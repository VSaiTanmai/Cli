"use client";

import React, { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  Calendar,
  User,
  BarChart3,
  AlertTriangle,
  ShieldCheck,
  Copy,
  Check,
  Download,
  Play,
  Loader2,
  FileText,
  Network,
  Grid3X3,
  Brain,
  Lock,
  Database,
  ChevronDown,
  ChevronRight,
  Tag,
  Fingerprint,
  CheckCircle2,
  Search,
  Link2,
  Eye,
  RefreshCw,
  Filter,
} from "lucide-react";

export default function InvestigationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params.id as string) || "INV-2026-001";

  const [expandedLogs, setExpandedLogs] = useState<Record<number, boolean>>({ 0: true });
  const [copySuccess, setCopySuccess] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [selectedNode, setSelectedNode] = useState<{ id: string; label: string; type: string; detail?: string } | null>(null);

  // ──── ATTACK GRAPH DATA ────
  const NODE_COLORS: Record<string, string> = {
    alert: "#ef4444",
    host: "#3b82f6",
    user: "#8b5cf6",
    technique: "#f59e0b",
  };

  const graphNodeData = [
    { id: "alert-1", label: "Kerberos RC4 Anomaly", type: "alert", detail: "Non-standard RC4-HMAC encryption detected on Kerberos ticket request" },
    { id: "host-c102", label: "C102", type: "host", detail: "Source workstation — initial access point" },
    { id: "host-c4501", label: "C4501", type: "host", detail: "Administrative jump-box — hop 2" },
    { id: "host-c892", label: "C892", type: "host", detail: "EDR detected mstsc.exe with injected DLL" },
    { id: "host-dc01", label: "DC01", type: "host", detail: "Domain Controller — final target" },
    { id: "user-u4521", label: "U4521@DOM2", type: "user", detail: "Compromised account with delegated admin privileges" },
    { id: "tech-t1021", label: "T1021 — Remote Services", type: "technique", detail: "Lateral Movement via RDP" },
    { id: "tech-t1558", label: "T1558 — Steal/Forge Tickets", type: "technique", detail: "Kerberos ticket manipulation" },
  ];

  const initialNodes: Node[] = graphNodeData.map((n) => {
    const positions: Record<string, { x: number; y: number }> = {
      "alert-1": { x: 50, y: 180 },
      "host-c102": { x: 250, y: 80 },
      "host-c4501": { x: 450, y: 180 },
      "host-c892": { x: 650, y: 80 },
      "host-dc01": { x: 850, y: 180 },
      "user-u4521": { x: 450, y: 320 },
      "tech-t1021": { x: 250, y: 320 },
      "tech-t1558": { x: 650, y: 320 },
    };
    const color = NODE_COLORS[n.type] || "#64748b";
    return {
      id: n.id,
      position: positions[n.id] || { x: 0, y: 0 },
      data: {
        label: (
          <div className="text-center px-1">
            <div style={{ color, fontSize: 9, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase" as const }}>
              {n.type}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>{n.label}</div>
          </div>
        ),
      },
      style: {
        background: `${color}12`,
        border: `2px solid ${color}`,
        borderRadius: 12,
        padding: "8px 14px",
        boxShadow: `0 4px 12px ${color}20`,
        minWidth: 100,
        cursor: "pointer",
      },
    };
  });

  const initialEdges: Edge[] = [
    { id: "e1", source: "alert-1", target: "host-c102", label: "triggered on", animated: true },
    { id: "e2", source: "host-c102", target: "host-c4501", label: "RDP hop 1" },
    { id: "e3", source: "host-c4501", target: "host-c892", label: "RDP hop 2" },
    { id: "e4", source: "host-c892", target: "host-dc01", label: "auth attempt", animated: true },
    { id: "e5", source: "user-u4521", target: "host-c102", label: "logged in" },
    { id: "e6", source: "user-u4521", target: "host-dc01", label: "targeted" },
    { id: "e7", source: "tech-t1021", target: "host-c4501", label: "tactic" },
    { id: "e8", source: "tech-t1558", target: "alert-1", label: "technique" },
  ].map((e) => ({
    ...e,
    style: { stroke: "#94a3b8", strokeWidth: 1.5 },
    labelStyle: { fontSize: 9, fill: "#64748b", fontWeight: 500 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
  }));

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const gn = graphNodeData.find((n) => n.id === node.id);
    setSelectedNode(gn || null);
  }, []);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleRerunPipeline = () => {
    setPipelineRunning(true);
    setTimeout(() => setPipelineRunning(false), 3000);
  };

  const handleVerifyAll = () => {
    setVerifying(true);
    setTimeout(() => setVerifying(false), 2000);
  };

  const handleDownloadReport = () => {
    const reportContent = `Investigation Report: ${id}\n\nTitle: Lateral Movement — U4521@DOM2 to Domain Controller\nSeverity: Critical\nStatus: Suspicious\nConfidence: 0.9%\nAssignee: Nethra\nEvents: 47\n\n--- Narrative ---\nAt 14:32 UTC on February 10, a significant Kerberos ticket anomaly was detected originating from segment DOM2.\n\n--- MITRE ATT&CK ---\nT1021 - Remote Services (Lateral Movement) - Critical\nT1558 - Steal/Forge Tickets (Credential Access) - High\n`;
    const blob = new Blob([reportContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}-report.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleLog = (index: number) => {
    setExpandedLogs((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const logEntries = [
    {
      source: "Windows Security",
      sourceColor: "text-foreground",
      sourceBg: "bg-muted",
      title: "EventID 4769: A Kerberos service ticket was requested.",
      time: "14:32:01.442 UTC",
      detail: `{
  "EventID": 4769,
  "TargetUserName": "U4521@DOM2",
  "ServiceName": "DC01$",
  "TicketEncryptionType": "0x17", // RC4-HMAC
  "IpAddress": "10.0.4.102",
  "Status": "0x0"
}`,
    },
    {
      source: "CrowdStrike EDR",
      sourceColor: "text-blue-600",
      sourceBg: "bg-blue-50",
      title: "Process Creation: mstsc.exe with unusual module load",
      time: "14:32:05.110 UTC",
      detail: `{
  "ProcessName": "mstsc.exe",
  "ParentProcess": "explorer.exe",
  "CommandLine": "mstsc.exe /v:10.0.4.201",
  "LoadedModule": "inject_x64.dll",
  "SHA256": "a1b2c3d4e5f6...",
  "HostName": "C892"
}`,
    },
    {
      source: "Sigma Rule Engine",
      sourceColor: "text-purple-600",
      sourceBg: "bg-purple-50",
      title: "Rule Match: Lateral Movement via Remote Desktop (RDP)",
      time: "14:32:12.891 UTC",
      detail: `{
  "RuleName": "Lateral Movement via RDP",
  "RuleID": "sigma-lat-rdp-001",
  "Severity": "High",
  "MatchedField": "DestinationPort: 3389",
  "SourceIP": "10.0.4.102",
  "DestIP": "10.0.1.10"
}`,
    },
  ];

  return (
    <div className="space-y-10">
      {/* ═══ HERO SECTION ═══ */}
      <section className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.back()}
                className="flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
              >
                Investigations
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-widest text-foreground">{id}</span>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold tracking-tight border border-emerald-100/50">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 animate-pulse" />
                REAL-TIME STREAMING
              </div>
            </div>
            <h1 className="text-3xl lg:text-4xl font-extrabold text-foreground tracking-tight max-w-4xl leading-[1.1]">
              Lateral Movement <span className="text-primary inline-block">U4521@DOM2</span> to Domain Controller
            </h1>
            <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground/60" />
                Detected 27 days ago
              </span>
              <span className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground/60" />
                Assignee: <span className="font-semibold text-foreground">Nethra</span>
              </span>
              <span className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground/60" />
                47 Total Events
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-3 shrink-0">
            <div className="flex gap-2">
              <div className="px-4 py-2 bg-card shadow-sm border border-border rounded-xl flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                <span className="text-sm font-bold text-foreground">SUSPICIOUS SIGNAL</span>
              </div>
              <div className="px-4 py-2 bg-primary text-primary-foreground shadow-sm border border-primary rounded-xl flex items-center gap-3">
                <span className="text-sm font-bold">0.9% Confidence</span>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="px-2.5 py-1 bg-red-50 text-red-600 text-[11px] font-black uppercase tracking-tighter border border-red-100 rounded">Critical Severity</span>
              {["T1021", "kerberos", "dc-intel"].map((tag) => (
                <span key={tag} className="px-2.5 py-1 bg-muted text-muted-foreground rounded text-[10px] font-bold uppercase">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleCopyId}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-xl text-sm font-semibold hover:bg-accent transition-colors shadow-sm"
          >
            {copySuccess ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            {copySuccess ? "Copied!" : "Copy ID"}
          </button>
          <button
            onClick={handleDownloadReport}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-xl text-sm font-semibold hover:bg-accent transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" /> Download Report
          </button>
          <button
            onClick={handleRerunPipeline}
            disabled={pipelineRunning}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all shadow-lg ${
              pipelineRunning
                ? "bg-primary/60 text-primary-foreground cursor-wait shadow-primary/25"
                : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/25"
            }`}
          >
            {pipelineRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {pipelineRunning ? "Running..." : "Re-run Analysis"}
          </button>
        </div>
      </section>

      {/* ═══ MAIN TWO-COLUMN LAYOUT ═══ */}
      <div className="grid grid-cols-12 gap-8">
        {/* LEFT COLUMN */}
        <div className="col-span-12 xl:col-span-8 space-y-8">
          {/* INCIDENT NARRATIVE — Glass Card */}
          <section className="bg-card/80 backdrop-blur-xl rounded-2xl border border-border/80 p-8 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-[100px] -z-10" />
            <div className="flex items-center gap-4 mb-8">
              <div className="p-3 bg-primary rounded-2xl text-primary-foreground shadow-lg shadow-primary/20">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-extrabold text-foreground">Incident Narrative</h3>
            </div>
            <div className="space-y-6 text-base leading-relaxed text-muted-foreground">
              <p className="text-lg">
                At <span className="text-foreground font-semibold">14:32 UTC on February 10</span>, a significant Kerberos ticket anomaly was detected originating from segment <span className="bg-primary/10 px-2 py-0.5 rounded text-primary font-bold italic">DOM2</span>. The initial signal triggered on an unusual Service Ticket request for the Domain Controller (DC01), utilizing a non-standard encryption type (RC4-HMAC) which had been previously deprecated in this environment.
              </p>
              <p>
                Detailed path analysis revealed a sophisticated <span className="text-foreground font-semibold italic">3-hop lateral movement pattern</span>. The threat actor initiated the sequence from workstation <span className="text-primary font-bold underline decoration-primary/20">C102</span>, jumped to the administrative jump-box <span className="text-primary font-bold underline decoration-primary/20">C4501</span>, and subsequently moved to <span className="text-primary font-bold underline decoration-primary/20">C892</span> before attempting final authentication against <span className="text-primary font-bold">DC01</span>.
              </p>

              {/* EDR Telemetry Block */}
              <div className="p-6 bg-slate-900 rounded-2xl border border-slate-800 shadow-inner">
                <div className="flex items-center gap-3 mb-3 text-slate-400 text-xs font-bold uppercase tracking-widest">
                  <Database className="w-4 h-4" />
                  EDR Telemetry Signal
                </div>
                <p className="text-slate-300 font-mono text-sm">
                  Execution of <code className="text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded">mstsc.exe</code> with an injected DLL module. Process correlated exactly with the Kerberos authentication spike, suggesting coordinated session hijacking.
                </p>
              </div>

              <p>
                Impact assessment indicates the compromised account <span className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg font-bold border border-indigo-100">U4521@DOM2</span> holds delegated administrative privileges. All sessions force-terminated pending remediation.
              </p>
            </div>

            {/* Footer with entities & model info */}
            <div className="mt-10 pt-8 border-t border-border flex items-center justify-between flex-wrap gap-4">
              <div className="flex gap-2">
                {["C102", "C4501", "C892"].map((e) => (
                  <span key={e} className="px-4 py-2 bg-muted rounded-xl text-xs font-bold text-muted-foreground uppercase tracking-tight">
                    {e}
                  </span>
                ))}
                <span className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold uppercase tracking-tight shadow-lg shadow-primary/20">
                  U4521@DOM2
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-muted-foreground italic flex items-center gap-1">
                  <Fingerprint className="w-3 h-3" /> xgboost-binar-v4-0219
                </span>
                <button
                  onClick={handleCopyId}
                  className="p-2 text-muted-foreground hover:text-primary transition-colors"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>

          {/* ATTACK GRAPH — Interactive ReactFlow (KEPT SAME) */}
          <section className="bg-card/80 backdrop-blur-xl rounded-2xl border border-border/80 shadow-sm overflow-hidden flex flex-col">
            <div className="px-8 py-6 border-b border-border/60 flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600">
                  <Network className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-foreground">Relational Attack Graph</h3>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Topology Analysis &middot; {nodes.length} Nodes &middot; Live Feed</p>
                </div>
              </div>
              <div className="flex gap-6">
                {[
                  { label: "Alert", color: "bg-red-500" },
                  { label: "Host", color: "bg-blue-500" },
                  { label: "User", color: "bg-purple-500" },
                  { label: "Tech", color: "bg-amber-500" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${item.color} border-2 border-white shadow-sm`} />
                    <span className="text-[10px] font-black text-muted-foreground uppercase">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="h-[500px]">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                fitView
                className="bg-card"
              >
                <Background color="hsl(var(--border))" gap={20} size={1} />
                <Controls className="[&>button]:bg-card [&>button]:border-border [&>button]:text-foreground" />
                <MiniMap
                  nodeColor={(n) => {
                    const gn = graphNodeData.find((gd) => gd.id === n.id);
                    return NODE_COLORS[gn?.type || ""] || "#64748b";
                  }}
                  className="rounded-lg border border-border bg-card"
                  style={{ width: 120, height: 80 }}
                />
              </ReactFlow>
            </div>
            {/* Selected Node Detail */}
            {selectedNode && (
              <div className="p-4 border-t bg-accent/30 flex items-start gap-4">
                <Eye className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-foreground">{selectedNode.label}</span>
                    <span
                      className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                      style={{
                        color: NODE_COLORS[selectedNode.type],
                        background: `${NODE_COLORS[selectedNode.type]}15`,
                        border: `1px solid ${NODE_COLORS[selectedNode.type]}30`,
                      }}
                    >
                      {selectedNode.type}
                    </span>
                  </div>
                  {selectedNode.detail && (
                    <p className="text-[11px] text-muted-foreground mt-1">{selectedNode.detail}</p>
                  )}
                </div>
                <button onClick={() => setSelectedNode(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
              </div>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN — AI Panel */}
        <div className="col-span-12 xl:col-span-4 space-y-8">
          {/* AI INSIGHTS */}
          <section className="bg-card/80 backdrop-blur-xl rounded-2xl border border-border/80 p-8 shadow-sm border-t-4 border-t-primary relative">
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center">
                  <Brain className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-extrabold text-foreground">AI Insights</h3>
              </div>
              <div className="px-2.5 py-1 bg-foreground text-background text-[9px] font-black rounded uppercase tracking-[0.2em]">Agent Trio</div>
            </div>

            {/* Pipeline Visualizer */}
            <div className="flex justify-between items-center mb-12 px-2">
              {["Triage", "Hunter", "Verifier"].map((step, i) => (
                <React.Fragment key={step}>
                  {i > 0 && <div className="flex-1 h-px bg-border mx-4" />}
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center border-2 border-emerald-500 shadow-lg shadow-emerald-500/10">
                      <Check className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-tighter">{step}</span>
                  </div>
                </React.Fragment>
              ))}
            </div>

            <div className="space-y-6">
              {/* Triage Report */}
              <div className="bg-muted/50 rounded-2xl p-6 border border-border/60 transition-transform hover:scale-[1.02] cursor-default">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h4 className="text-[11px] font-black text-muted-foreground uppercase tracking-widest mb-1">Triage Report</h4>
                    <p className="text-sm font-bold text-foreground">Success with High Confidence</p>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-extrabold text-primary">94%</div>
                    <div className="text-[9px] font-black text-primary/70 uppercase">Match Score</div>
                  </div>
                </div>
                <div className="space-y-4">
                  {[
                    { label: "Anomalous Logic", pct: 82 },
                    { label: "Path Continuity", pct: 45 },
                  ].map((bar) => (
                    <div key={bar.label}>
                      <div className="flex justify-between text-[10px] font-bold text-muted-foreground uppercase mb-1.5">
                        <span>{bar.label}</span>
                        <span>{bar.pct}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full shadow-[0_0_8px_rgba(37,99,235,0.4)]" style={{ width: `${bar.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats Cluster */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { val: "47", label: "Events" },
                  { val: "12", label: "IOCs" },
                  { val: "6", label: "Queries" },
                ].map((s) => (
                  <div key={s.label} className="bg-muted/50 p-4 rounded-2xl border border-border text-center">
                    <div className="text-xl font-black text-foreground">{s.val}</div>
                    <div className="text-[9px] font-bold text-muted-foreground uppercase">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Verifier Gauge */}
              <div className="bg-muted/50 rounded-2xl p-6 border border-border/60">
                <h4 className="text-[11px] font-black text-muted-foreground uppercase tracking-widest mb-6 text-center">Final Verification Score</h4>
                <div className="flex justify-around">
                  {[
                    { val: "91%", label: "Integrity", stroke: "#10b981", offset: 15.8 },
                    { val: "100", label: "Trust", stroke: "#3b82f6", offset: 0 },
                  ].map((gauge) => (
                    <div key={gauge.label} className="flex flex-col items-center">
                      <div className="relative w-16 h-16 flex items-center justify-center">
                        <svg className="absolute inset-0 w-full h-full -rotate-90">
                          <circle cx="32" cy="32" r="28" fill="transparent" stroke="hsl(var(--border))" strokeWidth="4" />
                          <circle cx="32" cy="32" r="28" fill="transparent" stroke={gauge.stroke} strokeWidth="4" strokeDasharray="175.9" strokeDashoffset={gauge.offset} />
                        </svg>
                        <span className="text-sm font-black text-foreground">{gauge.val}</span>
                      </div>
                      <span className="text-[8px] font-bold text-muted-foreground mt-2 uppercase">{gauge.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* MERKLE INTEGRITY */}
          <section className="bg-card/80 backdrop-blur-xl rounded-2xl border border-border/80 p-8 shadow-sm overflow-hidden">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-foreground">Merkle Integrity</h3>
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Chain Validated</p>
              </div>
            </div>

            {/* Terminal-style validation log */}
            <div className={`bg-slate-900 rounded-2xl p-4 font-mono text-[10px] space-y-1 text-emerald-400/80 mb-6 border border-slate-800 transition-all ${verifying ? "animate-pulse" : ""}`}>
              <div className="flex items-center">
                <span className="w-6 text-slate-600 font-bold">01</span> Initializing integrity validation ...
              </div>
              <div className="flex items-center">
                <span className="w-6 text-slate-600 font-bold">02</span> Fetching sequence 0x291 ... 0x2FF
              </div>
              <div className="flex items-center text-emerald-400">
                <span className="w-6 text-slate-600 font-bold">03</span> Root Hash: a3f8202656... Verified
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-[9px] font-black text-muted-foreground uppercase block mb-1">Root Hash</span>
                <div className="bg-muted/50 border border-border rounded-lg p-3 font-mono text-[10px] text-muted-foreground truncate">a3f820265691079d9e6022e3391d84f2b96e6d1912f</div>
              </div>
              <div>
                <span className="text-[9px] font-black text-muted-foreground uppercase block mb-1">Leaf (E7D2)</span>
                <div className="bg-muted/50 border border-border rounded-lg p-3 font-mono text-[10px] text-muted-foreground truncate">e7d22ff1b07849e6022e3391d84f2b96e6d1912fc02</div>
              </div>
            </div>

            <button
              onClick={handleVerifyAll}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 rounded-xl text-xs font-bold hover:bg-emerald-500/20 transition-colors"
            >
              {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              {verifying ? "Verifying..." : "Verify All Entries"}
            </button>
          </section>
        </div>
      </div>

      {/* ═══ SUPPORTING EVIDENCE BOTTOM AREA ═══ */}
      <div className="grid grid-cols-12 gap-8">
        {/* MITRE ATT&CK MAPPING */}
        <div className="col-span-12 xl:col-span-6">
          <section className="bg-card/80 backdrop-blur-xl rounded-2xl border border-border/80 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-muted rounded-xl text-muted-foreground">
                  <Grid3X3 className="w-5 h-5" />
                </div>
                <h3 className="font-extrabold text-foreground">MITRE Mapping</h3>
              </div>
              <button className="text-[11px] font-black text-primary uppercase tracking-widest hover:underline">View Matrix</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-8 py-4 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">ID</th>
                    <th className="px-8 py-4 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">Technique</th>
                    <th className="px-8 py-4 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">Severity</th>
                    <th className="px-8 py-4 text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">Signal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="hover:bg-primary/5 transition-colors">
                    <td className="px-8 py-5 text-sm font-mono font-bold text-primary">T1021</td>
                    <td className="px-8 py-5">
                      <div className="text-sm font-bold text-foreground">Remote Services</div>
                      <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Lateral Movement</div>
                    </td>
                    <td className="px-8 py-5">
                      <span className="px-2.5 py-1 bg-red-100 text-red-700 text-[10px] font-black rounded uppercase">Critical</span>
                    </td>
                    <td className="px-8 py-5 text-xs font-semibold text-muted-foreground">23 Net Events</td>
                  </tr>
                  <tr className="hover:bg-primary/5 transition-colors">
                    <td className="px-8 py-5 text-sm font-mono font-bold text-primary">T1558</td>
                    <td className="px-8 py-5">
                      <div className="text-sm font-bold text-foreground">Steal/Forge Tickets</div>
                      <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Credential Access</div>
                    </td>
                    <td className="px-8 py-5">
                      <span className="px-2.5 py-1 bg-orange-100 text-orange-700 text-[10px] font-black rounded uppercase">High</span>
                    </td>
                    <td className="px-8 py-5 text-xs font-semibold text-muted-foreground">Anomaly Signal</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* RAW EVIDENCE LOGS */}
        <div className="col-span-12 xl:col-span-6">
          <section className="bg-card/80 backdrop-blur-xl rounded-2xl border border-border/80 shadow-sm overflow-hidden h-full flex flex-col">
            <div className="px-8 py-6 border-b border-border flex items-center justify-between bg-card">
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-foreground rounded-xl text-background">
                  <Database className="w-5 h-5" />
                </div>
                <h3 className="font-extrabold text-foreground">Raw Evidence Logs</h3>
              </div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{logEntries.length} Primary Records</span>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[400px]">
              {logEntries.map((log, index) => (
                <div key={index} className="rounded-2xl border border-border shadow-sm overflow-hidden transition-all hover:border-primary/40 group">
                  <button
                    onClick={() => toggleLog(index)}
                    className="w-full p-4 bg-muted/30 flex items-center justify-between cursor-pointer group-hover:bg-card transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-lg ${log.sourceBg} ${log.sourceColor} flex items-center justify-center text-xs font-bold`}>
                        {index === 0 ? "ID" : index === 1 ? "ED" : "SG"}
                      </span>
                      <span className="text-xs font-bold text-foreground italic text-left">{log.title}</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0 ml-2">{log.time}</span>
                  </button>
                  {expandedLogs[index] && (
                    <div className="p-4 bg-[#0f172a] overflow-x-auto animate-in fade-in duration-200">
                      <pre className="text-[11px] font-mono text-blue-300 leading-relaxed whitespace-pre-wrap">
                        {log.detail}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
