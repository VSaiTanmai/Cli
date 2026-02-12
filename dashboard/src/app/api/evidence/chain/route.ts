import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [batches, summary] = await Promise.all([
      // Fetch all anchor batches ordered by creation time
      queryClickHouse<{
        batch_id: string;
        created_at: string;
        table_name: string;
        time_from: string;
        time_to: string;
        event_count: string;
        merkle_root: string;
        merkle_depth: string;
        s3_key: string;
        s3_version_id: string;
        status: string;
        prev_merkle_root: string;
      }>(
        `SELECT
           batch_id,
           toString(created_at) AS created_at,
           table_name,
           toString(time_from) AS time_from,
           toString(time_to) AS time_to,
           event_count,
           merkle_root,
           merkle_depth,
           s3_key,
           s3_version_id,
           status,
           prev_merkle_root
         FROM clif_logs.evidence_anchors
         ORDER BY created_at DESC`
      ),
      // Aggregate summary stats
      queryClickHouse<{
        total_anchored: string;
        total_batches: string;
        avg_batch_size: string;
        verified_count: string;
      }>(
        `SELECT
           sum(event_count) AS total_anchored,
           count() AS total_batches,
           avg(event_count) AS avg_batch_size,
           countIf(status = 'Verified') AS verified_count
         FROM clif_logs.evidence_anchors`
      ),
    ]);

    const summaryRow = summary.data[0];
    const totalBatches = Number(summaryRow?.total_batches ?? 0);
    const verifiedCount = Number(summaryRow?.verified_count ?? 0);

    return NextResponse.json({
      batches: batches.data.map((b) => ({
        id: b.batch_id,
        timestamp: b.created_at,
        tableName: b.table_name,
        timeFrom: b.time_from,
        timeTo: b.time_to,
        eventCount: Number(b.event_count),
        merkleRoot: b.merkle_root,
        merkleDepth: Number(b.merkle_depth),
        s3Key: b.s3_key,
        s3VersionId: b.s3_version_id,
        status: b.status,
        prevMerkleRoot: b.prev_merkle_root,
      })),
      summary: {
        totalAnchored: Number(summaryRow?.total_anchored ?? 0),
        totalBatches,
        verificationRate: totalBatches > 0
          ? Math.round((verifiedCount / totalBatches) * 100)
          : 0,
        avgBatchSize: Math.round(Number(summaryRow?.avg_batch_size ?? 0)),
        chainLength: totalBatches,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch evidence chain" },
      { status: 500 }
    );
  }
}
