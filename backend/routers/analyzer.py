import uuid
import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
from fastapi import APIRouter, HTTPException, BackgroundTasks
from models.schemas import (
    AnalyzeRequest, AnalyzeResponse, AnalyzeStatus,
    AnalysisReport, Entity, GapItem, CompetitorPage,
)
from services.serp import fetch_top20, fetch_page_text
from services.entity_extractor import extract_entities
from services.gap_analyzer import analyze_gaps
from db import (
    create_running_analysis, update_analysis_status,
    complete_analysis, fail_analysis, get_analysis_status,
    get_cached_entities, cache_entities, get_setting,
)

router = APIRouter(prefix="/api", tags=["analyzer"])
SEMAPHORE = asyncio.Semaphore(5)


async def _extract_with_cache(url: str, text: str, model: str) -> list[dict]:
    cached = get_cached_entities(url)
    if cached:
        return cached
    entities = await extract_entities(text, url, model)
    if entities:
        cache_entities(url, entities)
    return entities


async def _run_pipeline(
    analysis_id: str,
    query: str,
    engine: str,
    url: str | None,
    user_text: str | None,
    model: str,
):
    """Фоновый pipeline: выполняет анализ и обновляет статус в БД."""
    try:
        # Stage: searching
        logger.info("[%s] Stage: searching (query=%r, engine=%r)", analysis_id, query, engine)
        update_analysis_status(analysis_id, "searching")
        serp_results = await fetch_top20(query, engine)
        if not serp_results:
            fail_analysis(analysis_id, "No results found for query")
            return

        # Stage: fetching
        # Для 'both' берём 20 страниц (10 Google + 10 Yandex), иначе 10
        page_limit = 20 if engine == "both" else 10
        logger.info("[%s] Stage: fetching (%d URLs)", analysis_id, page_limit)
        update_analysis_status(analysis_id, "fetching")

        async def fetch_text(r):
            try:
                text = await fetch_page_text(r["url"])
                return {
                    "url": r["url"], "title": r["title"], "text": text,
                    "position": r["position"], "engine": r.get("engine", engine),
                }
            except Exception:
                return {
                    "url": r["url"], "title": r["title"], "text": r["snippet"],
                    "position": r["position"], "engine": r.get("engine", engine),
                }

        competitors = serp_results[:page_limit]
        pages = await asyncio.gather(*(fetch_text(r) for r in competitors))

        # Сохраняем тексты конкурентов для отчёта
        competitor_pages = [
            CompetitorPage(
                url=p["url"],
                title=p["title"],
                position=p["position"],
                engine=p["engine"],
                text=p["text"],
            )
            for p in pages
        ]

        # Stage: extracting
        logger.info("[%s] Stage: extracting (%d pages)", analysis_id, len(pages))
        update_analysis_status(analysis_id, "extracting")

        async def extract_for_page(p):
            async with SEMAPHORE:
                entities = await _extract_with_cache(p["url"], p["text"], model)
                return {"url": p["url"], "title": p["title"], "position": p["position"], "entities": entities}

        page_entities = await asyncio.gather(*(extract_for_page(p) for p in pages))

        # Собираем сущности со всех страниц конкурентов
        all_entities: list[dict] = []
        entity_urls: dict[str, list[dict]] = {}
        for pe in page_entities:
            all_entities.extend(pe["entities"])
            for e in pe["entities"]:
                name = e["name"].lower()
                if name not in entity_urls:
                    entity_urls[name] = []
                url_info = {"url": pe["url"], "title": pe["title"], "position": pe["position"]}
                if url_info not in entity_urls[name]:
                    entity_urls[name].append(url_info)

        # Группируем ВСЕ сущности конкурентов по имени: frequency + descriptions + source_urls
        competitor_grouped: dict[str, dict] = {}
        for e in all_entities:
            key = e["name"].lower()
            if key not in competitor_grouped:
                competitor_grouped[key] = {
                    "name": e["name"],
                    "type": e["type"],
                    "confidence": e["confidence"],
                    "frequency": 1,
                    "descriptions": [],
                    "source_urls": [],
                }
                desc = e.get("description", "")
                if desc:
                    competitor_grouped[key]["descriptions"].append(desc)
                src = e.get("source_url", "")
                if src and src not in competitor_grouped[key]["source_urls"]:
                    competitor_grouped[key]["source_urls"].append(src)
            else:
                competitor_grouped[key]["frequency"] += 1
                desc = e.get("description", "")
                if desc and desc not in competitor_grouped[key]["descriptions"]:
                    competitor_grouped[key]["descriptions"].append(desc)
                src = e.get("source_url", "")
                if src and src not in competitor_grouped[key]["source_urls"]:
                    competitor_grouped[key]["source_urls"].append(src)
                # Берём максимальный confidence
                if e.get("confidence", 0) > competitor_grouped[key]["confidence"]:
                    competitor_grouped[key]["confidence"] = e["confidence"]

        competitor_entities = sorted(
            competitor_grouped.values(),
            key=lambda e: e["frequency"],
            reverse=True,
        )

        # Страница пользователя
        user_entities: list[dict] = []
        report_user_text = ""
        if url or user_text:
            update_analysis_status(analysis_id, "analyzing")
            try:
                if user_text:
                    report_user_text = user_text.strip()
                    user_entities = await _extract_with_cache("user-text://", report_user_text, model)
                elif url:
                    report_user_text = await fetch_page_text(url)
                    user_entities = await _extract_with_cache(url, report_user_text, model)
            except Exception:
                pass

        # Stage: analyzing gaps
        logger.info("[%s] Stage: analyzing gaps (user_entities=%d, competitor_entities=%d)",
                     analysis_id, len(user_entities), len(competitor_entities))
        update_analysis_status(analysis_id, "analyzing")
        gaps = await analyze_gaps(user_entities, competitor_entities, model, query)

        # Stage: building report
        logger.info("[%s] Stage: building report (%d gaps)", analysis_id, len(gaps))
        update_analysis_status(analysis_id, "building")

        unique_entity_names = {e["name"].lower() for e in all_entities}
        user_entity_names = {e["name"].lower() for e in user_entities}
        competitor_entity_names = set(competitor_grouped.keys())

        user_coverage = 0.0
        if unique_entity_names:
            user_coverage = round(
                len(user_entity_names & unique_entity_names) / len(unique_entity_names) * 100, 1
            )

        gap_items = [
            GapItem(
                entity=g["entity"],
                entity_type=g.get("entity_type", "Concept"),
                found_in_competitors=g.get("found_in_competitors", True),
                found_in_user_page=g.get("found_in_user_page", False),
                priority=g.get("priority", "medium"),
                recommendation=g.get("recommendation", ""),
                competitor_description=g.get("competitor_description", ""),
                found_on_urls=entity_urls.get(g["entity"].lower(), []),
            )
            for g in gaps
        ]

        report = AnalysisReport(
            id=analysis_id,
            query=query,
            timestamp=datetime.now(timezone.utc).isoformat(),
            entities_found=len(all_entities),
            user_entity_coverage=user_coverage,
            competitor_entity_coverage=100.0,
            gaps=gap_items[:20],
            competitor_pages=competitor_pages,
            user_page_text=report_user_text,
        )

        complete_analysis(analysis_id, report.model_dump())
    except Exception as e:
        logger.exception("[%s] Pipeline failed: %s", analysis_id, e)
        fail_analysis(analysis_id, str(e))


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest, background_tasks: BackgroundTasks):
    """Запускает анализ и сразу возвращает ID. Pipeline выполняется в фоне."""
    model = get_setting("model") or "openai/gpt-4o"
    analysis_id = str(uuid.uuid4())[:12]

    # Создаём запись сразу
    create_running_analysis(analysis_id, req.query, model, req.url)

    # Запускаем pipeline в фоне
    background_tasks.add_task(
        _run_pipeline, analysis_id, req.query, req.engine, req.url, req.user_text, model,
    )

    return AnalyzeResponse(id=analysis_id, status="running", stage="searching")


@router.get("/analyze/{analysis_id}/status", response_model=AnalyzeStatus)
async def get_status(analysis_id: str):
    """Возвращает текущий статус анализа."""
    try:
        data = get_analysis_status(analysis_id)
    except Exception as e:
        logger.exception("Failed to get analysis status for %s", analysis_id)
        raise HTTPException(status_code=500, detail=f"Internal error: {e}")
    if not data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    result = None
    if data.get("status") == "completed" and data.get("result_json"):
        try:
            result = AnalysisReport(**data["result_json"])
        except Exception:
            logger.exception("Failed to parse result_json for %s", analysis_id)

    return AnalyzeStatus(
        id=data["id"],
        status=data.get("status", "running"),
        stage=data.get("stage", "unknown"),
        result=result,
        error=data.get("result_json", {}).get("error") if data.get("status") == "failed" else None,
    )