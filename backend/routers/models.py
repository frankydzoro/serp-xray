import asyncio
import time
from typing import Optional

import httpx
from fastapi import APIRouter, Query

from config import OPENROUTER_API_KEY, OPENROUTER_BASE_URL

router = APIRouter(prefix="/api/models", tags=["models"])

OPENROUTER_MODELS_URL = f"{OPENROUTER_BASE_URL}/models"

_cache: dict = {"data": [], "ts": 0}
_cache_lock = asyncio.Lock()
CACHE_TTL = 300  # 5 min


@router.get("")
async def list_models(
    q: Optional[str] = Query(None, description="Search by model name or slug"),
    modality: Optional[str] = Query(None, description="Modality filter"),
    sort: Optional[str] = Query(None, description="Sort: pricing-low-to-high, context-high-to-low, newest, most-popular"),
    min_price: Optional[float] = Query(None, description="Min prompt price $/M tokens"),
    max_price: Optional[float] = Query(None, description="Max prompt price $/M tokens"),
    min_context: Optional[int] = Query(None, description="Min context length"),
    category: Optional[str] = Query(None, description="Category: programming, marketing, etc."),
    providers: Optional[str] = Query(None, description="Comma-separated provider names"),
):
    """Proxy OpenRouter models API with caching and filtering."""
    # Check cache
    async with _cache_lock:
        if _cache["data"] and (time.time() - _cache["ts"]) < CACHE_TTL:
            data = _cache["data"]
        else:
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(
                        OPENROUTER_MODELS_URL,
                        headers={
                            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                            "Content-Type": "application/json",
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()["data"]
                    _cache["data"] = data
                    _cache["ts"] = time.time()
            except Exception as e:
                if _cache["data"]:
                    data = _cache["data"]  # stale cache fallback
                else:
                    return {"data": [], "error": str(e), "total": 0, "total_all": 0}

    # Filter
    filtered = data

    if modality:
        filtered = [
            m for m in filtered
            if m.get("architecture", {}).get("modality") == modality
        ]

    if q:
        q_lower = q.lower()
        filtered = [
            m for m in filtered
            if q_lower in m.get("name", "").lower() or q_lower in m.get("id", "").lower()
        ]

    if min_price is not None:
        filtered = [
            m for m in filtered
            if float(m.get("pricing", {}).get("prompt", "0") or "0") * 1_000_000 >= min_price
        ]

    if max_price is not None:
        filtered = [
            m for m in filtered
            if float(m.get("pricing", {}).get("prompt", "0") or "0") * 1_000_000 <= max_price
        ]

    if min_context is not None:
        filtered = [
            m for m in filtered
            if (m.get("context_length") or 0) >= min_context
        ]

    if category:
        cat_lower = category.lower()
        filtered = [
            m for m in filtered
            if any(
                cat_lower in str(c).lower()
                for c in (m.get("categories") or [m.get("category")] if m.get("category") else [])
            )
        ]

    if providers:
        prov_list = [p.strip().lower() for p in providers.split(",")]
        filtered = [
            m for m in filtered
            if any(
                prov in (m.get("top_provider", {}).get("name", "")).lower()
                or prov in m.get("id", "").lower().split("/")[0]
                for prov in prov_list
            )
        ]

    # Sort
    if sort == "pricing-low-to-high":
        filtered.sort(key=lambda m: _avg_price(m))
    elif sort == "pricing-high-to-low":
        filtered.sort(key=lambda m: _avg_price(m), reverse=True)
    elif sort == "context-high-to-low":
        filtered.sort(key=lambda m: m.get("context_length") or 0, reverse=True)
    elif sort == "newest":
        filtered.sort(key=lambda m: m.get("created") or 0, reverse=True)

    return {
        "data": filtered,
        "total": len(filtered),
        "total_all": len(data),
    }


def _avg_price(m: dict) -> float:
    p = m.get("pricing", {})
    prompt = float(p.get("prompt", "0") or "0")
    completion = float(p.get("completion", "0") or "0")
    return (prompt + completion) / 2