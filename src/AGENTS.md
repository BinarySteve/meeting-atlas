# TypeScript and Next.js guidance

Applies to everything under `src/`, including the web app, API routes, shared domain modules, and worker.

## Next.js application

- This repository uses Next.js 16 App Router and React 19. Read the relevant local guide in `node_modules/next/dist/docs/` before using framework APIs.
- Prefer Server Components. Add `"use client"` only for browser state, effects, event handlers, media controls, or WebAuthn.
- Keep request-time authentication and authorization on the server. UI disabled states are feedback, never the security boundary.
- API mutation routes must validate input, verify owner access, enforce active-job constraints, and return bounded errors without private content.
- Uploads must stream; do not buffer recordings in memory. Client filenames remain metadata, never storage paths.
- SSE processing updates must re-read PostgreSQL after Redis invalidation. Do not make Redis payloads authoritative or include private artifacts.
- Search and filter state belongs in the URL. Use Next client navigation instead of native full-document refreshes.

## UI and PWA

- Reuse tokens and component patterns in `src/app/globals.css` and `docs/design-system.md`. Keep changes mobile-first and verify constrained desktop widths.
- Preserve keyboard access, visible focus, semantic labels, live-region behavior, reduced-motion support, and minimum touch targets.
- Keep all fonts, icons, and assets local. Do not introduce remote CDNs or runtime dependencies.
- Service-worker changes must preserve the public-only cache boundary in root `AGENTS.md` and `src/lib/pwa.test.ts`.
- Meeting playback, transcript following, timestamps, and evidence links must remain synchronized.

## Domain and worker

- Validate external/process boundaries with Zod. Do not trust JSON from local model services merely because they are local.
- Keep pipeline stages checkpointed and idempotent. A retry resumes durable completed work and never reruns immutable audio stages for summary-only jobs.
- Preserve one-active-job-per-meeting enforcement at both application and database layers.
- Never mark a stage complete before its database rows and referenced storage artifacts are durable.
- Cancellation must reach active local subprocesses and authenticated remote processing requests.
- Be explicit when serializing Prisma `BigInt` values for client or API use.

## Tests and checks

- Co-locate focused tests as `*.test.ts` near domain modules. Add regression coverage for bug fixes and boundary changes.
- Run `npm run lint`, `npm run typecheck`, and `npm test` for TypeScript changes.
- Also run `npm run build` for routes, layouts, metadata, service-worker integration, Next configuration, or significant UI work.
- Use `npm run test:integration` and `npm run test:e2e` only with PostgreSQL, Redis, storage, FFmpeg, worker, and processing dependencies intentionally available.
