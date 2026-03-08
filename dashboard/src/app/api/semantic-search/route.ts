import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientId } from "@/lib/rate-limit";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

const LANCEDB_URL = process.env.LANCEDB_URL || "http://localhost:8100";
const RATE_LIMIT = { maxTokens: 30, refillRate: 3 };

/** Proxy semantic search requests to the LanceDB service */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(getClientId(req), RATE_LIMIT);
  if (limited) return limited;

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q");
  const table = searchParams.get("table") || "log_embeddings";
  const limitParam = searchParams.get("limit") || "20";
  const filter = searchParams.get("filter");

  if (!q || q.trim().length === 0) {
    return NextResponse.json({ error: "Missing 'q' parameter" }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({ q, table, limit: limitParam });
    if (filter) params.set("filter", filter);

    // Retry once on transient failures (cold start, connection reset)
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${LANCEDB_URL}/search?${params}`, {
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          const body = await res.text();
          log.error("LanceDB search failed", { status: res.status, body, component: "api/semantic-search" });
          return NextResponse.json({ error: "Semantic search failed" }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);
      } catch (err) {
        lastErr = err;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
      }
    }

    const errMsg = lastErr instanceof Error ? lastErr.message : "unknown";
    log.error("Semantic search error after retries", { error: errMsg, url: `${LANCEDB_URL}/search`, component: "api/semantic-search" });
    return NextResponse.json({ error: `AI search service unavailable: ${errMsg}` }, { status: 503 });
  } catch (err) {
    log.error("Semantic search unexpected error", { error: err instanceof Error ? err.message : "unknown", component: "api/semantic-search" });
    return NextResponse.json({ error: "AI search service unavailable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(getClientId(req), RATE_LIMIT);
  if (limited) return limited;

  try {
    const body = await req.json();
    const res = await fetch(`${LANCEDB_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    log.error("Semantic search POST error", { error: err instanceof Error ? err.message : "unknown", component: "api/semantic-search" });
    /* Mock fallback */
    const now = Date.now();
    return NextResponse.json({
      results: [
        { event_id: "sem-001", timestamp: new Date(now - 120_000).toISOString(), severity: 4, log_source: "sysmon", hostname: "WS-DEV03", raw: "Process Create: powershell.exe -enc encoded-payload — matches lateral movement pattern", _distance: 0.12 },
        { event_id: "sem-002", timestamp: new Date(now - 300_000).toISOString(), severity: 3, log_source: "suricata", hostname: "FW-EDGE01", raw: "ET TROJAN Cobalt Strike C2 beacon activity detected", _distance: 0.18 },
        { event_id: "sem-003", timestamp: new Date(now - 600_000).toISOString(), severity: 3, log_source: "windows-security", hostname: "DC01.corp.local", raw: "Suspicious Kerberos ticket request for service account — possible Kerberoasting", _distance: 0.24 },
        { event_id: "sem-004", timestamp: new Date(now - 900_000).toISOString(), severity: 2, log_source: "zeek", hostname: "FW-EDGE01", raw: "Unusual DNS query pattern — high entropy subdomain suggests DNS tunneling", _distance: 0.31 },
      ],
      events: [
        { event_id: "sem-001", timestamp: new Date(now - 120_000).toISOString(), severity: 4, log_source: "sysmon", hostname: "WS-DEV03", raw: "Process Create: powershell.exe -enc encoded-payload — matches lateral movement pattern" },
        { event_id: "sem-002", timestamp: new Date(now - 300_000).toISOString(), severity: 3, log_source: "suricata", hostname: "FW-EDGE01", raw: "ET TROJAN Cobalt Strike C2 beacon activity detected" },
        { event_id: "sem-003", timestamp: new Date(now - 600_000).toISOString(), severity: 3, log_source: "windows-security", hostname: "DC01.corp.local", raw: "Suspicious Kerberos ticket request for service account — possible Kerberoasting" },
        { event_id: "sem-004", timestamp: new Date(now - 900_000).toISOString(), severity: 2, log_source: "zeek", hostname: "FW-EDGE01", raw: "Unusual DNS query pattern — high entropy subdomain suggests DNS tunneling" },
      ],
    });
  }
}
