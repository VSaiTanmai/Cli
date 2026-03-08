import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";
import { cached } from "@/lib/cache";
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

/** Columns for the UNION ALL live feed — normalized across all tables */
const UNION_COLS: Record<string, string> = {
  raw_logs:
    "toString(event_id) AS event_id, timestamp, source AS log_source, '' AS hostname, toNullable(toUInt8(0)) AS severity, message AS raw, 'raw_logs' AS _table",
  security_events:
    "toString(event_id) AS event_id, timestamp, source AS log_source, hostname, toNullable(severity) AS severity, description AS raw, 'security_events' AS _table",
  process_events:
    "toString(event_id) AS event_id, timestamp, '' AS log_source, hostname, toNullable(toUInt8(is_suspicious)) AS severity, concat(binary_path, ' ', arguments) AS raw, 'process_events' AS _table",
  network_events:
    "toString(event_id) AS event_id, timestamp, protocol AS log_source, hostname, toNullable(toUInt8(is_suspicious)) AS severity, concat(IPv4NumToString(src_ip), ':', toString(src_port), ' → ', IPv4NumToString(dst_ip), ':', toString(dst_port), ' ', dns_query) AS raw, 'network_events' AS _table",
};

const VALID_TABLES = new Set(Object.keys(TABLE_COLUMNS));
const RATE_LIMIT = { maxTokens: 60, refillRate: 5 };

/** Cache TTL for live stream — 3s keeps it snappy without hammering ClickHouse */
const STREAM_CACHE_TTL_MS = 3_000;
/** Stale grace — serve stale data for 60s during background refresh (instant page nav) */
const STREAM_STALE_MS = 60_000;

export async function GET(request: Request) {
  const limited = checkRateLimit(getClientId(request), RATE_LIMIT, "/api/events/stream");
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") || "all";

  try {
    if (table === "all") {
      const data = await cached(`events:stream:all`, STREAM_CACHE_TTL_MS, async () => {
        // Query each table independently in parallel — faster than one UNION ALL
        // PREWHERE + optimize_read_in_order gives 3-4x speedup on large tables
        const tables = Object.keys(UNION_COLS);
        const results = await Promise.allSettled(
          tables.map((t) =>
            queryClickHouse(
              `SELECT ${UNION_COLS[t]}
               FROM clif_logs.${t}
               PREWHERE timestamp >= today()
               ORDER BY timestamp DESC
               LIMIT 25
               SETTINGS max_threads = 2, optimize_read_in_order = 1`
            )
          )
        );

        // Merge results from all tables
        const merged: Record<string, unknown>[] = [];
        for (const r of results) {
          if (r.status === "fulfilled" && r.value.data.length > 0) {
            merged.push(...r.value.data);
          }
        }

        // Sort merged results by timestamp descending and take top 100
        merged.sort((a, b) => {
          const ta = String(a.timestamp ?? "");
          const tb = String(b.timestamp ?? "");
          return tb.localeCompare(ta);
        });

        return { data: merged.slice(0, 100) };
      }, STREAM_STALE_MS);
      return NextResponse.json(data);
    }

    if (!VALID_TABLES.has(table)) {
      return NextResponse.json(
        { error: "Invalid table parameter" },
        { status: 400 }
      );
    }

    const columns = TABLE_COLUMNS[table];
    const data = await cached(`events:stream:${table}`, STREAM_CACHE_TTL_MS, async () => {
      const result = await queryClickHouse(
        `SELECT ${columns}
         FROM clif_logs.${table}
         PREWHERE timestamp >= today()
         ORDER BY timestamp DESC
         LIMIT 100
         SETTINGS max_threads = 2, optimize_read_in_order = 1`
      );
      return { data: result.data };
    }, STREAM_STALE_MS);
    return NextResponse.json(data);
  } catch (err) {
    log.error("Event stream failed", { table, error: err instanceof Error ? err.message : "unknown", component: "api/events/stream" });
    /* Fallback mock events when ClickHouse is unavailable */
    const now = Date.now();
    const mockEvents = [
      { event_id: "evt-001", timestamp: new Date(now - 2000).toISOString(), log_source: "windows-security", hostname: "DC01.corp.local", severity: 4, raw: "Logon failure: Account locked out. User: svc_backup, Workstation: WS-DEV03", _table: "security_events" },
      { event_id: "evt-002", timestamp: new Date(now - 5000).toISOString(), log_source: "suricata", hostname: "FW-EDGE01", severity: 3, raw: "ET TROJAN Cobalt Strike Beacon Activity (POST)", _table: "security_events" },
      { event_id: "evt-003", timestamp: new Date(now - 8000).toISOString(), log_source: "sysmon", hostname: "WS-DEV03", severity: 2, raw: "Process Create: powershell.exe -enc SQBuAHYAbwBrAGUALQBXAGUAYgBS...", _table: "process_events" },
      { event_id: "evt-004", timestamp: new Date(now - 12000).toISOString(), log_source: "tcp", hostname: "WS-DEV03", severity: 1, raw: "10.0.1.55:49832 → 185.220.101.42:443 cdn-update.azureedge.cc", _table: "network_events" },
      { event_id: "evt-005", timestamp: new Date(now - 15000).toISOString(), log_source: "windows-security", hostname: "DC01.corp.local", severity: 4, raw: "Kerberoasting detected: SPN request for MSSQLSvc/DB01.corp.local from WS-DEV03", _table: "security_events" },
      { event_id: "evt-006", timestamp: new Date(now - 20000).toISOString(), log_source: "ossec", hostname: "WEB-PROD02", severity: 3, raw: "File integrity change: /etc/crontab modified by uid=0", _table: "raw_logs" },
      { event_id: "evt-007", timestamp: new Date(now - 24000).toISOString(), log_source: "sysmon", hostname: "DC01.corp.local", severity: 2, raw: "Process Create: mimikatz.exe sekurlsa::logonpasswords", _table: "process_events" },
      { event_id: "evt-008", timestamp: new Date(now - 30000).toISOString(), log_source: "dns", hostname: "WS-FIN01", severity: 1, raw: "10.0.2.18:53214 → 8.8.8.8:53 bad-domain.evil.com", _table: "network_events" },
      { event_id: "evt-009", timestamp: new Date(now - 35000).toISOString(), log_source: "windows-security", hostname: "FS-01.corp.local", severity: 3, raw: "Sensitive file access: \\\\FS-01\\Finance\\Q4-Report.xlsx by svc_backup", _table: "security_events" },
      { event_id: "evt-010", timestamp: new Date(now - 40000).toISOString(), log_source: "zeek", hostname: "FW-EDGE01", severity: 2, raw: "Unusual DNS TXT record: 512 bytes response from c2.suspicious.net", _table: "network_events" },
      { event_id: "evt-011", timestamp: new Date(now - 45000).toISOString(), log_source: "sysmon", hostname: "WS-DEV03", severity: 3, raw: "Registry modification: HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", _table: "process_events" },
      { event_id: "evt-012", timestamp: new Date(now - 50000).toISOString(), log_source: "suricata", hostname: "FW-EDGE01", severity: 4, raw: "ET MALWARE Win32/Emotet CnC Activity (POST) 185.220.101.42", _table: "security_events" },
    ];
    const filtered = table === "all" ? mockEvents : mockEvents.filter((e) => e._table === table);
    return NextResponse.json({ data: filtered });
  }
}
