"use client";

import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatRate, severityLabel, severityBgColor } from "@/lib/utils";
import {
  Activity,
  Database,
  ShieldAlert,
  Clock,
  TrendingUp,
  Server,
  Layers,
  Shield,
} from "lucide-react";
import type { DashboardMetrics } from "@/lib/types";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const SEVERITY_COLORS: Record<number, string> = {
  0: "#64748b",
  1: "#22c55e",
  2: "#3b82f6",
  3: "#f59e0b",
  4: "#ef4444",
};

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  loading,
  accent,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  loading: boolean;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className={`text-2xl font-bold tabular-nums ${accent ?? ""}`}>
                {value}
              </p>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="rounded-md bg-primary/10 p-2">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold">{formatNumber(payload[0].value)} events</p>
    </div>
  );
}

export default function DashboardPage() {
  const { data, loading } = usePolling<DashboardMetrics>(
    "/api/metrics",
    5000
  );

  const uptime = data?.uptime ? `${data.uptime}%` : "—";

  const timelineData = (data?.eventsTimeline ?? []).map((d) => ({
    time: new Date(d.time).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    count: d.count,
  }));

  const severityData = (data?.severityDistribution ?? []).map((d) => ({
    label: severityLabel(d.severity),
    count: d.count,
    severity: d.severity,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Real-time security operations overview
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Events"
          value={data ? formatNumber(data.totalEvents) : "—"}
          subtitle="All time ingested"
          icon={Database}
          loading={loading}
        />
        <KpiCard
          title="Ingestion Rate"
          value={data ? formatRate(data.ingestRate) : "—"}
          subtitle="Current throughput"
          icon={TrendingUp}
          loading={loading}
        />
        <KpiCard
          title="Active Alerts"
          value={data ? formatNumber(data.activeAlerts) : "—"}
          subtitle="Past 24 hours"
          icon={ShieldAlert}
          loading={loading}
          accent={
            data && data.activeAlerts > 0 ? "text-severity-high" : undefined
          }
        />
        <KpiCard
          title="Uptime"
          value={uptime}
          subtitle="Pipeline availability"
          icon={Clock}
          loading={loading}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Events Timeline — 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Activity className="h-4 w-4 text-primary" />
              Events / Minute
              <span className="ml-auto text-xs text-muted-foreground">
                {timelineData.length > 0 ? `${timelineData.length} data points` : "Last 30 minutes"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {loading || timelineData.length === 0 ? (
              <Skeleton className="h-[240px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart
                  data={timelineData}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(0 0% 14%)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10, fill: "hsl(0 0% 55%)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(0 0% 55%)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatNumber(v)}
                  />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(217 91% 60%)"
                    strokeWidth={2}
                    fill="url(#grad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Severity Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="h-4 w-4 text-severity-high" />
              Security Severity
              <span className="ml-auto text-xs text-muted-foreground">
                24h
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {loading || severityData.length === 0 ? (
              <Skeleton className="h-[240px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={severityData}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid stroke="hsl(0 0% 14%)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "hsl(0 0% 55%)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(0 0% 55%)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {severityData.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={SEVERITY_COLORS[entry.severity] ?? "#64748b"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-Table Breakdown + Evidence Chain */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Per-Table Event Counts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Layers className="h-4 w-4 text-primary" />
              Event Distribution by Table
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { key: "raw_logs", label: "Raw Logs", color: "bg-blue-500" },
                  { key: "security_events", label: "Security Events", color: "bg-red-500" },
                  { key: "process_events", label: "Process Events", color: "bg-amber-500" },
                  { key: "network_events", label: "Network Events", color: "bg-emerald-500" },
                ].map((t) => {
                  const count = data?.tableCounts?.[t.key] ?? 0;
                  const total = data?.totalEvents || 1;
                  const pct = (count / total) * 100;
                  return (
                    <div key={t.key} className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${t.color}`} />
                      <span className="text-xs w-32 truncate">{t.label}</span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${t.color}/60 transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">
                        {formatNumber(count)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Evidence Chain Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Shield className="h-4 w-4 text-emerald-400" />
              Merkle Evidence Chain
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-xs text-muted-foreground">Anchor Batches</span>
                  <span className="tabular-nums text-sm font-bold">{data?.evidenceBatches ?? 0}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-xs text-muted-foreground">Events Anchored</span>
                  <span className="tabular-nums text-sm font-bold">{formatNumber(data?.evidenceAnchored ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <span className="text-xs text-emerald-400">Chain Integrity</span>
                  <Badge variant="low" className="text-[10px]">
                    {(data?.evidenceBatches ?? 0) > 0 ? "Verified" : "No Data"}
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Sources & Recent Alerts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top Sources */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Server className="h-4 w-4 text-primary" />
              Top Sources
              <span className="ml-auto text-xs text-muted-foreground">
                Past hour
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                {(data?.topSources ?? []).map((s, i) => {
                  const maxCount =
                    data?.topSources?.[0]?.count ?? 1;
                  const pct = (s.count / maxCount) * 100;
                  return (
                    <div key={i} className="group flex items-center gap-3 text-sm">
                      <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs">{s.source}</span>
                          <span className="tabular-nums text-xs text-muted-foreground">
                            {formatNumber(s.count)}
                          </span>
                        </div>
                        <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/60 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Severity Alerts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="h-4 w-4 text-severity-critical" />
              Severity Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {(data?.severityDistribution ?? [])
                  .sort((a, b) => b.severity - a.severity)
                  .map((s) => (
                    <div
                      key={s.severity}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            s.severity >= 4
                              ? "critical"
                              : s.severity >= 3
                                ? "high"
                                : s.severity >= 2
                                  ? "medium"
                                  : s.severity >= 1
                                    ? "low"
                                    : "info"
                          }
                        >
                          {severityLabel(s.severity)}
                        </Badge>
                      </div>
                      <span className="tabular-nums text-sm font-medium">
                        {formatNumber(s.count)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
