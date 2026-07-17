# Environment variables

## Windows application

- `DATABASE_URL`: PostgreSQL connection string.
- `POSTGRES_PASSWORD`: Compose PostgreSQL password; use URL-safe characters because Compose builds container `DATABASE_URL` from it.
- `APP_BIND_IP`: host interface for Compose TCP 6982; default loopback. Use a trusted LAN address when Nginx Proxy Manager runs on another host; do not expose it to WAN.
- `REDIS_URL`: Redis connection string used by BullMQ and lightweight processing-status Pub/Sub invalidations. PostgreSQL remains status authority.
- `STORAGE_ROOT`: mounted/local root for recordings and generated artifacts.
- `MAX_UPLOAD_BYTES`: upload ceiling; default `2147483648` (2 GiB).
- `SESSION_SECRET`: 32+ byte session signing secret.
- `WEBAUTHN_RP_ID`: stable passkey relying-party hostname without scheme or port (`localhost` only for development).
- `WEBAUTHN_ORIGIN`: exact browser-facing trusted app origin. Use `http://localhost:6982` for direct local access; use the stable HTTPS URL when deployed behind Nginx Proxy Manager. Do not use the upstream `:6982` address when browsers use the HTTPS URL.
- `WEBAUTHN_RP_NAME`: name shown by authenticators; default `Meeting Atlas`.
- `OWNER_EMAIL`: input for owner creation script.
- `OWNER_NAME`: optional display name for owner creation.
- `OWNER_PASSWORD` / `OWNER_PASSWORD_HASH`: owner setup inputs; never commit.
- `PROCESSING_MODE`: `remote` or explicit development `simulation`.
- `ALLOW_SIMULATION`: must be `true` plus non-production for simulation.
- `PROCESSING_API_URL`: private FastAPI base URL.
- `PROCESSING_API_CREDENTIAL`: shared 32+ byte service secret.
- `LM_STUDIO_URL`: local LM Studio OpenAI-compatible `/v1` URL used by health checks.
- `LM_STUDIO_MODEL`: local model identifier.
- `FFPROBE_PATH`, `FFMPEG_PATH`: executable names/absolute paths.
- `SUBPROCESS_TIMEOUT_MS`: upper bound for long local/remote work.
- `HEALTH_TIMEOUT_MS`: dependency health deadline.
- `RETENTION_DAYS`: `0` disables default age deletion; explicit meeting date still applies.
- `LOG_LEVEL`: Pino level (`info` default).
- `NEXT_TELEMETRY_DISABLED`: keep `1`.

Live processing feedback requires no additional environment variables. The authenticated SSE endpoint uses the existing application origin/session, `DATABASE_URL`, and `REDIS_URL`. Reverse proxies must allow long-lived `text/event-stream` responses and should disable response buffering for `/api/meetings/*/processing`.

Next.js and Compose both use TCP `6982`; Compose publishes host TCP `6982` to container TCP `6982`. Nginx Proxy Manager should forward to the Docker host's trusted LAN address on port `6982`, pass WebSocket/upgrade headers, allow the configured `MAX_UPLOAD_BYTES`, and disable proxy buffering for processing event streams. Set `WEBAUTHN_RP_ID` to the public hostname only and `WEBAUTHN_ORIGIN` to its exact `https://` origin.

## Kubuntu processing service

- `SERVICE_TOKEN`: same shared credential as Windows.
- `SERVICE_HOST`, `SERVICE_PORT`: bind address/port.
- `SERVICE_MAX_UPLOAD_BYTES`: request stream limit.
- `SERVICE_TEMP_DIR`: temporary request storage.
- `SUBPROCESS_TIMEOUT_SECONDS`: whisper.cpp deadline.
- `WHISPER_BACKEND`: `vulkan`, `rocm`, or `cpu` metadata/selection.
- `WHISPER_EXECUTABLE`: selected whisper.cpp CLI.
- `WHISPER_MODEL_PATH`: explicit local GGML model file.
- `WHISPER_MODEL_NAME`: `large-v3-turbo` or `large-v3`.
- `WHISPER_LANGUAGE`, `WHISPER_THREADS`: decoding controls.
- `WHISPER_VAD_ENABLED`, `WHISPER_VAD_MODEL_PATH`: local VAD controls.
- `WESPEAKER_MODEL_PATH`: directory containing `avg_model.pt` + `config.yaml`.
- `WESPEAKER_DEVICE`: `cpu` or ROCm PyTorch `cuda[:index]`.
- `WESPEAKER_MIN_DURATION`, `WESPEAKER_WINDOW_SECONDS`, `WESPEAKER_PERIOD_SECONDS`, `WESPEAKER_BATCH_SIZE`: diarization tuning.
- `LM_STUDIO_URL`, `LM_STUDIO_MODEL`, `LM_STUDIO_TIMEOUT_SECONDS`: local structured-generation endpoint/config.
- `HF_HUB_OFFLINE`, `HF_HUB_DISABLE_TELEMETRY`, `TRANSFORMERS_OFFLINE`: forced by systemd/runtime.
