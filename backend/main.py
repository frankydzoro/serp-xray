from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import analyzer, admin, history, models, rewrite
from auth import require_auth, router as auth_router
from config import ADMIN_PASSWORD, AUTH_DISABLED, CORS_ORIGINS
from db import init_db


app = FastAPI(
    title="SERP X-Ray",
    description="Competitive SERP analysis tool via OpenRouter + SerpAPI",
    version="0.1.0",
)

# CORS: в проде с Next rewrites единый origin — CORS не участвует. Список
# нужен для dev (localhost:3000 → localhost:8000) и прямого доступа к API.
# allow_credentials=False всегда: токен в заголовке, не в cookie.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Публичные роуты: login + health. Всё остальное — под require_auth.
app.include_router(auth_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {"service": "SERP X-Ray", "version": "0.1.0", "docs": "/docs"}


app.include_router(analyzer.router, dependencies=[Depends(require_auth)])
app.include_router(admin.router, dependencies=[Depends(require_auth)])
app.include_router(history.router, dependencies=[Depends(require_auth)])
app.include_router(models.router, dependencies=[Depends(require_auth)])
app.include_router(rewrite.router, dependencies=[Depends(require_auth)])


@app.on_event("startup")
async def startup():
    init_db()
    # Fail-fast: без пароля прод-режим не стартует. Обход — явный AUTH_DISABLED=1
    # для локальной разработки (в compose/проде не выставляется).
    if not ADMIN_PASSWORD and not AUTH_DISABLED:
        raise RuntimeError(
            "SERPXRAY_ADMIN_PASSWORD is not set. "
            "Set it in environment or backend/.env, "
            "or set SERPXRAY_AUTH_DISABLED=1 for local development only."
        )