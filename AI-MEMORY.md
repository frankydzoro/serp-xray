# AI Memory — SERP X-Ray

> For any AI agent working on this project. Load this file first.
> Last updated: 2026-08-10 (auth + production readiness)

## Project

SERP X-Ray — local web tool for competitive SERP entity analysis.  
Takes a search query → fetches top-20 via SerpAPI (Google/Yandex/both) → extracts Knowledge Graph entities via OpenRouter LLM → compares against user's page → builds gap graph + prioritized checklist.

**Path:** `~/serp-xray/`  
**Git:** branch `main` (PR workflow via GitHub, remote `frankydzoro/serp-xray`)  
**Owner:** Petr Grishechkin, SEO specialist, Russian-speaking, prefers English UI

## Architecture

```
localhost:3000 → Next.js 16 (shadcn/ui, D3.js)
localhost:8000 → FastAPI (Python 3.11, uvicorn)
```

Backend talks to:
- SerpAPI (Google + Yandex organic results)
- OpenRouter (LLM: entity extraction + gap analysis)
- SQLite (history, settings, entity cache)

## Production Readiness / Security (2026-08-10)

Backend auth + production scaffolding (for non-local deployment). Full breakdown and decisions — the `serp-xray` skill, "Production Readiness" section.

**Auth (session tokens):**
- `POST /api/login {password}` → `secrets.compare_digest` against `SERPXRAY_ADMIN_PASSWORD` → token `secrets.token_urlsafe(32)`; only `sha256(token)` is stored in the DB (`auth_sessions`).
- Every `/api/*` (except `/login`, `/health`) — dependency `require_auth` (in `main.py` via `dependencies=[Depends(require_auth)]` on include_router): checks the hash + `expires_at > now` + `password_sha == sha256(current env password)`. Changing the password in env instantly invalidates ALL sessions (no manual cleanup). Sliding renewal `expires_at = now + TTL` (default 30d). Header is case-insensitive.
- Expired sessions are cleaned up on every successful `/login`, no cron.
- **Fail-fast:** `main.py` startup raises RuntimeError if `SERPXRAY_ADMIN_PASSWORD` is missing (unless explicit `SERPXRAY_AUTH_DISABLED=1` for local dev). To not break local dev: set a password in `backend/.env` or set `AUTH_DISABLED`.
- Brute force: a global bucket on `/login` (5 failures/min → 300s lockout).
- Rate limit: `/api/analyze` — per session TOKEN (10/min), NOT per IP (behind a proxy all requests share one IP).

**config.py:** `load_dotenv(override=False)` — priority: environment → `backend/.env` → `~/.hermes/.env` (legacy). New vars: `SERPXRAY_ADMIN_PASSWORD`, `SERPXRAY_AUTH_DISABLED`, `SERPXRAY_TRUST_PROXY`, `SERPXRAY_CORS_ORIGINS`, `SERPXRAY_SESSION_TTL_DAYS`.

**CORS:** `allow_origins` from env, `allow_credentials=False` always. In prod with Next rewrites (single origin) CORS is not involved.

**SSRF (`services/serp.py`):**
- `resolve_and_pin(url)` → `(pinned_url, host)`: resolves all A/AAAA via `getaddrinfo`, blocks `is_private/is_loopback/is_link_local(incl 169.254.169.254)/is_multicast/is_reserved/is_unspecified` + IPv4-mapped `::ffff:`; IP literals are checked without resolution; http/https schemes only.
- **DNS pinning:** the client connects to the verified IP (`Host` header + `sni_hostname` extension for https), and does NOT re-resolve the hostname — closes rebinding between check and connect.
- Redirects are handled manually (`follow_redirects=False`, ≤5 hops) — each hop re-runs `resolve_and_pin`. The residual risk (a race inside the TCP handshake) is documented, not closed — acceptable for a personal tool.
- `fetch_page_text` now goes through `_safe_get` (applies to competitor pages and user-URL alike).

**Rate limit:** in-memory, hence exactly **1 uvicorn worker** (SQLite too). In compose port 8000 is NOT published (only `expose`), `SERPXRAY_TRUST_PROXY=1`.

**Frontend (auth):**
- `lib/api.ts`: `API_BASE = NEXT_PUBLIC_API_URL || ""` (same-origin via rewrites), `getToken/setToken/clearToken` (sessionStorage), `apiFetch(path, init)` adds `X-Auth-Token`, on 401 clears the token and redirects to `/login`. `login(password)`. `deleteAnalysis`/`bulkDelete` added.
- `app/login/page.tsx` — the form; `components/AuthGuard.tsx` — client-side guard. **PITFALL:** AuthGuard must NOT block rendering children (don't hold a spinner until ready!) — with problematic hydration that hung the page forever. Correct: render children immediately, redirect to /login via a soft `useEffect` + `window.location.href` (no router.replace in the effect for static pages).
- `app/history/page.tsx` — the `http://localhost:8000` hardcode is removed (was a known issue), fetches via `apiFetch/deleteAnalysis/bulkDelete`.
- `next.config.ts`: `output: 'standalone'` + `rewrites /api/:path* → BACKEND_URL`.

**XSS (step 0):** `GapGraph.tsx` tooltips rewritten to `document.createElement`/`textContent` (was `innerHTML` with `d.title/d.url/d.description` — stored XSS stealing the token). `EntityGraph.tsx` — dead code, also has `innerHTML` in the tooltip — not rendered, but delete when convenient.

**Docker:** `backend/Dockerfile`, `frontend/Dockerfile` (standalone), `docker-compose.yml` (backend+frontend+caddy, volume `serp_data:/app/data`, healthcheck, `restart: unless-stopped`, conditional depends_on), `Caddyfile` (Let's Encrypt for `{$SERPXRAY_DOMAIN}`), `.env.example`. HTTPS is mandatory — via Caddy.

**Frontend build/standalone:** `next build` produces `.next/standalone` + `.next/static`; run with `node server.js` (must copy `public/` and `.next/static`). Turbopack. FAST build (~5s), tsc clean, 57 backend tests green.

## Pipeline (Background Task)

Analysis runs as a FastAPI `BackgroundTasks` with 5 stages:

1. **searching** — SerpAPI fetch top-20 (Google/Yandex/both)
2. **fetching** — fetch page text (10 pages per engine, 20 total for 'both'), **deterministic `clean_article_text()`** in `fetch_page_text()` (removes meta/TOC/tags/buttons, glues `-\n` breaks) — applied to all pages (user + competitors)
3. **extracting** — LLM entity extraction per page (semaphore=5, timeout=30s per call, 24h entity cache, stop-words filter, top-15 cap)
4. **analyzing** — TWO sequential LLM steps: (a) user page entities (URL or pasted text), (b) gap analysis (quick-gaps or LLM, timeout=30s; overall deadline `GAP_TIMEOUT_SECONDS=180`, on failure `gaps=[]` — the report builds without gaps)
5. **building** — assemble report including Wave 1 Knowledge Graph fields: all_competitor_entities, user_entities, cooccurrence_matrix (pairwise `entity1|entity2` → count), competitor_entity_frequencies, typed_edges (co_occurrence / parent_child detection via description matching)

Each stage updates the `stage` column in DB. **Per-page progress** (fetch/extract) is written to the `analysis_pages` table via point-updates (no read-modify-write), user_page/gap metadata goes to `progress_meta`. Frontend polls `GET /api/analyze/{id}/status` every 2s, the response includes `progress: {pages: [...], user_step, gap_step, ...}`.  
Auto-timeout: stuck analyses (20+ min) are auto-marked `failed`.  
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
│   │   ├── serp.py          # SerpAPI: fetch_top20(engine), fetch_page_text() + clean_article_text()
│   │   ├── article_cleaner.py  # Deterministic text cleanup (regex, no LLM) — clean_article_text()
│   │   ├── entity_extractor.py  # OpenRouter LLM → entities (semaphore=5, 24h cache, stop-words, top-15)
│   │   └── gap_analyzer.py  # Gap detection: quick-gaps (no URL) + LLM fallback, description enrichment
│   ├── models/schemas.py    # Pydantic: AnalyzeRequest, GapItem, AnalysisReport, AnalyzeStatus
│   ├── prompts/default.py   # Default prompts (fallback, overridden via DB)
│   ├── tests/
│   │   ├── test_article_cleaner.py  # 11 cleaner tests (meta/TOC/tags/glue/buttons/smoke markdown)
│   │   ├── test_prompts.py  # 29 systematic prompt tests (run: python -m tests.test_prompts, NOT pytest!)
│   │   └── prompt-findings.md # Remediation plan (all items completed)
│   └── venv/                # Python 3.11.15
├── frontend/
│   ├── app/                 # Next.js App Router
│   │   ├── layout.tsx       # Root layout with AppNav
│   │   ├── page.tsx         # Launch form only (modal); does NOT render results — after analyzeQuery redirects to /report/{id}
│   │   ├── admin/page.tsx   # Model selector + prompt editors
│   │   ├── history/page.tsx # Card grid with Running/Failed/Completed badges, bulk ops
│   │   └── report/[id]/page.tsx  # Universal: polls status (running→ReportSkeleton, failed→error+back), completed→report + GapGraph + PDF/MD
│   ├── components/
│   │   ├── QueryForm.tsx    # NOT USED (dead code; form is inline in page.tsx modal)
│   │   ├── EntityGraph.tsx  # D3.js force graph (LEGACY — unused; replaced by GapGraph)
│   │   ├── GapGraph.tsx     # BIPARTITE report graph: competitors (from gap.found_on_urls) left ↔ gap entities right; forceX columns, zoom, click↔open competitor page
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- … + rewritten_*, rewrite_* (see Rewrite Article), progress_meta TEXT NOT NULL DEFAULT '{}'
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

-- Per-page analysis progress (point-updates from concurrent coroutines; race-free by PK)
CREATE TABLE analysis_pages (
    analysis_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    engine TEXT NOT NULL DEFAULT '',
    step TEXT NOT NULL DEFAULT 'pending',   -- pending → fetching → done|failed → extracting → done|failed
    chars INTEGER NOT NULL DEFAULT 0,       -- text length (fetch-done)
    entities INTEGER NOT NULL DEFAULT 0,    -- entity count (extract-done)
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (analysis_id, url)
);
```

### Status values
- `running` — pipeline in progress (stage tracks sub-step)
- `completed` — finished successfully
- `failed` — error or timeout

### Stage values
- `searching` → `fetching` → `extracting` → `analyzing` → `building` → `done`
- `error` — terminal failure
- On `fetching`/`extracting`, in addition to `stage`, **per-page progress** is written to `analysis_pages`; on `analyzing` — `progress_meta` (`user_step`, then `gap_step`). The frontend shows an article list on `fetching/extracting`, and two rows (Your page / Gap analysis) on `analyzing`.

### DB Functions
- `create_running_analysis(id, query, model, url)` — inserts with status=running
- `update_analysis_status(id, stage)` — updates stage only
- `register_pages(id, pages)` — INSERT OR IGNORE pages (all pending)
- `update_page(id, url, step=, chars=, entities=)` — point-update of an analysis_pages row (no read-modify-write)
- `set_progress_meta(id, dict)` — merge-update progress_meta (only from the main coroutine between gathers — no races)
- `complete_analysis(id, result)` — saves result, sets status=completed
- `fail_analysis(id, error)` — sets status=failed, stage=error
- `get_analysis_status(id)` — returns status/stage/**progress** (`{pages, user_step, gap_step, ...}`), auto-timeouts after 20min
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
8. **Background pipeline with polling** — analysis runs as BackgroundTasks, **report page** polls `/status` every 2s (running→skeleton; polling stops on completed/failed via `settledRef`, otherwise the graph rebuilds endlessly).
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
- `competitor_pages` — CompetitorPage[] (url, title, position, engine, text, **entities**) — entities = per-page entities, wired from `page_entities` in `analyzer.py` (url→entities map); an empty page = text was extracted but NER produced nothing
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

## Recent Changes (2026-08-10, competitor results accordion)

5. **Competitor Results accordion** — a new section on `/report/[id]` between Content Gaps and Checklist:
   - `CompetitorEntities.tsx` — URL → entities accordion: `#position · engine · title` + an «N entities» badge
   - Empty pages (0 entities) — red «0 entities» badge + a warning at the top «⚠ N of M pages have 0 entities» (diagnostics: text extracted, NER produced nothing)
   - Backend: `CompetitorPage.entities: list[dict] = []` (schemas.py) + per-page entity wiring in `analyzer.py` (after `page_entities = gather(...)` — url→entities map)
   - Old DB reports don't contain entities (will show «0 entities»)

## Recent Changes (2026-08-10, bipartite gap graph + report-only results)

PR #3 merged to main (`a8e0b6e`).

1. **Bipartite graph on the report** — new `GapGraph.tsx` replaces EntityGraph on `/report/[id]`:
   - Competitor nodes (unique URLs from `gap.found_on_urls`) — blue rectangles on the left (forceX → x=22%)
   - Gap nodes — red dashed circles on the right (forceX → x=78%), radius by frequency
   - Edges `competitor → gap` (not co-occurrence!); clicking a competitor opens its page
   - `EntityGraph.tsx` no longer used (legacy; delete candidate)
2. **Home `/` — launch form only** — results/KPI/graph/polling/resume/localStorage removed (page.tsx −418 lines). After `analyzeQuery` → `router.push('/report/{id}')`.
3. **Report page — universal** — polls `getAnalysisStatus` every 2s: running→ReportSkeleton, failed→error+Back to History, completed→a single `getReport`. The terminal `settledRef` stops polling (otherwise each tick recreated the graph).
4. **History** — running analyses open in `/report/{id}` (was `/?id=`). Old `/?id=` bookmarks no longer work (intentional).

## Recent Changes (2026-08-10, structured text extraction: Trafilatura → quality gate → BS4)

**Problem**: Trafilatura in its default precision mode dropped H2 headings and cut content (a real Roseltorg case: the HTML had H1+7 H2 and 6330 chars in `.article-reader`, while `extract` returned 3740 chars and **0 headings**). For NER this is a disaster — the LLM can't see the document structure.

**Solution — new module `services/text_extraction.py`** (cascade, structure preserved):
1. **Trafilatura** with `favor_recall=True`, `output_format="markdown"`, `include_tables=True`, `include_links=False`, `include_images=False` — recall over precision.
2. **Quality gate** `_assess_quality()` — fails if: (a) `len < 300`; (b) the DOM candidate has ≥2 H2 but markdown has 0; (c) text < 50% of the DOM candidate's length. Threshold 300 instead of the old 50.
3. **BS4 structural** — walks the DOM candidate, converts to Markdown: `h1..h6→#`, `p→text`, `ul/ol→- item`, `table→| a | b |` (escapes `|` in cells), `blockquote→>`. Service nodes (`nav/footer/header/aside/script/style`) are skipped.
4. **raw text** — the old crude fallback (semantic tags + CSS + `get_text("\n")`), `logger.warning("Extraction degraded...")`.

**DOM candidates** `find_content_candidate()`: cascade `article → [itemprop="articleBody"] → main → .article-content → .post-content → .entry-content → #content` + the **`DOMAIN_SELECTORS`** dict for templates without article/main (`cv.roseltorg.ru: [".article-reader"]` — there is NO article/main in that DOM). Domain overrides are only extra priority, not the sole path.

**`PageTextResult`**: `{text, method: trafilatura|bs4_structural|raw_text, char_count, h1_count, h2_count, h3_count, truncated, warnings[]}` — metrics for logging degradations and future metadata storage.

**`serp.py::fetch_page_text()`** became a thin wrapper: fetched HTML → `extract_page_text_from_html(html, url).text`.

**Truncation to 8000 — only at the LLM input**: `entity_extractor.py` uses `smart_truncate(text, MAX_PAGE_CHARS)` (cuts on `\n\n` blocks, doesn't break sentences). The report stores the **full** page text (`PageTextResult.truncated` is always False in the orchestrator).

**Tests**: `tests/test_text_extraction.py` (9 items: selector cascade, domain override, heading/list/table preservation, smart_truncate). IMPORTANT: markdown tables in tests come in two formats — trafilatura `|---|---|`, bs4 `| --- | --- |`.

**Pitfall after extraction edits**: reset `entities_cache` (`DELETE FROM entities_cache;` after killing uvicorn — old rows return entities from heading-less text) and restart uvicorn (no `--reload`).

## Recent Changes (2026-08-10, deterministic article cleaner)

New `services/article_cleaner.py` — deterministic text cleanup BEFORE NER (regex, no LLM):
- `clean_article_text()` removes: leading meta (author/date/read time, first 10 lines), table of contents (first 20, `skip_toc_block` mode via `^\d+\.\s+\w+`), tags/hashtags (last 10), service buttons via **exact matches** (`^(поделиться|share|...)\s*[.?:：→»›…]*$` — «Поделиться» is removed, «Поделиться опытом внедрения» is not)
- Glue `-\n` breaks → `` via `HYPHEN_BREAK_RE` **before** splitting into lines (fix: naive per-line gluing duplicated the next line)
- Threshold: text < 100 chars is returned as-is (protects snippets/truncations) — spec tests with short texts were lengthened to > 100
- Constants: `META_SCAN_LINES=10`, `TOC_SCAN_LINES=20`, `TAG_SCAN_LINES=10`
- Integration: `fetch_page_text()` (serp.py) — cleans all pages (user URL + competitors); `analyzer.py` — `user_text` is cleaned **before** `sha1` (cache key derived from canonical text)
- On deploy, cache reset is mandatory: `DELETE FROM entities_cache;` (otherwise old rows return entities from uncleaned texts) + restart uvicorn
- Tests: `tests/test_article_cleaner.py` (11 items) — run `./venv/bin/python3 -m pytest tests/test_article_cleaner.py -v`. pytest is installed in the project venv.

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
13. **Backend changes need MANUAL uvicorn restart** — backend runs WITHOUT `--reload` (reloader breaks imports, changes cwd to /tmp). After editing any backend file: kill the old uvicorn process, then `./venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000` (background). Symptom of stale backend: API works but new fields/logic missing (e.g. `competitor_pages[].entities` empty while entities_found > 0).
14. **`provider.require_parameters` for JSON** (learned 2026-08-10) — `response_format={"type":"json_object"}` is already set in entity_extractor/gap_analyzer, BUT OpenRouter by default may route to an endpoint that ignores the parameter (Claude etc.) → the model returns ```json fences → json.loads crashes. Fix: `provider={"require_parameters": True}` + a defensive parser (strip fences). Full digest — in the openrouter-api skill («Structured outputs / JSON Schema» section).
15. **OpenRouter + VPN (eXpress) → «half-dead» connection** (2026-08-10) — TCP ESTABLISHED to the CF IP of openrouter.ai, no data flows, process eats no CPU (symptom: analysis hangs in `running/extracting` for minutes; `lsof -nP -p <pid> -i` shows ESTABLISHED to 104.18.x.x). The SDK `timeout=30` is per-operation, not a whole-request deadline, so it doesn't always save you. Fix: `asyncio.wait_for(..., timeout=GAP_TIMEOUT_SECONDS=180)` around gap analysis + fallback `gaps=[]`, and try/except in `extract_for_page` (a failed page is skipped, the report builds from the rest). Diagnostics: `sample <pid> 2`, `lsof`, `curl -m 10 https://openrouter.ai/api/v1/models`.
16. **`progress` must be forwarded into AnalyzeStatus in the router** (2026-08-10) — `get_analysis_status()` (db) returns `d["progress"]`, but if `routers/analyzer.py::get_status` does NOT pass `progress=data.get("progress", {})` — the API returns empty progress while the `analysis_pages` table is full (symptom: `/status` returns `pages: []`, while `sqlite3 ... SELECT * FROM analysis_pages` is populated). The pydantic default `{}` silently hides the bug.
17. **Resilience tests touch the real DB after db calls were added to the pipeline** (2026-08-10) — as soon as `_run_pipeline` started calling `register_pages`/`update_page`/`set_progress_meta`, `test_analyzer_resilience.py` failed with `no such table: analysis_pages` (production DB without migration). Fix: mock these three functions in `_patch_base` (they are not part of resilience behavior).

## Recent Changes (2026-08-10, per-page analysis progress)

«Analyzing gaps..» sat invisible for up to ~4 min: the flat `stage` hid (a) the entire `extracting` (10-20 LLM calls) and (b) the two sequential LLM calls inside `analyzing`. At the user's request, **progress transparency** was added (not speed).

- **Solution — NO JSON blob for pages** (user-enforced): with semaphore=5, coroutines would read-modify-write one field → lost updates (stuck `pending` = the same UX bug elsewhere). Instead `analysis_pages` (PK `analysis_id+url`): each coroutine point-UPDATEs its own row — race-free by construction. `user_page`/`gap` metadata lives in `analyses.progress_meta` (JSON; written only from the main coroutine between gathers — no races).
- `db.py`: `register_pages`, `update_page(id,url,step=,chars=,entities=)`, `set_progress_meta(id,dict)`; `get_analysis_status` assembles `progress={pages, ...meta}` (pages ordered by position).
- `routers/analyzer.py`: page registration after searching; `fetch_text` → `fetching`→`done(chars)|failed`; `extract_for_page` → `extracting`→`done(entities)|failed`; user page → `user_step` extracting/done/failed/skipped + `user_entities`; gap → `gap_step` running/done/failed + `gap_user_n`/`gap_competitor_n`/`gap_count`.
- `schemas.py`/`routers`: `AnalyzeStatus.progress: dict = {}`, forwarded in `get_status` (see pitfall 16).
- Frontend: `AnalysisProgress`/`PageProgress` in `lib/api.ts`; `ReportSkeleton` on `fetching/extracting` — a dense article list (`#pos · hostname — title` + spinner / ✓ N entities / ✗ failed, `Pages — 8/9`), on `analyzing` — StepRows «Your page entities — N extracted» and «Gap analysis — comparing N competitor vs M user entities»; the progress bar uses the fraction of settled pages. `report/[id]/page.tsx` stores `progress` from each poll.
- Tests: `tests/test_progress.py` (17 passed total). E2E confirmed live (search→fetch→extract→analyze→completed) + the UI showed the article list and separated gap steps. tsc clean. Backend restarted, migrations applied (table + column in place).

## Recent Changes (2026-08-10, resilient pipeline: gap fallback)

When LLM calls hang/fail, the analysis no longer falls to `failed` — the report builds with what was already extracted:
- **`analyzer.py`**: `GAP_TIMEOUT_SECONDS = 180`; `analyze_gaps` wrapped in `asyncio.wait_for` + `except → gaps=[]` (log `[id] Gap analysis failed ... building report with available data`). The UI gets a completed report: entities, graph, coverage, but empty gaps/checklist.
- **`analyzer.py`**: `extract_for_page` wrapped in try/except — one failed/hung page is skipped (`entities=[]`), the rest still extract.
- The `entities_cache` is not reset on restart — a re-analysis picks up already-extracted pages instantly.
- Tests: `tests/test_analyzer_resilience.py` (2 items, mocks without LLM): `test_gap_failure_still_builds_report`, `test_extract_failure_skips_only_broken_page`. Run: `./venv/bin/python3 -m pytest tests/ -q` → 15 passed (1 pre-existing error in test_prompts.py: the helper is named `def test()` — pytest treats it as a test with a `name` fixture; don't touch, the file runs real LLM calls).
