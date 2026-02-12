import { NextRequest, NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

/** Explicit columns per table — prevents schema breakage and data over-exposure */
const TABLE_COLUMNS: Record<string, string> = {
  raw_logs:
    "toString(event_id) AS event_id, timestamp, level, source AS log_source, message AS raw, user_id, toString(ip_address) AS ip_address, request_id",
  security_events:
    "toString(event_id) AS event_id, timestamp, severity, category, source AS log_source, description AS raw, hostname, user_id, mitre_tactic, mitre_technique",
  process_events:
    "toString(event_id) AS event_id, timestamp, hostname, pid, ppid, binary_path, arguments AS raw, container_id, is_suspicious",
  network_events:
    "toString(event_id) AS event_id, timestamp, hostname, IPv4NumToString(src_ip) AS src_ip, src_port, IPv4NumToString(dst_ip) AS dst_ip, dst_port, protocol, direction, bytes_sent, bytes_received, dns_query",
};

const ALLOWED_TABLES = new Set(Object.keys(TABLE_COLUMNS));
const MAX_LIMIT = 200;
const MAX_OFFSET = 100_000; // Prevent excessive OFFSET scans

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const query = searchParams.get("q") || "";
  const table = searchParams.get("table") || "raw_logs";
  const limit = Math.min(Math.max(1, Number(searchParams.get("limit") || 50) || 50), MAX_LIMIT);
  const offset = Math.min(Math.max(0, Number(searchParams.get("offset") || 0) || 0), MAX_OFFSET);
  const severity = searchParams.get("severity");
  const timeFrom = searchParams.get("from");
  const timeTo = searchParams.get("to");

  const safeTable = ALLOWED_TABLES.has(table) ? table : "raw_logs";
  const columns = TABLE_COLUMNS[safeTable];

  try {
    const conditions: string[] = [];
    const params: Record<string, string | number> = {};
    if (query) {
      // Search across the most useful text columns per table
      const searchCols: Record<string, string> = {
        raw_logs: "concat(source, ' ', message, ' ', user_id)",
        security_events: "concat(source, ' ', description, ' ', hostname, ' ', user_id, ' ', category, ' ', mitre_tactic, ' ', mitre_technique)",
        process_events: "concat(hostname, ' ', binary_path, ' ', arguments, ' ', container_id)",
        network_events: "concat(hostname, ' ', protocol, ' ', dns_query, ' ', direction)",
      };
      const haystack = searchCols[safeTable] ?? "source";
      conditions.push(`position(lower(${haystack}), lower({q:String})) > 0`);
      params.q = query;
    }
    if (severity) {
      const sev = Math.max(0, Math.min(4, Math.floor(Number(severity)) || 0));
      conditions.push(`severity >= {sev:UInt8}`);
      params.sev = sev;
    }
    if (timeFrom) {
      conditions.push(`timestamp >= parseDateTimeBestEffort({timeFrom:String})`);
      params.timeFrom = timeFrom;
    }
    if (timeTo) {
      conditions.push(`timestamp <= parseDateTimeBestEffort({timeTo:String})`);
      params.timeTo = timeTo;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [data, total] = await Promise.all([
      queryClickHouse(
        `SELECT ${columns}
         FROM clif_logs.${safeTable}
         ${where}
         ORDER BY timestamp DESC
         LIMIT {lim:UInt32} OFFSET {off:UInt32}`,
        { ...params, lim: limit, off: offset }
      ),
      queryClickHouse<{ cnt: string }>(
        `SELECT count() AS cnt
         FROM clif_logs.${safeTable}
         ${where}`,
        params
      ),
    ]);

    return NextResponse.json({
      data: data.data,
      total: Number(total.data[0]?.cnt ?? 0),
      limit,
      offset,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
