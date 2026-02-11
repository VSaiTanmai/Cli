import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [totalEvents, recentRate, alertCount, topSources, severityDist, eventsTimeline] =
      await Promise.allSettled([
        queryClickHouse<{ cnt: string }>(
          "SELECT count() AS cnt FROM clif_logs.raw_logs"
        ),
        queryClickHouse<{ eps: string }>(
          `SELECT round(count() / 60) AS eps
           FROM clif_logs.raw_logs
           WHERE timestamp >= now() - INTERVAL 1 MINUTE`
        ),
        queryClickHouse<{ cnt: string }>(
          `SELECT count() AS cnt
           FROM clif_logs.security_events
           WHERE severity >= 2
             AND timestamp >= now() - INTERVAL 24 HOUR`
        ),
        queryClickHouse<{ source: string; cnt: string }>(
          `SELECT log_source AS source, count() AS cnt
           FROM clif_logs.raw_logs
           WHERE timestamp >= now() - INTERVAL 1 HOUR
           GROUP BY log_source
           ORDER BY cnt DESC
           LIMIT 10`
        ),
        queryClickHouse<{ severity: number; cnt: string }>(
          `SELECT severity, count() AS cnt
           FROM clif_logs.security_events
           WHERE timestamp >= now() - INTERVAL 24 HOUR
           GROUP BY severity
           ORDER BY severity`
        ),
        queryClickHouse<{ minute: string; cnt: string }>(
          `SELECT toStartOfMinute(timestamp) AS minute, count() AS cnt
           FROM clif_logs.raw_logs
           WHERE timestamp >= now() - INTERVAL 30 MINUTE
           GROUP BY minute
           ORDER BY minute`
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
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}
