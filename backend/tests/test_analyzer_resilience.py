"""Устойчивость пайплайна: при сбое LLM-вызовов (сеть, зависание, таймаут)
анализ НЕ должен падать в failed — отчёт строится с тем, что уже извлечено."""

import asyncio

from routers import analyzer as analyzer_mod


async def _fake_serp(query, engine):
    return [
        {"url": "https://ex1.ru", "title": "Конкурент 1", "snippet": "s1", "position": 1, "engine": "google"},
        {"url": "https://ex2.ru", "title": "Конкурент 2", "snippet": "s2", "position": 2, "engine": "google"},
    ]


async def _fake_fetch_page_text(url, timeout=15):
    return f"Текст статьи конкурента {url} про обучение сотрудников и онбординг"


async def _fake_extract(text, url, model=None):
    return [
        {"name": "онбординг", "type": "Concept", "confidence": 0.9, "source_url": url, "description": "описание"},
        {"name": "наставник", "type": "Role", "confidence": 0.8, "source_url": url, "description": "описание"},
    ]


async def _boom_gaps(user_entities, competitor_entities, model=None, query=""):
    raise TimeoutError("LLM stuck / network dead")


def _patch_base(monkeypatch, captured):
    monkeypatch.setattr(analyzer_mod, "fetch_top20", _fake_serp)
    monkeypatch.setattr(analyzer_mod, "fetch_page_text", _fake_fetch_page_text)
    monkeypatch.setattr(analyzer_mod, "extract_entities", _fake_extract)
    monkeypatch.setattr(analyzer_mod, "get_cached_entities", lambda url: None)
    monkeypatch.setattr(analyzer_mod, "cache_entities", lambda url, e: None)
    monkeypatch.setattr(analyzer_mod, "update_analysis_status", lambda *a, **k: None)
    monkeypatch.setattr(analyzer_mod, "fail_analysis", lambda aid, err: captured.setdefault("fail", err))
    # Прогресс-записи не относятся к устойчивости — не трогаем БД в этих тестах
    monkeypatch.setattr(analyzer_mod, "register_pages", lambda *a, **k: None)
    monkeypatch.setattr(analyzer_mod, "update_page", lambda *a, **k: None)
    monkeypatch.setattr(analyzer_mod, "set_progress_meta", lambda *a, **k: None)

    def fake_complete(aid, report):
        captured["report"] = report

    monkeypatch.setattr(analyzer_mod, "complete_analysis", fake_complete)


def test_gap_failure_still_builds_report(monkeypatch):
    captured = {}
    _patch_base(monkeypatch, captured)
    monkeypatch.setattr(analyzer_mod, "analyze_gaps", _boom_gaps)

    asyncio.run(
        analyzer_mod._run_pipeline("test-gap-fail", "запрос", "google", None, "Текст пользователя", "model")
    )

    # Анализ НЕ упал
    assert "fail" not in captured, f"pipeline failed: {captured.get('fail')}"
    # Отчёт собран с тем, что есть
    report = captured["report"]
    assert report["gaps"] == []          # gap-анализ не удался — gaps пустые
    assert report["entities_found"] > 0  # но сущности конкурентов на месте
    assert len(report["competitor_pages"]) == 2
    assert report["all_competitor_entities"]


def test_extract_failure_skips_only_broken_page(monkeypatch):
    captured = {}
    _patch_base(monkeypatch, captured)

    async def flaky_extract(text, url, model=None):
        if "ex2.ru" in url:
            raise ConnectionError("page stuck")
        return [
            {"name": "онбординг", "type": "Concept", "confidence": 0.9,
             "source_url": url, "description": "описание"},
        ]

    monkeypatch.setattr(analyzer_mod, "extract_entities", flaky_extract)
    # quick-path: user_entities пусто (user_text не передаём) → analyze_gaps без LLM
    async def fake_gaps(user_entities, competitor_entities, model=None, query=""):
        return [
            {"entity": "онбординг", "entity_type": "Concept", "priority": "high",
             "competitor_description": "d", "recommendation": "r",
             "found_in_competitors": True, "found_in_user_page": False},
        ]

    monkeypatch.setattr(analyzer_mod, "analyze_gaps", fake_gaps)

    asyncio.run(
        analyzer_mod._run_pipeline("test-extract-fail", "запрос", "google", None, None, "model")
    )

    assert "fail" not in captured, f"pipeline failed: {captured.get('fail')}"
    report = captured["report"]
    # Упавшая страница пропущена, но анализ продолжен и gaps не пустые
    assert report["gaps"], "no gaps returned"
    assert report["entities_found"] == 1  # только ex1.ru извлеклась
    assert len(report["competitor_pages"]) == 2