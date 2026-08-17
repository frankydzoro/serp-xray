"""SERP X-Ray auth for non-local deployment.

Scheme: session tokens.
  POST /api/login {password} → checked via secrets.compare_digest →
  token = secrets.token_urlsafe(32) → only sha256(token) is stored in the DB →
  every subsequent /api/* request carries X-Auth-Token.

Changing the password (env SERPXRAY_ADMIN_PASSWORD + restart) instantly
invalidates all sessions: password_sha is checked on every request.

Brute-force protection:
  - /api/login — a GLOBAL bucket (not per-IP: behind a proxy all requests come
    from one internal IP, a per-IP limit is meaningless). Max 5 failed
    attempts/min, beyond that — a 5-minute lockout.
  - /api/analyze — limited per session TOKEN (10/min), not per IP.
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

# ── Tuning ────────────────────────────────
LOGIN_MAX_FAILS_PER_MIN = 5
LOGIN_LOCKOUT_SECONDS = 300
ANALYZE_MAX_PER_MIN = 10


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expires_iso() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=config.AUTH_SESSION_TTL_DAYS)).isoformat()


# ── Login: global bucket ───────────────────
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
    """Checks the password and issues a session token (the password itself never travels again)."""
    if _login_blocked():
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Try again later.",
        )

    # AUTH_DISABLED — local development without a password
    if config.AUTH_DISABLED:
        return {"token": "", "disabled": True}

    if not config.ADMIN_PASSWORD or not secrets.compare_digest(
        req.password.encode("utf-8"), config.ADMIN_PASSWORD.encode("utf-8")
    ):
        await _register_login_failure()
        raise HTTPException(status_code=401, detail="Invalid password")

    # Success: clean up expired sessions (no separate cron — the table stays small)
    delete_expired_sessions()

    token = secrets.token_urlsafe(32)
    create_session(
        token_hash=_sha256_hex(token),
        password_sha=_sha256_hex(config.ADMIN_PASSWORD),
        expires_at=_expires_iso(),
    )
    return {"token": token}


# ── Dependency: protects all /api/* ────────
async def require_auth(x_auth_token: Optional[str] = Header(default=None, alias="X-Auth-Token")) -> str:
    """FastAPI dependency. Returns token_hash (the key for per-token rate limiting).

    HTTP headers are case-insensitive: both X-Auth-Token and x-auth-token work.
    All failures return the same 401 — details are not disclosed.
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

    # Expiry
    if session["expires_at"] < _now_iso():
        raise HTTPException(status_code=401, detail="Unauthorized")

    # A password change in env invalidates all old sessions
    if not secrets.compare_digest(
        session["password_sha"].encode("utf-8"),
        _sha256_hex(config.ADMIN_PASSWORD).encode("utf-8"),
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Sliding renewal
    touch_session(token_hash, _expires_iso())
    return token_hash


# ── Rate limit: /api/analyze per token ─────
_analyze_hits: dict = {}
_analyze_lock = asyncio.Lock()


async def rate_limit_analyze(token_hash: str = Depends(require_auth)) -> str:
    """Limit on analysis starts: 10/min per session token (not per IP — behind a
    proxy the IP is always the same). Returns token_hash for further use."""
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
