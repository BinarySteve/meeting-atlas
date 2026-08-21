import httpx
from pydantic import BaseModel, Field, ValidationError

from .settings import get_settings


class LlamaCppModelStatus(BaseModel):
    value: str = Field(min_length=1, max_length=100)


class LlamaCppArchitecture(BaseModel):
    input_modalities: list[str] = Field(default_factory=list, max_length=20)
    output_modalities: list[str] = Field(default_factory=list, max_length=20)


class LlamaCppModel(BaseModel):
    id: str = Field(min_length=1, max_length=500)
    aliases: list[str] = Field(default_factory=list, max_length=100)
    status: LlamaCppModelStatus | None = None
    architecture: LlamaCppArchitecture | None = None


class LlamaCppModels(BaseModel):
    data: list[LlamaCppModel] = Field(max_length=1_000)


def parse_llm_models(payload: object) -> list[dict[str, str | bool]]:
    try:
        parsed = LlamaCppModels.model_validate(payload)
    except ValidationError as error:
        raise RuntimeError("llama.cpp router returned an invalid model list") from error
    models: list[dict[str, str | bool]] = []
    for model in parsed.data:
        if model.architecture is None or "text" in model.architecture.output_modalities:
            model_alias = next(
                (alias.strip() for alias in model.aliases if alias.strip()), model.id
            )
            models.append(
                {
                    "id": model_alias,
                    "display_name": model.id,
                    "loaded": model.status is not None and model.status.value == "loaded",
                }
            )
    return sorted(models, key=lambda model: (str(model["display_name"]).lower(), str(model["id"])))


def llama_cpp_models_url(base_url: str) -> str:
    url = httpx.URL(base_url)
    return str(url.copy_with(path="/v1/models", query=None))


async def available_llm_models() -> list[dict[str, str | bool]]:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=settings.llama_cpp_timeout_seconds) as client:
            response = await client.get(llama_cpp_models_url(settings.llama_cpp_url))
        if response.is_error:
            detail = response.text[:1_000].replace("\n", " ")
            raise RuntimeError(f"llama.cpp router HTTP {response.status_code}: {detail}")
        return parse_llm_models(response.json())
    except (httpx.HTTPError, ValueError) as error:
        raise RuntimeError("llama.cpp router model list is unavailable") from error
