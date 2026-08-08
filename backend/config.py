import os
from dotenv import load_dotenv

load_dotenv(os.path.expanduser("~/.hermes/.env"))

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Значения по умолчанию (переопределяются через админку / БД)
DEFAULT_MODEL = "openai/gpt-4o"
DEFAULT_SERP_RESULTS = 20
# Максимальная длина текста страницы, подаваемого на LLM
MAX_PAGE_CHARS = 8000