import { NextRequest, NextResponse } from "next/server";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8200";

/**
 * POST /api/ai/investigate — Run full 4-agent investigation pipeline
 *
 * Supports modes:
 *  - "features"  → /investigate       (NSL-KDD features)
 *  - "clif"      → /investigate/clif  (CLIF pipeline event)
 *  - "generic"   → /investigate/generic (any log type: Sysmon, auth, firewall…)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event, mode = "features" } = body;

    const endpointMap: Record<string, string> = {
      clif: "/investigate/clif",
      generic: "/investigate/generic",
      features: "/investigate",
    };
    const endpoint = endpointMap[mode] ?? "/investigate";

    const res = await fetch(`${AI_SERVICE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(30000), // 30s — full pipeline can take a moment
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI service error: ${res.status} - ${errText}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Investigation failed" },
      { status: 500 },
    );
  }
}
