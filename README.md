# SERP X-Ray 🔍

A local web tool for competitive SERP analysis. It takes a search query → parses the top-20 results via SerpAPI → extracts Knowledge Graph entities from every page via OpenRouter (LLM) → compares them against your page → builds a gap graph → returns a prioritized action checklist.

## What it is

The tool helps SEO specialists quickly understand:

- Which entities (Person, Organization, Concept, Product, Event) appear in the top of the SERP
- Which of them are missing from your page
- How far your page lags in entity coverage
- What exactly to add (a prioritized checklist)

## Stack

| Layer    | Technology |
|----------|-----------|
| Backend  | Python 3.11+, FastAPI, httpx, Pydantic |
| LLM      | OpenRouter API (openai/gpt-4o, claude-sonnet-4, gemini-2.5-flash — swappable model) |
| Search   | SerpAPI (Google organic results, top-20) |
| Frontend | TypeScript, Next.js 14, shadcn/ui, D3.js |
| DB       | SQLite (query history, settings) |

## Run locally

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

> Auth: the backend **does not start** without `SERPXRAY_ADMIN_PASSWORD` (fail-fast)
> anymore. For local dev, either set it in `backend/.env`, or
> `SERPXRAY_AUTH_DISABLED=1` (development only). The frontend asks for the password
> on `/login` (the token lives in `sessionStorage`).

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

### 3. Open

- App: http://localhost:3000
- Swagger API: http://localhost:8000/docs (requires `X-Auth-Token`)

## Production (Docker)

The full stack — `docker-compose.yml` (backend + frontend + Caddy for HTTPS):

```bash
cp .env.example .env   # fill in keys + password + domain
docker compose up -d --build
```

- **HTTPS is mandatory**: Caddy issues a Let's Encrypt cert for `SERPXRAY_DOMAIN`
  automatically. Without HTTPS the password and token travel in cleartext — do not disable it.
- The backend port `8000` is **not published** externally — access is only through Next
  (`/api/*` is proxied via rewrites, a single origin).
- Data: SQLite in the `serp_data` volume (survives restarts and rebuilds).
  Back it up with a single command:
  ```bash
  docker compose exec backend sh -c 'cat /app/data/serp-xray.db' > serp-xray-$(date +%F).db
  ```
- Before upgrading the image — back up the DB (see above). The schema is applied
  idempotently on backend startup (`init_db()`); Alembic is not used.

### Known production-mode limitations

- **SSRF protection**: blocks private/loopback/link-local + cloud metadata IPs,
  DNS requests go to the verified IP (pinning), redirects are re-validated hop-by-hop.
  Full protection against DNS rebinding with a race inside the TCP handshake is **not**
  implemented (that needs a custom socket-level resolver) — a conscious compromise for
  a personal tool.
- **Rate limit** resets on container restart — this guards against bursts, not a
  targeted attacker (the primary defense is the password + HTTPS).
- A single uvicorn worker is intentional (SQLite + in-memory rate limit).

## API keys

The tool needs two keys (neither is bundled — you bring your own):

| Variable | What it is | Where to get it |
|----------|-----------|-----------------|
| `OPENROUTER_API_KEY` | LLM access (entity extraction + gap analysis) | [openrouter.ai/keys](https://openrouter.ai/keys) — create an API key |
| `SERPAPI_API_KEY` | Google/Yandex SERP results | [serpapi.com](https://serpapi.com/manage-api-key) — free tier: 100 searches/month |

**Local dev** — put them in `backend/.env` (or `~/.hermes/.env`):

```bash
cd backend
cat > .env <<'EOF'
OPENROUTER_API_KEY=sk-or-v1-...
SERPAPI_API_KEY=...
EOF
```

**Production (Docker)** — copy the template and fill it in:

```bash
cp .env.example .env
# edit .env: OPENROUTER_API_KEY, SERPAPI_API_KEY, SERPXRAY_ADMIN_PASSWORD, SERPXRAY_DOMAIN
docker compose up -d --build
```

Priority: environment → `backend/.env` → `~/.hermes/.env`.

## Features

- 🔍 Analyze any search query — top-20 organic results
- 🧠 Extract Knowledge Graph entities via LLM
- 📊 Entity graph visualization (D3.js force-directed graph)
- 🆚 Compare your page against the top-3 results
- 📋 Prioritized action checklist (critical → low)
- ⚙️ Admin panel: switch the OpenRouter model, edit prompts
- 📜 History of all analyses (SQLite)
