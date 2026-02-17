"""
Reporter Agent
===============
Generates structured investigation reports from the full agent pipeline output.

Responsibilities:
1. Synthesise triage, hunt, and verification data into a coherent report
2. Map all findings to MITRE ATT&CK framework
3. Build a readable timeline
4. Generate actionable recommendations
5. Produce executive summary for SOC leads
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from .base import (
    BaseAgent,
    InvestigationContext,
    ReportData,
    ReportSection,
)

# ── MITRE ATT&CK Tactic descriptions ────────────────────────────────────────

MITRE_TACTIC_DESC = {
    "reconnaissance": "Gathering information to plan future operations",
    "resource-development": "Establishing resources to support operations",
    "initial-access": "Trying to get into the network",
    "execution": "Running malicious code",
    "persistence": "Maintaining foothold",
    "privilege-escalation": "Gaining higher-level permissions",
    "defense-evasion": "Avoiding detection",
    "credential-access": "Stealing credentials",
    "discovery": "Exploring the environment",
    "lateral-movement": "Moving through the network",
    "collection": "Gathering data of interest",
    "command-and-control": "Communicating with compromised systems",
    "exfiltration": "Stealing data",
    "impact": "Manipulating, interrupting, or destroying systems and data",
}

MITRE_TECHNIQUE_DB = {
    # NSL-KDD ML categories
    "T1499": {"name": "Endpoint Denial of Service", "url": "https://attack.mitre.org/techniques/T1499/"},
    "T1498": {"name": "Network Denial of Service", "url": "https://attack.mitre.org/techniques/T1498/"},
    "T1046": {"name": "Network Service Discovery", "url": "https://attack.mitre.org/techniques/T1046/"},
    "T1595": {"name": "Active Scanning", "url": "https://attack.mitre.org/techniques/T1595/"},
    "T1133": {"name": "External Remote Services", "url": "https://attack.mitre.org/techniques/T1133/"},
    "T1110": {"name": "Brute Force", "url": "https://attack.mitre.org/techniques/T1110/"},
    "T1068": {"name": "Exploitation for Privilege Escalation", "url": "https://attack.mitre.org/techniques/T1068/"},
    "T1059": {"name": "Command and Scripting Interpreter", "url": "https://attack.mitre.org/techniques/T1059/"},
    "T1078": {"name": "Valid Accounts", "url": "https://attack.mitre.org/techniques/T1078/"},
    "T1548": {"name": "Abuse Elevation Control Mechanism", "url": "https://attack.mitre.org/techniques/T1548/"},
    "T1041": {"name": "Exfiltration Over C2 Channel", "url": "https://attack.mitre.org/techniques/T1041/"},
    "T1021": {"name": "Remote Services", "url": "https://attack.mitre.org/techniques/T1021/"},
    "T1071.004": {"name": "Application Layer Protocol: DNS", "url": "https://attack.mitre.org/techniques/T1071/004/"},
    "T1562": {"name": "Impair Defenses", "url": "https://attack.mitre.org/techniques/T1562/"},
    # Sysmon/Windows Security classifier techniques
    "T1059.001": {"name": "PowerShell", "url": "https://attack.mitre.org/techniques/T1059/001/"},
    "T1218": {"name": "System Binary Proxy Execution", "url": "https://attack.mitre.org/techniques/T1218/"},
    "T1055": {"name": "Process Injection", "url": "https://attack.mitre.org/techniques/T1055/"},
    "T1003": {"name": "OS Credential Dumping", "url": "https://attack.mitre.org/techniques/T1003/"},
    "T1003.001": {"name": "LSASS Memory", "url": "https://attack.mitre.org/techniques/T1003/001/"},
    "T1547": {"name": "Boot or Logon Autostart Execution", "url": "https://attack.mitre.org/techniques/T1547/"},
    "T1547.001": {"name": "Registry Run Keys / Startup Folder", "url": "https://attack.mitre.org/techniques/T1547/001/"},
    "T1562.001": {"name": "Disable or Modify Tools", "url": "https://attack.mitre.org/techniques/T1562/001/"},
    "T1071": {"name": "Application Layer Protocol", "url": "https://attack.mitre.org/techniques/T1071/"},
    "T1136": {"name": "Create Account", "url": "https://attack.mitre.org/techniques/T1136/"},
    "T1136.001": {"name": "Local Account", "url": "https://attack.mitre.org/techniques/T1136/001/"},
    "T1110.001": {"name": "Password Guessing", "url": "https://attack.mitre.org/techniques/T1110/001/"},
    "T1070": {"name": "Indicator Removal", "url": "https://attack.mitre.org/techniques/T1070/"},
    "T1070.001": {"name": "Clear Windows Event Logs", "url": "https://attack.mitre.org/techniques/T1070/001/"},
    "T1134": {"name": "Access Token Manipulation", "url": "https://attack.mitre.org/techniques/T1134/"},
    "T1543.003": {"name": "Windows Service", "url": "https://attack.mitre.org/techniques/T1543/003/"},
    "T1546.003": {"name": "WMI Event Subscription", "url": "https://attack.mitre.org/techniques/T1546/003/"},
    "T1564.004": {"name": "NTFS File Attributes", "url": "https://attack.mitre.org/techniques/T1564/004/"},
    "T1505.003": {"name": "Web Shell", "url": "https://attack.mitre.org/techniques/T1505/003/"},
    "T1053.005": {"name": "Scheduled Task", "url": "https://attack.mitre.org/techniques/T1053/005/"},
    "T1571": {"name": "Non-Standard Port", "url": "https://attack.mitre.org/techniques/T1571/"},
    "T1098": {"name": "Account Manipulation", "url": "https://attack.mitre.org/techniques/T1098/"},
    "T1036": {"name": "Masquerading", "url": "https://attack.mitre.org/techniques/T1036/"},
    # Auth classifier
    "T1021.004": {"name": "SSH", "url": "https://attack.mitre.org/techniques/T1021/004/"},
    # Generic
    "T1190": {"name": "Exploit Public-Facing Application", "url": "https://attack.mitre.org/techniques/T1190/"},
    "T1105": {"name": "Ingress Tool Transfer", "url": "https://attack.mitre.org/techniques/T1105/"},
}

# ── Recommendation templates ─────────────────────────────────────────────────

CATEGORY_RECOMMENDATIONS = {
    # NSL-KDD ML categories
    "DoS": [
        "Enable rate-limiting on affected services to mitigate ongoing flood",
        "Deploy upstream DDoS mitigation (WAF/CDN scrubbing)",
        "Block source IPs at perimeter firewall if attack is single-source",
        "Monitor affected services for degraded performance",
        "Review auto-scaling thresholds for impacted infrastructure",
    ],
    "Probe": [
        "Block source IPs performing reconnaissance at the perimeter",
        "Review firewall rules to limit exposed services",
        "Audit open ports on target hosts — close unnecessary services",
        "Enable network segmentation to limit probe reach",
        "Correlate with threat intelligence for known scanner infrastructure",
    ],
    "R2L": [
        "Reset credentials for affected user accounts immediately",
        "Enable multi-factor authentication (MFA) on targeted services",
        "Review SSH/RDP access logs for unauthorized sessions",
        "Block source IPs and add to deny list",
        "Audit file integrity on accessed systems",
    ],
    "U2R": [
        "Isolate affected host(s) from the network immediately",
        "Audit all processes running with elevated privileges",
        "Check for unauthorized user accounts or privilege changes",
        "Run full malware scan on affected systems",
        "Review sudo/admin logs for unauthorized escalation",
        "Patch any exploited vulnerabilities",
    ],
    # Sysmon / process-based categories
    "Execution": [
        "Investigate the process tree for the suspicious execution",
        "Check if the parent process is legitimate and expected",
        "Review command-line arguments for encoded/obfuscated payloads",
        "Block the hash of the suspicious binary across endpoints",
        "Collect memory dump of the suspicious process for forensics",
    ],
    "Persistence": [
        "Remove unauthorized registry Run keys or startup entries",
        "Review scheduled tasks and WMI subscriptions",
        "Audit service installations for unauthorized entries",
        "Check for web shells in publicly accessible directories",
        "Review autostart locations across all user profiles",
    ],
    "Defense Evasion": [
        "Verify integrity of security tools and logging infrastructure",
        "Check for disabled antivirus or EDR agents",
        "Review audit policy changes for unauthorized modifications",
        "Scan for unsigned drivers or tampered system files",
        "Validate that security event logs are not being cleared",
    ],
    "Credential Access": [
        "Reset passwords for all potentially compromised accounts",
        "Enable MFA on all privileged accounts immediately",
        "Review LSASS access patterns for credential dumping",
        "Check for Mimikatz artifacts and known credential tools",
        "Rotate service account credentials and API keys",
    ],
    "Lateral Movement": [
        "Isolate affected hosts to prevent further lateral spread",
        "Review remote logon events across the domain",
        "Check for PsExec, WMI, and WinRM usage patterns",
        "Validate network segmentation controls",
        "Audit admin share access (C$, ADMIN$) across hosts",
    ],
    "Brute Force": [
        "Enable account lockout policies if not configured",
        "Block source IPs at the authentication gateway",
        "Reset credentials for any successfully compromised accounts",
        "Implement fail2ban or equivalent rate-limiting",
        "Review logs for any successful logon after the brute-force attempts",
    ],
    "Privilege Escalation": [
        "Audit sudo configuration and sudoers file",
        "Review recent privilege escalation events",
        "Check for unauthorized SUID/SGID binaries (Linux)",
        "Verify UAC settings and token integrity (Windows)",
        "Patch known local privilege escalation vulnerabilities",
    ],
    "Command and Control": [
        "Block identified C2 IP addresses and domains at the firewall",
        "Review DNS logs for DGA or tunnelling patterns",
        "Isolate affected endpoints from the network",
        "Capture network traffic for C2 protocol analysis",
        "Check for beaconing behaviour in proxy/firewall logs",
    ],
    "Account Manipulation": [
        "Review recently created or modified user accounts",
        "Audit group membership changes, especially admin groups",
        "Verify that account changes were authorized via change management",
        "Check for shadow admin accounts or hidden privileges",
        "Enable alerting on all account creation/modification events",
    ],
    "Audit Tampering": [
        "Investigate who cleared the security event logs",
        "Restore audit logs from backup or SIEM",
        "Review audit policy changes for unauthorized modifications",
        "Enable tamper protection on logging infrastructure",
        "Escalate immediately — log clearing often indicates active compromise",
    ],
    "Suspicious Process": [
        "Investigate the full process execution chain",
        "Review the binary reputation and signing status",
        "Check for living-off-the-land binary (LOLBIN) abuse",
        "Collect the binary for sandbox analysis",
        "Review similar executions across the fleet for scope",
    ],
    "Firewall Evasion": [
        "Review and tighten outbound firewall rules",
        "Block identified non-standard port communications",
        "Monitor for additional C2 traffic on unusual ports",
        "Review endpoint for malware communicating on detected ports",
        "Correlate with threat intel for known malware port usage",
    ],
    "Suspicious Auth": [
        "Review authentication source and verify legitimacy",
        "Check for credential stuffing indicators",
        "Review geographic/IP patterns for anomalous logons",
        "Enforce step-up authentication for suspicious sessions",
        "Monitor the account for further suspicious activity",
    ],
}

VERDICT_RECOMMENDATIONS = {
    "true_positive": [
        "Initiate formal incident response procedure",
        "Preserve forensic evidence (memory dump, disk image)",
        "Notify security operations lead per escalation policy",
    ],
    "false_positive": [
        "Document this pattern to improve future ML training data",
        "Consider adding allowlist rule for this traffic signature",
        "Review classifier performance for this event category",
    ],
    "suspicious": [
        "Assign to SOC analyst for manual investigation",
        "Set up continuous monitoring on affected assets for 24 hours",
        "Collect additional evidence before making final determination",
    ],
    "inconclusive": [
        "Continue passive monitoring — do not dismiss",
        "Cross-reference with external threat feeds",
        "Escalate if additional suspicious activity is observed",
    ],
}


class ReporterAgent(BaseAgent):
    """
    Generates structured investigation reports from the pipeline output.
    """

    name = "Reporter Agent"
    description = "Generates investigation reports with MITRE mapping and recommendations"

    def __init__(self):
        super().__init__()

    def _build_executive_summary(self, ctx: InvestigationContext) -> str:
        """One-paragraph executive summary for SOC leads."""
        triage = ctx.triage
        verification = ctx.verification
        hunt = ctx.hunt

        if not triage or not triage.is_attack:
            return (
                f"Investigation {ctx.investigation_id}: Event analysed and classified as "
                f"benign traffic with {triage.confidence:.1%} confidence. "
                f"No further action required."
            )

        parts = [
            f"Investigation {ctx.investigation_id}: ",
            f"A {triage.severity.upper()} severity {triage.category} alert was detected "
            f"on a {triage.log_type} event with {triage.confidence:.1%} confidence "
            f"(classifier: {triage.classifier_used}). ",
        ]

        if verification:
            parts.append(
                f"After verification, the finding was assessed as "
                f"{verification.verdict.upper().replace('_', ' ')} "
                f"(adjusted confidence: {verification.adjusted_confidence:.1%}). "
            )

        if hunt and hunt.correlated_events:
            parts.append(
                f"Investigation uncovered {len(hunt.correlated_events)} correlated events "
                f"across {len(hunt.affected_hosts)} host(s) and {len(hunt.affected_ips)} IP(s). "
            )

        if hunt and hunt.attack_chain:
            parts.append(
                f"Attack chain spans {len(hunt.attack_chain)} steps over "
                f"{hunt.temporal_window_sec:.0f} seconds. "
            )

        if hunt and hunt.mitre_tactics:
            parts.append(
                f"MITRE ATT&CK mapping: {', '.join(hunt.mitre_tactics)}. "
            )

        parts.append(f"Priority: {triage.priority}.")

        return "".join(parts)

    def _build_triage_section(self, ctx: InvestigationContext) -> ReportSection:
        triage = ctx.triage
        if not triage:
            return ReportSection(title="Triage", content="No triage data available.")

        lines = [
            f"Classification: {'ATTACK' if triage.is_attack else 'BENIGN'}",
            f"Log Type: {triage.log_type}",
            f"Classifier: {triage.classifier_used}",
            f"Category: {triage.category} ({triage.clif_category})",
            f"Confidence: {triage.confidence:.1%}",
            f"Category confidence: {triage.category_confidence:.1%}",
            f"Severity: {triage.severity.upper()}",
            f"Priority: {triage.priority}",
            f"MITRE Tactic: {triage.mitre_tactic or 'N/A'}",
            f"MITRE Technique: {triage.mitre_technique or 'N/A'}",
            "",
            f"Explanation: {triage.explanation}",
        ]

        if triage.matched_rules:
            lines.append("")
            lines.append(f"Matched Rules ({len(triage.matched_rules)}):")
            for rule in triage.matched_rules:
                lines.append(f"  • {rule}")

        if triage.multi_probs:
            lines.append("")
            lines.append("Class Probabilities:")
            for cls, prob in sorted(triage.multi_probs.items(), key=lambda x: -x[1]):
                bar = "█" * int(prob * 20) + "░" * (20 - int(prob * 20))
                lines.append(f"  {cls:8s} {bar} {prob:.1%}")

        return ReportSection(title="Triage Analysis", content="\n".join(lines))

    def _build_hunt_section(self, ctx: InvestigationContext) -> ReportSection:
        hunt = ctx.hunt
        if not hunt or not hunt.correlated_events:
            return ReportSection(
                title="Investigation",
                content="No correlated events found — single-event alert.",
            )

        lines = [
            f"Correlated Events: {len(hunt.correlated_events)}",
            f"  - ClickHouse matches: {hunt.clickhouse_matches}",
            f"  - Semantic matches: {hunt.semantic_matches}",
            f"Temporal Window: {hunt.temporal_window_sec:.0f} seconds",
            f"Affected Hosts: {', '.join(hunt.affected_hosts) or 'N/A'}",
            f"Affected IPs: {', '.join(hunt.affected_ips) or 'N/A'}",
            f"Affected Users: {', '.join(hunt.affected_users) or 'N/A'}",
            f"MITRE Tactics: {', '.join(hunt.mitre_tactics) or 'N/A'}",
            f"MITRE Techniques: {', '.join(hunt.mitre_techniques) or 'N/A'}",
        ]

        if hunt.attack_chain:
            lines.append("")
            lines.append(f"Attack Chain ({len(hunt.attack_chain)} steps):")
            for i, step in enumerate(hunt.attack_chain[:20], 1):
                ts = step.timestamp[:19] if step.timestamp else "?"
                lines.append(f"  [{i:2d}] {ts}  {step.action[:100]}")
                if step.mitre_tactic:
                    lines.append(f"       MITRE: {step.mitre_tactic}/{step.mitre_technique}")

        return ReportSection(title="Investigation Details", content="\n".join(lines))

    def _build_verification_section(self, ctx: InvestigationContext) -> ReportSection:
        v = ctx.verification
        if not v:
            return ReportSection(
                title="Verification",
                content="Verification not performed.",
            )

        lines = [
            f"Verdict: {v.verdict.upper().replace('_', ' ')}",
            f"Adjusted Confidence: {v.adjusted_confidence:.1%}",
            f"False Positive Score: {v.false_positive_score:.1%}",
            f"Historical Similar Events (24h): {v.historical_similar_count}",
            "",
            "Checks Performed:",
        ]
        for check in v.checks_performed:
            lines.append(f"  • {check}")

        if v.checks_passed:
            lines.append(f"\nPassed ({len(v.checks_passed)}):")
            for c in v.checks_passed:
                lines.append(f"  ✓ {c}")
        if v.checks_failed:
            lines.append(f"\nFailed ({len(v.checks_failed)}):")
            for c in v.checks_failed:
                lines.append(f"  ✗ {c}")

        lines.append(f"\nEvidence: {v.evidence_summary}")
        lines.append(f"\nRecommendation: {v.recommendation}")

        return ReportSection(title="Verification Results", content="\n".join(lines))

    def _build_mitre_mapping(self, ctx: InvestigationContext) -> List[Dict[str, str]]:
        hunt = ctx.hunt
        triage = ctx.triage
        mapping: List[Dict[str, str]] = []
        seen: set = set()

        tactics = list(hunt.mitre_tactics) if hunt else []
        techniques = list(hunt.mitre_techniques) if hunt else []

        if triage and triage.mitre_tactic and triage.mitre_tactic not in tactics:
            tactics.insert(0, triage.mitre_tactic)
        if triage and triage.mitre_technique and triage.mitre_technique not in techniques:
            techniques.insert(0, triage.mitre_technique)

        for tech in techniques:
            if tech in seen:
                continue
            seen.add(tech)
            info = MITRE_TECHNIQUE_DB.get(tech, {})
            mapping.append({
                "technique_id": tech,
                "technique_name": info.get("name", tech),
                "url": info.get("url", f"https://attack.mitre.org/techniques/{tech}/"),
            })

        for tactic in tactics:
            desc = MITRE_TACTIC_DESC.get(tactic, "")
            # Add as enrichment to existing entries
            for m in mapping:
                if "tactic" not in m:
                    m["tactic"] = tactic
                    m["tactic_description"] = desc
                    break

        return mapping

    def _build_recommendations(self, ctx: InvestigationContext) -> List[str]:
        triage = ctx.triage
        verification = ctx.verification
        recs: List[str] = []

        # Category-specific
        if triage and triage.is_attack:
            cat_recs = CATEGORY_RECOMMENDATIONS.get(triage.category, [])
            recs.extend(cat_recs)

        # Verdict-specific
        if verification:
            verdict_recs = VERDICT_RECOMMENDATIONS.get(verification.verdict, [])
            recs.extend(verdict_recs)

        # Deduplicate while preserving order
        seen: set = set()
        unique: List[str] = []
        for r in recs:
            if r not in seen:
                seen.add(r)
                unique.append(r)

        return unique

    def _build_timeline(self, ctx: InvestigationContext) -> List[Dict[str, str]]:
        timeline: List[Dict[str, str]] = []

        # Agent execution log
        for ar in ctx.agent_results:
            timeline.append({
                "timestamp": ar.started_at,
                "event": f"{ar.agent_name} started",
                "details": f"Status: {ar.status.value}",
            })
            timeline.append({
                "timestamp": ar.finished_at,
                "event": f"{ar.agent_name} completed",
                "details": f"Duration: {ar.duration_ms:.0f}ms",
            })

        # Attack chain events
        if ctx.hunt and ctx.hunt.attack_chain:
            for step in ctx.hunt.attack_chain[:20]:
                timeline.append({
                    "timestamp": step.timestamp,
                    "event": step.action[:120],
                    "details": f"{step.source} → {step.target}" if step.source else "",
                })

        # Sort by timestamp
        timeline.sort(key=lambda t: t.get("timestamp", ""))
        return timeline

    # ── Main execution ───────────────────────────────────────────────────

    async def _execute(self, ctx: InvestigationContext) -> InvestigationContext:
        triage = ctx.triage
        if not triage:
            raise ValueError("No triage data — run Triage Agent first")

        # ── Build report sections ────────────────────────────────────
        sections = [
            self._build_triage_section(ctx),
            self._build_hunt_section(ctx),
            self._build_verification_section(ctx),
        ]

        # ── MITRE mapping ────────────────────────────────────────────
        mitre_mapping = self._build_mitre_mapping(ctx)
        if mitre_mapping:
            mitre_lines = ["MITRE ATT&CK Mapping:", ""]
            for m in mitre_mapping:
                mitre_lines.append(
                    f"  {m['technique_id']} — {m['technique_name']}"
                )
                if m.get("tactic"):
                    mitre_lines.append(
                        f"    Tactic: {m['tactic']} ({m.get('tactic_description', '')})"
                    )
                mitre_lines.append(f"    Reference: {m['url']}")
            sections.append(ReportSection(
                title="MITRE ATT&CK Framework",
                content="\n".join(mitre_lines),
            ))

        # ── Recommendations ──────────────────────────────────────────
        recommendations = self._build_recommendations(ctx)

        # ── Affected assets ──────────────────────────────────────────
        affected_assets: Dict[str, List[str]] = {}
        if ctx.hunt:
            if ctx.hunt.affected_hosts:
                affected_assets["hosts"] = ctx.hunt.affected_hosts
            if ctx.hunt.affected_ips:
                affected_assets["ips"] = ctx.hunt.affected_ips
            if ctx.hunt.affected_users:
                affected_assets["users"] = ctx.hunt.affected_users

        # ── Timeline ─────────────────────────────────────────────────
        timeline = self._build_timeline(ctx)

        # ── Executive summary ────────────────────────────────────────
        executive_summary = self._build_executive_summary(ctx)

        # ── Build final report ───────────────────────────────────────
        verdict = ctx.verification.verdict if ctx.verification else "pending"
        report = ReportData(
            investigation_id=ctx.investigation_id,
            title=f"{triage.category} Attack Investigation — {ctx.investigation_id}",
            executive_summary=executive_summary,
            severity=triage.severity,
            priority=triage.priority,
            verdict=verdict,
            sections=sections,
            mitre_mapping=mitre_mapping,
            recommendations=recommendations,
            affected_assets=affected_assets,
            timeline=timeline,
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

        ctx.report = report
        ctx.status = "reported"

        # ── Log action ───────────────────────────────────────────────
        self._last_action = (
            f"Generated investigation report for {ctx.investigation_id} — "
            f"{triage.category} ({verdict.replace('_', ' ').upper()}). "
            f"{len(sections)} sections, {len(recommendations)} recommendations, "
            f"{len(mitre_mapping)} MITRE techniques mapped."
        )

        return ctx
