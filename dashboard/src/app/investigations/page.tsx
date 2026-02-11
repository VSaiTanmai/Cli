"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { severityLabel, timeAgo, formatNumber } from "@/lib/utils";
import {
  FolderSearch,
  Plus,
  Search,
  Clock,
  User,
  Tag,
  ChevronRight,
} from "lucide-react";
import investigationsData from "@/lib/mock/investigations.json";
import type { Investigation } from "@/lib/types";
import { useState } from "react";

const cases = investigationsData.cases as Investigation[];

const STATUS_COLORS: Record<string, string> = {
  "Open": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "In Progress": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Closed": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

const SEVERITY_VARIANT: Record<number, "critical" | "high" | "medium" | "low" | "info"> = {
  4: "critical",
  3: "high",
  2: "medium",
  1: "low",
  0: "info",
};

export default function InvestigationsPage() {
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");

  const filtered = cases.filter((c) => {
    const matchesText =
      !filter ||
      c.title.toLowerCase().includes(filter.toLowerCase()) ||
      c.id.toLowerCase().includes(filter.toLowerCase()) ||
      c.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase()));
    const matchesStatus =
      statusFilter === "All" || c.status === statusFilter;
    return matchesText && matchesStatus;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Investigations</h1>
          <p className="text-sm text-muted-foreground">
            Active and historical case files
          </p>
        </div>
        <Button className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Investigation
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex items-center gap-3 p-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search cases…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <div className="flex gap-1">
            {["All", "Open", "In Progress", "Closed"].map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </Button>
            ))}
          </div>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {filtered.length} cases
          </span>
        </CardContent>
      </Card>

      {/* Case List */}
      <div className="space-y-2">
        {filtered.map((inv) => (
          <Link key={inv.id} href={`/investigations/${inv.id}`}>
            <Card className="transition-colors hover:bg-muted/20 cursor-pointer">
              <CardContent className="flex items-start gap-4 p-4">
                {/* Left: Severity */}
                <div className="mt-0.5">
                  <Badge variant={SEVERITY_VARIANT[inv.severity] ?? "info"}>
                    {severityLabel(inv.severity)}
                  </Badge>
                </div>

                {/* Center: Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {inv.id}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${
                        STATUS_COLORS[inv.status] ?? ""
                      }`}
                    >
                      {inv.status}
                    </span>
                  </div>
                  <h3 className="mt-1 text-sm font-medium">{inv.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {inv.description}
                  </p>

                  {/* Tags */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {inv.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        <Tag className="h-2.5 w-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Right: Meta */}
                <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <User className="h-3 w-3" />
                    {inv.assignee}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {timeAgo(inv.updated)}
                  </div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {formatNumber(inv.eventCount)} events
                  </div>
                  <ChevronRight className="mt-2 h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
