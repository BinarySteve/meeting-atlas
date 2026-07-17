# Prisma and migration guidance

Applies to `schema.prisma` and all migration files.

- Treat committed migrations as append-only deployment history. Never rewrite or delete a migration that may have run outside the current workspace.
- Create a new timestamped, descriptive migration for every schema change. Review generated SQL before applying it.
- Never use `prisma db push` as a replacement for a migration in shared or production environments.
- Never reset or drop a database unless the user explicitly requests it and confirms data loss.
- Preserve PostgreSQL as processing-state authority and retain the database-enforced one-active-job-per-meeting constraint.
- Prisma schema cannot express every PostgreSQL feature. Preserve required raw SQL indexes, partial constraints, and migration guards.
- Choose cascade behavior deliberately. Meeting deletion must remove relational artifacts while storage cleanup remains coordinated by application logic.
- Schema changes must ship with corresponding TypeScript updates, tests, migration notes when operationally relevant, and regenerated Prisma client output.

Verify with:

```powershell
npm run prisma:validate
npm run prisma:generate
```

Use `npm run db:migrate -- --name <descriptive-name>` only against an intentional development database. Use `npm run db:deploy` for existing migrations in deployment workflows.
