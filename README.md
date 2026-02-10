# CLIF Storage Infrastructure — Week 1 Deliverable

> **Cognitive Log Investigation Framework** — Stage 3 Prototype  
> Foundation layer: ClickHouse + Redpanda + MinIO (S3) with consumer pipeline, monitoring, and test suites.

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
│           12 partitions each, RF=2, 7-day retention, ZSTD compression │
└────────────────────────────┬──────────────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│  CLIF Consumer  (Python — confluent-kafka + clickhouse-connect)      │
│                                                                       │
│  • Reads all 4 topics in a single consumer group                     │
│  • Batches events (5 000 default) or flushes every 2 s               │
│  • Retries with exponential back-off on ClickHouse failures          │
│  • Manual offset commit after successful flush                        │
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
6. CLIF consumer  
7. Redpanda Console  
8. Prometheus & Grafana  

### 3. Verify everything is healthy

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

### 4. Access web UIs

| Service           | URL                        | Credentials                  |
|-------------------|----------------------------|------------------------------|
| Redpanda Console  | http://localhost:8080       | (no auth)                    |
| MinIO Console     | http://localhost:9003       | clif_minio_admin / (see .env)|
| Grafana           | http://localhost:3000       | admin / (see .env)           |
| Prometheus        | http://localhost:9090       | (no auth)                    |
| ClickHouse HTTP   | http://localhost:8123       | clif_admin / (see .env)      |

---

## Running Tests

### Install test dependencies

```bash
pip install -r tests/requirements.txt
```

### Performance test

```bash
# Default: 1M events, target 100k/s, 60s sustained
python tests/performance_test.py

# Custom parameters
python tests/performance_test.py --events 500000 --rate 50000 --duration 120
```

**What it measures:**
1. **Burst produce** — max throughput to Redpanda
2. **End-to-end latency** — tagged events from Redpanda to ClickHouse
3. **Query performance** — 8 representative analyst queries
4. **Sustained ingestion** — constant-rate stability over time

### Resilience test

```bash
bash tests/resilience_test.sh
```

**What it validates:**
1. Service health checks (all components reachable)
2. Redpanda broker restart — zero message loss
3. ClickHouse node failover — queries still work
4. Consumer recovery after restart
5. S3 tiering configuration
6. Schema integrity (all tables and MVs exist)
7. Topic verification

---

## Performance Targets

| Metric                 | Target              | Notes                              |
|------------------------|---------------------|------------------------------------|
| Ingestion throughput   | ≥ 100k events/sec   | Burst & sustained                  |
| End-to-end latency     | < 500ms             | Redpanda → ClickHouse              |
| Query (last 24h)       | < 500ms             | On typical analyst queries          |
| Query (last 30d)       | < 1s                | Full-text and aggregation           |
| Compression ratio      | 15–20x              | ZSTD on columnar data               |
| Zero message loss      | Yes                 | During broker/consumer restarts     |
| System uptime          | 99.9%+              | Replicated components               |

---

## File Layout

```
CLIF/
├── docker-compose.yml              # Full infrastructure stack
├── .env.example                    # Environment variable template
├── README.md                       # This file
│
├── clickhouse/
│   ├── schema.sql                  # All table definitions + MVs
│   ├── keeper_config.xml           # ClickHouse Keeper config
│   ├── node01_config.xml           # Node 1 cluster + macros
│   ├── node02_config.xml           # Node 2 cluster + macros
│   ├── users.xml                   # User profiles and quotas
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
│   ├── performance_test.py         # Load & latency benchmarks
│   ├── resilience_test.sh          # Failure scenario validation
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
- **Flexible batching** — tunable batch size + time-based flush
- **Offset control** — manual commit after confirmed ClickHouse insert
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
import clickhouse_connect
c = clickhouse_connect.get_client(host='clickhouse01', port=8123, username='clif_admin', password='clif_secure_password_change_me')
print(c.query('SELECT version()').result_rows)
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

## Next Steps (Week 2+)

- **Week 2**: Tetragon eBPF integration → events flow into `process_events` and `network_events`
- **Week 3**: Data quality framework, query optimization, full-text search improvements
- **Week 4**: Exonum blockchain anchoring — `anchor_tx_id` columns get populated
- **Week 5**: LanceDB vector embeddings for semantic log search
- **Week 6**: DSPy anomaly detection consuming from these tables

---

*CLIF Stage 3 — Storage Infrastructure — v1.0*
