from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from .settings import get_settings


class LmStudioModel(BaseModel):
    type: Literal["llm", "embedding"]
    key: str = Field(min_length=1, max_length=500)
    display_name: str = Field(min_length=1, max_length=500)
    loaded_instances: list[dict[str, Any]] = Field(default_factory=list)


class LmStudioModels(BaseModel):
    models: list[LmStudioModel] = Field(max_length=1_000)


def parse_llm_models(payload: object) -> list[dict[str, str | bool]]:
    try:
        parsed = LmStudioModels.model_validate(payload)
    except ValidationError as error:
        raise RuntimeError("LM Studio returned an invalid model list") from error
    models: list[dict[str, str | bool]] = []
    for model in parsed.models:
        if model.type == "llm":
            models.append(
                {
                    "id": model.key,
                    "display_name": model.display_name,
                    "loaded": bool(model.loaded_instances),
                }
            )
    return sorted(models, key=lambda model: (str(model["display_name"]).lower(), str(model["id"])))


def lm_studio_models_url(base_url: str) -> str:
    url = httpx.URL(base_url)
    return str(url.copy_with(path="/api/v1/models", query=None))


async def available_llm_models() -> list[dict[str, str | bool]]:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=settings.lm_studio_timeout_seconds) as client:
            response = await client.get(lm_studio_models_url(settings.lm_studio_url))
        if response.is_error:
            detail = response.text[:1_000].replace("\n", " ")
            raise RuntimeError(f"LM Studio HTTP {response.status_code}: {detail}")
        return parse_llm_models(response.json())
    except (httpx.HTTPError, ValueError) as error:
        raise RuntimeError("LM Studio model list is unavailable") from error
