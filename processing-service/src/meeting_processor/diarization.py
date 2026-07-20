import hashlib
import importlib.metadata
import json
import math
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

from .settings import Settings, get_settings
from .subprocesses import run_controlled

MODEL_MANIFEST = ".meeting-atlas-model.json"


def _manifest_digest(manifest: dict[str, Any]) -> str:
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _configuration_fingerprint(
    settings: Settings, model_revision: str, model_digest: str = "legacy"
) -> str:
    if settings.diarization_backend == "pyannote":
        configuration: dict[str, object] = {
            "backend": "pyannote",
            "device": settings.pyannote_device,
            "max_speakers": settings.pyannote_max_speakers,
            "min_speakers": settings.pyannote_min_speakers,
            "model_digest": model_digest,
            "model_revision": model_revision,
        }
    else:
        configuration = {
            "backend": "wespeaker",
            "batch_size": settings.wespeaker_batch_size,
            "device": settings.wespeaker_device,
            "min_duration": settings.wespeaker_min_duration,
            "model_revision": model_revision,
            "period_seconds": settings.wespeaker_period_seconds,
            "window_seconds": settings.wespeaker_window_seconds,
        }
    encoded = json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _pyannote_manifest(settings: Settings) -> dict[str, Any]:
    model_path = settings.pyannote_model_path
    if model_path is None:
        raise RuntimeError("PYANNOTE_MODEL_PATH is required for the pyannote backend")
    manifest_path = model_path / MODEL_MANIFEST
    if not (model_path / "config.yaml").is_file() or not manifest_path.is_file():
        raise RuntimeError(
            f"Pyannote model unavailable; expected config.yaml and {MODEL_MANIFEST} in {model_path}"
        )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Pyannote model manifest is unreadable") from error
    revision = manifest.get("revision") if isinstance(manifest, dict) else None
    if not isinstance(revision, str) or not revision:
        raise RuntimeError("Pyannote model manifest has no revision")
    return cast(dict[str, Any], manifest)


def diarization_status(settings: Settings) -> dict[str, object]:
    if settings.diarization_backend == "wespeaker":
        path = settings.wespeaker_model_path
        ready = path is not None and all(
            (path / name).is_file() for name in ("avg_model.pt", "config.yaml")
        )
        return {
            "ready": ready,
            "model": "WeSpeaker ResNet221-LM (VoxCeleb)",
            "model_revision": "legacy",
            "requested_device": settings.wespeaker_device,
            "actual_device": settings.wespeaker_device if ready else "unavailable",
            "config_fingerprint": _configuration_fingerprint(settings, "legacy"),
            "speaker_bounds": None,
            "capabilities": {"overlap_detection": False, "exclusive_timing": False},
        }
    try:
        manifest = _pyannote_manifest(settings)
        revision = str(manifest["revision"])
        model_digest = _manifest_digest(manifest)
        actual_device = (
            _verified_pyannote_device(settings.pyannote_device)
            if _pyannote_package_ready()
            else "unavailable"
        )
        ready = actual_device != "unavailable"
    except RuntimeError:
        revision = "unavailable"
        model_digest = "unavailable"
        actual_device = "unavailable"
        ready = False
    return {
        "ready": ready,
        "model": "pyannote/speaker-diarization-community-1",
        "model_revision": revision,
        "model_digest": model_digest,
        "requested_device": settings.pyannote_device,
        "actual_device": actual_device,
        "config_fingerprint": _configuration_fingerprint(settings, revision, model_digest),
        "speaker_bounds": {
            "min": settings.pyannote_min_speakers,
            "max": settings.pyannote_max_speakers,
        },
        "capabilities": {"overlap_detection": True, "exclusive_timing": True},
    }


def _pyannote_package_ready() -> bool:
    try:
        return importlib.metadata.version("pyannote.audio") == "4.0.7"
    except importlib.metadata.PackageNotFoundError:
        return False


def _verified_pyannote_device(requested: str) -> str:
    if requested == "cpu":
        return "cpu"
    try:
        import torch  # type: ignore[import-not-found]
    except ImportError:
        return "unavailable"
    if not torch.cuda.is_available():
        return "unavailable"
    try:
        index = torch.device(requested).index or 0
        torch.empty(1, device=requested)
        return f"cuda:{index} ({torch.cuda.get_device_name(index)})"
    except (RuntimeError, ValueError):
        return "unavailable"


async def diarize(audio_path: Path) -> dict[str, Any]:
    settings = get_settings()
    if settings.diarization_backend == "wespeaker":
        return await _diarize_wespeaker(audio_path, settings)
    manifest = _pyannote_manifest(settings)
    if not _pyannote_package_ready():
        raise RuntimeError("pyannote.audio 4.0.7 is not installed")
    if _verified_pyannote_device(settings.pyannote_device) == "unavailable":
        raise RuntimeError(f"Requested Pyannote device unavailable: {settings.pyannote_device}")
    output_path = audio_path.with_suffix(".diarization.json")
    args = [
        "-m", "meeting_processor.diarization_runner",
        "--audio", str(audio_path),
        "--model", str(settings.pyannote_model_path),
        "--output", str(output_path),
        "--device", settings.pyannote_device,
        "--min-speakers", str(settings.pyannote_min_speakers),
        "--max-speakers", str(settings.pyannote_max_speakers),
    ]
    try:
        process = await run_controlled(
            Path(sys.executable), args,
            timeout_seconds=settings.subprocess_timeout_seconds,
            max_output_bytes=32_768,
        )
        try:
            result = json.loads(output_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError("Pyannote runner returned no valid result") from error
        if isinstance(result, dict):
            result["duration_seconds"] = process.duration_seconds
        _validate_result(result)
        expected = _configuration_fingerprint(
            settings, str(manifest["revision"]), _manifest_digest(manifest)
        )
        if result.get("config_fingerprint") != expected:
            raise RuntimeError("Pyannote runner configuration fingerprint mismatch")
        return cast(dict[str, Any], result)
    finally:
        output_path.unlink(missing_ok=True)


@lru_cache(maxsize=1)
def _wespeaker_model(model_path: str, device: str, min_duration: float,
                     window_seconds: float, period_seconds: float, batch_size: int) -> Any:
    import wespeaker  # type: ignore[import-not-found]

    path = Path(model_path)
    missing = [
        str(path / name)
        for name in ("avg_model.pt", "config.yaml")
        if not (path / name).is_file()
    ]
    if missing:
        raise RuntimeError(f"WeSpeaker model unavailable; missing: {', '.join(missing)}")
    model = wespeaker.load_model(str(path))
    model.set_device(device)
    model.set_diarization_params(
        min_duration=min_duration,
        window_secs=window_seconds,
        period_secs=period_seconds,
        batch_size=batch_size,
    )
    return model


async def _diarize_wespeaker(audio_path: Path, settings: Settings) -> dict[str, Any]:
    import asyncio

    if settings.wespeaker_model_path is None:
        raise RuntimeError("WESPEAKER_MODEL_PATH is required for the wespeaker backend")
    model = _wespeaker_model(
        str(settings.wespeaker_model_path), settings.wespeaker_device,
        settings.wespeaker_min_duration, settings.wespeaker_window_seconds,
        settings.wespeaker_period_seconds, settings.wespeaker_batch_size,
    )
    raw = await asyncio.to_thread(model.diarize, str(audio_path), "meeting")
    turns = _wespeaker_turns(raw)
    result = {
        "backend": "wespeaker",
        "model": "WeSpeaker ResNet221-LM (VoxCeleb)",
        "model_revision": "legacy",
        "device": settings.wespeaker_device,
        "config_fingerprint": _configuration_fingerprint(settings, "legacy"),
        "turns": turns,
        "exclusive_turns": [],
        "capabilities": {"overlap_detection": False, "exclusive_timing": False},
    }
    _validate_result(result)
    return result


def _wespeaker_turns(result: Any) -> list[dict[str, Any]]:
    turns: list[dict[str, Any]] = []
    for item in result:
        if len(item) != 4:
            raise RuntimeError("WeSpeaker returned malformed diarization turn")
        _, raw_start, raw_end, raw_speaker = item
        turns.append(
            {
                "start": float(raw_start),
                "end": float(raw_end),
                "speaker": f"WESPEAKER_{raw_speaker}",
            }
        )
    return sorted(turns, key=lambda turn: (turn["start"], turn["end"], turn["speaker"]))


def _validate_result(result: Any) -> None:
    if not isinstance(result, dict):
        raise RuntimeError("Diarization runner returned malformed output")
    for collection_name in ("turns", "exclusive_turns"):
        collection = result.get(collection_name)
        if not isinstance(collection, list):
            raise RuntimeError(f"Diarization output has malformed {collection_name}")
        previous_start = 0.0
        previous_end = 0.0
        for turn in collection:
            if not isinstance(turn, dict):
                raise RuntimeError("Diarization output contains malformed turn")
            start, end, speaker = turn.get("start"), turn.get("end"), turn.get("speaker")
            if (
                not isinstance(start, int | float) or not isinstance(end, int | float)
                or not math.isfinite(start) or not math.isfinite(end)
                or start < previous_start or start < 0 or end <= start
                or not isinstance(speaker, str) or not speaker
                or (collection_name == "exclusive_turns" and start < previous_end)
            ):
                raise RuntimeError("Diarization output contains invalid timing")
            previous_start = float(start)
            previous_end = float(end)
