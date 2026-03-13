"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Bot, Activity, Shield, Zap, Clock, TrendingUp, AlertTriangle,
  CheckCircle, RefreshCw, Lock, Cpu, BarChart3, Fingerprint,
  ArrowRight, ArrowDown, Crosshair, Search as SearchIcon, ShieldCheck,
  ChevronRight, Settings, FileText, Radio,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

/* Deterministic 24h performance data for bar chart */
const PERF_DATA = [
  { hour: "00:00", triage: 62, hunter: 40 }, { hour: "01:00", triage: 55, hunter: 35 },
  { hour: "02:00", triage: 48, hunter: 30 }, { hour: "03:00", triage: 45, hunter: 28 },
  { hour: "04:00", triage: 50, hunter: 32 }, { hour: "05:00", triage: 58, hunter: 38 },
  { hour: "06:00", triage: 75, hunter: 48 }, { hour: "07:00", triage: 95, hunter: 58 },
  { hour: "08:00", triage: 120, hunter: 72 }, { hour: "09:00", triage: 145, hunter: 85 },
  { hour: "10:00", triage: 160, hunter: 95 }, { hour: "11:00", triage: 175, hunter: 105 },
  { hour: "12:00", triage: 155, hunter: 90 }, { hour: "13:00", triage: 168, hunter: 98 },
  { hour: "14:00", triage: 180, hunter: 110 }, { hour: "15:00", triage: 170, hunter: 100 },
  { hour: "16:00", triage: 150, hunter: 88 }, { hour: "17:00", triage: 130, hunter: 78 },
  { hour: "18:00", triage: 105, hunter: 65 }, { hour: "19:00", triage: 85, hunter: 52 },
  { hour: "20:00", triage: 75, hunter: 45 }, { hour: "21:00", triage: 68, hunter: 42 },
  { hour: "22:00", triage: 60, hunter: 38 }, { hour: "23:00", triage: 55, hunter: 34 },
];

/* Pipeline activity logs */
const ACTIVITY_LOG = [
  { agent: "VERIFIER_AGENT", color: "text-emerald-500", dot: "bg-emerald-500", text: "Hash verification successful for event", highlight: "0x4F...E1", extra: "Result: CLEAN", time: "2s ago" },
  { agent: "TRIAGE_AGENT", color: "text-red-500", dot: "bg-red-500", text: "High-entropy payload detected on Topic:", highlight: "ingest.raw.json", extra: "Routing to Hunter.", time: "12s ago" },
  { agent: "HUNTER_AGENT", color: "text-amber-500", dot: "bg-amber-500", text: "IOC correlation matched pattern:", highlight: "Log4ShellExploit_A", extra: "Escalation triggered.", time: "52s ago" },
  { agent: "PIPELINE_SCHEDULER", color: "text-blue-500", dot: "bg-blue-500", text: "Model refresh cycle complete.", highlight: "LightGBM v2.4", extra: "weight updated to 0.50.", time: "8 ago" },
];

/* XAI feature importance */
const XAI_FEATURES = [
  { feature: "Source IP Reputation", importance: 0.42, color: "bg-blue-500" },
  { feature: "Payload Entropy", importance: 0.29, color: "bg-orange-500" },
  { feature: "Temporal Anomaly Score", importance: 0.15, color: "bg-cyan-500" },
  { feature: "DNS Request Density", importance: 0.09, color: "bg-emerald-500" },
];

/* Model leaderboard */
const MODELS = [
  { rank: "#1", model: "LightGBM v2.4", recall: 0.982, precision: 0.975, status: "ACTIVE", statusCls: "text-emerald-600 bg-emerald-50" },
  { rank: "#2", model: "XGBoost Optimized", recall: 0.971, precision: 0.982, status: "ACTIVE", statusCls: "text-emerald-600 bg-emerald-50" },
  { rank: "#3", model: "RF Multiclass", recall: 0.945, precision: 0.958, status: "SHADOW", statusCls: "text-blue-600 bg-blue-50" },
];

export default function AIAgentsPage() {
  const { data, loading, refresh } = usePolling<AgentsResponse>("/api/ai/agents", 15000);
  const [showLogs, setShowLogs] = useState(true);

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
  const triage = agents.find((a) => a.name.toLowerCase().includes("triage"));
  const hunter = agents.find((a) => a.name.toLowerCase().includes("hunter"));
  const verifier = agents.find((a) => a.name.toLowerCase().includes("verifier"));

  return (
    <div className="space-y-6">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            AI Systems
            <Badge variant="success" className="text-2xs gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
            </Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            Core Intelligence Pipeline Monitor • Cluster: US-EAST-01
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-1 h-3 w-3" /> Reset Pipeline
          </Button>
          <Link href="/explainability">
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
              <Settings className="mr-1 h-3 w-3" /> Configuration
            </Button>
          </Link>
        </div>
      </div>

      {/* ═══ PIPELINE ARCHITECTURE — FULL WIDTH ═══ */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Cpu className="h-4 w-4 text-primary" />
            Agent Pipeline Architecture
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between py-4 px-8">
            {[
              { label: "SOURCE", name: "Kafka Input", icon: Radio, bg: "bg-slate-100 dark:bg-slate-800", border: "border-slate-200 dark:border-slate-700", textColor: "text-slate-500", labelColor: "text-muted-foreground" },
              { label: "PHASE 1", name: "Triage", icon: Crosshair, bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", textColor: "text-red-500", labelColor: "text-red-500" },
              { label: "PHASE 2", name: "Hunter", icon: SearchIcon, bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", textColor: "text-emerald-500", labelColor: "text-emerald-500" },
              { label: "PHASE 3", name: "Verifier", icon: ShieldCheck, bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800", textColor: "text-blue-500", labelColor: "text-blue-500" },
              { label: "OUTPUT", name: "Reports", icon: FileText, bg: "bg-slate-100 dark:bg-slate-800", border: "border-slate-200 dark:border-slate-700", textColor: "text-slate-500", labelColor: "text-muted-foreground" },
            ].map((stage, i, arr) => {
              const Icon = stage.icon;
              return (
                <React.Fragment key={stage.label}>
                  <div className="flex flex-col items-center gap-2">
                    <div className={cn("flex h-14 w-14 items-center justify-center rounded-xl border-2", stage.bg, stage.border)}>
                      <Icon className={cn("h-6 w-6", stage.textColor)} />
                    </div>
                    <div className="text-center">
                      <p className={cn("text-[9px] font-bold uppercase tracking-wider", stage.labelColor)}>{stage.label}</p>
                      <p className="text-[10px] font-semibold text-foreground">{stage.name}</p>
                    </div>
                  </div>
                  {i < arr.length - 1 && (
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mx-1" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ═══ BOTTOM SECTION: 3 cols Left (Score+Confidence) | 1 col Right (Metrics) ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* LEFT COLUMN — Score Fusion & Agent Confidence */}
        <div className="lg:col-span-3 space-y-4">
          {/* Score Fusion Engine */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4 text-amber-500" />
                Score Fusion Engine
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-3">Model Voting Stack</p>
                  <div className="space-y-2.5">
                    {[
                      { name: "LightGBM", weight: 50, color: "bg-blue-500" },
                      { name: "Extended IF", weight: 30, color: "bg-emerald-500" },
                      { name: "Autoencoder", weight: 20, color: "bg-amber-500" },
                    ].map((m) => (
                      <div key={m.name} className="flex items-center gap-3">
                        <div className="flex-1 h-7 rounded-lg bg-muted/20 overflow-hidden">
                          <div className={cn("h-full rounded-lg flex items-center px-2", m.color)} style={{ width: `${m.weight}%` }}>
                            <span className="text-[10px] font-bold text-white truncate">{m.name}</span>
                          </div>
                        </div>
                        <span className="text-sm font-mono text-muted-foreground w-12 text-right">{m.weight}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-3">Decision Modifiers</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Asset Criticality", icon: "🔴" },
                      { label: "IOC Boost", icon: "⚡" },
                      { label: "Template Rarity", icon: "◆" },
                      { label: "Allowlist", icon: "✦" },
                    ].map((d) => (
                      <span key={d.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/20 border border-border text-xs font-semibold text-foreground">
                        <span>{d.icon}</span> {d.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Agent Confidence — SVG Donuts */}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                Agent Confidence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-around py-4">
                {[
                  { label: "Triage", pct: triage?.accuracy || 94.2, stroke: "#3b82f6" },
                  { label: "Hunter", pct: hunter?.accuracy || 91.5, stroke: "#06b6d4" },
                  { label: "Verifier", pct: verifier?.accuracy || 97.1, stroke: "#10b981" },
                ].map((a) => {
                  const r = 36, c = 2 * Math.PI * r, offset = c * (1 - a.pct / 100);
                  return (
                    <div key={a.label} className="flex flex-col items-center gap-2">
                      <svg width="90" height="90" viewBox="0 0 90 90">
                        <circle cx="45" cy="45" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" opacity="0.2" />
                        <circle cx="45" cy="45" r={r} fill="none" stroke={a.stroke} strokeWidth="6"
                          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
                          transform="rotate(-90 45 45)" className="transition-all duration-700" />
                        <text x="45" y="47" textAnchor="middle" dominantBaseline="middle"
                          className="fill-foreground" style={{ fontSize: "16px", fontWeight: 700 }}>
                          {a.pct}%
                        </text>
                      </svg>
                      <span className="text-sm font-semibold text-muted-foreground">{a.label}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN — 4 Metrics stacked vertically */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Processed</p>
              <p className="text-2xl font-bold text-foreground mt-1">{formatNumber(pipeline?.totalProcessed || 356)}</p>
              <p className="text-[10px] text-emerald-500 font-semibold mt-1">↑ +12% vs last hour</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Avg Latency</p>
              <p className="text-2xl font-bold text-foreground mt-1">{pipeline?.avgLatencyMs || 42}<span className="text-sm font-normal text-muted-foreground ml-1">ms</span></p>
              <p className="text-[10px] text-emerald-500 font-semibold mt-1">↓ -8% latency decrease</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">HMAC Status</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{pipeline?.hmacEnabled !== false ? "On" : "Off"}</p>
                  <p className="text-[10px] text-emerald-500 font-semibold mt-1">✓ Hashes verified</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10">
                  <ShieldCheck className="h-4 w-4 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Kafka Topics</p>
                  <p className="text-2xl font-bold text-foreground mt-1">4</p>
                  <p className="text-[10px] text-emerald-500 font-semibold mt-1">0 msgs behind</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/20">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ═══ PERFORMANCE TRENDS — FULL WIDTH SINGLE ROW ═══ */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-primary" />
              Agent Performance Trends (24h)
            </CardTitle>
            <div className="flex items-center gap-3 text-2xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500" /> Triage</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-cyan-400" /> Hunter</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={PERF_DATA} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={2} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="triage" fill="#3b82f6" radius={[2, 2, 0, 0]} name="Triage" />
                <Bar dataKey="hunter" fill="#22d3ee" radius={[2, 2, 0, 0]} name="Hunter" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* ═══ MODEL LEADERBOARD + XAI FEATURE IMPORTANCE ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Model Leaderboard */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BarChart3 className="h-4 w-4 text-primary" />
                Model Leaderboard
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs text-primary">View All</Button>
            </div>
          </CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 font-medium">RANK</th>
                  <th className="pb-2 font-medium">MODEL ENGINE</th>
                  <th className="pb-2 font-medium text-right">RECALL</th>
                  <th className="pb-2 font-medium text-right">PRECISION</th>
                  <th className="pb-2 font-medium text-right">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {MODELS.map((m) => (
                  <tr key={m.rank} className="border-b border-border/30">
                    <td className="py-3 font-mono font-bold text-foreground">{m.rank}</td>
                    <td className="py-3 font-medium text-foreground">{m.model}</td>
                    <td className="py-3 text-right font-mono text-muted-foreground">{m.recall.toFixed(3)}</td>
                    <td className="py-3 text-right font-mono text-muted-foreground">{m.precision.toFixed(3)}</td>
                    <td className="py-3 text-right">
                      <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold", m.statusCls)}>{m.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* XAI Global Feature Importance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Fingerprint className="h-4 w-4 text-nexus-cyan" />
              XAI Global Feature Importance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 py-2">
              {XAI_FEATURES.map((f) => (
                <div key={f.feature} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">{f.feature}</span>
                    <span className="text-xs font-bold font-mono text-foreground">{f.importance.toFixed(2)}</span>
                  </div>
                  <div className="w-full h-3 rounded-full bg-muted/20 overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", f.color)} style={{ width: `${(f.importance / 0.5) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ RECENT PIPELINE ACTIVITY ═══ */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" />
              Recent Pipeline Activity
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="text-xs">Export Logs</Button>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowLogs(!showLogs)}>
                {showLogs ? "Collapse" : "Expand"}
              </Button>
            </div>
          </div>
        </CardHeader>
        {showLogs && (
          <CardContent>
            <div className="space-y-1">
              {ACTIVITY_LOG.map((log, i) => (
                <div key={i} className="flex items-start gap-3 py-3 border-b border-border/30 last:border-0">
                  <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", log.dot)} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-xs font-bold uppercase tracking-wide", log.color)}>{log.agent}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {log.text}{" "}
                      <code className="px-1 py-0.5 rounded bg-muted/30 text-foreground font-mono text-[10px]">{log.highlight}</code>
                      {". "}{log.extra}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{log.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
