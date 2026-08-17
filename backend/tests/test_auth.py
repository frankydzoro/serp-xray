"""Auth tests: session tokens, brute-force protection, per-token rate limit.

Run: cd backend && ./venv/bin/python3 -m pytest tests/test_auth.py -v
"""
import hashlib

import pytest

import db
import config


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ── Basic 401/200 ────────────────────────

def test_health_is_public(client):
    assert client.get("/health").status_code == 200


def test_api_requires_token(client):
    assert client.get("/api/history").status_code == 401


def test_api_rejects_invalid_token(client):
    resp = client.get("/api/history", headers={"X-Auth-Token": "wrong-token"})
    assert resp.status_code == 401


def test_valid_token_allows_access(client, auth_token):
    resp = client.get("/api/history", headers={"X-Auth-Token": auth_token})
    assert resp.status_code == 200
    assert "analyses" in resp.json() or isinstance(resp.json(), list)


def test_header_is_case_insensitive(client, auth_token):
    """HTTP headers are case-insensitive: x-auth-token works like X-Auth-Token."""
    resp = client.get("/api/history", headers={"x-auth-token": auth_token})
    assert resp.status_code == 200


def test_admin_routes_also_protected(client):
    assert client.get("/api/admin/model").status_code == 401
    assert client.get("/api/models").status_code == 401
    assert client.get("/api/analyze/whatever/status").status_code == 401


# ── Login ──────────────────────────────────

def test_login_wrong_password(client):
    resp = client.post("/api/login", json={"password": "nope"})
    assert resp.status_code == 401


def test_login_ok_returns_long_token(client):
    resp = client.post("/api/login", json={"password": "test-password"})
    assert resp.status_code == 200
    token = resp.json()["token"]
    assert len(token) >= 32


def test_login_bruteforce_lockout(client):
    """Global bucket: 5 failed attempts/min → lockout, even a correct password gets 429."""
    for _ in range(5):
        assert client.post("/api/login", json={"password": "wrong"}).status_code == 401
    # 6th attempt (with the correct password) — the lockout is active
    assert client.post("/api/login", json={"password": "test-password"}).status_code == 429


def test_expired_session_rejected(client, tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(db, "DB_DIR", str(tmp_path))
    db.init_db()
    db.create_session(
        token_hash=_sha("expired-token"),
        password_sha=_sha(config.ADMIN_PASSWORD),
        expires_at="2000-01-01T00:00:00+00:00",
    )
    resp = client.get("/api/history", headers={"X-Auth-Token": "expired-token"})
    assert resp.status_code == 401


def test_password_change_kills_all_sessions(client, auth_token, monkeypatch):
    """A password change in env (config.ADMIN_PASSWORD) invalidates old sessions via password_sha."""
    assert client.get("/api/history", headers={"X-Auth-Token": auth_token}).status_code == 200
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "new-password")
    assert client.get("/api/history", headers={"X-Auth-Token": auth_token}).status_code == 401


def test_login_cleanup_expired_sessions(client, auth_token, monkeypatch, tmp_path):
    """Cleanup on a successful login removes expired rows."""
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(db, "DB_DIR", str(tmp_path))
    db.init_db()
    db.create_session(_sha("stale"), _sha("x"), "2000-01-01T00:00:00+00:00")
    assert db.get_session(_sha("stale")) is not None

    resp = client.post("/api/login", json={"password": "test-password"})
    assert resp.status_code == 200
    assert db.get_session(_sha("stale")) is None  # expired removed
    assert db.get_session(_sha(resp.json()["token"])) is not None  # new created


# ── Rate limit /api/analyze per token ─────

@pytest.fixture()
def _mock_pipeline(monkeypatch):
    """Don't let the background pipeline hit SerpAPI/LLM (we only test the limit)."""
    import routers.analyzer as analyzer_mod

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(analyzer_mod, "_run_pipeline", noop)


def test_analyze_rate_limit_per_token(client, auth_token, _mock_pipeline):
    """10 starts/min per token; the 11th → 429."""
    headers = {"X-Auth-Token": auth_token}
    body = {"query": "test query", "engine": "google"}
    for _ in range(10):
        resp = client.post("/api/analyze", json=body, headers=headers)
        assert resp.status_code == 200, resp.text
    resp = client.post("/api/analyze", json=body, headers=headers)
    assert resp.status_code == 429


def test_analyze_rate_limit_is_per_token_not_per_ip(client, _mock_pipeline):
    """Two different tokens from one client — independent limits."""
    t1 = client.post("/api/login", json={"password": "test-password"}).json()["token"]
    t2 = client.post("/api/login", json={"password": "test-password"}).json()["token"]
    body = {"query": "test query", "engine": "google"}

    # Token 1: exhaust its limit
    for _ in range(10):
        assert client.post("/api/analyze", json=body, headers={"X-Auth-Token": t1}).status_code == 200
    assert client.post("/api/analyze", json=body, headers={"X-Auth-Token": t1}).status_code == 429

    # Token 2 (same IP/client) — its own limit, works
    assert client.post("/api/analyze", json=body, headers={"X-Auth-Token": t2}).status_code == 200