"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Shield,
  Clock,
  User,
  Tag,
  Copy,
  Download,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Brain,
  FileText,
  BarChart3,
  Activity,
  Server,
  Fingerprint,
  Target,
  Bot,
  Play,
  Loader2,
  ChevronRight,
  Crosshair,
  Search,
  Zap,
  Hash,
  MonitorDot,
  Network,
  TrendingUp,
  ShieldCheck,
  FileCheck,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { timeAgo, severityLabel, cn } from "@/lib/utils";
import { toast } from "sonner";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface InvestigationDetail {
  id: string;
  title: string;
  status: string;
  severity: number;
  created: string;
  updated: string;
  assignee: string;
  eventCount: number;
  description: string;
  tags: string[];
  hosts: string[];
  users: string[];
  verdict?: string;
  confidence?: number;
  category?: string;
  narrative?: string;
  mitre_techniques?: string[];
  model_fingerprint?: string;
  shap_features?: Array<{ feature: string; importance: number }>;
  attack_chain?: Array<{ step: number; technique: string; description: string; timestamp: string }>;
  verifier_checks?: Array<{ check: string; status: string; detail: string }>;
  feature_vector?: Record<string, number>;
  agent_results?: Array<{
    agent_name: string;
    status: string;
    started_at?: string;
    finished_at?: string;
    duration_ms?: number;
    result_summary?: string;
    error?: string;
    findings?: any;
  }>;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const variants: Record<string, { variant: "success" | "destructive" | "warning" | "info"; icon: React.ElementType }> = {
    "TRUE POSITIVE": { variant: "destructive", icon: AlertTriangle },
    "FALSE POSITIVE": { variant: "success", icon: CheckCircle },
    "SUSPICIOUS": { variant: "warning", icon: AlertTriangle },
    "BENIGN": { variant: "success", icon: CheckCircle },
  };
  const v = variants[verdict.toUpperCase()] || { variant: "info" as const, icon: Shield };
  const Icon = v.icon;

  return (
    <Badge variant={v.variant} className="gap-1 px-3 py-1 text-sm">
      <Icon className="h-3.5 w-3.5" />
      {verdict}
    </Badge>
  );
}

const AGENT_META: Record<string, { icon: React.ElementType; color: string; bg: string; border: string; label: string; description: string }> = {
  "Triage Agent": { icon: Crosshair, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Triage Agent", description: "Classifies events, assigns severity, identifies MITRE tactics" },
  "Hunter Agent": { icon: Search, color: "text-nexus-cyan", bg: "bg-cyan-500/10", border: "border-cyan-500/30", label: "Hunter Agent", description: "Correlates events, discovers attack chains, hunts for IOCs" },
  "Verifier Agent": { icon: ShieldCheck, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", label: "Verifier Agent", description: "Validates integrity, calibrates confidence, generates report" },
};

/* ─── Triage Findings Card ─── */
function TriageFindings({ findings }: { findings: any }) {
  if (!findings) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Classification</p>
          <p className="mt-1 text-sm font-bold text-foreground capitalize">{findings.classification}</p>
        </div>
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Severity</p>
          <p className="mt-1 text-sm font-bold text-foreground">{severityLabel(findings.severity)}</p>
        </div>
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Confidence</p>
          <p className="mt-1 text-sm font-bold text-foreground">{(findings.confidence * 100).toFixed(0)}%</p>
        </div>
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Model</p>
          <p className="mt-1 text-xs font-mono text-foreground truncate">{findings.classifier_used?.split("-").slice(0, 2).join("-")}</p>
        </div>
      </div>
      {findings.mitre_tactic && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">MITRE:</span>
          <Badge variant="purple" className="text-2xs">{findings.mitre_tactic}</Badge>
          {findings.mitre_technique && <Badge variant="cyan" className="text-2xs">{findings.mitre_technique}</Badge>}
        </div>
      )}
      {findings.explanation && <p className="text-xs leading-relaxed text-foreground/80">{findings.explanation}</p>}
      {findings.xai_top_features && findings.xai_top_features.length > 0 && (
        <div>
          <p className="text-2xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Top XAI Features</p>
          <div className="space-y-1.5">
            {findings.xai_top_features.map((f: any) => (
              <div key={f.feature} className="flex items-center gap-2">
                <span className="w-32 truncate font-mono text-2xs text-muted-foreground">{f.feature}</span>
                <div className="flex-1 h-2 rounded bg-muted/30 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${Math.abs(f.importance) * 100 * 2.5}%`, background: f.direction === "increases risk" ? "rgba(251,191,36,0.7)" : "rgba(52,211,153,0.7)" }} />
                </div>
                <span className={cn("text-2xs w-28 text-right", f.direction === "increases risk" ? "text-amber-400" : "text-emerald-400")}>{f.direction}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Hunter Findings Card ─── */
function HunterFindings({ findings }: { findings: any }) {
  if (!findings) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Events Correlated</p>
          <p className="mt-1 text-lg font-bold text-foreground">{findings.correlated_events}</p>
        </div>
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">IOCs Found</p>
          <p className="mt-1 text-lg font-bold text-foreground">{findings.iocs_found}</p>
        </div>
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Hunt Queries</p>
          <p className="mt-1 text-lg font-bold text-foreground">{findings.hunt_queries_run}</p>
        </div>
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">MITRE Techniques</p>
          <p className="mt-1 text-lg font-bold text-foreground">{findings.mitre_techniques?.length || 0}</p>
        </div>
      </div>
      {(findings.affected_hosts?.length > 0 || findings.affected_users?.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {findings.affected_hosts?.length > 0 && (
            <div>
              <p className="text-2xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Affected Hosts</p>
              <div className="flex flex-wrap gap-1">
                {findings.affected_hosts.map((h: string) => <Badge key={h} variant="ghost" className="text-2xs font-mono"><Server className="mr-0.5 h-2 w-2" />{h}</Badge>)}
              </div>
            </div>
          )}
          {findings.affected_users?.length > 0 && (
            <div>
              <p className="text-2xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Affected Users</p>
              <div className="flex flex-wrap gap-1">
                {findings.affected_users.map((u: string) => <Badge key={u} variant="ghost" className="text-2xs font-mono"><User className="mr-0.5 h-2 w-2" />{u}</Badge>)}
              </div>
            </div>
          )}
        </div>
      )}
      {findings.attack_chain && findings.attack_chain.length > 0 && (
        <div>
          <p className="text-2xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Attack Chain Discovered</p>
          <div className="relative space-y-2 pl-5">
            {findings.attack_chain.map((step: any, i: number) => (
              <div key={i} className="relative">
                {i < findings.attack_chain.length - 1 && <div className="absolute left-[-12px] top-5 h-full w-px bg-nexus-cyan/30" />}
                <div className="flex items-start gap-2">
                  <div className="absolute left-[-16px] flex h-4 w-4 items-center justify-center rounded-full border border-nexus-cyan bg-cyan-500/20 text-2xs font-bold text-nexus-cyan">{step.step}</div>
                  <div className="flex-1 rounded-md border border-border/50 bg-card/50 p-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="cyan" className="text-2xs">{step.technique}</Badge>
                      <span className="text-2xs text-muted-foreground font-mono">{step.host}</span>
                    </div>
                    <p className="mt-0.5 text-2xs text-foreground/80">{step.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Verifier Findings Card ─── */
function VerifierFindings({ findings }: { findings: any }) {
  if (!findings) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Verdict</p>
          <p className="mt-1 text-sm font-bold text-foreground capitalize">{findings.verdict?.replace("_", " ")}</p>
        </div>
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Confidence</p>
          <p className="mt-1 text-sm font-bold text-foreground">{(findings.adjusted_confidence * 100).toFixed(0)}%</p>
        </div>
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Checks Passed</p>
          <p className="mt-1 text-sm font-bold text-emerald-400">{findings.checks_passed}/{findings.checks_performed}</p>
        </div>
        <div className="rounded-md bg-muted/20 p-2.5 text-center">
          <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">FP Score</p>
          <p className="mt-1 text-sm font-bold text-foreground">{(findings.false_positive_score * 100).toFixed(0)}%</p>
        </div>
      </div>
      {findings.evidence_summary && <p className="text-xs leading-relaxed text-foreground/80">{findings.evidence_summary}</p>}
      {findings.recommendation && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-2xs font-medium text-emerald-400 uppercase tracking-wider mb-1">Recommendation</p>
          <p className="text-xs text-foreground/90">{findings.recommendation}</p>
        </div>
      )}
      {findings.report_generated && (
        <div className="flex items-center gap-2 text-xs text-emerald-400">
          <FileCheck className="h-3.5 w-3.5" />
          <span>Investigation report generated</span>
        </div>
      )}
    </div>
  );
}

/* ─── Full AI Analysis Section ─── */
function AIAgentAnalysis({ agents, onRerun, agentRunning }: {
  agents: Array<{ agent_name: string; status: string; started_at?: string; finished_at?: string; duration_ms?: number; result_summary?: string; error?: string; findings?: any }>;
  onRerun: () => void;
  agentRunning: boolean;
}) {
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    agents.forEach((a) => { initial[a.agent_name] = true; });
    return initial;
  });

  const toggleAgent = (name: string) => {
    setExpandedAgents((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const totalDuration = agents.reduce((sum, a) => sum + (a.duration_ms || 0), 0);
  const completedCount = agents.filter((a) => a.status === "completed").length;

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-b from-primary/5 to-transparent p-1">
      {/* Section Header */}
      <div className="rounded-t-lg bg-primary/10 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20 ring-2 ring-primary/30">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                AI-Powered Analysis
                <Badge variant="cyan" className="text-2xs font-normal">3-Agent Pipeline</Badge>
              </h2>
              <p className="text-xs text-muted-foreground">
                {completedCount}/{agents.length} agents completed
                {totalDuration > 0 && <> &middot; Total: {(totalDuration / 1000).toFixed(1)}s</>}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onRerun} disabled={agentRunning} className="gap-1.5">
            {agentRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Re-run Pipeline
          </Button>
        </div>

        {/* Pipeline Flow Visualization */}
        <div className="mt-4 flex items-center gap-0">
          {agents.map((agent, i) => {
            const meta = AGENT_META[agent.agent_name] || { icon: Bot, color: "text-muted-foreground", bg: "bg-muted/20", border: "border-border", label: agent.agent_name, description: "" };
            const AgentIcon = meta.icon;
            const completed = agent.status === "completed";
            const pending = agent.status === "pending";
            const failed = agent.status === "failed" || agent.status === "error";
            const running = agent.status === "running" || agent.status === "in_progress";

            return (
              <React.Fragment key={agent.agent_name}>
                {i > 0 && (
                  <div className="flex items-center px-1">
                    <div className={cn("h-px w-6 sm:w-10", completed ? "bg-emerald-400/60" : "bg-muted-foreground/20")} />
                    <ChevronRight className={cn("h-3.5 w-3.5 -ml-1", completed ? "text-emerald-400/60" : "text-muted-foreground/20")} />
                  </div>
                )}
                <div className={cn(
                  "flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 transition-all",
                  completed ? "border-emerald-500/40 bg-emerald-500/10" :
                  failed ? "border-destructive/40 bg-destructive/10" :
                  running ? "border-primary/40 bg-primary/10" :
                  "border-muted-foreground/20 bg-muted/10"
                )}>
                  <AgentIcon className={cn("h-4 w-4 shrink-0", meta.color)} />
                  <span className="text-xs font-semibold text-foreground truncate">{meta.label}</span>
                  <span className="ml-auto shrink-0">
                    {completed && <CheckCircle className="h-4 w-4 text-emerald-400" />}
                    {failed && <XCircle className="h-4 w-4 text-destructive" />}
                    {running && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
                    {pending && <Clock className="h-4 w-4 text-muted-foreground" />}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Agent Detail Sections */}
      <div className="space-y-1 p-1">
        {agents.map((agent) => {
          const meta = AGENT_META[agent.agent_name] || { icon: Bot, color: "text-muted-foreground", bg: "bg-muted/20", border: "border-border", label: agent.agent_name, description: "" };
          const AgentIcon = meta.icon;
          const completed = agent.status === "completed";
          const expanded = expandedAgents[agent.agent_name] ?? true;

          return (
            <div key={agent.agent_name} className={cn("rounded-lg border transition-all", meta.border, expanded ? meta.bg : "bg-transparent")}>
              {/* Collapsible Header */}
              <button onClick={() => toggleAgent(agent.agent_name)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/10 rounded-lg transition-colors">
                <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", meta.bg)}>
                  <AgentIcon className={cn("h-4 w-4", meta.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{meta.label}</span>
                    <Badge variant={completed ? "success" : agent.status === "pending" ? "ghost" : "warning"} className="text-2xs">
                      {agent.status}
                    </Badge>
                    {agent.duration_ms !== undefined && (
                      <span className="text-2xs font-mono text-muted-foreground">{(agent.duration_ms / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                  <p className="text-2xs text-muted-foreground truncate">{agent.result_summary || meta.description}</p>
                </div>
                {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>

              {/* Expanded Content */}
              {expanded && (
                <div className="px-4 pb-4 pt-1">
                  <Separator className="mb-3" />
                  {agent.agent_name === "Triage Agent" && <TriageFindings findings={agent.findings} />}
                  {agent.agent_name === "Hunter Agent" && <HunterFindings findings={agent.findings} />}
                  {agent.agent_name === "Verifier Agent" && <VerifierFindings findings={agent.findings} />}
                  {!agent.findings && agent.result_summary && (
                    <p className="text-xs text-muted-foreground">{agent.result_summary}</p>
                  )}
                  {agent.error && (
                    <div className="mt-2 rounded-md bg-destructive/10 border border-destructive/30 p-2">
                      <p className="text-xs text-destructive">{agent.error}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function InvestigationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [data, setData] = useState<InvestigationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("narrative");
  const [agentRunning, setAgentRunning] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/ai/investigations/${encodeURIComponent(id)}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch {} finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const rerunAgents = async () => {
    if (!data || agentRunning) return;
    setAgentRunning(true);
    toast.info("Re-running AI agent pipeline…");
    try {
      const res = await fetch("/api/ai/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: { investigation_id: data.id, title: data.title, events: data.eventCount }, mode: "clif" }),
      });
      if (res.ok) {
        toast.success("AI pipeline completed — refreshing results");
        // Re-fetch updated investigation
        const updated = await fetch(`/api/ai/investigations/${encodeURIComponent(id)}`);
        if (updated.ok) setData(await updated.json());
      } else {
        toast.error("AI pipeline returned an error");
      }
    } catch {
      toast.error("Could not reach AI service");
    } finally {
      setAgentRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64 rounded" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="text-center">
          <XCircle className="mx-auto h-8 w-8 text-destructive" />
          <p className="mt-2 text-sm text-muted-foreground">Investigation not found</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push("/investigations")}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
          </Button>
        </div>
      </div>
    );
  }

  const getSevVariant = (sev: number) => {
    if (sev >= 4) return "critical" as const;
    if (sev >= 3) return "high" as const;
    if (sev >= 2) return "medium" as const;
    if (sev >= 1) return "low" as const;
    return "info" as const;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push("/investigations")} className="mb-2">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Investigations
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-foreground">{data.title}</h1>
            <Badge variant={getSevVariant(data.severity)}>{severityLabel(data.severity)}</Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">{data.id}</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Created {timeAgo(data.created)}</span>
            <span className="flex items-center gap-1"><User className="h-3 w-3" /> {data.assignee}</span>
            <span>{data.eventCount} events</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.verdict && <VerdictBadge verdict={data.verdict} />}
          {data.confidence !== undefined && (
            <Badge variant="cyan" className="text-sm">{data.confidence.toFixed(1)}% confidence</Badge>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(data.id); toast.success("Investigation ID copied"); }}>
          <Copy className="mr-1 h-3 w-3" /> Copy ID
        </Button>
        <Button variant="outline" size="sm"><Download className="mr-1 h-3 w-3" /> Download Report</Button>
        <Button variant="outline" size="sm"><RefreshCw className="mr-1 h-3 w-3" /> Re-run Pipeline</Button>
        {data.tags.map((tag) => (
          <Badge key={tag} variant="ghost" className="text-2xs"><Tag className="mr-0.5 h-2 w-2" /> {tag}</Badge>
        ))}
      </div>

      {/* AI Agent Pipeline */}
      {data.agent_results && data.agent_results.length > 0 && (
        <AIAgentAnalysis agents={data.agent_results} onRerun={rerunAgents} agentRunning={agentRunning} />
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="narrative">Incident Narrative</TabsTrigger>
              <TabsTrigger value="shap">SHAP Analysis</TabsTrigger>
              <TabsTrigger value="attack-chain">Attack Chain</TabsTrigger>
              <TabsTrigger value="raw">Feature Vector</TabsTrigger>
            </TabsList>

            <TabsContent value="narrative">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Incident Narrative</CardTitle>
                  <CardDescription>Generated by Verifier Agent analysis</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-relaxed text-foreground/90">{data.narrative || data.description}</p>
                  {(data.category || data.mitre_techniques?.length || data.model_fingerprint) && (
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                      {data.category && <Badge variant="purple"><Target className="mr-0.5 h-2.5 w-2.5" />{data.category}</Badge>}
                      {data.mitre_techniques?.map((t) => <Badge key={t} variant="cyan" className="text-2xs">{t}</Badge>)}
                      {data.model_fingerprint && <Badge variant="ghost" className="text-2xs font-mono"><Fingerprint className="mr-0.5 h-2.5 w-2.5" />{data.model_fingerprint.slice(0, 12)}</Badge>}
                    </div>
                  )}
                  {(data.hosts.length > 0 || data.users.length > 0) && (
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                      {data.hosts.length > 0 && (
                        <div>
                          <p className="text-2xs font-medium text-muted-foreground mb-1">HOSTS</p>
                          <div className="flex flex-wrap gap-1">
                            {data.hosts.map((h) => <Badge key={h} variant="ghost" className="text-2xs font-mono"><Server className="mr-0.5 h-2 w-2" />{h}</Badge>)}
                          </div>
                        </div>
                      )}
                      {data.users.length > 0 && (
                        <div>
                          <p className="text-2xs font-medium text-muted-foreground mb-1">USERS</p>
                          <div className="flex flex-wrap gap-1">
                            {data.users.map((u) => <Badge key={u} variant="ghost" className="text-2xs font-mono"><User className="mr-0.5 h-2 w-2" />{u}</Badge>)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="shap">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-nexus-cyan" /> SHAP Global Feature Importance</CardTitle></CardHeader>
                <CardContent>
                  {data.shap_features?.length ? (
                    <div className="space-y-2">
                      {data.shap_features.slice(0, 15).map((f) => {
                        const maxImp = Math.max(...data.shap_features!.map((x) => Math.abs(x.importance)));
                        const pct = maxImp > 0 ? (Math.abs(f.importance) / maxImp) * 100 : 0;
                        return (
                          <div key={f.feature} className="flex items-center gap-3">
                            <span className="w-36 truncate font-mono text-xs text-muted-foreground">{f.feature}</span>
                            <div className="flex-1 h-4 rounded bg-muted/30 overflow-hidden">
                              <div className="h-full rounded transition-all duration-500" style={{ width: `${pct}%`, background: f.importance >= 0 ? "rgba(6,182,212,0.6)" : "rgba(239,68,68,0.6)" }} />
                            </div>
                            <span className="w-16 text-right font-mono text-xs text-foreground">{f.importance.toFixed(4)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="text-xs text-muted-foreground">SHAP analysis not available for this investigation</p>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="attack-chain">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-nexus-purple" /> Attack Chain Timeline</CardTitle></CardHeader>
                <CardContent>
                  {data.attack_chain?.length ? (
                    <div className="relative space-y-4 pl-6">
                      {data.attack_chain.map((step, i) => (
                        <div key={i} className="relative">
                          {i < data.attack_chain!.length - 1 && <div className="timeline-connector" />}
                          <div className="flex items-start gap-3">
                            <div className="absolute left-[-20px] flex h-4 w-4 items-center justify-center rounded-full border border-nexus-purple bg-nexus-purple/20 text-2xs font-bold text-nexus-purple">{step.step}</div>
                            <div className="flex-1 rounded-md border border-border bg-card p-3">
                              <div className="flex items-center gap-2">
                                <Badge variant="purple" className="text-2xs">{step.technique}</Badge>
                                <span className="text-2xs text-muted-foreground">{step.timestamp}</span>
                              </div>
                              <p className="mt-1 text-xs text-foreground/80">{step.description}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-muted-foreground">No attack chain constructed</p>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="raw">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Fingerprint className="h-4 w-4 text-muted-foreground" /> Feature Vector</CardTitle></CardHeader>
                <CardContent>
                  {data.feature_vector ? (
                    <ScrollArea className="h-64">
                      <pre className="clif-mono whitespace-pre-wrap text-xs text-foreground/80">{JSON.stringify(data.feature_vector, null, 2)}</pre>
                    </ScrollArea>
                  ) : <p className="text-xs text-muted-foreground">Feature vector not available</p>}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Shield className="h-4 w-4 text-primary" /> Verifier Checks</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {data.verifier_checks?.length ? data.verifier_checks.map((check) => (
                <div key={check.check} className="flex items-start gap-2 rounded-md bg-muted/20 p-2">
                  {check.status === "pass" ? <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> : check.status === "fail" ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />}
                  <div className="flex-1"><p className="text-xs font-medium text-foreground">{check.check}</p><p className="text-2xs text-muted-foreground">{check.detail}</p></div>
                </div>
              )) : <p className="text-xs text-muted-foreground">No verifier checks</p>}
            </CardContent>
          </Card>

          {data.confidence !== undefined && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Confidence Calibration</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="flex-1"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${data.confidence}%`, background: data.confidence >= 90 ? "#10b981" : data.confidence >= 70 ? "#06b6d4" : data.confidence >= 50 ? "#f59e0b" : "#ef4444" }} /></div></div>
                  <span className="font-mono text-sm font-bold text-foreground">{data.confidence.toFixed(1)}%</span>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant="secondary" className="text-2xs">{data.status}</Badge></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Updated</span><span className="text-foreground">{timeAgo(data.updated)}</span></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Events</span><span className="font-mono text-foreground">{data.eventCount}</span></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Hosts</span><span className="font-mono text-foreground">{data.hosts.length}</span></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Users</span><span className="font-mono text-foreground">{data.users.length}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
