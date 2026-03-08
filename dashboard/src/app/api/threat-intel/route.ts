import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";
import { checkRateLimit, getClientId } from "@/lib/rate-limit";
import { cached } from "@/lib/cache";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

const RATE_LIMIT = { maxTokens: 20, refillRate: 1 };

export async function GET(request: Request) {
  const limited = checkRateLimit(getClientId(request), RATE_LIMIT);
  if (limited) return limited;

  try {
    const data = await cached("threat-intel:dashboard", 15_000, async () => {
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

      if ([mitreStats, topIOCs, recentAttacks].every((r) => r.status === "rejected")) {
        throw new Error("All ClickHouse queries failed — serving mock threat-intel");
      }

      return {
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
      };
    });

    /* If ClickHouse returned empty data (backends down), serve mock threat-intel */
    if (data.mitreStats?.length === 0 && data.topIOCs?.length === 0 && data.recentAttacks?.length === 0) {
      throw new Error("All threat-intel data is empty — serving mock data");
    }

    return NextResponse.json(data);
  } catch (err) {
    log.error("Threat intel fetch failed", { error: err instanceof Error ? err.message : "unknown", component: "api/threat-intel" });
    /* Fallback mock data matching the ThreatIntelPage expected shape */
    const mock = await import("@/lib/mock/threat-intel.json");
    return NextResponse.json({
      iocs: mock.iocs.map((ioc: { type: string; value: string; source: string; confidence: number; lastSeen: string; mitre: string }) => ({
        ...ioc,
        type: ioc.type.toLowerCase(),
      })),
      patterns: (mock.threatPatterns || []).map((p: { name: string; description: string; mitre: string; iocCount: number; matchedEvents: number; severity: number }) => ({
        ...p,
      })),
      stats: {
        totalIOCs: mock.iocs.length,
        activeThreats: (mock.threatPatterns || []).length,
        mitreTechniques: new Set(mock.iocs.map((i: { mitre: string }) => i.mitre)).size,
        lastUpdated: new Date().toISOString(),
      },
    });
  }
}
