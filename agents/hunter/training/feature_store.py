"""
Feature Store – helpers for writing hunter investigation results to
the `hunter_training_data` ClickHouse table.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from config import CLICKHOUSE_DATABASE
from models import FEATURE_ORDER, HunterVerdict
from utils import sanitize_sql

log = logging.getLogger(__name__)


def write_training_row(
    verdict: HunterVerdict,
    label: int,
    ch_client: Any,
) -> None:
    """
    Insert one training row into `hunter_training_data`.

    Schema columns: alert_id, feature_vector, label, label_source,
                    label_confidence, created_at
    """
    if not verdict.feature_vector or len(verdict.feature_vector) != len(FEATURE_ORDER):
        log.warning(
            "Skipping training write – feature_vector missing or wrong length for %s",
            verdict.alert_id,
        )
        return

    feature_json = json.dumps(verdict.feature_vector)

    # Convert finding_type to label_source description
    label_source = _determine_label_source(verdict)

    # label_confidence maps from hunter_score (0-1)
    label_confidence = verdict.hunter_score

    try:
        ch_client.command(
            f"""
            INSERT INTO {CLICKHOUSE_DATABASE}.hunter_training_data
            (alert_id, feature_vector, label, label_source, label_confidence)
            VALUES (
                '{sanitize_sql(verdict.alert_id)}',
                '{sanitize_sql(feature_json)}',
                {label},
                '{sanitize_sql(label_source)}',
                {label_confidence:.6f}
            )
            """
        )
    except Exception as exc:  # noqa: BLE001
        log.error("Feature store write failed for %s: %s", verdict.alert_id, exc)


def _determine_label_source(verdict: HunterVerdict) -> str:
    """Return a human-readable label source description."""
    model = getattr(verdict, 'model_used', 'unknown')
    prefix = "catboost" if model == "catboost" else "heuristic"
    if verdict.finding_type in ("CONFIRMED_ATTACK", "ACTIVE_CAMPAIGN"):
        return f"{prefix}_positive"
    if verdict.finding_type in ("FALSE_POSITIVE", "NORMAL_BEHAVIOUR"):
        return f"{prefix}_negative"
    return f"{prefix}_ambiguous"
