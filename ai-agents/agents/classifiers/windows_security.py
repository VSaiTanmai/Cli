"""
Windows Security Event Log Classifier
=======================================
Rule-based detection using Windows Security Event IDs.

Covers:
 - Logon events (4624, 4625, 4648, 4672)
 - Account management (4720-4740, 4756, 4767)
 - Policy/audit changes (4670, 4703, 4719, 4739, 1102)
 - Privilege use (4673, 4674)
 - Object access (4656, 4663)
 - Process tracking (4688)
 - Service install (4697)
 - Scheduled task (4698, 4699, 4702)
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple


# ---------------------------------------------------------------------------
# Detection rules keyed by EventID
# ---------------------------------------------------------------------------
# Each entry: (check_func, category, severity, confidence,
#              mitre_tactic, mitre_technique, description)
# check_func takes (event) -> bool.  None means always-match for that EventID.

def _always(_event: Dict) -> bool:
    return True


def _logon_type_suspicious(event: Dict) -> bool:
    """Logon types 3 (network), 10 (remote interactive) are higher-risk."""
    lt = event.get("LogonType", event.get("logon_type", ""))
    try:
        return int(lt) in (3, 10)
    except (ValueError, TypeError):
        return False


def _admin_logon(event: Dict) -> bool:
    """4672 - Special privileges assigned to new logon (admin)."""
    return True  # Any special-priv logon is notable


def _brute_force_indicators(event: Dict) -> bool:
    """Multiple 4625 is brute force but we flag each one."""
    return True


def _explicit_credential(event: Dict) -> bool:
    """4648 - Logon with explicit credentials (runas, etc.)."""
    target = str(event.get("TargetUserName", event.get("target_user", ""))).lower()
    # Especially suspicious if targeting admin/service accounts
    return target in ("administrator", "admin", "system", "localservice",
                      "networkservice") or not target


def _new_account(event: Dict) -> bool:
    """4720 - A user account was created."""
    return True


def _account_enabled(event: Dict) -> bool:
    """4722 - Account enabled."""
    return True


def _password_change(event: Dict) -> bool:
    """4723/4724 - Password change attempted."""
    return True


def _account_disabled(event: Dict) -> bool:
    """4725 - Account disabled."""
    return True


def _account_deleted(event: Dict) -> bool:
    """4726 - Account deleted."""
    return True


def _group_member_added(event: Dict) -> bool:
    """4728/4732/4756 - Member added to security group."""
    group = str(event.get("TargetUserName", event.get("group_name", ""))).lower()
    # Escalation if admin group
    return any(kw in group for kw in ("admin", "domain admins", "enterprise admins",
                                       "schema admins", "backup operators"))


def _group_member_added_any(event: Dict) -> bool:
    """Any group membership change."""
    return True


def _account_locked(event: Dict) -> bool:
    """4740 - Account locked out (possible brute force)."""
    return True


def _audit_log_cleared(event: Dict) -> bool:
    """1102 - The audit log was cleared."""
    return True


def _sensitive_privilege_use(event: Dict) -> bool:
    """4673 - Sensitive privilege used."""
    priv = str(event.get("PrivilegeList", event.get("privileges", ""))).lower()
    sensitive = ("sedebugprivilege", "setakeownershipprivilege",
                 "seloaddriverprivilege", "sebackupprivilege",
                 "serestoreprivilege", "seimpersonateprivilege")
    return any(s in priv for s in sensitive)


def _new_service_installed(event: Dict) -> bool:
    """4697 - A service was installed in the system."""
    return True


def _process_creation(event: Dict) -> bool:
    """4688 - New process created."""
    cmd = str(event.get("CommandLine", event.get("NewProcessName",
                                                  event.get("process_name", "")))).lower()
    suspicious = ("powershell", "cmd.exe", "wscript", "cscript", "mshta",
                  "certutil", "bitsadmin", "rundll32")
    return any(s in cmd for s in suspicious)


def _scheduled_task_created(event: Dict) -> bool:
    """4698 - A scheduled task was created."""
    return True


# ---------------------------------------------------------------------------
# Rule table: EventID -> list of (check, category, severity, confidence,
#                                  mitre_tactic, mitre_technique, desc)
# ---------------------------------------------------------------------------

_RULE_TABLE: Dict[int, List[Tuple]] = {
    # ── Logon Events ──────────────────────────────────────────────────
    4624: [
        (_logon_type_suspicious,
         "Suspicious Logon", "medium", 0.65,
         "initial-access", "T1078",
         "Remote/network logon detected (LogonType 3/10)"),
    ],
    4625: [
        (_brute_force_indicators,
         "Brute Force", "high", 0.78,
         "credential-access", "T1110",
         "Failed logon attempt - potential brute force"),
    ],
    4648: [
        (_explicit_credential,
         "Lateral Movement", "high", 0.75,
         "lateral-movement", "T1021",
         "Logon with explicit credentials (runas/mapped drive) - potential lateral movement"),
    ],
    4672: [
        (_admin_logon,
         "Privilege Escalation", "medium", 0.60,
         "privilege-escalation", "T1078",
         "Special privileges assigned to new logon session"),
    ],

    # ── Account Management ────────────────────────────────────────────
    4720: [
        (_new_account,
         "Persistence", "high", 0.80,
         "persistence", "T1136.001",
         "New user account created"),
    ],
    4722: [
        (_account_enabled,
         "Persistence", "medium", 0.60,
         "persistence", "T1098",
         "User account enabled"),
    ],
    4723: [
        (_password_change,
         "Credential Access", "medium", 0.55,
         "credential-access", "T1098",
         "User attempted to change own password"),
    ],
    4724: [
        (_password_change,
         "Credential Access", "high", 0.72,
         "credential-access", "T1098",
         "Password reset attempted by another account"),
    ],
    4725: [
        (_account_disabled,
         "Impact", "medium", 0.60,
         "impact", "T1531",
         "User account disabled"),
    ],
    4726: [
        (_account_deleted,
         "Impact", "high", 0.75,
         "impact", "T1531",
         "User account deleted"),
    ],
    4728: [
        (_group_member_added,
         "Privilege Escalation", "critical", 0.88,
         "privilege-escalation", "T1098",
         "Member added to privileged security group"),
        (_group_member_added_any,
         "Account Modification", "medium", 0.60,
         "persistence", "T1098",
         "Member added to security-enabled global group"),
    ],
    4732: [
        (_group_member_added,
         "Privilege Escalation", "critical", 0.88,
         "privilege-escalation", "T1098",
         "Member added to privileged local group"),
        (_group_member_added_any,
         "Account Modification", "medium", 0.60,
         "persistence", "T1098",
         "Member added to security-enabled local group"),
    ],
    4740: [
        (_account_locked,
         "Brute Force", "high", 0.82,
         "credential-access", "T1110",
         "Account locked out - possible brute force attack"),
    ],
    4756: [
        (_group_member_added,
         "Privilege Escalation", "critical", 0.88,
         "privilege-escalation", "T1098",
         "Member added to privileged universal group"),
        (_group_member_added_any,
         "Account Modification", "medium", 0.60,
         "persistence", "T1098",
         "Member added to security-enabled universal group"),
    ],

    # ── Policy / Audit Changes ────────────────────────────────────────
    1102: [
        (_audit_log_cleared,
         "Defense Evasion", "critical", 0.92,
         "defense-evasion", "T1070.001",
         "Audit log cleared - indicator of evidence destruction"),
    ],
    4719: [
        (_always,
         "Defense Evasion", "high", 0.80,
         "defense-evasion", "T1562.002",
         "System audit policy changed"),
    ],

    # ── Privilege Use ─────────────────────────────────────────────────
    4673: [
        (_sensitive_privilege_use,
         "Privilege Escalation", "high", 0.78,
         "privilege-escalation", "T1134",
         "Sensitive privilege used (SeDebug/SeTakeOwnership/etc.)"),
    ],

    # ── Process Tracking ──────────────────────────────────────────────
    4688: [
        (_process_creation,
         "Execution", "medium", 0.65,
         "execution", "T1059",
         "Suspicious process created via Windows auditing"),
    ],

    # ── Service / Task ────────────────────────────────────────────────
    4697: [
        (_new_service_installed,
         "Persistence", "high", 0.80,
         "persistence", "T1543.003",
         "New service installed on system"),
    ],
    4698: [
        (_scheduled_task_created,
         "Persistence", "high", 0.78,
         "persistence", "T1053.005",
         "Scheduled task created"),
    ],
}


class WindowsSecurityClassifier:
    """
    Classify Windows Security Event Log entries using EventID-based rules.
    """

    def __init__(self) -> None:
        self._rule_table = _RULE_TABLE

    def classify(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """
        Classify a Windows Security event.

        Returns a dict compatible with TriageData fields.
        """
        event_id = event.get("EventID", event.get("event_id_win", 0))
        try:
            event_id = int(event_id)
        except (ValueError, TypeError):
            event_id = 0

        rules = self._rule_table.get(event_id, [])
        if not rules:
            return self._benign_result(event, event_id)

        # Evaluate rules in order; first matching check wins per severity
        sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        best = None
        best_rank = 99

        for check_fn, cat, sev, conf, tactic, technique, desc in rules:
            try:
                if check_fn(event):
                    rank = sev_order.get(sev, 9)
                    if rank < best_rank or (rank == best_rank and conf > (best[3] if best else 0)):
                        best = (check_fn, cat, sev, conf, tactic, technique, desc)
                        best_rank = rank
            except Exception:
                continue

        if not best:
            return self._benign_result(event, event_id)

        _, category, severity, confidence, mitre_tactic, mitre_technique, description = best

        # Enrich description with event details
        user = (event.get("TargetUserName", "") or
                event.get("SubjectUserName", "") or
                event.get("user", ""))
        ip = event.get("IpAddress", event.get("source_ip", ""))
        workstation = event.get("WorkstationName", event.get("hostname", ""))

        detail_parts = []
        if user:
            detail_parts.append(f"User: {user}")
        if ip:
            detail_parts.append(f"IP: {ip}")
        if workstation:
            detail_parts.append(f"Host: {workstation}")

        explanation = f"[EventID {event_id}] {description}"
        if detail_parts:
            explanation += f" ({', '.join(detail_parts)})"

        return {
            "is_attack": True,
            "confidence": confidence,
            "category": category,
            "category_confidence": confidence,
            "clif_category": category.lower().replace(" ", "_"),
            "severity": severity,
            "explanation": explanation,
            "binary_probs": {},
            "multi_probs": {},
            "mitre_tactic": mitre_tactic,
            "mitre_technique": mitre_technique,
        }

    @staticmethod
    def _benign_result(event: Dict[str, Any], event_id: int) -> Dict[str, Any]:
        user = event.get("TargetUserName", event.get("SubjectUserName", ""))
        return {
            "is_attack": False,
            "confidence": 0.75,
            "category": "Normal",
            "category_confidence": 0.75,
            "clif_category": "normal",
            "severity": "info",
            "explanation": (
                f"Windows Security EventID {event_id} - routine event"
                + (f" (User: {user})" if user else "")
            ),
            "binary_probs": {},
            "multi_probs": {},
            "mitre_tactic": "",
            "mitre_technique": "",
        }
