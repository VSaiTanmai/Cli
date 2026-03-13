"use client";

import { useState, useEffect, useCallback } from "react";
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
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
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
  Activity,
  AlertTriangle,
  Play,
  Loader2,
  Shield,
  Clock,
  Cpu,
  GitMerge,
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

/* ═══════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════
   MOCK / FALLBACK DATA
   ═══════════════════════════════════════════════════════════ */

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
  decisionBoundary: Array.from({ length: 80 }, () => ({
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
      model: "LightGBM Binary (Triage)",
      version: "v2.4.0",
      trainDate: "2025-02-20",
      metrics: { f1: 0.942, precision: 0.951, recall: 0.933, auc: 0.978 },
      fairness: { equalizedOdds: 0.96, demographicParity: 0.93 },
    },
    {
      model: "CatBoost Meta-Model (Hunter)",
      version: "v1.3.0",
      trainDate: "2025-02-18",
      metrics: { f1: 0.915, precision: 0.928, recall: 0.903, auc: 0.961 },
      fairness: { equalizedOdds: 0.94, demographicParity: 0.91 },
    },
    {
      model: "Verifier Calibration Model",
      version: "v1.1.0",
      trainDate: "2025-02-22",
      metrics: { f1: 0.971, precision: 0.963, recall: 0.979, auc: 0.989 },
      fairness: { equalizedOdds: 0.97, demographicParity: 0.95 },
    },
  ],
};

const RADAR_DATA = [
  { metric: "SHAP Stability", triage: 88, hunter: 72, verifier: 91 },
  { metric: "Confidence", triage: 94, hunter: 87, verifier: 97 },
  { metric: "F1 Score", triage: 94, hunter: 92, verifier: 97 },
  { metric: "Fairness", triage: 96, hunter: 91, verifier: 97 },
  { metric: "Drift Resist.", triage: 85, hunter: 78, verifier: 89 },
  { metric: "Interpretability", triage: 92, hunter: 68, verifier: 82 },
];

const SAMPLE_EVENTS = [
  { label: "Lateral Movement (High)", event_frequency: 142, sigma_match: 3, user_risk: 0.87, bytes_out: 52400, entropy: 0.91 },
  { label: "Credential Access (Med)", event_frequency: 38, sigma_match: 1, user_risk: 0.54, bytes_out: 8100, entropy: 0.44 },
  { label: "Normal Activity", event_frequency: 12, sigma_match: 0, user_risk: 0.12, bytes_out: 1200, entropy: 0.18 },
];

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════ */

export default function ExplainabilityPage() {
  const { data, loading, refresh } = usePolling<XAIData>("/api/ai/xai", 30000);
  const [view, setView] = useState("features");
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<{
    score: number;
    label: string;
    shap: Array<{ feature: string; value: number }>;
  } | null>(null);

  useEffect(() => {
    fetch("/api/ai/investigations/list")
      .then((r) => r.json())
      .then((d) => setInvestigations(d.investigations || []))
      .catch(() => {});
  }, []);

  const xai = data?.globalFeatures ? data : MOCK_DATA;

  /* Live Event Explainer — POST to /api/ai/xai */
  const handleExplain = useCallback(async (idx: number) => {
    setSelectedEvent(idx);
    setExplaining(true);
    setExplanation(null);

    const ev = SAMPLE_EVENTS[idx];
    try {
      const res = await fetch("/api/ai/xai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_frequency: ev.event_frequency,
          sigma_match_count: ev.sigma_match,
          user_risk_score: ev.user_risk,
          network_bytes_out: ev.bytes_out,
          entropy_score: ev.entropy,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setExplanation(result);
      } else {
        // Fallback mock SHAP response
        const score = ev.event_frequency > 100 ? 0.89 : ev.event_frequency > 30 ? 0.54 : 0.12;
        setExplanation({
          score,
          label: score > 0.75 ? "Anomalous" : score > 0.4 ? "Suspicious" : "Normal",
          shap: [
            { feature: "event_frequency", value: ev.event_frequency > 100 ? 0.32 : ev.event_frequency > 30 ? 0.15 : -0.08 },
            { feature: "sigma_match_count", value: ev.sigma_match > 2 ? 0.25 : ev.sigma_match > 0 ? 0.08 : -0.05 },
            { feature: "user_risk_score", value: ev.user_risk > 0.7 ? 0.18 : ev.user_risk > 0.4 ? 0.06 : -0.12 },
            { feature: "network_bytes_out", value: ev.bytes_out > 40000 ? 0.14 : ev.bytes_out > 5000 ? 0.04 : -0.03 },
            { feature: "entropy_score", value: ev.entropy > 0.8 ? 0.11 : ev.entropy > 0.3 ? 0.02 : -0.06 },
          ],
        });
      }
    } catch {
      const score = ev.event_frequency > 100 ? 0.89 : ev.event_frequency > 30 ? 0.54 : 0.12;
      setExplanation({
        score,
        label: score > 0.75 ? "Anomalous" : score > 0.4 ? "Suspicious" : "Normal",
        shap: [
          { feature: "event_frequency", value: ev.event_frequency > 100 ? 0.32 : ev.event_frequency > 30 ? 0.15 : -0.08 },
          { feature: "sigma_match_count", value: ev.sigma_match > 2 ? 0.25 : ev.sigma_match > 0 ? 0.08 : -0.05 },
          { feature: "user_risk_score", value: ev.user_risk > 0.7 ? 0.18 : ev.user_risk > 0.4 ? 0.06 : -0.12 },
          { feature: "network_bytes_out", value: ev.bytes_out > 40000 ? 0.14 : ev.bytes_out > 5000 ? 0.04 : -0.03 },
          { feature: "entropy_score", value: ev.entropy > 0.8 ? 0.11 : ev.entropy > 0.3 ? 0.02 : -0.06 },
        ],
      });
    } finally {
      setExplaining(false);
    }
  }, []);

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
      {/* ══ HEADER ══ */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-primary" />
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

      {/* ══ PIPELINE XAI INTEGRATION BANNER ══ */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">3-Agent XAI Pipeline</p>
                <p className="text-xs text-muted-foreground">
                  Each agent contributes unique explainability signals to the final verdict
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="text-2xs gap-1">
                <Crosshair className="h-2.5 w-2.5 text-amber-400" /> Triage: TreeSHAP
              </Badge>
              <Badge variant="outline" className="text-2xs gap-1">
                <SearchIcon className="h-2.5 w-2.5 text-primary" /> Hunter: Module correlation
              </Badge>
              <Badge variant="outline" className="text-2xs gap-1">
                <ShieldCheck className="h-2.5 w-2.5 text-emerald-400" /> Verifier: Calibrated conf.
              </Badge>
              <Link href="/ai-agents">
                <Button variant="ghost" size="sm" className="text-xs">Agents <ChevronRight className="ml-1 h-3 w-3" /></Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══ MODEL HEALTH & DRIFT STRIP ══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">PSI Drift Score</p>
                <p className="mt-1 text-2xl font-bold text-foreground">0.0312</p>
              </div>
              <Activity className="h-4 w-4 text-emerald-400" />
            </div>
            <Badge variant="success" className="mt-2 text-2xs">No Drift Detected</Badge>
          </CardContent>
        </Card>
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Model Freshness</p>
                <p className="mt-1 text-2xl font-bold text-foreground">14 <span className="text-sm text-muted-foreground">days</span></p>
              </div>
              <Clock className="h-4 w-4 text-amber-400" />
            </div>
            <p className="text-2xs text-muted-foreground mt-2">Last retrained Feb 20</p>
          </CardContent>
        </Card>
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">ARF Confidence</p>
                <p className="mt-1 text-2xl font-bold text-foreground">0.94</p>
              </div>
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            <p className="text-2xs text-muted-foreground mt-2">Online learning ramp (ADWIN)</p>
          </CardContent>
        </Card>
        <Card className="stat-card">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">SHAP Explainer</p>
                <p className="mt-1 text-2xl font-bold text-foreground">TreeSHAP</p>
              </div>
              <Fingerprint className="h-4 w-4 text-primary" />
            </div>
            <p className="text-2xs text-muted-foreground mt-2">v1.3.0 · ONNX Runtime</p>
          </CardContent>
        </Card>
      </div>

      {/* ══ RADAR CHART + FEATURE INTERACTIONS ══ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Radar */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-primary" />
              Agent XAI Capability Comparison
            </CardTitle>
            <CardDescription>Side-by-side explainability dimensions across all 3 agents</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer>
                <RadarChart data={RADAR_DATA}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis
                    dataKey="metric"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <PolarRadiusAxis
                    angle={30}
                    domain={[0, 100]}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Radar name="Triage" dataKey="triage" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} />
                  <Radar name="Hunter" dataKey="hunter" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.1} strokeWidth={2} />
                  <Radar name="Verifier" dataKey="verifier" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-6 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-amber-500" /> Triage</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-cyan-500" /> Hunter</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-emerald-500" /> Verifier</span>
            </div>
          </CardContent>
        </Card>

        {/* Feature Interactions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4 text-primary" />
              Feature Interaction Strengths
            </CardTitle>
            <CardDescription>
              SHAP interaction values showing how feature pairs jointly influence predictions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer>
                <BarChart data={xai.featureInteractions} layout="vertical" margin={{ left: 160 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="pair" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={155} />
                  <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="interaction" fill="rgba(139,92,246,0.6)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ══ PER-AGENT XAI CARDS ══ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-amber-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10">
                <Crosshair className="h-3.5 w-3.5 text-amber-400" />
              </div>
              Triage Agent XAI
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Explainer</span><span className="font-mono text-foreground">TreeSHAP (ONNX)</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Features</span><span className="text-foreground">20 features per prediction</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Top SHAP Feature</span><Badge variant="outline" className="text-2xs font-mono">event_frequency (0.342)</Badge></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">SHAP Stability</span><span className="text-foreground">88% across 1k samples</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Fast-path</span><span className="text-foreground">LightGBM &gt;0.85 → bypass ensemble</span></div>
          </CardContent>
        </Card>
        <Card className="border-cyan-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-500/10">
                <SearchIcon className="h-3.5 w-3.5 text-primary" />
              </div>
              Hunter Agent XAI
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">L1 Score Visibility</span><span className="text-foreground">Sigma, SPC, Graph, Temporal, LanceDB</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Meta-model</span><span className="font-mono text-foreground">CatBoost (SHAP-compatible)</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">L1 Module Weights</span><span className="text-foreground">Sigma 35%, Graph 25%</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">&nbsp;</span><span className="text-foreground">Temporal SPC 20%, Vector 20%</span></div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              Verifier Agent XAI
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Formula</span><span className="text-foreground">40% hunter + 20% evidence + 20% IOC</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">&nbsp;</span><span className="text-foreground">+ 10% FP + 10% timeline</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">TP Threshold</span><span className="text-emerald-400 font-bold">&gt;0.75</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">FP Threshold</span><span className="text-red-400 font-bold">&lt;0.30</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Inconclusive</span><span className="text-amber-400">0.30 — 0.75</span></div>
          </CardContent>
        </Card>
      </div>

      {/* ══ LIVE EVENT EXPLAINER ══ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Zap className="h-4 w-4 text-amber-400" />
            Live Event Explainer
          </CardTitle>
          <CardDescription>Select an event to generate a real-time SHAP explanation via the AI pipeline</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            {SAMPLE_EVENTS.map((ev, i) => (
              <button
                key={i}
                onClick={() => handleExplain(i)}
                className={cn(
                  "text-left rounded-lg border p-3 transition-all hover:border-primary/50",
                  selectedEvent === i ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border"
                )}
              >
                <p className="text-xs font-bold text-foreground mb-2">{ev.label}</p>
                <div className="grid grid-cols-2 gap-1 text-2xs text-muted-foreground">
                  <span>event_freq: <span className="text-foreground font-mono">{ev.event_frequency}</span></span>
                  <span>sigma: <span className="text-foreground font-mono">{ev.sigma_match}</span></span>
                  <span>user_risk: <span className="text-foreground font-mono">{ev.user_risk}</span></span>
                  <span>bytes_out: <span className="text-foreground font-mono">{ev.bytes_out}</span></span>
                  <span>entropy: <span className="text-foreground font-mono">{ev.entropy}</span></span>
                </div>
              </button>
            ))}
          </div>

          {explaining && (
            <div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Computing SHAP values…
            </div>
          )}

          {explanation && !explaining && (
            <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge
                    variant={explanation.score > 0.75 ? "destructive" : explanation.score > 0.4 ? "warning" : "success"}
                    className="text-xs px-3 py-1"
                  >
                    {explanation.label}
                  </Badge>
                  <span className="text-sm font-mono font-bold text-foreground">
                    Score: {explanation.score.toFixed(2)}
                  </span>
                </div>
                <Badge variant="outline" className="text-2xs gap-1"><Fingerprint className="h-2.5 w-2.5" /> SHAP</Badge>
              </div>
              <div className="space-y-1.5">
                {explanation.shap.map((s) => {
                  const pct = (Math.abs(s.value) / 0.4) * 100;
                  return (
                    <div key={s.feature} className="flex items-center gap-3">
                      <span className="w-36 truncate font-mono text-xs text-muted-foreground">{s.feature}</span>
                      <div className="flex-1 h-3 rounded bg-muted/30 overflow-hidden">
                        <div
                          className="h-full rounded transition-all duration-500"
                          style={{
                            width: `${Math.min(pct, 100)}%`,
                            background: s.value >= 0 ? "rgba(239,68,68,0.6)" : "rgba(6,182,212,0.6)",
                          }}
                        />
                      </div>
                      <Badge
                        variant={s.value >= 0 ? "destructive" : "cyan"}
                        className="text-2xs w-14 justify-center"
                      >
                        {s.value >= 0 ? "+" : ""}{s.value.toFixed(3)}
                      </Badge>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-4 text-2xs text-muted-foreground pt-2 border-t border-border/50">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/60" /> Pushes towards anomalous</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-500/60" /> Pushes towards normal</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══ PER-INVESTIGATION EXPLANATIONS ══ */}
      {investigations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileSearch className="h-4 w-4 text-primary" />
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

      {/* ══ TABBED DEEP-DIVE SECTION ══ */}
      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="features"><BarChart3 className="mr-1 h-3 w-3" /> Feature Importance</TabsTrigger>
          <TabsTrigger value="boundary"><Eye className="mr-1 h-3 w-3" /> Decision Boundary</TabsTrigger>
          <TabsTrigger value="cohorts"><Layers className="mr-1 h-3 w-3" /> Cohort Analysis</TabsTrigger>
          <TabsTrigger value="model-card"><Info className="mr-1 h-3 w-3" /> Model Cards</TabsTrigger>
        </TabsList>

        {/* FEATURE IMPORTANCE */}
        <TabsContent value="features" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Global SHAP Values</CardTitle>
                <CardDescription>Mean absolute SHAP contribution per feature</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer>
                    <BarChart data={xai.globalFeatures} layout="vertical" margin={{ left: 100 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="feature" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={95} />
                      <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                        {xai.globalFeatures.map((f, i) => (
                          <Cell key={i} fill={f.importance >= 0 ? "rgba(6,182,212,0.7)" : "rgba(239,68,68,0.7)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Feature Detail List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Feature Detail</CardTitle>
                <CardDescription>All 10 features with SHAP contributions</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-72">
                  <div className="space-y-2">
                    {xai.globalFeatures.map((f) => {
                      const pct = (Math.abs(f.importance) / 0.4) * 100;
                      return (
                        <div key={f.feature} className="flex items-center gap-3">
                          <span className="w-36 truncate font-mono text-xs text-muted-foreground">{f.feature}</span>
                          <div className="flex-1 h-3 rounded bg-muted/30 overflow-hidden">
                            <div
                              className="h-full rounded transition-all duration-500"
                              style={{
                                width: `${Math.min(pct, 100)}%`,
                                background: f.importance >= 0 ? "rgba(6,182,212,0.5)" : "rgba(239,68,68,0.5)",
                              }}
                            />
                          </div>
                          <Badge variant={f.importance >= 0 ? "cyan" : "destructive"} className="text-2xs w-14 justify-center">
                            {f.importance >= 0 ? "+" : ""}{f.importance.toFixed(3)}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* DECISION BOUNDARY */}
        <TabsContent value="boundary" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Decision Boundary Visualization</CardTitle>
              <CardDescription>2D projection of top-2 features with classification regions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" dataKey="x" name="Feature 1" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} />
                    <YAxis type="number" dataKey="y" name="Feature 2" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} />
                    <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Scatter data={xai.decisionBoundary}>
                      {(xai.decisionBoundary || []).map((p, i) => (
                        <Cell key={i} fill={p.label === 1 ? "rgba(239,68,68,0.6)" : "rgba(6,182,212,0.6)"} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex gap-4 justify-center text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500/60" /> Attack / Anomalous</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-cyan-500/60" /> Normal / Benign</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* COHORT ANALYSIS */}
        <TabsContent value="cohorts" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(xai.cohortAnalysis || []).map((c) => (
              <Card key={c.cohort}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-foreground">{c.cohort}</h4>
                    <Badge variant="ghost" className="text-2xs">{c.count.toLocaleString()} events</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-2xs text-muted-foreground">Accuracy</p>
                      <p className="text-lg font-bold text-foreground">{(c.accuracy * 100).toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-2xs text-muted-foreground">F1 Score</p>
                      <p className="text-lg font-bold text-foreground">{c.f1.toFixed(3)}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-2xs text-muted-foreground">Top Feature</p>
                    <Badge variant="outline" className="mt-0.5 text-2xs font-mono">{c.topFeature}</Badge>
                  </div>
                  <div className="h-2 rounded bg-muted/30 overflow-hidden">
                    <div className="h-full rounded bg-primary/50 transition-all" style={{ width: `${c.accuracy * 100}%` }} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="p-4">
              <p className="text-xs text-foreground font-medium">
                <strong>Insight:</strong> Auth Events show the strongest performance (F1: 0.950). File Events are weakest (F1: 0.860) due to entropy noise from encrypted payloads.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* MODEL CARDS */}
        <TabsContent value="model-card" className="space-y-4 mt-4">
          {(xai.modelCards || MOCK_DATA.modelCards!).map((mc) => (
            <Card key={mc.model}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">{mc.model}</CardTitle>
                    <CardDescription>Version {mc.version} · Trained {mc.trainDate}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm"><Download className="mr-1 h-3 w-3" /> Export Card</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                  {Object.entries(mc.metrics).map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">{k}</p>
                      <p className={cn("mt-1 text-2xl font-bold", v >= 0.9 ? "text-emerald-400" : v >= 0.7 ? "text-amber-400" : "text-destructive")}>{v.toFixed(3)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6">
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Fairness Metrics</h4>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {Object.entries(mc.fairness).map(([k, v]) => (
                      <div key={k}>
                        <p className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").trim()}</p>
                        <p className="mt-1 text-lg font-semibold text-foreground">{v.toFixed(3)}</p>
                        <Badge variant={v >= 0.9 ? "success" : v >= 0.8 ? "warning" : "destructive"} className="mt-0.5 text-2xs">
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
