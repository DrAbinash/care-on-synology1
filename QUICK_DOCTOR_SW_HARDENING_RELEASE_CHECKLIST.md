# Production Deployment Checklist — Quick Doctor Fix + Service Worker Hardening

**Release scope:** commits `0cf3b8bc` → `151b5302` on `claude/care-radiology-impl-guide-aywbd9`
(merged to the default branch via PR #14, plus two follow-on hardening commits).

| Commit | Summary |
|---|---|
| `0cf3b8bc` | Fix 403 on Quick Doctor save for non-admin Billing Desk staff — new `staff_quick_doctors` table, `GET/PUT /api/my/quick-doctors` |
| `ba2e110a` | Fix CRITICAL — service worker cache leaked personal data across staff/patients on shared workstations |
| `151b5302` | Hardening pass — automated CI guardrail + developer guardrail docs against the same bug class recurring |

**Database change:** one new table (`staff_quick_doctors`), applied via
`migrations/add_staff_quick_doctors.sql` (idempotent, additive-only — no
`ALTER`/`DROP` on existing tables).

**Not in this release:** `SECURITY_FINDING_PUBLIC_BOOKING_PHI_EXPOSURE.md`
documents an unrelated, pre-existing, **unfixed** finding on the public
booking site. It is explicitly out of scope for this deploy — do not treat
it as a blocker or attempt to fix it as part of this checklist.

This document assumes the standard deployment mechanics already described in
`DEPLOYMENT.md` (the `care-db-patch-v2` → `care-schema-verify` → `care-api` →
`care-web` startup chain, migration auto-discovery, health endpoints). It
does not repeat that mechanism — it is the release-specific runbook for
*this* change, for whoever is on call during the deploy.

---

## 1. Pre-Deployment Checklist

Complete every item before touching the production host.

- [ ] **Maintenance window communicated.** Even though this deploy is
      zero-downtime in the normal case (rolling `care-api`/`care-web`
      rebuild, `care-db` untouched), notify reception/billing staff of a
      possible few-minutes blip so no one is mid-bill-save during the
      restart.
- [ ] **Branch state confirmed.** On the deploy host:
      ```bash
      git fetch origin
      git log --oneline -5 origin/<default-branch>
      # Confirm 151b5302 (or later) is present in the history you're about to pull
      ```
- [ ] **CI green** on the merged PR (tests, typecheck baseline unchanged —
      see §7 for the exact expected numbers).
- [ ] **Fresh backup taken** (see §2 below) — not the nightly one; a
      deploy-time snapshot.
- [ ] **`.env` reviewed** — confirm `JWT_SECRET`, `SESSION_SECRET`,
      `ICICI_SECRET_KEY` are the real production values (not placeholders),
      and `DATABASE_URL`/`DB_HOST`/`DB_NAME` point at the correct production
      database. This release adds a new table; a misdirected DB target would
      create `staff_quick_doctors` in the wrong place.
- [ ] **Rollback owner named** — one person is explicitly on point to run
      §6 if needed, not "whoever notices."
- [ ] **Change log entry drafted** (what changed, why, who to contact) for
      the on-call channel.

---

## 2. Pre-Deployment Backup

```bash
# On the Synology NAS, from the compose project directory:
docker exec care-db pg_dump -U ${DB_USER:-erp} -d ${DB_NAME:-diagnostic_erp} \
  --format=custom -f /tmp/pre_quickdoctor_deploy.dump
docker cp care-db:/tmp/pre_quickdoctor_deploy.dump \
  ./backups/pre_quickdoctor_deploy_$(date +%Y%m%d_%H%M).dump

# Verify the dump is non-trivial in size and not corrupt:
ls -lh ./backups/pre_quickdoctor_deploy_*.dump
docker exec care-db pg_restore --list /tmp/pre_quickdoctor_deploy.dump | head -20
```

- [ ] Backup file exists, is a plausible size (compare to yesterday's
      nightly backup via `scripts/synology-backup.sh`'s output directory),
      and `pg_restore --list` prints a table of contents without error.
- [ ] Backup copied off the NAS to secondary storage per existing backup
      policy (same as the nightly job).

This is in addition to, not a replacement for, the existing nightly
`scripts/synology-backup.sh` job — keep that schedule running as-is.

---

## 3. Step-by-Step Deployment Plan

```bash
# 1. SSH into the Synology NAS
ssh admin@192.168.1.137
cd /volume1/care-erp   # or wherever the repo is checked out

# 2. Confirm no uncommitted local drift on the deploy host
git status

# 3. Pull the release
git fetch origin
git log --oneline origin/<default-branch> -3   # sanity-check 151b5302 is there
git pull

# 4. Deploy — this is the entire mechanism (see DEPLOYMENT.md for the full
#    startup-order explanation): care-db-patch-v2 applies
#    migrations/add_staff_quick_doctors.sql, care-schema-verify checks it,
#    then care-api and care-web rebuild and restart.
docker compose up -d --build

# 5. Watch the migration step specifically — this is the one part of this
#    release that touches the database
docker compose logs -f care-db-patch-v2
# Expected to see, among the other (already-applied, skipped) migrations:
#   [apply] add_staff_quick_doctors.sql
# with no error lines. If it's already been applied by a prior deploy of
# this same branch, you'll instead see it skipped by hash — that's fine.

# 6. Watch schema verification (read-only report)
docker compose logs -f care-schema-verify

# 7. Watch API startup
docker compose logs -f care-api --tail 100
```

- [ ] `care-db-patch-v2` exited 0, log shows `add_staff_quick_doctors.sql`
      applied (or already-applied) with **zero** unexpected error lines.
- [ ] `care-schema-verify` exited 0.
- [ ] `care-api` reports healthy (`docker compose ps` shows `healthy`, not
      just `running`).
- [ ] `care-web` started only after `care-api` was healthy (per
      `depends_on: condition: service_healthy` — this is automatic, just
      confirm the log timestamps reflect it).

Do **not** proceed to §4 until every box above is checked.

---

## 4. Health Checks

```bash
# All containers up and the right ones report "healthy"
docker compose ps

# Liveness — always 200 if the process is up at all
curl -s http://localhost:8080/health
# → {"ok":true}

# Schema readiness — confirms this release's migration actually landed
curl -s http://localhost:8080/api/health/schema
# → {"ok":true,"state":{"db_patch_ok":"true","total_migrations":"<N>", ...}}
# total_migrations should be one higher than before this deploy (or equal,
# if this was a redeploy of an already-migrated environment).

# ERP shell reachable through nginx
curl -s http://localhost:8888/erp/ | grep -q "Care Diagnostics" && echo "ERP OK"
```

- [ ] `docker compose ps` — `care-api` and `care-web` both `healthy`/`Up`,
      `care-db-patch-v2` and `care-schema-verify` both `Exited (0)`.
- [ ] `/health` → `200 {"ok":true}`.
- [ ] `/api/health/schema` → `200 {"ok":true, ...}` (not 503).
- [ ] `curl .../erp/` returns the SPA shell, not an error page.

If any of these fail, stop and go to §6 (Rollback) rather than debugging
live against production traffic — diagnose against the backup/staging
instead.

---

## 5. Smoke Tests (this release's specific behavior)

Run these against production immediately after health checks pass, using a
real (non-admin) staff account and a real Super Admin account — not curl
against `/api/my/quick-doctors` with a forged session, since the whole point
of the original bug was authorization-layer behavior.

- [ ] **Login** — Super Admin can log in.
- [ ] **Login** — a non-admin Billing/Reception staff member can log in.
- [ ] **Billing Desk loads** for the non-admin user (doctor search
      populates).
- [ ] **Quick Doctor save works for the non-admin user** — this is the exact
      bug this release fixes. Open Billing Desk → Quick Doctor settings →
      assign a doctor to a slot → Save. Must succeed (no "Failed to save
      quick doctor" error, no 403).
- [ ] **Quick Doctor save persists** — reload Billing Desk, confirm the
      saved doctor is still shown in the slot.
- [ ] **Quick Doctor isolation** — log in as a second staff member on the
      same or a different workstation; confirm they see their **own**
      Quick Doctor layout (or the legacy shared default if they've never
      saved one), not the first staff member's.
- [ ] **Shared-workstation check (the CRITICAL fix)** — on one browser/
      workstation: log in as Staff A, open Billing Desk (loads Quick
      Doctor), log out, log in as Staff B, open Billing Desk again.
      Staff B must see **their own** Quick Doctor layout, never a flash of
      Staff A's. If unsure, hard-refresh is not required — the fix means
      the service worker never serves a cached response for this endpoint
      at all, so this should be correct even without a refresh.
- [ ] **Existing bills / patient registration unaffected** — spot-check
      that creating a bill and registering a patient still work normally
      (this release did not touch that code, but confirms no incidental
      regression from the API/container restart).
- [ ] **PWA/offline shell still loads** — if the ERP is used as an
      installed PWA on any workstation, confirm it still opens normally
      after this deploy (the service worker file changed; a stale
      previously-installed worker should self-update via the existing
      `skipWaiting()`/`clients.claim()` lifecycle on next navigation — this
      confirms it actually did).

---

## 6. Rollback Plan

Use this if §4 health checks fail, or §5 smoke tests surface a regression.

### 6a. Application rollback (no data changes to undo)

```bash
docker compose down
git log --oneline -5          # identify the pre-release commit, e.g. fc4cd879
git checkout fc4cd879         # last known-good commit before this release
docker compose up -d --build
```

- [ ] Confirm `docker compose ps` shows all services healthy again on the
      old code.
- [ ] Re-run §4 health checks against the rolled-back version.

This is normally sufficient. The only schema change in this release is a
**new, additive table** (`staff_quick_doctors`) — rolling back the
application code does not require rolling back the schema. Old code simply
never reads/writes that table again; no other table or column was altered.

### 6b. Only if the migration itself is suspected to have corrupted data

This should not be necessary given the migration is `CREATE TABLE IF NOT
EXISTS` only, but if there is any doubt:

```bash
docker compose down
# Restore from the pre-deployment backup taken in §2:
docker exec -i care-db pg_restore -U ${DB_USER:-erp} -d ${DB_NAME:-diagnostic_erp} \
  --clean --if-exists < ./backups/pre_quickdoctor_deploy_<timestamp>.dump
git checkout fc4cd879
docker compose up -d --build
```

- [ ] **Do not** run this unless §6a alone did not resolve the issue — a
      full restore is more disruptive (rolls back *every* table to the
      backup point, including any bills/patients/reports created in the
      intervening window) than simply reverting the application code.

### 6c. Rollback communication

- [ ] Notify the on-call channel that a rollback occurred, with the reason.
- [ ] File a follow-up issue for the root cause before re-attempting this
      release.

---

## 7. Monitoring Checklist (first 24–48 hours after deploy)

- [ ] **Error logs** — `docker compose logs care-api --tail 200 -f` (or
      whatever centralized log aggregation is in place) — watch for any
      500s on `/api/my/quick-doctors`, or any new exception class not seen
      before this deploy.
- [ ] **403/401 rate on `/api/my/quick-doctors`** — should be near zero for
      authenticated staff after this fix. A nonzero rate here (excluding
      the expected 401 for genuinely logged-out sessions) would indicate the
      fix regressed.
- [ ] **`staff_quick_doctors` row count growth** — sanity metric; should
      grow roughly with the number of distinct staff who open Billing Desk
      and save a layout, not spike unexpectedly (which could indicate
      duplicate-row creation, i.e. the unique constraint not holding).
      ```sql
      SELECT COUNT(*), COUNT(DISTINCT staff_id) FROM staff_quick_doctors;
      -- these two numbers must always be equal (one row per staff, enforced
      -- by the staff_quick_doctors_staff_uq unique index)
      ```
- [ ] **Service worker cache size / behavior** — no direct server-side
      metric; spot-check on 2–3 real workstations over the following days
      that no staff member reports seeing another staff member's Quick
      Doctor selections (this is the regression class this release closes —
      treat any such report as high priority).
- [ ] **CI guardrail staying green** — confirm
      `personalEndpointCacheGuard.test.ts` and
      `serviceWorkerCacheExclusions.test.ts` continue to pass on subsequent
      merges (they are designed to fail loudly if a future change
      reintroduces this bug class or adds a new unprotected personal
      endpoint).
- [ ] **Support/helpdesk channel** — watch specifically for "wrong doctor
      showing," "can't save quick doctor," or "seeing someone else's data"
      reports; triage any such report as a potential regression of this
      exact release, not routine noise.

---

## 8. Post-Deployment Verification (sign-off)

To be completed by the deploying engineer and acknowledged by a second
person before closing out the release.

- [ ] All items in §3 (deployment steps), §4 (health checks), and §5
      (smoke tests) checked off.
- [ ] Backup from §2 confirmed restorable in principle (table-of-contents
      listed successfully) and archived per policy.
- [ ] Monitoring from §7 set up / being actively watched for the stated
      window.
- [ ] `SECURITY_FINDING_PUBLIC_BOOKING_PHI_EXPOSURE.md` confirmed still
      tracked as open, separate, unaffected by this deploy — not
      accidentally closed or forgotten because "the security pass shipped."
- [ ] No `SCHEMA_REPAIR=true` or `SCHEMA_VERIFY_STRICT=true` left set in
      `.env` after this deploy unless deliberately intended long-term.
- [ ] Release recorded (commit range, deploy timestamp, who deployed, who
      verified) in whatever release log/changelog process is standard.

**Deployed by:** _______________  **Date/time:** _______________
**Verified by:** _______________  **Date/time:** _______________

**Result:** ☐ Deployed successfully, all checks pass
            ☐ Rolled back — see §6c for reason and follow-up issue
