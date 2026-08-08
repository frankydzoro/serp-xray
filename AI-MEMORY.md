# AI Memory — SERP X-Ray

> For any AI agent working on this project. Load this file first.

## Project

SERP X-Ray — local web tool for competitive SERP entity analysis.  
Takes a search query → fetches top-20 via SerpAPI (Google/Yandex/both) → extracts Knowledge Graph entities via OpenRouter LLM → compares against user's page → builds gap graph + prioritized checklist.

**Path:** `~/serp-xray/`  
**Git:** initialized, 3 commits on `main`  
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

## Directory Layout

```
~/serp-xray/
├── backend/
│   ├── main.py              # FastAPI entry, CORS, startup
│   ├── config.py            # OpenRouter/SerpAPI keys, defaults
│   ├── db.py                # SQLite: analyses, settings, entities_cache
│   ├── routers/
│   │   ├── analyzer.py      # POST /api/analyze — main pipeline
│   │   ├── admin.py         # Model & prompts CRUD
│   │   └── history.py       # History list, detail, delete, bulk-delete
│   ├── services/
│   │   ├── serp.py          # SerpAPI: fetch_top20(engine), fetch_page_text()
│   │   ├── entity_extractor.py  # OpenRouter LLM → entities + post-process
│   │   └── gap_analyzer.py  # Gap detection: quick-gaps + LLM fallback
│   ├── models/schemas.py    # Pydantic: AnalyzeRequest, GapItem, AnalysisReport
│   ├── prompts/default.py   # Default prompts (fallback, overridden via DB)
│   ├── tests/
│   │   ├── test_prompts.py  # 28 systematic prompt tests
│   │   └── prompt-findings.md # Remediation plan (all items completed)
│   └── venv/                # Python 3.11.15
├── frontend/
│   ├── app/                 # Next.js App Router
│   │   ├── layout.tsx       # Root layout with nav
│   │   ├── page.tsx         # Main: QueryForm + tabs (overview/graph/gaps/checklist)
│   │   ├── admin/page.tsx   # Model selector + prompt editors
│   │   ├── history/page.tsx # Checkbox table + bulk operations
│   │   └── report/[id]/page.tsx  # Report detail + PDF/MD download
│   ├── components/
│   │   ├── QueryForm.tsx    # Query input + engine selector + URL field
│   │   ├── EntityGraph.tsx  # D3.js force-directed entity graph
│   │   ├── GapTable.tsx     # Gaps table with priority badges + URL links
│   │   ├── Checklist.tsx    # Numbered checklist
│   │   ├── ReportSkeleton.tsx  # Animated 5-stage progress loader
│   │   └── AdminPrompts.tsx # Model select + prompt textareas
│   ├── lib/
│   │   ├── api.ts           # Fetch wrappers for all backend endpoints
│   │   └── export.ts        # downloadMarkdown() + downloadPDF() (jsPDF + Roboto font)
│   └── package.json         # Next.js 16, shadcn/ui, d3, jspdf
└── data/serp-xray.db        # SQLite (created on first run)
```

## Key Architecture Decisions

1. **No migrations.** `init_db()` creates tables IF NOT EXISTS.
2. **Python 3.11 required** — `str | None` syntax. System python3 is 3.9; venv uses `/Users/petergrish/.hermes/hermes-agent/venv/bin/python3.11`.
3. **Uvicorn must run via `python -m uvicorn`**, not bare `uvicorn` — global uvicorn conflicts with venv.
4. **Prompts are DB-driven.** `default.py` is fallback. Admin edits → `settings` table. Reset restores from `default.py`.
5. **English-only UI.** All visible text in English. Backend prompts in Russian (user's choice — content is Russian).
6. **No emojis.** Removed from all source files.
7. **Two gap-analysis modes:**
   - **Quick-gaps** (no user URL): all top-3 entities → gaps, priority by `frequency` field
   - **LLM** (with user URL): gap analysis via OpenRouter with `query` as topic anchor

## Database Schema

```sql
analyses (id TEXT PK, query TEXT, url TEXT, result_json TEXT, model_used TEXT, created_at TEXT)
settings (key TEXT PK, value TEXT)  -- model, entity_prompt, gap_prompt
entities_cache (url TEXT PK, entities_json TEXT, extracted_at TEXT)
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/analyze | Main pipeline: query + engine → report |
| GET | /api/history | List analyses (last 50) |
| GET | /api/history/{id} | Full report with result_json |
| DELETE | /api/history/{id} | Delete single |
| POST | /api/history/bulk-delete | `{ids: [...]}` |
| GET | /api/admin/model | Current model |
| PUT | /api/admin/model | `{model: "..."}` |
| GET | /api/admin/prompts | Current prompts |
| PUT | /api/admin/prompts | `{entity_prompt, gap_prompt}` |
| POST | /api/admin/prompts/reset | Restore defaults |

## Prompt Design (Critical)

### Entity Extraction
- Types: Person, Organization, Concept, Product, Event, Location, Metric
- Product > Organization (Salesforce=Org, Sales Cloud=Product)
- Metric > Concept (if numeric value present)
- Maximum 15 entities, sorted by confidence descending
- Post-processing: truncate to 15 + stop-words filter
- Stop-words: доставка, ремонт, услуги, сервис, компания, решение, пользователи, стулья, столы, etc.

### Gap Analysis
- Direction: top-3 → user ONLY
- Topic anchor: `{query}` helps LLM filter relevance
- `frequency` field: entity appears on N top-3 pages → critical if ≥2
- Deduplication: same entity different forms → one gap
- Max 10 gaps, sorted by priority

### Known LLM Behaviors
- gpt-4o-mini ignores "max 15 entities" in text → hard post-process truncate needed
- LLM extracts common nouns without anti-hallucination rules → explicit negative examples help
- Confidence is stable at temp=0, but values cluster at 0.9 — discrete scale (0.5/0.7/0.9/1.0) could reduce noise

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

## OpenRouter

- API key: `~/.hermes/.env` as `OPENROUTER_API_KEY`
- Base URL: `https://openrouter.ai/api/v1`
- Model set in DB `settings`, default `openai/gpt-4o`
- Available: `openai/gpt-4o`, `anthropic/claude-sonnet-4`, `google/gemini-2.5-flash`, `deepseek/deepseek-v4-pro`
- Tests use `openai/gpt-4o-mini` (cheap)
- SDK: `openai` Python client with `base_url` override