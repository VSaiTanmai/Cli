"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Globe,
  Shield,
  AlertTriangle,
  Search,
  RefreshCw,
  ExternalLink,
  Hash,
  Server,
  Mail,
  FileText,
  Target,
  Clock,
  Filter,
  ChevronDown,
  ChevronRight,
  Brain,
  Crosshair,
  Search as SearchIcon,
  ShieldCheck,
  Zap,
  CheckCircle,
  Link2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { usePolling } from "@/hooks/use-polling";
import { formatNumber, timeAgo, cn } from "@/lib/utils";
import type { IOC, ThreatPattern } from "@/lib/types";
import type { Investigation } from "@/lib/types";

interface ThreatIntelResponse {
  iocs: IOC[];
  patterns: ThreatPattern[];
  stats?: {
    totalIOCs: number;
    activeThreats: number;
    mitreTechniques: number;
    lastUpdated: string;
  };
}

const IOC_ICONS: Record<string, typeof Globe> = {
  ip: Server,
  domain: Globe,
  url: ExternalLink,
  hash: Hash,
  email: Mail,
  file: FileText,
};

export default function ThreatIntelPage() {
  const { data, loading, refresh } = usePolling<ThreatIntelResponse>(
    "/api/threat-intel",
    30000
  );
  const [tab, setTab] = useState("iocs");
  const [filter, setFilter] = useState("");
  const [expandedPattern, setExpandedPattern] = useState<string | null>(null);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);

  useEffect(() => {
    fetch("/api/ai/investigations/list")
      .then((r) => r.json())
      .then((d) => setInvestigations(d.investigations || []))
      .catch(() => {});
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }

  const iocs = data?.iocs || [];
  const patterns = data?.patterns || [];
  const stats = data?.stats;

  const filteredIOCs = iocs.filter(
    (ioc) =>
      ioc.value.toLowerCase().includes(filter.toLowerCase()) ||
      ioc.type.toLowerCase().includes(filter.toLowerCase()) ||
      ioc.source?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Globe className="h-5 w-5 text-nexus-purple" />
            Threat Intelligence
          </h2>
          <p className="text-sm text-muted-foreground">
            IOC management, threat patterns, and MITRE ATT&CK mapping
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="mr-1 h-3 w-3" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="stat-card">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total IOCs</p>
              <p className="text-xl font-bold text-foreground">
                {formatNumber(stats.totalIOCs)}
              </p>
            </CardContent>
          </Card>
          <Card className="stat-card">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Active Threats</p>
              <p className="text-xl font-bold text-destructive">
                {formatNumber(stats.activeThreats)}
              </p>
            </CardContent>
          </Card>
          <Card className="stat-card">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">MITRE Techniques</p>
              <p className="text-xl font-bold text-foreground">
                {formatNumber(stats.mitreTechniques)}
              </p>
            </CardContent>
          </Card>
          <Card className="stat-card">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Last Updated</p>
              <p className="text-sm font-medium text-foreground">
                {timeAgo(stats.lastUpdated)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* AI Enrichment Banner */}
      <Card className="border-nexus-cyan/20 bg-nexus-cyan/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-nexus-cyan/10">
                <Brain className="h-5 w-5 text-nexus-cyan" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">AI-Driven IOC Enrichment</p>
                <p className="text-xs text-muted-foreground">
                  Triage Agent checks IOCs against threat feeds &bull; Hunter Agent correlates IOCs across investigations
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Crosshair className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs text-muted-foreground">Triage</span>
                <CheckCircle className="h-3 w-3 text-emerald-400" />
              </div>
              <div className="flex items-center gap-1.5">
                <SearchIcon className="h-3.5 w-3.5 text-nexus-cyan" />
                <span className="text-xs text-muted-foreground">Hunter</span>
                <CheckCircle className="h-3 w-3 text-emerald-400" />
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-xs text-muted-foreground">Verifier</span>
                <CheckCircle className="h-3 w-3 text-emerald-400" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Threat Feed Status */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { name: "MITRE ATT&CK", status: "active" as const, lastSync: "2m ago", iocs: 156, color: "text-nexus-purple" },
          { name: "Sigma Rules", status: "active" as const, lastSync: "5m ago", iocs: 89, color: "text-nexus-cyan" },
          { name: "Custom Threat Feed", status: "active" as const, lastSync: "1m ago", iocs: 42, color: "text-amber-400" },
        ].map((feed) => (
          <Card key={feed.name} className="hover:border-primary/20 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className={cn("h-3.5 w-3.5", feed.color)} />
                  <span className="text-sm font-medium text-foreground">{feed.name}</span>
                </div>
                <Badge variant="success" className="text-2xs">{feed.status}</Badge>
              </div>
              <div className="mt-2 flex items-center gap-3 text-2xs text-muted-foreground">
                <span>Synced {feed.lastSync}</span>
                <span>&bull;</span>
                <span>{feed.iocs} IOCs</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* IOC-Investigation Correlation */}
      {investigations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Link2 className="h-4 w-4 text-nexus-purple" />
              IOC ↔ Investigation Matches
            </CardTitle>
            <CardDescription>IOCs that matched across active investigations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {investigations.slice(0, 5).map((inv) => (
                <Link key={inv.id} href={`/investigations/${inv.id}`}>
                  <div className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={inv.severity >= 4 ? "critical" : inv.severity >= 3 ? "high" : "medium"}
                        className="text-2xs"
                      >
                        S{inv.severity}
                      </Badge>
                      <span className="text-xs font-medium text-foreground">{inv.title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-2xs">{inv.eventCount} events</Badge>
                      {inv.tags?.slice(0, 2).map((t) => (
                        <Badge key={t} variant="purple" className="text-2xs">{t}</Badge>
                      ))}
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="iocs">
            <Shield className="mr-1 h-3 w-3" /> IOCs ({iocs.length})
          </TabsTrigger>
          <TabsTrigger value="patterns">
            <Target className="mr-1 h-3 w-3" /> Threat Patterns ({patterns.length})
          </TabsTrigger>
        </TabsList>

        {/* IOCs Tab */}
        <TabsContent value="iocs" className="mt-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Filter className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search IOCs by value, type, or source..."
                className="pl-8 h-9 text-sm"
              />
            </div>
            <Badge variant="outline" className="text-xs">
              {filteredIOCs.length} results
            </Badge>
          </div>

          <ScrollArea className="h-[500px]">
            <div className="clif-table">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium">Value</th>
                    <th className="pb-2 font-medium">Confidence</th>
                    <th className="pb-2 font-medium">Source</th>
                    <th className="pb-2 font-medium">MITRE</th>
                    <th className="pb-2 font-medium">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIOCs.map((ioc, i) => {
                    const IconComp = IOC_ICONS[ioc.type] || Shield;
                    return (
                      <tr key={i} className="clif-table-row">
                        <td className="py-2">
                          <Badge variant="outline" className="text-2xs gap-1">
                            <IconComp className="h-2.5 w-2.5" />
                            {ioc.type}
                          </Badge>
                        </td>
                        <td className="py-2 font-mono text-foreground">{ioc.value}</td>
                        <td className="py-2">
                          <Badge
                            variant={
                              ioc.confidence >= 90
                                ? "critical"
                                : ioc.confidence >= 70
                                  ? "high"
                                  : ioc.confidence >= 50
                                    ? "medium"
                                    : "low"
                            }
                            className="text-2xs"
                          >
                            {ioc.confidence}%
                          </Badge>
                        </td>
                        <td className="py-2 text-muted-foreground">{ioc.source || "—"}</td>
                        <td className="py-2">
                          {ioc.mitre ? (
                            <Badge variant="purple" className="text-2xs">
                              {ioc.mitre}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {ioc.lastSeen ? timeAgo(ioc.lastSeen) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredIOCs.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {filter ? "No IOCs match your filter" : "No IOCs available"}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Threat Patterns Tab */}
        <TabsContent value="patterns" className="mt-4 space-y-4">
          <ScrollArea className="h-[500px]">
            <div className="space-y-2">
              {patterns.map((pattern, idx) => {
                const isExpanded = expandedPattern === pattern.name;
                return (
                  <Card
                    key={idx}
                    className="hover:border-primary/30 transition-colors"
                  >
                    <CardContent className="p-0">
                      <button
                        onClick={() =>
                          setExpandedPattern(isExpanded ? null : pattern.name)
                        }
                        className="flex w-full items-start gap-3 p-4 text-left"
                      >
                        {isExpanded ? (
                          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-foreground">
                              {pattern.name}
                            </h3>
                            <Badge
                              variant={
                                pattern.severity >= 8
                                  ? "critical"
                                  : pattern.severity >= 6
                                    ? "high"
                                    : "medium"
                              }
                              className="text-2xs"
                            >
                              Risk: {pattern.severity}/10
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                            {pattern.description}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {pattern.mitre && (
                              <Badge variant="purple" className="text-2xs">
                                {pattern.mitre}
                              </Badge>
                            )}
                            <Badge variant="ghost" className="text-2xs">
                              {pattern.iocCount} IOCs
                            </Badge>
                            <Badge variant="ghost" className="text-2xs">
                              {pattern.matchedEvents} events
                            </Badge>
                          </div>
                        </div>
                      </button>
                    </CardContent>
                  </Card>
                );
              })}

              {patterns.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No threat patterns available
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
