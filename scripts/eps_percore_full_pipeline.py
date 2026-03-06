#!/usr/bin/env python3
"""
CLIF Full Pipeline — Per-Core EPS Benchmark (WITH VECTOR)
==========================================================
Scales VECTOR_THREADS (1 → 2 → 4) to measure true per-core pipeline EPS.

For each level:
  1. Restart Vector with VECTOR_THREADS=N
  2. Push events via TCP NDJSON socket (port 9514) — faster than HTTP
  3. Measure E2E: events landed in ClickHouse / total wall time
  4. Report per-core metrics

TCP socket is used instead of HTTP because:
  - HTTP overhead (connection, headers, JSON array parsing) was 4K EPS
  - TCP NDJSON is how production syslog/agent feeds Vector
  - Measures Vector transform throughput, not HTTP server overhead
"""

import json
import os
import socket
import subprocess
import sys
import time
import threading
import uuid
import random
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
VECTOR_TCP_HOST   = os.getenv("VECTOR_TCP_HOST",     "localhost")
VECTOR_TCP_PORT   = int(os.getenv("VECTOR_TCP_PORT",  "9514"))
CLICKHOUSE_URL    = os.getenv("CLICKHOUSE_URL",       "http://localhost:8123")
CLICKHOUSE_USER   = os.getenv("CLICKHOUSE_USER",      "clif_admin")
CLICKHOUSE_PASS   = os.getenv("CLICKHOUSE_PASSWORD",  "Cl1f_Ch@ngeM3_2026!")
CLICKHOUSE_DB     = os.getenv("CLICKHOUSE_DB",        "clif_logs")
COMPOSE_FILE      = "docker-compose-benchmark.yml"

EVENTS_PER_LEVEL  = int(os.getenv("EVENTS_PER_LEVEL", "200000"))
VECTOR_THREAD_LEVELS = [1, 2, 4]    # Vector internal threads to test
TCP_SENDERS       = 4               # Fixed TCP sender threads (not the bottleneck)
POLL_INTERVAL     = 0.5
MAX_WAIT          = 300             # max seconds to wait for all events

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


def _generate_ndjson_line() -> bytes:
    """Build a single NDJSON line (newline-terminated JSON)."""
    msg_template = random.choice(_MESSAGES)
    msg = msg_template.format(
        user=random.choice(_USERS), ip=_random_ip(),
        port=random.randint(1024, 65535), ms=random.randint(1, 9999),
        domain=random.choice(_DOMAINS), pid=random.randint(100, 65535),
        ext_ip=_random_ip(), bytes=random.randint(64, 1_000_000),
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
    return json.dumps(event).encode("utf-8") + b"\n"


# ---------------------------------------------------------------------------
# ClickHouse helper
# ---------------------------------------------------------------------------
_CH = requests.Session()
_CH.auth = (CLICKHOUSE_USER, CLICKHOUSE_PASS)


def ch_total() -> int:
    """Sum rows across all 4 ingestion tables."""
    total = 0
    for t in ["raw_logs", "security_events", "process_events", "network_events"]:
        try:
            r = _CH.get(CLICKHOUSE_URL, params={
                "query": f"SELECT count() FROM {t}",
                "database": CLICKHOUSE_DB
            }, timeout=10)
            r.raise_for_status()
            total += int(r.text.strip())
        except Exception:
            pass
    return total


# ---------------------------------------------------------------------------
# Docker helpers
# ---------------------------------------------------------------------------
def docker_run(*args, timeout=120):
    cmd = ["docker"] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return result.returncode, result.stdout + result.stderr


def restart_vector(threads: int):
    """Stop Vector, restart with VECTOR_THREADS=N."""
    print(f"    Stopping Vector …", end=" ", flush=True)
    subprocess.run(["docker", "stop", "clif-vector"], capture_output=True, timeout=30)
    subprocess.run(["docker", "rm", "-f", "clif-vector"], capture_output=True, timeout=30)
    time.sleep(1)
    print("done")

    print(f"    Starting Vector with VECTOR_THREADS={threads} …", end=" ", flush=True)
    cmd = [
        "docker", "compose", "-f", COMPOSE_FILE,
        "run", "-d", "--name", "clif-vector",
        "-e", f"VECTOR_THREADS={threads}",
        "-p", "1514:1514",
        "-p", "1514:1514/udp",
        "-p", "8686:8686",
        "-p", "8687:8687",
        "-p", "9514:9514",
        "--no-deps",
        "clif-vector"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"FAILED: {result.stderr}")
        sys.exit(1)
    print("done")

    # Wait for healthy
    print(f"    Waiting for Vector health …", end=" ", flush=True)
    for attempt in range(30):
        time.sleep(2)
        try:
            r = requests.get("http://localhost:8686/health", timeout=3)
            if r.status_code == 200:
                print(f"healthy ({(attempt+1)*2}s)")
                return
        except Exception:
            pass
    print("TIMEOUT — proceeding anyway")


def ensure_consumer():
    """Make sure consumer is running."""
    check = subprocess.run(
        ["docker", "ps", "--filter", "name=clif-consumer", "--format", "{{.Status}}"],
        capture_output=True, text=True, timeout=10
    )
    if "Up" in check.stdout:
        return
    print("    Restarting consumer …", end=" ", flush=True)
    subprocess.run(["docker", "stop", "clif-consumer"], capture_output=True, timeout=30)
    subprocess.run(["docker", "rm", "-f", "clif-consumer"], capture_output=True, timeout=30)
    time.sleep(1)
    cmd = [
        "docker", "compose", "-f", COMPOSE_FILE,
        "up", "-d", "clif-consumer"
    ]
    subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    time.sleep(5)
    print("done")


# ---------------------------------------------------------------------------
# TCP NDJSON sender
# ---------------------------------------------------------------------------
def _tcp_sender(thread_id: int, lines: list[bytes], barrier: threading.Barrier) -> dict:
    """Send NDJSON lines over TCP to Vector's socket source."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1024 * 1024)  # 1MB send buffer
    sock.settimeout(30)
    sock.connect((VECTOR_TCP_HOST, VECTOR_TCP_PORT))

    barrier.wait()

    t0 = time.perf_counter()
    sent = 0
    # Send in chunks of ~64KB for efficiency
    buf = b""
    for line in lines:
        buf += line
        if len(buf) >= 65536:
            sock.sendall(buf)
            sent += buf.count(b"\n")
            buf = b""
    if buf:
        sock.sendall(buf)
        sent += buf.count(b"\n")

    elapsed = time.perf_counter() - t0
    sock.close()
    return {"thread": thread_id, "sent": sent, "sec": elapsed}


# ---------------------------------------------------------------------------
# Benchmark
# ---------------------------------------------------------------------------
def run_level(vector_threads: int, total_events: int) -> dict:
    per_sender = total_events // TCP_SENDERS
    actual = per_sender * TCP_SENDERS

    print(f"\n{'='*70}")
    print(f"  VECTOR_THREADS = {vector_threads}  |  {actual:,} events")
    print(f"  {TCP_SENDERS} TCP sender thread(s) → Vector:{VECTOR_TCP_PORT}")
    print(f"{'='*70}")

    # Restart Vector with new thread count
    restart_vector(vector_threads)
    ensure_consumer()

    # Cooldown
    prev = ch_total()
    for _ in range(6):
        time.sleep(0.5)
        cur = ch_total()
        if cur == prev:
            break
        prev = cur

    baseline = ch_total()
    print(f"    CH baseline: {baseline:,}")

    # Pre-generate
    print(f"    Pre-generating {actual:,} NDJSON lines …", end=" ", flush=True)
    all_lines = [
        [_generate_ndjson_line() for _ in range(per_sender)]
        for _ in range(TCP_SENDERS)
    ]
    print("done")

    # Send via TCP
    barrier = threading.Barrier(TCP_SENDERS)
    print(f"    Sending via TCP →", flush=True)
    t_start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=TCP_SENDERS) as pool:
        futures = [
            pool.submit(_tcp_sender, i, all_lines[i], barrier)
            for i in range(TCP_SENDERS)
        ]
        thread_results = [f.result() for f in futures]

    send_wall = time.perf_counter() - t_start
    total_sent = sum(r["sent"] for r in thread_results)
    send_eps = total_sent / send_wall if send_wall > 0 else 0
    print(f"    Sent {total_sent:,} in {send_wall:.2f}s ({send_eps:,.0f} send EPS)")

    # Wait for pipeline to drain into ClickHouse
    print(f"    Waiting for full pipeline to drain into CH …")
    target = baseline + total_sent
    peak_eps = 0
    samples = []

    while True:
        time.sleep(POLL_INTERVAL)
        current = ch_total()
        elapsed = time.perf_counter() - t_start

        ingested = current - baseline
        instant_eps = ingested / elapsed if elapsed > 0 else 0

        # Track peak over 3-second windows
        samples.append((elapsed, ingested))
        if len(samples) >= 6:  # 3 seconds of 0.5s intervals
            old_t, old_n = samples[-6]
            window_eps = (ingested - old_n) / (elapsed - old_t) if (elapsed - old_t) > 0 else 0
            peak_eps = max(peak_eps, window_eps)

        if current >= target:
            final_wall = time.perf_counter() - t_start
            break

        if elapsed > MAX_WAIT:
            print(f"    ⚠ Timeout ({MAX_WAIT}s) — {ingested:,} / {total_sent:,}")
            final_wall = time.perf_counter() - t_start
            break

        if current != (samples[-2][1] if len(samples) >= 2 else -1):
            remaining = target - current
            eta = remaining / instant_eps if instant_eps > 0 else 999
            pct = 100 * ingested / total_sent if total_sent > 0 else 0
            print(f"      [{elapsed:5.1f}s] {ingested:>9,} / {total_sent:,}  "
                  f"({pct:.0f}%)  {instant_eps:,.0f} EPS  ETA {eta:.1f}s", flush=True)

    final_count = ch_total()
    actually_ingested = final_count - baseline
    e2e_eps = actually_ingested / final_wall if final_wall > 0 else 0
    eps_per_core = e2e_eps / vector_threads if vector_threads > 0 else 0

    result = {
        "vector_threads": vector_threads,
        "sent":           total_sent,
        "ingested":       actually_ingested,
        "send_eps":       round(send_eps),
        "e2e_eps":        round(e2e_eps),
        "e2e_wall":       round(final_wall, 2),
        "eps_per_core":   round(eps_per_core),
        "peak_eps":       round(peak_eps),
    }

    print(f"\n  ┌──────────────────────────────────────────────────────┐")
    print(f"  │  VECTOR_THREADS : {vector_threads:<5}                          │")
    print(f"  │  Send→Vector    : {send_eps:>10,.0f} EPS  ({send_wall:.1f}s)    │")
    print(f"  │  E2E Pipeline   : {e2e_eps:>10,.0f} EPS  ({final_wall:.1f}s)    │")
    print(f"  │  EPS/core       : {eps_per_core:>10,.0f}                        │")
    print(f"  │  Peak (3s win)  : {peak_eps:>10,.0f} EPS                        │")
    print(f"  │  Ingested       : {actually_ingested:>10,} / {total_sent:,}     │")
    print(f"  └──────────────────────────────────────────────────────┘")

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 70)
    print("  CLIF Full Pipeline — Per-Core EPS Benchmark (WITH VECTOR)")
    print("  Scaling VECTOR_THREADS: 1 → 2 → 4")
    print("  Path: TCP → Vector(VRL) → Redpanda → Consumer → ClickHouse")
    print("=" * 70)
    print(f"  Events per level  : {EVENTS_PER_LEVEL:,}")
    print(f"  TCP senders       : {TCP_SENDERS} (fixed)")
    print(f"  Vector thread lvls: {VECTOR_THREAD_LEVELS}")
    print()

    # Verify CH
    try:
        cnt = ch_total()
        print(f"  ✓ ClickHouse: {cnt:,} total events")
    except Exception as e:
        print(f"  ✗ ClickHouse failed: {e}")
        sys.exit(1)

    results = []
    for threads in VECTOR_THREAD_LEVELS:
        r = run_level(threads, EVENTS_PER_LEVEL)
        results.append(r)

    # Final summary
    print(f"\n{'='*70}")
    print(f"  FINAL SUMMARY — Per-Core Pipeline EPS (WITH VECTOR)")
    print(f"  TCP → Vector(VRL) → Redpanda → Consumer → ClickHouse")
    print(f"{'='*70}")
    print(f"  {'V.Threads':>10}  {'Send EPS':>12}  {'E2E EPS':>12}  "
          f"{'EPS/core':>12}  {'Peak EPS':>12}  {'Wall(s)':>8}")
    print(f"  {'-'*10}  {'-'*12}  {'-'*12}  {'-'*12}  {'-'*12}  {'-'*8}")

    base_eps = results[0]["e2e_eps"] if results else 1
    for r in results:
        scale = r["e2e_eps"] / base_eps if base_eps > 0 else 0
        print(f"  {r['vector_threads']:>10}  {r['send_eps']:>12,}  "
              f"{r['e2e_eps']:>12,}  {r['eps_per_core']:>12,}  "
              f"{r['peak_eps']:>12,}  {r['e2e_wall']:>8.1f}  {scale:.2f}x")

    print(f"\n  Columns:")
    print(f"    V.Threads = VECTOR_THREADS (Vector's internal processing threads)")
    print(f"    Send EPS  = TCP socket push rate (not the bottleneck)")
    print(f"    E2E EPS   = events in ClickHouse / total wall time")
    print(f"    EPS/core  = E2E EPS / VECTOR_THREADS")
    print(f"    Peak EPS  = highest 3-second window EPS")
    print(f"    Scale     = E2E EPS relative to 1-thread baseline")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
