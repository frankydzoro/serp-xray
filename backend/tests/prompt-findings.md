# SERP X-Ray — Prompt Remediation Plan

## Результаты тестирования: 26/28 passed, 2 failed

---

## Entity Extraction Prompt

### Найдено

| # | Тест | Статус | Детали |
|---|------|--------|--------|
| 1 | Валидный JSON без markdown | PASS | — |
| 2 | Лимит ≤15 сущностей | **FAIL** | 16 вместо 15 |
| 3 | Пустой текст → [] | PASS | — |
| 4 | Boilerplate (меню/футер/cookie) → [] | PASS | — |
| 5 | Confidence в [0,1] | PASS | — |
| 6 | Нет confidence <0.5 | PASS | — |
| 7 | Дедупликация имён | PASS | Но «OpenAI» и «Open AI Inc.» — разные |
| 8 | Нет generic-слов | **FAIL** | «стулья», «доставка» извлечены |
| 9 | Воспроизводимость (temp=0) | PASS | 70%+ overlap |
| 10 | Типы: Product vs Organization | PASS | Salesforce=Org, Sales Cloud=Product |
| 11 | Типы: Metric vs Concept | PASS | Числа с контекстом → Metric |

### Проблемы и доработки

#### ❌ 1. Лимит сущностей нарушен (16 вместо 15)

**Причина:** модель игнорирует текстовое ограничение в середине промпта.

**Исправление:** дублировать ограничение в конце, перед форматом ответа:
```
Верни не более 15 сущностей. Если сущностей больше — оставь 15 наиболее релевантных.
```

#### ❌ 2. Common nouns извлекаются как сущности

**Причина:** «стулья», «доставка» — общие существительные без бренда/имени собственного.

**Исправление:** добавить в правила:
```
НЕ извлекай: нарицательные существительные без имени собственного 
(«стулья», «доставка», «ремонт», «услуги»), общие категории товаров 
без бренда, глаголы и прилагательные как сущности.
```
И добавить few-shot negative example:
```
Плохо: {"name": "стулья", "type": "Product"}
Хорошо: не извлекать (нет бренда/модели)
```

#### ⚠️ 3. Нормализация не сработала

**Причина:** «OpenAI» и «Open AI Inc.» — разные строки. Нужен явный пример.

**Исправление:** добавить few-shot пример:
```
Пример дедупликации:
Вход: «OpenAI», «Open AI», «OpenAI Inc.»
Выход: одна сущность с name: «OpenAI»
```

---

## Gap Analysis Prompt

### Найдено

| # | Тест | Статус |
|---|------|--------|
| G1 | Валидный JSON без markdown | PASS |
| G2 | Разрывы найдены | PASS |
| G3 | Лимит ≤10 gaps | PASS |
| G4 | Все поля валидны | PASS |
| G5 | Направление top3→user | PASS |
| G6 | Нет дублей | PASS |
| G7 | Сортировка по priority | PASS |
| G8 | Рекомендации конкретны | PASS |
| G9 | Нет выдуманных сущностей | PASS |
| G10 | Пустые входы → [] | PASS |
| G11 | Идентичные списки → [] | PASS |

### Потенциальные улучшения

#### ⚠️ 1. Частотность сущностей

**Текущее:** сущности топ-3 передаются плоским списком с дублями (если сущность есть на 2+ страницах, она повторяется). LLM должен сам посчитать частоту.

**Риск:** на gpt-4o-mini подсчёт может быть неточным.

**Исправление:** на стороне бэкенда предварительно группировать сущности по страницам и передавать метаинформацию:
```json
{"entity": "HubSpot", "type": "Product", "pages": 2, "positions": [1, 3]}
```
ИЛИ добавить в промпт: «Сущности могут дублироваться — дубликат означает, что сущность найдена на ещё одной странице топ-3.»

#### ⚠️ 2. Якорь темы

**Текущее:** тема определяется «по набору и концентрации сущностей пользователя».

**Риск:** если страница пользователя маленькая или нерелевантная, якорь слабый.

**Исправление:** передавать search query в промпт как дополнительную переменную:
```
Тема запроса: {query}
```
Это даст LLM явный якорь для фильтрации релевантности.

---

## Remediation Implementation Plan

### Срочно (Prompt)

1. **Entity Extraction** — усилить лимит, добавить anti-hallucination rule, few-shot normalisation
2. **Gap Analysis** — добавить `{query}` как якорь темы

### Код (Backend)

3. **analyzer.py** — передавать `query` в `analyze_gaps()`
4. **gap_analyzer.py** — добавить `query` параметр и передавать в промпт
5. **schemas.py** — не требует изменений

### Опционально (Код)

6. **entity_extractor.py** — добавить post-processing: фильтрация common words по словарю
7. **analyzer.py** — группировать top3_entities по страницам перед gap-анализом

---

## Эталонные ответы ожидаемых результатов

### Entity Extraction (текст про CRM)

```json
{
  "entities": [
    {"name": "Salesforce CRM", "type": "Product", "confidence": 0.95},
    {"name": "Gmail", "type": "Product", "confidence": 0.9},
    {"name": "Outlook", "type": "Product", "confidence": 0.9},
    {"name": "HubSpot", "type": "Product", "confidence": 0.85},
    {"name": "Zoho CRM", "type": "Product", "confidence": 0.85},
    {"name": "Gartner", "type": "Organization", "confidence": 0.9},
    {"name": "Microsoft Dynamics 365", "type": "Product", "confidence": 0.85},
    {"name": "Marc Benioff", "type": "Person", "confidence": 0.9},
    {"name": "San Francisco", "type": "Location", "confidence": 0.85},
    {"name": "Slack", "type": "Product", "confidence": 0.8},
    {"name": "Zoom", "type": "Product", "confidence": 0.8},
    {"name": "Google Workspace", "type": "Product", "confidence": 0.8},
    {"name": "$89 billion", "type": "Metric", "confidence": 0.9},
    {"name": "$25/user/month", "type": "Metric", "confidence": 0.85},
    {"name": "CRM market", "type": "Concept", "confidence": 0.7}
  ]
}
```

### Gap Analysis (CRM example)

```json
{
  "gaps": [
    {"entity": "HubSpot", "entity_type": "Product", "priority": "critical", "recommendation": "..."},
    {"entity": "Zoho CRM", "entity_type": "Product", "priority": "high", "recommendation": "..."},
    {"entity": "воронка продаж", "entity_type": "Concept", "priority": "medium", "recommendation": "..."}
  ]
}
```