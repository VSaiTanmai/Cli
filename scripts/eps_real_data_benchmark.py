"""
EPS Per-Core Benchmark — REAL DATA from ClickHouse.

Extracts 50K real rows from raw_logs, then replays them back into ClickHouse
to measure true insert throughput with real-world payloads (complex messages,
UUIDs, metadata fields).
"""

import time
import sys
import json
import uuid
import concurrent.futures
import urllib.request

CH_URL = "http://localhost:8123"
CH_USER = "clif_admin"
CH_PASS = "Cl1f_Ch@ngeM3_2026!"
DB = "clif_logs"
TABLE = "raw_logs"

SAMPLE_SIZE = 50_000       # rows to extract from CH
BATCH_SIZE = 10_000        # rows per INSERT
DURATION_SEC = 15          # seconds per concurrency level
CONCURRENCY_LEVELS = [1, 2, 4, 8]


def ch_query(query: str, timeout: int = 30) -> bytes:
    url = f"{CH_URL}/?user={CH_USER}&password={CH_PASS}&query={urllib.parse.quote(query)}"
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def ch_post(query: str, data: bytes, timeout: int = 30) -> bytes:
    url = f"{CH_URL}/?user={CH_USER}&password={CH_PASS}&query={urllib.parse.quote(query)}"
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


import urllib.parse


def extract_real_data(n: int) -> list[str]:
    """Extract n real rows from raw_logs as JSONEachRow lines."""
    print(f"  Extracting {n:,} real rows from {DB}.{TABLE} ...")
    query = f"SELECT * FROM {DB}.{TABLE} LIMIT {n} FORMAT JSONEachRow"
    raw = ch_query(query, timeout=60)
    lines = [l for l in raw.decode("utf-8").strip().split("\n") if l.strip()]
    print(f"  Got {len(lines):,} rows (avg {len(raw)//max(len(lines),1)} bytes/row)")
    return lines


def make_batches(lines: list[str], batch_size: int) -> list[bytes]:
    """Split lines into batches, assign fresh event_ids to avoid dedup."""
    batches = []
    for i in range(0, len(lines), batch_size):
        chunk = lines[i:i + batch_size]
        # Replace event_id to avoid ClickHouse ReplacingMergeTree dedup
        modified = []
        for line in chunk:
            row = json.loads(line)
            row["event_id"] = str(uuid.uuid4())
            # Update timestamp to now so it goes into current partition
            row["timestamp"] = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
            modified.append(json.dumps(row))
        batches.append("\n".join(modified).encode("utf-8"))
    return batches


def insert_batch(batch_data: bytes) -> int:
    """Insert one batch. Returns row count on success, 0 on failure."""
    try:
        ch_post(f"INSERT INTO {DB}.{TABLE} FORMAT JSONEachRow", batch_data)
        return batch_data.count(b"\n") + 1
    except Exception as e:
        print(f"  INSERT error: {e}", file=sys.stderr)
        return 0


def worker_loop(worker_id: int, batches: list[bytes], stop_time: float) -> int:
    """Continuously cycle through batches until stop_time."""
    total = 0
    idx = 0
    while time.time() < stop_time:
        batch = batches[idx % len(batches)]
        # Give each insert a unique event_id set so dedup doesn't eat rows
        rows = batch.decode("utf-8").split("\n")
        fresh = []
        for line in rows:
            if not line.strip():
                continue
            row = json.loads(line)
            row["event_id"] = str(uuid.uuid4())
            fresh.append(json.dumps(row))
        fresh_data = "\n".join(fresh).encode("utf-8")
        total += insert_batch(fresh_data)
        idx += 1
    return total


def run_benchmark(concurrency: int, batches: list[bytes]) -> dict:
    before = int(ch_query(f"SELECT count() FROM {DB}.{TABLE}").strip())

    stop_time = time.time() + DURATION_SEC
    start = time.time()

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker_loop, i, batches, stop_time) for i in range(concurrency)]
        results = [f.result() for f in futures]

    elapsed = time.time() - start
    total_rows = sum(results)

    after = int(ch_query(f"SELECT count() FROM {DB}.{TABLE}").strip())
    actual = after - before
    eps = total_rows / elapsed if elapsed > 0 else 0
    eps_per_core = eps / concurrency

    return {
        "concurrency": concurrency,
        "duration_sec": round(elapsed, 1),
        "total_rows": total_rows,
        "ch_verified": actual,
        "eps": int(eps),
        "eps_per_core": int(eps_per_core),
    }


def main():
    # Verify CH
    try:
        ch_query("SELECT 1")
    except Exception as e:
        print(f"ClickHouse not reachable: {e}")
        sys.exit(1)

    total_rows = int(ch_query(f"SELECT count() FROM {DB}.{TABLE}").strip())
    sample_n = min(SAMPLE_SIZE, total_rows)
    if sample_n < BATCH_SIZE:
        print(f"Not enough data ({sample_n} rows). Need at least {BATCH_SIZE}.")
        sys.exit(1)

    print("=" * 70)
    print("EPS Per-Core Benchmark — REAL DATA")
    print(f"CPU: i5-14450HX (10C/16T) | Docker RAM: 7.6GB | CH limit: 1GB")
    print(f"Source: {total_rows:,} real logs in {DB}.{TABLE}")
    print(f"Sample: {sample_n:,} rows | Batch: {BATCH_SIZE:,} | Duration: {DURATION_SEC}s")
    print("=" * 70)

    lines = extract_real_data(sample_n)
    batches = make_batches(lines, BATCH_SIZE)
    print(f"  Prepared {len(batches)} batches of ~{BATCH_SIZE:,} rows each")
    avg_bytes = sum(len(b) for b in batches) / max(len(batches), 1)
    print(f"  Avg batch size: {avg_bytes/1024:.0f} KB")

    results = []
    for c in CONCURRENCY_LEVELS:
        print(f"\n>>> Testing {c} concurrent writer(s) for {DURATION_SEC}s ...")
        r = run_benchmark(c, batches)
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

    print("\nScaling Efficiency:")
    for r in results:
        ideal = results[0]["eps"] * r["concurrency"]
        eff = (r["eps"] / ideal) * 100 if ideal > 0 else 0
        print(f"  {r['concurrency']} cores: {eff:.0f}% of linear scaling")

    # Comparison
    print("\n" + "=" * 70)
    print("Comparison: Synthetic vs Real Data")
    print("-" * 70)
    synth = [96900, 111447, 118908, 118170]  # from previous run
    for i, r in enumerate(results):
        s = synth[i] if i < len(synth) else 0
        diff_pct = ((r["eps"] - s) / s * 100) if s > 0 else 0
        print(f"  {r['concurrency']} writer(s): Synthetic={s:>8,}  Real={r['eps']:>8,}  Δ={diff_pct:>+.1f}%")


if __name__ == "__main__":
    main()
