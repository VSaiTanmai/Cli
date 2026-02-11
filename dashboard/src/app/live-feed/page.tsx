"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { severityLabel, severityBgColor, timeAgo, formatNumber } from "@/lib/utils";
import { Radio, Pause, Play, ArrowDown, Filter, RotateCcw } from "lucide-react";
import type { EventRow } from "@/lib/types";

const MAX_ROWS = 2000;

export default function LiveFeedPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [totalReceived, setTotalReceived] = useState(0);
  const [rate, setRate] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const rateCountRef = useRef(0);

  // Poll for new events
  const fetchEvents = useCallback(async () => {
    if (paused) return;
    try {
      const res = await fetch("/api/events/stream", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const newEvents = (json.data ?? []) as EventRow[];
      if (newEvents.length > 0) {
        setEvents((prev) => {
          const combined = [...newEvents, ...prev];
          return combined.slice(0, MAX_ROWS);
        });
        setTotalReceived((p) => p + newEvents.length);
        rateCountRef.current += newEvents.length;
      }
    } catch {
      // silent
    }
  }, [paused]);

  useEffect(() => {
    fetchEvents();
    const timer = setInterval(fetchEvents, 2000);
    return () => clearInterval(timer);
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
        <CardContent className="flex items-center gap-3 p-3">
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
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
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
