from fastapi import APIRouter, HTTPException
from models.schemas import ModelSetting, PromptsSetting
from db import get_setting, set_setting
from config import DEFAULT_MODEL
from prompts.default import ENTITY_EXTRACTION_PROMPT, GAP_ANALYSIS_PROMPT

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/model")
async def get_model() -> ModelSetting:
    model = get_setting("model") or DEFAULT_MODEL
    return ModelSetting(model=model)


@router.put("/model")
async def update_model(req: ModelSetting) -> ModelSetting:
    set_setting("model", req.model)
    return ModelSetting(model=req.model)


@router.get("/prompts")
async def get_prompts() -> PromptsSetting:
    return PromptsSetting(
        entity_prompt=get_setting("entity_prompt") or ENTITY_EXTRACTION_PROMPT,
        gap_prompt=get_setting("gap_prompt") or GAP_ANALYSIS_PROMPT,
    )


@router.put("/prompts")
async def update_prompts(req: PromptsSetting) -> PromptsSetting:
    set_setting("entity_prompt", req.entity_prompt)
    set_setting("gap_prompt", req.gap_prompt)
    return PromptsSetting(
        entity_prompt=req.entity_prompt,
        gap_prompt=req.gap_prompt,
    )


@router.post("/prompts/reset")
async def reset_prompts() -> PromptsSetting:
    set_setting("entity_prompt", ENTITY_EXTRACTION_PROMPT)
    set_setting("gap_prompt", GAP_ANALYSIS_PROMPT)
    return PromptsSetting(
        entity_prompt=ENTITY_EXTRACTION_PROMPT,
        gap_prompt=GAP_ANALYSIS_PROMPT,
    )