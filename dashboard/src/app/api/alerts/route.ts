import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await queryClickHouse<{ severity: number; cnt: string }>(
      `SELECT severity, count() AS cnt
       FROM clif_logs.security_events
       WHERE severity >= 2
         AND timestamp >= now() - INTERVAL 24 HOUR
       GROUP BY severity
       ORDER BY severity DESC`
    );

    // Also get recent alerts list
    const alerts = await queryClickHouse(
      `SELECT *
       FROM clif_logs.security_events
       WHERE severity >= 2
         AND timestamp >= now() - INTERVAL 24 HOUR
       ORDER BY timestamp DESC
       LIMIT 50`
    );

    return NextResponse.json({
      summary: result.data.map((r) => ({
        severity: r.severity,
        count: Number(r.cnt),
      })),
      alerts: alerts.data,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Alerts fetch failed" },
      { status: 500 }
    );
  }
}
