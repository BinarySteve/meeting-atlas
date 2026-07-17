# Operations

## Owner password recovery

Password recovery is deliberately host-only: no email service, public reset token, or security questions exist. From the application host, supply a new 15–128 character password through the process environment:

```powershell
$env:OWNER_PASSWORD='a-new-long-unique-password'
npm run owner:reset-password
Remove-Item Env:OWNER_PASSWORD
```

The command refuses databases that do not contain exactly one owner, writes a security audit event, and revokes every active session. Sign in again on each device afterward.

## Kubuntu service

```bash
systemctl --user status meeting-processor
systemctl --user restart meeting-processor
journalctl --user -u meeting-processor -n 100 --no-pager
```

Service is enabled under `~/.config/systemd/user`. Optional one-time admin command for boot-before-login:

```bash
sudo loginctl enable-linger kubuntiai
```

## Whisper backend benchmark

Build both backends, stop other GPU work, benchmark same normalized fixture/model several times, and compare wall time plus transcript output:

```bash
bash scripts/build-whisper-backends.sh
bash scripts/benchmark-whisper.sh /path/to/fixture.wav
```

Set `WHISPER_BACKEND`, `WHISPER_EXECUTABLE`, restart service, then verify `/health`. Current machine selected Vulkan because ROCm build did not engage GPU during benchmark.

## Health

```powershell
Invoke-RestMethod http://127.0.0.1:6982/api/health
```

Expected components: database, Redis, worker heartbeat, FFmpeg, FFprobe, LM Studio, processing service. FastAPI `/health` requires bearer credential and reports Whisper executable/model/VAD, diarization model/backend/device.

## Pipeline status operations

PostgreSQL is the processing-status authority. Redis Pub/Sub only wakes authenticated event streams so they can fetch a fresh snapshot. A Redis reconnect can delay an update, but periodic PostgreSQL reconciliation and browser reconnection restore the current state without changing the running job.

Deploy the live-status schema before starting updated web and worker containers:

```powershell
docker compose build
docker compose run --rm web npm run db:deploy
docker compose up -d
```

The migration adds durable stage progress columns and a partial unique index allowing one active job per meeting. Deployment will fail instead of silently choosing a winner if legacy data contains duplicate active jobs; investigate and resolve those rows before retrying the migration.

Normal live-status checks:

- The meeting card should move through queued/running/retrying/terminal states without manual refresh.
- Browser developer tools should show one authenticated `text/event-stream` request per open meeting workspace.
- A second regeneration attempt should be disabled client-side; a raced request should receive HTTP `409` with the existing processing snapshot.
- Worker logs, job heartbeat, and stage progress should advance together during long summary runs.

## Backup

Settings > Backups creates a timestamped `.tar.gz` containing a custom-format PostgreSQL dump, full storage tree, and SHA-256 manifest. Creation and meeting deletion share a PostgreSQL advisory lifecycle lock. Database snapshot occurs before storage copy, so every storage object referenced by the snapshot is included; objects created later are harmless extras. Redis is not included because it is not meeting authority.

Set `BACKUP_HOST_ROOT=C:/MeetingAtlasBackups` before starting Compose. Settings can create, verify, download, and delete archives. Verification checks every manifest hash and asks `pg_restore` to parse the database dump.

Copy verified archives to encrypted storage on another physical device. A second folder on the same `C:` disk does not protect against disk failure. Test restore periodically.

## Restore

```powershell
docker compose stop web worker
New-Item -ItemType Directory -Force C:\MeetingAtlasRestore
tar -xzf C:\MeetingAtlasBackups\meeting-atlas-manual-TIMESTAMP.tar.gz -C C:\MeetingAtlasRestore
docker compose exec -T postgres dropdb -U meeting --if-exists meeting_transcriber
docker compose exec -T postgres createdb -U meeting meeting_transcriber
Get-Content -AsByteStream C:\MeetingAtlasRestore\database.dump | docker compose exec -T postgres pg_restore -U meeting -d meeting_transcriber --clean --if-exists
Copy-Item -Recurse -Force C:\MeetingAtlasRestore\storage\* C:\Code\meeting-transcriber\data\
docker compose up -d
```

Restore remains manual by design; browser routes never replace live PostgreSQL or storage. Verify health, several recordings, transcript seek, and export after restore.

## Retention

UI supports per-meeting delete date/protection/manual deletion. Schedule default retention if desired:

```powershell
npm run retention:run
```

`RETENTION_DAYS=0` disables default age deletion. Active meetings are never deleted.

## Troubleshooting

- Queue unavailable after upload: original remains stored and DB job remains retryable.
- Stuck processing: inspect active stage, heartbeat, BullMQ worker log, then cancel/retry failed stage.
- Status says reconnecting: verify the owner session, reverse-proxy SSE buffering/timeouts, app-to-Redis connectivity, and the `/api/meetings/{id}/processing` response. Processing itself continues independently.
- UI status is delayed but worker is healthy: query PostgreSQL first. Redis carries invalidations only; restarting Redis must not erase job/stage truth.
- Regeneration returns `409`: another meeting job is active. Use the returned snapshot, wait for its terminal state, or cancel it before retrying.
- Job remains queued after enqueue failure: inspect Redis/BullMQ availability. Updated retry routes restore a failed durable state rather than leaving a false queued state.
- FFprobe error: file is malformed/unsupported or contains no audio stream.
- Processing `401`: credentials differ between Windows and Kubuntu.
- Diarization degraded: confirm `avg_model.pt`, `config.yaml`, and FastAPI health.
- LM Studio failure after transcript: retry resumes summary stage; audio work stays complete.
