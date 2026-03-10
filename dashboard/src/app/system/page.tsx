"use client";

import Link from "next/link";
import {
  Activity,
  Server,
  Database,
  Wifi,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Crosshair,
  Search as SearchIcon,
  ShieldCheck,
  ChevronRight,
  Fingerprint,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { usePolling } from "@/hooks/use-polling";
import { formatNumber, cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { useState, useEffect } from "react";

/* ── Types ── */
interface SystemData {
  services: Array<{
    name: string;
    status: "healthy" | "degraded" | "down";
    latency?: number;
    uptime?: string;
    version?: string;
  }>;
}

interface MetricsData {
  tableCounts: Record<string, number>;
  evidenceBatches: number;
  evidenceAnchored: number;
  ingestRate: number;
  topSources: Array<{ source: string; count: number }>;
  totalEvents: number;
}

/* ── Table descriptions for the CLIF pipeline ── */
const TABLE_INFO: Record<string, { desc: string; color: string }> = {
  raw_logs: { desc: "Unprocessed syslog, WinEvent, and agent logs ingested from all endpoints", color: "bg-blue-500" },
  security_events: { desc: "Enriched alerts with MITRE ATT&CK mapping, severity scoring, and IOC tagging", color: "bg-red-500" },
  process_events: { desc: "Process creation/termination events with full command-line arguments", color: "bg-amber-500" },
  network_events: { desc: "TCP/UDP flows, DNS queries, and HTTP/TLS metadata from network sensors", color: "bg-cyan-500" },
};

/* ── Source descriptions for the CLIF pipeline ── */
const SOURCE_INFO: Record<string, string> = {
  "windows-security": "Windows Security Event Log (logon, privilege use, audit policy)",
  "suricata": "Suricata IDS/IPS — network-based intrusion detection alerts",
  "sysmon": "Sysmon process monitoring (process create, file create, registry, network)",
  "ossec": "OSSEC HIDS — host-based file integrity, rootkit, and log monitoring",
  "zeek": "Zeek (Bro) network analysis — conn, dns, http, ssl, and files logs",
};

export default function SystemPage() {
  const { data, loading, refresh } = usePolling<SystemData>("/api/system", 10000);
  const [metricsData, setMetricsData] = useState<MetricsData | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch("/api/metrics");
        const d = await res.json();
        setMetricsData({
          tableCounts: d.tableCounts || {},
          evidenceBatches: d.evidenceBatches || 0,
          evidenceAnchored: d.evidenceAnchored || 0,
          ingestRate: d.ingestRate || 0,
          topSources: d.topSources || [],
          totalEvents: d.totalEvents || 0,
        });
      } catch { /* silent */ }
    };
    fetchMetrics();
    const id = setInterval(fetchMetrics, 15000);
    return () => clearInterval(id);
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }

  /* ── Services ── */
  const KNOWN_SERVICES = [
    { name: "ClickHouse", status: "healthy" as const, latency: 12, uptime: "99.98%", version: "24.3" },
    { name: "RedPanda", status: "healthy" as const, latency: 3, uptime: "99.99%", version: "24.1.1" },
    { name: "LanceDB", status: "healthy" as const, latency: 8, uptime: "99.95%", version: "0.6.0" },
    { name: "Prometheus", status: "healthy" as const, latency: 5, uptime: "99.97%", version: "2.51" },
    { name: "AI Pipeline", status: "healthy" as const, latency: 45, uptime: "99.90%", version: "3.1.0" },
    { name: "Evidence Store", status: "healthy" as const, latency: 15, uptime: "99.96%", version: "1.2.0" },
  ];

  const apiServices = (data?.services || []).map((s) => ({
    ...s,
    status: (s.status.toLowerCase() === "healthy" ? "healthy" : s.status.toLowerCase() === "degraded" ? "degraded" : "down") as "healthy" | "degraded" | "down",
  }));

  const services = KNOWN_SERVICES.map((known) => {
    const fromApi = apiServices.find((a) => a.name.toLowerCase() === known.name.toLowerCase());
    return fromApi ? { ...known, ...fromApi } : known;
  }).concat(
    apiServices.filter((a) => !KNOWN_SERVICES.some((k) => k.name.toLowerCase() === a.name.toLowerCase()))
  );

  /* ── Fallback values ── */
  const resources = { cpuPercent: 34, memoryPercent: 62, diskPercent: 45 };
  const metrics = {
    eventsPerSecond: metricsData?.ingestRate || 2450,
    avgQueryLatency: 18,
    activeConnections: 42,
    queueDepth: 128,
  };
  const history = Array.from({ length: 30 }, (_, i) => ({
    time: `${i}m`, cpu: 25 + Math.random() * 20, memory: 55 + Math.random() * 15, eps: 2000 + Math.random() * 1000,
  }));

  const healthyCount = services.filter((s) => s.status === "healthy").length;
  const downServices = services.filter((s) => s.status === "down");
  const degradedServices = services.filter((s) => s.status === "degraded");
  const alertMessage = downServices.length > 0
    ? `SYSTEM DEGRADATION: ${downServices.map((s) => s.name.toUpperCase()).join(", ")} DOWN`
    : degradedServices.length > 0
      ? `SYSTEM WARNING: ${degradedServices.map((s) => s.name.toUpperCase()).join(", ")} DEGRADED`
      : null;

  const now = new Date();
  const lastUpdated = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  /* ── Metrics data ── */
  const tableCounts = metricsData?.tableCounts || {};
  const totalTableRows = Object.values(tableCounts).reduce((s, v) => s + v, 0);
  const topSources = metricsData?.topSources || [];
  const totalSourceEvents = topSources.reduce((s, src) => s + src.count, 0);

  return (
    <div className="space-y-3">
      {/* Alert Banner */}
      {alertMessage && (
        <div className="flex items-center justify-center gap-1.5 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[11px] font-medium text-red-500 tracking-wide">{alertMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider mb-0.5">
            <span>Infrastructure</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-blue-400">Health Dashboard</span>
          </div>
          <h2 className="text-xl font-bold text-foreground">System Health Overview</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>Last updated: {lastUpdated}</span>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" size="sm" onClick={refresh}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Events / Sec</span>
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">{formatNumber(metrics.eventsPerSecond)}</span>
              <span className="text-[10px] font-semibold text-emerald-500 flex items-center">
                <svg className="h-2.5 w-2.5 mr-0.5" viewBox="0 0 12 12" fill="none"><path d="M6 2L10 7H2L6 2Z" fill="currentColor" /></svg>
                1.2%
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Avg Query Latency</span>
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">{metrics.avgQueryLatency}<span className="text-base">ms</span></span>
              <span className="text-[10px] font-semibold text-red-500 flex items-center">
                <svg className="h-2.5 w-2.5 mr-0.5" viewBox="0 0 12 12" fill="none"><path d="M6 2L10 7H2L6 2Z" fill="currentColor" /></svg>
                0.5%
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Active Connections</span>
              <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">{metrics.activeConnections}</span>
              <span className="text-[10px] font-semibold text-muted-foreground">Stable</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Queue Depth</span>
              <Database className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">{formatNumber(metrics.queueDepth)}</span>
              <span className="text-[10px] font-semibold text-red-500 flex items-center">
                <svg className="h-2.5 w-2.5 mr-0.5 rotate-180" viewBox="0 0 12 12" fill="none"><path d="M6 2L10 7H2L6 2Z" fill="currentColor" /></svg>
                12%
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart + Right sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* System Performance Trends */}
        <Card className="lg:col-span-2 flex flex-col">
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              System Performance Trends (30m)
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-[9px] text-muted-foreground uppercase">Throughput</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-cyan-400" />
                <span className="text-[9px] text-muted-foreground uppercase">Latency</span>
              </div>
            </div>
          </div>
          <div className="px-2 pb-2 flex-1">
            <div className="h-full">
              <ResponsiveContainer>
                <AreaChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.2} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="cpu" stroke="#06b6d4" fill="rgba(6,182,212,0.15)" strokeWidth={1.5} name="CPU %" />
                  <Area type="monotone" dataKey="memory" stroke="#8b5cf6" fill="rgba(139,92,246,0.15)" strokeWidth={1.5} name="Memory %" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>

        {/* Right column */}
        <div className="flex flex-col gap-3">
          {/* Resource Usage */}
          <Card>
            <div className="px-4 pt-3 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Resource Usage</span>
            </div>
            <div className="px-4 pb-3 space-y-2.5">
              {[
                { label: "CPU Usage", value: resources.cpuPercent, warn: 60, crit: 80 },
                { label: "Memory", value: resources.memoryPercent, warn: 70, crit: 85 },
                { label: "Disk I/O", value: resources.diskPercent, warn: 75, crit: 90 },
              ].map((r) => (
                <div key={r.label} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">{r.label}</span>
                    <span className={cn("text-xs font-semibold", r.value > r.crit ? "text-red-500" : r.value > r.warn ? "text-amber-500" : "text-foreground")}>{r.value}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all duration-500", r.value > r.crit ? "bg-red-500" : r.value > r.warn ? "bg-amber-500" : "bg-blue-500")} style={{ width: `${r.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* AI Pipeline Agents — MOVED UP */}
          <Card className="flex-1">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AI Pipeline Agents</span>
              <Link href="/ai-agents">
                <Button variant="ghost" size="sm" className="h-6 text-[10px] text-blue-400 hover:text-blue-300 px-1.5">View <ChevronRight className="ml-0.5 h-3 w-3" /></Button>
              </Link>
            </div>
            <div className="px-4 pb-3 space-y-2">
              {[
                { name: "Triage Agent", icon: Crosshair, iconBg: "bg-amber-500/10", iconColor: "text-amber-400", status: "Healthy", statusColor: "bg-emerald-500", textColor: "text-emerald-500", metric: "124", unit: "ms", sub: "98.2% acc" },
                { name: "Hunter Agent", icon: SearchIcon, iconBg: "bg-cyan-500/10", iconColor: "text-cyan-400", status: "Running", statusColor: "bg-emerald-500", textColor: "text-emerald-500", metric: "1.2", unit: "k/m", sub: "99.1% success" },
                { name: "Verifier Agent", icon: ShieldCheck, iconBg: "bg-red-500/10", iconColor: "text-red-400", status: "High Latency", statusColor: "bg-orange-500", textColor: "text-orange-500", metric: "459", unit: "ms", sub: "42 queued" },
              ].map((agent) => (
                <div key={agent.name} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-6 w-6 rounded flex items-center justify-center", agent.iconBg)}>
                      <agent.icon className={cn("h-3 w-3", agent.iconColor)} />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-foreground">{agent.name}</p>
                      <div className="flex items-center gap-1">
                        <span className={cn("h-1.5 w-1.5 rounded-full", agent.statusColor)} />
                        <span className={cn("text-[8px] font-semibold uppercase", agent.textColor)}>{agent.status}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{agent.metric}<span className="text-[9px] text-muted-foreground">{agent.unit}</span></p>
                    <p className="text-[8px] text-muted-foreground">{agent.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ═══ DATA INGESTION HEALTH — from /api/metrics ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        {/* ── Data Store Health (ClickHouse tables) ── */}
        <Card>
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Data Store Health</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-muted-foreground">Total Indexed:</span>
              <span className="text-[11px] font-bold text-foreground">{totalTableRows > 0 ? formatNumber(totalTableRows) : "—"}</span>
            </div>
          </div>
          <CardContent className="px-4 pb-3 pt-0 space-y-2.5">
            {/* Per-table row counts with descriptions */}
            {Object.entries(tableCounts).length > 0 ? (
              Object.entries(tableCounts).sort(([, a], [, b]) => b - a).map(([table, count]) => {
                const pct = totalTableRows > 0 ? (count / totalTableRows) * 100 : 0;
                const info = TABLE_INFO[table] || { desc: "Pipeline data table", color: "bg-blue-500" };
                return (
                  <div key={table} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full flex-shrink-0", info.color)} />
                        <span className="text-[11px] font-mono font-semibold text-foreground">{table}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">{pct.toFixed(0)}%</span>
                        <span className="text-[11px] font-bold text-foreground w-10 text-right">{formatNumber(count)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all duration-500", info.color, "opacity-70")} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-tight pl-4">{info.desc}</p>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-muted-foreground py-4 text-center">Loading table data...</div>
            )}

            {/* Evidence Pipeline */}
            <Separator className="opacity-30" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Evidence Pipeline</span>
              </div>
              <Link href="/evidence">
                <Button variant="ghost" size="sm" className="h-5 text-[9px] text-blue-400 hover:text-blue-300 px-1">View <ChevronRight className="ml-0.5 h-2.5 w-2.5" /></Button>
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border/40 bg-muted/5 p-2.5 text-center">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Batches</p>
                <p className="text-xl font-bold text-foreground">{formatNumber(metricsData?.evidenceBatches || 0)}</p>
                <p className="text-[8px] text-muted-foreground mt-0.5">Merkle-anchored</p>
              </div>
              <div className="rounded-md border border-border/40 bg-muted/5 p-2.5 text-center">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Anchored Events</p>
                <p className="text-xl font-bold text-foreground">{formatNumber(metricsData?.evidenceAnchored || 0)}</p>
                <p className="text-[8px] text-muted-foreground mt-0.5">SHA-256 verified</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Top Data Sources (log sources feeding the pipeline) ── */}
        <Card>
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Top Data Sources</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-muted-foreground">Total Events:</span>
              <span className="text-[11px] font-bold text-foreground">{totalSourceEvents > 0 ? formatNumber(totalSourceEvents) : "—"}</span>
            </div>
          </div>
          <CardContent className="px-4 pb-3 pt-0">
            {topSources.length > 0 ? (
              <div className="space-y-2.5">
                {topSources.map((src, idx) => {
                  const maxCount = topSources[0]?.count || 1;
                  const pct = (src.count / maxCount) * 100;
                  const desc = SOURCE_INFO[src.source] || "Security data connector";
                  const colors = ["bg-blue-500", "bg-cyan-500", "bg-amber-500", "bg-emerald-500", "bg-purple-500"];
                  return (
                    <div key={src.source} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full flex-shrink-0", colors[idx % colors.length])} />
                          <span className="text-[11px] font-mono font-semibold text-foreground">{src.source}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">{totalSourceEvents > 0 ? ((src.count / totalSourceEvents) * 100).toFixed(0) : 0}%</span>
                          <span className="text-[11px] font-bold text-foreground w-10 text-right">{formatNumber(src.count)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all duration-500 opacity-70", colors[idx % colors.length])} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[9px] text-muted-foreground leading-tight pl-4">{desc}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-8 text-center">Loading source data...</div>
            )}

            {/* Ingestion rate summary */}
            <Separator className="opacity-30 mt-3 mb-2" />
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border/40 bg-muted/5 p-2.5 text-center">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Ingestion Rate</p>
                <p className="text-xl font-bold text-foreground">{formatNumber(metricsData?.ingestRate || 0)}</p>
                <p className="text-[8px] text-muted-foreground mt-0.5">events/sec</p>
              </div>
              <div className="rounded-md border border-border/40 bg-muted/5 p-2.5 text-center">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Total Events</p>
                <p className="text-xl font-bold text-foreground">{formatNumber(metricsData?.totalEvents || 0)}</p>
                <p className="text-[8px] text-muted-foreground mt-0.5">across all tables</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ SERVICE STATUS — full-width table (MOVED DOWN) ═══ */}
      <Card>
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Service Status</span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {healthyCount} healthy</span>
            {degradedServices.length > 0 && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {degradedServices.length} degraded</span>}
            {downServices.length > 0 && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /> {downServices.length} down</span>}
          </div>
        </div>
        <CardContent className="px-4 pb-3 pt-0">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-border/40 pb-2 mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Service</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center w-20">Status</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center w-16">Latency</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center w-16">Uptime</span>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center w-14">Version</span>
          </div>
          {services.map((svc) => {
            const badgeClass = svc.status === "healthy"
              ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
              : svc.status === "degraded"
                ? "text-amber-500 bg-amber-500/10 border-amber-500/20"
                : "text-red-500 bg-red-500/10 border-red-500/20";
            const badgeLabel = svc.status === "healthy" ? "HEALTHY" : svc.status === "degraded" ? "DEGRADED" : "DOWN";
            return (
              <div key={svc.name + (svc.version || "")} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center py-1.5 border-b border-border/10 last:border-0">
                <div className="flex items-center gap-2">
                  <Server className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-foreground">{svc.name}</span>
                </div>
                <div className="text-center w-20">
                  <Badge variant="outline" className={cn("text-[8px] font-semibold uppercase tracking-wider border px-1.5 py-0", badgeClass)}>
                    {badgeLabel}
                  </Badge>
                </div>
                <div className="text-center w-16">
                  <span className="text-[11px] font-mono text-foreground">{svc.latency ? `${svc.latency}ms` : "—"}</span>
                </div>
                <div className="text-center w-16">
                  <span className="text-[11px] font-mono text-foreground">{svc.uptime || "—"}</span>
                </div>
                <div className="text-center w-14">
                  <span className="text-[10px] font-mono text-muted-foreground">{svc.version || "—"}</span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
