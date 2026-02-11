const RP_URL = process.env.REDPANDA_ADMIN_URL || "http://localhost:9644";

export async function rpGet<T = unknown>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${RP_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getClusterHealth() {
  return rpGet<{ is_healthy: boolean }>("/v1/cluster/health");
}

export async function getBrokers() {
  return rpGet<{ node_id: number; is_alive: boolean }[]>("/v1/brokers");
}
