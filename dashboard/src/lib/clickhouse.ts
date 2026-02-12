const CH_HOST = process.env.CH_HOST || "localhost";
const CH_PORT = process.env.CH_PORT || "8123";
const CH_USER = process.env.CH_USER || "clif_admin";
const CH_PASSWORD = process.env.CH_PASSWORD || "Cl1f_Ch@ngeM3_2026!";
const CH_DB = process.env.CH_DB || "clif_logs";

/** Query timeout in ms — prevents runaway ClickHouse queries */
const CH_QUERY_TIMEOUT_MS = Number(process.env.CH_QUERY_TIMEOUT_MS) || 30_000;
/** Max retry attempts on transient failures */
const CH_MAX_RETRIES = Number(process.env.CH_MAX_RETRIES) || 3;
/** Base backoff delay in ms (doubled on each retry) */
const CH_RETRY_BASE_MS = 200;

export interface CHResult<T = Record<string, unknown>> {
  data: T[];
  rows: number;
  statistics?: { elapsed: number; rows_read: number; bytes_read: number };
}

/** Transient error codes worth retrying (ClickHouse-specific + network) */
const RETRIABLE_STATUS_CODES = new Set([502, 503, 504, 408, 429]);

function isRetriable(status: number, body: string): boolean {
  if (RETRIABLE_STATUS_CODES.has(status)) return true;
  // ClickHouse returns 500 for some transient errors
  if (status === 500 && /CANNOT_SCHEDULE_TASK|TOO_MANY_SIMULTANEOUS_QUERIES|MEMORY_LIMIT_EXCEEDED/.test(body)) return true;
  return false;
}

/** Sanitize ClickHouse error messages — strip credentials and internal paths */
function sanitizeError(raw: string): string {
  return raw
    .replace(/password=[^\s&]*/gi, "password=***")
    .replace(/user=[^\s&]*/gi, "user=***")
    .replace(/\/var\/lib\/clickhouse[^\s]*/g, "[internal path]")
    .slice(0, 500); // Cap error length to prevent leaking large payloads
}

export async function queryClickHouse<T = Record<string, unknown>>(
  sql: string,
  params?: Record<string, string | number>,
): Promise<CHResult<T>> {
  const url = new URL(`http://${CH_HOST}:${CH_PORT}/`);
  url.searchParams.set("database", CH_DB);
  url.searchParams.set("default_format", "JSON");
  // ClickHouse server-side query timeout as safety net
  url.searchParams.set("max_execution_time", String(Math.ceil(CH_QUERY_TIMEOUT_MS / 1000)));

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(`param_${key}`, String(value));
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= CH_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CH_QUERY_TIMEOUT_MS);

    try {
      const res = await fetch(url.toString(), {
        method: "POST",
        body: sql,
        headers: {
          "Content-Type": "text/plain",
          // Send credentials via headers — not logged like query params
          "X-ClickHouse-User": CH_USER,
          "X-ClickHouse-Key": CH_PASSWORD,
        },
        signal: controller.signal,
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        if (attempt < CH_MAX_RETRIES && isRetriable(res.status, text)) {
          lastError = new Error(`ClickHouse HTTP ${res.status}`);
          const backoff = CH_RETRY_BASE_MS * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw new Error(`ClickHouse error (HTTP ${res.status}): ${sanitizeError(text)}`);
      }

      const json = await res.json();
      return {
        data: json.data ?? [],
        rows: json.rows ?? 0,
        statistics: json.statistics,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`ClickHouse query timed out after ${CH_QUERY_TIMEOUT_MS}ms`);
      }
      // Retry network errors (ECONNREFUSED, ECONNRESET, etc.)
      if (attempt < CH_MAX_RETRIES && err instanceof TypeError) {
        lastError = err;
        const backoff = CH_RETRY_BASE_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("ClickHouse query failed after max retries");
}
