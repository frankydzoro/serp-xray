import uuid
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from models.schemas import AnalyzeRequest, AnalysisReport, Entity, GapItem
from services.serp import fetch_top20, fetch_page_text
from services.entity_extractor import extract_entities
from services.gap_analyzer import analyze_gaps
from db import save_analysis, get_cached_entities, cache_entities, get_setting

router = APIRouter(prefix="/api", tags=["analyzer"])

# Семафор для ограничения конкурентных запросов к LLM
SEMAPHORE = asyncio.Semaphore(5)


async def _extract_with_cache(url: str, text: str, model: str) -> list[dict]:
    """Извлекает сущности с кэшированием."""
    cached = get_cached_entities(url)
    if cached:
        return cached

    entities = await extract_entities(text, url, model)
    if entities:
        cache_entities(url, entities)
    return entities


@router.post("/analyze", response_model=AnalysisReport)
async def analyze(req: AnalyzeRequest):
    """Основной pipeline анализа поисковой выдачи."""
    model = get_setting("model") or "openai/gpt-4o"
    analysis_id = str(uuid.uuid4())[:12]
    started_at = datetime.now(timezone.utc)

    # 1. Получаем топ-20 из SerpAPI
    try:
        serp_results = await fetch_top20(req.query, req.engine)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SerpAPI error: {str(e)}")

    if not serp_results:
        raise HTTPException(status_code=404, detail="No results found for query")

    # 2. Загружаем текст каждой страницы (топ-10 для скорости, остальные  сниппеты)
    async def fetch_text(r):
        try:
            text = await fetch_page_text(r["url"])
            return {"url": r["url"], "title": r["title"], "text": text, "position": r["position"]}
        except Exception:
            # fallback: используем сниппет
            return {"url": r["url"], "title": r["title"], "text": r["snippet"], "position": r["position"]}

    # Параллельная загрузка топ-10
    top10 = serp_results[:10]
    pages = await asyncio.gather(*(fetch_text(r) for r in top10))

    # 3. Извлекаем сущности для каждой страницы (с кэшем)
    async def extract_for_page(p):
        async with SEMAPHORE:
            entities = await _extract_with_cache(p["url"], p["text"], model)
            return {"url": p["url"], "title": p["title"], "position": p["position"], "entities": entities}

    page_entities = await asyncio.gather(*(extract_for_page(p) for p in pages))

    # Собираем все сущности
    all_entities: list[dict] = []
    for pe in page_entities:
        all_entities.extend(pe["entities"])

    # Сущности топ-3 для gap-анализа
    top3_entities: list[dict] = []
    for pe in page_entities[:3]:
        top3_entities.extend(pe["entities"])

    # 4. Извлекаем сущности со страницы пользователя (если URL передан)
    user_entities: list[dict] = []
    if req.url:
        try:
            user_text = await fetch_page_text(req.url)
            user_entities = await _extract_with_cache(req.url, user_text, model)
        except Exception:
            pass  # Продолжаем без страницы пользователя

    # 5. Gap-анализ
    gaps = await analyze_gaps(user_entities, top3_entities, model)

    # 6. Формируем чек-лист
    checklist = _generate_checklist(gaps, req.url is not None and len(user_entities) > 0)

    # 7. Подсчитываем покрытие
    unique_entity_names = {e["name"].lower() for e in all_entities}
    user_entity_names = {e["name"].lower() for e in user_entities}
    top3_entity_names = {e["name"].lower() for e in top3_entities}

    top3_coverage = 100.0 if not top3_entity_names else round(
        len(top3_entity_names) / len(top3_entity_names) * 100, 1
    )
    user_coverage = 0.0
    if unique_entity_names:
        user_coverage = round(len(user_entity_names & unique_entity_names) / len(unique_entity_names) * 100, 1)

    # 8. Формируем отчёт
    gap_items = [
        GapItem(
            entity=g["entity"],
            entity_type=g.get("entity_type", "Concept"),
            found_in_top3=g.get("found_in_top3", True),
            found_in_user_page=g.get("found_in_user_page", False),
            priority=g.get("priority", "medium"),
            recommendation=g.get("recommendation", ""),
        )
        for g in gaps
    ]

    report = AnalysisReport(
        id=analysis_id,
        query=req.query,
        timestamp=started_at.isoformat(),
        entities_found=len(all_entities),
        user_entity_coverage=user_coverage,
        top3_entity_coverage=top3_coverage,
        gaps=gap_items[:20],  # топ-20 разрывов
        checklist=checklist[:15],
    )

    # 9. Сохраняем в БД
    save_analysis(analysis_id, req.query, report.model_dump(), model, req.url)

    return report


def _generate_checklist(gaps: list[dict], has_user_page: bool) -> list[str]:
    """Generates a checklist based on gaps."""
    items = []

    critical = [g for g in gaps if g.get("priority") == "critical"]
    high = [g for g in gaps if g.get("priority") == "high"]

    if critical:
        items.append(f"CRITICAL GAPS ({len(critical)}):")
        for g in critical[:5]:
            rec = g.get("recommendation") or f"Add: {g['entity']}"
            items.append(f"  • {rec}")

    if high:
        items.append(f"HIGH PRIORITY GAPS ({len(high)}):")
        for g in high[:5]:
            rec = g.get("recommendation") or f"Add: {g['entity']}"
            items.append(f"  • {rec}")

    if not critical and not high:
        items.append("No critical gaps found")

    if has_user_page:
        items.append("Compare your page to the top-3 by these entities and fill the gaps")

    items.append("Verify heading structure (H1-H3) for key entity presence")
    items.append("Ensure main entities appear in the first fold of the page")

    return items