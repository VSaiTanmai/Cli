const RP_URL = process.env.REDPANDA_ADMIN_URL || "http://localhost:9644";
const RP_TIMEOUT_MS = Number(process.env.RP_TIMEOUT_MS) || 5_000;

export async function rpGet<T = unknown>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RP_TIMEOUT_MS);
  try {
    const res = await fetch(`${RP_URL}${path}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getClusterHealth() {
  return rpGet<{ is_healthy: boolean }>("/v1/cluster/health");
}

export async function getBrokers() {
  return rpGet<{ node_id: number; is_alive: boolean }[]>("/v1/brokers");
}
