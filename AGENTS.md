# Meeting Atlas agent guide

This file applies to the whole repository. A nested `AGENTS.md` adds narrower rules for its directory. Read this file, the nearest nested file, and the relevant document under `docs/` before changing code.

## Product boundary

Meeting Atlas is a single-owner, LAN-only meeting transcription system. Privacy and recoverability outrank convenience.

- Never add cloud inference, hosted storage, telemetry, analytics, remote fonts, remote runtime assets, or automatic model downloads.
- Browser code talks only to authenticated Next.js endpoints. It must never address PostgreSQL, Redis, FastAPI, LM Studio, whisper.cpp, or WeSpeaker directly.
- Never log or cache recordings, transcripts, summaries, credentials, cookies, tokens, WebAuthn payloads, or full request bodies.
- PostgreSQL is authoritative. Redis/BullMQ carry queues and invalidations, not canonical meeting or processing state.
- Original recordings and raw transcription/diarization artifacts are immutable. Derived versions must remain auditable.
- Ambiguous diarization remains `Unassigned`; never invent speaker identity.
- Generated summaries and outcomes must reference valid transcript evidence IDs before persistence.
- PWA caches may contain only public offline UI, static application assets, manifest data, and icons. Authenticated pages, APIs, audio, and meeting data stay network-only.

Read [Architecture](docs/ARCHITECTURE.md) and [Security](docs/SECURITY.md) before changing trust boundaries, authentication, storage, queues, processing, networking, or offline behavior.

## Repository map

- `src/`: Next.js application, API routes, worker, and TypeScript domain code. See `src/AGENTS.md`.
- `processing-service/`: authenticated FastAPI service and local inference adapters. See `processing-service/AGENTS.md`.
- `prisma/`: schema and append-only migrations. See `prisma/AGENTS.md`.
- `scripts/`: owner setup, retention, integration, and E2E utilities. See `scripts/AGENTS.md`.
- `public/`: PWA service worker and local static assets.
- `docs/`: architecture, environment, operations, security, implementation, and design references.

## Working rules

- Preserve unrelated user changes in a dirty worktree. Do not reset, revert, stage, or reformat unrelated files.
- Prefer the smallest coherent change. Follow existing module boundaries before introducing new abstractions or dependencies.
- Keep secrets out of source, fixtures, snapshots, logs, and documentation. Use `.env.example` placeholders only.
- Treat database rows and storage objects as one lifecycle. Failure paths must not orphan sensitive files or claim completion before durable artifacts exist.
- Keep mutations authenticated, authorized, bounded, idempotent where retried, and auditable where they affect meeting data.
- Update documentation when changing architecture, environment variables, security controls, deployment, or operator workflows.
- Do not edit generated directories such as `.next/`, caches, Python `*.egg-info`, or `__pycache__`.

## Verification

Run checks proportional to the change and report exactly what ran.

- TypeScript or UI: `npm run lint`, `npm run typecheck`, `npm test`.
- Next.js routing, metadata, configuration, or production behavior: also `npm run build`.
- Prisma: `npm run prisma:validate`; regenerate client when schema changes.
- Python processing service: run Ruff, mypy, and pytest using its local environment.
- Compose or deployment: `docker compose config --quiet` plus the relevant health check when services are available.
- Documentation only: validate local Markdown links; full application build is unnecessary.
- Integration/E2E tests mutate local services and storage. Run them only when dependencies are available and the change warrants them.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
