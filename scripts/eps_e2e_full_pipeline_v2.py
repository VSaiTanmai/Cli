#!/usr/bin/env python3
"""
CLIF Full-Pipeline E2E EPS Benchmark (WITH VECTOR) — v2 Corrected
==================================================================
Producer → Vector → Redpanda → Consumer → ClickHouse

Fixed measurement: wall time from first event sent to last event in CH.
No split between "produce" and "drain" — because Vector streams
events through the pipeline DURING the produce phase.

Usage:
    pip install requests
    python scripts/eps_e2e_full_pipeline_v2.py
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

EVENTS_PER_LEVEL  = int(os.getenv("EVENTS_PER_LEVEL", "100000"))
CONCURRENCY_LEVELS= [1, 2, 4]
HTTP_BATCH_SIZE   = 500
POLL_INTERVAL     = 0.5
MAX_WAIT          = 600

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

def _generate_event() -> dict:
    t = random.choice(_MESSAGES)
    msg = t.format(user=random.choice(_USERS), ip=_random_ip(),
                   port=random.randint(1024,65535), ms=random.randint(1,9999),
                   domain=random.choice(_DOMAINS), pid=random.randint(100,65535),
                   ext_ip=_random_ip(), bytes=random.randint(64,1000000))
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": random.choice(_LEVELS),
        "source": random.choice(_SOURCES),
        "message": msg,
        "ip_address": _random_ip(),
        "metadata": {
            "user_id": random.choice(_USERS),
            "request_id": uuid.uuid4().hex[:16],
            "env": random.choice(["prod","staging","dev"]),
            "region": random.choice(["us-east-1","eu-west-1","ap-south-1"]),
        },
    }

# ---------------------------------------------------------------------------
# ClickHouse
# ---------------------------------------------------------------------------
_CH = requests.Session()
_CH.auth = (CLICKHOUSE_USER, CLICKHOUSE_PASS)

def ch_count(table="raw_logs"):
    r = _CH.get(CLICKHOUSE_URL, params={"query":f"SELECT count() FROM {table}",
                                         "database":CLICKHOUSE_DB}, timeout=10)
    r.raise_for_status()
    return int(r.text.strip())

def ch_total():
    total = 0
    for t in ["raw_logs","security_events","process_events","network_events"]:
        try: total += ch_count(t)
        except: pass
    return total

# ---------------------------------------------------------------------------
# Vector sender
# ---------------------------------------------------------------------------
def _sender(tid, events, barrier, results_lock, shared):
    session = requests.Session()
    session.headers["Content-Type"] = "application/json"
    barrier.wait()
    sent = 0
    for i in range(0, len(events), HTTP_BATCH_SIZE):
        batch = events[i:i+HTTP_BATCH_SIZE]
        try:
            r = session.post(VECTOR_URL, json=batch, timeout=60)
            r.raise_for_status()
            sent += len(batch)
        except Exception as e:
            with results_lock:
                shared["errors"] += 1
    with results_lock:
        shared["sent"] += sent

# ---------------------------------------------------------------------------
# Monitor thread — polls CH count in background during the benchmark
# ---------------------------------------------------------------------------
def _monitor(baseline, target, stop_event, samples):
    """Polls CH row count periodically, stores (time, count) samples."""
    while not stop_event.is_set():
        try:
            c = ch_total()
            samples.append((time.perf_counter(), c))
            ingested = c - baseline
            if ingested >= target:
                break
        except:
            pass
        stop_event.wait(POLL_INTERVAL)

# ---------------------------------------------------------------------------
# Benchmark
# ---------------------------------------------------------------------------
def run_level(num_threads, total_events):
    per_thread = total_events // num_threads
    actual = per_thread * num_threads

    print(f"\n{'='*70}")
    print(f"  {num_threads} HTTP thread(s)  |  {actual:,} events")
    print(f"  Pipeline: Host → Vector → Redpanda → Consumer → ClickHouse")
    print(f"{'='*70}")

    # Pre-generate
    print(f"  Pre-generating {actual:,} events …", end=" ", flush=True)
    all_events = [[_generate_event() for _ in range(per_thread)]
                  for _ in range(num_threads)]
    print("done")

    # Baseline
    baseline = ch_total()
    print(f"  CH baseline: {baseline:,}")

    # Start monitor thread
    stop_mon = threading.Event()
    samples = []  # (timestamp, ch_count)
    monitor = threading.Thread(target=_monitor, args=(baseline, actual, stop_mon, samples), daemon=True)

    # Shared results
    lock = threading.Lock()
    shared = {"sent": 0, "errors": 0}

    # Start everything together
    barrier = threading.Barrier(num_threads + 1)  # +1 for main thread
    threads = []
    for i in range(num_threads):
        t = threading.Thread(target=_sender, args=(i, all_events[i], barrier, lock, shared))
        t.start()
        threads.append(t)

    # Start measuring
    monitor.start()
    t0 = time.perf_counter()
    barrier.wait()  # release all senders

    # Wait for senders to finish
    for t in threads:
        t.join()
    send_done = time.perf_counter()
    send_wall = send_done - t0
    send_eps = shared["sent"] / send_wall if send_wall > 0 else 0
    print(f"  Sent {shared['sent']:,} to Vector in {send_wall:.2f}s ({send_eps:,.0f} send EPS)")
    if shared["errors"]:
        print(f"  ⚠ HTTP batch errors: {shared['errors']}")

    # Now wait for ALL events to appear in ClickHouse
    target_count = baseline + shared["sent"]
    print(f"  Waiting for remaining events to land in ClickHouse …")
    last_printed = 0

    while True:
        time.sleep(POLL_INTERVAL)
        current = ch_total()
        elapsed = time.perf_counter() - t0
        ingested = current - baseline

        if ingested != last_printed:
            rate = ingested / elapsed if elapsed > 0 else 0
            remaining = shared["sent"] - ingested
            eta = remaining / rate if rate > 0 else 999
            pct = ingested / shared["sent"] * 100 if shared["sent"] > 0 else 0
            print(f"    [{elapsed:5.1f}s] {ingested:>9,} / {shared['sent']:,}  "
                  f"({pct:.0f}%)  {rate:,.0f} EPS  ETA {eta:.1f}s", flush=True)
            last_printed = ingested

        if current >= target_count:
            break

        if elapsed > MAX_WAIT:
            print(f"  ⚠ Timeout ({MAX_WAIT}s) — {ingested:,} / {shared['sent']:,}")
            break

    stop_mon.set()
    monitor.join(timeout=2)

    final = ch_total()
    total_ingested = final - baseline
    total_wall = time.perf_counter() - t0
    e2e_eps = total_ingested / total_wall if total_wall > 0 else 0
    eps_per_thread = e2e_eps / num_threads

    # Compute instantaneous peak EPS from monitor samples
    peak_eps = 0
    window = 3.0  # 3-second rolling window
    for i in range(len(samples)):
        for j in range(i+1, len(samples)):
            dt = samples[j][0] - samples[i][0]
            if dt >= window:
                de = samples[j][1] - samples[i][1]
                inst = de / dt
                if inst > peak_eps:
                    peak_eps = inst
                break

    result = {
        "threads": num_threads,
        "sent": shared["sent"],
        "ingested": total_ingested,
        "send_eps": round(send_eps),
        "e2e_eps": round(e2e_eps),
        "eps_per_thread": round(eps_per_thread),
        "peak_eps": round(peak_eps),
        "wall_sec": round(total_wall, 2),
        "errors": shared["errors"],
    }

    print(f"\n  ┌──────────────────────────────────────────────────────┐")
    print(f"  │  Threads        : {num_threads:<5}                           │")
    print(f"  │  Send to Vector : {send_eps:>10,.0f} EPS  ({send_wall:.1f}s)       │")
    print(f"  │  E2E Pipeline   : {e2e_eps:>10,.0f} EPS  ({total_wall:.1f}s)       │")
    print(f"  │  EPS/thread     : {eps_per_thread:>10,.0f}                        │")
    print(f"  │  Peak (3s win)  : {peak_eps:>10,.0f} EPS                        │")
    print(f"  │  Ingested       : {total_ingested:>10,} / {shared['sent']:,}      │")
    print(f"  └──────────────────────────────────────────────────────┘")

    return result


def drain_cooldown():
    """Wait for residual events between levels."""
    print(f"\n  Cooldown …", end=" ", flush=True)
    prev = ch_total()
    for _ in range(20):  # up to 10s
        time.sleep(0.5)
        cur = ch_total()
        if cur == prev:
            break
        prev = cur
    print(f"stable at {cur:,}")


def main():
    print("=" * 70)
    print("  CLIF FULL Pipeline E2E EPS Benchmark (WITH VECTOR) v2")
    print("  Producer → VECTOR → Redpanda → Consumer → ClickHouse")
    print("=" * 70)
    print(f"  Vector   : {VECTOR_URL}")
    print(f"  CH       : {CLICKHOUSE_URL}")
    print(f"  Events   : {EVENTS_PER_LEVEL:,} per level")
    print(f"  Batch    : {HTTP_BATCH_SIZE} events/POST")
    print(f"  Levels   : {CONCURRENCY_LEVELS}")
    print()

    # Connectivity
    try:
        r = requests.get("http://localhost:8686/health", timeout=5)
        print(f"  ✓ Vector: healthy ({r.status_code})")
    except Exception as e:
        print(f"  ✗ Vector: {e}"); sys.exit(1)

    try:
        cnt = ch_total()
        print(f"  ✓ ClickHouse: {cnt:,} total events")
    except Exception as e:
        print(f"  ✗ ClickHouse: {e}"); sys.exit(1)

    results = []
    for level in CONCURRENCY_LEVELS:
        drain_cooldown()
        r = run_level(level, EVENTS_PER_LEVEL)
        results.append(r)

    # Summary
    print(f"\n{'='*70}")
    print(f"  FINAL SUMMARY — Full Pipeline with Vector")
    print(f"  Host → Vector → Redpanda → Consumer → ClickHouse")
    print(f"{'='*70}")
    print(f"  {'Threads':>8}  {'Send EPS':>12}  {'E2E EPS':>12}  "
          f"{'EPS/thread':>12}  {'Peak EPS':>12}  {'Wall(s)':>8}")
    print(f"  {'-'*8}  {'-'*12}  {'-'*12}  {'-'*12}  {'-'*12}  {'-'*8}")

    base = results[0]["e2e_eps"] if results else 1
    for r in results:
        scale = r["e2e_eps"] / base if base > 0 else 0
        print(f"  {r['threads']:>8}  {r['send_eps']:>12,}  {r['e2e_eps']:>12,}  "
              f"{r['eps_per_thread']:>12,}  {r['peak_eps']:>12,}  "
              f"{r['wall_sec']:>8.1f}  {scale:.2f}x")

    print(f"\n  Measurement method:")
    print(f"    Wall time = first HTTP POST to Vector → last row in ClickHouse")
    print(f"    E2E EPS   = total_ingested / wall_time")
    print(f"    EPS/thread = E2E EPS / num_threads")
    print(f"    Peak EPS  = max instantaneous rate over 3s rolling window")
    print(f"\n  Pipeline stages (all running in parallel):")
    print(f"    [Host HTTP POST] → [Vector VRL parse+classify] → [Redpanda broker]")
    print(f"    → [Consumer poll+batch] → [ClickHouse native insert]")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
