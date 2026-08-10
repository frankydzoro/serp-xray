import re

# ── Константы сканирования ──────────────────────────────
META_SCAN_LINES = 10   # мета-информация ищется в первых N строках
TOC_SCAN_LINES = 20    # оглавление ищется в первых N строках
TAG_SCAN_LINES = 10    # теги ищутся в последних N строках

# ── Паттерны мета-информации в начале статьи ────────────
META_PATTERNS = [
    r'^(автор|author|дата|date|опубликовано|published|рубрика|category|теги|tags):\s*',
    r'^\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}',
    r'^\d+\s+мин(ут)?\s+чтения',
    r'^(читать|read)\s+\d+\s+мин',
]

# ── Паттерны оглавления ─────────────────────────────────
TOC_PATTERNS = [
    r'^(содержание|оглавление|table of contents|contents):',
]

# ── Паттерны тегов в конце статьи ───────────────────────
TAG_PATTERNS = [
    r'^#[\wа-яА-ЯёЁ]+',
    r'^(теги|tags):\s*.*',
]

# ── Паттерны служебных элементов (точные матчи + хвосты) ─
# Кнопки/виджеты: «Поделиться», «Читать далее →», «Оставить комментарий».
# Точное совпадение + опциональные разделители-хвосты, чтобы НЕ резать
# осмысленные предложения («Поделиться опытом внедрения…»).
SERVICE_PATTERNS = [
    r'^(поделиться|share|оставить комментарий|leave a comment|читать далее|read more|'
    r'нашли ошибку|сообщить об ошибке|распечатать|print|скопировать ссылку)\s*[.?:：→»›…]*$',
]

# Склейка разрывов слов: дефис в конце строки — перенос.
# Составные слова («красно-белый») в вебе разорванными не встречаются
# (в DOM слово хранится целиком), а переносы приходят из pasted PDF/Word,
# поэтому `-\n` склеивается всегда.
HYPHEN_BREAK_RE = re.compile(r'-\n')


def clean_article_text(text: str) -> str:
    """Детерминированная очистка текста статьи от структурного мусора.

    Удаляет:
    - Мета-информацию в начале (автор, дата, рубрика, время чтения)
    - Оглавление (нумерованные списки в первых 20 строках)
    - Теги и хештеги в конце статьи
    - Служебные элементы (Поделиться, Читать далее, Оставить комментарий)

    Склеивает:
    - Разрывы слов через дефис ("кон- \\n струкция" → "конструкция")

    Не использует LLM. Работает только с регулярными выражениями.
    """
    if not text or len(text) < 100:
        return text

    # 0. Склейка разрывов слов ДО разбиения на строки
    text = HYPHEN_BREAK_RE.sub('', text)

    lines = text.split('\n')
    cleaned_lines = []
    skip_toc_block = False
    total_lines = len(lines)

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Сохраняем пустые строки (переносы между абзацами)
        if not stripped:
            cleaned_lines.append(line)
            continue

        # 1. Мета-информация в начале (первые META_SCAN_LINES строк)
        if i < META_SCAN_LINES:
            if any(re.match(p, stripped, re.IGNORECASE) for p in META_PATTERNS):
                continue

        # 2. Оглавление (первые TOC_SCAN_LINES строк)
        if i < TOC_SCAN_LINES:
            # Заголовок оглавления —— включаем режим пропуска
            if any(re.match(p, stripped, re.IGNORECASE) for p in TOC_PATTERNS):
                skip_toc_block = True
                continue

            # В режиме пропуска: пункты оглавления пропускаем,
            # первая непунктовая строка завершает блок
            if skip_toc_block:
                if re.match(r'^\d+\.\s+\w+', stripped):
                    continue
                skip_toc_block = False

        # 3. Теги в конце (последние TAG_SCAN_LINES строк)
        if i > total_lines - TAG_SCAN_LINES - 1:
            if any(re.match(p, stripped, re.IGNORECASE) for p in TAG_PATTERNS):
                continue

        # 4. Служебные элементы (в любом месте) — точные матчи
        if any(re.match(p, stripped, re.IGNORECASE) for p in SERVICE_PATTERNS):
            continue

        cleaned_lines.append(line)

    # Удаляем лишние пустые строки в начале и конце
    return '\n'.join(cleaned_lines).strip()