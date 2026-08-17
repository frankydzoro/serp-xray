# SERP-рентген 🔍

Локальный веб-инструмент для конкурентного анализа поисковой выдачи. Принимает поисковый запрос → парсит топ-20 через SerpAPI → через OpenRouter (LLM) извлекает Knowledge Graph сущности из каждой страницы → сравнивает с вашей страницей → строит граф разрывов → выдаёт приоритизированный чек-лист действий.

## Что это

Инструмент помогает SEO-специалистам быстро понять:
- Какие сущности (Person, Organization, Concept, Product, Event) присутствуют в топе выдачи
- Какие из них отсутствуют на вашей странице
- Насколько ваша страница отстаёт по entity-покрытию
- Что конкретно нужно добавить (чек-лист с приоритетами)

## Стек

| Уровень | Технология |
|---------|-----------|
| Бэкенд  | Python 3.11+, FastAPI, httpx, Pydantic |
| LLM     | OpenRouter API (openai/gpt-4o, claude-sonnet-4, gemini-2.5-flash — сменная модель) |
| Поиск   | SerpAPI (Google organic results, топ-20) |
| Фронтенд | TypeScript, Next.js 14, shadcn/ui, D3.js |
| БД      | SQLite (история запросов, настройки) |

## Запуск локально

### 1. Бэкенд

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

> Авторизация: с недавних пор backend **не стартует** без `SERPXRAY_ADMIN_PASSWORD`
> (fail-fast). Для локального запуска: либо задайте его в `backend/.env`, либо
> `SERPXRAY_AUTH_DISABLED=1` (только для разработки). Фронтенд попросит пароль
> на `/login` (токен живёт в `sessionStorage`).

### 2. Фронтенд

```bash
cd frontend
npm install
npm run dev
```

### 3. Открыть

- Приложение: http://localhost:3000
- Swagger API: http://localhost:8000/docs (требует `X-Auth-Token`)

## Запуск в проде (Docker)

Полный стек — `docker-compose.yml` (backend + frontend + Caddy для HTTPS):

```bash
cp .env.example .env   # заполнить ключи + пароль + домен
docker compose up -d --build
```

- **HTTPS обязателен**: Caddy выпускает Let's Encrypt для `SERPXRAY_DOMAIN`
  автоматически. Без HTTPS пароль и токен идут открытым текстом — не выключать.
- Backend-порт `8000` наружу **не публикуется** — доступ только через Next
  (`/api/*` проксируется rewrites, единый origin).
- Данные: SQLite в volume `serp_data` (переживает рестарты и пересборки).
  Бэкап одной командой:
  ```bash
  docker compose exec backend sh -c 'cat /app/data/serp-xray.db' > serp-xray-$(date +%F).db
  ```
- Перед обновлением образа — сделайте бэкап БД (см. выше). Схема применяется
  идемпотентно при старте backend (`init_db()`), Alembic не используется.

### Известные ограничения прод-режима

- **SSRF-защита**: блокирует private/loopback/link-local + cloud metadata IP,
  DNS-запросы идут на проверенный IP (pinning), редиректы проверяются походово.
  Полная защита от DNS-rebinding с гонкой внутри TCP-хендшейка **не** реализована
  (для этого нужен кастомный резолвер на уровне сокета) — для личного
  инструмента это осознанный компромисс.
- **Rate limit** сбрасывается при рестарте контейнера — это защита от всплесков,
  не от целевого злоумышленника (главная защита — пароль + HTTPS).
- Один uvicorn-воркер намеренно (SQLite + in-memory rate limit).

## Переменные окружения

В prod: ключи и настройки в `.env` (см. `.env.example`). В dev ключи по-прежнему
подхватываются из `~/.hermes/.env` (legacy), приоритет: окружение → `backend/.env`
→ `~/.hermes/.env`.

## Возможности

- 🔍 Анализ любого поискового запроса — топ-20 organic results
- 🧠 Извлечение Knowledge Graph сущностей через LLM
- 📊 Визуализация графа сущностей (D3.js force-directed graph)
- 🆚 Сравнение вашей страницы с топ-3 выдачи
- 📋 Приоритизированный чек-лист действий (critical → low)
- ⚙️ Админ-панель: смена модели OpenRouter, редактирование промптов
- 📜 История всех анализов (SQLite)

## Модели OpenRouter (по умолчанию)

| Модель | Особенность |
|--------|------------|
| `openai/gpt-4o` | Баланс цена/качество (по умолчанию) |
| `anthropic/claude-sonnet-4` | Лучшее качество извлечения сущностей |
| `google/gemini-2.5-flash` | Быстрый и дешёвый |
| `deepseek/deepseek-v4-pro` | Хорош для русского языка |

Модель можно сменить в админ-панели без перезапуска.

---

*Создано как часть Agent OS. Исследования: `research/2026-08-07-ai-seo-marketing-ideas`, `research/2026-08-07-ai-seo-deep-dive`*