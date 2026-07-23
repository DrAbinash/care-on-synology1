# CARE Staff/HR Module — Rollout, Migration Safety & Deployment

**Status:** Phase 0/1 · **Date:** 2026-07-23

Covers shadow mode, feature flags, the migration-safety report for this change, deployment on the
Synology/Docker stack, verification, and rollback.

---

## 1. Shadow mode (mandatory first posture)

The module runs in **Shadow Mode**: scores/eligibility compute and are reviewable, but **no payroll amount
changes, no allowance is granted, no increment is applied, and no disciplinary action is triggered by
software alone**. Every `ff_hr_*` flag is seeded **disabled**. Nothing is user-visible or active until an
admin explicitly enables a flag.

## 2. Feature flags (seeded disabled — server `feature_flags` table)

| Key | Gates |
|---|---|
| `ff_hr_staff_enhanced` | Enhanced Staff directory/profile UI |
| `ff_hr_attendance_management` | Attendance management (manual + import) |
| `ff_hr_biometric_attendance` | USB fingerprint-bridge attendance |
| `ff_hr_performance_scoring` | Monthly performance scoring |
| `ff_hr_employee_self_service` | Employee self-service (own score/attendance) |
| `ff_hr_performance_appeals` | Explanations & appeals |
| `ff_hr_staff_awards` | Employee of Week/Month/Year |
| `ff_hr_performance_allowances` | Travel/Food allowance eligibility |
| `ff_hr_annual_appraisals` | Annual appraisal & increment recommendations |
| `ff_hr_shadow_mode` | Master shadow-mode guard (compute-only) |

- **Backend check:** `isFeatureEnabledServer("ff_hr_...")` (`artifacts/api-server/src/lib/featureFlags.ts`, 30s cache).
- **Toggle:** `PATCH /api/feature-flags/:key` (admin only). **Read:** `GET /api/feature-flags`.
- **Frontend:** the client `FEATURE_FLAG_DEFAULTS` (`staffSession.ts`) hydrates server `ff_*` values via
  `useServerFeatureFlags()`. Follow the "wired" discipline (`CARE_ERP_OPEN_ISSUES.md` #5): do not enable a
  flag until it is fully vertically integrated (backend gate + service + frontend consumer).

## 3. Migration-safety report (this change)

**File:** `migrations/staff_hr_foundation.sql` — additive, idempotent, non-financial.

| Check | Result |
|---|---|
| Additive only (no `ALTER`/`DROP`/`RENAME` of existing tables) | ✅ four new `CREATE TABLE IF NOT EXISTS` + indexes |
| Idempotent (safe to run 10×) | ✅ `IF NOT EXISTS` DDL + `INSERT ... ON CONFLICT (key) DO NOTHING` |
| No `NOT NULL` without `DEFAULT` on any altered table | ✅ N/A — no existing table altered |
| FK targets exist at execution time | ✅ `staff`/`users`/`departments` are Drizzle-core (`0000_dear_forge.sql`); `feature_flags` from `aaaa_bootstrap_feature_flags.sql` (sorts first) |
| Ordering preflight | ✅ `node scripts/check-migration-order.cjs` → "No ordering violations" |
| HR/legal delete safety | ✅ owning-staff FKs `ON DELETE RESTRICT`; actor/department FKs `ON DELETE SET NULL` (never `CASCADE`) |
| Touches a financial/protected table? | ❌ none (bills/payments/vouchers/ledgers/salary/advances/commission untouched) |
| Full test suite | ✅ `3187 passed`; the 12 failing files are pre-existing env failures (`DATABASE_URL` not provisioned in the sandbox), unrelated to this diff |
| Drizzle schema parity | ✅ `lib/db/src/schema/staffHr.ts` mirrors the SQL; exported from `schema/index.ts` |

Tables created: `designations`, `staff_status_history`, `staff_reporting_lines`, `staff_documents` (all inert —
no routes/UI yet). Flags seeded disabled. Follows the `add_staff_quick_doctors.sql` precedent (hand-written
idempotent migration + Drizzle schema file; no drizzle-kit migration).

**Note on future migrations:** the staff schema is Drizzle-native. Later performance/attendance tables should
prefer a generated Drizzle migration (`cd lib/db && pnpm drizzle-kit generate`) to avoid the dual-tracking
drift `MIGRATION_FRAMEWORK_AUDIT.md` warns about — or a hand-written `migrations/*.sql` mirrored exactly by the
Drizzle schema, as done here. Always run `check-migration-order.cjs` and add column-level DML only after the
column exists in execution order.

## 4. Service-worker cache guard (required for future self-scoped endpoints)

Any authenticated **GET** that returns data scoped to the caller's own identity (`/api/my/attendance`,
`/api/my/performance`, `/api/my/score`, …) **must** have its path added to `NETWORK_ONLY_PREFIXES` in
`artifacts/diagnostic-erp/public/sw.js`, or the SW caches by URL and can serve one user's data to the next.
This is enforced by `personalEndpointCacheGuard.test.ts`. **This change ships no such endpoint** (foundation
only), so no `sw.js` edit is needed yet — it becomes mandatory in the self-service phase.

## 5. Deployment (Synology NAS / Docker Compose)

Standard two-command deploy (`DEPLOYMENT.md`): `git pull` then `docker compose up -d --build`. Migrations run
automatically: `care-db-patch-v2` applies `lib/db/drizzle/*.sql` then `migrations/*.sql` (alphabetical) with
`psql -v ON_ERROR_STOP=1` before `care-api` starts. `care-schema-verify` then read-verifies. No manual step;
never edit `docker/db-patch-entrypoint.sh`; never `docker compose down -v`.

## 6. Verification (post-deploy)

- `node scripts/check-migration-order.cjs` (pre-deploy, in CI/`pnpm test`).
- `curl /api/health/schema` → readiness after boot.
- Confirm the four tables exist and are empty; confirm `feature_flags` has the 10 `ff_hr_*` rows, all `enabled=false`.
- `pnpm test` (unit) + `pnpm typecheck` (root).

## 7. Rollback

- **Forward-only migrations** (`HOW_TO_ADD_DB_MIGRATIONS.md`): there are no auto-rollbacks. To stop the module,
  leave all `ff_hr_*` flags disabled (default) — the tables are inert and harmless.
- To reverse the migration file: revert `migrations/staff_hr_foundation.sql` (an already-applied file is skipped
  by hash, so removing it does not re-run). The four empty tables can remain (inert) or be dropped manually via a
  compensating, reviewed SQL (`docker exec -it care-db psql ...`) **only** if confirmed empty. HR tables that have
  accumulated real rows must **not** be dropped.
- No financial state is ever affected by enabling/disabling this module.

## 8. Staged activation order (later phases, each reviewed)

1. `ff_hr_staff_enhanced` (directory/profile) → 2. `ff_hr_attendance_management` → 3. `ff_hr_performance_scoring`
(shadow) → 4. `ff_hr_employee_self_service` + `ff_hr_performance_appeals` → 5. `ff_hr_staff_awards` +
`ff_hr_performance_allowances` (management approval required) → 6. `ff_hr_annual_appraisals`. Biometric
(`ff_hr_biometric_attendance`) activates independently once hardware is verified (`FINGERPRINT_ATTENDANCE_INTEGRATION.md`).
