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


class ModelSetting(BaseModel):
    model: str


class PromptsSetting(BaseModel):
    entity_prompt: str
    gap_prompt: str