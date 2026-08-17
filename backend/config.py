import os
from pathlib import Path
from dotenv import load_dotenv

# Priority order (override=False — already-set env vars are NOT overwritten):
#   1. environment variables (always win, including empty ones in compose)
#   2. backend/.env (local development / docker env_file)
#   3. ~/.hermes/.env (legacy path with keys for local runs)
_BACKEND_ENV = Path(__file__).resolve().parent / ".env"
if _BACKEND_ENV.exists():
    load_dotenv(_BACKEND_ENV, override=False)
load_dotenv(os.path.expanduser("~/.hermes/.env"), override=False)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# ── Auth ───────────────────────────────────
# Required in prod: without it the backend fails on startup (see main.py).
# The only escape hatch for local development is SERPXRAY_AUTH_DISABLED=1.
ADMIN_PASSWORD = os.getenv("SERPXRAY_ADMIN_PASSWORD", "")
AUTH_DISABLED = os.getenv("SERPXRAY_AUTH_DISABLED", "").lower() in ("1", "true", "yes")
AUTH_SESSION_TTL_DAYS = int(os.getenv("SERPXRAY_SESSION_TTL_DAYS", "30"))

# ── Proxy / rate limit ─────────────────────
# =1 when the backend sits behind the Next proxy (docker compose): the real
# client IP is read from X-Forwarded-For.
TRUST_PROXY = os.getenv("SERPXRAY_TRUST_PROXY", "").lower() in ("1", "true", "yes")

# ── CORS ───────────────────────────────────
# In prod with Next rewrites there is a single origin — CORS is not involved;
# the list is needed only for direct API access in dev (localhost:3000):
#   SERPXRAY_CORS_ORIGINS=http://localhost:3000,https://example.com
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("SERPXRAY_CORS_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

# Default values (overridable via admin / DB)
DEFAULT_MODEL = "openai/gpt-4o"
DEFAULT_SERP_RESULTS = 20
# Max page text length fed to the LLM
MAX_PAGE_CHARS = 8000
