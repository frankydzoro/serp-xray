"""Pytest-конфигурация: изолированная БД + тестовый пароль.

ВАЖНО: env задаётся ДО импорта config/main — значений хватает на всю сессию.
DB_PATH подменяется на tmp_path в фикстуре client — продакшн-БД не трогается.
"""
import os

# Тестовый пароль: auth включена и полноценно тестируется
os.environ["SERPXRAY_ADMIN_PASSWORD"] = "test-password"
# Явно НЕ выставляем SERPXRAY_AUTH_DISABLED — авторизация активна
os.environ.setdefault("SERPXRAY_TRUST_PROXY", "0")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_auth_state():
    """Сбрасывает глобальные счётчики rate limit между тестами."""
    import auth

    auth._login_fail_ts.clear()
    auth._login_lockout_until = 0.0
    auth._analyze_hits.clear()
    yield


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """TestClient с изолированной БД (tmp_path) и поднятым startup."""
    import db

    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(db, "DB_DIR", str(tmp_path))

    from main import app
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_token(client):
    """Логинится тестовым паролем и возвращает токен."""
    resp = client.post("/api/login", json={"password": "test-password"})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]