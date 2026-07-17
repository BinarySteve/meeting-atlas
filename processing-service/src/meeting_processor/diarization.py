import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from .settings import get_settings


@lru_cache(maxsize=1)
def _model() -> Any:
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    import wespeaker  # type: ignore[import-not-found]  # Upstream package ships no type stubs.

    settings = get_settings()
    required = [
        settings.wespeaker_model_path / "avg_model.pt",
        settings.wespeaker_model_path / "config.yaml",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError(f"WeSpeaker model unavailable; missing: {', '.join(missing)}")
    model = wespeaker.load_model(str(settings.wespeaker_model_path))
    model.set_device(settings.wespeaker_device)
    model.set_diarization_params(
        min_duration=settings.wespeaker_min_duration,
        window_secs=settings.wespeaker_window_seconds,
        period_secs=settings.wespeaker_period_seconds,
        batch_size=settings.wespeaker_batch_size,
    )
    return model


def _turns(result: Any) -> list[dict[str, Any]]:
    turns: list[dict[str, Any]] = []
    for item in result:
        if len(item) != 4:
            raise RuntimeError("WeSpeaker returned malformed diarization turn")
        _, raw_start, raw_end, raw_speaker = item
        start = float(raw_start)
        end = float(raw_end)
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            raise RuntimeError("WeSpeaker returned invalid diarization timing")
        turns.append(
            {"start": start, "end": end, "speaker": f"WESPEAKER_{raw_speaker}"}
        )
    return sorted(turns, key=lambda turn: (turn["start"], turn["end"], turn["speaker"]))


def diarize(audio_path: Path) -> dict[str, Any]:
    turns = _turns(_model().diarize(str(audio_path), "meeting"))
    return {
        "backend": "wespeaker",
        "model": "WeSpeaker ResNet221-LM (VoxCeleb)",
        "turns": turns,
        "exclusive_turns": [],
        "capabilities": {"overlap_detection": False, "exclusive_timing": False},
    }
