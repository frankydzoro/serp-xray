import os
from pathlib import Path
from dotenv import load_dotenv

# Порядок приоритета (override=False — уже установленные env НЕ перезаписываются):
#   1. переменные окружения (всегда побеждают, включая пустые в compose)
#   2. backend/.env (локальная разработка / docker env_file)
#   3. ~/.hermes/.env (легаси-путь с ключами для локального запуска)
_BACKEND_ENV = Path(__file__).resolve().parent / ".env"
if _BACKEND_ENV.exists():
    load_dotenv(_BACKEND_ENV, override=False)
load_dotenv(os.path.expanduser("~/.hermes/.env"), override=False)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# ── Авторизация ────────────────────────────
# Обязателен в проде: при отсутствии backend падает на старте (см. main.py).
# Единственный обход для локальной разработки — SERPXRAY_AUTH_DISABLED=1.
ADMIN_PASSWORD = os.getenv("SERPXRAY_ADMIN_PASSWORD", "")
AUTH_DISABLED = os.getenv("SERPXRAY_AUTH_DISABLED", "").lower() in ("1", "true", "yes")
AUTH_SESSION_TTL_DAYS = int(os.getenv("SERPXRAY_SESSION_TTL_DAYS", "30"))

# ── Прокси / rate limit ────────────────────
# =1 когда backend за Next-прокси (docker compose): IP берётся из X-Forwarded-For.
TRUST_PROXY = os.getenv("SERPXRAY_TRUST_PROXY", "").lower() in ("1", "true", "yes")

# ── CORS ───────────────────────────────────
# В проде с Next rewrites единый origin — CORS не участвует; список нужен
# только для прямого доступа к API в dev (localhost:3000):
#   SERPXRAY_CORS_ORIGINS=http://localhost:3000,https://example.com
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("SERPXRAY_CORS_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

# Значения по умолчанию (переопределяются через админку / БД)
DEFAULT_MODEL = "openai/gpt-4o"
DEFAULT_SERP_RESULTS = 20
# Максимальная длина текста страницы, подаваемого на LLM
MAX_PAGE_CHARS = 8000