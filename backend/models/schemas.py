from pydantic import BaseModel, Field
from typing import Optional, Literal


class AnalyzeRequest(BaseModel):
    query: str
    url: Optional[str] = None  # URL страницы пользователя для сравнения
    engine: Literal["google", "yandex", "both"] = "google"


class Entity(BaseModel):
    name: str
    type: str  # Person, Organization, Concept, Product, Event, Location, Metric
    confidence: float  # 0-1
    source_url: str


class GapItem(BaseModel):
    entity: str
    entity_type: str
    found_in_top3: bool
    found_in_user_page: bool
    priority: str  # critical, high, medium, low
    recommendation: str
    found_on_urls: list[dict] = []  # [{url, title, position}, ...]


class AnalysisReport(BaseModel):
    id: str
    query: str
    timestamp: str
    entities_found: int
    user_entity_coverage: float  # % покрытия (0-100)
    top3_entity_coverage: float
    gaps: list[GapItem]
    checklist: list[str]


class ModelSetting(BaseModel):
    model: str


class PromptsSetting(BaseModel):
    entity_prompt: str
    gap_prompt: str