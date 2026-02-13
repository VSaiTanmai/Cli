-- =============================================================================
-- CLIF ClickHouse Schema — Stage 3 Storage Layer
-- =============================================================================
-- Applied automatically on first start via docker-entrypoint-initdb.d
-- Engine: ReplicatedMergeTree with ZSTD compression
-- Partitioning: daily on timestamp
-- TTL: 7 days hot  ➜  30 days warm  ➜  S3 cold
-- =============================================================================

CREATE DATABASE IF NOT EXISTS clif_logs ON CLUSTER 'clif_cluster';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. raw_logs — every ingested log line
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clif_logs.raw_logs ON CLUSTER 'clif_cluster'
(
    event_id          UUID          DEFAULT generateUUIDv4()  CODEC(ZSTD(3)),
    timestamp         DateTime64(3) DEFAULT now64()            CODEC(Delta, ZSTD(3)),
    received_at       DateTime64(3) DEFAULT now64()            CODEC(Delta, ZSTD(3)),
    level             LowCardinality(String)                   CODEC(ZSTD(1)),
    source            LowCardinality(String)                   CODEC(ZSTD(1)),
    message           String                                   CODEC(ZSTD(3)),
    -- Structured metadata stored as a flexible map
    metadata          Map(String, String)                      CODEC(ZSTD(3)),
    -- Fields frequently used in WHERE clauses
    user_id           String        DEFAULT ''                 CODEC(ZSTD(1)),
    ip_address        IPv4          DEFAULT toIPv4('0.0.0.0')  CODEC(ZSTD(1)),
    request_id        String        DEFAULT ''                 CODEC(ZSTD(1)),
    -- Blockchain anchoring (populated asynchronously)
    anchor_tx_id      String        DEFAULT ''                 CODEC(ZSTD(1)),
    anchor_batch_hash String        DEFAULT ''                 CODEC(ZSTD(1)),

    -- Projection index for full-text search on message
    INDEX idx_message  message  TYPE tokenbf_v1(30720, 2, 0)  GRANULARITY 1,
    INDEX idx_user_id  user_id  TYPE bloom_filter(0.01)        GRANULARITY 4,
    INDEX idx_ip       ip_address TYPE minmax                  GRANULARITY 4,
    INDEX idx_req_id   request_id TYPE bloom_filter(0.01)      GRANULARITY 4
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/raw_logs',
    '{replica}'
)
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (source, level, timestamp, event_id)
TTL
    toDateTime(timestamp) + INTERVAL 7  DAY TO VOLUME 'warm',
    toDateTime(timestamp) + INTERVAL 30 DAY TO VOLUME 'cold',
    toDateTime(timestamp) + INTERVAL 90 DAY DELETE
SETTINGS
    index_granularity          = 8192,
    storage_policy             = 'clif_tiered',
    merge_with_ttl_timeout     = 3600,
    ttl_only_drop_parts        = 0;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. security_events — parsed security-relevant events
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clif_logs.security_events ON CLUSTER 'clif_cluster'
(
    event_id          UUID          DEFAULT generateUUIDv4()    CODEC(ZSTD(3)),
    timestamp         DateTime64(3) DEFAULT now64()              CODEC(Delta, ZSTD(3)),
    severity          UInt8         DEFAULT 0                    CODEC(ZSTD(1)),   -- 0=info … 4=critical
    category          LowCardinality(String)                     CODEC(ZSTD(1)),   -- e.g., auth, malware, exfil
    source            LowCardinality(String)                     CODEC(ZSTD(1)),
    description       String                                     CODEC(ZSTD(3)),
    -- Subject
    user_id           String        DEFAULT ''                   CODEC(ZSTD(1)),
    ip_address        IPv4          DEFAULT toIPv4('0.0.0.0')    CODEC(ZSTD(1)),
    hostname          String        DEFAULT ''                   CODEC(ZSTD(1)),
    -- MITRE ATT&CK mapping
    mitre_tactic      LowCardinality(String) DEFAULT ''          CODEC(ZSTD(1)),
    mitre_technique   LowCardinality(String) DEFAULT ''          CODEC(ZSTD(1)),
    -- AI enrichment
    ai_confidence     Float32       DEFAULT 0.0                  CODEC(ZSTD(1)),
    ai_explanation    String        DEFAULT ''                   CODEC(ZSTD(3)),
    -- Evidence integrity
    raw_log_event_id  UUID          DEFAULT generateUUIDv4()    CODEC(ZSTD(3)),
    anchor_tx_id      String        DEFAULT ''                   CODEC(ZSTD(1)),
    metadata          Map(String, String)                        CODEC(ZSTD(3)),

    INDEX idx_category   category     TYPE set(100)              GRANULARITY 4,
    INDEX idx_severity   severity     TYPE minmax                GRANULARITY 4,
    INDEX idx_mitre_t    mitre_tactic TYPE set(50)               GRANULARITY 4,
    INDEX idx_user_id    user_id      TYPE bloom_filter(0.01)    GRANULARITY 4,
    INDEX idx_ip         ip_address   TYPE minmax                GRANULARITY 4,
    INDEX idx_desc       description  TYPE tokenbf_v1(30720, 2, 0) GRANULARITY 1
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/security_events',
    '{replica}'
)
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (category, severity, timestamp, event_id)
TTL
    toDateTime(timestamp) + INTERVAL 7  DAY TO VOLUME 'warm',
    toDateTime(timestamp) + INTERVAL 30 DAY TO VOLUME 'cold',
    toDateTime(timestamp) + INTERVAL 180 DAY DELETE
SETTINGS
    index_granularity      = 8192,
    storage_policy         = 'clif_tiered',
    merge_with_ttl_timeout = 3600;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. process_events — kernel-level process execution (Tetragon source)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clif_logs.process_events ON CLUSTER 'clif_cluster'
(
    event_id          UUID          DEFAULT generateUUIDv4()    CODEC(ZSTD(3)),
    timestamp         DateTime64(3) DEFAULT now64()              CODEC(Delta, ZSTD(3)),
    hostname          String        DEFAULT ''                   CODEC(ZSTD(1)),
    -- Process info
    pid               UInt32        DEFAULT 0                    CODEC(Delta, ZSTD(1)),
    ppid              UInt32        DEFAULT 0                    CODEC(Delta, ZSTD(1)),
    uid               UInt32        DEFAULT 0                    CODEC(ZSTD(1)),
    gid               UInt32        DEFAULT 0                    CODEC(ZSTD(1)),
    binary_path       String        DEFAULT ''                   CODEC(ZSTD(3)),
    arguments         String        DEFAULT ''                   CODEC(ZSTD(3)),
    cwd               String        DEFAULT ''                   CODEC(ZSTD(3)),
    exit_code         Int32         DEFAULT -1                   CODEC(ZSTD(1)),
    -- Container context
    container_id      String        DEFAULT ''                   CODEC(ZSTD(1)),
    pod_name          String        DEFAULT ''                   CODEC(ZSTD(1)),
    namespace         LowCardinality(String) DEFAULT ''          CODEC(ZSTD(1)),
    -- Syscall detail
    syscall           LowCardinality(String) DEFAULT ''          CODEC(ZSTD(1)),
    -- Enrichment
    is_suspicious     UInt8         DEFAULT 0                    CODEC(ZSTD(1)),
    detection_rule    String        DEFAULT ''                   CODEC(ZSTD(1)),
    anchor_tx_id      String        DEFAULT ''                   CODEC(ZSTD(1)),
    metadata          Map(String, String)                        CODEC(ZSTD(3)),

    INDEX idx_binary    binary_path  TYPE tokenbf_v1(10240, 2, 0) GRANULARITY 1,
    INDEX idx_pid       pid          TYPE minmax                   GRANULARITY 4,
    INDEX idx_container container_id TYPE bloom_filter(0.01)       GRANULARITY 4,
    INDEX idx_ns        namespace    TYPE set(200)                 GRANULARITY 4,
    INDEX idx_syscall   syscall      TYPE set(500)                 GRANULARITY 4
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/process_events',
    '{replica}'
)
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (hostname, timestamp, pid, event_id)
TTL
    toDateTime(timestamp) + INTERVAL 7  DAY TO VOLUME 'warm',
    toDateTime(timestamp) + INTERVAL 30 DAY TO VOLUME 'cold',
    toDateTime(timestamp) + INTERVAL 90 DAY DELETE
SETTINGS
    index_granularity      = 8192,
    storage_policy         = 'clif_tiered',
    merge_with_ttl_timeout = 3600;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. network_events — network connection logs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clif_logs.network_events ON CLUSTER 'clif_cluster'
(
    event_id          UUID          DEFAULT generateUUIDv4()    CODEC(ZSTD(3)),
    timestamp         DateTime64(3) DEFAULT now64()              CODEC(Delta, ZSTD(3)),
    hostname          String        DEFAULT ''                   CODEC(ZSTD(1)),
    -- Connection info
    src_ip            IPv4          DEFAULT toIPv4('0.0.0.0')    CODEC(ZSTD(1)),
    src_port          UInt16        DEFAULT 0                    CODEC(ZSTD(1)),
    dst_ip            IPv4          DEFAULT toIPv4('0.0.0.0')    CODEC(ZSTD(1)),
    dst_port          UInt16        DEFAULT 0                    CODEC(ZSTD(1)),
    protocol          LowCardinality(String) DEFAULT 'TCP'       CODEC(ZSTD(1)),
    direction         LowCardinality(String) DEFAULT 'outbound'  CODEC(ZSTD(1)),
    bytes_sent        UInt64        DEFAULT 0                    CODEC(Delta, ZSTD(1)),
    bytes_received    UInt64        DEFAULT 0                    CODEC(Delta, ZSTD(1)),
    duration_ms       UInt32        DEFAULT 0                    CODEC(ZSTD(1)),
    -- Process context
    pid               UInt32        DEFAULT 0                    CODEC(Delta, ZSTD(1)),
    binary_path       String        DEFAULT ''                   CODEC(ZSTD(3)),
    container_id      String        DEFAULT ''                   CODEC(ZSTD(1)),
    pod_name          String        DEFAULT ''                   CODEC(ZSTD(1)),
    namespace         LowCardinality(String) DEFAULT ''          CODEC(ZSTD(1)),
    -- Enrichment
    dns_query         String        DEFAULT ''                   CODEC(ZSTD(3)),
    geo_country       LowCardinality(String) DEFAULT ''          CODEC(ZSTD(1)),
    is_suspicious     UInt8         DEFAULT 0                    CODEC(ZSTD(1)),
    detection_rule    String        DEFAULT ''                   CODEC(ZSTD(1)),
    anchor_tx_id      String        DEFAULT ''                   CODEC(ZSTD(1)),
    metadata          Map(String, String)                        CODEC(ZSTD(3)),

    INDEX idx_src_ip    src_ip      TYPE minmax              GRANULARITY 4,
    INDEX idx_dst_ip    dst_ip      TYPE minmax              GRANULARITY 4,
    INDEX idx_dst_port  dst_port    TYPE minmax               GRANULARITY 4,
    INDEX idx_protocol  protocol    TYPE set(20)             GRANULARITY 4,
    INDEX idx_dns       dns_query   TYPE tokenbf_v1(10240, 2, 0) GRANULARITY 1,
    INDEX idx_container container_id TYPE bloom_filter(0.01)  GRANULARITY 4
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/network_events',
    '{replica}'
)
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (src_ip, dst_ip, timestamp, event_id)
TTL
    toDateTime(timestamp) + INTERVAL 7  DAY TO VOLUME 'warm',
    toDateTime(timestamp) + INTERVAL 30 DAY TO VOLUME 'cold',
    toDateTime(timestamp) + INTERVAL 90 DAY DELETE
SETTINGS
    index_granularity      = 8192,
    storage_policy         = 'clif_tiered',
    merge_with_ttl_timeout = 3600;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Materialized views for real-time aggregations
-- ─────────────────────────────────────────────────────────────────────────────

-- Events-per-minute rollup (useful for dashboard sparklines)
CREATE TABLE IF NOT EXISTS clif_logs.events_per_minute ON CLUSTER 'clif_cluster'
(
    minute       DateTime       CODEC(Delta, ZSTD(1)),
    source       LowCardinality(String) CODEC(ZSTD(1)),
    level        LowCardinality(String) CODEC(ZSTD(1)),
    event_count  SimpleAggregateFunction(sum, UInt64)
)
ENGINE = ReplicatedAggregatingMergeTree(
    '/clickhouse/tables/{shard}/events_per_minute',
    '{replica}'
)
PARTITION BY toYYYYMM(minute)
ORDER BY (minute, source, level);

CREATE MATERIALIZED VIEW IF NOT EXISTS clif_logs.events_per_minute_mv ON CLUSTER 'clif_cluster'
TO clif_logs.events_per_minute
AS
SELECT
    toStartOfMinute(timestamp) AS minute,
    source,
    level,
    count() AS event_count
FROM clif_logs.raw_logs
GROUP BY minute, source, level;


-- Security severity rollup
CREATE TABLE IF NOT EXISTS clif_logs.security_severity_hourly ON CLUSTER 'clif_cluster'
(
    hour         DateTime       CODEC(Delta, ZSTD(1)),
    category     LowCardinality(String) CODEC(ZSTD(1)),
    severity     UInt8          CODEC(ZSTD(1)),
    event_count  SimpleAggregateFunction(sum, UInt64)
)
ENGINE = ReplicatedAggregatingMergeTree(
    '/clickhouse/tables/{shard}/security_severity_hourly',
    '{replica}'
)
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, category, severity);

CREATE MATERIALIZED VIEW IF NOT EXISTS clif_logs.security_severity_hourly_mv ON CLUSTER 'clif_cluster'
TO clif_logs.security_severity_hourly
AS
SELECT
    toStartOfHour(timestamp) AS hour,
    category,
    severity,
    count() AS event_count
FROM clif_logs.security_events
GROUP BY hour, category, severity;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Additional MVs — cover all 4 tables for events_per_minute
-- ─────────────────────────────────────────────────────────────────────────────

-- Security events → events_per_minute
CREATE MATERIALIZED VIEW IF NOT EXISTS clif_logs.events_per_minute_security_mv ON CLUSTER 'clif_cluster'
TO clif_logs.events_per_minute
AS
SELECT
    toStartOfMinute(timestamp) AS minute,
    source,
    category AS level,
    count() AS event_count
FROM clif_logs.security_events
GROUP BY minute, source, level;

-- Process events → events_per_minute
CREATE MATERIALIZED VIEW IF NOT EXISTS clif_logs.events_per_minute_process_mv ON CLUSTER 'clif_cluster'
TO clif_logs.events_per_minute
AS
SELECT
    toStartOfMinute(timestamp) AS minute,
    'process' AS source,
    if(is_suspicious = 1, 'SUSPICIOUS', 'NORMAL') AS level,
    count() AS event_count
FROM clif_logs.process_events
GROUP BY minute, source, level;

-- Network events → events_per_minute
CREATE MATERIALIZED VIEW IF NOT EXISTS clif_logs.events_per_minute_network_mv ON CLUSTER 'clif_cluster'
TO clif_logs.events_per_minute
AS
SELECT
    toStartOfMinute(timestamp) AS minute,
    protocol AS source,
    direction AS level,
    count() AS event_count
FROM clif_logs.network_events
GROUP BY minute, source, level;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. evidence_anchors — Merkle tree anchor records for forensic integrity
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clif_logs.evidence_anchors ON CLUSTER 'clif_cluster'
(
    batch_id          String                                     CODEC(ZSTD(1)),
    table_name        LowCardinality(String)                     CODEC(ZSTD(1)),
    time_from         DateTime64(3)                              CODEC(Delta, ZSTD(3)),
    time_to           DateTime64(3)                              CODEC(Delta, ZSTD(3)),
    event_count       UInt64        DEFAULT 0                    CODEC(ZSTD(1)),
    merkle_root       String                                     CODEC(ZSTD(3)),
    merkle_depth      UInt8         DEFAULT 0                    CODEC(ZSTD(1)),
    leaf_hashes       Array(String)                              CODEC(ZSTD(3)),
    s3_key            String        DEFAULT ''                   CODEC(ZSTD(1)),
    s3_version_id     String        DEFAULT ''                   CODEC(ZSTD(1)),
    status            LowCardinality(String) DEFAULT 'Pending'   CODEC(ZSTD(1)),
    prev_merkle_root  String        DEFAULT ''                   CODEC(ZSTD(3)),
    created_at        DateTime64(3) DEFAULT now64()              CODEC(Delta, ZSTD(3)),

    INDEX idx_table    table_name   TYPE set(10)                 GRANULARITY 1,
    INDEX idx_status   status       TYPE set(10)                 GRANULARITY 1
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/evidence_anchors',
    '{replica}'
)
PARTITION BY toYYYYMM(created_at)
ORDER BY (table_name, time_from, batch_id)
TTL
    toDateTime(created_at) + INTERVAL 365 DAY DELETE
SETTINGS
    index_granularity = 8192;
