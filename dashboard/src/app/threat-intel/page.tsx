"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { severityLabel, formatNumber, timeAgo } from "@/lib/utils";
import {
  Radar,
  Search,
  Globe,
  Hash,
  Link2,
  Server,
  Shield,
  AlertTriangle,
  ExternalLink,
  Tag,
  Activity,
} from "lucide-react";
import threatIntelData from "@/lib/mock/threat-intel.json";
import type { IOC, ThreatPattern } from "@/lib/types";
import { toast } from "sonner";

const iocs = threatIntelData.iocs as IOC[];
const threatPatterns = threatIntelData.threatPatterns as ThreatPattern[];

const IOC_TYPE_ICONS: Record<string, React.ElementType> = {
  IPv4: Server,
  Domain: Globe,
  SHA256: Hash,
  URL: Link2,
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "text-emerald-400",
  medium: "text-amber-400",
  low: "text-red-400",
};

function getConfidenceLevel(score: number): string {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

const SEVERITY_VARIANT: Record<number, "critical" | "high" | "medium" | "low" | "info"> = {
  4: "critical",
  3: "high",
  2: "medium",
  1: "low",
  0: "info",
};

export default function ThreatIntelPage() {
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [liveMitre, setLiveMitre] = useState<Array<{ technique: string; tactic: string; count: number; maxSeverity: number }>>([]);
  const [liveIOCs, setLiveIOCs] = useState<Array<{ value: string; type: string; hits: number; maxSeverity: number }>>([]);

  useEffect(() => {
    async function fetchLive() {
      try {
        const res = await fetch("/api/threat-intel", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        setLiveMitre(json.mitreStats ?? []);
        setLiveIOCs(json.topIOCs ?? []);
      } catch { /* silent */ }
    }
    fetchLive();
    const t = setInterval(fetchLive, 30_000);
    return () => clearInterval(t);
  }, []);

  const filteredIocs = iocs.filter((ioc) => {
    const matchesText =
      !filter ||
      ioc.value.toLowerCase().includes(filter.toLowerCase()) ||
      ioc.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase()));
    const matchesType = typeFilter === "All" || ioc.type === typeFilter;
    return matchesText && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Threat Intelligence</h1>
          <p className="text-sm text-muted-foreground">
            IOC feeds, threat patterns, and MITRE ATT&CK mapping
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => toast.info("IOC feed configuration", { description: "Connect MISP / AlienVault OTX feed — requires threat intel service (Week 7)" })}>
          <Radar className="h-4 w-4" /> Add IOC Feed
        </Button>
      </div>

      {/* Live MITRE ATT&CK from ClickHouse */}
      {liveMitre.length > 0 && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Activity className="h-4 w-4 text-primary" />
              Live MITRE ATT&CK Detections (24h)
              <Badge variant="outline" className="ml-1 tabular-nums text-[10px]">
                {liveMitre.reduce((s, m) => s + m.count, 0)} total
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              {liveMitre.slice(0, 8).map((m) => (
                <div key={m.technique} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <Badge variant={m.maxSeverity >= 3 ? "critical" : m.maxSeverity >= 2 ? "high" : "medium"} className="text-[9px] font-mono">
                      {m.technique}
                    </Badge>
                    <p className="mt-1 text-[10px] text-muted-foreground">{m.tactic}</p>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{m.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live IOC Matches */}
      {liveIOCs.length > 0 && (
        <Card className="border-amber-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Active Threat Indicators (Last 24h)
              <Badge variant="high" className="ml-1 tabular-nums text-[10px]">
                {liveIOCs.length} hosts
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-3">
              {liveIOCs.slice(0, 6).map((ioc) => (
                <div key={ioc.value} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Server className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-mono text-xs">{ioc.value}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium tabular-nums ${ioc.maxSeverity >= 3 ? "text-red-400" : "text-amber-400"}`}>
                      {ioc.hits} hits
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Threat Patterns */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        {threatPatterns.map((pattern) => (
          <Card key={pattern.name}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <Badge variant={SEVERITY_VARIANT[pattern.severity] ?? "info"} className="text-[10px]">
                  {pattern.mitre}
                </Badge>
                {pattern.matchedEvents > 0 && (
                  <span className="text-[10px] font-medium text-amber-400">
                    {pattern.matchedEvents} hits
                  </span>
                )}
              </div>
              <h3 className="mt-2 text-sm font-medium">{pattern.name}</h3>
              <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                {pattern.description}
              </p>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                <Shield className="h-3 w-3" />
                {pattern.iocCount} IOCs
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* IOC Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm font-medium">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Indicators of Compromise
              <Badge variant="outline" className="ml-1 tabular-nums">
                {filteredIocs.length}
              </Badge>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search IOCs…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <div className="flex gap-1">
              {["All", "IPv4", "Domain", "SHA256", "URL"].map((t) => (
                <Button
                  key={t}
                  variant={typeFilter === t ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setTypeFilter(t)}
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>

          {/* IOC List */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[70px]">
                    Type
                  </th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Value
                  </th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[80px]">
                    Source
                  </th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[80px]">
                    Confidence
                  </th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[60px]">
                    MITRE
                  </th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[60px]">
                    Hits
                  </th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[130px]">
                    Tags
                  </th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[80px]">
                    Last Seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredIocs.map((ioc, idx) => {
                  const TypeIcon = IOC_TYPE_ICONS[ioc.type] ?? Globe;
                  const confLevel = getConfidenceLevel(ioc.confidence);
                  return (
                    <tr
                      key={idx}
                      className="border-b border-border/30 transition-colors hover:bg-muted/20"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-[11px]">{ioc.type}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-foreground">
                        {ioc.value.length > 50
                          ? `${ioc.value.slice(0, 50)}…`
                          : ioc.value}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground">
                        {ioc.source}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`text-[11px] font-medium tabular-nums ${CONFIDENCE_COLORS[confLevel]}`}
                        >
                          {ioc.confidence}%
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[9px] font-mono">
                          {ioc.mitre}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`text-[11px] tabular-nums ${
                            ioc.matchedEvents > 0
                              ? "font-medium text-amber-400"
                              : "text-muted-foreground"
                          }`}
                        >
                          {formatNumber(ioc.matchedEvents)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {ioc.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-sm bg-muted px-1 py-0.5 text-[9px] text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                        {timeAgo(ioc.lastSeen)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
