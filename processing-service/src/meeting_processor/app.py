import asyncio
import json
import logging
import time
from collections.abc import Awaitable
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .diarization import diarize
from .files import receive_stream
from .llm import structured_completion
from .security import require_service_auth
from .settings import get_settings
from .whisper import transcribe

app = FastAPI(title="Private Meeting Processor", docs_url=None, redoc_url=None)
active_requests: dict[str, asyncio.Task[Any]] = {}
logger = logging.getLogger("meeting_processor")


class LlmRequest(BaseModel):
    system: str = Field(min_length=1, max_length=20_000)
    user: str = Field(min_length=1, max_length=1_000_000)
    schema_: dict[str, Any] = Field(alias="schema")


@app.get("/health")
def health(_: None = Depends(require_service_auth)) -> dict[str, Any]:
    settings = get_settings()
    components = {
        "whisper_executable": settings.whisper_executable.is_file(),
        "whisper_model": settings.whisper_model_path.is_file(),
        "vad_model": bool(
            settings.whisper_vad_model_path and settings.whisper_vad_model_path.is_file()
        ),
        "diarization_model": all(
            (settings.wespeaker_model_path / filename).is_file()
            for filename in ("avg_model.pt", "config.yaml")
        ),
    }
    return {
        "status": "healthy" if all(components.values()) else "degraded",
        "components": components,
        "whisper_backend": settings.whisper_backend,
        "whisper_model_name": settings.whisper_model_name,
        "diarization_backend": "wespeaker",
        "diarization_device": settings.wespeaker_device,
        "lm_studio_model": settings.lm_studio_model,
    }


@app.post("/v1/transcribe")
async def transcribe_route(
    request: Request,
    _: None = Depends(require_service_auth),
    x_filename: str = Header(default="audio.wav"),
    x_request_id: str = Header(default="", max_length=200),
) -> dict[str, Any]:
    suffix = Path(x_filename).suffix
    async for path, sha256, byte_size in receive_stream(request, suffix):
        try:
            result = await registered(x_request_id, "transcription", transcribe(path))
            return {**result, "input_sha256": sha256, "input_bytes": byte_size}
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
    raise HTTPException(status_code=400, detail="No input")


@app.post("/v1/diarize")
async def diarize_route(
    request: Request,
    _: None = Depends(require_service_auth),
    x_filename: str = Header(default="audio.wav"),
    x_request_id: str = Header(default="", max_length=200),
) -> dict[str, Any]:
    suffix = Path(x_filename).suffix
    async for path, sha256, byte_size in receive_stream(request, suffix):
        try:
            result = await registered(
                x_request_id, "diarization", asyncio.to_thread(diarize, path)
            )
            return {**result, "input_sha256": sha256, "input_bytes": byte_size}
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
    raise HTTPException(status_code=400, detail="No input")


@app.post("/v1/llm/structured")
async def llm_route(
    body: LlmRequest,
    _: None = Depends(require_service_auth),
    x_request_id: str = Header(default="", max_length=200),
) -> dict[str, Any]:
    return await registered(
        x_request_id,
        "summarization",
        structured_completion(body.system, body.user, body.schema_),
    )


@app.post("/v1/cancel/{request_id}")
async def cancel_route(
    request_id: str, _: None = Depends(require_service_auth)
) -> dict[str, Any]:
    task = active_requests.get(request_id)
    if task is None:
        return {"cancelled": False, "status": "not_found_or_finished"}
    task.cancel()
    return {"cancelled": True, "status": "cancel_requested"}


async def registered[T](request_id: str, stage: str, operation: Awaitable[T]) -> T:
    task = asyncio.current_task()
    started = time.perf_counter()
    if request_id and task is not None:
        active_requests[request_id] = task
    try:
        result = await operation
        logger.info(
            json.dumps(
                {
                    "event": "processing_completed",
                    "request_id": request_id,
                    "stage": stage,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                }
            )
        )
        return result
    except BaseException as error:
        logger.warning(
            json.dumps(
                {
                    "event": "processing_interrupted",
                    "request_id": request_id,
                    "stage": stage,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                    "error_type": type(error).__name__,
                }
            )
        )
        raise
    finally:
        if request_id and active_requests.get(request_id) is task:
            active_requests.pop(request_id, None)
