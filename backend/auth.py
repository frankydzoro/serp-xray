"""Авторизация SERP X-Ray для не-локального запуска.

Схема: сессионные токены.
  POST /api/login {password} → проверка через secrets.compare_digest →
  токен = secrets.token_urlsafe(32) → в БД хранится ТОЛЬКО sha256(токена) →
  дальше каждый запрос к /api/* несёт X-Auth-Token.

Смена пароля (env SERPXRAY_ADMIN_PASSWORD + restart) мгновенно инвалидирует
все сессии: password_sha сверяется при каждом запросе.

Защита от брутфорса:
  - /api/login — ГЛОБАЛЬНЫЙ бакет (не per-IP: за прокси все запросы с одного
    внутреннего IP, per-IP лимит бессмыслен). Макс 5 неудачных попыток/мин,
    при превышении — блокировка на 5 минут.
  - /api/analyze — лимит ПО ТОКЕНУ сессии (10/мин), не по IP.
"""
import asyncio
import hashlib
import secrets
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

import config
from db import create_session, delete_expired_sessions, get_session, touch_session

router = APIRouter(prefix="/api", tags=["auth"])

# ── Тюнинг ────────────────────────────────
LOGIN_MAX_FAILS_PER_MIN = 5
LOGIN_LOCKOUT_SECONDS = 300
ANALYZE_MAX_PER_MIN = 10


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expires_iso() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=config.AUTH_SESSION_TTL_DAYS)).isoformat()


# ── Login: глобальный бакет ───────────────
_login_fail_ts: deque = deque()
_login_lockout_until = 0.0
_login_lock = asyncio.Lock()


async def _register_login_failure() -> None:
    global _login_lockout_until
    async with _login_lock:
        now = time.time()
        while _login_fail_ts and now - _login_fail_ts[0] > 60:
            _login_fail_ts.popleft()
        _login_fail_ts.append(now)
        if len(_login_fail_ts) >= LOGIN_MAX_FAILS_PER_MIN:
            _login_lockout_until = now + LOGIN_LOCKOUT_SECONDS


def _login_blocked() -> bool:
    return time.time() < _login_lockout_until


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
async def login(req: LoginRequest):
    """Проверяет пароль и выдаёт сессионный токен (сам пароль больше нигде не ходит)."""
    if _login_blocked():
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Try again later.",
        )

    # AUTH_DISABLED — локальная разработка без пароля
    if config.AUTH_DISABLED:
        return {"token": "", "disabled": True}

    if not config.ADMIN_PASSWORD or not secrets.compare_digest(
        req.password.encode("utf-8"), config.ADMIN_PASSWORD.encode("utf-8")
    ):
        await _register_login_failure()
        raise HTTPException(status_code=401, detail="Invalid password")

    # Успех: чистим истёкшие сессии (без отдельного cron — таблица не разрастается)
    delete_expired_sessions()

    token = secrets.token_urlsafe(32)
    create_session(
        token_hash=_sha256_hex(token),
        password_sha=_sha256_hex(config.ADMIN_PASSWORD),
        expires_at=_expires_iso(),
    )
    return {"token": token}


# ── Dependency: защита всех /api/* ────────
async def require_auth(x_auth_token: Optional[str] = Header(default=None, alias="X-Auth-Token")) -> str:
    """FastAPI-dependency. Возвращает token_hash (ключ для rate limit по токену).

    HTTP-заголовки регистронезависимы: и X-Auth-Token, и x-auth-token работают.
    Все ошибки возвращают одинаковый 401 — детали не раскрываются.
    """
    if config.AUTH_DISABLED:
        return "auth-disabled"

    token = (x_auth_token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    token_hash = _sha256_hex(token)
    session = get_session(token_hash)
    if not session:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Срок действия
    if session["expires_at"] < _now_iso():
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Смена пароля в env инвалидирует все старые сессии
    if not secrets.compare_digest(
        session["password_sha"].encode("utf-8"),
        _sha256_hex(config.ADMIN_PASSWORD).encode("utf-8"),
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Sliding-продление
    touch_session(token_hash, _expires_iso())
    return token_hash


# ── Rate limit: /api/analyze по токену ────
_analyze_hits: dict = {}
_analyze_lock = asyncio.Lock()


async def rate_limit_analyze(token_hash: str = Depends(require_auth)) -> str:
    """Лимит запусков анализа: 10/мин на сессионный токен (не на IP — за прокси
    IP всегда один и тот же). Возвращает token_hash для дальнейшего использования."""
    if config.AUTH_DISABLED:
        return token_hash

    now = time.time()
    async with _analyze_lock:
        q = _analyze_hits.setdefault(token_hash, deque())
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= ANALYZE_MAX_PER_MIN:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded: max {ANALYZE_MAX_PER_MIN} analyses per minute",
            )
        q.append(now)
    return token_hash