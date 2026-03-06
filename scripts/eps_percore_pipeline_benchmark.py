#!/usr/bin/env python3
"""
CLIF E2E Pipeline — Per-Core EPS Benchmark
============================================
Scales the Consumer's FLUSH_WORKERS (1 → 2 → 4) and measures
true pipeline throughput at each parallelism level.

For each level:
  1. Stop consumer container
  2. Restart with CONSUMER_FLUSH_WORKERS=N
  3. Produce 300K events to Redpanda
  4. Measure drain EPS into ClickHouse
  5. Report per-core metrics
"""

import json
import os
import subprocess
import sys
import time
import threading
import uuid
import random
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

import requests
from confluent_kafka import Producer as KProducer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
REDPANDA_BROKER   = os.getenv("REDPANDA_BROKER",   "localhost:19092")
CLICKHOUSE_URL    = os.getenv("CLICKHOUSE_URL",     "http://localhost:8123")
CLICKHOUSE_USER   = os.getenv("CLICKHOUSE_USER",    "clif_admin")
CLICKHOUSE_PASS   = os.getenv("CLICKHOUSE_PASSWORD","Cl1f_Ch@ngeM3_2026!")
CLICKHOUSE_DB     = os.getenv("CLICKHOUSE_DB",      "clif_logs")
COMPOSE_FILE      = "docker-compose-benchmark.yml"

TOPIC             = "raw-logs"
EVENTS_PER_LEVEL  = int(os.getenv("EVENTS_PER_LEVEL", "300000"))
WORKER_LEVELS     = [1, 2, 4]       # Consumer flush workers to test
PRODUCER_THREADS  = 2               # Fixed — producer is not the bottleneck
POLL_INTERVAL     = 0.5
MAX_DRAIN_WAIT    = 180

# ---------------------------------------------------------------------------
# Log templates
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
    "Outbound connection {ip}:{port} -> {ext_ip}:443 bytes={bytes}",
    "cron job /etc/cron.d/backup completed exit_code=0",
    "OOM killer invoked for pid {pid} (rss={bytes}KB)",
    "Kernel: segfault at 0000000000000000 rip 00007f rsp ...",
]
_DOMAINS = ["evil.example.com", "c2.badactor.net", "github.com",
            "google.com", "internal.corp.local", "updates.vendor.io"]
_USERS   = ["admin", "root", "deploy", "jenkins", "john.doe",
            "svc-monitor", "backup-agent", "guest", "testuser"]


def _random_ip():
    return f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"


def _generate_event():
    msg_template = random.choice(_MESSAGES)
    msg = msg_template.format(
        user=random.choice(_USERS), ip=_random_ip(),
        port=random.randint(1024, 65535), ms=random.randint(1, 9999),
        domain=random.choice(_DOMAINS), pid=random.randint(100, 65535),
        ext_ip=_random_ip(), bytes=random.randint(64, 1_000_000),
    )
    return json.dumps({
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
    }).encode("utf-8")


# ---------------------------------------------------------------------------
# ClickHouse helper
# ---------------------------------------------------------------------------
_CH = requests.Session()
_CH.auth = (CLICKHOUSE_USER, CLICKHOUSE_PASS)


def ch_count():
    r = _CH.get(CLICKHOUSE_URL, params={"query": "SELECT count() FROM raw_logs",
                                         "database": CLICKHOUSE_DB}, timeout=10)
    r.raise_for_status()
    return int(r.text.strip())


# ---------------------------------------------------------------------------
# Docker helper
# ---------------------------------------------------------------------------
def docker(*args):
    """Run a docker compose command and return (returncode, stdout)."""
    cmd = ["docker", "compose", "-f", COMPOSE_FILE] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    return result.returncode, result.stdout + result.stderr


def restart_consumer(flush_workers: int):
    """Stop consumer, restart with new FLUSH_WORKERS setting."""
    print(f"    Stopping consumer …", end=" ", flush=True)
    # Force remove any existing container with this name
    subprocess.run(["docker", "stop", "clif-consumer"],
                   capture_output=True, text=True, timeout=30)
    subprocess.run(["docker", "rm", "-f", "clif-consumer"],
                   capture_output=True, text=True, timeout=30)
    time.sleep(1)
    print("done")

    # Set env and start
    os.environ["CONSUMER_FLUSH_WORKERS_OVERRIDE"] = str(flush_workers)
    print(f"    Starting consumer with FLUSH_WORKERS={flush_workers} …", end=" ", flush=True)

    # Use docker run directly to override the env var
    cmd = [
        "docker", "compose", "-f", COMPOSE_FILE,
        "run", "-d", "--name", "clif-consumer",
        "-e", f"CONSUMER_FLUSH_WORKERS={flush_workers}",
        "--no-deps",
        "clif-consumer"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"FAILED: {result.stderr}")
        sys.exit(1)
    print("done")

    # Wait for consumer to connect
    time.sleep(5)

    # Verify it's running
    check = subprocess.run(["docker", "ps", "--filter", "name=clif-consumer",
                            "--format", "{{.Status}}"],
                           capture_output=True, text=True, timeout=10)
    status = check.stdout.strip()
    if "Up" not in status:
        print(f"    WARNING: Consumer status = {status}")
    else:
        print(f"    Consumer status: {status}")

    # Check logs for connection confirmation
    time.sleep(2)
    logs = subprocess.run(["docker", "logs", "clif-consumer", "--tail", "5"],
                          capture_output=True, text=True, timeout=10)
    for line in logs.stdout.strip().split("\n")[-3:]:
        if line.strip():
            print(f"      {line.strip()}")


# ---------------------------------------------------------------------------
# Producer
# ---------------------------------------------------------------------------
_delivery_errors = []


def _delivery_cb(err, msg):
    if err:
        _delivery_errors.append(str(err))


def _produce_worker(thread_id, events, barrier):
    conf = {
        "bootstrap.servers": REDPANDA_BROKER,
        "client.id":         f"bench-{thread_id}",
        "linger.ms":         50,
        "batch.num.messages": 10000,
        "queue.buffering.max.messages": 200000,
        "compression.type":  "lz4",
        "acks":              "1",
    }
    p = KProducer(conf)
    barrier.wait()
    t0 = time.perf_counter()
    for i, ev in enumerate(events):
        p.produce(TOPIC, value=ev, callback=_delivery_cb)
        if (i + 1) % 5000 == 0:
            p.poll(0)
    p.flush(30)
    return time.perf_counter() - t0


def produce_events(total):
    """Produce total events using PRODUCER_THREADS threads. Return wall time."""
    per_thread = total // PRODUCER_THREADS
    actual = per_thread * PRODUCER_THREADS

    # Pre-generate
    print(f"    Pre-generating {actual:,} events …", end=" ", flush=True)
    all_events = [[_generate_event() for _ in range(per_thread)]
                  for _ in range(PRODUCER_THREADS)]
    print("done")

    _delivery_errors.clear()
    barrier = threading.Barrier(PRODUCER_THREADS)
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=PRODUCER_THREADS) as pool:
        futs = [pool.submit(_produce_worker, i, all_events[i], barrier)
                for i in range(PRODUCER_THREADS)]
        [f.result() for f in futs]
    wall = time.perf_counter() - t0
    eps = actual / wall if wall > 0 else 0
    print(f"    Produced {actual:,} in {wall:.2f}s ({eps:,.0f} EPS)")
    return actual, wall


# ---------------------------------------------------------------------------
# Drain measurement
# ---------------------------------------------------------------------------
def wait_drain(baseline, target_count):
    """Wait for Consumer to drain events into CH. Return (ingested, wall_sec, drain_eps)."""
    t0 = time.perf_counter()
    target = baseline + target_count
    last = baseline

    while True:
        time.sleep(POLL_INTERVAL)
        cur = ch_count()
        elapsed = time.perf_counter() - t0

        if cur >= target:
            wall = time.perf_counter() - t0
            ingested = cur - baseline
            return ingested, wall, ingested / wall if wall > 0 else 0

        if elapsed > MAX_DRAIN_WAIT:
            wall = time.perf_counter() - t0
            ingested = cur - baseline
            print(f"    TIMEOUT: {ingested:,} / {target_count:,}")
            return ingested, wall, ingested / wall if wall > 0 else 0

        ingested = cur - baseline
        rate = ingested / elapsed if elapsed > 0 else 0
        if cur != last:
            remaining = target - cur
            eta = remaining / rate if rate > 0 else 999
            print(f"      [{elapsed:5.1f}s] {ingested:>9,} / {target_count:,}  "
                  f"({rate:,.0f} EPS)  ETA {eta:.1f}s", flush=True)
        last = cur


def drain_cooldown():
    """Wait for residual events to settle."""
    prev = ch_count()
    for _ in range(6):
        time.sleep(0.5)
        cur = ch_count()
        if cur == prev:
            break
        prev = cur


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 70)
    print("  CLIF E2E Pipeline — Per-Core EPS Benchmark")
    print("  Scaling Consumer FLUSH_WORKERS: 1 → 2 → 4")
    print("=" * 70)
    print(f"  Events per level : {EVENTS_PER_LEVEL:,}")
    print(f"  Producer threads : {PRODUCER_THREADS} (fixed)")
    print(f"  Worker levels    : {WORKER_LEVELS}")
    print()

    # Verify connectivity
    try:
        cnt = ch_count()
        print(f"  ✓ ClickHouse: {cnt:,} rows in raw_logs")
    except Exception as e:
        print(f"  ✗ ClickHouse failed: {e}")
        sys.exit(1)

    try:
        KProducer({"bootstrap.servers": REDPANDA_BROKER}).flush(5)
        print(f"  ✓ Redpanda: {REDPANDA_BROKER}")
    except Exception as e:
        print(f"  ✗ Redpanda failed: {e}")
        sys.exit(1)

    results = []

    for workers in WORKER_LEVELS:
        print(f"\n{'='*70}")
        print(f"  FLUSH_WORKERS = {workers}")
        print(f"{'='*70}")

        # Restart consumer with new worker count
        restart_consumer(workers)
        drain_cooldown()

        # Record baseline
        baseline = ch_count()
        print(f"    Baseline: {baseline:,} rows")

        # Produce events
        actual, produce_wall = produce_events(EVENTS_PER_LEVEL)

        # Wait for drain
        print(f"    Waiting for drain …")
        ingested, drain_wall, drain_eps = wait_drain(baseline, actual)

        e2e_wall = produce_wall + drain_wall
        e2e_eps = ingested / e2e_wall if e2e_wall > 0 else 0
        produce_eps = actual / produce_wall if produce_wall > 0 else 0
        eps_per_core = drain_eps / workers if workers > 0 else 0

        r = {
            "workers":      workers,
            "produced":     actual,
            "ingested":     ingested,
            "produce_eps":  round(produce_eps),
            "drain_eps":    round(drain_eps),
            "e2e_eps":      round(e2e_eps),
            "e2e_wall":     round(e2e_wall, 2),
            "eps_per_core": round(eps_per_core),
        }
        results.append(r)

        print(f"\n  ┌────────────────────────────────────────────────────┐")
        print(f"  │  Workers      : {workers:<5}                            │")
        print(f"  │  Produce EPS  : {produce_eps:>10,.0f}                     │")
        print(f"  │  Drain EPS    : {drain_eps:>10,.0f}                     │")
        print(f"  │  E2E EPS      : {e2e_eps:>10,.0f}  ({e2e_wall:.1f}s)          │")
        print(f"  │  EPS/core     : {eps_per_core:>10,.0f}                     │")
        print(f"  │  Ingested     : {ingested:>10,} / {actual:,}         │")
        print(f"  └────────────────────────────────────────────────────┘")

    # ── Final summary ────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  FINAL SUMMARY — Per-Core Pipeline EPS")
    print(f"{'='*70}")
    print(f"  {'Workers':>8}  {'Drain EPS':>12}  {'E2E EPS':>12}  {'EPS/core':>12}  {'Wall(s)':>8}  {'Scale':>7}")
    print(f"  {'-'*8}  {'-'*12}  {'-'*12}  {'-'*12}  {'-'*8}  {'-'*7}")

    base_drain = results[0]["drain_eps"] if results else 1
    for r in results:
        scale = r["drain_eps"] / base_drain if base_drain > 0 else 0
        print(f"  {r['workers']:>8}  {r['drain_eps']:>12,}  {r['e2e_eps']:>12,}  "
              f"{r['eps_per_core']:>12,}  {r['e2e_wall']:>8.1f}  {scale:.2f}x")

    print(f"\n  Columns:")
    print(f"    Drain EPS  = Consumer→ClickHouse throughput (the real bottleneck)")
    print(f"    E2E EPS    = total events / (produce_time + drain_time)")
    print(f"    EPS/core   = Drain EPS / FLUSH_WORKERS")
    print(f"    Scale      = Drain EPS relative to 1-worker baseline")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
