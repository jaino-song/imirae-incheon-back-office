# Prisma migrations & the database patches workflow

Two complementary paths keep the databases in sync. Knowing which one touched a
migration file explains the checksum warnings local `migrate dev` can raise.

## The two paths

| Path | Command | Tracking | Used for |
| --- | --- | --- | --- |
| Migrate | `pnpm db:migrate` (dev) / `pnpm db:migrate:deploy` (deploy) | `_prisma_migrations` (records checksums) | Fresh databases, locally tracked schema changes |
| Database patches workflow | `.github/workflows/database-patches.yml` → `prisma db execute --file prisma/migrations/<name>/migration.sql` | **None** — idempotent SQL, re-runnable on every push | Repairing/upgrading long-lived dev·preview·production databases that predate the migrate history |

Because the patches workflow re-executes files with no tracking table, the
migration files it targets are kept idempotent (`IF NOT EXISTS`, `IF NULL`
guards, fail-closed verify blocks) and are sometimes **rewritten in place**
after they have already been applied.

## Checksum drift after an in-place rewrite

`_prisma_migrations` stores the checksum of each migration as first applied.
When a patches-targeted file is later rewritten in place, the migrate path sees
a checksum that no longer matches and `prisma migrate dev` fails with:

```
migration ... was modified after it was applied
```

This is expected, not corruption. The rewritten SQL has already run through the
patches workflow; only the recorded checksum is stale.

### Resolve on an existing local database

Mark the migration as applied without re-running its SQL:

```bash
pnpm exec prisma migrate resolve --applied <migration_name>
# e.g.
pnpm exec prisma migrate resolve --applied 20260819000000_track_eformsign_auto_registered_client
```

Repeat for every migration named in the warning, then re-run `pnpm db:migrate`.

### Fresh local databases

`pnpm db:migrate:deploy` (or a fresh `migrate dev`) replays the full history —
no resolve needed, because nothing was previously recorded.

## Adding a patch

New schema repairs that must reach long-lived environments go through the
patches workflow: keep the migration SQL idempotent, add it (and a
`prisma/scripts/verify-*.sql` guard where useful) to the workflow's
dev/preview/production jobs, and expect local `migrate dev` to need the resolve
step above once the rewrite lands.
