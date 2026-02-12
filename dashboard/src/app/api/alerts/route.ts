import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

/** Explicit columns — never SELECT * in production */
const ALERT_COLUMNS = [
  "toString(event_id) AS event_id",
  "timestamp",
  "severity",
  "category AS event_type",
  "source",
  "description AS raw",
  "hostname",
  "user_id",
  "mitre_tactic",
  "mitre_technique",
].join(", ");

export async function GET() {
  try {
    const [result, alerts] = await Promise.allSettled([
      queryClickHouse<{ severity: number; cnt: string }>(
        `SELECT severity, count() AS cnt
         FROM clif_logs.security_events
         WHERE severity >= 2
           AND timestamp >= now() - INTERVAL 24 HOUR
         GROUP BY severity
         ORDER BY severity DESC`
      ),
      queryClickHouse(
        `SELECT ${ALERT_COLUMNS}
         FROM clif_logs.security_events
         WHERE severity >= 2
           AND timestamp >= now() - INTERVAL 24 HOUR
         ORDER BY timestamp DESC
         LIMIT 100`
      ),
    ]);

    return NextResponse.json({
      summary:
        result.status === "fulfilled"
          ? result.value.data.map((r) => ({
              severity: r.severity,
              count: Number(r.cnt),
            }))
          : [],
      alerts: alerts.status === "fulfilled" ? alerts.value.data : [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Alerts fetch failed" },
      { status: 500 }
    );
  }
}
