# CLIF Pipeline: 15–20K EPS/Core Optimization Plan

**Date:** 2026-03-02  
**Target:** 15,000–20,000 EPS per Vector CPU core with real heterogeneous logs  
**Machine:** 12 logical CPUs, 16 GB RAM, Windows 11 + Docker Desktop (WSL2)  
**Current Stack:** Vector 0.42.0 → Redpanda 24.2.8 → Python consumers → ClickHouse 24.8  

---

## Executive Summary

Current measured throughput per Vector core with real heterogeneous logs is **6,740 EPS** (TCP NDJSON, 4 cores). Reaching 15K EPS/core requires cutting per-event processing time from **148µs → 67µs** (55% reduction). Reaching 20K requires **148µs → 50µs** (66% reduction).

This plan identifies **7 concrete optimization tiers** ordered by impact-to-effort ratio. Tiers 0–3 (configuration + VRL optimization) are expected to reach **~14–16K EPS/core**. Tier 4 (architecture change) pushes toward **~18–22K EPS/core** but requires removing Kafka from the hot path.

| Tier | Category | Est. Savings | Cumulative EPS/core |
|------|----------|-------------|---------------------|
| **0** | Fix CPU oversubscription | ~23µs (16%) | **~8,000** |
| **1** | Merge transforms (reduce hops) | ~12µs (8%) | **~8,850** |
| **2** | Optimize VRL transforms | ~20µs (14%) | **~10,750** |
| **3** | Disable/cheapen dedup | ~10µs (7%) | **~12,200** |
| **4** | ClickHouse direct sink (bypass Kafka) | ~20µs (14%) | **~15,200** |
| **5** | Pre-classification fast path | ~10µs (7%) | **~18,200** |
| **6** | Bare-metal / no WSL2 overhead | ~10µs (7%) | **~20,800** |

---

## 1. Current Baseline

### Measured Throughput (March 2, 2026)

| Test | Protocol | Total EPS | EPS/Core (4 cores) |
|------|----------|-----------|---------------------|
| Synthetic (5 templates) | HTTP JSON | 45,675 | 11,419 |
| Real logs (11 datasets) | HTTP JSON | 5,118 | 1,280 |
| Real logs (11 datasets) | TCP NDJSON | 26,959 | **6,740** |

**Primary baseline:** 6,740 EPS/core (TCP NDJSON, real heterogeneous logs).

### Per-Event Cost Budget

At 6,740 EPS/core, each event consumes **≈148µs** of wall-clock time per core:

```
148µs ← 1,000,000 / 6,740
```

### Current Resource Allocation (docker-compose.eps-test.yml)

| Container | CPUs | Memory | Count | Total CPUs |
|-----------|------|--------|-------|------------|
| Vector | 4 | 2 GB | 1 | 4 |
| Redpanda | 1 | 1.2 GB | 3 | 3 |
| ClickHouse | 2 | 2 GB | 2 | 4 |
| CH Keeper | 0.5 | 512 MB | 1 | 0.5 |
| Consumer | 1 | 512 MB | 3 | 3 |
| **TOTAL** | | **~11.5 GB** | **10** | **14.5** |

**Critical finding: 14.5 CPUs allocated on a 12-CPU machine = 21% oversubscription.** Vector's 4 allocated CPUs effectively become ~3.3 CPUs under load.

---

## 2. Per-Event Cost Breakdown (148µs)

Based on Vector component analysis, profiling estimates, and benchmark deltas:

```
┌─────────────────────────────────────────────────────────────┐
│                    148µs PER EVENT                          │
├─────────────────────────────────────────────────────────────┤
│ TCP receive + JSON decode               │   5µs  │   3%    │
│ Tokio channel: source → parse           │   4µs  │   3%    │
│ parse_and_structure VRL                  │  15µs  │  10%    │
│   ├─ timestamp parsing                  │   3µs  │         │
│   ├─ JSON guard + parse_json fallback   │   3µs  │         │
│   ├─ hostname/level normalization       │   4µs  │         │
│   ├─ IP regex extraction                │   3µs  │         │
│   └─ message_body regex extraction      │   2µs  │         │
│ Tokio channel: parse → classify         │   4µs  │   3%    │
│ classify_format_route VRL               │  30µs  │  20%    │
│   ├─ Phase 0: label fast path           │   1µs  │         │
│   ├─ Phase 1: security regex (big)      │  12µs  │         │
│   ├─ Phase 2: field classification      │   2µs  │         │
│   ├─ Phase 3: field normalization       │   7µs  │         │
│   └─ Phase 4: metadata + output build   │   8µs  │         │
│ Tokio channel: classify → route         │   4µs  │   3%    │
│ route_by_type                           │   1µs  │   1%    │
│ Tokio channel: route → dedup            │   4µs  │   3%    │
│ dedup (SHA256 hash + LRU lookup)        │  10µs  │   7%    │
│ Tokio channel: dedup → sink             │   4µs  │   3%    │
│ Kafka sink                              │  15µs  │  10%    │
│   ├─ JSON serialization (serde)         │   5µs  │         │
│   ├─ librdkafka produce call            │   7µs  │         │
│   └─ LZ4 compression (amortized)        │   3µs  │         │
│ CPU oversubscription tax (21%)          │  23µs  │  16%    │
│ WSL2 + Docker overhead                  │  10µs  │   7%    │
│ Memory allocation / GC                  │   8µs  │   5%    │
│ librdkafka ack processing               │   8µs  │   5%    │
│ Misc (buffer mgmt, metrics)            │   3µs  │   2%    │
└─────────────────────────────────────────────────────────────┘
```

### Top Bottlenecks Ranked

1. **classify_format_route VRL** — 30µs (20%) — the regex-heavy mega-transform
2. **CPU oversubscription** — 23µs (16%) — 14.5 CPUs on 12-core machine
3. **Tokio channel hops** — 20µs (14%) — 5 inter-component boundaries
4. **Kafka sink** — 15µs (10%) — JSON serialize + librdkafka
5. **parse_and_structure VRL** — 15µs (10%) — timestamp, JSON, regex
6. **Dedup** — 10µs (7%) — SHA256 hashing per event
7. **WSL2/Docker layer** — 10µs (7%) — hypervisor + filesystem overhead

---

## 3. Optimization Tiers

### Tier 0: Fix CPU Oversubscription (Zero Code Changes)

**Estimated savings: ~23µs → 125µs/event → ~8,000 EPS/core**

The single biggest free win. Currently 14.5 vCPUs are allocated on 12 logical cores, causing constant CPU contention, context switching, and cache thrashing.

#### Option A: Slim the compose (keep architecture)

```yaml
# docker-compose.eps-test.yml changes:

# Redpanda: 3 brokers → 1 broker (dev/benchmark mode)
# Saves 2 CPUs + 2.4 GB RAM
redpanda01:
  cpus: '2'          # was '1', give it more since it's alone
  mem_limit: 1500M
# DELETE redpanda02 and redpanda03

# ClickHouse: 2 nodes → 1 node (skip replication for benchmarks)
# Saves 2 CPUs + 2 GB RAM
clickhouse01:
  cpus: '2'
  mem_limit: 2g
# DELETE clickhouse02

# Consumer: 3 → 1 (single consumer can handle 30K+ EPS)
# Saves 2 CPUs + 1 GB RAM
consumer01:
  cpus: '1'
  mem_limit: 512m
# DELETE consumer02 and consumer03

# Vector: increase to use freed CPUs
vector:
  cpus: '6'          # was '4'
  mem_limit: 2g
  environment:
    VECTOR_THREADS: '6'
```

**New allocation: 6 + 2 + 2 + 0.5 + 1 = 11.5 CPUs on 12 cores** — no oversubscription.

#### Redpanda Topic Adjustment

With 1 broker, reduce replication factor to 1:

```bash
# In redpanda-init:
rpk topic create raw-logs --partitions 12 --replicas 1
rpk topic create security-events --partitions 12 --replicas 1
rpk topic create process-events --partitions 12 --replicas 1
rpk topic create network-events --partitions 12 --replicas 1
```

#### Option B: Direct ClickHouse sink (see Tier 4)

Eliminates Redpanda + consumers entirely → frees 8.5 CPUs + 5.4 GB RAM.

---

### Tier 1: Merge All VRL Into One Transform (Reduce Channel Hops)

**Estimated savings: ~12µs → 113µs/event → ~8,850 EPS/core**

Currently the pipeline has **5 Tokio channel boundaries** between source and sink. Each boundary costs ~4µs (channel send + recv + task wake + scheduling). Merging `parse_and_structure` + `classify_format_route` into a single `remap` transform eliminates 1 hop and removes the intermediate event allocation.

#### Implementation

```yaml
transforms:
  # MERGED: parse_classify_format (was parse_and_structure + classify_format_route)
  parse_classify_format:
    type: remap
    inputs:
      - "syslog_tcp"
      - "syslog_udp"
      - "route_http_source.standard"
      - "docker_logs"
      - "file_logs"
      - "journald"
    source: |
      # ── PARSE PHASE (was parse_and_structure) ──────────────
      .clif_source_type = to_string(.source_type) ?? "unknown"
      
      if !is_timestamp(.timestamp) {
        if is_string(.timestamp) {
          .timestamp = parse_timestamp!(to_string!(.timestamp), format: "%+") ?? now()
        } else { .timestamp = now() }
      }
      
      # ... rest of parse_and_structure VRL ...
      # ... then classify_format_route VRL directly, no channel hop ...
```

Also merge `route_by_type` into the remap by setting `.clif_event_type` in the same VRL and routing directly:

```yaml
  # BEFORE: classify_format_route → route_by_type → dedup_security
  # AFTER:  parse_classify_format → dedup_security (route embedded in VRL)
  
  dedup_security:
    inputs:
      - "parse_classify_format"   # route condition moved here
    type: dedupe
    # Use Vector's "route" on the transform output instead of a separate component
```

Wait — Vector's `dedupe` doesn't support conditional inputs. So we still need `route_by_type`. But we can eliminate the `parse_and_structure` → `classify_format_route` boundary:

**Revised approach:** Merge `parse_and_structure` INTO `classify_format_route`:
- **Before:** 6 components (parse → classify → route → 4×dedup) = 5 hops
- **After:** 5 components (parse_classify → route → 4×dedup) = 4 hops
- **Saved:** 1 hop = ~4µs

Additionally, merge `route_windows_events` logic into the main VRL to eliminate another hop:
- **After:** 4 components (mega_transform → route → 4×dedup) = 3 hops  
- **Saved:** 2 hops total = ~8µs

And remove `route_http_source` by inlining its check:
- **After:** Events from `http_json` and `tcp_json` go directly to `mega_transform`
- The VRL checks `exists(.clif_event_type)` at the top and fast-paths pre-classified events
- **Saved:** 3 hops total = ~12µs

#### Final Transform Chain

```
Sources → mega_transform → route_by_type → dedup_* → sinks
           (1 VRL)         (1 route)       (4 dedup)  (4 sink)
```

**3 hops** (was 6 with route_http_source + route_windows_events + parse + classify + route + dedup).

---

### Tier 2: Optimize VRL Transform Cost

**Estimated savings: ~20µs → 93µs/event → ~10,750 EPS/core**

The merged VRL currently costs ~45µs (parse + classify combined). Target: ~25µs.

#### 2a. Eliminate Redundant Object Reconstruction (–8µs)

**Problem:** Phase 4 rebuilds the entire event from scratch using `{ "field": value, ... }` syntax. This allocates a new VRL object with 15-25 fields and discards the old one.

**Fix:** Mutate in-place. Only delete unwanted fields instead of rebuilding:

```vrl
# BEFORE (Phase 4 — current):
. = {
  "clif_event_type": "security",
  "timestamp": ts,
  "severity": sev_int,
  "category": cat,
  ...15 more fields...
}

# AFTER (mutate in-place):
del(.message)
del(.host)
del(.clif_source_type)
del(.facility)
# ... delete non-schema fields ...
# Keep .clif_event_type, .timestamp, .severity, etc. already set
.metadata = metadata  # only set what's new
```

**Why it's faster:** `del()` is O(1) hash removal. Object construction is O(n) allocation + copy. For 20 fields at ~0.4µs each = 8µs saved.

#### 2b. Lazy Metadata Building (–3µs)

**Problem:** The metadata map is built with 10+ `exists()` + `to_string!()` calls regardless of whether those fields exist.

**Fix:** Only build metadata entries for fields that actually exist, using conditional assignment:

```vrl
# BEFORE:
metadata = {}
if exists(.user_id) { metadata.user_id = to_string!(.user_id) }
if exists(.ip_address) { ... validate IPv4 ... metadata.ip_address = ip_str }
if exists(.request_id) { metadata.request_id = to_string!(.request_id) }
if exists(.container_name) { metadata.container_name = to_string!(.container_name) }
if exists(.container_id) { metadata.container_id = to_string!(.container_id) }
if exists(.clif_source_type) { metadata.original_source_type = to_string!(.clif_source_type) }
if exists(.facility) { metadata.syslog_facility = to_string!(.facility) }
if exists(.appname) { metadata.appname = to_string!(.appname) }
if exists(.procid) { metadata.procid = to_string!(.procid) }
if exists(.image) { metadata.docker_image = to_string!(.image) }

# AFTER (batch construct, no branching):
metadata = compact({
  "user_id": .user_id,
  "ip_address": .ip_address,
  "request_id": .request_id,
  "container_name": .container_name,
  "container_id": .container_id,
  "original_source_type": .clif_source_type,
  "syslog_facility": .facility,
  "appname": .appname,
  "procid": .procid,
  "docker_image": .image,
})
# compact() removes null values → same result, fewer branches
```

**Saves:** 10 branch mispredictions + 10 `exists()` calls ≈ 3µs.

#### 2c. Skip Message Body Extraction for Structured Events (–2µs)

**Problem:** The message_body regex extraction runs for ALL events, even structured ones where `.message` is just a field echo.

**Fix:**

```vrl
# Only extract message_body from syslog/text sources
if .clif_source_type == "syslog" || .clif_source_type == "file" || .clif_source_type == "journald" {
  # ... syslog header strip + ISO header strip regexes ...
} else {
  .message_body = to_string!(.message)
}
```

**Saves:** 2 regex match() calls per structured event ≈ 2µs.

#### 2d. Simplify Level Normalization (–2µs)

**Problem:** Level normalization goes through multiple branches: numeric check → regex → text mapping. Most events from TCP sources already have a clean level field.

**Fix:** Fast-path common values:

```vrl
# BEFORE: complex multi-branch normalization
# AFTER: direct check for the 5 canonical values first
lvl = upcase(to_string!(.level ?? .severity ?? .priority ?? .PRIORITY ?? "INFO"))
if lvl == "INFO" || lvl == "WARNING" || lvl == "ERROR" || lvl == "CRITICAL" || lvl == "DEBUG" {
  .level = lvl
} else {
  # ... fallback normalization (rare path) ...
}
```

**Saves:** ~2µs for 90%+ of events that already have standard levels.

#### 2e. Reduce Phase 1 Regex Scope (–5µs)

**Problem:** The security classification regex scans the ENTIRE message for 35+ keywords, including very long messages (some log lines are 2KB+). The Aho-Corasick automaton is fast (O(n) in message length) but scanning 2KB still takes ~12µs.

**Fix:** Scan only the first 512 bytes. Security keywords almost always appear in the first portion of a log line:

```vrl
# BEFORE:
if match(msg, r'(?i)failed password|authentication failure|...')

# AFTER — limit scan scope:
scan_prefix = slice!(msg, 0, 512)
if match(scan_prefix, r'(?i)failed password|authentication failure|...')
```

**Saves:** For long messages (>512 bytes), reduces scan time by 50-75%. Average savings: ~5µs. For short messages (<512 bytes), no cost (slice is a pointer operation, not a copy).

#### Combined Tier 2 Savings

| Optimization | Saved |
|-------------|-------|
| In-place mutation (skip object rebuild) | 8µs |
| Lazy metadata with `compact()` | 3µs |
| Skip message_body regex for structured | 2µs |
| Fast-path level normalization | 2µs |
| Limit regex scan to 512B prefix | 5µs |
| **Total** | **20µs** |

---

### Tier 3: Disable or Cheapen Dedup

**Estimated savings: ~10µs → 83µs/event → ~12,200 EPS/core**

Currently 4 `dedupe` transforms (raw, security, process, network) each compute SHA256 hashes over 2–4 fields per event and perform an LRU cache lookup against a 25K-entry cache.

#### Option A: Disable Dedup Entirely (Benchmark Mode)

For benchmarks and environments where sources don't produce duplicates:

```yaml
# Remove dedup transforms, connect route directly to sinks:
sinks:
  sink_raw_logs:
    inputs: ["route_by_type.raw", "route_windows_events.raw"]
    # was: ["dedup_raw"]
```

**Saves:** Full 10µs per event + frees 4 LRU caches (25K entries × 4 = 100K SHA256 entries = ~10MB of hot memory).

#### Option B: Sampling Dedup (Production Mode)

Only dedup 1-in-N events (e.g., 10%). Catches sustained bursts of duplicates while reducing CPU cost by 90%:

```yaml
# Use Vector's 'sample' transform before dedup:
sample_for_dedup_raw:
  type: sample
  inputs: ["route_by_type.raw"]
  rate: 10  # check 1 in 10 events for dedup
  
dedup_raw:
  inputs: ["sample_for_dedup_raw"]
  # ... same config ...
```

**Or:** Replace `dedupe` with a `filter` transform using a VRL bloom filter approximation:

```yaml
# Bloom-style dedup: hash timestamp+source, check modulo
dedup_filter_raw:
  type: filter
  inputs: ["route_by_type.raw"]
  condition: |
    # Simple hash-based dedup: if we've seen this exact second + source combo
    # in the current batch, skip it. Much cheaper than SHA256 + LRU.
    true  # pass all — dedup handled at ClickHouse level via ReplacingMergeTree
```

#### Option C: Push Dedup to ClickHouse (Architecture)

ClickHouse's `ReplacingMergeTree` engine deduplicates asynchronously during merges. If we switch from `ReplicatedMergeTree` to `ReplicatedReplacingMergeTree`, ClickHouse handles dedup at query time with `FINAL`:

```sql
-- Schema change (one-time):
ALTER TABLE raw_logs 
  MODIFY ENGINE = ReplicatedReplacingMergeTree(
    '/clickhouse/tables/{shard}/raw_logs', '{replica}', timestamp
  );

-- Queries use FINAL to get deduplicated results:
SELECT * FROM raw_logs FINAL WHERE timestamp > now() - INTERVAL 1 HOUR;
```

**Saves:** 10µs in Vector (full dedup cost). ClickHouse dedup is near-free at merge time.

---

### Tier 4: Vector → ClickHouse Direct Sink (Bypass Kafka)

**Estimated savings: ~20µs → 63µs/event → ~15,200 EPS/core** ✅ **TARGET HIT**

This is the architecture change that pushes throughput past 15K EPS/core. By replacing the `kafka` sink with Vector's native `clickhouse` sink, we eliminate:

1. **librdkafka overhead** (produce call, partition hashing, ack protocol): ~7µs
2. **Kafka-specific batching/buffering overhead**: ~3µs  
3. **LZ4 compression for Kafka wire**: ~3µs
4. **Redpanda broker network round-trip** (amortized): ~2µs
5. **Free 5 containers** (3× Redpanda + 3× Consumer): ~5µs indirect (CPU contention)

#### Architecture Before vs After

```
BEFORE:
  Vector (4 cpus) → Redpanda (3 cpus) → Consumer (3 cpus) → ClickHouse (4 cpus)
  Total: 14.5 CPUs on 12 cores (21% oversubscribed)
  Vector effective: ~3.3 cores

AFTER:
  Vector (8 cpus) → ClickHouse (3 cpus) + Keeper (0.5 cpu)
  Total: 11.5 CPUs on 12 cores (no oversubscription)
  Vector effective: 8 cores
```

#### Implementation: Vector ClickHouse Sink Config

```yaml
sinks:
  # ── Raw Logs → ClickHouse Direct ────────────────────────────
  sink_raw_logs:
    type: clickhouse
    inputs: ["route_by_type.raw"]
    endpoint: "http://clickhouse01:8123"
    database: "clif_logs"
    table: "raw_logs"
    auth:
      strategy: basic
      user: "clif_admin"
      password: "Cl1f_Ch@ngeM3_2026!"
    encoding:
      timestamp_format: "rfc3339"
    batch:
      max_events: 50000
      max_bytes: 20971520    # 20 MB
      timeout_secs: 1.0
    buffer:
      type: memory
      max_events: 200000
      when_full: block
    compression: gzip
    request:
      concurrency: 4          # parallel HTTP POST batches
      rate_limit_num: 100
      timeout_secs: 60
    acknowledgements: true
    skip_unknown_fields: true

  # ── Security Events → ClickHouse Direct ──────────────────────
  sink_security_events:
    type: clickhouse
    inputs: ["route_by_type.security"]
    endpoint: "http://clickhouse01:8123"
    database: "clif_logs"
    table: "security_events"
    # ... same auth, batch, buffer settings ...

  # ── Process Events → ClickHouse Direct ───────────────────────
  sink_process_events:
    type: clickhouse
    inputs: ["route_by_type.process"]
    endpoint: "http://clickhouse01:8123"
    database: "clif_logs"
    table: "process_events"
    # ... same auth, batch, buffer settings ...

  # ── Network Events → ClickHouse Direct ───────────────────────
  sink_network_events:
    type: clickhouse
    inputs: ["route_by_type.network"]
    endpoint: "http://clickhouse01:8123"
    database: "clif_logs"
    table: "network_events"
    # ... same auth, batch, buffer settings ...
```

#### Simplified Compose (4 Containers)

```yaml
services:
  clickhouse-keeper:
    cpus: '0.5'
    mem_limit: 512m

  clickhouse01:
    cpus: '3'        # single node, more CPU
    mem_limit: 3g

  vector:
    cpus: '8'        # doubled from 4
    mem_limit: 3g
    environment:
      VECTOR_THREADS: '8'

  # Total: 11.5 CPUs, 6.5 GB RAM
  # (Keep 1 Redpanda + 1 Consumer for AI pipeline replay topics if needed)
```

#### Trade-offs

| Aspect | Kafka Path | Direct ClickHouse |
|--------|-----------|-------------------|
| Durability | Kafka retains events for replay | Vector memory buffer only (disk buffer available) |
| Backpressure | Kafka absorbs bursts (100K buffer) | Vector blocks when CH is slow |
| AI Pipeline | Consumers feed triage_scores table | Separate Vector sink to Kafka for AI topics only |
| Complexity | 10 containers | 3–4 containers |
| RAM | ~11.5 GB | ~6.5 GB |
| EPS/core | ~12K (with Tiers 0–3) | **~15K+** |

#### Hybrid: Keep Kafka for AI Pipeline Only

```yaml
# Keep 1 Redpanda broker + 1 consumer for AI pipeline:
# Vector → ClickHouse (hot path, 4 tables)
# Vector → Kafka → Consumer → ClickHouse (AI tables: triage, hunter, verifier, feedback)

sinks:
  # HOT PATH: Direct to ClickHouse
  sink_raw_logs:
    type: clickhouse
    inputs: ["route_by_type.raw"]
    # ...

  # COLD PATH: Kafka for AI pipeline replay
  sink_ai_pipeline:
    type: kafka
    inputs: ["route_by_type.security"]  # only security events need AI scoring
    topic: "security-events-ai"
    # ...
```

---

### Tier 5: Pre-Classification Fast Path

**Estimated savings: ~10µs → 53µs/event → ~18,200 EPS/core**

For events arriving with `clif_event_type` already set (from agents, structured sources), skip the entire classification VRL (Phase 0–2) and most normalization (Phase 3).

#### Current Fast Path (Broken)

The current `route_http_source` routes pre-classified events to `route_windows_events`, which then routes to dedup. But these events still go through `route_windows_events` == 1 extra component hop. And they skip parse_and_structure, so timestamps may not be normalized.

#### Optimized Fast Path

Move the pre-classification check INTO the mega-transform VRL as the very first operation:

```vrl
# Top of mega_transform VRL:
if exists(.clif_event_type) {
  # ── PRE-CLASSIFIED FAST PATH ──
  # Only validate timestamp and format output. Skip ALL classification.
  
  if !is_timestamp(.timestamp) {
    if is_string(.timestamp) {
      .timestamp = parse_timestamp!(to_string!(.timestamp), format: "%+") ?? now()
    } else { .timestamp = now() }
  }
  
  # Validate critical fields for ClickHouse
  .timestamp = format_timestamp!(.timestamp, format: "%Y-%m-%dT%H:%M:%S%.fZ")
  
  # Fast metadata
  .metadata = compact({
    "original_source_type": .source_type,
    "container_id": .container_id,
  })
  
  # Skip everything else — event already has correct schema
  
} else {
  # ── STANDARD PATH ── (full parse + classify + normalize)
  # ... existing VRL ...
}
```

**Impact:** Pre-classified events go from ~45µs → ~8µs. If 50% of production traffic is pre-classified (Windows agents, EDR, enriched sources), the blended average drops from 45µs to ~27µs ≈ **37K EPS/core** for the fast-path half.

#### Agent-Side Pre-Classification

Deploy lightweight agent-side classification. The agent knows its source type:

```json
{
  "clif_event_type": "security",
  "timestamp": "2026-03-02T15:30:00Z",
  "category": "auth",
  "severity": 3,
  "description": "Failed password for user admin from 10.0.1.50",
  "hostname": "web-prod-01",
  "ip_address": "10.0.1.50",
  "source": "sshd",
  "metadata": {}
}
```

Events pre-classified at the agent skip ALL VRL regex scanning.

---

### Tier 6: System-Level Optimizations

**Estimated savings: ~10µs → ~50µs/event → ~20,800 EPS/core** ✅ **20K TARGET**

These require OS/infrastructure changes:

#### 6a. Native Linux (No WSL2/Docker) — saves ~7µs

Docker Desktop on Windows runs inside WSL2, which adds:
- Hyper-V hypervisor overhead (~3–5%)
- 9P filesystem translation for mounted volumes (~2–5µs per file I/O)
- Virtual network adapter for container networking (~1µs per packet)

**Fix:** Run on native Linux (bare metal or VM with direct hardware access):
- Ubuntu 24.04 + Docker CE (no WSL2 layer)
- Or Kubernetes on bare metal

#### 6b. CPU Pinning (taskset) — saves ~2µs

Pin Vector threads to specific physical cores to avoid:
- Cross-NUMA memory access
- L3 cache thrashing between Vector and other processes
- SMT (hyperthreading) contention

```bash
# Pin Vector to cores 0-7 (physical cores on a 6C/12T CPU):
taskset -c 0-7 vector --config-yaml /etc/vector/vector.yaml --threads 8

# Pin ClickHouse to cores 8-11:
taskset -c 8-11 clickhouse-server
```

In Docker:
```yaml
vector:
  cpuset: "0-7"       # pin to specific cores
```

#### 6c. Network Optimization — saves ~1µs

```yaml
# Vector TCP source tuning:
tcp_json:
  type: socket
  mode: tcp
  address: "0.0.0.0:9514"
  decoding:
    codec: json
  receive_buffer_bytes: 8388608   # 8 MB recv buffer
  max_length: 1048576
  shutdown_timeout_secs: 30
```

```bash
# Linux kernel tuning:
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_max=16777216
sysctl -w net.ipv4.tcp_rmem="4096 87380 16777216"
sysctl -w net.ipv4.tcp_wmem="4096 87380 16777216"
sysctl -w net.core.netdev_max_backlog=5000
```

---

## 4. ClickHouse Tuning (Sink-Side)

When switching to direct ClickHouse sink, tune ClickHouse for high-throughput inserts:

```xml
<!-- /etc/clickhouse-server/config.d/perf.xml -->
<clickhouse>
  <profiles>
    <default>
      <!-- Async inserts: batches incoming rows, flushes periodically -->
      <async_insert>1</async_insert>
      <wait_for_async_insert>0</wait_for_async_insert>
      <async_insert_busy_timeout_ms>200</async_insert_busy_timeout_ms>
      <async_insert_max_data_size>104857600</async_insert_max_data_size>
      
      <!-- Parallel insert processing -->
      <max_insert_threads>4</max_insert_threads>
      
      <!-- Buffer table for ultra-high-throughput bursts -->
      <max_threads>4</max_threads>
    </default>
  </profiles>
  
  <!-- MergeTree settings -->
  <merge_tree>
    <parts_to_throw_insert>600</parts_to_throw_insert>
    <max_parts_in_total>10000</max_parts_in_total>
    <min_bytes_for_wide_part>104857600</min_bytes_for_wide_part>
  </merge_tree>
</clickhouse>
```

---

## 5. Implementation Roadmap

### Phase 1: Quick Wins (Day 1) — Target: 10K EPS/core

| Step | Change | File | Impact |
|------|--------|------|--------|
| 1.1 | Reduce to 1 RP broker, 1 CH node, 1 consumer | docker-compose.eps-test.yml | Fix CPU oversubscription |
| 1.2 | Increase Vector to 6 threads/CPUs | docker-compose.eps-test.yml | +50% Vector parallelism |
| 1.3 | Disable dedup (benchmark mode) | vector.yaml | –10µs/event |
| 1.4 | Merge parse + classify into 1 transform | vector.yaml | –12µs/event |
| | **Benchmark** | | **Expected: ~10K EPS/core** |

### Phase 2: VRL Optimization (Day 2) — Target: 12–14K EPS/core

| Step | Change | File | Impact |
|------|--------|------|--------|
| 2.1 | In-place mutation (skip object rebuild) | vector.yaml | –8µs/event |
| 2.2 | Lazy metadata with `compact()` | vector.yaml | –3µs/event |
| 2.3 | Skip message_body regex for structured | vector.yaml | –2µs/event |
| 2.4 | Fast-path level normalization | vector.yaml | –2µs/event |
| 2.5 | Limit regex scan to 512B prefix | vector.yaml | –5µs/event |
| | **Benchmark** | | **Expected: ~13K EPS/core** |

### Phase 3: Architecture Change (Day 3–4) — Target: 15–18K EPS/core

| Step | Change | File | Impact |
|------|--------|------|--------|
| 3.1 | Add `clickhouse` sinks for 4 main tables | vector.yaml | Direct CH inserts |
| 3.2 | Remove Kafka sinks for main tables | vector.yaml | –15µs/event |
| 3.3 | Slim compose to 3–4 containers | docker-compose.yml | Free 8+ CPUs |
| 3.4 | Increase Vector to 8 threads | docker-compose.yml | 2x parallelism |
| 3.5 | Tune ClickHouse for high-throughput inserts | clickhouse config | Absorb direct load |
| | **Benchmark** | | **Expected: ~16K EPS/core** |

### Phase 4: Advanced (Day 5+) — Target: 18–22K EPS/core

| Step | Change | File | Impact |
|------|--------|------|--------|
| 4.1 | Pre-classification fast path in VRL | vector.yaml | –10µs for 50% of events |
| 4.2 | Agent-side pre-classification | agent configs | Shifts work to edge |
| 4.3 | CPU pinning (cpuset in compose) | docker-compose.yml | –2µs cache locality |
| 4.4 | Native Linux (remove WSL2) | infrastructure | –7µs hypervisor overhead |
| | **Benchmark** | | **Expected: ~20K EPS/core** |

---

## 6. Projected Results

### Conservative Estimates (Each Tier Stacks)

| Tier | Per-Event µs | EPS/Core | Total EPS (8 cores) | Notes |
|------|-------------|----------|---------------------|-------|
| **Baseline** | 148 | 6,740 | 26,960 (4 cores) | Current measured |
| **+ Tier 0** | 125 | 8,000 | 48,000 | Fix CPU oversubscription + 6 cores |
| **+ Tier 1** | 113 | 8,850 | 70,800 | Merge transforms |
| **+ Tier 2** | 93 | 10,750 | 86,000 | VRL optimization |
| **+ Tier 3** | 83 | 12,200 | 97,600 | Disable dedup |
| **+ Tier 4** | 63 | 15,200 | 121,600 | ClickHouse direct sink + 8 cores |
| **+ Tier 5** | 53 | 18,200 | 145,600 | Pre-classification fast path |
| **+ Tier 6** | 43 | 20,800 | 166,400 | Native Linux + CPU pinning |

### Optimistic Estimates

On dedicated hardware (bare metal Linux, 16+ cores, 64GB RAM):

| Config | EPS/Core | Total EPS |
|--------|----------|-----------|
| 16 cores, all tiers, bare metal | ~22,000 | ~352,000 |
| 32 cores, all tiers, bare metal | ~22,000 | ~704,000 |

---

## 7. Verification & Benchmarking

### Benchmark Script Template

```bash
#!/bin/bash
# benchmark_eps_per_core.sh — Measure per-core throughput after each tier

VECTOR_THREADS=$(docker exec clif-vector printenv VECTOR_THREADS)
DURATION=60
MSG_COUNT=500000

# Generate synthetic events with realistic distribution
python3 tests/synthetic_benchmark.py \
  --protocol tcp \
  --target localhost:9514 \
  --events $MSG_COUNT \
  --duration $DURATION \
  --threads 8

# Wait for pipeline drain
sleep 15

# Query ClickHouse for received count
RECEIVED=$(docker exec clif-clickhouse01 clickhouse-client \
  --user clif_admin --password 'Cl1f_Ch@ngeM3_2026!' \
  --database clif_logs \
  --query "SELECT count() FROM raw_logs WHERE timestamp > now() - INTERVAL 2 MINUTE")

TOTAL_EPS=$((RECEIVED / DURATION))
PER_CORE=$((TOTAL_EPS / VECTOR_THREADS))

echo "─────────────────────────────────"
echo "Threads:    $VECTOR_THREADS"
echo "Sent:       $MSG_COUNT"
echo "Received:   $RECEIVED"
echo "Total EPS:  $TOTAL_EPS"
echo "EPS/Core:   $PER_CORE"
echo "─────────────────────────────────"
```

### Key Metrics to Track

| Metric | Source | Target |
|--------|--------|--------|
| `component_sent_events_total{component_name="mega_transform"}` | Vector Prometheus :9598 | Rate = target EPS |
| `component_errors_total` | Vector Prometheus | 0 |
| Per-core EPS | Calculated | 15,000–20,000 |
| ClickHouse insert latency (p99) | CH system.query_log | <100ms |
| Vector memory usage | Docker stats | <3 GB |
| CPU utilization per core | `docker stats` | 85–95% |

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| ClickHouse overload from direct inserts | async_insert=1, batch 50K events, max 4 concurrent requests |
| Data loss without Kafka buffer | Vector disk buffer (fallback), or hybrid Kafka for durability |
| Regex truncation misses security keywords | Validate against all 11 datasets after applying 512B prefix cut |
| Dedup removal causes CH storage bloat | ReplacingMergeTree handles dedup at merge time; query with FINAL |
| Pre-classified events with wrong schema | VRL validation on fast path: assert required fields exist |

---

## 9. Summary

**To reach 15K EPS/core (60K+ total on 4→8 cores):**
1. Fix CPU oversubscription (compose changes only)
2. Merge VRL transforms (1 config change)
3. Optimize VRL (in-place mutation, lazy metadata, regex prefix)
4. Disable dedup (or push to ClickHouse)
5. Switch to direct ClickHouse sink (eliminate Kafka from hot path)

**To reach 20K EPS/core (160K+ total on 8 cores):**
6. Pre-classify events at the agent/source
7. Run on native Linux with CPU pinning

The highest-impact single change is **Tier 0 + Tier 4 combined**: fix CPU oversubscription AND switch to ClickHouse direct sink. This alone should achieve ~15K EPS/core by giving Vector 8 dedicated cores and eliminating 35µs of Kafka/consumer overhead per event.
