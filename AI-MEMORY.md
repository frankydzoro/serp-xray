# AI Memory — SERP X-Ray

> For any AI agent working on this project. Load this file first.
> Last updated: 2026-08-08 (API + фронтенд architecture refresh)

## Project

SERP X-Ray — local web tool for competitive SERP entity analysis.  
Takes a search query → fetches top-20 via SerpAPI (Google/Yandex/both) → extracts Knowledge Graph entities via OpenRouter LLM → compares against user's page → builds gap graph + prioritized checklist.

**Path:** `~/serp-xray/`  
**Git:** branch `feat/openrouter-model-search`, 5 modified files, 3 commits ahead of main
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

1. **searching** — SerpAPI fetch top-20 (Google/Yandex/both)
2. **fetching** — fetch page text (10 pages per engine, 20 total for 'both')
3. **extracting** — LLM entity extraction per page (with semaphore=5, timeout=30s per call, 24h entity cache, stop-words filter, top-15 cap)
4. **analyzing** — gap analysis (quick-gaps or LLM, timeout=30s)
5. **building** — assemble report including Wave 1 Knowledge Graph fields: all_competitor_entities, user_entities, cooccurrence_matrix (pairwise «entity1|entity2» → count), competitor_entity_frequencies, typed_edges (co_occurrence / parent_child detection via description matching)

Each stage updates `stage` column in DB. Frontend polls `GET /api/analyze/{id}/status` every 2s.  
Auto-timeout: stuck analyses (20+ min) auto-marked as `failed`.  
**Logging**: each stage logged with `logger.info()` including analysis_id and key metrics.

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
│   │   ├── history.py       # History list, detail, delete, bulk-delete
│   │   └── models.py        # GET /api/models — OpenRouter proxy with cache + filtering
│   ├── services/
│   │   ├── serp.py          # SerpAPI: fetch_top20(engine), fetch_page_text()
│   │   ├── entity_extractor.py  # OpenRouter LLM → entities (semaphore=5, 24h cache, stop-words, top-15)
│   │   └── gap_analyzer.py  # Gap detection: quick-gaps (no URL) + LLM fallback, description enrichment
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
│   │   ├── EntityGraph.tsx  # D3.js force-directed graph: nodes (user/competitor/gap owners), edges (co_occurrence/parent_child types), frequency-weighted sizing, type+owner color coding, entity type filter dropdown
│   │   ├── GapCard.tsx      # Content gap cards (priority badges, descriptions, URL links)
│   │   ├── GapTable.tsx     # Legacy gap table (deprecated, replaced by GapCard)
│   │   ├── Checklist.tsx    # Numbered checklist
│   │   ├── ReportSkeleton.tsx  # Animated 5-stage progress loader
│   │   ├── AdminPrompts.tsx # Model search (live OpenRouter API) + prompt editor
│   │   ├── AppNav.tsx       # Top navigation bar (Home, History, Admin)
│   │   └── Modal.tsx        # Reusable modal dialog
│   ├── lib/
│   │   ├── api.ts           # Functions: analyzeQuery, getAnalysisStatus, getHistory, getReport, getModel/updateModel, getPrompts/updatePrompts/resetPrompts, fetchModels (with ModelInfo type)
│   │   └── export.ts        # downloadMarkdown() + downloadPDF() (jsPDF + Roboto font)
│   ├── components/ui/        # shadcn/ui primitives: button, card, input, textarea, badge, select, tabs, skeleton
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
- `get_analysis_status(id)` — returns status/stage, auto-timeouts after 20min
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
| GET | /api/models | OpenRouter models proxy with cache + filtering (q, modality, sort, min_price, max_price, min_context, category, providers) |

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
9. **Auto-timeout** — stuck analyses (running >20min) auto-fail in `get_analysis_status()`.
10. **Description fallback chain** — 3 levels: LLM description → competitor entity descriptions → generated `"Type: Name"` → `"Entity: Name"`.
11. **Entity extraction limits** — semaphore=5 (max 5 concurrent LLM calls), page text truncated to 8000 chars, max 15 entities per page, 24h cache.
12. **Stop-words filter** — common Russian generic terms filtered post-extraction: доставка, ремонт, услуги, сервис, компания, решение, пользователи, клиенты, товар, услуга, продукт, система, платформа, приложение, главная, контакты, о нас, каталог, стулья, столы, одежда, обувь, еда.

## AnalysisReport Data Model

### Core fields
- `id`, `query`, `timestamp` — metadata
- `entities_found` — total raw entities across all competitor pages
- `user_entity_coverage`, `competitor_entity_coverage` — coverage % (0-100)
- `gaps` — GapItem[] (max 20: entity, entity_type, found_in_competitors, found_in_user_page, priority, recommendation, competitor_description, found_on_urls)
- `checklist` — actionable items (string[])
- `competitor_pages` — CompetitorPage[] (url, title, position, engine, text)
- `user_page_text` — raw text of analyzed user page

### Wave 1 — Knowledge Graph fields
- `all_competitor_entities` — grouped entities with adjusted_confidence, frequency, descriptions, source_urls, positions
- `user_entities` — entities from user's page (name, type, confidence, description, source_urls)
- `cooccurrence_matrix` — `{"entity1|entity2": count}` — pairwise co-occurrences across competitor pages
- `competitor_entity_frequencies` — `{"Entity Name": frequency}` — how many pages each entity appears on
- `typed_edges` — `[{source, target, weight, type}]` — `co_occurrence` (default) or `parent_child` (detected via description containment: e.g. «CRM» contains «Salesforce» → parent_child)

### SERP position weighting (Wave 1.3)
- pos 1-3: weight 1.0, pos 4-6: 0.7, pos 7-10: 0.4, pos 11+: 0.2
- Applied to confidence → `adjusted_confidence = confidence × avg_position_weight`

## Prompt Design (Critical)

### Entity Extraction
- Fields: name, type, confidence, **description** (1-2 sentences on how entity is presented in text, Russian)
- Types: Person, Organization, Concept, Product, Event, Location, Metric
- Product > Organization (Salesforce=Org, Sales Cloud=Product)
- Metric > Concept (if numeric value present)
- Maximum 15 entities, sorted by confidence descending
- Post-processing: truncate to 15 + stop-words filter
- **Fallback**: if LLM returns empty description → generated `"Type: Name"` in `entity_extractor.py`

### Gap Analysis
- Direction: ALL top-10 competitors → user ONLY
- Uses entity descriptions for semantic matching
- `frequency` field: entity appears on N competitor pages → critical if ≥2
- Placeholders: `{user_entities}`, `{competitor_entities}`, `{query}`
- Max 10 gaps, sorted by priority
- **Description enrichment**: if LLM returns empty `competitor_description` → `_find_entity_description()` searches in original competitor data → fallback to generated text

## SerpAPI Notes

- Google: `engine=google`, parameter `q`
- Yandex: `engine=yandex`, parameter `text` (NOT `q`!)
- Both: parallel fetch → deduplicate by URL → merge
- Free tier: 100 req/month. Key in `~/.hermes/.env` as `SERPAPI_API_KEY`.
- **`fields` parameter**: added `organic_results(link,title,snippet,position),search_metadata(status),error` — reduces response size 5-10× (strips knowledge_graph, related_questions, ads, inline_images, etc.)
- **pages per engine**: 10 for single engine, 20 total for 'both'

## OpenRouter

- API key: `~/.hermes/.env` as `OPENROUTER_API_KEY`
- Base URL: `https://openrouter.ai/api/v1`
- Model set in DB `settings`, default `openai/gpt-4o`
- Available: `openai/gpt-4o`, `anthropic/claude-sonnet-4`, `google/gemini-2.5-flash`, `deepseek/deepseek-v4-pro`
- Tests use `openai/gpt-4o-mini` (cheap)
- SDK: `openai` Python client with `base_url` override
- **Timeout**: 30s per LLM call (reduced from 60s — faster failure detection)

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

## Models Router (`GET /api/models`)

Proxy for OpenRouter `/models` endpoint with server-side caching.

- **Cache**: 5 min TTL, in-memory dict with async lock
- **Stale-as-fallback**: on OpenRouter error, returns stale cache if available
- **Filtering**: `q` (name/id search), `modality` (text/image/multimodal), `min_price`/`max_price` ($/M tokens), `min_context` (tokens), `category`, `providers` (comma-separated)
- **Sorting**: `pricing-low-to-high`, `pricing-high-to-low`, `context-high-to-low`, `newest`
- **Response shape**: `{data: ModelInfo[], total: number, total_all: number}`
- **AdminPrompts.tsx** uses this for live model search (debounced, dropdown with model cards showing pricing + context)

## Rewrite Article (background, autonomous)

`POST /api/rewrite` is now ASYNC (BackgroundTasks) — returns in ~50ms with `status: running`,
generation continues on the server even if the browser tab is closed.

**DB columns** (migrations in `init_db`): `rewrite_status` (''|running|completed|failed),
`rewrite_error`, `rewrite_started_at`. Legacy rows (text but no status) → treated as completed.

**Endpoints:**
- `POST /api/rewrite` — idempotent: returns existing result if completed, does NOT duplicate if running. Requires `analysis_id`. 400 on empty text/gaps.
- `GET /api/rewrite/{id}/status` — poll (frontend: every 2.5s). Auto-fails rewrites stuck running >10min (server-restart protection).
- `GET /api/history/{id}/rewrite` — same state (RewriteResult: status/error/rewritten_text/rewritten_at/started_at)

**Frontend (RewriteModal.tsx)** — state machine idle→starting→running→done|error:
- mount: checks server state, RESUMES in-flight generation (opens modal, restarts polling)
- running: live elapsed timer, "runs on server — closing page is safe" hint
- error: "Try again" button
- `autoStart` prop: History page one-click flow starts generation on mount
- History page: `rewrite_status` badge (amber "Generating…" from server), auto-refresh list while rewrite running

**LLM timeout**: 180s per rewrite call (article + gaps is a big task; vs 30s for extraction).
Model: `rewrite_model` setting (Admin → Rewrite Article tab), prompts: `rewrite_system_prompt`/`rewrite_user_prompt`.

## Recent Changes (2026-08-08, feat/openrouter-model-search)

5. **Bug fixes batch** —
   - `RewriteModal.tsx`: early `return null` moved AFTER all hooks (was before useCallback/useEffect — Rules of Hooks violation).
   - `analyzer.py`: user-text cache key is now `user-text://<sha1[:16]>` (was shared `"user-text://"` — all pasted-text analyses returned the first one's entities from cache for 24h).
   - `competitor_entity_coverage` is now real: % of user entities also found among competitor entities (was hardcoded 100.0). Formula: `len(user ∩ competitor) / len(user) × 100`. Symmetric to `user_entity_coverage`.
   - `checklist` is now populated from gaps (`"Entity — recommendation"`) and rendered via `Checklist.tsx` on home + report pages, and exported in MD.

1. **Empty Description fix** — 3 levels of fallback: `entity_extractor.py` generates `"Type: Name"` if LLM returns empty description; `gap_analyzer.py` has `_find_entity_description()` to enrich gaps from competitor data; quick-gaps generate fallback text.
2. **Timeout tuning** — analysis timeout 10→20 min; OpenRouter calls 60→30s; pipeline now logs every stage with `logger.info()`.
3. **SerpAPI `fields` parameter** — Google and Yandex calls now request only needed fields, cutting response size ~10×.
4. **OpenRouter live model search** — new `GET /api/models` endpoint proxies OpenRouter with 5min cache + filtering/sorting. AdminPrompts.tsx replaced hardcoded model select with debounced live search dropdown. `fetchModels()` in `lib/api.ts` with full `ModelInfo` type.

## Pitfalls & Gotchas

1. **Yandex uses `text` not `q`** — 400 Bad Request otherwise.
2. **`.format()` doubles braces** — `{{\"entities\": [...]}}` in prompt strings, `{page_text}` as placeholder.
3. **No `--reload` with uvicorn background** — reloader changes cwd to `/tmp`, breaks imports.
4. **`str | None` needs Python 3.10+** — venv must use python3.11.
5. **Entity limit was 16 despite prompt** — fixed with post-process truncate in `entity_extractor.py`.
6. **Critical priority broke after entity grouping** — `frequency` field replaces name counting.
7. **DB `created_at` is NAIVE (no timezone)** — `get_analysis_status()` must call `.replace(tzinfo=timezone.utc)` before subtracting from `datetime.now(timezone.utc)`. Otherwise: `TypeError: can't subtract offset-naive and offset-aware datetimes`.
8. **`result_json` must be in INSERT** — column has `NOT NULL`, include `'{}'` explicitly in `create_running_analysis()`.
9. **DB migration via `SELECT *` is dangerous** — column order may differ between old and new schema. Use explicit column lists.
10. **SQLite gets `database is locked`** if CLI and backend access DB simultaneously. Kill backend before running `sqlite3` CLI directly.
11. **Empty competitor_description** — LLM may return gaps without descriptions. Fixed with `_find_entity_description()` enrichment in `gap_analyzer.py` + fallback in `entity_extractor.py`. Three-tier chain: LLM → competitor data → generated.
12. **Pipeline timeout at 10min** — deepseek-v4-pro can be slow (30-40s per extraction). 20 pages × 30-40s ÷ semaphore 5 = 120-160s. Increased to 20min, reduced OpenRouter timeout to 30s.
