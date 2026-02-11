"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatNumber, timeAgo } from "@/lib/utils";
import {
  Lock,
  CheckCircle2,
  Link2,
  Database,
  Hash,
  Shield,
  ExternalLink,
  Copy,
  Layers,
} from "lucide-react";
import evidenceData from "@/lib/mock/evidence.json";
import type { EvidenceBatch, EvidenceSummary } from "@/lib/types";

const batches = evidenceData.batches as EvidenceBatch[];
const summary = evidenceData.summary as EvidenceSummary;

export default function EvidencePage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chain of Custody</h1>
        <p className="text-sm text-muted-foreground">
          Blockchain-anchored evidence integrity verification via Merkle tree hashing
        </p>
      </div>

      {/* Summary KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total Anchored
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatNumber(summary.totalAnchored)}
            </p>
            <p className="text-[10px] text-muted-foreground">events</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total Batches
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {summary.totalBatches}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Verification Rate
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">
              {summary.verificationRate}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Avg Batch Size
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatNumber(summary.avgBatchSize)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Chain Length
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatNumber(summary.chainLength)}
            </p>
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
              All Evidence Verified — Integrity Intact
            </p>
            <p className="text-xs text-muted-foreground">
              {summary.totalBatches} batches verified against on-chain Merkle roots.
              No tampering detected. Last verification: {timeAgo(batches[0]?.timestamp ?? "")}.
            </p>
          </div>
          <Button variant="outline" size="sm" className="ml-auto gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Re-verify All
          </Button>
        </CardContent>
      </Card>

      {/* Batch History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Layers className="h-4 w-4 text-primary" />
            Anchor Batch History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left bg-muted/30">
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Batch ID
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Timestamp
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Events
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Merkle Root
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    TX ID
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Block #
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr
                    key={batch.id}
                    className="border-b border-border/30 transition-colors hover:bg-muted/20"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-foreground">
                        {batch.id}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(batch.timestamp).toLocaleString("en-US", {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {formatNumber(batch.eventCount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Hash className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {batch.merkleRoot.slice(0, 16)}…
                        </span>
                        <button className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Link2 className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {batch.txId}
                        </span>
                        <button className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {formatNumber(batch.blockNumber)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={batch.status === "Verified" ? "low" : "medium"}
                        className="text-[10px]"
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        {batch.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
