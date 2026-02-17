"""
Log Type Detector
==================
Inspects an event dict and classifies it into one of the supported log types.

Detection strategy (ordered by specificity):
1. Explicit field:  clif_event_type or log_type field present
2. Sysmon:          EventID + Channel == "Microsoft-Windows-Sysmon/Operational"
3. Windows Security: EventID + Channel == "Security" or source == "WinEventLog"
4. Auth log:        sshd/sudo/pam markers, or auth-related syslog fields
5. Firewall:        action/direction/rule_name combos, firewall source markers
6. Network (NSL-KDD): presence of 3+ NSL-KDD-specific feature names
7. Generic:         fallback for everything else (syslog, app, docker, etc.)
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict


class LogType(str, Enum):
    NETWORK = "network"               # NSL-KDD feature set
    SYSMON = "sysmon"                 # Windows Sysmon
    WINDOWS_SECURITY = "windows_security"  # Windows Security Event Log
    AUTH = "auth"                     # SSH / PAM / sudo / login
    FIREWALL = "firewall"            # Any firewall (iptables, pf, PAN, Forti)
    GENERIC = "generic"              # Fallback: syslog, applog, docker, etc.


# NSL-KDD fields that strongly indicate network feature data
_NSLKDD_MARKERS = frozenset({
    "serror_rate", "srv_serror_rate", "rerror_rate", "same_srv_rate",
    "diff_srv_rate", "dst_host_serror_rate", "dst_host_srv_serror_rate",
    "dst_host_same_srv_rate", "dst_host_diff_srv_rate",
    "dst_host_same_src_port_rate", "dst_host_srv_diff_host_rate",
})

# Sysmon EventID ranges (1-29 are Sysmon)
_SYSMON_EVENT_IDS = set(range(1, 30)) | {255}

# Windows Security Event IDs of interest
_WINSEC_EVENT_IDS = {
    # Logon
    4624, 4625, 4634, 4647, 4648, 4672,
    # Account management
    4720, 4722, 4723, 4724, 4725, 4726, 4728, 4732, 4733, 4735, 4738, 4740,
    4756, 4767,
    # Policy changes
    4670, 4703, 4704, 4719, 4739,
    # Privilege use
    4673, 4674,
    # Object access
    4656, 4657, 4658, 4660, 4663,
    # Process tracking
    4688, 4689,
    # Audit
    1102, 4616, 4697, 4698, 4699, 4702,
}


def _has_nslkdd_features(event: Dict[str, Any]) -> bool:
    """Return True if the event contains at least 3 NSL-KDD-specific fields."""
    return len(_NSLKDD_MARKERS.intersection(event.keys())) >= 3


def _is_sysmon(event: Dict[str, Any]) -> bool:
    """Detect Sysmon event."""
    channel = str(event.get("Channel", event.get("channel", ""))).lower()
    if "sysmon" in channel:
        return True
    source = str(event.get("source", event.get("Source", ""))).lower()
    if "sysmon" in source:
        return True
    event_id = event.get("EventID", event.get("event_id_win", None))
    if event_id is not None:
        try:
            eid = int(event_id)
            if eid in _SYSMON_EVENT_IDS and channel:
                return True
        except (ValueError, TypeError):
            pass
    return False


def _is_windows_security(event: Dict[str, Any]) -> bool:
    """Detect Windows Security Event Log."""
    channel = str(event.get("Channel", event.get("channel", ""))).lower()
    if channel in ("security", "microsoft-windows-security-auditing"):
        return True
    source = str(event.get("source", event.get("Source", ""))).lower()
    if source in ("wineventlog", "wineventlog:security", "microsoft-windows-security-auditing"):
        return True
    event_id = event.get("EventID", event.get("event_id_win", None))
    if event_id is not None:
        try:
            if int(event_id) in _WINSEC_EVENT_IDS:
                return True
        except (ValueError, TypeError):
            pass
    return False


def _is_auth(event: Dict[str, Any]) -> bool:
    """Detect auth-related log (SSH, PAM, sudo, login)."""
    source = str(event.get("source", event.get("program", ""))).lower()
    if source in ("sshd", "sudo", "su", "login", "pam", "systemd-logind"):
        return True
    message = str(event.get("message", "")).lower()
    auth_markers = (
        "accepted publickey", "accepted password", "failed password",
        "authentication failure", "pam_unix", "session opened",
        "session closed", "sudo:", "invalid user",
    )
    if any(m in message for m in auth_markers):
        return True
    category = str(event.get("category", "")).lower()
    if category in ("auth", "authentication", "login", "ssh"):
        return True
    return False


def _is_firewall(event: Dict[str, Any]) -> bool:
    """Detect firewall log (iptables, pf, PAN, Fortinet, UFW, etc.)."""
    source = str(event.get("source", event.get("program", ""))).lower()
    fw_sources = (
        "iptables", "ip6tables", "nftables", "ufw", "firewalld",
        "pf", "paloalto", "fortigate", "checkpoint", "sophos",
        "cisco_asa", "juniper_srx",
    )
    if any(s in source for s in fw_sources):
        return True
    # Firewall keyword markers in message
    message = str(event.get("message", "")).lower()
    if any(kw in message for kw in ("iptables", "ufw block", "ufw allow", "[firewall]")):
        return True
    # Has action + src/dst fields typical of firewall logs
    has_action = "action" in event and str(event["action"]).lower() in (
        "allow", "deny", "drop", "reject", "block", "accept", "pass",
    )
    has_direction = "direction" in event or ("src_ip" in event and "dst_ip" in event)
    if has_action and has_direction:
        return True
    # Has rule_name or policy_id often seen in NGFW logs
    if "rule_name" in event or "policy_id" in event or "fw_rule" in event:
        return True
    return False


def detect_log_type(event: Dict[str, Any]) -> LogType:
    """
    Detect the type of a log event.

    Priority order ensures the most specific match wins:
    1. Explicit label (clif_event_type / log_type)
    2. Sysmon (most specific Windows type)
    3. Windows Security
    4. Auth log
    5. Firewall
    6. NSL-KDD network features
    7. Generic fallback
    """
    # 1. Explicit label
    explicit = str(
        event.get("clif_event_type",
                   event.get("log_type",
                             event.get("_log_type", "")))
    ).lower().strip()

    type_map = {
        "network": LogType.NETWORK,
        "sysmon": LogType.SYSMON,
        "windows_security": LogType.WINDOWS_SECURITY,
        "security": LogType.WINDOWS_SECURITY,
        "auth": LogType.AUTH,
        "firewall": LogType.FIREWALL,
        "process": LogType.GENERIC,   # Tetragon process events go through generic
        "raw": LogType.GENERIC,
    }
    if explicit in type_map:
        return type_map[explicit]

    # 2-5. Content-based detection (ordered by specificity)
    if _is_sysmon(event):
        return LogType.SYSMON
    if _is_windows_security(event):
        return LogType.WINDOWS_SECURITY
    if _is_auth(event):
        return LogType.AUTH
    if _is_firewall(event):
        return LogType.FIREWALL

    # 6. NSL-KDD network features
    if _has_nslkdd_features(event):
        return LogType.NETWORK

    # 7. Fallback
    return LogType.GENERIC
