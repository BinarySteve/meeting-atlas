import json
import math
import wave
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
        "--suppress-nst",
    ]
    if settings.whisper_language != "auto":
        args.extend(["--language", settings.whisper_language])
    result = await run_controlled(
        executable, args, timeout_seconds=settings.subprocess_timeout_seconds
    )
    output_path = output_prefix.with_suffix(".json")
    try:
        raw = json.loads(output_path.read_text(encoding="utf-8"))
    finally:
        output_path.unlink(missing_ok=True)
    duration_ms = _wav_duration_ms(audio_path)
    _validate_absolute_timeline(raw, duration_ms)
    return {
        "model": settings.whisper_model_name,
        "backend": settings.whisper_backend,
        "duration_seconds": result.duration_seconds,
        "timeline": {
            "basis": "normalized_audio",
            "unit": "milliseconds",
            "duration_ms": duration_ms,
            "speech_gaps_preserved": True,
        },
        "raw": raw,
    }


def _wav_duration_ms(audio_path: Path) -> int:
    try:
        with wave.open(str(audio_path), "rb") as audio:
            frame_rate = audio.getframerate()
            if frame_rate <= 0:
                raise RuntimeError("Normalized audio has invalid sample rate")
            return round(audio.getnframes() / frame_rate * 1000)
    except (wave.Error, OSError) as error:
        raise RuntimeError("Normalized audio is not a readable PCM WAV") from error


def _validate_absolute_timeline(raw: Any, duration_ms: int) -> None:
    transcription = raw.get("transcription") if isinstance(raw, dict) else None
    if not isinstance(transcription, list):
        raise RuntimeError("whisper.cpp returned malformed transcription timing")
    previous_start = 0.0
    upper_bound = duration_ms + 1000
    for segment in transcription:
        offsets = segment.get("offsets") if isinstance(segment, dict) else None
        start = offsets.get("from") if isinstance(offsets, dict) else None
        end = offsets.get("to") if isinstance(offsets, dict) else None
        if (
            not isinstance(start, int | float)
            or not isinstance(end, int | float)
            or not math.isfinite(start)
            or not math.isfinite(end)
            or start < previous_start
            or start < 0
            or end <= start
            or end > upper_bound
        ):
            raise RuntimeError("whisper.cpp returned invalid absolute timestamps")
        previous_start = start
