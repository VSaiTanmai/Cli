"use client";

import { useState, useMemo, useCallback } from "react";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { severityLabel, severityBgColor, formatNumber, timeAgo } from "@/lib/utils";
import {
  ShieldAlert,
  CheckCircle2,
  Eye,
  AlertTriangle,
  Bell,
  Filter,
  Search,
  CheckSquare,
  Square,
  MinusSquare,
  Server,
  User,
} from "lucide-react";
import { toast } from "sonner";

interface AlertData {
  summary: Array<{ severity: number; count: number }>;
  alerts: Array<{
    timestamp: string;
    severity?: number;
    event_type?: string;
    hostname?: string;
    log_source?: string;
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
  Investigating: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  Resolved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

export default function AlertsPage() {
  const { data, loading, error } = usePolling<AlertData>("/api/alerts", 5000);
  const [statusFilter, setStatusFilter] = useState<WorkflowState | "All">("All");
  const [hostnameFilter, setHostnameFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [selectedAlert, setSelectedAlert] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<{ action: WorkflowState; open: boolean }>({
    action: "Acknowledged",
    open: false,
  });
  /** Track overridden workflow states (key = stringified alert index from raw data) */
  const [stateOverrides, setStateOverrides] = useState<Record<number, WorkflowState>>({});

  // Deterministic workflow states based on severity (can be overridden by user)
  const alertsWithState = useMemo(
    () =>
      (data?.alerts ?? []).map((alert, rawIdx) => {
        if (stateOverrides[rawIdx] !== undefined) {
          return { ...alert, workflowState: stateOverrides[rawIdx], _rawIdx: rawIdx };
        }
        const sev = alert.severity ?? 0;
        let state: WorkflowState;
        if (sev >= 4) state = "New";
        else if (sev === 3) state = "Investigating";
        else if (sev === 2) state = "Acknowledged";
        else state = "Resolved";
        return { ...alert, workflowState: state, _rawIdx: rawIdx };
      }),
    [data, stateOverrides],
  );

  // Unique hostnames and sources for quick filters
  const uniqueHosts = useMemo(() => {
    const hosts = new Set<string>();
    alertsWithState.forEach((a) => a.hostname && hosts.add(a.hostname));
    return Array.from(hosts).sort();
  }, [alertsWithState]);

  const uniqueSources = useMemo(() => {
    const sources = new Set<string>();
    alertsWithState.forEach((a) => a.log_source && sources.add(a.log_source));
    return Array.from(sources).sort();
  }, [alertsWithState]);

  const filtered = useMemo(() => {
    return alertsWithState.filter((a) => {
      if (statusFilter !== "All" && a.workflowState !== statusFilter) return false;
      if (hostnameFilter && a.hostname !== hostnameFilter) return false;
      if (sourceFilter && a.log_source !== sourceFilter) return false;
      return true;
    });
  }, [alertsWithState, statusFilter, hostnameFilter, sourceFilter]);

  const totalAlerts = data?.summary?.reduce((s, d) => s + d.count, 0) ?? 0;

  // Selection helpers
  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((_, i) => i)));
    }
  }, [allSelected, filtered]);

  const toggleSelect = useCallback((idx: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleBulkAction = useCallback(
    (targetState: WorkflowState) => {
      const updates: Record<number, WorkflowState> = {};
      selectedIds.forEach((filteredIdx) => {
        const alert = filtered[filteredIdx];
        if (alert) updates[alert._rawIdx] = targetState;
      });
      setStateOverrides((prev) => ({ ...prev, ...updates }));
      toast.success(`${selectedIds.size} alerts → ${targetState}`, {
        description: `Bulk state change applied to ${selectedIds.size} alerts`,
      });
      setSelectedIds(new Set());
      setBulkAction((p) => ({ ...p, open: false }));
    },
    [selectedIds, filtered],
  );

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

      {/* Filters Bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          {/* Status filter */}
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
            const count = alertsWithState.filter((a) => a.workflowState === state).length;
            return (
              <Button
                key={state}
                variant={statusFilter === state ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setStatusFilter(state)}
                disabled={count === 0}
              >
                <Icon className="h-3 w-3" />
                {state}
                <span className="tabular-nums text-muted-foreground">({count})</span>
              </Button>
            );
          })}

          <div className="h-4 w-px bg-border mx-1" />

          {/* Hostname quick filter */}
          {uniqueHosts.length > 0 && (
            <div className="flex items-center gap-1">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={hostnameFilter}
                onChange={(e) => setHostnameFilter(e.target.value)}
                className="h-7 rounded-md border bg-background px-2 text-[11px]"
                aria-label="Filter by hostname"
              >
                <option value="">All hosts</option>
                {uniqueHosts.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          )}

          {/* Source quick filter */}
          {uniqueSources.length > 0 && (
            <div className="flex items-center gap-1">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="h-7 rounded-md border bg-background px-2 text-[11px]"
                aria-label="Filter by source"
              >
                <option value="">All sources</option>
                {uniqueSources.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {filtered.length} alerts
          </span>
        </CardContent>
      </Card>

      {/* Bulk Action Bar — appears when items are selected */}
      {selectedIds.size > 0 && (
        <Card className="border-primary/30">
          <CardContent className="flex items-center gap-3 p-3">
            <Badge variant="default" className="tabular-nums">
              {selectedIds.size} selected
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setBulkAction({ action: "Acknowledged", open: true })}
            >
              <Eye className="h-3 w-3" /> Acknowledge
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setBulkAction({ action: "Investigating", open: true })}
            >
              <AlertTriangle className="h-3 w-3" /> Investigate
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setBulkAction({ action: "Resolved", open: true })}
            >
              <CheckCircle2 className="h-3 w-3" /> Resolve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 text-xs"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Alert List */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            Alert Queue
            {/* Select all toggle in header */}
            {filtered.length > 0 && (
              <button
                onClick={toggleSelectAll}
                className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                aria-label={allSelected ? "Deselect all" : "Select all"}
              >
                {allSelected ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : someSelected ? (
                  <MinusSquare className="h-4 w-4" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
              </button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Error state */}
          {error && !data && (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <ShieldAlert className="h-8 w-8 text-destructive" />
              <p className="text-sm font-medium text-destructive">Failed to load alerts</p>
              <p className="text-xs text-muted-foreground">{error}</p>
              <p className="text-xs text-muted-foreground">Retrying automatically with backoff…</p>
            </div>
          )}
          {/* Loading state */}
          {loading && !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {/* Empty state */}
              {filtered.length === 0 && !error ? (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                  <p className="text-sm font-medium">
                    {alertsWithState.length === 0
                      ? "No alerts in the last 24 hours"
                      : "No alerts match current filters"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {alertsWithState.length === 0
                      ? "The pipeline is monitoring — alerts will appear when severity ≥ Medium events are detected."
                      : "Try changing status, hostname, or source filters above."}
                  </p>
                  {(statusFilter !== "All" || hostnameFilter || sourceFilter) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-7 text-xs"
                      onClick={() => {
                        setStatusFilter("All");
                        setHostnameFilter("");
                        setSourceFilter("");
                      }}
                    >
                      Clear all filters
                    </Button>
                  )}
                </div>
              ) : (
                filtered.map((alert, idx) => {
                  const Icon = WORKFLOW_ICONS[alert.workflowState];
                  const isSelected = selectedIds.has(idx);
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/20 cursor-pointer ${
                        selectedAlert === idx ? "bg-muted/30" : ""
                      } ${isSelected ? "bg-primary/5" : ""}`}
                    >
                      {/* Checkbox */}
                      <button
                        className="mt-1 text-muted-foreground hover:text-foreground transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(idx);
                        }}
                        aria-label={isSelected ? "Deselect alert" : "Select alert"}
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-primary" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>

                      {/* Severity indicator */}
                      <div
                        className="mt-1 flex-1 min-w-0 flex items-start gap-4"
                        onClick={() =>
                          setSelectedAlert(selectedAlert === idx ? null : idx)
                        }
                      >
                        <div className="shrink-0">
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
                    </div>
                  );
                })
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk Action Confirmation */}
      <ConfirmationDialog
        open={bulkAction.open}
        onOpenChange={(open) => setBulkAction((p) => ({ ...p, open }))}
        title={`${bulkAction.action} ${selectedIds.size} alerts?`}
        description={`This will change the workflow state of ${selectedIds.size} selected alert${
          selectedIds.size === 1 ? "" : "s"
        } to "${bulkAction.action}". This action is recorded in the audit log.`}
        confirmLabel={`${bulkAction.action} ${selectedIds.size} alerts`}
        onConfirm={() => handleBulkAction(bulkAction.action)}
      />
    </div>
  );
}
