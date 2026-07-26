# CARE ERP — Deployment Runbook

_Exact steps to deploy CARE ERP on the Synology NAS (Container Manager / `docker compose`), and how to roll back._

---

## 0. Pre-flight (once per environment)
1. `.env` exists next to `docker-compose.yml` with at least: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `SESSION_SECRET`, `ICICI_SECRET_KEY`. See `CARE_ERP_ENVIRONMENT_MATRIX.md`.
2. External DB volume exists: `docker volume create care_main_db_data` (only if not already present — **never** recreate over real data).
3. Optional integrations (Orthanc, OHIF, Ollama, n8n) configured only if in use.

## 1. Standard deploy (automated)
The repo ships `deploy-synology.sh`, which does exactly:
```sh
git fetch origin feature/website-login-redirection
git checkout feature/website-login-redirection
git reset --hard origin/feature/website-login-redirection   # deploy tracks this branch
export GIT_COMMIT=... GIT_BRANCH=... GIT_TAG=... BUILD_DATE=...   # version stamping
node scripts/bump-build.cjs                                  # ERP_VERSION / BUILD_NUMBER
sudo docker compose down --remove-orphans
sudo docker compose up -d --build
```
Run it:
```sh
./deploy-synology.sh
```

## 2. What happens on `up` (do not intervene mid-sequence)
```
care-db → healthy
  → care-db-patch-v2  applies migrations (Drizzle journal order, then migrations/*.sql
                      alphabetical), records schema_deploy_state, exits 0
     → care-schema-verify  confirms schema matches; exits 0 (blocks only on DB-identity
                           mismatch, or drift when SCHEMA_VERIFY_STRICT=true)
        → care-api  starts, healthcheck GET /health
           → care-web  nginx starts, healthcheck GET /nginx-health
```
`care-api` will **not** start unless `care-db-patch-v2` and `care-schema-verify` both exit 0 — a schema mismatch cannot silently serve traffic.

## 3. Post-deploy verification (required)
```sh
docker ps --format '{{.Names}}\t{{.Status}}'         # all healthy / patch+verify Exited(0)
pnpm operations:verify-deployment                     # full stack health
curl -fsS http://localhost:8080/health                # {"ok":true}
curl -fsS http://localhost:8080/api/system/version    # deployed version/commit
```
Expected: verifier prints "✓ No deployment-blocking failures." External services you haven't configured show **SKIPPED — NOT CONFIGURED** (not a failure).

Then the owner smoke: log in → Operational Health → `/radiology/usg-demo` (see `CARE_ERP_MASTER_HANDOVER.md` §Owner checklist).

## 4. First-ever install (empty database)
Same as above. The migration path is proven to bootstrap a completely empty DB end-to-end (`pnpm db:smoke` → 23/23). The first admin user is auto-seeded (default PIN `1234` for the bootstrap email); change it immediately, then ensure `BOOTSTRAP_ADMIN_FORCE` is `false`/unset.

## 5. Emergency / manual migration (rarely needed)
The automatic `care-db-patch-v2` handles all normal migrations. Only if debugging:
```sh
docker compose --profile manual run --rm care-migrate      # Drizzle TS migrator (db-deploy.ts)
```
One-off owner-reviewed data scripts run in the same container, e.g.:
```sh
docker compose run --rm care-migrate pnpm --filter @workspace/db run phase-f:assess
```

## 6. Rollback
Migrations are **forward-only** — there is no automatic data rollback. To roll back the application:
1. Identify the previous good commit/tag (`/api/system/version` history, or `git log`).
2. `git reset --hard <previous-commit>` on `feature/website-login-redirection`, then `docker compose up -d --build`.
3. The schema stays forward (idempotent, additive) — an older app image runs fine against the newer schema because migrations only ADD. If a specific migration must be neutralised, **remove its `migrations/*.sql` file** (removing a file never touches the DB) and write a compensating additive migration; never edit an already-applied migration.
4. For data corruption, restore from backup — see `CARE_ERP_RECOVERY_GUIDE.md`.

## 7. Safety guards you will see in logs (all good signs)
- **DB target printout** — host/port/db/user printed before any mutation (catches a wrong-`.env`).
- **DB identity check** — `system_database_identity` stamped `app_name=care-erp`; a mismatch **fails loudly** rather than migrating the wrong database.
- **Migration lock** — `schema_migration_lock` prevents two migration runs racing; auto-expires after 10 min if a run crashed.

## 8. When NOT to deploy
- A migration-order preflight fails: `node scripts/check-migration-order.cjs` → fix first.
- `pnpm db:smoke` fails against a scratch DB → the clean boot is broken; do not ship.
- Disk `<10%` free on the NAS → free space first (deploys write build layers).
