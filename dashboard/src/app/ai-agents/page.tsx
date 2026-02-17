"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  CheckCircle2,
  XCircle,
  Cpu,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Zap,
  Brain,
  BarChart3,
  FlaskConical,
  Loader2,
  Trophy,
  Target,
  RefreshCw,
  Search,
  FileText,
  Clock,
  Shield,
  Eye,
  Crosshair,
  BookOpen,
  Play,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

/* ══════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════ */

interface ModelInfo {
  status: "online" | "offline";
  version?: string;
  dataset?: string;
  binary_model?: { name: string; accuracy: number };
  multiclass_model?: { name: string; accuracy: number };
  categories?: string[];
  error?: string;
}

interface LeaderboardEntry {
  name: string;
  best_params: Record<string, unknown>;
  cv_accuracy: number;
  test_accuracy: number;
  test_precision: number;
  test_recall: number;
  test_f1: number;
  auc_roc: number | null;
  train_time: number;
  inference_ms: number;
}

interface LeaderboardData {
  binary: LeaderboardEntry[];
  multiclass: LeaderboardEntry[];
}

interface ClassifyResult {
  is_attack: boolean;
  confidence: number;
  category: string;
  severity: string;
  explanation: string;
  binary_probability: number;
  multiclass_probabilities?: Record<string, number>;
}

interface AgentInfo {
  name: string;
  description: string;
  status: string;
  cases_processed: number;
  avg_response_ms: number;
  errors: number;
  last_action: string;
  last_action_time: string;
}

interface InvestigationSummary {
  investigation_id: string;
  created_at: string;
  status: string;
  is_attack: boolean;
  category: string;
  severity: string;
  priority: string;
  confidence: number;
  verdict: string | null;
  adjusted_confidence: number | null;
  correlated_events: number;
  agent_count: number;
  total_duration_ms: number;
}

interface InvestigationReport {
  investigation_id: string;
  created_at: string;
  status: string;
  error: string | null;
  trigger_source: string;
  triage: {
    is_attack: boolean;
    confidence: number;
    category: string;
    severity: string;
    priority: string;
    explanation: string;
    mitre_tactic: string;
    mitre_technique: string;
  } | null;
  hunt: {
    correlated_events: Array<{
      event_id: string;
      timestamp: string;
      source_table: string;
      category: string;
      severity: number;
      description: string;
      hostname: string;
      ip_address: string;
      similarity_score: number;
      correlation_type: string;
    }>;
    attack_chain: Array<{
      timestamp: string;
      action: string;
      source: string;
      detail: string;
    }>;
    affected_hosts: string[];
    affected_ips: string[];
    affected_users: string[];
    mitre_tactics: string[];
    mitre_techniques: string[];
  } | null;
  verification: {
    verdict: string;
    confidence: number;
    adjusted_confidence: number;
    false_positive_score: number;
    evidence_summary: string;
    checks_performed: number;
    checks_passed: number;
    checks_failed: number;
    check_details: Array<{ check: string; passed: boolean; detail: string }>;
    recommendation: string;
  } | null;
  report: {
    title: string;
    executive_summary: string;
    sections: Array<{ title: string; content: string; priority: number }>;
    mitre_mapping: Array<{
      technique_id: string;
      technique_name: string;
      tactic: string;
      url: string;
    }>;
    recommendations: string[];
    affected_assets: Record<string, string[]>;
    timeline: Array<{ timestamp: string; event: string; source: string }>;
  } | null;
  agent_results: Array<{
    agent_name: string;
    status: string;
    started_at: string;
    finished_at: string;
    duration_ms: number;
    error: string | null;
  }>;
}

/* ── Agent metadata ── */
const AGENT_META: Record<string, { icon: typeof Bot; color: string; bg: string }> = {
  triage: { icon: Shield, color: "text-blue-400", bg: "bg-blue-500/10" },
  hunter: { icon: Crosshair, color: "text-amber-400", bg: "bg-amber-500/10" },
  verifier: { icon: Eye, color: "text-purple-400", bg: "bg-purple-500/10" },
  reporter: { icon: BookOpen, color: "text-emerald-400", bg: "bg-emerald-500/10" },
};

/* ── Sample events ── */
const SAMPLE_EVENTS: Array<{
  label: string;
  icon: typeof Bot;
  color: string;
  logType: string;
  mode: "features" | "generic";
  event: Record<string, unknown>;
}> = [
  {
    label: "Normal HTTP Traffic",
    icon: CheckCircle2,
    color: "text-emerald-400",
    logType: "network",
    mode: "features",
    event: {
      duration: 0, protocol_type: "tcp", service: "http", flag: "SF",
      src_bytes: 215, dst_bytes: 45076, land: 0, wrong_fragment: 0, urgent: 0,
      hot: 0, num_failed_logins: 0, logged_in: 1, num_compromised: 0,
      root_shell: 0, su_attempted: 0, num_root: 0, num_file_creations: 0,
      num_shells: 0, num_access_files: 0, num_outbound_cmds: 0,
      is_host_login: 0, is_guest_login: 0, count: 1, srv_count: 1,
      serror_rate: 0.0, srv_serror_rate: 0.0, rerror_rate: 0.0,
      srv_rerror_rate: 0.0, same_srv_rate: 1.0, diff_srv_rate: 0.0,
      srv_diff_host_rate: 0.0, dst_host_count: 255, dst_host_srv_count: 255,
      dst_host_same_srv_rate: 1.0, dst_host_diff_srv_rate: 0.0,
      dst_host_same_src_port_rate: 0.0, dst_host_srv_diff_host_rate: 0.0,
      dst_host_serror_rate: 0.0, dst_host_srv_serror_rate: 0.0,
      dst_host_rerror_rate: 0.0, dst_host_srv_rerror_rate: 0.0,
    },
  },
  {
    label: "SYN Flood (DoS)",
    icon: AlertTriangle,
    color: "text-red-400",
    logType: "network",
    mode: "features",
    event: {
      duration: 0, protocol_type: "tcp", service: "http", flag: "S0",
      src_bytes: 0, dst_bytes: 0, land: 0, wrong_fragment: 0, urgent: 0,
      hot: 0, num_failed_logins: 0, logged_in: 0, num_compromised: 0,
      root_shell: 0, su_attempted: 0, num_root: 0, num_file_creations: 0,
      num_shells: 0, num_access_files: 0, num_outbound_cmds: 0,
      is_host_login: 0, is_guest_login: 0, count: 511, srv_count: 511,
      serror_rate: 1.0, srv_serror_rate: 1.0, rerror_rate: 0.0,
      srv_rerror_rate: 0.0, same_srv_rate: 1.0, diff_srv_rate: 0.0,
      srv_diff_host_rate: 0.0, dst_host_count: 255, dst_host_srv_count: 255,
      dst_host_same_srv_rate: 1.0, dst_host_diff_srv_rate: 0.0,
      dst_host_same_src_port_rate: 1.0, dst_host_srv_diff_host_rate: 0.0,
      dst_host_serror_rate: 1.0, dst_host_srv_serror_rate: 1.0,
      dst_host_rerror_rate: 0.0, dst_host_srv_rerror_rate: 0.0,
    },
  },
  {
    label: "Port Scan (Probe)",
    icon: Activity,
    color: "text-amber-400",
    logType: "network",
    mode: "features",
    event: {
      duration: 0, protocol_type: "tcp", service: "http", flag: "REJ",
      src_bytes: 0, dst_bytes: 0, land: 0, wrong_fragment: 0, urgent: 0,
      hot: 0, num_failed_logins: 0, logged_in: 0, num_compromised: 0,
      root_shell: 0, su_attempted: 0, num_root: 0, num_file_creations: 0,
      num_shells: 0, num_access_files: 0, num_outbound_cmds: 0,
      is_host_login: 0, is_guest_login: 0, count: 1, srv_count: 1,
      serror_rate: 0.0, srv_serror_rate: 0.0, rerror_rate: 1.0,
      srv_rerror_rate: 1.0, same_srv_rate: 1.0, diff_srv_rate: 0.0,
      srv_diff_host_rate: 0.0, dst_host_count: 147, dst_host_srv_count: 13,
      dst_host_same_srv_rate: 0.09, dst_host_diff_srv_rate: 0.06,
      dst_host_same_src_port_rate: 0.0, dst_host_srv_diff_host_rate: 0.0,
      dst_host_serror_rate: 0.0, dst_host_srv_serror_rate: 0.0,
      dst_host_rerror_rate: 1.0, dst_host_srv_rerror_rate: 1.0,
    },
  },
  {
    label: "Sysmon: Mimikatz (Cred Dump)",
    icon: AlertTriangle,
    color: "text-red-400",
    logType: "sysmon",
    mode: "generic",
    event: {
      Channel: "Microsoft-Windows-Sysmon/Operational",
      EventID: 10,
      source: "sysmon",
      hostname: "DC01.corp.local",
      timestamp: new Date().toISOString(),
      SourceProcessGUID: "{12345678-abcd-1234-abcd-123456789abc}",
      SourceImage: "C:\\Tools\\mimikatz.exe",
      TargetImage: "C:\\Windows\\System32\\lsass.exe",
      GrantedAccess: "0x1010",
      SourceUser: "CORP\\attacker",
    },
  },
  {
    label: "WinSec: Failed Logon Burst",
    icon: AlertTriangle,
    color: "text-orange-400",
    logType: "windows_security",
    mode: "generic",
    event: {
      Channel: "Security",
      EventID: 4625,
      source: "Microsoft-Windows-Security-Auditing",
      hostname: "WEB-SRV01",
      timestamp: new Date().toISOString(),
      TargetUserName: "admin",
      LogonType: "10",
      IpAddress: "185.220.101.42",
      FailureReason: "%%2313",
      SubStatus: "0xc000006a",
    },
  },
  {
    label: "SSH Brute Force (Auth)",
    icon: AlertTriangle,
    color: "text-orange-400",
    logType: "auth",
    mode: "generic",
    event: {
      source: "sshd",
      hostname: "prod-bastion-01",
      timestamp: new Date().toISOString(),
      message: "Failed password for invalid user admin from 45.33.32.156 port 22 ssh2",
      ip_address: "45.33.32.156",
      user: "admin",
      failed_logins: 5,
    },
  },
  {
    label: "Firewall: Outbound C2 Port",
    icon: AlertTriangle,
    color: "text-red-400",
    logType: "firewall",
    mode: "generic",
    event: {
      source: "iptables",
      hostname: "edge-fw-01",
      timestamp: new Date().toISOString(),
      message: "iptables: IN= OUT=eth0 SRC=10.0.1.42 DST=198.51.100.99 PROTO=TCP SPT=54321 DPT=4444 LEN=52",
      action: "allow",
      direction: "outbound",
      src_ip: "10.0.1.42",
      dst_ip: "198.51.100.99",
      dst_port: 4444,
      protocol: "TCP",
    },
  },
];

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

/* ── Helpers ── */
function severityVariant(sev: string): "critical" | "high" | "medium" | "low" | "info" {
  switch (sev?.toLowerCase()) {
    case "critical": return "critical";
    case "high": return "high";
    case "medium": return "medium";
    case "low": return "low";
    default: return "info";
  }
}

function verdictVariant(v: string): "critical" | "high" | "medium" | "low" | "info" {
  switch (v) {
    case "true_positive": return "critical";
    case "false_positive": return "low";
    case "suspicious": return "high";
    case "benign": return "low";
    default: return "info";
  }
}

function verdictLabel(v: string): string {
  return v?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ?? "Unknown";
}

function statusColor(s: string): string {
  switch (s) {
    case "idle": return "text-zinc-400";
    case "processing": return "text-amber-400";
    case "done": return "text-emerald-400";
    case "error": return "text-red-400";
    default: return "text-zinc-400";
  }
}

function priorityVariant(p: string): "critical" | "high" | "medium" | "low" | "info" {
  switch (p) {
    case "P1": return "critical";
    case "P2": return "high";
    case "P3": return "medium";
    case "P4": return "low";
    default: return "info";
  }
}

/* ══════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════ */
export default function AIAgentsPage() {
  /* ── ML State ── */
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);
  const [selectedSample, setSelectedSample] = useState<number | null>(null);
  const [classificationHistory, setClassificationHistory] = useState<
    { label: string; result: ClassifyResult; timestamp: Date }[]
  >([]);

  /* ── Agent State ── */
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [investigations, setInvestigations] = useState<InvestigationSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [investigating, setInvestigating] = useState(false);
  const [investigateResult, setInvestigateResult] = useState<InvestigationReport | null>(null);
  const [selectedInvestigate, setSelectedInvestigate] = useState<number | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["triage", "verification"]),
  );
  const [pipelineProgress, setPipelineProgress] = useState<string[]>([]);

  /* ── Fetchers ── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [infoRes, lbRes] = await Promise.all([
        fetch("/api/ai/classify").then((r) => r.json()),
        fetch("/api/ai/leaderboard").then((r) => r.json()),
      ]);
      setModelInfo(infoRes);
      if (!infoRes.error) setLeaderboard(lbRes);
    } catch {
      setModelInfo({ status: "offline", error: "Failed to reach API" });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const res = await fetch("/api/ai/agents");
      const data = await res.json();
      if (!data.error) {
        setAgents(data.agents ?? []);
        setInvestigations(data.investigations ?? []);
      }
    } catch {
      /* silently fail */
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchAgents();
  }, [fetchData, fetchAgents]);

  /* ── Actions ── */
  const runClassify = async (idx: number) => {
    setClassifying(true);
    setSelectedSample(idx);
    setClassifyResult(null);
    try {
      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: SAMPLE_EVENTS[idx].event }),
      });
      const data: ClassifyResult = await res.json();
      setClassifyResult(data);
      setClassificationHistory((prev) => [
        { label: SAMPLE_EVENTS[idx].label, result: data, timestamp: new Date() },
        ...prev.slice(0, 19),
      ]);
      toast.success("Classification complete", {
        description: `${data.is_attack ? "⚠ Attack" : "✓ Benign"} — ${data.category} (${(data.confidence * 100).toFixed(1)}%)`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Classification failed", { description: msg });
    } finally {
      setClassifying(false);
    }
  };

  const runInvestigation = async (idx: number) => {
    setInvestigating(true);
    setSelectedInvestigate(idx);
    setInvestigateResult(null);
    setPipelineProgress(["Submitting event..."]);

    try {
      const timer = setInterval(() => {
        setPipelineProgress((prev) => {
          if (prev.length === 1) return [...prev, "Triage Agent analysing..."];
          if (prev.length === 2) return [...prev, "Hunter Agent correlating..."];
          if (prev.length === 3) return [...prev, "Verifier Agent validating..."];
          if (prev.length === 4) return [...prev, "Reporter Agent generating report..."];
          return prev;
        });
      }, 1500);

      const res = await fetch("/api/ai/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: SAMPLE_EVENTS[idx].event, mode: SAMPLE_EVENTS[idx].mode }),
      });
      clearInterval(timer);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: InvestigationReport = await res.json();
      setInvestigateResult(data);
      setPipelineProgress((prev) => [...prev, "Investigation complete!"]);
      fetchAgents();

      const verdict = data.verification?.verdict ?? "N/A";
      toast.success("Investigation complete", {
        description: `${data.triage?.priority ?? "P5"} — ${data.triage?.category ?? "Unknown"} — Verdict: ${verdictLabel(verdict)}`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setPipelineProgress((prev) => [...prev, `Error: ${msg}`]);
      toast.error("Investigation failed", { description: msg });
    } finally {
      setInvestigating(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const isOnline = modelInfo?.status === "online";

  /* ══════════════════════════════════════════════════════════════
     Render
     ══════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Agents</h1>
          <p className="text-sm text-muted-foreground">
            Autonomous investigation pipeline — ML classifier + 4-agent orchestration
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            fetchData();
            fetchAgents();
          }}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Service Status Banner */}
      <Card className={isOnline ? "border-emerald-500/30" : "border-red-500/30"}>
        <CardContent className="flex items-center gap-4 py-4">
          <div className={`rounded-full p-2 ${isOnline ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
            {isOnline ? (
              <Zap className="h-5 w-5 text-emerald-400" />
            ) : (
              <XCircle className="h-5 w-5 text-red-400" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">AI Service</span>
              <Badge variant={isOnline ? "low" : "critical"}>
                {isOnline ? "Online" : "Offline"}
              </Badge>
              {modelInfo?.version && (
                <Badge variant="outline" className="text-[10px]">
                  v{modelInfo.version}
                </Badge>
              )}
              {agents.length > 0 && (
                <Badge variant="default" className="text-[10px]">
                  {agents.length} agents
                </Badge>
              )}
            </div>
            {isOnline && modelInfo?.dataset && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Dataset: {modelInfo.dataset} · Binary: {modelInfo.binary_model?.name} (
                {pct(modelInfo.binary_model?.accuracy ?? 0)}) · Multiclass:{" "}
                {modelInfo.multiclass_model?.name} (
                {pct(modelInfo.multiclass_model?.accuracy ?? 0)})
              </p>
            )}
            {!isOnline && (
              <p className="text-xs text-red-400 mt-0.5">
                {modelInfo?.error ??
                  "AI classifier service is not reachable — start ai_service.py"}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ═══════════ TABS ═══════════ */}
      <Tabs defaultValue="agents" className="space-y-4">
        <TabsList>
          <TabsTrigger value="agents" className="gap-1.5">
            <Bot className="h-3.5 w-3.5" /> Agents
          </TabsTrigger>
          <TabsTrigger value="investigate" className="gap-1.5">
            <Search className="h-3.5 w-3.5" /> Investigate
          </TabsTrigger>
          <TabsTrigger value="overview" className="gap-1.5">
            <Brain className="h-3.5 w-3.5" /> ML Overview
          </TabsTrigger>
          <TabsTrigger value="leaderboard" className="gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Leaderboard
          </TabsTrigger>
          <TabsTrigger value="classify" className="gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" /> Live Classify
          </TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════
           TAB 1: AGENTS STATUS
           ══════════════════════════════════════════════════════════ */}
        <TabsContent value="agents" className="space-y-4">
          {agentsLoading && agents.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : agents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Bot className="mx-auto h-10 w-10 mb-3 opacity-40" />
                <p>
                  No agents connected. Start{" "}
                  <code className="text-xs">ai_service.py</code> to enable the
                  agent orchestrator.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Agent Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {agents.map((agent) => {
                  const key = agent.name.toLowerCase().replace(/\s+/g, "_");
                  const meta = AGENT_META[key] ?? {
                    icon: Bot,
                    color: "text-zinc-400",
                    bg: "bg-zinc-500/10",
                  };
                  const Icon = meta.icon;
                  return (
                    <Card key={agent.name}>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <div className={`rounded-md p-1.5 ${meta.bg}`}>
                            <Icon className={`h-4 w-4 ${meta.color}`} />
                          </div>
                          <span className="flex-1 truncate">{agent.name}</span>
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase ${statusColor(
                              agent.status,
                            )}`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {agent.status}
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                          {agent.description || "No description"}
                        </p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-lg font-bold tabular-nums">
                              {agent.cases_processed}
                            </p>
                            <p className="text-[9px] text-muted-foreground">Cases</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold tabular-nums">
                              {agent.avg_response_ms.toFixed(0)}
                              <span className="text-[10px] text-muted-foreground font-normal">
                                ms
                              </span>
                            </p>
                            <p className="text-[9px] text-muted-foreground">Avg Time</p>
                          </div>
                          <div>
                            <p
                              className={`text-lg font-bold tabular-nums ${
                                agent.errors > 0 ? "text-red-400" : "text-emerald-400"
                              }`}
                            >
                              {agent.errors}
                            </p>
                            <p className="text-[9px] text-muted-foreground">Errors</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Pipeline Architecture */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Zap className="h-4 w-4 text-primary" />
                    Investigation Pipeline
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between gap-2">
                    {[
                      { name: "Triage", desc: "ML Classification", key: "triage" },
                      { name: "Hunter", desc: "ClickHouse + LanceDB", key: "hunter" },
                      { name: "Verifier", desc: "6-Check Validation", key: "verifier" },
                      { name: "Reporter", desc: "Structured Report", key: "reporter" },
                    ].map((stage, i) => {
                      const meta = AGENT_META[stage.key];
                      const Icon = meta.icon;
                      return (
                        <div key={stage.key} className="flex items-center gap-2 flex-1">
                          <div className="flex-1 rounded-lg border p-3 text-center">
                            <Icon
                              className={`mx-auto h-5 w-5 ${meta.color} mb-1`}
                            />
                            <p className="text-xs font-medium">{stage.name}</p>
                            <p className="text-[9px] text-muted-foreground">{stage.desc}</p>
                          </div>
                          {i < 3 && (
                            <span className="text-muted-foreground text-lg shrink-0">→</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Recent Investigations */}
              {investigations.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="h-4 w-4 text-primary" />
                      Recent Investigations ({investigations.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="pb-2 pr-3 font-medium text-muted-foreground">ID</th>
                            <th className="pb-2 pr-3 font-medium text-muted-foreground">
                              Category
                            </th>
                            <th className="pb-2 pr-3 font-medium text-muted-foreground">
                              Severity
                            </th>
                            <th className="pb-2 pr-3 font-medium text-muted-foreground">
                              Priority
                            </th>
                            <th className="pb-2 pr-3 font-medium text-muted-foreground">
                              Verdict
                            </th>
                            <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">
                              Confidence
                            </th>
                            <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">
                              Events
                            </th>
                            <th className="pb-2 font-medium text-muted-foreground text-right">
                              Duration
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {investigations.map((inv) => (
                            <tr key={inv.investigation_id} className="border-b border-border/50">
                              <td className="py-2 pr-3 font-mono text-[10px] text-muted-foreground">
                                {inv.investigation_id.slice(0, 8)}
                              </td>
                              <td className="py-2 pr-3">
                                <Badge
                                  variant={inv.is_attack ? "critical" : "low"}
                                  className="text-[10px]"
                                >
                                  {inv.category}
                                </Badge>
                              </td>
                              <td className="py-2 pr-3">
                                <Badge
                                  variant={severityVariant(inv.severity)}
                                  className="text-[10px]"
                                >
                                  {inv.severity}
                                </Badge>
                              </td>
                              <td className="py-2 pr-3">
                                <Badge
                                  variant={priorityVariant(inv.priority)}
                                  className="text-[10px]"
                                >
                                  {inv.priority}
                                </Badge>
                              </td>
                              <td className="py-2 pr-3">
                                {inv.verdict ? (
                                  <Badge
                                    variant={verdictVariant(inv.verdict)}
                                    className="text-[10px]"
                                  >
                                    {verdictLabel(inv.verdict)}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {(
                                  (inv.adjusted_confidence ?? inv.confidence) * 100
                                ).toFixed(1)}
                                %
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {inv.correlated_events}
                              </td>
                              <td className="py-2 text-right tabular-nums text-muted-foreground">
                                {inv.total_duration_ms.toFixed(0)}ms
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════
           TAB 2: INVESTIGATE
           ══════════════════════════════════════════════════════════ */}
        <TabsContent value="investigate" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-5">
            {/* Left: event selection + progress */}
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Play className="h-4 w-4 text-primary" />
                    Launch Investigation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Run the full 4-agent pipeline: Triage → Hunter → Verifier →
                    Reporter. Select an event below.
                  </p>
                  {SAMPLE_EVENTS.map((sample, idx) => {
                    const Icon = sample.icon;
                    return (
                      <button
                        key={idx}
                        disabled={investigating || !isOnline}
                        onClick={() => runInvestigation(idx)}
                        className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed ${
                          selectedInvestigate === idx ? "border-primary bg-accent/30" : ""
                        }`}
                      >
                        <div className="rounded-md bg-muted p-2">
                          <Icon className={`h-4 w-4 ${sample.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{sample.label}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {sample.logType.toUpperCase()}
                            {sample.event.protocol_type
                              ? ` · ${String(sample.event.protocol_type).toUpperCase()} · ${sample.event.service} · flag=${sample.event.flag}`
                              : sample.event.EventID
                                ? ` · EID ${sample.event.EventID} · ${sample.event.hostname ?? ""}`
                                : sample.event.source
                                  ? ` · ${sample.event.source} · ${sample.event.hostname ?? ""}`
                                  : ""}
                          </p>
                        </div>
                        {investigating && selectedInvestigate === idx ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                        ) : (
                          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                      </button>
                    );
                  })}
                  {!isOnline && (
                    <p className="text-xs text-red-400 text-center pt-1">
                      AI service offline
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Pipeline Progress */}
              {pipelineProgress.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <Activity className="h-4 w-4 text-primary" />
                      Pipeline Progress
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="relative space-y-2">
                      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
                      {pipelineProgress.map((step, i) => {
                        const isLast = i === pipelineProgress.length - 1;
                        const isError = step.startsWith("Error:");
                        const isDone = step === "Investigation complete!";
                        return (
                          <div key={i} className="relative flex items-center gap-3 pl-5">
                            <div className="absolute left-0">
                              {isDone ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                              ) : isError ? (
                                <XCircle className="h-3.5 w-3.5 text-red-400" />
                              ) : isLast && investigating ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </div>
                            <span
                              className={`text-xs ${
                                isDone
                                  ? "text-emerald-400 font-medium"
                                  : isError
                                    ? "text-red-400"
                                    : isLast && investigating
                                      ? "text-foreground"
                                      : "text-muted-foreground"
                              }`}
                            >
                              {step}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right: investigation report */}
            <div className="lg:col-span-3 space-y-4">
              {investigateResult ? (
                <>
                  {/* Report Header */}
                  <Card
                    className={
                      investigateResult.triage?.is_attack
                        ? "border-red-500/30"
                        : "border-emerald-500/30"
                    }
                  >
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            {investigateResult.triage?.is_attack ? (
                              <AlertTriangle className="h-5 w-5 text-red-400" />
                            ) : (
                              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                            )}
                            <span className="font-semibold">
                              {investigateResult.report?.title ??
                                (investigateResult.triage?.is_attack
                                  ? "Attack Detected"
                                  : "Benign Traffic")}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {investigateResult.report?.executive_summary ??
                              investigateResult.triage?.explanation ??
                              "No summary available"}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {investigateResult.triage?.priority && (
                            <Badge
                              variant={priorityVariant(investigateResult.triage.priority)}
                            >
                              {investigateResult.triage.priority}
                            </Badge>
                          )}
                          {investigateResult.verification?.verdict && (
                            <Badge
                              variant={verdictVariant(
                                investigateResult.verification.verdict,
                              )}
                              className="text-[10px]"
                            >
                              {verdictLabel(investigateResult.verification.verdict)}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {/* Quick stats row */}
                      <div className="grid grid-cols-4 gap-3 mt-3">
                        <div className="rounded border p-2 text-center">
                          <p className="text-[9px] uppercase text-muted-foreground">
                            Category
                          </p>
                          <p className="text-xs font-bold mt-0.5">
                            {investigateResult.triage?.category ?? "—"}
                          </p>
                        </div>
                        <div className="rounded border p-2 text-center">
                          <p className="text-[9px] uppercase text-muted-foreground">
                            Severity
                          </p>
                          <Badge
                            variant={severityVariant(
                              investigateResult.triage?.severity ?? "info",
                            )}
                            className="text-[10px] mt-0.5"
                          >
                            {investigateResult.triage?.severity ?? "info"}
                          </Badge>
                        </div>
                        <div className="rounded border p-2 text-center">
                          <p className="text-[9px] uppercase text-muted-foreground">
                            Confidence
                          </p>
                          <p className="text-xs font-bold tabular-nums mt-0.5 text-emerald-400">
                            {(
                              (investigateResult.verification?.adjusted_confidence ??
                                investigateResult.triage?.confidence ??
                                0) * 100
                            ).toFixed(1)}
                            %
                          </p>
                        </div>
                        <div className="rounded border p-2 text-center">
                          <p className="text-[9px] uppercase text-muted-foreground">
                            Duration
                          </p>
                          <p className="text-xs font-bold tabular-nums mt-0.5">
                            {investigateResult.agent_results
                              .reduce((s, a) => s + a.duration_ms, 0)
                              .toFixed(0)}
                            ms
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Collapsible Sections */}

                  {/* Triage Section */}
                  {investigateResult.triage && (
                    <Card>
                      <button
                        className="w-full"
                        onClick={() => toggleSection("triage")}
                      >
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-sm font-medium">
                            <Shield className="h-4 w-4 text-blue-400" />
                            Triage Results
                            <span className="ml-auto">
                              {expandedSections.has("triage") ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </span>
                          </CardTitle>
                        </CardHeader>
                      </button>
                      {expandedSections.has("triage") && (
                        <CardContent className="space-y-3">
                          <p className="text-xs text-muted-foreground">
                            {investigateResult.triage.explanation}
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded border p-2">
                              <span className="text-muted-foreground">MITRE Tactic:</span>{" "}
                              <span className="font-medium">
                                {investigateResult.triage.mitre_tactic || "N/A"}
                              </span>
                            </div>
                            <div className="rounded border p-2">
                              <span className="text-muted-foreground">MITRE Technique:</span>{" "}
                              <span className="font-medium">
                                {investigateResult.triage.mitre_technique || "N/A"}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  )}

                  {/* Hunt Section */}
                  {investigateResult.hunt && (
                    <Card>
                      <button
                        className="w-full"
                        onClick={() => toggleSection("hunt")}
                      >
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-sm font-medium">
                            <Crosshair className="h-4 w-4 text-amber-400" />
                            Hunt Findings
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              {investigateResult.hunt.correlated_events.length} events
                            </Badge>
                            <span className="ml-auto">
                              {expandedSections.has("hunt") ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </span>
                          </CardTitle>
                        </CardHeader>
                      </button>
                      {expandedSections.has("hunt") && (
                        <CardContent className="space-y-3">
                          {/* Affected assets */}
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              {
                                label: "Hosts",
                                items: investigateResult.hunt.affected_hosts,
                              },
                              {
                                label: "IPs",
                                items: investigateResult.hunt.affected_ips,
                              },
                              {
                                label: "Users",
                                items: investigateResult.hunt.affected_users,
                              },
                            ].map(
                              (g) =>
                                g.items.length > 0 && (
                                  <div key={g.label} className="rounded border p-2">
                                    <p className="text-[9px] uppercase text-muted-foreground mb-1">
                                      {g.label}
                                    </p>
                                    {g.items.map((item) => (
                                      <Badge
                                        key={item}
                                        variant="outline"
                                        className="text-[10px] mr-1 mb-1"
                                      >
                                        {item}
                                      </Badge>
                                    ))}
                                  </div>
                                ),
                            )}
                          </div>

                          {/* MITRE */}
                          {investigateResult.hunt.mitre_techniques.length > 0 && (
                            <div className="rounded border p-2">
                              <p className="text-[9px] uppercase text-muted-foreground mb-1">
                                MITRE Techniques
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {investigateResult.hunt.mitre_techniques.map((t) => (
                                  <Badge key={t} variant="medium" className="text-[10px]">
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Attack chain */}
                          {investigateResult.hunt.attack_chain.length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase text-muted-foreground mb-2">
                                Attack Chain Timeline
                              </p>
                              <div className="relative space-y-2">
                                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
                                {investigateResult.hunt.attack_chain
                                  .slice(0, 10)
                                  .map((step, i) => (
                                    <div
                                      key={i}
                                      className="relative flex gap-3 pl-5 text-xs"
                                    >
                                      <div className="absolute left-0 top-1">
                                        <div className="h-3.5 w-3.5 rounded-full border-2 border-amber-400/50 bg-card" />
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground font-mono text-[10px]">
                                          {step.timestamp
                                            ? new Date(step.timestamp).toLocaleTimeString()
                                            : "—"}
                                        </span>
                                        <p className="font-medium">{step.action}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                          {step.source} — {step.detail}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}

                          {/* Correlated events table */}
                          {investigateResult.hunt.correlated_events.length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase text-muted-foreground mb-2">
                                Correlated Events
                              </p>
                              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="border-b text-left">
                                      <th className="pb-1 pr-2 text-muted-foreground font-medium">
                                        Source
                                      </th>
                                      <th className="pb-1 pr-2 text-muted-foreground font-medium">
                                        Type
                                      </th>
                                      <th className="pb-1 pr-2 text-muted-foreground font-medium">
                                        Host/IP
                                      </th>
                                      <th className="pb-1 text-muted-foreground font-medium">
                                        Description
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {investigateResult.hunt.correlated_events
                                      .slice(0, 15)
                                      .map((evt, i) => (
                                        <tr key={i} className="border-b border-border/30">
                                          <td className="py-1 pr-2">
                                            <Badge
                                              variant="outline"
                                              className="text-[9px]"
                                            >
                                              {evt.source_table}
                                            </Badge>
                                          </td>
                                          <td className="py-1 pr-2 text-muted-foreground">
                                            {evt.correlation_type}
                                          </td>
                                          <td className="py-1 pr-2 font-mono text-[10px]">
                                            {evt.hostname || evt.ip_address || "—"}
                                          </td>
                                          <td className="py-1 truncate max-w-[200px]">
                                            {evt.description || evt.category}
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  )}

                  {/* Verification Section */}
                  {investigateResult.verification && (
                    <Card>
                      <button
                        className="w-full"
                        onClick={() => toggleSection("verification")}
                      >
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-sm font-medium">
                            <Eye className="h-4 w-4 text-purple-400" />
                            Verification
                            <Badge
                              variant={verdictVariant(
                                investigateResult.verification.verdict,
                              )}
                              className="ml-2 text-[10px]"
                            >
                              {verdictLabel(investigateResult.verification.verdict)}
                            </Badge>
                            <span className="ml-auto">
                              {expandedSections.has("verification") ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </span>
                          </CardTitle>
                        </CardHeader>
                      </button>
                      {expandedSections.has("verification") && (
                        <CardContent className="space-y-3">
                          <p className="text-xs text-muted-foreground">
                            {investigateResult.verification.evidence_summary}
                          </p>

                          {/* Check results */}
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="rounded border p-2">
                              <p className="text-lg font-bold tabular-nums text-emerald-400">
                                {investigateResult.verification.checks_passed}
                              </p>
                              <p className="text-[9px] text-muted-foreground">Passed</p>
                            </div>
                            <div className="rounded border p-2">
                              <p className="text-lg font-bold tabular-nums text-red-400">
                                {investigateResult.verification.checks_failed}
                              </p>
                              <p className="text-[9px] text-muted-foreground">Failed</p>
                            </div>
                            <div className="rounded border p-2">
                              <p className="text-lg font-bold tabular-nums">
                                {(
                                  investigateResult.verification.adjusted_confidence * 100
                                ).toFixed(1)}
                                %
                              </p>
                              <p className="text-[9px] text-muted-foreground">
                                Adj. Confidence
                              </p>
                            </div>
                          </div>

                          {/* Individual checks */}
                          {investigateResult.verification.check_details?.length > 0 && (
                            <div className="space-y-1">
                              {investigateResult.verification.check_details.map(
                                (check, i) => (
                                  <div
                                    key={i}
                                    className="flex items-start gap-2 text-xs rounded border p-2"
                                  >
                                    {check.passed ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                                    ) : (
                                      <XCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                                    )}
                                    <div>
                                      <span className="font-medium">{check.check}</span>
                                      <p className="text-[10px] text-muted-foreground">
                                        {check.detail}
                                      </p>
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                          )}

                          {/* Recommendation */}
                          {investigateResult.verification.recommendation && (
                            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                              <p className="text-[10px] uppercase text-blue-400 font-medium mb-1">
                                Recommendation
                              </p>
                              <p className="text-xs">
                                {investigateResult.verification.recommendation}
                              </p>
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  )}

                  {/* Report Section */}
                  {investigateResult.report && (
                    <Card>
                      <button
                        className="w-full"
                        onClick={() => toggleSection("report")}
                      >
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-sm font-medium">
                            <BookOpen className="h-4 w-4 text-emerald-400" />
                            Investigation Report
                            <span className="ml-auto">
                              {expandedSections.has("report") ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </span>
                          </CardTitle>
                        </CardHeader>
                      </button>
                      {expandedSections.has("report") && (
                        <CardContent className="space-y-3">
                          {/* MITRE Mapping */}
                          {investigateResult.report.mitre_mapping?.length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase text-muted-foreground mb-2">
                                MITRE ATT&CK Mapping
                              </p>
                              <div className="space-y-1">
                                {investigateResult.report.mitre_mapping.map((m, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center gap-2 text-xs rounded border p-2"
                                  >
                                    <Badge variant="medium" className="text-[10px]">
                                      {m.technique_id}
                                    </Badge>
                                    <span className="font-medium">{m.technique_name}</span>
                                    <span className="text-muted-foreground">
                                      ({m.tactic})
                                    </span>
                                    {m.url && (
                                      <a
                                        href={m.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="ml-auto text-primary hover:underline"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Recommendations */}
                          {investigateResult.report.recommendations?.length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase text-muted-foreground mb-2">
                                Recommendations
                              </p>
                              <ul className="space-y-1">
                                {investigateResult.report.recommendations.map((rec, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2 text-xs rounded border p-2"
                                  >
                                    <span className="text-primary font-bold shrink-0">
                                      {i + 1}.
                                    </span>
                                    {rec}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Affected Assets */}
                          {investigateResult.report.affected_assets &&
                            Object.keys(investigateResult.report.affected_assets).length >
                              0 && (
                              <div>
                                <p className="text-[10px] uppercase text-muted-foreground mb-2">
                                  Affected Assets
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                  {Object.entries(
                                    investigateResult.report.affected_assets,
                                  ).map(
                                    ([key, vals]) =>
                                      vals.length > 0 && (
                                        <div key={key} className="rounded border p-2">
                                          <p className="text-[9px] uppercase text-muted-foreground mb-1">
                                            {key}
                                          </p>
                                          <div className="flex flex-wrap gap-1">
                                            {vals.map((v) => (
                                              <Badge
                                                key={v}
                                                variant="outline"
                                                className="text-[10px]"
                                              >
                                                {v}
                                              </Badge>
                                            ))}
                                          </div>
                                        </div>
                                      ),
                                  )}
                                </div>
                              </div>
                            )}

                          {/* Report Sections */}
                          {investigateResult.report.sections?.length > 0 && (
                            <div>
                              <Separator className="my-2" />
                              {investigateResult.report.sections.map((sec, i) => (
                                <div key={i} className="mb-3">
                                  <p className="text-xs font-medium mb-1">{sec.title}</p>
                                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                                    {sec.content}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Timeline */}
                          {investigateResult.report.timeline?.length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase text-muted-foreground mb-2">
                                Timeline
                              </p>
                              <div className="relative space-y-2">
                                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
                                {investigateResult.report.timeline.map((evt, i) => (
                                  <div
                                    key={i}
                                    className="relative flex gap-3 pl-5 text-xs"
                                  >
                                    <div className="absolute left-0 top-1">
                                      <div className="h-3.5 w-3.5 rounded-full border-2 border-emerald-400/50 bg-card" />
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground font-mono text-[10px]">
                                        {evt.timestamp
                                          ? new Date(evt.timestamp).toLocaleTimeString()
                                          : "—"}
                                      </span>
                                      <p>
                                        <Badge
                                          variant="outline"
                                          className="text-[9px] mr-1"
                                        >
                                          {evt.source}
                                        </Badge>
                                        {evt.event}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  )}

                  {/* Agent Performance */}
                  {investigateResult.agent_results.length > 0 && (
                    <Card>
                      <button
                        className="w-full"
                        onClick={() => toggleSection("agents")}
                      >
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-sm font-medium">
                            <Clock className="h-4 w-4 text-primary" />
                            Agent Performance
                            <span className="ml-auto">
                              {expandedSections.has("agents") ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </span>
                          </CardTitle>
                        </CardHeader>
                      </button>
                      {expandedSections.has("agents") && (
                        <CardContent>
                          <div className="space-y-2">
                            {investigateResult.agent_results.map((ar) => {
                              const key = ar.agent_name
                                .toLowerCase()
                                .replace(/\s+/g, "_");
                              const meta = AGENT_META[key] ?? {
                                icon: Bot,
                                color: "text-zinc-400",
                                bg: "bg-zinc-500/10",
                              };
                              const Icon = meta.icon;
                              return (
                                <div
                                  key={ar.agent_name}
                                  className="flex items-center gap-3 rounded border p-2"
                                >
                                  <div className={`rounded-md p-1.5 ${meta.bg}`}>
                                    <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                                  </div>
                                  <span className="text-xs font-medium flex-1">
                                    {ar.agent_name}
                                  </span>
                                  <Badge
                                    variant={ar.error ? "critical" : "low"}
                                    className="text-[10px]"
                                  >
                                    {ar.status}
                                  </Badge>
                                  <span className="text-xs tabular-nums text-muted-foreground">
                                    {ar.duration_ms.toFixed(0)}ms
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  )}
                </>
              ) : (
                <Card>
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <Search className="mx-auto h-10 w-10 mb-3 opacity-40" />
                    <p className="text-sm">Select an event to investigate</p>
                    <p className="text-[10px] mt-1">
                      Full pipeline results will appear here
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════
           TAB 3: ML OVERVIEW  (carried forward)
           ══════════════════════════════════════════════════════════ */}
        <TabsContent value="overview" className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !isOnline ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Bot className="mx-auto h-10 w-10 mb-3 opacity-40" />
                <p>
                  AI service is offline. Start <code className="text-xs">ai_service.py</code>{" "}
                  to enable classification.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* KPI cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5" /> Binary Accuracy
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold tabular-nums text-emerald-400">
                      {pct(modelInfo?.binary_model?.accuracy ?? 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {modelInfo?.binary_model?.name}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Target className="h-3.5 w-3.5" /> Multiclass Accuracy
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold tabular-nums text-blue-400">
                      {pct(modelInfo?.multiclass_model?.accuracy ?? 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {modelInfo?.multiclass_model?.name}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Cpu className="h-3.5 w-3.5" /> Models Trained
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold tabular-nums">
                      {(leaderboard?.binary?.length ?? 0) +
                        (leaderboard?.multiclass?.length ?? 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {leaderboard?.binary?.length ?? 0} binary ·{" "}
                      {leaderboard?.multiclass?.length ?? 0} multiclass
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Activity className="h-3.5 w-3.5" /> Attack Categories
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold tabular-nums">
                      {modelInfo?.categories?.length ?? 0}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {modelInfo?.categories?.join(", ")}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Architecture overview */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Brain className="h-4 w-4 text-primary" />
                    Classifier Architecture
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-lg border p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="rounded-md bg-emerald-500/10 p-1.5">
                          <ShieldCheck className="h-4 w-4 text-emerald-400" />
                        </div>
                        <span className="text-sm font-medium">Stage 1 — Binary</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        First pass determines if traffic is <strong>Normal</strong> or{" "}
                        <strong>Attack</strong>. Uses {modelInfo?.binary_model?.name} with{" "}
                        {pct(modelInfo?.binary_model?.accuracy ?? 0)} accuracy.
                      </p>
                    </div>
                    <div className="rounded-lg border p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="rounded-md bg-blue-500/10 p-1.5">
                          <Target className="h-4 w-4 text-blue-400" />
                        </div>
                        <span className="text-sm font-medium">Stage 2 — Multiclass</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        If attack detected, classifies into categories:{" "}
                        {modelInfo?.categories
                          ?.filter((c) => c !== "Normal")
                          .join(", ")}
                        . Uses {modelInfo?.multiclass_model?.name}.
                      </p>
                    </div>
                    <div className="rounded-lg border p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="rounded-md bg-amber-500/10 p-1.5">
                          <AlertTriangle className="h-4 w-4 text-amber-400" />
                        </div>
                        <span className="text-sm font-medium">Stage 3 — Severity</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Computes severity (Info → Critical) from confidence scores and
                        attack category. Generates human-readable explanations for SOC
                        analysts.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════
           TAB 4: LEADERBOARD  (carried forward)
           ══════════════════════════════════════════════════════════ */}
        <TabsContent value="leaderboard" className="space-y-4">
          {!leaderboard ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {loading ? (
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                ) : (
                  <p>No leaderboard data available.</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {(["binary", "multiclass"] as const).map((task) => (
                <Card key={task}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <Trophy className="h-4 w-4 text-amber-400" />
                      {task === "binary"
                        ? "Binary Classification"
                        : "Multiclass Classification"}{" "}
                      Leaderboard
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="pb-2 pr-4 font-medium text-muted-foreground">
                              #
                            </th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground">
                              Model
                            </th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">
                              Accuracy
                            </th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">
                              Precision
                            </th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">
                              Recall
                            </th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">
                              F1
                            </th>
                            {task === "binary" && (
                              <th className="pb-2 font-medium text-muted-foreground text-right">
                                AUC-ROC
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {leaderboard[task].map((m, i) => (
                            <tr
                              key={m.name}
                              className={`border-b border-border/50 ${
                                i === 0 ? "bg-amber-500/5" : ""
                              }`}
                            >
                              <td className="py-2.5 pr-4 tabular-nums">
                                {i === 0 ? (
                                  <span className="inline-flex items-center gap-1 text-amber-400 font-semibold">
                                    <Trophy className="h-3 w-3" /> 1
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">{i + 1}</span>
                                )}
                              </td>
                              <td className="py-2.5 pr-4 font-medium">{m.name}</td>
                              <td className="py-2.5 pr-4 text-right tabular-nums text-emerald-400 font-medium">
                                {pct(m.test_accuracy)}
                              </td>
                              <td className="py-2.5 pr-4 text-right tabular-nums">
                                {pct(m.test_precision)}
                              </td>
                              <td className="py-2.5 pr-4 text-right tabular-nums">
                                {pct(m.test_recall)}
                              </td>
                              <td className="py-2.5 pr-4 text-right tabular-nums">
                                {pct(m.test_f1)}
                              </td>
                              {task === "binary" && (
                                <td className="py-2.5 text-right tabular-nums text-blue-400">
                                  {m.auc_roc != null ? pct(m.auc_roc) : "—"}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════
           TAB 5: LIVE CLASSIFY  (carried forward)
           ══════════════════════════════════════════════════════════ */}
        <TabsContent value="classify" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Sample events */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <FlaskConical className="h-4 w-4 text-primary" />
                  Sample Events
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {SAMPLE_EVENTS.filter((s) => s.logType === "network").map((sample, idx) => {
                  const Icon = sample.icon;
                  const realIdx = SAMPLE_EVENTS.indexOf(sample);
                  return (
                    <button
                      key={realIdx}
                      disabled={classifying || !isOnline}
                      onClick={() => runClassify(realIdx)}
                      className={`w-full flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed ${
                        selectedSample === realIdx ? "border-primary bg-accent/30" : ""
                      }`}
                    >
                      <div className="rounded-md bg-muted p-2">
                        <Icon className={`h-4 w-4 ${sample.color}`} />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{sample.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {String(sample.event.protocol_type ?? "").toUpperCase()} ·{" "}
                          {String(sample.event.service ?? "")} · flag={String(sample.event.flag ?? "")} · src_bytes=
                          {String(sample.event.src_bytes ?? 0)}
                        </p>
                      </div>
                      {classifying && selectedSample === realIdx ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Zap className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
                {!isOnline && (
                  <p className="text-xs text-red-400 text-center pt-2">
                    AI service offline — start it to classify events
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Result panel */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Classification Result
                </CardTitle>
              </CardHeader>
              <CardContent>
                {classifyResult ? (
                  <div className="space-y-4">
                    {/* Verdict */}
                    <div
                      className={`rounded-lg border p-4 ${
                        classifyResult.is_attack
                          ? "border-red-500/30 bg-red-500/5"
                          : "border-emerald-500/30 bg-emerald-500/5"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {classifyResult.is_attack ? (
                          <AlertTriangle className="h-5 w-5 text-red-400" />
                        ) : (
                          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                        )}
                        <span className="text-lg font-semibold">
                          {classifyResult.is_attack ? "Attack Detected" : "Benign Traffic"}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {classifyResult.explanation}
                      </p>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border p-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Category
                        </p>
                        <p className="text-sm font-bold mt-1">{classifyResult.category}</p>
                      </div>
                      <div className="rounded-lg border p-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Confidence
                        </p>
                        <p className="text-sm font-bold mt-1 tabular-nums text-emerald-400">
                          {(classifyResult.confidence * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="rounded-lg border p-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Severity
                        </p>
                        <Badge
                          variant={severityVariant(classifyResult.severity)}
                          className="mt-1"
                        >
                          {classifyResult.severity}
                        </Badge>
                      </div>
                    </div>

                    {/* Multiclass probabilities */}
                    {classifyResult.multiclass_probabilities && (
                      <>
                        <Separator />
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                            Class Probabilities
                          </p>
                          <div className="space-y-2">
                            {Object.entries(classifyResult.multiclass_probabilities)
                              .sort(([, a], [, b]) => b - a)
                              .map(([cls, prob]) => (
                                <div key={cls} className="flex items-center gap-2">
                                  <span className="text-xs w-20 truncate">{cls}</span>
                                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-primary transition-all duration-500"
                                      style={{ width: `${prob * 100}%` }}
                                    />
                                  </div>
                                  <span className="text-xs tabular-nums text-muted-foreground w-14 text-right">
                                    {(prob * 100).toFixed(1)}%
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Bot className="h-10 w-10 mb-3 opacity-40" />
                    <p className="text-sm">Select a sample event to classify</p>
                    <p className="text-[10px] mt-1">
                      Results will appear here in real-time
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Classification History */}
          {classificationHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Activity className="h-4 w-4 text-primary" />
                  Classification History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative space-y-3">
                  <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
                  {classificationHistory.map((item, idx) => (
                    <div key={idx} className="relative flex gap-3">
                      <div className="relative z-10 mt-1">
                        <div
                          className={`h-3.5 w-3.5 rounded-full border-2 bg-card ${
                            item.result.is_attack
                              ? "border-red-400"
                              : "border-emerald-400"
                          }`}
                        />
                      </div>
                      <div className="flex-1 flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">
                          {item.label}
                        </Badge>
                        <Badge
                          variant={item.result.is_attack ? "critical" : "low"}
                          className="text-[10px]"
                        >
                          {item.result.category}
                        </Badge>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {(item.result.confidence * 100).toFixed(1)}% confidence
                        </span>
                        <Badge
                          variant={severityVariant(item.result.severity)}
                          className="text-[10px]"
                        >
                          {item.result.severity}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {item.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
