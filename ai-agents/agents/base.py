"""
Base Agent & Shared Data Models
================================
Every CLIF agent inherits from BaseAgent and reads/writes InvestigationContext.
"""

from __future__ import annotations

import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


# ── Enums ────────────────────────────────────────────────────────────────────

class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class Priority(str, Enum):
    P1 = "P1"   # critical – immediate (SOC on-call)
    P2 = "P2"   # high     – within 15 min
    P3 = "P3"   # medium   – within 1 hour
    P4 = "P4"   # low      – within 8 hours
    P5 = "P5"   # info     – informational


class Verdict(str, Enum):
    TRUE_POSITIVE = "true_positive"
    FALSE_POSITIVE = "false_positive"
    SUSPICIOUS = "suspicious"
    BENIGN = "benign"
    INCONCLUSIVE = "inconclusive"


class AgentStatus(str, Enum):
    IDLE = "idle"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"


# ── Data Classes ─────────────────────────────────────────────────────────────

@dataclass
class AgentResult:
    """A single agent's contribution to an investigation."""
    agent_name: str
    status: AgentStatus
    started_at: str
    finished_at: str
    duration_ms: float
    data: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


@dataclass
class TriageData:
    """Output of the Triage Agent."""
    is_attack: bool = False
    confidence: float = 0.0
    category: str = "Normal"
    category_confidence: float = 0.0
    clif_category: str = "normal"
    severity: str = "info"
    priority: str = "P5"
    explanation: str = ""
    binary_probs: Dict[str, float] = field(default_factory=dict)
    multi_probs: Dict[str, float] = field(default_factory=dict)
    mitre_tactic: str = ""
    mitre_technique: str = ""


@dataclass
class CorrelatedEvent:
    """An event found by the Hunter agent that correlates with the trigger."""
    event_id: str = ""
    timestamp: str = ""
    source_table: str = ""
    category: str = ""
    severity: int = 0
    description: str = ""
    hostname: str = ""
    ip_address: str = ""
    similarity_score: float = 0.0
    correlation_type: str = ""  # temporal, ip, hostname, semantic


@dataclass
class AttackChainStep:
    """A single step in an attack chain timeline."""
    timestamp: str = ""
    event_id: str = ""
    action: str = ""
    source: str = ""
    target: str = ""
    mitre_tactic: str = ""
    mitre_technique: str = ""


@dataclass
class HuntData:
    """Output of the Hunter Agent."""
    correlated_events: List[CorrelatedEvent] = field(default_factory=list)
    attack_chain: List[AttackChainStep] = field(default_factory=list)
    affected_hosts: List[str] = field(default_factory=list)
    affected_ips: List[str] = field(default_factory=list)
    affected_users: List[str] = field(default_factory=list)
    mitre_tactics: List[str] = field(default_factory=list)
    mitre_techniques: List[str] = field(default_factory=list)
    temporal_window_sec: float = 0.0
    semantic_matches: int = 0
    clickhouse_matches: int = 0


@dataclass
class VerificationData:
    """Output of the Verifier Agent."""
    verdict: str = "inconclusive"
    adjusted_confidence: float = 0.0
    false_positive_score: float = 0.0
    evidence_summary: str = ""
    checks_performed: List[str] = field(default_factory=list)
    checks_passed: List[str] = field(default_factory=list)
    checks_failed: List[str] = field(default_factory=list)
    historical_similar_count: int = 0
    baseline_deviation: float = 0.0
    recommendation: str = ""


@dataclass
class ReportSection:
    """A section in the final investigation report."""
    title: str = ""
    content: str = ""


@dataclass
class ReportData:
    """Output of the Reporter Agent."""
    investigation_id: str = ""
    title: str = ""
    executive_summary: str = ""
    severity: str = "info"
    priority: str = "P5"
    verdict: str = "inconclusive"
    sections: List[ReportSection] = field(default_factory=list)
    mitre_mapping: List[Dict[str, str]] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    affected_assets: Dict[str, List[str]] = field(default_factory=dict)
    timeline: List[Dict[str, str]] = field(default_factory=list)
    generated_at: str = ""


@dataclass
class InvestigationContext:
    """
    Shared context passed through the agent pipeline.
    Each agent reads upstream data and writes its own section.
    """
    investigation_id: str = field(default_factory=lambda: f"INV-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}")
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    # Original trigger event
    trigger_event: Dict[str, Any] = field(default_factory=dict)
    trigger_source: str = ""   # "api", "redpanda", "manual"

    # Agent outputs
    triage: Optional[TriageData] = None
    hunt: Optional[HuntData] = None
    verification: Optional[VerificationData] = None
    report: Optional[ReportData] = None

    # Agent execution log
    agent_results: List[AgentResult] = field(default_factory=list)

    # Processing state
    status: str = "pending"   # pending, triaged, hunted, verified, reported, closed
    error: Optional[str] = None


# ── Base Agent ───────────────────────────────────────────────────────────────

class BaseAgent(ABC):
    """
    Abstract base class for all CLIF AI agents.

    Subclasses implement `_execute()` which takes an InvestigationContext
    and returns it with their section populated.
    """

    name: str = "base"
    description: str = ""

    def __init__(self):
        self._status = AgentStatus.IDLE
        self._cases_processed = 0
        self._total_time_ms = 0.0
        self._last_action: str = ""
        self._last_action_time: str = ""
        self._errors: int = 0

    @property
    def status(self) -> AgentStatus:
        return self._status

    @property
    def stats(self) -> Dict[str, Any]:
        avg_time = (self._total_time_ms / self._cases_processed
                    if self._cases_processed > 0 else 0)
        return {
            "name": self.name,
            "description": self.description,
            "status": self._status.value,
            "cases_processed": self._cases_processed,
            "avg_response_ms": round(avg_time, 1),
            "errors": self._errors,
            "last_action": self._last_action,
            "last_action_time": self._last_action_time,
        }

    async def run(self, ctx: InvestigationContext) -> InvestigationContext:
        """
        Execute the agent and record timing / results.
        """
        self._status = AgentStatus.PROCESSING
        started = datetime.now(timezone.utc).isoformat()
        t0 = time.perf_counter()
        error_msg = None

        try:
            ctx = await self._execute(ctx)
        except Exception as exc:
            error_msg = f"{type(exc).__name__}: {exc}"
            ctx.error = error_msg
            self._errors += 1
        finally:
            elapsed_ms = (time.perf_counter() - t0) * 1000
            finished = datetime.now(timezone.utc).isoformat()
            self._status = AgentStatus.DONE if not error_msg else AgentStatus.ERROR

            result = AgentResult(
                agent_name=self.name,
                status=self._status,
                started_at=started,
                finished_at=finished,
                duration_ms=round(elapsed_ms, 2),
                error=error_msg,
            )
            ctx.agent_results.append(result)

            self._cases_processed += 1
            self._total_time_ms += elapsed_ms
            self._last_action_time = finished

        # Reset to idle for next request
        if self._status == AgentStatus.DONE:
            self._status = AgentStatus.IDLE

        return ctx

    @abstractmethod
    async def _execute(self, ctx: InvestigationContext) -> InvestigationContext:
        """Agent-specific logic — implemented by subclasses."""
        ...
