# CLIF Hunter Agent — Overall Implementation Plan

> **Project:** CLIF — Cognitive Log Investigation Framework (SIH1733)  
> **Agent:** Hunter Agent (Agent #2 in the 4-agent pipeline)  
> **Architecture:** Triple-Layer Detection (Sigma Rules + SPC Baselines + ML Classification)  
> **Date:** March 4, 2026  
> **Status:** Planning Complete — Ready for Implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Position in the Agentic Pipeline](#2-position-in-the-agentic-pipeline)
3. [Data Contract: What Triage Sends to Hunter](#3-data-contract-what-triage-sends-to-hunter)
4. [Triple-Layer Architecture](#4-triple-layer-architecture)
5. [Layer 1 — Sigma Rule Engine](#5-layer-1--sigma-rule-engine)
6. [Layer 2 — Statistical Process Control (SPC)](#6-layer-2--statistical-process-control-spc)
7. [Layer 3 — ML Classification + LanceDB RAG](#7-layer-3--ml-classification--lancedb-rag)
8. [Fusion Decision Engine](#8-fusion-decision-engine)
9. [Novelty Paradox Solution (4-Layer)](#9-novelty-paradox-solution-4-layer)
10. [Attack Graph Construction](#10-attack-graph-construction)
11. [ClickHouse Schema & Tables](#11-clickhouse-schema--tables)
12. [LanceDB Integration Points](#12-lancedb-integration-points)
13. [Investigation Workflow](#13-investigation-workflow)
14. [Hardware Constraints & Performance Budget](#14-hardware-constraints--performance-budget)
15. [Alternative Architectures Evaluated](#15-alternative-architectures-evaluated)
16. [Implementation Phases](#16-implementation-phases)
17. [File Structure](#17-file-structure)
18. [Testing Strategy](#18-testing-strategy)
19. [Risks & Mitigations](#19-risks--mitigations)

---

## 1. Executive Summary

The Hunter Agent is the **investigator** in CLIF's 4-agent pipeline (Triage → **Hunter** → Verifier → Reporter). It receives escalated alerts from the Triage Agent and performs deep investigation using three fundamentally different detection paradigms running in parallel:

| Layer | Method | Catches | Speed | Cold-Start |
|-------|--------|---------|-------|------------|
| **Layer 1** | Sigma Rules → ClickHouse SQL | Known attack patterns (deterministic) | < 5 ms | Works from event #1 |
| **Layer 2** | Statistical Process Control (SPC) | Novel anomalies (behavioral deviation) | < 5 ms | Needs ~24h baseline |
| **Layer 3** | LightGBM + LanceDB RAG | ML classification + similar-incident context | 30–50 ms | Needs trained model |

**Why Triple-Layer?** No single approach catches everything:
- **Sigma** catches known attacks but can't detect novel ones
- **SPC** catches any behavioral deviation but can't classify attack type
- **ML** classifies known attack types but has blind spots for zero-days
- When **2-of-3 agree**, confidence is very high. When all 3 disagree, the event is genuinely ambiguous (which is the correct answer)

**Performance target:** < 60 ms per investigation (p95)  
**Output:** Writes to `hunter_investigations` table (17 fields) + publishes to `hunter-results` Kafka topic

---

## 2. Position in the Agentic Pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│                        DATA PLANE                                │
│  Sources (7 types) → Vector VRL → Redpanda → Consumer → CH      │
│                                              → Triage Agent      │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │     TRIAGE AGENT        │
                    │  LGBM(0.60) + EIF(0.15) │
                    │  + ARF(0.25) ensemble   │
                    │  F1 = 0.9636            │
                    │                         │
                    │  action = escalate      │───── hunter-tasks topic
                    │  action = monitor       │───── triage-scores topic
                    │  action = discard       │───── triage-scores topic
                    └─────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   ★ HUNTER AGENT ★      │
                    │                         │
                    │  Layer 1: Sigma Rules   │
                    │  Layer 2: SPC Baselines │
                    │  Layer 3: ML + LanceDB  │
                    │                         │
                    │  → Fusion Decision      │
                    │  → Attack Graph         │
                    │  → Evidence Assembly    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    VERIFIER AGENT       │
                    │  IOC validation          │
                    │  Merkle proof check      │
                    │  TP/FP verdict           │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    REPORTER AGENT       │
                    │  Narrative generation    │
                    │  MITRE kill chain        │
                    │  Slack/PagerDuty notify  │
                    └─────────────────────────┘
```

---

## 3. Data Contract: What Triage Sends to Hunter

The Hunter Agent consumes from the **`hunter-tasks`** Kafka topic. Each message is an identical copy of the `TriageResult` payload (31 fields) published only when `action = escalate`.

### Key Fields Used by Hunter

| Field | Type | Hunter Usage |
|-------|------|-------------|
| `event_id` | UUID | → `alert_id` in hunter_investigations |
| `timestamp` | DateTime64(3) | Investigation time window anchor |
| `source_type` | String | Route to source-specific Sigma rules |
| `hostname` | String | Entity expansion queries |
| `source_ip` | String | Entity expansion queries + SPC baselines |
| `user_id` | String | Entity expansion queries |
| `adjusted_score` | Float32 | → `trigger_score` in hunter_investigations |
| `lgbm_score` | Float32 | Layer 3 ML signal |
| `eif_score` | Float32 | Novelty signal (EIF ≥ 0.65 = strong anomaly indicator) |
| `arf_score` | Float32 | Online learning signal |
| `template_id` | String | SPC baseline key |
| `template_rarity` | Float32 | Novelty signal (≥ 0.8 = rare template) |
| `disagreement_flag` | UInt8 | Model disagreement = uncertainty |
| `mitre_tactic` | String | Attack graph node type |
| `mitre_technique` | String | Attack graph edge label |
| `shap_top_features` | JSON String | Explainability context |
| `ioc_match` | UInt8 | Pre-checked IOC hit from Triage |

### Triage Action Distribution (from live data)

| Action | Count | % |
|--------|-------|---|
| Escalate | 233,854 | 60.3% |
| Monitor | 117,772 | 30.4% |
| Discard | 36,158 | 9.3% |

> **Note:** 60% escalation rate means Hunter will process ~233K events per batch. Hunter must be fast.

### Escalation by Source Type

| Source Type | Escalation Rate | Volume |
|------------|----------------|--------|
| dns | 97.9% | Very High |
| ids_ips | 58.1% | High |
| netflow | 77.3% | High |
| windows_event | 100% | Medium |
| syslog_linux_auth | 100% | Medium |
| active_directory | 100% | Low |

---

## 4. Triple-Layer Architecture

```
                    ┌─────────────────────────────────┐
                    │   HUNTER-TASKS (from Triage)     │
                    └──────────────┬──────────────────┘
                                   │
               ┌───────────────────┼───────────────────┐
               ▼                   ▼                   ▼
      ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
      │   LAYER 1    │   │   LAYER 2    │   │    LAYER 3       │
      │  Sigma Rules │   │     SPC      │   │ LightGBM+LanceDB│
      │   (< 5 ms)  │   │   (< 5 ms)  │   │   (30-50 ms)     │
      │              │   │              │   │                  │
      │ 52 YAML→SQL  │   │ Per-entity   │   │ ML classifi-    │
      │ Known attack │   │ behavioral   │   │ cation + RAG    │
      │ detection    │   │ baselines    │   │ context         │
      └──────┬───────┘   └──────┬───────┘   └────────┬─────────┘
             │                  │                     │
             ▼                  ▼                     ▼
      ┌──────────────────────────────────────────────────────┐
      │               FUSION DECISION ENGINE                  │
      │                                                       │
      │  sigma_hit=True  → CONFIRMED (known attack)           │
      │  spc_anomaly=True + ml_score>0.5 → PROBABLE ATTACK    │
      │  spc_anomaly=True + ml_score<0.5 → NOVEL/INVESTIGATE  │
      │  sigma_hit=False + spc_normal + ml_low → CLOSE        │
      └──────────────────────┬────────────────────────────────┘
                             │
               ┌─────────────┼─────────────┐
               ▼             ▼             ▼
        ┌───────────┐ ┌──────────┐ ┌────────────┐
        │  Attack   │ │  Hunter  │ │  Feedback  │
        │  Graph    │ │  Results │ │  Loop      │
        │  Builder  │ │ (CH+Kafka)│ │ (online)  │
        └───────────┘ └──────────┘ └────────────┘
```

### Why This Architecture Was Chosen

Six alternative architectures were evaluated against the live ClickHouse data. Two were **eliminated by data constraints**:

- **Temporal Transformers / LSTM** — ELIMINATED: Data shows MITRE tactics occur **simultaneously** (all 3 in the same minute on MSEDGEWIN10), not sequentially. Sequence models learn ordering that doesn't exist. Also 300K events/window × per-token processing = infeasible on 6C CPU.
- **Graph Neural Networks** — ELIMINATED: 300K events per investigation window. Graph construction is O(n·k) minimum. No graph-labeled training data exists. Would consume entire 16 GB RAM per investigation.

Full evaluation: [Section 15 — Alternative Architectures Evaluated](#15-alternative-architectures-evaluated)

---

## 5. Layer 1 — Sigma Rule Engine

### What It Is

[Sigma](https://github.com/SigmaHQ/sigma) is a community-maintained, vendor-neutral detection rule format (YAML). CLIF already has **52 Sigma rules** in `agents/Data/datasets/10_ids_ips_zeek/path_a_lightgbm/Sigma_IDS/` covering 7 vendor categories:

| Category | Rules | Example |
|----------|-------|---------|
| cisco | 8 | Cisco ASA threat detection |
| dns | 6 | Cobalt Strike DNS beaconing (`aaa.stage.*`) |
| firewall | 7 | Generic firewall anomalies |
| fortinet | 8 | FortiGate exploit detection |
| huawei | 7 | Huawei USG rules |
| juniper | 8 | Juniper SRX rules |
| zeek | 8 | Zeek connection anomalies |

### How It Works

```
Sigma YAML  ──→  YAML→SQL Compiler  ──→  ClickHouse WHERE clause
                                          │
                                          ▼
                                    SELECT * FROM security_events
                                    WHERE category = 'dns_query'
                                      AND description LIKE '%aaa.stage%'
                                      AND timestamp BETWEEN ... AND ...
```

Each Sigma rule compiles to a parameterized ClickHouse SQL query. At investigation time, Hunter runs all applicable rules (filtered by `source_type`) against the ±15 min event window.

### Sigma Rule Structure (Example)

```yaml
title: Cobalt Strike DNS Beaconing
status: test
description: Detects DNS queries associated with Cobalt Strike C2 beaconing
logsource:
    category: dns
    product: zeek
detection:
    selection:
        query|contains:
            - 'aaa.stage.'
            - '.stage.123456.'
    condition: selection
level: critical
tags:
    - attack.command_and_control
    - attack.t1071.004
```

### Implementation

```python
class SigmaEngine:
    """Compiles Sigma YAML rules → ClickHouse SQL and evaluates them."""
    
    def __init__(self, rules_dir: str):
        self.rules = self._load_rules(rules_dir)
        self.compiled = {r.id: self._compile_to_sql(r) for r in self.rules}
    
    def evaluate(self, hostname: str, source_type: str, 
                 time_start: datetime, time_end: datetime) -> list[SigmaHit]:
        """Run applicable rules against the event window. Returns list of hits."""
        applicable = [r for r in self.rules if r.matches_source(source_type)]
        hits = []
        for rule in applicable:
            sql = self.compiled[rule.id].format(
                hostname=hostname, t_start=time_start, t_end=time_end
            )
            result = clickhouse_client.execute(sql)
            if result:
                hits.append(SigmaHit(
                    rule_id=rule.id,
                    rule_name=rule.title,
                    mitre_tags=rule.tags,
                    severity=rule.level,
                    matched_events=len(result)
                ))
        return hits
```

### Properties

| Property | Value |
|----------|-------|
| Detection type | Deterministic — same input always produces same output |
| Anomaly detection | **None** — only detects what rules explicitly define |
| Speed | < 5 ms per rule (pure SQL) |
| Explainability | Rule name + MITRE tag directly in output |
| Cold-start | Works from event #1 |
| Maintenance | Community-updated; add new rules via YAML |

---

## 6. Layer 2 — Statistical Process Control (SPC)

### What It Is

Per-entity behavioral baselines that detect **any deviation from normal**, regardless of whether the attack is known or novel. This is the layer that catches zero-day exploits, novel malware, and stealthy attacks that ML models have never been trained on.

### Why SPC Is Critical

The **Novelty Paradox**: ML models (LightGBM, even EIF) are trained on historical data. If a brand-new attack type appears that:
- EIF doesn't flag (EIF < 0.65 threshold)
- LightGBM mis-classifies as benign (never trained on it)
- LanceDB finds "close" normal neighbors (because the attack IS new)

...the attack passes through undetected. **SPC closes this gap completely** because it doesn't care what the attack "looks like" — it only cares that behavior **changed**.

### Baselines Tracked

Stored in a new ClickHouse table `entity_baselines`:

| # | Baseline | Formula | Detection Method | What It Catches |
|---|----------|---------|------------------|----------------|
| 1 | Event rate | `count() / minute` per `(hostname)` | z-score > 3σ | DDoS, brute force, exfiltration bursts |
| 2 | Score distribution | `avg(adjusted_score)` per `(hostname, category)` | EWMA shift detection | Gradual score escalation (APT) |
| 3 | Category frequency | `count per category` per `(hostname)` | Chi-squared test | New attack types appearing on host |
| 4 | Tactic diversity | `uniq(mitre_tactic)` per `(hostname, window)` | Count threshold | Kill chain progression |
| 5 | Connection fan-out | `uniq(ip_address)` per `(hostname, window)` | z-score > 3σ | Lateral movement, scanning |
| 6 | Template novelty | `uniq(template_id)` per `(hostname)` | New template never seen before | Novel log patterns |

**Scale:** 22 unique hosts × 6 baselines = **132 baseline entries**. Fits entirely in memory. Updated every 60s via ClickHouse materialized views.

### Entity Profiling (from live data)

| Metric | Value |
|--------|-------|
| Unique hostnames | 22 |
| Unique source IPs | 33 |
| Unique categories | 38 |
| Unique MITRE tactics | 6 |
| Hosts with multi-category activity | 9 |
| Avg events per host | 93,978 |
| Total events | 2,067,513 |

### Implementation

```python
class SPCEngine:
    """Statistical Process Control for per-entity behavioral baselines."""
    
    def __init__(self, clickhouse_client, baseline_window_hours: int = 24):
        self.ch = clickhouse_client
        self.window = baseline_window_hours
        self.baselines = {}  # (hostname, metric) → (mean, std, last_updated)
    
    def refresh_baselines(self):
        """Pull aggregated baselines from ClickHouse materialized views."""
        # Event rate baseline
        self.baselines['event_rate'] = self.ch.execute("""
            SELECT hostname, 
                   avg(event_count) as mean_rate,
                   stddevPop(event_count) as std_rate
            FROM clif_logs.features_entity_freq
            WHERE window_start >= now() - INTERVAL {window} HOUR
            GROUP BY hostname
        """.format(window=self.window))
        # ... similar for other 5 baselines
    
    def evaluate(self, hostname: str, source_ip: str,
                 time_start: datetime, time_end: datetime) -> SPCResult:
        """Check if current behavior deviates from baseline."""
        current = self._get_current_metrics(hostname, time_start, time_end)
        deviations = []
        
        for metric_name, (mean, std) in self.baselines.get(hostname, {}).items():
            if std == 0:
                continue
            z_score = abs(current[metric_name] - mean) / std
            if z_score > 3.0:  # 3-sigma control limit
                deviations.append(SPCDeviation(
                    metric=metric_name,
                    expected=mean,
                    observed=current[metric_name],
                    z_score=z_score,
                    explanation=f"{hostname} {metric_name}: expected {mean:.1f} "
                               f"(±{std:.1f}), observed {current[metric_name]:.1f} "
                               f"(z={z_score:.1f})"
                ))
        
        return SPCResult(
            is_anomaly=len(deviations) > 0,
            deviations=deviations,
            anomaly_score=max((d.z_score for d in deviations), default=0.0) / 10.0
        )
```

### ClickHouse Table: `entity_baselines`

```sql
CREATE TABLE IF NOT EXISTS clif_logs.entity_baselines ON CLUSTER 'clif_cluster'
(
    hostname          String                                       CODEC(ZSTD(1)),
    metric_name       LowCardinality(String)                       CODEC(ZSTD(1)),
    window_start      DateTime64(3)                               CODEC(Delta, ZSTD(3)),
    mean_value        Float64        DEFAULT 0.0                  CODEC(ZSTD(1)),
    std_value         Float64        DEFAULT 0.0                  CODEC(ZSTD(1)),
    sample_count      UInt32         DEFAULT 0                    CODEC(ZSTD(1)),
    last_updated      DateTime64(3)  DEFAULT now64()              CODEC(ZSTD(3))
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/entity_baselines',
    '{replica}'
)
ORDER BY (hostname, metric_name, window_start)
TTL toDateTime(window_start) + INTERVAL 7 DAY DELETE;
```

### Properties

| Property | Value |
|----------|-------|
| Detection type | Statistical — mathematical deviation from learned baseline |
| Anomaly detection | **Excellent** — ANY behavioral change is flagged |
| Speed | < 5 ms (arithmetic on pre-computed aggregates) |
| Explainability | "Host X normally has 12 events/min, now has 847" |
| Cold-start | Needs ~24h of baseline data; initially permissive |
| Maintenance | Zero — baselines auto-update via materialized views |

---

## 7. Layer 3 — ML Classification + LanceDB RAG

### What It Is

The ML layer classifies alerts into known attack types using a trained LightGBM model, then enriches findings with similar historical incidents from LanceDB vector search.

### LightGBM Classification

Uses 20 canonical features (same as Triage's feature space) plus additional investigation-window features:

**Investigation-Window Features (computed at Hunter time):**
| Feature | Description |
|---------|-------------|
| `window_event_count` | Total events in ±15 min window |
| `window_unique_categories` | Category diversity in window |
| `window_unique_tactics` | MITRE tactic count in window |
| `window_unique_ips` | Connection fan-out in window |
| `window_score_mean` | Average triage score in window |
| `window_score_max` | Peak triage score in window |
| `correlated_escalations` | Number of other escalated events in window |

### LanceDB RAG Context

The LanceDB service (FastAPI, port 8100, `all-MiniLM-L6-v2`, 384-dim) provides:

1. **Similar Incident Search**: Find past investigations with similar characteristics
2. **Threat Intel Match**: Check if entities appear in threat intelligence feeds
3. **Attack Embeddings Table**: Separate table populated ONLY from confirmed attacks (not normal events)

```python
# LanceDB query during investigation
similar_incidents = lancedb_client.search(
    table="attack_embeddings",
    query_text=f"{hostname} {category} {mitre_tactic} {description}",
    top_k=5,
    filter_sql=f"severity IN ('high', 'critical')"
)
```

### Properties

| Property | Value |
|----------|-------|
| Detection type | Probabilistic — trained ML classifier |
| Anomaly detection | Limited — classifies into known buckets only |
| Speed | 30–50 ms (ONNX inference + LanceDB HTTP call) |
| Explainability | SHAP top features + similar past incidents |
| Cold-start | Needs trained model + populated LanceDB |
| Maintenance | Retrain on feedback loop; LanceDB auto-syncs via ClickHouse |

---

## 8. Fusion Decision Engine

The Fusion Engine combines all 3 layers into a final verdict. This is the core decision logic.

### Decision Matrix

| Sigma Hit | SPC Anomaly | ML Score | Verdict | Severity | Confidence |
|-----------|-------------|----------|---------|----------|------------|
| ✅ Yes | ✅ Yes | > 0.5 | **CONFIRMED** | Critical | 0.95+ |
| ✅ Yes | ❌ No | > 0.5 | **CONFIRMED** | High | 0.85 |
| ✅ Yes | ❌ No | < 0.5 | **CONFIRMED** | Medium | 0.70 |
| ❌ No | ✅ Yes | > 0.5 | **PROBABLE ATTACK** | High | 0.80 |
| ❌ No | ✅ Yes | < 0.5 | **NOVEL / INVESTIGATE** | Medium | 0.60 |
| ❌ No | ❌ No | > 0.7 | **ML ALERT** | Medium | 0.55 |
| ❌ No | ❌ No | < 0.5 | **CLOSE** | Info | 0.10 |

### Key Principles

1. **Sigma hit = always escalate.** Deterministic rules are pre-validated by the community. False-rule rate is near zero.
2. **SPC anomaly = always investigate.** Behavioral deviation is a fact, not a prediction. The host IS behaving differently.
3. **ML alone is advisory.** ML provides classification and enrichment but does NOT have veto power.
4. **2-of-3 agreement = high confidence.** Three fundamentally different paradigms agreeing is extremely strong signal.
5. **Triple non-agreement = genuinely ambiguous.** This IS the right answer for borderline events.

### Implementation

```python
class FusionEngine:
    """Combines 3 detection layers into a final verdict."""

    def fuse(self, sigma: list[SigmaHit], spc: SPCResult, 
             ml: MLResult, triage: TriageResult) -> HunterVerdict:
        
        sigma_hit = len(sigma) > 0
        spc_anomaly = spc.is_anomaly
        ml_high = ml.score > 0.5
        
        # Count agreeing layers
        agreeing = sum([sigma_hit, spc_anomaly, ml_high])
        
        if sigma_hit:
            severity = 'critical' if agreeing == 3 else 'high' if agreeing == 2 else 'medium'
            return HunterVerdict(
                finding_type='confirmed_attack',
                severity=severity,
                confidence=0.70 + (agreeing * 0.10),
                sigma_rules=[h.rule_name for h in sigma],
                spc_deviations=spc.deviations,
                ml_classification=ml.label,
                evidence_sources=['sigma', 'spc', 'ml'][:agreeing]
            )
        
        if spc_anomaly and ml_high:
            return HunterVerdict(
                finding_type='probable_attack',
                severity='high',
                confidence=0.80,
                spc_deviations=spc.deviations,
                ml_classification=ml.label
            )
        
        if spc_anomaly and not ml_high:
            return HunterVerdict(
                finding_type='novel_investigation',
                severity='medium',
                confidence=0.60,
                spc_deviations=spc.deviations,
                note='SPC detected behavioral deviation but ML has no matching pattern. '
                     'This could be a novel attack type or benign change.'
            )
        
        if ml_high and not spc_anomaly:
            return HunterVerdict(
                finding_type='ml_alert',
                severity='medium',
                confidence=0.55,
                ml_classification=ml.label,
                note='ML flagged but behavior is within historical baselines.'
            )
        
        return HunterVerdict(
            finding_type='closed',
            severity='info',
            confidence=0.10
        )
```

---

## 9. Novelty Paradox Solution (4-Layer)

### The Problem

LanceDB similarity search has a critical flaw for anomaly detection: novel/zero-day attacks have no historical matches, so nearest neighbors are **normal events** → LanceDB would label the attack as "similar to normal" → **novel attacks marked as benign**.

### The Solution: 4 Defensive Layers

#### Layer A: Distance-Based Novelty Detection

| avg_distance | Interpretation | Action |
|-------------|---------------|--------|
| < 0.20 | Known pattern (close match) | Trust LanceDB classification |
| 0.20 – 0.45 | Uncertain (moderate distance) | Blend with other signals |
| > 0.45 | Novel (far from all known patterns) | **Flag as novel — DO NOT trust neighbor labels** |

#### Layer B: Triage Score Is Authoritative

Hunter **NEVER** overrides Triage's escalation decision based on LanceDB results. If Triage said `action=escalate`, the event IS investigated regardless of LanceDB similarity scores.

#### Layer C: Multi-Signal Decision Matrix

| Signal | Threshold | Indicates |
|--------|-----------|-----------|
| `eif_score` ≥ 0.65 | EIF anomaly | Statistical isolation in feature space |
| `template_rarity` ≥ 0.8 | Rare log template | Log pattern rarely/never seen |
| `disagreement_flag` = 1 | Model disagreement | LGBM/EIF/ARF don't agree — uncertainty |
| `lancedb_distance` > 0.45 | Novel pattern | Far from all known events |

**Combined scenarios:**

| Scenario | Signals Present | Verdict |
|----------|----------------|---------|
| Novel zero-day | EIF high + template rare + high distance | `novel_anomaly` — escalate to Verifier |
| Stealth/evasion | Low EIF + model disagreement + high distance | `evasion_technique` — needs investigation |
| Known attack variant | Low distance + Sigma hit | `known_attack` — classify and close |
| True false positive | Low EIF + no disagreement + low distance | `likely_false_positive` — close with evidence |

#### Layer D: Separate Attack Embeddings Table

LanceDB maintains a dedicated `attack_embeddings` table populated **only** from:
- Events confirmed as True Positives by the Verifier Agent
- Events with `severity >= high` from Hunter investigations

This ensures similarity search compares against **known attacks**, not general log traffic.

```
┌─────────────────────┐     ┌──────────────────────┐
│  log_embeddings     │     │  attack_embeddings   │
│  (all logs — noisy) │     │  (confirmed attacks) │
│                     │     │                      │
│  ❌ Novel attacks   │     │  ✅ Novel attacks    │
│  look "normal" here │     │  have no close match │
│                     │     │  → high distance     │
│                     │     │  → CORRECTLY flagged  │
└─────────────────────┘     └──────────────────────┘
```

---

## 10. Attack Graph Construction

### Feasibility (Proven from Live Data)

| Data Point | Value | Source |
|-----------|-------|--------|
| MITRE tactics observed | 6 (defense-evasion, lateral-movement, privilege-escalation, credential-access, initial-access, discovery) | security_events |
| Hosts with multi-stage kill chains | 7 (MSEDGEWIN10, IEWIN7, fw-01, etc.) | security_events |
| Cross-host entity resolution | MSEDGEWIN10→10.0.2.17, IEWIN7→10.0.2.15/16 | network_events |
| DNS C2 indicators | steam.zombieden.cn (1,406 queries), tinyurl.com (1,998) | dns_events |

### Graph Structure (stored in `evidence_json`)

```json
{
  "attack_graph": {
    "nodes": [
      {"id": "MSEDGEWIN10", "type": "host", "tactics": ["defense-evasion", "lateral-movement", "privilege-escalation"]},
      {"id": "10.0.2.17", "type": "ip", "role": "source"},
      {"id": "10.0.2.15", "type": "ip", "role": "target"},
      {"id": "steam.zombieden.cn", "type": "domain", "role": "c2"}
    ],
    "edges": [
      {"from": "MSEDGEWIN10", "to": "10.0.2.15", "type": "lateral_movement", "technique": "T1021", "event_count": 921},
      {"from": "MSEDGEWIN10", "to": "steam.zombieden.cn", "type": "c2_communication", "technique": "T1071.004", "event_count": 1406}
    ],
    "kill_chain": [
      {"stage": 1, "tactic": "initial-access", "host": "host-syslog", "technique": "T1078"},
      {"stage": 2, "tactic": "privilege-escalation", "host": "MSEDGEWIN10", "technique": "T1548"},
      {"stage": 3, "tactic": "lateral-movement", "host": "MSEDGEWIN10→IEWIN7", "technique": "T1021"},
      {"stage": 4, "tactic": "defense-evasion", "host": "fw-01", "technique": "T1562"}
    ]
  }
}
```

### How It's Built

1. **Entity Expansion**: Query ClickHouse for all events involving the hostname/IP in ±15 min window
2. **Relationship Extraction**: Map host→IP, IP→IP, host→domain connections from network_events and dns_events
3. **Tactic Ordering**: Sort by earliest `timestamp` per tactic to reconstruct kill chain
4. **Graph Assembly**: Build node/edge graph with event counts as edge weights
5. **MITRE Mapping**: Label edges with ATT&CK techniques from `mitre_mapping_rules`

---

## 11. ClickHouse Schema & Tables

### Existing Tables Used by Hunter

| Table | Purpose | Status |
|-------|---------|--------|
| `triage_scores` | Source data (28 columns) | ✅ Active, populated |
| `security_events` | Event context for investigation windows | ✅ Active, populated |
| `network_events` | IP-to-IP connections for attack graph | ✅ Active, populated |
| `dns_events` | DNS queries for C2 detection | ✅ Active, populated |
| `process_events` | Process execution chains | ✅ Active, populated |
| `raw_logs` | Full log text for evidence | ✅ Active, populated |
| `hunter_investigations` | Hunter output (17 fields) | ✅ Schema exists, empty |
| `ioc_cache` | Threat intel IOCs | ⚠️ Schema exists, **EMPTY** |
| `asset_criticality` | Asset importance multipliers | ⚠️ Schema exists, **EMPTY** |
| `allowlist` | False positive suppression | ⚠️ Schema exists, **EMPTY** |
| `mitre_mapping_rules` | ATT&CK technique definitions | ✅ Schema + 9 seeded rules |
| `features_entity_freq` | Per-entity event frequency | ⚠️ Schema exists, **TABLE MISSING from CH** |

### New Tables Needed

| Table | Purpose |
|-------|---------|
| `entity_baselines` | SPC behavioral baselines (22 hosts × 6 metrics) |
| `sigma_rule_hits` | Sigma rule match audit log |

### Tables Requiring Population

| Table | What To Populate | Priority |
|-------|-----------------|----------|
| `features_entity_freq` | Create missing table in ClickHouse | **P0** — SPC depends on it |
| `ioc_cache` | Seed with open-source threat feeds (abuse.ch, malware bazaar) | P1 |
| `asset_criticality` | Define importance for 22 known hosts | P1 |
| `allowlist` | Add known false-positive patterns after first run | P2 |

---

## 12. LanceDB Integration Points

### 7 Optimal Integration Points (Priority Ordered)

| # | Integration Point | Description | Layer |
|---|-------------------|-------------|-------|
| 1 | **Attack Embeddings Table** | Separate table for confirmed attacks only (solves novelty paradox) | Layer 3 |
| 2 | **Similar Incident Search** | Find past investigations matching current alert pattern | Layer 3 |
| 3 | **Threat Intel Enrichment** | Semantic search against threat_intel table for entity names | Layer 3 |
| 4 | **Investigation Summary RAG** | Provide context from historical_incidents to aid summary generation | Reporter |
| 5 | **IOC Context Expansion** | Find related IOCs by semantic similarity (not just exact match) | Verifier |
| 6 | **Baseline Anomaly Context** | Explain SPC deviations using similar past deviations | Layer 2 |
| 7 | **Sigma Rule Suggestion** | Find similar rules when new patterns emerge | Layer 1 |

### LanceDB Architecture

| Component | Value |
|-----------|-------|
| Service | FastAPI (lancedb-service/app.py, 875 lines) |
| Embedding model | all-MiniLM-L6-v2 (384 dimensions) |
| Tables | log_embeddings, threat_intel, historical_incidents, **+ attack_embeddings (new)** |
| Sync | ClickHouse → LanceDB every 30s (4 source tables) |
| Docker profile | `full` (currently disabled, needs activation) |
| Port | 8100 |

### Key Rule

> **LanceDB is a CONTEXT PROVIDER, never a DECISION MAKER.** It enriches investigations with relevant past incidents and threat intelligence but never has veto power over Sigma hits or SPC deviations.

---

## 13. Investigation Workflow

### Per-Alert Investigation Sequence

```
1. RECEIVE alert from hunter-tasks topic            [0 ms]
   │
2. PARSE TriageResult payload                       [< 1 ms]
   │
3. RUN all 3 layers IN PARALLEL:
   ├── Layer 1: Sigma rules for source_type         [< 5 ms]
   ├── Layer 2: SPC baseline check for hostname     [< 5 ms]
   └── Layer 3: ML inference + LanceDB search       [30-50 ms]
   │                                                [~50 ms total — parallel]
   │
4. FUSE results via Decision Matrix                 [< 1 ms]
   │
5. IF verdict != 'close':
   ├── EXPAND entities (±15 min ClickHouse window)  [10-30 ms]
   ├── BUILD attack graph from expanded events      [5-15 ms]
   └── SEARCH LanceDB for similar past incidents    [10-20 ms]
   │                                                [~50 ms total — parallel]
   │
6. WRITE to hunter_investigations table             [< 5 ms]
   │
7. PUBLISH to hunter-results Kafka topic            [< 5 ms]
   │
   TOTAL: 50-110 ms per investigation
```

### Batch Processing Strategy

Given 233K escalated events per batch window, Hunter groups by `(hostname, time_window)` to amortize ClickHouse queries:

```
233,854 escalated events
    → Group by (hostname, 1-min window)
    → ~500-1000 investigation groups
    → Each group: 1 ClickHouse query (not 1 per event)
    → Effective throughput: 2,000-4,000 investigations/sec
```

---

## 14. Hardware Constraints & Performance Budget

### Machine Specifications

| Spec | Value |
|------|-------|
| CPU | 6 cores / 12 threads |
| RAM | 16 GB |
| OS | Windows 11 + Docker Desktop (WSL2) |
| Storage | SSD (ClickHouse tiered storage) |

### Investigation Workload (from live data)

| Host | Events per ±15 min Window | Complexity |
|------|--------------------------|------------|
| ids-sensor-01 | 349,284 | Very Heavy |
| fw-01 | 325,719 | Very Heavy |
| ids-01 | 229,582 | Heavy |
| PC01.example.corp | 15,283 | Medium |
| MSEDGEWIN10 | 5,773 | Light |
| IEWIN7 | 1,877 | Light |
| LAPTOP-JU4M3I0E | 288 | Minimal |

### Performance Budget per Investigation

| Component | Budget | Actual |
|-----------|--------|--------|
| Layer 1 (Sigma) | < 10 ms | < 5 ms |
| Layer 2 (SPC) | < 10 ms | < 5 ms |
| Layer 3 (ML + LanceDB) | < 60 ms | 30-50 ms |
| Entity expansion | < 40 ms | 10-30 ms |
| Attack graph build | < 20 ms | 5-15 ms |
| DB writes + Kafka publish | < 10 ms | < 5 ms |
| **Total** | **< 150 ms** | **50-110 ms** |

### What This Eliminates

| Approach | Why Eliminated |
|----------|---------------|
| GNN (Graph Neural Networks) | 300K node graph = O(n·k) construction, > 16 GB RAM |
| LSTM / Transformers | Per-token processing × 300K events = infeasible on 6C CPU |
| Deep Learning ensemble | GPU required; CPU inference > 500 ms |

---

## 15. Alternative Architectures Evaluated

### Full Comparison Matrix

| Criteria | A: Rules+ML (Original) | B: Sigma Only | C: SPC Only | D: River ARF | E: Transformer | F: GNN | **G: Triple-Layer (Chosen)** |
|----------|----------------------|---------------|-------------|--------------|----------------|--------|---------------------------|
| Known attack detection | ★★★★☆ | ★★★★★ | ★★☆☆☆ | ★★★★☆ | ★★★☆☆ | ★★★★☆ | **★★★★★** |
| **Novel anomaly detection** | ★★★☆☆ | ★☆☆☆☆ | ★★★★★ | ★★★☆☆ | ★★★☆☆ | ★★★★☆ | **★★★★★** |
| Speed (p95) | ~40 ms | < 5 ms | < 5 ms | ~20 ms | 100-500 ms | ∞ | **~50 ms** |
| Reliability | ★★★☆☆ | ★★★★★ | ★★★★★ | ★★★★☆ | ★★☆☆☆ | ★★☆☆☆ | **★★★★★** |
| Explainability | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★☆☆ | ★★☆☆☆ | ★★☆☆☆ | **★★★★★** |
| Cold-start | ★★☆☆☆ | ★★★★★ | ★★★☆☆ | ★★☆☆☆ | ★☆☆☆☆ | ★☆☆☆☆ | **★★★★☆** |
| Implementation effort | Medium | Low | Low-Med | Low | High | Very High | **Medium-High** |
| Hardware feasibility | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | **✅** |

### Why Triple-Layer Wins

1. **Novel anomalies SOLVED**: SPC detects any deviation — no training data needed
2. **Deterministic + Probabilistic + Statistical**: Three fundamentally different paradigms
3. **2-of-3 agreement**: Dramatically reduces false positives
4. **Zero extra infrastructure**: Sigma compiles to SQL, SPC uses ClickHouse materialized views
5. **52 Sigma rules are free**: Already in the dataset, community-validated
6. **SPC adapts automatically**: Sliding baseline window, no model retraining

---

## 16. Implementation Phases

### Phase 1: Foundation (Days 1-3)

| Task | Description | Dependencies |
|------|-------------|-------------|
| Create `agents/hunter/` directory structure | app.py, sigma_engine.py, spc_engine.py, ml_engine.py, fusion.py, graph_builder.py | None |
| Create `features_entity_freq` table in ClickHouse | Table is missing despite schema.sql having it | None |
| Create `entity_baselines` table | SPC storage | features_entity_freq |
| Create `sigma_rule_hits` table | Audit log for rule matches | None |
| Sigma YAML→SQL compiler | Parse 52 rules into ClickHouse SQL | Sigma rules in dataset |
| Docker service definition | Add hunter-agent to docker-compose.yml | None |

### Phase 2: Detection Layers (Days 4-7)

| Task | Description | Dependencies |
|------|-------------|-------------|
| Layer 1: SigmaEngine class | Load rules, compile to SQL, evaluate against event window | Phase 1 compiler |
| Layer 2: SPCEngine class | Baseline refresh, z-score/EWMA/chi-squared evaluation | entity_baselines table |
| Layer 3: MLEngine class | LightGBM ONNX inference + LanceDB HTTP client | Triage model artifacts |
| Fusion Decision Engine | 4-way decision matrix combining all 3 layers | All 3 layers |
| Kafka consumer for hunter-tasks | Async consumer with batch processing | Docker service |

### Phase 3: Investigation & Context (Days 8-10)

| Task | Description | Dependencies |
|------|-------------|-------------|
| Entity Expansion module | ±15 min ClickHouse window queries | ClickHouse access |
| Attack Graph Builder | Node/edge graph from expanded events | Entity expansion |
| LanceDB integration | attack_embeddings table + similar incident search | LanceDB service enabled |
| Evidence Assembly | Combine all signals into evidence_json | All modules |
| Write to hunter_investigations + publish to hunter-results | DB + Kafka output | All modules |

### Phase 4: Population & Tuning (Days 11-13)

| Task | Description | Dependencies |
|------|-------------|-------------|
| Populate `ioc_cache` | Seed with open-source threat feeds | None |
| Populate `asset_criticality` | Define importance for 22 hosts | None |
| SPC baseline warm-up | Run 24h of data to build initial baselines | SPC engine |
| LanceDB `attack_embeddings` seed | Populate from historical high-severity events | LanceDB enabled |
| Threshold tuning | Adjust z-score limits, ML score boundaries | All layers running |

### Phase 5: Integration Testing (Days 14-15)

| Task | Description | Dependencies |
|------|-------------|-------------|
| End-to-end test | Real logs → Triage → Hunter → hunter_investigations | All phases |
| Known attack detection test | Verify Sigma rules fire on Cobalt Strike DNS, brute force | Sigma engine |
| Novel anomaly test | Inject never-seen-before behavior, verify SPC catches it | SPC engine |
| Performance benchmark | Verify < 150 ms p95 per investigation | All layers |
| Kafka integration test | Verify hunter-results topic receives correct payloads | Kafka consumer/producer |

---

## 17. File Structure

```
agents/hunter/
├── app.py                  # Main entry: Kafka consumer, orchestrator
├── sigma_engine.py         # Layer 1: Sigma YAML→SQL compiler + evaluator
├── spc_engine.py           # Layer 2: Statistical Process Control baselines
├── ml_engine.py            # Layer 3: LightGBM ONNX + LanceDB client
├── fusion.py               # Fusion Decision Engine (3-layer combiner)
├── graph_builder.py        # Attack graph construction
├── entity_expander.py      # ClickHouse ±15 min window queries
├── evidence_assembler.py   # Combine signals into evidence_json
├── models.py               # Dataclasses (HunterVerdict, SigmaHit, SPCResult, etc.)
├── config.py               # Configuration (thresholds, timeouts, endpoints)
├── sigma_rules/            # Compiled Sigma rules (YAML + generated SQL)
│   ├── cisco/
│   ├── dns/
│   ├── firewall/
│   ├── fortinet/
│   ├── huawei/
│   ├── juniper/
│   └── zeek/
├── tests/
│   ├── test_sigma_engine.py
│   ├── test_spc_engine.py
│   ├── test_ml_engine.py
│   ├── test_fusion.py
│   ├── test_graph_builder.py
│   └── test_integration.py
├── Dockerfile
└── requirements.txt
```

---

## 18. Testing Strategy

### Unit Tests

| Test | What It Verifies |
|------|-----------------|
| `test_sigma_engine.py` | YAML→SQL compilation correctness, rule matching against mock events |
| `test_spc_engine.py` | z-score calculation, EWMA shift detection, baseline refresh |
| `test_ml_engine.py` | ONNX inference output shape/range, LanceDB client mock |
| `test_fusion.py` | All 7 decision matrix scenarios produce correct verdicts |
| `test_graph_builder.py` | Graph construction from mock event windows |

### Integration Tests

| Test | What It Verifies |
|------|-----------------|
| Known Cobalt Strike DNS | Sigma rule fires → CONFIRMED → correct MITRE tag (T1071.004) |
| Known brute force | All 3 layers agree → severity=critical, confidence > 0.90 |
| Novel zero-day injection | SPC flags deviation, ML has no match → NOVEL/INVESTIGATE |
| Legitimate admin traffic | All 3 layers clear → CLOSE → severity=info |
| High-volume host (ids-sensor-01) | Hunter completes investigation in < 500 ms despite 349K events |

### Performance Tests

| Metric | Target |
|--------|--------|
| Per-investigation latency (p95) | < 150 ms |
| Throughput | > 1,000 investigations/sec (batched) |
| Memory usage | < 2 GB (Docker container limit) |
| Cold-start time | < 30 sec (model load + baseline pull) |

---

## 19. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|-----------|
| SPC false positives during first 24h | Hunter overwhelmed with noise | High | Warm-start from historical ClickHouse data; permissive thresholds during baseline build |
| Sigma rules don't cover all source types | Known attacks missed | Medium | Start with 52 rules; add custom rules for gaps; ML covers remainder |
| LanceDB service adds latency | > 150 ms per investigation | Low | LanceDB call is async + not in critical path; timeout at 100 ms + fallback |
| features_entity_freq table missing | SPC baselines can't compute | High | **P0 fix**: Create table before Hunter implementation starts |
| 300K event windows overwhelm entity expansion | OOM or timeout | Medium | LIMIT queries to 10K most relevant events (highest triage scores first) |
| All support tables (ioc_cache, asset_criticality) are empty | Hunter has no enrichment context | High | Phase 4 population task; Hunter works without them (degraded but functional) |
| Model drift over time | ML accuracy degrades | Low | ARF online learning + SPC auto-adjusting baselines cover this |

---

## Appendix A: Data Inventory

### ClickHouse Data Summary

| Metric | Value |
|--------|-------|
| Total events (security_events) | 2,067,513 |
| Unique hostnames | 22 |
| Unique source IPs | 33 |
| Unique categories | 38 |
| Unique MITRE tactics | 6 |
| Hosts with multi-category activity | 9 |
| Triage escalated events | 233,854 (60.3%) |
| Sigma rules available | 52 (7 vendor categories) |
| MITRE mapping rules seeded | 9 |

### Triage Score Columns Available to Hunter (28 fields)

```
score_id, event_id, timestamp, source_type, hostname, source_ip, user_id,
template_id, template_rarity, combined_score, lgbm_score, eif_score, arf_score,
score_std_dev, agreement, ci_lower, ci_upper, asset_multiplier, adjusted_score,
action, ioc_match, ioc_confidence, mitre_tactic, mitre_technique,
shap_top_features, shap_summary, features_stale, model_version, disagreement_flag
```

### Cross-Host Attack Chain Evidence

| Host | IP | Tactics | Events | Techniques |
|------|----|---------|--------|------------|
| MSEDGEWIN10 | 10.0.2.17 | defense-evasion, lateral-movement, privilege-escalation | 12,733 | T1562, T1021, T1548 |
| IEWIN7 | 10.0.2.15/16 | lateral-movement, privilege-escalation | 4,097 | T1021, T1548 |
| DESKTOP-NTSSLJD | — | privilege-escalation | 19,389 | T1548 |
| fw-01 | — | defense-evasion | 354,593 | T1562 |
| host-syslog_linux_auth | — | credential-access, initial-access | 22,603 | T1078 |
| dns-resolver-01 | — | discovery | 36 | T1046 |

### DNS C2 Indicators

| Domain | Query Count | Suspicion |
|--------|-------------|-----------|
| steam.zombieden.cn | 1,406 | High — known C2 pattern |
| tinyurl.com | 1,998 | Medium — URL shortener abuse |

---

## Appendix B: Existing Triage Agent Reference

The Hunter Agent depends directly on Triage Agent output. Key Triage internals:

| Component | Detail |
|-----------|--------|
| Models | LGBM v2.0.0 (weight=0.60), EIF v2.0.0 (weight=0.15), ARF v2.0.0 (weight=0.25) |
| Training F1 | 0.9636 (LGBM) |
| Thresholds | suspicious=0.39, anomalous=0.89 |
| EIF override | Floor score = 0.45 when EIF ≥ 0.65 |
| Online learning | River ARF with ADWIN drift detection (delta=0.002) |
| Replay buffer | arf_replay_buffer (24h, 50K rows max) |
| Output topics | triage-scores (all), anomaly-alerts (escalated), hunter-tasks (escalated) |
| Source code | `agents/triage/app.py` (892 lines), `agents/triage/score_fusion.py` (626 lines) |

---

## Appendix C: LanceDB Service Reference

| Component | Detail |
|-----------|--------|
| Source | `lancedb-service/app.py` (875 lines) |
| Framework | FastAPI |
| Embedding | all-MiniLM-L6-v2 (384 dimensions, thread-safe) |
| Tables | log_embeddings, threat_intel, historical_incidents |
| New table needed | attack_embeddings (confirmed attacks only) |
| ClickHouse sync | 4 source tables (raw_logs, security_events, process_events, network_events) |
| Sync interval | Every 30 seconds (watermark-based) |
| Docker profile | `full` (currently disabled) |
| Port | 8100 |
| Seeded data | 5 historical incidents (ransomware, APT, insider, supply-chain, cryptominer) |

---

*Document auto-generated from live ClickHouse data analysis and architecture research. All metrics are from the production CLIF cluster as of March 4, 2026.*
