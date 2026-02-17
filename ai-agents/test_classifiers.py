"""Quick-sanity test for all classifiers and log type detection."""
import sys
sys.path.insert(0, ".")

from agents.classifiers import (
    detect_log_type, LogType,
    SysmonClassifier, WindowsSecurityClassifier,
    AuthLogClassifier, FirewallLogClassifier, GenericLogClassifier,
)
from agents.triage import TriageAgent
from agents.hunter import HunterAgent
from agents.verifier import VerifierAgent
from agents.reporter import ReporterAgent
from agents.orchestrator import Orchestrator

print("All imports OK")

# --- Log type detection ---
tests = [
    ({"serror_rate": 0.5, "srv_serror_rate": 0.5, "rerror_rate": 0.0, "same_srv_rate": 1.0}, LogType.NETWORK),
    ({"Channel": "Microsoft-Windows-Sysmon/Operational", "EventID": 1, "Image": "cmd.exe"}, LogType.SYSMON),
    ({"Channel": "Security", "EventID": 4625, "TargetUserName": "admin"}, LogType.WINDOWS_SECURITY),
    ({"source": "sshd", "message": "Failed password for root from 10.0.0.1"}, LogType.AUTH),
    ({"source": "iptables", "message": "iptables: IN=eth0 SRC=1.2.3.4"}, LogType.FIREWALL),
    ({"message": "Application error occurred", "level": "error"}, LogType.GENERIC),
    # Explicit log_type hint
    ({"log_type": "sysmon", "EventID": 999}, LogType.SYSMON),
    ({"log_type": "auth", "message": "hello"}, LogType.AUTH),
]
for event, expected in tests:
    result = detect_log_type(event)
    assert result == expected, f"Expected {expected}, got {result} for {event}"
print(f"Log type detection: {len(tests)}/{len(tests)} passed")

# --- Sysmon classifier ---
sc = SysmonClassifier()
r = sc.classify({
    "EventID": 10,
    "SourceImage": "mimikatz.exe",
    "TargetImage": "C:\\Windows\\System32\\lsass.exe",
    "GrantedAccess": "0x1010",
})
assert r["is_attack"], f"Sysmon: expected attack, got {r}"
print(f"Sysmon: {r['category']} ({r['confidence']:.2f}) MITRE={r['mitre_technique']}")

# --- Windows Security classifier ---
wc = WindowsSecurityClassifier()
r2 = wc.classify({"EventID": 4625, "TargetUserName": "admin", "LogonType": "10", "IpAddress": "1.2.3.4"})
assert r2["is_attack"], f"WinSec: expected attack, got {r2}"
print(f"WinSec: {r2['category']} ({r2['confidence']:.2f}) MITRE={r2['mitre_technique']}")

# Test benign: admin logon 4672
r2b = wc.classify({"EventID": 4672, "SubjectUserName": "svc_monitor"})
print(f"WinSec benign: is_attack={r2b['is_attack']}, category={r2b['category']}")

# --- Auth classifier ---
ac = AuthLogClassifier()
r3 = ac.classify({"source": "sshd", "message": "Failed password for invalid user admin from 45.33.32.156 port 22 ssh2"})
assert r3["is_attack"], f"Auth: expected attack, got {r3}"
print(f"Auth: {r3['category']} ({r3['confidence']:.2f}) MITRE={r3['mitre_technique']}")

# --- Firewall classifier ---
fc = FirewallLogClassifier()
r4 = fc.classify({
    "source": "iptables",
    "message": "iptables: IN= OUT=eth0 SRC=10.0.1.42 DST=198.51.100.99 PROTO=TCP SPT=54321 DPT=4444",
})
assert r4["is_attack"], f"Firewall: expected attack, got {r4}"
print(f"Firewall: {r4['category']} ({r4['confidence']:.2f}) MITRE={r4['mitre_technique']}")

# --- Generic classifier ---
gc = GenericLogClassifier()
r5 = gc.classify({"message": "SQL injection attempt detected in POST /login", "level": "critical"})
assert r5["is_attack"], f"Generic: expected attack, got {r5}"
print(f"Generic: {r5['category']} ({r5['confidence']:.2f}) MITRE={r5['mitre_technique']}")

# Benign generic
r5b = gc.classify({"message": "Server started successfully on port 8080", "level": "info"})
assert not r5b["is_attack"], f"Generic benign: expected benign, got {r5b}"
print(f"Generic benign: is_attack={r5b['is_attack']}")

# --- Verify TriageAgent can be instantiated without ML classifier ---
ta = TriageAgent(classifier=None)
print(f"TriageAgent instantiated (classifiers: ML={ta._classifier is None}, sysmon={ta._sysmon is not None})")

# --- Verify Orchestrator ---
orch = Orchestrator(classifier=None)
print(f"Orchestrator: {len(orch.agents)} agents ready")

print("\n=== ALL TESTS PASSED ===")
