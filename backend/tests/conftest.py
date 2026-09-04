import httpx2
import pytest
from fastapi.testclient import TestClient

from app import ai, config
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


@pytest.fixture
def openrouter(monkeypatch):
    """Swap OpenRouter for a fake transport.

    Call the returned function with a handler taking a request and returning a
    response. It returns a dict that will hold the request under "request", so
    tests can assert on what was actually sent.
    """
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "test-key")
    captured: dict = {}

    def install(handler):
        def record(request: httpx2.Request) -> httpx2.Response:
            captured["request"] = request
            return handler(request)

        transport = httpx2.MockTransport(record)
        monkeypatch.setattr(
            ai,
            "AsyncClient",
            lambda **kwargs: httpx2.AsyncClient(transport=transport, **kwargs),
        )
        return captured

    return install
