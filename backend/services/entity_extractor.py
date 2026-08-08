import json
from openai import AsyncOpenAI
from config import OPENROUTER_API_KEY, OPENROUTER_BASE_URL, DEFAULT_MODEL, MAX_PAGE_CHARS
from prompts.default import ENTITY_EXTRACTION_PROMPT
from db import get_setting


async def extract_entities(page_text: str, url: str, model: str | None = None) -> list[dict]:
    """Извлекает сущности из текста страницы через OpenRouter LLM.

    Returns:
        [{name, type, confidence, source_url}, ...]
    """
    model = model or get_setting("model") or DEFAULT_MODEL
    prompt_template = get_setting("entity_prompt") or ENTITY_EXTRACTION_PROMPT

    # Обрезаем текст до лимита
    truncated_text = page_text[:MAX_PAGE_CHARS]
    try:
        prompt = prompt_template.format(page_text=truncated_text)
    except KeyError as e:
        import logging
        logging.getLogger(__name__).warning(
            "Entity prompt in DB has invalid placeholder %s, falling back to default", e
        )
        prompt = ENTITY_EXTRACTION_PROMPT.format(page_text=truncated_text)

    client = AsyncOpenAI(
        api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE_URL,
    )

    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.1,
        timeout=30,
    )

    content = resp.choices[0].message.content
    if not content:
        return []

    try:
        data = json.loads(content)
        entities = data.get("entities", [])
    except json.JSONDecodeError:
        # Иногда LLM возвращает массив напрямую
        try:
            entities = json.loads(content)
            if not isinstance(entities, list):
                return []
        except json.JSONDecodeError:
            return []

    # Добавляем source_url и fallback description к каждой сущности
    for e in entities:
        if not e.get("description"):
            e["description"] = f"{e.get('type', 'Entity')}: {e.get('name', 'Unknown')}"
        e["source_url"] = url

    # Post-processing: сортируем по confidence и обрезаем до 15
    entities.sort(key=lambda e: e.get("confidence", 0), reverse=True)

    # Фильтр common words — удаляем заведомо не-сущности
    stop_entities = {
        "доставка", "ремонт", "услуги", "сервис", "компания",
        "решение", "пользователи", "клиенты", "товар", "услуга",
        "продукт", "система", "платформа", "приложение",
        "главная", "контакты", "о нас", "каталог",
        "стулья", "столы", "одежда", "обувь", "еда",
    }
    entities = [e for e in entities if e.get("name", "").lower() not in stop_entities]

    return entities[:15]