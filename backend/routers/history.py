from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db import list_analyses, get_analysis, delete_analysis, delete_analyses_bulk

router = APIRouter(prefix="/api", tags=["history"])


class BulkDeleteRequest(BaseModel):
    ids: list[str]


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


@router.delete("/history/{analysis_id}")
async def delete_analysis_endpoint(analysis_id: str):
    """Удаляет один анализ по ID."""
    if not delete_analysis(analysis_id):
        raise HTTPException(status_code=404, detail="Анализ не найден")
    return {"deleted": True, "id": analysis_id}


@router.post("/history/bulk-delete")
async def bulk_delete(req: BulkDeleteRequest):
    """Массовое удаление анализов."""
    if not req.ids:
        raise HTTPException(status_code=400, detail="Пустой список ID")
    count = delete_analyses_bulk(req.ids)
    return {"deleted": count, "ids": req.ids}