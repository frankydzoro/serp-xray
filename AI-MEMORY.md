# AI Memory — SERP X-Ray

> For any AI agent working on this project. Load this file first.
> Last updated: 2026-08-08

## Project

SERP X-Ray — local web tool for competitive SERP entity analysis.  
Takes a search query → fetches top-20 via SerpAPI (Google/Yandex/both) → extracts Knowledge Graph entities via OpenRouter LLM → compares against user's page → builds gap graph + prioritized checklist.

**Path:** `~/serp-xray/`  
**Git:** branch `feat/background-pipeline-status`, 4 commits on main + 1 on feature branch  
**Owner:** Petr Grishechkin, SEO specialist, Russian-speaking, prefers English UI  
**No remote configured** — `git remote` is empty.

## Architecture

```
localhost:3000 → Next.js 16 (shadcn/ui, D3.js)
localhost:8000 → FastAPI (Python 3.11, uvicorn)
```

Backend talks to:
- SerpAPI (Google + Yandex organic results)
- OpenRouter (LLM: entity extraction + gap analysis)
- SQLite (history, settings, entity cache)

## Pipeline (Background Task)

Analysis runs as a FastAPI `BackgroundTasks` with 5 stages:

1. **searching** — SerpAPI fetch top-20
2. **fetching** — fetch page text (10–20 pages)
3. **extracting** — LLM entity extraction per page (with semaphore=5)
4. **analyzing** — gap analysis (quick-gaps or LLM)
5. **building** — assemble report

Each stage updates `stage` column in DB. Frontend polls `GET /api/analyze/{id}/status` every 2s.  
Auto-timeout: stuck analyses (10+ min) auto-marked as `failed`.

## Directory Layout

```
~/serp-xray/
├── backend/
│   ├── main.py              # FastAPI entry, CORS, startup (calls init_db)
│   ├── config.py            # OpenRouter/SerpAPI keys, defaults
│   ├── db.py                # SQLite: all CRUD + migrations
│   ├── routers/
│   │   ├── analyzer.py      # POST /api/analyze (background pipeline) + GET /status
│   │   ├── admin.py         # Model & prompts CRUD
│   │   └── history.py       # History list, detail, delete, bulk-delete
│   ├── services/
│   │   ├── serp.py          # SerpAPI: fetch_top20(engine), fetch_page_text()
│   │   ├── entity_extractor.py  # OpenRouter LLM → entities + post-process
│   │   └── gap_analyzer.py  # Gap detection: quick-gaps + LLM fallback
│   ├── models/schemas.py    # Pydantic: AnalyzeRequest, GapItem, AnalysisReport, AnalyzeStatus
│   ├── prompts/default.py   # Default prompts (fallback, overridden via DB)
│   ├── tests/
│   │   ├── test_prompts.py  # 28 systematic prompt tests
│   │   └── prompt-findings.md # Remediation plan (all items completed)
│   └── venv/                # Python 3.11.15
├── frontend/
│   ├── app/                 # Next.js App Router
│   │   ├── layout.tsx       # Root layout with AppNav
│   │   ├── page.tsx         # Main: QueryForm + tabs (overview/graph/gaps/checklist) + polling
│   │   ├── admin/page.tsx   # Model selector + prompt editors
│   │   ├── history/page.tsx # Card grid with Running/Failed/Completed badges, bulk ops
│   │   └── report/[id]/page.tsx  # Report detail + PDF/MD download
│   ├── components/
│   │   ├── QueryForm.tsx    # Query input + engine selector + URL field
│   │   ├── EntityGraph.tsx  # D3.js force-directed entity graph
│   │   ├── GapTable.tsx     # Gaps table with priority badges + URL links
│   │   ├── Checklist.tsx    # Numbered checklist
│   │   ├── ReportSkeleton.tsx  # Animated 5-stage progress loader
│   │   ├── AdminPrompts.tsx # Model select + prompt textareas
│   │   ├── AppNav.tsx       # Top navigation bar (Home, History, Admin)
│   │   └── Modal.tsx        # Reusable modal dialog
│   ├── lib/
│   │   ├── api.ts           # Fetch wrappers for all backend endpoints (with error details)
│   │   └── export.ts        # downloadMarkdown() + downloadPDF() (jsPDF + Roboto font)
│   └── package.json         # Next.js 16, shadcn/ui, d3, jspdf
└── data/serp-xray.db        # SQLite (created on first run, gitignored)
```

## DB Schema

```sql
CREATE TABLE analyses (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    url TEXT,
    result_json TEXT NOT NULL DEFAULT '{}',
    model_used TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    stage TEXT NOT NULL DEFAULT 'searching',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE entities_cache (
    url TEXT PRIMARY KEY,
    entities_json TEXT NOT NULL,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Status values
- `running` — pipeline in progress (stage tracks sub-step)
- `completed` — finished successfully
- `failed` — error or timeout

### Stage values
- `searching` → `fetching` → `extracting` → `analyzing` → `building` → `done`
- `error` — terminal failure

### DB Functions
- `create_running_analysis(id, query, model, url)` — inserts with status=running
- `update_analysis_status(id, stage)` — updates stage only
- `complete_analysis(id, result)` — saves result, sets status=completed
- `fail_analysis(id, error)` — sets status=failed, stage=error
- `get_analysis_status(id)` — returns status/stage, auto-timeouts after 10min
- `save_analysis(id, query, result, model, url)` — legacy compat, delegates to complete_analysis

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/analyze | Start analysis (returns ID immediately, pipeline runs in background) |
| GET | /api/analyze/{id}/status | Poll status + stage + result (when completed) |
| GET | /api/history | List analyses (last 50), includes status+stage+entities_found+gaps_count |
| GET | /api/history/{id} | Full report with result_json |
| DELETE | /api/history/{id} | Delete single |
| POST | /api/history/bulk-delete | `{ids: [...]}` |
| GET | /api/admin/model | Current model |
| PUT | /api/admin/model | `{model: "..."}` |
| GET | /api/admin/prompts | Current prompts |
| PUT | /api/admin/prompts | `{entity_prompt, gap_prompt}` |
| POST | /api/admin/prompts/reset | Restore defaults |

## Key Architecture Decisions

1. **No migrations framework.** `init_db()` creates tables IF NOT EXISTS + ALTER TABLE migrations with try/except.
2. **Python 3.11 required** — `str | None` syntax. Venv uses `/Users/petergrish/.hermes/hermes-agent/venv/bin/python3.11`.
3. **Uvicorn must run via `python -m uvicorn`**, not bare `uvicorn` — global uvicorn conflicts with venv.
4. **Prompts are DB-driven.** `default.py` is fallback. Admin edits → `settings` table. Reset restores from `default.py`.
5. **English-only UI.** All visible text in English. Backend prompts in Russian (user's choice — content is Russian).
6. **No emojis.**
7. **Two gap-analysis modes:**
   - **Quick-gaps** (no user URL): all competitor entities → gaps, priority by `frequency`
   - **LLM** (with user URL): semantic gap analysis via OpenRouter
8. **Background pipeline with polling** — analysis runs as BackgroundTasks, frontend polls `/status` every 2s.
9. **Auto-timeout** — stuck analyses (running >10min) auto-fail in `get_analysis_status()`.

## Prompt Design (Critical)

### Entity Extraction
- Fields: name, type, confidence, **description** (1-2 sentences on how entity is presented in text, Russian)
- Types: Person, Organization, Concept, Product, Event, Location, Metric
- Product > Organization (Salesforce=Org, Sales Cloud=Product)
- Metric > Concept (if numeric value present)
- Maximum 15 entities, sorted by confidence descending
- Post-processing: truncate to 15 + stop-words filter

### Gap Analysis
- Direction: ALL top-10 competitors → user ONLY
- Uses entity descriptions for semantic matching
- `frequency` field: entity appears on N competitor pages → critical if ≥2
- Placeholders: `{user_entities}`, `{competitor_entities}`, `{query}`
- Max 10 gaps, sorted by priority

## SerpAPI Notes

- Google: `engine=google`, parameter `q`
- Yandex: `engine=yandex`, parameter `text` (NOT `q`!)
- Both: parallel fetch → deduplicate by URL → merge
- Free tier: 100 req/month. Key in `~/.hermes/.env` as `SERPAPI_API_KEY`.

## How to Run

```bash
# Backend
cd ~/serp-xray/backend
source venv/bin/activate
python -m uvicorn main:app --port 8000

# Frontend
cd ~/serp-xray/frontend
npm run dev
```

Open http://localhost:3000 (app) or http://localhost:8000/docs (Swagger).

## How to Test Prompts

```bash
cd ~/serp-xray/backend
source venv/bin/activate
python -m tests.test_prompts
```

## Pitfalls & Gotchas

1. **Yandex uses `text` not `q`** — 400 Bad Request otherwise.
2. **`.format()` doubles braces** — `{{"entities": [...]}}` in prompt strings, `{page_text}` as placeholder.
3. **No `--reload` with uvicorn background** — reloader changes cwd to `/tmp`, breaks imports.
4. **`str | None` needs Python 3.10+** — venv must use python3.11.
5. **Entity limit was 16 despite prompt** — fixed with post-process truncate in `entity_extractor.py`.
6. **Critical priority broke after entity grouping** — `frequency` field replaces name counting.
7. **DB `created_at` is NAIVE (no timezone)** — `get_analysis_status()` must call `.replace(tzinfo=timezone.utc)` before subtracting from `datetime.now(timezone.utc)`. Otherwise: `TypeError: can't subtract offset-naive and offset-aware datetimes`.
8. **`result_json` must be in INSERT** — column has `NOT NULL`, include `'{}'` explicitly in `create_running_analysis()`.
9. **DB migration via `SELECT *` is dangerous** — column order may differ between old and new schema. Use explicit column lists.
10. **SQLite gets `database is locked`** if CLI and backend access DB simultaneously. Kill backend before running `sqlite3` CLI directly.

## OpenRouter

- API key: `~/.hermes/.env` as `OPENROUTER_API_KEY`
- Base URL: `https://openrouter.ai/api/v1`
- Model set in DB `settings`, default `deepseek/deepseek-v4-pro`
- Available: `openai/gpt-4o`, `anthropic/claude-sonnet-4`, `google/gemini-2.5-flash`, `deepseek/deepseek-v4-pro`
- Tests use `openai/gpt-4o-mini` (cheap)
- SDK: `openai` Python client with `base_url` override