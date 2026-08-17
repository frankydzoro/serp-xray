# AI Memory — SERP X-Ray

> For any AI agent working on this project. Load this file first.
> Last updated: 2026-08-10 (auth + production readiness)

## Project

SERP X-Ray — local web tool for competitive SERP entity analysis.  
Takes a search query → fetches top-20 via SerpAPI (Google/Yandex/both) → extracts Knowledge Graph entities via OpenRouter LLM → compares against user's page → builds gap graph + prioritized checklist.

**Path:** `~/serp-xray/`  
**Git:** branch `main` (PR workflow через GitHub, remote `frankydzoro/serp-xray`)
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

Backend auth + prod-обвязка (для не-локального запуска). Полный разбор и решения — Skill `serp-xray` секция "Production Readiness".

**Auth (session tokens):**
- `POST /api/login {password}` → `secrets.compare_digest` с `SERPXRAY_ADMIN_PASSWORD` → токен `secrets.token_urlsafe(32)`; в БД (`auth_sessions`) хранится ТОЛЬКО `sha256(токена)`.
- Каждый `/api/*` (кроме `/login`, `/health`) — dependency `require_auth` (в `main.py` через `dependencies=[Depends(require_auth)]` на include_router): сверка хэша + `expires_at > now` + `password_sha == sha256(текущего env-пароля)`. Смена пароля в env мгновенно инвалидирует ВСЕ сессии (без ручной чистки). Sliding-продление `expires_at = now + TTL` (default 30d). Заголовок регистронезависим.
- Cleanup истёкших сессий — при каждом успешном `/login`, без cron.
- **Fail-fast:** `main.py` startup бросает RuntimeError, если нет `SERPXRAY_ADMIN_PASSWORD` (кроме явного `SERPXRAY_AUTH_DISABLED=1` для локального dev). Локальную разработку сломать: задать пароль в `backend/.env` или выставить `AUTH_DISABLED`.
- Брутфорс: глобальный бакет на `/login` (5 неудачных/мин → блокировка 300с).
- Rate limit: `/api/analyze` — по ТОКЕНУ сессии (10/мин), НЕ по IP (за прокси IP один).

**config.py:** `load_dotenv(override=False)` — приоритет: окружение → `backend/.env` → `~/.hermes/.env` (legacy). Новые: `SERPXRAY_ADMIN_PASSWORD`, `SERPXRAY_AUTH_DISABLED`, `SERPXRAY_TRUST_PROXY`, `SERPXRAY_CORS_ORIGINS`, `SERPXRAY_SESSION_TTL_DAYS`.

**CORS:** `allow_origins` из env, `allow_credentials=False` всегда. В проде с Next rewrites (один origin) CORS не участвует.

**SSRF (`services/serp.py`):**
- `resolve_and_pin(url)` → `(pinned_url, host)`: резолв всех A/AAAA через `getaddrinfo`, блок `is_private/is_loopback/is_link_local(вкл 169.254.169.254)/is_multicast/is_reserved/is_unspecified` + IPv4-mapped `::ffff:`; IP-литералы проверяются без резолва; схемы только http/https.
- **DNS pinning:** клиент соединяется с проверенным IP (`Host`-заголовок + `sni_hostname` extension для https), а НЕ пере-резолвит hostname — закрывает rebinding между проверкой и коннектом.
- Redirects обрабатываются вручную (`follow_redirects=False`, ≤5 хопов) — каждый хоп заново `resolve_and_pin`. Остаточный риск (гонка внутри TCP-хендшейка) задокументирован, не закрыт — для личного инструмента ок.
- `fetch_page_text` теперь идёт через `_safe_get` (это касается и страниц-конкурентов, и user-URL).

**Rate limit:** in-memory, поэтому ровно **1 uvicorn worker** (SQLite тоже). В compose порт 8000 НЕ публикуется (только `expose`), `SERPXRAY_TRUST_PROXY=1`.

**Frontend (auth):**
- `lib/api.ts`: `API_BASE = NEXT_PUBLIC_API_URL || ""` (same-origin через rewrites), `getToken/setToken/clearToken` (sessionStorage), `apiFetch(path, init)` подставляет `X-Auth-Token`, на 401 чистит токен и редиректит на `/login`. `login(password)`. `deleteAnalysis`/`bulkDelete` добавлены.
- `app/login/page.tsx` — форма; `components/AuthGuard.tsx` — клиентский guard. **ПИТФОЛЛ:** AuthGuard НЕ блокирует рендер children (не держит спиннер до ready!) — при проблемной гидратации это вешало страницу навсегда. Правильно: рендерить children сразу, редирект на /login — мягким `useEffect` + `window.location.href` (никакого router.replace в эффекте для статических страниц).
- `app/history/page.tsx` — хардкод `http://localhost:8000` убран (был известный issue), выборки через `apiFetch/deleteAnalysis/bulkDelete`.
- `next.config.ts`: `output: 'standalone'` + `rewrites /api/:path* → BACKEND_URL`.

**XSS (шаг 0):** `GapGraph.tsx` тултипы переписаны на `document.createElement`/`textContent` (был `innerHTML` с `d.title/d.url/d.description` — stored XSS кража токена). `EntityGraph.tsx` — dead code, в нём тоже `innerHTML` в тултипе — НЕ рендерится, но удалить при случае.

**Docker:** `backend/Dockerfile`, `frontend/Dockerfile` (standalone), `docker-compose.yml` (backend+frontend+caddy, volume `serp_data:/app/data`, healthcheck, `restart: unless-stopped`, depends_on с условием), `Caddyfile` (Let's Encrypt для `{$SERPXRAY_DOMAIN}`), `.env.example`. HTTPS обязателен — через Caddy.

**Frontend build/standalone:** `next build` генерит `.next/standalone` + `.next/static`; запуск `node server.js` (нужно скопировать `public/` и `.next/static`). Turbopack. FAST-build (~5s), tsc чист, 57 backend-тестов зелёные.

## Pipeline (Background Task)

Analysis runs as a FastAPI `BackgroundTasks` with 5 stages:

1. **searching** — SerpAPI fetch top-20 (Google/Yandex/both)
2. **fetching** — fetch page text (10 pages per engine, 20 total for 'both'), **детерминированная очистка `clean_article_text()`** в `fetch_page_text()` (удаляет мету/оглавление/теги/кнопки, склеивает `-\n` переносы) — применяется ко всем страницам (user + competitors)
3. **extracting** — LLM entity extraction per page (with semaphore=5, timeout=30s per call, 24h entity cache, stop-words filter, top-15 cap)
4. **analyzing** — ДВА последовательных LLM-шага: (a) сущности страницы пользователя (URL или pasted text), (b) gap analysis (quick-gaps or LLM, timeout=30s; общий дедлайн `GAP_TIMEOUT_SECONDS=180`, при фейле `gaps=[]` — отчёт строится без gaps)
5. **building** — assemble report including Wave 1 Knowledge Graph fields: all_competitor_entities, user_entities, cooccurrence_matrix (pairwise «entity1|entity2» → count), competitor_entity_frequencies, typed_edges (co_occurrence / parent_child detection via description matching)

Each stage updates `stage` column in DB. **Per-page progress** (fetch/extract) пишется в таблицу `analysis_pages` point-апдейтами (без read-modify-write), метаданные user_page/gap — в `progress_meta`. Frontend polls `GET /api/analyze/{id}/status` every 2s, ответ содержит `progress: {pages: [...], user_step, gap_step, ...}`.  
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
│   │   ├── serp.py          # SerpAPI: fetch_top20(engine), fetch_page_text() + clean_article_text()
│   │   ├── article_cleaner.py  # Детерминированная очистка текста (regex, без LLM) — clean_article_text()
│   │   ├── entity_extractor.py  # OpenRouter LLM → entities (semaphore=5, 24h cache, stop-words, top-15)
│   │   └── gap_analyzer.py  # Gap detection: quick-gaps (no URL) + LLM fallback, description enrichment
│   ├── models/schemas.py    # Pydantic: AnalyzeRequest, GapItem, AnalysisReport, AnalyzeStatus
│   ├── prompts/default.py   # Default prompts (fallback, overridden via DB)
│   ├── tests/
│   │   ├── test_article_cleaner.py  # 11 тестов cleaner (мета/оглавление/теги/склейка/кнопки/smoke markdown)
│   │   ├── test_prompts.py  # 29 systematic prompt tests (запуск: python -m tests.test_prompts, НЕ pytest!)
│   │   └── prompt-findings.md # Remediation plan (all items completed)
│   └── venv/                # Python 3.11.15
├── frontend/
│   ├── app/                 # Next.js App Router
│   │   ├── layout.tsx       # Root layout with AppNav
│   │   ├── page.tsx         # Только форма запуска (модалка); результаты НЕ рендерит — после analyzeQuery redirect на /report/{id}
│   │   ├── admin/page.tsx   # Model selector + prompt editors
│   │   ├── history/page.tsx # Card grid with Running/Failed/Completed badges, bulk ops
│   │   └── report/[id]/page.tsx  # Универсальный: поллинг status (running→ReportSkeleton, failed→error+back), completed→отчёт + GapGraph + PDF/MD
│   ├── components/
│   │   ├── QueryForm.tsx    # NOT USED (мёртвый код; форма инлайн в модалке page.tsx)
│   │   ├── EntityGraph.tsx  # D3.js force graph (LEGACY — не используется; заменён GapGraph)
│   │   ├── GapGraph.tsx     # БИПАРТИТНЫЙ граф репорта: конкуренты (from gap.found_on_urls) слева ↔ gap-сущности справа; forceX-колонки, zoom, click↔открыть страницу конкурента
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
    -- … + rewritten_*, rewrite_* (см. Rewrite Article), progress_meta TEXT NOT NULL DEFAULT '{}'
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

-- Постраничный прогресс анализа (point-апдейты из конкурентных корутин; race-free по PK)
CREATE TABLE analysis_pages (
    analysis_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    engine TEXT NOT NULL DEFAULT '',
    step TEXT NOT NULL DEFAULT 'pending',   -- pending → fetching → done|failed → extracting → done|failed
    chars INTEGER NOT NULL DEFAULT 0,       -- длина текста (fetch-done)
    entities INTEGER NOT NULL DEFAULT 0,    -- число сущностей (extract-done)
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
- На `fetching`/`extracting` плюс к stage пишется **постраничный прогресс** в `analysis_pages`; на `analyzing` — `progress_meta` (`user_step`, затем `gap_step`). Фронт показывает на `fetching/extracting` лист статей, на `analyzing` — две строки (Your page / Gap analysis).

### DB Functions
- `create_running_analysis(id, query, model, url)` — inserts with status=running
- `update_analysis_status(id, stage)` — updates stage only
- `register_pages(id, pages)` — INSERT OR IGNORE страницы (все pending)
- `update_page(id, url, step=, chars=, entities=)` — point-апдейт строки analysis_pages (без read-modify-write)
- `set_progress_meta(id, dict)` — merge-апдейт progress_meta (только из главной корутины между gather — гонок нет)
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
8. **Background pipeline with polling** — analysis runs as BackgroundTasks, **report page** polls `/status` every 2s (running→skeleton; поллинг останавливается на completed/failed через `settledRef`, иначе граф пересобирается бесконечно).
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
- `competitor_pages` — CompetitorPage[] (url, title, position, engine, text, **entities**) — entities = постраничные сущности, привязка из `page_entities` в `analyzer.py` (мапа url→entities); пустая страница = текст вытащился, а NER не сработал
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

5. **Competitor Results аккордеон** — новая секция на `/report/[id]` между Content Gaps и Checklist:
   - `CompetitorEntities.tsx` — аккордеон URL → сущности: `#позиция · engine · title` + бейдж «N entities»
   - Пустые страницы (0 сущностей) — красный бейдж «0 entities» + предупреждение сверху «⚠ N of M pages have 0 entities» (диагностика: текст вытащился, NER не сработал)
   - Backend: `CompetitorPage.entities: list[dict] = []` (schemas.py) + привязка постраничных сущностей в `analyzer.py` (после `page_entities = gather(...)` — мапа url→entities)
   - Старые отчёты в БД entities не содержат (покажут «0 entities»)

## Recent Changes (2026-08-10, bipartite gap graph + report-only results)

PR #3 merged to main (`a8e0b6e`).

1. **Бипартитный граф на репорте** — новый `GapGraph.tsx` заменяет EntityGraph на `/report/[id]`:
   - Узлы-конкуренты (уникальные URL из `gap.found_on_urls`) — синие прямоугольники слева (forceX → x=22%)
   - Узлы-гэпы — красные пунктирные круги справа (forceX → x=78%), радиус по frequency
   - Рёбра `конкурент → gap` (не cooccurrence!); клик по конкуренту открывает его страницу
   - `EntityGraph.tsx` больше не используется (legacy; кандидат на удаление)
2. **Главная `/` — только форма запуска** — убраны результаты/KPI/граф/поллинг/resume/localStorage (page.tsx −418 строк). После `analyzeQuery` → `router.push('/report/{id}')`.
3. **Report page — универсальный** — поллинг `getAnalysisStatus` каждые 2с: running→ReportSkeleton, failed→error+Back to History, completed→один `getReport`. Терминальный `settledRef` останавливает поллинг (иначе каждый тик пересоздавал граф).
4. **History** — running-анализы открываются в `/report/{id}` (было `/?id=`). Старые `/?id=` закладки больше не работают (осознанно).

## Recent Changes (2026-08-10, structured text extraction: Trafilatura → quality gate → BS4)

**Проблема**: Trafilatura в дефолтном precision-режиме выбрасывал H2-заголовки и резал контент (реальный кейс Росэлторга: HTML имел H1+7 H2 и 6330 символов в `.article-reader`, а `extract` вернул 3740 символов и **0 заголовков**). Для NER это катастрофа — LLM не видит структуру документа.

**Решение — новый модуль `services/text_extraction.py`** (каскад, структура сохраняется):
1. **Trafilatura** с `favor_recall=True`, `output_format="markdown"`, `include_tables=True`, `include_links=False`, `include_images=False` — recall важнее precision.
2. **Quality gate** `_assess_quality()` — провал если: (а) `len < 300`; (б) в DOM-кандидате ≥2 H2, а в markdown 0; (в) текст < 50% длины DOM-кандидата. Порог 300 вместо старого 50.
3. **BS4 structural** — обход DOM-кандидата, превращение в Markdown: `h1..h6→#`, `p→текст`, `ul/ol→- item`, `table→| a | b |` (экранирует `|` в ячейках), `blockquote→>`. Служебные (`nav/footer/header/aside/script/style`) пропускаются.
4. **raw text** — старый грубый fallback (semantic tags + CSS + `get_text("\n")`), `logger.warning("Extraction degraded...")`.

**DOM-кандидаты** `find_content_candidate()`: каскад `article → [itemprop="articleBody"] → main → .article-content → .post-content → .entry-content → #content` + словарь **`DOMAIN_SELECTORS`** для шаблонов без article/main (`cv.roseltorg.ru: [".article-reader"]` — там article/main в DOM НЕТ). Доменные оверрайды — только доп. приоритет, не единственный путь.

**`PageTextResult`**: `{text, method: trafilatura|bs4_structural|raw_text, char_count, h1_count, h2_count, h3_count, truncated, warnings[]}` — метрики для логирования деградаций, будущего хранения метаданных.

**`serp.py::fetch_page_text()`** стал тонкой обёрткой: скачал HTML → `extract_page_text_from_html(html, url).text`.

**Обрезка до 8000 — только на входе в LLM**: `entity_extractor.py` использует `smart_truncate(text, MAX_PAGE_CHARS)` (режет по блокам `\n\n`, не рвёт предложения). Отчёт хранит **полный** текст страницы (`PageTextResult.truncated` всегда False в оркестраторе).

**Тесты**: `tests/test_text_extraction.py` (9 шт.: каскад селекторов, доменный оверрайд, сохранение заголовков/списков/таблиц, smart_truncate). ВАЖНО: markdown-таблицы в тестах бывают в двух форматах — trafilatura `|---|---|`, bs4 `| --- | --- |`.

**Питфолл после правок extraction**: сбросить `entities_cache` (`DELETE FROM entities_cache;` после kill uvicorn — старые записи вернут сущности из текста без заголовков) и перезапустить uvicorn (без `--reload`).

## Recent Changes (2026-08-10, deterministic article cleaner)

Новый `services/article_cleaner.py` — детерминированная очистка текста ДО NER (regex, без LLM):
- `clean_article_text()` удаляет: мету в начале (автор/дата/мин чтения, первые 10 строк), оглавление (первые 20, режим `skip_toc_block` по `^\d+\.\s+\w+`), теги/хештеги (последние 10), служебные кнопки **точными матчами** (`^(поделиться|share|...)\s*[.?:：→»›…]*$` — «Поделиться» удалится, «Поделиться опытом внедрения» — нет)
- Склейка переносов `-\n` → `` через `HYPHEN_BREAK_RE` **до** разбиения на строки (фикс: наивная построчная склейка дублировала следующую строку)
- Порог: текст < 100 символов возвращается as-is (защита сниппетов/обрывков) — тесты ТЗ с короткими текстами были удлинены до > 100
- Константы: `META_SCAN_LINES=10`, `TOC_SCAN_LINES=20`, `TAG_SCAN_LINES=10`
- Интеграция: `fetch_page_text()` (serp.py) — очистка всех страниц (user url + competitors); `analyzer.py` — `user_text` чистится **до** `sha1` (кэш-ключ от канонического текста)
- При деплое обязателен сброс кэша: `DELETE FROM entities_cache;` (иначе старые записи вернут сущности из неочищенных текстов) + рестарт uvicorn
- Тесты: `tests/test_article_cleaner.py` (11 шт.) — запуск `./venv/bin/python3 -m pytest tests/test_article_cleaner.py -v`. pytest установлен в venv проекта.

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
14. **`provider.require_parameters` для JSON** (изучено 2026-08-10) — `response_format={"type":"json_object"}` уже стоит в entity_extractor/gap_analyzer, НО OpenRouter по умолчанию может роутить на эндпоинт, игнорирующий параметр (Claude и др.) → модель возвращает ```json фенсы → json.loads падает. Фикс: `provider={"require_parameters": True}` + defensive-парсер (strip фенсов). Полная выжимка — в скилле openrouter-api (секция «Structured outputs / JSON Schema»).
15. **OpenRouter + VPN (eXpress) → «полумёртвое» соединение** (2026-08-10) — TCP ESTABLISHED к CF-IP openrouter.ai, данные не идут, процесс не ест CPU (симптом: анализ висит в `running/extracting` минутами; `lsof -nP -p <pid> -i` показывает ESTABLISHED к 104.18.x.x). SDK-таймаут `timeout=30` — per-operation, не общий дедлайн, поэтому спасает не всегда. Решение: `asyncio.wait_for(..., timeout=GAP_TIMEOUT_SECONDS=180)` вокруг gap-анализа + fallback `gaps=[]`, и try/except в `extract_for_page` (упавшая страница пропускается, отчёт строится по остальным). Диагностика: `sample <pid> 2`, `lsof`, `curl -m 10 https://openrouter.ai/api/v1/models`.
16. **`progress` надо пробрасывать в AnalyzeStatus в роутере** (2026-08-10) — `get_analysis_status()` (db) возвращает `d["progress"]`, но если в `routers/analyzer.py::get_status` НЕ передать `progress=data.get("progress", {})` — API вернёт пустой прогресс при полной таблице `analysis_pages` (симптом: `/status` отдаёт `pages: []`, а `sqlite3 ... SELECT * FROM analysis_pages` полон). Pydantic-дефолт `{}` молча прячет баг.
17. **Resilience-тесты трогают реальную БД после добавления db-вызовов в пайплайн** (2026-08-10) — как только `_run_pipeline` начал звать `register_pages`/`update_page`/`set_progress_meta`, `test_analyzer_resilience.py` упал с `no such table: analysis_pages` (продакшн-БД без миграции). Чинить: замокать эти три функции в `_patch_base` (не относятся к устойчивости).

## Recent Changes (2026-08-10, per-page analysis progress)

«Analyzing gaps..» висел невидимкой до ~4 мин: плоский `stage` скрывал (а) весь `extracting` (10-20 LLM-вызовов) и (б) внутри `analyzing` два последовательных LLM-вызова. По запросу пользователя сделана **прозрачность прогресса** (не ускорение).

- **Решение — БЕЗ JSON-блоба для страниц** (user-enforced): с семафором 5 корутины делали бы читай-модифицируй-пиши одного поля → потерянные апдейты (застрявшие `pending` = тот же UX-баг в другом месте). Вместо этого `analysis_pages` (PK `analysis_id+url`): каждая корутина point-UPDATE своей строки — race-free по конструкции. Метаданные `user_page`/`gap` — в `analyses.progress_meta` (JSON; пишутся только из главной корутины между gather — гонок нет).
- `db.py`: `register_pages`, `update_page(id,url,step=,chars=,entities=)`, `set_progress_meta(id,dict)`; `get_analysis_status` собирает `progress={pages, ...meta}` (pages по порядку position).
- `routers/analyzer.py`: регистрация страниц после searching; `fetch_text` → `fetching`→`done(chars)|failed`; `extract_for_page` → `extracting`→`done(entities)|failed`; user-страница → `user_step` extracting/done/failed/skipped + `user_entities`; gap → `gap_step` running/done/failed + `gap_user_n`/`gap_competitor_n`/`gap_count`.
- `schemas.py`/`routers`: `AnalyzeStatus.progress: dict = {}`, проброс в `get_status` (см. pitfall 16).
- Frontend: `AnalysisProgress`/`PageProgress` в `lib/api.ts`; `ReportSkeleton` на `fetching/extracting` — dense-лист статей (`#pos · hostname — title` + спиннер / ✓ N entities / ✗ failed, `Pages — 8/9`), на `analyzing` — StepRow'ы «Your page entities — N extracted» и «Gap analysis — comparing N competitor vs M user entities»; прогресс-бар учитывает долю готовых страниц. `report/[id]/page.tsx` хранит `progress` из каждого полла.
- Тесты: `tests/test_progress.py` (17 passed всего). E2E вживую подтверждён (search→fetch→extract→analyze→completed) + UI показал лист статей и разведённые gap-шаги. tsc чист. Бэкенд перезапущен, миграции применены (таблица + колонка на месте).

## Recent Changes (2026-08-10, resilient pipeline: gap fallback)

При зависании/сбое LLM-вызовов анализ больше НЕ падает в `failed` — отчёт собирается с тем, что уже извлечено:
- **`analyzer.py`**: `GAP_TIMEOUT_SECONDS = 180`; `analyze_gaps` обёрнут в `asyncio.wait_for` + `except → gaps=[]` (лог `[id] Gap analysis failed ... building report with available data`). UI получит completed-отчёт: сущности, граф, coverage, но пустые gaps/checklist.
- **`analyzer.py`**: `extract_for_page` обёрнут в try/except — одна упавшая/зависшая страница пропускается (`entities=[]`), остальные извлекаются.
- Кэш `entities_cache` не сбрасывается при рестарте — повторный анализ подхватит уже извлечённые страницы мгновенно.
- Тесты: `tests/test_analyzer_resilience.py` (2 шт., моки без LLM): `test_gap_failure_still_builds_report`, `test_extract_failure_skips_only_broken_page`. Прогон: `./venv/bin/python3 -m pytest tests/ -q` → 15 passed (1 pre-existing error в test_prompts.py: хелпер назван `def test()` — pytest считает его тестом с фикстурой `name`; не трогать, файл жжёт реальные LLM-вызовы).
