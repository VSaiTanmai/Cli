"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { timeAgo } from "@/lib/utils";
import {
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Eye,
  Zap,
} from "lucide-react";
import agentsData from "@/lib/mock/agents.json";
import type { Agent, AgentActivity, PendingApproval } from "@/lib/types";
import { toast } from "sonner";

const agents = agentsData.agents as Agent[];
const recentActivity = agentsData.recentActivity as AgentActivity[];
const pendingApprovals = agentsData.pendingApprovals as PendingApproval[];

const STATUS_CONFIG: Record<string, { color: string; icon: React.ElementType }> = {
  Active: { color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: Zap },
  Processing: { color: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: Cpu },
  Idle: { color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20", icon: Clock },
};

const AGENT_ICONS: Record<string, React.ElementType> = {
  triage: Eye,
  hunter: Activity,
  verifier: ShieldCheck,
  escalation: AlertTriangle,
  reporter: CheckCircle2,
};

export default function AIAgentsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Agents</h1>
        <p className="text-sm text-muted-foreground">
          Autonomous investigation agents — powered by LanceDB vector search
        </p>
      </div>

      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Pending Approval
              <Badge variant="high" className="ml-1">
                {pendingApprovals.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingApprovals.map((approval) => (
              <div
                key={approval.id}
                className="flex items-start justify-between rounded-md border border-amber-500/20 bg-amber-500/5 p-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {approval.id}
                    </span>
                    <Badge variant="critical">
                      {approval.investigation}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium">{approval.action}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {approval.reason}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Requested by {approval.agent} · {timeAgo(approval.created)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2 ml-4">
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => toast.error("Action denied", { description: `${approval.action} — denied by SOC Lead` })}>
                    Deny
                  </Button>
                  <Button size="sm" className="h-8 text-xs bg-amber-600 hover:bg-amber-700" onClick={() => toast.success("Action approved", { description: `${approval.action} — executing via LangGraph orchestrator` })}>
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Agent Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => {
          const Icon = AGENT_ICONS[agent.id] ?? Bot;
          const statusConfig = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.Idle;
          const StatusIcon = statusConfig.icon;
          return (
            <Card key={agent.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-md bg-primary/10 p-2">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-medium">
                        {agent.name}
                      </CardTitle>
                      <p className="text-[11px] text-muted-foreground">
                        {agent.description}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${statusConfig.color}`}
                  >
                    <StatusIcon className="h-2.5 w-2.5" />
                    {agent.status}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                {/* Metrics */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Cases
                    </p>
                    <p className="text-lg font-bold tabular-nums">
                      {agent.casesProcessed}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Accuracy
                    </p>
                    <p className="text-lg font-bold tabular-nums text-emerald-400">
                      {agent.accuracy}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Avg Time
                    </p>
                    <p className="text-lg font-bold tabular-nums">
                      {agent.avgResponseTime}
                    </p>
                  </div>
                </div>
                <Separator />
                {/* Last Action */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Last Action
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {agent.lastAction}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {timeAgo(agent.lastActionTime)}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Activity Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-primary" />
            Agent Activity Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative space-y-4">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
            {recentActivity.map((item, idx) => (
              <div key={idx} className="relative flex gap-3">
                <div className="relative z-10 mt-1">
                  <div className="h-3.5 w-3.5 rounded-full border-2 border-primary bg-card" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {item.agent}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {timeAgo(item.timestamp)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.action}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
