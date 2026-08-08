import json
from openai import AsyncOpenAI
from config import OPENROUTER_API_KEY, OPENROUTER_BASE_URL, DEFAULT_MODEL
from prompts.default import GAP_ANALYSIS_PROMPT
from db import get_setting


async def analyze_gaps(
    user_entities: list[dict],
    competitor_entities: list[dict],
    model: str | None = None,
    query: str = "",
) -> list[dict]:
    """Сравнивает сущности пользователя со ВСЕМИ сущностями конкурентов из топа выдачи.

    competitor_entities — уже сгруппированные сущности:
        [{name, type, frequency, descriptions: [...], source_urls: [...]}, ...]

    Returns:
        [{entity, entity_type, priority, competitor_description, recommendation,
          found_in_competitors, found_in_user_page}, ...]
    """
    if not competitor_entities:
        return []

    # Быстрый pre-check для quick-gaps (без URL пользователя)
    if len(user_entities) == 0 and competitor_entities:
        seen = set()
        quick_gaps = []
        for e in competitor_entities:
            name = e.get("name", "")
            if name and name.lower() not in seen:
                seen.add(name.lower())
                freq = e.get("frequency", 1)
                # Выбираем лучшее описание (первое непустое)
                descriptions = e.get("descriptions", [])
                best_desc = next((d for d in descriptions if d), "")
                quick_gaps.append({
                    "entity": name,
                    "entity_type": e.get("type", "Concept"),
                    "found_in_competitors": True,
                    "found_in_user_page": False,
                    "priority": "critical" if freq >= 2 else "high",
                    "competitor_description": best_desc,
                    "recommendation": f"Add information about '{name}' to the page",
                })
        quick_gaps.sort(key=lambda g: {"critical": 0, "high": 1}.get(g["priority"], 1))
        return quick_gaps[:20]

    # LLM-based gap analysis
    model = model or get_setting("model") or DEFAULT_MODEL
    prompt_template = get_setting("gap_prompt") or GAP_ANALYSIS_PROMPT

    # Формируем читаемые списки для LLM
    user_str = json.dumps(user_entities, ensure_ascii=False, indent=2)
    competitor_str = json.dumps(competitor_entities, ensure_ascii=False, indent=2)

    prompt = prompt_template.format(
        user_entities=user_str,
        competitor_entities=competitor_str,
        query=query,
    )

    client = AsyncOpenAI(
        api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE_URL,
    )

    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.1,
        timeout=60,
    )

    content = resp.choices[0].message.content
    if not content:
        return []

    try:
        data = json.loads(content)
        gaps = data.get("gaps", [])
        if not isinstance(gaps, list):
            return []
    except json.JSONDecodeError:
        return []

    # Обогащаем каждый gap
    user_names = {e.get("name", "").lower() for e in user_entities}
    for g in gaps:
        g.setdefault("entity_type", "Concept")
        g.setdefault("priority", "medium")
        g.setdefault("competitor_description", "")
        g.setdefault("recommendation", f"Add information about {g['entity']}")
        g["found_in_competitors"] = True
        g["found_in_user_page"] = g["entity"].lower() in user_names

    # Сортируем по приоритету
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    gaps.sort(key=lambda g: priority_order.get(g.get("priority", "medium"), 2))

    return gaps