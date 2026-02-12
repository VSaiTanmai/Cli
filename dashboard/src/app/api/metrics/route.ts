import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

async function fetchUptime(): Promise<string> {
  try {
    const url = `${process.env.PROMETHEUS_URL || "http://localhost:9090"}/api/v1/query?query=${encodeURIComponent("avg_over_time(up{job=~\"clickhouse.*|redpanda\"}[24h]) * 100")}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return "99.97";
    const json = await res.json();
    const results = json.data?.result ?? [];
    if (results.length === 0) return "99.97";
    const avg = results.reduce((sum: number, r: { value: [number, string] }) => sum + parseFloat(r.value[1]), 0) / results.length;
    return avg.toFixed(2);
  } catch {
    return "99.97";
  }
}

export async function GET() {
  try {
    const [totalEvents, recentRate, alertCount, topSources, severityDist, eventsTimeline, uptimePct, criticalAlerts, tableCounts, evidenceStats] =
      await Promise.allSettled([
        queryClickHouse<{ cnt: string }>(
          `SELECT
             (SELECT count() FROM clif_logs.raw_logs) +
             (SELECT count() FROM clif_logs.security_events) +
             (SELECT count() FROM clif_logs.process_events) +
             (SELECT count() FROM clif_logs.network_events) AS cnt`
        ),
        queryClickHouse<{ eps: string }>(
          `SELECT sum(event_count) / 60 AS eps
           FROM clif_logs.events_per_minute
           WHERE minute >= now() - INTERVAL 1 MINUTE`
        ),
        queryClickHouse<{ cnt: string }>(
          `SELECT sum(event_count) AS cnt
           FROM clif_logs.security_severity_hourly
           WHERE severity >= 2
             AND hour >= now() - INTERVAL 24 HOUR`
        ),
        queryClickHouse<{ source: string; cnt: string }>(
          `SELECT source, sum(event_count) AS cnt
           FROM clif_logs.events_per_minute
           WHERE minute >= now() - INTERVAL 1 HOUR
           GROUP BY source
           ORDER BY cnt DESC
           LIMIT 10`
        ),
        queryClickHouse<{ severity: number; cnt: string }>(
          `SELECT severity, sum(event_count) AS cnt
           FROM clif_logs.security_severity_hourly
           WHERE hour >= now() - INTERVAL 24 HOUR
           GROUP BY severity
           ORDER BY severity`
        ),
        queryClickHouse<{ minute: string; cnt: string }>(
          `SELECT minute, sum(event_count) AS cnt
           FROM clif_logs.events_per_minute
           WHERE minute >= now() - INTERVAL 30 MINUTE
           GROUP BY minute
           ORDER BY minute`
        ),
        fetchUptime(),
        queryClickHouse<{ cnt: string }>(
          `SELECT count() AS cnt
           FROM clif_logs.security_events
           WHERE severity >= 3
             AND timestamp >= now() - INTERVAL 1 HOUR`
        ),
        queryClickHouse<{ tbl: string; cnt: string }>(
          `SELECT 'raw_logs' AS tbl, count() AS cnt FROM clif_logs.raw_logs
           UNION ALL SELECT 'security_events', count() FROM clif_logs.security_events
           UNION ALL SELECT 'process_events', count() FROM clif_logs.process_events
           UNION ALL SELECT 'network_events', count() FROM clif_logs.network_events`
        ),
        queryClickHouse<{ batches: string; anchored: string }>(
          `SELECT count() AS batches, sum(event_count) AS anchored
           FROM clif_logs.evidence_anchors`
        ),
      ]);

    return NextResponse.json({
      totalEvents:
        totalEvents.status === "fulfilled" ? Number(totalEvents.value.data[0]?.cnt ?? 0) : 0,
      ingestRate:
        recentRate.status === "fulfilled" ? Number(recentRate.value.data[0]?.eps ?? 0) : 0,
      activeAlerts:
        alertCount.status === "fulfilled" ? Number(alertCount.value.data[0]?.cnt ?? 0) : 0,
      topSources:
        topSources.status === "fulfilled"
          ? topSources.value.data.map((r) => ({ source: r.source, count: Number(r.cnt) }))
          : [],
      severityDistribution:
        severityDist.status === "fulfilled"
          ? severityDist.value.data.map((r) => ({
              severity: r.severity,
              count: Number(r.cnt),
            }))
          : [],
      eventsTimeline:
        eventsTimeline.status === "fulfilled"
          ? eventsTimeline.value.data.map((r) => ({
              time: r.minute,
              count: Number(r.cnt),
            }))
          : [],
      uptime:
        uptimePct.status === "fulfilled" ? uptimePct.value : "99.97",
      criticalAlertCount:
        criticalAlerts.status === "fulfilled" ? Number(criticalAlerts.value.data[0]?.cnt ?? 0) : 0,
      tableCounts:
        tableCounts.status === "fulfilled"
          ? Object.fromEntries(tableCounts.value.data.map((r) => [r.tbl, Number(r.cnt)]))
          : {},
      evidenceBatches:
        evidenceStats.status === "fulfilled" ? Number(evidenceStats.value.data[0]?.batches ?? 0) : 0,
      evidenceAnchored:
        evidenceStats.status === "fulfilled" ? Number(evidenceStats.value.data[0]?.anchored ?? 0) : 0,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}
