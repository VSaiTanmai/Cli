import { NextRequest, NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const query = searchParams.get("q") || "";
  const table = searchParams.get("table") || "raw_logs";
  const limit = Math.min(Number(searchParams.get("limit") || 50), 200);
  const offset = Number(searchParams.get("offset") || 0);
  const severity = searchParams.get("severity");
  const timeFrom = searchParams.get("from");
  const timeTo = searchParams.get("to");

  const allowedTables = ["raw_logs", "security_events", "process_events", "network_events"];
  const safeTable = allowedTables.includes(table) ? table : "raw_logs";

  try {
    const conditions: string[] = [];
    const params: Record<string, string | number> = {};
    if (query) {
      conditions.push(`position(lower(toString(*)), lower({q:String})) > 0`);
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
        `SELECT *
         FROM clif_logs.${safeTable}
         ${where}
         ORDER BY timestamp DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
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
