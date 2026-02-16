"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Crosshair,
  RefreshCcw,
  ZoomIn,
  ExternalLink,
  Eye,
  EyeOff,
} from "lucide-react";
import investigationsData from "@/lib/mock/investigations.json";
import type { Investigation } from "@/lib/types";
import { severityLabel } from "@/lib/utils";

const allCases = investigationsData.cases as Investigation[];

/* ── Shared style factories (same as investigation-graph) ── */

function userStyle(): React.CSSProperties {
  return {
    background: "#1e1b4b", color: "#a5b4fc", border: "1px solid #4338ca",
    borderRadius: "50%", width: 90, height: 90, display: "flex",
    alignItems: "center", justifyContent: "center",
    fontSize: "11px", fontWeight: 600, fontFamily: "monospace",
  };
}
function hostStyle(): React.CSSProperties {
  return {
    background: "#0c0a09", color: "#fbbf24", border: "1px solid #f59e0b",
    borderRadius: "8px", padding: "10px",
    fontSize: "12px", fontWeight: 600, fontFamily: "monospace",
  };
}
function critStyle(): React.CSSProperties {
  return {
    background: "#450a0a", color: "#fca5a5", border: "2px solid #ef4444",
    borderRadius: "8px", padding: "12px",
    fontSize: "12px", fontWeight: 700, fontFamily: "monospace",
  };
}
function techStyle(): React.CSSProperties {
  return {
    background: "#0f172a", color: "#93c5fd", border: "1px dashed #3b82f6",
    borderRadius: "8px", padding: "10px",
    fontSize: "10px", fontWeight: 600, fontFamily: "monospace",
    whiteSpace: "pre-line" as const,
  };
}

function edgeBase(color: string, w = 2, animated = true): Partial<Edge> {
  return {
    style: { stroke: color, strokeWidth: w },
    labelStyle: { fill: "#a1a1aa", fontSize: 9 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
    animated,
  };
}
function critEdge(label?: string): Partial<Edge> {
  return {
    ...edgeBase("#ef4444", 3), label,
    labelStyle: { fill: "#ef4444", fontSize: 9, fontWeight: 600 },
  };
}

/* ── Per-investigation graph definitions ── */

interface InvGraph { nodes: Node[]; edges: Edge[] }

/** Tag every node/edge with the investigation they belong to via data.invId */
function tagGraph(invId: string, g: InvGraph): InvGraph {
  return {
    nodes: g.nodes.map((n) => ({ ...n, data: { ...n.data, invId } })),
    edges: g.edges.map((e) => ({ ...e, data: { ...e.data, invId } })),
  };
}

const KNOWN: Record<string, (yOff: number) => InvGraph> = {
  "INV-2026-001": (y) => ({
    nodes: [
      { id: "u4521", type: "default", data: { label: "U4521@DOM2" }, position: { x: 50, y: y + 0 }, style: userStyle() },
      { id: "c102", type: "default", data: { label: "C102" }, position: { x: 230, y: y + 0 }, style: hostStyle() },
      { id: "c4501", type: "default", data: { label: "C4501" }, position: { x: 410, y: y - 60 }, style: hostStyle() },
      { id: "c892", type: "default", data: { label: "C892" }, position: { x: 590, y: y + 0 }, style: hostStyle() },
      { id: "dc01", type: "default", data: { label: "DC01" }, position: { x: 770, y: y + 0 }, style: critStyle() },
    ],
    edges: [
      { id: "e1-1", source: "u4521", target: "c102", label: "Kerberos Auth", ...edgeBase("#f59e0b") } as Edge,
      { id: "e1-2", source: "c102", target: "c4501", label: "Interactive", ...edgeBase("#f59e0b") } as Edge,
      { id: "e1-3", source: "c4501", target: "c892", label: "NTLM/Network", ...edgeBase("#f59e0b") } as Edge,
      { id: "e1-4", source: "c892", target: "dc01", ...critEdge("Kerberos/TGS") } as Edge,
    ],
  }),
  "INV-2026-002": (y) => ({
    nodes: [
      { id: "u8921", type: "default", data: { label: "U8921@DOM1" }, position: { x: 50, y: y + 0 }, style: userStyle() },
      { id: "c3847", type: "default", data: { label: "C3847" }, position: { x: 280, y: y + 0 }, style: hostStyle() },
      { id: "ps-chain", type: "default", data: { label: "svchost→cmd→ps\n-EncodedCommand" }, position: { x: 500, y: y + 0 }, style: critStyle() },
    ],
    edges: [
      { id: "e2-1", source: "u8921", target: "c3847", label: "Session", ...edgeBase("#f59e0b") } as Edge,
      { id: "e2-2", source: "c3847", target: "ps-chain", ...critEdge("Execution") } as Edge,
    ],
  }),
  "INV-2026-003": (y) => ({
    nodes: [
      { id: "u3102", type: "default", data: { label: "U3102@DOM3" }, position: { x: 50, y: y + 0 }, style: userStyle() },
      { id: "c1923", type: "default", data: { label: "C1923" }, position: { x: 280, y: y + 0 }, style: hostStyle() },
      { id: "dns-c2", type: "default", data: { label: "malware-c2\n.darkops.cc" }, position: { x: 560, y: y + 0 }, style: critStyle() },
    ],
    edges: [
      { id: "e3-1", source: "u3102", target: "c1923", label: "Session", ...edgeBase("#4338ca") } as Edge,
      { id: "e3-2", source: "c1923", target: "dns-c2", ...critEdge("DNS Tunnel 2400+") } as Edge,
    ],
  }),
  "INV-2026-004": (y) => ({
    nodes: [
      { id: "u1205", type: "default", data: { label: "U1205@DOM1" }, position: { x: 50, y: y + 0 }, style: userStyle() },
      { id: "c587", type: "default", data: { label: "C587" }, position: { x: 280, y: y + 0 }, style: hostStyle() },
      { id: "mimikatz", type: "default", data: { label: "mimikatz→lsass" }, position: { x: 520, y: y + 0 }, style: critStyle() },
    ],
    edges: [
      { id: "e4-1", source: "u1205", target: "c587", label: "Session", ...edgeBase("#f59e0b") } as Edge,
      { id: "e4-2", source: "c587", target: "mimikatz", ...critEdge("Credential Dump") } as Edge,
    ],
  }),
  "INV-2026-005": (y) => ({
    nodes: [
      { id: "attacker-5", type: "default", data: { label: "Attacker" }, position: { x: 50, y: y + 0 }, style: critStyle() },
      { id: "c9234", type: "default", data: { label: "C9234" }, position: { x: 280, y: y + 0 }, style: hostStyle() },
      { id: "targets-5", type: "default", data: { label: "15 Accounts\n1842 Failures" }, position: { x: 520, y: y + 0 }, style: techStyle() },
    ],
    edges: [
      { id: "e5-1", source: "attacker-5", target: "c9234", ...critEdge("Password Spray") } as Edge,
      { id: "e5-2", source: "c9234", target: "targets-5", label: "NTLM Auth", ...edgeBase("#f59e0b", 2, false) } as Edge,
    ],
  }),
  "INV-2026-006": (y) => ({
    nodes: [
      { id: "u7823", type: "default", data: { label: "U7823@DOM2" }, position: { x: 50, y: y + 0 }, style: userStyle() },
      { id: "c4102", type: "default", data: { label: "C4102" }, position: { x: 280, y: y + 0 }, style: hostStyle() },
      { id: "sched-task", type: "default", data: { label: "SchedTask\nsvc.exe" }, position: { x: 520, y: y + 0 }, style: critStyle() },
    ],
    edges: [
      { id: "e6-1", source: "u7823", target: "c4102", label: "Session", ...edgeBase("#f59e0b") } as Edge,
      { id: "e6-2", source: "c4102", target: "sched-task", ...critEdge("Persistence") } as Edge,
    ],
  }),
  "INV-2026-007": (y) => ({
    nodes: [
      { id: "u5431", type: "default", data: { label: "U5431@DOM1" }, position: { x: 50, y: y + 0 }, style: userStyle() },
      { id: "c2891", type: "default", data: { label: "C2891" }, position: { x: 280, y: y + 0 }, style: hostStyle() },
      { id: "nmap-7", type: "default", data: { label: "nmap → 3200 IPs" }, position: { x: 520, y: y + 0 }, style: critStyle() },
    ],
    edges: [
      { id: "e7-1", source: "u5431", target: "c2891", label: "Session", ...edgeBase("#f59e0b") } as Edge,
      { id: "e7-2", source: "c2891", target: "nmap-7", ...critEdge("Port 445 Scan") } as Edge,
    ],
  }),
  "INV-2026-008": (y) => ({
    nodes: [
      { id: "system-8", type: "default", data: { label: "SYSTEM" }, position: { x: 50, y: y + 0 }, style: userStyle() },
      { id: "c6721", type: "default", data: { label: "C6721" }, position: { x: 280, y: y + 0 }, style: hostStyle() },
      { id: "recon-8", type: "default", data: { label: "cmd→whoami" }, position: { x: 520, y: y + 0 }, style: techStyle() },
    ],
    edges: [
      { id: "e8-1", source: "system-8", target: "c6721", ...critEdge("Interactive Logon") } as Edge,
      { id: "e8-2", source: "c6721", target: "recon-8", label: "Recon", ...edgeBase("#f59e0b", 2, false) } as Edge,
    ],
  }),
};

/** Generate a simple fallback graph for unknown investigation IDs */
function fallbackGraph(inv: Investigation, y: number): InvGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  inv.users.forEach((u, i) => {
    nodes.push({ id: `${inv.id}-u${i}`, type: "default", data: { label: u }, position: { x: 50, y: y + i * 110 }, style: userStyle() });
    if (inv.hosts.length > 0) edges.push({ id: `${inv.id}-eu${i}`, source: `${inv.id}-u${i}`, target: `${inv.id}-h0`, label: "Session", ...edgeBase("#f59e0b") } as Edge);
  });
  inv.hosts.forEach((h, i) => {
    const isCrit = /dc|c2|malware/i.test(h);
    nodes.push({ id: `${inv.id}-h${i}`, type: "default", data: { label: h }, position: { x: 280 + i * 200, y: y + (i % 2 === 0 ? 0 : -60) }, style: isCrit ? critStyle() : hostStyle() });
    if (i > 0) edges.push({ id: `${inv.id}-eh${i}`, source: `${inv.id}-h${i - 1}`, target: `${inv.id}-h${i}`, label: "Lateral", ...edgeBase("#f59e0b") } as Edge);
  });
  return { nodes, edges };
}

/* ── Build combined graph from all investigations ── */

function buildCombinedGraph(cases: Investigation[], visible: Set<string>) {
  const allNodes: Node[] = [];
  const allEdges: Edge[] = [];
  let yOffset = 0;

  for (const inv of cases) {
    if (!visible.has(inv.id)) continue;
    const builder = KNOWN[inv.id];
    const raw = builder ? builder(yOffset) : fallbackGraph(inv, yOffset);
    const tagged = tagGraph(inv.id, raw);
    allNodes.push(...tagged.nodes);
    allEdges.push(...tagged.edges);
    yOffset += 180;
  }
  return { nodes: allNodes, edges: allEdges };
}

/* ── Legend ── */

const LEGEND = [
  { color: "#4338ca", label: "User / Identity" },
  { color: "#f59e0b", label: "Compromised Host" },
  { color: "#ef4444", label: "Critical Target / C2" },
  { color: "#3b82f6", label: "MITRE Technique" },
];

const SEV_VARIANT: Record<number, "critical" | "high" | "medium" | "low" | "info"> = {
  4: "critical", 3: "high", 2: "medium", 1: "low", 0: "info",
};

/* ── FitView button ── */

function FitViewButton() {
  const { fitView } = useReactFlow();
  return (
    <Button variant="outline" size="sm" className="gap-1" onClick={() => fitView({ padding: 0.12 })}>
      <ZoomIn className="h-3.5 w-3.5" /> Fit View
    </Button>
  );
}

/* ── Main graph inner component ── */

function AttackGraphInner() {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(allCases.map((c) => c.id)));
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const { nodes: initNodes, edges: initEdges } = useMemo(
    () => buildCombinedGraph(allCases, visible),
    [visible],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  // Sync when visibility filter changes
  const prevVisibleRef = useMemo(() => ({ current: visible }), []); // track for reference
  useMemo(() => {
    setNodes(initNodes);
    setEdges(initEdges);
    setSelectedNode(null);
  }, [initNodes, initEdges, setNodes, setEdges]);

  const toggleInv = useCallback((id: string) => {
    setVisible((prev) => {
      const next = new Set(Array.from(prev));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const showAll = useCallback(() => {
    setVisible(new Set(allCases.map((c) => c.id)));
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const resetView = useCallback(() => {
    setNodes(initNodes);
    setEdges(initEdges);
    setSelectedNode(null);
  }, [initNodes, initEdges, setNodes, setEdges]);

  const selectedInvId = selectedNode?.data?.invId as string | undefined;
  const selectedInv = selectedInvId ? allCases.find((c) => c.id === selectedInvId) : undefined;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Attack Graph — Overview</h1>
          <p className="text-sm text-muted-foreground">
            Combined attack paths across {visible.size} of {allCases.length} investigations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={showAll}>
            Show All
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={resetView}>
            <RefreshCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <FitViewButton />
        </div>
      </div>

      {/* Investigation Toggle Bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
            Investigations:
          </span>
          {allCases.map((inv) => {
            const isOn = visible.has(inv.id);
            return (
              <Button
                key={inv.id}
                variant={isOn ? "secondary" : "ghost"}
                size="sm"
                className={`gap-1.5 h-7 text-[11px] ${!isOn ? "opacity-40" : ""}`}
                onClick={() => toggleInv(inv.id)}
              >
                {isOn ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                <Badge variant={SEV_VARIANT[inv.severity] ?? "info"} className="text-[9px] px-1 py-0">
                  {severityLabel(inv.severity)}
                </Badge>
                {inv.id}
              </Button>
            );
          })}
        </CardContent>
      </Card>

      {/* Graph Canvas */}
      <Card className="overflow-hidden">
        <div className="h-[calc(100vh-310px)]">
          {nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No investigations selected — toggle at least one above
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              fitView
              fitViewOptions={{ padding: 0.12 }}
              proOptions={{ hideAttribution: true }}
              style={{ background: "hsl(0 0% 3.9%)" }}
            >
              <Background color="hsl(0 0% 12%)" gap={20} size={1} />
              <Controls
                style={{
                  background: "hsl(0 0% 6%)",
                  border: "1px solid hsl(0 0% 14%)",
                  borderRadius: "8px",
                }}
              />
              <MiniMap
                style={{
                  background: "hsl(0 0% 6%)",
                  border: "1px solid hsl(0 0% 14%)",
                  borderRadius: "8px",
                }}
                nodeColor={(node) => {
                  const border = (node.style?.border as string) ?? "";
                  if (border.includes("#ef4444")) return "#ef4444";
                  if (border.includes("#f59e0b")) return "#f59e0b";
                  if (border.includes("#4338ca")) return "#4338ca";
                  if (border.includes("#3b82f6")) return "#3b82f6";
                  return "#64748b";
                }}
                maskColor="rgba(0,0,0,0.7)"
              />

              {/* Legend */}
              <Panel position="top-left">
                <div className="rounded-md border bg-card/90 p-3 backdrop-blur-sm">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Legend
                  </p>
                  <div className="space-y-1.5">
                    {LEGEND.map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: item.color }} />
                        <span className="text-[11px]">{item.label}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <div className="h-px w-3 bg-foreground" style={{ borderBottom: "2px dashed #f59e0b" }} />
                      <span className="text-[11px]">Animated = Active path</span>
                    </div>
                  </div>
                </div>
              </Panel>

              {/* Visible Investigations */}
              <Panel position="top-right">
                <div className="rounded-md border bg-card/90 p-3 backdrop-blur-sm max-w-[200px]">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Showing
                  </p>
                  <div className="space-y-1">
                    {allCases.filter((c) => visible.has(c.id)).map((inv) => (
                      <Link key={inv.id} href={`/investigations/${inv.id}`}>
                        <Badge
                          variant={SEV_VARIANT[inv.severity] ?? "info"}
                          className="text-[9px] cursor-pointer hover:opacity-80 transition-opacity"
                        >
                          {inv.id}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              </Panel>
            </ReactFlow>
          )}
        </div>
      </Card>

      {/* Selected Node Details */}
      {selectedNode && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-medium">
              <span className="flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-primary" />
                Node Details — {String(selectedNode.data?.label ?? selectedNode.id).replace(/\n/g, " ")}
              </span>
              {selectedInv && (
                <Link href={`/investigations/${selectedInv.id}`}>
                  <Button variant="outline" size="sm" className="gap-1 h-7 text-xs">
                    <ExternalLink className="h-3 w-3" />
                    Open {selectedInv.id}
                  </Button>
                </Link>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Node ID</p>
              <p className="font-mono text-sm">{selectedNode.id}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Label</p>
              <p className="text-sm">{String(selectedNode.data?.label ?? "—").replace(/\n/g, " ")}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Investigation</p>
              <p className="text-sm font-mono">{selectedInvId ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Connections</p>
              <p className="text-sm tabular-nums">
                {edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id).length} edges
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function AttackGraphPage() {
  return (
    <ReactFlowProvider>
      <AttackGraphInner />
    </ReactFlowProvider>
  );
}