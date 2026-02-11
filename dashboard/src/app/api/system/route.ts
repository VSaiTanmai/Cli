import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function fetchProm(query: string) {
  const url = `${process.env.PROMETHEUS_URL || "http://localhost:9090"}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data?.result ?? [];
}

export async function GET() {
  try {
    const [upTargets, chInserted, rpBrokers] = await Promise.allSettled([
      fetchProm('up'),
      fetchProm('ClickHouseProfileEvents_InsertedRows'),
      fetchProm('redpanda_cluster_brokers'),
    ]);

    const services: Array<{
      name: string;
      status: string;
      metric?: string;
    }> = [];

    // Parse up targets
    if (upTargets.status === "fulfilled" && upTargets.value) {
      for (const target of upTargets.value) {
        services.push({
          name: target.metric?.job || target.metric?.instance || "Unknown",
          status: target.value?.[1] === "1" ? "Healthy" : "Down",
          metric: target.metric?.instance,
        });
      }
    }

    return NextResponse.json({
      services,
      clickhouseInserted:
        chInserted.status === "fulfilled" ? chInserted.value?.[0]?.value?.[1] : null,
      redpandaBrokers:
        rpBrokers.status === "fulfilled" ? rpBrokers.value?.[0]?.value?.[1] : null,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch system health" },
      { status: 500 }
    );
  }
}
