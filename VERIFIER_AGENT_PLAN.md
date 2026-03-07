# CLIF Verifier Agent — Implementation Plan

> **Version:** 1.0  
> **Date:** 2025-07-14  
> **Pipeline Impact:** ZERO — All changes are purely additive  
> **Status:** Ready for implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Pipeline Architecture](#2-current-pipeline-architecture)
3. [What Already Exists](#3-what-already-exists-infrastructure-stubs)
4. [Verifier Agent Purpose & Role](#4-verifier-agent-purpose--role)
5. [Architecture & Data Flow](#5-architecture--data-flow)
6. [Kafka Integration](#6-kafka-integration)
7. [ClickHouse Integration](#7-clickhouse-integration)
8. [LanceDB Integration](#8-lancedb-integration)
9. [Merkle Service Integration](#9-merkle-service-integration)
10. [File Structure](#10-file-structure)
11. [Module-by-Module Design](#11-module-by-module-design)
12. [Data Models](#12-data-models)
13. [Configuration](#13-configuration)
14. [Docker Integration](#14-docker-integration)
15. [Health & Monitoring](#15-health--monitoring)
16. [Implementation Phases](#16-implementation-phases)
17. [Safety Checklist — Zero Disruption Guarantee](#17-safety-checklist--zero-disruption-guarantee)
18. [Dependencies & Requirements](#18-dependencies--requirements)
19. [Testing Strategy](#19-testing-strategy)

---

## 1. Executive Summary

The **Verifier Agent** is the third AI agent in the CLIF pipeline. It sits **after the Hunter Agent** and acts as an independent forensic validator — a "second opinion" on every Hunter verdict before it reaches SOC analysts.

### Why it exists

The Hunter Agent is optimized for **speed and coverage** — it processes escalated events through Sigma rules, SPC analysis, graph building, temporal correlation, and ML scoring to produce verdicts. But speed-optimized systems produce false positives. The Verifier Agent trades speed for **depth and accuracy**:

| Concern | Hunter Agent | Verifier Agent |
|---------|-------------|----------------|
| Priority | Speed (concurrent L1/L2 threads) | Accuracy (sequential deep verification) |
| Evidence | Generates evidence from queries | Validates evidence integrity via Merkle |
| IOC check | Single lookup in `ioc_cache` | Multi-source cross-correlation |
| History | 15-min investigation window | Full timeline reconstruction |
| False positives | Flags `NORMAL_BEHAVIOUR` | Learns from `feedback_labels` |
| Output | `finding_type` + `hunter_score` | `verdict` (TP/FP/inconclusive) + `priority` (P1-P4) |

### Key design constraint

> **"Make sure the changes you make would not affect my existing pipeline a bit"**

The Verifier Agent is **100% additive**. It:
- Creates NO modifications to any existing service (Triage, Hunter, Consumer, Vector, etc.)
- Consumes `hunter-results` Kafka topic using its **own independent consumer group**
- Publishes to `verifier-results` topic (already created, already consumed by Consumer)
- Writes to `verifier_results` ClickHouse table (already created, consumer row builder already exists)
- All existing data flows continue exactly as they are

---

## 2. Current Pipeline Architecture

```
Log Sources → Vector → Redpanda
                         │
              ┌──────────┼──────────────────────┐
              │          │                       │
              ▼          ▼                       ▼
         raw-logs   security-events    process-events / network-events
              │          │                       │
              └──────────┼───────────────────────┘
                         │
                ┌────────┴────────┐
                ▼                 ▼
           Consumer ×3      Triage Agent ×4
           (→ ClickHouse)   (LightGBM+EIF+ARF)
                                  │
                     ┌────────────┼────────────┐
                     ▼            ▼            ▼
              triage-scores  anomaly-alerts  hunter-tasks
                     │                         │
                     │                    ┌────┘
                     ▼                    ▼
              Consumer ×3          Hunter Agent
           (→ triage_scores)   (Sigma+SPC+CatBoost)
                                      │
                                      ▼
                               hunter-results
                                      │
                        ┌─────────────┴─────────────┐
                        ▼                           ▼
                 Consumer ×3                 ┌──────────────┐
              (→ hunter_investigations)      │ VERIFIER     │ ← NEW
                                             │ AGENT        │
                                             └──────┬───────┘
                                                    ▼
                                             verifier-results
                                                    │
                                                    ▼
                                             Consumer ×3
                                          (→ verifier_results)
```

The Verifier Agent taps into `hunter-results` as a **parallel reader** (separate consumer group). The existing Consumer continues reading `hunter-results` into `hunter_investigations` exactly as before — both consumer groups read independently from the same topic.

---

## 3. What Already Exists (Infrastructure Stubs)

The CLIF infrastructure was forward-designed with the Verifier in mind. These components already exist and require **NO modification**:

### 3.1 Kafka Topics (in `redpanda/topics.sh`)

| Topic | Partitions | RF | Status |
|-------|-----------|-----|--------|
| `verifier-tasks` | 6 | 3 | Created by `redpanda-init` — available for future selective routing |
| `verifier-results` | 6 | 3 | Created by `redpanda-init` — the Verifier's output topic |

### 3.2 ClickHouse Schema (in `schema_local.sql` + `schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS clif_logs.verifier_results (
    verification_id   UUID          DEFAULT generateUUIDv4(),
    investigation_id  UUID,
    alert_id          UUID,
    started_at        DateTime64(3) DEFAULT now64(),
    completed_at      Nullable(DateTime64(3)),
    status            Enum8('pending'=0, 'running'=1, 'verified'=2,
                            'false_positive'=3, 'inconclusive'=4, 'failed'=5),
    verdict           Enum8('true_positive'=1, 'false_positive'=2, 'inconclusive'=3),
    confidence        Float32       DEFAULT 0.0,
    evidence_verified UInt8         DEFAULT 0,
    merkle_batch_ids  Array(String),
    timeline_json     String,
    ioc_correlations  String,
    priority          Enum8('P4'=0, 'P3'=1, 'P2'=2, 'P1'=3),
    recommended_action String,
    analyst_summary   String
);
```

### 3.3 Consumer Mapping (in `consumer/app.py`)

```python
TOPIC_TABLE_MAP = {
    ...
    "verifier-results": "verifier_results",   # Already mapped
    ...
}
# _build_verifier_result_row() — Already implemented (14 columns)
# VERIFIER_RESULTS_COLUMNS — Already defined
# TABLE_META["verifier_results"] — Already registered
```

### 3.4 Dashboard UI (in `dashboard/src/`)

| Page | Verifier Reference |
|------|-------------------|
| `/ai-agents` | Purple-themed Verifier card with Eye icon |
| `/investigations/[id]` | "Verifier Agent confirmed as true positive" timeline entry |
| `/investigations/live/[id]` | Verifier Agent actor with purple styling |

### Summary: The Verifier Agent only needs the **agent code itself** and a **docker-compose entry**. Everything else is already wired.

---

## 4. Verifier Agent Purpose & Role

### 4.1 Core Mission

The Verifier Agent performs **independent forensic validation** of every Hunter verdict. It does NOT re-run the Hunter's analysis — it validates the Hunter's conclusions through orthogonal evidence:

| Verification Module | Question It Answers |
|---|---|
| **Evidence Integrity** | Was the underlying log data tampered with? (Merkle verification) |
| **IOC Cross-Correlation** | Do external threat intel sources corroborate the IOCs? |
| **Timeline Reconstruction** | Does the event sequence make logical sense? |
| **False Positive Analysis** | Has an analyst previously marked similar events as FP? |
| **Confidence Calibration** | What is the overall confidence after all checks? |

### 4.2 What It Consumes

The Verifier reads the full `HunterVerdict` payload from the `hunter-results` Kafka topic:

```json
{
  "alert_id": "uuid",
  "started_at": "ISO-8601",
  "completed_at": "ISO-8601",
  "status": "COMPLETED",
  "hostname": "WORKSTATION-01",
  "source_ip": "192.168.1.100",
  "user_id": "jdoe",
  "trigger_score": 0.85,
  "severity": "HIGH",
  "finding_type": "CONFIRMED_ATTACK",
  "summary": "...",
  "evidence_json": "{...}",
  "correlated_events": ["uuid1", "uuid2"],
  "mitre_tactics": ["lateral-movement"],
  "mitre_techniques": ["T1021"],
  "recommended_action": "...",
  "confidence": 0.78
}
```

### 4.3 What It Produces

Publishes to `verifier-results` (matching `VERIFIER_RESULTS_COLUMNS`):

```json
{
  "investigation_id": "uuid-v4",
  "alert_id": "uuid (from hunter)",
  "started_at": "ISO-8601",
  "completed_at": "ISO-8601",
  "status": "verified|false_positive|inconclusive|failed",
  "verdict": "true_positive|false_positive|inconclusive",
  "confidence": 0.92,
  "evidence_verified": 1,
  "merkle_batch_ids": ["batch-uuid-1"],
  "timeline_json": "{...}",
  "ioc_correlations": "{...}",
  "priority": "P1|P2|P3|P4",
  "recommended_action": "Isolate host, revoke credentials",
  "analyst_summary": "Verified lateral movement via RDP..."
}
```

### 4.4 Verdict Decision Matrix

| Hunter finding_type | Hunter confidence | Evidence intact | IOC corroborated | FP history | → Verdict | → Priority |
|---|---|---|---|---|---|---|
| `CONFIRMED_ATTACK` | ≥ 0.80 | Yes | Yes | No | `true_positive` | **P1** |
| `CONFIRMED_ATTACK` | ≥ 0.80 | Yes | No | No | `true_positive` | **P2** |
| `CONFIRMED_ATTACK` | < 0.80 | Yes | — | No | `true_positive` | **P2** |
| `ACTIVE_CAMPAIGN` | Any | Yes | — | No | `true_positive` | **P1** |
| `BEHAVIOURAL_ANOMALY` | ≥ 0.60 | Yes | Yes | No | `true_positive` | **P2** |
| `BEHAVIOURAL_ANOMALY` | ≥ 0.60 | Yes | No | No | `inconclusive` | **P3** |
| `BEHAVIOURAL_ANOMALY` | < 0.60 | — | — | No | `inconclusive` | **P3** |
| Any `DEFINITE_POSITIVE` | Any | No (tampered) | — | — | `inconclusive` | **P2** |
| Any `AMBIGUOUS` | Any | — | — | Yes | `false_positive` | **P4** |
| `NORMAL_BEHAVIOUR` | Any | — | — | — | `false_positive` | **P4** |
| `FALSE_POSITIVE` | Any | — | — | — | `false_positive` | **P4** |
| Any | Any | Error | — | — | `inconclusive` | **P3** |

---

## 5. Architecture & Data Flow

```
                                    hunter-results (Kafka)
                                            │
                                            │ Consumer Group: clif-verifier-agent
                                            ▼
                              ┌──────────────────────────────┐
                              │     VERIFIER AGENT           │
                              │     (FastAPI + aiokafka)     │
                              │     Port: 8500               │
                              │                              │
                              │  ① Parse HunterVerdict       │
                              │  ② Skip if NORMAL/FP type    │
                              │     (optional gate)          │
                              │                              │
                              │  ③ Verification Modules:     │
                              │     ├─ Evidence Integrity    │─── ClickHouse: evidence_anchors
                              │     │  (Merkle verification) │─── Merkle Service (optional)
                              │     │                        │
                              │     ├─ IOC Cross-Correlator  │─── ClickHouse: ioc_cache
                              │     │                        │─── ClickHouse: network_events
                              │     │                        │
                              │     ├─ Timeline Builder      │─── ClickHouse: raw_logs
                              │     │                        │─── ClickHouse: triage_scores
                              │     │                        │─── ClickHouse: hunter_investigations
                              │     │                        │
                              │     ├─ FP Pattern Analyzer   │─── ClickHouse: feedback_labels
                              │     │                        │─── LanceDB: attack_embeddings
                              │     │                        │
                              │     └─ Confidence Calibrator │
                              │                              │
                              │  ④ Verdict Decision Matrix   │
                              │  ⑤ Summary Builder           │
                              │  ⑥ Publish to verifier-results│
                              └──────────────┬───────────────┘
                                             │
                                             ▼
                                    verifier-results (Kafka)
                                             │
                                             ▼
                                    Consumer ×3 (existing)
                                             │
                                             ▼
                                    ClickHouse: verifier_results
```

### Key Integration Points

| What | How | Existing Impact |
|------|-----|----------------|
| Read `hunter-results` | aiokafka consumer, group `clif-verifier-agent` | NONE — separate consumer group |
| Query ClickHouse | `clickhouse-connect` HTTP client (:8123) | Read-only queries only |
| Query LanceDB | `httpx` REST client (:8100) | Read-only queries only |
| Write `verifier-results` | aiokafka producer | Consumer already handles this topic |
| Docker networking | `clif-backend` + `clif-storage` | Additive network membership |

---

## 6. Kafka Integration

### 6.1 Consumer

```
Topic:          hunter-results  (already exists, 6 partitions, RF=3)
Consumer Group: clif-verifier-agent  (NEW — does not interfere with clif-clickhouse-consumer)
Offset Reset:   earliest
Max Poll:       5 (slower processing per message is acceptable)
Deserializer:   JSON (UTF-8)
```

This is safe because Kafka/Redpanda supports unlimited independent consumer groups reading the same topic. The existing `clif-clickhouse-consumer` group continues consuming `hunter-results` into `hunter_investigations` completely unaffected.

### 6.2 Producer

```
Topic:          verifier-results  (already exists, 6 partitions, RF=3)
Key:            alert_id (bytes) — same partition as Hunter for ordering
Compression:    lz4
Acks:           all
Serializer:     JSON (UTF-8)
```

### 6.3 No Topic Changes Required

Both `verifier-tasks` and `verifier-results` topics already exist. The `verifier-tasks` topic remains available for future selective routing (Phase 3) but is not needed in Phase 1.

---

## 7. ClickHouse Integration

### 7.1 Tables READ by Verifier (all existing — no modifications)

| Table | Module | Query Purpose |
|-------|--------|--------------|
| `evidence_anchors` | Evidence Integrity | Find Merkle batches covering the alert's time window |
| `ioc_cache` | IOC Cross-Correlator | Look up IOC entries by IP, domain, hash |
| `network_events` | IOC Cross-Correlator | Find related network flows for the source_ip |
| `raw_logs` | Timeline Builder | Full raw event history for the entity |
| `triage_scores` | Timeline Builder | Triage scoring history for the entity |
| `hunter_investigations` | Timeline Builder | Prior Hunter verdicts for the entity |
| `feedback_labels` | FP Pattern Analyzer | Historical analyst feedback on similar events |
| `verifier_results` | FP Pattern Analyzer | Prior Verifier verdicts for same source_ip/hostname |

### 7.2 Tables WRITTEN by Verifier

**NONE directly.** The Verifier publishes to `verifier-results` Kafka topic → Consumer writes to `verifier_results` table. This follows the same pattern as Hunter (publishes to `hunter-results` → Consumer writes to `hunter_investigations`).

### 7.3 No Schema Changes Required

The `verifier_results` table already exists in both `schema_local.sql` and `schema.sql` with all required columns.

---

## 8. LanceDB Integration

### 8.1 Tables Queried (read-only)

| Table | Module | Purpose |
|-------|--------|---------|
| `attack_embeddings` | FP Pattern Analyzer | Find confirmed attacks similar to this verdict — if many confirmed neighbors exist, supports TP verdict |
| `historical_incidents` | FP Pattern Analyzer | Find historical incidents similar to this event pattern |

### 8.2 Endpoint

```
POST http://lancedb:8100/tables/attack_embeddings/search
POST http://lancedb:8100/tables/historical_incidents/search
```

Same HTTP API the Hunter's `similarity_searcher.py` already uses. Read-only, no writes.

---

## 9. Merkle Service Integration

### 9.1 How Evidence Integrity Works

The Merkle Service (`merkle-service/merkle_anchor.py`) anchors batches of events every 30 minutes. Each batch record in `evidence_anchors` contains:
- `batch_id`
- `merkle_root` (SHA-256)
- `event_count`
- `time_range_start` / `time_range_end`
- `previous_root` (chaining)
- `proof_s3_key` (MinIO object with full proof JSON)

### 9.2 Verifier's Evidence Check

1. Query `evidence_anchors` for batches overlapping the alert's timestamp
2. If batch found → `evidence_verified = 1`, collect `merkle_batch_ids`
3. If no batch found (event too recent for anchoring) → `evidence_verified = 0`, note in summary
4. If batch found but root chain broken → flag as tampered, force `inconclusive` verdict

**No direct Merkle Service API call needed** — the ClickHouse table is sufficient for basic integrity verification. The Verifier does NOT re-compute Merkle trees (that would duplicate the Merkle Service's work).

---

## 10. File Structure

```
agents/verifier/
├── app.py                    # Main FastAPI + Kafka consumer loop
├── config.py                 # Environment-based configuration
├── models.py                 # Data models (VerifierResult, etc.)
├── verdict_engine.py         # Verdict decision matrix + final scoring
├── summary_builder.py        # Analyst-friendly summary generation
├── output_writer.py          # Kafka producer (publish to verifier-results)
├── utils.py                  # Shared utilities (sanitize_sql, safe parsers)
├── verification/
│   ├── __init__.py
│   ├── evidence_integrity.py # Merkle batch verification via ClickHouse
│   ├── ioc_correlator.py     # Cross-reference IOC cache + network events
│   ├── timeline_builder.py   # Reconstruct full event timeline
│   └── fp_analyzer.py        # False positive pattern detection
├── Dockerfile
└── requirements.txt
```

**Total: 14 files** (12 Python + 1 Dockerfile + 1 requirements.txt)

---

## 11. Module-by-Module Design

### 11.1 `app.py` — Main Entry Point

**Responsibilities:**
- FastAPI server on port 8500 with `/health`, `/stats`, `/ready` endpoints
- aiokafka consumer reading `hunter-results` (group: `clif-verifier-agent`)
- aiokafka producer writing `verifier-results`
- Startup health gates: Kafka reachable, ClickHouse connected
- Process pipeline: parse → verify → decide → summarize → publish

**Pipeline per message:**

```
HunterVerdict payload
    │
    ├── Gate check: skip NORMAL_BEHAVIOUR / FALSE_POSITIVE (configurable)
    │
    ├── evidence_integrity.verify(payload)  → EvidenceResult
    ├── ioc_correlator.correlate(payload)   → IOCResult
    ├── timeline_builder.build(payload)     → TimelineResult
    ├── fp_analyzer.analyze(payload)        → FPResult
    │
    ├── verdict_engine.decide(evidence, ioc, timeline, fp, payload)
    │       → verdict, confidence, priority
    │
    ├── summary_builder.build(all_results)
    │       → analyst_summary, recommended_action
    │
    └── output_writer.publish(verifier-results, result)
```

**No batch processing needed** — the Verifier runs one deep investigation per message (unlike Triage which batches 1000 events). Hunter only produces ~tens of verdicts per minute, so sequential processing is fine.

### 11.2 `config.py` — Configuration

All values from environment variables with sane defaults:

```python
# Kafka
KAFKA_BROKERS = "redpanda01:9092"
CONSUMER_GROUP_ID = "clif-verifier-agent"
TOPIC_INPUT = "hunter-results"          # Reads from Hunter output
TOPIC_OUTPUT = "verifier-results"       # Writes verified results
KAFKA_AUTO_OFFSET_RESET = "earliest"
KAFKA_MAX_POLL_RECORDS = 5

# ClickHouse
CLICKHOUSE_HOST = "clickhouse01"
CLICKHOUSE_PORT = 8123
CLICKHOUSE_USER = "clif_admin"
CLICKHOUSE_PASSWORD = "clif_secure_password_change_me"
CLICKHOUSE_DATABASE = "clif_logs"

# LanceDB
LANCEDB_URL = "http://lancedb:8100"
LANCEDB_TIMEOUT_SEC = 5.0

# Verifier
VERIFIER_PORT = 8500
LOG_LEVEL = "INFO"
SKIP_NEGATIVE_VERDICTS = True    # Skip NORMAL_BEHAVIOUR / FALSE_POSITIVE from Hunter
TIMELINE_WINDOW_HOURS = 24       # How far back to build timeline
FP_SIMILARITY_THRESHOLD = 0.3    # LanceDB distance threshold for FP matching
IOC_LOOKBACK_HOURS = 72          # IOC correlation lookback window
EVIDENCE_LOOKBACK_HOURS = 2      # Merkle batch search window around event
```

### 11.3 `models.py` — Data Models

```python
@dataclass
class EvidenceResult:
    evidence_verified: bool          # True if Merkle batch found covering event
    merkle_batch_ids: List[str]      # Batch IDs that cover this event's window
    chain_intact: bool               # True if previous_root chain is unbroken
    coverage_gap: bool               # True if event falls outside any batch window

@dataclass
class IOCResult:
    corroborated: bool               # True if IOCs from Hunter are confirmed in ioc_cache
    ioc_matches: List[Dict]          # Detailed matches: {type, value, confidence, source}
    network_flows_found: int         # Related network events for the source_ip
    correlation_json: str            # JSON string of all correlation evidence

@dataclass
class TimelineResult:
    event_count: int                 # Total events in timeline window
    raw_events: int                  # Events from raw_logs
    triage_events: int               # Events from triage_scores
    hunter_events: int               # Prior Hunter verdicts for this entity
    timeline_json: str               # JSON string: chronological event list
    sequence_coherent: bool          # True if timestamps form logical sequence

@dataclass
class FPResult:
    has_fp_history: bool             # True if analyst previously marked similar events as FP
    fp_feedback_count: int           # Number of feedback_labels with label=false_positive
    tp_feedback_count: int           # Number of feedback_labels with label=true_positive
    similar_attack_count: int        # LanceDB: confirmed attacks with distance < threshold
    fp_confidence: float             # 0-1 score: likelihood this is a false positive

@dataclass
class VerifierVerdict:
    """Matches the VERIFIER_RESULTS_COLUMNS expected by consumer/app.py."""
    investigation_id: str            # UUID-v4 for this verification
    alert_id: str                    # From Hunter (links to hunter_investigations)
    started_at: str                  # ISO-8601
    completed_at: str                # ISO-8601
    status: str                      # pending|running|verified|false_positive|inconclusive|failed
    verdict: str                     # true_positive|false_positive|inconclusive
    confidence: float                # 0.0-1.0
    evidence_verified: int           # 0 or 1
    merkle_batch_ids: List[str]      # Merkle batch IDs
    timeline_json: str               # Full timeline JSON
    ioc_correlations: str            # IOC correlation JSON
    priority: str                    # P1|P2|P3|P4
    recommended_action: str          # Action string for analyst
    analyst_summary: str             # Human-readable investigation summary
```

### 11.4 `verification/evidence_integrity.py`

**Purpose:** Verify that the log data underlying a Hunter verdict has not been tampered with.

**ClickHouse queries (READ-ONLY):**

```sql
-- Find Merkle batches covering the event's timestamp
SELECT batch_id, merkle_root, event_count, time_range_start, time_range_end,
       previous_root, source_table
FROM evidence_anchors
WHERE time_range_start <= {event_ts} + INTERVAL {lookback} HOUR
  AND time_range_end >= {event_ts} - INTERVAL {lookback} HOUR
ORDER BY time_range_start DESC
LIMIT 10

-- Verify chain integrity: previous root must match
SELECT batch_id, merkle_root, previous_root
FROM evidence_anchors
WHERE source_table = {table}
ORDER BY time_range_start DESC
LIMIT 5
```

**Outputs:** `EvidenceResult` with `evidence_verified`, `merkle_batch_ids`, `chain_intact`.

### 11.5 `verification/ioc_correlator.py`

**Purpose:** Cross-reference the Hunter's IOC findings with the current IOC cache and network event patterns.

**ClickHouse queries (READ-ONLY):**

```sql
-- Check if source_ip or any IPs from evidence are in IOC cache
SELECT ioc_type, ioc_value, confidence, source, expires_at
FROM ioc_cache
WHERE ioc_value IN ({ip_list})
  AND expires_at > now()

-- Find network flows involving the source_ip (corroborating evidence)
SELECT dst_ip, dst_port, protocol, event_ts, bytes_sent, bytes_received
FROM network_events
WHERE source_ip = {source_ip}
  AND event_ts >= now() - INTERVAL {lookback} HOUR
ORDER BY event_ts DESC
LIMIT 50

-- Check for connections to known-bad IPs
SELECT ne.dst_ip, ne.dst_port, ic.confidence, ic.source
FROM network_events ne
INNER JOIN ioc_cache ic ON ne.dst_ip = ic.ioc_value
WHERE ne.source_ip = {source_ip}
  AND ne.event_ts >= now() - INTERVAL {lookback} HOUR
  AND ic.ioc_type = 'ip'
  AND ic.expires_at > now()
```

**Outputs:** `IOCResult` with `corroborated`, `ioc_matches`, `network_flows_found`, `correlation_json`.

### 11.6 `verification/timeline_builder.py`

**Purpose:** Build a chronological timeline of the entity's activity to verify the Hunter's narrative makes sense.

**ClickHouse queries (READ-ONLY):**

```sql
-- Raw events for the entity in the timeline window
SELECT event_id, event_ts, source_type, hostname, source_ip, log_level,
       message
FROM raw_logs
WHERE (hostname = {hostname} OR source_ip = {source_ip})
  AND event_ts >= {event_ts} - INTERVAL {window} HOUR
  AND event_ts <= {event_ts} + INTERVAL 1 HOUR
ORDER BY event_ts ASC
LIMIT 200

-- Triage scores for the entity
SELECT event_id, timestamp, source_type, combined_score, adjusted_score,
       action, mitre_tactic, mitre_technique
FROM triage_scores
WHERE (hostname = {hostname} OR source_ip = {source_ip})
  AND timestamp >= {event_ts} - INTERVAL {window} HOUR
ORDER BY timestamp ASC
LIMIT 100

-- Prior Hunter investigations for the entity
SELECT alert_id, started_at, severity, finding_type, summary, confidence,
       mitre_tactics, mitre_techniques
FROM hunter_investigations
WHERE (hostname = {hostname} OR source_ip = {source_ip})
  AND started_at >= {event_ts} - INTERVAL {window} HOUR
ORDER BY started_at ASC
LIMIT 50
```

**Outputs:** `TimelineResult` with `event_count`, chronological `timeline_json`, `sequence_coherent`.

### 11.7 `verification/fp_analyzer.py`

**Purpose:** Detect false positive patterns by checking analyst feedback history and LanceDB similarity.

**ClickHouse queries (READ-ONLY):**

```sql
-- Check analyst feedback for similar events (same source_ip or hostname)
SELECT label, confidence, notes, timestamp
FROM feedback_labels fl
INNER JOIN triage_scores ts ON fl.event_id = ts.event_id
WHERE (ts.hostname = {hostname} OR ts.source_ip = {source_ip})
  AND fl.timestamp >= now() - INTERVAL 30 DAY
ORDER BY fl.timestamp DESC
LIMIT 20

-- Check prior Verifier verdicts for this entity
SELECT verdict, confidence, priority, started_at
FROM verifier_results
WHERE alert_id IN (
    SELECT alert_id FROM hunter_investigations
    WHERE (hostname = {hostname} OR source_ip = {source_ip})
      AND started_at >= now() - INTERVAL 7 DAY
)
ORDER BY started_at DESC
LIMIT 10
```

**LanceDB queries (READ-ONLY):**

```
POST /tables/attack_embeddings/search
{
  "query": "{hostname} {source_ip} {mitre_tactics} {finding_type}",
  "limit": 10
}
```

**False-positive confidence formula:**

```
fp_score = (fp_feedback_count / (fp_feedback_count + tp_feedback_count + 1))
           × (1 - similar_attack_ratio)
           × feedback_recency_weight
```

Where `similar_attack_ratio = similar_attack_count / max(1, total_search_results)`.

If `fp_score > 0.6` → `has_fp_history = True`.

**Outputs:** `FPResult` with `has_fp_history`, `fp_confidence`.

### 11.8 `verdict_engine.py`

**Purpose:** Implements the verdict decision matrix from Section 4.4.

**Input:** All four verification results + original Hunter payload.

**Logic (pseudocode):**

```python
def decide(hunter_payload, evidence, ioc, timeline, fp):

    finding_type = hunter_payload["finding_type"]
    hunter_conf = hunter_payload["confidence"]

    # False positive detected
    if fp.has_fp_history and finding_type not in DEFINITE_POSITIVE_TYPES:
        return "false_positive", fp.fp_confidence, "P4"

    # Evidence tampered — force inconclusive regardless
    if evidence.evidence_verified and not evidence.chain_intact:
        return "inconclusive", 0.5, "P2"

    # Definite positives from Hunter
    if finding_type in ("CONFIRMED_ATTACK", "ACTIVE_CAMPAIGN"):
        if hunter_conf >= 0.80 and ioc.corroborated:
            priority = "P1"
        elif finding_type == "ACTIVE_CAMPAIGN":
            priority = "P1"
        else:
            priority = "P2"
        # Calibrated confidence
        conf = _calibrate(hunter_conf, evidence, ioc, fp)
        return "true_positive", conf, priority

    # Ambiguous types
    if finding_type in ("BEHAVIOURAL_ANOMALY", "ANOMALOUS_PATTERN", "SIGMA_MATCH"):
        if hunter_conf >= 0.60 and ioc.corroborated:
            return "true_positive", _calibrate(hunter_conf, evidence, ioc, fp), "P2"
        if hunter_conf >= 0.60:
            return "inconclusive", _calibrate(hunter_conf, evidence, ioc, fp), "P3"
        return "inconclusive", hunter_conf * 0.8, "P3"

    # Negative types
    return "false_positive", max(0.7, 1 - hunter_conf), "P4"
```

**Confidence calibration formula:**

```
calibrated = base_conf × (
    0.40                                        # Hunter weight
    + 0.20 × evidence.evidence_verified         # Evidence boost
    + 0.20 × ioc.corroborated                  # IOC boost
    + 0.10 × (1 - fp.fp_confidence)            # FP penalty
    + 0.10 × timeline.sequence_coherent         # Timeline boost
)
```

### 11.9 `summary_builder.py`

**Purpose:** Generate analyst-friendly verification summary.

**Format:**

```
VERIFICATION: alert_id={id} | host={hostname} | src={ip} | user={user}
HUNTER VERDICT: {finding_type} (conf={confidence}, severity={severity})
EVIDENCE: {verified|unverified} | merkle_batches={count} | chain={intact|broken|unknown}
IOC: {corroborated|not_found} | matches={count} | flows={count}
TIMELINE: {count} events | {raw} raw / {triage} triage / {hunter} hunter | sequence={coherent|broken}
FP CHECK: {clean|flagged} | fp_history={count} | tp_history={count} | similar_attacks={count}
KILL CHAIN: {mitre_tactics}
VERIFIER VERDICT: {verdict} (conf={confidence:.2f}) | priority={priority}
ACTION: {recommended_action}
```

### 11.10 `output_writer.py`

**Purpose:** Serialize `VerifierVerdict` to JSON and publish to `verifier-results` Kafka topic.

**Message key:** `alert_id` (bytes) — same as Hunter for partition affinity.

**Fields published:** Exactly the 14 fields expected by `_build_verifier_result_row()` in consumer/app.py:

```python
{
    "investigation_id", "alert_id", "started_at", "completed_at",
    "status", "verdict", "confidence", "evidence_verified",
    "merkle_batch_ids", "timeline_json", "ioc_correlations",
    "priority", "recommended_action", "analyst_summary"
}
```

### 11.11 `utils.py`

**Purpose:** Shared utilities. Contains `sanitize_sql()` (same implementation as Hunter's `utils.py`) for ClickHouse query parameter sanitization.

---

## 12. Data Models

### 12.1 Hunter → Verifier Message (Input)

| Field | Type | Source |
|-------|------|--------|
| `alert_id` | string (UUID) | Hunter-assigned (mapped from triage's `event_id`) |
| `started_at` | string (ISO-8601) | Hunter investigation start |
| `completed_at` | string (ISO-8601) | Hunter investigation end |
| `status` | string | `COMPLETED` / `FAST_PATH` / `ERROR` |
| `hostname` | string | From triage payload |
| `source_ip` | string | From triage payload |
| `user_id` | string | From triage payload |
| `trigger_score` | float | Triage `adjusted_score` |
| `severity` | string | `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` |
| `finding_type` | string | Hunter verdict category |
| `summary` | string | Hunter narrative |
| `evidence_json` | string | JSON evidence dict |
| `correlated_events` | string[] | Related alert UUIDs |
| `mitre_tactics` | string[] | ATT&CK tactics |
| `mitre_techniques` | string[] | ATT&CK techniques |
| `recommended_action` | string | Hunter's recommended action |
| `confidence` | float | Hunter confidence score |

### 12.2 Verifier → Consumer Message (Output)

| Field | Type | Maps to CH Column |
|-------|------|-------------------|
| `investigation_id` | string (UUID-v4) | `investigation_id` |
| `alert_id` | string (UUID) | `alert_id` |
| `started_at` | string (ISO-8601) | `started_at` |
| `completed_at` | string (ISO-8601, nullable) | `completed_at` |
| `status` | string (Enum8) | `status` |
| `verdict` | string (Enum8) | `verdict` |
| `confidence` | float (0-1) | `confidence` |
| `evidence_verified` | int (0/1) | `evidence_verified` |
| `merkle_batch_ids` | string[] | `merkle_batch_ids` |
| `timeline_json` | string (JSON) | `timeline_json` |
| `ioc_correlations` | string (JSON) | `ioc_correlations` |
| `priority` | string (Enum8) | `priority` |
| `recommended_action` | string | `recommended_action` |
| `analyst_summary` | string | `analyst_summary` |

---

## 13. Configuration

### 13.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_BROKERS` | `redpanda01:9092` | Kafka bootstrap servers |
| `CONSUMER_GROUP_ID` | `clif-verifier-agent` | Kafka consumer group |
| `TOPIC_INPUT` | `hunter-results` | Input topic (Hunter verdicts) |
| `TOPIC_OUTPUT` | `verifier-results` | Output topic |
| `TOPIC_DEAD_LETTER` | `dead-letter` | Failed message routing |
| `KAFKA_AUTO_OFFSET_RESET` | `earliest` | Consumer offset policy |
| `KAFKA_MAX_POLL_RECORDS` | `5` | Max messages per poll |
| `CLICKHOUSE_HOST` | `clickhouse01` | ClickHouse host |
| `CLICKHOUSE_PORT` | `8123` | ClickHouse HTTP port |
| `CLICKHOUSE_USER` | `clif_admin` | ClickHouse user |
| `CLICKHOUSE_PASSWORD` | `clif_secure_password_change_me` | ClickHouse password |
| `CLICKHOUSE_DATABASE` | `clif_logs` | Database name |
| `LANCEDB_URL` | `http://lancedb:8100` | LanceDB HTTP endpoint |
| `LANCEDB_TIMEOUT_SEC` | `5.0` | LanceDB request timeout |
| `VERIFIER_PORT` | `8500` | HTTP server port |
| `LOG_LEVEL` | `INFO` | Logging level |
| `SKIP_NEGATIVE_VERDICTS` | `true` | Skip NORMAL/FP finding types |
| `TIMELINE_WINDOW_HOURS` | `24` | Timeline lookback hours |
| `FP_SIMILARITY_THRESHOLD` | `0.3` | LanceDB FP similarity threshold |
| `IOC_LOOKBACK_HOURS` | `72` | IOC correlation lookback |
| `EVIDENCE_LOOKBACK_HOURS` | `2` | Merkle batch search window |

### 13.2 Resource Limits

```yaml
deploy:
  resources:
    limits:
      cpus: "1.0"
      memory: 512M
    reservations:
      cpus: "0.25"
      memory: 256M
```

The Verifier is I/O-bound (ClickHouse queries, Kafka polling), not CPU-bound. 512MB is sufficient — it has no ML models to load.

---

## 14. Docker Integration

### 14.1 docker-compose.yml Entry (to be ADDED — not modifying existing entries)

```yaml
  clif-verifier-agent:
    build:
      context: ./agents/verifier
      dockerfile: Dockerfile
    container_name: clif-verifier-agent
    restart: unless-stopped
    ports:
      - "8500:8500"
    environment:
      KAFKA_BROKERS: "redpanda01:9092"
      CONSUMER_GROUP_ID: "clif-verifier-agent"
      TOPIC_INPUT: "hunter-results"
      TOPIC_OUTPUT: "verifier-results"
      TOPIC_DEAD_LETTER: "dead-letter"
      CLICKHOUSE_HOST: "clickhouse01"
      CLICKHOUSE_PORT: "8123"
      CLICKHOUSE_USER: "clif_admin"
      CLICKHOUSE_PASSWORD: "clif_secure_password_change_me"
      CLICKHOUSE_DATABASE: "clif_logs"
      LANCEDB_URL: "http://lancedb:8100"
      VERIFIER_PORT: "8500"
      LOG_LEVEL: "INFO"
    networks:
      - clif-backend
      - clif-storage
    depends_on:
      redpanda01:
        condition: service_healthy
      clickhouse01:
        condition: service_healthy
      redpanda-init:
        condition: service_completed_successfully
      clif-hunter-agent:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8500/health')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 256M
```

### 14.2 Dockerfile

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/verification

EXPOSE 8500

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8500", "--workers", "1", "--loop", "asyncio"]
```

### 14.3 Network Topology

```
clif-backend: [redpanda, consumers, triage-agents, hunter-agent, VERIFIER-AGENT, lancedb, vector]
clif-storage: [clickhouse, redpanda, minio, keeper, consumers, triage-agents, hunter-agent, VERIFIER-AGENT]
```

The Verifier joins both existing networks — no network modifications needed.

---

## 15. Health & Monitoring

### 15.1 HTTP Endpoints

| Endpoint | Method | Response |
|----------|--------|----------|
| `/health` | GET | `{"status": "healthy", "kafka_connected": true, "clickhouse_connected": true, "messages_processed": 42}` |
| `/stats` | GET | `{"messages_received": 100, "messages_processed": 95, "messages_skipped": 5, "verdicts_tp": 60, "verdicts_fp": 20, "verdicts_inconclusive": 15, "errors": 0, "started_at": "..."}` |
| `/ready` | GET | 200 when Kafka + ClickHouse connected, 503 otherwise |

### 15.2 Prometheus Integration

Add to `monitoring/prometheus.yml` (additive only):

```yaml
  - job_name: 'verifier'
    scrape_interval: 30s
    metrics_path: '/stats'
    static_configs:
      - targets: ['clif-verifier-agent:8500']
        labels:
          service: 'verifier-agent'
```

### 15.3 Grafana Dashboard

No changes to existing dashboards. A new Verifier dashboard panel can be added later if needed.

---

## 16. Implementation Phases

### Phase 1 — Core Agent (MVP)

**Goal:** Working Verifier Agent that reads Hunter verdicts and produces verified results.

| Step | Task | Files | Existing Changes |
|------|------|-------|-----------------|
| 1.1 | Create `agents/verifier/` directory | New directory | None |
| 1.2 | Implement `config.py` | New file | None |
| 1.3 | Implement `utils.py` | New file | None |
| 1.4 | Implement `models.py` | New file | None |
| 1.5 | Implement `verification/evidence_integrity.py` | New file | None |
| 1.6 | Implement `verification/ioc_correlator.py` | New file | None |
| 1.7 | Implement `verification/timeline_builder.py` | New file | None |
| 1.8 | Implement `verification/fp_analyzer.py` | New file | None |
| 1.9 | Implement `verdict_engine.py` | New file | None |
| 1.10 | Implement `summary_builder.py` | New file | None |
| 1.11 | Implement `output_writer.py` | New file | None |
| 1.12 | Implement `app.py` | New file | None |
| 1.13 | Create `Dockerfile` | New file | None |
| 1.14 | Create `requirements.txt` | New file | None |
| 1.15 | Add service to `docker-compose.yml` | Append entry | **Additive only** |
| 1.16 | Add Prometheus scrape target | Append entry | **Additive only** |

**Existing files modified:** 2 (docker-compose.yml — append service, prometheus.yml — append scrape target)  
**Existing files NOT modified:** Everything else (0 changes to Triage, Hunter, Consumer, Vector, schemas, topics, dashboard, LanceDB, Merkle, etc.)

### Phase 2 — Feedback Loop

**Goal:** Verifier writes back to `feedback-labels` topic to feed Triage ARF retraining.

| Step | Task | Existing Changes |
|------|------|-----------------|
| 2.1 | Add feedback publisher to output_writer.py | None (new topic already exists) |
| 2.2 | Publish `true_positive` / `false_positive` verdicts as feedback labels | None |

This creates a closed loop: Verifier verdicts → `feedback-labels` → Consumer → `feedback_labels` table → available for Triage/Hunter retraining.

### Phase 3 — Selective Routing (Optional)

**Goal:** Hunter selectively routes high-priority verdicts to `verifier-tasks` for prioritized verification.

| Step | Task | Existing Changes |
|------|------|-----------------|
| 3.1 | Add `verifier-tasks` consumer to Verifier Agent | None |
| 3.2 | Modify Hunter `output_writer.py` to also publish high-severity verdicts to `verifier-tasks` | **Hunter modification** |

**Phase 3 is optional and the ONLY phase that modifies an existing agent.**

### Phase 4 — LanceDB Write-back (Optional)

**Goal:** Verifier writes confirmed `true_positive` verdicts to LanceDB `attack_embeddings` table, enriching future similarity searches for both Hunter and Verifier.

| Step | Task | Existing Changes |
|------|------|-----------------|
| 4.1 | Add LanceDB write call to output_writer.py | None (uses existing REST API) |
| 4.2 | Publish confirmed attacks to `attack_embeddings` table | None |

---

## 17. Safety Checklist — Zero Disruption Guarantee

### What DOES NOT change

| Component | Status |
|-----------|--------|
| Triage Agent (all files) | **UNTOUCHED** |
| Hunter Agent (all files) | **UNTOUCHED** |
| Consumer (app.py) | **UNTOUCHED** — already has `verifier-results` mapping |
| ClickHouse schemas | **UNTOUCHED** — `verifier_results` table already exists |
| Kafka topics | **UNTOUCHED** — `verifier-tasks` and `verifier-results` already created |
| Vector (log ingestion) | **UNTOUCHED** |
| LanceDB service | **UNTOUCHED** — read-only queries only |
| Merkle service | **UNTOUCHED** — reads `evidence_anchors` table only |
| Dashboard | **UNTOUCHED** — already has Verifier UI stubs |
| MinIO | **UNTOUCHED** |
| All ML models | **UNTOUCHED** |
| All Sigma rules | **UNTOUCHED** |

### What DOES change (Phase 1)

| File | Change Type | Nature |
|------|------------|--------|
| `docker-compose.yml` | **Append** service block | Additive — no existing lines modified |
| `monitoring/prometheus.yml` | **Append** scrape target | Additive — no existing lines modified |
| `agents/verifier/` (14 files) | **New directory** | Brand new code, no overlap |

### Risk Mitigations

1. **Kafka consumer isolation:** The Verifier uses consumer group `clif-verifier-agent`, completely separate from `clif-clickhouse-consumer` (used by Consumer) and `clif-hunter-agent` (used by Hunter). Multiple consumer groups reading the same topic is a core Kafka feature — no interference.

2. **ClickHouse read-only:** The Verifier only performs SELECT queries against ClickHouse. It does NOT write directly — all writes go through the Kafka → Consumer → ClickHouse path.

3. **LanceDB read-only:** The Verifier only performs search queries. It does not write to any LanceDB tables (until optional Phase 4).

4. **No shared state:** The Verifier has no shared memory, files, or models with Triage or Hunter. Each runs in its own container.

5. **Graceful degradation:** If the Verifier crashes or is stopped, the existing pipeline continues completely unaffected. Hunter verdicts still flow to `hunter_investigations` via Consumer. The only missing output is the `verifier_results` table — which simply stays empty.

6. **No circular dependencies:** The Verifier consumes from Hunter output and produces to its own topic. There is no feedback loop that could deadlock the pipeline (until Phase 2 adds an optional one via `feedback-labels`, which is a separate topic with no backpressure).

---

## 18. Dependencies & Requirements

### 18.1 `requirements.txt`

```
fastapi==0.109.0
uvicorn==0.27.0
aiokafka==0.10.0
clickhouse-connect==0.7.0
httpx==0.27.0
orjson==3.9.10
```

**Note:** Same versions as Hunter Agent for consistency. No new dependencies introduced to the ecosystem.

### 18.2 System Requirements

| Resource | Requirement |
|----------|-------------|
| CPU | 0.25–1.0 cores |
| Memory | 256–512 MB |
| Disk | Minimal (<50MB image + logs) |
| Network | Needs access to `clif-backend` + `clif-storage` |
| GPU | None |
| ML Models | None (rule-based + query-based verification) |

---

## 19. Testing Strategy

### 19.1 Unit Testing

```
tests/
├── test_evidence_integrity.py    # Mock ClickHouse → verify batch lookup logic
├── test_ioc_correlator.py        # Mock ClickHouse → verify IOC matching
├── test_timeline_builder.py      # Mock ClickHouse → verify timeline assembly
├── test_fp_analyzer.py           # Mock ClickHouse + LanceDB → verify FP detection
├── test_verdict_engine.py        # Test decision matrix with all combinations
├── test_summary_builder.py       # Verify summary format
└── test_output_writer.py         # Mock Kafka → verify message shape
```

### 19.2 Integration Testing

1. **Docker Compose up** → verify Verifier Agent starts, passes healthcheck
2. **Produce test message** to `hunter-results` → verify Verifier consumes and publishes to `verifier-results`
3. **Check ClickHouse** → verify `verifier_results` table has the new row
4. **Stop Verifier** → verify rest of pipeline continues unaffected

### 19.3 Pipeline Compatibility Test

```bash
# Verify existing pipeline works WITHOUT Verifier
docker compose up -d --scale clif-verifier-agent=0
# Run existing test suite

# Verify existing pipeline works WITH Verifier
docker compose up -d
# Run existing test suite — all should pass identically
```

---

## Appendix A: Complete ClickHouse Table Access Map

```
┌─────────────────────┐     ┌──────────────────┐     ┌──────────────────────────┐
│    TRIAGE AGENT      │     │   HUNTER AGENT    │     │    VERIFIER AGENT        │
│                      │     │                   │     │                          │
│ READS:               │     │ READS:            │     │ READS:                   │
│  arf_replay_buffer   │     │  triage_scores    │     │  evidence_anchors        │
│  source_thresholds   │     │  network_events   │     │  ioc_cache               │
│  asset_criticality   │     │  security_events  │     │  network_events          │
│  ioc_cache           │     │  ioc_cache        │     │  raw_logs                │
│  allowlist           │     │  features_entity  │     │  triage_scores           │
│                      │     │   _freq           │     │  hunter_investigations   │
│ WRITES:              │     │  mitre_mapping    │     │  feedback_labels         │
│  arf_replay_buffer   │     │   _rules          │     │  verifier_results        │
│                      │     │  hunter_training  │     │                          │
│ KAFKA OUT:           │     │   _data           │     │ WRITES:                  │
│  triage-scores       │     │                   │     │  (none — via Kafka only) │
│  anomaly-alerts      │     │ WRITES:           │     │                          │
│  hunter-tasks        │     │  hunter_training  │     │ KAFKA OUT:               │
└─────────────────────┘     │   _data           │     │  verifier-results        │
                             │  hunter_model     │     └──────────────────────────┘
                             │   _health         │
                             │                   │
                             │ KAFKA OUT:        │
                             │  hunter-results   │
                             └──────────────────┘
```

## Appendix B: Complete Kafka Topic Map

```
Topic                 Partitions  Producers              Consumers
─────────────────────────────────────────────────────────────────────
raw-logs              12          Vector                  Consumer ×3, Triage ×4
security-events       12          Vector                  Consumer ×3, Triage ×4
process-events        12          Vector                  Consumer ×3, Triage ×4
network-events        12          Vector                  Consumer ×3, Triage ×4
templated-logs        12          (reserved)              (reserved)
triage-scores         12          Triage ×4               Consumer ×3
anomaly-alerts        12          Triage ×4               (alerting)
hunter-tasks          6           Triage ×4               Hunter ×1
hunter-results        6           Hunter ×1               Consumer ×3, VERIFIER ×1 ← NEW READER
verifier-tasks        6           (Phase 3: Hunter)       (Phase 3: Verifier)
verifier-results      6           VERIFIER ×1 ← NEW      Consumer ×3
feedback-labels       3           (Phase 2: Verifier)     Consumer ×3
dead-letter           3           Consumer ×3             (monitoring)
pipeline-commands     3           (reserved)              (reserved)
```

## Appendix C: Service Port Map (Updated)

| Service | Port | Protocol |
|---------|------|----------|
| ClickHouse 01 | 8123 (HTTP), 9000 (Native) | TCP |
| ClickHouse 02 | 8124 (HTTP), 9001 (Native) | TCP |
| Redpanda 01 | 19092 (Kafka), 18082 (Schema), 9644 (Admin) | TCP |
| Vector | 1514 (Syslog), 8686 (API), 8687 (HTTP), 9514 (TCP JSON) | TCP |
| Triage Agent 1-4 | 8300-8303 | HTTP |
| Hunter Agent | 8400 | HTTP |
| **Verifier Agent** | **8500** | **HTTP** ← NEW |
| LanceDB | 8100 | HTTP |
| Redpanda Console | 8080 | HTTP |
| Grafana | 3001 | HTTP |
| Prometheus | 9090 | HTTP |
| MinIO | 9002 (API), 9003 (Console) | HTTP |

---

*End of Verifier Agent Plan v1.0*
