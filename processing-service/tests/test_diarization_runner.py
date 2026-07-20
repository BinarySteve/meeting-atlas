from types import SimpleNamespace

from meeting_processor.diarization_runner import _turns


class FakeAnnotation:
    def itertracks(self, *, yield_label: bool):
        assert yield_label is True
        return iter([
            (SimpleNamespace(start=2.0, end=3.0), "track-2", "SPEAKER_01"),
            (SimpleNamespace(start=0.0, end=1.0), "track-1", "SPEAKER_00"),
        ])


def test_annotation_turns_are_normalized_and_sorted() -> None:
    assert _turns(FakeAnnotation()) == [
        {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00"},
        {"start": 2.0, "end": 3.0, "speaker": "SPEAKER_01"},
    ]
