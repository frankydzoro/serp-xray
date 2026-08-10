"""Извлечение текста страницы с сохранением структуры (Markdown).

Архитектура (по ТЗ 2026-08-10):
1. Trafilatura (favor_recall=True, output_format="markdown") — основной метод.
2. Quality gate: длина + наличие Markdown-заголовков против DOM-кандидата.
3. Если Trafilatura потерял заголовки или текст подозрительно короткий —
   BS4-структурное извлечение (h1..h6 -> #, p -> текст, li -> -, table -> markdown).
4. Грубый fallback — get_text().
5. Обрезка до MAX_PAGE_CHARS — по блокам (не по символам).

Метаданные (author, datePublished, JSON-LD) сознательно не извлекаются —
отдельная задача, для текущего фикса не критична.
"""
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

from bs4 import BeautifulSoup, NavigableString, Tag

from services.article_cleaner import clean_article_text
from config import MAX_PAGE_CHARS

logger = logging.getLogger(__name__)

# ── Пороги качества ─────────────────────────────────────────
MIN_TEXT_LEN = 300              # текст короче — считаем провалом
MIN_HALF_RATIO = 0.5            # текст < 50% от DOM-кандидата — считаем провалом
MIN_H2_FOR_GATE = 2             # в DOM >= 2 H2, а в markdown 0 — заголовки потеряны

# ── Каскад селекторов основного контента ───────────────────
# Общие селекторы — работают на большинстве шаблонов.
MAIN_CONTENT_SELECTORS = [
    "article",
    '[itemprop="articleBody"]',
    "main",
    ".article-content",
    ".post-content",
    ".entry-content",
    "#content",
]

# Доменные оверрайды — ТОЛЬКО как дополнительный приоритет,
# а не единственный путь (для шаблонов без article/main).
# Роселторг: статья лежит в div.article-reader, article/main в DOM нет.
DOMAIN_SELECTORS = {
    "cv.roseltorg.ru": [".article-reader"],
}

# Регэксп Markdown-заголовков: строка начинается с 1-6 '#' + пробел
MD_HEADING_RE = re.compile(r"^#{1,6}\s", re.MULTILINE)


@dataclass
class PageTextResult:
    """Результат извлечения текста + метрики качества."""
    text: str
    method: str                # trafilatura | bs4_structural | raw_text
    char_count: int
    h1_count: int
    h2_count: int
    h3_count: int
    truncated: bool
    warnings: list[str] = field(default_factory=list)


# ── Quality helpers ─────────────────────────────────────────

def count_markdown_headings(text: str) -> int:
    """Число Markdown-заголовков (#/##/###...) в тексте."""
    if not text:
        return 0
    return len(MD_HEADING_RE.findall(text))


def _heading_counts(text: str) -> dict[str, int]:
    counts = {"h1": 0, "h2": 0, "h3": 0}
    for line in text.split("\n"):
        m = re.match(r"^(#{1,3})\s", line)
        if m:
            level = len(m.group(1))
            key = f"h{level}"
            if key in counts:
                counts[key] += 1
    return counts


def smart_truncate(text: str, limit: int = MAX_PAGE_CHARS) -> tuple[str, bool]:
    """Обрезка по блокам (абзацам), а не по символам.

    Возвращает (обрезанный_текст, был_ли_обрезан).
    Если лимит меньше первого блока — жёстко режем по limit (лучше что-то, чем ничего).
    """
    if len(text) <= limit:
        return text, False

    blocks = text.split("\n\n")
    result = []
    total = 0
    for block in blocks:
        addition = len(block) + 2  # \n\n
        if total + addition > limit:
            break
        result.append(block)
        total += addition

    truncated = "\n\n".join(result).strip()
    if not truncated:
        truncated = text[:limit]

    return truncated, True


# ── Извлечение: Trafilatura ─────────────────────────────────

def _extract_with_trafilatura(html: str) -> Optional[str]:
    """Trafilatura в recall-режиме (больше текста, markdown, без ссылок/картинок)."""
    try:
        import trafilatura
        extracted = trafilatura.extract(
            html,
            favor_recall=True,
            output_format="markdown",
            include_tables=True,
            include_links=False,
            include_images=False,
        )
        if extracted:
            return extracted.strip()
    except Exception as e:  # noqa: BLE001
        logger.warning("Trafilatura failed: %s", e)
    return None


# ── Извлечение: BS4 structural ──────────────────────────────

def _domain_for_url(url: Optional[str]) -> str:
    if not url:
        return ""
    try:
        from urllib.parse import urlparse
        return (urlparse(url).hostname or "").lower()
    except Exception:  # noqa: BLE001
        return ""


def find_content_candidate(soup: BeautifulSoup, url: Optional[str] = None) -> Optional[Tag]:
    """Ищет контейнер основного контента (каскад селекторов + доменные оверрайды)."""
    selectors: list[str] = []
    domain = _domain_for_url(url)
    if domain in DOMAIN_SELECTORS:
        selectors.extend(DOMAIN_SELECTORS[domain])
    selectors.extend(MAIN_CONTENT_SELECTORS)

    for sel in selectors:
        el = soup.select_one(sel)
        if el is not None:
            return el
    return None


def _blockquote_to_md(el: Tag) -> list[str]:
    lines = []
    for p in el.find_all("p", recursive=False):
        txt = p.get_text(" ", strip=True)
        if txt:
            lines.append(f"> {txt}")
    if not lines:
        txt = el.get_text(" ", strip=True)
        if txt:
            lines.append(f"> {txt}")
    return lines


def _table_to_md(el: Tag) -> list[str]:
    """HTML-таблица -> Markdown-таблица (| a | b | / |---|)."""
    rows: list[list[str]] = []
    for tr in el.find_all("tr"):
        cells = []
        for cell in tr.find_all(["td", "th"]):
            txt = cell.get_text(" ", strip=True)
            # экранируем пайпы внутри ячеек, чтобы не ломать markdown
            txt = txt.replace("|", "\\|")
            cells.append(txt)
        if cells:
            rows.append(cells)
    if not rows:
        return []

    n_cols = max(len(r) for r in rows)
    out = []
    for i, row in enumerate(rows):
        row = row + [""] * (n_cols - len(row))
        out.append("| " + " | ".join(row) + " |")
        if i == 0:
            out.append("| " + " | ".join(["---"] * n_cols) + " |")
    return out


def _walk_blocks(el: Tag, out: list[str]) -> None:
    """Рекурсивный обход DOM-кандидата, превращение структуры в Markdown."""
    for child in el.children:
        if isinstance(child, NavigableString):
            continue
        if not isinstance(child, Tag):
            continue
        name = child.name.lower()

        # Служебные/нежелательные блоки — пропускаем целиком
        if name in ("script", "style", "nav", "footer", "header", "aside", "noscript"):
            continue

        if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            txt = child.get_text(" ", strip=True)
            if txt:
                level = int(name[1])
                out.append("#" * level + " " + txt)
        elif name == "p":
            txt = child.get_text(" ", strip=True)
            if txt:
                out.append(txt)
        elif name in ("ul", "ol"):
            for li in child.find_all("li", recursive=False):
                txt = li.get_text(" ", strip=True)
                if txt:
                    out.append(f"- {txt}")
        elif name == "table":
            out.extend(_table_to_md(child))
        elif name == "blockquote":
            out.extend(_blockquote_to_md(child))
        elif name in ("div", "section", "article", "main", "td", "th", "span", "figure", "figcaption"):
            # пропускаем вложенные article/main — они уже обработаны на верхнем уровне
            if name in ("article", "main") and child is not el:
                continue
            _walk_blocks(child, out)
        # прочие (a, strong, em, img-обёртки и т.д.) — игнорируем, их текст
        # попадает через родительские p/h/li


def _extract_with_bs4_structure(soup: BeautifulSoup, url: Optional[str] = None) -> Optional[str]:
    """BS4-структурное извлечение: h1..h6 -> #, ul/ol -> -, table -> markdown."""
    candidate = find_content_candidate(soup, url)
    if candidate is None:
        return None

    out: list[str] = []
    _walk_blocks(candidate, out)

    text = "\n\n".join(out).strip()
    if not text:
        return None
    return text


# ── Извлечение: raw fallback ────────────────────────────────

def _extract_raw_text(soup: BeautifulSoup) -> str:
    """Грубый fallback: убираем семантический мусор, склеиваем строки."""
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()
    for selector in [
        "[role='navigation']", "[role='banner']", "[role='contentinfo']",
        ".menu", ".nav", ".sidebar", ".footer", ".header",
        ".breadcrumb", ".cookie", ".banner",
    ]:
        for tag in soup.select(selector):
            tag.decompose()

    text = soup.get_text(separator="\n", strip=True)
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    return "\n".join(lines)


# ── Quality gate ────────────────────────────────────────────

def _assess_quality(
    text: str,
    soup: BeautifulSoup,
    url: Optional[str],
) -> tuple[bool, list[str]]:
    """Оценивает качество извлечённого текста.

    Возвращает (ok, warnings). Провал, если:
    - текст короче MIN_TEXT_LEN;
    - в DOM-кандидате >= MIN_H2_FOR_GATE H2, а в markdown 0;
    - текст заметно короче DOM-кандидата (< MIN_HALF_RATIO).
    """
    warnings: list[str] = []
    if not text:
        return False, ["empty text"]

    text_len = len(text)
    md_h = count_markdown_headings(text)

    candidate = find_content_candidate(soup, url)
    dom_h2 = 0
    cand_len = 0
    if candidate is not None:
        dom_h2 = len(candidate.find_all("h2"))
        cand_len = len(candidate.get_text(" ", strip=True))

    if text_len < MIN_TEXT_LEN:
        warnings.append(f"text too short ({text_len} < {MIN_TEXT_LEN})")
    if dom_h2 >= MIN_H2_FOR_GATE and md_h == 0:
        warnings.append(f"headings lost: {dom_h2} H2 in DOM, 0 in markdown")
    if cand_len > 0 and text_len < MIN_HALF_RATIO * cand_len:
        warnings.append(
            f"text {text_len} chars < {MIN_HALF_RATIO:.0%} of DOM candidate ({cand_len})"
        )

    return not warnings, warnings


# ── Оркестратор ─────────────────────────────────────────────

def extract_page_text_from_html(html: str, url: Optional[str] = None) -> PageTextResult:
    """Извлекает текст страницы, сохраняя структуру (Markdown).

    Каскад: Trafilatura -> quality gate -> BS4 structural -> raw text.
    Финальный текст прогоняется через clean_article_text() (детерминированная чиста).
    Обрезка до MAX_PAGE_CHARS НЕ выполняется здесь — она происходит на входе в LLM
    (entity_extractor.smart_truncate), чтобы отчёт хранил полный текст страницы.
    """
    soup = BeautifulSoup(html, "lxml")
    warnings: list[str] = []
    traf_warnings: list[str] = []

    # 1) Trafilatura
    traf = _extract_with_trafilatura(html)
    if traf:
        traf_clean = clean_article_text(traf)
        ok, traf_warnings = _assess_quality(traf_clean, soup, url)
        if ok:
            return _result("trafilatura", traf_clean, False, [])

    # 2) BS4 structural
    struct = _extract_with_bs4_structure(soup, url)
    if struct:
        struct_clean = clean_article_text(struct)
        ok, struct_warnings = _assess_quality(struct_clean, soup, url)
        if ok:
            return _result("bs4_structural", struct_clean, False, struct_warnings)

    # 3) raw text fallback
    raw = _extract_raw_text(soup)
    raw_clean = clean_article_text(raw)
    text = raw_clean
    warnings = ["fallback to raw_text"]
    if traf:
        warnings.append(f"trafilatura degraded: {traf_warnings}")
    if struct is None:
        warnings.append("no content candidate found")
    logger.warning(
        "Extraction degraded for %s (raw_text fallback): %s", url or "?", warnings
    )
    return _result("raw_text", text, False, warnings)


def _result(method: str, text: str, truncated: bool, warnings: list[str]) -> PageTextResult:
    counts = _heading_counts(text)
    return PageTextResult(
        text=text,
        method=method,
        char_count=len(text),
        h1_count=counts["h1"],
        h2_count=counts["h2"],
        h3_count=counts["h3"],
        truncated=truncated,
        warnings=list(warnings),
    )