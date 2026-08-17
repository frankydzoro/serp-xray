"""Pytest configuration: isolated DB + test password.

IMPORTANT: env is set BEFORE importing config/main — the values last for the whole session.
DB_PATH is swapped to tmp_path in the client fixture — the production DB is not touched.
"""
import os

# Test password: auth is enabled and fully tested
os.environ["SERPXRAY_ADMIN_PASSWORD"] = "test-password"
# Explicitly do NOT set SERPXRAY_AUTH_DISABLED — auth stays active
os.environ.setdefault("SERPXRAY_TRUST_PROXY", "0")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_auth_state():
    """Resets the global rate-limit counters between tests."""
    import auth

    auth._login_fail_ts.clear()
    auth._login_lockout_until = 0.0
    auth._analyze_hits.clear()
    yield


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """TestClient with an isolated DB (tmp_path) and the startup hook raised."""
    import db

    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(db, "DB_DIR", str(tmp_path))

    from main import app
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_token(client):
    """Logs in with the test password and returns the token."""
    resp = client.post("/api/login", json={"password": "test-password"})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]
