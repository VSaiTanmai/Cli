"""
CLIF Triage Agent — Configuration
===================================
All configuration via environment variables with sensible production defaults.
"""

import os

# ── Kafka / Redpanda ────────────────────────────────────────────────────────

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "redpanda01:9092")
CONSUMER_GROUP_ID = os.getenv("CONSUMER_GROUP_ID", "clif-triage-agent")

INPUT_TOPICS = [
    t.strip()
    for t in os.getenv(
        "INPUT_TOPICS", "raw-logs,security-events,process-events,network-events"
    ).split(",")
]

TOPIC_TEMPLATED_LOGS = os.getenv("TOPIC_TEMPLATED_LOGS", "templated-logs")
TOPIC_TRIAGE_SCORES = os.getenv("TOPIC_TRIAGE_SCORES", "triage-scores")
TOPIC_ANOMALY_ALERTS = os.getenv("TOPIC_ANOMALY_ALERTS", "anomaly-alerts")
TOPIC_DEAD_LETTER = os.getenv("TOPIC_DEAD_LETTER", "dead-letter")

# ── ClickHouse ──────────────────────────────────────────────────────────────

CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "clickhouse01")
CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "9000"))
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "clif_admin")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "clif_secure_password_change_me")
CLICKHOUSE_DB = os.getenv("CLICKHOUSE_DB", "clif_logs")

# ── Drain3 ──────────────────────────────────────────────────────────────────

DRAIN3_DEPTH = int(os.getenv("DRAIN3_DEPTH", "4"))
DRAIN3_SIM_TH = float(os.getenv("DRAIN3_SIM_TH", "0.4"))
DRAIN3_MAX_CHILDREN = int(os.getenv("DRAIN3_MAX_CHILDREN", "100"))
DRAIN3_MAX_CLUSTERS = int(os.getenv("DRAIN3_MAX_CLUSTERS", "1024"))
DRAIN3_STATE_PATH = os.getenv("DRAIN3_STATE_PATH", "/app/drain3_state.bin")
DRAIN3_CONFIG_PATH = os.getenv("DRAIN3_CONFIG_PATH", "/app/drain3.ini")

# ── Models ──────────────────────────────────────────────────────────────────

MODEL_DIR = os.getenv("MODEL_DIR", "/models")
MODEL_LGBM_PATH = os.getenv("MODEL_LGBM_PATH", "/models/lgbm_v2.0.0.onnx")
MODEL_EIF_PATH = os.getenv("MODEL_EIF_PATH", "/models/eif_v2.0.0.pkl")
MODEL_EIF_THRESHOLD_PATH = os.getenv(
    "MODEL_EIF_THRESHOLD_PATH", "/models/eif_threshold.npy"
)
MODEL_EIF_CALIBRATION_PATH = os.getenv(
    "MODEL_EIF_CALIBRATION_PATH", "/models/eif_calibration.npz"
)
MODEL_ARF_CHECKPOINT = os.getenv("MODEL_ARF_CHECKPOINT", "/models/arf_v2.0.0.pkl")
FEATURE_COLS_PATH = os.getenv("FEATURE_COLS_PATH", "/models/feature_cols.pkl")
MANIFEST_PATH = os.getenv("MANIFEST_PATH", "/models/manifest.json")

# ── Score Weights ───────────────────────────────────────────────────────────

# v2 weights: LightGBM dominates, EIF reduced (inverted discrimination
# corrected via score_flip), ARF increased (now functional with delta=0.62).
_raw_weights = os.getenv("SCORE_WEIGHTS", "lgbm=0.60,eif=0.15,arf=0.25")
SCORE_WEIGHTS = {}
for pair in _raw_weights.split(","):
    k, v = pair.split("=")
    SCORE_WEIGHTS[k.strip()] = float(v.strip())

# ── Thresholds ──────────────────────────────────────────────────────────────

# v2.1 thresholds — LABEL-LEAKAGE FIXED, retrained with honest features.
# 131K rows, 9 datasets, F1=0.9593, AUC=0.9936, 997 iterations.
# Weights: LGBM=0.60, EIF=0.15(flipped), ARF=0.25.
# Cold-start (ARF conf=0): Normal~0.15, Mal~0.86
# suspicious=0.40 → detect=97.5%, FPR=5.0%
# anomalous=0.70  → detect~85%, FPR<1%  (lowered from 0.89 for usability)
DEFAULT_SUSPICIOUS_THRESHOLD = float(
    os.getenv("DEFAULT_SUSPICIOUS_THRESHOLD", "0.40")
)
DEFAULT_ANOMALOUS_THRESHOLD = float(
    os.getenv("DEFAULT_ANOMALOUS_THRESHOLD", "0.70")
)
DISAGREEMENT_THRESHOLD = float(os.getenv("DISAGREEMENT_THRESHOLD", "0.30"))

# ── Operational ─────────────────────────────────────────────────────────────

BATCH_SIZE = int(os.getenv("BATCH_SIZE", "1000"))
INFERENCE_WORKERS = int(os.getenv("INFERENCE_WORKERS", "4"))
FEATURE_STALENESS_TIMEOUT_SEC = int(
    os.getenv("FEATURE_STALENESS_TIMEOUT_SEC", "300")
)
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
HEALTH_PORT = int(os.getenv("TRIAGE_PORT", "8300"))

# ── Connection Tracking Windows ─────────────────────────────────────────────

CONN_TIME_WINDOW_SEC = float(os.getenv("CONN_TIME_WINDOW_SEC", "2.0"))
CONN_HOST_WINDOW_SIZE = int(os.getenv("CONN_HOST_WINDOW_SIZE", "100"))
CONN_CLEANUP_INTERVAL_SEC = float(os.getenv("CONN_CLEANUP_INTERVAL_SEC", "10.0"))

# ── ARF Warm Restart Configuration ──────────────────────────────────────────
# The ARF pickle file produces CONSTANT probabilities after deserialization
# (upstream River bug). Production inference uses warm restart: a fresh model
# replays recent events from ClickHouse arf_replay_buffer to rebuild
# Hoeffding trees and ADWIN detectors. The pickle is retained as offline
# reference only — it is NEVER loaded for production inference.

ARF_WARM_RESTART = os.getenv("ARF_WARM_RESTART", "true").lower() == "true"
ARF_REPLAY_HOURS = int(os.getenv("ARF_REPLAY_HOURS", "24"))
ARF_REPLAY_MAX_ROWS = int(os.getenv("ARF_REPLAY_MAX_ROWS", "50000"))
ARF_STREAM_CSV_PATH = os.getenv(
    "ARF_STREAM_CSV_PATH", "/models/features_arf_stream_features.csv"
)

# ARF hyperparameters — must match training notebook exactly
ARF_N_MODELS = int(os.getenv("ARF_N_MODELS", "10"))
ARF_ADWIN_DELTA = float(os.getenv("ARF_ADWIN_DELTA", "0.002"))
ARF_ADWIN_WARNING_DELTA = float(os.getenv("ARF_ADWIN_WARNING_DELTA", "0.01"))
ARF_SEED = int(os.getenv("ARF_SEED", "42"))

# ARF confidence ramp: ARF weight scales from 0→1 over this many samples.
# This prevents the cold-start ARF (near-constant ~0.074) from adding dead
# weight to the combined score. The ARF's full 20% weight is only reached
# after learning from this many events.
ARF_CONFIDENCE_RAMP_SAMPLES = int(os.getenv("ARF_CONFIDENCE_RAMP_SAMPLES", "10000"))

# ARF label source: 'lgbm_pseudo' uses high-confidence LightGBM predictions
# as pseudo-labels (avoids label leakage from using the combined score).
# 'combined' uses the old behavior (action == escalate → 1).
ARF_LABEL_SOURCE = os.getenv("ARF_LABEL_SOURCE", "lgbm_pseudo")
ARF_PSEUDO_LABEL_HIGH = float(os.getenv("ARF_PSEUDO_LABEL_HIGH", "0.80"))
ARF_PSEUDO_LABEL_LOW = float(os.getenv("ARF_PSEUDO_LABEL_LOW", "0.20"))

# ── Template Rarity & IOC Post-Model Boost ──────────────────────────────────
# v2 training data now includes VARYING template_rarity for EVTX, CSIC, and
# Loghub datasets (LightGBM feature importance: #2 at 9688 gain).
# threat_intel_flag remains 0 in training, so IOC boost is still applied
# post-model. Template rarity boost is kept for additional runtime signal.
# Rare templates (< RARE_THRESHOLD) and IOC matches boost the score by up to
# BOOST_MAX_PCT percent.
TEMPLATE_RARITY_RARE_THRESHOLD = float(
    os.getenv("TEMPLATE_RARITY_RARE_THRESHOLD", "0.15")
)
TEMPLATE_RARITY_BOOST_MAX = float(
    os.getenv("TEMPLATE_RARITY_BOOST_MAX", "0.10")
)
IOC_MATCH_SCORE_BOOST = float(os.getenv("IOC_MATCH_SCORE_BOOST", "0.15"))

# ── EIF Anomaly Override ────────────────────────────────────────────────────
# When the unsupervised EIF strongly flags an event as anomalous, the combined
# score should never drop below the suspicious threshold. Without this, novel
# attacks unseen by LightGBM get DISCARDED because LGBM's 60-80% weight
# drowns out the EIF signal.
# Example: reverse shell → LGBM=0.005, EIF=0.698. Without override:
#   cold combined = 0.80*0.005 + 0.20*0.698 = 0.144 → DISCARDED!
# With override: EIF ≥ 0.70 → combined floor = suspicious threshold → MONITOR.
EIF_ANOMALY_OVERRIDE_THRESHOLD = float(
    os.getenv("EIF_ANOMALY_OVERRIDE_THRESHOLD", "0.65")
)
EIF_ANOMALY_OVERRIDE_FLOOR = float(
    os.getenv("EIF_ANOMALY_OVERRIDE_FLOOR", "0.45")  # just above suspicious
)

# ── Startup Self-Test ───────────────────────────────────────────────────────

SELFTEST_ENABLED = os.getenv("SELFTEST_ENABLED", "true").lower() == "true"
STARTUP_HEALTH_RETRIES = int(os.getenv("STARTUP_HEALTH_RETRIES", "30"))
STARTUP_HEALTH_DELAY_SEC = float(os.getenv("STARTUP_HEALTH_DELAY_SEC", "2.0"))

# ── Source Type Numeric Mapping ─────────────────────────────────────────────
# Must match the encoding used during training (06_extract_features.py)

SOURCE_TYPE_MAP = {
    "syslog": 1,
    "linux_auth": 1,
    "windows_event": 2,
    "winlogbeat": 2,
    "wineventlog": 2,
    "firewall": 3,
    "cef": 3,
    "active_directory": 4,
    "ldap": 4,
    "dns": 5,
    "dns_logs": 5,
    "cloudtrail": 6,
    "aws_cloudtrail": 6,
    "kubernetes": 7,
    "k8s_audit": 7,
    "nginx": 8,
    "apache": 8,
    "web_server": 8,
    "netflow": 9,
    "ipfix": 9,
    "ids_ips": 10,
    "zeek": 10,
    "snort": 10,
    "suricata": 10,
    # Fallback mappings for Vector source types
    "sshd": 1,
    "sudo": 1,
    "pam": 1,
    "auditd": 1,
    "sysmon": 2,
    "docker_logs": 1,
    "journald": 1,
    "http_json": 1,
    "file_logs": 1,
    "unknown": 1,
}

# ── Protocol Numeric Mapping ────────────────────────────────────────────────

PROTOCOL_MAP = {
    "tcp": 6,
    "udp": 17,
    "icmp": 1,
    "igmp": 2,
    "gre": 47,
    "esp": 50,
    "ah": 51,
    "sctp": 132,
}

# ── Severity Text → Numeric ────────────────────────────────────────────────

SEVERITY_MAP = {
    "info": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 4,
    # Also handle numeric-as-string and level names from Vector
    "0": 0,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "debug": 0,
    "INFO": 0,
    "WARNING": 2,
    "ERROR": 3,
    "CRITICAL": 4,
}
