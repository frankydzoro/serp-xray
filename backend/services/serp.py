import httpx
import asyncio
import ipaddress
import logging
import socket
from typing import Optional
from urllib.parse import urlsplit, urljoin

from config import SERPAPI_API_KEY, DEFAULT_SERP_RESULTS
from services.text_extraction import extract_page_text_from_html

logger = logging.getLogger(__name__)


class SSRFError(RuntimeError):
    """URL blocked by SSRF protection (private/loopback/link-local IP, etc.)."""


def _blocked_ip_reason(ip_str: str) -> Optional[str]:
    """Returns the reason an IP is blocked, or None if the address is public.

    Order matters: in Python 3.11 is_private=True for many special ranges
    (loopback/link-local), so the more specific classes come first.
    """
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return "invalid"
    if ip.is_loopback:
        return "loopback"
    if ip.is_link_local or ip_str == "169.254.169.254":
        return "link-local"  # includes cloud metadata (AWS/GCP)
    if ip.is_private:
        return "private"
    if ip.is_multicast:
        return "multicast"
    if ip.is_reserved:
        return "reserved"
    if ip.is_unspecified:
        return "unspecified"
    return None


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def resolve_and_pin(url_str: str) -> tuple[str, str]:
    """SSRF check + DNS pinning.

    Returns (pinned_url, hostname):
      - resolves the hostname via getaddrinfo and checks ALL returned addresses
        (A+AAAA, including ::ffff:v4-mapped) for private/loopback/link-local/etc;
      - IP literals in the URL are checked directly, without resolution;
      - pinned_url = scheme://<verified IP>/path — the HTTP client connects to
        a specific IP and does NOT re-resolve the hostname internally (closes the
        main DNS rebinding window between check and connect).

    Raises: SSRFError with the block reason.
    """
    parsed = urlsplit(url_str)
    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        raise SSRFError("Only http/https URLs are allowed")
    host = parsed.hostname or ""
    if not host:
        raise SSRFError("Missing host in URL")
    if len(host) > 253:
        raise SSRFError("Host too long")

    try:
        port = parsed.port
    except ValueError:
        raise SSRFError("Invalid port in URL")

    if _is_ip_literal(host):
        reason = _blocked_ip_reason(host)
        if reason:
            raise SSRFError(f"Blocked URL: {host} ({reason} IP)")
        ip = host
    else:
        try:
            infos = socket.getaddrinfo(host, port or (443 if scheme == "https" else 80),
                                       proto=socket.IPPROTO_TCP)
        except socket.gaierror:
            raise SSRFError(f"DNS resolution failed for {host}")
        addrs = {str(info[4][0]) for info in infos}
        if not addrs:
            raise SSRFError(f"DNS resolution failed for {host}")
        for addr in addrs:
            reason = _blocked_ip_reason(addr)
            if reason:
                raise SSRFError(f"Blocked host {host}: resolves to {addr} ({reason} IP)")
        # Prefer IPv4 (first in the set), otherwise the first AAAA
        ip = next((a for a in addrs if ":" not in a), next(iter(addrs)))

    host_part = f"[{ip}]" if ":" in ip else ip
    if port:
        host_part = f"{host_part}:{port}"
    path = parsed.path or "/"
    pinned = f"{scheme}://{host_part}{path}"
    if parsed.query:
        pinned += f"?{parsed.query}"
    return pinned, host


async def _safe_get(client: httpx.AsyncClient, url: str, headers: dict, max_hops: int = 5) -> httpx.Response:
    """GET with an SSRF check on every hop and manual redirect handling.

    follow_redirects=False on the client — each redirect hop re-runs resolve_and_pin
    (a redirect to an internal address is blocked)."""
    current = url
    for _ in range(max_hops + 1):
        pinned, host = resolve_and_pin(current)
        req_headers = dict(headers)
        req_headers["Host"] = host
        # For https the connection goes to the IP, but SNI and cert validation use the original hostname
        extensions = {"sni_hostname": host} if pinned.startswith("https://") else None
        resp = await client.get(pinned, headers=req_headers, extensions=extensions)
        if resp.status_code in (301, 302, 303, 307, 308):
            loc = resp.headers.get("location")
            if not loc:
                return resp
            current = urljoin(current, loc)
            if not current.startswith(("http://", "https://")):
                raise SSRFError("Redirect to non-http(s) URL")
            continue
        resp.raise_for_status()
        return resp
    raise SSRFError("Too many redirects")


async def fetch_serp(query: str, engine: str = "google", num: int = 20) -> list[dict]:
    """Returns organic results from SerpAPI for the given engine.

    Args:
        query: the search query
        engine: 'google' or 'yandex'
        num: number of results

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
        "text": query,        # Yandex uses "text", not "q"
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
    """Returns the top-N results from one or both engines.

    Args:
        query: the search query
        engine: 'google', 'yandex', or 'both'
        num: number of results per engine
    """
    if num is None:
        num = DEFAULT_SERP_RESULTS

    if engine == "both":
        g_results, y_results = await asyncio.gather(
            _fetch_google(query, num),
            _fetch_yandex(query, num),
        )
        # Merge, dedupe by URL, interleave
        seen_urls = set()
        merged = []
        for pair in zip(g_results, y_results):
            for r in pair:
                if r["url"] not in seen_urls:
                    seen_urls.add(r["url"])
                    merged.append(r)
        # Add the leftovers (if the counts differ)
        for lst in (g_results, y_results):
            for r in lst:
                if r["url"] not in seen_urls:
                    seen_urls.add(r["url"])
                    merged.append(r)
        return merged[:num * 2]

    return await fetch_serp(query, engine, num)


async def fetch_page_text(url: str, timeout: int = 15) -> str:
    """Extracts the main page content as Markdown (structure preserved).

    Cascade: Trafilatura (favor_recall) → quality gate → BS4 structural → raw.
    Headings/lists/tables are preserved (#, -, |table|) — the LLM sees the structure.

    Security: the request goes through _safe_get — an SSRF check on every redirect
    hop + DNS pinning (connects to the verified IP, no re-resolution).
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SerpXray/1.0)"
    }

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        resp = await _safe_get(client, url, headers=headers)
        html = resp.text

    return extract_page_text_from_html(html, url).text
