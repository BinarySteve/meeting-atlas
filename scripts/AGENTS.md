# Repository script guidance

Applies to root `scripts/`. Processing-service scripts follow `processing-service/AGENTS.md` instead.

- Assume scripts may touch real local meetings, storage, queues, or owner credentials. Make destructive scope explicit and narrow.
- Never print passwords, hashes, session secrets, bearer tokens, transcript bodies, or recording paths containing private metadata.
- Prefer idempotent behavior, bounded retries, actionable errors, and nonzero exit codes on failure.
- Validate resolved paths before deleting or moving files. Keep generated fixtures and cleanup inside configured test storage.
- Owner creation must not create public registration paths or weaken password requirements.
- Retention must skip protected meetings and active jobs, delete referenced storage safely, and keep database/storage lifecycle coordinated.
- Integration and E2E scripts must use synthetic media, clean up artifacts, and avoid cloud or internet dependencies.
- Keep PowerShell compatible with supported Windows development and avoid cross-shell destructive command composition.

Run scripts from repository root so environment loading and relative paths are predictable. After changing a TypeScript script, run `npm run lint`, `npm run typecheck`, `npm test`, and the affected script only when its required local services are available.
