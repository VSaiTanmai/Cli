"""
CLIF AI Agents
==============
Triage → Hunter → Verifier → Reporter

Each agent consumes investigation context, enriches it, and passes forward.
"""

from .base import BaseAgent, AgentResult, InvestigationContext
from .triage import TriageAgent
from .hunter import HunterAgent
from .verifier import VerifierAgent
from .reporter import ReporterAgent
from .orchestrator import Orchestrator

__all__ = [
    "BaseAgent",
    "AgentResult",
    "InvestigationContext",
    "TriageAgent",
    "HunterAgent",
    "VerifierAgent",
    "ReporterAgent",
    "Orchestrator",
]
