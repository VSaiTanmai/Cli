"""
LanceDB HTTP vector-search service.

Exposes POST /tables/{table}/search for the Hunter similarity_searcher.
Uses LanceDB embedded (no external DB process) with sentence-transformers
for text→embedding conversion.

Tables created on first boot (empty):
  - attack_embeddings      (confirmed attack patterns)
  - historical_incidents   (past investigated incidents)
  - log_embeddings         (per-host log context)
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

import lancedb
import numpy as np
import pyarrow as pa
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

log = logging.getLogger("lancedb-service")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DB_PATH = os.getenv("LANCEDB_PATH", "/data/lancedb")
MODEL_NAME = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")
EMBED_DIM = 384  # all-MiniLM-L6-v2 produces 384-dim vectors
PORT = int(os.getenv("PORT", "8100"))

# ---------------------------------------------------------------------------
# Table schemas (PyArrow)
# ---------------------------------------------------------------------------
_ATTACK_SCHEMA = pa.schema([
    pa.field("vector", pa.list_(pa.float32(), EMBED_DIM)),
    pa.field("text", pa.utf8()),
    pa.field("hostname", pa.utf8()),
    pa.field("source_ip", pa.utf8()),
    pa.field("tactic", pa.utf8()),
    pa.field("technique", pa.utf8()),
    pa.field("severity", pa.utf8()),
    pa.field("timestamp", pa.utf8()),
])

_HISTORICAL_SCHEMA = pa.schema([
    pa.field("vector", pa.list_(pa.float32(), EMBED_DIM)),
    pa.field("text", pa.utf8()),
    pa.field("hostname", pa.utf8()),
    pa.field("finding_type", pa.utf8()),
    pa.field("hunter_score", pa.float32()),
    pa.field("timestamp", pa.utf8()),
])

_LOG_SCHEMA = pa.schema([
    pa.field("vector", pa.list_(pa.float32(), EMBED_DIM)),
    pa.field("text", pa.utf8()),
    pa.field("hostname", pa.utf8()),
    pa.field("source_type", pa.utf8()),
    pa.field("level", pa.utf8()),
    pa.field("timestamp", pa.utf8()),
])

TABLES: Dict[str, pa.Schema] = {
    "attack_embeddings": _ATTACK_SCHEMA,
    "historical_incidents": _HISTORICAL_SCHEMA,
    "log_embeddings": _LOG_SCHEMA,
}

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
_db: Optional[lancedb.DBConnection] = None
_model: Optional[SentenceTransformer] = None


def _get_db() -> lancedb.DBConnection:
    global _db
    if _db is None:
        Path(DB_PATH).mkdir(parents=True, exist_ok=True)
        _db = lancedb.connect(DB_PATH)
    return _db


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        log.info("Loading embedding model %s ...", MODEL_NAME)
        _model = SentenceTransformer(MODEL_NAME)
        log.info("Embedding model loaded (dim=%d)", EMBED_DIM)
    return _model


def _ensure_tables() -> None:
    """Create empty tables if they don't exist."""
    db = _get_db()
    existing = set(db.table_names())
    for name, schema in TABLES.items():
        if name not in existing:
            db.create_table(name, schema=schema)
            log.info("Created table '%s'", name)


# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _get_model()          # pre-load model
    _ensure_tables()      # create empty tables
    log.info("LanceDB service ready on port %d", PORT)
    yield


app = FastAPI(title="LanceDB Vector Service", lifespan=lifespan)


class SearchRequest(BaseModel):
    query_text: str
    limit: int = 10
    filter: Optional[str] = None


class IngestRequest(BaseModel):
    text: str
    metadata: Dict[str, Any] = {}


@app.get("/health")
async def health():
    db = _get_db()
    tables = db.table_names()
    return {"status": "ok", "tables": tables}


@app.post("/tables/{table}/search")
async def search(table: str, req: SearchRequest):
    """Vector similarity search using text query."""
    db = _get_db()
    if table not in db.table_names():
        raise HTTPException(404, f"Table '{table}' not found")

    tbl = db.open_table(table)

    # If table is empty, return empty results
    if tbl.count_rows() == 0:
        return []

    model = _get_model()
    query_vec = model.encode(req.query_text).tolist()

    search_builder = tbl.search(query_vec).limit(req.limit)
    if req.filter:
        search_builder = search_builder.where(req.filter)

    results = search_builder.to_list()

    # Convert numpy types to Python native for JSON serialisation
    cleaned = []
    for row in results:
        clean = {}
        for k, v in row.items():
            if k == "vector":
                continue  # don't return embedding vectors
            if isinstance(v, (np.floating, np.integer)):
                clean[k] = float(v)
            else:
                clean[k] = v
        cleaned.append(clean)
    return cleaned


@app.post("/tables/{table}/ingest")
async def ingest(table: str, req: IngestRequest):
    """Add a single row with auto-generated embedding."""
    db = _get_db()
    if table not in db.table_names():
        raise HTTPException(404, f"Table '{table}' not found")

    model = _get_model()
    vec = model.encode(req.text).tolist()

    row = {"vector": vec, "text": req.text}
    row.update(req.metadata)

    tbl = db.open_table(table)
    tbl.add([row])
    return {"status": "ok", "table": table, "rows_after": tbl.count_rows()}


@app.post("/tables/{table}/ingest_batch")
async def ingest_batch(table: str, rows: List[IngestRequest]):
    """Add multiple rows with auto-generated embeddings."""
    db = _get_db()
    if table not in db.table_names():
        raise HTTPException(404, f"Table '{table}' not found")

    model = _get_model()
    texts = [r.text for r in rows]
    vecs = model.encode(texts).tolist()

    data = []
    for i, r in enumerate(rows):
        row = {"vector": vecs[i], "text": r.text}
        row.update(r.metadata)
        data.append(row)

    tbl = db.open_table(table)
    tbl.add(data)
    return {"status": "ok", "table": table, "added": len(data), "rows_after": tbl.count_rows()}
