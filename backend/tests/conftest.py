import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A client backed by a fresh database. Entering the TestClient context runs
    the lifespan, which creates the schema and seeds the default user."""
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "pm.db")
    monkeypatch.setattr(config, "SECRET_KEY", "test-secret-key")
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def signed_in(client):
    client.post("/api/login", json={"username": "user", "password": "password"})
    return client
