from pathlib import Path
from types import SimpleNamespace

import pytest

from meeting_processor import diarization


class FakeModel:
    def diarize(self, _audio_path: str, _utterance: str):
        return [
            ("meeting", 2.0, 3.0, 1),
            ("meeting", 0.0, 1.5, 0),
        ]


def test_diarization_normalizes_and_sorts_turns(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(diarization, "_model", lambda: FakeModel())

    result = diarization.diarize(Path("audio.wav"))

    assert result["backend"] == "wespeaker"
    assert result["exclusive_turns"] == []
    assert result["turns"] == [
        {"start": 0.0, "end": 1.5, "speaker": "WESPEAKER_0"},
        {"start": 2.0, "end": 3.0, "speaker": "WESPEAKER_1"},
    ]


def test_diarization_rejects_bad_timing(monkeypatch: pytest.MonkeyPatch) -> None:
    bad_model = SimpleNamespace(diarize=lambda *_args: [("meeting", 3.0, 2.0, 0)])
    monkeypatch.setattr(diarization, "_model", lambda: bad_model)

    with pytest.raises(RuntimeError, match="invalid diarization timing"):
        diarization.diarize(Path("audio.wav"))
