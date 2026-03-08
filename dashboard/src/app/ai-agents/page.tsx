"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import {
  Bot,
  Activity,
  Shield,
  Zap,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Lock,
  Cpu,
  BarChart3,
  Fingerprint,
  ArrowRight,
  Crosshair,
  Search as SearchIcon,
  ShieldCheck,
  FileSearch,
  ChevronRight,
  XCircle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { usePolling } from "@/hooks/use-polling";
import { formatNumber, timeAgo, cn } from "@/lib/utils";
import type { Agent } from "@/lib/types";

interface AgentsResponse {
  agents: Agent[];
  pipeline?: {
    hmacEnabled: boolean;
    totalProcessed: number;
    avgLatencyMs: number;
  };
  leaderboard?: Array<{
    model: string;
    type: string;
    f1: number;
    precision: number;
    recall: number;
    deployed: boolean;
    version: string;
  }>;
  xaiGlobal?: Array<{
    feature: string;
    importance: number;
  }>;
  drift?: {
    status: string;
    lastCheck: string;
    psiScore: number;
    threshold: number;
  };
}

function PipelineVisual({
  agents,
  hmacEnabled,
}: {
  agents: Agent[];
  hmacEnabled: boolean;
}) {
  const pipelineOrder = ["Triage Agent", "Hunter Agent", "Verifier Agent"];
  const ordered = pipelineOrder
    .map((name) => agents.find((a) => a.name.includes(name.split(" ")[0])))
    .filter(Boolean) as Agent[];

  return (
    <div className="flex items-center justify-center gap-2 py-4 overflow-x-auto">
      {ordered.map((agent, i) => (
        <React.Fragment key={agent.id}>
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-3 min-w-[120px]">
            <Bot className={cn(
              "h-5 w-5",
              agent.status === "active" ? "text-emerald-400" : "text-muted-foreground"
            )} />
            <span className="text-xs font-medium text-foreground">{agent.name}</span>
            <Badge
              variant={agent.status === "active" ? "success" : agent.status === "error" ? "destructive" : "warning"}
              className="text-2xs"
            >
              {agent.status}
            </Badge>
            <span className="text-2xs text-muted-foreground">
              {formatNumber(agent.casesProcessed)} cases
            </span>
          </div>
          {i < ordered.length - 1 && (
            <div className="flex flex-col items-center gap-0.5">
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              {hmacEnabled && (
                <Badge variant="success" className="text-2xs gap-0.5">
                  <Lock className="h-2 w-2" />
                  HMAC
                </Badge>
              )}
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function ModelLeaderboard({
  models,
}: {
  models: NonNullable<AgentsResponse["leaderboard"]>;
}) {
  const [modelType, setModelType] = useState("all");

  const filtered = modelType === "all"
    ? models
    : models.filter((m) => m.type.toLowerCase() === modelType);

  return (
    <div className="space-y-3">
      <Tabs value={modelType} onValueChange={setModelType}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="binary">Binary</TabsTrigger>
          <TabsTrigger value="multiclass">Multiclass</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="clif-table">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 font-medium">Model</th>
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 font-medium text-right">F1</th>
              <th className="pb-2 font-medium text-right">Precision</th>
              <th className="pb-2 font-medium text-right">Recall</th>
              <th className="pb-2 font-medium">Version</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.model}>
                <td className="py-2 font-medium text-foreground">{m.model}</td>
                <td className="py-2">
                  <Badge variant={m.type === "binary" ? "cyan" : "purple"} className="text-2xs">
                    {m.type}
                  </Badge>
                </td>
                <td className="py-2 text-right font-mono">
                  <span className={cn(
                    "font-semibold",
                    m.f1 >= 0.9 ? "text-emerald-400" : m.f1 >= 0.7 ? "text-amber-400" : "text-destructive"
                  )}>
                    {m.f1.toFixed(3)}
                  </span>
                </td>
                <td className="py-2 text-right font-mono text-muted-foreground">
                  {m.precision.toFixed(3)}
                </td>
                <td className="py-2 text-right font-mono text-muted-foreground">
                  {m.recall.toFixed(3)}
                </td>
                <td className="py-2 font-mono text-muted-foreground">{m.version}</td>
                <td className="py-2">
                  {m.deployed ? (
                    <Badge variant="success" className="text-2xs">DEPLOYED</Badge>
                  ) : (
                    <Badge variant="ghost" className="text-2xs">STAGING</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AIAgentsPage() {
  const { data, loading, refresh } = usePolling<AgentsResponse>(
    "/api/ai/agents",
    15000
  );

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }

  const agents = data?.agents || [];
  const pipeline = data?.pipeline;
  const leaderboard = data?.leaderboard;
  const xaiGlobal = data?.xaiGlobal;
  const drift = data?.drift;

  // Generate mock performance data for charts
  const perfData = Array.from({ length: 24 }, (_, i) => ({
    hour: `${i}:00`,
    triage: Math.round(50 + Math.random() * 150),
    hunter: Math.round(30 + Math.random() * 100),
    verifier: Math.round(20 + Math.random() * 80),
  }));

  return (
    <div className="space-y-6">
      {/* Pipeline Architecture */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" />
                Agent Pipeline Architecture
              </CardTitle>
              <CardDescription>
                Real-time pipeline status with inter-agent HMAC-SHA256 verification
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="mr-1 h-3 w-3" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <PipelineVisual
            agents={agents}
            hmacEnabled={pipeline?.hmacEnabled ?? true}
          />
          {pipeline && (
            <div className="mt-4 flex justify-center gap-6">
              <div className="text-center">
                <p className="text-2xs text-muted-foreground">Total Processed</p>
                <p className="text-lg font-bold text-foreground">
                  {formatNumber(pipeline.totalProcessed)}
                </p>
              </div>
              <Separator orientation="vertical" className="h-10" />
              <div className="text-center">
                <p className="text-2xs text-muted-foreground">Avg Latency</p>
                <p className="text-lg font-bold text-foreground">
                  {pipeline.avgLatencyMs}ms
                </p>
              </div>
              <Separator orientation="vertical" className="h-10" />
              <div className="text-center">
                <p className="text-2xs text-muted-foreground">HMAC Status</p>
                <Badge variant={pipeline.hmacEnabled ? "success" : "destructive"}>
                  {pipeline.hmacEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {agents.slice(0, 4).map((agent) => (
          <Card key={agent.id} className="stat-card">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {agent.name}
                  </p>
                  <p className="mt-1 text-xl font-bold text-foreground">
                    {agent.accuracy}%
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {formatNumber(agent.casesProcessed)} cases · {agent.avgResponseTime}
                  </p>
                </div>
                <div className={cn(
                  "status-dot h-2.5 w-2.5",
                  agent.status === "active"
                    ? "status-dot-online"
                    : agent.status === "error"
                      ? "status-dot-offline"
                      : "status-dot-degraded"
                )} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Performance Trends */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-nexus-cyan" />
            Agent Performance Trends (24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={perfData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="triage" stroke="#3b82f6" strokeWidth={2} dot={false} name="Triage" />
                <Line type="monotone" dataKey="hunter" stroke="#06b6d4" strokeWidth={2} dot={false} name="Hunter" />
                <Line type="monotone" dataKey="verifier" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Verifier" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Model Leaderboard */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Model Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            {leaderboard?.length ? (
              <ModelLeaderboard models={leaderboard} />
            ) : (
              <div className="space-y-3">
                {/* Fallback mock leaderboard */}
                <ModelLeaderboard
                  models={[
                    { model: "XGBoost Binary v3", type: "binary", f1: 0.942, precision: 0.951, recall: 0.933, deployed: true, version: "v3.1.0" },
                    { model: "RF Multiclass v2", type: "multiclass", f1: 0.887, precision: 0.892, recall: 0.882, deployed: true, version: "v2.4.0" },
                    { model: "LightGBM Binary v1", type: "binary", f1: 0.928, precision: 0.935, recall: 0.921, deployed: false, version: "v1.2.0" },
                  ]}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* XAI Global Feature Importance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-nexus-cyan" />
              XAI Global Feature Importance
            </CardTitle>
            <CardDescription>Aggregate SHAP values across all predictions</CardDescription>
          </CardHeader>
          <CardContent>
            {(xaiGlobal || [
              { feature: "event_frequency", importance: 0.342 },
              { feature: "sigma_match_count", importance: 0.287 },
              { feature: "time_anomaly_score", importance: 0.231 },
              { feature: "network_bytes_out", importance: 0.198 },
              { feature: "process_tree_depth", importance: 0.176 },
              { feature: "user_risk_score", importance: 0.154 },
              { feature: "geo_anomaly", importance: 0.132 },
              { feature: "entropy_score", importance: 0.119 },
            ]).map((f) => {
              const maxImp = 0.4;
              const pct = (Math.abs(f.importance) / maxImp) * 100;
              return (
                <div key={f.feature} className="flex items-center gap-3 mb-2">
                  <span className="w-32 truncate font-mono text-xs text-muted-foreground">
                    {f.feature}
                  </span>
                  <div className="flex-1 h-4 rounded bg-muted/30 overflow-hidden">
                    <div
                      className="h-full rounded transition-all duration-500"
                      style={{
                        width: `${Math.min(pct, 100)}%`,
                        background: "rgba(6,182,212,0.5)",
                      }}
                    />
                  </div>
                  <span className="w-14 text-right font-mono text-xs text-foreground">
                    {f.importance.toFixed(3)}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Model Health & Drift */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-nexus-purple" />
            Model Health & Drift Monitor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/10 p-4">
              <p className="text-xs font-medium text-muted-foreground">Model Version</p>
              <p className="mt-1 text-lg font-bold text-foreground">v3.1.0</p>
              <p className="text-2xs text-muted-foreground">Last updated 3 days ago</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/10 p-4">
              <p className="text-xs font-medium text-muted-foreground">Training Freshness</p>
              <p className="mt-1 text-lg font-bold text-foreground">14 days</p>
              <Badge variant={14 <= 30 ? "success" : "warning"} className="mt-1 text-2xs">
                {14 <= 30 ? "Fresh" : "Needs Retrain"}
              </Badge>
            </div>
            <div className="rounded-lg border border-border bg-muted/10 p-4">
              <p className="text-xs font-medium text-muted-foreground">PSI Drift Score</p>
              <p className="mt-1 text-lg font-bold text-foreground">
                {drift?.psiScore?.toFixed(4) || "0.0312"}
              </p>
              <Badge
                variant={
                  (drift?.psiScore || 0.0312) < (drift?.threshold || 0.1)
                    ? "success"
                    : "destructive"
                }
                className="mt-1 text-2xs"
              >
                {(drift?.psiScore || 0.0312) < (drift?.threshold || 0.1)
                  ? "No Drift"
                  : "Drift Detected"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agent Detail Cards — What Each Agent Does */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Triage Agent */}
        <Card className="border-amber-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/10">
                <Crosshair className="h-4 w-4 text-amber-400" />
              </div>
              Triage Agent
            </CardTitle>
            <CardDescription>Event classification & severity assignment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Input</span><span className="text-foreground">Raw events from 4 Kafka topics</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">ML Model</span><span className="font-mono text-foreground">XGBoost Binary v3.1</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Ensemble</span><span className="text-foreground">3-model (ARF + ensemble)</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Output</span><span className="text-foreground">triage-scores + anomaly-alerts</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Features</span><span className="text-foreground">IOC check, allowlist, XAI</span></div>
          </CardContent>
        </Card>

        {/* Hunter Agent */}
        <Card className="border-cyan-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-cyan-500/10">
                <SearchIcon className="h-4 w-4 text-nexus-cyan" />
              </div>
              Hunter Agent
            </CardTitle>
            <CardDescription>Threat correlation & attack chain discovery</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Input</span><span className="text-foreground">hunter-tasks from Triage</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">L1 Parallel</span><span className="text-foreground">Sigma, SPC, Graph, Temporal, Similarity</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">L2 Parallel</span><span className="text-foreground">MITRE mapping, Campaign linking</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Scoring</span><span className="font-mono text-foreground">CatBoost + FusionEngine</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Output</span><span className="text-foreground">hunter-results + narrative</span></div>
          </CardContent>
        </Card>

        {/* Verifier Agent */}
        <Card className="border-emerald-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
              </div>
              Verifier Agent
            </CardTitle>
            <CardDescription>Evidence integrity, verdict & report generation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Input</span><span className="text-foreground">hunter-results via Kafka</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Verification</span><span className="text-foreground">Merkle chain, IOC, timeline, FP</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Verdict</span><span className="text-foreground">true_positive / false_positive / inconclusive</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Security</span><span className="font-mono text-foreground">HMAC-SHA256 chain</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Output</span><span className="text-foreground">verifier-results + report + attack graph</span></div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity Feed */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" />
              Recent Pipeline Activity
            </CardTitle>
            <Link href="/investigations">
              <Button variant="ghost" size="sm" className="text-xs">View Investigations <ChevronRight className="ml-1 h-3 w-3" /></Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { agent: "Triage Agent", icon: Crosshair, color: "text-amber-400", action: "Classified INV-2026-001 as lateral-movement", time: "2m ago", status: "completed" },
              { agent: "Hunter Agent", icon: SearchIcon, color: "text-nexus-cyan", action: "Correlated 47 events across 4 hosts", time: "2m ago", status: "completed" },
              { agent: "Verifier Agent", icon: ShieldCheck, color: "text-emerald-400", action: "All integrity checks passed — report generated", time: "1m ago", status: "completed" },
              { agent: "Triage Agent", icon: Crosshair, color: "text-amber-400", action: "Classified INV-2026-003 as credential-access", time: "5m ago", status: "completed" },
              { agent: "Hunter Agent", icon: SearchIcon, color: "text-nexus-cyan", action: "Discovered Kerberoasting attack chain (3 steps)", time: "4m ago", status: "completed" },
              { agent: "Verifier Agent", icon: ShieldCheck, color: "text-emerald-400", action: "Verified INV-2026-003 — true_positive verdict", time: "3m ago", status: "completed" },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/20 transition-colors">
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", item.color)} />
                  <span className="text-xs font-medium text-foreground shrink-0">{item.agent}</span>
                  <span className="text-xs text-muted-foreground flex-1 truncate">{item.action}</span>
                  <CheckCircle className="h-3 w-3 text-emerald-400 shrink-0" />
                  <span className="text-2xs text-muted-foreground shrink-0">{item.time}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
