"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, AreaChart, Area, ScatterChart, Scatter, ZAxis, Cell,
} from "recharts";
import {
  Globe, Shield, AlertTriangle, Search, RefreshCw, ExternalLink,
  Hash, Server, Mail, FileText, Target, Clock, Filter,
  ChevronDown, ChevronRight, Brain, Crosshair, Search as SearchIcon,
  ShieldCheck, Zap, CheckCircle, Link2, Activity, Eye, ArrowRight,
  AlertCircle, User, Monitor, Wifi,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePolling } from "@/hooks/use-polling";
import { formatNumber, timeAgo, cn } from "@/lib/utils";
import type { IOC, ThreatPattern, Investigation } from "@/lib/types";

interface ThreatIntelResponse {
  iocs: IOC[];
  patterns: ThreatPattern[];
  stats?: {
    totalIOCs: number;
    activeThreats: number;
    mitreTechniques: number;
    lastUpdated: string;
  };
}

const IOC_ICONS: Record<string, typeof Globe> = {
  ip: Server, ipv4: Server, domain: Globe, url: ExternalLink,
  hash: Hash, sha256: Hash, email: Mail, file: FileText,
};

/* 24h simulated attack timeline data (deterministic to avoid hydration mismatch) */
const TIMELINE_DATA = [
  { hour: "00:00", critical: 1, high: 2, medium: 4 }, { hour: "01:00", critical: 0, high: 1, medium: 3 },
  { hour: "02:00", critical: 0, high: 1, medium: 2 }, { hour: "03:00", critical: 1, high: 2, medium: 3 },
  { hour: "04:00", critical: 0, high: 1, medium: 5 }, { hour: "05:00", critical: 1, high: 3, medium: 4 },
  { hour: "06:00", critical: 2, high: 4, medium: 6 }, { hour: "07:00", critical: 1, high: 3, medium: 5 },
  { hour: "08:00", critical: 3, high: 6, medium: 8 }, { hour: "09:00", critical: 4, high: 8, medium: 10 },
  { hour: "10:00", critical: 5, high: 9, medium: 12 }, { hour: "11:00", critical: 6, high: 11, medium: 14 },
  { hour: "12:00", critical: 7, high: 12, medium: 11 }, { hour: "13:00", critical: 5, high: 10, medium: 13 },
  { hour: "14:00", critical: 8, high: 13, medium: 15 }, { hour: "15:00", critical: 6, high: 11, medium: 12 },
  { hour: "16:00", critical: 4, high: 9, medium: 10 }, { hour: "17:00", critical: 5, high: 8, medium: 9 },
  { hour: "18:00", critical: 3, high: 6, medium: 7 }, { hour: "19:00", critical: 2, high: 5, medium: 8 },
  { hour: "20:00", critical: 1, high: 3, medium: 6 }, { hour: "21:00", critical: 2, high: 4, medium: 5 },
  { hour: "22:00", critical: 1, high: 2, medium: 4 }, { hour: "23:00", critical: 0, high: 1, medium: 3 },
];

/* IOC type distribution percentages */
const TYPE_DIST = [
  { type: "Domain", pct: 38, color: "#6366f1" },
  { type: "Server", pct: 28, color: "#f97316" },
  { type: "SHA256", pct: 20, color: "#eab308" },
  { type: "URL", pct: 10, color: "#06b6d4" },
  { type: "Email", pct: 4, color: "#10b981" },
];

/* MITRE ATT&CK tactics — bubble chart data */
const MITRE_BUBBLE_DATA = [
  { x: 1, y: 72, z: 180, name: "Recon", id: "TA0043", active: true },
  { x: 2, y: 25, z: 60,  name: "Resource Dev", id: "TA0042", active: false },
  { x: 3, y: 88, z: 240, name: "Initial Access", id: "TA0001", active: true },
  { x: 4, y: 18, z: 45,  name: "Execution", id: "TA0002", active: false },
  { x: 5, y: 65, z: 160, name: "Persistence", id: "TA0003", active: true },
  { x: 6, y: 20, z: 50,  name: "Priv Esc", id: "TA0004", active: false },
  { x: 7, y: 55, z: 140, name: "Def Evasion", id: "TA0005", active: true },
  { x: 8, y: 78, z: 200, name: "Cred Access", id: "TA0006", active: true },
  { x: 9, y: 60, z: 150, name: "Discovery", id: "TA0007", active: true },
  { x: 10, y: 82, z: 220, name: "Lat Movement", id: "TA0008", active: true },
  { x: 11, y: 15, z: 35,  name: "Collection", id: "TA0009", active: false },
  { x: 12, y: 70, z: 190, name: "Exfiltration", id: "TA0010", active: true },
];

/* Kill chain activity */
const KILL_CHAIN = [
  { stage: "RECONNAISSANCE", count: "14/192", pct: 82, color: "bg-orange-500" },
  { stage: "WEAPONIZATION", count: null, pct: 65, color: "bg-orange-400" },
  { stage: "DELIVERY", count: "32/192", pct: 48, color: "bg-orange-500" },
  { stage: "EXPLOITATION", count: null, pct: 45, color: "bg-red-500" },
  { stage: "INSTALLATION", count: "10/83", pct: 31, color: "bg-orange-400" },
  { stage: "C2 INFRASTRUCTURE", count: null, pct: 62, color: "bg-red-500" },
];

/* Threat feeds */
const THREAT_FEEDS = [
  { name: "AlienVault OTX", sync: "3m ago", iocs: 1246, health: "STABLE", hcls: "text-emerald-600 bg-emerald-50" },
  { name: "MISP Community", sync: "12m ago", iocs: 892, health: "STABLE", hcls: "text-emerald-600 bg-emerald-50" },
  { name: "Abuse.ch", sync: "1h ago", iocs: 45, health: "LAGGING", hcls: "text-amber-600 bg-amber-50" },
  { name: "ThreatFox", sync: "5m ago", iocs: 621, health: "STABLE", hcls: "text-emerald-600 bg-emerald-50" },
];

/* Risky entities */
const RISKY_ENTITIES = [
  { name: "jenks_reina", type: "user", label: "Runbook Violation", score: 94, color: "from-red-500 to-orange-500" },
  { name: "koss_theron", type: "user", label: "", score: 82, color: "from-orange-500 to-amber-500" },
  { name: "SVC_SQL_91", type: "host", label: "", score: 76, color: "from-amber-500 to-yellow-500" },
  { name: "WS_0_31", type: "host", label: "", score: 65, color: "from-yellow-500 to-lime-500" },
];

/* Recent critical alerts */
const RECENT_ALERTS = [
  { title: "Suspicious LSASS Memory Dump", desc: "Detected MiniDump of the AD DC lif, host rds/siem/dc 02.example.com", mitre: "T1003.001", time: "14m ago", sev: "CRITICAL" },
  { title: "Unexpected SSH Outbound to Unknown IP", desc: "Host rds/siem ssh reverse to 191.0.12.43.11", mitre: "T1021.004", time: "1h ago", sev: "HIGH" },
];

export default function ThreatIntelPage() {
  const { data, loading, refresh } = usePolling<ThreatIntelResponse>("/api/threat-intel", 30000);
  const [tab, setTab] = useState("iocs");
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [confFilter, setConfFilter] = useState(0);
  const [expandedPattern, setExpandedPattern] = useState<string | null>(null);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);

  useEffect(() => {
    fetch("/api/ai/investigations/list")
      .then((r) => r.json())
      .then((d) => setInvestigations(d.investigations || []))
      .catch(() => {});
  }, []);

  const iocs = data?.iocs || [];
  const patterns = data?.patterns || [];
  const stats = data?.stats;

  const filteredIOCs = iocs.filter(
    (ioc) =>
      (typeFilter === "All Types" || ioc.type.toLowerCase() === typeFilter.toLowerCase()) &&
      ioc.confidence >= confFilter &&
      (filter === "" ||
        ioc.value.toLowerCase().includes(filter.toLowerCase()) ||
        ioc.type.toLowerCase().includes(filter.toLowerCase()) ||
        ioc.source?.toLowerCase().includes(filter.toLowerCase()) ||
        ioc.tags?.some((t) => t.toLowerCase().includes(filter.toLowerCase())))
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

  return (
    <div className="space-y-6">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Threat Intelligence
          </h2>
          <p className="text-sm text-muted-foreground">
            IOC management, threat patterns, MITRE ATT&CK mapping, and AI-driven enrichment
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="mr-1 h-3 w-3" /> Refresh
        </Button>
      </div>

      {/* ═══ STATS STRIP — 4 Cards ═══ */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total IOCs</p>
                <p className="text-2xl font-bold text-foreground mt-1">{formatNumber(stats?.totalIOCs || iocs.length)}</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10">
                <Shield className="h-4 w-4 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Active Threats</p>
                <p className="text-2xl font-bold text-red-500 mt-1">{formatNumber(stats?.activeThreats || patterns.length)}</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/10">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">MITRE Techniques</p>
                <p className="text-2xl font-bold text-foreground mt-1">{formatNumber(stats?.mitreTechniques || 42)}</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10">
                <Target className="h-4 w-4 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Last Updated</p>
                <p className="text-lg font-semibold text-foreground mt-1">{stats?.lastUpdated ? timeAgo(stats.lastUpdated) : "2 mins ago"}</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <Clock className="h-4 w-4 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ AI-DRIVEN IOC ENRICHMENT BANNER ═══ */}
      <div className="relative overflow-hidden rounded-xl p-5" style={{ background: "linear-gradient(135deg, #f97316 0%, #ea580c 50%, #dc2626 100%)" }}>
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur">
              <Brain className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">AI-Driven IOC Enrichment</p>
              <p className="text-xs text-white/70">Automated pipeline processing real-time telemetry from 14 global feeds.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {[
              { label: "Triage", color: "bg-amber-400" },
              { label: "Hunter", color: "bg-cyan-400" },
              { label: "Verifier", color: "bg-emerald-400" },
            ].map((a) => (
              <span key={a.label} className={cn("px-3 py-1 rounded-full text-[10px] font-bold text-white/90", a.color + "/30 border border-white/20")}>
                <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1.5", a.color)} />
                {a.label}
              </span>
            ))}
            <Link href="/explainability">
              <Button size="sm" className="bg-white text-orange-600 hover:bg-white/90 font-bold text-xs">
                View Deep Analysis
              </Button>
            </Link>
          </div>
        </div>
        {/* Background decoration */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-20 w-32 h-32 bg-white/5 rounded-full translate-y-1/2" />
      </div>

      {/* ═══ ATTACK TIMELINE + IOC TYPE DISTRIBUTION ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Attack Timeline (2/3 width) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4 text-red-500" />
                Attack Timeline (24h)
              </CardTitle>
              <div className="flex items-center gap-3 text-2xs">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Critical</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" /> High</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" /> Medium</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer>
                <AreaChart data={TIMELINE_DATA}>
                  <defs>
                    <linearGradient id="critG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity={0.4}/><stop offset="100%" stopColor="#ef4444" stopOpacity={0}/></linearGradient>
                    <linearGradient id="highG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f97316" stopOpacity={0.3}/><stop offset="100%" stopColor="#f97316" stopOpacity={0}/></linearGradient>
                    <linearGradient id="medG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.2}/><stop offset="100%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={3} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                  <Area type="monotone" dataKey="critical" stroke="#ef4444" fill="url(#critG)" strokeWidth={2} name="Critical" />
                  <Area type="monotone" dataKey="high" stroke="#f97316" fill="url(#highG)" strokeWidth={1.5} name="High" />
                  <Area type="monotone" dataKey="medium" stroke="#06b6d4" fill="url(#medG)" strokeWidth={1} name="Medium" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* IOC Type Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Eye className="h-4 w-4 text-primary" />
              IOC Type Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 mt-2">
              {TYPE_DIST.map((t) => (
                <div key={t.type} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">{t.type}</span>
                    <span className="text-xs font-bold text-foreground">{t.pct}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted/30 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${t.pct}%`, background: t.color }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ MITRE ATT&CK BUBBLE CHART + KILL CHAIN ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* MITRE Coverage Bubble Chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Target className="h-4 w-4 text-primary" />
                MITRE ATT&CK Coverage
              </CardTitle>
              <div className="flex items-center gap-3 text-2xs">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> Active (8)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300" /> Inactive (4)</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    type="number" dataKey="x" domain={[0, 13]} name="Tactic"
                    tick={{ fontSize: 0 }} axisLine={false} tickLine={false}
                  />
                  <YAxis
                    type="number" dataKey="y" domain={[0, 100]} name="Activity"
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false} tickLine={false} label={{ value: "Activity %", angle: -90, position: "insideLeft", fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <ZAxis type="number" dataKey="z" range={[40, 400]} />
                  <RechartsTooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    formatter={(value: number, name: string) => {
                      if (name === "Activity") return [`${value}%`, "Activity Level"];
                      return [value, name];
                    }}
                    labelFormatter={(_, payload) => {
                      if (payload?.[0]?.payload) {
                        const d = payload[0].payload;
                        return `${d.id} — ${d.name}`;
                      }
                      return "";
                    }}
                  />
                  <Scatter data={MITRE_BUBBLE_DATA}>
                    {MITRE_BUBBLE_DATA.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={entry.active ? "#f97316" : "#94a3b8"}
                        fillOpacity={entry.active ? 0.7 : 0.3}
                        stroke={entry.active ? "#ea580c" : "#cbd5e1"}
                        strokeWidth={1.5}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            {/* Tactic labels below chart */}
            <div className="flex justify-between px-2 mt-1">
              {MITRE_BUBBLE_DATA.map((t) => (
                <span key={t.id} className={cn("text-[7px] font-bold uppercase text-center leading-tight w-[60px]", t.active ? "text-orange-600" : "text-muted-foreground/50")}>
                  {t.name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Kill Chain Activity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-orange-500" />
              Cyber Kill Chain Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {KILL_CHAIN.map((k) => (
                <div key={k.stage} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-foreground">{k.stage}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{k.count || `${k.pct}%`}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-muted/30 overflow-hidden">
                    <div className={cn("h-full rounded-full", k.color)} style={{ width: `${k.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ THREAT FEED STATUS + HIGH-RISK ENTITIES ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Threat Feed Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wifi className="h-4 w-4 text-emerald-500" />
              Threat Feed Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 font-medium">FEED SOURCE</th>
                    <th className="pb-2 font-medium">LAST SYNC</th>
                    <th className="pb-2 font-medium">IOCS PULLED</th>
                    <th className="pb-2 font-medium text-right">HEALTH</th>
                  </tr>
                </thead>
                <tbody>
                  {THREAT_FEEDS.map((f) => (
                    <tr key={f.name} className="border-b border-border/30 last:border-0">
                      <td className="py-2.5 font-medium text-foreground">{f.name}</td>
                      <td className="py-2.5 text-muted-foreground">{f.sync}</td>
                      <td className="py-2.5 font-mono">{formatNumber(f.iocs)}</td>
                      <td className="py-2.5 text-right">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold", f.hcls)}>{f.health}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* High-Risk Entities */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-red-500" />
              High-Risk Entities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {RISKY_ENTITIES.map((e) => (
                <div key={e.name} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/10 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={cn("h-8 w-8 rounded-full flex items-center justify-center bg-gradient-to-br text-white text-[10px] font-bold", e.color)}>
                      {e.type === "user" ? <User className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">{e.name}</p>
                      {e.label && <p className="text-[10px] text-muted-foreground">{e.label}</p>}
                    </div>
                  </div>
                  <div className={cn(
                    "text-sm font-bold tabular-nums",
                    e.score >= 90 ? "text-red-500" : e.score >= 70 ? "text-orange-500" : "text-amber-500"
                  )}>
                    {e.score}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ RECENT CRITICAL ALERTS + INVESTIGATION MATCHES ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Critical Alerts */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Recent Critical Alerts
              </CardTitle>
              <Link href="/investigations">
                <Button variant="ghost" size="sm" className="text-xs text-primary">View All</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {RECENT_ALERTS.map((a) => (
                <div key={a.title} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:border-primary/20 transition-colors">
                  <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5", a.sev === "CRITICAL" ? "bg-red-500/10" : "bg-orange-500/10")}>
                    <AlertTriangle className={cn("h-3.5 w-3.5", a.sev === "CRITICAL" ? "text-red-500" : "text-orange-500")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h4 className="text-xs font-semibold text-foreground">{a.title}</h4>
                      <Badge variant={a.sev === "CRITICAL" ? "critical" : "high"} className="text-2xs">{a.sev}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-1">{a.desc}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="purple" className="text-2xs">{a.mitre}</Badge>
                      <span className="text-[10px] text-muted-foreground">{a.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Investigation Matches */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Link2 className="h-4 w-4 text-primary" />
              Investigation Matches
            </CardTitle>
          </CardHeader>
          <CardContent>
            {investigations.length > 0 ? (
              <div className="space-y-2">
                {investigations.slice(0, 4).map((inv) => (
                  <Link key={inv.id} href={`/investigations/${inv.id}`}>
                    <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/10 transition-colors">
                      <div className="flex items-center gap-3">
                        <Badge variant={inv.severity >= 4 ? "critical" : inv.severity >= 3 ? "high" : "medium"} className="text-2xs shrink-0">S{inv.severity}</Badge>
                        <div>
                          <p className="text-xs font-medium text-foreground line-clamp-1">{inv.title}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">{inv.eventCount} events</span>
                            {inv.tags?.slice(0, 2).map((t) => (
                              <Badge key={t} variant="purple" className="text-2xs">{t}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-6 text-center">No active investigations</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ TABBED SECTION: IOCs + Threat Patterns + Reports ═══ */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="iocs"><Shield className="mr-1 h-3 w-3" /> Indicators of Compromise</TabsTrigger>
          <TabsTrigger value="patterns"><Target className="mr-1 h-3 w-3" /> Threat Patterns</TabsTrigger>
          <TabsTrigger value="reports"><FileText className="mr-1 h-3 w-3" /> Reports</TabsTrigger>
        </TabsList>

        {/* IOCs Tab */}
        <TabsContent value="iocs" className="mt-4 space-y-4">
          {/* Filters Row */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-foreground outline-none"
            >
              <option>All Types</option>
              <option>ipv4</option>
              <option>domain</option>
              <option>sha256</option>
              <option>url</option>
              <option>email</option>
            </select>
            <select
              value={confFilter}
              onChange={(e) => setConfFilter(Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-foreground outline-none"
            >
              <option value={0}>All Confidence</option>
              <option value={80}>Confidence &gt; 80</option>
              <option value={90}>Confidence &gt; 90</option>
            </select>
            <div className="relative flex-1 min-w-[200px]">
              <Filter className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search threats, IPs, hashes..."
                className="pl-8 h-9 text-sm"
              />
            </div>
            {filter && <Button variant="ghost" size="sm" className="text-xs" onClick={() => setFilter("")}>Clear</Button>}
            <Button size="sm" className="ml-auto bg-red-500 hover:bg-red-600 text-white text-xs font-bold">
              + Add Manual IOC
            </Button>
          </div>

          {/* IOC Table */}
          <ScrollArea className="h-[500px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 font-medium px-1">TYPE</th>
                  <th className="pb-2 font-medium px-1">VALUE</th>
                  <th className="pb-2 font-medium px-1">CONFIDENCE</th>
                  <th className="pb-2 font-medium px-1">SOURCE</th>
                  <th className="pb-2 font-medium px-1">MITRE</th>
                  <th className="pb-2 font-medium px-1">LAST SEEN</th>
                </tr>
              </thead>
              <tbody>
                {filteredIOCs.map((ioc, i) => {
                  const IconComp = IOC_ICONS[ioc.type.toLowerCase()] || Shield;
                  return (
                    <tr key={i} className="border-b border-border/30 hover:bg-muted/10 transition-colors">
                      <td className="py-3 px-1">
                        <Badge variant="outline" className="text-2xs gap-1">
                          <IconComp className="h-2.5 w-2.5" />{ioc.type}
                        </Badge>
                      </td>
                      <td className="py-3 px-1 font-mono text-foreground max-w-[240px] truncate">{ioc.value}</td>
                      <td className="py-3 px-1">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                            <div className={cn("h-full rounded-full", ioc.confidence >= 90 ? "bg-red-500" : ioc.confidence >= 70 ? "bg-orange-400" : "bg-yellow-400")} style={{ width: `${ioc.confidence}%` }} />
                          </div>
                          <span className="font-mono font-bold">{ioc.confidence}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-1 text-muted-foreground">{ioc.source || "—"}</td>
                      <td className="py-3 px-1">
                        {ioc.mitre ? <Badge variant="purple" className="text-2xs">{ioc.mitre}</Badge> : "—"}
                      </td>
                      <td className="py-3 px-1 text-muted-foreground">{ioc.lastSeen ? timeAgo(ioc.lastSeen) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredIOCs.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {filter || typeFilter !== "All Types" || confFilter > 0 ? "No IOCs match your filters" : "No IOCs available"}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Threat Patterns Tab */}
        <TabsContent value="patterns" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {patterns.map((pattern, idx) => (
              <Card key={idx} className="overflow-hidden hover:border-primary/20 transition-colors">
                <CardContent className="p-0">
                  <div className="flex items-start gap-3 p-4">
                    <div className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full mt-0.5",
                      pattern.severity >= 4 ? "bg-red-500/10" : "bg-orange-500/10"
                    )}>
                      <Target className={cn("h-4 w-4", pattern.severity >= 4 ? "text-red-500" : "text-orange-500")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={pattern.severity >= 4 ? "critical" : "high"} className="text-2xs">
                          {pattern.severity >= 4 ? "CRITICAL" : "HIGH"} · {pattern.mitre}
                        </Badge>
                      </div>
                      <h4 className="text-sm font-semibold text-foreground">{pattern.name}</h4>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{pattern.description}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Shield className="h-2.5 w-2.5" /> {pattern.iocCount} Indicators
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Activity className="h-2.5 w-2.5" /> {pattern.matchedEvents} events
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {patterns.length === 0 && (
              <div className="col-span-2 py-12 text-center text-sm text-muted-foreground">No threat patterns available</div>
            )}
          </div>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="mt-4">
          <div className="py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Threat intelligence reports will appear here</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Generate a report from AI Agents or Explainability to see it in this section</p>
          </div>
        </TabsContent>
      </Tabs>

      {/* ═══ FOOTER ═══ */}
      <div className="border-t border-border pt-4 flex items-center justify-between text-2xs text-muted-foreground">
        <p>© 2024 CyberSentinel Threat Intelligence Platform. All rights reserved.</p>
        <div className="flex items-center gap-4">
          <Link href="/ai-agents" className="hover:text-foreground transition-colors">AI Agents</Link>
          <Link href="/explainability" className="hover:text-foreground transition-colors">Feed Integration</Link>
          <Link href="/investigations" className="hover:text-foreground transition-colors">Contact Support</Link>
          <span>STATUS</span>
        </div>
      </div>
    </div>
  );
}
