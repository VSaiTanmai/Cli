# CLIF — Cognitive Log Investigation Framework

> **Stage 3 Prototype** — Enterprise SOC platform  
> High-throughput log pipeline (ClickHouse + Redpanda + MinIO) with a 12-page real-time SOC dashboard, automated monitoring, and full test suites.

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                         Log Producers                                │
│   (Tetragon / Vector / Applications — future integration)            │
└────────────────────────────┬──────────────────────────────────────────┘
                             │  Kafka protocol
                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Redpanda Cluster  (3 brokers, Kafka-compatible, C++ native)         │
│                                                                       │
│  Topics:  raw-logs │ security-events │ process-events │ network-events│
│           12 partitions each, RF=3, 7-day retention, LZ4 passthrough  │
└────────────────────────────┬──────────────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│  CLIF Consumer ×3  (Python — confluent-kafka + clickhouse-driver)    │
│                                                                       │
│  • 3 horizontally-scaled consumers in same consumer group            │
│  • 12 partitions / 3 consumers = 4 partitions each                   │
│  • Columnar inserts via clickhouse-driver native TCP (LZ4 wire)      │
│  • Pipelined flush — non-blocking: main loop resumes immediately     │
│  • async_insert=1 with 100ms timeout — server-side micro-batching    │
│  • Batches 200 000 events or flushes every 0.5s                      │
│  • Manual offset commit after successful flush                        │
│  • ~78K+ events/sec end-to-end throughput                            │
└────────────────────────────┬──────────────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│  ClickHouse Cluster  (2-node, replicated shard)                      │
│                                                                       │
│  Tables (ReplicatedMergeTree, ZSTD, daily partitions):               │
│    • raw_logs          — all ingested events                          │
│    • security_events   — parsed security-relevant events              │
│    • process_events    — kernel-level process data (Tetragon)         │
│    • network_events    — network connection logs                      │
│                                                                       │
│  Materialized views:                                                  │
│    • events_per_minute_mv      — sparkline aggregations               │
│    • security_severity_hourly_mv — severity roll-ups                  │
│                                                                       │
│  Storage policy  "clif_tiered":                                       │
│    hot (local)  →  warm (local, >7d)  →  cold (S3/MinIO, >30d)       │
└────────────────────────────┬──────────────────────────────────────────┘
                             │  S3 API
                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│  MinIO Cluster  (3 nodes, erasure coded)                             │
│                                                                       │
│  Buckets:                                                             │
│    • clif-cold-logs         — ClickHouse cold tier                    │
│    • clif-backups           — ClickHouse backups                      │
│    • clif-evidence-archive  — long-term evidence (blockchain-linked)  │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  Monitoring                                                           │
│    Prometheus  ──►  Grafana                                           │
│    Scrapes: ClickHouse, Redpanda, MinIO                               │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  SOC Dashboard  (Next.js 14 / TypeScript / Tailwind / shadcn/ui)     │
│                                                                       │
│  12 pages:  Dashboard │ Live Feed │ Search │ Alerts │ Investigations  │
│             Attack Graph │ AI Agents │ Threat Intel │ Evidence Chain  │
│             Reports │ System Health │ Settings                        │
│                                                                       │
│  Real-time API routes → ClickHouse (HTTP) + Prometheus + Redpanda    │
│  React Flow attack graph │ Recharts analytics │ Dark zinc theme       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites
- **Docker** ≥ 24.0 and **Docker Compose** v2
- **Python** ≥ 3.10 (for test scripts)
- ~8 GB free RAM (dev mode)
- `rpk` CLI (optional, for manual topic management)

### 1. Clone & configure

```bash
cd CLIF
cp .env.example .env        # edit passwords / ports as needed
```

### 2. Start the entire stack

```bash
docker-compose up -d
```

This brings up (in dependency order):
1. ClickHouse Keeper  
2. ClickHouse nodes (schema auto-applied)  
3. Redpanda brokers  
4. MinIO nodes → `minio-init` creates buckets  
5. `redpanda-init` creates topics  
6. CLIF consumers (×3 — horizontally scaled)  
7. Redpanda Console  
8. Prometheus & Grafana

### 3. Start the SOC Dashboard

```bash
cd dashboard
npm install
npm run dev
# Opens on http://localhost:3001 (port 3000 is Grafana)
```

### 4. Verify everything is healthy

```bash
# All containers running
docker-compose ps

# ClickHouse responding
curl "http://localhost:8123/?query=SELECT+version()"

# Redpanda healthy
rpk cluster health --brokers localhost:19092

# Topics created
rpk topic list --brokers localhost:19092

# MinIO buckets
docker exec clif-minio-init mc ls clif/
```

### 5. Access web UIs

| Service            | URL                        | Credentials                  |
|--------------------|----------------------------|------------------------------|
| **CLIF Dashboard** | http://localhost:3001       | (no auth)                    |
| Grafana            | http://localhost:3000       | admin / (see .env)           |
| Redpanda Console   | http://localhost:8080       | (no auth)                    |
| MinIO Console      | http://localhost:9003       | clif_minio_admin / (see .env)|
| Prometheus         | http://localhost:9090       | (no auth)                    |
| ClickHouse HTTP    | http://localhost:8123       | clif_admin / (see .env)      |

---

## Running Tests

### Install test dependencies

```bash
pip install -r tests/requirements.txt
```

### Full test suite (pytest)

```bash
# Infrastructure, data integrity, performance tests
pytest tests/ -v --tb=short

# Run specific test categories
pytest tests/test_infrastructure.py -v    # Cluster health, schema, configs
pytest tests/test_data_integrity.py -v    # E2E pipeline validation
pytest tests/test_performance.py -v -s    # Throughput & query benchmarks
pytest tests/test_resilience.py -v -s     # Fault tolerance (destructive)
```

### Realistic load test (LANL-format)

```bash
# Default: 1M events across 4 topics with LANL-realistic data
python tests/realistic_load_test.py

# Custom event count
python tests/realistic_load_test.py --events 500000
```

**What it measures:**
1. **Produce throughput** — parallel multiprocess producers (4 topics)
2. **End-to-end time** — produce start → all events visible in ClickHouse
3. **Red team injection** — realistic LANL-format attack patterns

### Legacy performance test

```bash
python tests/performance_test.py --events 1000000 --rate 100000 --duration 60
```

---

## Performance Targets

| Metric                 | Target              | Achieved            | Notes                              |
|------------------------|---------------------|---------------------|------------------------------------|
| E2E throughput         | ≥ 70k events/sec    | ~78k events/sec     | 3 consumers, 1M event benchmark    |
| Produce throughput     | ≥ 100k events/sec   | ~244k events/sec    | LZ4, acks=1, multiprocess          |
| End-to-end latency     | < 5s                | < 3s (probe batch)  | Redpanda → ClickHouse              |
| Query (last 24h)       | < 500ms             | < 200ms             | On typical analyst queries          |
| Compression ratio      | 15–20x              | 15–20x              | ZSTD on columnar data               |
| Zero message loss      | Yes                 | Yes                 | During broker/consumer restarts     |
| System uptime          | 99.9%+              | —                   | Replicated components               |

---

## File Layout

```
CLIF/
├── docker-compose.yml              # Full infrastructure stack
├── docker-compose.prod.yml         # Production overrides (auto-detect resources)
├── .env.example                    # Environment variable template
├── .env                            # Local environment (git-ignored)
├── pytest.ini                      # Pytest configuration
├── README.md                       # This file
│
├── dashboard/                      # SOC Dashboard (Next.js 14)
│   ├── src/app/                    # 12 page routes + 4 API routes
│   │   ├── dashboard/              # Overview KPIs, charts, tables
│   │   ├── live-feed/              # Real-time event stream (2s polling)
│   │   ├── search/                 # Full-text search with filters
│   │   ├── alerts/                 # Alert queue with workflow states
│   │   ├── investigations/         # Case management + detail views
│   │   ├── attack-graph/           # React Flow threat visualization
│   │   ├── ai-agents/              # AI agent cards + approval queue
│   │   ├── threat-intel/           # IOCs, patterns, MITRE mappings
│   │   ├── evidence/               # Blockchain chain-of-custody
│   │   ├── reports/                # Report templates & history
│   │   ├── system/                 # Real-time service health (Prometheus)
│   │   ├── settings/               # Configuration & user management
│   │   └── api/                    # Backend API routes
│   │       ├── metrics/            # ClickHouse aggregation queries
│   │       ├── events/stream/      # Live event polling endpoint
│   │       ├── alerts/             # Alert management
│   │       └── system/             # Prometheus + direct health checks
│   ├── src/components/             # Sidebar, TopBar, shadcn/ui
│   ├── src/lib/                    # ClickHouse, Prometheus, Redpanda clients
│   ├── src/hooks/                  # usePolling custom hook
│   ├── package.json
│   └── tailwind.config.ts
│
├── clickhouse/
│   ├── schema.sql                  # All table definitions + MVs
│   ├── keeper_config.xml           # ClickHouse Keeper config
│   ├── node01_config.xml           # Node 1 cluster + macros
│   ├── node02_config.xml           # Node 2 cluster + macros
│   ├── users.xml                   # User profiles, quotas, async_insert
│   └── storage_policy.xml          # Tiered storage (local → S3)
│
├── redpanda/
│   ├── topics.sh                   # Manual topic creation script
│   └── console-config.yml          # Redpanda Console config
│
├── consumer/
│   ├── app.py                      # Redpanda → ClickHouse pipeline
│   ├── requirements.txt            # Python dependencies
│   └── Dockerfile                  # Consumer container image
│
├── tests/
│   ├── conftest.py                 # Shared pytest fixtures & CH wrapper
│   ├── test_infrastructure.py      # Cluster health, schema, config tests
│   ├── test_data_integrity.py      # E2E pipeline validation tests
│   ├── test_performance.py         # Throughput & query benchmarks
│   ├── test_resilience.py          # Fault tolerance tests (destructive)
│   ├── realistic_load_test.py      # LANL-format 1M event load test
│   ├── performance_test.py         # Legacy standalone benchmark
│   ├── resilience_test.sh          # Legacy bash resilience test
│   └── requirements.txt            # Test dependencies
│
└── monitoring/
    ├── prometheus.yml              # Prometheus scrape config
    ├── grafana-dashboard.json      # Pre-built Grafana dashboard
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
- **Built-in Wasm** — enables in-stream PII scrubbing (future Phase 2)
- **Simpler operations** — no ZooKeeper dependency

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
# Verify connectivity
docker exec clif-consumer python -c "
from clickhouse_driver import Client
c = Client(host='clickhouse01', port=9000, user='clif_admin', password='YOUR_PASSWORD', database='clif_logs')
print(c.execute('SELECT version()'))
"
```

### S3 tiering not working
```bash
# Verify MinIO is healthy
curl http://localhost:9002/minio/health/live
# Check ClickHouse can see the disk
curl "http://localhost:8123/?query=SELECT+*+FROM+system.disks+FORMAT+Pretty"
# Verify storage policy
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

## Dashboard Pages

| Page | Route | Data Source | Description |
|------|-------|-------------|-------------|
| Dashboard | `/dashboard` | ClickHouse | KPI cards, event trend chart, severity distribution, top sources |
| Live Feed | `/live-feed` | ClickHouse (2s poll) | Real-time event stream with pause/filter/auto-scroll |
| Search | `/search` | ClickHouse | Full-text search across all tables, time/severity filters, CSV export |
| Alerts | `/alerts` | ClickHouse | Alert queue with New/Acknowledged/Investigating/Resolved workflow |
| Investigations | `/investigations` | Mock JSON | Case list with status, severity, MITRE ATT&CK tags |
| Attack Graph | `/attack-graph` | Mock JSON | React Flow canvas — lateral movement, DNS tunneling, PowerShell chains |
| AI Agents | `/ai-agents` | Mock JSON | 5 agent cards (Triage/Hunter/Verifier/Escalation/Reporter), approvals |
| Threat Intel | `/threat-intel` | Mock JSON | IOC table with type/confidence/MITRE, threat pattern cards |
| Evidence | `/evidence` | Mock JSON | Blockchain chain-of-custody, Merkle roots, batch history |
| Reports | `/reports` | Mock JSON | Report templates & historical reports |
| System Health | `/system` | Prometheus + Direct | Real-time service status for all infrastructure components |
| Settings | `/settings` | Static | Config, data sources, notifications, integrations, users, API keys |

---

## Next Steps (Week 2+)

- **Week 2**: Tetragon eBPF integration → events flow into `process_events` and `network_events`
- **Week 3**: Data quality framework, query optimization, full-text search improvements
- **Week 4**: Exonum blockchain anchoring — `anchor_tx_id` columns get populated
- **Week 5**: LanceDB vector embeddings for semantic log search
- **Week 6**: DSPy anomaly detection consuming from these tables

---

*CLIF Stage 3 — Storage + SOC Dashboard — v2.0*
