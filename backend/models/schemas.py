from pydantic import BaseModel, Field
from typing import Optional, Literal


class AnalyzeRequest(BaseModel):
    query: str
    url: Optional[str] = None
    user_text: Optional[str] = None
    engine: Literal["google", "yandex", "both"] = "google"


class AnalyzeResponse(BaseModel):
    """Immediate response — analysis ID for polling."""
    id: str
    status: str = "running"
    stage: str = "searching"


class AnalyzeStatus(BaseModel):
    """Status polling response."""
    id: str
    status: str  # running, completed, failed
    stage: str   # searching, fetching, extracting, analyzing, building, done, error
    result: Optional["AnalysisReport"] = None
    error: Optional[str] = None


class Entity(BaseModel):
    name: str
    type: str
    confidence: float
    source_url: str
    description: str = ""


class GapItem(BaseModel):
    entity: str
    entity_type: str
    found_in_competitors: bool
    found_in_user_page: bool
    priority: str
    recommendation: str
    competitor_description: str = ""
    found_on_urls: list[dict] = []


class CompetitorPage(BaseModel):
    """Текст и метаданные страницы конкурента."""
    url: str
    title: str
    position: int
    engine: str
    text: str
    entities: list[dict] = []


class AnalysisReport(BaseModel):
    id: str
    query: str
    timestamp: str
    entities_found: int
    user_entity_coverage: float
    competitor_entity_coverage: float
    gaps: list[GapItem]
    checklist: list[str] = []
    competitor_pages: list[CompetitorPage] = []
    user_page_text: str = ""
    # Wave 1: полные данные для Knowledge Graph
    all_competitor_entities: list[dict] = []
    user_entities: list[dict] = []
    cooccurrence_matrix: dict[str, int] = {}
    competitor_entity_frequencies: dict[str, int] = {}
    typed_edges: list[dict] = []


class ModelSetting(BaseModel):
    model: str


class PromptsSetting(BaseModel):
    entity_prompt: str
    gap_prompt: str


class RewritePromptsSetting(BaseModel):
    system_prompt: str
    user_prompt: str


class RewriteModelSetting(BaseModel):
    model: str


class RewriteRequest(BaseModel):
    article_text: str
    gaps: list[dict]
    model: Optional[str] = None
    analysis_id: Optional[str] = None


class RewriteResponse(BaseModel):
    """Ответ POST /api/rewrite — немедленный, до завершения генерации."""
    rewritten_text: str = ""
    rewritten_at: str = ""
    status: str = ""  # none | running | completed | failed
    started_at: str = ""


class RewriteResult(BaseModel):
    """Полное состояние rewrite (поллинг)."""
    status: str  # none | running | completed | failed
    error: str = ""
    rewritten_text: str = ""
    rewritten_at: str = ""
    started_at: str = ""