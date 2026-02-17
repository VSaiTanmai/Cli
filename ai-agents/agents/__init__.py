"""
CLIF AI Agents
==============
Triage → Hunter → Verifier → Reporter

Each agent consumes investigation context, enriches it, and passes forward.
DSPy/Ollama LLM integration provides optional enhancement across all agents.
"""

from .base import BaseAgent, AgentResult, InvestigationContext
from .triage import TriageAgent
from .hunter import HunterAgent
from .verifier import VerifierAgent
from .reporter import ReporterAgent
from .orchestrator import Orchestrator
from .llm import (
    configure_llm,
    is_llm_available,
    get_llm_status,
)

__all__ = [
    "BaseAgent",
    "AgentResult",
    "InvestigationContext",
    "TriageAgent",
    "HunterAgent",
    "VerifierAgent",
    "ReporterAgent",
    "Orchestrator",
    "configure_llm",
    "is_llm_available",
    "get_llm_status",
]
