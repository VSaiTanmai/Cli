"use client";

import Link from "next/link";
import {
  Activity,
  Server,
  Database,
  HardDrive,
  Cpu,
  MemoryStick,
  Wifi,
  WifiOff,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Brain,
  Crosshair,
  Search as SearchIcon,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { usePolling } from "@/hooks/use-polling";
import { formatNumber, formatBytes, cn } from "@/lib/utils";

interface SystemData {
  services: Array<{
    name: string;
    status: "healthy" | "degraded" | "down";
    latency?: number;
    uptime?: string;
    version?: string;
  }>;
  resources?: {
    cpuPercent: number;
    memoryPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskPercent: number;
    diskUsed: number;
    diskTotal: number;
  };
  metrics?: {
    eventsPerSecond: number;
    avgQueryLatency: number;
    activeConnections: number;
    queueDepth: number;
  };
  history?: Array<{
    time: string;
    cpu: number;
    memory: number;
    eps: number;
  }>;
}

const STATUS_CONFIG = {
  healthy: { icon: CheckCircle, color: "text-emerald-400", badge: "success" as const },
  degraded: { icon: AlertTriangle, color: "text-amber-400", badge: "warning" as const },
  down: { icon: XCircle, color: "text-destructive", badge: "destructive" as const },
};

export default function SystemPage() {
  const { data, loading, refresh } = usePolling<SystemData>("/api/system", 10000);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }

  const services = (data?.services || [
    { name: "ClickHouse", status: "healthy" as const, latency: 12, uptime: "99.98%", version: "24.3" },
    { name: "RedPanda", status: "healthy" as const, latency: 3, uptime: "99.99%", version: "24.1.1" },
    { name: "LanceDB", status: "healthy" as const, latency: 8, uptime: "99.95%", version: "0.6.0" },
    { name: "Prometheus", status: "healthy" as const, latency: 5, uptime: "99.97%", version: "2.51" },
    { name: "AI Pipeline", status: "healthy" as const, latency: 45, uptime: "99.90%", version: "3.1.0" },
    { name: "Evidence Store", status: "healthy" as const, latency: 15, uptime: "99.96%", version: "1.2.0" },
  ]).map((s) => ({
    ...s,
    status: (s.status.toLowerCase() === "healthy" ? "healthy" : s.status.toLowerCase() === "degraded" ? "degraded" : "down") as "healthy" | "degraded" | "down",
  }));

  const resources = data?.resources || {
    cpuPercent: 34,
    memoryPercent: 62,
    memoryUsed: 12.8e9,
    memoryTotal: 20.6e9,
    diskPercent: 45,
    diskUsed: 180e9,
    diskTotal: 400e9,
  };

  const metrics = data?.metrics || {
    eventsPerSecond: 2450,
    avgQueryLatency: 18,
    activeConnections: 42,
    queueDepth: 128,
  };

  const history = data?.history || Array.from({ length: 30 }, (_, i) => ({
    time: `${i}m`,
    cpu: 25 + Math.random() * 20,
    memory: 55 + Math.random() * 15,
    eps: 2000 + Math.random() * 1000,
  }));

  const healthyCount = services.filter((s) => s.status === "healthy").length;
  const overallStatus = healthyCount === services.length
    ? "healthy"
    : healthyCount >= services.length * 0.8
      ? "degraded"
      : "down";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            System Health
          </h2>
          <p className="text-sm text-muted-foreground">
            Infrastructure monitoring and service status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_CONFIG[overallStatus].badge}>
            {overallStatus === "healthy" ? "All Systems Operational" : overallStatus === "degraded" ? "Degraded" : "Outage"}
          </Badge>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-nexus-cyan" />
              <p className="text-xs text-muted-foreground">Events/sec</p>
            </div>
            <p className="mt-1 text-xl font-bold text-foreground">
              {formatNumber(metrics.eventsPerSecond)}
            </p>
          </CardContent>
        </Card>
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-nexus-purple" />
              <p className="text-xs text-muted-foreground">Avg Query Latency</p>
            </div>
            <p className="mt-1 text-xl font-bold text-foreground">
              {metrics.avgQueryLatency}ms
            </p>
          </CardContent>
        </Card>
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-primary" />
              <p className="text-xs text-muted-foreground">Active Connections</p>
            </div>
            <p className="mt-1 text-xl font-bold text-foreground">
              {metrics.activeConnections}
            </p>
          </CardContent>
        </Card>
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-amber-400" />
              <p className="text-xs text-muted-foreground">Queue Depth</p>
            </div>
            <p className="mt-1 text-xl font-bold text-foreground">
              {formatNumber(metrics.queueDepth)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Service status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              Service Status
            </CardTitle>
            <CardDescription>
              {healthyCount}/{services.length} services healthy
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {services.map((svc) => {
                const cfg = STATUS_CONFIG[svc.status];
                const StatusIcon = cfg.icon;
                return (
                  <div
                    key={svc.name}
                    className="flex items-center justify-between rounded-lg border border-border bg-muted/5 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <StatusIcon className={cn("h-4 w-4", cfg.color)} />
                      <div>
                        <p className="text-sm font-medium text-foreground">{svc.name}</p>
                        <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                          {svc.version && <span>v{svc.version}</span>}
                          {svc.uptime && (
                            <>
                              <span>·</span>
                              <span>{svc.uptime} uptime</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {svc.latency != null && (
                        <span className="text-xs font-mono text-muted-foreground">
                          {svc.latency}ms
                        </span>
                      )}
                      <Badge variant={cfg.badge} className="text-2xs">
                        {svc.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Resource usage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu className="h-4 w-4 text-nexus-cyan" />
              Resource Usage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* CPU */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Cpu className="h-3 w-3" /> CPU
                </span>
                <span className={cn(
                  "font-mono font-medium",
                  resources.cpuPercent > 80 ? "text-destructive" : resources.cpuPercent > 60 ? "text-amber-400" : "text-foreground"
                )}>
                  {resources.cpuPercent}%
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    resources.cpuPercent > 80 ? "bg-destructive" : resources.cpuPercent > 60 ? "bg-amber-400" : "bg-nexus-cyan"
                  )}
                  style={{ width: `${resources.cpuPercent}%` }}
                />
              </div>
            </div>

            {/* Memory */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <MemoryStick className="h-3 w-3" /> Memory
                </span>
                <span className="font-mono font-medium text-foreground">
                  {formatBytes(resources.memoryUsed)} / {formatBytes(resources.memoryTotal)} ({resources.memoryPercent}%)
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    resources.memoryPercent > 85 ? "bg-destructive" : resources.memoryPercent > 70 ? "bg-amber-400" : "bg-nexus-purple"
                  )}
                  style={{ width: `${resources.memoryPercent}%` }}
                />
              </div>
            </div>

            {/* Disk */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <HardDrive className="h-3 w-3" /> Disk
                </span>
                <span className="font-mono font-medium text-foreground">
                  {formatBytes(resources.diskUsed)} / {formatBytes(resources.diskTotal)} ({resources.diskPercent}%)
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${resources.diskPercent}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System trends */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">System Trends (30 min)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="time"
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
                <Area type="monotone" dataKey="cpu" stroke="#06b6d4" fill="rgba(6,182,212,0.15)" strokeWidth={1.5} name="CPU %" />
                <Area type="monotone" dataKey="memory" stroke="#8b5cf6" fill="rgba(139,92,246,0.15)" strokeWidth={1.5} name="Memory %" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* AI Pipeline Service Health */}
      <Card className="border-nexus-cyan/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Brain className="h-4 w-4 text-nexus-cyan" />
                AI Pipeline Service Health
              </CardTitle>
              <CardDescription>Per-agent processing status and queue depths</CardDescription>
            </div>
            <Link href="/ai-agents">
              <Button variant="ghost" size="sm" className="text-xs">View Agents <ChevronRight className="ml-1 h-3 w-3" /></Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Triage Agent */}
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Crosshair className="h-4 w-4 text-amber-400" />
                  <span className="text-sm font-medium text-foreground">Triage Agent</span>
                </div>
                <Badge variant="success" className="text-2xs">Running</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Queue Depth</p>
                  <p className="font-mono font-bold text-foreground">42</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg Latency</p>
                  <p className="font-mono font-bold text-foreground">85ms</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Processed/hr</p>
                  <p className="font-mono font-bold text-foreground">1,240</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Error Rate</p>
                  <p className="font-mono font-bold text-emerald-400">0.02%</p>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div className="h-full rounded-full bg-amber-400/60 w-[35%]" />
              </div>
            </div>

            {/* Hunter Agent */}
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SearchIcon className="h-4 w-4 text-nexus-cyan" />
                  <span className="text-sm font-medium text-foreground">Hunter Agent</span>
                </div>
                <Badge variant="success" className="text-2xs">Running</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Queue Depth</p>
                  <p className="font-mono font-bold text-foreground">18</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg Latency</p>
                  <p className="font-mono font-bold text-foreground">340ms</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Correlated/hr</p>
                  <p className="font-mono font-bold text-foreground">380</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Error Rate</p>
                  <p className="font-mono font-bold text-emerald-400">0.05%</p>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div className="h-full rounded-full bg-nexus-cyan/60 w-[55%]" />
              </div>
            </div>

            {/* Verifier Agent */}
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-medium text-foreground">Verifier Agent</span>
                </div>
                <Badge variant="success" className="text-2xs">Running</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Queue Depth</p>
                  <p className="font-mono font-bold text-foreground">7</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg Latency</p>
                  <p className="font-mono font-bold text-foreground">220ms</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Verified/hr</p>
                  <p className="font-mono font-bold text-foreground">295</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Error Rate</p>
                  <p className="font-mono font-bold text-emerald-400">0.01%</p>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-400/60 w-[25%]" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
