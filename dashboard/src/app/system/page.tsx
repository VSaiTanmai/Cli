"use client";

import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatNumber } from "@/lib/utils";
import {
  Activity,
  Server,
  Database,
  Radio,
  HardDrive,
  CheckCircle2,
  XCircle,
  RefreshCcw,
  Cpu,
  MemoryStick,
  ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface SystemData {
  services: Array<{ name: string; status: string; metric?: string }>;
  clickhouseInserted: string | null;
  redpandaBrokers: string | null;
}

// Static config for service enrichment
const SERVICE_META: Record<string, { label: string; icon: React.ElementType; category: string }> = {
  clickhouse: { label: "ClickHouse", icon: Database, category: "Storage" },
  redpanda: { label: "Redpanda", icon: Radio, category: "Streaming" },
  "clif-consumer": { label: "CLIF Consumer", icon: Cpu, category: "Pipeline" },
  prometheus: { label: "Prometheus", icon: Activity, category: "Monitoring" },
  grafana: { label: "Grafana", icon: Activity, category: "Monitoring" },
  minio: { label: "MinIO", icon: HardDrive, category: "Storage" },
  node: { label: "Node Exporter", icon: Server, category: "Infrastructure" },
};

function guessServiceKey(name: string): string {
  const lower = name.toLowerCase();
  for (const key of Object.keys(SERVICE_META)) {
    if (lower.includes(key)) return key;
  }
  return "";
}

export default function SystemHealthPage() {
  const { data, loading, refresh } = usePolling<SystemData>("/api/system", 10000);

  const services = data?.services ?? [];

  // Group services by category
  const grouped = services.reduce<Record<string, typeof services>>((acc, svc) => {
    const key = guessServiceKey(svc.name);
    const meta = SERVICE_META[key];
    const category = meta?.category ?? "Other";
    if (!acc[category]) acc[category] = [];
    acc[category].push(svc);
    return acc;
  }, {});

  const healthyCount = services.filter((s) => s.status === "Healthy").length;
  const downCount = services.filter((s) => s.status !== "Healthy").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Live infrastructure monitoring via Prometheus & Redpanda Admin API
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1" onClick={refresh}>
          <RefreshCcw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Status Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-primary/10 p-2">
              <Server className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Services
              </p>
              {loading ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <p className="text-xl font-bold tabular-nums">{services.length}</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-emerald-500/10 p-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Healthy
              </p>
              {loading ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <p className="text-xl font-bold tabular-nums text-emerald-400">
                  {healthyCount}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-red-500/10 p-2">
              <XCircle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Down
              </p>
              {loading ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <p className="text-xl font-bold tabular-nums text-red-400">
                  {downCount}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-md bg-primary/10 p-2">
              <ArrowUpDown className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Redpanda Brokers
              </p>
              {loading ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <p className="text-xl font-bold tabular-nums">
                  {data?.redpandaBrokers ?? "—"}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ClickHouse Stats */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4 text-primary" />
              ClickHouse
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Total Rows Inserted
                </p>
                {loading ? (
                  <Skeleton className="h-8 w-24 mt-1" />
                ) : (
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {data?.clickhouseInserted
                      ? formatNumber(Number(data.clickhouseInserted))
                      : "—"}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Cluster Mode
                </p>
                <p className="mt-1 text-sm font-medium">2-Node ReplicatedMergeTree</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  S3 Tiering
                </p>
                <p className="mt-1 text-sm font-medium text-emerald-400">Active (MinIO)</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Tables
                </p>
                <p className="mt-1 text-sm font-medium">
                  raw_logs, security_events, process_events, network_events
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Radio className="h-4 w-4 text-primary" />
              Redpanda Cluster
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Brokers
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">3</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Partitions
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">12</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Replication Factor
                </p>
                <p className="mt-1 text-sm font-medium">3</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Topics
                </p>
                <p className="mt-1 text-sm font-medium">clif-raw-logs (v2 LZ4)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Service List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-primary" />
            Service Status
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : services.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              <p>No services detected from Prometheus.</p>
              <p className="mt-1 text-xs">
                Ensure Prometheus is running on port 9090 with proper scrape targets.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {services.map((svc, idx) => {
                const key = guessServiceKey(svc.name);
                const meta = SERVICE_META[key];
                const Icon = meta?.icon ?? Server;
                const isHealthy = svc.status === "Healthy";
                return (
                  <div
                    key={idx}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/20"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{meta?.label ?? svc.name}</p>
                      {svc.metric && (
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {svc.metric}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={isHealthy ? "low" : "critical"}
                      className="text-[10px]"
                    >
                      {isHealthy ? (
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                      ) : (
                        <XCircle className="mr-1 h-3 w-3" />
                      )}
                      {svc.status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
