import { NextRequest, NextResponse } from "next/server";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8200";

/**
 * POST /api/ai/chat — Chat with CLIF AI assistant (Ollama qwen model)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const res = await fetch(`${AI_SERVICE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(65000), // 65s — LLM can be slow
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI service error: ${res.status} - ${errText}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    const mockResponses: Record<string, string> = {
      default:
        "Based on my analysis of the current CLIF telemetry, I can see **356 events processed** across the pipeline in the last hour. The Triage Agent flagged 12 events as suspicious — 3 matched Sigma rules for credential access (T1003) and the remaining 9 showed anomalous lateral movement patterns.\n\nThe Hunter Agent escalated 2 cases for deeper investigation:\n- **INV-2026-001**: Potential supply-chain compromise via a modified npm package\n- **INV-2026-003**: Unusual PowerShell execution chain from a service account\n\nI recommend reviewing the attack graph for INV-2026-001 first, as it has the highest confidence score (0.94).",
      threat:
        "Current threat landscape shows **3 active IOCs** matching known APT groups. Top threat: APT-Ember (confidence 0.91) — targeting cloud infrastructure with novel credential harvesting. The MITRE ATT&CK heatmap highlights increased activity in **Initial Access (T1190)** and **Execution (T1059)**. I suggest tightening WAF rules and enabling enhanced logging on internet-facing assets.",
      investigation:
        "Investigation summary for INV-2026-001:\n- **Verdict**: Malicious (confidence 92%)\n- **Attack chain**: 4 stages detected — initial access via phishing → code execution → persistence via scheduled task → data exfiltration attempt\n- **SHAP analysis**: Top contributing features are `event_frequency` (0.342) and `sigma_match_count` (0.287)\n- **Verifier status**: All 5 checks passed ✓",
    };

    return NextResponse.json({
      response: mockResponses.default,
      model: "clif-ai-v3 (mock)",
      confidence: 0.85,
      sources: ["CLIF Telemetry", "Sigma Rules v2.1", "MITRE ATT&CK v14"],
    });
  }
}
