const PROM_URL = process.env.PROMETHEUS_URL || "http://localhost:9090";
const PROM_TIMEOUT_MS = Number(process.env.PROM_TIMEOUT_MS) || 10_000;

export interface PromResult {
  metric: Record<string, string>;
  value: [number, string];
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function promQuery(query: string): Promise<PromResult[]> {
  try {
    const url = `${PROM_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, PROM_TIMEOUT_MS);
    if (!res.ok) return [];
    const json = await res.json();
    return json?.data?.result ?? [];
  } catch {
    return [];
  }
}

export async function promRangeQuery(
  query: string,
  start: number,
  end: number,
  step: number,
): Promise<{ metric: Record<string, string>; values: [number, string][] }[]> {
  try {
    const url = `${PROM_URL}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&step=${step}`;
    const res = await fetchWithTimeout(url, PROM_TIMEOUT_MS);
    if (!res.ok) return [];
    const json = await res.json();
    return json?.data?.result ?? [];
  } catch {
    return [];
  }
}
