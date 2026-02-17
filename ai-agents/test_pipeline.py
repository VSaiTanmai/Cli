"""End-to-end pipeline test for all log types (without external services)."""
import asyncio
import sys
sys.path.insert(0, ".")

from agents.orchestrator import Orchestrator

# Events covering all 6 log types
TEST_EVENTS = {
    "network_dos": {
        "duration": 0, "protocol_type": "tcp", "service": "http", "flag": "S0",
        "src_bytes": 0, "dst_bytes": 0, "land": 0, "wrong_fragment": 0, "urgent": 0,
        "hot": 0, "num_failed_logins": 0, "logged_in": 0, "num_compromised": 0,
        "root_shell": 0, "su_attempted": 0, "num_root": 0, "num_file_creations": 0,
        "num_shells": 0, "num_access_files": 0, "num_outbound_cmds": 0,
        "is_host_login": 0, "is_guest_login": 0, "count": 511, "srv_count": 511,
        "serror_rate": 1.0, "srv_serror_rate": 1.0, "rerror_rate": 0.0,
        "srv_rerror_rate": 0.0, "same_srv_rate": 1.0, "diff_srv_rate": 0.0,
        "srv_diff_host_rate": 0.0, "dst_host_count": 255, "dst_host_srv_count": 255,
        "dst_host_same_srv_rate": 1.0, "dst_host_diff_srv_rate": 0.0,
        "dst_host_same_src_port_rate": 1.0, "dst_host_srv_diff_host_rate": 0.0,
        "dst_host_serror_rate": 1.0, "dst_host_srv_serror_rate": 1.0,
        "dst_host_rerror_rate": 0.0, "dst_host_srv_rerror_rate": 0.0,
    },
    "sysmon_mimikatz": {
        "Channel": "Microsoft-Windows-Sysmon/Operational",
        "EventID": 10,
        "source": "sysmon",
        "hostname": "DC01.corp.local",
        "SourceImage": "C:\\Tools\\mimikatz.exe",
        "TargetImage": "C:\\Windows\\System32\\lsass.exe",
        "GrantedAccess": "0x1010",
    },
    "winsec_4625": {
        "Channel": "Security",
        "EventID": 4625,
        "TargetUserName": "administrator",
        "LogonType": "10",
        "IpAddress": "185.220.101.42",
        "hostname": "WEB-SRV01",
    },
    "auth_ssh_brute": {
        "source": "sshd",
        "hostname": "bastion-01",
        "message": "Failed password for invalid user admin from 45.33.32.156 port 22 ssh2",
        "ip_address": "45.33.32.156",
    },
    "firewall_c2": {
        "source": "iptables",
        "message": "iptables: IN= OUT=eth0 SRC=10.0.1.42 DST=198.51.100.99 PROTO=TCP SPT=54321 DPT=4444",
        "hostname": "edge-fw-01",
    },
    "generic_sqli": {
        "message": "SQL injection attempt blocked: SELECT * FROM users WHERE 1=1",
        "level": "critical",
        "source": "waf",
        "hostname": "web-proxy-01",
    },
}


async def main():
    orch = Orchestrator(classifier=None)  # No ML model - will fail gracefully for network
    
    passed = 0
    failed = 0
    
    for name, event in TEST_EVENTS.items():
        print(f"\n{'='*60}")
        print(f"Testing: {name}")
        print(f"{'='*60}")
        
        try:
            result = await orch.investigate(event, source="test")
            
            triage = result.get("triage", {})
            verification = result.get("verification", {})
            report = result.get("report", {})
            status = result.get("status", "unknown")
            agent_results = result.get("agent_results", [])
            
            log_type = triage.get("log_type", "?")
            classifier = triage.get("classifier_used", "?")
            is_attack = triage.get("is_attack", False)
            category = triage.get("category", "?")
            confidence = triage.get("confidence", 0)
            severity = triage.get("severity", "?")
            priority = triage.get("priority", "?")
            mitre_t = triage.get("mitre_tactic", "?")
            mitre_tech = triage.get("mitre_technique", "?")
            matched = triage.get("matched_rules", [])
            
            print(f"  Status:     {status}")
            print(f"  Log type:   {log_type} (classifier: {classifier})")
            print(f"  Attack:     {is_attack}")
            print(f"  Category:   {category} ({confidence:.1%})")
            print(f"  Severity:   {severity} / Priority: {priority}")
            print(f"  MITRE:      {mitre_t} / {mitre_tech}")
            if matched:
                print(f"  Rules:      {matched[:3]}")
            
            if verification:
                verdict = verification.get("verdict", "?")
                adj_conf = verification.get("adjusted_confidence", 0)
                print(f"  Verdict:    {verdict} (adj. confidence: {adj_conf:.1%})")
            
            if report:
                print(f"  Report:     {report.get('title', '?')[:60]}")
                recs = report.get("recommendations", [])
                print(f"  Recs:       {len(recs)} recommendations")
            
            agent_names = [ar.get("agent_name", "?") for ar in agent_results]
            agent_times = [ar.get("duration_ms", 0) for ar in agent_results]
            print(f"  Agents:     {' → '.join(agent_names)}")
            print(f"  Times:      {' / '.join(f'{t:.0f}ms' for t in agent_times)}")
            
            # Validate that non-network events used rule-based classifiers
            if name.startswith("sysmon"):
                assert log_type == "sysmon", f"Expected sysmon, got {log_type}"
                assert classifier == "sysmon_rules"
            elif name.startswith("winsec"):
                assert log_type == "windows_security", f"Expected windows_security, got {log_type}"
                assert classifier == "winsec_rules"
            elif name.startswith("auth"):
                assert log_type == "auth", f"Expected auth, got {log_type}"
                assert classifier == "auth_rules"
            elif name.startswith("firewall"):
                assert log_type == "firewall", f"Expected firewall, got {log_type}"
                assert classifier == "fw_rules"
            elif name.startswith("generic"):
                assert log_type == "generic", f"Expected generic, got {log_type}"
                assert classifier == "heuristic"
            
            passed += 1
            print(f"  ✓ PASSED")
            
        except Exception as e:
            failed += 1
            print(f"  ✗ FAILED: {type(e).__name__}: {e}")
    
    print(f"\n{'='*60}")
    print(f"RESULTS: {passed}/{passed+failed} passed, {failed} failed")
    print(f"{'='*60}")
    
    if failed:
        sys.exit(1)


asyncio.run(main())
