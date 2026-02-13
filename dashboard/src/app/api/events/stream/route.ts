import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";
import { checkRateLimit, getClientId } from "@/lib/rate-limit";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Explicit columns per table for single-table queries */
const TABLE_COLUMNS: Record<string, string> = {
  raw_logs:
    "toString(event_id) AS event_id, timestamp, source AS log_source, level, message AS raw, 'raw_logs' AS _table",
  security_events:
    "toString(event_id) AS event_id, timestamp, source AS log_source, severity, category, description AS raw, hostname, mitre_technique, 'security_events' AS _table",
  process_events:
    "toString(event_id) AS event_id, timestamp, hostname, pid, binary_path, arguments AS raw, is_suspicious, 'process_events' AS _table",
  network_events:
    "toString(event_id) AS event_id, timestamp, hostname, IPv4NumToString(src_ip) AS src_ip, IPv4NumToString(dst_ip) AS dst_ip, dst_port, protocol, dns_query, 'network_events' AS _table",
};

const VALID_TABLES = new Set(Object.keys(TABLE_COLUMNS));
const RATE_LIMIT = { maxTokens: 60, refillRate: 5 };

export async function GET(request: Request) {
  const limited = checkRateLimit(getClientId(request), RATE_LIMIT, "/api/events/stream");
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") || "all";

  try {
    if (table === "all") {
      // Union latest events from all 4 tables with normalized columns
      // Frontend expects: event_id, timestamp, log_source, hostname, severity, raw, _table
      // Use a 24-hour sliding window so the live feed always has data
      const result = await queryClickHouse(
        `SELECT * FROM (
           (SELECT toString(event_id) AS event_id, timestamp, source AS log_source, '' AS hostname, toNullable(toUInt8(0)) AS severity, message AS raw, 'raw_logs' AS _table
            FROM clif_logs.raw_logs WHERE timestamp >= now() - INTERVAL 24 HOUR ORDER BY timestamp DESC LIMIT 25)
           UNION ALL
           (SELECT toString(event_id), timestamp, source, hostname, toNullable(severity), description, 'security_events'
            FROM clif_logs.security_events WHERE timestamp >= now() - INTERVAL 24 HOUR ORDER BY timestamp DESC LIMIT 25)
           UNION ALL
           (SELECT toString(event_id), timestamp, '' AS log_source, hostname, toNullable(toUInt8(is_suspicious)) AS severity, concat(binary_path, ' ', arguments) AS raw, 'process_events'
            FROM clif_logs.process_events WHERE timestamp >= now() - INTERVAL 24 HOUR ORDER BY timestamp DESC LIMIT 25)
           UNION ALL
           (SELECT toString(event_id), timestamp, protocol AS log_source, hostname, toNullable(toUInt8(is_suspicious)) AS severity, concat(IPv4NumToString(src_ip), ':', toString(src_port), ' → ', IPv4NumToString(dst_ip), ':', toString(dst_port), ' ', dns_query) AS raw, 'network_events'
            FROM clif_logs.network_events WHERE timestamp >= now() - INTERVAL 24 HOUR ORDER BY timestamp DESC LIMIT 25)
         ) AS combined
         ORDER BY timestamp DESC
         LIMIT 100
         SETTINGS max_threads = 4`
      );
      return NextResponse.json({ data: result.data });
    }

    if (!VALID_TABLES.has(table)) {
      return NextResponse.json(
        { error: "Invalid table parameter" },
        { status: 400 }
      );
    }

    const columns = TABLE_COLUMNS[table];
    const result = await queryClickHouse(
      `SELECT ${columns}
       FROM clif_logs.${table}
       ORDER BY timestamp DESC
       LIMIT 100`
    );
    return NextResponse.json({ data: result.data });
  } catch (err) {
    log.error("Event stream failed", { table, error: err instanceof Error ? err.message : "unknown", component: "api/events/stream" });
    return NextResponse.json(
      { error: "Failed to fetch event stream" },
      { status: 500 }
    );
  }
}
