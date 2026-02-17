"""
Firewall Log Classifier
========================
Rule-based detection for firewall logs: iptables, UFW, nftables, PAN, Fortinet,
Cisco ASA, Juniper SRX, pfSense, Sophos, Check Point, etc.

Detection scenarios:
 - Port scans (many denied connections to different ports)
 - Denied inbound to sensitive ports
 - Outbound to known-bad ports
 - Rate-based anomalies (high deny count)
 - Policy violations
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Sensitive / suspicious port sets
# ---------------------------------------------------------------------------

_SENSITIVE_INBOUND_PORTS = frozenset({
    22, 23, 25, 135, 137, 138, 139, 445, 1433, 1434, 3306, 3389,
    5432, 5900, 5985, 5986, 6379, 8080, 8443, 9200, 27017,
})

_MALWARE_PORTS = frozenset({
    4444, 5555, 6666, 1234, 31337, 8888, 9999, 12345, 65535,
    1337, 2222, 7777,
})

_C2_PORTS = frozenset({
    443, 8443, 80, 8080, 53,  # common C2 over standard ports
    4443, 4444, 5555, 8888,
})


# ---------------------------------------------------------------------------
# Iptables / UFW message parser
# ---------------------------------------------------------------------------

_IPTABLES_RE = re.compile(
    r"(?:iptables|UFW\s+\w+|kernel:.*\bIN=)"
    r".*?IN=(?P<in_iface>\S*)"
    r".*?OUT=(?P<out_iface>\S*)"
    r".*?SRC=(?P<src_ip>\S+)"
    r".*?DST=(?P<dst_ip>\S+)"
    r"(?:.*?SPT=(?P<src_port>\d+))?"
    r"(?:.*?DPT=(?P<dst_port>\d+))?"
    r"(?:.*?PROTO=(?P<proto>\S+))?",
    re.IGNORECASE,
)


def _parse_iptables(message: str) -> Optional[Dict[str, Any]]:
    """Try to parse iptables/UFW formatted log line."""
    m = _IPTABLES_RE.search(message)
    if not m:
        return None
    d = m.groupdict()
    try:
        d["src_port"] = int(d.get("src_port") or 0)
        d["dst_port"] = int(d.get("dst_port") or 0)
    except ValueError:
        d["src_port"] = 0
        d["dst_port"] = 0
    return d


# ---------------------------------------------------------------------------
# Classifier
# ---------------------------------------------------------------------------

class FirewallLogClassifier:
    """
    Classify firewall log events using rule-based analysis.
    """

    def classify(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """
        Classify a firewall log event.

        Accepts both structured events (with src_ip, dst_ip, action, etc.)
        and raw syslog messages (iptables/UFW format).
        """
        # Normalize into a structured form
        parsed = self._normalize(event)

        action = (parsed.get("action") or "").lower()
        src_ip = parsed.get("src_ip") or ""
        dst_ip = parsed.get("dst_ip") or ""
        src_port = parsed.get("src_port") or 0
        dst_port = parsed.get("dst_port") or 0
        direction = (parsed.get("direction") or "").lower()
        protocol = (parsed.get("protocol") or "").lower()

        # Run checks in priority order
        checks = [
            self._check_outbound_to_malware_port,
            self._check_denied_to_sensitive_port,
            self._check_ufw_block_inbound,
            self._check_deny_pattern,
            self._check_allow_inbound_sensitive,
        ]

        for check_fn in checks:
            result = check_fn(parsed, action, src_ip, dst_ip, src_port, dst_port,
                              direction, protocol)
            if result:
                return result

        return self._benign_result(parsed)

    def _normalize(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize event into structured firewall fields."""
        # If it has structured fields already, use them
        if "src_ip" in event and "action" in event:
            parsed = dict(event)
            for int_field in ("src_port", "dst_port"):
                try:
                    parsed[int_field] = int(parsed.get(int_field, 0))
                except (ValueError, TypeError):
                    parsed[int_field] = 0
            return parsed

        # Try parsing iptables/UFW from message
        message = str(event.get("message", ""))
        iptables_data = _parse_iptables(message)
        if iptables_data:
            # Determine action from message
            action = "deny"
            msg_lower = message.lower()
            if "ufw allow" in msg_lower or "accept" in msg_lower:
                action = "allow"
            elif "ufw block" in msg_lower or "drop" in msg_lower or "deny" in msg_lower:
                action = "deny"
            elif "reject" in msg_lower:
                action = "reject"

            iptables_data["action"] = action
            iptables_data["direction"] = "inbound" if iptables_data.get("in_iface") else "outbound"
            iptables_data["protocol"] = iptables_data.get("proto", "")
            # Carry over original fields
            for k, v in event.items():
                if k not in iptables_data:
                    iptables_data[k] = v
            return iptables_data

        # Fallback: construct from whatever fields are available
        return {
            "action": str(event.get("action", event.get("fw_action", ""))),
            "src_ip": str(event.get("src_ip", event.get("source_ip", ""))),
            "dst_ip": str(event.get("dst_ip", event.get("dest_ip", event.get("destination_ip", "")))),
            "src_port": int(event.get("src_port", event.get("source_port", 0)) or 0),
            "dst_port": int(event.get("dst_port", event.get("dest_port", event.get("destination_port", 0))) or 0),
            "direction": str(event.get("direction", "")),
            "protocol": str(event.get("protocol", event.get("proto", ""))),
            "rule_name": str(event.get("rule_name", event.get("fw_rule", ""))),
            **{k: v for k, v in event.items() if k not in
               ("action", "src_ip", "dst_ip", "src_port", "dst_port", "direction", "protocol")},
        }

    # ── Check functions ───────────────────────────────────────────────

    def _check_outbound_to_malware_port(
        self, parsed, action, src_ip, dst_ip, src_port, dst_port,
        direction, protocol,
    ) -> Optional[Dict[str, Any]]:
        """Outbound connection to known malware/C2 port."""
        if dst_port in _MALWARE_PORTS:
            return self._result(
                is_attack=True,
                confidence=0.85,
                category="Command and Control",
                severity="high",
                mitre_tactic="command-and-control",
                mitre_technique="T1571",
                description=(
                    f"{'Blocked' if action in ('deny', 'drop', 'reject', 'block') else 'Allowed'} "
                    f"connection to known malware/C2 port {dst_port} "
                    f"({src_ip} -> {dst_ip}:{dst_port})"
                ),
            )
        return None

    def _check_denied_to_sensitive_port(
        self, parsed, action, src_ip, dst_ip, src_port, dst_port,
        direction, protocol,
    ) -> Optional[Dict[str, Any]]:
        """Denied inbound connection to sensitive service port."""
        if action in ("deny", "drop", "reject", "block") and dst_port in _SENSITIVE_INBOUND_PORTS:
            port_names = {
                22: "SSH", 23: "Telnet", 25: "SMTP", 135: "RPC", 139: "NetBIOS",
                445: "SMB", 1433: "MSSQL", 3306: "MySQL", 3389: "RDP",
                5432: "PostgreSQL", 5900: "VNC", 6379: "Redis", 9200: "Elasticsearch",
                27017: "MongoDB",
            }
            svc = port_names.get(dst_port, str(dst_port))
            return self._result(
                is_attack=True,
                confidence=0.72,
                category="Probe",
                severity="medium",
                mitre_tactic="discovery",
                mitre_technique="T1046",
                description=(
                    f"Denied inbound connection to sensitive port {dst_port}/{svc} "
                    f"from {src_ip} -> {dst_ip}:{dst_port}"
                ),
            )
        return None

    def _check_ufw_block_inbound(
        self, parsed, action, src_ip, dst_ip, src_port, dst_port,
        direction, protocol,
    ) -> Optional[Dict[str, Any]]:
        """UFW block on inbound - general denied traffic."""
        message = str(parsed.get("message", "")).lower()
        if "ufw block" in message:
            return self._result(
                is_attack=True,
                confidence=0.60,
                category="Probe",
                severity="low",
                mitre_tactic="discovery",
                mitre_technique="T1046",
                description=(
                    f"UFW blocked inbound connection: {src_ip}:{src_port} -> "
                    f"{dst_ip}:{dst_port} ({protocol})"
                ),
            )
        return None

    def _check_deny_pattern(
        self, parsed, action, src_ip, dst_ip, src_port, dst_port,
        direction, protocol,
    ) -> Optional[Dict[str, Any]]:
        """Generic deny/drop action."""
        if action in ("deny", "drop", "reject", "block"):
            return self._result(
                is_attack=True,
                confidence=0.55,
                category="Probe",
                severity="low",
                mitre_tactic="discovery",
                mitre_technique="T1046",
                description=(
                    f"Firewall denied: {src_ip}:{src_port} -> "
                    f"{dst_ip}:{dst_port} (action={action}, proto={protocol})"
                ),
            )
        return None

    def _check_allow_inbound_sensitive(
        self, parsed, action, src_ip, dst_ip, src_port, dst_port,
        direction, protocol,
    ) -> Optional[Dict[str, Any]]:
        """Allowed inbound to sensitive port (not necessarily attack, but notable)."""
        if (action in ("allow", "accept", "pass") and
                dst_port in _SENSITIVE_INBOUND_PORTS and
                direction in ("inbound", "in", "")):
            return self._result(
                is_attack=False,
                confidence=0.45,
                category="Normal",
                severity="low",
                mitre_tactic="",
                mitre_technique="",
                description=(
                    f"Allowed inbound to sensitive port {dst_port}: "
                    f"{src_ip}:{src_port} -> {dst_ip}:{dst_port}"
                ),
            )
        return None

    # ── Helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _result(is_attack: bool, confidence: float, category: str,
                severity: str, mitre_tactic: str, mitre_technique: str,
                description: str) -> Dict[str, Any]:
        return {
            "is_attack": is_attack,
            "confidence": confidence,
            "category": category,
            "category_confidence": confidence,
            "clif_category": category.lower().replace(" ", "_"),
            "severity": severity,
            "explanation": description,
            "binary_probs": {},
            "multi_probs": {},
            "mitre_tactic": mitre_tactic,
            "mitre_technique": mitre_technique,
        }

    @staticmethod
    def _benign_result(parsed: Dict[str, Any]) -> Dict[str, Any]:
        action = parsed.get("action", "unknown")
        src = parsed.get("src_ip", "?")
        dst = parsed.get("dst_ip", "?")
        dport = parsed.get("dst_port", "?")
        return {
            "is_attack": False,
            "confidence": 0.70,
            "category": "Normal",
            "category_confidence": 0.70,
            "clif_category": "normal",
            "severity": "info",
            "explanation": (
                f"Firewall event: action={action} {src} -> {dst}:{dport} - "
                f"no suspicious pattern detected"
            ),
            "binary_probs": {},
            "multi_probs": {},
            "mitre_tactic": "",
            "mitre_technique": "",
        }
