import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from meeting_processor import diarization


class FakeModel:
    def diarize(self, _audio_path: str, _utterance: str):
        return [
            ("meeting", 2.0, 3.0, 1),
            ("meeting", 0.0, 1.5, 0),
        ]


def wespeaker_settings(tmp_path: Path) -> Any:
    model_path = tmp_path / "wespeaker"
    model_path.mkdir()
    (model_path / "avg_model.pt").touch()
    (model_path / "config.yaml").touch()
    return SimpleNamespace(
        diarization_backend="wespeaker",
        wespeaker_model_path=model_path,
        wespeaker_device="cpu",
        wespeaker_min_duration=0.255,
        wespeaker_window_seconds=1.5,
        wespeaker_period_seconds=0.75,
        wespeaker_batch_size=32,
    )


def test_wespeaker_normalizes_and_sorts_turns(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = wespeaker_settings(tmp_path)
    monkeypatch.setattr(diarization, "get_settings", lambda: settings)
    monkeypatch.setattr(diarization, "_wespeaker_model", lambda *_args: FakeModel())

    result = asyncio.run(diarization.diarize(Path("audio.wav")))

    assert result["backend"] == "wespeaker"
    assert result["exclusive_turns"] == []
    assert result["turns"] == [
        {"start": 0.0, "end": 1.5, "speaker": "WESPEAKER_0"},
        {"start": 2.0, "end": 3.0, "speaker": "WESPEAKER_1"},
    ]


def test_wespeaker_rejects_bad_timing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = wespeaker_settings(tmp_path)
    bad_model = SimpleNamespace(diarize=lambda *_args: [("meeting", 3.0, 2.0, 0)])
    monkeypatch.setattr(diarization, "get_settings", lambda: settings)
    monkeypatch.setattr(diarization, "_wespeaker_model", lambda *_args: bad_model)

    with pytest.raises(RuntimeError, match="invalid timing"):
        asyncio.run(diarization.diarize(Path("audio.wav")))


def test_pyannote_runner_result_and_fingerprint(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    model_path = tmp_path / "pyannote"
    model_path.mkdir()
    (model_path / "config.yaml").touch()
    manifest = {"revision": "abc123"}
    (model_path / diarization.MODEL_MANIFEST).write_text(json.dumps(manifest), encoding="utf-8")
    settings = SimpleNamespace(
        diarization_backend="pyannote",
        pyannote_model_path=model_path,
        pyannote_device="cpu",
        pyannote_min_speakers=1,
        pyannote_max_speakers=8,
        subprocess_timeout_seconds=60,
    )

    async def fake_run(_executable: Path, args: list[str], **_kwargs: Any) -> Any:
        output = Path(args[args.index("--output") + 1])
        output.write_text(json.dumps({
            "backend": "pyannote",
            "model": "pyannote/speaker-diarization-community-1",
            "model_revision": "abc123",
            "device": "cpu",
            "model_digest": diarization._manifest_digest(manifest),
            "config_fingerprint": diarization._configuration_fingerprint(
                settings, "abc123", diarization._manifest_digest(manifest)
            ),
            "turns": [
                {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00"},
                {"start": 1.0, "end": 3.0, "speaker": "SPEAKER_01"},
            ],
            "exclusive_turns": [
                {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00"},
                {"start": 2.0, "end": 3.0, "speaker": "SPEAKER_01"},
            ],
            "capabilities": {"overlap_detection": True, "exclusive_timing": True},
        }), encoding="utf-8")
        return SimpleNamespace(duration_seconds=0.25)

    monkeypatch.setattr(diarization, "get_settings", lambda: settings)
    monkeypatch.setattr(diarization, "run_controlled", fake_run)
    monkeypatch.setattr(diarization, "_pyannote_package_ready", lambda: True)

    result = asyncio.run(diarization.diarize(tmp_path / "meeting.wav"))

    assert result["backend"] == "pyannote"
    assert result["duration_seconds"] == 0.25
    assert len(result["turns"]) == 2


def test_pyannote_requires_verified_local_model(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = SimpleNamespace(
        diarization_backend="pyannote",
        pyannote_model_path=tmp_path,
        pyannote_device="cpu",
        pyannote_min_speakers=1,
        pyannote_max_speakers=8,
        subprocess_timeout_seconds=60,
    )
    monkeypatch.setattr(diarization, "get_settings", lambda: settings)

    with pytest.raises(RuntimeError, match="model unavailable"):
        asyncio.run(diarization.diarize(tmp_path / "meeting.wav"))


def test_rejects_overlapping_exclusive_turns() -> None:
    with pytest.raises(RuntimeError, match="invalid timing"):
        diarization._validate_result({
            "turns": [],
            "exclusive_turns": [
                {"start": 0.0, "end": 2.0, "speaker": "A"},
                {"start": 1.0, "end": 3.0, "speaker": "B"},
            ],
        })
