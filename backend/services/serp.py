import httpx
import asyncio
import logging
from config import SERPAPI_API_KEY, DEFAULT_SERP_RESULTS
from services.article_cleaner import clean_article_text

logger = logging.getLogger(__name__)


async def fetch_serp(query: str, engine: str = "google", num: int = 20) -> list[dict]:
    """Возвращает organic results из SerpAPI для указанного движка.

    Args:
        query: поисковый запрос
        engine: 'google' или 'yandex'
        num: количество результатов

    Returns:
        [{url, title, snippet, position, engine}, ...]
    """
    if engine == "yandex":
        return await _fetch_yandex(query, num)
    return await _fetch_google(query, num)


async def _fetch_google(query: str, num: int) -> list[dict]:
    params = {
        "api_key": SERPAPI_API_KEY,
        "q": query,
        "num": min(num, 20),
        "engine": "google",
        "gl": "ru",
        "hl": "ru",
        "fields": "organic_results(link,title,snippet,position),search_metadata(status),error",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get("https://serpapi.com/search", params=params)
        resp.raise_for_status()
        data = resp.json()

        if "error" in data:
            raise RuntimeError(f"SerpAPI error: {data['error']}")

        results = []
        for i, r in enumerate(data.get("organic_results", [])[:num]):
            results.append({
                "url": r.get("link", ""),
                "title": r.get("title", ""),
                "snippet": r.get("snippet", ""),
                "position": i + 1,
                "engine": "google",
            })
        return results


async def _fetch_yandex(query: str, num: int) -> list[dict]:
    params = {
        "api_key": SERPAPI_API_KEY,
        "text": query,        # Yandex использует "text", не "q"
        "num": min(num, 20),
        "engine": "yandex",
        "yandex_domain": "yandex.ru",
        "lang": "ru",
        "fields": "organic_results(link,title,snippet,position),search_metadata(status),error",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get("https://serpapi.com/search", params=params)
        resp.raise_for_status()
        data = resp.json()

        if "error" in data:
            raise RuntimeError(f"SerpAPI Yandex error: {data['error']}")

        results = []
        for i, r in enumerate(data.get("organic_results", [])[:num]):
            results.append({
                "url": r.get("link", ""),
                "title": r.get("title", ""),
                "snippet": r.get("snippet", ""),
                "position": i + 1,
                "engine": "yandex",
            })
        return results


async def fetch_top20(query: str, engine: str = "google", num: int = None) -> list[dict]:
    """Возвращает топ-N результатов из одного или обоих движков.

    Args:
        query: поисковый запрос
        engine: 'google', 'yandex', или 'both'
        num: количество результатов на движок
    """
    if num is None:
        num = DEFAULT_SERP_RESULTS

    if engine == "both":
        g_results, y_results = await asyncio.gather(
            _fetch_google(query, num),
            _fetch_yandex(query, num),
        )
        # Объединяем, дедуплицируем по URL, чередуем
        seen_urls = set()
        merged = []
        for pair in zip(g_results, y_results):
            for r in pair:
                if r["url"] not in seen_urls:
                    seen_urls.add(r["url"])
                    merged.append(r)
        # Добавляем оставшиеся (если разное количество)
        for lst in (g_results, y_results):
            for r in lst:
                if r["url"] not in seen_urls:
                    seen_urls.add(r["url"])
                    merged.append(r)
        return merged[:num * 2]

    return await fetch_serp(query, engine, num)


async def fetch_page_text(url: str, timeout: int = 15) -> str:
    """Извлекает основной контент страницы через Trafilatura (markdown).
    
    Trafilatura автоматически отсеивает навигацию, меню, футеры, сайдбары,
    рекламу и прочий boilerplate. Сохраняет структуру: заголовки, списки, таблицы.
    При неудаче — fallback на BeautifulSoup с улучшенной фильтрацией.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SerpXray/1.0; +http://localhost:3000)"
    }

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        html = resp.text

    # ── Trafilatura (основной метод) ──
    try:
        import trafilatura
        extracted = trafilatura.extract(
            html,
            output_format="markdown",
            include_tables=True,
            include_images=False,
            include_links=False,
        )
        if extracted and len(extracted.strip()) > 50:
            return clean_article_text(extracted.strip())
        if extracted:
            logger.warning(
                "Trafilatura returned short content (%d chars) for %s, falling back to BS4",
                len(extracted.strip()), url,
            )
        else:
            logger.warning("Trafilatura returned None for %s, falling back to BS4", url)
    except Exception as e:
        logger.warning("Trafilatura failed for %s: %s, falling back to BS4", url, e)

    # ── BeautifulSoup (fallback) ──
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")

    # Удаляем семантические контейнеры
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()

    # Удаляем по CSS-селекторам: меню, сайдбары, хлебные крошки, cookie-баннеры
    for selector in [
        "[role='navigation']", "[role='banner']", "[role='contentinfo']",
        ".menu", ".nav", ".sidebar", ".footer", ".header",
        ".breadcrumb", ".cookie", ".banner",
    ]:
        for tag in soup.select(selector):
            tag.decompose()

    text = soup.get_text(separator="\n", strip=True)
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    return clean_article_text("\n".join(lines))