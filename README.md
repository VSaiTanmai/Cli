# CLIF — Cognitive Log Investigation Framework

> **Production-Ready Agentic SIEM Platform** — Enterprise SOC with AI-powered threat detection & semantic search  
> High-throughput log pipeline (ClickHouse + Redpanda + MinIO) with 3-model ML triage agent, LanceDB vector search, 14-page real-time SOC dashboard, 2-PC + Kubernetes deployment, automated monitoring & alerting.  
> **Benchmark: Grade A — 82,000+ EPS sustained, 0% data loss**

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                         Log Producers                                 │
│   (Tetragon / Vector / Applications — future integration)             │
└────────────────────────────┬──────────────────────────────────────────┘
                             │  Kafka protocol
                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Redpanda Cluster  (3 brokers, Kafka-compatible, C++ native)          │
│                                                                       │
│  Topics (14): raw-logs │ security-events │ process-events             │
│    network-events │ triage-scores │ anomaly-alerts │ templated-logs   │
│    + 7 more │ 12 partitions each, RF=3, 7-day retention, LZ4         │
└────────────────────────────┬──────────────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│  CLIF Consumer ×3  (Python — confluent-kafka + clickhouse-driver)     │
│                                                                       │
│  • 3 horizontally-scaled consumers in same consumer group            │
│  • 12 partitions / 3 consumers = 4 partitions each                   │
│  • Columnar inserts via clickhouse-driver native TCP (LZ4 wire)      │
│  • Pipelined flush — non-blocking: main loop resumes immediately     │
│  • orjson fast JSON parsing + Semaphore-based WriterPool             │
│  • Batches 200,000 events or flushes every 0.5s                      │
│  • Manual offset commit after successful flush                        │
│  • ~82K events/sec sustained E2E throughput (Grade A)                │
└────────────────┬───────────────────────────────┬─────────────────────┘
                 │                               │
                 ▼                               ▼
┌────────────────────────────────┐ ┌────────────────────────────────────┐
│  ClickHouse Cluster            │ │  LanceDB Vector Store              │
│  (2-node replicated shard)     │ │  (FastAPI + all-MiniLM-L6-v2)     │
│                                │ │                                    │
│  Tables (ReplicatedMergeTree): │ │  • 384-dim embeddings             │
│  • raw_logs                    │ │  • 494K+ vectors indexed          │
│  • security_events             │ │  • Auto-sync from ClickHouse      │
│  • process_events              │ │  • Semantic similarity search     │
│  • network_events              │ │  • Historical incident matching   │
│  • triage_scores               │ │  • REST API: /search /health      │
│  • arf_replay_buffer           │ └────────────────────────────────────┘
│  • source_thresholds           │
│  • ioc_cache / allowlist       │
│  • asset_criticality           │
│                                │
│  Materialized views:           │
│  • events_per_minute_mv        │
│  • security_severity_hourly_mv │
│                                │
│  Tiered storage:               │
│  hot → warm → cold (S3/MinIO)  │
└────────────────┬───────────────┘
                 │  S3 API
                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│  MinIO Cluster  (3 nodes, erasure coded)                             │
│  Buckets: clif-cold-logs │ clif-backups │ clif-evidence-archive      │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  Triage Agent  (Python — 3-model ML ensemble)                        │
│                                                                       │
│  Models: LightGBM ONNX (50%) │ Ext. Isolation Forest (30%)          │
│          River ARF+ADWIN (20%, warm restart from ClickHouse replay)  │
│                                                                       │
│  Pipeline: Kafka consume → Drain3 template → 20-feature extract     │
│            → 3-model inference → weighted score fusion → CI bounds   │
│            → route (triage-scores / anomaly-alerts)                  │
│            → write arf_replay_buffer → online ARF learn_one          │
│                                                                       │
│  Health: ClickHouse + Kafka gates │ startup self-test                │
│  Port 8300 │ /health /stats /ready endpoints                        │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  Monitoring & Alerting                                                │
│  Prometheus → Grafana  │  Alert Rules for all 22+ services           │
│  Scrapes: ClickHouse, Redpanda, MinIO, LanceDB, Dashboard, Vector   │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  SOC Dashboard  (Next.js 14 / TypeScript / Tailwind / shadcn/ui)     │
│                                                                       │
│  14 pages:  Overview │ Dashboard │ Live Feed │ Search │ Alerts       │
│             Investigations │ Attack Graph │ AI Agents │ Threat Intel │
│             Evidence Chain │ Reports │ System Health │ Settings       │
│                                                                       │
│  11 API routes → ClickHouse + LanceDB + Prometheus + Redpanda       │
│  AI semantic search │ React Flow attack graph │ Dark zinc theme       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Status

| Layer | Component | Status | Details |
|-------|-----------|--------|---------|
| **Collection** | Tetragon (eBPF) | 🔲 Planned | Kernel-level process/network/file telemetry |
| **Collection** | Vector (aggregator) | ✅ Live | Syslog/HTTP/Docker/File → CCS → Redpanda, dedup transforms |
| **Streaming** | Redpanda (3-node) | ✅ Live | 244K produce EPS, zero message loss |
| **Ingestion** | Python Consumers (×3) | ✅ Live | 82K+ E2E EPS (Grade A), orjson + WriterPool |
| **Storage** | ClickHouse (2-node) | ✅ Live | 38 tables, <100ms queries, 15-20x ZSTD |
| **Cold Storage** | MinIO (3-node) | ✅ Live | S3-compatible, erasure coded |
| **Evidence** | Merkle Service | ✅ Live | SHA-256 trees, S3 Object Lock proofs |
| **Vector Store** | LanceDB | ✅ Live | 494K+ embeddings, semantic search + RAG |
| **Dashboard** | Next.js 14 (14 pages) | ✅ Live | 6 fully real, 3 partial, 5 mock |
| **Monitoring** | Prometheus + Grafana | ✅ Live | Full scrape coverage + alert rules |
| **Intelligence** | Triage Agent | ✅ Live | 3-model ensemble (LightGBM + EIF + ARF), warm restart, Drain3, score fusion |
| **Intelligence** | Hunter Agent | 🔨 Stub | Dockerfile only — context assembly, graph walk, similarity search |
| **Intelligence** | Verifier Agent | 🔨 Stub | Dockerfile only — IOC validation, Merkle proof verification |
| **Intelligence** | Reporter Agent | 🔲 Planned | LLM reports, MITRE mapping, SOAR actions |
| **Deployment** | 2-PC Docker Compose | ✅ Live | PC1 (14 svc data tier) + PC2 (10 svc AI compute) |
| **Deployment** | Kubernetes (Kustomize) | ✅ Live | 59+ resources, 3 overlays (dev/staging/prod) |
| **Auth** | RBAC / NextAuth.js | 🔲 Planned | No authentication currently |

---

## Docker Services (22+ containers)

CLIF uses a **2-PC split deployment** for maximum performance:
- **PC1** (`docker-compose.pc1.yml`) — Data tier: ClickHouse, Redpanda, MinIO, monitoring (14 services)
- **PC2** (`docker-compose.pc2.yml`) — AI compute: Consumers, Triage Agent, LanceDB, dashboard (10 services)

| Service | Container | Port | PC | Description |
|---------|-----------|------|----|-------------|
| ClickHouse Keeper | `clif-clickhouse-keeper` | 2181 | PC1 | Consensus for replication |
| ClickHouse Node 1 | `clif-clickhouse01` | 8123, 9000 | PC1 | Primary shard |
| ClickHouse Node 2 | `clif-clickhouse02` | 8124, 9001 | PC1 | Replica shard |
| Redpanda Broker 1 | `clif-redpanda01` | 19092 | PC1 | Kafka-compatible broker |
| Redpanda Broker 2 | `clif-redpanda02` | 29092 | PC1 | Kafka-compatible broker |
| Redpanda Broker 3 | `clif-redpanda03` | 39092 | PC1 | Kafka-compatible broker |
| Redpanda Console | `clif-redpanda-console` | 8080 | PC1 | Web UI for Redpanda |
| MinIO Node 1 | `clif-minio1` | 9002, 9003 | PC1 | S3-compatible storage |
| MinIO Node 2 | `clif-minio2` | — | PC1 | MinIO cluster member |
| MinIO Node 3 | `clif-minio3` | — | PC1 | MinIO cluster member |
| Prometheus | `clif-prometheus` | 9090 | PC1 | Metrics collection + alerting |
| Grafana | `clif-grafana` | 3000 | PC1 | Monitoring dashboards |
| Vector | `clif-vector` | 8686 | PC1 | Log aggregator/shipper |
| Merkle Service | `clif-merkle` | 8200 | PC1 | Evidence chain anchoring |
| Consumer 1 | `clif-consumer` | — | PC2 | Redpanda → ClickHouse |
| Consumer 2 | `clif-consumer-2` | — | PC2 | Redpanda → ClickHouse |
| Consumer 3 | `clif-consumer-3` | — | PC2 | Redpanda → ClickHouse |
| **Triage Agent** | `clif-triage-agent` | 8300 | PC2 | **3-model ML ensemble scoring** |
| LanceDB | `clif-lancedb` | 8100 | PC2 | Vector search service |
| SOC Dashboard | `clif-dashboard` | 3001 | PC2 | Next.js 14 SOC interface |

---

## The Multi-Agent Intelligence Pipeline

CLIF's core differentiator: four specialized AI agents that autonomously detect, investigate, verify, and report security threats. The **Triage Agent** is fully implemented with production-grade ML scoring.

```
Redpanda Topics (14)                    Triage Agent
┌──────────────────┐          ┌───────────────────────────┐
│ raw-logs         │────────▶│  Drain3 Template Mining  │
│ security-events  │          │  20-Feature Extraction   │
│ process-events   │          │  ┌─────────────────────┐  │
│ network-events   │          │  │ LightGBM ONNX (50%) │  │
└──────────────────┘          │  │ EIF        (30%) │  │
                              │  │ River ARF  (20%) │  │
                              │  └─────────────────────┘  │
                              │  Weighted Score Fusion    │
                              │  CI bounds + routing      │
                              └──┬───────────────┬───────┬─┘
                                │               │       │
                                ▼               ▼       ▼
                         triage-scores   anomaly-   arf_replay_buffer
                         (Kafka topic)   alerts     (ClickHouse →
                                         (Kafka)     warm restart)
```

### Triage Agent (Fully Implemented)

| Component | Technology | Details |
|-----------|------------|----------|
| **Log Parsing** | Drain3 | Thread-safe template mining with rarity scoring, 10 regex masking rules |
| **Feature Extraction** | Custom | 20 canonical features: token count, entropy, rarity, rare ratio, connection stats (5min/1min), source fan-in/out, bytes mean/std, numeric ratio, punct density, length features |
| **Model 1 (50%)** | LightGBM ONNX | Pre-trained gradient boosting, ONNX Runtime inference |
| **Model 2 (30%)** | Extended Isolation Forest | Unsupervised anomaly detection, fitted from CSV |
| **Model 3 (20%)** | River ARF + ADWIN | Online Adaptive Random Forest with warm restart from ClickHouse `arf_replay_buffer` (no pickle.load — fresh model replays 24h of labeled data) |
| **Score Fusion** | Weighted ensemble | Per-source adaptive thresholds, asset criticality boost, IOC lookup, allowlist bypass, confidence intervals |
| **Health** | Startup gates | ClickHouse + Kafka connectivity with retry/backoff, self-test (synthetic event through full pipeline, verifies ARF produces varying probabilities) |
| **Online Learning** | Replay buffer | Every scored event written to `arf_replay_buffer` (20 features + label), ARF learns incrementally via `learn_one()` |

### Remaining Agents

| Agent | Role | Status | Input | Output |
|-------|------|--------|-------|--------|
| **Hunter** | Context assembly — expands entities ±15min, similarity search, graph walk | 🔨 Stub | `Signal` + ClickHouse + LanceDB | `EnrichedFinding` |
| **Verifier** | Fact-checking — validates IOCs via VirusTotal/AbuseIPDB, verifies Merkle proofs | 🔨 Stub | `EnrichedFinding` + Threat Intel APIs | `ConfirmedIncident` or `FP` |
| **Reporter** | Communication — generates MITRE-mapped reports, triggers SOAR actions | 🔲 Planned | `ConfirmedIncident` | Markdown report + Slack/PagerDuty |

---

## Quick Start

### Prerequisites
- **Docker** ≥ 24.0 and **Docker Compose** v2
- **Node.js** ≥ 18 (for the dashboard)
- **Python** ≥ 3.10 (for test scripts)
- ~8 GB free RAM (dev mode)
- `rpk` CLI (optional, for manual topic management)

### 1. Clone & configure

```bash
git clone https://github.com/Nethrananda21/clif-log-investigation.git
cd CLIF
cp .env.example .env        # edit passwords / ports as needed
```

### 2. Start the entire stack

**Single-machine mode:**
```bash
docker-compose up -d
```

**2-PC split deployment (recommended for production):**
```bash
# PC1 — Data tier (ClickHouse, Redpanda, MinIO, monitoring)
docker-compose -f docker-compose.pc1.yml up -d

# PC2 — AI compute (Consumers, Triage Agent, LanceDB, Dashboard)
docker-compose -f docker-compose.pc2.yml up -d
```

This brings up (in dependency order):
1. ClickHouse Keeper
2. ClickHouse nodes (schema auto-applied — 38 tables)
3. Redpanda brokers + Console
4. MinIO nodes → `minio-init` creates buckets
5. `redpanda-init` creates 14 topics
6. CLIF consumers (×3 — horizontally scaled)
7. **Triage Agent (3-model ML ensemble — waits for ClickHouse + Kafka health gates)**
8. Vector (log aggregator)
9. LanceDB (vector search — auto-syncs from ClickHouse)
10. Merkle Service (evidence anchoring)
11. Prometheus & Grafana (monitoring + alerting)
12. SOC Dashboard (Next.js 14)

### 3. Start the SOC Dashboard

```bash
cd dashboard
npm install
npm run dev
# Opens on http://localhost:3001
```

### 4. Verify everything is healthy

```bash
# All containers running
docker-compose ps

# ClickHouse responding
curl "http://localhost:8123/?query=SELECT+version()"

# Redpanda healthy
rpk cluster health --brokers localhost:19092

# LanceDB semantic search
curl http://localhost:8100/health
curl -X POST http://localhost:8100/search \
  -H "Content-Type: application/json" \
  -d '{"query": "suspicious login attempt", "limit": 5}'

# Triage Agent health
curl http://localhost:8300/health
curl http://localhost:8300/ready
curl http://localhost:8300/stats

# MinIO buckets
docker exec clif-minio-init mc ls clif/
```

### 5. Access web UIs

| Service | URL | Credentials |
|---------|-----|-------------|
| **CLIF Dashboard** | http://localhost:3001 | (no auth) |
| **Triage Agent** | http://localhost:8300/health | (no auth) |
| Grafana | http://localhost:3000 | admin / (see .env) |
| Redpanda Console | http://localhost:8080 | (no auth) |
| MinIO Console | http://localhost:9003 | clif_minio_admin / (see .env) |
| Prometheus | http://localhost:9090 | (no auth) |
| LanceDB API | http://localhost:8100 | (no auth) |
| ClickHouse HTTP | http://localhost:8123 | clif_admin / (see .env) |

---

## Running Tests

### Install test dependencies

```bash
pip install -r tests/requirements.txt
```

### Full test suite (pytest)

```bash
# Infrastructure, data integrity, performance, resilience tests
pytest tests/ -v --tb=short

# Run specific test categories
pytest tests/test_infrastructure.py -v    # Cluster health, schema, configs
pytest tests/test_data_integrity.py -v    # E2E pipeline validation
pytest tests/test_performance.py -v -s    # Throughput & query benchmarks
pytest tests/test_resilience.py -v -s     # Fault tolerance (destructive)
pytest tests/test_lancedb.py -v           # LanceDB semantic search tests
```

### Enterprise benchmark (Grade A)

```bash
# Full enterprise benchmark: 2M events, burst, latency probes, concurrent queries
python tests/enterprise_benchmark.py

# Results saved to tests/benchmark_results.json
```

### Realistic load test (LANL-format)

```bash
# Default: 1M events across 4 topics with LANL-realistic data
python tests/realistic_load_test.py

# Custom event count
python tests/realistic_load_test.py --events 500000
```

### Legacy performance test

```bash
python tests/performance_test.py --events 1000000 --rate 100000 --duration 60
```

---

## Benchmark Results (Grade A)

Enterprise benchmark: 2M events, 3-minute sustained load, 500K burst, 500 latency probes, 16 concurrent analyst queries.

| Metric | Result | Enterprise Target | Status |
|--------|--------|-------------------|--------|
| **Sustained Throughput** | **82,000+ EPS** | ≥50,000 EPS | ✅ Pass |
| **Peak Throughput** | **96,000+ EPS** | — | ✅ |
| **EPS Stability (σ)** | ±4,402 (7.8%) | <20% of avg | ✅ Pass |
| **Burst Throughput** | **51,865 EPS** | ≥50,000 EPS | ✅ Pass |
| **Data Loss** | **0.0%** | 0% | ✅ Pass |
| **Query Avg Response** | **61.4ms** | <200ms | ✅ Pass |
| **Query P95 Response** | **87.4ms** | <500ms | ✅ Pass |
| **Queries <100ms** | **15/16 (94%)** | ≥80% | ✅ Pass |
| **Concurrent QPS** | **37.6 QPS** | ≥10 QPS | ✅ Pass |
| **Consumer Lag** | **0 messages** | <10,000 | ✅ Pass |
| **Memory Efficiency** | **11,085 EPS/GB** | ≥1,000 EPS/GB | ✅ Pass |
| **Zero Data Loss** | **2.5M/2.5M events** | Zero loss | ✅ Pass |

> Benchmark run on Docker Desktop (WSL2) with shared resources. On dedicated hardware, metrics improve 2-5x.

---

## Dashboard Pages

| Page | Route | Data Source | Status | Description |
|------|-------|-------------|--------|-------------|
| Overview | `/` | ClickHouse | ✅ Real | KPI cards, event trends, severity distribution |
| Dashboard | `/dashboard` | ClickHouse | ✅ Real | Aggregation charts, top sources |
| Live Feed | `/live-feed` | ClickHouse (2s poll) | ✅ Real | Real-time event stream with pause/filter/dedup |
| Search | `/search` | ClickHouse + LanceDB | ✅ Real | Keyword + AI semantic search, time/severity filters |
| Alerts | `/alerts` | ClickHouse | ⚠️ Partial | Real data, client-side workflow state |
| System Health | `/system` | Prometheus + Direct | ✅ Real | All infrastructure service status |
| Threat Intel | `/threat-intel` | ClickHouse + Mock | ⚠️ Partial | MITRE data real, IOC table mock |
| Evidence | `/evidence` | Merkle + Mock | ⚠️ Partial | Partial mock data |
| AI Agents | `/ai-agents` | Mock | 🔲 Mock | Agent cards & approval queue |
| Investigations | `/investigations` | Mock | 🔲 Mock | Case list with MITRE tags |
| Attack Graph | `/attack-graph` | Mock | 🔲 Mock | React Flow visualization |
| Reports | `/reports` | Mock | 🔲 Mock | Report templates |
| Settings | `/settings` | Mock | 🔲 Mock | User management |

### Dashboard API Routes (11)

| Route | Method | Description |
|-------|--------|-------------|
| `/api/metrics` | GET | ClickHouse aggregation queries for dashboard KPIs |
| `/api/events/stream` | GET | Live event polling (UNION ALL across 4 tables) |
| `/api/events/search` | GET | Full-text keyword search with filters |
| `/api/alerts` | GET | Alert data from security_events |
| `/api/system` | GET | Service health from Prometheus + direct checks |
| `/api/evidence` | GET | Merkle evidence chain data |
| `/api/threat-intel` | GET | MITRE ATT&CK + threat intelligence |
| `/api/lancedb` | GET | LanceDB health and stats proxy |
| `/api/semantic-search` | POST | AI semantic search via LanceDB embeddings |
| `/api/similar-events` | POST | Find similar events by event ID |

---

## LanceDB Vector Search

CLIF includes a production LanceDB service for AI-powered semantic search across all log data.

### Features
- **Embedding Model:** `all-MiniLM-L6-v2` (384 dimensions)
- **Auto-Sync:** Continuously indexes new events from ClickHouse
- **Semantic Search:** Natural language queries against 494K+ log embeddings
- **Similar Events:** Find related events by vector similarity
- **Historical Incidents:** 5 pre-loaded incident patterns for matching

### API Endpoints

```bash
# Health check
GET http://localhost:8100/health

# Statistics (embedding counts, sync status)
GET http://localhost:8100/stats

# Semantic search
POST http://localhost:8100/search
{"query": "brute force login attempt", "limit": 10}

# Similar events
POST http://localhost:8100/similar
{"event_id": "abc-123", "limit": 5}
```

---

## File Layout

```
CLIF/
├── docker-compose.yml              # Full infrastructure (22+ services)
├── docker-compose.pc1.yml          # PC1: Data tier (14 services)
├── docker-compose.pc2.yml          # PC2: AI compute (10 services)
├── docker-compose.prod.yml         # Production overrides
├── .env.example                    # Environment variable template
├── .env                            # Local environment
├── pytest.ini                      # Pytest configuration
├── README.md                       # This file
├── CLIF_PROJECT_REPORT.md          # Detailed project report (all layers)
├── BENCHMARK_RESULTS.md            # Full benchmark analysis
├── INDUSTRY_GAP_ANALYSIS.md        # Gap analysis vs Splunk/Elastic/Sentinel
├── implementation_plan.md          # Agentic SIEM transformation roadmap
│
├── agents/                         # AI Agent Pipeline
│   ├── triage/                     # ✅ Fully implemented
│   │   ├── app.py                  # 837 lines — TriageProcessor + TriageAgent + Flask
│   │   ├── config.py               # All env vars incl. ARF warm restart config
│   │   ├── model_ensemble.py       # 540 lines — LightGBM + EIF + ARF ensemble
│   │   ├── feature_extractor.py    # 513 lines — 20-feature canonical extraction
│   │   ├── score_fusion.py         # 570 lines — Weighted fusion, CI, routing
│   │   ├── drain3_miner.py         # 188 lines — Thread-safe Drain3 mining
│   │   ├── drain3.ini              # 10 regex masking rules
│   │   ├── Dockerfile              # Python 3.11-slim, librdkafka, healthcheck
│   │   ├── requirements.txt        # onnxruntime, river, eif, drain3, etc.
│   │   └── models/                 # Model artifacts (ONNX, joblib, pkl)
│   ├── hunter/                     # 🔨 Stub (Dockerfile only)
│   │   └── Dockerfile
│   └── verifier/                   # 🔨 Stub (Dockerfile only)
│       └── Dockerfile
│
├── dashboard/                      # SOC Dashboard (Next.js 14)
│   ├── src/app/                    # 14 page routes + 11 API routes
│   │   ├── page.tsx                # Overview (✅ real)
│   │   ├── dashboard/              # KPIs, charts, tables (✅ real)
│   │   ├── live-feed/              # Real-time event stream (✅ real)
│   │   ├── search/                 # Keyword + AI semantic search (✅ real)
│   │   ├── alerts/                 # Alert queue (⚠️ partial)
│   │   ├── system/                 # Service health (✅ real)
│   │   ├── threat-intel/           # MITRE + IOCs (⚠️ partial)
│   │   ├── evidence/               # Merkle chain (⚠️ partial)
│   │   ├── ai-agents/              # Agent dashboard (🔲 mock)
│   │   ├── investigations/         # Case management (🔲 mock)
│   │   ├── attack-graph/           # React Flow graph (🔲 mock)
│   │   ├── reports/                # Compliance reports (🔲 mock)
│   │   ├── settings/               # User management (🔲 mock)
│   │   └── api/                    # Backend API routes
│   │       ├── metrics/            # ClickHouse aggregation queries
│   │       ├── events/             # Stream + search endpoints
│   │       ├── alerts/             # Alert management
│   │       ├── evidence/           # Merkle service integration
│   │       ├── threat-intel/       # MITRE data queries
│   │       ├── system/             # Prometheus + direct health
│   │       ├── lancedb/            # LanceDB health proxy
│   │       ├── semantic-search/    # AI semantic search endpoint
│   │       └── similar-events/     # Similar event lookup
│   ├── src/components/             # Sidebar, TopBar, shadcn/ui
│   ├── src/lib/                    # ClickHouse, Prometheus, Redpanda clients
│   │   └── mock/                   # Mock JSON files (to be replaced)
│   ├── src/hooks/                  # usePolling custom hook
│   ├── package.json
│   └── tailwind.config.ts
│
├── clickhouse/
│   ├── schema.sql                  # 38 tables + materialized views
│   ├── keeper_config.xml           # ClickHouse Keeper config
│   ├── node01_config.xml           # Node 1 cluster + macros
│   ├── node02_config.xml           # Node 2 cluster + macros
│   ├── users.xml                   # User profiles, quotas, async_insert
│   └── storage_policy.xml          # Tiered storage (local → S3)
│
├── consumer/
│   ├── app.py                      # 756 lines — Redpanda → ClickHouse pipeline
│   ├── requirements.txt            # Python dependencies
│   └── Dockerfile                  # Consumer container image
│
├── k8s/                            # Kubernetes manifests (Kustomize)
│   ├── base/                       # 59+ resources (deployments, services, PVCs)
│   ├── overlays/                   # dev / staging / production
│   ├── generate-configmaps.ps1     # ConfigMap generation script
│   └── README.md                   # K8s deployment guide
│
├── cluster/                        # 2-PC cluster utilities
│   ├── setup.ps1                   # Cross-PC setup script
│   ├── health-check.ps1            # Cluster health verification
│   ├── firewall-pc1.ps1            # Windows firewall rules
│   └── README.md                   # 2-PC deployment guide
│
├── lancedb-service/
│   ├── app.py                      # 874 lines — FastAPI vector search service
│   ├── requirements.txt            # Python dependencies (sentence-transformers)
│   └── Dockerfile                  # LanceDB container image
│
├── merkle-service/
│   └── merkle_anchor.py            # SHA-256 evidence chain anchoring
│
├── vector/
│   └── vector.yaml                 # Vector aggregator config (dedup transforms)
│
├── redpanda/
│   ├── topics.sh                   # Manual topic creation script
│   └── console-config.yml          # Redpanda Console config
│
├── tests/
│   ├── conftest.py                 # Shared pytest fixtures + constants
│   ├── test_infrastructure.py      # Cluster health, schema validation
│   ├── test_data_integrity.py      # E2E pipeline validation
│   ├── test_performance.py         # Throughput & query benchmarks
│   ├── test_resilience.py          # Fault tolerance (destructive)
│   ├── test_lancedb.py             # LanceDB semantic search tests
│   ├── enterprise_benchmark.py     # Full enterprise SIEM benchmark (Grade A)
│   ├── realistic_load_test.py      # LANL-format 1M event simulation
│   ├── performance_test.py         # Legacy standalone benchmark
│   ├── benchmark_results.json      # Latest benchmark results
│   └── requirements.txt            # Test dependencies
│
└── monitoring/
    ├── prometheus.yml              # Scrape config (all services)
    ├── alert_rules.yml             # Alerting rules for 22+ services
    ├── grafana-dashboard.json      # Pre-built overview dashboard
    ├── grafana-datasources.yml     # Prometheus data source
    └── grafana-dashboards.yml      # Dashboard provisioning
```

---

## Architecture Decisions

### Why ClickHouse over Elasticsearch?
- **10–20x better compression** on structured log data (columnar + ZSTD)
- **Sub-second analytical queries** vs ES's multi-second aggregation
- **S3 tiering built-in** — 90% cost reduction for cold data
- **SQL interface** — no query DSL learning curve for analysts

### Why Redpanda over Kafka?
- **C++ native** — no JVM overhead, 10x lower tail latency
- **Kafka-compatible** — drop-in replacement, all client libraries work
- **Built-in Wasm** — enables in-stream PII scrubbing (future)
- **Simpler operations** — no ZooKeeper dependency

### Why LanceDB for vector search?
- **Embedded-first** — runs as a lightweight service, no cluster to manage
- **Fast ANN search** — IVF-PQ indexing on 494K+ embeddings
- **Auto-sync** — continuously indexes new ClickHouse events
- **Sentence-transformers** — `all-MiniLM-L6-v2` for 384-dim embeddings

### Why MinIO over AWS S3 directly?
- **Local development** — fully offline-capable, identical S3 API
- **Erasure coding** — data durability without cloud dependency
- **Swap for production** — change one endpoint URL to move to AWS S3

### Why ReplicatedMergeTree?
- **Async replication** — survives node loss with zero data loss
- **Built-in deduplication** — exactly-once semantics with idempotent inserts
- **Partition pruning** — daily partitions enable fast time-range queries

### Why manual consumer over ClickHouse Kafka engine?
- **Better error handling** — retries, dead letter logic, structured logging
- **Flexible batching** — tunable batch size + time-based flush + pipelined I/O
- **Offset control** — manual commit after confirmed ClickHouse insert
- **Horizontal scaling** — multiple consumer instances in same group
- **Monitoring** — built-in stats reporting, easy to instrument

---

## Troubleshooting

### ClickHouse won't start
```bash
# Check keeper is running first
docker logs clif-clickhouse-keeper
# Verify keeper health
echo ruok | nc localhost 2181   # should return "imok"
# Then check node logs
docker logs clif-clickhouse01
```

### Topics not created
```bash
# Run manually
rpk topic create raw-logs --brokers localhost:19092 --partitions 12 --replicas 2
# Or re-run the init container
docker-compose up redpanda-init
```

### Consumer not ingesting
```bash
# Check logs
docker logs clif-consumer -f --tail 100
# Check consumer lag
rpk group describe clif-clickhouse-consumer --brokers localhost:19092
```

### LanceDB not syncing
```bash
# Check health
curl http://localhost:8100/health
# Check stats (embedding count, last sync)
curl http://localhost:8100/stats
# Check logs
docker logs clif-lancedb -f --tail 50
```
### Triage Agent not scoring
```bash
# Check health (should return startup_ok + self-test_ok)
curl http://localhost:8300/health
# Check readiness
curl http://localhost:8300/ready
# Check stats (events_processed, arf_model_ready, etc.)
curl http://localhost:8300/stats
# Check logs for ClickHouse/Kafka health gate failures
docker logs clif-triage-agent -f --tail 100
```
### S3 tiering not working
```bash
# Verify MinIO is healthy
curl http://localhost:9002/minio/health/live
# Check ClickHouse storage policy
curl "http://localhost:8123/?query=SELECT+*+FROM+system.storage_policies+FORMAT+Pretty"
```

### Grafana shows no data
1. Check Prometheus targets: http://localhost:9090/targets
2. Verify data source in Grafana: Settings → Data Sources → Prometheus → Test
3. Redpanda metrics may take 1–2 minutes to appear after startup

---

## Tear Down

```bash
# Stop everything and remove volumes (fresh start)
docker-compose down -v

# Stop but keep data
docker-compose down
```

---

## Next Steps

See [implementation_plan.md](implementation_plan.md) for the full roadmap.

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 1: Foundation** | ClickHouse + Redpanda + MinIO + Consumers + Dashboard + Monitoring | ✅ Complete |
| **Phase 2: Triage Agent** | 3-model ensemble (LightGBM + EIF + ARF), warm restart, Drain3, score fusion, health gates, self-test | ✅ Complete |
| **Phase 3: 2-PC + K8s** | Split deployment (PC1 data / PC2 AI), Kustomize + 3 overlays, 59+ K8s resources | ✅ Complete |
| **Phase 4: Hunter Agent** | Context assembly, ±15min entity expansion, LanceDB similarity search, graph walk | 🔨 Next |
| **Phase 5: Verifier + Reporter** | IOC validation (VT/AbuseIPDB), Merkle proof verification, LLM reports, SOAR | 🔲 Planned |
| **Phase 6: Integration** | Wire mock dashboard pages to real agent backends, SSE streaming, RBAC | 🔲 Planned |

---

## Related Docs

| Document | Description |
|----------|-------------|
| [CLIF_PROJECT_REPORT.md](CLIF_PROJECT_REPORT.md) | Full layer-by-layer project report |
| [BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md) | Detailed enterprise benchmark analysis |
| [INDUSTRY_GAP_ANALYSIS.md](INDUSTRY_GAP_ANALYSIS.md) | 22-gap comparison vs Splunk/Elastic/Sentinel/CrowdStrike |
| [implementation_plan.md](implementation_plan.md) | Agentic SIEM transformation roadmap |

---

*CLIF — Cognitive Log Investigation Framework — v5.0*
