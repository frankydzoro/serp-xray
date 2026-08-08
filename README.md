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

### 2. Фронтенд

```bash
cd frontend
npm install
npm run dev
```

### 3. Открыть

- Приложение: http://localhost:3000
- Swagger API: http://localhost:8000/docs

## Переменные окружения

Необходимы ключи в `~/.hermes/.env`:

```
OPENROUTER_API_KEY=sk-or-...
SERPAPI_API_KEY=...
```

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