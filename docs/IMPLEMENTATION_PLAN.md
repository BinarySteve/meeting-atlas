# Implementation plan

## Milestone status

- Milestone 1: complete. Repository, schema/migrations, owner auth, storage, streaming upload, Redis/BullMQ, checkpoint worker, FFprobe/FFmpeg, health, simulation, UI, cancellation, DB/queue integration test.
- Milestone 2: complete. Authenticated FastAPI, whisper.cpp Vulkan/ROCm builds and benchmark, model configuration, timestamps, raw artifacts, stage retry, synchronized playback, user systemd deployment.
- Milestone 3: complete. Local Pyannote Community-1 backend with overlap-aware regular turns, exclusive alignment turns, neutral speakers, rename/reassign, split/merge, and visible uncertain/overlapping assignment. WeSpeaker remains rollback-only.
- Milestone 4: complete. Hierarchical LM Studio JSON summaries, validation, evidence, action items, decisions, questions, transcript versions, summary regeneration/history/restore.
- Milestone 5: complete. PostgreSQL full-text search/filtering, five exports, audit UI, retention, active cancellation, structured logging, security/operations/backup documentation, unit and integration tests.
- Milestone 6: complete. Authoritative processing snapshots, durable within-stage counters, Redis invalidation Pub/Sub, authenticated SSE delivery, cross-tab status UI, immediate action gating, PostgreSQL active-job uniqueness, stable BullMQ enqueue IDs, and regeneration-race E2E coverage.
- Milestone 7: complete. Absolute normalized-audio timestamp contract, VAD-safe transcription, interval-accurate follow mode, word-level conservative speaker alignment, auditable transcript reprocessing, active transcript pointers, manual-version protection, and silence-gap/reprocessing E2E coverage.

## Decisions

- Raw-body upload avoids multipart buffering/proxy limits.
- 2 GiB configurable default; detected media decides acceptance.
- Stable relative storage keys; no platform paths in DB.
- No Qdrant initial foundation.
- Community-1 access uses an operator-supplied Hugging Face token only during interactive setup. Runtime has no token, loads a revisioned local model, disables metrics, and forces model libraries offline.
- User systemd selected because system-wide installation requires sudo. `loginctl enable-linger` remains optional admin step for boot-before-login.
- Playback review uses compact sentence-oriented display groups without rewriting source transcript segments; precise source editing and evidence IDs remain available.
- Playback, Whisper, diarization, evidence, and follow mode share the normalized WAV's absolute millisecond timeline. whisper.cpp VAD is disabled because silence compaction changes that coordinate system.
- Speaker deduction is word-level and conservative: confident handoffs split phrases, brief isolated label flicker is smoothed, and ambiguity remains `Unassigned`. No voice identity/profile inference is performed.
- Reprocessing creates a child machine transcript plus summary, retains immutable old versions/artifacts, and switches active pointers atomically. Manual active versions require explicit machine-version activation before reprocessing.
- PostgreSQL owns all processing state. Redis carries queue data and ephemeral change notifications but never replaces the durable snapshot.
- Meeting workspaces use one event stream across all tabs and refresh large server-rendered artifacts only when processing becomes terminal.
- Duplicate prevention is layered: immediate client gating improves feedback, API checks return the current snapshot, a partial database unique index closes races, and stable BullMQ IDs deduplicate delivery.

## Known limitations / future work

- Mono Whisper cannot recover both word streams during simultaneous speech. Pyannote detects overlap; affected words remain `Unassigned` and visibly require review.
- User systemd starts with user session unless linger enabled.
- The E2E harness exercises the authenticated HTTP UI/export surface, processing SSE, duplicate job races, a known silence gap, transcript reprocessing/version activation, manual-edit protection, durable summary progress, and the complete live local-AI pipeline. Pixel-level browser automation is separate from this harness.
- Future extensions remain voice profiles, browser recording, calendar/import integrations, mobile apps, Qdrant semantic search, email delivery.
