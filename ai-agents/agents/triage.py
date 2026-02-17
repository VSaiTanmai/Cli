"""
Triage Agent
=============
First responder — classifies incoming events and assigns priority.

Responsibilities:
1. Run ML classifier (binary + multiclass)
2. Assign priority (P1–P5) based on severity + confidence
3. Map to MITRE ATT&CK categories
4. Decide whether to route to Hunter Agent
"""

from __future__ import annotations

from typing import Any, Dict

from .base import (
    BaseAgent,
    InvestigationContext,
    Priority,
    Severity,
    TriageData,
)


# ── MITRE ATT&CK mapping for ML categories ──────────────────────────────────

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

# ── Priority matrix (severity × confidence → priority) ──────────────────────

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


class TriageAgent(BaseAgent):
    """
    ML-powered triage — classifies events and assigns investigation priority.
    """

    name = "Triage Agent"
    description = "Initial alert classification, severity scoring, and priority assignment"

    def __init__(self, classifier=None):
        """
        Args:
            classifier: An inference.CLIFClassifier instance.
                        If None, will be loaded at first invocation.
        """
        super().__init__()
        self._classifier = classifier

    def _ensure_classifier(self):
        """Lazy-load the ML classifier on first use."""
        if self._classifier is None:
            from inference.inference import CLIFClassifier
            self._classifier = CLIFClassifier()

    async def _execute(self, ctx: InvestigationContext) -> InvestigationContext:
        self._ensure_classifier()

        event = ctx.trigger_event
        if not event:
            raise ValueError("No trigger event provided for triage")

        # ── Step 1: ML Classification ────────────────────────────────────
        result = self._classifier.classify(event)

        # ── Step 2: MITRE ATT&CK Mapping ────────────────────────────────
        mitre = CATEGORY_MITRE.get(result["category"], CATEGORY_MITRE["Normal"])

        # ── Step 3: Priority Assignment ──────────────────────────────────
        severity = result["severity"]
        conf_bucket = _conf_bucket(result["confidence"])
        priority = PRIORITY_MATRIX.get(severity, PRIORITY_MATRIX["info"]).get(
            conf_bucket, "P5"
        )

        # ── Step 4: Build TriageData ─────────────────────────────────────
        triage = TriageData(
            is_attack=result["is_attack"],
            confidence=result["confidence"],
            category=result["category"],
            category_confidence=result["category_confidence"],
            clif_category=result["clif_category"],
            severity=severity,
            priority=priority,
            explanation=result["explanation"],
            binary_probs=result.get("binary_probs", {}),
            multi_probs=result.get("multi_probs", {}),
            mitre_tactic=mitre["tactic"],
            mitre_technique=mitre["technique"],
        )

        ctx.triage = triage
        ctx.status = "triaged"

        # ── Log action ───────────────────────────────────────────────────
        if triage.is_attack:
            self._last_action = (
                f"Classified event as {triage.category} attack "
                f"(confidence: {triage.confidence:.2f}, priority: {triage.priority}). "
                f"MITRE: {mitre['tactic']}/{mitre['technique']}. "
                f"Forwarding to Hunter Agent."
            )
        else:
            self._last_action = (
                f"Classified event as benign traffic "
                f"(confidence: {triage.confidence:.2f}). No further action required."
            )

        return ctx
