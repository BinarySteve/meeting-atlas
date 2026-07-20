# Architecture

## Security boundary

Browser talks only to LAN-bound Next.js. Signed HTTP-only, SameSite=Strict owner session protects UI and APIs. No public registration exists. PostgreSQL and Redis stay on private Compose network. FastAPI requires 32+ byte shared bearer credential. LM Studio remains processing-service-only dependency. No hosted inference or telemetry.

## Windows application

Next.js streams raw request bodies directly into generated filesystem keys. Client filename is metadata only. PostgreSQL owns meeting state and stable references. Redis AOF + BullMQ preserve queued work. Separate Node worker performs checkpointed stages independently of browser sessions.

FFprobe/FFmpeg use argument arrays with no shell interpolation, bounded logs, timeouts, and abort signals. Upload extensions/MIME are never trusted. Original stays immutable; working copy is mono 16 kHz PCM WAV.

## Kubuntu processing service

Authenticated FastAPI controls Vulkan/ROCm/CPU-configurable whisper.cpp, local Pyannote Community-1 diarization, and LM Studio. WeSpeaker remains a configuration-selected rollback backend. Current benchmark selected Vulkan whisper.cpp; Pyannote defaults to CPU until its ROCm path passes an explicit device smoke test. Whisper decodes the complete normalized WAV without timeline-compacting VAD and returns an explicit normalized-audio timeline contract. The worker rejects malformed, non-monotonic, or duration-incompatible timestamps. Remote request IDs allow active cancellation. Whisper and Pyannote execute in controlled child processes so cancellation kills active inference. Service runs under user systemd with restart policy and offline model/telemetry flags.

Pyannote processes the complete normalized recording from a verified local Community-1 directory. Regular turns preserve simultaneous speakers; exclusive turns provide one-speaker timing for Whisper alignment. Alignment first detects words intersecting regular-turn overlap and keeps them `Unassigned`, then scores exclusive timing for remaining words, applies conservative nearest-turn fallback and short-flicker smoothing, and groups words at confident handoffs, overlap boundaries, source boundaries, pauses, duration limits, and punctuation. A phrase receives a speaker only when confidence-weighted evidence is decisive.

## Durable pipeline

Stages: upload validation → inspection → normalization → transcription → diarization → alignment → assembly → hierarchical summarization → structured extraction → completion.

Every attempt stores state, timestamps, error, result, attempt number, heartbeat, and unique idempotency key. Completed-stage guard resumes first incomplete stage. BullMQ retries exponentially and recovers stalled jobs. Cancellation polling reaches active local subprocesses and authenticated remote requests. Summary regeneration creates a `SUMMARY_REGENERATION` job targeting one transcript version, so audio stages never rerun. Transcript reprocessing creates a `TRANSCRIPT_REPROCESS` job, reuses a duration-valid normalized WAV and immutable diarization artifact only when normalized storage identity, backend, model revision, speaker bounds, and configuration fingerprint match, writes new raw/output artifacts, then atomically activates the new machine transcript and completed summary.

PostgreSQL is the authoritative processing-status store, including durable within-stage progress. A partial unique index permits only one active job per meeting, while stable BullMQ job IDs deduplicate same-run enqueue attempts. Workers publish lightweight Redis invalidations; authenticated server-sent events re-read PostgreSQL and push snapshots to every meeting tab. The UI disables conflicting actions immediately, shows queued/running/retrying/completed/failed states, and refreshes meeting artifacts once when a run becomes terminal.

### Processing state ownership

- `ProcessingJob` owns the run type, target transcript version, lifecycle state, attempt count, heartbeat, terminal error, and timestamps.
- `ProcessingStageAttempt` owns stage state, attempt number, idempotency key, result/error data, and optional current/total/message progress.
- PostgreSQL's partial unique index covers `QUEUED`, `ACTIVE`, `RETRYING`, and `CANCEL_REQUESTED`, closing the query-then-insert race for all job-creation paths.
- BullMQ job IDs combine the durable job ID and run revision. Repeated enqueue calls for the same run collapse, while an explicit retry receives a new revision.

### Live status path

`GET /api/meetings/:id/processing` authenticates the owner, emits an initial PostgreSQL snapshot, then subscribes to the meeting's Redis notification channel. Notifications contain no transcript or summary content; they only prompt another database read. The stream also reconciles with PostgreSQL periodically, so dropped Pub/Sub messages or a reconnect cannot make Redis the source of truth.

The client installs the stream once for the meeting workspace, independent of the selected tab. Local submission state gates the control before the network round trip. Server-side active-job checks and the database constraint remain the final concurrency boundary. The client refreshes server-rendered artifacts only on an active-to-terminal transition, avoiding repeated full transcript payloads while a stage runs.

## Versioning and evidence

Raw transcription and diarization remain immutable artifacts. Editing and reprocessing each create a new transcript version with a parent pointer. Text correction, speaker reassignment, split, merge, summary exclusion, and reprocessing never overwrite earlier machine or manual output. A manually active transcript cannot be reprocessed; the owner must explicitly activate a machine version first. Meeting-row locks serialize job creation, transcript edits, summary restore, and transcript activation so a late pipeline completion cannot silently displace concurrent manual work. Speaker rename updates relational display name and alias history without touching raw diarization.

`Meeting.activeTranscriptVersionId` is the authoritative presentation/export pointer. Each summary targets one transcript version. Section summaries retain transcript IDs/timestamps. Final decisions, action items, open questions, and claims must pass Zod validation and reference known segment IDs. Summary restore activates both its summary and transcript; explicit transcript activation selects its newest completed summary when available. Older versions, summaries, and items remain stored.

## Search, exports, retention, backups

PostgreSQL full-text indexes cover meeting titles, speaker names, transcript text, action items, and summary JSON. Exports are generated through authenticated Next.js, saved under opaque storage keys, audited, then returned. Retention deletes all referenced recording, normalized, raw artifact, and export objects before deleting DB meeting; active jobs block deletion.

Authenticated Settings backup controls create a custom PostgreSQL dump first, then copy opaque storage under a shared PostgreSQL advisory lifecycle lock that blocks meeting deletion across processes. Each local `.tar.gz` contains both data layers plus per-file SHA-256 manifest. Verification checks hashes and PostgreSQL dump readability. Download and deletion remain owner-only and audited; restore is deliberately operator-only and offline from browser routes.

## Failure recovery

- Queue outage after upload leaves meeting/file referenced and job retryable.
- Stage transaction never says completed before DB artifacts exist.
- Partial normalization is removed on failure/cancel.
- Retry resumes completed checkpoints.
- Stale BullMQ locks retry automatically.
- Missed Redis Pub/Sub invalidations are repaired by the event stream's PostgreSQL reconciliation.
- Event-stream disconnects show reconnecting state; they do not interrupt the worker or alter durable progress.
- Concurrent job creation is rejected by the PostgreSQL active-job constraint; the API returns the existing processing snapshot.
- DB + storage must be backed up/restored together.
