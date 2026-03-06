#!/usr/bin/env python3
"""
CLIF Full-Pipeline E2E EPS Benchmark (WITH VECTOR)
====================================================
Producer → Vector → Redpanda → Consumer → ClickHouse

THE REAL PIPELINE. Previous benchmarks skipped Vector.

Measures true end-to-end throughput by:
1. Pushing events to Vector's HTTP JSON endpoint (port 8687)
2. Vector parses, classifies, normalizes, routes → Redpanda
3. Consumer reads Redpanda → batch inserts to ClickHouse
4. We count rows in ClickHouse to measure EPS

Producer concurrency: 1, 2, 4 HTTP sender threads

Usage:
    pip install requests
    python scripts/eps_e2e_full_pipeline.py
"""

import json
import os
import sys
import time
import threading
import uuid
import random
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
VECTOR_URL        = os.getenv("VECTOR_URL",         "http://localhost:8687/v1/logs")
CLICKHOUSE_URL    = os.getenv("CLICKHOUSE_URL",      "http://localhost:8123")
CLICKHOUSE_USER   = os.getenv("CLICKHOUSE_USER",     "clif_admin")
CLICKHOUSE_PASS   = os.getenv("CLICKHOUSE_PASSWORD", "Cl1f_Ch@ngeM3_2026!")
CLICKHOUSE_DB     = os.getenv("CLICKHOUSE_DB",       "clif_logs")

EVENTS_PER_LEVEL  = int(os.getenv("EVENTS_PER_LEVEL", "200000"))
CONCURRENCY_LEVELS= [1, 2, 4]
HTTP_BATCH_SIZE   = 500          # events per HTTP POST to Vector
POLL_INTERVAL     = 0.5
MAX_DRAIN_WAIT    = 300          # seconds

# ---------------------------------------------------------------------------
# Realistic log templates
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


def _generate_event() -> dict:
    """Build a single realistic raw log event."""
    msg_template = random.choice(_MESSAGES)
    msg = msg_template.format(
        user=random.choice(_USERS), ip=_random_ip(),
        port=random.randint(1024, 65535), ms=random.randint(1, 9999),
        domain=random.choice(_DOMAINS), pid=random.randint(100, 65535),
        ext_ip=_random_ip(), bytes=random.randint(64, 1_000_000),
    )
    return {
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


# ---------------------------------------------------------------------------
# ClickHouse helper
# ---------------------------------------------------------------------------
_CH = requests.Session()
_CH.auth = (CLICKHOUSE_USER, CLICKHOUSE_PASS)


def ch_count(table: str = "raw_logs") -> int:
    r = _CH.get(CLICKHOUSE_URL, params={
        "query": f"SELECT count() FROM {table}",
        "database": CLICKHOUSE_DB
    }, timeout=10)
    r.raise_for_status()
    return int(r.text.strip())


def ch_total_events() -> int:
    """Count across all 4 ingestion tables since Vector routes to different topics."""
    total = 0
    for t in ["raw_logs", "security_events", "process_events", "network_events"]:
        try:
            total += ch_count(t)
        except Exception:
            pass
    return total


# ---------------------------------------------------------------------------
# HTTP sender to Vector
# ---------------------------------------------------------------------------

def _send_batch_to_vector(session: requests.Session, events: list[dict]) -> int:
    """POST a batch of events to Vector's HTTP JSON endpoint. Return count sent."""
    # Vector's http_server source accepts JSON arrays
    try:
        r = session.post(VECTOR_URL, json=events, timeout=30)
        r.raise_for_status()
        return len(events)
    except Exception as e:
        print(f"    Vector POST error: {e}")
        return 0


def _producer_thread(thread_id: int, events: list[dict],
                      barrier: threading.Barrier) -> dict:
    """Send events to Vector in batches from one thread."""
    session = requests.Session()
    session.headers["Content-Type"] = "application/json"

    barrier.wait()  # sync all threads

    t0 = time.perf_counter()
    sent = 0
    errors = 0

    for i in range(0, len(events), HTTP_BATCH_SIZE):
        batch = events[i:i + HTTP_BATCH_SIZE]
        n = _send_batch_to_vector(session, batch)
        if n > 0:
            sent += n
        else:
            errors += 1

    elapsed = time.perf_counter() - t0
    return {"thread": thread_id, "sent": sent, "errors": errors, "sec": elapsed}


# ---------------------------------------------------------------------------
# Benchmark runner
# ---------------------------------------------------------------------------

def run_level(num_threads: int, total_events: int) -> dict:
    per_thread = total_events // num_threads
    actual_total = per_thread * num_threads

    print(f"\n{'='*70}")
    print(f"  Concurrency: {num_threads} HTTP sender thread(s)  |  {actual_total:,} events")
    print(f"{'='*70}")

    # Baseline (all 4 tables, since Vector routes events)
    baseline = ch_total_events()
    print(f"  CH baseline (all tables): {baseline:,}")

    # Pre-generate events
    print(f"  Pre-generating {actual_total:,} events …", end=" ", flush=True)
    all_events = [
        [_generate_event() for _ in range(per_thread)]
        for _ in range(num_threads)
    ]
    print("done")

    # Produce via Vector
    barrier = threading.Barrier(num_threads)
    print(f"  Sending to Vector (HTTP) →", flush=True)
    produce_start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=num_threads) as pool:
        futures = [
            pool.submit(_producer_thread, i, all_events[i], barrier)
            for i in range(num_threads)
        ]
        thread_results = [f.result() for f in futures]

    produce_end = time.perf_counter()
    produce_wall = produce_end - produce_start
    total_sent = sum(r["sent"] for r in thread_results)
    total_errors = sum(r["errors"] for r in thread_results)
    produce_eps = total_sent / produce_wall if produce_wall > 0 else 0

    print(f"  → Sent {total_sent:,} events to Vector in {produce_wall:.2f}s "
          f"({produce_eps:,.0f} produce EPS)")
    if total_errors:
        print(f"  ⚠ HTTP errors: {total_errors}")

    # Wait for full pipeline to drain into ClickHouse
    print(f"  Waiting for Vector → Redpanda → Consumer → ClickHouse drain …")
    target = baseline + total_sent
    drain_start = time.perf_counter()
    last_count = baseline

    while True:
        time.sleep(POLL_INTERVAL)
        current = ch_total_events()
        elapsed = time.perf_counter() - drain_start

        if current >= target:
            drain_end = time.perf_counter()
            break

        if elapsed > MAX_DRAIN_WAIT:
            print(f"  ⚠ Drain timeout ({MAX_DRAIN_WAIT}s) — "
                  f"got {current - baseline:,} / {total_sent:,}")
            drain_end = time.perf_counter()
            break

        ingested = current - baseline
        rate = ingested / elapsed if elapsed > 0 else 0
        if current != last_count:
            remaining = target - current
            eta = remaining / rate if rate > 0 else 999
            print(f"    [{elapsed:5.1f}s] {ingested:>9,} / {total_sent:,}  "
                  f"({rate:,.0f} EPS)  ETA {eta:.1f}s", flush=True)
        last_count = current

    drain_wall = drain_end - drain_start
    final_count = ch_total_events()
    actually_ingested = final_count - baseline
    e2e_wall = produce_wall + drain_wall
    e2e_eps = actually_ingested / e2e_wall if e2e_wall > 0 else 0
    drain_eps = actually_ingested / drain_wall if drain_wall > 0 else 0

    result = {
        "threads":           num_threads,
        "target_events":     actual_total,
        "actually_ingested": actually_ingested,
        "produce_wall_sec":  round(produce_wall, 3),
        "produce_eps":       round(produce_eps),
        "drain_wall_sec":    round(drain_wall, 3),
        "drain_eps":         round(drain_eps),
        "e2e_wall_sec":      round(e2e_wall, 3),
        "e2e_eps":           round(e2e_eps),
    }

    print(f"\n  ┌─────────────────────────────────────────────────────┐")
    print(f"  │  STAGE                     EPS         TIME         │")
    print(f"  │  ─────────────────────────────────────────────────── │")
    print(f"  │  Host → Vector      : {produce_eps:>10,.0f}   ({produce_wall:.2f}s)  │")
    print(f"  │  Vector → RP → CH   : {drain_eps:>10,.0f}   ({drain_wall:.2f}s)  │")
    print(f"  │  ─────────────────────────────────────────────────── │")
    print(f"  │  FULL E2E PIPELINE   : {e2e_eps:>10,.0f}   ({e2e_wall:.2f}s)  │")
    print(f"  │  Ingested            : {actually_ingested:>10,} / {total_sent:,}   │")
    print(f"  └─────────────────────────────────────────────────────┘")

    return result


def drain_cooldown():
    prev = ch_total_events()
    for _ in range(8):
        time.sleep(0.5)
        cur = ch_total_events()
        if cur == prev:
            break
        prev = cur


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 70)
    print("  CLIF FULL Pipeline E2E EPS Benchmark (WITH VECTOR)")
    print("  Producer → VECTOR → Redpanda → Consumer → ClickHouse")
    print("=" * 70)
    print(f"  Vector endpoint  : {VECTOR_URL}")
    print(f"  ClickHouse       : {CLICKHOUSE_URL}")
    print(f"  Events per level : {EVENTS_PER_LEVEL:,}")
    print(f"  HTTP batch size  : {HTTP_BATCH_SIZE}")
    print(f"  Concurrency      : {CONCURRENCY_LEVELS}")
    print()

    # Verify Vector
    try:
        r = requests.get("http://localhost:8686/health", timeout=5)
        print(f"  ✓ Vector health: {r.status_code}")
    except Exception as e:
        print(f"  ✗ Vector unreachable: {e}")
        sys.exit(1)

    # Verify ClickHouse
    try:
        cnt = ch_total_events()
        print(f"  ✓ ClickHouse: {cnt:,} total events across all tables")
    except Exception as e:
        print(f"  ✗ ClickHouse failed: {e}")
        sys.exit(1)

    results = []
    for level in CONCURRENCY_LEVELS:
        drain_cooldown()
        r = run_level(level, EVENTS_PER_LEVEL)
        results.append(r)

    # Final summary
    print(f"\n{'='*70}")
    print(f"  FINAL SUMMARY — Full Pipeline EPS (WITH VECTOR)")
    print(f"  Producer → Vector → Redpanda → Consumer → ClickHouse")
    print(f"{'='*70}")
    print(f"  {'Threads':>8}  {'Produce EPS':>14}  {'Drain EPS':>12}  "
          f"{'E2E EPS':>12}  {'Wall(s)':>8}")
    print(f"  {'-'*8}  {'-'*14}  {'-'*12}  {'-'*12}  {'-'*8}")

    base_eps = None
    for r in results:
        if base_eps is None:
            base_eps = r["e2e_eps"]
            scale = "1.00x"
        else:
            s = r["e2e_eps"] / base_eps if base_eps > 0 else 0
            scale = f"{s:.2f}x"
        print(f"  {r['threads']:>8}  {r['produce_eps']:>14,}  "
              f"{r['drain_eps']:>12,}  {r['e2e_eps']:>12,}  "
              f"{r['e2e_wall_sec']:>8.1f}  {scale}")

    print()
    print("  Pipeline stages measured:")
    print("    Produce EPS = Host HTTP POST → Vector (parse+classify+route)")
    print("    Drain EPS   = Vector → Redpanda → Consumer → ClickHouse")
    print("    E2E EPS     = total events / total wall time")
    print("=" * 70)


if __name__ == "__main__":
    main()
