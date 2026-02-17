"""
Agent Orchestrator
===================
Manages the full investigation pipeline: Triage → Hunter → Verifier → Reporter.

Features:
- Sequential pipeline with early-exit for benign traffic
- Shared InvestigationContext passed through each agent
- Full timing and audit trail
- Configurable agent parameters
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .base import InvestigationContext
from .triage import TriageAgent
from .hunter import HunterAgent
from .verifier import VerifierAgent
from .reporter import ReporterAgent

logger = logging.getLogger("clif.orchestrator")


class Orchestrator:
    """
    Runs the 4-agent investigation pipeline.

    Usage:
        orch = Orchestrator()
        result = await orch.investigate(event_dict)
    """

    def __init__(
        self,
        classifier=None,
        clickhouse_url: str = "http://localhost:8123",
        clickhouse_user: str = "clif_admin",
        clickhouse_password: str = "Cl1f_Ch@ngeM3_2026!",
        clickhouse_db: str = "clif_logs",
        lancedb_url: str = "http://localhost:8100",
    ):
        self.triage_agent = TriageAgent(classifier=classifier)
        self.hunter_agent = HunterAgent(
            clickhouse_url=clickhouse_url,
            clickhouse_user=clickhouse_user,
            clickhouse_password=clickhouse_password,
            clickhouse_db=clickhouse_db,
            lancedb_url=lancedb_url,
        )
        self.verifier_agent = VerifierAgent(
            clickhouse_url=clickhouse_url,
            clickhouse_user=clickhouse_user,
            clickhouse_password=clickhouse_password,
            clickhouse_db=clickhouse_db,
            lancedb_url=lancedb_url,
        )
        self.reporter_agent = ReporterAgent()

        self._investigations: List[Dict[str, Any]] = []

    @property
    def agents(self) -> list:
        return [
            self.triage_agent,
            self.hunter_agent,
            self.verifier_agent,
            self.reporter_agent,
        ]

    def get_agent_statuses(self) -> List[Dict[str, Any]]:
        """Return status of all agents for the dashboard."""
        return [agent.stats for agent in self.agents]

    def get_recent_investigations(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Return recent investigation summaries."""
        return self._investigations[-limit:][::-1]

    async def investigate(
        self,
        event: Dict[str, Any],
        source: str = "api",
        full_pipeline: bool = True,
    ) -> Dict[str, Any]:
        """
        Run the full investigation pipeline on a security event.

        Args:
            event: Event dict with NSL-KDD features or CLIF fields.
            source: Origin of the event ("api", "redpanda", "manual").
            full_pipeline: If False, stop after triage (for quick classification).

        Returns:
            Serialised InvestigationContext as a dict.
        """
        ctx = InvestigationContext(
            trigger_event=event,
            trigger_source=source,
        )

        logger.info("[%s] Starting investigation — source=%s", ctx.investigation_id, source)

        # ── Stage 1: Triage ──────────────────────────────────────────
        ctx = await self.triage_agent.run(ctx)

        if ctx.error:
            logger.error("[%s] Triage failed: %s", ctx.investigation_id, ctx.error)
            return self._serialise(ctx)

        if not full_pipeline or not ctx.triage or not ctx.triage.is_attack:
            # Benign traffic or quick mode — skip deeper investigation
            if ctx.triage and not ctx.triage.is_attack:
                ctx.status = "closed"
                logger.info(
                    "[%s] Benign traffic — confidence %.2f, closing",
                    ctx.investigation_id, ctx.triage.confidence,
                )
            self._record(ctx)
            return self._serialise(ctx)

        logger.info(
            "[%s] Attack detected: %s (%.2f) — priority %s, starting hunt",
            ctx.investigation_id,
            ctx.triage.category,
            ctx.triage.confidence,
            ctx.triage.priority,
        )

        # ── Stage 2: Hunt ────────────────────────────────────────────
        ctx = await self.hunter_agent.run(ctx)

        if ctx.error:
            logger.warning("[%s] Hunter error (non-fatal): %s", ctx.investigation_id, ctx.error)
            ctx.error = None  # Non-fatal — continue pipeline

        # ── Stage 3: Verify ──────────────────────────────────────────
        ctx = await self.verifier_agent.run(ctx)

        if ctx.error:
            logger.warning("[%s] Verifier error (non-fatal): %s", ctx.investigation_id, ctx.error)
            ctx.error = None

        # ── Stage 4: Report ──────────────────────────────────────────
        ctx = await self.reporter_agent.run(ctx)

        if ctx.error:
            logger.warning("[%s] Reporter error (non-fatal): %s", ctx.investigation_id, ctx.error)
            ctx.error = None

        ctx.status = "completed"
        logger.info(
            "[%s] Investigation complete — verdict: %s, priority: %s",
            ctx.investigation_id,
            ctx.verification.verdict if ctx.verification else "N/A",
            ctx.triage.priority if ctx.triage else "N/A",
        )

        self._record(ctx)
        return self._serialise(ctx)

    async def triage_only(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """Quick triage without full investigation (for high-throughput mode)."""
        return await self.investigate(event, source="api", full_pipeline=False)

    def _record(self, ctx: InvestigationContext):
        """Store investigation summary in memory (last 100)."""
        summary = {
            "investigation_id": ctx.investigation_id,
            "created_at": ctx.created_at,
            "status": ctx.status,
            "is_attack": ctx.triage.is_attack if ctx.triage else False,
            "category": ctx.triage.category if ctx.triage else "Unknown",
            "severity": ctx.triage.severity if ctx.triage else "info",
            "priority": ctx.triage.priority if ctx.triage else "P5",
            "confidence": ctx.triage.confidence if ctx.triage else 0.0,
            "verdict": ctx.verification.verdict if ctx.verification else None,
            "adjusted_confidence": (
                ctx.verification.adjusted_confidence if ctx.verification else None
            ),
            "correlated_events": (
                len(ctx.hunt.correlated_events) if ctx.hunt else 0
            ),
            "agent_count": len(ctx.agent_results),
            "total_duration_ms": sum(ar.duration_ms for ar in ctx.agent_results),
        }
        self._investigations.append(summary)
        if len(self._investigations) > 100:
            self._investigations = self._investigations[-100:]

    def _serialise(self, ctx: InvestigationContext) -> Dict[str, Any]:
        """Convert InvestigationContext to a JSON-serialisable dict."""
        d = asdict(ctx)
        return d
