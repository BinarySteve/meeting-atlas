import asyncio
import json
import wave
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from meeting_processor import whisper
from meeting_processor.settings import Settings


def write_silent_wav(path: Path, duration_seconds: int = 1) -> None:
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16_000)
        audio.writeframes(bytes(16_000 * 2 * duration_seconds))


def test_transcription_preserves_absolute_timeline(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    audio_path = tmp_path / "meeting.wav"
    executable = tmp_path / "whisper-cli"
    model = tmp_path / "model.bin"
    write_silent_wav(audio_path)
    executable.touch()
    model.touch()
    settings = SimpleNamespace(
        whisper_executable=executable,
        whisper_model_path=model,
        whisper_threads=4,
        whisper_language="en",
        whisper_model_name="large-v3-turbo",
        whisper_backend="vulkan",
        subprocess_timeout_seconds=60,
    )
    observed_args: list[str] = []

    async def fake_run(_executable: Path, args: list[str], **_kwargs: Any) -> Any:
        observed_args.extend(args)
        output_prefix = Path(args[args.index("--output-file") + 1])
        output_prefix.with_suffix(".json").write_text(
            json.dumps({"transcription": [{
                "offsets": {"from": 100, "to": 900},
                "text": " hello",
                "tokens": [{"text": " hello", "offsets": {"from": 100, "to": 900}}],
            }]}),
            encoding="utf-8",
        )
        return SimpleNamespace(duration_seconds=0.5)

    monkeypatch.setattr(whisper, "get_settings", lambda: settings)
    monkeypatch.setattr(whisper, "run_controlled", fake_run)

    result = asyncio.run(whisper.transcribe(audio_path))

    assert "--vad" not in observed_args
    assert "--suppress-nst" in observed_args
    assert result["timeline"] == {
        "basis": "normalized_audio",
        "unit": "milliseconds",
        "duration_ms": 1000,
        "speech_gaps_preserved": True,
    }


def test_settings_reject_timeline_compacting_vad(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="synchronized transcript timestamps"):
        Settings(
            service_token="x" * 32,
            whisper_executable=tmp_path / "whisper-cli",
            whisper_model_path=tmp_path / "model.bin",
            whisper_vad_enabled=True,
            wespeaker_model_path=tmp_path / "wespeaker",
            lm_studio_model="local-model",
        )
