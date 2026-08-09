import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException
from openai import AsyncOpenAI

from config import DEFAULT_MODEL, OPENROUTER_API_KEY, OPENROUTER_BASE_URL
from db import (
    fail_rewrite,
    get_analysis,
    get_rewrite,
    get_setting,
    save_rewrite,
    start_rewrite,
)
from models.schemas import RewriteRequest, RewriteResponse, RewriteResult
from prompts.default import REWRITE_SYSTEM_PROMPT, REWRITE_USER_PROMPT

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["rewrite"])

# Таймаут одного LLM-вызова (rewrite — крупная задача: статья + gaps)
LLM_TIMEOUT_SECONDS = 180


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


async def _run_rewrite(
    analysis_id: str,
    article_text: str,
    gaps: list[dict],
    model: str,
    system_prompt: str,
    user_template: str,
):
    """Фоновая задача: вызывает LLM и сохраняет результат в БД."""
    gaps_text = _format_gaps_for_prompt(gaps)
    try:
        user_prompt = user_template.format(
            article_text=article_text,
            gaps=gaps_text,
        )
    except KeyError as e:
        logger.warning("Rewrite user prompt has invalid placeholder %s, falling back to default", e)
        user_prompt = REWRITE_USER_PROMPT.format(
            article_text=article_text,
            gaps=gaps_text,
        )

    client = AsyncOpenAI(
        api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE_URL,
    )

    try:
        logger.info("[%s] Rewrite started (model=%s, gaps=%d, article=%d chars)",
                    analysis_id, model, len(gaps), len(article_text))
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            timeout=LLM_TIMEOUT_SECONDS,
        )
    except Exception as e:
        logger.exception("[%s] Rewrite LLM call failed", analysis_id)
        fail_rewrite(analysis_id, f"LLM call failed: {e}")
        return

    content = resp.choices[0].message.content
    if not content or not content.strip():
        logger.error("[%s] Rewrite returned empty content", analysis_id)
        fail_rewrite(analysis_id, "Empty response from LLM")
        return

    rewritten_text = content.strip()
    save_rewrite(analysis_id, rewritten_text)
    logger.info("[%s] Rewrite completed (%d chars)", analysis_id, len(rewritten_text))


@router.post("/rewrite", response_model=RewriteResponse)
async def rewrite_article(req: RewriteRequest, background_tasks: BackgroundTasks) -> RewriteResponse:
    """Запускает переписывание статьи в фоне.

    Возвращает статус немедленно; результат доступен через
    GET /api/history/{analysis_id}/rewrite (поллинг).
    Если rewrite уже выполняется — не дублирует запрос.
    """
    if not req.analysis_id:
        raise HTTPException(status_code=400, detail="analysis_id is required")

    analysis = get_analysis(req.analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    state = get_rewrite(req.analysis_id)

    # Уже выполняется — не дублируем
    if state["status"] == "running":
        return RewriteResponse(
            rewritten_text="",
            rewritten_at="",
            status="running",
            started_at=state["started_at"],
        )

    # Уже готово — возвращаем результат (повторная генерация не нужна)
    if state["status"] == "completed" and state["rewritten_text"]:
        return RewriteResponse(
            rewritten_text=state["rewritten_text"],
            rewritten_at=state["rewritten_at"],
            status="completed",
            started_at=state["started_at"],
        )

    if not req.article_text.strip():
        raise HTTPException(status_code=400, detail="article_text is empty")
    if not req.gaps:
        raise HTTPException(status_code=400, detail="gaps list is empty")

    model = req.model or get_setting("rewrite_model") or DEFAULT_MODEL
    system_prompt = get_setting("rewrite_system_prompt") or REWRITE_SYSTEM_PROMPT
    user_template = get_setting("rewrite_user_prompt") or REWRITE_USER_PROMPT

    started_at = start_rewrite(req.analysis_id)
    logger.info("[%s] Rewrite queued", req.analysis_id)

    background_tasks.add_task(
        _run_rewrite,
        req.analysis_id,
        req.article_text,
        req.gaps,
        model,
        system_prompt,
        user_template,
    )

    return RewriteResponse(
        rewritten_text="",
        rewritten_at="",
        status="running",
        started_at=started_at or datetime.now(timezone.utc).isoformat(),
    )


@router.get("/rewrite/{analysis_id}/status", response_model=RewriteResult)
async def rewrite_status(analysis_id: str) -> RewriteResult:
    """Поллинг статуса rewrite. Авто-таймаут застрявших — внутри get_rewrite()."""
    state = get_rewrite(analysis_id)
    if state["status"] == "not_found":
        raise HTTPException(status_code=404, detail="Analysis not found")
    return RewriteResult(**state)
