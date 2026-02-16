"use client";

import { Search, Bell, ShieldAlert, X, Filter, CheckCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

interface RecentAlert {
  event_id: string;
  timestamp: string;
  severity: number;
  category: string;
  description: string;
  hostname: string;
}

const SEV_LABEL: Record<number, string> = { 4: "Critical", 3: "High", 2: "Medium", 1: "Low", 0: "Info" };
const SEV_VARIANT: Record<number, "critical" | "high" | "medium" | "low" | "info"> = { 4: "critical", 3: "high", 2: "medium", 1: "low", 0: "info" };

/** Per-request timeout for TopBar fetches */
const FETCH_TIMEOUT_MS = 15_000;

export function TopBar() {
  const [alertCount, setAlertCount] = useState(0);
  const [alerts, setAlerts] = useState<RecentAlert[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [panelSevFilter, setPanelSevFilter] = useState<number | null>(null);
  const [panelLimit, setPanelLimit] = useState(10);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const [metricsRes, alertsRes] = await Promise.allSettled([
        fetch("/api/metrics", { cache: "no-store", signal: controller.signal }),
        fetch("/api/alerts", { cache: "no-store", signal: controller.signal }),
      ]);
      if (metricsRes.status === "fulfilled" && metricsRes.value.ok) {
        const json = await metricsRes.value.json();
        setAlertCount(json.criticalAlertCount ?? 0);
      }
      if (alertsRes.status === "fulfilled" && alertsRes.value.ok) {
        const json = await alertsRes.value.json();
        const recent = (json.alerts ?? [])
          .filter((a: RecentAlert) => a.severity >= 3);
        setAlerts(recent);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    return () => { clearInterval(t); abortRef.current?.abort(); };
  }, [fetchData]);

  const filteredAlerts = useMemo(() => {
    let list = alerts;
    if (panelSevFilter !== null) list = list.filter((a) => a.severity === panelSevFilter);
    return list;
  }, [alerts, panelSevFilter]);

  const unreadCount = useMemo(
    () => alerts.filter((a) => !readIds.has(a.event_id)).length,
    [alerts, readIds],
  );

  const markAllRead = useCallback(() => {
    setReadIds(new Set(alerts.map((a) => a.event_id)));
  }, [alerts]);

  // Close panel on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false);
      }
    }
    if (showPanel) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPanel]);

  // Keyboard handlers: Escape to close panel, Cmd+K for search focus
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && showPanel) {
        setShowPanel(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showPanel]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q) {
      router.push(`/search?q=${encodeURIComponent(q)}`);
      setSearchQuery("");
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/80 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <form onSubmit={handleSearch} className="relative w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Search events, hosts, users…"
            className="pl-9 bg-background/50 border-border/50 h-8 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search events"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </form>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative" ref={panelRef}>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-8 w-8"
            onClick={() => { setShowPanel((p) => !p); setPanelLimit(10); }}
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
            aria-expanded={showPanel}
            aria-haspopup="dialog"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>

          {/* Notification dropdown panel */}
          {showPanel && (
            <div
              className="absolute right-0 top-10 z-50 w-[420px] rounded-lg border bg-card shadow-xl"
              role="dialog"
              aria-label="Recent notifications"
            >
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-semibold">Alerts</span>
                  <Badge variant="outline" className="tabular-nums text-[10px]">{alerts.length}</Badge>
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 gap-1 text-[10px] px-2" onClick={markAllRead}>
                      <CheckCheck className="h-3 w-3" /> Mark all read
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowPanel(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {/* Severity filter tabs */}
              <div className="flex items-center gap-1 border-b px-4 py-1.5">
                <Filter className="h-3 w-3 text-muted-foreground" />
                {[
                  { label: "All", value: null },
                  { label: "Critical", value: 4 },
                  { label: "High", value: 3 },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    className={`rounded-sm px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      panelSevFilter === opt.value
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => { setPanelSevFilter(opt.value); setPanelLimit(10); }}
                  >
                    {opt.label}
                  </button>
                ))}
                <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                  {filteredAlerts.length} alerts
                </span>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-border/30">
                {filteredAlerts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No {panelSevFilter === 4 ? "critical" : panelSevFilter === 3 ? "high-severity" : "high-severity"} alerts in the last 24 hours
                  </div>
                ) : (
                  filteredAlerts.slice(0, panelLimit).map((a, i) => {
                    const isRead = readIds.has(a.event_id);
                    return (
                      <div
                        key={a.event_id || i}
                        className={`px-4 py-3 hover:bg-muted/20 transition-colors ${!isRead ? "border-l-2 border-l-primary" : ""}`}
                        onClick={() => setReadIds((prev) => { const s = new Set(Array.from(prev)); s.add(a.event_id); return s; })}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant={SEV_VARIANT[a.severity] ?? "info"} className="text-[9px] shrink-0">
                            {SEV_LABEL[a.severity] ?? "Info"}
                          </Badge>
                          <span className={`text-xs truncate ${!isRead ? "font-semibold" : "font-medium text-muted-foreground"}`}>
                            {a.category || "Alert"}
                          </span>
                          <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
                            {new Date(a.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {a.description || "Security event detected"}
                        </p>
                        {a.hostname && (
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{a.hostname}</p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="flex items-center justify-between border-t px-4 py-2">
                <a href="/alerts" className="text-xs text-primary hover:underline">
                  View all alerts →
                </a>
                {filteredAlerts.length > panelLimit && (
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => setPanelLimit((p) => p + 20)}
                  >
                    Show more ({filteredAlerts.length - panelLimit} remaining)
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-md px-2 py-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-medium text-primary">
            SC
          </div>
          <div className="hidden sm:block">
            <div className="text-xs font-medium">Sarah Chen</div>
            <div className="text-[10px] text-muted-foreground">SOC Lead</div>
          </div>
        </div>
      </div>
    </header>
  );
}
