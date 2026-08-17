"""Тесты SSRF-защиты: IP-литералы, резолв в private, IPv6, редиректы, DNS pinning.

Без сети: socket.getaddrinfo и httpx-клиент мокаются.
Запуск: cd backend && ./venv/bin/python3 -m pytest tests/test_ssrf.py -v
"""
import httpx
import pytest

from services import serp
from services.serp import SSRFError, resolve_and_pin, _safe_get


# ── IP-литералы ────────────────────────────

@pytest.mark.parametrize("url", [
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://172.16.0.1/x",
    "http://169.254.169.254/latest/meta-data/",  # cloud metadata
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",  # IPv4-mapped loopback
    "http://[fc00::1]/",           # IPv6 ULA
    "http://0.0.0.0/x",
])
def test_blocked_ip_literals(url):
    with pytest.raises(SSRFError):
        resolve_and_pin(url)


@pytest.mark.parametrize("url", [
    "ftp://example.com/x",
    "file:///etc/passwd",
    "gopher://example.com/x",
    "javascript:alert(1)",
])
def test_blocked_non_http_schemes(url):
    with pytest.raises(SSRFError):
        resolve_and_pin(url)


# ── Hostname → private при резолве ─────────

def test_blocked_host_resolving_to_private(monkeypatch):
    monkeypatch.setattr(serp.socket, "getaddrinfo",
                        lambda host, port, proto=0: [(2, 1, 6, "", ("10.0.0.7", port))])
    with pytest.raises(SSRFError, match="private"):
        resolve_and_pin("http://evil.example.com/x")


def test_valid_hostname_pins_to_public_ip(monkeypatch):
    monkeypatch.setattr(serp.socket, "getaddrinfo",
                        lambda host, port, proto=0: [(2, 1, 6, "", ("93.184.216.34", port))])
    pinned, host = resolve_and_pin("http://example.com/path?q=1")
    assert pinned == "http://93.184.216.34/path?q=1"
    assert host == "example.com"


# ── DNS pinning: коннект на проверенный IP ─

def test_pinned_url_uses_verified_ip_not_rebind(monkeypatch):
    """После проверки клиент получает URL с IP, а не hostname: повторный резолв
    DNS (который мог бы вернуть private) внутри HTTP-клиента невозможен."""
    calls = {"n": 0}

    def fake_getaddrinfo(host, port, proto=0):
        calls["n"] += 1
        if calls["n"] == 1:
            return [(2, 1, 6, "", ("93.184.216.34", port))]
        return [(2, 1, 6, "", ("127.0.0.1", port))]  # если резолв повторится — private

    monkeypatch.setattr(serp.socket, "getaddrinfo", fake_getaddrinfo)

    requested = []

    class FakeClient:
        async def get(self, url, headers=None, extensions=None):
            requested.append(url)
            return httpx.Response(200, text="ok", request=httpx.Request("GET", url))

    async def run():
        await _safe_get(FakeClient(), "http://example.com/path", {"User-Agent": "t"})

    import asyncio
    asyncio.run(run())

    assert calls["n"] == 1, "DNS должен резолвиться ровно один раз"
    assert requested == ["http://93.184.216.34/path"], "запрос идёт на pinned IP, не на hostname"


# ── Redirects ──────────────────────────────

def test_redirect_to_private_blocked_on_second_hop(monkeypatch):
    """Первый хоп публичный, редирект ведёт на 127.0.0.1 — блокируется."""
    monkeypatch.setattr(serp.socket, "getaddrinfo",
                        lambda host, port, proto=0: [(2, 1, 6, "", ("93.184.216.34", port))])

    class FakeClient:
        async def get(self, url, headers=None, extensions=None):
            req = httpx.Request("GET", url)
            if "93.184.216.34" in url:
                return httpx.Response(302, headers={"location": "http://127.0.0.1/internal"},
                                      request=req)
            return httpx.Response(200, text="ok", request=req)

    async def run():
        await _safe_get(FakeClient(), "http://example.com/start", {"User-Agent": "t"})

    import asyncio
    with pytest.raises(SSRFError):
        asyncio.run(run())


def test_too_many_redirects_blocked(monkeypatch):
    monkeypatch.setattr(serp.socket, "getaddrinfo",
                        lambda host, port, proto=0: [(2, 1, 6, "", ("93.184.216.34", port))])

    class LoopClient:
        async def get(self, url, headers=None, extensions=None):
            req = httpx.Request("GET", url)
            return httpx.Response(302, headers={"location": "http://example.com/loop"}, request=req)

    async def run():
        await _safe_get(LoopClient(), "http://example.com/start", {"User-Agent": "t"})

    import asyncio
    with pytest.raises(SSRFError, match="Too many redirects"):
        asyncio.run(run())