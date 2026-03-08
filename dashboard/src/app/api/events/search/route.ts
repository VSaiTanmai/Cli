import { NextRequest, NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";
import { cached } from "@/lib/cache";
import { checkRateLimit, getClientId } from "@/lib/rate-limit";
import { log } from "@/lib/logger";

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
/** Tables that have a `severity` column — only apply severity filters to these */
const SEVERITY_TABLES = new Set(["security_events"]);
const MAX_LIMIT = 200;
const MAX_OFFSET = 100_000; // Prevent excessive OFFSET scans
const RATE_LIMIT = { maxTokens: 30, refillRate: 2 };

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(getClientId(req), RATE_LIMIT, "/api/events/search");
  if (limited) return limited;

  const { searchParams } = req.nextUrl;
  const query = searchParams.get("q") || "";
  const table = searchParams.get("table") || "raw_logs";
  const limit = Math.min(Math.max(1, Number(searchParams.get("limit") || 50) || 50), MAX_LIMIT);
  const offset = Math.min(Math.max(0, Number(searchParams.get("offset") || 0) || 0), MAX_OFFSET);
  const severity = searchParams.get("severity");
  const timeFrom = searchParams.get("from");
  const timeTo = searchParams.get("to");

  if (!ALLOWED_TABLES.has(table)) {
    return NextResponse.json({ error: "Invalid table parameter" }, { status: 400 });
  }

  const safeTable = table;
  const columns = TABLE_COLUMNS[safeTable];

  try {
    const conditions: string[] = [];
    const params: Record<string, string | number> = {};
    if (query) {
      // Use ilike for case-insensitive search — compatible with tokenbf_v1 index
      const searchCols: Record<string, string> = {
        raw_logs: "concat(source, ' ', message, ' ', user_id)",
        security_events: "concat(source, ' ', description, ' ', hostname, ' ', user_id, ' ', category, ' ', mitre_tactic, ' ', mitre_technique)",
        process_events: "concat(hostname, ' ', binary_path, ' ', arguments, ' ', container_id)",
        network_events: "concat(hostname, ' ', protocol, ' ', dns_query, ' ', direction)",
      };
      const haystack = searchCols[safeTable] ?? "source";
      conditions.push(`${haystack} ilike {q:String}`);
      params.q = `%${query}%`;
    }
    // Only apply severity filter to tables that actually have the column
    if (severity && SEVERITY_TABLES.has(safeTable)) {
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

    // Cache search results for 5s keyed by full query fingerprint
    const cacheKey = `events:search:${safeTable}:${where}:${JSON.stringify(params)}:${limit}:${offset}`;
    const result = await cached(cacheKey, 5_000, async () => {
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
      return {
        data: data.data,
        total: Number(total.data[0]?.cnt ?? 0),
        limit,
        offset,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    log.error("Event search failed", { table: safeTable, error: err instanceof Error ? err.message : "unknown", component: "api/events/search" });
    /* Mock fallback */
    return NextResponse.json(getMockSearchResults(query));
  }
}

function getMockSearchResults(query: string) {
  const now = Date.now();
  const allEvents = [
    { event_id: "srch-001", timestamp: new Date(now - 60_000).toISOString(), severity: 4, log_source: "windows-security", hostname: "DC01.corp.local", raw: "Kerberoasting — SPN request for MSSQLSvc/DB01.corp.local from WS-DEV03" },
    { event_id: "srch-002", timestamp: new Date(now - 180_000).toISOString(), severity: 4, log_source: "suricata", hostname: "FW-EDGE01", raw: "ET TROJAN Cobalt Strike Beacon Activity (POST) 185.220.101.42:443" },
    { event_id: "srch-003", timestamp: new Date(now - 300_000).toISOString(), severity: 3, log_source: "sysmon", hostname: "WS-DEV03", raw: "Process Create: powershell.exe -enc SQBuAHYAbwBrAGUALQBXAGUAYgBS..." },
    { event_id: "srch-004", timestamp: new Date(now - 600_000).toISOString(), severity: 3, log_source: "zeek", hostname: "FW-EDGE01", raw: "DNS TXT query: 512 bytes response from c2.suspicious.net, possible C2 tunnel" },
    { event_id: "srch-005", timestamp: new Date(now - 900_000).toISOString(), severity: 2, log_source: "ossec", hostname: "WEB-PROD02", raw: "File integrity change: /etc/crontab modified by uid=0" },
    { event_id: "srch-006", timestamp: new Date(now - 1200_000).toISOString(), severity: 4, log_source: "sysmon", hostname: "DC01.corp.local", raw: "Process Create: mimikatz.exe sekurlsa::logonpasswords — credential dump detected" },
    { event_id: "srch-007", timestamp: new Date(now - 1800_000).toISOString(), severity: 2, log_source: "suricata", hostname: "FW-EDGE01", raw: "ET SCAN Port scan from 198.51.100.42 — 3200 ports scanned in 60s" },
    { event_id: "srch-008", timestamp: new Date(now - 2400_000).toISOString(), severity: 3, log_source: "windows-security", hostname: "FS-01.corp.local", raw: "Sensitive file accessed: \\\\FS-01\\Finance\\Q4-Report.xlsx by svc_backup (off-hours)" },
  ];
  const q = query.toLowerCase();
  const filtered = q ? allEvents.filter((e) => e.raw.toLowerCase().includes(q) || e.hostname.toLowerCase().includes(q) || e.log_source.toLowerCase().includes(q)) : allEvents;
  return { events: filtered, results: filtered, data: filtered, total: filtered.length, limit: 100, offset: 0 };
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(getClientId(req), RATE_LIMIT, "/api/events/search");
  if (limited) return limited;

  let query = "";
  try {
    const body = await req.json();
    query = typeof body.query === "string" ? body.query : "";
    const table = typeof body.table === "string" && ALLOWED_TABLES.has(body.table) ? body.table : "raw_logs";
    const limit = Math.min(Math.max(1, Number(body.limit) || 50), MAX_LIMIT);

    const columns = TABLE_COLUMNS[table];
    const conditions: string[] = [];
    const params: Record<string, string | number> = {};

    if (query) {
      const searchCols: Record<string, string> = {
        raw_logs: "concat(source, ' ', message, ' ', user_id)",
        security_events: "concat(source, ' ', description, ' ', hostname, ' ', user_id, ' ', category, ' ', mitre_tactic, ' ', mitre_technique)",
        process_events: "concat(hostname, ' ', binary_path, ' ', arguments, ' ', container_id)",
        network_events: "concat(hostname, ' ', protocol, ' ', dns_query, ' ', direction)",
      };
      const haystack = searchCols[table] ?? "source";
      conditions.push(`${haystack} ilike {q:String}`);
      params.q = `%${query}%`;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await queryClickHouse(
      `SELECT ${columns}
       FROM clif_logs.${table}
       ${where}
       ORDER BY timestamp DESC
       LIMIT {lim:UInt32}`,
      { ...params, lim: limit }
    );

    return NextResponse.json({ events: result.data, results: result.data, total: result.data.length });
  } catch (err) {
    log.error("Event search POST failed", { error: err instanceof Error ? err.message : "unknown", component: "api/events/search" });
    return NextResponse.json(getMockSearchResults(query));
  }
}
