import json, sys

with open('hunter_results_raw.txt', 'r') as f:
    content = f.read()

records = []
buf = ''
brace_depth = 0
for ch in content:
    if ch == '{':
        brace_depth += 1
    if brace_depth > 0:
        buf += ch
    if ch == '}':
        brace_depth -= 1
        if brace_depth == 0 and buf:
            try:
                r = json.loads(buf)
                records.append(r)
            except:
                pass
            buf = ''

records.sort(key=lambda x: x.get('started_at', ''))

with open('hunter_parsed.txt', 'w') as out:
    out.write(f"Total records: {len(records)}\n\n")
    for i, r in enumerate(records):
        out.write(f"ROW {i+1}\n")
        out.write(f"  started_at: {r['started_at']}\n")
        out.write(f"  hostname: {r['hostname']}\n")
        out.write(f"  trigger_score: {r['trigger_score']:.4f}\n")
        out.write(f"  finding_type: {r['finding_type']}\n")
        out.write(f"  confidence: {r['confidence']:.4f}\n")
        out.write(f"  correlated_events: {len(r.get('correlated_events', []))}\n")
        out.write(f"  mitre_tactics: {', '.join(r.get('mitre_tactics', []))}\n")
        out.write(f"  summary: {r['summary'][:80]}\n")
        out.write("\n")

print("Done. Output in hunter_parsed.txt")
