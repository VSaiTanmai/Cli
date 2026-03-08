import { NextResponse } from "next/server";
import mockInvestigations from "@/lib/mock/investigations.json";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8200";

/**
 * GET /api/ai/investigations/list — Return all investigations
 * Tries the real AI service first; falls back to mock data.
 */
export async function GET() {
  try {
    const res = await fetch(`${AI_SERVICE_URL}/investigations?limit=50`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`AI service responded ${res.status}`);

    const data = await res.json();
    return NextResponse.json({
      investigations: data.investigations ?? data.cases ?? [],
    });
  } catch {
    /* Fallback — serve mock investigations */
    const investigations = mockInvestigations.cases.map((inv) => ({
      id: inv.id,
      title: inv.title,
      status: inv.status,
      severity: inv.severity,
      created: inv.created,
      updated: inv.updated,
      assignee: inv.assignee,
      eventCount: inv.eventCount,
      description: inv.description,
      tags: inv.tags,
      hosts: inv.hosts,
      users: inv.users,
    }));

    return NextResponse.json({
      investigations,
      total: investigations.length,
      open: investigations.filter((i) => i.status === "Open").length,
      in_progress: investigations.filter((i) => i.status === "In Progress").length,
      closed: investigations.filter((i) => i.status === "Closed").length,
    });
  }
}
