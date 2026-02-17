"""
Hunter Agent
=============
Deep-dive investigation — correlates events and traces attack paths.

Responsibilities:
1. Query ClickHouse for temporally and IP-correlated events
2. Query raw_logs table for cross-log-type correlation
3. Query LanceDB for semantically similar events
4. Build attack chain / timeline
5. Identify affected hosts, IPs, users
6. Map to MITRE ATT&CK framework

Supports ALL log types: Network, Sysmon, Windows Security, Auth, Firewall, Generic.
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
from .llm import is_llm_available, llm_hypothesis

logger = logging.getLogger("clif.hunter")

# ── MITRE enrichment lookup ─────────────────────────────────────────────────
# Covers NSL-KDD ML categories AND rule-based classifier categories.

_MITRE_EXPANSION: Dict[str, List[Dict[str, str]]] = {
    # NSL-KDD ML categories
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
    # Rule-based classifier categories
    "Execution": [
        {"tactic": "execution", "technique": "T1059", "name": "Command and Scripting Interpreter"},
    ],
    "Persistence": [
        {"tactic": "persistence", "technique": "T1547", "name": "Boot or Logon Autostart Execution"},
    ],
    "Defense Evasion": [
        {"tactic": "defense-evasion", "technique": "T1562", "name": "Impair Defenses"},
    ],
    "Credential Access": [
        {"tactic": "credential-access", "technique": "T1003", "name": "OS Credential Dumping"},
        {"tactic": "credential-access", "technique": "T1110", "name": "Brute Force"},
    ],
    "Lateral Movement": [
        {"tactic": "lateral-movement", "technique": "T1021", "name": "Remote Services"},
    ],
    "Command and Control": [
        {"tactic": "command-and-control", "technique": "T1071", "name": "Application Layer Protocol"},
    ],
    "Brute Force": [
        {"tactic": "credential-access", "technique": "T1110", "name": "Brute Force"},
    ],
    "Privilege Escalation": [
        {"tactic": "privilege-escalation", "technique": "T1548", "name": "Abuse Elevation Control Mechanism"},
    ],
    "Account Manipulation": [
        {"tactic": "persistence", "technique": "T1098", "name": "Account Manipulation"},
    ],
    "Audit Tampering": [
        {"tactic": "defense-evasion", "technique": "T1070", "name": "Indicator Removal"},
    ],
    "Suspicious Process": [
        {"tactic": "execution", "technique": "T1059", "name": "Command and Scripting Interpreter"},
        {"tactic": "defense-evasion", "technique": "T1036", "name": "Masquerading"},
    ],
    "Firewall Evasion": [
        {"tactic": "command-and-control", "technique": "T1571", "name": "Non-Standard Port"},
    ],
}

# Log types that have no reason to query network_events
_SKIP_NETWORK_QUERY = {"auth", "windows_security", "generic"}
# Log types that have no reason to query process_events
_SKIP_PROCESS_QUERY = {"firewall"}


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

    async def _correlate_raw_logs(
        self, event: Dict[str, Any], client: httpx.AsyncClient,
        time_from: str, time_to: str,
    ) -> List[Dict[str, Any]]:
        """Query raw_logs table for cross-log-type correlation.

        raw_logs schema: event_id, timestamp, level, source, message,
                         metadata, user_id, ip_address, request_id
        """
        ip = event.get("source_ip", event.get("ip_address", ""))
        user = event.get("user_id", event.get("user", event.get("TargetUserName", "")))
        hostname = event.get("hostname", event.get("Computer", ""))
        source = event.get("source", event.get("Source", ""))

        conditions = [f"timestamp BETWEEN '{time_from}' AND '{time_to}'"]
        or_parts: List[str] = []
        if ip:
            or_parts.append(f"ip_address = '{ip}'")
        if user:
            or_parts.append(f"user_id = '{user}'")
        if hostname:
            or_parts.append(f"message LIKE '%{hostname}%'")
        if source:
            or_parts.append(f"source = '{source}'")

        if not or_parts:
            return []

        where = f"timestamp BETWEEN '{time_from}' AND '{time_to}' AND ({' OR '.join(or_parts)})"

        query = f"""
            SELECT
                toString(event_id) AS event_id,
                toString(timestamp) AS timestamp,
                level,
                source,
                substring(message, 1, 250) AS message,
                user_id,
                ip_address
            FROM raw_logs
            WHERE {where}
              AND level IN ('critical', 'error', 'warning', 'alert', 'emergency')
            ORDER BY timestamp ASC
            LIMIT {self._max_correlated}
        """
        return await self._ch_query(query, client)

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
        raw_events: List[Dict] | None = None,
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

        # Raw log events (cross-log-type correlation)
        for ev in (raw_events or []):
            lvl = ev.get("level", "").upper()
            src = ev.get("source", "unknown")
            msg = ev.get("message", "")[:120]
            steps.append(AttackChainStep(
                timestamp=ev.get("timestamp", ""),
                event_id=ev.get("event_id", ""),
                action=f"[RawLog/{src}] ({lvl}) {msg}",
                source=ev.get("ip_address", ""),
                target=ev.get("user_id", ""),
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
        log_type = triage.log_type  # e.g. "network", "sysmon", "auth", etc.

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

        # ── Run parallel queries (log-type-aware) ────────────────────
        async with httpx.AsyncClient() as client:
            tasks: Dict[str, Any] = {}

            # Always run: security_events + raw_logs + semantic search
            tasks["sec"] = self._correlate_security_events(event, client, time_from, time_to)
            tasks["raw"] = self._correlate_raw_logs(event, client, time_from, time_to)

            # Network events — skip for auth/winsec/generic  log types
            if log_type not in _SKIP_NETWORK_QUERY:
                tasks["net"] = self._correlate_network_events(event, client, time_from, time_to)

            # Process events — skip for firewall  log type
            if log_type not in _SKIP_PROCESS_QUERY:
                tasks["proc"] = self._correlate_process_events(event, client, time_from, time_to)

            # Semantic search in LanceDB
            search_text = (
                f"{triage.category} {log_type} {triage.explanation} "
                f"from {event.get('source_ip', event.get('ip_address', event.get('hostname', 'unknown')))}"
            )
            tasks["sem"] = self._lance_search(search_text, client, limit=self._max_semantic)

            # Await all in parallel
            keys = list(tasks.keys())
            results = await asyncio.gather(*tasks.values())
            result_map = dict(zip(keys, results))

        sec_events = result_map.get("sec", [])
        net_events = result_map.get("net", [])
        proc_events = result_map.get("proc", [])
        raw_events = result_map.get("raw", [])
        sem_results = result_map.get("sem", [])

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

        for ev in raw_events:
            eid = ev.get("event_id", "")
            if eid in seen_ids:
                continue
            seen_ids.add(eid)
            correlated.append(CorrelatedEvent(
                event_id=eid,
                timestamp=ev.get("timestamp", ""),
                source_table="raw_logs",
                category=ev.get("source", "raw"),
                severity=2 if ev.get("level", "") in ("critical", "emergency") else 1,
                description=ev.get("message", "")[:200],
                hostname="",
                ip_address=ev.get("ip_address", ""),
                similarity_score=0.65,
                correlation_type="cross_log",
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
        if event.get("user"):
            users[event["user"]] = True
        if event.get("TargetUserName"):
            users[event["TargetUserName"]] = True

        # Users from raw_logs correlation
        for ev in raw_events:
            if ev.get("user_id"):
                users[ev["user_id"]] = True
            if ev.get("ip_address"):
                ips[ev["ip_address"]] = True

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
        attack_chain = self._build_attack_chain(triage, sec_events, net_events, proc_events, raw_events)

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

        # ── DSPy/LLM: Generate threat hypotheses ─────────────────────
        llm_narrative = ""
        llm_hypo = ""
        llm_queries = ""
        llm_risk = ""

        if is_llm_available() and triage.is_attack:
            import json
            alert_summary = (
                f"Category: {triage.category}, Severity: {triage.severity}, "
                f"Confidence: {triage.confidence:.2f}, Priority: {triage.priority}, "
                f"MITRE: {triage.mitre_tactic}/{triage.mitre_technique}, "
                f"Log type: {log_type}, Classifier: {triage.classifier_used}, "
                f"Matched rules: {', '.join(triage.matched_rules) if triage.matched_rules else 'N/A'}"
            )

            corr_summary_items = []
            for c in correlated[:10]:  # Top 10 for LLM context
                corr_summary_items.append({
                    "table": c.source_table,
                    "category": c.category,
                    "type": c.correlation_type,
                    "desc": c.description[:100],
                })
            corr_str = json.dumps(corr_summary_items, default=str)[:2000]

            try:
                hypo = llm_hypothesis(
                    alert_summary=alert_summary,
                    correlated_events=corr_str,
                    log_type=log_type,
                )
                if hypo:
                    llm_narrative = hypo.get("attack_narrative", "")
                    llm_hypo = hypo.get("hypotheses", "")
                    llm_queries = hypo.get("recommended_queries", "")
                    llm_risk = hypo.get("risk_assessment", "")
                    logger.info(
                        "[%s] LLM hypothesis generated: %s",
                        ctx.investigation_id, llm_narrative[:100],
                    )
            except Exception as e:
                logger.warning("LLM hypothesis generation failed: %s", e)

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
            clickhouse_matches=len(sec_events) + len(net_events) + len(proc_events) + len(raw_events),
            llm_attack_narrative=llm_narrative,
            llm_hypotheses=llm_hypo,
            llm_recommended_queries=llm_queries,
            llm_risk_assessment=llm_risk,
        )

        ctx.hunt = hunt
        ctx.status = "hunted"

        llm_tag = " [DSPy-enhanced]" if llm_narrative else ""
        self._last_action = (
            f"Investigated {triage.category} attack — "
            f"found {len(correlated)} correlated events "
            f"({hunt.clickhouse_matches} from ClickHouse, {hunt.semantic_matches} semantic). "
            f"Affected: {len(hunt.affected_hosts)} hosts, {len(hunt.affected_ips)} IPs. "
            f"MITRE: {', '.join(hunt.mitre_tactics)}. "
            f"Attack chain: {len(attack_chain)} steps over {window_sec:.0f}s.{llm_tag}"
        )

        return ctx
