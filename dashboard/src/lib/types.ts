/* ── Dashboard metrics ── */
export interface DashboardMetrics {
  totalEvents: number;
  ingestRate: number;
  activeAlerts: number;
  topSources: Array<{ source: string; count: number }>;
  severityDistribution: Array<{ severity: number; count: number }>;
  eventsTimeline: Array<{ time: string; count: number }>;
  uptime?: string;
  criticalAlertCount?: number;
  tableCounts?: Record<string, number>;
  evidenceBatches?: number;
  evidenceAnchored?: number;
  mitreTopTechniques?: Array<{ technique: string; tactic: string; count: number }>;
  riskScore?: number;
  mttr?: number;
  riskyEntities?: Array<{ entity: string; type: "user" | "host" | "ip"; riskScore: number; alertCount: number }>;
  mitreTacticHeatmap?: Array<{ tactic: string; techniques: number; alerts: number }>;
}

/* ── Generic event row ── */
export interface EventRow {
  timestamp: string;
  log_source?: string;
  hostname?: string;
  severity?: number;
  raw?: string;
  [key: string]: unknown;
}

/* ── Investigation ── */
export interface Investigation {
  id: string;
  title: string;
  status: string;
  severity: number;
  created: string;
  updated: string;
  assignee: string;
  eventCount: number;
  description: string;
  tags: string[];
  hosts: string[];
  users: string[];
}

/* ── AI Agent ── */
export interface Agent {
  id: string;
  name: string;
  status: string;
  description: string;
  casesProcessed: number;
  accuracy: number;
  avgResponseTime: string;
  lastAction: string;
  lastActionTime: string;
}

export interface AgentActivity {
  timestamp: string;
  agent: string;
  action: string;
}

export interface PendingApproval {
  id: string;
  agent: string;
  action: string;
  reason: string;
  investigation: string;
  severity: number;
  created: string;
}

/* ── Threat Intel ── */
export interface IOC {
  type: string;
  value: string;
  source: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  mitre: string;
  tags: string[];
  matchedEvents: number;
}

export interface ThreatPattern {
  name: string;
  description: string;
  mitre: string;
  iocCount: number;
  matchedEvents: number;
  severity: number;
}

/* ── Evidence / Chain of Custody ── */
export interface EvidenceBatch {
  id: string;
  timestamp: string;
  tableName: string;
  timeFrom: string;
  timeTo: string;
  eventCount: number;
  merkleRoot: string;
  merkleDepth: number;
  s3Key: string;
  s3VersionId: string;
  status: string;
  prevMerkleRoot: string;
  /* Legacy fields kept for mock fallback */
  txId?: string;
  blockNumber?: number;
}

export interface EvidenceSummary {
  totalAnchored: number;
  totalBatches: number;
  verificationRate: number;
  avgBatchSize: number;
  chainLength: number;
}

/* ── Reports ── */
export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface Report {
  id: string;
  title: string;
  template: string;
  created: string;
  status: string;
  pages: number;
  size: string;
}

/* ── Users ── */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLogin: string;
}
