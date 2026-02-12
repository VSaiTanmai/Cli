"use client";

import { useState } from "react";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { severityLabel, severityBgColor, formatNumber, timeAgo } from "@/lib/utils";
import {
  ShieldAlert,
  CheckCircle2,
  Eye,
  AlertTriangle,
  Bell,
  Filter,
} from "lucide-react";

interface AlertData {
  summary: Array<{ severity: number; count: number }>;
  alerts: Array<{
    timestamp: string;
    severity?: number;
    event_type?: string;
    hostname?: string;
    raw?: string;
    [key: string]: unknown;
  }>;
}

const WORKFLOW_STATES = ["New", "Acknowledged", "Investigating", "Resolved"] as const;
type WorkflowState = (typeof WORKFLOW_STATES)[number];

const WORKFLOW_ICONS: Record<WorkflowState, React.ElementType> = {
  New: Bell,
  Acknowledged: Eye,
  Investigating: AlertTriangle,
  Resolved: CheckCircle2,
};

const WORKFLOW_STYLES: Record<WorkflowState, string> = {
  New: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Acknowledged: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Investigating: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  Resolved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

export default function AlertsPage() {
  const { data, loading } = usePolling<AlertData>("/api/alerts", 5000);
  const [statusFilter, setStatusFilter] = useState<WorkflowState | "All">("All");
  const [selectedAlert, setSelectedAlert] = useState<number | null>(null);

  // Deterministic workflow states based on severity and timestamp hash
  const alertsWithState = (data?.alerts ?? []).map((alert) => {
    // Deterministic: severity 4 → New, 3 → Investigating, 2 → Acknowledged, else Resolved
    const sev = alert.severity ?? 0;
    let state: WorkflowState;
    if (sev >= 4) state = "New";
    else if (sev === 3) state = "Investigating";
    else if (sev === 2) state = "Acknowledged";
    else state = "Resolved";
    return { ...alert, workflowState: state };
  });

  const filtered =
    statusFilter === "All"
      ? alertsWithState
      : alertsWithState.filter((a) => a.workflowState === statusFilter);

  const totalAlerts =
    data?.summary?.reduce((s, d) => s + d.count, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            Security alerts with severity ≥ Medium (last 24h)
          </p>
        </div>
        <Badge variant="outline" className="tabular-nums text-sm">
          {formatNumber(totalAlerts)} total
        </Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 md:grid-cols-4">
        {(data?.summary ?? [])
          .sort((a, b) => b.severity - a.severity)
          .map((s) => (
            <Card key={s.severity}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {severityLabel(s.severity)}
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {formatNumber(s.count)}
                  </p>
                </div>
                <div
                  className={`rounded-md p-2 ${severityBgColor(s.severity)}`}
                >
                  <ShieldAlert className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          ))}
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
      </div>

      {/* Workflow Filter */}
      <Card>
        <CardContent className="flex items-center gap-2 p-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Status:</span>
          <Button
            variant={statusFilter === "All" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setStatusFilter("All")}
          >
            All
          </Button>
          {WORKFLOW_STATES.map((state) => {
            const Icon = WORKFLOW_ICONS[state];
            return (
              <Button
                key={state}
                variant={statusFilter === state ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setStatusFilter(state)}
              >
                <Icon className="h-3 w-3" />
                {state}
              </Button>
            );
          })}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {filtered.length} alerts
          </span>
        </CardContent>
      </Card>

      {/* Alert List */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm font-medium">Alert Queue</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {filtered.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No alerts match the filter
                </div>
              ) : (
                filtered.map((alert, idx) => {
                  const Icon = WORKFLOW_ICONS[alert.workflowState];
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-4 px-4 py-3 transition-colors hover:bg-muted/20 cursor-pointer ${
                        selectedAlert === idx ? "bg-muted/30" : ""
                      }`}
                      onClick={() =>
                        setSelectedAlert(selectedAlert === idx ? null : idx)
                      }
                    >
                      {/* Severity indicator */}
                      <div className="mt-1">
                        {alert.severity !== undefined ? (
                          <span
                            className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${severityBgColor(alert.severity)}`}
                          >
                            {severityLabel(alert.severity)}
                          </span>
                        ) : null}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {alert.event_type ?? "Security Event"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            on {alert.hostname ?? "—"}
                          </span>
                        </div>
                        {selectedAlert === idx && alert.raw && (
                          <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-background p-2 font-mono text-[11px] text-muted-foreground">
                            {alert.raw}
                          </pre>
                        )}
                      </div>

                      {/* Status & time */}
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${
                            WORKFLOW_STYLES[alert.workflowState]
                          }`}
                        >
                          <Icon className="h-2.5 w-2.5" />
                          {alert.workflowState}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {alert.timestamp ? timeAgo(alert.timestamp) : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
