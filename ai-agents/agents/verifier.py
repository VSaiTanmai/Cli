"""
Verifier Agent
===============
Validates findings against baselines and determines verdict.

Responsibilities:
1. Check confidence thresholds (statistical validation)
2. Compare against historical false-positive patterns
3. Validate temporal patterns (attack plausibility)
4. Cross-check with threat intelligence
5. Produce a verdict: true_positive / false_positive / suspicious / benign
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

import httpx

from .base import (
    BaseAgent,
    InvestigationContext,
    Verdict,
    VerificationData,
)

logger = logging.getLogger("clif.verifier")

# ── False-positive signatures ────────────────────────────────────────────────
# Known patterns that frequently cause false positives in network IDS.
# Each pattern has conditions that, if ALL met, increase the FP score.

FP_PATTERNS: List[Dict[str, Any]] = [
    {
        "name": "Health-check traffic",
        "description": "Internal load balancer health checks misclassified as probes",
        "conditions": {
            "category": "Probe",
            "same_srv_rate_gte": 0.95,
            "serror_rate_lte": 0.05,
            "logged_in": True,
        },
        "fp_score": 0.7,
    },
    {
        "name": "HTTP keep-alive burst",
        "description": "High connection count from keep-alive pipelining",
        "conditions": {
            "category": "DoS",
            "service": "http",
            "serror_rate_lte": 0.1,
            "logged_in": True,
        },
        "fp_score": 0.6,
    },
    {
        "name": "Batch SSH deployment",
        "description": "Automated SSH deployments (Ansible, SaltStack) cause R2L alerts",
        "conditions": {
            "category": "R2L",
            "service": "ssh",
            "num_failed_logins_lte": 0,
            "logged_in": True,
        },
        "fp_score": 0.65,
    },
    {
        "name": "Low-confidence single event",
        "description": "Single low-confidence alert with no corroborating events",
        "conditions": {
            "confidence_lte": 0.65,
            "correlated_events_lte": 1,
        },
        "fp_score": 0.5,
    },
    {
        "name": "DNS monitoring tool",
        "description": "DNS health/performance probes from monitoring systems",
        "conditions": {
            "category": "Probe",
            "service": "domain_u",
            "serror_rate_lte": 0.1,
        },
        "fp_score": 0.55,
    },
]


def _check_condition(key: str, expected: Any, event: Dict, triage, hunt) -> bool:
    """Evaluate a single FP pattern condition."""
    if key == "category":
        return triage.category == expected
    if key == "service":
        return event.get("service", "") == expected
    if key == "logged_in":
        return bool(event.get("logged_in", 0)) == expected
    if key.endswith("_gte"):
        field = key[:-4]
        return float(event.get(field, 0)) >= expected
    if key.endswith("_lte"):
        field = key[:-4]
        if field == "confidence":
            return triage.confidence <= expected
        if field == "correlated_events":
            return len(hunt.correlated_events) <= expected if hunt else True
        if field == "num_failed_logins":
            return int(event.get("num_failed_logins", 0)) <= expected
        return float(event.get(field, 0)) <= expected
    return False


class VerifierAgent(BaseAgent):
    """
    Validates attack findings through multi-layer confidence checks.
    """

    name = "Verifier Agent"
    description = "Validates findings against baselines and false-positive patterns"

    def __init__(
        self,
        clickhouse_url: str = "http://localhost:8123",
        clickhouse_user: str = "clif_admin",
        clickhouse_password: str = "Cl1f_Ch@ngeM3_2026!",
        clickhouse_db: str = "clif_logs",
        lancedb_url: str = "http://localhost:8100",
    ):
        super().__init__()
        self._ch_url = clickhouse_url
        self._ch_user = clickhouse_user
        self._ch_password = clickhouse_password
        self._ch_db = clickhouse_db
        self._lancedb_url = lancedb_url

    # ── ClickHouse helper ────────────────────────────────────────────────

    async def _ch_query(
        self, query: str, client: httpx.AsyncClient
    ) -> List[Dict[str, Any]]:
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
                return []
            import json
            lines = resp.text.strip().split("\n")
            return [json.loads(line) for line in lines if line.strip()]
        except Exception as exc:
            logger.warning("ClickHouse unreachable: %s", exc)
            return []

    # ── LanceDB threat intel check ───────────────────────────────────────

    async def _check_threat_intel(
        self, event: Dict, client: httpx.AsyncClient
    ) -> List[Dict]:
        """Search threat intelligence for IOCs related to the event."""
        ip = event.get("source_ip", event.get("ip_address", ""))
        if not ip:
            return []
        try:
            resp = await client.post(
                f"{self._lancedb_url}/search",
                json={"query": ip, "table": "threat_intel", "limit": 5},
                timeout=5.0,
            )
            if resp.status_code == 200:
                return resp.json().get("results", [])
        except Exception:
            pass
        return []

    # ── Verification checks ──────────────────────────────────────────────

    def _check_confidence_threshold(self, triage) -> tuple[bool, str]:
        """Check 1: ML confidence above operational threshold."""
        if triage.confidence >= 0.80:
            return True, f"ML confidence {triage.confidence:.2f} ≥ 0.80 threshold"
        elif triage.confidence >= 0.60:
            return True, f"ML confidence {triage.confidence:.2f} — moderate (0.60-0.80), needs corroboration"
        else:
            return False, f"ML confidence {triage.confidence:.2f} < 0.60 — below operational threshold"

    def _check_false_positive_patterns(
        self, event: Dict, triage, hunt
    ) -> tuple[float, List[str]]:
        """Check 2: Match against known FP patterns. Returns (fp_score, matched_patterns)."""
        total_fp_score = 0.0
        matched = []

        for pattern in FP_PATTERNS:
            conditions = pattern["conditions"]
            all_match = all(
                _check_condition(k, v, event, triage, hunt)
                for k, v in conditions.items()
            )
            if all_match:
                total_fp_score = max(total_fp_score, pattern["fp_score"])
                matched.append(f"{pattern['name']}: {pattern['description']}")

        return total_fp_score, matched

    def _check_corroboration(self, hunt) -> tuple[bool, str]:
        """Check 3: Multiple independent sources confirm the finding."""
        if not hunt or not hunt.correlated_events:
            return False, "No corroborating events found"

        n = len(hunt.correlated_events)
        types = set(e.correlation_type for e in hunt.correlated_events)
        sources = set(e.source_table for e in hunt.correlated_events)

        if n >= 5 and len(types) >= 2:
            return True, (
                f"Strong corroboration: {n} events from {len(types)} correlation types "
                f"({', '.join(types)}) across {len(sources)} source tables"
            )
        elif n >= 2:
            return True, f"Moderate corroboration: {n} correlated events found"
        else:
            return False, f"Weak corroboration: only {n} event(s) found"

    def _check_temporal_plausibility(self, hunt) -> tuple[bool, str]:
        """Check 4: Attack chain timing makes sense."""
        if not hunt or not hunt.attack_chain:
            return True, "No attack chain to validate"

        window = hunt.temporal_window_sec
        steps = len(hunt.attack_chain)

        if steps >= 2 and 0 < window <= 7200:  # <= 2 hours
            return True, f"Plausible timeline: {steps} steps over {window:.0f}s"
        elif steps >= 2 and window > 7200:
            return False, f"Suspicious timeline: {steps} steps over {window:.0f}s (>2 hours)"
        else:
            return True, f"Single-step event (no temporal chain)"

    async def _check_historical_baseline(
        self, triage, client: httpx.AsyncClient
    ) -> tuple[bool, str, int]:
        """Check 5: How often do we see this category from this source?"""
        category = triage.category

        # Query last 24h of this category
        rows = await self._ch_query(
            f"""
            SELECT count() AS cnt
            FROM security_events
            WHERE category = '{category}'
              AND timestamp > now() - INTERVAL 24 HOUR
            """,
            client,
        )

        if rows:
            count = int(rows[0].get("cnt", 0))
            if count > 100:
                return False, f"High volume: {count} '{category}' events in last 24h (possible noise)", count
            elif count > 20:
                return True, f"Moderate volume: {count} '{category}' events in last 24h", count
            else:
                return True, f"Low volume: {count} '{category}' events in last 24h (anomalous)", count

        return True, "Historical data unavailable — assuming valid", 0

    # ── Verdict computation ──────────────────────────────────────────────

    def _compute_verdict(
        self,
        triage,
        fp_score: float,
        checks_passed: List[str],
        checks_failed: List[str],
        threat_intel_hits: int,
    ) -> tuple[str, float, str]:
        """
        Compute final verdict, adjusted confidence, and recommendation.
        """
        n_passed = len(checks_passed)
        n_failed = len(checks_failed)
        total = n_passed + n_failed

        pass_ratio = n_passed / total if total > 0 else 0.5
        raw_conf = triage.confidence

        # Adjust confidence based on checks and FP score
        adjusted = raw_conf * (0.5 + 0.5 * pass_ratio) * (1.0 - fp_score * 0.5)
        if threat_intel_hits > 0:
            adjusted = min(1.0, adjusted * 1.2)  # Boost if in threat intel
        adjusted = round(max(0.0, min(1.0, adjusted)), 4)

        # Verdict logic
        if not triage.is_attack:
            verdict = Verdict.BENIGN.value
            rec = "No action required — traffic classified as benign."
        elif fp_score >= 0.6 and adjusted < 0.5:
            verdict = Verdict.FALSE_POSITIVE.value
            rec = (
                "Likely false positive — matches known FP patterns. "
                "Consider adding to allowlist if recurring."
            )
        elif adjusted >= 0.75:
            verdict = Verdict.TRUE_POSITIVE.value
            rec = (
                f"Confirmed {triage.category} attack (adjusted confidence: {adjusted:.1%}). "
                f"Recommend immediate incident response per {triage.priority} SLA."
            )
        elif adjusted >= 0.50:
            verdict = Verdict.SUSPICIOUS.value
            rec = (
                f"Suspicious activity — moderate confidence ({adjusted:.1%}). "
                f"Recommend manual review by SOC analyst."
            )
        else:
            verdict = Verdict.INCONCLUSIVE.value
            rec = (
                f"Insufficient confidence ({adjusted:.1%}). "
                f"Recommend continued monitoring and correlation."
            )

        return verdict, adjusted, rec

    # ── Main execution ───────────────────────────────────────────────────

    async def _execute(self, ctx: InvestigationContext) -> InvestigationContext:
        triage = ctx.triage
        hunt = ctx.hunt
        event = ctx.trigger_event

        if not triage:
            raise ValueError("No triage data — run Triage Agent first")

        checks_passed: List[str] = []
        checks_failed: List[str] = []
        checks_performed: List[str] = []

        # ── Check 1: Confidence threshold ────────────────────────────
        ok, msg = self._check_confidence_threshold(triage)
        checks_performed.append(f"Confidence threshold: {msg}")
        (checks_passed if ok else checks_failed).append(msg)

        # ── Check 2: False positive patterns ─────────────────────────
        fp_score, fp_matches = self._check_false_positive_patterns(event, triage, hunt)
        checks_performed.append(f"FP pattern check: score={fp_score:.2f}, matches={len(fp_matches)}")
        if fp_score < 0.5:
            checks_passed.append(f"No significant FP patterns matched (score={fp_score:.2f})")
        else:
            checks_failed.append(
                f"FP pattern(s) matched (score={fp_score:.2f}): " + "; ".join(fp_matches)
            )

        # ── Check 3: Corroboration ───────────────────────────────────
        ok, msg = self._check_corroboration(hunt)
        checks_performed.append(f"Corroboration: {msg}")
        (checks_passed if ok else checks_failed).append(msg)

        # ── Check 4: Temporal plausibility ───────────────────────────
        ok, msg = self._check_temporal_plausibility(hunt)
        checks_performed.append(f"Temporal: {msg}")
        (checks_passed if ok else checks_failed).append(msg)

        # ── Check 5: Historical baseline (async) ─────────────────────
        async with httpx.AsyncClient() as client:
            ok, msg, hist_count = await self._check_historical_baseline(triage, client)
            checks_performed.append(f"Historical baseline: {msg}")
            (checks_passed if ok else checks_failed).append(msg)

            # ── Check 6: Threat intelligence ─────────────────────────
            ti_results = await self._check_threat_intel(event, client)
            if ti_results:
                checks_performed.append(f"Threat intel: {len(ti_results)} IOC matches found")
                checks_passed.append(f"Threat intel match: {len(ti_results)} IOCs corroborate the finding")
            else:
                checks_performed.append("Threat intel: No matching IOCs found")
                # Not a failure — just no additional signal

        # ── Compute verdict ──────────────────────────────────────────
        verdict, adjusted_confidence, recommendation = self._compute_verdict(
            triage, fp_score, checks_passed, checks_failed, len(ti_results)
        )

        # ── Evidence summary ─────────────────────────────────────────
        evidence_parts = [
            f"ML classifier: {triage.category} ({triage.confidence:.1%})",
        ]
        if hunt and hunt.correlated_events:
            evidence_parts.append(
                f"Correlated events: {len(hunt.correlated_events)} "
                f"({hunt.clickhouse_matches} DB + {hunt.semantic_matches} semantic)"
            )
        if hunt and hunt.attack_chain:
            evidence_parts.append(f"Attack chain: {len(hunt.attack_chain)} steps")
        if ti_results:
            evidence_parts.append(f"Threat intel: {len(ti_results)} IOC matches")
        evidence_summary = " | ".join(evidence_parts)

        # ── Build result ─────────────────────────────────────────────
        ctx.verification = VerificationData(
            verdict=verdict,
            adjusted_confidence=adjusted_confidence,
            false_positive_score=round(fp_score, 4),
            evidence_summary=evidence_summary,
            checks_performed=checks_performed,
            checks_passed=checks_passed,
            checks_failed=checks_failed,
            historical_similar_count=hist_count,
            baseline_deviation=0.0,
            recommendation=recommendation,
        )
        ctx.status = "verified"

        self._last_action = (
            f"Verified {triage.category} alert — verdict: {verdict.upper()} "
            f"(adjusted confidence: {adjusted_confidence:.1%}). "
            f"{len(checks_passed)}/{len(checks_passed)+len(checks_failed)} checks passed. "
            f"FP score: {fp_score:.2f}. {recommendation[:80]}"
        )

        return ctx
