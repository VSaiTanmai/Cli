import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await queryClickHouse(
      `SELECT *
       FROM clif_logs.raw_logs
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
