# Processing service guidance

Applies to the Python FastAPI service, model adapters, tests, setup scripts, and systemd units under `processing-service/`.

## Runtime contract

- Target Python 3.12 and keep `pyproject.toml` pins intentional. Runtime must remain usable without internet access.
- Every endpoint, including `/health`, requires the configured bearer credential. Processing endpoints also require bounded streamed input.
- Keep temporary files under the configured canonical temp root. Reject traversal, oversize bodies, malformed media, and unsafe filenames.
- Launch whisper and related tools with argument arrays, never shell interpolation. Preserve timeouts, bounded output, cancellation, and child-process cleanup.
- Do not add hosted inference, telemetry, Hugging Face authentication, runtime model downloads, or fallback network calls.
- Preserve `HF_HUB_OFFLINE`, `HF_HUB_DISABLE_TELEMETRY`, and `TRANSFORMERS_OFFLINE` behavior in deployed service units.

## Transcription and diarization

- Keep raw whisper and diarization output factual and auditable. Do not normalize uncertainty into invented speaker identity.
- WeSpeaker overlap limitations are known. Ambiguous or low-confidence assignments must remain unassigned.
- Changes to timing, clustering, alignment contracts, or response schemas require matching TypeScript consumer changes and regression tests.
- Hardware backends must be explicit (`vulkan`, `rocm`, or `cpu`); do not silently report GPU use without verified backend behavior.
- LM Studio responses remain untrusted input. Preserve strict structured validation and bounded fallback behavior.

## Verification

Activate the local environment first.

```bash
python -m ruff check src tests
python -m mypy src
python -m pytest
```

Run focused tests during iteration, then the full suite before handoff. For systemd or environment changes, also inspect `../docs/ENVIRONMENT.md` and `../docs/OPERATIONS.md` and update them when behavior changes.
