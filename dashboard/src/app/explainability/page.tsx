"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import {
  Fingerprint,
  Info,
  RefreshCw,
  Download,
  Layers,
  Eye,
  BarChart3,
  TrendingUp,
  Zap,
  Brain,
  Crosshair,
  Search as SearchIcon,
  ShieldCheck,
  ChevronRight,
  CheckCircle,
  FileSearch,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { usePolling } from "@/hooks/use-polling";
import { cn } from "@/lib/utils";
import type { Investigation } from "@/lib/types";

interface XAIData {
  globalFeatures: Array<{ feature: string; importance: number; direction: string }>;
  decisionBoundary?: Array<{ x: number; y: number; label: number }>;
  featureInteractions?: Array<{ pair: string; interaction: number }>;
  cohortAnalysis?: Array<{
    cohort: string;
    accuracy: number;
    f1: number;
    count: number;
    topFeature: string;
  }>;
  modelCards?: Array<{
    model: string;
    version: string;
    trainDate: string;
    metrics: { f1: number; precision: number; recall: number; auc: number };
    fairness: { equalizedOdds: number; demographicParity: number };
  }>;
}

const MOCK_DATA: XAIData = {
  globalFeatures: [
    { feature: "event_frequency", importance: 0.342, direction: "positive" },
    { feature: "sigma_match_count", importance: 0.287, direction: "positive" },
    { feature: "time_anomaly_score", importance: 0.231, direction: "positive" },
    { feature: "network_bytes_out", importance: 0.198, direction: "positive" },
    { feature: "process_tree_depth", importance: 0.176, direction: "positive" },
    { feature: "user_risk_score", importance: 0.154, direction: "positive" },
    { feature: "geo_anomaly", importance: 0.132, direction: "positive" },
    { feature: "entropy_score", importance: 0.119, direction: "positive" },
    { feature: "login_frequency", importance: -0.098, direction: "negative" },
    { feature: "session_duration", importance: -0.067, direction: "negative" },
  ],
  decisionBoundary: Array.from({ length: 80 }, (_, i) => ({
    x: (Math.random() - 0.5) * 4,
    y: (Math.random() - 0.5) * 4,
    label: Math.random() > 0.4 ? 1 : 0,
  })),
  featureInteractions: [
    { pair: "event_freq × sigma_match", interaction: 0.089 },
    { pair: "time_anomaly × geo_anomaly", interaction: 0.074 },
    { pair: "bytes_out × entropy", interaction: 0.061 },
    { pair: "process_depth × user_risk", interaction: 0.052 },
    { pair: "login_freq × session_dur", interaction: 0.038 },
  ],
  cohortAnalysis: [
    { cohort: "Network Events", accuracy: 0.94, f1: 0.92, count: 12450, topFeature: "network_bytes_out" },
    { cohort: "Auth Events", accuracy: 0.96, f1: 0.95, count: 8320, topFeature: "login_frequency" },
    { cohort: "Process Events", accuracy: 0.91, f1: 0.89, count: 15200, topFeature: "process_tree_depth" },
    { cohort: "File Events", accuracy: 0.88, f1: 0.86, count: 6100, topFeature: "entropy_score" },
  ],
  modelCards: [
    {
      model: "XGBoost Binary Classifier",
      version: "v3.1.0",
      trainDate: "2025-01-15",
      metrics: { f1: 0.942, precision: 0.951, recall: 0.933, auc: 0.978 },
      fairness: { equalizedOdds: 0.96, demographicParity: 0.93 },
    },
  ],
};

export default function ExplainabilityPage() {
  const { data, loading, refresh } = usePolling<XAIData>("/api/ai/xai", 30000);
  const [view, setView] = useState("features");
  const [investigations, setInvestigations] = useState<Investigation[]>([]);

  useEffect(() => {
    fetch("/api/ai/investigations/list")
      .then((r) => r.json())
      .then((d) => setInvestigations(d.investigations || []))
      .catch(() => {});
  }, []);

  const xai = data?.globalFeatures ? data : MOCK_DATA;

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-nexus-cyan" />
            XAI Explainability Center
          </h2>
          <p className="text-sm text-muted-foreground">
            Global model explanations, feature analysis, and fairness monitoring
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="mr-1 h-3 w-3" /> Refresh
        </Button>
      </div>

      {/* AI Pipeline XAI Integration Banner */}
      <Card className="border-nexus-cyan/20 bg-nexus-cyan/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-nexus-cyan/10">
                <Brain className="h-5 w-5 text-nexus-cyan" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Triage Agent — XAI Pipeline</p>
                <p className="text-xs text-muted-foreground">
                  SHAP explanations generated per classification &bull; Feature importance computed by XGBoost ensemble
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-2xs gap-1">
                <Crosshair className="h-2.5 w-2.5 text-amber-400" /> Triage: SHAP values
              </Badge>
              <Badge variant="outline" className="text-2xs gap-1">
                <SearchIcon className="h-2.5 w-2.5 text-nexus-cyan" /> Hunter: Correlation scores
              </Badge>
              <Badge variant="outline" className="text-2xs gap-1">
                <ShieldCheck className="h-2.5 w-2.5 text-emerald-400" /> Verifier: Confidence %
              </Badge>
              <Link href="/ai-agents">
                <Button variant="ghost" size="sm" className="text-xs">Agents <ChevronRight className="ml-1 h-3 w-3" /></Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-Investigation XAI */}
      {investigations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileSearch className="h-4 w-4 text-nexus-purple" />
              Per-Investigation Explanations
            </CardTitle>
            <CardDescription>Click to view SHAP analysis for each classified investigation</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {investigations.slice(0, 6).map((inv) => (
                <Link key={inv.id} href={`/investigations/${inv.id}`}>
                  <div className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-primary/30 hover:bg-muted/10 transition-colors">
                    <Badge
                      variant={inv.severity >= 4 ? "critical" : inv.severity >= 3 ? "high" : "medium"}
                      className="text-2xs shrink-0"
                    >
                      S{inv.severity}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{inv.title}</p>
                      <p className="text-2xs text-muted-foreground">{inv.eventCount} events</p>
                    </div>
                    <Badge variant="ghost" className="text-2xs gap-1 shrink-0">
                      <Fingerprint className="h-2.5 w-2.5" /> XAI
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="features">
            <BarChart3 className="mr-1 h-3 w-3" /> Feature Importance
          </TabsTrigger>
          <TabsTrigger value="interactions">
            <Layers className="mr-1 h-3 w-3" /> Interactions
          </TabsTrigger>
          <TabsTrigger value="cohorts">
            <Eye className="mr-1 h-3 w-3" /> Cohort Analysis
          </TabsTrigger>
          <TabsTrigger value="model-card">
            <Info className="mr-1 h-3 w-3" /> Model Card
          </TabsTrigger>
        </TabsList>

        {/* Global Feature Importance */}
        <TabsContent value="features" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Global SHAP Values</CardTitle>
                <CardDescription>
                  Mean absolute SHAP contribution per feature across all predictions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer>
                    <BarChart
                      data={xai.globalFeatures}
                      layout="vertical"
                      margin={{ left: 100 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="feature"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        width={95}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                        {xai.globalFeatures.map((f, i) => (
                          <Cell
                            key={i}
                            fill={f.importance >= 0 ? "rgba(6,182,212,0.7)" : "rgba(239,68,68,0.7)"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Decision Boundary Visualization</CardTitle>
                <CardDescription>
                  2D projection of top-2 features with classification regions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer>
                    <ScatterChart>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                      />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="Feature 1"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name="Feature 2"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Scatter data={xai.decisionBoundary}>
                        {(xai.decisionBoundary || []).map((p, i) => (
                          <Cell
                            key={i}
                            fill={p.label === 1 ? "rgba(239,68,68,0.6)" : "rgba(6,182,212,0.6)"}
                          />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex gap-4 justify-center text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" /> Attack
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-500/60" /> Benign
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Feature detail list */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Feature Detail</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-48">
                <div className="space-y-2">
                  {xai.globalFeatures.map((f) => {
                    const pct = (Math.abs(f.importance) / 0.4) * 100;
                    return (
                      <div key={f.feature} className="flex items-center gap-3">
                        <span className="w-36 truncate font-mono text-xs text-muted-foreground">
                          {f.feature}
                        </span>
                        <div className="flex-1 h-3 rounded bg-muted/30 overflow-hidden">
                          <div
                            className="h-full rounded transition-all duration-500"
                            style={{
                              width: `${Math.min(pct, 100)}%`,
                              background:
                                f.importance >= 0
                                  ? "rgba(6,182,212,0.5)"
                                  : "rgba(239,68,68,0.5)",
                            }}
                          />
                        </div>
                        <Badge
                          variant={f.importance >= 0 ? "cyan" : "destructive"}
                          className="text-2xs w-14 justify-center"
                        >
                          {f.importance >= 0 ? "+" : ""}
                          {f.importance.toFixed(3)}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Feature Interactions */}
        <TabsContent value="interactions" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="h-4 w-4 text-nexus-purple" />
                Feature Interaction Strengths
              </CardTitle>
              <CardDescription>
                SHAP interaction values showing how feature pairs jointly influence predictions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-48">
                <ResponsiveContainer>
                  <BarChart data={xai.featureInteractions} layout="vertical" margin={{ left: 160 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="pair"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={155}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="interaction" fill="rgba(139,92,246,0.6)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cohort Analysis */}
        <TabsContent value="cohorts" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(xai.cohortAnalysis || []).map((c) => (
              <Card key={c.cohort}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-foreground">{c.cohort}</h4>
                    <Badge variant="ghost" className="text-2xs">
                      {c.count.toLocaleString()} events
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-2xs text-muted-foreground">Accuracy</p>
                      <p className="text-lg font-bold text-foreground">
                        {(c.accuracy * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-2xs text-muted-foreground">F1 Score</p>
                      <p className="text-lg font-bold text-foreground">
                        {c.f1.toFixed(3)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-2xs text-muted-foreground">Top Feature</p>
                    <Badge variant="outline" className="mt-0.5 text-2xs font-mono">
                      {c.topFeature}
                    </Badge>
                  </div>
                  {/* Accuracy bar */}
                  <div className="h-2 rounded bg-muted/30 overflow-hidden">
                    <div
                      className="h-full rounded bg-nexus-cyan/50 transition-all"
                      style={{ width: `${c.accuracy * 100}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Model Card */}
        <TabsContent value="model-card" className="space-y-4 mt-4">
          {(xai.modelCards || MOCK_DATA.modelCards!).map((mc) => (
            <Card key={mc.model}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">{mc.model}</CardTitle>
                    <CardDescription>
                      Version {mc.version} · Trained {mc.trainDate}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm">
                    <Download className="mr-1 h-3 w-3" /> Export Card
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                  {Object.entries(mc.metrics).map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        {k}
                      </p>
                      <p className={cn(
                        "mt-1 text-2xl font-bold",
                        v >= 0.9 ? "text-emerald-400" : v >= 0.7 ? "text-amber-400" : "text-destructive"
                      )}>
                        {v.toFixed(3)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-6">
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                    Fairness Metrics
                  </h4>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {Object.entries(mc.fairness).map(([k, v]) => (
                      <div key={k}>
                        <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").trim()}</p>
                        <p className="mt-1 text-lg font-semibold text-foreground">
                          {v.toFixed(3)}
                        </p>
                        <Badge
                          variant={v >= 0.9 ? "success" : v >= 0.8 ? "warning" : "destructive"}
                          className="mt-0.5 text-2xs"
                        >
                          {v >= 0.9 ? "Fair" : v >= 0.8 ? "Review" : "Bias Risk"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
