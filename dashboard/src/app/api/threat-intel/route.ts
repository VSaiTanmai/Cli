import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [mitreStats, topIOCs, recentAttacks] = await Promise.allSettled([
      // MITRE technique distribution from security_events
      queryClickHouse<{
        technique: string;
        tactic: string;
        cnt: string;
        max_sev: number;
      }>(
        `SELECT
           mitre_technique AS technique,
           mitre_tactic AS tactic,
           count() AS cnt,
           max(severity) AS max_sev
         FROM clif_logs.security_events
         WHERE mitre_technique != ''
           AND timestamp >= now() - INTERVAL 24 HOUR
         GROUP BY mitre_technique, mitre_tactic
         ORDER BY cnt DESC
         LIMIT 20`
      ),
      // Top IOC-like indicators (IPs, hostnames with high severity)
      queryClickHouse<{
        value: string;
        type: string;
        cnt: string;
        max_sev: number;
      }>(
        `SELECT
           hostname AS value,
           'Hostname' AS type,
           count() AS cnt,
           max(severity) AS max_sev
         FROM clif_logs.security_events
         WHERE severity >= 2
           AND timestamp >= now() - INTERVAL 24 HOUR
         GROUP BY hostname
         ORDER BY cnt DESC
         LIMIT 15`
      ),
      // Recent high-severity attacks timeline
      queryClickHouse<{
        hour: string;
        technique: string;
        cnt: string;
      }>(
        `SELECT
           toStartOfHour(timestamp) AS hour,
           mitre_technique AS technique,
           count() AS cnt
         FROM clif_logs.security_events
         WHERE severity >= 3
           AND mitre_technique != ''
           AND timestamp >= now() - INTERVAL 24 HOUR
         GROUP BY hour, mitre_technique
         ORDER BY hour DESC
         LIMIT 50`
      ),
    ]);

    return NextResponse.json({
      mitreStats:
        mitreStats.status === "fulfilled"
          ? mitreStats.value.data.map((r) => ({
              technique: r.technique,
              tactic: r.tactic,
              count: Number(r.cnt),
              maxSeverity: r.max_sev,
            }))
          : [],
      topIOCs:
        topIOCs.status === "fulfilled"
          ? topIOCs.value.data.map((r) => ({
              value: r.value,
              type: r.type,
              hits: Number(r.cnt),
              maxSeverity: r.max_sev,
            }))
          : [],
      recentAttacks:
        recentAttacks.status === "fulfilled"
          ? recentAttacks.value.data.map((r) => ({
              hour: r.hour,
              technique: r.technique,
              count: Number(r.cnt),
            }))
          : [],
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch threat intel" },
      { status: 500 }
    );
  }
}
