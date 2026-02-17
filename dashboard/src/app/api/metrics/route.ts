import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";
import { cached } from "@/lib/cache";
import { checkRateLimit, getClientId } from "@/lib/rate-limit";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

const PROM_URL = process.env.PROMETHEUS_URL || "http://localhost:9090";
const PROM_TIMEOUT_MS = 8_000;

/** Cache TTL for dashboard metrics — balances freshness vs. query cost */
const METRICS_CACHE_TTL_MS = 2_000;

async function fetchUptime(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROM_TIMEOUT_MS);
  try {
    const url = `${PROM_URL}/api/v1/query?query=${encodeURIComponent("avg_over_time(up{job=~\"clickhouse.*|redpanda\"}[24h]) * 100")}`;
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) {
      log.warn("Prometheus uptime query returned non-OK", { component: "metrics", status: res.status });
      return "—";
    }
    const json = await res.json();
    const results = json.data?.result ?? [];
    if (results.length === 0) return "—";
    const avg = results.reduce((sum: number, r: { value: [number, string] }) => sum + parseFloat(r.value[1]), 0) / results.length;
    return avg.toFixed(2);
  } catch {
    log.warn("Prometheus uptime query failed", { component: "metrics" });
    return "—";
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  // Rate limiting
  const rateLimited = checkRateLimit(getClientId(request), { maxTokens: 30, refillRate: 2 }, "/api/metrics");
  if (rateLimited) return rateLimited;

  try {
    const data = await cached("metrics:dashboard", METRICS_CACHE_TTL_MS, async () => {
      const [totalEvents, recentRate, alertCount, topSources, severityDist, eventsTimeline, uptimePct, criticalAlerts, tableCounts, evidenceStats, mitreStats, eventsTimelineFallback, recentRateFallback] =
        await Promise.allSettled([
          queryClickHouse<{ cnt: string }>(
            `SELECT
               (SELECT count() FROM clif_logs.raw_logs) +
               (SELECT count() FROM clif_logs.security_events) +
               (SELECT count() FROM clif_logs.process_events) +
               (SELECT count() FROM clif_logs.network_events) AS cnt`
          ),
          queryClickHouse<{ eps: string }>(
            `SELECT greatest(
               ifNull((SELECT sum(event_count) / 10
                FROM clif_logs.events_per_10s
                WHERE ts >= now() - INTERVAL 10 SECOND), 0),
               ifNull((SELECT sum(event_count) / greatest(10, dateDiff('second', min(ts), max(ts) + INTERVAL 10 SECOND))
                FROM clif_logs.events_per_10s
                WHERE ts >= now() - INTERVAL 60 SECOND), 0),
               ifNull((SELECT max(bin_total) / 10 FROM (
                  SELECT sum(event_count) AS bin_total
                  FROM clif_logs.events_per_10s
                  WHERE ts >= now() - INTERVAL 1 HOUR
                  GROUP BY ts)), 0),
               ifNull((SELECT coalesce(value, 0)
                FROM clif_logs.pipeline_metrics
                WHERE metric = 'producer_eps'
                  AND ts >= now() - INTERVAL 5 MINUTE
                ORDER BY ts DESC LIMIT 1), 0)
             ) AS eps`
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
            `SELECT ts AS minute, sum(event_count) AS cnt
             FROM clif_logs.events_per_10s
             WHERE ts >= now() - INTERVAL 30 MINUTE
             GROUP BY ts
             ORDER BY ts`
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
          queryClickHouse<{ technique: string; tactic: string; cnt: string }>(
            `SELECT mitre_technique AS technique,
                   mitre_tactic AS tactic,
                   count() AS cnt
             FROM clif_logs.security_events
             WHERE mitre_technique != ''
               AND timestamp >= now() - INTERVAL 7 DAY
             GROUP BY mitre_technique, mitre_tactic
             ORDER BY cnt DESC
             LIMIT 10`
          ),
          // ── Fallback: events_per_minute for timeline when events_per_10s TTL expired ──
          queryClickHouse<{ minute: string; cnt: string }>(
            `SELECT minute, sum(event_count) AS cnt
             FROM clif_logs.events_per_minute
             WHERE minute >= now() - INTERVAL 60 MINUTE
             GROUP BY minute
             ORDER BY minute`
          ),
          // ── Fallback: recent rate from events_per_minute ──
          queryClickHouse<{ eps: string }>(
            `SELECT sum(event_count) / greatest(60, dateDiff('second', min(minute), max(minute) + INTERVAL 60 SECOND)) AS eps
             FROM clif_logs.events_per_minute
             WHERE minute >= now() - INTERVAL 5 MINUTE`
          ),
        ]);

      return {
        totalEvents:
          totalEvents.status === "fulfilled" ? Number(totalEvents.value.data[0]?.cnt ?? 0) : 0,
        ingestRate: (() => {
          const primary = recentRate.status === "fulfilled" ? Number(recentRate.value.data[0]?.eps ?? 0) : 0;
          if (primary > 0) return primary;
          return recentRateFallback.status === "fulfilled" ? Number(recentRateFallback.value.data[0]?.eps ?? 0) : 0;
        })(),
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
        eventsTimeline: (() => {
          const primary = eventsTimeline.status === "fulfilled" ? eventsTimeline.value.data : [];
          if (primary.length > 0) return primary.map((r) => ({ time: r.minute, count: Number(r.cnt) }));
          // Fallback to events_per_minute when events_per_10s TTL expired
          const fallback = eventsTimelineFallback.status === "fulfilled" ? eventsTimelineFallback.value.data : [];
          return fallback.map((r) => ({ time: r.minute, count: Number(r.cnt) }));
        })(),
        uptime:
          uptimePct.status === "fulfilled" ? uptimePct.value : "—",
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
        mitreTopTechniques:
          mitreStats.status === "fulfilled"
            ? mitreStats.value.data.map((r) => ({ technique: r.technique, tactic: r.tactic, count: Number(r.cnt) }))
            : [],
      };
    });

    return NextResponse.json(data);
  } catch (err) {
    log.error("Metrics API failed", {
      component: "api/metrics",
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}
