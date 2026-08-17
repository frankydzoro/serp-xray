import re

# ── Scan constants ──────────────────────────────────
META_SCAN_LINES = 10   # meta info is searched in the first N lines
TOC_SCAN_LINES = 20    # table of contents is searched in the first N lines
TAG_SCAN_LINES = 10    # tags are searched in the last N lines

# ── Meta-info patterns at the start of an article ──
META_PATTERNS = [
    r'^(автор|author|дата|date|опубликовано|published|рубрика|category|теги|tags):\s*',
    r'^\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}',
    r'^\d+\s+мин(ут)?\s+чтения',
    r'^(читать|read)\s+\d+\s+мин',
]

# ── Table-of-contents patterns ─────────────────────
TOC_PATTERNS = [
    r'^(содержание|оглавление|table of contents|contents):',
]

# ── Tag patterns at the end of an article ──────────
TAG_PATTERNS = [
    r'^#[\wа-яА-ЯёЁ]+',
    r'^(теги|tags):\s*.*',
]

# ── Service element patterns (exact matches + tails) ─
# Buttons/widgets: «Поделиться», «Читать далее →», «Оставить комментарий».
# Exact match + optional separator tails, so meaningful sentences
# («Поделиться опытом внедрения…») are NOT cut.
SERVICE_PATTERNS = [
    r'^(поделиться|share|оставить комментарий|leave a comment|читать далее|read more|'
    r'нашли ошибку|сообщить об ошибке|распечатать|print|скопировать ссылку)\s*[.?:：→»›…]*$',
]

# Gluing word breaks: a hyphen at the end of a line — a line break.
# Compound words («красно-белый») never appear broken on the web
# (the word is stored whole in the DOM), while breaks come from pasted PDF/Word,
# so `-\n` is always glued.
HYPHEN_BREAK_RE = re.compile(r'-\n')


def clean_article_text(text: str) -> str:
    """Deterministic cleanup of article text from structural noise.

    Removes:
    - Leading meta info (author, date, category, read time)
    - Table of contents (numbered lists in the first 20 lines)
    - Tags and hashtags at the end of the article
    - Service elements (Поделиться, Читать далее, Оставить комментарий)

    Glues:
    - Word breaks across a hyphen ("кон- \n струкция" → "конструкция")

    Does not use the LLM. Works with regular expressions only.
    """
    if not text or len(text) < 100:
        return text

    # 0. Glue word breaks BEFORE splitting into lines
    text = HYPHEN_BREAK_RE.sub('', text)

    lines = text.split('\n')
    cleaned_lines = []
    skip_toc_block = False
    total_lines = len(lines)

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Keep empty lines (paragraph separators)
        if not stripped:
            cleaned_lines.append(line)
            continue

        # 1. Leading meta info (first META_SCAN_LINES lines)
        if i < META_SCAN_LINES:
            if any(re.match(p, stripped, re.IGNORECASE) for p in META_PATTERNS):
                continue

        # 2. Table of contents (first TOC_SCAN_LINES lines)
        if i < TOC_SCAN_LINES:
            # A TOC heading — enable skip mode
            if any(re.match(p, stripped, re.IGNORECASE) for p in TOC_PATTERNS):
                skip_toc_block = True
                continue

            # In skip mode: TOC items are skipped; the first non-item line ends the block
            if skip_toc_block:
                if re.match(r'^\d+\.\s+\w+', stripped):
                    continue
                skip_toc_block = False

        # 3. Tags at the end (last TAG_SCAN_LINES lines)
        if i > total_lines - TAG_SCAN_LINES - 1:
            if any(re.match(p, stripped, re.IGNORECASE) for p in TAG_PATTERNS):
                continue

        # 4. Service elements (anywhere) — exact matches
        if any(re.match(p, stripped, re.IGNORECASE) for p in SERVICE_PATTERNS):
            continue

        cleaned_lines.append(line)

    # Remove stray empty lines at the start and end
    return '\n'.join(cleaned_lines).strip()
