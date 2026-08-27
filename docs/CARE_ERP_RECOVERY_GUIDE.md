# CARE ERP — Recovery Guide

_How to recover safely from failure states without losing patient, report, or billing data._

**Prime directives**
- Migrations are forward-only; there is no automatic data rollback.
- **Take a backup before any destructive action:** `docker exec care-db pg_dump -U erp diagnostic_erp > care-$(date +%F).sql`
- Never edit an already-applied migration; never mutate a signed/finalized report.

---

## A. Application rollback (bad release, schema is fine)
1. `git reset --hard <previous-good-commit>` on `main`.
2. `docker compose up -d --build`.
3. Verify: `pnpm operations:verify-deployment`. The additive-only schema means an older image runs against the newer schema safely.

## B. Migration failed mid-deploy (`care-db-patch-v2` non-zero)
1. `docker logs care-db-patch-v2` → find `✗ Feature migration FAILED: <file>`.
2. Reproduce safely, no real DB: `node scripts/check-migration-order.cjs` then `pnpm db:smoke`.
3. Fix or remove the offending `migrations/*.sql` (removing the file never touches the DB), redeploy. Already-applied files are skipped by hash.
4. If a partial change landed, write a compensating **additive** migration (`ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).

## C. Interrupted migration / stale lock
- Symptom: "Could not acquire schema migration lock".
- The lock auto-expires after 10 min. If you are certain no migration is running:
  `docker exec care-db psql -U erp -d diagnostic_erp -c "UPDATE schema_migration_lock SET locked=false WHERE id=1;"`
- Then redeploy. The migrator is idempotent — a re-run is safe (proven: `pnpm db:smoke` re-runs all migrations with zero data change).

## D. Restore the database from backup
1. Stop the app so nothing writes: `docker compose stop api web`.
2. Restore into a **fresh** database (never over the live one blindly):
   ```sh
   docker exec -i care-db psql -U erp -c "CREATE DATABASE diagnostic_erp_restore;"
   docker exec -i care-db psql -U erp -d diagnostic_erp_restore < care-YYYY-MM-DD.sql
   ```
3. Verify row counts and that signed reports are intact, then cut over (point `DB_NAME` at the restore, or rename).
4. **Schema drift after restoring an OLD backup:** the restored tracking tables mark later migrations "already applied" though the schema predates them. Regenerate a reconcile migration:
   `node scripts/generate-schema-reconcile.cjs --date YYYYMMDD` → writes `migrations/zz_schema_reconcile_<date>.sql` (idempotent, error-downgraded), then redeploy. See `HOW_TO_ADD_DB_MIGRATIONS.md` §"Schema drift after a volume restore".

## E. Lost admin access
1. `.env`: `BOOTSTRAP_ADMIN_FORCE=true` (and set `BOOTSTRAP_ADMIN_EMAIL/PIN` if needed).
2. `docker compose up -d` → log in with the bootstrap email + PIN → change the PIN in the UI.
3. **Immediately** set `BOOTSTRAP_ADMIN_FORCE=false` (or remove the line) and redeploy — leaving it on resets the PIN on every restart.

## F. Study-lock conflict (reporting shows read-only)
- A lock older than the idle window blocks editing. Clear from Admin, or:
  `docker exec care-db psql -U erp -d diagnostic_erp -c "DELETE FROM radiology_study_locks WHERE last_activity_at < now() - interval '2 hours';"`
- Never force-overwrite a report held by an active lock — coordinate with the holder.

## G. USG Companion / reporting UI crash
- The workspace offers **Return to Classic** and preserves the canonical draft; a diagnostic ID is logged. Use the kill switch (disable the relevant `ff_radiology_usg_*` flag in Admin → Feature Flags) to restore the Classic Workspace instantly — no data change (`rollbackEffect` documented per flag in the registry).

## H. External service down (Orthanc / OHIF / Ollama / PACS / WhatsApp)
- **Reporting continues** — these are non-blocking. AI/viewer/PACS controls show an unavailable state; PACS-return and delivery use persistent retry queues you can re-run from Admin once the service returns. See `CARE_ERP_TROUBLESHOOTING.md` rows 6–15.

## I. Full disaster recovery (fresh NAS)
1. Reinstall Container Manager; restore the `care_main_db_data` volume from backup (or start empty — the clean bootstrap is proven).
2. Restore `.env` (secrets) from your secrets store.
3. `./deploy-synology.sh`.
4. If DB restored from backup: run the reconcile migration (D.4).
5. `pnpm operations:verify-deployment` → resolve any blocking failure before reopening to users.

---

## Recovery quick-reference
| Situation | First command | Safe fix |
|---|---|---|
| Bad release | `git log` | reset to previous commit, `up --build` |
| Migration failed | `docker logs care-db-patch-v2` | fix/remove `migrations/*.sql`, `pnpm db:smoke`, redeploy |
| Stale lock | check `schema_migration_lock` | clear lock (if truly idle), redeploy |
| DB corrupt | `pg_dump` first | restore into fresh DB, reconcile, cut over |
| No admin | — | `BOOTSTRAP_ADMIN_FORCE=true` → login → reset → `false` |
| UI crash | — | Return to Classic / disable USG flag (kill switch) |
