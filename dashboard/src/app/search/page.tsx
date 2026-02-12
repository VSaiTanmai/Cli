"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { severityLabel, severityBgColor, formatNumber } from "@/lib/utils";
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  AlertCircle,
} from "lucide-react";
import type { EventRow } from "@/lib/types";
import { toast } from "sonner";

const TABLES = [
  { value: "raw_logs", label: "Raw Logs" },
  { value: "security_events", label: "Security Events" },
  { value: "process_events", label: "Process Events" },
  { value: "network_events", label: "Network Events" },
];

const TIME_RANGES = [
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

function getTimeFrom(range: string): string {
  const now = new Date();
  const map: Record<string, number> = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };
  return new Date(now.getTime() - (map[range] ?? 60 * 60 * 1000)).toISOString();
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [table, setTable] = useState("raw_logs");
  const [timeRange, setTimeRange] = useState("1h");
  const [severity, setSeverity] = useState("");
  const [results, setResults] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const PAGE_SIZE = 50;

  const doSearch = useCallback(
    async (offset: number = 0) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        params.set("table", table);
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(offset));
        params.set("from", getTimeFrom(timeRange));
        if (severity) params.set("severity", severity);

        const res = await fetch(`/api/events/search?${params}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setResults(json.data ?? []);
        setTotal(json.total ?? 0);
        setPage(Math.floor(offset / PAGE_SIZE));
        setSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [query, table, timeRange, severity]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(0);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">
          Query events across all ClickHouse tables
        </p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSubmit}>
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder='Search events — e.g. "lateral movement", "C102", "mimikatz"'
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9 h-10"
                />
              </div>
              <Button type="submit" disabled={loading} className="gap-1.5 px-6">
                <Search className="h-4 w-4" />
                Search
              </Button>
            </div>

            {/* Filters Row */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Table selector */}
              <div className="flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Table:</span>
                <div className="flex gap-1">
                  {TABLES.map((t) => (
                    <Button
                      key={t.value}
                      type="button"
                      variant={table === t.value ? "secondary" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setTable(t.value)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="h-4 w-px bg-border" />

              {/* Time range */}
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Time:</span>
                <div className="flex gap-1">
                  {TIME_RANGES.map((t) => (
                    <Button
                      key={t.value}
                      type="button"
                      variant={timeRange === t.value ? "secondary" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setTimeRange(t.value)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="h-4 w-px bg-border" />

              {/* Severity filter */}
              <div className="flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Min Severity:</span>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="h-6 rounded-md border bg-background px-1.5 text-[11px]"
                >
                  <option value="">Any</option>
                  <option value="1">Low (1+)</option>
                  <option value="2">Medium (2+)</option>
                  <option value="3">High (3+)</option>
                  <option value="4">Critical (4)</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Results */}
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </CardContent>
        </Card>
      )}

      {searched && (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center justify-between text-sm font-medium">
              <span>
                {formatNumber(total)} results
                {query && ` for "${query}"`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs h-7"
                  onClick={() => {
                    if (results.length === 0) return;
                    const headers = Object.keys(results[0]).join(",");
                    const rows = results.map((r) =>
                      Object.values(r)
                        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
                        .join(",")
                    );
                    const csv = [headers, ...rows].join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `clif-search-${table}-${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success(`Exported ${results.length} rows to CSV`);
                  }}
                >
                  <Download className="h-3 w-3" /> Export CSV
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/30">
                      <tr className="border-b text-left">
                        <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[170px]">
                          Timestamp
                        </th>
                        <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[70px]">
                          Severity
                        </th>
                        <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[100px]">
                          Source
                        </th>
                        <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[100px]">
                          Host
                        </th>
                        <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Content
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-12 text-center text-sm text-muted-foreground"
                          >
                            No results found
                          </td>
                        </tr>
                      ) : (
                        results.map((row, idx) => (
                          <tr
                            key={idx}
                            className="border-b border-border/30 transition-colors hover:bg-muted/20"
                          >
                            <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                              {row.timestamp
                                ? new Date(row.timestamp).toLocaleString("en-US", {
                                    month: "short",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                    hour12: false,
                                  })
                                : "—"}
                            </td>
                            <td className="px-4 py-2">
                              {row.severity !== undefined ? (
                                <span
                                  className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${severityBgColor(row.severity)}`}
                                >
                                  {severityLabel(row.severity)}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2 font-mono text-[11px]">
                              {row.log_source ?? "—"}
                            </td>
                            <td className="px-4 py-2 font-mono text-[11px]">
                              {row.hostname ?? "—"}
                            </td>
                            <td className="max-w-0 truncate px-4 py-2 font-mono text-[11px] text-muted-foreground">
                              {row.raw ?? JSON.stringify(row).slice(0, 300)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t px-4 py-3">
                    <span className="text-xs text-muted-foreground">
                      Page {page + 1} of {totalPages}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={page === 0}
                        onClick={() => doSearch((page - 1) * PAGE_SIZE)}
                        className="h-7"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" /> Prev
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={page >= totalPages - 1}
                        onClick={() => doSearch((page + 1) * PAGE_SIZE)}
                        className="h-7"
                      >
                        Next <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
