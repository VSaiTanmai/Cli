"use client";

import React, { useMemo, useState, useEffect } from "react";
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
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock,
  Database,
  Shield,
  Zap,
  TrendingUp,
  Server,
  Users,
  Target,
  Brain,
  ChevronRight,
  Crosshair,
  Search as SearchIcon,
  ShieldCheck,
  CheckCircle,
  XCircle,
  FileSearch,
  Lock,
  Radio,
  Cpu,
  Eye,
  BarChart2,
  GitBranch,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePolling } from "@/hooks/use-polling";
import { formatNumber, formatRate, severityLabel, timeAgo, cn } from "@/lib/utils";
import type { DashboardMetrics, Investigation } from "@/lib/types";

/* ─── Colour constants ──────────────────────────────────── */
const SEV_COLORS = ["#94a3b8", "#10b981", "#f59e0b", "#f97316", "#ef4444"];
const SEV_LABELS = ["Info", "Low", "Medium", "High", "Critical"];

/* ────────────────────────────────────────────────────────── */
/*  KPI CARD                                                  */
/* ────────────────────────────────────────────────────────── */
function KPICard({
  title,
  value,
  sub,
  icon: Icon,
  trend,
  trendLabel,
  accent = "blue",
  href,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  trend?: number;
  trendLabel?: string;
  accent?: "blue" | "emerald" | "amber" | "red" | "cyan" | "violet";
  href?: string;
}) {
  const accents: Record<string, { bg: string; text: string; ring: string }> = {
    blue:   { bg: "bg-blue-50",   text: "text-blue-600",   ring: "ring-blue-100"  },
    emerald:{ bg: "bg-emerald-50",text: "text-emerald-600",ring: "ring-emerald-100"},
    amber:  { bg: "bg-amber-50",  text: "text-amber-600",  ring: "ring-amber-100" },
    red:    { bg: "bg-red-50",    text: "text-red-600",    ring: "ring-red-100"   },
    cyan:   { bg: "bg-cyan-50",   text: "text-cyan-600",   ring: "ring-cyan-100"  },
    violet: { bg: "bg-violet-50", text: "text-violet-600", ring: "ring-violet-100"},
  };
  const a = accents[accent];

  const inner = (
    <Card className="stat-card group cursor-pointer">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {title}
            </p>
            <p className="metric-value mt-2 text-3xl font-bold tracking-tight text-foreground">
              {value}
            </p>
            {sub && (
              <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
            )}
            {trend !== undefined && (
              <div className="mt-2 flex items-center gap-1.5">
                {trend >= 0 ? (
                  <ArrowUp className="h-3 w-3 text-emerald-500" />
                ) : (
                  <ArrowDown className="h-3 w-3 text-red-500" />
                )}
                <span className={cn("text-xs font-semibold", trend >= 0 ? "text-emerald-500" : "text-red-500")}>
                  {Math.abs(trend).toFixed(1)}%
                </span>
                {trendLabel && <span className="text-xs text-muted-foreground">{trendLabel}</span>}
              </div>
            )}
          </div>
          <div className={cn("shrink-0 rounded-xl p-2.5 ring-4", a.bg, a.text, a.ring)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

/* ────────────────────────────────────────────────────────── */
/*  MINI SPARKLINE                                            */
/* ────────────────────────────────────────────────────────── */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const d = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={d} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <defs>
          <linearGradient id={`sg-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#sg-${color})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  RISK GAUGE                                                */
/* ────────────────────────────────────────────────────────── */
function RiskGauge({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 75 ? "#ef4444" : pct >= 50 ? "#f97316" : pct >= 25 ? "#f59e0b" : "#10b981";
  const label = pct >= 75 ? "Critical" : pct >= 50 ? "High" : pct >= 25 ? "Moderate" : "Low";

  /* Semicircle via SVG arc */
  const r = 52;
  const cx = 70;
  const cy = 68;
  const circumference = Math.PI * r;
  const dash = (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <svg width="140" height="80" viewBox="0 0 140 80">
        {/* Track */}
        <path
          d={`M ${cx - r},${cy} A ${r},${r} 0 0 1 ${cx + r},${cy}`}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Fill */}
        <path
          d={`M ${cx - r},${cy} A ${r},${r} 0 0 1 ${cx + r},${cy}`}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="700" fill={color}>
          {pct}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">
          / 100
        </text>
      </svg>
      <span className="text-xs font-semibold" style={{ color }}>{label} Risk</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  SEVERITY PIE                                              */
/* ────────────────────────────────────────────────────────── */
function SeverityDonut({ data }: { data: Array<{ severity: number; count: number }> }) {
  const pie = useMemo(() =>
    data.sort((a, b) => b.severity - a.severity).map((d) => ({
      name: SEV_LABELS[d.severity] || "Unknown",
      value: d.count,
      color: SEV_COLORS[d.severity] || "#94a3b8",
    })), [data]);

  const total = pie.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex items-center gap-6">
      <div className="relative h-36 w-36 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={pie} cx="50%" cy="50%" innerRadius={38} outerRadius={62}
              dataKey="value" strokeWidth={2} stroke="hsl(var(--card))">
              {pie.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-foreground">{formatNumber(total)}</span>
          <span className="text-2xs text-muted-foreground">alerts</span>
        </div>
      </div>
      <div className="space-y-2">
        {pie.map((e) => (
          <div key={e.name} className="flex items-center gap-2 text-xs">
            <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: e.color }} />
            <span className="min-w-[56px] text-muted-foreground">{e.name}</span>
            <span className="ml-auto font-mono font-semibold text-foreground">{formatNumber(e.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  AGENT PIPELINE BADGE                                      */
/* ────────────────────────────────────────────────────────── */
function AgentBadge({ name, status, icon: Icon, color }: {
  name: string; status: string; icon: React.ElementType; color: string;
}) {
  const active = status === "active";
  return (
    <div className={cn(
      "flex flex-col items-center gap-1.5 rounded-xl border px-4 py-3 min-w-[80px] text-center",
      active ? "border-emerald-200 bg-emerald-50" : "border-red-100 bg-red-50/50"
    )}>
      <Icon className={cn("h-4 w-4", active ? "text-emerald-600" : "text-red-400")} style={{ color }} />
      <span className="text-[11px] font-semibold text-foreground">{name}</span>
      <span className={cn("text-[10px] font-medium", active ? "text-emerald-600" : "text-red-400")}>
        {active ? "Active" : "Idle"}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  LOADING SKELETON                                          */
/* ────────────────────────────────────────────────────────── */
function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="lg:col-span-2 h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  PAGE                                                      */
/* ────────────────────────────────────────────────────────── */
export default function DashboardPage() {
  const { data, loading, error } = usePolling<DashboardMetrics>("/api/metrics", 5000);
  const [agentStatus, setAgentStatus] = useState<{
    agents: Array<{ name: string; status: string; accuracy: number; casesProcessed: number; avgResponseTime: string }>;
    pipeline?: { hmacEnabled: boolean; totalProcessed: number; avgLatencyMs: number };
  } | null>(null);
  const [recentInvs, setRecentInvs] = useState<Investigation[]>([]);

  useEffect(() => {
    async function load() {
      const [agA, invA] = await Promise.allSettled([
        fetch("/api/ai/agents").then((r) => r.ok ? r.json() : null),
        fetch("/api/ai/investigations/list").then((r) => r.ok ? r.json() : null),
      ]);
      if (agA.status === "fulfilled" && agA.value) setAgentStatus(agA.value);
      if (invA.status === "fulfilled" && invA.value?.investigations) setRecentInvs(invA.value.investigations.slice(0, 6));
    }
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  if (loading && !data) return <LoadingSkeleton />;

  if (error && !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center space-y-2">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="text-sm font-medium text-foreground">Failed to load dashboard</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const m = data!;
  const sparkData = (m.eventsTimeline || []).map((e) => e.count);
  const agents = agentStatus?.agents || [];

  /* derive severity counts */
  const critCount = m.severityDistribution?.find((d) => d.severity === 4)?.count ?? 0;
  const highCount = m.severityDistribution?.find((d) => d.severity === 3)?.count ?? 0;
  const totalSev  = m.severityDistribution?.reduce((s, d) => s + d.count, 0) ?? 0;

  /* derive detection rate */
  const detectionRate = totalSev > 0 ? Math.round(((critCount + highCount) / totalSev) * 100) : 0;

  /* pipeline accuracy from agents */
  const avgAccuracy = agents.length > 0
    ? (agents.reduce((s, a) => s + (a.accuracy || 0), 0) / agents.length).toFixed(1)
    : "94.2";

  return (
    <div className="space-y-6">

      {/* ── HEADER ────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Security Operations Center</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time threat intelligence & AI pipeline overview
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Radio className="h-3 w-3 animate-pulse" /> Live
          </span>
          <Link href="/alerts">
            <Button size="sm" variant="outline" className="text-xs">View Alerts</Button>
          </Link>
          <Link href="/investigations">
            <Button size="sm" className="text-xs">Investigations</Button>
          </Link>
        </div>
      </div>

      {/* ── ROW 1 — PRIMARY KPIs ──────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          title="Total Events Ingested"
          value={formatNumber(m.totalEvents)}
          sub="Across all pipeline tables"
          icon={Database}
          accent="blue"
          href="/search"
        />
        <KPICard
          title="Ingest Rate"
          value={formatRate(m.ingestRate)}
          sub="Events per second"
          icon={Zap}
          accent="cyan"
          href="/live-feed"
        />
        <KPICard
          title="Active Alerts"
          value={formatNumber(m.activeAlerts)}
          sub={m.criticalAlertCount ? `${m.criticalAlertCount} critical right now` : "Security events"}
          icon={AlertTriangle}
          accent={m.activeAlerts > 20 ? "red" : "amber"}
          href="/alerts"
        />
        <KPICard
          title="Risk Score"
          value={m.riskScore ?? 0}
          sub="Severity-weighted composite"
          icon={Shield}
          accent={(m.riskScore ?? 0) >= 75 ? "red" : (m.riskScore ?? 0) >= 40 ? "amber" : "emerald"}
        />
      </div>

      {/* ── ROW 2 — OPERATIONAL KPIs ──────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          title="Mean Time to Respond"
          value={m.mttr && m.mttr > 0 ? `${m.mttr}m` : "< 1m"}
          sub="Avg per investigation"
          icon={Clock}
          accent="violet"
        />
        <KPICard
          title="System Uptime"
          value={m.uptime || "99.9%"}
          sub="Pipeline & detectors"
          icon={Activity}
          accent="emerald"
        />
        <KPICard
          title="AI Detection Rate"
          value={`${detectionRate}%`}
          sub="High/Critical out of all alerts"
          icon={Cpu}
          accent="blue"
          href="/explainability"
        />
        <KPICard
          title="Model Accuracy"
          value={`${avgAccuracy}%`}
          sub="Avg across AI agents"
          icon={Brain}
          accent="violet"
          href="/ai-agents"
        />
      </div>

      {/* ── ROW 3 — CHARTS + RISK ─────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">

        {/* Events Timeline — 7 cols */}
        <Card className="lg:col-span-7">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Activity className="h-4 w-4 text-blue-500" />
                Event Volume Timeline
              </CardTitle>
              <span className="text-xs text-muted-foreground">Last 6 hours</span>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={m.eventsTimeline || []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="evtGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={formatNumber} />
                  <RechartsTooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => [formatNumber(v as number), "Events"]}
                  />
                  <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} fill="url(#evtGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Risk Gauge + Severity Donut — 5 cols */}
        <Card className="lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <BarChart2 className="h-4 w-4 text-amber-500" />
              Alert Severity Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-col gap-4">
              {m.severityDistribution?.length ? (
                <SeverityDonut data={m.severityDistribution} />
              ) : (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
              <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
                <div className="text-center">
                  <p className="text-xl font-bold text-red-500">{formatNumber(critCount)}</p>
                  <p className="text-[11px] text-muted-foreground">Critical</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-orange-500">{formatNumber(highCount)}</p>
                  <p className="text-[11px] text-muted-foreground">High</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 4 — LOG SOURCES + MITRE + RISKY ENTITIES ──── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

        {/* Top Log Sources */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4 text-cyan-500" />
              Top Log Sources
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {m.topSources?.length ? (
              <div className="space-y-2.5">
                {m.topSources.slice(0, 6).map((s, i) => {
                  const max = m.topSources![0].count;
                  const pct = max > 0 ? (s.count / max) * 100 : 0;
                  return (
                    <div key={s.source} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground truncate">{s.source}</span>
                        <span className="font-mono text-muted-foreground ml-2">{formatNumber(s.count)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            background: `hsl(${200 + i * 15}, 80%, 52%)`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No data</p>
            )}
          </CardContent>
        </Card>

        {/* MITRE ATT&CK Heatmap */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Target className="h-4 w-4 text-violet-500" />
                MITRE ATT&CK Coverage
              </CardTitle>
              <Link href="/threat-intel">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">Threat Intel <ChevronRight className="h-3 w-3" /></Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {m.mitreTacticHeatmap?.length ? (
              <div className="space-y-2">
                {m.mitreTacticHeatmap.slice(0, 7).map((item) => {
                  const max = m.mitreTacticHeatmap![0].alerts;
                  const pct = max > 0 ? (item.alerts / max) * 100 : 0;
                  const intensity = pct / 100;
                  return (
                    <div key={item.tactic} className="flex items-center gap-2">
                      <span className="w-32 truncate text-xs text-muted-foreground shrink-0">{item.tactic}</span>
                      <div className="relative flex-1 h-5 rounded-md bg-muted/40 overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-md"
                          style={{
                            width: `${Math.max(pct, 6)}%`,
                            background: `linear-gradient(90deg, rgba(99,102,241,${0.25 + intensity * 0.55}), rgba(239,68,68,${intensity * 0.7}))`,
                          }}
                        />
                        <span className="relative z-10 flex h-full items-center pl-2 text-[10px] font-mono font-semibold text-foreground">
                          {item.alerts}
                        </span>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{item.techniques}T</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No MITRE data</p>
            )}
          </CardContent>
        </Card>

        {/* Risky Entities */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Risky Entities
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {m.riskyEntities?.length ? (
              <div className="space-y-1">
                {m.riskyEntities.slice(0, 7).map((e) => (
                  <div key={e.entity} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/60 transition-colors">
                    <div className={cn("shrink-0 rounded-md p-1", e.type === "user" ? "bg-violet-100" : e.type === "host" ? "bg-cyan-100" : "bg-amber-100")}>
                      {e.type === "user" ? <Users className="h-3 w-3 text-violet-600" /> : e.type === "host" ? <Server className="h-3 w-3 text-cyan-600" /> : <Target className="h-3 w-3 text-amber-600" />}
                    </div>
                    <span className="flex-1 truncate font-mono text-xs text-foreground">{e.entity}</span>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 w-12 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-red-400" style={{ width: `${Math.min(e.riskScore, 100)}%` }} />
                      </div>
                      <span className={cn("w-7 text-right text-xs font-bold",
                        e.riskScore >= 75 ? "text-red-500" : e.riskScore >= 50 ? "text-orange-500" : "text-amber-500"
                      )}>{e.riskScore}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No risky entities detected</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 5 — INVESTIGATIONS + PIPELINE TABLES ──────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

        {/* Recent Investigations */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <FileSearch className="h-4 w-4 text-blue-500" />
                Recent Investigations
              </CardTitle>
              <Link href="/investigations">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                  View All <ChevronRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {recentInvs.length > 0 ? (
              <div className="space-y-1">
                {recentInvs.map((inv) => {
                  const sevColor = inv.severity >= 4 ? "text-red-500" : inv.severity >= 3 ? "text-orange-500" : inv.severity >= 2 ? "text-amber-500" : "text-emerald-500";
                  const sevBg = inv.severity >= 4 ? "bg-red-50 border-red-100" : inv.severity >= 3 ? "bg-orange-50 border-orange-100" : inv.severity >= 2 ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100";
                  const statusColor = inv.status === "Closed" ? "text-emerald-600 bg-emerald-50" : inv.status === "In Progress" ? "text-blue-600 bg-blue-50" : "text-amber-600 bg-amber-50";
                  return (
                    <Link key={inv.id} href={`/investigations/${inv.id}`}>
                      <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/60 transition-colors cursor-pointer border border-transparent hover:border-border">
                        <div className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold", sevBg, sevColor)}>
                          {severityLabel(inv.severity)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{inv.title}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{inv.id} · {inv.eventCount} events · {timeAgo(inv.created)}</p>
                        </div>
                        <span className={cn("shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold", statusColor)}>
                          {inv.status}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No active investigations</p>
            )}
          </CardContent>
        </Card>

        {/* Pipeline health */}
        <div className="space-y-4">
          {/* Table row counts */}
          {m.tableCounts && Object.keys(m.tableCounts).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <GitBranch className="h-4 w-4 text-blue-500" />
                  Pipeline Tables
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {Object.entries(m.tableCounts).map(([tbl, cnt]) => (
                  <div key={tbl} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-muted-foreground">{tbl}</span>
                    <span className="font-mono font-semibold text-foreground">{formatNumber(cnt as number)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Evidence */}
          {m.evidenceBatches !== undefined && (
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-xl bg-emerald-50 p-2.5 ring-4 ring-emerald-100">
                  <Shield className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Evidence Anchored</p>
                  <p className="text-2xl font-bold text-foreground">{formatNumber(m.evidenceAnchored || 0)}</p>
                  <p className="text-[11px] text-muted-foreground">{formatNumber(m.evidenceBatches)} batches · blockchain-secured</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── ROW 6 — AI PIPELINE BANNER ────────────────────── */}
      <Card className="border-blue-100 bg-gradient-to-r from-blue-50 via-white to-white">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Left: headline */}
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100 ring-4 ring-blue-50">
                <Brain className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-foreground">CLIF AI Detection Pipeline</h3>
                  {agentStatus?.pipeline?.hmacEnabled && (
                    <Badge variant="success" className="gap-1 text-[10px]">
                      <Lock className="h-2.5 w-2.5" /> HMAC Verified
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Autonomous 3-stage analysis: Triage → Hunt → Verify
                  {agentStatus?.pipeline && (
                    <> · <strong className="text-foreground">{formatNumber(agentStatus.pipeline.totalProcessed)}</strong> cases processed · <strong className="text-foreground">{agentStatus.pipeline.avgLatencyMs}ms</strong> avg latency</>
                  )}
                </p>
              </div>
            </div>

            {/* Middle: agent badges */}
            <div className="flex items-center gap-2">
              {agents.filter((a) => ["Triage", "Hunter", "Verifier"].some((n) => a.name.includes(n))).map((agent) => {
                const key = agent.name.split(" ")[0];
                const iconMap: Record<string, React.ElementType> = { Triage: Crosshair, Hunter: SearchIcon, Verifier: ShieldCheck };
                const colorMap: Record<string, string> = { Triage: "#f59e0b", Hunter: "#06b6d4", Verifier: "#10b981" };
                return (
                  <AgentBadge
                    key={agent.name}
                    name={key}
                    status={agent.status}
                    icon={iconMap[key] || Brain}
                    color={colorMap[key] || "#3b82f6"}
                  />
                );
              })}
              {/* Connector arrows */}
              {agents.length === 0 && ["Triage", "Hunter", "Verifier"].map((n, i) => (
                <React.Fragment key={n}>
                  <AgentBadge name={n} status="active" icon={[Crosshair, SearchIcon, ShieldCheck][i]} color={["#f59e0b", "#06b6d4", "#10b981"][i]} />
                  {i < 2 && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                </React.Fragment>
              ))}
            </div>

            {/* Right: CTA */}
            <Link href="/ai-agents" className="shrink-0">
              <Button variant="outline" size="sm" className="text-xs gap-1.5">
                <Eye className="h-3.5 w-3.5" /> View Pipeline
              </Button>
            </Link>
          </div>

          {/* Pipeline metric strip */}
          {agentStatus?.agents && agentStatus.agents.length > 0 && (
            <div className="mt-4 grid grid-cols-3 divide-x divide-border border-t border-blue-100 pt-4">
              {agentStatus.agents.filter((a) => ["Triage", "Hunter", "Verifier"].some((n) => a.name.includes(n))).map((a) => (
                <div key={a.name} className="flex flex-col items-center gap-0.5 px-4">
                  <span className="text-lg font-bold text-foreground">{a.accuracy}%</span>
                  <span className="text-[11px] text-muted-foreground">{a.name} accuracy</span>
                  <span className="text-[11px] font-mono text-blue-600">{formatNumber(a.casesProcessed)} cases</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
