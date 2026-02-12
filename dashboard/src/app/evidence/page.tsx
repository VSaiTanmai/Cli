"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, timeAgo } from "@/lib/utils";
import { usePolling } from "@/hooks/use-polling";
import {
  CheckCircle2,
  Hash,
  Shield,
  Copy,
  Layers,
  Database,
  RefreshCw,
  Loader2,
  FileCheck,
  ShieldCheck,
  Link2,
} from "lucide-react";
import type { EvidenceBatch, EvidenceSummary } from "@/lib/types";
import { toast } from "sonner";

interface EvidenceChainResponse {
  batches: EvidenceBatch[];
  summary: EvidenceSummary;
}

interface VerifyResult {
  batchId: string;
  table: string;
  storedRoot: string;
  computedRoot: string;
  storedCount: number;
  actualCount: number;
  verified: boolean;
  depth: number;
  status: string;
}

const TABLE_COLORS: Record<string, string> = {
  raw_logs: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  security_events: "bg-red-500/10 text-red-400 border-red-500/30",
  process_events: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  network_events: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

export default function EvidencePage() {
  const { data, loading } = usePolling<EvidenceChainResponse>(
    "/api/evidence/chain",
    15000
  );
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResult>>({});

  const batches = data?.batches ?? [];
  const summary = data?.summary ?? {
    totalAnchored: 0,
    totalBatches: 0,
    verificationRate: 0,
    avgBatchSize: 0,
    chainLength: 0,
  };

  const verifyBatch = useCallback(async (batchId: string) => {
    setVerifying((prev) => ({ ...prev, [batchId]: true }));
    try {
      const res = await fetch(`/api/evidence/verify?batchId=${encodeURIComponent(batchId)}`);
      const result: VerifyResult = await res.json();
      setVerifyResults((prev) => ({ ...prev, [batchId]: result }));
      if (result.verified) {
        toast.success(`${batchId} — Integrity verified`, {
          description: `${formatNumber(result.actualCount)} events, Merkle root matches (depth ${result.depth})`,
        });
      } else {
        toast.error(`${batchId} — TAMPERING DETECTED`, {
          description: `Stored: ${result.storedRoot.slice(0, 16)}… ≠ Computed: ${result.computedRoot.slice(0, 16)}…`,
        });
      }
    } catch {
      toast.error("Verification request failed");
    } finally {
      setVerifying((prev) => ({ ...prev, [batchId]: false }));
    }
  }, []);

  const verifyAll = useCallback(async () => {
    toast.promise(
      (async () => {
        for (const batch of batches) {
          await verifyBatch(batch.id);
        }
      })(),
      {
        loading: `Verifying ${batches.length} batches against Merkle roots…`,
        success: `All ${batches.length} batches verified — integrity intact`,
        error: "One or more verifications failed",
      }
    );
  }, [batches, verifyBatch]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chain of Custody</h1>
        <p className="text-sm text-muted-foreground">
          Merkle tree evidence integrity — SHA-256 hashed, S3 Object Lock archived
        </p>
      </div>

      {/* Summary KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total Anchored
            </p>
            {loading ? <Skeleton className="mt-1 h-8 w-24" /> : (
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {formatNumber(summary.totalAnchored)}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">events</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total Batches
            </p>
            {loading ? <Skeleton className="mt-1 h-8 w-16" /> : (
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {summary.totalBatches}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Verification Rate
            </p>
            {loading ? <Skeleton className="mt-1 h-8 w-20" /> : (
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">
                {summary.verificationRate}%
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Avg Batch Size
            </p>
            {loading ? <Skeleton className="mt-1 h-8 w-24" /> : (
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {formatNumber(summary.avgBatchSize)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Chain Length
            </p>
            {loading ? <Skeleton className="mt-1 h-8 w-16" /> : (
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {formatNumber(summary.chainLength)}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">blocks</p>
          </CardContent>
        </Card>
      </div>

      {/* Integrity Status */}
      <Card className="border-emerald-500/20">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="rounded-full bg-emerald-500/10 p-3">
            <Shield className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-emerald-400">
              {summary.verificationRate === 100
                ? "All Evidence Verified — Integrity Intact"
                : `${summary.verificationRate}% Verified`}
            </p>
            <p className="text-xs text-muted-foreground">
              {summary.totalBatches} batches across 4 tables.{" "}
              {formatNumber(summary.totalAnchored)} events anchored via SHA-256 Merkle trees.
              {batches[0]?.timestamp && ` Last anchor: ${timeAgo(batches[0].timestamp)}.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto gap-1"
            onClick={verifyAll}
            disabled={batches.length === 0}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Re-verify All
          </Button>
        </CardContent>
      </Card>

      {/* Batch History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Layers className="h-4 w-4 text-primary" />
            Anchor Batch History
            <span className="ml-auto text-xs text-muted-foreground font-normal">
              Live from ClickHouse evidence_anchors
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left bg-muted/30">
                    <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Batch ID
                    </th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Table
                    </th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Events
                    </th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Merkle Root
                    </th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Depth
                    </th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      S3 Archive
                    </th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Verify
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => {
                    const vr = verifyResults[batch.id];
                    return (
                      <tr
                        key={batch.id}
                        className="border-b border-border/30 transition-colors hover:bg-muted/20"
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-foreground">
                            {batch.id}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${TABLE_COLORS[batch.tableName] ?? ""}`}
                          >
                            <Database className="mr-1 h-2.5 w-2.5" />
                            {batch.tableName}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs tabular-nums font-medium">
                          {formatNumber(batch.eventCount)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Hash className="h-3 w-3 text-muted-foreground" />
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {batch.merkleRoot.slice(0, 16)}…
                            </span>
                            <button
                              className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
                              onClick={() => {
                                navigator.clipboard.writeText(batch.merkleRoot);
                                toast.success("Merkle root copied to clipboard");
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums">
                          {batch.merkleDepth}
                        </td>
                        <td className="px-4 py-3">
                          {batch.s3Key ? (
                            <div className="flex items-center gap-1">
                              <Link2 className="h-3 w-3 text-emerald-400" />
                              <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[120px]">
                                {batch.s3Key.split("/").pop()}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              vr?.verified === true
                                ? "low"
                                : vr?.verified === false
                                  ? "critical"
                                  : batch.status === "Verified"
                                    ? "low"
                                    : "medium"
                            }
                            className="text-[10px]"
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            {vr
                              ? vr.verified
                                ? "PASS"
                                : "FAIL"
                              : batch.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            onClick={() => verifyBatch(batch.id)}
                            disabled={verifying[batch.id]}
                          >
                            {verifying[batch.id] ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <FileCheck className="h-3 w-3" />
                            )}
                            {verifying[batch.id] ? "Verifying…" : "Verify"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
