import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") || "all";

  try {
    if (table === "all") {
      // Union latest events from all 4 tables with normalized columns
      const result = await queryClickHouse(
        `SELECT toString(event_id) AS event_id, timestamp, source AS source, level AS category, message AS summary, 'raw_logs' AS _table
         FROM clif_logs.raw_logs ORDER BY timestamp DESC LIMIT 25
         UNION ALL
         SELECT toString(event_id), timestamp, source, category, description, 'security_events'
         FROM clif_logs.security_events ORDER BY timestamp DESC LIMIT 25
         UNION ALL
         SELECT toString(event_id), timestamp, hostname, binary_path, arguments, 'process_events'
         FROM clif_logs.process_events ORDER BY timestamp DESC LIMIT 25
         UNION ALL
         SELECT toString(event_id), timestamp, hostname, protocol, IPv4NumToString(dst_ip), 'network_events'
         FROM clif_logs.network_events ORDER BY timestamp DESC LIMIT 25
         ORDER BY timestamp DESC
         LIMIT 100`
      );
      return NextResponse.json({ data: result.data });
    }

    const validTables = ["raw_logs", "security_events", "process_events", "network_events"];
    const safeTable = validTables.includes(table) ? table : "raw_logs";
    const result = await queryClickHouse(
      `SELECT *, '${safeTable}' AS _table
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
