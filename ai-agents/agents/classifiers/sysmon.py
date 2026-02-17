"""
Sysmon Rule-Based Classifier
==============================
Implements a Sigma-inspired rule engine for Windows Sysmon events.

Covers the most security-relevant Sysmon Event IDs:
 1  - Process Creation
 3  - Network Connection
 5  - Process Terminated
 6  - Driver Loaded
 7  - Image Loaded (DLL)
 8  - CreateRemoteThread
 10 - ProcessAccess (credential dumping)
 11 - File Created
 12 - Registry key/value create/delete
 13 - Registry value set
 15 - FileCreateStreamHash (ADS)
 17 - Pipe Created
 19 - WMI Event Filter
 20 - WMI Consumer
 22 - DNS Query
 23 - File Delete (archived)
 25 - Process Tampering

Each rule defines:
 - match conditions (field comparisons)
 - severity / priority
 - MITRE ATT&CK mapping
 - confidence score
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Rule definitions
# ---------------------------------------------------------------------------
# Each rule is a dict with:
#   name:       Human-readable rule name
#   event_id:   Sysmon EventID(s) the rule applies to (int or list)
#   conditions: Dict[field_name, check] where check is:
#               - str:  case-insensitive substring match
#               - list of str: any substring matches
#               - re.Pattern: regex match
#               - callable(value) -> bool: custom check
#   category:   Attack category label
#   severity:   critical / high / medium / low
#   confidence: Base confidence (0-1) before modifiers
#   mitre_tactic / mitre_technique: MITRE ATT&CK mapping
#   description: Explanation template

_RULES: List[Dict[str, Any]] = [
    # ── Process Creation (EID 1) ──────────────────────────────────────
    {
        "name": "Suspicious PowerShell execution",
        "event_id": 1,
        "conditions": {
            "Image|CommandLine": [
                "powershell", "pwsh",
            ],
            "CommandLine": [
                "-encodedcommand", "-enc ", "-e ", "invoke-expression",
                "iex(", "downloadstring", "invoke-webrequest",
                "frombase64string", "bypass", "-nop", "-w hidden",
                "invoke-mimikatz", "invoke-shellcode",
            ],
        },
        "category": "Execution",
        "severity": "high",
        "confidence": 0.82,
        "mitre_tactic": "execution",
        "mitre_technique": "T1059.001",
        "description": "Suspicious PowerShell command detected: obfuscated or download cradle execution",
    },
    {
        "name": "LOLBIN execution",
        "event_id": 1,
        "conditions": {
            "Image": [
                "\\certutil.exe", "\\mshta.exe", "\\regsvr32.exe",
                "\\rundll32.exe", "\\msiexec.exe", "\\wmic.exe",
                "\\cscript.exe", "\\wscript.exe", "\\installutil.exe",
                "\\msconfig.exe", "\\bitsadmin.exe",
            ],
        },
        "category": "Defense Evasion",
        "severity": "high",
        "confidence": 0.75,
        "mitre_tactic": "defense-evasion",
        "mitre_technique": "T1218",
        "description": "Living-off-the-land binary (LOLBIN) execution detected",
    },
    {
        "name": "Suspicious process from temp directory",
        "event_id": 1,
        "conditions": {
            "Image": [
                "\\temp\\", "\\tmp\\", "\\appdata\\local\\temp\\",
                "\\downloads\\",
            ],
        },
        "category": "Execution",
        "severity": "medium",
        "confidence": 0.65,
        "mitre_tactic": "execution",
        "mitre_technique": "T1204.002",
        "description": "Process executed from temporary/download directory",
    },
    {
        "name": "cmd.exe spawned by Office application",
        "event_id": 1,
        "conditions": {
            "Image": ["\\cmd.exe"],
            "ParentImage": [
                "\\winword.exe", "\\excel.exe", "\\powerpnt.exe",
                "\\outlook.exe", "\\msaccess.exe",
            ],
        },
        "category": "Execution",
        "severity": "critical",
        "confidence": 0.90,
        "mitre_tactic": "execution",
        "mitre_technique": "T1204.002",
        "description": "Command shell spawned by Office application - likely macro execution",
    },
    {
        "name": "PsExec-like remote execution",
        "event_id": 1,
        "conditions": {
            "Image|CommandLine": [
                "psexec", "\\psexesvc.exe", "paexec",
            ],
        },
        "category": "Lateral Movement",
        "severity": "high",
        "confidence": 0.80,
        "mitre_tactic": "lateral-movement",
        "mitre_technique": "T1570",
        "description": "PsExec-style remote execution tool detected",
    },
    {
        "name": "Suspicious scheduled task creation",
        "event_id": 1,
        "conditions": {
            "Image|CommandLine": ["schtasks"],
            "CommandLine": ["/create"],
        },
        "category": "Persistence",
        "severity": "medium",
        "confidence": 0.70,
        "mitre_tactic": "persistence",
        "mitre_technique": "T1053.005",
        "description": "Scheduled task creation via schtasks.exe",
    },
    {
        "name": "Credential dumping tool execution",
        "event_id": 1,
        "conditions": {
            "Image|CommandLine": [
                "mimikatz", "procdump", "comsvcs.dll",
                "sekurlsa", "lsass", "ntdsutil",
                "shadow copy", "vssadmin",
            ],
        },
        "category": "Credential Access",
        "severity": "critical",
        "confidence": 0.92,
        "mitre_tactic": "credential-access",
        "mitre_technique": "T1003",
        "description": "Potential credential dumping tool or technique detected",
    },

    # ── Network Connection (EID 3) ────────────────────────────────────
    {
        "name": "Unusual process network connection",
        "event_id": 3,
        "conditions": {
            "Image": [
                "\\notepad.exe", "\\calc.exe", "\\mspaint.exe",
                "\\write.exe", "\\wordpad.exe",
            ],
        },
        "category": "Command and Control",
        "severity": "high",
        "confidence": 0.85,
        "mitre_tactic": "command-and-control",
        "mitre_technique": "T1071",
        "description": "Non-network application making outbound connection (potential C2)",
    },
    {
        "name": "Connection to known bad port",
        "event_id": 3,
        "conditions": {
            "DestinationPort": lambda v: int(v) in (4444, 5555, 6666, 1234, 31337, 8888, 9999),
        },
        "category": "Command and Control",
        "severity": "high",
        "confidence": 0.78,
        "mitre_tactic": "command-and-control",
        "mitre_technique": "T1571",
        "description": "Connection to commonly used malware/C2 port",
    },

    # ── CreateRemoteThread (EID 8) ────────────────────────────────────
    {
        "name": "Remote thread injection",
        "event_id": 8,
        "conditions": {},  # Any EID 8 is suspicious
        "category": "Defense Evasion",
        "severity": "high",
        "confidence": 0.80,
        "mitre_tactic": "defense-evasion",
        "mitre_technique": "T1055",
        "description": "Remote thread created in another process (process injection)",
    },

    # ── ProcessAccess (EID 10) ────────────────────────────────────────
    {
        "name": "LSASS process access",
        "event_id": 10,
        "conditions": {
            "TargetImage": ["\\lsass.exe"],
        },
        "category": "Credential Access",
        "severity": "critical",
        "confidence": 0.88,
        "mitre_tactic": "credential-access",
        "mitre_technique": "T1003.001",
        "description": "Process accessed LSASS memory - credential dumping attempt",
    },

    # ── File Create (EID 11) ─────────────────────────────────────────
    {
        "name": "Executable dropped in startup folder",
        "event_id": 11,
        "conditions": {
            "TargetFilename": [
                "\\startup\\", "\\start menu\\programs\\startup\\",
            ],
        },
        "category": "Persistence",
        "severity": "high",
        "confidence": 0.82,
        "mitre_tactic": "persistence",
        "mitre_technique": "T1547.001",
        "description": "File created in startup folder for persistence",
    },
    {
        "name": "Suspicious script file created",
        "event_id": 11,
        "conditions": {
            "TargetFilename": [
                ".ps1", ".vbs", ".bat", ".cmd", ".hta", ".wsf", ".js",
            ],
        },
        "category": "Execution",
        "severity": "medium",
        "confidence": 0.60,
        "mitre_tactic": "execution",
        "mitre_technique": "T1059",
        "description": "Script file created on disk",
    },

    # ── Registry (EID 12, 13) ────────────────────────────────────────
    {
        "name": "Registry Run key persistence",
        "event_id": [12, 13],
        "conditions": {
            "TargetObject": [
                "\\currentversion\\run",
                "\\currentversion\\runonce",
                "\\currentversion\\runservicesonce",
            ],
        },
        "category": "Persistence",
        "severity": "high",
        "confidence": 0.82,
        "mitre_tactic": "persistence",
        "mitre_technique": "T1547.001",
        "description": "Registry Run key modification detected for persistence",
    },
    {
        "name": "Security tool registry tampering",
        "event_id": [12, 13],
        "conditions": {
            "TargetObject": [
                "\\windows defender\\", "\\disableantispyware",
                "\\disablerealtimemonitoring", "\\disablebehaviormonitoring",
            ],
        },
        "category": "Defense Evasion",
        "severity": "critical",
        "confidence": 0.90,
        "mitre_tactic": "defense-evasion",
        "mitre_technique": "T1562.001",
        "description": "Security tool disabled via registry modification",
    },

    # ── FileCreateStreamHash / ADS (EID 15) ──────────────────────────
    {
        "name": "Alternate Data Stream created",
        "event_id": 15,
        "conditions": {},
        "category": "Defense Evasion",
        "severity": "medium",
        "confidence": 0.70,
        "mitre_tactic": "defense-evasion",
        "mitre_technique": "T1564.004",
        "description": "NTFS Alternate Data Stream created - potential data hiding",
    },

    # ── Pipe Created (EID 17) ────────────────────────────────────────
    {
        "name": "Known malicious pipe name",
        "event_id": 17,
        "conditions": {
            "PipeName": [
                "\\isapi", "\\msse-", "\\postex_", "\\status_",
                "\\msagent_", "\\demoagent_", "\\mojo_",
            ],
        },
        "category": "Command and Control",
        "severity": "high",
        "confidence": 0.85,
        "mitre_tactic": "command-and-control",
        "mitre_technique": "T1570",
        "description": "Named pipe associated with known C2 framework (Cobalt Strike / Meterpreter)",
    },

    # ── WMI Event (EID 19, 20) ───────────────────────────────────────
    {
        "name": "WMI persistence",
        "event_id": [19, 20],
        "conditions": {},
        "category": "Persistence",
        "severity": "high",
        "confidence": 0.80,
        "mitre_tactic": "persistence",
        "mitre_technique": "T1546.003",
        "description": "WMI event subscription created for persistence",
    },

    # ── DNS Query (EID 22) ───────────────────────────────────────────
    {
        "name": "DNS query to suspicious TLD",
        "event_id": 22,
        "conditions": {
            "QueryName": [
                ".onion", ".bit", ".bazar", ".coin", ".lib",
                ".emc", ".chan",
            ],
        },
        "category": "Command and Control",
        "severity": "high",
        "confidence": 0.80,
        "mitre_tactic": "command-and-control",
        "mitre_technique": "T1071.004",
        "description": "DNS query to suspicious/anonymous TLD",
    },
    {
        "name": "Unusually long DNS query (DGA / tunneling)",
        "event_id": 22,
        "conditions": {
            "QueryName": lambda v: len(str(v)) > 60,
        },
        "category": "Command and Control",
        "severity": "medium",
        "confidence": 0.70,
        "mitre_tactic": "command-and-control",
        "mitre_technique": "T1071.004",
        "description": "Unusually long DNS query - possible DGA or DNS tunneling",
    },

    # ── Process Tampering (EID 25) ───────────────────────────────────
    {
        "name": "Process tampering detected",
        "event_id": 25,
        "conditions": {},
        "category": "Defense Evasion",
        "severity": "critical",
        "confidence": 0.90,
        "mitre_tactic": "defense-evasion",
        "mitre_technique": "T1055",
        "description": "Process image tampering detected (process hollowing/herpaderping)",
    },

    # ── Driver Load (EID 6) ──────────────────────────────────────────
    {
        "name": "Unsigned driver loaded",
        "event_id": 6,
        "conditions": {
            "Signed": ["false"],
        },
        "category": "Persistence",
        "severity": "high",
        "confidence": 0.78,
        "mitre_tactic": "persistence",
        "mitre_technique": "T1543.003",
        "description": "Unsigned kernel driver loaded",
    },
]


# ---------------------------------------------------------------------------
# Classifier
# ---------------------------------------------------------------------------

class SysmonClassifier:
    """
    Evaluate a Sysmon event against all rules and return the highest-severity match.
    """

    def __init__(self) -> None:
        self._rules = _RULES

    @staticmethod
    def _field_match(event: Dict[str, Any], field_spec: str, check: Any) -> bool:
        """
        Check if the event matches a single field condition.

        field_spec can be:
          - "FieldName"            -> check event["FieldName"]
          - "FieldA|FieldB"        -> check event["FieldA"] OR event["FieldB"]

        check can be:
          - list[str]:             -> any substring found (case-insensitive)
          - str:                   -> substring (case-insensitive)
          - callable(value)->bool: -> call it
          - re.Pattern:            -> regex search
        """
        # Resolve field(s)
        field_names = field_spec.split("|")
        values: List[str] = []
        for fn in field_names:
            val = event.get(fn)
            if val is not None:
                values.append(str(val))

        if not values:
            return False

        combined = " ".join(values).lower()

        if callable(check) and not isinstance(check, (list, str, re.Pattern)):
            # Callable check - pass original first value
            try:
                return check(values[0])
            except Exception:
                return False

        if isinstance(check, re.Pattern):
            return bool(check.search(combined))

        if isinstance(check, list):
            return any(s.lower() in combined for s in check)

        if isinstance(check, str):
            return check.lower() in combined

        return False

    def _match_rule(
        self, event: Dict[str, Any], rule: Dict[str, Any]
    ) -> bool:
        """Return True if all conditions of a rule match."""
        conditions = rule.get("conditions", {})
        if not conditions:
            # No conditions = matches on EventID alone
            return True

        for field_spec, check in conditions.items():
            if not self._field_match(event, field_spec, check):
                return False
        return True

    def classify(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """
        Classify a Sysmon event.

        Returns a dict compatible with TriageData fields.
        """
        event_id = event.get("EventID", event.get("event_id_win", 0))
        try:
            event_id = int(event_id)
        except (ValueError, TypeError):
            event_id = 0

        # Collect all matching rules
        matched: List[Dict[str, Any]] = []

        for rule in self._rules:
            rule_eids = rule["event_id"]
            if isinstance(rule_eids, int):
                rule_eids = [rule_eids]
            if event_id not in rule_eids:
                continue
            if self._match_rule(event, rule):
                matched.append(rule)

        if not matched:
            return self._benign_result(event, event_id)

        # Pick the highest-severity match
        sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        matched.sort(key=lambda r: (sev_order.get(r["severity"], 9), -r["confidence"]))
        best = matched[0]

        # Build explanation
        all_names = [r["name"] for r in matched]
        explanation = best["description"]
        if len(matched) > 1:
            explanation += f" (+ {len(matched) - 1} more rules matched: {', '.join(all_names[1:])})"

        # Add Sysmon-specific context to explanation
        image = event.get("Image", event.get("image", ""))
        cmd = event.get("CommandLine", event.get("commandline", ""))
        if image:
            explanation += f". Process: {image}"
        if cmd and len(cmd) < 200:
            explanation += f". Cmd: {cmd}"

        return {
            "is_attack": True,
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
            "matched_rules": all_names,
            "rule_count": len(matched),
        }

    @staticmethod
    def _benign_result(event: Dict[str, Any], event_id: int) -> Dict[str, Any]:
        """Return a benign classification result."""
        image = event.get("Image", event.get("image", ""))
        return {
            "is_attack": False,
            "confidence": 0.75,
            "category": "Normal",
            "category_confidence": 0.75,
            "clif_category": "normal",
            "severity": "info",
            "explanation": (
                f"Sysmon EventID {event_id} - no suspicious patterns detected"
                + (f" (Image: {image})" if image else "")
            ),
            "binary_probs": {},
            "multi_probs": {},
            "mitre_tactic": "",
            "mitre_technique": "",
            "matched_rules": [],
            "rule_count": 0,
        }
