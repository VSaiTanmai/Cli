const PROM_URL = process.env.PROMETHEUS_URL || "http://localhost:9090";

export interface PromResult {
  metric: Record<string, string>;
  value: [number, string];
}

export async function promQuery(query: string): Promise<PromResult[]> {
  const url = `${PROM_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data?.result ?? [];
}

export async function promRangeQuery(
  query: string,
  start: number,
  end: number,
  step: number,
): Promise<{ metric: Record<string, string>; values: [number, string][] }[]> {
  const url = `${PROM_URL}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&step=${step}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data?.result ?? [];
}
