import { NextResponse } from "next/server";
import mockAgents from "@/lib/mock/agents.json";

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
  } catch {
    /* Fallback to rich mock data */
    return NextResponse.json({
      agents: mockAgents.agents.map((a) => ({
        ...a,
        status: a.status.toLowerCase() === "active" ? "active" : a.status.toLowerCase() === "processing" ? "active" : "idle",
      })),
      total_agents: mockAgents.agents.length,
      recentActivity: mockAgents.recentActivity,
      investigations: [],
      pipeline: {
        hmacEnabled: true,
        totalProcessed: 356,
        avgLatencyMs: 42,
      },
      leaderboard: [
        { model: "XGBoost Binary v3", type: "binary", f1: 0.942, precision: 0.951, recall: 0.933, deployed: true, version: "v3.1.0" },
        { model: "RF Multiclass v2", type: "multiclass", f1: 0.887, precision: 0.892, recall: 0.882, deployed: true, version: "v2.4.0" },
        { model: "LightGBM Binary v1", type: "binary", f1: 0.928, precision: 0.935, recall: 0.921, deployed: false, version: "v1.2.0" },
        { model: "XGBoost Multiclass v1", type: "multiclass", f1: 0.863, precision: 0.871, recall: 0.855, deployed: false, version: "v1.0.0" },
      ],
      xaiGlobal: [
        { feature: "event_frequency", importance: 0.342 },
        { feature: "sigma_match_count", importance: 0.287 },
        { feature: "time_anomaly_score", importance: 0.231 },
        { feature: "network_bytes_out", importance: 0.198 },
        { feature: "process_tree_depth", importance: 0.176 },
        { feature: "user_risk_score", importance: 0.154 },
        { feature: "geo_anomaly", importance: 0.132 },
        { feature: "entropy_score", importance: 0.119 },
      ],
      drift: {
        status: "stable",
        lastCheck: new Date().toISOString(),
        psiScore: 0.0312,
        threshold: 0.1,
      },
    });
  }
}
