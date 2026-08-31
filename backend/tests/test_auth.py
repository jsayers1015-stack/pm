from app import config, db
from app.auth import COOKIE_NAME


def test_login_with_correct_credentials_sets_cookie(client):
    response = client.post(
        "/api/login", json={"username": "user", "password": "password"}
    )
    assert response.status_code == 200
    assert response.json() == {"username": "user"}
    assert COOKIE_NAME in response.cookies


def test_login_cookie_is_http_only(client):
    response = client.post(
        "/api/login", json={"username": "user", "password": "password"}
    )
    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie


def test_login_with_wrong_password_returns_401(client):
    response = client.post("/api/login", json={"username": "user", "password": "nope"})
    assert response.status_code == 401
    assert COOKIE_NAME not in response.cookies


def test_login_with_unknown_user_returns_401(client):
    response = client.post(
        "/api/login", json={"username": "ghost", "password": "password"}
    )
    assert response.status_code == 401
    assert COOKIE_NAME not in response.cookies


def test_login_with_malformed_body_returns_422(client):
    response = client.post("/api/login", json={"username": "user"})
    assert response.status_code == 422


def test_me_without_cookie_returns_401(client):
    assert client.get("/api/me").status_code == 401


def test_me_after_login_returns_username(client):
    client.post("/api/login", json={"username": "user", "password": "password"})
    response = client.get("/api/me")
    assert response.status_code == 200
    assert response.json() == {"username": "user"}


def test_me_with_tampered_cookie_returns_401(client):
    client.post("/api/login", json={"username": "user", "password": "password"})
    client.cookies.set(COOKIE_NAME, "not-a-valid-signed-token")
    assert client.get("/api/me").status_code == 401


def test_me_with_cookie_signed_by_another_key_returns_401(client, monkeypatch):
    client.post("/api/login", json={"username": "user", "password": "password"})
    # Same payload, different signing key: the signature must be rejected.
    monkeypatch.setattr(config, "SECRET_KEY", "a-different-key")
    assert client.get("/api/me").status_code == 401


def test_logout_clears_the_session(client):
    client.post("/api/login", json={"username": "user", "password": "password"})
    assert client.get("/api/me").status_code == 200

    response = client.post("/api/logout")
    assert response.status_code == 200
    assert client.get("/api/me").status_code == 401


def test_password_is_not_stored_in_plain_text(client):
    user = db.get_user("user")
    assert user is not None
    assert "password" not in user["password_hash"]
    assert db.verify_password("password", user["password_hash"])
    assert not db.verify_password("wrong", user["password_hash"])


def test_schema_init_is_idempotent(client):
    db.init_db()
    db.init_db()
    with db.connect() as conn:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    assert count == 1


def test_secret_key_is_generated_and_persisted(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "pm.db")
    monkeypatch.setattr(config, "SECRET_KEY", "")

    first = config.secret_key()
    assert first
    assert (tmp_path / "secret_key").exists()
    # A second call must reuse the stored key, or sessions would break on restart.
    assert config.secret_key() == first
