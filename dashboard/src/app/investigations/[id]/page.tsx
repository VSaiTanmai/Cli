"use client";

import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { severityLabel, timeAgo, formatNumber } from "@/lib/utils";
import {
  ArrowLeft,
  Clock,
  User,
  Monitor,
  Tag,
  FileText,
  Shield,
  Network,
  Activity,
} from "lucide-react";
import investigationsData from "@/lib/mock/investigations.json";
import type { Investigation } from "@/lib/types";

const cases = investigationsData.cases as Investigation[];

const SEVERITY_VARIANT: Record<number, "critical" | "high" | "medium" | "low" | "info"> = {
  4: "critical",
  3: "high",
  2: "medium",
  1: "low",
  0: "info",
};

const STATUS_COLORS: Record<string, string> = {
  "Open": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "In Progress": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Closed": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

// Mock timeline events for the investigation detail view
const MOCK_TIMELINE = [
  { time: "10:58:00", event: "Triage Agent classified as lateral movement (confidence: 0.96)" },
  { time: "10:57:00", event: "Hunter Agent traced authentication chain — 3 hops confirmed" },
  { time: "10:52:00", event: "Escalation Agent elevated severity to Critical" },
  { time: "10:45:00", event: "Verifier Agent confirmed as true positive — no FP patterns matched" },
  { time: "10:30:00", event: "Reporter Agent generated technical analysis report" },
  { time: "10:15:00", event: "Alert initially triaged by Triage Agent" },
  { time: "10:00:00", event: "Security event detected by CLIF pipeline" },
];

export default function InvestigationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const investigation = cases.find((c) => c.id === params.id);
  if (!investigation) return notFound();

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <Link
          href="/investigations"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Investigations
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Badge variant={SEVERITY_VARIANT[investigation.severity] ?? "info"}>
                {severityLabel(investigation.severity)}
              </Badge>
              <span className="font-mono text-sm text-muted-foreground">
                {investigation.id}
              </span>
              <span
                className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${
                  STATUS_COLORS[investigation.status] ?? ""
                }`}
              >
                {investigation.status}
              </span>
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight">
              {investigation.title}
            </h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1">
              <FileText className="h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" className="gap-1">
              <Shield className="h-3.5 w-3.5" /> Contain
            </Button>
          </div>
        </div>
      </div>

      {/* Meta Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <User className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Assignee
              </p>
              <p className="text-sm font-medium">{investigation.assignee}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Last Updated
              </p>
              <p className="text-sm font-medium">{timeAgo(investigation.updated)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Events
              </p>
              <p className="text-sm font-medium tabular-nums">
                {formatNumber(investigation.eventCount)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Monitor className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Hosts
              </p>
              <p className="text-sm font-medium">
                {investigation.hosts.join(", ")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Description + Tags — 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Description</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {investigation.description}
            </p>
            <Separator />
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                MITRE ATT&CK TTPs
              </p>
              <div className="flex flex-wrap gap-1.5">
                {investigation.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs"
                  >
                    <Tag className="h-3 w-3 text-primary" />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Affected Users
              </p>
              <div className="flex flex-wrap gap-1.5">
                {investigation.users.map((u) => (
                  <Badge key={u} variant="outline" className="font-mono text-xs">
                    {u}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Affected Hosts
              </p>
              <div className="flex flex-wrap gap-1.5">
                {investigation.hosts.map((h) => (
                  <Badge key={h} variant="outline" className="font-mono text-xs">
                    <Network className="mr-1 h-3 w-3" />
                    {h}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Investigation Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4 text-primary" />
              AI Investigation Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative space-y-4">
              {/* Vertical line */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
              {MOCK_TIMELINE.map((item, idx) => (
                <div key={idx} className="relative flex gap-3 pl-0">
                  <div className="relative z-10 mt-1.5">
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-primary bg-card" />
                  </div>
                  <div className="flex-1">
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {item.time}
                    </p>
                    <p className="text-xs leading-relaxed">{item.event}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
