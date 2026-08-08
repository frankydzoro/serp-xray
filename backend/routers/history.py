from fastapi import APIRouter, HTTPException
from db import list_analyses, get_analysis

router = APIRouter(prefix="/api", tags=["history"])


@router.get("/history")
async def get_history(limit: int = 50):
    """Возвращает последние N анализов (без result_json)."""
    return list_analyses(limit)


@router.get("/history/{analysis_id}")
async def get_analysis_detail(analysis_id: str):
    """Возвращает полный отчёт анализа по ID."""
    result = get_analysis(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail="Анализ не найден")
    return result