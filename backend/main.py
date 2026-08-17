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

# CORS: in prod with Next rewrites there is a single origin — CORS is not
# involved. The list is needed for dev (localhost:3000 → localhost:8000) and
# direct API access. allow_credentials=False always: the token travels in a
# header, not a cookie.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public routes: login + health. Everything else — behind require_auth.
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
    # Fail-fast: without a password prod mode does not start. The escape hatch
    # is the explicit AUTH_DISABLED=1 for local development (never set in
    # compose/prod).
    if not ADMIN_PASSWORD and not AUTH_DISABLED:
        raise RuntimeError(
            "SERPXRAY_ADMIN_PASSWORD is not set. "
            "Set it in environment or backend/.env, "
            "or set SERPXRAY_AUTH_DISABLED=1 for local development only."
        )
