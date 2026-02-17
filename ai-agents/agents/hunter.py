"""
Hunter Agent
=============
Deep-dive investigation — correlates events and traces attack paths.

Responsibilities:
1. Query ClickHouse for temporally and IP-correlated events
2. Query LanceDB for semantically similar events
3. Build attack chain / timeline
4. Identify affected hosts, IPs, users
5. Map to MITRE ATT&CK framework
"""

from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

from .base import (
    AttackChainStep,
    BaseAgent,
    CorrelatedEvent,
    HuntData,
    InvestigationContext,
)

logger = logging.getLogger("clif.hunter")

# ── MITRE enrichment lookup for ML categories ───────────────────────────────

_MITRE_EXPANSION: Dict[str, List[Dict[str, str]]] = {
    "DoS": [
        {"tactic": "impact", "technique": "T1499", "name": "Endpoint Denial of Service"},
        {"tactic": "impact", "technique": "T1498", "name": "Network Denial of Service"},
    ],
    "Probe": [
        {"tactic": "discovery", "technique": "T1046", "name": "Network Service Discovery"},
        {"tactic": "reconnaissance", "technique": "T1595", "name": "Active Scanning"},
    ],
    "R2L": [
        {"tactic": "initial-access", "technique": "T1133", "name": "External Remote Services"},
        {"tactic": "credential-access", "technique": "T1110", "name": "Brute Force"},
    ],
    "U2R": [
        {"tactic": "privilege-escalation", "technique": "T1068", "name": "Exploitation for Privilege Escalation"},
        {"tactic": "execution", "technique": "T1059", "name": "Command and Scripting Interpreter"},
    ],
}


class HunterAgent(BaseAgent):
    """
    Investigates triaged attack events by correlating across data sources.
    """

    name = "Hunter Agent"
    description = "Deep-dive investigation — correlates events and traces attack paths"

    def __init__(
        self,
        clickhouse_url: str = "http://localhost:8123",
        clickhouse_user: str = "clif_admin",
        clickhouse_password: str = "Cl1f_Ch@ngeM3_2026!",
        clickhouse_db: str = "clif_logs",
        lancedb_url: str = "http://localhost:8100",
        correlation_window_min: int = 30,
        max_correlated: int = 50,
        max_semantic: int = 20,
    ):
        super().__init__()
        self._ch_url = clickhouse_url
        self._ch_user = clickhouse_user
        self._ch_password = clickhouse_password
        self._ch_db = clickhouse_db
        self._lancedb_url = lancedb_url
        self._window_min = correlation_window_min
        self._max_correlated = max_correlated
        self._max_semantic = max_semantic

    # ── ClickHouse HTTP query helper ─────────────────────────────────────

    async def _ch_query(
        self, query: str, client: httpx.AsyncClient
    ) -> List[Dict[str, Any]]:
        """Execute a ClickHouse query via HTTP interface, return rows as dicts."""
        try:
            resp = await client.post(
                self._ch_url,
                content=query,
                params={
                    "user": self._ch_user,
                    "password": self._ch_password,
                    "database": self._ch_db,
                    "default_format": "JSONEachRow",
                },
                timeout=10.0,
            )
            if resp.status_code != 200:
                logger.warning("ClickHouse query failed (%d): %s", resp.status_code, resp.text[:200])
                return []
            lines = resp.text.strip().split("\n")
            import json
            return [json.loads(line) for line in lines if line.strip()]
        except Exception as exc:
            logger.warning("ClickHouse unreachable: %s", exc)
            return []

    # ── LanceDB search helper ────────────────────────────────────────────

    async def _lance_search(
        self, query: str, client: httpx.AsyncClient, limit: int = 20,
        table: str = "log_embeddings", filter_sql: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Semantic search via LanceDB REST API."""
        try:
            body: Dict[str, Any] = {"query": query, "table": table, "limit": limit}
            if filter_sql:
                body["filter"] = filter_sql
            resp = await client.post(
                f"{self._lancedb_url}/search",
                json=body,
                timeout=10.0,
            )
            if resp.status_code != 200:
                logger.warning("LanceDB search failed (%d): %s", resp.status_code, resp.text[:200])
                return []
            data = resp.json()
            return data.get("results", [])
        except Exception as exc:
            logger.warning("LanceDB unreachable: %s", exc)
            return []

    # ── Correlation queries ──────────────────────────────────────────────

    async def _correlate_security_events(
        self, event: Dict[str, Any], client: httpx.AsyncClient,
        time_from: str, time_to: str,
    ) -> List[Dict[str, Any]]:
        """Find security events in the same time window from same IP/host."""
        ip = event.get("source_ip", event.get("ip_address", ""))
        hostname = event.get("hostname", "")

        conditions = [f"timestamp BETWEEN '{time_from}' AND '{time_to}'"]
        if ip:
            conditions.append(f"ip_address = toIPv4('{ip}')")
        if hostname:
            conditions.append(f"hostname = '{hostname}'")

        # Use OR for IP/hostname so we get both
        if ip and hostname:
            where = (f"timestamp BETWEEN '{time_from}' AND '{time_to}' "
                     f"AND (ip_address = toIPv4('{ip}') OR hostname = '{hostname}')")
        elif ip:
            where = f"timestamp BETWEEN '{time_from}' AND '{time_to}' AND ip_address = toIPv4('{ip}')"
        elif hostname:
            where = f"timestamp BETWEEN '{time_from}' AND '{time_to}' AND hostname = '{hostname}'"
        else:
            where = f"timestamp BETWEEN '{time_from}' AND '{time_to}'"

        query = f"""
            SELECT
                toString(event_id) AS event_id,
                toString(timestamp) AS timestamp,
                severity,
                category,
                description,
                hostname,
                IPv4NumToString(ip_address) AS ip_address,
                mitre_tactic,
                mitre_technique,
                ai_confidence
            FROM security_events
            WHERE {where}
            ORDER BY timestamp ASC
            LIMIT {self._max_correlated}
        """
        return await self._ch_query(query, client)

    async def _correlate_network_events(
        self, event: Dict[str, Any], client: httpx.AsyncClient,
        time_from: str, time_to: str,
    ) -> List[Dict[str, Any]]:
        """Find network events involving the same IPs."""
        ip = event.get("source_ip", event.get("ip_address", ""))
        if not ip:
            return []

        query = f"""
            SELECT
                toString(event_id) AS event_id,
                toString(timestamp) AS timestamp,
                hostname,
                IPv4NumToString(src_ip) AS src_ip,
                src_port,
                IPv4NumToString(dst_ip) AS dst_ip,
                dst_port,
                protocol,
                direction,
                bytes_sent,
                bytes_received,
                duration_ms,
                binary_path,
                dns_query,
                is_suspicious,
                detection_rule
            FROM network_events
            WHERE timestamp BETWEEN '{time_from}' AND '{time_to}'
              AND (src_ip = toIPv4('{ip}') OR dst_ip = toIPv4('{ip}'))
            ORDER BY timestamp ASC
            LIMIT {self._max_correlated}
        """
        return await self._ch_query(query, client)

    async def _correlate_process_events(
        self, event: Dict[str, Any], client: httpx.AsyncClient,
        time_from: str, time_to: str,
    ) -> List[Dict[str, Any]]:
        """Find suspicious process events on the same host."""
        hostname = event.get("hostname", "")
        if not hostname:
            return []

        query = f"""
            SELECT
                toString(event_id) AS event_id,
                toString(timestamp) AS timestamp,
                hostname,
                pid,
                ppid,
                binary_path,
                arguments,
                is_suspicious,
                detection_rule
            FROM process_events
            WHERE timestamp BETWEEN '{time_from}' AND '{time_to}'
              AND hostname = '{hostname}'
              AND is_suspicious = 1
            ORDER BY timestamp ASC
            LIMIT {self._max_correlated}
        """
        return await self._ch_query(query, client)

    # ── Build attack chain ───────────────────────────────────────────────

    def _build_attack_chain(
        self,
        triage_data,
        sec_events: List[Dict],
        net_events: List[Dict],
        proc_events: List[Dict],
    ) -> List[AttackChainStep]:
        """Merge all correlated events into a chronological attack timeline."""
        steps: List[AttackChainStep] = []

        for ev in sec_events:
            steps.append(AttackChainStep(
                timestamp=ev.get("timestamp", ""),
                event_id=ev.get("event_id", ""),
                action=f"[Security] {ev.get('category', 'unknown')}: {ev.get('description', '')[:120]}",
                source=ev.get("ip_address", ""),
                target=ev.get("hostname", ""),
                mitre_tactic=ev.get("mitre_tactic", ""),
                mitre_technique=ev.get("mitre_technique", ""),
            ))

        for ev in net_events:
            direction = ev.get("direction", "outbound")
            action = (
                f"[Network] {ev.get('src_ip', '')}:{ev.get('src_port', '')} → "
                f"{ev.get('dst_ip', '')}:{ev.get('dst_port', '')} "
                f"({ev.get('protocol', '')}/{direction})"
            )
            if ev.get("dns_query"):
                action += f" DNS={ev['dns_query']}"
            if ev.get("is_suspicious"):
                action += f" ⚠ {ev.get('detection_rule', 'suspicious')}"
            steps.append(AttackChainStep(
                timestamp=ev.get("timestamp", ""),
                event_id=ev.get("event_id", ""),
                action=action,
                source=ev.get("src_ip", ""),
                target=ev.get("dst_ip", ""),
            ))

        for ev in proc_events:
            steps.append(AttackChainStep(
                timestamp=ev.get("timestamp", ""),
                event_id=ev.get("event_id", ""),
                action=f"[Process] {ev.get('binary_path', '')} {ev.get('arguments', '')[:80]} (PID:{ev.get('pid', '')})",
                source=ev.get("hostname", ""),
                target=ev.get("binary_path", ""),
                mitre_tactic=triage_data.mitre_tactic if triage_data else "",
                mitre_technique=triage_data.mitre_technique if triage_data else "",
            ))

        # Sort by timestamp
        steps.sort(key=lambda s: s.timestamp)
        return steps

    # ── Main execution ───────────────────────────────────────────────────

    async def _execute(self, ctx: InvestigationContext) -> InvestigationContext:
        if not ctx.triage or not ctx.triage.is_attack:
            # Nothing to hunt — benign traffic
            ctx.hunt = HuntData()
            ctx.status = "hunted"
            self._last_action = "Skipped — event classified as benign by Triage Agent"
            return ctx

        event = ctx.trigger_event
        triage = ctx.triage

        # ── Time window ──────────────────────────────────────────────
        now = datetime.now(timezone.utc)
        ts_str = event.get("timestamp", "")
        if ts_str:
            try:
                event_time = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                event_time = now
        else:
            event_time = now

        time_from = (event_time - timedelta(minutes=self._window_min)).strftime("%Y-%m-%d %H:%M:%S")
        time_to = (event_time + timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")

        # ── Run parallel queries ─────────────────────────────────────
        async with httpx.AsyncClient() as client:
            # Parallelize ClickHouse + LanceDB queries
            sec_task = self._correlate_security_events(event, client, time_from, time_to)
            net_task = self._correlate_network_events(event, client, time_from, time_to)
            proc_task = self._correlate_process_events(event, client, time_from, time_to)

            # Semantic search in LanceDB
            search_text = (
                f"{triage.category} attack {triage.explanation} "
                f"from {event.get('source_ip', event.get('ip_address', 'unknown'))}"
            )
            sem_task = self._lance_search(search_text, client, limit=self._max_semantic)

            sec_events, net_events, proc_events, sem_results = await asyncio.gather(
                sec_task, net_task, proc_task, sem_task
            )

        # ── Build correlated events list ─────────────────────────────
        correlated: List[CorrelatedEvent] = []
        seen_ids: set = set()

        for ev in sec_events:
            eid = ev.get("event_id", "")
            if eid in seen_ids:
                continue
            seen_ids.add(eid)
            correlated.append(CorrelatedEvent(
                event_id=eid,
                timestamp=ev.get("timestamp", ""),
                source_table="security_events",
                category=ev.get("category", ""),
                severity=int(ev.get("severity", 0)),
                description=ev.get("description", "")[:200],
                hostname=ev.get("hostname", ""),
                ip_address=ev.get("ip_address", ""),
                similarity_score=1.0,
                correlation_type="temporal",
            ))

        for ev in net_events:
            eid = ev.get("event_id", "")
            if eid in seen_ids:
                continue
            seen_ids.add(eid)
            correlated.append(CorrelatedEvent(
                event_id=eid,
                timestamp=ev.get("timestamp", ""),
                source_table="network_events",
                category="network",
                severity=1 if ev.get("is_suspicious") else 0,
                description=f"{ev.get('src_ip', '')}→{ev.get('dst_ip', '')} {ev.get('protocol', '')}",
                hostname=ev.get("hostname", ""),
                ip_address=ev.get("src_ip", ""),
                similarity_score=0.8,
                correlation_type="ip",
            ))

        for ev in proc_events:
            eid = ev.get("event_id", "")
            if eid in seen_ids:
                continue
            seen_ids.add(eid)
            correlated.append(CorrelatedEvent(
                event_id=eid,
                timestamp=ev.get("timestamp", ""),
                source_table="process_events",
                category="process",
                severity=1 if ev.get("is_suspicious") else 0,
                description=f"{ev.get('binary_path', '')} (PID:{ev.get('pid', '')})",
                hostname=ev.get("hostname", ""),
                ip_address="",
                similarity_score=0.7,
                correlation_type="hostname",
            ))

        for ev in sem_results:
            eid = ev.get("event_id", "")
            if eid in seen_ids:
                continue
            seen_ids.add(eid)
            distance = ev.get("_distance", 1.0)
            sim_score = max(0.0, 1.0 - distance)
            correlated.append(CorrelatedEvent(
                event_id=eid,
                timestamp=ev.get("timestamp", ""),
                source_table=ev.get("source_table", "log_embeddings"),
                category="semantic",
                severity=int(ev.get("severity", 0)),
                description=ev.get("text", "")[:200],
                hostname=ev.get("hostname", ""),
                ip_address="",
                similarity_score=round(sim_score, 4),
                correlation_type="semantic",
            ))

        # ── Collect unique affected assets ───────────────────────────
        hosts = OrderedDict()
        ips = OrderedDict()
        users = OrderedDict()

        for c in correlated:
            if c.hostname:
                hosts[c.hostname] = True
            if c.ip_address:
                ips[c.ip_address] = True
        for ev in sec_events:
            if ev.get("hostname"):
                hosts[ev["hostname"]] = True
            if ev.get("ip_address"):
                ips[ev["ip_address"]] = True

        # Users from trigger event
        if event.get("user_id"):
            users[event["user_id"]] = True

        # ── MITRE tactics/techniques ─────────────────────────────────
        tactics = OrderedDict()
        techniques = OrderedDict()

        if triage.mitre_tactic:
            tactics[triage.mitre_tactic] = True
        if triage.mitre_technique:
            techniques[triage.mitre_technique] = True

        for ev in sec_events:
            t = ev.get("mitre_tactic", "")
            if t:
                tactics[t] = True
            tech = ev.get("mitre_technique", "")
            if tech:
                techniques[tech] = True

        # Add expanded MITRE from category
        for m in _MITRE_EXPANSION.get(triage.category, []):
            tactics[m["tactic"]] = True
            techniques[m["technique"]] = True

        # ── Attack chain ─────────────────────────────────────────────
        attack_chain = self._build_attack_chain(triage, sec_events, net_events, proc_events)

        # ── Temporal window ──────────────────────────────────────────
        timestamps = [c.timestamp for c in correlated if c.timestamp]
        if len(timestamps) >= 2:
            try:
                ts_sorted = sorted(timestamps)
                t_first = datetime.fromisoformat(ts_sorted[0].replace("Z", "+00:00").replace(" ", "T"))
                t_last = datetime.fromisoformat(ts_sorted[-1].replace("Z", "+00:00").replace(" ", "T"))
                window_sec = (t_last - t_first).total_seconds()
            except (ValueError, TypeError):
                window_sec = 0.0
        else:
            window_sec = 0.0

        # ── Build result ─────────────────────────────────────────────
        hunt = HuntData(
            correlated_events=correlated,
            attack_chain=attack_chain,
            affected_hosts=list(hosts.keys()),
            affected_ips=list(ips.keys()),
            affected_users=list(users.keys()),
            mitre_tactics=list(tactics.keys()),
            mitre_techniques=list(techniques.keys()),
            temporal_window_sec=round(window_sec, 1),
            semantic_matches=len(sem_results),
            clickhouse_matches=len(sec_events) + len(net_events) + len(proc_events),
        )

        ctx.hunt = hunt
        ctx.status = "hunted"

        self._last_action = (
            f"Investigated {triage.category} attack — "
            f"found {len(correlated)} correlated events "
            f"({hunt.clickhouse_matches} from ClickHouse, {hunt.semantic_matches} semantic). "
            f"Affected: {len(hunt.affected_hosts)} hosts, {len(hunt.affected_ips)} IPs. "
            f"MITRE: {', '.join(hunt.mitre_tactics)}. "
            f"Attack chain: {len(attack_chain)} steps over {window_sec:.0f}s."
        )

        return ctx
