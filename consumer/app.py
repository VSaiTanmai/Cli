"""
CLIF Consumer — Redpanda → ClickHouse ingestion pipeline.

Reads from all CLIF Redpanda topics, batches events, and bulk-inserts
into the corresponding ClickHouse tables.  Handles back-pressure,
retries, and graceful shutdown.

Environment variables (all have sensible defaults):
    KAFKA_BROKERS           comma-separated broker list
    CLICKHOUSE_HOST         ClickHouse HTTP host
    CLICKHOUSE_PORT         ClickHouse HTTP port
    CLICKHOUSE_USER         ClickHouse username
    CLICKHOUSE_PASSWORD     ClickHouse password
    CLICKHOUSE_DB           target database (default: clif_logs)
    CONSUMER_GROUP_ID       Kafka consumer group
    CONSUMER_BATCH_SIZE     max events per INSERT batch
    CONSUMER_FLUSH_INTERVAL_SEC  max seconds between flushes
    CONSUMER_MAX_RETRIES    retries on ClickHouse insert failure
    LOG_LEVEL               Python log level (DEBUG/INFO/WARNING/…)
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
import uuid
from datetime import datetime, timezone
from threading import Event, Thread
from typing import Any

from confluent_kafka import Consumer, KafkaError, KafkaException
import clickhouse_connect

# ── Configuration ────────────────────────────────────────────────────────────

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "redpanda01:9092")
CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "clickhouse01")
CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "8123"))
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "clif_admin")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "clif_secure_password_change_me")
CLICKHOUSE_DB = os.getenv("CLICKHOUSE_DB", "clif_logs")
CONSUMER_GROUP = os.getenv("CONSUMER_GROUP_ID", "clif-clickhouse-consumer")
BATCH_SIZE = int(os.getenv("CONSUMER_BATCH_SIZE", "5000"))
FLUSH_INTERVAL = float(os.getenv("CONSUMER_FLUSH_INTERVAL_SEC", "2"))
MAX_RETRIES = int(os.getenv("CONSUMER_MAX_RETRIES", "5"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

# Topic → ClickHouse table mapping
TOPIC_TABLE_MAP: dict[str, str] = {
    "raw-logs": "raw_logs",
    "security-events": "security_events",
    "process-events": "process_events",
    "network-events": "network_events",
}

TOPICS = list(TOPIC_TABLE_MAP.keys())

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    format="%(asctime)s  %(levelname)-8s  [%(name)s]  %(message)s",
    level=getattr(logging, LOG_LEVEL, logging.INFO),
)
log = logging.getLogger("clif.consumer")

# ── Graceful shutdown ────────────────────────────────────────────────────────

_shutdown = Event()


def _handle_signal(sig: int, _frame: Any) -> None:
    log.warning("Received signal %s — initiating graceful shutdown …", sig)
    _shutdown.set()


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)

# ── Helpers ──────────────────────────────────────────────────────────────────


def _parse_timestamp(raw: str | None) -> str:
    """Return a ClickHouse-compatible DateTime64 string."""
    if not raw:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    except (ValueError, AttributeError):
        return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def _safe_str(val: Any, default: str = "") -> str:
    return str(val) if val is not None else default


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


# ── Row builders (one per target table) ──────────────────────────────────────


def _build_raw_log_row(msg: dict) -> list:
    meta = msg.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = {}
    return [
        str(uuid.uuid4()),                     # event_id
        _parse_timestamp(msg.get("timestamp")), # timestamp
        datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],  # received_at
        _safe_str(msg.get("level"), "INFO"),    # level
        _safe_str(msg.get("source"), "unknown"),# source
        _safe_str(msg.get("message")),          # message
        {str(k): str(v) for k, v in meta.items()},  # metadata
        _safe_str(meta.get("user_id")),         # user_id
        _safe_str(meta.get("ip_address"), "0.0.0.0"),  # ip_address
        _safe_str(meta.get("request_id")),      # request_id
        "",                                     # anchor_tx_id
        "",                                     # anchor_batch_hash
    ]


def _build_security_event_row(msg: dict) -> list:
    meta = msg.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = {}
    return [
        str(uuid.uuid4()),
        _parse_timestamp(msg.get("timestamp")),
        _safe_int(msg.get("severity"), 0),
        _safe_str(msg.get("category"), "unknown"),
        _safe_str(msg.get("source"), "unknown"),
        _safe_str(msg.get("description")),
        _safe_str(msg.get("user_id")),
        _safe_str(msg.get("ip_address"), "0.0.0.0"),
        _safe_str(msg.get("hostname")),
        _safe_str(msg.get("mitre_tactic")),
        _safe_str(msg.get("mitre_technique")),
        _safe_float(msg.get("ai_confidence")),
        _safe_str(msg.get("ai_explanation")),
        str(uuid.uuid4()),                      # raw_log_event_id placeholder
        "",                                     # anchor_tx_id
        {str(k): str(v) for k, v in meta.items()},
    ]


def _build_process_event_row(msg: dict) -> list:
    meta = msg.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = {}
    return [
        str(uuid.uuid4()),
        _parse_timestamp(msg.get("timestamp")),
        _safe_str(msg.get("hostname")),
        _safe_int(msg.get("pid")),
        _safe_int(msg.get("ppid")),
        _safe_int(msg.get("uid")),
        _safe_int(msg.get("gid")),
        _safe_str(msg.get("binary_path")),
        _safe_str(msg.get("arguments")),
        _safe_str(msg.get("cwd")),
        _safe_int(msg.get("exit_code"), -1),
        _safe_str(msg.get("container_id")),
        _safe_str(msg.get("pod_name")),
        _safe_str(msg.get("namespace")),
        _safe_str(msg.get("syscall")),
        _safe_int(msg.get("is_suspicious")),
        _safe_str(msg.get("detection_rule")),
        "",
        {str(k): str(v) for k, v in meta.items()},
    ]


def _build_network_event_row(msg: dict) -> list:
    meta = msg.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = {}
    return [
        str(uuid.uuid4()),
        _parse_timestamp(msg.get("timestamp")),
        _safe_str(msg.get("hostname")),
        _safe_str(msg.get("src_ip"), "0.0.0.0"),
        _safe_int(msg.get("src_port")),
        _safe_str(msg.get("dst_ip"), "0.0.0.0"),
        _safe_int(msg.get("dst_port")),
        _safe_str(msg.get("protocol"), "TCP"),
        _safe_str(msg.get("direction"), "outbound"),
        _safe_int(msg.get("bytes_sent")),
        _safe_int(msg.get("bytes_received")),
        _safe_int(msg.get("duration_ms")),
        _safe_int(msg.get("pid")),
        _safe_str(msg.get("binary_path")),
        _safe_str(msg.get("container_id")),
        _safe_str(msg.get("pod_name")),
        _safe_str(msg.get("namespace")),
        _safe_str(msg.get("dns_query")),
        _safe_str(msg.get("geo_country")),
        _safe_int(msg.get("is_suspicious")),
        _safe_str(msg.get("detection_rule")),
        "",
        {str(k): str(v) for k, v in meta.items()},
    ]


# Column lists matching the row builders above
RAW_LOGS_COLUMNS = [
    "event_id", "timestamp", "received_at", "level", "source", "message",
    "metadata", "user_id", "ip_address", "request_id",
    "anchor_tx_id", "anchor_batch_hash",
]
SECURITY_EVENTS_COLUMNS = [
    "event_id", "timestamp", "severity", "category", "source", "description",
    "user_id", "ip_address", "hostname",
    "mitre_tactic", "mitre_technique", "ai_confidence", "ai_explanation",
    "raw_log_event_id", "anchor_tx_id", "metadata",
]
PROCESS_EVENTS_COLUMNS = [
    "event_id", "timestamp", "hostname", "pid", "ppid", "uid", "gid",
    "binary_path", "arguments", "cwd", "exit_code",
    "container_id", "pod_name", "namespace", "syscall",
    "is_suspicious", "detection_rule", "anchor_tx_id", "metadata",
]
NETWORK_EVENTS_COLUMNS = [
    "event_id", "timestamp", "hostname",
    "src_ip", "src_port", "dst_ip", "dst_port",
    "protocol", "direction", "bytes_sent", "bytes_received", "duration_ms",
    "pid", "binary_path", "container_id", "pod_name", "namespace",
    "dns_query", "geo_country", "is_suspicious", "detection_rule",
    "anchor_tx_id", "metadata",
]

TABLE_META: dict[str, dict] = {
    "raw_logs":        {"columns": RAW_LOGS_COLUMNS,        "builder": _build_raw_log_row},
    "security_events": {"columns": SECURITY_EVENTS_COLUMNS, "builder": _build_security_event_row},
    "process_events":  {"columns": PROCESS_EVENTS_COLUMNS,  "builder": _build_process_event_row},
    "network_events":  {"columns": NETWORK_EVENTS_COLUMNS,  "builder": _build_network_event_row},
}

# ── ClickHouse writer ────────────────────────────────────────────────────────


class ClickHouseWriter:
    """Manages batched inserts into ClickHouse."""

    def __init__(self) -> None:
        self.client = self._connect()

    def _connect(self):
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                client = clickhouse_connect.get_client(
                    host=CLICKHOUSE_HOST,
                    port=CLICKHOUSE_PORT,
                    username=CLICKHOUSE_USER,
                    password=CLICKHOUSE_PASSWORD,
                    database=CLICKHOUSE_DB,
                    connect_timeout=30,
                    send_receive_timeout=60,
                )
                log.info("Connected to ClickHouse at %s:%s (attempt %d)", CLICKHOUSE_HOST, CLICKHOUSE_PORT, attempt)
                return client
            except Exception as exc:
                log.warning("ClickHouse connection attempt %d failed: %s", attempt, exc)
                if attempt == MAX_RETRIES:
                    raise
                time.sleep(min(2 ** attempt, 30))
        raise RuntimeError("unreachable")

    def insert(self, table: str, columns: list[str], rows: list[list]) -> None:
        """Insert a batch of rows with retries."""
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                self.client.insert(table, rows, column_names=columns)
                return
            except Exception as exc:
                log.warning(
                    "Insert into %s failed (attempt %d/%d, %d rows): %s",
                    table, attempt, MAX_RETRIES, len(rows), exc,
                )
                if attempt == MAX_RETRIES:
                    raise
                time.sleep(min(2 ** attempt, 15))
                # Reconnect on persistent failures
                try:
                    self.client = self._connect()
                except Exception:
                    pass


# ── Stats reporter ───────────────────────────────────────────────────────────


class StatsReporter(Thread):
    """Periodically logs ingestion stats."""

    def __init__(self) -> None:
        super().__init__(daemon=True, name="stats-reporter")
        self.counts: dict[str, int] = {t: 0 for t in TOPICS}
        self.errors: int = 0

    def run(self) -> None:
        while not _shutdown.is_set():
            _shutdown.wait(30)
            total = sum(self.counts.values())
            log.info(
                "Stats — total=%d  %s  errors=%d",
                total,
                "  ".join(f"{t}={c}" for t, c in self.counts.items()),
                self.errors,
            )


# ── Main consumer loop ──────────────────────────────────────────────────────


def main() -> None:
    log.info("Starting CLIF consumer  brokers=%s  group=%s  batch=%d  flush=%ss",
             KAFKA_BROKERS, CONSUMER_GROUP, BATCH_SIZE, FLUSH_INTERVAL)

    writer = ClickHouseWriter()
    stats = StatsReporter()
    stats.start()

    consumer = Consumer({
        "bootstrap.servers": KAFKA_BROKERS,
        "group.id": CONSUMER_GROUP,
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
        "session.timeout.ms": 30000,
        "max.poll.interval.ms": 300000,
        "fetch.min.bytes": 1,
        "fetch.wait.max.ms": 500,
    })
    consumer.subscribe(TOPICS)
    log.info("Subscribed to topics: %s", TOPICS)

    # Per-table row buffers
    buffers: dict[str, list[list]] = {table: [] for table in TABLE_META}
    last_flush = time.monotonic()

    try:
        while not _shutdown.is_set():
            msg = consumer.poll(timeout=1.0)

            if msg is None:
                # No message — check if we need a time-based flush
                if time.monotonic() - last_flush >= FLUSH_INTERVAL:
                    _flush_all(writer, buffers, stats)
                    consumer.commit(asynchronous=False)
                    last_flush = time.monotonic()
                continue

            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                log.error("Consumer error: %s", msg.error())
                stats.errors += 1
                continue

            topic = msg.topic()
            table = TOPIC_TABLE_MAP.get(topic)
            if table is None:
                continue

            try:
                payload = json.loads(msg.value().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                log.warning("Bad message on %s offset=%s: %s", topic, msg.offset(), exc)
                stats.errors += 1
                continue

            builder = TABLE_META[table]["builder"]
            try:
                row = builder(payload)
                buffers[table].append(row)
                stats.counts[topic] += 1
            except Exception as exc:
                log.warning("Row build error on %s: %s", topic, exc)
                stats.errors += 1
                continue

            # Size-based flush
            total_buffered = sum(len(b) for b in buffers.values())
            if total_buffered >= BATCH_SIZE:
                _flush_all(writer, buffers, stats)
                consumer.commit(asynchronous=False)
                last_flush = time.monotonic()

            # Time-based flush
            if time.monotonic() - last_flush >= FLUSH_INTERVAL:
                _flush_all(writer, buffers, stats)
                consumer.commit(asynchronous=False)
                last_flush = time.monotonic()

    except KeyboardInterrupt:
        log.info("Interrupted.")
    finally:
        log.info("Flushing remaining buffers …")
        _flush_all(writer, buffers, stats)
        try:
            consumer.commit(asynchronous=False)
        except Exception:
            pass
        consumer.close()
        log.info("Consumer shut down cleanly.")


def _flush_all(
    writer: ClickHouseWriter,
    buffers: dict[str, list[list]],
    stats: StatsReporter,
) -> None:
    for table, rows in buffers.items():
        if not rows:
            continue
        columns = TABLE_META[table]["columns"]
        try:
            writer.insert(table, columns, rows)
            log.debug("Flushed %d rows → %s", len(rows), table)
        except Exception as exc:
            log.error("Failed to flush %d rows → %s: %s", len(rows), table, exc)
            stats.errors += len(rows)
        rows.clear()


if __name__ == "__main__":
    main()
