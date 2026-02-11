const CH_HOST = process.env.CH_HOST || "localhost";
const CH_PORT = process.env.CH_PORT || "8123";
const CH_USER = process.env.CH_USER || "clif_admin";
const CH_PASSWORD = process.env.CH_PASSWORD || "Cl1f_Ch@ngeM3_2026!";
const CH_DB = process.env.CH_DB || "clif_logs";

export interface CHResult<T = Record<string, unknown>> {
  data: T[];
  rows: number;
  statistics?: { elapsed: number; rows_read: number; bytes_read: number };
}

export async function queryClickHouse<T = Record<string, unknown>>(
  sql: string,
  params?: Record<string, string | number>,
): Promise<CHResult<T>> {
  const url = new URL(`http://${CH_HOST}:${CH_PORT}/`);
  url.searchParams.set("database", CH_DB);
  url.searchParams.set("default_format", "JSON");
  url.searchParams.set("user", CH_USER);
  url.searchParams.set("password", CH_PASSWORD);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(`param_${key}`, String(value));
    }
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    body: sql,
    headers: { "Content-Type": "text/plain" },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickHouse error: ${text}`);
  }

  const json = await res.json();
  return {
    data: json.data ?? [],
    rows: json.rows ?? 0,
    statistics: json.statistics,
  };
}
