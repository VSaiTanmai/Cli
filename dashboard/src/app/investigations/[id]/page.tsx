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
    <div className="-m-6 -mt-4">
      {/* ═══ TITLE & HERO AREA ═══ */}
      <div className="bg-card border-b border-border">
        <div className="px-10 py-12 max-w-[1600px] w-full mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 bg-red-50 text-red-600 text-[11px] font-black uppercase tracking-tighter rounded">Critical Severity</span>
                <span className="text-muted-foreground text-sm font-medium">#{id}</span>
              </div>
              <h1 className="text-4xl lg:text-5xl font-extrabold text-foreground tracking-tight max-w-4xl leading-[1.1]">
                Lateral Movement <span className="text-primary inline-block">U4521@DOM2</span> to Domain Controller
              </h1>
              <div className="flex flex-wrap items-center gap-8 text-sm text-muted-foreground">
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
            <div className="flex flex-col items-end gap-4 shrink-0">
              <div className="flex gap-3">
                <div className="px-5 py-2.5 bg-muted/50 border border-border rounded-2xl flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-orange-500" />
                  <span className="text-sm font-bold text-foreground">SUSPICIOUS SIGNAL</span>
                </div>
                <div className="px-5 py-2.5 bg-primary text-primary-foreground rounded-2xl flex items-center gap-3">
                  <span className="text-sm font-bold">0.9% Confidence</span>
                </div>
              </div>
              <div className="flex gap-2">
                {["T1021", "kerberos", "dc-intel"].map((tag) => (
                  <span key={tag} className="px-2.5 py-1 bg-muted/50 text-muted-foreground rounded text-[10px] font-bold uppercase">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ MAIN 12-COL GRID ═══ */}
      <div className="grid grid-cols-12">
        {/* LEFT COLUMN (Content) */}
        <div className="col-span-12 xl:col-span-8 flex flex-col">

          {/* ── Narrative Section: White Background ── */}
          <section className="px-10 pt-20 pb-28 bg-card flex-1">
            <div>
              <div className="flex items-center gap-4 mb-10">
                <div className="p-3 bg-primary/10 text-primary rounded-2xl">
                  <FileText className="w-5 h-5" />
                </div>
                <h3 className="text-2xl font-extrabold text-foreground">Incident Narrative</h3>
              </div>
              <div className="bg-muted/30 rounded-[2.5rem] p-12 transition-all hover:bg-muted/50">
                <div className="space-y-8">
                  <p className="text-xl leading-relaxed text-muted-foreground">
                    At <span className="text-foreground font-semibold">14:32 UTC on February 10</span>, a significant Kerberos ticket anomaly was detected originating from segment <span className="bg-primary/10 px-2 py-0.5 rounded text-primary font-bold italic">DOM2</span>. The initial signal triggered on an unusual Service Ticket request for the Domain Controller (DC01), utilizing a non-standard encryption type (RC4-HMAC) which had been previously deprecated in this environment.
                  </p>
                  <p className="text-lg text-muted-foreground">
                    Detailed path analysis revealed a sophisticated <span className="text-foreground font-semibold italic">3-hop lateral movement pattern</span>. The threat actor initiated the sequence from workstation <span className="text-primary font-bold underline decoration-primary/20">C102</span>, jumped to the administrative jump-box <span className="text-primary font-bold underline decoration-primary/20">C4501</span>, and subsequently moved to <span className="text-primary font-bold underline decoration-primary/20">C892</span> before attempting final authentication against <span className="text-primary font-bold">DC01</span>.
                  </p>

                  {/* EDR Telemetry Block */}
                  <div className="p-8 bg-slate-900 rounded-[2rem] shadow-xl">
                    <div className="flex items-center gap-3 mb-4 text-slate-400 text-xs font-bold uppercase tracking-widest">
                      <Database className="w-4 h-4" />
                      EDR Telemetry Signal
                    </div>
                    <p className="text-slate-300 font-mono text-sm leading-relaxed">
                      Execution of <code className="text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded">mstsc.exe</code> with an injected DLL module. Process correlated exactly with the Kerberos authentication spike, suggesting coordinated session hijacking.
                    </p>
                  </div>

                  <p className="text-lg text-muted-foreground">
                    Impact assessment indicates the compromised account <span className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg font-bold">U4521@DOM2</span> holds delegated administrative privileges. All sessions force-terminated pending remediation.
                  </p>
                </div>

                {/* Footer with entities & model info */}
                <div className="mt-12 pt-10 border-t border-border flex items-center justify-between flex-wrap gap-4">
                  <div className="flex gap-3">
                    {["C102", "C4501", "C892"].map((e) => (
                      <span key={e} className="px-4 py-2 bg-card rounded-xl text-xs font-bold text-muted-foreground uppercase tracking-tight">
                        {e}
                      </span>
                    ))}
                    <span className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold uppercase tracking-tight">
                      U4521@DOM2
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-bold text-muted-foreground italic">
                      <Fingerprint className="w-3 h-3 inline mr-1" />xgboost-binar-v4-0219
                    </span>
                    <button onClick={handleCopyId} className="p-2 text-muted-foreground hover:text-primary transition-colors">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Attack Graph (inside left column) ── */}
          <section className="px-10 py-12 bg-card border-t border-border">
            <div className="flex items-center justify-between mb-6 px-2">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                  <Network className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-2xl font-extrabold text-foreground">Relational Attack Graph</h3>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Topology Analysis &middot; {nodes.length} Nodes &middot; Live Feed</p>
                </div>
              </div>
              <div className="flex gap-6">
                {[
                  { label: "Alert", color: "bg-red-500" },
                  { label: "Host", color: "bg-blue-500" },
                  { label: "User", color: "bg-indigo-600" },
                  { label: "Tech", color: "bg-amber-500" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${item.color}`} />
                    <span className="text-[10px] font-black text-muted-foreground uppercase">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="h-[500px] relative bg-card/60 rounded-[2.5rem] overflow-hidden border border-border/50">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                fitView
                className="bg-transparent"
              >
                <Background color="hsl(var(--border))" gap={16} size={0.5} />
                <Controls className="[&>button]:bg-card [&>button]:border-border [&>button]:text-foreground [&>button]:rounded-xl" />
                <MiniMap
                  nodeColor={(n) => {
                    const gn = graphNodeData.find((gd) => gd.id === n.id);
                    return NODE_COLORS[gn?.type || ""] || "#64748b";
                  }}
                  className="rounded-2xl border border-border bg-card/80 backdrop-blur-md"
                  style={{ width: 120, height: 80 }}
                />
              </ReactFlow>

              {/* Selected Node Detail Overlay */}
              {selectedNode && (
                <div className="absolute bottom-6 left-6 right-6 bg-card/80 backdrop-blur-md rounded-2xl p-4 shadow-sm border border-border flex items-start gap-4">
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
            </div>
          </section>

        </div>

        {/* RIGHT COLUMN (AI Sidebar) */}
        <aside className="col-span-12 xl:col-span-4 bg-card border-l border-border/80 p-8 space-y-10">
          {/* ── AI Insights Section ── */}
          <section>
            <div className="flex items-center justify-between mb-6 px-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-card shadow-sm text-primary rounded-xl flex items-center justify-center border border-border">
                  <Brain className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-extrabold text-foreground">AI Insights</h3>
              </div>
              <div className="px-3 py-1 bg-foreground text-background text-[9px] font-black rounded uppercase tracking-[0.2em]">Agent Trio</div>
            </div>

            <div className="space-y-5">
              {/* ── TRIAGE AGENT ── */}
              <div className="rounded-2xl border border-red-200 overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3.5 bg-red-50">
                  <div className="w-8 h-8 rounded-full bg-white text-red-500 flex items-center justify-center border border-red-200 shadow-sm">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[11px] font-black text-red-900 uppercase tracking-widest">Triage Agent</h4>
                    <p className="text-[10px] font-bold text-red-600/70 uppercase tracking-wide">Initial Classification</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-extrabold text-red-600">94%</div>
                    <div className="text-[8px] font-black text-red-500/70 uppercase">Match</div>
                  </div>
                </div>
                <div className="px-5 py-4 bg-white space-y-3">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Classified alert as <span className="font-bold text-foreground">Lateral Movement</span> with RC4-HMAC Kerberos anomaly flagged</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Identified <span className="font-bold text-foreground">3-hop lateral path</span> across C102 → C4501 → C892 → DC01</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Mapped to <span className="font-bold text-foreground">T1021, T1558</span> MITRE techniques automatically</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-red-100 grid grid-cols-2 gap-3">
                    {[
                      { label: "Anomalous Logic", pct: 82 },
                      { label: "Path Continuity", pct: 45 },
                    ].map((bar) => (
                      <div key={bar.label}>
                        <div className="flex justify-between text-[9px] font-bold text-muted-foreground uppercase mb-1">
                          <span>{bar.label}</span>
                          <span>{bar.pct}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-red-100 rounded-full overflow-hidden">
                          <div className="h-full bg-red-500 rounded-full" style={{ width: `${bar.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="px-2.5 py-1 bg-red-50 text-red-700 text-[9px] font-black rounded uppercase">Verdict: Suspicious</span>
                    <span className="text-[9px] text-muted-foreground italic">14:32:02 UTC</span>
                  </div>
                </div>
              </div>

              {/* ── HUNTER AGENT ── */}
              <div className="rounded-2xl border border-emerald-200 overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3.5 bg-emerald-50">
                  <div className="w-8 h-8 rounded-full bg-white text-emerald-600 flex items-center justify-center border border-emerald-200 shadow-sm">
                    <Search className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[11px] font-black text-emerald-900 uppercase tracking-widest">Hunter Agent</h4>
                    <p className="text-[10px] font-bold text-emerald-600/70 uppercase tracking-wide">Deep Threat Hunting</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-extrabold text-emerald-600">12</div>
                    <div className="text-[8px] font-black text-emerald-500/70 uppercase">IOCs</div>
                  </div>
                </div>
                <div className="px-5 py-4 bg-white space-y-3">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Ran <span className="font-bold text-foreground">6 ClickHouse queries</span> correlating Kerberos tickets with EDR telemetry</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Correlated <span className="font-bold text-foreground">mstsc.exe + inject_x64.dll</span> process chain on C892 with ticket spike</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Traced full <span className="font-bold text-foreground">RDP lateral chain</span> from 10.0.4.102 → jump-box → DC01</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Discovered <span className="font-bold text-foreground">12 IOCs</span> including IPs, hashes, and Sigma rule matches</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-emerald-100 grid grid-cols-3 gap-2 text-center">
                    {[
                      { val: "47", label: "Events" },
                      { val: "6", label: "Queries" },
                      { val: "3", label: "Hosts" },
                    ].map((s) => (
                      <div key={s.label} className="bg-emerald-50 rounded-lg py-2">
                        <div className="text-base font-black text-emerald-700">{s.val}</div>
                        <div className="text-[8px] font-bold text-emerald-600/60 uppercase">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[9px] font-black rounded uppercase">Verdict: Threat Confirmed</span>
                    <span className="text-[9px] text-muted-foreground italic">14:32:18 UTC</span>
                  </div>
                </div>
              </div>

              {/* ── VERIFIER AGENT ── */}
              <div className="rounded-2xl border border-blue-200 overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3.5 bg-blue-50">
                  <div className="w-8 h-8 rounded-full bg-white text-blue-600 flex items-center justify-center border border-blue-200 shadow-sm">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[11px] font-black text-blue-900 uppercase tracking-widest">Verifier Agent</h4>
                    <p className="text-[10px] font-bold text-blue-600/70 uppercase tracking-wide">Evidence Validation</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-extrabold text-blue-600">100%</div>
                    <div className="text-[8px] font-black text-blue-500/70 uppercase">Integrity</div>
                  </div>
                </div>
                <div className="px-5 py-4 bg-white space-y-3">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Validated <span className="font-bold text-foreground">Merkle tree integrity</span> for all 3 evidence batches</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Cross-referenced <span className="font-bold text-foreground">MITRE ATT&CK mappings</span> against known TTP patterns</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Confirmed <span className="font-bold text-foreground">chain-of-custody</span> anchoring to Merkle root <code className="text-[10px] bg-muted/50 px-1 rounded">a3f820...</code></p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">Flagged <span className="font-bold text-foreground">0 tampered records</span> — all event hashes match original ingest</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-blue-100 grid grid-cols-2 gap-2 text-center">
                    {[
                      { val: "3/3", label: "Batches OK" },
                      { val: "0", label: "Tampered" },
                    ].map((s) => (
                      <div key={s.label} className="bg-blue-50 rounded-lg py-2">
                        <div className="text-base font-black text-blue-700">{s.val}</div>
                        <div className="text-[8px] font-bold text-blue-600/60 uppercase">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-[9px] font-black rounded uppercase">Verdict: Evidence Verified</span>
                    <span className="text-[9px] text-muted-foreground italic">14:32:31 UTC</span>
                  </div>
                </div>
              </div>

              {/* ── Final Combined Verdict ── */}
              <div className="rounded-2xl bg-slate-900 p-5 text-center">
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Combined Agent Verdict</div>
                <div className="text-xl font-extrabold text-white mb-1">Suspicious — High Confidence Threat</div>
                <p className="text-[11px] text-slate-400 leading-relaxed">All 3 agents agree: lateral movement confirmed with verified evidence chain. Recommended action: <span className="text-white font-bold">Escalate & Contain</span>.</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCopyId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-card border border-border rounded-2xl text-sm font-semibold hover:bg-accent transition-colors shadow-sm"
              >
                {copySuccess ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                {copySuccess ? "Copied!" : "Copy ID"}
              </button>
              <button
                onClick={handleDownloadReport}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-card border border-border rounded-2xl text-sm font-semibold hover:bg-accent transition-colors shadow-sm"
              >
                <Download className="w-4 h-4" /> Report
              </button>
            </div>
            <button
              onClick={handleRerunPipeline}
              disabled={pipelineRunning}
              className={`w-full mt-3 flex items-center justify-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold transition-all shadow-lg ${
                pipelineRunning
                  ? "bg-primary/60 text-primary-foreground cursor-wait shadow-primary/20"
                  : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20"
              }`}
            >
              {pipelineRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {pipelineRunning ? "Running..." : "Re-run Analysis"}
            </button>
          </section>

          {/* ── Merkle Integrity Section ── */}
          <section>
            <div className="flex items-center gap-3 mb-6 px-2">
              <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-foreground">Merkle Integrity</h3>
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Chain Validated</p>
              </div>
            </div>

            <div className="space-y-5">
              {/* Terminal validation log */}
              <div className={`bg-slate-900 rounded-2xl p-5 font-mono text-xs space-y-2 text-emerald-400/80 shadow-xl transition-all ${verifying ? "animate-pulse" : ""}`}>
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

              {/* Hash displays */}
              <div className="space-y-4">
                <div>
                  <span className="text-[9px] font-black text-muted-foreground uppercase block mb-1.5 px-1">Root Hash</span>
                  <div className="bg-card border border-border/50 rounded-xl p-3 font-mono text-[11px] text-muted-foreground truncate shadow-sm">a3f820265691079d9e6022e3391d84f2b96e6d1912f</div>
                </div>
                <div>
                  <span className="text-[9px] font-black text-muted-foreground uppercase block mb-1.5 px-1">Leaf (E7D2)</span>
                  <div className="bg-card border border-border/50 rounded-xl p-3 font-mono text-[11px] text-muted-foreground truncate shadow-sm">e7d22ff1b07849e6022e3391d84f2b96e6d1912fc02</div>
                </div>
              </div>

              <button
                onClick={handleVerifyAll}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 rounded-2xl text-xs font-bold hover:bg-emerald-500/20 transition-colors"
              >
                {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                {verifying ? "Verifying..." : "Verify All Entries"}
              </button>
            </div>
          </section>
        </aside>
      </div>

      {/* ═══ FULL-WIDTH EVIDENCE SECTION ═══ */}
      <section className="px-10 py-16 bg-card border-t border-border">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-[1600px] mx-auto">
          {/* MITRE Mapping */}
          <div>
            <div className="flex items-center justify-between mb-8 px-2">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-muted text-muted-foreground rounded-2xl">
                  <Grid3X3 className="w-5 h-5" />
                </div>
                <h3 className="text-2xl font-extrabold text-foreground">MITRE Mapping</h3>
              </div>
              <button className="text-[11px] font-black text-primary uppercase tracking-widest hover:underline">View Matrix</button>
            </div>
            <div className="bg-muted/20 rounded-2xl overflow-hidden border border-border">
              <table className="w-full text-left">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-6 py-5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">ID</th>
                    <th className="px-6 py-5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Technique</th>
                    <th className="px-6 py-5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Severity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  <tr className="hover:bg-card transition-colors">
                    <td className="px-6 py-6 text-sm font-mono font-bold text-primary">T1021</td>
                    <td className="px-6 py-6">
                      <div className="text-base font-bold text-foreground">Remote Services</div>
                      <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Lateral Movement</div>
                    </td>
                    <td className="px-6 py-6">
                      <span className="px-3 py-1 bg-red-50 text-red-600 text-[10px] font-black rounded uppercase">Critical</span>
                    </td>
                  </tr>
                  <tr className="hover:bg-card transition-colors">
                    <td className="px-6 py-6 text-sm font-mono font-bold text-primary">T1558</td>
                    <td className="px-6 py-6">
                      <div className="text-base font-bold text-foreground">Steal/Forge Tickets</div>
                      <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Credential Access</div>
                    </td>
                    <td className="px-6 py-6">
                      <span className="px-3 py-1 bg-orange-50 text-orange-600 text-[10px] font-black rounded uppercase">High</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Raw Logs */}
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-8 px-2">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-slate-900 text-white rounded-2xl">
                  <Database className="w-5 h-5" />
                </div>
                <h3 className="text-2xl font-extrabold text-foreground">Raw Logs</h3>
              </div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{logEntries.length} Records</span>
            </div>
            <div className="bg-muted/20 rounded-2xl p-6 space-y-4 flex-1 border border-border">
              {logEntries.map((log, index) => (
                <div key={index} className={`bg-card rounded-xl shadow-sm overflow-hidden group border border-border/50 transition-all ${expandedLogs[index] ? "" : "hover:bg-card"}`}>
                  <button
                    onClick={() => toggleLog(index)}
                    className="w-full px-5 py-3.5 flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-lg ${log.sourceBg} ${log.sourceColor} flex items-center justify-center text-[10px] font-bold`}>
                        {index === 0 ? "ID" : index === 1 ? "ED" : "SG"}
                      </span>
                      <span className="text-xs font-bold text-foreground italic text-left line-clamp-1">{log.title}</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0 ml-2">{log.time}</span>
                  </button>
                  {expandedLogs[index] && (
                    <div className="px-5 py-5 bg-[#0f172a]">
                      <pre className="text-[10px] font-mono text-blue-300 leading-relaxed whitespace-pre-wrap">{log.detail}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
