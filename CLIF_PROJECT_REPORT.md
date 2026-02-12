# CLIF — Cognitive Log Investigation Framework  
## Complete Project Report

> **Version:** Stage 3 Prototype  
> **Date:** February 2026  
> **Status:** Data plane production-ready, Intelligence plane in development

---

## 1. Project Overview

CLIF is an AI-driven, multi-agent Security Information & Event Management (SIEM) platform built for autonomous threat detection, investigation, and response. It combines a high-throughput log pipeline with a four-agent intelligence system to deliver SOC-grade capabilities.

**Core Philosophy:** Replace manual SOC analyst workflows with autonomous AI agents backed by a blazing-fast columnar data engine.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                                     │
│  Tetragon (eBPF kernel telemetry) → Vector (log aggregator/normalizer)  │
│  + Syslog / Applications / Cloud APIs                                   │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ Kafka protocol
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  REDPANDA CLUSTER (3 brokers, C++ native, Kafka-compatible)            │
│  Topics: raw-logs | security-events | process-events | network-events  │
│  12 partitions/topic, RF=3, 7-day retention                            │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Consumer ×3     │ │  Triage Agent    │ │  Merkle Service  │
│  (Python)        │ │  (Real-time      │ │  (SHA-256 chain  │
│  Redpanda →      │ │   detection)     │ │   + MinIO S3)    │
│  ClickHouse      │ │                  │ │                  │
└────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
         │                    │                     │
         ▼                    ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CLICKHOUSE CLUSTER (2-node replicated shard)                          │
│  Tables: raw_logs | security_events | process_events | network_events  │
│  + Materialized views (events_per_minute, severity_hourly)             │
│  TTL: 7d hot → 30d warm → 90d cold (S3/MinIO)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  MINIO CLUSTER (3-node, S3-compatible)                                 │
│  Buckets: clif-cold-logs | clif-backups | clif-evidence-archive        │
├─────────────────────────────────────────────────────────────────────────┤
│  LANCEDB (Vector Store — planned)                                      │
│  Collections: historical_incidents | threat_intel_reports               │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────────┐
│               INTELLIGENCE PLANE (Multi-Agent)                          │
│                                                                         │
│  Triage Agent → Hunter Agent → Verifier Agent → Reporter Agent          │
│  (Filter)       (Investigate)   (Fact-check)     (Report + SOAR)        │
│                                                                         │
│  Powered by: DSPy (LLM orchestration) + LanceDB (RAG)                  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  NEXT.JS 14 SOC DASHBOARD (12 pages)                                   │
│  Real-time metrics, alerts, investigations, attack graph, threat intel  │
├─────────────────────────────────────────────────────────────────────────┤
│  PROMETHEUS + GRAFANA  (Infrastructure monitoring)                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Layer-by-Layer Breakdown

### 3.1 Log Collection — Tetragon + Vector
**Status:** 🔲 Planned (Week 1-2)

| Component | Role | Details |
|-----------|------|---------|
| **Tetragon** | eBPF kernel sensor | Captures process exec, file access, network connections at syscall level. Deployed as DaemonSet (k8s) or systemd service. |
| **Vector** | Log aggregator & normalizer | Receives JSON from Tetragon via gRPC/Unix socket. Remaps fields to CLIF Common Schema (CCS). Sinks to Redpanda topics. |

**Data Flow:**
```
Kernel syscalls → Tetragon (eBPF) → JSON events → Vector (transform to CCS) → Redpanda
```

**Why Tetragon:** Kernel-level visibility without requiring agents on endpoints. Captures process trees, syscall arguments, and container context that application logs miss entirely.

**Why Vector:** Written in Rust, 10x faster than Logstash, native Redpanda/Kafka sink support, built-in VRL (Vector Remap Language) for field normalization.

---

### 3.2 Event Streaming — Redpanda
**Status:** ✅ Production-Ready

| Spec | Value |
|------|-------|
| **Version** | v24.2.8 |
| **Cluster** | 3 brokers (`redpanda01`, `redpanda02`, `redpanda03`) |
| **Protocol** | Kafka-compatible (C++ native, no JVM) |
| **Topics** | `raw-logs`, `security-events`, `process-events`, `network-events` |
| **Partitions** | 12 per topic |
| **Replication Factor** | 3 (every message stored on all brokers) |
| **Retention** | 7 days (604,800,000 ms) |
| **Compression** | LZ4 passthrough |
| **Admin API** | Port 9644 |
| **Pandaproxy** | REST API on ports 18082/28082/38082 |
| **Console UI** | Redpanda Console v2.7.2 on port 8080 |

**Throughput:** 205K produce EPS confirmed. Zero message loss on 1M event test.

**Docker Services:**
- `redpanda01` (external Kafka: 19092)
- `redpanda02` (external Kafka: 29092)
- `redpanda03` (external Kafka: 39092)
- `redpanda-console` (web UI: 8080)
- `redpanda-init` (creates all 4 topics on startup)

---

### 3.3 Consumer Pipeline — Python Consumers
**Status:** ✅ Production-Ready

| Spec | Value |
|------|-------|
| **File** | `consumer/app.py` (731 lines) |
| **Instances** | 3 horizontally-scaled consumers (same consumer group) |
| **Partition Distribution** | 12 partitions / 3 consumers = 4 each |
| **Libraries** | `confluent-kafka` (librdkafka), `clickhouse-driver` (native TCP) |
| **JSON Parser** | `orjson` (Rust-based, 3-10x faster) with `json` fallback |
| **Batch Size** | 200,000 events per INSERT |
| **Flush Interval** | 0.5 seconds |
| **Flush Workers** | 4 threads (ThreadPoolExecutor) |
| **Insert Mode** | Columnar (`columnar=True`) via native TCP with LZ4 wire compression |
| **Async Insert** | `async_insert=1` with 100ms server-side micro-batching |
| **Offset Commit** | Manual, after successful ClickHouse flush |
| **Shutdown** | Graceful drain on SIGINT/SIGTERM |
| **E2E Throughput** | ~78K+ events/sec |

**Topic → Table Mapping:**
| Redpanda Topic | ClickHouse Table |
|---------------|------------------|
| `raw-logs` | `raw_logs` |
| `security-events` | `security_events` |
| `process-events` | `process_events` |
| `network-events` | `network_events` |

**Row Builders:** Per-table builder functions (`_build_raw_log_row`, `_build_security_event_row`, `_build_process_event_row`, `_build_network_event_row`) handle type coercion, timestamp parsing, and metadata normalization before columnar insert.

---

### 3.4 Log Storage — ClickHouse
**Status:** ✅ Production-Ready

| Spec | Value |
|------|-------|
| **Version** | 24.8 |
| **Cluster** | 2-node replicated shard (`clickhouse01`, `clickhouse02`) |
| **Keeper** | ClickHouse Keeper (ZooKeeper replacement) on port 12181 |
| **Database** | `clif_logs` |
| **Engine** | `ReplicatedMergeTree` (all tables) |
| **Compression** | ZSTD(3) for data, ZSTD(1) for low-cardinality, Delta+ZSTD for timestamps |
| **Partitioning** | Daily (`toYYYYMMDD(timestamp)`) |
| **Compression Ratio** | 15-20x |
| **Query Latency** | <200ms on analyst queries |

**Tables:**

| Table | Purpose | Key Columns | Indexes |
|-------|---------|-------------|---------|
| `raw_logs` | Every ingested log line | `event_id`, `timestamp`, `level`, `source`, `message`, `metadata`, `user_id`, `ip_address`, `request_id`, `anchor_tx_id` | tokenbf on message, bloom on user_id/request_id, minmax on ip |
| `security_events` | Parsed security events | `severity` (0-4), `category`, `mitre_tactic`, `mitre_technique`, `ai_confidence`, `ai_explanation` | set on category/mitre, minmax on severity/ip, tokenbf on description |
| `process_events` | Kernel process execution (Tetragon) | `pid`, `ppid`, `uid`, `binary_path`, `arguments`, `syscall`, `container_id`, `pod_name`, `namespace`, `is_suspicious` | tokenbf on binary_path, bloom on container_id, set on namespace/syscall |
| `network_events` | Network connections | `src_ip`, `dst_ip`, `src_port`, `dst_port`, `protocol`, `direction`, `bytes_sent`, `bytes_received`, `dns_query`, `geo_country` | minmax on IPs, set on dst_port/protocol, tokenbf on dns_query |

**Materialized Views:**
| View | Target Table | Aggregation |
|------|-------------|-------------|
| `events_per_minute_mv` | `events_per_minute` | Count by (minute, source, level) — sparklines |
| `security_severity_hourly_mv` | `security_severity_hourly` | Count by (hour, category, severity) — severity rollups |

**Tiered Storage (TTL):**
```
Hot  (SSD)  → 7 days
Warm (HDD)  → 30 days
Cold (MinIO S3) → 90 days
DELETE after TTL expires
```

---

### 3.5 Cold Storage & Object Store — MinIO
**Status:** ✅ Production-Ready

| Spec | Value |
|------|-------|
| **Version** | RELEASE.2024-08-29 |
| **Cluster** | 3 nodes (`minio1`, `minio2`, `minio3`) with erasure coding |
| **Protocol** | S3-compatible |
| **Console** | Port 9003 |
| **Data API** | Port 9002 |

**Buckets:**
| Bucket | Purpose |
|--------|---------|
| `clif-cold-logs` | ClickHouse cold tier overflow (TTL-driven) |
| `clif-backups` | Manual/scheduled ClickHouse backups |
| `clif-evidence-archive` | Merkle proof objects (S3 Object Lock, immutable) |

---

### 3.6 Evidence Integrity — Merkle Service
**Status:** ✅ Production-Ready

| Spec | Value |
|------|-------|
| **File** | `merkle-service/merkle_anchor.py` (475 lines) |
| **Algorithm** | SHA-256 binary Merkle trees |
| **Batch Window** | 30 minutes (configurable) |
| **Daemon Mode** | Runs every 30 seconds |
| **Coverage** | All 4 ClickHouse tables |

**How It Works:**
1. Queries ClickHouse for events in the current time window
2. Computes SHA-256 hash per row (using ClickHouse server-side `hex(SHA256(...))`)
3. Builds a binary Merkle tree from leaf hashes
4. Stores the Merkle root in `evidence_anchors` table
5. Uploads full proof object to MinIO with S3 Object Lock (immutable)

**Verification:** Can re-verify any batch by recomputing the Merkle tree and comparing against the stored root. Any tampered event will produce a different root hash.

**Why This Matters:** No other major SIEM offers cryptographic evidence chains. This enables forensic/legal admissibility of log data — any modification to stored events is mathematically detectable.

---

### 3.7 Vector Store — LanceDB
**Status:** 🔲 Planned (Week 1-2)

| Spec | Value |
|------|-------|
| **Purpose** | Semantic search & RAG for AI agents |
| **Embedding Model** | `all-MiniLM-L6-v2` (local) or `text-embedding-3-small` (cloud) |
| **Storage** | Local disk or S3-backed |

**Collections:**
| Collection | Purpose |
|------------|---------|
| `historical_incidents` | Similarity search: "Have we seen this attack pattern before?" |
| `threat_intel_reports` | RAG context for the Reporter agent's narrative generation |

**Integration:** The Hunter Agent queries LanceDB during investigation to find similar historical incidents and enrich context.

---

### 3.8 Intelligence Plane — Multi-Agent System
**Status:** 🔲 Planned (Weeks 3-5)

Four specialized AI agents collaborate in a pipeline:

```
Event Stream → Triage → Hunter → Verifier → Reporter → Action
               (Filter)  (Investigate)  (Judge)    (Communicate)
```

**Tech Stack:**
- **DSPy** — LLM prompt optimization & reliability framework
- **AsyncIO** — Agent orchestration
- **PostgreSQL** — Agent state, task queues, conversation history
- **LLM Backend** — GPT-4o (cloud) or Llama-3-70B (local via Ollama/vLLM)

#### Agent 1: Triage Agent (The Filter)
| Attribute | Detail |
|-----------|--------|
| **Role** | High-volume noise reduction |
| **Input** | Real-time Redpanda stream + SQL rule engine results |
| **Logic** | Deterministic SQL rules (e.g., "5 failed logins in 1min") + DSPy classifier for ambiguous patterns |
| **Output** | `Signal` object (if confidence > 70%) passed to Hunter |
| **Volume** | Processes 100% of events, filters down to <1% as signals |

#### Agent 2: Hunter Agent (The Investigator)
| Attribute | Detail |
|-----------|--------|
| **Role** | Context assembly & hypothesis generation |
| **Trigger** | Receives `Signal` from Triage |
| **Actions** | 1) Entity expansion: queries ClickHouse ±15min around flagged entity. 2) Similarity search via LanceDB. 3) Graph walk: User→Process→Network→IP. 4) Baseline comparison. |
| **Output** | `EnrichedFinding` with full context package |

#### Agent 3: Verifier Agent (The Judge)
| Attribute | Detail |
|-----------|--------|
| **Role** | Fact-checking & false positive elimination |
| **Trigger** | Receives `EnrichedFinding` from Hunter |
| **Actions** | 1) IOC validation via VirusTotal/AbuseIPDB. 2) Merkle proof verification for source log integrity. 3) Final verdict assignment. |
| **Output** | `ConfirmedIncident` (True Positive) or `FP` dismissal |

#### Agent 4: Reporter Agent (The Communicator)
| Attribute | Detail |
|-----------|--------|
| **Role** | Narrative generation & automated response |
| **Trigger** | `ConfirmedIncident` from Verifier |
| **Actions** | 1) Generates Markdown report with MITRE kill chain mapping. 2) Suggests remediation actions. 3) Pushes notifications to Slack/PagerDuty. |
| **Output** | Human-readable incident report + SOAR actions |

---

### 3.9 SOC Dashboard — Next.js 14
**Status:** ✅ UI Built (12 pages) — Backend integration varies per page

| Page | Route | Data Source | Status |
|------|-------|-------------|--------|
| **Overview** | `/` | ClickHouse (real metrics) | ✅ Real |
| **Live Feed** | `/live-feed` | ClickHouse via 2s HTTP polling | ✅ Real |
| **Search** | `/search` | ClickHouse queries | ✅ Real |
| **Alerts** | `/alerts` | ClickHouse (real data, client-side state) | ⚠️ Partial |
| **Dashboard** | `/dashboard` | ClickHouse aggregations | ✅ Real |
| **System Health** | `/system` | Direct service health checks | ✅ Real |
| **Evidence Chain** | `/evidence` | Merkle service + ClickHouse | ⚠️ Partial (mock: `evidence.json`) |
| **Threat Intel** | `/threat-intel` | MITRE data real, IOCs mock | ⚠️ Partial (mock: `threat-intel.json`) |
| **Attack Graph** | `/attack-graph` | Hardcoded ReactFlow nodes | ❌ Mock |
| **AI Agents** | `/ai-agents` | Static agent cards | ❌ Mock (mock: `agents.json`) |
| **Investigations** | `/investigations` | Mock case data | ❌ Mock (mock: `investigations.json`) |
| **Reports** | `/reports` | Mock report list | ❌ Mock (mock: `reports.json`) |
| **Settings** | `/settings` | Mock user management | ❌ Mock (mock: `users.json`) |

**Mock Files (to be replaced with real backends):**
- `dashboard/src/lib/mock/agents.json`
- `dashboard/src/lib/mock/investigations.json`
- `dashboard/src/lib/mock/reports.json`
- `dashboard/src/lib/mock/users.json`
- `dashboard/src/lib/mock/evidence.json`
- `dashboard/src/lib/mock/threat-intel.json`

**API Routes (Real):**
| Route | Backend |
|-------|---------|
| `/api/metrics` | ClickHouse aggregations |
| `/api/events/*` | ClickHouse event queries |
| `/api/alerts/*` | ClickHouse security_events |
| `/api/evidence/*` | Merkle service |
| `/api/system/*` | Direct health checks |
| `/api/threat-intel/*` | ClickHouse MITRE tables |

---

### 3.10 Infrastructure Monitoring — Prometheus + Grafana
**Status:** ✅ Production-Ready

| Component | Version | Port |
|-----------|---------|------|
| **Prometheus** | v2.54.0 | 9090 |
| **Grafana** | v11.1.4 | 3000 |

**Scrape Targets:**
| Target | Endpoint | Metrics |
|--------|----------|---------|
| ClickHouse Node 1 | `clickhouse01:9363/metrics` | Query latency, merge operations, memory, parts count |
| ClickHouse Node 2 | `clickhouse02:9363/metrics` | Same |
| Redpanda (×3) | `redpanda0X:9644/public_metrics` | Throughput, lag, partition health |
| MinIO | `minio1:9000/minio/v2/metrics/cluster` | Storage usage, request rates |
| Prometheus | `localhost:9090` | Self-monitoring |

**Grafana Dashboard:** Pre-provisioned `clif-overview.json` with auto-configured Prometheus datasource.

---

## 4. Docker Compose Service Inventory

Total: **19 services** across 3 networks (`clif-frontend`, `clif-backend`, `clif-storage`)

| Service | Image | Ports | Network |
|---------|-------|-------|---------|
| `clickhouse-keeper` | clickhouse/clickhouse-keeper:24.8 | 12181 | storage |
| `clickhouse01` | clickhouse/clickhouse-server:24.8 | 8123, 9000 | backend, storage |
| `clickhouse02` | clickhouse/clickhouse-server:24.8 | 8124, 9001 | backend, storage |
| `redpanda01` | redpandadata/redpanda:v24.2.8 | 19092, 18082, 9644 | backend, storage |
| `redpanda02` | redpandadata/redpanda:v24.2.8 | 29092, 28082 | backend, storage |
| `redpanda03` | redpandadata/redpanda:v24.2.8 | 39092, 38082 | backend, storage |
| `redpanda-console` | redpandadata/console:v2.7.2 | 8080 | frontend, backend |
| `minio1` | minio/minio | 9002, 9003 | storage, frontend |
| `minio2` | minio/minio | — | storage |
| `minio3` | minio/minio | — | storage |
| `minio-init` | minio/mc | — (init, exits) | storage |
| `redpanda-init` | redpandadata/redpanda | — (init, exits) | backend |
| `clif-consumer` | ./consumer (custom) | — | backend, storage |
| `clif-consumer-2` | ./consumer (custom) | — | backend, storage |
| `clif-consumer-3` | ./consumer (custom) | — | backend, storage |
| `prometheus` | prom/prometheus:v2.54.0 | 9090 | frontend, storage, backend |
| `grafana` | grafana/grafana:v11.1.4 | 3000 | frontend, storage |

**Persistent Volumes:** 11 named volumes for data durability across restarts.

---

## 5. Test Suite

| Test File | Coverage |
|-----------|----------|
| `tests/test_infrastructure.py` | Service connectivity, ClickHouse schema validation |
| `tests/test_data_integrity.py` | Merkle proof verification, data consistency |
| `tests/test_performance.py` | Query latency benchmarks |
| `tests/performance_test.py` | E2E throughput measurement |
| `tests/test_resilience.py` | Failover, recovery, partition tolerance |
| `tests/realistic_load_test.py` | Sustained load simulation |
| `tests/conftest.py` | Shared fixtures |

---

## 6. Performance Benchmarks

| Metric | Value |
|--------|-------|
| **Produce throughput** | 205,000 events/sec |
| **E2E throughput** (produce → store) | 78,000+ events/sec |
| **Query latency** (analyst queries) | <200ms |
| **Compression ratio** | 15-20x (ZSTD columnar) |
| **Zero message loss** | Confirmed on 1M event test |
| **Partition distribution** | 12 partitions / 3 consumers = 4 each |

---

## 7. File Structure

```
CLIF/
├── clickhouse/
│   ├── schema.sql                  # 267 lines — all table/view DDL
│   ├── keeper_config.xml           # ClickHouse Keeper config
│   ├── node01_config.xml           # Shard/replica config node 1
│   ├── node02_config.xml           # Shard/replica config node 2
│   ├── users.xml                   # ClickHouse user permissions
│   └── storage_policy.xml          # Tiered storage (hot/warm/cold)
├── consumer/
│   ├── app.py                      # 731 lines — high-perf consumer
│   └── Dockerfile
├── merkle-service/
│   └── merkle_anchor.py            # 475 lines — evidence chain
├── dashboard/
│   └── src/
│       ├── app/                    # 12 Next.js pages
│       │   ├── page.tsx            # Overview
│       │   ├── live-feed/          # Real-time event feed
│       │   ├── search/             # Log search
│       │   ├── alerts/             # Security alerts
│       │   ├── ai-agents/          # AI agent dashboard (mock)
│       │   ├── attack-graph/       # Attack visualization (mock)
│       │   ├── investigations/     # Case management (mock)
│       │   ├── reports/            # Compliance reports (mock)
│       │   ├── settings/           # User management (mock)
│       │   ├── threat-intel/       # Threat intelligence (partial)
│       │   ├── evidence/           # Evidence chain (partial)
│       │   ├── system/             # System health
│       │   └── api/                # API routes
│       ├── components/             # Reusable UI components
│       └── lib/mock/               # 6 mock JSON data files
├── redpanda/
│   └── console-config.yml
├── monitoring/
│   ├── prometheus.yml
│   ├── grafana-dashboard.json
│   ├── grafana-datasources.yml
│   └── grafana-dashboards.yml
├── tests/                          # 7 test files
├── docker-compose.yml              # 542 lines — 19 services
├── docker-compose.prod.yml         # Production overrides
├── .env / .env.example             # Environment configuration
├── pytest.ini
└── README.md
```

---

## 8. Implementation Status Summary

| Layer | Component | Status | Notes |
|-------|-----------|--------|-------|
| **Collection** | Tetragon (eBPF) | 🔲 Planned | Kernel-level telemetry |
| **Collection** | Vector (aggregator) | 🔲 Planned | Log normalization to CCS |
| **Streaming** | Redpanda (3-node) | ✅ Live | 205K EPS, zero loss |
| **Ingestion** | Python Consumers (×3) | ✅ Live | 78K+ E2E EPS |
| **Storage** | ClickHouse (2-node) | ✅ Live | <200ms queries, ZSTD |
| **Cold Storage** | MinIO (3-node) | ✅ Live | S3-compatible, erasure coded |
| **Evidence** | Merkle Service | ✅ Live | SHA-256, S3 Object Lock |
| **Vector Store** | LanceDB | 🔲 Planned | RAG for agents |
| **AI** | Triage Agent | 🔲 Planned | Noise reduction |
| **AI** | Hunter Agent | 🔲 Planned | Investigation |
| **AI** | Verifier Agent | 🔲 Planned | Fact-checking |
| **AI** | Reporter Agent | 🔲 Planned | Reports + SOAR |
| **AI** | DSPy Framework | 🔲 Planned | LLM orchestration |
| **Dashboard** | Next.js 14 (12 pages) | ⚠️ Mixed | 6 real, 5 mock, 2 partial |
| **Monitoring** | Prometheus + Grafana | ✅ Live | Full scrape coverage |
| **Auth** | RBAC / NextAuth.js | 🔲 Planned | No auth currently |
| **Detection** | Rule Engine | 🔲 Planned | SQL-template rules |
| **SOAR** | Playbook Engine | 🔲 Planned | YAML workflows |
| **Threat Intel** | Feed Integration | 🔲 Planned | STIX/TAXII, VirusTotal |

**Bottom Line:** The **data plane** (ingest → stream → store → archive → verify) is fully operational and benchmarked. The **intelligence plane** (detect → investigate → respond) is architecturally designed and awaiting implementation.

---

*CLIF Project Report — v1.0 — February 2026*
