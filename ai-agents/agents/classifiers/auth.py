"""
Auth Log Classifier
====================
Rule-based detection for authentication logs: SSH, PAM, sudo, su, login.

Detection scenarios:
 - Failed SSH password / publickey attempts
 - Invalid user login attempts
 - Successful root / admin logins
 - sudo to root
 - Brute force patterns (high failure count)
 - Authentication from unusual sources
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Pattern-based rules
# ---------------------------------------------------------------------------

class _Rule:
    __slots__ = ("name", "pattern", "category", "severity", "confidence",
                 "mitre_tactic", "mitre_technique", "description",
                 "extract_fields")

    def __init__(self, name: str, pattern: str, category: str, severity: str,
                 confidence: float, mitre_tactic: str, mitre_technique: str,
                 description: str, extract_fields: Optional[Dict[str, str]] = None):
        self.name = name
        self.pattern = re.compile(pattern, re.IGNORECASE)
        self.category = category
        self.severity = severity
        self.confidence = confidence
        self.mitre_tactic = mitre_tactic
        self.mitre_technique = mitre_technique
        self.description = description
        self.extract_fields = extract_fields or {}


_RULES: List[_Rule] = [
    # ── SSH Failures ──────────────────────────────────────────────────
    _Rule(
        name="SSH failed password",
        pattern=r"failed password for (?P<user>\S+) from (?P<ip>\S+)",
        category="Brute Force",
        severity="high",
        confidence=0.78,
        mitre_tactic="credential-access",
        mitre_technique="T1110.001",
        description="SSH password authentication failure",
    ),
    _Rule(
        name="SSH invalid user",
        pattern=r"invalid user (?P<user>\S+) from (?P<ip>\S+)",
        category="Brute Force",
        severity="high",
        confidence=0.82,
        mitre_tactic="credential-access",
        mitre_technique="T1110.001",
        description="SSH login attempt with non-existent user",
    ),
    _Rule(
        name="SSH failed publickey",
        pattern=r"connection closed by (?P<ip>\S+).*\[preauth\]",
        category="Brute Force",
        severity="medium",
        confidence=0.60,
        mitre_tactic="credential-access",
        mitre_technique="T1110",
        description="SSH pre-authentication connection closed",
    ),

    # ── SSH Successes (notable) ───────────────────────────────────────
    _Rule(
        name="SSH root login success",
        pattern=r"accepted (?:password|publickey) for root from (?P<ip>\S+)",
        category="Privilege Escalation",
        severity="high",
        confidence=0.75,
        mitre_tactic="privilege-escalation",
        mitre_technique="T1078.003",
        description="Successful root SSH login - high-risk event",
    ),
    _Rule(
        name="SSH login success",
        pattern=r"accepted (?:password|publickey) for (?P<user>\S+) from (?P<ip>\S+)",
        category="Initial Access",
        severity="low",
        confidence=0.40,
        mitre_tactic="initial-access",
        mitre_technique="T1078",
        description="Successful SSH authentication",
    ),

    # ── sudo ──────────────────────────────────────────────────────────
    _Rule(
        name="sudo to root",
        pattern=r"(?P<user>\S+)\s+:\s+.*COMMAND=(?P<cmd>.+)",
        category="Privilege Escalation",
        severity="medium",
        confidence=0.55,
        mitre_tactic="privilege-escalation",
        mitre_technique="T1548.003",
        description="sudo command execution",
    ),
    _Rule(
        name="sudo authentication failure",
        pattern=r"(?P<user>\S+)\s+:\s+.*authentication failure",
        category="Brute Force",
        severity="high",
        confidence=0.75,
        mitre_tactic="credential-access",
        mitre_technique="T1110",
        description="sudo authentication failure",
    ),
    _Rule(
        name="sudo incorrect password",
        pattern=r"(?P<user>\S+)\s+:\s+.*\d+ incorrect password attempt",
        category="Brute Force",
        severity="high",
        confidence=0.80,
        mitre_tactic="credential-access",
        mitre_technique="T1110",
        description="Multiple incorrect sudo password attempts",
    ),

    # ── PAM ───────────────────────────────────────────────────────────
    _Rule(
        name="PAM authentication failure",
        pattern=r"pam_unix\(.*\):\s*authentication failure.*user=(?P<user>\S+)",
        category="Brute Force",
        severity="high",
        confidence=0.75,
        mitre_tactic="credential-access",
        mitre_technique="T1110",
        description="PAM authentication failure",
    ),
    _Rule(
        name="PAM session opened for root",
        pattern=r"pam_unix\(.*\):\s*session opened for user root",
        category="Privilege Escalation",
        severity="medium",
        confidence=0.55,
        mitre_tactic="privilege-escalation",
        mitre_technique="T1078.003",
        description="PAM session opened for root user",
    ),

    # ── su ────────────────────────────────────────────────────────────
    _Rule(
        name="su failed",
        pattern=r"failed su for (?P<user>\S+) by",
        category="Privilege Escalation",
        severity="high",
        confidence=0.78,
        mitre_tactic="privilege-escalation",
        mitre_technique="T1548.003",
        description="Failed su (switch user) attempt",
    ),

    # ── Systemd logind ────────────────────────────────────────────────
    _Rule(
        name="New login session",
        pattern=r"new session \d+ of user (?P<user>\S+)",
        category="Initial Access",
        severity="low",
        confidence=0.30,
        mitre_tactic="initial-access",
        mitre_technique="T1078",
        description="New login session created",
    ),
]


class AuthLogClassifier:
    """
    Classify auth-related log events (SSH, PAM, sudo, su).
    """

    def __init__(self) -> None:
        self._rules = _RULES

    def classify(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """
        Classify an auth log event.

        The event can have a 'message' field (raw syslog line) or structured
        fields like 'source', 'user', 'source_ip', etc.
        """
        message = str(event.get("message", ""))

        # Also check structured fields
        source = str(event.get("source", event.get("program", ""))).lower()
        category_hint = str(event.get("category", "")).lower()

        matched: List[Dict[str, Any]] = []

        for rule in self._rules:
            m = rule.pattern.search(message)
            if not m:
                continue

            # Extract named groups
            groups = m.groupdict()

            matched.append({
                "name": rule.name,
                "category": rule.category,
                "severity": rule.severity,
                "confidence": rule.confidence,
                "mitre_tactic": rule.mitre_tactic,
                "mitre_technique": rule.mitre_technique,
                "description": rule.description,
                "extracted": groups,
            })

        if not matched:
            # Try structured-field heuristics
            result = self._structured_check(event)
            if result:
                return result
            return self._benign_result(event)

        # Pick highest severity
        sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        matched.sort(key=lambda r: (sev_order.get(r["severity"], 9), -r["confidence"]))
        best = matched[0]

        # Build rich explanation
        explanation = best["description"]
        extracted = best.get("extracted", {})
        detail_parts = []
        if extracted.get("user"):
            detail_parts.append(f"User: {extracted['user']}")
        if extracted.get("ip"):
            detail_parts.append(f"From: {extracted['ip']}")
        if extracted.get("cmd"):
            cmd = extracted["cmd"][:120]
            detail_parts.append(f"Command: {cmd}")
        if detail_parts:
            explanation += f" ({', '.join(detail_parts)})"

        if source:
            explanation += f" [source: {source}]"

        is_attack = best["severity"] in ("critical", "high", "medium")

        return {
            "is_attack": is_attack,
            "confidence": best["confidence"],
            "category": best["category"],
            "category_confidence": best["confidence"],
            "clif_category": best["category"].lower().replace(" ", "_"),
            "severity": best["severity"],
            "explanation": explanation,
            "binary_probs": {},
            "multi_probs": {},
            "mitre_tactic": best["mitre_tactic"],
            "mitre_technique": best["mitre_technique"],
        }

    def _structured_check(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Fallback: check structured fields when message-based rules miss."""
        # Check for failed login count field
        failed = event.get("failed_logins", event.get("failures", 0))
        try:
            failed = int(failed)
        except (ValueError, TypeError):
            failed = 0

        if failed >= 3:
            user = event.get("user", event.get("username", "unknown"))
            ip = event.get("source_ip", event.get("ip_address", ""))
            return {
                "is_attack": True,
                "confidence": min(0.60 + failed * 0.05, 0.95),
                "category": "Brute Force",
                "category_confidence": 0.80,
                "clif_category": "brute_force",
                "severity": "high" if failed >= 5 else "medium",
                "explanation": (
                    f"Multiple authentication failures detected: "
                    f"{failed} failures for user '{user}'"
                    + (f" from {ip}" if ip else "")
                ),
                "binary_probs": {},
                "multi_probs": {},
                "mitre_tactic": "credential-access",
                "mitre_technique": "T1110",
            }

        return None

    @staticmethod
    def _benign_result(event: Dict[str, Any]) -> Dict[str, Any]:
        source = event.get("source", event.get("program", "auth"))
        user = event.get("user", event.get("username", ""))
        return {
            "is_attack": False,
            "confidence": 0.70,
            "category": "Normal",
            "category_confidence": 0.70,
            "clif_category": "normal",
            "severity": "info",
            "explanation": (
                f"Auth event from {source} - no suspicious patterns detected"
                + (f" (user: {user})" if user else "")
            ),
            "binary_probs": {},
            "multi_probs": {},
            "mitre_tactic": "",
            "mitre_technique": "",
        }
