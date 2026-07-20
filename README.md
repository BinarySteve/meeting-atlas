# Meeting Atlas

LAN-only, local-first meeting transcription for Windows + Kubuntu. Browser talks only to authenticated Next.js. Recordings, transcripts, diarization, summaries, evidence, embeddings, analytics, and metadata never go to cloud AI or telemetry services.

## Current status

| Capability | Status |
|---|---|
| Owner-only auth; no registration | Implemented |
| Discoverable passkeys + password recovery | Implemented |
| Installable privacy-safe PWA | Implemented |
| Streaming uploads through 2 GiB default limit | Implemented |
| FFprobe content validation; FFmpeg 16 kHz mono working copy | Implemented |
| Durable BullMQ checkpoint pipeline, retries, stale recovery, cancellation | Implemented |
| Live processing status, stage/unit progress, cross-tab updates, duplicate-run guard | Implemented |
| Authenticated Kubuntu FastAPI service | Deployed as user systemd service |
| whisper.cpp large-v3-turbo, Vulkan | Deployed and benchmarked; large-v3 configurable |
| Local Pyannote Community-1 diarization | Implemented; deployment benchmark required before promotion |
| Timestamp alignment and neutral speakers | Implemented |
| Audio-synchronized transcript playback | Implemented |
| Auditable transcript edits and speaker rename | Implemented |
| Auditable transcript/speaker reprocessing and version activation | Implemented |
| Hierarchical LM Studio summaries and structured evidence | Implemented |
| Summary regeneration/history/restore | Implemented |
| Action items, decisions, open questions | Implemented |
| PostgreSQL full-text search and filters | Implemented |
| TXT, Markdown, JSON, SRT, VTT exports | Implemented |
| Audit history and retention controls | Implemented |
| Qdrant, voice profiles, external integrations | Intentionally excluded |

Pyannote preserves overlap-aware regular turns and supplies exclusive turns for transcript alignment. Words intersecting simultaneous speakers stay `Unassigned` and display a review warning; the system never invents which speaker produced mixed mono audio. WeSpeaker remains an explicit rollback backend.

The meeting workspace uses the normalized pipeline WAV for playback, so Whisper, Pyannote, evidence links, seeking, and transcript following share one absolute millisecond timeline. Whisper VAD is deliberately disabled because its silence-compacted timestamps cannot synchronize with the recording. Word-level diarization evidence is smoothed and then grouped into natural phrases; ambiguous and overlapping words remain `Unassigned`.

A live status card remains visible in every workspace view and reports queued, running, retrying, cancellation, completion, and failure states. Long runs also report durable stage progress. Transcript reprocessing creates a new machine version and matching summary without overwriting prior raw artifacts or versions. Manual transcript versions are protected from accidental reprocessing.

## Application flow

The mobile-first library puts search, active processing, and recent meetings first. Advanced filters open separately and remain encoded in the URL. New recordings use `/meetings/new`, with filename/title defaults, recording date, drag-and-drop or native picker, byte progress, cancellation, guarded submission, and a clear processing transition.

Meeting pages expose direct-linkable `?view=overview`, `?view=transcript`, and `?view=outcomes` views. The processing card is shared across all three views. Overview contains detailed stage history, transcript-version activation, speaker-aware transcript reprocessing, summary history, exports, and retention. Transcript contains playback, search, following, timestamp seeking, versioned source edits, and a summary-regeneration button. Processing mutations gate immediately while any meeting job is active. Outcomes contains action items, decisions, questions, and seekable evidence.

Processing status is pushed through an authenticated server-sent event stream. Redis carries lightweight change notifications; each notification causes the server to read the authoritative PostgreSQL snapshot before sending it to the browser. A periodic database reconciliation keeps the UI correct if a Redis notification is missed. When a job reaches a terminal state, the page refreshes its summary and outcome artifacts once without repeatedly reloading the full transcript during processing.

The installable Meeting Atlas PWA precaches only its public offline experience, required static UI assets, manifest, and purpose-built icons. Authenticated HTML, APIs, recordings, audio ranges, transcripts, summaries, outcomes, and auth traffic remain network-only. Offline mode reports server availability, helps reconnect, and never shows stale private records.

LM Studio structured-output support varies by loaded model/runtime. The processor first requests strict JSON Schema output; on a schema-format HTTP 400 it retries once in text mode with the exact schema embedded in the local prompt. The web worker still parses with a strict Zod schema and validates every evidence segment ID before saving anything.

## Data flow

Browser → Next.js streaming upload → immutable filesystem object → PostgreSQL meeting/job transaction → Redis/BullMQ worker → FFprobe → FFmpeg normalized copy → authenticated FastAPI → local whisper.cpp + Pyannote + LM Studio → versioned PostgreSQL artifacts.

Worker state change → durable PostgreSQL job/stage snapshot → Redis invalidation → authenticated Next.js SSE snapshot → live meeting UI. PostgreSQL remains authoritative; Redis accelerates delivery but is not required to reconstruct status.

Closing or refreshing browser does not affect processing. Completed stages and within-stage counters persist. Summary-only retries never rerun normalization, transcription, or diarization. Transcript reprocessing reuses a valid normalized WAV and eligible diarization artifact, creates new transcription/alignment/version artifacts, and switches active transcript and summary pointers only after completion. PostgreSQL permits only one active job per meeting, and stable BullMQ IDs deduplicate concurrent enqueue attempts.

## Privacy guarantees

- No cloud transcription, diarization, LLM, storage, analytics, fonts, icons, assets, or error monitoring.
- Hugging Face account/token is used only at the interactive operator-run Community-1 download prompt. It is never stored in application configuration or available to runtime services.
- Model libraries and Pyannote metrics are forced offline during normal processing.
- Browser never reaches LM Studio, FastAPI, whisper.cpp, Pyannote, Redis, or PostgreSQL.
- Structured logs contain IDs, stages, duration, backend, and bounded errors—never full transcripts, audio, secrets, tokens, or request bodies.
- Original file preserved byte-for-byte. Stable relative storage keys prevent Windows-path coupling.

## Native Windows development

Requirements: Node 24, Docker Desktop, FFmpeg/FFprobe.

```powershell
Set-Location C:\Code\meeting-transcriber
Copy-Item .env.example .env
$env:POSTGRES_PASSWORD='choose-a-secret'
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
npm install
npx prisma generate
npx prisma migrate deploy
$env:OWNER_EMAIL='owner@home.arpa'
$env:OWNER_NAME='Your Name'
$env:OWNER_PASSWORD='use-a-long-unique-password'
npm run owner:create
npm run dev
```

Separate terminal:

```powershell
Set-Location C:\Code\meeting-transcriber
npm run worker
```

Simulation requires all three conditions: non-production environment, `PROCESSING_MODE=simulation`, and `ALLOW_SIMULATION=true`. Real processing uses `PROCESSING_MODE=remote` and `ALLOW_SIMULATION=false`.

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run prisma:validate
npm run build
docker compose config --quiet
Invoke-RestMethod http://127.0.0.1:6982/api/health
```

`test:e2e` generates a legally safe synthetic recording with a known eight-second silence interval, exercises the live private-AI pipeline, verifies absolute timestamp preservation, authenticated processing events, transcript reprocessing/version activation, manual-edit protection, durable progress, duplicate-run races, and UI/export endpoints, then removes its meeting and files.

## Production Windows deployment

Copy repository to `C:\docker\meeting-transcriber`, set production `.env`, and replace example LAN bind IP when needed:

```powershell
docker compose build
docker compose run --rm web npm run db:deploy
docker compose up -d
```

Next.js and Compose use TCP `6982` both inside and outside the container (`6982:6982`). Before production startup, give the app one stable HTTPS hostname. In Nginx Proxy Manager, forward that hostname to the Docker host on port `6982`, enable WebSocket support, raise the upload limit to match `MAX_UPLOAD_BYTES`, and disable proxy buffering for `/api/meetings/*/processing`. Set `WEBAUTHN_RP_ID` to that hostname without a scheme and `WEBAUTHN_ORIGIN` to its exact HTTPS origin. Example: `WEBAUTHN_RP_ID=meetings.home.arpa` and `WEBAUTHN_ORIGIN=https://meetings.home.arpa`. Never derive these values from request headers. Startup rejects mismatched RP/origin values and non-HTTPS production origins outside localhost.

After deployment, sign in with password, open Account → Security, register at least two named passkeys, sign out, verify discoverable passkey login, then confirm password recovery.

Account security includes an editable display name and login email, current-password reauthentication for sensitive changes, Argon2id password hashing, active-session review and revocation, and a local security-event history. Sessions expire after 2 hours idle or 12 hours total. Changing or administratively resetting the password revokes every session and requires a fresh sign-in.

There is intentionally no public forgot-password endpoint. If the recovery password is lost, use the host-only reset command documented in [Operations](docs/OPERATIONS.md); it accepts the new password through the process environment and invalidates every existing session.

## Manual verification checklist

- At 320, 360, 390, 430, 768, 1024, and 1440 px: verify no overflow and all navigation, filters, upload, tabs, player, transcript edits, and outcome forms remain reachable.
- Upload valid and invalid media; confirm one meeting per submission, byte progress, cancellation/error recovery, processing handoff, and preserved metadata.
- Start summary regeneration; confirm the button disables immediately, progress updates without a page reload, a second tab follows the same run, and the new summary/outcomes appear once processing completes.
- Attempt concurrent regeneration requests; confirm only one job starts and the other request receives an active-processing conflict with the current job snapshot.
- Reprocess a machine transcript; confirm the action gates immediately, stage progress streams live, the original version remains unchanged, and the completed new version becomes active. Confirm a manual active version blocks reprocessing until a machine version is explicitly activated.
- Seek across a long silence with Follow transcript enabled; confirm the highlighted segment changes only at its true audio interval and no transcript row is highlighted during the gap.
- Exercise every search/date/state/speaker filter, meeting browser history, transcript search/seek/follow/edit, and evidence seeking.
- Register, use, name, and revoke passkeys; verify final-passkey warning, password fallback, sign-out, and other-session revocation after security changes.
- Install through browser UI; launch standalone; disconnect server; verify only the honest offline screen appears and Cache Storage contains no private response.
- Run all Verification commands, then test portrait/landscape, keyboard navigation, screen-reader status output, and reduced motion.

Do not publish PostgreSQL or Redis. Restrict TCP 6982 and the HTTPS hostname to trusted LAN/VLAN clients. Do not expose through Cloudflare/WAN by default.

## Pyannote Community-1 model setup

```bash
cd ~/meeting-transcriber-processing
source .venv/bin/activate
pip install -e '.[diarization]'
PYANNOTE_MODEL_PATH="$HOME/models/pyannote-speaker-diarization-community-1" \
  bash scripts/setup-pyannote-offline.sh
```

Git prompts for Hugging Face username and token with credential storage disabled. Setup records the exact repository revision and SHA-256 of every local model file, then removes Git metadata. Do not add the token to `.env`. Community-1 license: CC BY 4.0. Model files are not committed. For rollback dependencies, install `pip install -e '.[wespeaker]'`, set `DIARIZATION_BACKEND=wespeaker`, and retain the legacy WeSpeaker variables.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Environment reference](docs/ENVIRONMENT.md)
- [Operations](docs/OPERATIONS.md)
- [Security](docs/SECURITY.md)
