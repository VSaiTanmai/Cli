"""
Shared fixtures for the CLIF production test suite.
"""
from __future__ import annotations

import os
import pytest
import clickhouse_connect
from confluent_kafka import Producer
from confluent_kafka.admin import AdminClient


# ── Connection parameters (match .env) ───────────────────────────────────────

CH_HOST = os.getenv("CH_HOST", "localhost")
CH_PORT_1 = int(os.getenv("CH_PORT_1", "8123"))
CH_PORT_2 = int(os.getenv("CH_PORT_2", "8124"))
CH_USER = os.getenv("CH_USER", "clif_admin")
CH_PASS = os.getenv("CH_PASS", "Cl1f_Ch@ngeM3_2026!")
CH_DB = os.getenv("CH_DB", "clif_logs")
BROKER = os.getenv("BROKER", "localhost:19092")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://localhost:9002")


@pytest.fixture(scope="session")
def ch1():
    """ClickHouse client for node 1."""
    client = clickhouse_connect.get_client(
        host=CH_HOST, port=CH_PORT_1,
        username=CH_USER, password=CH_PASS,
        database=CH_DB, connect_timeout=30,
    )
    yield client
    client.close()


@pytest.fixture(scope="session")
def ch2():
    """ClickHouse client for node 2."""
    client = clickhouse_connect.get_client(
        host=CH_HOST, port=CH_PORT_2,
        username=CH_USER, password=CH_PASS,
        database=CH_DB, connect_timeout=30,
    )
    yield client
    client.close()


@pytest.fixture(scope="session")
def ch_system():
    """ClickHouse client connected to the system database (node 1)."""
    client = clickhouse_connect.get_client(
        host=CH_HOST, port=CH_PORT_1,
        username=CH_USER, password=CH_PASS,
        database="system", connect_timeout=30,
    )
    yield client
    client.close()


@pytest.fixture(scope="session")
def kafka_producer():
    """High-throughput Kafka producer."""
    p = Producer({
        "bootstrap.servers": BROKER,
        "linger.ms": 5,
        "batch.num.messages": 10000,
        "queue.buffering.max.messages": 2_000_000,
        "queue.buffering.max.kbytes": 2_097_152,
        "compression.type": "zstd",
        "acks": "all",
        "enable.idempotence": True,
    })
    yield p
    p.flush(30)


@pytest.fixture(scope="session")
def kafka_admin():
    """Kafka AdminClient for cluster introspection."""
    return AdminClient({"bootstrap.servers": BROKER})
