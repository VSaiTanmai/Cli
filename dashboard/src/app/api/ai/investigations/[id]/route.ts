import { NextRequest, NextResponse } from "next/server";
import mockInvestigations from "@/lib/mock/investigations.json";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8200";

/* ── Mock detail for a single investigation ── */
function getMockDetail(id: string) {
  const inv = mockInvestigations.cases.find((c) => c.id === id);
  if (!inv) return null;
  const createdMs = new Date(inv.created).getTime();
  const category = inv.tags[0] || "suspicious";
  const technique = inv.tags.find((t) => t.startsWith("T")) || "T1059";
  return {
    ...inv,
    verdict: inv.status === "Closed" ? "true_positive" : inv.status === "In Progress" ? "suspicious" : "pending",
    confidence: 0.87 + Math.random() * 0.1,
    narrative: inv.description,
    mitre_techniques: inv.tags.filter((t) => t.startsWith("T")),
    model_fingerprint: "xgboost-binary-v3.1.0",
    shap_features: [
      { feature: "event_frequency", importance: 0.342 },
      { feature: "sigma_match_count", importance: 0.287 },
      { feature: "time_anomaly_score", importance: -0.131 },
      { feature: "network_bytes_out", importance: 0.198 },
      { feature: "process_tree_depth", importance: 0.176 },
    ],
    attack_chain: [
      { step: 1, technique: inv.tags[1] || "T1059", description: "Initial access detected", timestamp: inv.created },
      { step: 2, technique: inv.tags[0] || "execution", description: "Execution phase observed", timestamp: inv.updated },
    ],
    verifier_checks: [
      { check: "False positive pattern match", status: "pass", detail: "No known FP patterns matched" },
      { check: "Temporal consistency", status: "pass", detail: "Event timeline is consistent" },
      { check: "HMAC chain integrity", status: "pass", detail: "All signatures verified" },
    ],
    feature_vector: { event_count: inv.eventCount, severity: inv.severity, host_count: inv.hosts.length },
    agent_results: [
      {
        agent_name: "Triage Agent",
        status: "completed",
        started_at: new Date(createdMs).toISOString(),
        finished_at: new Date(createdMs + 1200).toISOString(),
        duration_ms: 1200,
        result_summary: `Classified as ${category} — severity ${inv.severity}`,
        findings: {
          classification: category,
          severity: inv.severity,
          confidence: 0.94,
          classifier_used: "xgboost-binary-v3.1.0",
          mitre_tactic: inv.tags[0] || "execution",
          mitre_technique: technique,
          explanation: `Event pattern matched ${category} behavior with high confidence. ${inv.eventCount} events analyzed in initial triage scan.`,
          xai_top_features: [
            { feature: "event_frequency", importance: 0.342, direction: "increases risk" },
            { feature: "sigma_match_count", importance: 0.287, direction: "increases risk" },
            { feature: "time_anomaly_score", importance: -0.131, direction: "decreases risk" },
          ],
        },
      },
      {
        agent_name: "Hunter Agent",
        status: "completed",
        started_at: new Date(createdMs + 1200).toISOString(),
        finished_at: new Date(createdMs + 4800).toISOString(),
        duration_ms: 3600,
        result_summary: `Correlated ${inv.eventCount} events across ${inv.hosts.length} host(s)`,
        findings: {
          correlated_events: inv.eventCount,
          affected_hosts: inv.hosts,
          affected_users: inv.users,
          mitre_techniques: inv.tags.filter((t: string) => t.startsWith("T")),
          attack_chain: [
            { step: 1, technique: technique, description: "Initial activity detected on source host", host: inv.hosts[0] || "unknown" },
            { step: 2, technique: inv.tags[0] || "execution", description: "Behavioral pattern confirmed via correlated events", host: inv.hosts[inv.hosts.length - 1] || "unknown" },
          ],
          hunt_queries_run: 6,
          iocs_found: Math.min(inv.eventCount, 12),
        },
      },
      {
        agent_name: "Verifier Agent",
        status: inv.status === "Open" ? "pending" : "completed",
        started_at: inv.status === "Open" ? undefined : new Date(createdMs + 4800).toISOString(),
        finished_at: inv.status === "Open" ? undefined : new Date(createdMs + 6500).toISOString(),
        duration_ms: inv.status === "Open" ? undefined : 1700,
        result_summary: inv.status === "Open"
          ? "Awaiting Hunter Agent completion"
          : "All integrity checks passed — HMAC chain verified, report generated",
        findings: inv.status === "Open" ? undefined : {
          verdict: inv.status === "Closed" ? "true_positive" : "suspicious",
          adjusted_confidence: 0.91,
          false_positive_score: 0.06,
          checks_performed: 3,
          checks_passed: 3,
          checks_failed: 0,
          evidence_summary: `Verified ${inv.eventCount} events across ${inv.hosts.length} host(s). All HMAC chains intact. Temporal consistency confirmed.`,
          recommendation: inv.status === "Closed"
            ? "Confirmed true positive. Containment actions recommended."
            : "Suspicious activity confirmed. Continue monitoring and escalate if pattern persists.",
          report_generated: true,
        },
      },
    ],
  };
}

/**
 * GET /api/ai/investigations/[id] — Fetch a specific investigation by ID
 * Also handles [id]="list" to return all investigations
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;

  /* Handle "list" as a special pseudo-ID for the investigations list page */
  if (id === "list") {
    try {
      const res = await fetch(`${AI_SERVICE_URL}/agents/investigations?limit=50`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
      throw new Error("AI service unavailable");
    } catch {
      return NextResponse.json({
        investigations: mockInvestigations.cases.map((c) => ({
          ...c,
          status: c.status.toLowerCase().replace(/ /g, "-"),
        })),
      });
    }
  }

  /* Single investigation detail */
  try {
    const res = await fetch(
      `${AI_SERVICE_URL}/agents/investigations/${id}`,
      { cache: "no-store", signal: AbortSignal.timeout(10000) },
    );

    if (res.status === 404) {
      return NextResponse.json({ error: "Investigation not found" }, { status: 404 });
    }
    if (!res.ok) throw new Error(`AI service error: ${res.status}`);

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    /* Fallback to mock data */
    const mock = getMockDetail(id);
    if (mock) return NextResponse.json(mock);

    return NextResponse.json(
      { error: "Investigation not found" },
      { status: 404 },
    );
  }
}
