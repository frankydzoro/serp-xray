import uuid
import asyncio
import logging
import hashlib
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

        # ── Wave 1.3: SERP position weight ──
        def calc_position_weight(pos: int) -> float:
            if pos <= 3: return 1.0
            if pos <= 6: return 0.7
            if pos <= 10: return 0.4
            return 0.2

        # ── Wave 1.2: Co-occurrence matrix ──
        from collections import defaultdict as _dd
        cooccurrence_raw: dict[str, int] = _dd(int)
        for pe in page_entities:
            page_entity_names = list({e["name"].lower() for e in pe["entities"]})
            for i in range(len(page_entity_names)):
                for j in range(i + 1, len(page_entity_names)):
                    pair = "|".join(sorted([page_entity_names[i], page_entity_names[j]]))
                    cooccurrence_raw[pair] += 1
        cooccurrence_matrix = dict(cooccurrence_raw)

        # ── Wave 2.1: Typed edges — parent_child detection ──
        # Вычисляется ПОСЛЕ построения competitor_grouped (ниже)

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
                    "positions": [],     # Wave 1.3: позиции для расчёта visibility
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

        # ── Wave 1.3: добавление позиций и adjusted_confidence ──
        from statistics import mean as _mean
        for key, group in competitor_grouped.items():
            pages = entity_urls.get(key, [])
            positions = [p["position"] for p in pages]
            group["positions"] = positions
            if positions:
                avg_pos_weight = _mean([calc_position_weight(p) for p in positions])
                group["adjusted_confidence"] = round(group["confidence"] * avg_pos_weight, 3)
            else:
                group["adjusted_confidence"] = group["confidence"]

        # ── Wave 1.1: all_competitor_entities для фронтенда ──
        all_competitor_entities = [
            {
                "name": g["name"],
                "type": g["type"],
                "confidence": g["confidence"],
                "adjusted_confidence": g.get("adjusted_confidence", g["confidence"]),
                "frequency": g["frequency"],
                "description": g["descriptions"][0] if g["descriptions"] else "",
                "descriptions": g["descriptions"],
                "source_urls": g["source_urls"],
                "positions": g.get("positions", []),
            }
            for g in competitor_grouped.values()
        ]

        # ── Wave 2.1: Typed edges — parent_child detection ──
        entity_desc_map: dict[str, str] = {
            g["name"].lower(): (g["descriptions"] or [""])[0]
            for g in competitor_grouped.values()
        }
        typed_edges: list[dict] = []
        for pair_key, weight in cooccurrence_matrix.items():
            parts = pair_key.split("|")
            if len(parts) != 2:
                continue
            e1, e2 = parts
            desc1 = entity_desc_map.get(e1, "")
            desc2 = entity_desc_map.get(e2, "")
            edge_type = "co_occurrence"
            if e2 in desc1.lower() or e1 in desc2.lower():
                edge_type = "parent_child"
            typed_edges.append({
                "source": e1,
                "target": e2,
                "weight": weight,
                "type": edge_type,
            })

        # Частоты сущностей
        competitor_entity_frequencies = {
            g["name"]: g["frequency"]
            for g in competitor_grouped.values()
        }

        # Frequency map для обогащения gaps
        entity_freq: dict[str, int] = {
            g["name"].lower(): g["frequency"]
            for g in competitor_grouped.values()
        }

        # Страница пользователя
        user_entities: list[dict] = []
        report_user_text = ""
        if url or user_text:
            update_analysis_status(analysis_id, "analyzing")
            try:
                if user_text:
                    report_user_text = user_text.strip()
                    text_hash = hashlib.sha1(report_user_text.encode("utf-8")).hexdigest()[:16]
                    user_entities = await _extract_with_cache(f"user-text://{text_hash}", report_user_text, model)
                elif url:
                    report_user_text = await fetch_page_text(url)
                    user_entities = await _extract_with_cache(url, report_user_text, model)
            except Exception:
                pass

        # ── Wave 1.1: user_entities для фронтенда ──
        user_entities_list = [
            {
                "name": e.get("name", ""),
                "type": e.get("type", "Concept"),
                "confidence": e.get("confidence", 0.5),
                "description": e.get("description", ""),
                "source_urls": [e.get("source_url", "")] if e.get("source_url") else [],
            }
            for e in user_entities
        ]

        # Stage: analyzing gaps
        logger.info("[%s] Stage: analyzing gaps (user_entities=%d, competitor_entities=%d)",
                     analysis_id, len(user_entities), len(competitor_entities))
        update_analysis_status(analysis_id, "analyzing")
        gaps = await analyze_gaps(user_entities, competitor_entities, model, query)

        # ── Wave 1.2: enrichment gaps частотой ──
        for g in gaps:
            g["frequency"] = entity_freq.get(g["entity"].lower(), 1)

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

        competitor_coverage = 0.0
        if user_entity_names:
            competitor_coverage = round(
                len(user_entity_names & competitor_entity_names) / len(user_entity_names) * 100, 1
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

        # Checklist: actionable items derived from gaps (already priority-sorted)
        checklist = [
            f"{gi.entity} — {gi.recommendation}"
            if gi.recommendation
            else f"Add information about {gi.entity} to the page"
            for gi in gap_items[:20]
        ]

        report = AnalysisReport(
            id=analysis_id,
            query=query,
            timestamp=datetime.now(timezone.utc).isoformat(),
            entities_found=len(all_entities),
            user_entity_coverage=user_coverage,
            competitor_entity_coverage=competitor_coverage,
            gaps=gap_items[:20],
            checklist=checklist,
            competitor_pages=competitor_pages,
            user_page_text=report_user_text,
            # Wave 1: новые поля для Entity Graph
            all_competitor_entities=all_competitor_entities,
            user_entities=user_entities_list,
            cooccurrence_matrix=cooccurrence_matrix,
            competitor_entity_frequencies=competitor_entity_frequencies,
            typed_edges=typed_edges,
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