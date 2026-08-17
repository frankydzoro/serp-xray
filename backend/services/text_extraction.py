"""Page text extraction with structure preservation (Markdown).

Architecture (per spec 2026-08-10):
1. Trafilatura (favor_recall=True, output_format="markdown") — primary method.
2. Quality gate: length + Markdown headings vs the DOM candidate.
3. If Trafilatura dropped headings or the text is suspiciously short —
   BS4 structural extraction (h1..h6 -> #, p -> text, li -> -, table -> markdown).
4. Crude fallback — get_text().
5. Truncation to MAX_PAGE_CHARS — by blocks (not by characters).

Metadata (author, datePublished, JSON-LD) is intentionally not extracted — a
separate task, not critical for the current fix.
"""
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

from bs4 import BeautifulSoup, NavigableString, Tag

from services.article_cleaner import clean_article_text
from config import MAX_PAGE_CHARS

logger = logging.getLogger(__name__)

# ── Quality thresholds ──────────────────────────────────────
MIN_TEXT_LEN = 300              # text shorter than this → considered a failure
MIN_HALF_RATIO = 0.5            # text < 50% of the DOM candidate → considered a failure
MIN_H2_FOR_GATE = 2             # ≥2 H2 in the DOM but 0 in markdown → headings lost

# ── Main content selector cascade ───────────────────────────
# Generic selectors — work on most templates.
MAIN_CONTENT_SELECTORS = [
    "article",
    '[itemprop="articleBody"]',
    "main",
    ".article-content",
    ".post-content",
    ".entry-content",
    "#content",
]

# Domain overrides — ONLY as extra priority, not the sole path
# (for templates without article/main).
# Roseltorg: the article lives in div.article-reader, there is no article/main in the DOM.
DOMAIN_SELECTORS = {
    "cv.roseltorg.ru": [".article-reader"],
}

# Regex for Markdown headings: a line starting with 1-6 '#' + a space
MD_HEADING_RE = re.compile(r"^#{1,6}\s", re.MULTILINE)


@dataclass
class PageTextResult:
    """Text extraction result + quality metrics."""
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
    """Number of Markdown headings (#/##/###...) in the text."""
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
    """Truncation by blocks (paragraphs), not by characters.

    Returns (truncated_text, was_truncated).
    If the limit is smaller than the first block — hard-cut at limit (better something than nothing).
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


# ── Extraction: Trafilatura ─────────────────────────────────

def _extract_with_trafilatura(html: str) -> Optional[str]:
    """Trafilatura in recall mode (more text, markdown, no links/images)."""
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


# ── Extraction: BS4 structural ──────────────────────────────

def _domain_for_url(url: Optional[str]) -> str:
    if not url:
        return ""
    try:
        from urllib.parse import urlparse
        return (urlparse(url).hostname or "").lower()
    except Exception:  # noqa: BLE001
        return ""


def find_content_candidate(soup: BeautifulSoup, url: Optional[str] = None) -> Optional[Tag]:
    """Finds the main content container (selector cascade + domain overrides)."""
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
    """HTML table -> Markdown table (| a | b | / |---|)."""
    rows: list[list[str]] = []
    for tr in el.find_all("tr"):
        cells = []
        for cell in tr.find_all(["td", "th"]):
            txt = cell.get_text(" ", strip=True)
            # escape pipes inside cells so they don't break the markdown
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
    """Recursive walk of the DOM candidate, converting structure to Markdown."""
    for child in el.children:
        if isinstance(child, NavigableString):
            continue
        if not isinstance(child, Tag):
            continue
        name = child.name.lower()

        # Service/undesirable blocks — skip entirely
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
            # skip nested article/main — already handled at the top level
            if name in ("article", "main") and child is not el:
                continue
            _walk_blocks(child, out)
        # the rest (a, strong, em, img-wrappers, etc.) — ignored; their text
        # is captured through the parent p/h/li


def _extract_with_bs4_structure(soup: BeautifulSoup, url: Optional[str] = None) -> Optional[str]:
    """BS4 structural extraction: h1..h6 -> #, ul/ol -> -, table -> markdown."""
    candidate = find_content_candidate(soup, url)
    if candidate is None:
        return None

    out: list[str] = []
    _walk_blocks(candidate, out)

    text = "\n\n".join(out).strip()
    if not text:
        return None
    return text


# ── Extraction: raw fallback ────────────────────────────────

def _extract_raw_text(soup: BeautifulSoup) -> str:
    """Crude fallback: removes semantic junk, glues lines."""
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
    """Assesses the quality of the extracted text.

    Returns (ok, warnings). Fails if:
    - the text is shorter than MIN_TEXT_LEN;
    - the DOM candidate has >= MIN_H2_FOR_GATE H2 but markdown has 0;
    - the text is noticeably shorter than the DOM candidate (< MIN_HALF_RATIO).
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


# ── Orchestrator ─────────────────────────────────────────────

def extract_page_text_from_html(html: str, url: Optional[str] = None) -> PageTextResult:
    """Extracts page text while preserving structure (Markdown).

    Cascade: Trafilatura → quality gate → BS4 structural → raw text.
    The final text is run through clean_article_text() (deterministic cleanup).
    Truncation to MAX_PAGE_CHARS is NOT done here — it happens at the LLM input
    (entity_extractor.smart_truncate), so the report keeps the full page text.
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
