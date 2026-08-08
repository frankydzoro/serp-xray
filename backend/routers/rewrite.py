import json
import logging

from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI

from config import DEFAULT_MODEL, OPENROUTER_API_KEY, OPENROUTER_BASE_URL
from db import get_setting
from models.schemas import RewriteRequest, RewriteResponse
from prompts.default import REWRITE_SYSTEM_PROMPT, REWRITE_USER_PROMPT

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["rewrite"])


def _format_gaps_for_prompt(gaps: list[dict]) -> str:
    """Форматирует список gap-сущностей в читаемый текст для промпта."""
    lines: list[str] = []
    for i, g in enumerate(gaps, 1):
        entity = g.get("entity", "—")
        etype = g.get("entity_type", "Concept")
        priority = g.get("priority", "medium")
        description = g.get("competitor_description", "") or g.get("description", "")
        recommendation = g.get("recommendation", "")

        line = f"{i}. **{entity}** ({etype}, приоритет: {priority})"
        if description:
            line += f"\n   Описание: {description}"
        if recommendation:
            line += f"\n   Рекомендация: {recommendation}"
        lines.append(line)

    return "\n\n".join(lines)


@router.post("/rewrite", response_model=RewriteResponse)
async def rewrite_article(req: RewriteRequest) -> RewriteResponse:
    """Принимает текст статьи и список gap-сущностей, возвращает дополненную статью."""
    model = req.model or get_setting("rewrite_model") or DEFAULT_MODEL
    system_prompt = get_setting("rewrite_system_prompt") or REWRITE_SYSTEM_PROMPT
    user_template = get_setting("rewrite_user_prompt") or REWRITE_USER_PROMPT

    # Форматируем gaps для вставки в промпт
    gaps_text = _format_gaps_for_prompt(req.gaps)

    # Подставляем плейсхолдеры
    try:
        user_prompt = user_template.format(
            article_text=req.article_text,
            gaps=gaps_text,
        )
    except KeyError as e:
        logger.warning("Rewrite user prompt has invalid placeholder %s, falling back to default", e)
        user_prompt = REWRITE_USER_PROMPT.format(
            article_text=req.article_text,
            gaps=gaps_text,
        )

    client = AsyncOpenAI(
        api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE_URL,
    )

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            timeout=120,
        )
    except Exception as e:
        logger.exception("OpenRouter rewrite failed")
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")

    content = resp.choices[0].message.content
    if not content:
        raise HTTPException(status_code=500, detail="Empty response from LLM")

    return RewriteResponse(rewritten_text=content.strip())