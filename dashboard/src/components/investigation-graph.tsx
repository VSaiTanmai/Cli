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
import { Crosshair, ZoomIn, RefreshCcw } from "lucide-react";
import type { Investigation } from "@/lib/types";

/* ── Style factories ── */

function userNodeStyle(): React.CSSProperties {
  return {
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
  };
}

function hostNodeStyle(): React.CSSProperties {
  return {
    background: "#0c0a09",
    color: "#fbbf24",
    border: "1px solid #f59e0b",
    borderRadius: "8px",
    padding: "10px",
    fontSize: "12px",
    fontWeight: 600,
    fontFamily: "monospace",
  };
}

function criticalNodeStyle(): React.CSSProperties {
  return {
    background: "#450a0a",
    color: "#fca5a5",
    border: "2px solid #ef4444",
    borderRadius: "8px",
    padding: "12px",
    fontSize: "12px",
    fontWeight: 700,
    fontFamily: "monospace",
  };
}

function techniqueNodeStyle(): React.CSSProperties {
  return {
    background: "#0f172a",
    color: "#93c5fd",
    border: "1px dashed #3b82f6",
    borderRadius: "8px",
    padding: "10px",
    fontSize: "10px",
    fontWeight: 600,
    fontFamily: "monospace",
    whiteSpace: "pre-line" as const,
  };
}

function edgeBase(color: string, width = 2, animated = true): Partial<Edge> {
  return {
    style: { stroke: color, strokeWidth: width },
    labelStyle: { fill: "#a1a1aa", fontSize: 9 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
    animated,
  };
}

function criticalEdge(label?: string): Partial<Edge> {
  return {
    ...edgeBase("#ef4444", 3, true),
    label,
    labelStyle: { fill: "#ef4444", fontSize: 9, fontWeight: 600 },
  };
}

/* ── Hand-crafted graph data for known investigations ── */

const KNOWN_GRAPHS: Record<string, { nodes: Node[]; edges: Edge[] }> = {
  "INV-2026-001": {
    nodes: [
      { id: "u4521", type: "default", data: { label: "U4521@DOM2" }, position: { x: 50, y: 150 }, style: userNodeStyle() },
      { id: "c102", type: "default", data: { label: "C102" }, position: { x: 230, y: 150 }, style: hostNodeStyle() },
      { id: "c4501", type: "default", data: { label: "C4501" }, position: { x: 410, y: 80 }, style: hostNodeStyle() },
      { id: "c892", type: "default", data: { label: "C892" }, position: { x: 590, y: 150 }, style: hostNodeStyle() },
      { id: "dc01", type: "default", data: { label: "DC01" }, position: { x: 770, y: 150 }, style: criticalNodeStyle() },
      { id: "t-t1021", type: "default", data: { label: "T1021\nRemote Services" }, position: { x: 410, y: 260 }, style: techniqueNodeStyle() },
    ],
    edges: [
      { id: "e1", source: "u4521", target: "c102", label: "Kerberos Auth", ...edgeBase("#f59e0b") } as Edge,
      { id: "e2", source: "c102", target: "c4501", label: "Interactive", ...edgeBase("#f59e0b") } as Edge,
      { id: "e3", source: "c4501", target: "c892", label: "NTLM/Network", ...edgeBase("#f59e0b") } as Edge,
      { id: "e4", source: "c892", target: "dc01", ...criticalEdge("Kerberos/TGS") } as Edge,
      { id: "e5", source: "c102", target: "t-t1021", label: "T1021", ...edgeBase("#3b82f6", 1, false) } as Edge,
    ],
  },

  "INV-2026-002": {
    nodes: [
      { id: "u8921", type: "default", data: { label: "U8921@DOM1" }, position: { x: 50, y: 150 }, style: userNodeStyle() },
      { id: "c3847", type: "default", data: { label: "C3847" }, position: { x: 280, y: 150 }, style: hostNodeStyle() },
      { id: "svchost", type: "default", data: { label: "svchost.exe" }, position: { x: 480, y: 60 }, style: techniqueNodeStyle() },
      { id: "cmd", type: "default", data: { label: "cmd.exe" }, position: { x: 480, y: 160 }, style: techniqueNodeStyle() },
      { id: "ps", type: "default", data: { label: "powershell.exe\n-EncodedCommand" }, position: { x: 480, y: 270 }, style: criticalNodeStyle() },
      { id: "t-t1059", type: "default", data: { label: "T1059\nCommand & Script" }, position: { x: 700, y: 160 }, style: techniqueNodeStyle() },
    ],
    edges: [
      { id: "e1", source: "u8921", target: "c3847", label: "Session", ...edgeBase("#f59e0b") } as Edge,
      { id: "e2", source: "c3847", target: "svchost", label: "Spawns", ...edgeBase("#f59e0b", 2, false) } as Edge,
      { id: "e3", source: "svchost", target: "cmd", label: "Child", ...edgeBase("#f59e0b") } as Edge,
      { id: "e4", source: "cmd", target: "ps", ...criticalEdge("Encoded Cmd") } as Edge,
      { id: "e5", source: "ps", target: "t-t1059", label: "T1059", ...edgeBase("#3b82f6", 1, false) } as Edge,
    ],
  },

  "INV-2026-003": {
    nodes: [
      { id: "u3102", type: "default", data: { label: "U3102@DOM3" }, position: { x: 50, y: 150 }, style: userNodeStyle() },
      { id: "c1923", type: "default", data: { label: "C1923" }, position: { x: 280, y: 150 }, style: hostNodeStyle() },
      { id: "dns-c2", type: "default", data: { label: "malware-c2\n.darkops.cc" }, position: { x: 560, y: 150 }, style: criticalNodeStyle() },
      { id: "t-t1041", type: "default", data: { label: "T1041\nExfiltration" }, position: { x: 420, y: 30 }, style: techniqueNodeStyle() },
      { id: "t-c2", type: "default", data: { label: "DNS Tunnel\n2400+ queries" }, position: { x: 420, y: 280 }, style: techniqueNodeStyle() },
    ],
    edges: [
      { id: "e1", source: "u3102", target: "c1923", label: "Session", ...edgeBase("#4338ca") } as Edge,
      { id: "e2", source: "c1923", target: "dns-c2", ...criticalEdge("DNS Tunnel") } as Edge,
      { id: "e3", source: "c1923", target: "t-t1041", label: "T1041", ...edgeBase("#3b82f6", 1, false) } as Edge,
      { id: "e4", source: "c1923", target: "t-c2", label: "2400+ queries", ...edgeBase("#ef4444", 1, true) } as Edge,
    ],
  },

  "INV-2026-004": {
    nodes: [
      { id: "u1205", type: "default", data: { label: "U1205@DOM1" }, position: { x: 50, y: 150 }, style: userNodeStyle() },
      { id: "c587", type: "default", data: { label: "C587" }, position: { x: 280, y: 150 }, style: hostNodeStyle() },
      { id: "mimikatz", type: "default", data: { label: "mimikatz.exe" }, position: { x: 500, y: 80 }, style: criticalNodeStyle() },
      { id: "lsass", type: "default", data: { label: "lsass.exe\npid 672" }, position: { x: 500, y: 240 }, style: criticalNodeStyle() },
      { id: "t-t1003", type: "default", data: { label: "T1003\nCredential Dump" }, position: { x: 700, y: 150 }, style: techniqueNodeStyle() },
    ],
    edges: [
      { id: "e1", source: "u1205", target: "c587", label: "Session", ...edgeBase("#f59e0b") } as Edge,
      { id: "e2", source: "c587", target: "mimikatz", ...criticalEdge("Executed") } as Edge,
      { id: "e3", source: "mimikatz", target: "lsass", ...criticalEdge("Memory Access") } as Edge,
      { id: "e4", source: "mimikatz", target: "t-t1003", label: "T1003", ...edgeBase("#3b82f6", 1, false) } as Edge,
    ],
  },

  "INV-2026-005": {
    nodes: [
      { id: "attacker", type: "default", data: { label: "Attacker\n(External)" }, position: { x: 50, y: 150 }, style: criticalNodeStyle() },
      { id: "c9234", type: "default", data: { label: "C9234" }, position: { x: 300, y: 150 }, style: hostNodeStyle() },
      { id: "targets", type: "default", data: { label: "15 User\nAccounts" }, position: { x: 550, y: 80 }, style: hostNodeStyle() },
      { id: "failures", type: "default", data: { label: "1,842 Failed\nAuth Attempts" }, position: { x: 550, y: 240 }, style: techniqueNodeStyle() },
      { id: "t-t1110", type: "default", data: { label: "T1110\nBrute Force" }, position: { x: 300, y: 300 }, style: techniqueNodeStyle() },
    ],
    edges: [
      { id: "e1", source: "attacker", target: "c9234", ...criticalEdge("Password Spray") } as Edge,
      { id: "e2", source: "c9234", target: "targets", label: "NTLM Auth", ...edgeBase("#f59e0b") } as Edge,
      { id: "e3", source: "c9234", target: "failures", label: "All Failed", ...edgeBase("#ef4444", 2, false) } as Edge,
      { id: "e4", source: "c9234", target: "t-t1110", label: "T1110", ...edgeBase("#3b82f6", 1, false) } as Edge,
    ],
  },

  "INV-2026-006": {
    nodes: [
      { id: "u7823", type: "default", data: { label: "U7823@DOM2" }, position: { x: 50, y: 150 }, style: userNodeStyle() },
      { id: "c4102", type: "default", data: { label: "C4102" }, position: { x: 280, y: 150 }, style: hostNodeStyle() },
      { id: "task", type: "default", data: { label: "Sched Task\nWindowsUpdateCheck" }, position: { x: 500, y: 80 }, style: criticalNodeStyle() },
      { id: "payload", type: "default", data: { label: "C:\\Windows\\Temp\\\nsvc.exe" }, position: { x: 500, y: 250 }, style: criticalNodeStyle() },
      { id: "t-t1053", type: "default", data: { label: "T1053\nScheduled Task" }, position: { x: 720, y: 150 }, style: techniqueNodeStyle() },
    ],
    edges: [
      { id: "e1", source: "u7823", target: "c4102", label: "Session", ...edgeBase("#f59e0b") } as Edge,
      { id: "e2", source: "c4102", target: "task", ...criticalEdge("Creates Task") } as Edge,
      { id: "e3", source: "task", target: "payload", ...criticalEdge("Executes (15 min)") } as Edge,
      { id: "e4", source: "task", target: "t-t1053", label: "T1053", ...edgeBase("#3b82f6", 1, false) } as Edge,
    ],
  },

  "INV-2026-007": {
    nodes: [
      { id: "u5431", type: "default", data: { label: "U5431@DOM1" }, position: { x: 50, y: 150 }, style: userNodeStyle() },
      { id: "c2891", type: "default", data: { label: "C2891" }, position: { x: 280, y: 150 }, style: hostNodeStyle() },
      { id: "nmap", type: "default", data: { label: "nmap\nPort 445 scan" }, position: { x: 500, y: 80 }, style: criticalNodeStyle() },
      { id: "network", type: "default", data: { label: "3,200 Internal\nIPs Scanned" }, position: { x: 500, y: 250 }, style: hostNodeStyle() },
      { id: "t-t1018", type: "default", data: { label: "T1018\nRemote Discovery" }, position: { x: 720, y: 150 }, style: techniqueNodeStyle() },
    ],
    edges: [
      { id: "e1", source: "u5431", target: "c2891", label: "Session", ...edgeBase("#f59e0b") } as Edge,
      { id: "e2", source: "c2891", target: "nmap", ...criticalEdge("Executes nmap") } as Edge,
      { id: "e3", source: "nmap", target: "network", label: "SMB Scan", ...edgeBase("#f59e0b") } as Edge,
      { id: "e4", source: "nmap", target: "t-t1018", label: "T1018", ...edgeBase("#3b82f6", 1, false) } as Edge,
    ],
  },

  "INV-2026-008": {
    nodes: [
      { id: "system", type: "default", data: { label: "SYSTEM" }, position: { x: 50, y: 150 }, style: userNodeStyle() },
      { id: "c6721", type: "default", data: { label: "C6721" }, position: { x: 280, y: 150 }, style: hostNodeStyle() },
      { id: "cmd", type: "default", data: { label: "cmd.exe\n(interactive)" }, position: { x: 500, y: 80 }, style: criticalNodeStyle() },
      { id: "whoami", type: "default", data: { label: "whoami.exe" }, position: { x: 500, y: 250 }, style: techniqueNodeStyle() },
      { id: "t-t1078", type: "default", data: { label: "T1078\nValid Accounts" }, position: { x: 720, y: 150 }, style: techniqueNodeStyle() },
    ],
    edges: [
      { id: "e1", source: "system", target: "c6721", ...criticalEdge("Interactive Logon") } as Edge,
      { id: "e2", source: "c6721", target: "cmd", label: "Spawns", ...edgeBase("#f59e0b") } as Edge,
      { id: "e3", source: "cmd", target: "whoami", label: "Recon", ...edgeBase("#f59e0b", 2, false) } as Edge,
      { id: "e4", source: "c6721", target: "t-t1078", label: "T1078", ...edgeBase("#3b82f6", 1, false) } as Edge,
    ],
  },
};

/* ── Auto-generate fallback graph from investigation data ── */

function generateGraph(inv: Investigation): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let x = 50;
  const Y = 150;

  // User nodes
  inv.users.forEach((user, i) => {
    const id = `user-${i}`;
    nodes.push({
      id,
      type: "default",
      data: { label: user },
      position: { x, y: Y + i * 120 },
      style: userNodeStyle(),
    });
    // Connect user to first host
    if (inv.hosts.length > 0) {
      edges.push({
        id: `eu-${i}`,
        source: id,
        target: "host-0",
        label: "Session",
        ...edgeBase("#f59e0b"),
      } as Edge);
    }
    x += 200;
  });

  // Host nodes (chain them together)
  const hostStartX = Math.max(x, 250);
  inv.hosts.forEach((host, i) => {
    const id = `host-${i}`;
    const isCritical = /dc|controller|c2|malware/i.test(host);
    nodes.push({
      id,
      type: "default",
      data: { label: host },
      position: { x: hostStartX + i * 200, y: Y + (i % 2 === 0 ? 0 : -70) },
      style: isCritical ? criticalNodeStyle() : hostNodeStyle(),
    });
    if (i > 0) {
      edges.push({
        id: `eh-${i}`,
        source: `host-${i - 1}`,
        target: id,
        label: "Lateral",
        ...(isCritical ? criticalEdge("Lateral") : edgeBase("#f59e0b")),
      } as Edge);
    }
  });

  // MITRE tags as technique node
  const mitreTags = inv.tags.filter((t) => /^T\d{4}/i.test(t));
  if (mitreTags.length > 0) {
    const techLabel = mitreTags.join("\n");
    nodes.push({
      id: "technique",
      type: "default",
      data: { label: techLabel },
      position: { x: hostStartX + (inv.hosts.length - 1) * 100, y: Y + 150 },
      style: techniqueNodeStyle(),
    });
    const lastHost = inv.hosts.length > 0 ? `host-${inv.hosts.length - 1}` : inv.users.length > 0 ? "user-0" : undefined;
    if (lastHost) {
      edges.push({
        id: "et-tech",
        source: lastHost,
        target: "technique",
        label: mitreTags[0],
        ...edgeBase("#3b82f6", 1, false),
      } as Edge);
    }
  }

  return { nodes, edges };
}

/* ── Legend ── */

const LEGEND = [
  { color: "#4338ca", label: "User / Identity" },
  { color: "#f59e0b", label: "Compromised Host" },
  { color: "#ef4444", label: "Critical Target" },
  { color: "#3b82f6", label: "MITRE Technique" },
];

/* ── Graph Inner ── */

function FitViewButton() {
  const { fitView } = useReactFlow();
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1"
      onClick={() => fitView({ padding: 0.2 })}
    >
      <ZoomIn className="h-3.5 w-3.5" /> Fit
    </Button>
  );
}

function GraphInner({
  investigation,
  initialNodes,
  initialEdges,
}: {
  investigation: Investigation;
  initialNodes: Node[];
  initialEdges: Edge[];
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const resetView = useCallback(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedNode(null);
  }, [setNodes, setEdges, initialNodes, initialEdges]);

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-primary" />
              Attack Graph — {investigation.id}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs" onClick={resetView}>
                <RefreshCcw className="h-3 w-3" /> Reset
              </Button>
              <FitViewButton />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[420px]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              fitView
              fitViewOptions={{ padding: 0.2 }}
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
                showInteractive={false}
              />
              <MiniMap
                style={{
                  background: "hsl(0 0% 6%)",
                  border: "1px solid hsl(0 0% 14%)",
                  borderRadius: "8px",
                  width: 120,
                  height: 80,
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
                <div className="rounded-md border bg-card/90 p-2.5 backdrop-blur-sm">
                  <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Legend
                  </p>
                  <div className="space-y-1">
                    {LEGEND.map((item) => (
                      <div key={item.label} className="flex items-center gap-1.5">
                        <div
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-[10px]">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>

              {/* Tags */}
              <Panel position="top-right">
                <div className="rounded-md border bg-card/90 p-2.5 backdrop-blur-sm">
                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                    {investigation.tags.slice(0, 4).map((tag) => (
                      <Badge
                        key={tag}
                        variant={
                          investigation.severity >= 4
                            ? "critical"
                            : investigation.severity >= 3
                              ? "high"
                              : "medium"
                        }
                        className="text-[9px]"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </Panel>
            </ReactFlow>
          </div>
        </CardContent>
      </Card>

      {/* Selected Node Details */}
      {selectedNode && (
        <Card>
          <CardContent className="flex items-center gap-6 p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Selected Node
              </p>
              <p className="font-mono text-sm font-medium">
                {String(selectedNode.data?.label ?? selectedNode.id).replace(/\n/g, " ")}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Connections
              </p>
              <p className="text-sm tabular-nums">
                {edges.filter(
                  (e) =>
                    e.source === selectedNode.id || e.target === selectedNode.id,
                ).length}{" "}
                edges
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

/* ── Public component ── */

export function InvestigationGraph({
  investigation,
}: {
  investigation: Investigation;
}) {
  const { nodes, edges } = useMemo(() => {
    const known = KNOWN_GRAPHS[investigation.id];
    if (known) return known;
    return generateGraph(investigation);
  }, [investigation]);

  return (
    <ReactFlowProvider>
      <GraphInner
        investigation={investigation}
        initialNodes={nodes}
        initialEdges={edges}
      />
    </ReactFlowProvider>
  );
}
