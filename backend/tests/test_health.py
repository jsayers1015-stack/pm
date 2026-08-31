def test_health_returns_ok(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_api_path_returns_json_404(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not found"}


def test_root_serves_static_index(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
