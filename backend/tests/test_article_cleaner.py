import pytest
from services.article_cleaner import clean_article_text


def test_clean_meta_info():
    text = """Автор: Иван Петров
12 мая 2025
5 мин чтения

Это основной текст статьи. Он содержит полезную информацию.
Второй абзац текста с дополнительными деталями и пояснениями."""

    result = clean_article_text(text)
    assert "Иван Петров" not in result
    assert "12 мая 2025" not in result
    assert "5 мин чтения" not in result
    assert "Это основной текст статьи" in result


def test_clean_toc():
    text = """Содержание:
1. Введение
2. Основные принципы
3. Заключение

Введение в тему статьи. Здесь начинается полноценный контент, который
кратко подводит читателя к основной проблематике и помогает сориентироваться
в дальнейших разделах материала."""

    result = clean_article_text(text)
    assert "Содержание:" not in result
    assert "1. Введение" not in result
    assert "2. Основные принципы" not in result
    assert "3. Заключение" not in result
    assert "Введение в тему статьи" in result


def test_clean_tags():
    text = """Основной текст статьи.
Второй абзац с более подробным описанием темы и полезными деталями для читателя.

#SEO #контент #маркетинг
Теги: SEO, контент"""

    result = clean_article_text(text)
    assert "#SEO" not in result
    assert "Теги:" not in result
    assert "Основной текст статьи" in result


def test_glue_hyphen_breaks():
    text = """Это пример текста, в котором встречается перенос слова на границе
строк при копировании из документа: кон-
струкция должна быть склеена автоматически."""

    result = clean_article_text(text)
    assert "конструкция" in result
    assert "кон-\nструкция" not in result


def test_keep_main_content():
    text = """Заголовок статьи

Первый абзац основного текста. Он содержит важную информацию.

Второй абзац с деталями и развёрнутыми пояснениями к теме материала."""

    result = clean_article_text(text)
    assert "Заголовок статьи" in result
    assert "Первый абзац основного текста" in result
    assert "Второй абзац с деталями" in result


def test_service_buttons_exact_match():
    """Кнопки/виджеты (точное совпадение) удаляются."""
    text = """Основной текст статьи.
Поделиться
Читать далее →
Оставить комментарий

Финальный абзац с важными деталями и заключительными выводами материала."""

    result = clean_article_text(text)
    assert "Поделиться" not in result
    assert "Читать далее" not in result
    assert "Оставить комментарий" not in result
    assert "Основной текст статьи" in result
    assert "Финальный абзац" in result


def test_service_phrase_preserved():
    """Осмысленные предложения, начинающиеся со служебных слов, НЕ удаляются."""
    text = """Заголовок статьи

Поделиться опытом внедрения очень полезно для команды.
Читать далее рекомендации по оптимизации можно в нашем блоге.

Финальный абзац с важными деталями и заключительными выводами материала."""

    result = clean_article_text(text)
    assert "Поделиться опытом внедрения" in result
    assert "Читать далее рекомендации" in result
    assert "Финальный абзац" in result


def test_short_text_unchanged():
    """Текст короче 100 символов возвращается без изменений."""
    text = "Автор: Иван"
    assert clean_article_text(text) == text


def test_inline_hyphen_preserved():
    """Составное слово через дефис в одной строке не ломается."""
    text = """Это статья о красно-белом дизайне и его применении в веб-интерфейсах.
Второй абзац с деталями и развёрнутыми пояснениями."""

    result = clean_article_text(text)
    assert "красно-белом" in result


def test_mixed_latin_cyrillic():
    text = """Author: John Doe
Date: June 2026

Article about SEO optimization with important details and practical examples.
This is a longer body text that exceeds the minimum threshold to trigger cleaning.
#hashtag"""

    result = clean_article_text(text)
    assert "Author: John Doe" not in result
    assert "Date: June 2026" not in result
    assert "Article about SEO optimization" in result
    assert "#hashtag" not in result


def test_real_article_smoke():
    """Реальный markdown из Trafilatura: структура сохраняется, мусор режется."""
    text = """# Заголовок статьи

Автор: Иван Петров
12 мая 2025

## Введение

Это основной текст статьи с **жирным** и *курсивом*.

### Подзаголовок

- Пункт 1
- Пункт 2

| Колонка 1 | Колонка 2 |
|-----------|-----------|
| Данные    | Данные    |

## Заключение

Финальный абзац.

#SEO #контент
"""

    result = clean_article_text(text)

    # Структура сохранена
    assert "# Заголовок статьи" in result
    assert "## Введение" in result
    assert "**жирным**" in result
    assert "| Колонка 1 |" in result
    assert "## Заключение" in result

    # Мусор удалён
    assert "Автор: Иван Петров" not in result
    assert "12 мая 2025" not in result
    assert "#SEO" not in result