"""CLIF AI Service - FastAPI REST API for ML Classification & Agent Orchestration
================================================================================
Exposes HTTP endpoints for ML classification and AI agent investigation pipeline.

Endpoints:
  POST /classify              - Classify a single event
  POST /classify/batch        - Classify multiple events
  POST /investigate           - Full 4-agent investigation pipeline
  POST /investigate/triage    - Quick triage only
  GET  /agents/status         - All agent statuses
  GET  /agents/investigations - Recent investigation history
  GET  /health                - Health check
  GET  /model/info            - Model metadata
  GET  /model/leaderboard     - Training leaderboard

Run:
  uvicorn ai_service:app --host 0.0.0.0 --port 8200 --workers 2
"""

import os
import sys
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Add parent dirs to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from inference.inference import CLIFClassifier, map_clif_event_to_features
from agents.orchestrator import Orchestrator
from agents.llm import get_llm_status, is_llm_available

# ── Models ──────────────────────────────────────────────────────────────────

class EventFeatures(BaseModel):
    """Raw NSL-KDD features for direct classification."""
    duration: float = 0
    protocol_type: str = "tcp"
    service: str = "other"
    flag: str = "SF"
    src_bytes: float = 0
    dst_bytes: float = 0
    land: int = 0
    wrong_fragment: int = 0
    urgent: int = 0
    hot: int = 0
    num_failed_logins: int = 0
    logged_in: int = 0
    num_compromised: int = 0
    root_shell: int = 0
    su_attempted: int = 0
    num_root: int = 0
    num_file_creations: int = 0
    num_shells: int = 0
    num_access_files: int = 0
    num_outbound_cmds: int = 0
    is_host_login: int = 0
    is_guest_login: int = 0
    count: int = 1
    srv_count: int = 1
    serror_rate: float = 0.0
    srv_serror_rate: float = 0.0
    rerror_rate: float = 0.0
    srv_rerror_rate: float = 0.0
    same_srv_rate: float = 0.0
    diff_srv_rate: float = 0.0
    srv_diff_host_rate: float = 0.0
    dst_host_count: int = 0
    dst_host_srv_count: int = 0
    dst_host_same_srv_rate: float = 0.0
    dst_host_diff_srv_rate: float = 0.0
    dst_host_same_src_port_rate: float = 0.0
    dst_host_srv_diff_host_rate: float = 0.0
    dst_host_serror_rate: float = 0.0
    dst_host_srv_serror_rate: float = 0.0
    dst_host_rerror_rate: float = 0.0
    dst_host_srv_rerror_rate: float = 0.0

class CLIFEvent(BaseModel):
    """CLIF pipeline event (from Redpanda/ClickHouse)."""
    source_ip: str = ""
    dest_ip: str = ""
    source_port: int = 0
    dest_port: int = 0
    protocol: str = "tcp"
    service: str = ""
    duration: float = 0
    bytes_sent: int = 0
    bytes_received: int = 0
    connection_flag: str = "SF"
    failed_logins: int = 0
    logged_in: bool = False
    num_compromised: int = 0
    root_shell: bool = False
    su_attempted: bool = False
    connection_count: int = 1
    srv_count: int = 1
    serror_rate: float = 0.0
    srv_serror_rate: float = 0.0
    rerror_rate: float = 0.0
    srv_rerror_rate: float = 0.0
    same_srv_rate: float = 0.0
    diff_srv_rate: float = 0.0
    srv_diff_host_rate: float = 0.0
    dst_host_count: int = 0
    dst_host_srv_count: int = 0
    dst_host_same_srv_rate: float = 0.0
    dst_host_diff_srv_rate: float = 0.0
    dst_host_same_src_port_rate: float = 0.0
    dst_host_srv_diff_host_rate: float = 0.0
    dst_host_serror_rate: float = 0.0
    dst_host_srv_serror_rate: float = 0.0
    dst_host_rerror_rate: float = 0.0
    dst_host_srv_rerror_rate: float = 0.0
    # Additional CLIF fields
    hot_indicators: int = 0
    wrong_fragment: int = 0
    urgent: int = 0
    num_root: int = 0
    num_file_creations: int = 0
    num_shells: int = 0
    num_access_files: int = 0
    num_outbound_cmds: int = 0
    is_host_login: bool = False
    is_guest_login: bool = False

class ClassifyResponse(BaseModel):
    is_attack: bool
    confidence: float
    category: str
    category_confidence: float
    clif_category: str
    severity: str
    explanation: str
    binary_probs: Optional[Dict[str, float]] = None
    multi_probs: Optional[Dict[str, float]] = None

class BatchClassifyRequest(BaseModel):
    events: List[EventFeatures]

class BatchCLIFRequest(BaseModel):
    events: List[CLIFEvent]

class GenericEvent(BaseModel):
    """
    Accepts ANY log event (Sysmon, Windows Security, auth, firewall, generic).
    All fields are optional — the Triage Agent auto-detects the log type.
    """
    model_config = {"extra": "allow"}

    # Common optional fields for auto-detection
    EventID: Optional[int] = None
    Channel: Optional[str] = None
    source: Optional[str] = None
    message: Optional[str] = None
    timestamp: Optional[str] = None
    hostname: Optional[str] = None
    ip_address: Optional[str] = None
    user_id: Optional[str] = None
    level: Optional[str] = None
    log_type: Optional[str] = None  # explicit hint: sysmon, auth, firewall, etc.

class BatchClassifyResponse(BaseModel):
    results: List[ClassifyResponse]
    count: int
    latency_ms: float

# ── App ─────────────────────────────────────────────────────────────────────

classifier: Optional[CLIFClassifier] = None
orchestrator: Optional[Orchestrator] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load ML model and initialise agent orchestrator on startup."""
    global classifier, orchestrator
    try:
        classifier = CLIFClassifier()
        print("[AI-Service] ML classifier loaded successfully")
    except Exception as e:
        print(f"[AI-Service] WARNING: Could not load ML classifier: {e}")
        classifier = None

    # Initialise orchestrator (shares the same classifier instance)
    try:
        ch_url = os.getenv("CLICKHOUSE_HTTP_URL", "http://localhost:8123")
        ch_user = os.getenv("CLICKHOUSE_USER", "clif_admin")
        ch_pass = os.getenv("CLICKHOUSE_PASSWORD", "Cl1f_Ch@ngeM3_2026!")
        ch_db = os.getenv("CLICKHOUSE_DB", "clif_logs")
        lance_url = os.getenv("LANCEDB_URL", "http://localhost:8100")
        ollama_model = os.getenv("OLLAMA_MODEL", None)
        ollama_url = os.getenv("OLLAMA_BASE_URL", None)

        orchestrator = Orchestrator(
            classifier=classifier,
            clickhouse_url=ch_url,
            clickhouse_user=ch_user,
            clickhouse_password=ch_pass,
            clickhouse_db=ch_db,
            lancedb_url=lance_url,
            ollama_model=ollama_model,
            ollama_base_url=ollama_url,
        )
        print("[AI-Service] Agent orchestrator initialised (4 agents + DSPy/Ollama LLM)")
    except Exception as e:
        print(f"[AI-Service] WARNING: Could not init orchestrator: {e}")
        orchestrator = None

    yield
    # Cleanup
    classifier = None
    orchestrator = None

app = FastAPI(
    title="CLIF AI Classification & Agent Service",
    description="Tier-2 ML classifier + 4-agent investigation pipeline for security analysis",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS for dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    llm = get_llm_status()
    return {
        "status": "healthy" if classifier else "degraded",
        "model_loaded": classifier is not None,
        "orchestrator_ready": orchestrator is not None,
        "agents": len(orchestrator.agents) if orchestrator else 0,
        "llm_available": llm.get("available", False),
        "llm_model": llm.get("model", ""),
        "service": "clif-ai-service",
    }


@app.get("/llm/status")
async def llm_status():
    """Return DSPy/Ollama LLM integration status."""
    return get_llm_status()


@app.get("/model/info")
async def model_info():
    """Return model metadata."""
    if not classifier:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return classifier.get_model_info()


@app.get("/model/leaderboard")
async def model_leaderboard():
    """Return training leaderboard."""
    lb_path = Path(__file__).resolve().parent / "models" / "leaderboard.json"
    if not lb_path.exists():
        raise HTTPException(status_code=404, detail="Leaderboard not found")
    with open(lb_path) as f:
        return json.load(f)


@app.post("/classify", response_model=ClassifyResponse)
async def classify_event(event: EventFeatures):
    """Classify a single event using NSL-KDD features."""
    if not classifier:
        raise HTTPException(status_code=503, detail="Model not loaded")

    result = classifier.classify(event.model_dump())
    return ClassifyResponse(**result)


@app.post("/classify/clif", response_model=ClassifyResponse)
async def classify_clif_event(event: CLIFEvent):
    """Classify a CLIF pipeline event (auto-maps to NSL-KDD features)."""
    if not classifier:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # Map CLIF event to NSL-KDD features
    features = map_clif_event_to_features(event.model_dump())
    result = classifier.classify(features)
    return ClassifyResponse(**result)


@app.post("/classify/batch", response_model=BatchClassifyResponse)
async def classify_batch(request: BatchClassifyRequest):
    """Classify a batch of events."""
    if not classifier:
        raise HTTPException(status_code=503, detail="Model not loaded")

    t0 = time.time()
    events = [e.model_dump() for e in request.events]
    results = classifier.classify_batch(events)
    latency = (time.time() - t0) * 1000

    return BatchClassifyResponse(
        results=[ClassifyResponse(**r) for r in results],
        count=len(results),
        latency_ms=round(latency, 2),
    )


@app.post("/classify/clif/batch", response_model=BatchClassifyResponse)
async def classify_clif_batch(request: BatchCLIFRequest):
    """Classify a batch of CLIF pipeline events."""
    if not classifier:
        raise HTTPException(status_code=503, detail="Model not loaded")

    t0 = time.time()
    features = [map_clif_event_to_features(e.model_dump()) for e in request.events]
    results = classifier.classify_batch(features)
    latency = (time.time() - t0) * 1000

    return BatchClassifyResponse(
        results=[ClassifyResponse(**r) for r in results],
        count=len(results),
        latency_ms=round(latency, 2),
    )


# ── Agent Endpoints ─────────────────────────────────────────────────────────

@app.post("/investigate")
async def investigate(event: EventFeatures):
    """Run the full 4-agent investigation pipeline (NSL-KDD features)."""
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not loaded")

    result = await orchestrator.investigate(event.model_dump(), source="api")
    return result


@app.post("/investigate/clif")
async def investigate_clif(event: CLIFEvent):
    """Run full investigation on a CLIF pipeline event."""
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not loaded")

    features = map_clif_event_to_features(event.model_dump())
    result = await orchestrator.investigate(features, source="clif")
    return result


@app.post("/investigate/generic")
async def investigate_generic(event: GenericEvent):
    """Run full investigation on ANY log type (auto-detects log type).

    Accepts Sysmon, Windows Security, auth (SSH/sudo/PAM),
    firewall, and generic/unknown log events.  The Triage Agent
    internally routes to the correct rule-based classifier.
    """
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not loaded")

    # Pass through all fields including extras
    event_dict = event.model_dump()
    # Also include any extra fields (pydantic v2 extra="allow")
    if hasattr(event, "model_extra") and event.model_extra:
        event_dict.update(event.model_extra)

    result = await orchestrator.investigate(event_dict, source="generic")
    return result


@app.post("/investigate/triage")
async def investigate_triage_only(event: EventFeatures):
    """Quick triage only — no deep investigation."""
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not loaded")

    result = await orchestrator.triage_only(event.model_dump())
    return result


@app.get("/agents/status")
async def agent_status():
    """Return the status of all AI agents."""
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not loaded")
    return {
        "agents": orchestrator.get_agent_statuses(),
        "total_agents": len(orchestrator.agents),
    }


@app.get("/agents/investigations")
async def recent_investigations(limit: int = 20):
    """Return recent investigation summaries."""
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not loaded")
    return {
        "investigations": orchestrator.get_recent_investigations(limit),
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_SERVICE_PORT", "8200"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
