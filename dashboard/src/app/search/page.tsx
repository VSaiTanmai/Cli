"use client";

import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
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
  Sparkles,
  Link2,
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

function SearchPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Initialise from URL params (shareable links)
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [table, setTable] = useState(searchParams.get("table") ?? "raw_logs");
  const [timeRange, setTimeRange] = useState(searchParams.get("range") ?? "24h");
  const [severity, setSeverity] = useState(searchParams.get("severity") ?? "");
  const [results, setResults] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [aiMode, setAiMode] = useState(searchParams.get("ai") === "1");
  const [similarity, setSimilarity] = useState<number[]>([]);
  const aiToggledRef = useRef(false);

  const PAGE_SIZE = 50;

  /** Push current filters into the URL without a full navigation */
  const syncUrl = useCallback(
    (overrides?: { q?: string; table?: string; range?: string; severity?: string; ai?: boolean }) => {
      const params = new URLSearchParams();
      const q = overrides?.q ?? query;
      const t = overrides?.table ?? table;
      const r = overrides?.range ?? timeRange;
      const s = overrides?.severity ?? severity;
      const a = overrides?.ai ?? aiMode;
      if (q) params.set("q", q);
      if (t && t !== "raw_logs") params.set("table", t);
      if (r && r !== "24h") params.set("range", r);
      if (s) params.set("severity", s);
      if (a) params.set("ai", "1");
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [query, table, timeRange, severity, aiMode, pathname, router],
  );

  /** Copy shareable link to clipboard */
  const copyLink = useCallback(() => {
    syncUrl();
    navigator.clipboard.writeText(window.location.href).then(() => {
      toast.success("Search link copied to clipboard");
    });
  }, [syncUrl]);

  const doSearch = useCallback(
    async (offset: number = 0) => {
      setLoading(true);
      setError(null);
      setSimilarity([]);
      try {
        if (aiMode && query) {
          // Semantic vector search via LanceDB
          const params = new URLSearchParams({ q: query, limit: String(PAGE_SIZE) });
          if (severity) params.set("filter", `severity >= ${severity}`);
          const res = await fetch(`/api/semantic-search?${params}`, { cache: "no-store" });
          if (!res.ok) {
            if (res.status === 503) throw new Error("AI search service unavailable — is LanceDB running?");
            throw new Error(`HTTP ${res.status}`);
          }
          const json = await res.json();
          const items = (json.results ?? []).map((r: Record<string, unknown>) => ({
            timestamp: r.timestamp,
            log_source: r.log_source,
            hostname: r.hostname,
            severity: r.severity,
            raw: r.text,
            _distance: r._distance,
            source_table: r.source_table,
            event_id: r.event_id,
          }));
          setSimilarity(items.map((r: Record<string, unknown>) => Number(r._distance ?? 0)));
          setResults(items);
          setTotal(items.length);
          setPage(0);
          setSearched(true);
        } else {
          // Standard keyword search via ClickHouse
          const params = new URLSearchParams();
          if (query) params.set("q", query);
          params.set("table", table);
          params.set("limit", String(PAGE_SIZE));
          params.set("offset", String(offset));
          params.set("from", getTimeFrom(timeRange));
          if (severity) params.set("severity", severity);

          const res = await fetch(`/api/events/search?${params}`, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          setResults(json.data ?? []);
          setTotal(json.total ?? 0);
          setPage(Math.floor(offset / PAGE_SIZE));
          setSearched(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [query, table, timeRange, severity, aiMode]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    syncUrl();
    doSearch(0);
  };

  // Auto-load results on mount so users see data immediately
  useEffect(() => {
    doSearch(0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-search when AI mode is toggled and query exists
  useEffect(() => {
    if (aiToggledRef.current && query.trim()) {
      doSearch(0);
    }
    aiToggledRef.current = false;
  }, [aiMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">
          Query events across all ClickHouse tables
          {aiMode && " — AI semantic search powered by LanceDB"}
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
                  data-search-input="true"
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
              <Button
                type="button"
                variant={aiMode ? "default" : "outline"}
                className={`gap-1.5 ${aiMode ? "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white" : ""}`}
                onClick={() => {
                  aiToggledRef.current = true;
                  setAiMode(!aiMode);
                }}
              >
                <Sparkles className="h-4 w-4" />
                {aiMode ? "AI Search On" : "AI Search"}
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
                  onClick={copyLink}
                >
                  <Link2 className="h-3 w-3" /> Share Link
                </Button>
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
                        {aiMode && (
                          <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[80px]">
                            Similarity
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {results.length === 0 ? (
                        <tr>
                          <td
                            colSpan={aiMode ? 6 : 5}
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
                            {aiMode && similarity[idx] !== undefined && (
                              <td className="px-4 py-2 text-center">
                                <span className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                                  similarity[idx] < 0.3 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                  similarity[idx] < 0.6 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                  "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                                }`}>
                                  {(100 - similarity[idx] * 100).toFixed(0)}%
                                </span>
                              </td>
                            )}
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

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageInner />
    </Suspense>
  );
}
