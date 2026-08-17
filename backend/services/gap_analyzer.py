import json
from openai import AsyncOpenAI
from config import OPENROUTER_API_KEY, OPENROUTER_BASE_URL, DEFAULT_MODEL
from prompts.default import GAP_ANALYSIS_PROMPT
from db import get_setting


def _find_entity_description(entity_name: str, competitor_entities: list[dict]) -> str:
    """Looks up an entity description in the grouped competitor data.
    If there is no description — generates a fallback from name + type."""
    name_lower = entity_name.lower()
    for ce in competitor_entities:
        if ce.get("name", "").lower() == name_lower:
            descriptions = ce.get("descriptions", [])
            best_desc = next((d for d in descriptions if d), "")
            if best_desc:
                return best_desc
            return f"{ce.get('type', 'Concept')}: {ce.get('name', entity_name)}"
    return f"Entity: {entity_name}"


async def analyze_gaps(
    user_entities: list[dict],
    competitor_entities: list[dict],
    model: str | None = None,
    query: str = "",
) -> list[dict]:
    """Compares the user's entities against ALL competitor entities from the top of the SERP.

    competitor_entities — already grouped entities:
        [{name, type, frequency, descriptions: [...], source_urls: [...]}, ...]

    Returns:
        [{entity, entity_type, priority, competitor_description, recommendation,
          found_in_competitors, found_in_user_page}, ...]
    """
    if not competitor_entities:
        return []

    # Fast pre-check for quick-gaps (no user URL)
    if len(user_entities) == 0 and competitor_entities:
        seen = set()
        quick_gaps = []
        for e in competitor_entities:
            name = e.get("name", "")
            if name and name.lower() not in seen:
                seen.add(name.lower())
                freq = e.get("frequency", 1)
                # Pick the best description (first non-empty)
                descriptions = e.get("descriptions", [])
                best_desc = next((d for d in descriptions if d), "")
                if not best_desc:
                    best_desc = f"{e.get('type', 'Concept')}: {name}"
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

    # Build readable lists for the LLM
    user_str = json.dumps(user_entities, ensure_ascii=False, indent=2)
    competitor_str = json.dumps(competitor_entities, ensure_ascii=False, indent=2)

    try:
        prompt = prompt_template.format(
            user_entities=user_str,
            competitor_entities=competitor_str,
            query=query,
        )
    except KeyError as e:
        import logging
        logging.getLogger(__name__).warning(
            "Gap prompt in DB has invalid placeholder %s, falling back to default", e
        )
        prompt = GAP_ANALYSIS_PROMPT.format(
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
        timeout=30,
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

    # Enrich each gap
    user_names = {e.get("name", "").lower() for e in user_entities}
    for g in gaps:
        g.setdefault("entity_type", "Concept")
        g.setdefault("priority", "medium")
        g.setdefault("recommendation", f"Add information about {g['entity']}")
        g["found_in_competitors"] = True
        g["found_in_user_page"] = g["entity"].lower() in user_names
        # If the LLM returned no description — look it up in the original competitor data
        if not g.get("competitor_description"):
            g["competitor_description"] = _find_entity_description(
                g["entity"], competitor_entities
            )

    # Sort by priority
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    gaps.sort(key=lambda g: priority_order.get(g.get("priority", "medium"), 2))

    return gaps
