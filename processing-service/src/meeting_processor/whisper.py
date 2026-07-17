import json
from pathlib import Path
from typing import Any

from .settings import get_settings
from .subprocesses import run_controlled


async def transcribe(audio_path: Path) -> dict[str, Any]:
    settings = get_settings()
    executable = settings.whisper_executable
    model = settings.whisper_model_path
    if not executable.is_file():
        raise RuntimeError(f"whisper.cpp executable unavailable: {executable}")
    if not model.is_file():
        raise RuntimeError(f"Whisper model unavailable: {model}")
    output_prefix = audio_path.with_suffix("")
    args = [
        "--model", str(model),
        "--file", str(audio_path),
        "--output-json-full",
        "--output-file", str(output_prefix),
        "--threads", str(settings.whisper_threads),
        "--print-progress", "false",
        "--print-special", "false",
        "--print-colors", "false",
    ]
    if settings.whisper_language != "auto":
        args.extend(["--language", settings.whisper_language])
    if settings.whisper_vad_enabled:
        if not settings.whisper_vad_model_path or not settings.whisper_vad_model_path.is_file():
            raise RuntimeError("VAD enabled but local VAD model is unavailable")
        args.extend(["--vad", "--vad-model", str(settings.whisper_vad_model_path)])
    result = await run_controlled(
        executable, args, timeout_seconds=settings.subprocess_timeout_seconds
    )
    output_path = output_prefix.with_suffix(".json")
    try:
        raw = json.loads(output_path.read_text(encoding="utf-8"))
    finally:
        output_path.unlink(missing_ok=True)
    return {
        "model": settings.whisper_model_name,
        "backend": settings.whisper_backend,
        "duration_seconds": result.duration_seconds,
        "raw": raw,
    }
