"""Постраничный прогресс анализа:
1) пайплайн пишет point-апдейты по каждой странице (без read-modify-write);
2) get_analysis_status собирает progress из analysis_pages + progress_meta.
"""

import asyncio

import db as db_mod
from routers import analyzer as analyzer_mod


async def _fake_serp(query, engine):
    return [
        {"url": "https://ex1.ru", "title": "Конкурент 1", "snippet": "s1", "position": 1, "engine": "google"},
        {"url": "https://ex2.ru", "title": "Конкурент 2", "snippet": "s2", "position": 2, "engine": "google"},
    ]


async def _fake_fetch_page_text(url, timeout=15):
    return f"Текст статьи конкурента {url} про обучение сотрудников"


async def _fake_extract(text, url, model=None):
    return [
        {"name": "онбординг", "type": "Concept", "confidence": 0.9, "source_url": url, "description": "описание"},
        {"name": "наставник", "type": "Role", "confidence": 0.8, "source_url": url, "description": "описание"},
    ]


async def _fake_gaps(user_entities, competitor_entities, model=None, query=""):
    return [{"entity": "онбординг", "entity_type": "Concept", "priority": "high",
             "competitor_description": "d", "recommendation": "r",
             "found_in_competitors": True, "found_in_user_page": False}]


def test_pipeline_writes_per_page_progress(monkeypatch):
    """Каждая страница проходит fetching → extracting → done; user_page и gap пишут step."""
    calls: list[tuple] = []

    monkeypatch.setattr(analyzer_mod, "fetch_top20", _fake_serp)
    monkeypatch.setattr(analyzer_mod, "fetch_page_text", _fake_fetch_page_text)
    monkeypatch.setattr(analyzer_mod, "extract_entities", _fake_extract)
    monkeypatch.setattr(analyzer_mod, "get_cached_entities", lambda url: None)
    monkeypatch.setattr(analyzer_mod, "cache_entities", lambda url, e: None)
    monkeypatch.setattr(analyzer_mod, "analyze_gaps", _fake_gaps)
    monkeypatch.setattr(analyzer_mod, "update_analysis_status", lambda *a, **k: None)
    monkeypatch.setattr(analyzer_mod, "fail_analysis", lambda aid, err: calls.append(("fail", err)))
    monkeypatch.setattr(analyzer_mod, "complete_analysis", lambda aid, report: calls.append(("complete", report)))

    # Реальные db-функции прогресса заменяем на запись вызовов
    monkeypatch.setattr(analyzer_mod, "register_pages",
                        lambda aid, pages: calls.append(("register", len(pages))))
    monkeypatch.setattr(analyzer_mod, "update_page",
                        lambda aid, url, **kw: calls.append(("update", url, kw.get("step"), kw.get("entities"))))
    monkeypatch.setattr(analyzer_mod, "set_progress_meta",
                        lambda aid, meta: calls.append(("meta", meta)))

    asyncio.run(
        analyzer_mod._run_pipeline("test-progress", "запрос", "google", None, "Текст пользователя", "model")
    )

    steps = {
        url: [c[2] for c in calls if c[0] == "update" and c[1] == url]
        for url in ("https://ex1.ru", "https://ex2.ru")
    }
    # Обе страницы: fetching → extracting,... → done
    for url in steps:
        assert steps[url][0] == "fetching", f"{url}: {steps[url]}"
        assert "extracting" in steps[url], f"{url}: {steps[url]}"
        assert steps[url][-1] == "done", f"{url}: {steps[url]}"
        # done несёт количество сущностей (extract-done; fetch-done пишет только chars)
        done_calls = [c for c in calls if c[0] == "update" and c[1] == url and c[2] == "done"]
        assert any(c[3] == 2 for c in done_calls), done_calls

    # Все 2 страницы зарегистрированы до фетча
    assert calls[0][0] == "register" and calls[0][1] == 2

    metas = [c[1] for c in calls if c[0] == "meta"]
    assert {"user_step": "extracting"} in metas
    assert any(m.get("user_step") == "done" and m.get("user_entities") == 2 for m in metas), metas
    assert any(m.get("gap_step") == "running" for m in metas), metas
    assert any(m.get("gap_step") == "done" for m in metas), metas

    # Пайплайн не упал — отчёт собран
    assert not any(c[0] == "fail" for c in calls)
    assert any(c[0] == "complete" for c in calls)


def test_progress_roundtrip_in_sqlite(tmp_path, monkeypatch):
    """get_analysis_status собирает progress: страницы + метаданные (user/gap)."""
    monkeypatch.setattr(db_mod, "DB_PATH", str(tmp_path / "test.db"))
    db_mod.init_db()

    db_mod.create_running_analysis("aid-roundtrip", "запрос", "model", None)
    db_mod.register_pages("aid-roundtrip", [
        {"url": "https://a.ru", "title": "A", "position": 1, "engine": "google"},
        {"url": "https://b.ru", "title": "B", "position": 2, "engine": "yandex"},
    ])
    db_mod.update_page("aid-roundtrip", "https://a.ru", step="fetching")
    db_mod.update_page("aid-roundtrip", "https://a.ru", step="extracting")
    db_mod.update_page("aid-roundtrip", "https://a.ru", step="done", chars=100, entities=5)
    db_mod.update_page("aid-roundtrip", "https://b.ru", step="failed")
    db_mod.set_progress_meta("aid-roundtrip", {"user_step": "done", "user_entities": 3})
    db_mod.set_progress_meta("aid-roundtrip", {"gap_step": "running", "gap_user_n": 3, "gap_competitor_n": 4})

    status = db_mod.get_analysis_status("aid-roundtrip")
    assert status is not None
    pages = status["progress"]["pages"]

    assert len(pages) == 2
    assert pages[0]["url"] == "https://a.ru" and pages[0]["step"] == "done"
    assert pages[0]["entities"] == 5 and pages[0]["chars"] == 100
    assert pages[1]["step"] == "failed"
    # Порядок по позиции
    assert [p["position"] for p in pages] == [1, 2]
    # Метаданные слились в тот же объект progress
    assert status["progress"]["user_step"] == "done"
    assert status["progress"]["gap_step"] == "running"
    assert status["progress"]["gap_competitor_n"] == 4