"""
Fusion Engine – implements the Triple-Layer decision matrix.

Takes the combined output from all L1/L2 threads, builds the 42-dim
feature vector, and derives the final hunter_score plus finding_type
using the 9-cell decision table from the plan.

Decision matrix:
  ┌────────────────────┬──────────────────┬─────────────────────────────┐
  │  Sigma layer       │  SPC layer       │  ML layer outcome            │
  ├────────────────────┼──────────────────┼─────────────────────────────┤
  │  hit ≥ HIGH        │  any             │ → CONFIRMED_ATTACK (fast)    │
  │  hit (any)         │  anomaly=True    │ → CONFIRMED_ATTACK            │
  │  hit (any)         │  anomaly=False   │ → BEHAVIOURAL_ANOMALY         │
  │  no hit            │  anomaly=True    │ score ≥ .75 → CONFIRMED       │
  │  no hit            │  anomaly=True    │ score < .75 → ANOMALOUS_PAT   │
  │  no hit            │  anomaly=False   │ score ≥ .85 → CONFIRMED       │
  │  no hit            │  anomaly=False   │ .65 ≤ score < .85 → BEHAV     │
  │  no hit            │  anomaly=False   │ score < .65 → NORMAL          │
  │  campaign=True     │  any             │ → ACTIVE_CAMPAIGN (override)  │
  └────────────────────┴──────────────────┴─────────────────────────────┘
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from models import (
    FEATURE_ORDER,
    CampaignResult,
    GraphResult,
    MITREResult,
    MLResult,
    SigmaHit,
    SimilarityResult,
    SPCResult,
    TemporalResult,
)

log = logging.getLogger(__name__)


class FusionEngine:
    """
    Stateless – call `fuse()` for each investigation result.
    """

    def fuse(
        self,
        payload: Dict[str, Any],
        sigma_hits: List[SigmaHit],
        sigma_max_severity: int,
        spc_result: SPCResult,
        graph_result: GraphResult,
        temporal_result: TemporalResult,
        similarity_result: SimilarityResult,
        mitre_result: MITREResult,
        campaign_result: CampaignResult,
        ml_result: MLResult,
    ) -> tuple[str, float, List[float]]:
        """
        Returns:
            finding_type : str
            hunter_score : float (0-1)
            feature_vector : list[float] (42 dims, in FEATURE_ORDER)
        """
        fv = self._build_feature_vector(
            payload,
            sigma_hits,
            sigma_max_severity,
            spc_result,
            graph_result,
            temporal_result,
            similarity_result,
            mitre_result,
            campaign_result,
        )

        # ---------------------------------------------------------------
        # Override: active campaign always wins
        # ---------------------------------------------------------------
        if campaign_result.is_campaign:
            return "ACTIVE_CAMPAIGN", ml_result.score, fv

        # ---------------------------------------------------------------
        # Triple-layer matrix
        # ---------------------------------------------------------------
        has_sigma_hit = len(sigma_hits) > 0
        sigma_high = sigma_max_severity >= 3       # high or critical
        spc_anomaly = spc_result.is_anomaly
        score = ml_result.score

        if sigma_high:
            finding_type = "CONFIRMED_ATTACK"

        elif has_sigma_hit and spc_anomaly:
            finding_type = "CONFIRMED_ATTACK"

        elif has_sigma_hit and not spc_anomaly:
            finding_type = "BEHAVIOURAL_ANOMALY"

        elif not has_sigma_hit and spc_anomaly:
            if score >= 0.75:
                finding_type = "CONFIRMED_ATTACK"
            else:
                finding_type = "ANOMALOUS_PATTERN"

        else:
            # No Sigma hit, no SPC anomaly – purely ML-driven
            if score >= 0.85:
                finding_type = "CONFIRMED_ATTACK"
            elif score >= 0.65:
                finding_type = "BEHAVIOURAL_ANOMALY"
            else:
                finding_type = "NORMAL_BEHAVIOUR"

        return finding_type, score, fv

    # ------------------------------------------------------------------
    # Feature vector construction – strict FEATURE_ORDER
    # ------------------------------------------------------------------

    def _build_feature_vector(
        self,
        payload: Dict[str, Any],
        sigma_hits: List[SigmaHit],
        sigma_max_severity: int,
        spc_result: SPCResult,
        graph_result: GraphResult,
        temporal_result: TemporalResult,
        similarity_result: SimilarityResult,
        mitre_result: MITREResult,
        campaign_result: CampaignResult,
    ) -> List[float]:
        """Return 42-dim float list in FEATURE_ORDER."""

        # Group 1 – Triage passthrough (13)
        # Field mapping: TriageResult field → feature name
        #   combined_score   → base_score
        #   asset_multiplier → entity_risk
        #   ioc_match (0/1)  → ioc_boost  (scaled by ioc_confidence)
        #   template_rarity  → template_risk
        #   All other triage-passthrough features (temporal_boost, destination_risk,
        #   off_hours_boost, high_severity_count, medium_severity_count,
        #   distinct_categories, event_count, correlated_alert_count) are not
        #   present in TriageResult — defaulted to 0.0 so the vector dimension
        #   is preserved; enrichment can be added in a future sprint.
        ioc_boost = (
            float(payload.get("ioc_match", 0))
            * float(payload.get("ioc_confidence", 0))
            / 100.0
        )
        triage = [
            float(payload.get("adjusted_score", 0.0)),    # adjusted_score
            float(payload.get("combined_score", 0.0)),    # base_score
            float(payload.get("asset_multiplier", 1.0)),  # entity_risk
            ioc_boost,                                     # ioc_boost
            0.0,                                           # temporal_boost (N/A)
            0.0,                                           # destination_risk (N/A)
            0.0,                                           # off_hours_boost (N/A)
            0.0,                                           # high_severity_count (N/A)
            0.0,                                           # medium_severity_count (N/A)
            0.0,                                           # distinct_categories (N/A)
            0.0,                                           # event_count (N/A)
            0.0,                                           # correlated_alert_count (N/A)
            float(payload.get("template_rarity", 0.0)),   # template_risk
        ]

        # Group 2 – Graph (8)
        graph = [
            float(graph_result.unique_destinations),
            float(graph_result.unique_src_ips),
            float(graph_result.has_ioc_neighbor),
            float(graph_result.hop_count),
            float(graph_result.high_risk_neighbors),
            float(graph_result.escalation_count),
            float(graph_result.lateral_movement_score),
            float(graph_result.c2_candidate_score),
        ]

        # Group 3 – Temporal (4)
        temporal = [
            float(temporal_result.escalation_count),
            float(temporal_result.unique_categories),
            float(temporal_result.tactic_diversity),
            float(temporal_result.mean_score),
        ]

        # Group 4 – Similarity (7)
        sim = [
            float(similarity_result.attack_embed_dist),
            float(similarity_result.historical_dist),
            float(similarity_result.log_embed_matches),
            float(similarity_result.confirmed_neighbor_count),
            float(similarity_result.min_confirmed_dist),
            float(similarity_result.false_positive_count),
            float(similarity_result.label_confidence),
        ]

        # Group 5 – MITRE (2)
        mitre = [
            float(mitre_result.match_count),
            float(mitre_result.tactic_breadth),
        ]

        # Group 6 – Campaign (2)
        campaign = [
            float(campaign_result.host_count),
            float(campaign_result.tactic_count),
        ]

        # Group 7 – Sigma (2)
        sigma = [
            float(len(sigma_hits)),
            float(sigma_max_severity),
        ]

        # Group 8 – SPC (4)
        spc = [
            float(spc_result.max_z_score),
            float(spc_result.is_anomaly),
            float(spc_result.baseline_mean),
            float(spc_result.baseline_stddev),
        ]

        fv = triage + graph + temporal + sim + mitre + campaign + sigma + spc
        assert len(fv) == len(FEATURE_ORDER), (
            f"Feature vector length {len(fv)} != FEATURE_ORDER {len(FEATURE_ORDER)}"
        )
        return fv
