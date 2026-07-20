import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["PYANNOTE_METRICS_ENABLED"] = "0"

from .diarization import MODEL_MANIFEST  # noqa: E402


def _turns(annotation: Any) -> list[dict[str, object]]:
    turns = [
        {"start": float(segment.start), "end": float(segment.end), "speaker": str(speaker)}
        for segment, _, speaker in annotation.itertracks(yield_label=True)
    ]
    return sorted(turns, key=lambda turn: (turn["start"], turn["end"], turn["speaker"]))


def _fingerprint(
    revision: str, model_digest: str, device: str, minimum: int, maximum: int
) -> str:
    content = {
        "backend": "pyannote", "device": device, "max_speakers": maximum,
        "min_speakers": minimum, "model_digest": model_digest, "model_revision": revision,
    }
    encoded = json.dumps(content, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def run(audio: Path, model_path: Path, output_path: Path, device: str,
        min_speakers: int, max_speakers: int) -> None:
    import torch  # type: ignore[import-not-found]
    from pyannote.audio import Pipeline  # type: ignore[import-not-found]

    if device != "cpu":
        if not torch.cuda.is_available():
            raise RuntimeError(f"Requested Pyannote device unavailable: {device}")
        torch.empty(1, device=device)
    manifest = json.loads((model_path / MODEL_MANIFEST).read_text(encoding="utf-8"))
    revision = str(manifest["revision"])
    model_digest = hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    pipeline = Pipeline.from_pretrained(str(model_path))
    pipeline.to(torch.device(device))
    result = pipeline(str(audio), min_speakers=min_speakers, max_speakers=max_speakers)
    payload = {
        "backend": "pyannote",
        "model": "pyannote/speaker-diarization-community-1",
        "model_revision": revision,
        "model_digest": model_digest,
        "device": device,
        "speaker_bounds": {"min": min_speakers, "max": max_speakers},
        "config_fingerprint": _fingerprint(
            revision, model_digest, device, min_speakers, max_speakers
        ),
        "turns": _turns(result.speaker_diarization),
        "exclusive_turns": _turns(result.exclusive_speaker_diarization),
        "capabilities": {"overlap_detection": True, "exclusive_timing": True},
    }
    output_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--min-speakers", type=int, required=True)
    parser.add_argument("--max-speakers", type=int, required=True)
    args = parser.parse_args()
    run(args.audio, args.model, args.output, args.device, args.min_speakers, args.max_speakers)


if __name__ == "__main__":
    main()
