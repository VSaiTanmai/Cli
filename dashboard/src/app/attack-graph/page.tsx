"use client";

import { useCallback, useMemo, useState } from "react";
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
  Network,
  Monitor,
  User,
  Shield,
  Crosshair,
  RefreshCcw,
  ZoomIn,
} from "lucide-react";

/* ── Mock attack graph data ──
   Represents the lateral movement chain from INV-2026-001:
   U4521@DOM2 → C102 → C4501 → C892 → DC01
   + DNS tunneling from INV-2026-003: C1923 → malware-c2.darkops.cc
*/

const INITIAL_NODES: Node[] = [
  // Investigation 1: Lateral Movement
  {
    id: "u4521",
    type: "default",
    data: { label: "U4521@DOM2" },
    position: { x: 50, y: 200 },
    style: {
      background: "#1e1b4b",
      color: "#a5b4fc",
      border: "1px solid #4338ca",
      borderRadius: "50%",
      width: 90,
      height: 90,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "11px",
      fontWeight: 600,
      fontFamily: "monospace",
    },
  },
  {
    id: "c102",
    type: "default",
    data: { label: "C102" },
    position: { x: 220, y: 200 },
    style: {
      background: "#0c0a09",
      color: "#fbbf24",
      border: "1px solid #f59e0b",
      borderRadius: "8px",
      padding: "10px",
      fontSize: "12px",
      fontWeight: 600,
      fontFamily: "monospace",
    },
  },
  {
    id: "c4501",
    type: "default",
    data: { label: "C4501" },
    position: { x: 400, y: 120 },
    style: {
      background: "#0c0a09",
      color: "#fbbf24",
      border: "1px solid #f59e0b",
      borderRadius: "8px",
      padding: "10px",
      fontSize: "12px",
      fontWeight: 600,
      fontFamily: "monospace",
    },
  },
  {
    id: "c892",
    type: "default",
    data: { label: "C892" },
    position: { x: 580, y: 200 },
    style: {
      background: "#0c0a09",
      color: "#fbbf24",
      border: "1px solid #f59e0b",
      borderRadius: "8px",
      padding: "10px",
      fontSize: "12px",
      fontWeight: 600,
      fontFamily: "monospace",
    },
  },
  {
    id: "dc01",
    type: "default",
    data: { label: "DC01" },
    position: { x: 780, y: 200 },
    style: {
      background: "#450a0a",
      color: "#fca5a5",
      border: "2px solid #ef4444",
      borderRadius: "8px",
      padding: "12px",
      fontSize: "13px",
      fontWeight: 700,
      fontFamily: "monospace",
    },
  },

  // Investigation 3: DNS Tunneling
  {
    id: "u3102",
    type: "default",
    data: { label: "U3102@DOM3" },
    position: { x: 50, y: 450 },
    style: {
      background: "#1e1b4b",
      color: "#a5b4fc",
      border: "1px solid #4338ca",
      borderRadius: "50%",
      width: 90,
      height: 90,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "11px",
      fontWeight: 600,
      fontFamily: "monospace",
    },
  },
  {
    id: "c1923",
    type: "default",
    data: { label: "C1923" },
    position: { x: 220, y: 450 },
    style: {
      background: "#0c0a09",
      color: "#fbbf24",
      border: "1px solid #f59e0b",
      borderRadius: "8px",
      padding: "10px",
      fontSize: "12px",
      fontWeight: 600,
      fontFamily: "monospace",
    },
  },
  {
    id: "dns-c2",
    type: "default",
    data: { label: "malware-c2.darkops.cc" },
    position: { x: 520, y: 450 },
    style: {
      background: "#450a0a",
      color: "#fca5a5",
      border: "2px solid #ef4444",
      borderRadius: "8px",
      padding: "10px",
      fontSize: "11px",
      fontWeight: 600,
      fontFamily: "monospace",
    },
  },

  // PowerShell chain (INV-2026-002)
  {
    id: "u8921",
    type: "default",
    data: { label: "U8921@DOM1" },
    position: { x: 400, y: 340 },
    style: {
      background: "#1e1b4b",
      color: "#a5b4fc",
      border: "1px solid #4338ca",
      borderRadius: "50%",
      width: 90,
      height: 90,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "11px",
      fontWeight: 600,
      fontFamily: "monospace",
    },
  },
  {
    id: "c3847",
    type: "default",
    data: { label: "C3847\nsvchost→cmd→ps" },
    position: { x: 580, y: 340 },
    style: {
      background: "#0c0a09",
      color: "#f59e0b",
      border: "1px solid #f59e0b",
      borderRadius: "8px",
      padding: "10px",
      fontSize: "10px",
      fontWeight: 600,
      fontFamily: "monospace",
      whiteSpace: "pre-line" as const,
    },
  },
];

const INITIAL_EDGES: Edge[] = [
  // Lateral movement chain
  {
    id: "e-u4521-c102",
    source: "u4521",
    target: "c102",
    label: "Kerberos Auth",
    style: { stroke: "#f59e0b", strokeWidth: 2 },
    labelStyle: { fill: "#a1a1aa", fontSize: 9 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
    animated: true,
  },
  {
    id: "e-c102-c4501",
    source: "c102",
    target: "c4501",
    label: "Interactive",
    style: { stroke: "#f59e0b", strokeWidth: 2 },
    labelStyle: { fill: "#a1a1aa", fontSize: 9 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
    animated: true,
  },
  {
    id: "e-c4501-c892",
    source: "c4501",
    target: "c892",
    label: "NTLM/Network",
    style: { stroke: "#f59e0b", strokeWidth: 2 },
    labelStyle: { fill: "#a1a1aa", fontSize: 9 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
    animated: true,
  },
  {
    id: "e-c892-dc01",
    source: "c892",
    target: "dc01",
    label: "Kerberos/TGS",
    style: { stroke: "#ef4444", strokeWidth: 3 },
    labelStyle: { fill: "#ef4444", fontSize: 10, fontWeight: 600 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#ef4444" },
    animated: true,
  },

  // DNS Tunneling
  {
    id: "e-u3102-c1923",
    source: "u3102",
    target: "c1923",
    label: "Session",
    style: { stroke: "#4338ca", strokeWidth: 2 },
    labelStyle: { fill: "#a1a1aa", fontSize: 9 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#4338ca" },
  },
  {
    id: "e-c1923-dns",
    source: "c1923",
    target: "dns-c2",
    label: "DNS Tunnel\n2400+ queries",
    style: { stroke: "#ef4444", strokeWidth: 3 },
    labelStyle: { fill: "#ef4444", fontSize: 9, fontWeight: 600 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#ef4444" },
    animated: true,
  },

  // PowerShell chain
  {
    id: "e-u8921-c3847",
    source: "u8921",
    target: "c3847",
    label: "Execution",
    style: { stroke: "#f59e0b", strokeWidth: 2 },
    labelStyle: { fill: "#a1a1aa", fontSize: 9 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
  },
];

const LEGEND = [
  { color: "#4338ca", label: "User / Identity" },
  { color: "#f59e0b", label: "Compromised Host" },
  { color: "#ef4444", label: "Critical Target / C2" },
];

function FitViewButton() {
  const { fitView } = useReactFlow();
  return (
    <Button variant="outline" size="sm" className="gap-1" onClick={() => fitView({ padding: 0.15 })}>
      <ZoomIn className="h-3.5 w-3.5" /> Fit View
    </Button>
  );
}

function AttackGraphInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const resetView = useCallback(() => {
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES);
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Attack Graph</h1>
          <p className="text-sm text-muted-foreground">
            Visual attack path analysis — lateral movement, process chains, C2 connections
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={resetView}>
            <RefreshCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <FitViewButton />
        </div>
      </div>

      {/* Graph Canvas */}
      <Card className="overflow-hidden">
        <div className="h-[calc(100vh-220px)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.15 }}
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
                return "#64748b";
              }}
              maskColor="rgba(0,0,0,0.7)"
            />

            {/* Legend Panel */}
            <Panel position="top-left">
              <div className="rounded-md border bg-card/90 p-3 backdrop-blur-sm">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Legend
                </p>
                <div className="space-y-1.5">
                  {LEGEND.map((item) => (
                    <div key={item.label} className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-sm"
                        style={{ backgroundColor: item.color }}
                      />
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

            {/* Investigation Tags */}
            <Panel position="top-right">
              <div className="rounded-md border bg-card/90 p-3 backdrop-blur-sm">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Active Investigations
                </p>
                <div className="space-y-1">
                  <Badge variant="critical" className="text-[10px]">
                    INV-2026-001 — Lateral Movement
                  </Badge>
                  <br />
                  <Badge variant="critical" className="text-[10px]">
                    INV-2026-003 — DNS Tunneling
                  </Badge>
                  <br />
                  <Badge variant="high" className="text-[10px]">
                    INV-2026-002 — PowerShell Chain
                  </Badge>
                </div>
              </div>
            </Panel>
          </ReactFlow>
        </div>
      </Card>

      {/* Selected Node Details */}
      {selectedNode && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Crosshair className="h-4 w-4 text-primary" />
              Node Details — {String(selectedNode.data?.label ?? selectedNode.id)}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Node ID
              </p>
              <p className="font-mono text-sm">{selectedNode.id}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Label
              </p>
              <p className="text-sm">{String(selectedNode.data?.label ?? "—")}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Connections
              </p>
              <p className="text-sm tabular-nums">
                {edges.filter(
                  (e) =>
                    e.source === selectedNode.id || e.target === selectedNode.id
                ).length}{" "}
                edges
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