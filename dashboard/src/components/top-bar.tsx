"use client";

import { Search, Bell, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function TopBar() {
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    async function fetchCount() {
      try {
        const res = await fetch("/api/metrics", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        setAlertCount(json.criticalAlertCount ?? 0);
      } catch { /* silent */ }
    }
    fetchCount();
    const t = setInterval(fetchCount, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/80 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search events, hosts, users…"
            className="pl-9 bg-background/50 border-border/50 h-8 text-sm"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          onClick={() =>
            toast.info("Notifications", {
              description: alertCount > 0
                ? `${alertCount} critical alerts in the last hour — click Alerts page for details`
                : "No critical alerts — all clear",
            })
          }
        >
          <Bell className="h-4 w-4" />
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
              {alertCount > 99 ? "99+" : alertCount}
            </span>
          )}
        </Button>
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
