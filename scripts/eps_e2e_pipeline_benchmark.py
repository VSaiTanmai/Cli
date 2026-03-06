#!/usr/bin/env python3
"""
CLIF Full-Pipeline E2E EPS Benchmark
=====================================
Producer → Redpanda → Consumer → ClickHouse

Measures true end-to-end ingestion throughput by:
1. Recording ClickHouse row count (baseline)
2. Producing N events into Redpanda "raw-logs" topic as fast as possible,
   using 1, 2, 4, (optionally 8) producer threads
3. Waiting until all events appear in ClickHouse
4. Calculating EPS = total_events / wall_time

Usage:
    pip install confluent-kafka requests
    python scripts/eps_e2e_pipeline_benchmark.py
"""

import json
import os
import sys
import time
import threading
import uuid
import random
import string
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
REDPANDA_BROKER   = os.getenv("REDPANDA_BROKER",   "localhost:19092")
CLICKHOUSE_URL    = os.getenv("CLICKHOUSE_URL",     "http://localhost:8123")
CLICKHOUSE_USER   = os.getenv("CLICKHOUSE_USER",    "clif_admin")
CLICKHOUSE_PASS   = os.getenv("CLICKHOUSE_PASSWORD","Cl1f_Ch@ngeM3_2026!")
CLICKHOUSE_DB     = os.getenv("CLICKHOUSE_DB",      "clif_logs")

TOPIC             = "raw-logs"
EVENTS_PER_LEVEL  = int(os.getenv("EVENTS_PER_LEVEL", "100000"))  # events to produce per concurrency level
CONCURRENCY_LEVELS= [1, 2, 4]  # producer threads
POLL_INTERVAL     = 0.5        # seconds between CH row-count checks
MAX_DRAIN_WAIT    = 120        # max seconds to wait for Consumer to drain

# ---------------------------------------------------------------------------
# Realistic log templates  (mix of normal + suspicious)
# ---------------------------------------------------------------------------
_LEVELS   = ["INFO", "WARNING", "ERROR", "DEBUG", "CRITICAL"]
_SOURCES  = ["web-gw-01", "api-svc-02", "auth-proxy", "k8s-node-03",
             "firewall-edge", "vpn-concentrator", "db-primary",
             "mail-relay", "dns-resolver-01", "jump-box-admin"]
_MESSAGES = [
    "User {user} logged in from {ip}",
    "Failed password for {user} from {ip} port {port} ssh2",
    "GET /api/v2/users HTTP/1.1 200 {ms}ms",
    "POST /login HTTP/1.1 401 Unauthorized from {ip}",
    "Connection from {ip} port {port} on 0.0.0.0 port 22",
    "Accepted publickey for {user} from {ip} port {port}",
    "sudo: {user} : command not found ; TTY=pts/0",
    "firewall: DENY IN=eth0 SRC={ip} DST=10.0.0.1 PROTO=TCP DPT={port}",
    "DNS query for {domain} from {ip} (NXDOMAIN)",
    "TLS handshake failure: {ip}:{port} reason=expired_certificate",
    "Process /usr/bin/curl spawned by pid {pid} uid=0",
    "Outbound connection {ip}:{port} → {ext_ip}:443 bytes={bytes}",
    "cron job /etc/cron.d/backup completed exit_code=0",
    "OOM killer invoked for pid {pid} (rss={bytes}KB)",
    "Kernel: segfault at 0000000000000000 rip 00007f… rsp …",
]
_DOMAINS = ["evil.example.com", "c2.badactor.net", "github.com",
            "google.com", "internal.corp.local", "updates.vendor.io"]
_USERS   = ["admin", "root", "deploy", "jenkins", "john.doe",
            "svc-monitor", "backup-agent", "guest", "testuser"]


def _random_ip() -> str:
    return f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"


def _generate_event() -> bytes:
    """Build a single realistic raw-log JSON payload."""
    msg_template = random.choice(_MESSAGES)
    msg = msg_template.format(
        user=random.choice(_USERS),
        ip=_random_ip(),
        port=random.randint(1024, 65535),
        ms=random.randint(1, 9999),
        domain=random.choice(_DOMAINS),
        pid=random.randint(100, 65535),
        ext_ip=_random_ip(),
        bytes=random.randint(64, 1_000_000),
    )
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level":     random.choice(_LEVELS),
        "source":    random.choice(_SOURCES),
        "message":   msg,
        "ip_address": _random_ip(),
        "metadata": {
            "user_id":    random.choice(_USERS),
            "request_id": uuid.uuid4().hex[:16],
            "env":        random.choice(["prod", "staging", "dev"]),
            "region":     random.choice(["us-east-1", "eu-west-1", "ap-south-1"]),
        },
    }
    return json.dumps(event).encode("utf-8")


# ---------------------------------------------------------------------------
# ClickHouse helper
# ---------------------------------------------------------------------------
import requests

_CH_SESSION = requests.Session()
_CH_SESSION.auth = (CLICKHOUSE_USER, CLICKHOUSE_PASS)


def ch_query(sql: str) -> str:
    """Run a ClickHouse SQL query and return the text result."""
    r = _CH_SESSION.get(CLICKHOUSE_URL, params={
        "query": sql,
        "database": CLICKHOUSE_DB,
    }, timeout=10)
    r.raise_for_status()
    return r.text.strip()


def ch_row_count() -> int:
    """Count rows in raw_logs."""
    txt = ch_query("SELECT count() FROM raw_logs")
    return int(txt) if txt else 0


# ---------------------------------------------------------------------------
# Kafka producer
# ---------------------------------------------------------------------------
from confluent_kafka import Producer as KProducer


def _delivery_cb(err, msg):
    """Minimal delivery callback — count errors only."""
    if err is not None:
        _delivery_errors.append(str(err))


_delivery_errors: list[str] = []


def _produce_batch(thread_id: int, count: int, barrier: threading.Barrier) -> dict:
    """Produce `count` events as fast as possible from one thread."""
    conf = {
        "bootstrap.servers": REDPANDA_BROKER,
        "client.id":         f"bench-producer-{thread_id}",
        "linger.ms":         50,         # batch up for throughput
        "batch.num.messages": 10000,
        "queue.buffering.max.messages": 200000,
        "compression.type":  "lz4",
        "acks":              "1",        # single broker, RF=1
    }
    producer = KProducer(conf)

    # Pre-generate events for this thread
    my_events = [_generate_event() for _ in range(count)]

    # Sync all threads to start together
    barrier.wait()

    t0 = time.perf_counter()
    sent = 0
    for ev in my_events:
        producer.produce(TOPIC, value=ev, callback=_delivery_cb)
        sent += 1
        if sent % 5000 == 0:
            producer.poll(0)  # trigger delivery callbacks, don't block
    producer.flush(30)  # wait for all in-flight
    elapsed = time.perf_counter() - t0

    return {"thread": thread_id, "sent": sent, "produce_sec": elapsed}


# ---------------------------------------------------------------------------
# Benchmark runner
# ---------------------------------------------------------------------------

def run_level(num_threads: int, total_events: int) -> dict:
    """Run a single concurrency level and return results."""
    per_thread = total_events // num_threads
    actual_total = per_thread * num_threads  # handle rounding

    print(f"\n{'='*70}")
    print(f"  Concurrency: {num_threads} producer thread(s)  |  {actual_total:,} events")
    print(f"{'='*70}")

    # 1. Baseline CH count
    baseline = ch_row_count()
    print(f"  CH baseline rows: {baseline:,}")

    # 2. Pre-generate events (before timing)
    print(f"  Pre-generating {actual_total:,} events …", end=" ", flush=True)
    # Events are generated inside each thread; we just time the produce phase

    # 3. Produce
    barrier = threading.Barrier(num_threads)
    _delivery_errors.clear()

    print("producing →", flush=True)
    produce_start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=num_threads) as pool:
        futures = [
            pool.submit(_produce_batch, i, per_thread, barrier)
            for i in range(num_threads)
        ]
        thread_results = [f.result() for f in futures]

    produce_end = time.perf_counter()
    produce_wall = produce_end - produce_start
    produce_eps = actual_total / produce_wall if produce_wall > 0 else 0
    print(f"  → Produced {actual_total:,} events in {produce_wall:.2f}s "
          f"({produce_eps:,.0f} produce EPS)")
    if _delivery_errors:
        print(f"  ⚠ Delivery errors: {len(_delivery_errors)}")

    # 4. Wait for Consumer to drain all events into ClickHouse
    print(f"  Waiting for Consumer to drain into ClickHouse …", flush=True)
    target = baseline + actual_total
    drain_start = time.perf_counter()
    last_count = baseline
    stall_count = 0

    while True:
        time.sleep(POLL_INTERVAL)
        current = ch_row_count()
        elapsed = time.perf_counter() - drain_start

        if current >= target:
            drain_end = time.perf_counter()
            break

        if elapsed > MAX_DRAIN_WAIT:
            print(f"  ⚠ Drain timeout ({MAX_DRAIN_WAIT}s) — got {current - baseline:,} / {actual_total:,}")
            drain_end = time.perf_counter()
            break

        # Progress
        ingested = current - baseline
        rate = ingested / elapsed if elapsed > 0 else 0
        remaining = target - current
        eta = remaining / rate if rate > 0 else 999
        if current != last_count:
            print(f"    [{elapsed:5.1f}s] {ingested:>8,} / {actual_total:,}  "
                  f"({rate:,.0f} EPS)  ETA {eta:.1f}s", flush=True)
            stall_count = 0
        else:
            stall_count += 1
            if stall_count % 10 == 0:
                print(f"    [{elapsed:5.1f}s] stalled at {ingested:,} — waiting …", flush=True)
        last_count = current

    # 5. Calculate E2E EPS
    drain_wall = drain_end - drain_start
    final_count = ch_row_count()
    actually_ingested = final_count - baseline
    e2e_wall = produce_wall + drain_wall
    e2e_eps = actually_ingested / e2e_wall if e2e_wall > 0 else 0
    drain_eps = actually_ingested / drain_wall if drain_wall > 0 else 0

    result = {
        "threads":           num_threads,
        "target_events":     actual_total,
        "actually_ingested": actually_ingested,
        "produce_wall_sec":  round(produce_wall, 3),
        "produce_eps":       round(produce_eps, 0),
        "drain_wall_sec":    round(drain_wall, 3),
        "drain_eps":         round(drain_eps, 0),
        "e2e_wall_sec":      round(e2e_wall, 3),
        "e2e_eps":           round(e2e_eps, 0),
        "delivery_errors":   len(_delivery_errors),
    }

    print(f"\n  ┌─────────────────────────────────────────────────┐")
    print(f"  │  Produce  : {produce_eps:>10,.0f} EPS  ({produce_wall:.2f}s)       │")
    print(f"  │  Drain    : {drain_eps:>10,.0f} EPS  ({drain_wall:.2f}s)       │")
    print(f"  │  E2E total: {e2e_eps:>10,.0f} EPS  ({e2e_wall:.2f}s)       │")
    print(f"  │  Ingested : {actually_ingested:>10,} / {actual_total:,}          │")
    print(f"  └─────────────────────────────────────────────────┘")

    return result


# ---------------------------------------------------------------------------
# Cooldown helper
# ---------------------------------------------------------------------------

def _drain_remaining():
    """Wait a few seconds to ensure consumer queue is empty between levels."""
    print("\n  Draining residual events …", end=" ", flush=True)
    prev = ch_row_count()
    for _ in range(6):  # 3 seconds
        time.sleep(0.5)
        cur = ch_row_count()
        if cur == prev:
            break
        prev = cur
    print(f"done (rows: {cur:,})")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 70)
    print("  CLIF Full-Pipeline E2E EPS Benchmark")
    print("  Producer → Redpanda → Consumer → ClickHouse")
    print("=" * 70)
    print(f"  Redpanda broker : {REDPANDA_BROKER}")
    print(f"  ClickHouse      : {CLICKHOUSE_URL}")
    print(f"  Events per level: {EVENTS_PER_LEVEL:,}")
    print(f"  Concurrency     : {CONCURRENCY_LEVELS}")
    print()

    # Verify connectivity
    try:
        cnt = ch_row_count()
        print(f"  ✓ ClickHouse connected — raw_logs has {cnt:,} rows")
    except Exception as e:
        print(f"  ✗ ClickHouse connection failed: {e}")
        sys.exit(1)

    try:
        test_prod = KProducer({"bootstrap.servers": REDPANDA_BROKER})
        test_prod.flush(5)
        print(f"  ✓ Redpanda connected at {REDPANDA_BROKER}")
    except Exception as e:
        print(f"  ✗ Redpanda connection failed: {e}")
        sys.exit(1)

    results = []
    for level in CONCURRENCY_LEVELS:
        _drain_remaining()
        r = run_level(level, EVENTS_PER_LEVEL)
        results.append(r)

    # Final summary
    print("\n" + "=" * 70)
    print("  FINAL SUMMARY — Full Pipeline EPS")
    print("=" * 70)
    print(f"  {'Threads':>8}  {'Produce EPS':>14}  {'Drain EPS':>12}  {'E2E EPS':>12}  {'Wall(s)':>8}")
    print(f"  {'-'*8}  {'-'*14}  {'-'*12}  {'-'*12}  {'-'*8}")
    baseline_eps = None
    for r in results:
        if baseline_eps is None:
            baseline_eps = r["e2e_eps"]
            scale = "1.00x"
        else:
            s = r["e2e_eps"] / baseline_eps if baseline_eps > 0 else 0
            scale = f"{s:.2f}x"
        print(f"  {r['threads']:>8}  {r['produce_eps']:>14,.0f}  "
              f"{r['drain_eps']:>12,.0f}  {r['e2e_eps']:>12,.0f}  "
              f"{r['e2e_wall_sec']:>8.1f}  {scale}")

    print()
    print("  Key insight: E2E EPS = events flowing through the FULL pipeline")
    print("  (Redpanda broker + Consumer batching + ClickHouse native insert)")
    print("  Compare with direct-insert benchmarks to see pipeline overhead.")
    print("=" * 70)


if __name__ == "__main__":
    main()
