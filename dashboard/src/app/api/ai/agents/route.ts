import { NextResponse } from "next/server";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8200";

/**
 * GET /api/ai/agents — Get status of all AI agents + recent investigations
 */
export async function GET() {
  try {
    const [statusRes, invRes] = await Promise.all([
      fetch(`${AI_SERVICE_URL}/agents/status`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${AI_SERVICE_URL}/agents/investigations?limit=20`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    if (!statusRes.ok) throw new Error(`Agent status: ${statusRes.status}`);

    const status = await statusRes.json();
    const investigations = invRes.ok ? await invRes.json() : { investigations: [] };

    return NextResponse.json({
      ...status,
      investigations: investigations.investigations ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        agents: [],
        total_agents: 0,
        investigations: [],
        error: e.message || "AI service unreachable",
      },
      { status: 503 },
    );
  }
}
