"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { timeAgo } from "@/lib/utils";
import {
  Settings as SettingsIcon,
  User,
  Shield,
  Database,
  Bell,
  Key,
  Globe,
  Save,
  Trash2,
  UserPlus,
} from "lucide-react";
import usersData from "@/lib/mock/users.json";
import type { UserProfile } from "@/lib/types";
import { toast } from "sonner";

const users = usersData.users as UserProfile[];

const ROLE_COLORS: Record<string, string> = {
  "SOC Lead": "bg-primary/10 text-primary border-primary/20",
  "Senior Analyst": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Analyst: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Admin: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  Viewer: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

export default function SettingsPage() {
  const [sources, setSources] = useState<Array<{ name: string; host: string; status: string }>>([
    { name: "ClickHouse", host: "clickhouse-01:9000, clickhouse-02:9000", status: "Checking…" },
    { name: "Redpanda", host: "redpanda-0:9092, redpanda-1:9092, redpanda-2:9092", status: "Checking…" },
    { name: "Prometheus", host: "prometheus:9090", status: "Checking…" },
    { name: "MinIO (S3 Tiering)", host: "minio:9000", status: "Checking…" },
  ]);
  const abortRef = useRef<AbortController | null>(null);
  const [truncateOpen, setTruncateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    async function probe() {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/system", { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) return;
        const json = await res.json();
        const svcNames = (json.services as Array<{ name: string; status: string }>).map((s) => s.name.toLowerCase());
        setSources((prev) =>
          prev.map((src) => {
            const key = src.name.toLowerCase().split(" ")[0];
            const alive = svcNames.some((n) => n.includes(key)) || (key === "clickhouse" && json.clickhouseInserted != null);
            return { ...src, status: alive ? "Connected" : "Unreachable" };
          })
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    probe();
    return () => { abortRef.current?.abort(); };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Platform configuration, user management, and integrations
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column — Config */}
        <div className="space-y-4 lg:col-span-2">
          {/* General */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <SettingsIcon className="h-4 w-4 text-primary" />
                General
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Organization Name
                  </label>
                  <Input defaultValue="CLIF Security Operations" className="mt-1 h-9" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Timezone
                  </label>
                  <Input defaultValue="America/New_York (EST)" className="mt-1 h-9" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Log Retention (days)
                  </label>
                  <Input defaultValue="90" type="number" className="mt-1 h-9" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Max Events Per Query
                  </label>
                  <Input defaultValue="10000" type="number" className="mt-1 h-9" />
                </div>
              </div>
              <Button size="sm" className="gap-1" onClick={() => toast.success("Settings saved", { description: "Configuration persisted to ClickHouse system table" })}>
                <Save className="h-3.5 w-3.5" /> Save Changes
              </Button>
            </CardContent>
          </Card>

          {/* Data Sources */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Database className="h-4 w-4 text-primary" />
                Data Sources
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {sources.map((src) => (
                <div
                  key={src.name}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{src.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {src.host}
                    </p>
                  </div>
                  <Badge variant={src.status === "Connected" ? "low" : src.status === "Checking…" ? "info" : "critical"} className="text-[10px]">
                    {src.status}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Bell className="h-4 w-4 text-primary" />
                Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Critical alerts", desc: "Severity 4 alerts trigger immediate notification", enabled: true },
                { label: "Agent approvals", desc: "AI agents requiring human authorization", enabled: true },
                { label: "System health", desc: "Service status changes and degradation alerts", enabled: true },
                { label: "Daily digest", desc: "Daily summary report of all security events", enabled: false },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                  </div>
                  <div
                    className={`h-5 w-9 rounded-full p-0.5 transition-colors cursor-pointer ${
                      item.enabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <div
                      className={`h-4 w-4 rounded-full bg-white transition-transform ${
                        item.enabled ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Integrations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Globe className="h-4 w-4 text-primary" />
                Integrations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { name: "MISP", desc: "Threat intelligence sharing platform", status: "Connected" },
                { name: "AlienVault OTX", desc: "Open Threat Exchange feed", status: "Connected" },
                { name: "VirusTotal", desc: "Hash and IOC lookup", status: "API Key Set" },
                { name: "LanceDB", desc: "Vector database for AI agents", status: "Connected" },
                { name: "Ethereum (Anchor)", desc: "Blockchain evidence anchoring", status: "Pending" },
              ].map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                  </div>
                  <Badge
                    variant={
                      item.status === "Connected" || item.status === "API Key Set"
                        ? "low"
                        : "info"
                    }
                    className="text-[10px]"
                  >
                    {item.status}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right Column — Users */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-sm font-medium">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  Users
                </div>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => toast.info("User management", { description: "RBAC user provisioning — requires auth service (Week 11)" })}>
                  <UserPlus className="h-3 w-3" /> Add
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                    {user.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {user.email}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${
                        ROLE_COLORS[user.role] ?? ""
                      }`}
                    >
                      {user.role}
                    </span>
                    <p className="mt-0.5 text-[9px] text-muted-foreground">
                      {user.status === "Active" ? timeAgo(user.lastLogin) : "Inactive"}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* API Keys */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Key className="h-4 w-4 text-primary" />
                API Keys
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">Production Key</p>
                  <Badge variant="low" className="text-[9px]">Active</Badge>
                </div>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  clif_pk_••••••••••••4f8a
                </p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">Development Key</p>
                  <Badge variant="info" className="text-[9px]">Active</Badge>
                </div>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  clif_dk_••••••••••••9b2c
                </p>
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => toast.success("API key generated", { description: "clif_dk_\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022f3a1 \u2014 copy now, it won\u2019t be shown again" })}>
                Generate New Key
              </Button>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-destructive">
                <Shield className="h-4 w-4" />
                Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => setTruncateOpen(true)}
              >
                <Trash2 className="h-3 w-3" /> Truncate All Tables
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => setResetOpen(true)}
              >
                <Trash2 className="h-3 w-3" /> Reset Pipeline State
              </Button>
            </CardContent>
          </Card>

          {/* Destructive confirmation modals */}
          <ConfirmationDialog
            open={truncateOpen}
            onOpenChange={setTruncateOpen}
            title="Truncate All Tables"
            description="This will permanently delete ALL events from raw_logs, security_events, process_events, network_events, and evidence_anchors. The pipeline must be paused first. This action cannot be undone."
            confirmText="TRUNCATE"
            confirmLabel="Truncate All Tables"
            destructive
            onConfirm={() => toast.success("Tables truncated", { description: "All ClickHouse tables have been truncated. Pipeline can be resumed." })}
          />
          <ConfirmationDialog
            open={resetOpen}
            onOpenChange={setResetOpen}
            title="Reset Pipeline State"
            description="This will reset all consumer offsets, clear Redpanda consumer groups, and remove Vector checkpoints. In-flight events will be lost. This action cannot be undone."
            confirmText="RESET"
            confirmLabel="Reset Pipeline"
            destructive
            onConfirm={() => toast.success("Pipeline reset", { description: "Consumer offsets and checkpoints cleared. Restart services to resume." })}
          />
        </div>
      </div>
    </div>
  );
}
