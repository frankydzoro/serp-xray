import json
from openai import AsyncOpenAI
from config import OPENROUTER_API_KEY, OPENROUTER_BASE_URL, DEFAULT_MODEL
from prompts.default import GAP_ANALYSIS_PROMPT
from db import get_setting


async def analyze_gaps(
    user_entities: list[dict],
    top3_entities: list[dict],
    model: str | None = None,
    query: str = "",
) -> list[dict]:
    """Сравнивает сущности пользователя с топ-3 и находит разрывы через LLM.

    Returns:
        [{entity, entity_type, priority, recommendation}, ...]
    """
    if not top3_entities:
        return []

    # Быстрый pre-check: какие сущности из топ-3 отсутствуют у пользователя
    user_names = {e.get("name", "").lower() for e in user_entities}
    top3_names = {e.get("name", "").lower() for e in top3_entities}

    # Если пользователь не передал URL  все топ3-сущности = разрывы (без LLM)
    if len(user_entities) == 0 and top3_entities:
        seen = set()
        quick_gaps = []
        for e in top3_entities:
            name = e.get("name", "")
            if name and name.lower() not in seen:
                seen.add(name.lower())
                quick_gaps.append({
                    "entity": name,
                    "entity_type": e.get("type", "Concept"),
                    "found_in_top3": True,
                    "found_in_user_page": False,
                    "priority": "high",
                    "recommendation": f"Add information about '{name}' to the page",
                })
        # Сортируем: сначала критические (встречаются 2+ раза)
        name_counts = {}
        for e in top3_entities:
            n = e.get("name", "").lower()
            name_counts[n] = name_counts.get(n, 0) + 1
        for g in quick_gaps:
            if name_counts.get(g["entity"].lower(), 0) >= 2:
                g["priority"] = "critical"
        quick_gaps.sort(key=lambda g: {"critical": 0, "high": 1}.get(g["priority"], 1))
        return quick_gaps[:20]

    missing_names = top3_names - user_names
    if not missing_names:
        return []

    model = model or get_setting("model") or DEFAULT_MODEL
    prompt_template = get_setting("gap_prompt") or GAP_ANALYSIS_PROMPT

    # Формируем читаемые списки для LLM
    user_str = json.dumps(user_entities, ensure_ascii=False, indent=2)
    top3_str = json.dumps(top3_entities, ensure_ascii=False, indent=2)

    prompt = prompt_template.format(
        user_entities=user_str,
        top3_entities=top3_str,
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

    # Обогащаем каждый gap полями found_in_top3 / found_in_user_page
    for g in gaps:
        g.setdefault("entity_type", "Concept")
        g.setdefault("priority", "medium")
        g.setdefault("recommendation", f"Add information about {g['entity']}")
        g["found_in_top3"] = True
        g["found_in_user_page"] = g["entity"].lower() in user_names

    # Сортируем по приоритету
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    gaps.sort(key=lambda g: priority_order.get(g.get("priority", "medium"), 2))

    return gaps