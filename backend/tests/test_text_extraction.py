"""Tests for structural text extraction (services/text_extraction.py).

Run: cd backend && ./venv/bin/python3 -m pytest tests/test_text_extraction.py -v
"""
import sys

import pytest

from services.text_extraction import (
    PageTextResult,
    count_markdown_headings,
    extract_page_text_from_html,
    find_content_candidate,
    smart_truncate,
)

ARTICLE_HTML = """<!DOCTYPE html>
<html>
<head><title>Статья</title></head>
<body>
<nav><a href="/">Главная</a><a href="/catalog">Каталог</a></nav>
<header><h1>Заголовок шапки</h1></header>
<article>
  <h1>Как работать с поколением Z</h1>
  <p>Первый абзац введения с достаточной длиной текста для прохождения порога качества.</p>
  <h2>Кто такие зумеры</h2>
  <p>Зумеры — поколение, родившееся с 2000 по 2011 годы.</p>
  <h2>Сильные стороны</h2>
  <ul>
    <li>Быстро анализируют информацию</li>
    <li>Не боятся ошибок</li>
  </ul>
  <h2>Сравнение</h2>
  <table>
    <tr><th>Поколение</th><th>Годы</th></tr>
    <tr><td>Z</td><td>2000-2011</td></tr>
  </table>
</article>
<footer>Контакты</footer>
</body>
</html>
"""


def test_find_content_candidate_article():
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(ARTICLE_HTML, "lxml")
    cand = find_content_candidate(soup, "https://example.com/article")
    assert cand is not None
    assert cand.name == "article"


def test_find_content_candidate_no_article_falls_back_none():
    from bs4 import BeautifulSoup

    html = "<html><body><div>text</div></body></html>"
    soup = BeautifulSoup(html, "lxml")
    assert find_content_candidate(soup, "https://example.com") is None


def test_domain_override_roseltorg():
    from bs4 import BeautifulSoup

    html = "<html><body><div class='article-reader'><h1>Статья</h1></div></body></html>"
    soup = BeautifulSoup(html, "lxml")
    cand = find_content_candidate(soup, "https://cv.roseltorg.ru/journal/article/xxx")
    assert cand is not None
    assert cand.name == "div"
    assert "article-reader" in str(cand.get("class"))


def test_extract_article_html_preserves_headings():
    res = extract_page_text_from_html(ARTICLE_HTML, "https://example.com/article")
    assert isinstance(res, PageTextResult)
    assert res.text
    assert res.h1_count >= 1
    assert res.h2_count >= 3
    # Headings preserved as markdown
    assert "## Кто такие зумеры" in res.text
    assert "## Сильные стороны" in res.text
    # List preserved
    assert "- Быстро анализируют информацию" in res.text
    # Table preserved as markdown (format depends on the method: trafilatura |---|---|, bs4 | --- | --- |)
    assert "| Поколение | Годы |" in res.text.replace("| |", "|")
    assert "---" in res.text
    # The nav menu did not leak in
    assert "Каталог" not in res.text


def test_count_markdown_headings():
    text = "# H1\n\n## H2\n\n### H3\nplain text"
    assert count_markdown_headings(text) == 3


def test_smart_truncate_does_not_break_blocks():
    text = "абзац один с достаточно длинным содержимым и не только\n\nабзац два\n\nабзац три"
    truncated, was = smart_truncate(text, limit=30)
    assert was is True
    assert len(truncated) <= 30 + 30  # very loose sanity check


def test_smart_truncate_small_text_untouched():
    text = "короткий текст"
    truncated, was = smart_truncate(text, limit=8000)
    assert was is False
    assert truncated == text


def test_smart_truncate_force_cut_when_single_block_overflow():
    text = "x" * 100
    truncated, was = smart_truncate(text, limit=50)
    assert was is True
    assert len(truncated) <= 50