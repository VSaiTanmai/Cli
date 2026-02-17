"""
Triage Agent
=============
First responder - classifies incoming events and assigns priority.

Supports ALL log types via intelligent routing:
  - Network (NSL-KDD features)     -> ML classifier
  - Sysmon events                   -> Sigma-like rule engine
  - Windows Security Event Log      -> EventID-based rules
  - Auth logs (SSH/PAM/sudo)        -> Pattern-based rules
  - Firewall logs                   -> Rule-based analysis
  - Generic/unknown logs            -> Keyword heuristic scorer

Responsibilities:
1. Detect log type (auto-detect or explicit)
2. Route to appropriate classifier
3. Assign priority (P1-P5) based on severity + confidence
4. Map to MITRE ATT&CK categories
5. Decide whether to route to Hunter Agent
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from .base import (
    BaseAgent,
    InvestigationContext,
    Priority,
    Severity,
    TriageData,
)
from .classifiers import (
    LogType,
    detect_log_type,
    SysmonClassifier,
    WindowsSecurityClassifier,
    AuthLogClassifier,
    FirewallLogClassifier,
    GenericLogClassifier,
)

logger = logging.getLogger("clif.triage")

# -- MITRE ATT&CK mapping for ML categories (network/NSL-KDD) ----------------

CATEGORY_MITRE = {
    "DoS": {
        "tactic": "impact",
        "technique": "T1499",
        "technique_name": "Endpoint Denial of Service",
    },
    "Probe": {
        "tactic": "discovery",
        "technique": "T1046",
        "technique_name": "Network Service Discovery",
    },
    "R2L": {
        "tactic": "initial-access",
        "technique": "T1133",
        "technique_name": "External Remote Services",
    },
    "U2R": {
        "tactic": "privilege-escalation",
        "technique": "T1068",
        "technique_name": "Exploitation for Privilege Escalation",
    },
    "Normal": {
        "tactic": "",
        "technique": "",
        "technique_name": "",
    },
}

# -- Priority matrix (severity x confidence -> priority) ----------------------

PRIORITY_MATRIX: Dict[str, Dict[str, str]] = {
    "critical": {"high_conf": "P1", "med_conf": "P1", "low_conf": "P2"},
    "high":     {"high_conf": "P1", "med_conf": "P2", "low_conf": "P3"},
    "medium":   {"high_conf": "P2", "med_conf": "P3", "low_conf": "P4"},
    "low":      {"high_conf": "P3", "med_conf": "P4", "low_conf": "P5"},
    "info":     {"high_conf": "P5", "med_conf": "P5", "low_conf": "P5"},
}


def _conf_bucket(confidence: float) -> str:
    if confidence >= 0.85:
        return "high_conf"
    if confidence >= 0.60:
        return "med_conf"
    return "low_conf"


# -- Classifier name mapping --------------------------------------------------

_CLASSIFIER_NAMES = {
    LogType.NETWORK: "ml",
    LogType.SYSMON: "sysmon_rules",
    LogType.WINDOWS_SECURITY: "winsec_rules",
    LogType.AUTH: "auth_rules",
    LogType.FIREWALL: "fw_rules",
    LogType.GENERIC: "heuristic",
}


class TriageAgent(BaseAgent):
    """
    Multi-log-type triage - routes events to the appropriate classifier
    and assigns investigation priority.
    """

    name = "Triage Agent"
    description = (
        "Classifies all log types (network/Sysmon/Windows Security/"
        "auth/firewall/generic) with severity scoring and priority assignment"
    )

    def __init__(self, classifier=None):
        """
        Args:
            classifier: An inference.CLIFClassifier instance for NSL-KDD
                        network events. If None, will be loaded at first use.
        """
        super().__init__()
        self._classifier = classifier
        # Rule-based classifiers (stateless, lightweight)
        self._sysmon = SysmonClassifier()
        self._winsec = WindowsSecurityClassifier()
        self._auth = AuthLogClassifier()
        self._firewall = FirewallLogClassifier()
        self._generic = GenericLogClassifier()

    def _ensure_classifier(self):
        """Lazy-load the ML classifier on first use."""
        if self._classifier is None:
            from inference.inference import CLIFClassifier
            self._classifier = CLIFClassifier()

    # -- Classify by log type -------------------------------------------------

    def _classify_network(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """NSL-KDD ML classification for network events."""
        self._ensure_classifier()
        result = self._classifier.classify(event)
        mitre = CATEGORY_MITRE.get(result["category"], CATEGORY_MITRE["Normal"])
        result["mitre_tactic"] = mitre["tactic"]
        result["mitre_technique"] = mitre["technique"]
        return result

    def _classify_event(self, event: Dict[str, Any], log_type: LogType) -> Dict[str, Any]:
        """Route to the correct classifier based on log type."""
        if log_type == LogType.NETWORK:
            return self._classify_network(event)
        elif log_type == LogType.SYSMON:
            return self._sysmon.classify(event)
        elif log_type == LogType.WINDOWS_SECURITY:
            return self._winsec.classify(event)
        elif log_type == LogType.AUTH:
            return self._auth.classify(event)
        elif log_type == LogType.FIREWALL:
            return self._firewall.classify(event)
        else:
            return self._generic.classify(event)

    # -- Main execution -------------------------------------------------------

    async def _execute(self, ctx: InvestigationContext) -> InvestigationContext:
        event = ctx.trigger_event
        if not event:
            raise ValueError("No trigger event provided for triage")

        # -- Step 1: Detect log type ------------------------------------------
        log_type = detect_log_type(event)
        classifier_name = _CLASSIFIER_NAMES.get(log_type, "heuristic")
        logger.info(
            "[%s] Log type detected: %s (classifier: %s)",
            ctx.investigation_id, log_type.value, classifier_name,
        )

        # -- Step 2: Classify -------------------------------------------------
        result = self._classify_event(event, log_type)

        # -- Step 3: Priority Assignment --------------------------------------
        severity = result.get("severity", "info")
        conf_bucket = _conf_bucket(result.get("confidence", 0.0))
        priority = PRIORITY_MATRIX.get(severity, PRIORITY_MATRIX["info"]).get(
            conf_bucket, "P5"
        )

        # -- Step 4: Build TriageData -----------------------------------------
        triage = TriageData(
            is_attack=result.get("is_attack", False),
            confidence=result.get("confidence", 0.0),
            category=result.get("category", "Normal"),
            category_confidence=result.get("category_confidence", 0.0),
            clif_category=result.get("clif_category", "normal"),
            severity=severity,
            priority=priority,
            explanation=result.get("explanation", ""),
            binary_probs=result.get("binary_probs", {}),
            multi_probs=result.get("multi_probs", {}),
            mitre_tactic=result.get("mitre_tactic", ""),
            mitre_technique=result.get("mitre_technique", ""),
            log_type=log_type.value,
            classifier_used=classifier_name,
            matched_rules=result.get("matched_rules", []),
        )

        ctx.triage = triage
        ctx.status = "triaged"

        # -- Log action -------------------------------------------------------
        if triage.is_attack:
            self._last_action = (
                f"[{log_type.value}] Classified as {triage.category} attack "
                f"(confidence: {triage.confidence:.2f}, priority: {triage.priority}, "
                f"classifier: {classifier_name}). "
                f"MITRE: {triage.mitre_tactic}/{triage.mitre_technique}. "
                f"Forwarding to Hunter Agent."
            )
        else:
            self._last_action = (
                f"[{log_type.value}] Classified as benign "
                f"(confidence: {triage.confidence:.2f}, "
                f"classifier: {classifier_name}). No further action required."
            )

        return ctx
