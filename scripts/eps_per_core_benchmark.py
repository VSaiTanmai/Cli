"""
EPS Per-Core Benchmark — Direct ClickHouse insert throughput test.

Tests how many events per second ClickHouse can ingest using 1, 2, 4, 8
concurrent writer processes (simulating per-core scaling).

Lightweight: runs from host Python, no Docker containers needed besides CH.
"""

import time
import json
import random
import string
import sys
import concurrent.futures
import urllib.request

CH_URL = "http://localhost:8123"
CH_USER = "clif_admin"
CH_PASS = "Cl1f_Ch@ngeM3_2026!"
DB = "clif_logs"
TABLE = "raw_logs"
BATCH_SIZE = 10_000       # rows per INSERT
DURATION_SEC = 15         # seconds per concurrency level
CONCURRENCY_LEVELS = [1, 2, 4, 8]

# ── Synthetic log generator ──────────────────────────────────────────────

HOSTNAMES = [f"srv-{i:03d}" for i in range(50)]
SOURCES = ["syslog", "auth", "kern", "daemon", "network", "security"]
LEVELS = ["info", "warning", "error", "critical"]
MESSAGES = [
    "Connection established from {ip}",
    "Failed password for root from {ip} port 22 ssh2",
    "Accepted publickey for admin from {ip} port 443",
    "Firewall DENY src={ip} dst=10.0.0.1 proto=TCP dport=8080",
    "Process nginx started pid={pid}",
    "Disk usage on /var/log reached {pct}%",
    "DNS query from {ip} for suspicious.example.com",
    "Kernel: segfault at 0000 ip 00007f rsp 00007ff",
    "SNMP community string sweep detected from {ip}",
    "Session timeout for user admin after 1800s idle",
]


def random_ip():
    return f"{random.randint(10,192)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"


def generate_batch(n: int) -> str:
    """Generate n rows in JSONEachRow format."""
    lines = []
    base_ts = time.time()
    for i in range(n):
        msg_tpl = random.choice(MESSAGES)
        msg = msg_tpl.format(
            ip=random_ip(),
            pid=random.randint(1000, 60000),
            pct=random.randint(60, 99),
        )
        row = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(base_ts + i * 0.001)),
            "hostname": random.choice(HOSTNAMES),
            "source_type": random.choice(SOURCES),
            "level": random.choice(LEVELS),
            "message": msg,
            "source_ip": random_ip(),
        }
        lines.append(json.dumps(row))
    return "\n".join(lines)


def insert_batch(batch_data: bytes) -> int:
    """Insert one batch into ClickHouse via HTTP. Returns row count."""
    url = f"{CH_URL}/?user={CH_USER}&password={CH_PASS}&query=INSERT+INTO+{DB}.{TABLE}+FORMAT+JSONEachRow"
    req = urllib.request.Request(url, data=batch_data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
        return BATCH_SIZE
    except Exception as e:
        print(f"  INSERT error: {e}", file=sys.stderr)
        return 0


def worker_loop(worker_id: int, stop_time: float) -> int:
    """Continuously insert batches until stop_time. Returns total rows."""
    total = 0
    while time.time() < stop_time:
        data = generate_batch(BATCH_SIZE).encode("utf-8")
        total += insert_batch(data)
    return total


def run_benchmark(concurrency: int) -> dict:
    """Run benchmark at given concurrency for DURATION_SEC seconds."""
    # Pre-count rows
    count_url = f"{CH_URL}/?user={CH_USER}&password={CH_PASS}&query=SELECT+count()+FROM+{DB}.{TABLE}"
    with urllib.request.urlopen(count_url) as r:
        before = int(r.read().strip())

    stop_time = time.time() + DURATION_SEC
    start = time.time()

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker_loop, i, stop_time) for i in range(concurrency)]
        results = [f.result() for f in futures]

    elapsed = time.time() - start
    total_rows = sum(results)

    # Verify in CH
    with urllib.request.urlopen(count_url) as r:
        after = int(r.read().strip())

    actual_inserted = after - before
    eps = total_rows / elapsed if elapsed > 0 else 0
    eps_per_core = eps / concurrency

    return {
        "concurrency": concurrency,
        "duration_sec": round(elapsed, 1),
        "total_rows": total_rows,
        "ch_verified": actual_inserted,
        "eps": int(eps),
        "eps_per_core": int(eps_per_core),
    }


def main():
    # Verify CH is reachable
    try:
        with urllib.request.urlopen(f"{CH_URL}/?user={CH_USER}&password={CH_PASS}&query=SELECT+1") as r:
            r.read()
    except Exception as e:
        print(f"ClickHouse not reachable at {CH_URL}: {e}")
        sys.exit(1)

    # Check table exists
    table = TABLE
    try:
        check_url = f"{CH_URL}/?user={CH_USER}&password={CH_PASS}&query=SELECT+count()+FROM+{DB}.{table}"
        with urllib.request.urlopen(check_url) as r:
            r.read()
    except Exception:
        print(f"Table {DB}.{table} doesn't exist. Trying security_events...")
        table = "security_events"

    print("=" * 70)
    print(f"EPS Per-Core Benchmark — ClickHouse Direct Insert")
    print(f"CPU: i5-14450HX (10C/16T) | Docker RAM: 7.6GB")
    print(f"Batch size: {BATCH_SIZE:,} | Duration per level: {DURATION_SEC}s")
    print("=" * 70)

    results = []
    for c in CONCURRENCY_LEVELS:
        print(f"\n>>> Testing {c} concurrent writer(s) for {DURATION_SEC}s ...")
        r = run_benchmark(c)
        results.append(r)
        print(f"    Rows inserted: {r['total_rows']:>10,}")
        print(f"    CH verified:   {r['ch_verified']:>10,}")
        print(f"    Total EPS:     {r['eps']:>10,}")
        print(f"    EPS/core:      {r['eps_per_core']:>10,}")

    print("\n" + "=" * 70)
    print(f"{'Cores':<8} {'Total EPS':>12} {'EPS/Core':>12} {'Rows':>12} {'Scaling':>10}")
    print("-" * 70)
    base_eps = results[0]["eps"] if results[0]["eps"] > 0 else 1
    for r in results:
        scaling = r["eps"] / base_eps
        print(f"{r['concurrency']:<8} {r['eps']:>12,} {r['eps_per_core']:>12,} {r['total_rows']:>12,} {scaling:>9.2f}x")
    print("=" * 70)

    # Scaling efficiency
    print("\nScaling Efficiency:")
    for r in results:
        ideal = results[0]["eps"] * r["concurrency"]
        eff = (r["eps"] / ideal) * 100 if ideal > 0 else 0
        print(f"  {r['concurrency']} cores: {eff:.0f}% of linear scaling")


if __name__ == "__main__":
    main()
