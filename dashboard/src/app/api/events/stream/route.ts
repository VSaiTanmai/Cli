import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") || "all";

  try {
    if (table === "all") {
      // Union latest events from all 4 tables with normalized columns
      const result = await queryClickHouse(
        `SELECT * FROM (
           (SELECT toString(event_id) AS event_id, timestamp, source AS source, level AS category, message AS summary, 'raw_logs' AS _table
            FROM clif_logs.raw_logs ORDER BY timestamp DESC LIMIT 25)
           UNION ALL
           (SELECT toString(event_id), timestamp, source, category, description, 'security_events'
            FROM clif_logs.security_events ORDER BY timestamp DESC LIMIT 25)
           UNION ALL
           (SELECT toString(event_id), timestamp, hostname, binary_path, arguments, 'process_events'
            FROM clif_logs.process_events ORDER BY timestamp DESC LIMIT 25)
           UNION ALL
           (SELECT toString(event_id), timestamp, hostname, protocol, IPv4NumToString(dst_ip), 'network_events'
            FROM clif_logs.network_events ORDER BY timestamp DESC LIMIT 25)
         ) AS combined
         ORDER BY timestamp DESC
         LIMIT 100`
      );
      return NextResponse.json({ data: result.data });
    }

    const safeTable = VALID_TABLES.has(table) ? table : "raw_logs";
    const columns = TABLE_COLUMNS[safeTable];
    const result = await queryClickHouse(
      `SELECT ${columns}
       FROM clif_logs.${safeTable}
       ORDER BY timestamp DESC
       LIMIT 100`
    );
    return NextResponse.json({ data: result.data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stream failed" },
      { status: 500 }
    );
  }
}
