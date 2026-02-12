"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { severityLabel, severityBgColor, timeAgo, formatNumber } from "@/lib/utils";
import { Radio, Pause, Play, ArrowDown, Filter, RotateCcw, Database } from "lucide-react";
import type { EventRow } from "@/lib/types";

const MAX_ROWS = 2000;

const TABLE_OPTIONS = [
  { value: "all", label: "All Tables" },
  { value: "raw_logs", label: "Raw Logs" },
  { value: "security_events", label: "Security" },
  { value: "process_events", label: "Process" },
  { value: "network_events", label: "Network" },
];

interface StreamEvent extends EventRow {
  _table?: string;
}

export default function LiveFeedPage() {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [tableFilter, setTableFilter] = useState("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [totalReceived, setTotalReceived] = useState(0);
  const [rate, setRate] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const rateCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** Track latest seen event_id to deduplicate across polls */
  const seenIdsRef = useRef(new Set<string>());

  // Poll for new events — deduplicating by event_id
  const fetchEvents = useCallback(async () => {
    if (paused) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/events/stream?table=${tableFilter}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return;
      const json = await res.json();
      const incoming = (json.data ?? []) as StreamEvent[];
      if (incoming.length > 0) {
        setEvents((prev) => {
          // Deduplicate: only add events we haven't seen before
          const fresh = incoming.filter((e) => {
            const id = (e as Record<string, unknown>).event_id as string | undefined;
            if (!id) return true; // No ID → always show (shouldn't happen)
            if (seenIdsRef.current.has(id)) return false;
            seenIdsRef.current.add(id);
            return true;
          });
          if (fresh.length === 0) return prev;
          const combined = [...fresh, ...prev];
          // Cap seen set to prevent unbounded memory growth
          if (seenIdsRef.current.size > MAX_ROWS * 2) {
            const arr = Array.from(seenIdsRef.current);
            seenIdsRef.current = new Set(arr.slice(arr.length - MAX_ROWS));
          }
          return combined.slice(0, MAX_ROWS);
        });
        const freshCount = incoming.length; // Approximate — actual dedup happens in setState
        setTotalReceived((p) => p + freshCount);
        rateCountRef.current += freshCount;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // silent — network errors are transient
    }
  }, [paused, tableFilter]);

  useEffect(() => {
    // Reset dedup set when table filter changes
    seenIdsRef.current.clear();
    fetchEvents();
    const timer = setInterval(fetchEvents, 1000);
    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [fetchEvents]);

  // Calculate rate
  useEffect(() => {
    const rateTimer = setInterval(() => {
      setRate(rateCountRef.current);
      rateCountRef.current = 0;
    }, 1000);
    return () => clearInterval(rateTimer);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events, autoScroll]);

  const filtered = filter
    ? events.filter(
        (e) =>
          e.raw?.toLowerCase().includes(filter.toLowerCase()) ||
          e.hostname?.toLowerCase().includes(filter.toLowerCase()) ||
          e.log_source?.toLowerCase().includes(filter.toLowerCase())
      )
    : events;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live Feed</h1>
          <p className="text-sm text-muted-foreground">
            Real-time event stream from all sources
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-md border px-3 py-1.5">
            <div className={`h-2 w-2 rounded-full ${paused ? "bg-muted-foreground" : "bg-emerald-500 animate-pulse"}`} />
            <span className="text-xs font-medium tabular-nums">
              {formatNumber(rate)} eps
            </span>
          </div>
          <Badge variant="outline" className="tabular-nums">
            {formatNumber(totalReceived)} received
          </Badge>
        </div>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="flex items-center gap-3 p-3 flex-wrap">
          <Button
            variant={paused ? "default" : "secondary"}
            size="sm"
            onClick={() => setPaused(!paused)}
            className="gap-1.5"
          >
            {paused ? (
              <>
                <Play className="h-3.5 w-3.5" /> Resume
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" /> Pause
              </>
            )}
          </Button>
          <Button
            variant={autoScroll ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
            className="gap-1.5"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Auto-scroll {autoScroll ? "On" : "Off"}
          </Button>
          <div className="flex items-center gap-1 border-l pl-3 ml-1">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            {TABLE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={tableFilter === opt.value ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setTableFilter(opt.value);
                  setEvents([]);
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <div className="relative flex-1 max-w-sm">
            <Filter className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter events…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEvents([]);
              setTotalReceived(0);
            }}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Clear
          </Button>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {formatNumber(filtered.length)} / {formatNumber(events.length)} shown
          </span>
        </CardContent>
      </Card>

      {/* Event Stream Table */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Radio className="h-4 w-4 text-emerald-500" />
            Event Stream
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={containerRef}
            className="max-h-[calc(100vh-320px)] overflow-y-auto"
          >
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-left">
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[160px]">
                    Timestamp
                  </th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[80px]">
                    Table
                  </th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[60px]">
                    Severity
                  </th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[100px]">
                    Source
                  </th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[100px]">
                    Host
                  </th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Raw
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      {events.length === 0 ? (
                        <div className="space-y-2">
                          <Skeleton className="mx-auto h-3 w-48" />
                          <p>Waiting for events…</p>
                        </div>
                      ) : (
                        "No events match the filter"
                      )}
                    </td>
                  </tr>
                ) : (
                  filtered.slice(0, 500).map((event, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-border/30 transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-1.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        {event.timestamp
                          ? new Date(event.timestamp).toLocaleTimeString("en-US", {
                              hour12: false,
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                              fractionalSecondDigits: 3,
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-1.5">
                        <span className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[9px] font-medium ${
                          event._table === "security_events" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                          event._table === "process_events" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                          event._table === "network_events" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                          "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                        }`}>
                          {event._table?.replace("_events", "").replace("_logs", "") ?? "raw"}
                        </span>
                      </td>
                      <td className="px-4 py-1.5">
                        {event.severity !== undefined ? (
                          <span
                            className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${severityBgColor(event.severity)}`}
                          >
                            {severityLabel(event.severity)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-1.5 font-mono text-[11px]">
                        {event.log_source ?? "—"}
                      </td>
                      <td className="px-4 py-1.5 font-mono text-[11px]">
                        {event.hostname ?? "—"}
                      </td>
                      <td className="max-w-0 truncate px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {event.raw ?? JSON.stringify(event).slice(0, 200)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
