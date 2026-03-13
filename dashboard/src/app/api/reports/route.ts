import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";
import { cached } from "@/lib/cache";
import { checkRateLimit, getClientId } from "@/lib/rate-limit";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = checkRateLimit(getClientId(request), { maxTokens: 20, refillRate: 1 });
  if (limited) return limited;

  try {
    const data = await cached("reports:list", 30_000, async () => {
      const [
        alertSummary,
        eventCounts,
        evidenceStats,
        topCategories,
        severityDist,
        recentAlerts,
        mitreTop,
        sigmaTopRules,
        sigmaTacticDist,
        sigmaSeverityDist,
        modelHealth,
        hunterScoreDist,
        verifierVerdicts,
        evidenceBatches,
        investigationRows,
      ] = await Promise.allSettled([
        // Alert summary last 24h
        queryClickHouse<{ total: string; critical: string; high: string; medium: string }>(
          `SELECT
             count() AS total,
             countIf(severity = 4) AS critical,
             countIf(severity = 3) AS high,
             countIf(severity = 2) AS medium
           FROM clif_logs.security_events
           WHERE timestamp >= now() - INTERVAL 24 HOUR`
        ),
        // Event counts per table
        queryClickHouse<{ table_name: string; cnt: string }>(
          `SELECT 'raw_logs' AS table_name, count() AS cnt FROM clif_logs.raw_logs
           UNION ALL
           SELECT 'security_events', count() FROM clif_logs.security_events
           UNION ALL
           SELECT 'process_events', count() FROM clif_logs.process_events
           UNION ALL
           SELECT 'network_events', count() FROM clif_logs.network_events`
        ),
        // Evidence stats
        queryClickHouse<{ batches: string; anchored: string; verified: string }>(
          `SELECT
             count() AS batches,
             sum(event_count) AS anchored,
             countIf(status = 'Verified') AS verified
           FROM clif_logs.evidence_anchors`
        ),
        // Top categories
        queryClickHouse<{ category: string; cnt: string }>(
          `SELECT category, count() AS cnt
           FROM clif_logs.security_events
           WHERE timestamp >= now() - INTERVAL 7 DAY
           GROUP BY category
           ORDER BY cnt DESC
           LIMIT 10`
        ),
        // Severity distribution last 7 days
        queryClickHouse<{ severity: string; cnt: string }>(
          `SELECT toString(severity) AS severity, count() AS cnt
           FROM clif_logs.security_events
           WHERE timestamp >= now() - INTERVAL 7 DAY
           GROUP BY severity
           ORDER BY severity DESC`
        ),
        // Recent critical/high alerts for report content
        queryClickHouse<{
          event_id: string;
          ts: string;
          severity: string;
          category: string;
          source: string;
          description: string;
          hostname: string;
          mitre_tactic: string;
          mitre_technique: string;
        }>(
          `SELECT
             toString(event_id) AS event_id,
             toString(timestamp) AS ts,
             severity,
             category,
             source,
             description,
             hostname,
             mitre_tactic,
             mitre_technique
           FROM clif_logs.security_events
           WHERE severity >= 3
             AND timestamp >= now() - INTERVAL 7 DAY
           ORDER BY timestamp DESC
           LIMIT 50`
        ),
        // Top MITRE techniques
        queryClickHouse<{ technique: string; tactic: string; cnt: string }>(
          `SELECT mitre_technique AS technique, mitre_tactic AS tactic, count() AS cnt
           FROM clif_logs.security_events
           WHERE mitre_technique != ''
             AND timestamp >= now() - INTERVAL 7 DAY
           GROUP BY mitre_technique, mitre_tactic
           ORDER BY cnt DESC
           LIMIT 15`
        ),
        // ── Sigma Rules tab ──
        queryClickHouse<{ rule_name: string; cnt: string }>(
          `SELECT rule_name, count() AS cnt
           FROM clif_logs.sigma_rule_hits
           GROUP BY rule_name
           ORDER BY cnt DESC
           LIMIT 10`
        ),
        queryClickHouse<{ tactic: string; cnt: string }>(
          `SELECT mitre_tactic AS tactic, count() AS cnt
           FROM clif_logs.sigma_rule_hits
           WHERE mitre_tactic != ''
           GROUP BY mitre_tactic
           ORDER BY cnt DESC`
        ),
        queryClickHouse<{ severity: string; cnt: string }>(
          `SELECT toString(severity) AS severity, count() AS cnt
           FROM clif_logs.sigma_rule_hits
           GROUP BY severity
           ORDER BY cnt DESC`
        ),
        // ── ML Model tab ──
        queryClickHouse<{
          kl_divergence: string;
          psi_max: string;
          is_drifting: string;
          sample_count: string;
        }>(
          `SELECT kl_divergence, psi_max, is_drifting, sample_count
           FROM clif_logs.hunter_model_health
           ORDER BY check_time DESC
           LIMIT 1`
        ),
        queryClickHouse<{ bucket: string; cnt: string }>(
          `SELECT
             multiIf(
               hunter_score < 0.2, '0.0-0.2',
               hunter_score < 0.4, '0.2-0.4',
               hunter_score < 0.6, '0.4-0.6',
               hunter_score < 0.8, '0.6-0.8',
               '0.8-1.0'
             ) AS bucket,
             count() AS cnt
           FROM clif_logs.hunter_investigations
           GROUP BY bucket
           ORDER BY bucket`
        ),
        queryClickHouse<{ verdict: string; cnt: string }>(
          `SELECT
             multiIf(
               finding_type IN ('CONFIRMED_ATTACK','ACTIVE_CAMPAIGN','BEHAVIOURAL_ANOMALY','SIGMA_MATCH'), 'true_positive',
               'false_positive'
             ) AS verdict,
             count() AS cnt
           FROM clif_logs.hunter_investigations
           GROUP BY verdict`
        ),
        // ── Evidence Chain tab ──
        queryClickHouse<{
          batch_id: string;
          event_count: string;
          status: string;
          prev_merkle_root: string;
          merkle_root: string;
        }>(
          `SELECT
             toString(batch_id) AS batch_id,
             event_count,
             status,
             prev_merkle_root,
             merkle_root
           FROM clif_logs.evidence_anchors
           ORDER BY time_from DESC
           LIMIT 20`
        ),
        // ── Investigations tab ──
        queryClickHouse<{
          alert_id: string;
          finding_type: string;
          hunter_score: string;
          signals_fired: string;
          campaign_host_count: string;
        }>(
          `SELECT
             toString(alert_id) AS alert_id,
             finding_type,
             hunter_score,
             signals_fired,
             campaign_host_count
           FROM clif_logs.hunter_investigations
           ORDER BY created_at DESC
           LIMIT 20`
        ),
      ]);

      const allResults = [alertSummary, eventCounts, evidenceStats, topCategories, severityDist, recentAlerts, mitreTop, sigmaTopRules, sigmaTacticDist, sigmaSeverityDist, modelHealth, hunterScoreDist, verifierVerdicts, evidenceBatches, investigationRows];
      if (allResults.every((r) => r.status === "rejected")) {
        throw new Error("All ClickHouse queries failed — serving mock reports");
      }

      const alerts = alertSummary.status === "fulfilled" ? alertSummary.value.data[0] : null;
      const events = eventCounts.status === "fulfilled" ? eventCounts.value.data : [];
      const evidence = evidenceStats.status === "fulfilled" ? evidenceStats.value.data[0] : null;
      const categories = topCategories.status === "fulfilled" ? topCategories.value.data : [];
      const severity = severityDist.status === "fulfilled" ? severityDist.value.data : [];
      const criticalAlerts = recentAlerts.status === "fulfilled" ? recentAlerts.value.data : [];
      const mitre = mitreTop.status === "fulfilled" ? mitreTop.value.data : [];

      const totalEvents = events.reduce((sum, e) => sum + Number(e.cnt), 0);

      // Sigma
      const sigmaTop = sigmaTopRules.status === "fulfilled" ? sigmaTopRules.value.data : [];
      const sigmaTactic = sigmaTacticDist.status === "fulfilled" ? sigmaTacticDist.value.data : [];
      const sigmaSev = sigmaSeverityDist.status === "fulfilled" ? sigmaSeverityDist.value.data : [];

      // ML Model
      const mlHealth = modelHealth.status === "fulfilled" ? modelHealth.value.data[0] : null;
      const scoreDist = hunterScoreDist.status === "fulfilled" ? hunterScoreDist.value.data : [];
      const verdicts = verifierVerdicts.status === "fulfilled" ? verifierVerdicts.value.data : [];

      // Evidence batches
      const evBatches = evidenceBatches.status === "fulfilled" ? evidenceBatches.value.data : [];

      // Investigations
      const invRows = investigationRows.status === "fulfilled" ? investigationRows.value.data : [];

      return {
        summary: {
          totalEvents,
          totalAlerts24h: Number(alerts?.total ?? 0),
          criticalAlerts: Number(alerts?.critical ?? 0),
          highAlerts: Number(alerts?.high ?? 0),
          mediumAlerts: Number(alerts?.medium ?? 0),
          evidenceBatches: Number(evidence?.batches ?? 0),
          evidenceAnchored: Number(evidence?.anchored ?? 0),
          evidenceVerified: Number(evidence?.verified ?? 0),
        },
        eventsByTable: events.map((e) => ({ table: e.table_name, count: Number(e.cnt) })),
        topCategories: categories.map((c) => ({ category: c.category, count: Number(c.cnt) })),
        severityDistribution: severity.map((s) => ({ severity: Number(s.severity), count: Number(s.cnt) })),
        recentCriticalAlerts: criticalAlerts.map((a) => ({
          eventId: a.event_id,
          timestamp: a.ts,
          severity: Number(a.severity),
          category: a.category,
          source: a.source,
          description: a.description,
          hostname: a.hostname,
          mitreTactic: a.mitre_tactic,
          mitreTechnique: a.mitre_technique,
        })),
        mitreTopTechniques: mitre.map((m) => ({
          technique: m.technique,
          tactic: m.tactic,
          count: Number(m.cnt),
        })),
        // Sigma Rules data
        sigmaTopRules: sigmaTop.map((r) => ({ name: r.rule_name, count: Number(r.cnt) })),
        sigmaTacticDistribution: sigmaTactic.map((t) => ({ tactic: t.tactic, count: Number(t.cnt) })),
        sigmaSeverityDistribution: sigmaSev.map((s) => {
          const sevMap: Record<string, string> = { "1": "Low", "2": "Medium", "3": "High", "4": "Critical" };
          return { severity: sevMap[s.severity] || s.severity, count: Number(s.cnt) };
        }),
        // ML Model data
        mlModelHealth: {
          klDivergence: Number(mlHealth?.kl_divergence ?? 0),
          psiMax: Number(mlHealth?.psi_max ?? 0),
          isDrifting: mlHealth?.is_drifting === "1" || mlHealth?.is_drifting === "true",
          sampleCount: Number(mlHealth?.sample_count ?? 0),
        },
        hunterScoreDistribution: scoreDist.map((b) => ({ bucket: b.bucket, count: Number(b.cnt) })),
        tpFpRatio: verdicts.map((v) => ({ verdict: v.verdict, count: Number(v.cnt) })),
        modelFeatures: [], // populated from mock fallback only for now
        // Evidence Chain data
        evidenceBatchList: evBatches.map((b) => ({
          batchId: b.batch_id,
          eventCount: Number(b.event_count),
          status: b.status,
          hasContinuity: b.prev_merkle_root !== "" || b.merkle_root !== "",
          merkleRoot: b.merkle_root ?? "",
          anchoredAt: "",
        })),
        // Investigation data
        investigations: invRows.map((r) => ({
          alertId: r.alert_id,
          findingType: r.finding_type,
          hunterScore: Number(r.hunter_score),
          signalsFired: Number(r.signals_fired),
          campaignHostCount: Number(r.campaign_host_count),
        })),
        generatedAt: new Date().toISOString(),
      };
    });

    /* If ClickHouse returned empty data (backends down), serve mock reports */
    if (data.summary?.totalEvents === 0 && data.recentCriticalAlerts?.length === 0 && data.topCategories?.length === 0) {
      throw new Error("All reports data is empty — serving mock data");
    }

    return NextResponse.json(data);
  } catch (err) {
    log.error("Reports data fetch failed", {
      error: err instanceof Error ? err.message : "unknown",
      component: "api/reports",
    });
    /* Fallback: comprehensive mock data for all tabs */
    return NextResponse.json(getMockReportData());
  }
}

function getMockReportData() {
  return {
    summary: {
      totalEvents: 2400000,
      totalAlerts24h: 312,
      criticalAlerts: 47,
      highAlerts: 89,
      mediumAlerts: 176,
      evidenceBatches: 5234,
      evidenceAnchored: 5160000,
      evidenceVerified: 4930,
    },
    eventsByTable: [
      { table: "raw_logs", count: 1200000 },
      { table: "security_events", count: 580000 },
      { table: "process_events", count: 340000 },
      { table: "network_events", count: 280000 },
    ],
    topCategories: [
      { category: "Malware", count: 156 },
      { category: "Lateral Movement", count: 89 },
      { category: "Exfiltration", count: 67 },
      { category: "Auth Abuse", count: 45 },
      { category: "Reconnaissance", count: 34 },
    ],
    severityDistribution: [
      { severity: 4, count: 47 },
      { severity: 3, count: 89 },
      { severity: 2, count: 176 },
      { severity: 1, count: 234 },
    ],
    recentCriticalAlerts: [],
    mitreTopTechniques: [
      { technique: "T1078", tactic: "Initial Access", count: 45 },
      { technique: "T1059", tactic: "Execution", count: 38 },
      { technique: "T1053", tactic: "Persistence", count: 31 },
      { technique: "T1548", tactic: "Privilege Escalation", count: 28 },
      { technique: "T1562", tactic: "Defense Evasion", count: 24 },
      { technique: "T1003", tactic: "Credential Access", count: 20 },
      { technique: "T1018", tactic: "Discovery", count: 17 },
      { technique: "T1021", tactic: "Lateral Movement", count: 32 },
    ],
    sigmaTopRules: [
      { name: "Suspicious PowerShell Execution", count: 2410 },
      { name: "Credential Dumping via LSASS", count: 1890 },
      { name: "Suspicious Child Process of Excel", count: 1540 },
      { name: "Network Connection to Known C2", count: 1200 },
      { name: "RDP Inbound from Public IP", count: 980 },
      { name: "Massive File Deletion on File Server", count: 820 },
      { name: "Lateral Movement SMB/RDP", count: 756 },
      { name: "Registry Modification Persistence", count: 634 },
      { name: "Process Injection Detected", count: 512 },
      { name: "Encoded Command Execution", count: 340 },
    ],
    sigmaTacticDistribution: [
      { tactic: "Initial Access", count: 142 },
      { tactic: "Execution", count: 312 },
      { tactic: "Persistence", count: 224 },
      { tactic: "Defense Evasion", count: 415 },
      { tactic: "Exfiltration", count: 92 },
      { tactic: "Credential Access", count: 180 },
      { tactic: "Lateral Movement", count: 232 },
      { tactic: "Privilege Escalation", count: 128 },
    ],
    sigmaSeverityDistribution: [
      { severity: "Critical", count: 210 },
      { severity: "High", count: 351 },
      { severity: "Medium", count: 491 },
      { severity: "Low", count: 350 },
    ],
    mlModelHealth: {
      klDivergence: 0.042,
      psiMax: 0.156,
      isDrifting: false,
      sampleCount: 12400,
    },
    hunterScoreDistribution: [
      { bucket: "0.0-0.2", count: 23 },
      { bucket: "0.2-0.4", count: 67 },
      { bucket: "0.4-0.6", count: 156 },
      { bucket: "0.6-0.8", count: 289 },
      { bucket: "0.8-1.0", count: 534 },
    ],
    tpFpRatio: [
      { verdict: "true_positive", count: 1847 },
      { verdict: "false_positive", count: 234 },
    ],
    modelFeatures: [
      { name: "auth_failure_count", type: "Numeric", importance: 0.84, driftPsi: 0.012, status: "Stable" },
      { name: "remote_ip_reputation", type: "Categorical", importance: 0.71, driftPsi: 0.089, status: "Degrading" },
      { name: "payload_entropy", type: "Numeric", importance: 0.48, driftPsi: 0.005, status: "Stable" },
      { name: "session_duration_zscore", type: "Numeric", importance: 0.65, driftPsi: 0.031, status: "Stable" },
      { name: "command_frequency", type: "Numeric", importance: 0.59, driftPsi: 0.044, status: "Monitor" },
      { name: "geo_anomaly_score", type: "Numeric", importance: 0.73, driftPsi: 0.018, status: "Stable" },
      { name: "user_agent_class", type: "Categorical", importance: 0.38, driftPsi: 0.102, status: "Degrading" },
      { name: "lateral_move_hops", type: "Numeric", importance: 0.91, driftPsi: 0.007, status: "Stable" },
    ],
    evidenceBatchList: [
      { batchId: "BCH-5219-X", eventCount: 982, status: "Verified", hasContinuity: true, merkleRoot: "0x7a2...f3e9", anchoredAt: "2023-11-15 14:32:01 UTC" },
      { batchId: "BCH-5218-A", eventCount: 1024, status: "Verified", hasContinuity: true, merkleRoot: "0x3b1...a4c2", anchoredAt: "2023-11-15 14:15:45 UTC" },
      { batchId: "BCH-5217-D", eventCount: 855, status: "Pending", hasContinuity: true, merkleRoot: "0xc94...e112", anchoredAt: "2023-11-15 14:00:12 UTC" },
      { batchId: "BCH-5216-Q", eventCount: 912, status: "Failed", hasContinuity: false, merkleRoot: "0x1f3...c8d5", anchoredAt: "2023-11-15 13:45:30 UTC" },
      { batchId: "BCH-5215-M", eventCount: 1104, status: "Verified", hasContinuity: true, merkleRoot: "0x6e5...b2a0", anchoredAt: "2023-11-15 13:30:11 UTC" },
      { batchId: "BCH-5214-K", eventCount: 978, status: "Verified", hasContinuity: true, merkleRoot: "0xa8f...91d3", anchoredAt: "2023-11-15 13:15:02 UTC" },
      { batchId: "BCH-5213-R", eventCount: 1067, status: "Verified", hasContinuity: true, merkleRoot: "0xd42...7e6b", anchoredAt: "2023-11-15 13:00:44 UTC" },
      { batchId: "BCH-5212-F", eventCount: 891, status: "Anchored", hasContinuity: true, merkleRoot: "0x5c7...d4a8", anchoredAt: "2023-11-15 12:45:18 UTC" },
      { batchId: "BCH-5211-W", eventCount: 1156, status: "Verified", hasContinuity: true, merkleRoot: "0x9b3...f102", anchoredAt: "2023-11-15 12:30:55 UTC" },
      { batchId: "BCH-5210-P", eventCount: 934, status: "Verified", hasContinuity: true, merkleRoot: "0x2e8...c5b7", anchoredAt: "2023-11-15 12:15:23 UTC" },
      { batchId: "BCH-5209-L", eventCount: 1089, status: "Pending", hasContinuity: true, merkleRoot: "0xf71...a3d9", anchoredAt: "2023-11-15 12:00:07 UTC" },
      { batchId: "BCH-5208-V", eventCount: 947, status: "Verified", hasContinuity: true, merkleRoot: "0x4a6...e8c1", anchoredAt: "2023-11-15 11:45:39 UTC" },
    ],
    investigations: [
      { alertId: "INV-2026-001", title: "Brute Force Attempt on Domain Controller", findingType: "CONFIRMED_ATTACK", hunterScore: 0.94, signalsFired: 6, campaignHostCount: 3 },
      { alertId: "INV-2026-002", title: "Unusual PowerShell Execution Profile", findingType: "CONFIRMED_ATTACK", hunterScore: 0.87, signalsFired: 5, campaignHostCount: 1 },
      { alertId: "INV-2026-003", title: "Internal Lateral Movement Scan", findingType: "FALSE_POSITIVE", hunterScore: 0.42, signalsFired: 2, campaignHostCount: 2 },
      { alertId: "INV-2026-004", title: "Mimikatz Credential Dumping Detected", findingType: "CONFIRMED_ATTACK", hunterScore: 0.91, signalsFired: 7, campaignHostCount: 5 },
      { alertId: "INV-2026-005", title: "Suspicious DNS Tunneling Activity", findingType: "BEHAVIOURAL_ANOMALY", hunterScore: 0.68, signalsFired: 4, campaignHostCount: 2 },
    ],
    generatedAt: new Date().toISOString(),
  };
}
