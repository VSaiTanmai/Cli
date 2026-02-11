#!/usr/bin/env bash
# =============================================================================
# CLIF — Redpanda Topic Creation Script
# =============================================================================
# Usage:  ./topics.sh [broker_address]
# Default broker: localhost:19092 (external listener)
# =============================================================================
set -euo pipefail

BROKER="${1:-localhost:19092}"
PARTITIONS="${REDPANDA_PARTITIONS:-12}"
RF="${REDPANDA_REPLICATION_FACTOR:-2}"
RETENTION="${REDPANDA_LOG_RETENTION_MS:-604800000}"  # 7 days

TOPICS=(
  "raw-logs"
  "security-events"
  "process-events"
  "network-events"
)

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  CLIF — Creating Redpanda Topics                        ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo "  Broker     : ${BROKER}"
echo "  Partitions : ${PARTITIONS}"
echo "  Replicas   : ${RF}"
echo "  Retention  : ${RETENTION} ms ($(( RETENTION / 86400000 )) days)"
echo ""

for TOPIC in "${TOPICS[@]}"; do
  echo -n "  Creating ${TOPIC} ... "
  rpk topic create "${TOPIC}" \
    --brokers "${BROKER}" \
    --partitions "${PARTITIONS}" \
    --replicas "${RF}" \
    --topic-config retention.ms="${RETENTION}" \
    --topic-config cleanup.policy=delete \
    --topic-config compression.type=producer \
    --topic-config max.message.bytes=10485760 \
    2>/dev/null && echo "✔" || echo "already exists ✔"
done

echo ""
echo "  Current topic list:"
rpk topic list --brokers "${BROKER}"
echo ""
echo "  Done."
