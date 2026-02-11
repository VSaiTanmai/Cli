import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CH_HOST = process.env.CH_HOST || "localhost";
const CH_PORT = process.env.CH_PORT || "8123";
const CH_USER = process.env.CH_USER || "clif_admin";
const CH_PASSWORD = process.env.CH_PASSWORD || "Cl1f_Ch@ngeM3_2026!";

async function fetchProm(query: string) {
  const url = `${process.env.PROMETHEUS_URL || "http://localhost:9090"}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data?.result ?? [];
}

async function checkHealth(url: string, timeout = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(id);
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const [upTargets, chInserted, rpBrokers, ch01Health, ch02Health] = await Promise.allSettled([
      fetchProm('up'),
      fetchProm('ClickHouseProfileEvents_InsertedRows'),
      fetchProm('redpanda_cluster_brokers'),
      checkHealth(`http://${CH_HOST}:${CH_PORT}/ping`),
      checkHealth(`http://${CH_HOST}:8124/ping`),
    ]);

    const services: Array<{
      name: string;
      status: string;
      metric?: string;
    }> = [];

    // Parse up targets from Prometheus
    if (upTargets.status === "fulfilled" && upTargets.value) {
      for (const target of upTargets.value) {
        const instance = target.metric?.instance || "";
        // Skip clickhouse exporter targets (9363) — we check CH directly below
        if (instance.includes("9363")) continue;
        services.push({
          name: target.metric?.job || instance || "Unknown",
          status: target.value?.[1] === "1" ? "Healthy" : "Down",
          metric: instance,
        });
      }
    }

    // Add ClickHouse nodes with direct health check
    services.push({
      name: "ClickHouse",
      status: ch01Health.status === "fulfilled" && ch01Health.value ? "Healthy" : "Down",
      metric: `clickhouse01:${CH_PORT}`,
    });
    services.push({
      name: "ClickHouse",
      status: ch02Health.status === "fulfilled" && ch02Health.value ? "Healthy" : "Down",
      metric: "clickhouse02:8124",
    });

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
