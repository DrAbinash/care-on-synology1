---
name: Post-merge CI push
description: How to apply schema changes non-interactively in post-merge setup (no TTY available).
---

## The rule

Never use `drizzle-kit push` (CLI or programmatic `pushSchema`) in post-merge/CI scripts. Both hang regardless of TTY state because the Ink/clack rename-detection resolver runs on raw keyboard events.

**Use `generateDrizzleJson` + `generateMigration` instead** (lib/db/scripts/ci-push.ts):

```ts
const desired = generateDrizzleJson(schema);
const empty   = generateDrizzleJson({});
const stmts   = await generateMigration(empty, desired);
// Apply each, catching 42P07 (duplicate_table) and 42701 (duplicate_column)
```

This generates all CREATE TABLE / index statements from scratch and silently skips anything that already exists. It never prompts.

**Why:** drizzle-kit's `applyPgSnapshotsDiff` resolver asks "is table X renamed from Y?" even in programmatic mode. The prompt reads raw stdin; piping newlines doesn't help.

**How to apply:**
- `pnpm --filter @workspace/db run push-ci` — calls `tsx scripts/ci-push.ts`
- `scripts/post-merge.sh` calls this after `pnpm install --frozen-lockfile`
- Post-merge timeout is set to 120 000 ms (enough for install + schema push)

**If a new table causes the rename prompt before push-ci can run:** apply it manually via `psql "$DATABASE_URL"` with `CREATE TABLE IF NOT EXISTS`, then push-ci will skip it gracefully.
