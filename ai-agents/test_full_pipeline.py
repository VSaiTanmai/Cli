"""
Full Pipeline Test — AI Service (no LanceDB, no LLM)
=====================================================
Tests the entire CLIF pipeline end-to-end via HTTP against the running AI service.
"""
import requests
import json
import sys
import time

BASE = "http://localhost:8200"
DASH = "http://localhost:3001"
PASSED = 0
FAILED = 0


def ok(label, detail=""):
    global PASSED
    PASSED += 1
    print(f"  [PASS] {label}" + (f" — {detail}" if detail else ""))


def fail(label, detail=""):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {label}" + (f" — {detail}" if detail else ""))


# ───────────────────────────────────────────────────────────────
print("=" * 65)
print("  CLIF Full Pipeline Test (no LanceDB, no LLM)")
print("=" * 65)

# ── 1. Health Check ──────────────────────────────────────────
print("\n1. AI Service Health Check")
try:
    r = requests.get(f"{BASE}/health", timeout=5)
    h = r.json()
    if h.get("status") in ("healthy", "degraded"):
        ok("Health endpoint", f"status={h['status']}, model_loaded={h['model_loaded']}, agents={h['agents']}")
    else:
        fail("Health endpoint", str(h))
except Exception as e:
    fail("Health endpoint", str(e))

# ── 2. Agent Statuses ───────────────────────────────────────
print("\n2. Agent Statuses")
try:
    r = requests.get(f"{BASE}/agents/status", timeout=5)
    agents = r.json()["agents"]
    for a in agents:
        name = a.get("name", "?")
        status = a.get("status", a.get("available", "?"))
        print(f"     • {name}: {status}")
    if len(agents) >= 4:
        ok("Agent statuses", f"{len(agents)} agents reported")
    else:
        fail("Agent statuses", f"Only {len(agents)} agents")
except Exception as e:
    fail("Agent statuses", str(e))

# ── 3. LLM Status ───────────────────────────────────────────
print("\n3. LLM Status (should work even when LLM is down)")
try:
    r = requests.get(f"{BASE}/llm/status", timeout=5)
    llm = r.json()
    ok("LLM status endpoint", f"available={llm.get('available')}, model={llm.get('model', 'n/a')}")
except Exception as e:
    fail("LLM status endpoint", str(e))

# ── 4. Classify Single Event (NSL-KDD) ──────────────────────
print("\n4. Classify Single Event (NSL-KDD features)")
try:
    event = {
        "duration": 0, "protocol_type": "tcp", "service": "http",
        "flag": "SF", "src_bytes": 291, "dst_bytes": 0,
        "num_failed_logins": 0, "logged_in": 0,
        "count": 117, "srv_count": 16,
        "serror_rate": 0.0, "same_srv_rate": 0.14,
    }
    r = requests.post(f"{BASE}/classify", json=event, timeout=10)
    c = r.json()
    ok("NSL-KDD classify",
       f"attack={c['is_attack']} | category={c['category']} | "
       f"severity={c['severity']} | confidence={c['confidence']:.2f}")
except Exception as e:
    fail("NSL-KDD classify", str(e))

# ── 5. Classify Batch ───────────────────────────────────────
print("\n5. Classify Batch (3 events)")
try:
    batch = {"events": [
        {"duration": 0, "protocol_type": "tcp", "service": "http",
         "flag": "SF", "src_bytes": 100, "dst_bytes": 200},
        {"duration": 0, "protocol_type": "tcp", "service": "telnet",
         "flag": "S0", "src_bytes": 0, "dst_bytes": 0,
         "count": 500, "serror_rate": 1.0},
        {"duration": 300, "protocol_type": "udp", "service": "domain_u",
         "flag": "SF", "src_bytes": 50, "dst_bytes": 150},
    ]}
    r = requests.post(f"{BASE}/classify/batch", json=batch, timeout=15)
    b = r.json()
    ok("Batch classify",
       f"count={b['count']} | latency={b['latency_ms']:.1f}ms")
    for i, res in enumerate(b["results"]):
        print(f"       Event {i+1}: attack={res['is_attack']} category={res['category']} severity={res['severity']}")
except Exception as e:
    fail("Batch classify", str(e))

# ── 6. Full 4-Agent Investigation (attack) ──────────────────
print("\n6. Full 4-Agent Investigation (DoS/Probe attack)")
try:
    attack_event = {
        "duration": 0, "protocol_type": "tcp", "service": "telnet",
        "flag": "S0", "src_bytes": 0, "dst_bytes": 0,
        "num_failed_logins": 5, "logged_in": 0,
        "count": 511, "srv_count": 511,
        "serror_rate": 1.0, "srv_serror_rate": 1.0,
        "same_srv_rate": 1.0, "diff_srv_rate": 0.0,
        "dst_host_count": 255, "dst_host_srv_count": 255,
        "dst_host_serror_rate": 1.0, "dst_host_srv_serror_rate": 1.0,
    }
    t0 = time.time()
    r = requests.post(f"{BASE}/investigate", json=attack_event, timeout=60)
    elapsed = time.time() - t0
    inv = r.json()

    status = inv.get("status", inv.get("pipeline_status", "?"))
    triage = inv.get("triage", {})
    hunt = inv.get("hunt", {})
    ver = inv.get("verification", {})
    rep = inv.get("report", {})

    print(f"     Pipeline: {status} ({elapsed:.1f}s)")
    print(f"     Triage:   category={triage.get('category','?')} severity={triage.get('severity','?')} "
          f"confidence={triage.get('confidence','?')} classifier={triage.get('classifier_used','?')}")
    print(f"     Hunt:     correlations={hunt.get('correlations_found', 0)} iocs={hunt.get('iocs_found', 0)}")
    print(f"     Verify:   verdict={ver.get('verdict','?')} fp_score={ver.get('false_positive_score','?')}")
    print(f"     Report:   severity={rep.get('severity','?')} sections={len(rep.get('sections', {}))}")

    if status in ("completed", "closed"):
        ok("Full investigation (attack)", f"verdict={ver.get('verdict','?')}")
    else:
        fail("Full investigation (attack)", f"status={status}")
except Exception as e:
    fail("Full investigation (attack)", str(e))

# ── 7. Full Investigation (benign event) ────────────────────
print("\n7. Full 4-Agent Investigation (benign event)")
try:
    benign = {
        "duration": 0, "protocol_type": "tcp", "service": "http",
        "flag": "SF", "src_bytes": 200, "dst_bytes": 3000,
        "logged_in": 1, "count": 5, "srv_count": 5,
        "serror_rate": 0.0, "same_srv_rate": 1.0,
    }
    t0 = time.time()
    r = requests.post(f"{BASE}/investigate", json=benign, timeout=60)
    elapsed = time.time() - t0
    inv = r.json()

    status = inv.get("status", inv.get("pipeline_status", "?"))
    triage = inv.get("triage", {})
    print(f"     Pipeline: {status} ({elapsed:.1f}s)")
    print(f"     Triage:   category={triage.get('category','?')} severity={triage.get('severity','?')} "
          f"confidence={triage.get('confidence','?')}")

    if status in ("completed", "closed", "open"):
        ok("Full investigation (benign)", f"status={status}")
    else:
        fail("Full investigation (benign)", f"status={status}")
except Exception as e:
    fail("Full investigation (benign)", str(e))

# ── 8. Generic Investigation (Sysmon) ───────────────────────
print("\n8. Generic Investigation — Sysmon Event")
try:
    sysmon = {
        "EventID": 1,
        "Channel": "Microsoft-Windows-Sysmon/Operational",
        "Image": "C:\\Windows\\System32\\cmd.exe",
        "ParentImage": "C:\\Windows\\System32\\wscript.exe",
        "CommandLine": "cmd.exe /c powershell -ep bypass -e JABjAD0...",
        "User": "CORP\\admin",
        "source_ip": "10.0.0.50",
        "dest_ip": "10.0.0.1",
        "log_type": "sysmon",
    }
    t0 = time.time()
    r = requests.post(f"{BASE}/investigate/generic", json=sysmon, timeout=60)
    elapsed = time.time() - t0
    inv = r.json()
    triage = inv.get("triage", {})
    print(f"     Pipeline:  {inv.get('status','?')} ({elapsed:.1f}s)")
    print(f"     Triage:    category={triage.get('category','?')} severity={triage.get('severity','?')}")
    print(f"     Classifier: {triage.get('classifier_used','?')}")
    ok("Sysmon generic investigation")
except Exception as e:
    fail("Sysmon generic investigation", str(e))

# ── 9. Generic Investigation (Auth/SSH) ─────────────────────
print("\n9. Generic Investigation — Auth/SSH Event")
try:
    auth = {
        "message": "Failed password for root from 192.168.1.100 port 22 ssh2",
        "hostname": "webserver01",
        "source": "sshd",
        "log_type": "auth",
    }
    t0 = time.time()
    r = requests.post(f"{BASE}/investigate/generic", json=auth, timeout=60)
    elapsed = time.time() - t0
    inv = r.json()
    triage = inv.get("triage", {})
    print(f"     Pipeline:  {inv.get('status','?')} ({elapsed:.1f}s)")
    print(f"     Triage:    category={triage.get('category','?')} severity={triage.get('severity','?')}")
    print(f"     Classifier: {triage.get('classifier_used','?')}")
    ok("Auth/SSH generic investigation")
except Exception as e:
    fail("Auth/SSH generic investigation", str(e))

# ── 10. Generic Investigation (Firewall) ────────────────────
print("\n10. Generic Investigation — Firewall Event")
try:
    fw = {
        "action": "DROP",
        "source_ip": "203.0.113.50",
        "dest_ip": "10.0.0.5",
        "source_port": 44123,
        "dest_port": 22,
        "protocol": "tcp",
        "bytes_sent": 0,
        "packets": 1500,
        "log_type": "firewall",
    }
    t0 = time.time()
    r = requests.post(f"{BASE}/investigate/generic", json=fw, timeout=60)
    elapsed = time.time() - t0
    inv = r.json()
    triage = inv.get("triage", {})
    print(f"     Pipeline:  {inv.get('status','?')} ({elapsed:.1f}s)")
    print(f"     Triage:    category={triage.get('category','?')} severity={triage.get('severity','?')}")
    print(f"     Classifier: {triage.get('classifier_used','?')}")
    ok("Firewall generic investigation")
except Exception as e:
    fail("Firewall generic investigation", str(e))

# ── 11. Generic Investigation (Windows Security) ────────────
print("\n11. Generic Investigation — Windows Security Event")
try:
    winsec = {
        "EventID": 4625,
        "Channel": "Security",
        "TargetUserName": "Administrator",
        "IpAddress": "10.0.0.99",
        "LogonType": 10,
        "log_type": "windows_security",
    }
    t0 = time.time()
    r = requests.post(f"{BASE}/investigate/generic", json=winsec, timeout=60)
    elapsed = time.time() - t0
    inv = r.json()
    triage = inv.get("triage", {})
    print(f"     Pipeline:  {inv.get('status','?')} ({elapsed:.1f}s)")
    print(f"     Triage:    category={triage.get('category','?')} severity={triage.get('severity','?')}")
    print(f"     Classifier: {triage.get('classifier_used','?')}")
    ok("Windows Security generic investigation")
except Exception as e:
    fail("Windows Security generic investigation", str(e))

# ── 12. Model Info ──────────────────────────────────────────
print("\n12. Model Info")
try:
    r = requests.get(f"{BASE}/model/info", timeout=5)
    info = r.json()
    ok("Model info", f"binary={info.get('binary_model','?')} multi={info.get('multiclass_model','?')}")
except Exception as e:
    fail("Model info", str(e))

# ── 13. Investigation History ───────────────────────────────
print("\n13. Investigation History")
try:
    r = requests.get(f"{BASE}/agents/investigations", timeout=5)
    inv_list = r.json().get("investigations", [])
    ok("Investigation history", f"{len(inv_list)} investigations recorded")
except Exception as e:
    fail("Investigation history", str(e))

# ── 14. Dashboard Reachable ─────────────────────────────────
print("\n14. Dashboard (Next.js) Reachable")
try:
    r = requests.get(DASH, timeout=5, allow_redirects=True)
    if r.status_code in (200, 307, 302):
        ok("Dashboard reachable", f"status={r.status_code}")
    else:
        fail("Dashboard reachable", f"status={r.status_code}")
except Exception as e:
    fail("Dashboard reachable", str(e))

# ── Summary ─────────────────────────────────────────────────
print("\n" + "=" * 65)
total = PASSED + FAILED
print(f"  RESULTS: {PASSED}/{total} passed, {FAILED} failed")
if FAILED == 0:
    print("  ALL TESTS PASSED!")
else:
    print(f"  {FAILED} test(s) failed")
print("=" * 65)

sys.exit(0 if FAILED == 0 else 1)
