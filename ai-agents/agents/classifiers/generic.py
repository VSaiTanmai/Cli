"""
Generic Log Classifier
=======================
Keyword-based heuristic scorer for any log type that does not match a
specialised classifier (Sysmon, Windows Security, Auth, Firewall, Network).

This handles: syslog, application logs, Docker container logs,
custom application events, and anything else.

Scoring approach:
 - Scan the event message and structured fields for threat keywords
 - Weight each keyword by severity tier
 - Aggregate into a confidence score
 - Map the highest-tier match to a MITRE ATT&CK category
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple


# ---------------------------------------------------------------------------
# Keyword tiers: (keyword, weight, category, mitre_tactic, mitre_technique)
# Higher weight = more suspicious
# ---------------------------------------------------------------------------

_CRITICAL_KEYWORDS: List[Tuple[str, float, str, str, str]] = [
    ("ransomware", 0.95, "Malware", "impact", "T1486"),
    ("crypto locker", 0.95, "Malware", "impact", "T1486"),
    ("your files have been encrypted", 0.95, "Malware", "impact", "T1486"),
    ("reverse shell", 0.92, "Execution", "execution", "T1059"),
    ("backdoor", 0.90, "Persistence", "persistence", "T1505"),
    ("rootkit", 0.90, "Defense Evasion", "defense-evasion", "T1014"),
    ("mimikatz", 0.92, "Credential Access", "credential-access", "T1003"),
    ("credential dump", 0.88, "Credential Access", "credential-access", "T1003"),
    ("privilege escalation", 0.85, "Privilege Escalation", "privilege-escalation", "T1068"),
    ("lateral movement", 0.85, "Lateral Movement", "lateral-movement", "T1021"),
    ("data exfiltration", 0.88, "Exfiltration", "exfiltration", "T1041"),
    ("command and control", 0.85, "Command and Control", "command-and-control", "T1071"),
    ("c2 beacon", 0.88, "Command and Control", "command-and-control", "T1071"),
]

_HIGH_KEYWORDS: List[Tuple[str, float, str, str, str]] = [
    ("malware", 0.80, "Malware", "execution", "T1204"),
    ("exploit", 0.78, "Exploitation", "execution", "T1203"),
    ("injection", 0.75, "Exploitation", "execution", "T1055"),
    ("sql injection", 0.82, "Exploitation", "initial-access", "T1190"),
    ("xss", 0.78, "Exploitation", "initial-access", "T1189"),
    ("cross-site scripting", 0.78, "Exploitation", "initial-access", "T1189"),
    ("buffer overflow", 0.80, "Exploitation", "execution", "T1203"),
    ("brute force", 0.78, "Brute Force", "credential-access", "T1110"),
    ("unauthorized access", 0.75, "Unauthorized Access", "initial-access", "T1078"),
    ("permission denied", 0.45, "Access Violation", "defense-evasion", "T1222"),
    ("access denied", 0.45, "Access Violation", "defense-evasion", "T1222"),
    ("port scan", 0.75, "Probe", "discovery", "T1046"),
    ("nmap", 0.75, "Probe", "discovery", "T1046"),
    ("vulnerability", 0.70, "Vulnerability", "initial-access", "T1190"),
    ("cve-", 0.72, "Vulnerability", "initial-access", "T1190"),
    ("phishing", 0.78, "Phishing", "initial-access", "T1566"),
    ("suspicious process", 0.72, "Execution", "execution", "T1059"),
    ("encoding attack", 0.72, "Defense Evasion", "defense-evasion", "T1027"),
    ("obfuscated", 0.70, "Defense Evasion", "defense-evasion", "T1027"),
    ("webshell", 0.82, "Persistence", "persistence", "T1505.003"),
]

_MEDIUM_KEYWORDS: List[Tuple[str, float, str, str, str]] = [
    ("failed login", 0.55, "Brute Force", "credential-access", "T1110"),
    ("authentication failed", 0.55, "Brute Force", "credential-access", "T1110"),
    ("login failure", 0.55, "Brute Force", "credential-access", "T1110"),
    ("invalid password", 0.55, "Brute Force", "credential-access", "T1110"),
    ("account locked", 0.60, "Brute Force", "credential-access", "T1110"),
    ("error", 0.20, "Error", "", ""),
    ("warning", 0.15, "Warning", "", ""),
    ("timeout", 0.25, "Availability", "impact", "T1499"),
    ("connection refused", 0.30, "Availability", "", ""),
    ("segmentation fault", 0.50, "Crash", "execution", "T1203"),
    ("core dumped", 0.50, "Crash", "execution", "T1203"),
    ("out of memory", 0.40, "Availability", "impact", "T1499"),
    ("oom killer", 0.40, "Availability", "impact", "T1499"),
    ("disk full", 0.35, "Availability", "impact", "T1499"),
    ("certificate expired", 0.35, "Configuration", "", ""),
    ("ssl error", 0.30, "Configuration", "", ""),
    ("tls error", 0.30, "Configuration", "", ""),
]


class GenericLogClassifier:
    """
    Keyword-based heuristic classifier for untyped log events.
    """

    def __init__(self) -> None:
        # Pre-build a single keyword list sorted by weight descending
        self._keywords: List[Tuple[str, float, str, str, str]] = sorted(
            _CRITICAL_KEYWORDS + _HIGH_KEYWORDS + _MEDIUM_KEYWORDS,
            key=lambda x: -x[1],
        )

    def classify(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """
        Classify a generic log event by keyword scoring.

        Scans: message, description, level, category, and all string values.
        """
        # Build a searchable text blob from the event
        text = self._build_text(event).lower()

        if not text.strip():
            return self._benign_result(event)

        # Score keywords
        matches: List[Tuple[str, float, str, str, str]] = []
        for keyword, weight, category, tactic, technique in self._keywords:
            if keyword in text:
                matches.append((keyword, weight, category, tactic, technique))

        if not matches:
            # Check severity/level field as a signal
            level = str(event.get("level", event.get("severity", ""))).lower()
            if level in ("critical", "emergency", "alert"):
                return self._level_based_result(event, level, 0.55, "high")
            elif level in ("error", "err"):
                return self._level_based_result(event, level, 0.30, "medium")
            return self._benign_result(event)

        # Use the highest-weight match
        matches.sort(key=lambda m: -m[1])
        best_kw, best_weight, best_cat, best_tactic, best_technique = matches[0]

        # Aggregate score: max weight + small boost per additional match
        bonus = min(len(matches) - 1, 5) * 0.02
        confidence = min(best_weight + bonus, 0.99)

        # Determine severity from confidence
        if confidence >= 0.85:
            severity = "critical"
        elif confidence >= 0.70:
            severity = "high"
        elif confidence >= 0.50:
            severity = "medium"
        elif confidence >= 0.30:
            severity = "low"
        else:
            severity = "info"

        is_attack = confidence >= 0.50

        # Build explanation
        matched_keywords = [m[0] for m in matches[:5]]
        message_preview = str(event.get("message", ""))[:150]
        explanation = (
            f"Heuristic analysis matched {len(matches)} keyword(s): "
            f"{', '.join(matched_keywords)}"
        )
        if message_preview:
            explanation += f". Message: {message_preview}"

        return {
            "is_attack": is_attack,
            "confidence": round(confidence, 4),
            "category": best_cat,
            "category_confidence": round(best_weight, 4),
            "clif_category": best_cat.lower().replace(" ", "_"),
            "severity": severity,
            "explanation": explanation,
            "binary_probs": {},
            "multi_probs": {},
            "mitre_tactic": best_tactic,
            "mitre_technique": best_technique,
        }

    @staticmethod
    def _build_text(event: Dict[str, Any]) -> str:
        """Concatenate all string values into a single searchable blob."""
        parts: List[str] = []
        # Prioritized fields
        for key in ("message", "description", "detail", "log", "msg",
                     "category", "event_type", "rule_name"):
            val = event.get(key)
            if val is not None:
                parts.append(str(val))
        # Then all other string values
        for key, val in event.items():
            if key not in ("message", "description", "detail", "log", "msg",
                           "category", "event_type", "rule_name"):
                if isinstance(val, str) and len(val) < 500:
                    parts.append(val)
        return " ".join(parts)

    @staticmethod
    def _level_based_result(event: Dict[str, Any], level: str,
                            confidence: float, severity: str) -> Dict[str, Any]:
        """Result based on log level alone (no keyword match)."""
        message = str(event.get("message", ""))[:150]
        return {
            "is_attack": confidence >= 0.50,
            "confidence": confidence,
            "category": "Anomaly",
            "category_confidence": confidence,
            "clif_category": "anomaly",
            "severity": severity,
            "explanation": (
                f"Event has {level.upper()} severity level but no specific "
                f"threat keywords matched. Message: {message}"
            ),
            "binary_probs": {},
            "multi_probs": {},
            "mitre_tactic": "",
            "mitre_technique": "",
        }

    @staticmethod
    def _benign_result(event: Dict[str, Any]) -> Dict[str, Any]:
        source = event.get("source", event.get("program", "unknown"))
        level = event.get("level", event.get("severity", "info"))
        return {
            "is_attack": False,
            "confidence": 0.65,
            "category": "Normal",
            "category_confidence": 0.65,
            "clif_category": "normal",
            "severity": "info",
            "explanation": (
                f"Generic event from {source} (level: {level}) - "
                f"no threat indicators detected"
            ),
            "binary_probs": {},
            "multi_probs": {},
            "mitre_tactic": "",
            "mitre_technique": "",
        }
