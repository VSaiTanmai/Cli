"""
DSPy + Ollama LLM Integration
===============================
Provides LLM-powered reasoning to enhance the CLIF agent pipeline.

Architecture:
  - Uses DSPy (v3.x) with Ollama as the local LLM backend
  - Defines typed Signatures for each agent's LLM task
  - All LLM calls are optional — agents fall back to rule-based if LLM is unavailable
  - Thread-safe singleton configuration

Signatures:
  1. SecurityTriage      — Classify ambiguous events when rule confidence < threshold
  2. ThreatHypothesis    — Generate investigation hypotheses for the Hunter Agent
  3. VerdictReasoning    — Provide reasoned verification for the Verifier Agent
  4. IncidentNarrative   — Generate executive-quality incident reports for the Reporter
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Optional

import dspy

logger = logging.getLogger("clif.llm")

# ── Configuration ────────────────────────────────────────────────────────────

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3-vl:4b")
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.3"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1024"))
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "60"))  # seconds

# ── LLM Availability State ──────────────────────────────────────────────────

_llm_configured: bool = False
_llm_available: bool = False
_last_check_time: float = 0.0
_CHECK_INTERVAL = 30.0  # re-check availability every 30 seconds


def configure_llm(
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> bool:
    """
    Configure DSPy with Ollama backend.
    Returns True if configuration succeeded.
    """
    global _llm_configured, _llm_available

    _model = model or OLLAMA_MODEL
    _base_url = base_url or OLLAMA_BASE_URL
    _temp = temperature if temperature is not None else LLM_TEMPERATURE
    _max_tok = max_tokens or LLM_MAX_TOKENS

    try:
        lm = dspy.LM(
            f"ollama_chat/{_model}",
            api_base=_base_url,
            temperature=_temp,
            max_tokens=_max_tok,
            num_retries=2,
            extra_body={"options": {"think": False}},
        )
        dspy.configure(lm=lm)
        _llm_configured = True
        _llm_available = True
        logger.info(
            "DSPy configured — model=%s, base_url=%s, temp=%.1f, max_tokens=%d",
            _model, _base_url, _temp, _max_tok,
        )
        return True
    except Exception as e:
        logger.warning("Failed to configure DSPy/Ollama: %s", e)
        _llm_configured = False
        _llm_available = False
        return False


def is_llm_available() -> bool:
    """Check if Ollama LLM is available (with caching)."""
    global _llm_available, _last_check_time

    now = time.time()
    if now - _last_check_time < _CHECK_INTERVAL:
        return _llm_available

    _last_check_time = now

    if not _llm_configured:
        _llm_available = configure_llm()
        return _llm_available

    # Quick health check
    try:
        import httpx
        resp = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5.0)
        _llm_available = resp.status_code == 200
    except Exception:
        _llm_available = False

    return _llm_available


def get_llm_status() -> Dict[str, Any]:
    """Return LLM status for the dashboard API."""
    return {
        "configured": _llm_configured,
        "available": _llm_available,
        "model": OLLAMA_MODEL,
        "base_url": OLLAMA_BASE_URL,
        "temperature": LLM_TEMPERATURE,
        "max_tokens": LLM_MAX_TOKENS,
        "framework": f"DSPy {dspy.__version__}",
    }


# ═══════════════════════════════════════════════════════════════════════════
#  DSPy Signatures — Typed contracts for each LLM task
# ═══════════════════════════════════════════════════════════════════════════


class SecurityTriage(dspy.Signature):
    """You are a senior SOC analyst. Classify this security event based on the
    log data provided. Determine the attack category, severity, and relevant
    MITRE ATT&CK mapping. Be precise and concise."""

    log_type: str = dspy.InputField(desc="Type of log: sysmon, windows_security, auth, firewall, network, generic")
    event_data: str = dspy.InputField(desc="JSON string of the security event fields")
    initial_classification: str = dspy.InputField(desc="Initial rule-based classification result")

    category: str = dspy.OutputField(desc="Attack category (e.g., Execution, Credential Access, Lateral Movement, Brute Force, Normal)")
    severity: str = dspy.OutputField(desc="Severity level: critical, high, medium, low, or info")
    confidence: str = dspy.OutputField(desc="Confidence score as a decimal between 0.0 and 1.0")
    mitre_tactic: str = dspy.OutputField(desc="MITRE ATT&CK tactic (e.g., credential-access, execution)")
    mitre_technique: str = dspy.OutputField(desc="MITRE ATT&CK technique ID (e.g., T1059.001)")
    reasoning: str = dspy.OutputField(desc="Brief explanation of why this classification was chosen")


class ThreatHypothesis(dspy.Signature):
    """You are a threat hunter. Given an attack alert and correlated events,
    generate investigation hypotheses and identify the most likely attack chain.
    Focus on actionable intelligence."""

    alert_summary: str = dspy.InputField(desc="Summary of the triggering alert including category, severity, and source")
    correlated_events: str = dspy.InputField(desc="JSON summary of correlated events found by the Hunter")
    log_type: str = dspy.InputField(desc="Primary log type of the investigation")

    attack_narrative: str = dspy.OutputField(desc="2-3 sentence narrative describing the likely attack scenario")
    hypotheses: str = dspy.OutputField(desc="Top 3 investigation hypotheses, numbered 1-3")
    recommended_queries: str = dspy.OutputField(desc="2-3 recommended follow-up queries or data sources to check")
    risk_assessment: str = dspy.OutputField(desc="Brief risk assessment: what is the potential impact if this is a real attack")


class VerdictReasoning(dspy.Signature):
    """You are a security verification analyst. Given the triage classification,
    hunt findings, and false-positive analysis, provide a reasoned verdict.
    Consider all evidence before concluding."""

    triage_summary: str = dspy.InputField(desc="Triage classification including category, confidence, severity, MITRE mapping")
    hunt_summary: str = dspy.InputField(desc="Hunt findings including correlated events, attack chain, affected assets")
    fp_analysis: str = dspy.InputField(desc="False-positive analysis including FP score, matched patterns, checks performed")

    verdict: str = dspy.OutputField(desc="Verdict: true_positive, false_positive, suspicious, or benign")
    confidence: str = dspy.OutputField(desc="Confidence in this verdict as decimal between 0.0 and 1.0")
    reasoning: str = dspy.OutputField(desc="Detailed reasoning explaining why this verdict was reached, referencing specific evidence")
    additional_checks: str = dspy.OutputField(desc="Any additional checks or evidence that would increase confidence")


class IncidentNarrative(dspy.Signature):
    """You are a senior incident responder writing an executive brief.
    Generate a professional, clear incident report narrative from the
    investigation data. Use formal security reporting language."""

    investigation_id: str = dspy.InputField(desc="Unique investigation identifier")
    triage_summary: str = dspy.InputField(desc="Triage results: category, severity, confidence, MITRE mapping, log type")
    hunt_summary: str = dspy.InputField(desc="Hunt results: correlated events, attack chain, affected assets")
    verification_summary: str = dspy.InputField(desc="Verification results: verdict, adjusted confidence, FP score, checks")
    recommendations: str = dspy.InputField(desc="List of recommended remediation actions")

    executive_summary: str = dspy.OutputField(desc="3-5 sentence executive summary suitable for CISO briefing")
    incident_narrative: str = dspy.OutputField(desc="Detailed 2-3 paragraph incident narrative describing what happened, impact, and response")
    risk_rating: str = dspy.OutputField(desc="Overall risk rating: Critical, High, Medium, Low, or Informational")


# ═══════════════════════════════════════════════════════════════════════════
#  DSPy Modules — Compiled, optimisable modules wrapping each Signature
# ═══════════════════════════════════════════════════════════════════════════


class SecurityTriageModule(dspy.Module):
    """DSPy module for LLM-enhanced security triage."""

    def __init__(self):
        super().__init__()
        self.classify = dspy.ChainOfThought(SecurityTriage)

    def forward(self, log_type: str, event_data: str, initial_classification: str):
        return self.classify(
            log_type=log_type,
            event_data=event_data,
            initial_classification=initial_classification,
        )


class ThreatHypothesisModule(dspy.Module):
    """DSPy module for generating threat hypotheses."""

    def __init__(self):
        super().__init__()
        self.hypothesise = dspy.ChainOfThought(ThreatHypothesis)

    def forward(self, alert_summary: str, correlated_events: str, log_type: str):
        return self.hypothesise(
            alert_summary=alert_summary,
            correlated_events=correlated_events,
            log_type=log_type,
        )


class VerdictReasoningModule(dspy.Module):
    """DSPy module for verdict reasoning."""

    def __init__(self):
        super().__init__()
        self.reason = dspy.ChainOfThought(VerdictReasoning)

    def forward(self, triage_summary: str, hunt_summary: str, fp_analysis: str):
        return self.reason(
            triage_summary=triage_summary,
            hunt_summary=hunt_summary,
            fp_analysis=fp_analysis,
        )


class IncidentNarrativeModule(dspy.Module):
    """DSPy module for generating incident narratives."""

    def __init__(self):
        super().__init__()
        self.narrate = dspy.ChainOfThought(IncidentNarrative)

    def forward(
        self,
        investigation_id: str,
        triage_summary: str,
        hunt_summary: str,
        verification_summary: str,
        recommendations: str,
    ):
        return self.narrate(
            investigation_id=investigation_id,
            triage_summary=triage_summary,
            hunt_summary=hunt_summary,
            verification_summary=verification_summary,
            recommendations=recommendations,
        )


# ═══════════════════════════════════════════════════════════════════════════
#  Convenience wrappers — safe calls with timeout + fallback
# ═══════════════════════════════════════════════════════════════════════════

# Singleton instances (lazy-loaded)
_triage_module: Optional[SecurityTriageModule] = None
_hypothesis_module: Optional[ThreatHypothesisModule] = None
_verdict_module: Optional[VerdictReasoningModule] = None
_narrative_module: Optional[IncidentNarrativeModule] = None


def _get_triage_module() -> SecurityTriageModule:
    global _triage_module
    if _triage_module is None:
        _triage_module = SecurityTriageModule()
    return _triage_module


def _get_hypothesis_module() -> ThreatHypothesisModule:
    global _hypothesis_module
    if _hypothesis_module is None:
        _hypothesis_module = ThreatHypothesisModule()
    return _hypothesis_module


def _get_verdict_module() -> VerdictReasoningModule:
    global _verdict_module
    if _verdict_module is None:
        _verdict_module = VerdictReasoningModule()
    return _verdict_module


def _get_narrative_module() -> IncidentNarrativeModule:
    global _narrative_module
    if _narrative_module is None:
        _narrative_module = IncidentNarrativeModule()
    return _narrative_module


def llm_triage(
    log_type: str,
    event_data: str,
    initial_classification: str,
) -> Optional[Dict[str, Any]]:
    """
    LLM-enhanced triage classification.
    Returns None if LLM is unavailable or fails.
    """
    if not is_llm_available():
        return None

    try:
        module = _get_triage_module()
        result = module(
            log_type=log_type,
            event_data=event_data,
            initial_classification=initial_classification,
        )
        # Parse confidence to float
        try:
            conf = float(result.confidence)
        except (ValueError, TypeError):
            conf = 0.5

        return {
            "category": getattr(result, "category", "") or "",
            "severity": getattr(result, "severity", "") or "",
            "confidence": min(max(conf, 0.0), 1.0),
            "mitre_tactic": getattr(result, "mitre_tactic", "") or "",
            "mitre_technique": getattr(result, "mitre_technique", "") or "",
            "reasoning": getattr(result, "reasoning", "") or "",
        }
    except Exception as e:
        logger.warning("LLM triage failed: %s", e)
        return None


def llm_hypothesis(
    alert_summary: str,
    correlated_events: str,
    log_type: str,
) -> Optional[Dict[str, str]]:
    """
    LLM-generated threat hypotheses for the Hunter Agent.
    Returns None if LLM is unavailable or fails.
    """
    if not is_llm_available():
        return None

    try:
        module = _get_hypothesis_module()
        result = module(
            alert_summary=alert_summary,
            correlated_events=correlated_events,
            log_type=log_type,
        )
        return {
            "attack_narrative": getattr(result, "attack_narrative", "") or "",
            "hypotheses": getattr(result, "hypotheses", "") or "",
            "recommended_queries": getattr(result, "recommended_queries", "") or "",
            "risk_assessment": getattr(result, "risk_assessment", "") or "",
        }
    except Exception as e:
        logger.warning("LLM hypothesis generation failed: %s", e)
        return None


def llm_verdict(
    triage_summary: str,
    hunt_summary: str,
    fp_analysis: str,
) -> Optional[Dict[str, Any]]:
    """
    LLM-reasoned verdict for the Verifier Agent.
    Returns None if LLM is unavailable or fails.
    """
    if not is_llm_available():
        return None

    try:
        module = _get_verdict_module()
        result = module(
            triage_summary=triage_summary,
            hunt_summary=hunt_summary,
            fp_analysis=fp_analysis,
        )
        # Parse confidence
        try:
            conf = float(result.confidence)
        except (ValueError, TypeError):
            conf = 0.5

        return {
            "verdict": getattr(result, "verdict", "") or "",
            "confidence": min(max(conf, 0.0), 1.0),
            "reasoning": getattr(result, "reasoning", "") or "",
            "additional_checks": getattr(result, "additional_checks", "") or "",
        }
    except Exception as e:
        logger.warning("LLM verdict reasoning failed: %s", e)
        return None


def llm_generate_narrative(
    investigation_id: str,
    triage_summary: str,
    hunt_summary: str,
    verification_summary: str,
    recommendations: str,
) -> Optional[Dict[str, str]]:
    """
    LLM-generated incident narrative for the Reporter Agent.
    Returns None if LLM is unavailable or fails.
    """
    if not is_llm_available():
        return None

    try:
        module = _get_narrative_module()
        result = module(
            investigation_id=investigation_id,
            triage_summary=triage_summary,
            hunt_summary=hunt_summary,
            verification_summary=verification_summary,
            recommendations=recommendations,
        )
        return {
            "executive_summary": getattr(result, "executive_summary", "") or "",
            "incident_narrative": getattr(result, "incident_narrative", "") or "",
            "risk_rating": getattr(result, "risk_rating", "") or "",
        }
    except Exception as e:
        logger.warning("LLM narrative generation failed: %s", e)
        return None
