"""Pipeline resilience: when LLM calls fail (network, hang, timeout) the analysis
must NOT fall to failed — the report builds with what was already extracted."""

import asyncio

from routers import analyzer as analyzer_mod


async def _fake_serp(query, engine):
    return [
        {"url": "https://ex1.ru", "title": "Competitor 1", "snippet": "s1", "position": 1, "engine": "google"},
        {"url": "https://ex2.ru", "title": "Competitor 2", "snippet": "s2", "position": 2, "engine": "google"},
    ]


async def _fake_fetch_page_text(url, timeout=15):
    return f"Competitor article text {url} about employee onboarding and training"


async def _fake_extract(text, url, model=None):
    return [
        {"name": "onboarding", "type": "Concept", "confidence": 0.9, "source_url": url, "description": "description"},
        {"name": "mentor", "type": "Role", "confidence": 0.8, "source_url": url, "description": "description"},
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
    # Progress writes are not part of resilience behavior — don't touch the DB in these tests
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
        analyzer_mod._run_pipeline("test-gap-fail", "query", "google", None, "User text", "model")
    )

    # The analysis did NOT fail
    assert "fail" not in captured, f"pipeline failed: {captured.get('fail')}"
    # The report built with what was available
    report = captured["report"]
    assert report["gaps"] == []          # gap analysis failed — gaps are empty
    assert report["entities_found"] > 0  # but competitor entities are in place
    assert len(report["competitor_pages"]) == 2
    assert report["all_competitor_entities"]


def test_extract_failure_skips_only_broken_page(monkeypatch):
    captured = {}
    _patch_base(monkeypatch, captured)

    async def flaky_extract(text, url, model=None):
        if "ex2.ru" in url:
            raise ConnectionError("page stuck")
        return [
            {"name": "onboarding", "type": "Concept", "confidence": 0.9,
             "source_url": url, "description": "description"},
        ]

    monkeypatch.setattr(analyzer_mod, "extract_entities", flaky_extract)
    # quick-path: user_entities is empty (no user_text passed) → analyze_gaps without the LLM
    async def fake_gaps(user_entities, competitor_entities, model=None, query=""):
        return [
            {"entity": "onboarding", "entity_type": "Concept", "priority": "high",
             "competitor_description": "d", "recommendation": "r",
             "found_in_competitors": True, "found_in_user_page": False},
        ]

    monkeypatch.setattr(analyzer_mod, "analyze_gaps", fake_gaps)

    asyncio.run(
        analyzer_mod._run_pipeline("test-extract-fail", "query", "google", None, None, "model")
    )

    assert "fail" not in captured, f"pipeline failed: {captured.get('fail')}"
    report = captured["report"]
    # The broken page was skipped, but the analysis continued and gaps are non-empty
    assert report["gaps"], "no gaps returned"
    assert report["entities_found"] == 1  # only ex1.ru extracted
    assert len(report["competitor_pages"]) == 2
