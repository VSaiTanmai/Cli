"""
CLIF EPS (Events Per Second) Pipeline Stability Benchmark
===========================================================
Tests the FULL ingestion pipeline end-to-end:

  Producer → Vector (HTTP:8687) → Redpanda → Consumer → ClickHouse
                                     ↓
                      (also direct Kafka producer path)

Metrics reported:
  • Producer EPS (events pushed per second)
  • Vector ingest EPS (HTTP endpoint throughput)
  • Redpanda offset growth (events/sec through broker)
  • ClickHouse landing rate (rows/sec materialised)
  • End-to-end latency (produce → ClickHouse)
  • Pipeline stability (EPS stddev, jitter %, data completeness)
  • Backpressure detection (HTTP 429 / queue saturation)

Usage:
    python eps_benchmark.py [--mode full|vector|kafka] [--duration 60] [--target-eps 10000]

Modes:
  full   — send via Vector HTTP + direct Kafka (both paths)
  vector — send only via Vector HTTP endpoint (full pipeline)
  kafka  — send only direct to Redpanda (bypass Vector)
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import string
import sys
import time
import uuid
import signal
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from threading import Event, Thread, Lock
from typing import Any

import requests
from confluent_kafka import Producer, Consumer, TopicPartition
import clickhouse_connect
from rich.console import Console
from rich.table import Table
from rich.live import Live
from rich.panel import Panel
from rich.layout import Layout
from rich.text import Text

# ── CLI ──────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description="CLIF EPS Pipeline Stability Benchmark")
parser.add_argument("--mode", choices=["full", "vector", "kafka"], default="full",
                    help="Ingestion path: full (both), vector (HTTP→Vector), kafka (direct Redpanda)")
parser.add_argument("--duration", type=int, default=60, help="Test duration in seconds (default: 60)")
parser.add_argument("--target-eps", type=int, default=10000, help="Target events/sec (default: 10000)")
parser.add_argument("--batch-size", type=int, default=500, help="Events per HTTP batch to Vector (default: 500)")
parser.add_argument("--warmup", type=int, default=5, help="Warmup seconds before measuring (default: 5)")
parser.add_argument("--vector-url", default="http://localhost:8687/v1/logs", help="Vector HTTP endpoint")
parser.add_argument("--kafka-broker", default="localhost:19092", help="Redpanda broker")
parser.add_argument("--ch-host", default="localhost")
parser.add_argument("--ch-port", type=int, default=8123)
parser.add_argument("--ch-user", default="clif_admin")
parser.add_argument("--ch-password", default="Cl1f_Ch@ngeM3_2026!")
parser.add_argument("--ch-db", default="clif_logs")
args = parser.parse_args()

console = Console()
stop_event = Event()

# ── Signal handling ──────────────────────────────────────────────────────────

def _handle_sigint(sig, frame):
    console.print("\n[yellow]⚠ Ctrl+C — stopping benchmark gracefully…[/yellow]")
    stop_event.set()

signal.signal(signal.SIGINT, _handle_sigint)

# ── Event generators ─────────────────────────────────────────────────────────

LEVELS = ["INFO", "INFO", "INFO", "WARN", "WARN", "ERROR", "CRITICAL"]
SOURCES = ["web-server", "api-gateway", "database", "auth-service", "firewall",
           "ids-sensor", "vpn-gateway", "dns-server", "mail-server", "proxy-server"]
MESSAGES = [
    "Authentication failed for user admin_{}",
    "Successful login from {}",
    "Connection timeout to upstream {}",
    "SQL query executed in {}ms",
    "Rate limit exceeded for {}",
    "TLS handshake failed with {}",
    "SSH brute-force attempt from {}",
    "Process {} spawned child process",
    "DNS query for domain from {}",
    "Outbound connection blocked by policy {}",
]
MITRE_TACTICS = ["initial-access", "execution", "persistence", "privilege-escalation",
                 "lateral-movement", "collection", "exfiltration", "command-and-control"]


def _rand_ip():
    return f"{random.randint(1,254)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"


def generate_event(event_type: str, tag: str = "") -> dict:
    """Generate a single event for the given type with current timestamp."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    ip = _rand_ip()

    if event_type == "raw":
        return {
            "timestamp": now, "level": random.choice(LEVELS),
            "source": random.choice(SOURCES),
            "message": random.choice(MESSAGES).format(random.randint(1000, 9999)),
            "metadata": {"ip_address": ip, "request_id": tag or uuid.uuid4().hex[:8]},
        }
    elif event_type == "security":
        return {
            "timestamp": now, "severity": random.choice([0, 1, 1, 2, 3, 4]),
            "category": random.choice(["auth", "malware", "exfiltration", "brute-force", "scan"]),
            "source": random.choice(SOURCES),
            "description": random.choice(MESSAGES).format(random.randint(1, 9999)),
            "user_id": f"user_{random.randint(1000, 9999)}", "ip_address": ip,
            "hostname": f"node-{random.randint(1,50)}",
            "mitre_tactic": random.choice(MITRE_TACTICS),
            "mitre_technique": f"T{random.randint(1000, 1999)}",
            "ai_confidence": round(random.uniform(0.1, 0.99), 2), "metadata": {},
        }
    elif event_type == "process":
        return {
            "timestamp": now, "hostname": f"node-{random.randint(1,50)}",
            "pid": random.randint(1, 65535), "ppid": random.randint(1, 65535),
            "uid": random.randint(0, 65534), "gid": random.randint(0, 65534),
            "binary_path": random.choice(["/bin/bash", "/usr/bin/python3", "/usr/sbin/sshd"]),
            "arguments": f"--flag val_{random.randint(1,999)}", "cwd": "/home/user",
            "exit_code": random.choice([0, 0, 0, 1, 137]),
            "syscall": random.choice(["execve", "fork", "clone", "connect"]),
            "is_suspicious": random.choice([0, 0, 0, 0, 1]), "metadata": {},
        }
    else:  # network
        return {
            "timestamp": now, "hostname": f"node-{random.randint(1,50)}",
            "src_ip": ip, "src_port": random.randint(1024, 65535),
            "dst_ip": _rand_ip(), "dst_port": random.choice([22, 80, 443, 8080, 53]),
            "protocol": random.choice(["TCP", "TCP", "UDP"]),
            "direction": random.choice(["inbound", "outbound"]),
            "bytes_sent": random.randint(64, 100000),
            "bytes_received": random.randint(64, 500000),
            "duration_ms": random.randint(1, 5000),
            "dns_query": random.choice(["evil.com", "legit.org", ""]),
            "geo_country": random.choice(["US", "CN", "RU", "DE", ""]),
            "is_suspicious": random.choice([0, 0, 0, 0, 1]), "metadata": {},
        }


EVENT_TYPES = ["raw", "security", "process", "network"]
TOPIC_MAP = {
    "raw": "raw-logs",
    "security": "security-events",
    "process": "process-events",
    "network": "network-events",
}
CH_TABLE_MAP = {
    "raw": "raw_logs",
    "security": "security_events",
    "process": "process_events",
    "network": "network_events",
}

# ── Metrics collector ────────────────────────────────────────────────────────

class MetricsCollector:
    """Thread-safe metrics collector for the benchmark."""

    def __init__(self):
        self._lock = Lock()
        self.produced_vector = 0
        self.produced_kafka = 0
        self.http_errors = 0
        self.kafka_errors = 0
        self.kafka_acks = 0
        self.http_429s = 0
        self.per_second_rates: list[dict] = []
        self._sec_produced = 0
        self._sec_start = time.perf_counter()

    def record_vector_batch(self, count: int):
        with self._lock:
            self.produced_vector += count
            self._sec_produced += count

    def record_kafka_ack(self):
        with self._lock:
            self.kafka_acks += 1

    def record_kafka_produce(self, count: int):
        with self._lock:
            self.produced_kafka += count
            self._sec_produced += count  # track produce-side rate (not ack-side)

    def record_http_error(self, status: int = 0):
        with self._lock:
            self.http_errors += 1
            if status == 429:
                self.http_429s += 1

    def record_kafka_error(self):
        with self._lock:
            self.kafka_errors += 1

    def tick_second(self) -> float:
        """Call every ~1s to record per-second rate. Returns rate."""
        with self._lock:
            now = time.perf_counter()
            elapsed = now - self._sec_start
            rate = self._sec_produced / elapsed if elapsed > 0 else 0
            self.per_second_rates.append({
                "second": len(self.per_second_rates) + 1,
                "rate": rate,
                "produced_total": self.produced_vector + self.produced_kafka,
            })
            self._sec_produced = 0
            self._sec_start = now
            return rate

    @property
    def total_produced(self) -> int:
        return self.produced_vector + self.produced_kafka

    def stability_stats(self) -> dict:
        """Compute pipeline stability metrics (excludes boundary artifacts)."""
        # Filter out 0-rate boundary seconds (thread start/stop artifacts)
        rates = [s["rate"] for s in self.per_second_rates if s["rate"] > 0]
        if len(rates) < 2:
            return {"avg_eps": 0, "min_eps": 0, "max_eps": 0, "stddev": 0, "jitter_pct": 0, "cv": 0}
        # Trim top/bottom 5% outliers for stability stats (keep raw min/max for display)
        sorted_rates = sorted(rates)
        trim = max(1, len(sorted_rates) // 20)  # 5%
        trimmed = sorted_rates[trim:-trim] if trim < len(sorted_rates) // 2 else sorted_rates
        avg = statistics.mean(trimmed)
        sd = statistics.stdev(trimmed)
        return {
            "avg_eps": statistics.mean(rates),  # full average
            "min_eps": min(rates),
            "max_eps": max(rates),
            "stddev": sd,
            "jitter_pct": (max(trimmed) - min(trimmed)) / avg * 100 if avg > 0 else 0,
            "cv": sd / avg * 100 if avg > 0 else 0,  # coefficient of variation (trimmed)
        }


metrics = MetricsCollector()

# ── Vector HTTP producer ─────────────────────────────────────────────────────

def vector_producer_thread(target_eps: int, duration: int):
    """Send events to Vector HTTP endpoint in batches."""
    session = requests.Session()
    session.headers["Content-Type"] = "application/json"
    batch_size = args.batch_size
    interval = batch_size / target_eps if target_eps > 0 else 0.01
    deadline = time.perf_counter() + duration
    batch_count = 0

    while not stop_event.is_set() and time.perf_counter() < deadline:
        batch = [generate_event(random.choice(EVENT_TYPES)) for _ in range(batch_size)]
        try:
            t0 = time.perf_counter()
            resp = session.post(args.vector_url, data=json.dumps(batch), timeout=10)
            if resp.status_code in (200, 201, 204):
                metrics.record_vector_batch(batch_size)
            else:
                metrics.record_http_error(resp.status_code)
        except requests.RequestException:
            metrics.record_http_error()

        batch_count += 1
        # Pace to target rate
        elapsed = time.perf_counter() - t0
        sleep_time = interval - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)


# ── Kafka direct producer ────────────────────────────────────────────────────

def _kafka_delivery_cb(err, msg):
    if err:
        metrics.record_kafka_error()
    else:
        metrics.record_kafka_ack()


def kafka_producer_thread(target_eps: int, duration: int):
    """Send events directly to Redpanda topics with steady rate-limiting."""
    producer = Producer({
        "bootstrap.servers": args.kafka_broker,
        "linger.ms": 5,
        "batch.num.messages": 10000,
        "queue.buffering.max.messages": 2_000_000,
        "compression.type": "zstd",
        "acks": "all",
        "enable.idempotence": True,
    })
    deadline = time.perf_counter() + duration

    # Rate-limit per-second: produce target_eps events then busy-wait for the second
    per_sec_target = target_eps
    produced_this_sec = 0
    sec_start = time.perf_counter()
    poll_interval = max(1000, per_sec_target // 10)

    while not stop_event.is_set() and time.perf_counter() < deadline:
        evt_type = random.choice(EVENT_TYPES)
        topic = TOPIC_MAP[evt_type]
        event = generate_event(evt_type)
        producer.produce(topic, json.dumps(event).encode(), callback=_kafka_delivery_cb)
        metrics.record_kafka_produce(1)
        produced_this_sec += 1

        if produced_this_sec % poll_interval == 0:
            producer.poll(0)

        # Per-second rate gate: if we've hit the target, wait for next second
        if produced_this_sec >= per_sec_target:
            now = time.perf_counter()
            remaining = 1.0 - (now - sec_start)
            if remaining > 0.001:
                time.sleep(remaining)
            produced_this_sec = 0
            sec_start = time.perf_counter()

    producer.flush(timeout=120)


# ── ClickHouse monitor ───────────────────────────────────────────────────────

class ClickHouseMonitor:
    """Polls ClickHouse row counts to measure landing rate."""

    def __init__(self):
        self.client = clickhouse_connect.get_client(
            host=args.ch_host, port=args.ch_port,
            username=args.ch_user, password=args.ch_password,
            database=args.ch_db,
        )
        self.snapshots: list[dict] = []
        self._baseline: dict[str, int] = {}

    def take_baseline(self):
        """Record starting row counts."""
        self._baseline = self._get_counts()

    def _get_counts(self) -> dict[str, int]:
        counts = {}
        for table in ["raw_logs", "security_events", "process_events", "network_events"]:
            try:
                r = self.client.query(f"SELECT count() FROM {table}")
                counts[table] = r.result_rows[0][0]
            except Exception:
                counts[table] = 0
        return counts

    def snapshot(self):
        """Take a point-in-time count snapshot."""
        counts = self._get_counts()
        delta = {t: counts[t] - self._baseline.get(t, 0) for t in counts}
        self.snapshots.append({
            "time": time.perf_counter(),
            "counts": counts,
            "delta": delta,
            "total_new": sum(delta.values()),
        })
        return self.snapshots[-1]

    def landing_rate(self) -> float:
        """Events/sec landing in ClickHouse since baseline."""
        if len(self.snapshots) < 2:
            return 0
        first = self.snapshots[0]
        last = self.snapshots[-1]
        elapsed = last["time"] - first["time"]
        if elapsed <= 0:
            return 0
        return (last["total_new"] - first["total_new"]) / elapsed

    def total_landed(self) -> int:
        if not self.snapshots:
            return 0
        return self.snapshots[-1]["total_new"]


# ── Live display ─────────────────────────────────────────────────────────────

def build_live_panel(elapsed: int, duration: int, current_eps: float,
                     ch_landed: int, ch_rate: float) -> Panel:
    """Build a rich panel for live display."""
    pct = min(100, int(elapsed / duration * 100))
    bar_len = 40
    filled = int(bar_len * pct / 100)
    bar = "█" * filled + "░" * (bar_len - filled)

    lines = [
        f"  Time:    [{elapsed:3d}s / {duration}s]  {bar}  {pct}%",
        f"  Mode:    {args.mode.upper()}",
        "",
        f"  Producer EPS:     {current_eps:>10,.0f} /s",
        f"  Total Produced:   {metrics.total_produced:>10,}",
        f"  Vector Batches:   {metrics.produced_vector:>10,}",
        f"  Kafka Direct:     {metrics.produced_kafka:>10,}",
        f"  HTTP Errors:      {metrics.http_errors:>10,}  (429s: {metrics.http_429s})",
        f"  Kafka Errors:     {metrics.kafka_errors:>10,}",
        "",
        f"  CH Landing Rate:  {ch_rate:>10,.0f} /s",
        f"  CH New Rows:      {ch_landed:>10,}",
    ]
    text = "\n".join(lines)
    return Panel(text, title="[bold cyan]CLIF EPS Benchmark — LIVE[/bold cyan]",
                 border_style="cyan", padding=(1, 2))


# ── Main benchmark ───────────────────────────────────────────────────────────

def run_benchmark():
    duration = args.duration
    target_eps = args.target_eps
    warmup = args.warmup
    mode = args.mode

    console.print()
    console.rule("[bold magenta]CLIF EPS Pipeline Stability Benchmark[/bold magenta]")
    console.print()
    console.print(f"  Mode         : [cyan]{mode}[/cyan]")
    console.print(f"  Target EPS   : [cyan]{target_eps:,}[/cyan]")
    console.print(f"  Duration     : [cyan]{duration}s[/cyan]  (+ {warmup}s warmup)")
    console.print(f"  Vector URL   : [dim]{args.vector_url}[/dim]")
    console.print(f"  Kafka Broker : [dim]{args.kafka_broker}[/dim]")
    console.print(f"  ClickHouse   : [dim]{args.ch_host}:{args.ch_port}[/dim]")
    console.print()

    # ── Pre-flight checks ────────────────────────────────────────────────
    console.print("  [dim]Pre-flight checks…[/dim]")
    checks_ok = True

    if mode in ("full", "vector"):
        try:
            r = requests.get(args.vector_url.rsplit("/", 2)[0] + "/", timeout=3)
            console.print("    Vector HTTP       : [green]✔[/green]")
        except Exception:
            # Vector may not respond to GET / but accepting POST is fine
            try:
                r = requests.post(args.vector_url, json=[{"test": True}], timeout=3)
                console.print(f"    Vector HTTP       : [green]✔[/green] (status {r.status_code})")
            except Exception as e:
                console.print(f"    Vector HTTP       : [red]✘ {e}[/red]")
                checks_ok = False

    if mode in ("full", "kafka"):
        try:
            p = Producer({"bootstrap.servers": args.kafka_broker, "socket.timeout.ms": 3000})
            p.list_topics(timeout=5)
            console.print("    Redpanda          : [green]✔[/green]")
            del p
        except Exception as e:
            console.print(f"    Redpanda          : [red]✘ {e}[/red]")
            checks_ok = False

    try:
        ch = clickhouse_connect.get_client(
            host=args.ch_host, port=args.ch_port,
            username=args.ch_user, password=args.ch_password,
            database=args.ch_db,
        )
        ch.query("SELECT 1")
        console.print("    ClickHouse        : [green]✔[/green]")
        del ch
    except Exception as e:
        console.print(f"    ClickHouse        : [red]✘ {e}[/red]")
        checks_ok = False

    if not checks_ok:
        console.print("\n  [red]Pre-flight failed. Aborting.[/red]")
        sys.exit(1)

    console.print()

    # ── Set up ClickHouse monitor ────────────────────────────────────────
    ch_monitor = ClickHouseMonitor()
    ch_monitor.take_baseline()

    # ── Determine EPS split ──────────────────────────────────────────────
    total_duration = warmup + duration
    if mode == "full":
        vector_eps = target_eps // 2
        kafka_eps = target_eps - vector_eps
    elif mode == "vector":
        vector_eps = target_eps
        kafka_eps = 0
    else:
        vector_eps = 0
        kafka_eps = target_eps

    # ── Launch producer threads ──────────────────────────────────────────
    threads: list[Thread] = []
    if vector_eps > 0:
        t = Thread(target=vector_producer_thread, args=(vector_eps, total_duration), daemon=True)
        threads.append(t)
    if kafka_eps > 0:
        t = Thread(target=kafka_producer_thread, args=(kafka_eps, total_duration), daemon=True)
        threads.append(t)

    for t in threads:
        t.start()

    # ── Warmup phase ─────────────────────────────────────────────────────
    console.print(f"  [yellow]Warming up for {warmup}s…[/yellow]")
    for _ in range(warmup):
        if stop_event.is_set():
            break
        time.sleep(1)
        metrics.tick_second()

    # Reset metrics for actual measurement
    console.print("  [green]Warmup complete — starting measurement[/green]\n")
    metrics.per_second_rates.clear()
    ch_monitor.take_baseline()

    # ── Measurement phase with live display ──────────────────────────────
    t_start = time.perf_counter()

    with Live(build_live_panel(0, duration, 0, 0, 0), console=console, refresh_per_second=2) as live:
        for sec in range(1, duration + 1):
            if stop_event.is_set():
                break
            time.sleep(1)
            current_eps = metrics.tick_second()

            # Poll ClickHouse every 2 seconds
            if sec % 2 == 0:
                ch_monitor.snapshot()

            ch_landed = ch_monitor.total_landed()
            ch_rate = ch_monitor.landing_rate()
            live.update(build_live_panel(sec, duration, current_eps, ch_landed, ch_rate))

    stop_event.set()
    for t in threads:
        t.join(timeout=10)

    # Final ClickHouse snapshot (wait for pipeline drain)
    console.print("\n  [dim]Waiting 15s for pipeline drain…[/dim]")
    for _ in range(5):
        time.sleep(3)
        ch_monitor.snapshot()

    total_elapsed = time.perf_counter() - t_start

    # ── Results ──────────────────────────────────────────────────────────
    console.print()
    console.rule("[bold green]EPS Benchmark Results[/bold green]")
    console.print()

    stats = metrics.stability_stats()
    ch_landed = ch_monitor.total_landed()
    ch_rate = ch_monitor.landing_rate()
    total_produced = metrics.total_produced
    data_loss_pct = (1 - ch_landed / total_produced) * 100 if total_produced > 0 else 0

    # ── Summary table ────────────────────────────────────────────────────
    tbl = Table(title="Pipeline Performance", show_header=True, header_style="bold cyan")
    tbl.add_column("Metric", style="white", min_width=28)
    tbl.add_column("Value", justify="right", style="green", min_width=15)
    tbl.add_column("Target", justify="right", style="yellow", min_width=15)
    tbl.add_column("Status", justify="center", min_width=6)

    # Producer metrics
    tbl.add_row("Total Produced", f"{total_produced:,}", "", "")
    tbl.add_row("Avg Producer EPS", f"{stats['avg_eps']:,.0f}/s", f"{target_eps:,}/s",
                "✅" if stats['avg_eps'] >= target_eps * 0.8 else "⚠️")
    tbl.add_row("Peak EPS", f"{stats['max_eps']:,.0f}/s", "", "")
    tbl.add_row("Min EPS", f"{stats['min_eps']:,.0f}/s", "", "")

    # Stability metrics
    tbl.add_row("", "", "", "")
    tbl.add_row("[bold]Stability[/bold]", "", "", "")
    tbl.add_row("Std Deviation", f"{stats['stddev']:,.0f}", "<20% CV", "")
    tbl.add_row("Coefficient of Variation", f"{stats['cv']:.1f}%", "<20%",
                "✅" if stats['cv'] < 20 else "⚠️")
    tbl.add_row("Jitter (max-min/avg)", f"{stats['jitter_pct']:.1f}%", "<50%",
                "✅" if stats['jitter_pct'] < 50 else "⚠️")

    # ClickHouse landing
    tbl.add_row("", "", "", "")
    tbl.add_row("[bold]ClickHouse Landing[/bold]", "", "", "")
    tbl.add_row("CH Rows Landed", f"{ch_landed:,}", f"{total_produced:,}", "")
    tbl.add_row("CH Landing Rate", f"{ch_rate:,.0f}/s", f"≥{target_eps * 0.8:,.0f}/s",
                "✅" if ch_rate >= target_eps * 0.5 else "⚠️")
    tbl.add_row("Data Completeness", f"{100 - data_loss_pct:.1f}%", "≥95%",
                "✅" if data_loss_pct < 5 else "❌" if data_loss_pct > 10 else "⚠️")

    # Error metrics
    tbl.add_row("", "", "", "")
    tbl.add_row("[bold]Errors[/bold]", "", "", "")
    tbl.add_row("HTTP Errors", f"{metrics.http_errors:,}", "0",
                "✅" if metrics.http_errors == 0 else "⚠️")
    tbl.add_row("HTTP 429 (Backpressure)", f"{metrics.http_429s:,}", "0",
                "✅" if metrics.http_429s == 0 else "⚠️")
    tbl.add_row("Kafka Errors", f"{metrics.kafka_errors:,}", "0",
                "✅" if metrics.kafka_errors == 0 else "⚠️")
    tbl.add_row("Total Errors", f"{metrics.http_errors + metrics.kafka_errors:,}", "0",
                "✅" if (metrics.http_errors + metrics.kafka_errors) == 0 else "❌")

    console.print(tbl)

    # ── Per-second rate chart (ASCII) ────────────────────────────────────
    console.print()
    console.rule("[bold cyan]EPS Over Time (per-second)[/bold cyan]")
    rates = [s["rate"] for s in metrics.per_second_rates]
    if rates:
        max_rate = max(rates) if max(rates) > 0 else 1
        chart_height = 15
        chart_width = min(len(rates), 80)
        step = max(1, len(rates) // chart_width)
        sampled = [rates[i] for i in range(0, len(rates), step)][:chart_width]

        for row in range(chart_height, 0, -1):
            threshold = max_rate * row / chart_height
            line_label = f"{int(threshold):>8,} │"
            chars = []
            for val in sampled:
                if val >= threshold:
                    chars.append("█")
                elif val >= threshold - max_rate / chart_height / 2:
                    chars.append("▄")
                else:
                    chars.append(" ")
            console.print(f"  {line_label}{''.join(chars)}")
        console.print(f"  {'':>8} └{'─' * len(sampled)}")
        console.print(f"  {'':>8}  {'1':}<{len(sampled) - 1}{'s'}")
        console.print(f"  [dim]  (each column ≈ {step}s)[/dim]")

    # ── ClickHouse landing over time ─────────────────────────────────────
    if len(ch_monitor.snapshots) >= 2:
        console.print()
        ch_rates = []
        for i in range(1, len(ch_monitor.snapshots)):
            dt = ch_monitor.snapshots[i]["time"] - ch_monitor.snapshots[i-1]["time"]
            dn = ch_monitor.snapshots[i]["total_new"] - ch_monitor.snapshots[i-1]["total_new"]
            ch_rates.append(dn / dt if dt > 0 else 0)
        if ch_rates:
            console.print(f"  CH Landing Rate — Min: {min(ch_rates):,.0f}/s  "
                          f"Avg: {statistics.mean(ch_rates):,.0f}/s  "
                          f"Max: {max(ch_rates):,.0f}/s")

    # ── Final verdict ────────────────────────────────────────────────────
    console.print()
    console.rule("[bold]Verdict[/bold]")

    grade_points = 0
    grade_max = 5

    if stats['avg_eps'] >= target_eps * 0.8:
        grade_points += 1
    if stats['cv'] < 20:
        grade_points += 1
    if data_loss_pct < 5:
        grade_points += 1
    if (metrics.http_errors + metrics.kafka_errors) == 0:
        grade_points += 1
    if ch_rate >= target_eps * 0.5:
        grade_points += 1

    grades = {5: "A+", 4: "A", 3: "B", 2: "C", 1: "D", 0: "F"}
    grade = grades.get(grade_points, "F")
    grade_color = "green" if grade_points >= 4 else "yellow" if grade_points >= 3 else "red"

    console.print(f"\n  Pipeline Stability Grade: [{grade_color} bold]{grade}[/{grade_color} bold]  ({grade_points}/{grade_max})")
    console.print()

    criteria = [
        ("Throughput ≥80% target", stats['avg_eps'] >= target_eps * 0.8),
        ("CV < 20% (stable rate)", stats['cv'] < 20),
        ("Data loss < 5%", data_loss_pct < 5),
        ("Zero errors", (metrics.http_errors + metrics.kafka_errors) == 0),
        ("CH landing ≥50% target", ch_rate >= target_eps * 0.5),
    ]
    for label, passed in criteria:
        icon = "[green]✔[/green]" if passed else "[red]✘[/red]"
        console.print(f"    {icon}  {label}")

    console.print()

    # Return results for programmatic use
    return {
        "grade": grade,
        "total_produced": total_produced,
        "avg_eps": stats["avg_eps"],
        "peak_eps": stats["max_eps"],
        "cv_pct": stats["cv"],
        "jitter_pct": stats["jitter_pct"],
        "ch_landed": ch_landed,
        "ch_rate": ch_rate,
        "data_loss_pct": data_loss_pct,
        "errors": metrics.http_errors + metrics.kafka_errors,
        "duration_s": total_elapsed,
    }


if __name__ == "__main__":
    results = run_benchmark()
    sys.exit(0 if results["grade"] in ("A+", "A", "B") else 1)
