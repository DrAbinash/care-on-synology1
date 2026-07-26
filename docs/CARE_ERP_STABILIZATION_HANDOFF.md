# CARE ERP — Stabilization Handoff (2026-07-26)

_For the next developer or agent picking this up. Companion to
`docs/CARE_ERP_OPEN_ISSUES.md` (earlier audit pass) and
`docs/CARE_ERP_MASTER_HANDOVER.md` (architecture)._

**Read §1 and §2 first.** Everything else is context.

---

## 1. The two things that matter right now

### 1.1 There is still no proven-restorable backup

This is the single highest-risk open item, and it is **not** fixed by any merged PR.

For months every scheduled backup completed "successfully" while being
unrestorable — `pg_dump` was missing from the api image, so every run silently
fell through to `exportDatabaseSqlFallback()`, which emits `TRUNCATE + INSERT`
with **no `CREATE TABLE`**. The job recorded success, the SHA-256 matched the
bytes on disk, and the dead-man check stayed green throughout.

The pipeline is fixed (PR #257) and the verification job now opens a real
artifact instead of a dump it just made (PR #263). But:

- **Every artifact written before #257 deployed is still DATA-ONLY.** Restored
  into an empty database it produces nothing.
- **No post-fix backup has been confirmed yet.** Nobody has seen a job log
  saying `exporter=pg_dump`.

**To close this — fastest path first:**

```bash
# 1. Get a known-good backup RIGHT NOW. This does not depend on the api image
#    at all: care-db is postgres:16-alpine, which ships pg_dump 16 (matching
#    the 16.14 server). One command, guaranteed schema-complete.
docker exec care-db pg_dump -U erp -d diagnostic_erp \
  --no-owner --no-privileges --clean --if-exists \
  | gzip > /volume1/backups/caredeoghar_$(date +%Y%m%d_%H%M%S).sql.gz

# 2. PROVE it restores. Restores into a throwaway container and either prints
#    PASS or says exactly why not. Exit 0 means restorable; nothing in between.
bash scripts/verify-backup-restore.sh /volume1/backups/caredeoghar

# 3. Now check the SCHEDULER's own output the same way. Pass SESSION_SECRET for
#    anything written before BACKUP_PASSPHRASE was wired in (PR #257) —
#    production logs showed key=SESSION_SECRET.
SESSION_SECRET=... bash scripts/verify-backup-restore.sh /path/to/job/destinationPath

# 4. And confirm the pipeline itself: a good job records  exporter=pg_dump
#    in its notes. If it says  exporter=fallback , the api image did not pick
#    up postgresql-client-16 — get the build log.

# 5. Optionally force the in-app weekly test instead of waiting for Mon 03:30:
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<host>/api/internal/cron/restore-verification
```

> `scripts/verify-backup-restore.sh` was itself unable to read the scheduler's
> artifacts until PR #265 — it searched only for `caredeoghar_*.sql.gz[.enc]`,
> gunzipped unconditionally, and ran `psql` without `ON_ERROR_STOP`, so its
> restore step could not fail. Use the post-#265 version.

A **failure on a pre-#257 artifact is the correct result** — it means the job
is finally doing what it always claimed to. The first *pass* is the first
moment anyone can say this system has a restorable backup. Until then, assume
it does not.

### 1.2 Secrets are unrotated — owner action, cannot be fixed in code

| Secret | Deployed value | What it opens |
|---|---|---|
| `INTERNAL_API_KEY` | `1234` | DICOM intake, HL7 inbound, rate-limit bypass (full-DB export is now blocked — see below) |
| `DB_PASSWORD` | `changeme` | Postgres directly, bypassing every app-level check |
| `JWT_SECRET`, `SESSION_SECRET` | exposed | forged staff sessions = silent full admin |
| `TS_AUTHKEY`, `ICICI_SECRET_KEY`, `SUPER_ADMIN_USB_KEY`/PIN | exposed | as named |

Two traps when rotating:

1. **`INTERNAL_API_KEY` lives in two places.** `.env` **and** hardcoded at
   `care_erp_sync.py:44` (the Orthanc→ERP hook). Change both together or DICOM
   ingestion breaks.
   > `care_erp_sync.py` is **not in this repo** — it lives on the Orthanc/NAS
   > host and posts to `/api/internal/radiology/studies` and
   > `/api/internal/radiology/dicom-event`. Don't go looking for it here.
2. **Rotating `SESSION_SECRET` destroys backup decryptability.**
   `candidatePassphrases()` tries only `BACKUP_PASSPHRASE` and the *current*
   `SESSION_SECRET` — there is no previous-secret slot. Set
   `BACKUP_PASSPHRASE` to the **old** `SESSION_SECRET` *before* rotating, or
   every existing `.enc` file becomes unreadable by the app.

**How to tell rotation actually landed:** the api logs a line beginning
`SECURITY:` on every boot while `INTERNAL_API_KEY` is weak, naming exactly what
is still reachable. That line disappearing is the proof — not the `.env` file.

---

## 2. Deliberate decisions — do NOT "fix" these

Each of these looks like an oversight and is not. Undoing any of them causes a
clinical or operational outage. Tests pin most of them; read the test comment
before overriding.

| Thing that looks wrong | Why it is intentional |
|---|---|
| `internal-radiology.ts` has **no** weak-secret block, unlike `internal-backup.ts` | `care_erp_sync.py` posts DICOM studies with that same key. Blocking it stops study ingestion — a clinical outage traded for a security fix. The exposure is closed by **rotating**, not by refusing traffic. Pinned by `lib/secretStrength.test.ts`. |
| `radiology_worklist_accession_uq` reported "missing" by the schema verifier | The schema **deliberately** rejects it: `radiologyWorklist.ts:24` — `accession_number` is "nullable, NOT globally unique". `study_instance_uid` is the real identifier. Creating this index is wrong. |
| `idx_bills_referred_by_id`, `idx_bills_referred_by_created`, `idx_orders_referred_by` reported "missing" | They reference `bills.referred_by_id`, which is not in the Drizzle schema. `zz_schema_reconcile_20260709.sql` tries and swallows the failure into a `RAISE WARNING`. Verifier expectation drift, not a DB defect. Also commission territory — see below. |
| 14 `fetal_usg_*` type mismatches (`timestamp` vs `timestamptz`) | Flagged **non-blocking by the verifier itself**. Schema state is `full_pass`. |
| `proxy_pass http://$api_upstream;` with **no** URI part and **no** `$request_uri` | Measured against real nginx: `$request_uri` silently ignores `rewrite` (a `rewrite ... break` proxied the *pre*-rewrite URI). The bare form is byte-identical to the old literal across a 17-row matrix. Adding a URI part to `location = /health` **drops the query string**. |
| `docker/nginx.conf` comments never spell out the old literal `http://api:8080` | The operator pre-flight gate is `grep -c 'http://api:8080' docker/nginx.conf` → must be 0. A comment containing it makes the gate unpassable. |
| Commission / super-admin code | **Parked by the owner** — actively being modified elsewhere. Ships as a USB plugin; `routes/commission.ts` is a one-line stub. Do not touch without asking. |

---

## 3. Fixed in this pass

All merged to `feature/website-login-redirection`. Each shipped with tests that
were **confirmed to fail against the pre-fix tree** — they are guards, not
tautologies.

| PR | Fix | The actual defect |
|---|---|---|
| #257 | Backups are restorable | `pg_dump`/`psql` absent from the api image → silent DATA-ONLY fallback. Also: `pgDumpUsed: true` was hardcoded in snapshot metadata *inside the catch branch that used the fallback*; `synology-restore.sh` piped unconditionally through `gunzip` but the scheduler writes uncompressed `.sql.enc`; `BACKUP_PASSPHRASE` was documented but never passed into the container. |
| #258 | Staff session idle sweep | `INTERVAL '${idleMinutes} minutes'` in a Drizzle template makes the value a **bound parameter**, rendering `INTERVAL '$1 minutes'` — placeholder trapped inside a string literal. Postgres rejected every run; the `catch` swallowed it. **The sweep had never deleted a row.** Verified live post-deploy: `invalidated 12 idle staff session(s)`. |
| #259 | nginx dynamic upstream | A literal hostname in `proxy_pass` is resolved **once at config load**; container recreation left nginx proxying a dead IP. Measured: literal form still pinned at t+60s, variable+resolver followed at t+7s. |
| #260 | DICOM poll 403 loop | Poller ran for every user but the route requires `/dicom-nodes`. Separately, `readStaffSession()` returns a **new object each render**, so `[session]` re-fired the effect every render — 5 requests in 3s against a 30s interval. |
| #261 | Weak internal secrets | `/api/internal/backup/download` streams the whole patient DB, sits under the public `/api/` prefix (`routes/index.ts:254`), has **no IP allowlist**, and accepted `Bearer 1234`. Now refuses weak secrets like missing ones. |
| #262 | Postgres not network-exposed | `"${DB_HOST_PORT:-5400}:5432"` binds `0.0.0.0`. Now `${DB_BIND_ADDR:-127.0.0.1}:…`. Already rated **High** in `SOP/RECOVERY/07_SECURITY/ERP_SECURITY_AUDIT.md:27` and never applied. |
| #263 | Restore test verifies reality | The job passed no `backupPath`, so the engine dumped the live DB and restored *that* — proving `pg_dump` works and nothing about the NAS files. The failure email even claimed it "could not restore the latest backup". |

Earlier in the same pass: #217/#218/#223/#227 (bill audit actor + post-close
notice), #233/#235 (scheduler reachability, Orthanc poller backoff), #239
(openssl missing — backups dead 16 days), #240 (voucher numbering used
`count(*)` not `MAX`, creating a permanent collision fixed point), #241
(bill-dependent referential integrity), #244 (expense approval separation),
#245 (sync-billing dedup), #246 (schema verifier `full_fail`).

### Verified live in production logs (2026-07-26 03:23 UTC deploy)

`exporter=pg_dump` ❌ not yet observed · session sweep ✅ · schema `full_pass` ✅ ·
migrations 0 applied / 139 current ✅ · Orthanc poller silent ✅ · no nginx
resolver errors ✅ · all `/api/*` returning real upstream statuses ✅

---

## 4. Still open (none fatal)

| Item | Why it is not done |
|---|---|
| **~600 KB settings payloads** | `/api/clinic-settings` 605 KB, `/branding` 601 KB (×2 on login), `/portal/settings` 601 KB, `staff-login` 246 KB — base64 images inlined in JSON. ETag/304 works per-endpoint but can't dedupe *across* them, so a cold login pulls ~2 MB. **Paused deliberately:** the fix is to serve images from a cacheable URL, but `premiumBillPrint.ts:518` puts the logo into a print window, where swapping a data URL for a fetched URL can race the print dialog and produce a **logo-less bill**. Server-side renderers (`reportPresentation.ts`, `radiology-report-generator.ts`, `patient-reports.ts`) read the DB row directly and are unaffected. Needs print verification on real hardware. Note the upload cap at `clinicSettings.ts:682` is a very generous 2 MB. |
| `/api/system/version/short` → 404 | Frontend calls a route that does not exist. Cosmetic. |
| Doubled `/erp/erp/` referer segment | Seen as `/erp/erp/portal/staff-login`. Cosmetic. |
| `doctors.ts:293,296` hard-deletes `commission_rules` + `doctor_payouts` | Destroys payout history with no soft-delete. **Commission territory — parked.** |
| `scripts/generate-migrations-auto.cjs:8` | Hardcoded `postgresql://erp:changeme@100.65.255.115:5400/…` in the repo. Becomes stale once `DB_PASSWORD` rotates. |

---

## 5. Verification recipes

```bash
# Full gate (run from REPO ROOT — the vitest include is root-relative)
pnpm run typecheck
DATABASE_URL="postgresql://u:p@localhost:5432/none" npx vitest run
node scripts/check-migration-order.cjs
node scripts/migration-bootstrap-smoke.mjs

# Expected: 6 USG *.integration.test.ts files FAIL without a live Postgres
# (ECONNREFUSED 5432). That is environmental, not a regression.
# clinic-site/diagnostic-erp typecheck may fail on @types/react duplication in
# the vendored ui/calendar.tsx + ui/spinner.tsx — pre-existing, CI resolves it.

# nginx changes can be verified WITHOUT docker:
#   apt-get install -y nginx-light   (nginx 1.24 is enough)
#   run a Node stub upstream, build old+new configs from the real repo files,
#   diff the URI each one forwards. See PR #259 for the 17-row matrix.
```

**Deploy-time pre-flight for the nginx resolver** (the one assumption never
tested here — no docker daemon in the dev sandbox):

```bash
docker compose exec web cat /etc/resolv.conf   # MUST contain 127.0.0.11
grep -c 'http://api:8080' docker/nginx.conf    # MUST print 0
```

If `127.0.0.11` is absent, **do not rebuild web** — every `/api` request would
stall then 502, while `docker ps` still reports `care-web` healthy (because
`/nginx-health` is answered by nginx itself and never touches the upstream).

---

## 6. Traps that cost time in this pass

- **Tests that assert on source text match their own comments.** Twice a
  `not.toContain(...)` matched the explanatory comment describing the bug being
  fixed. Strip comment lines before any absence assertion. The same bit an
  *operator-facing* command: a `grep` gate in `docker/nginx.conf` matched its
  own documentation.
- **`git checkout -B` silently discards uncommitted tracked edits.** It ate six
  files once. Commit to a safe SHA before any branch switch.
- **`lib/db/dist/` is gitignored and can shadow `src/`.** A stale copy produces
  phantom "property does not exist" errors. `rm -rf lib/db/dist && find . -name
  '*.tsbuildinfo' -delete && npx tsc --build`.
- **Prefer behavioural tests over source-contract tests.** Two source-contract
  tests written earlier in this pass broke on a *correct* refactor because they
  pinned an exact 503 string. They were rewritten to assert behaviour.
- **Protected financial files** (`ACCOUNTING_PROTECTED_FILES.md`): `bills.ts`,
  `gateway-webhooks.ts`, `public-booking.ts`, `auto-voucher.ts`,
  `books-sanity.ts` are 🔴 CRITICAL and require the Section A/B questionnaire in
  `FINANCIAL_CHANGE_CONTROL.md`. `cron.ts` and `backupReplication.ts` are not on
  that list.
- **Migration order is alphabetical**, applied by `docker/db-patch-entrypoint.sh`
  — Drizzle journal first, then `migrations/*.sql`. A migration marked "applied"
  whose objects are missing usually means it ran before its dependency existed,
  or its `DO $$ … EXCEPTION` block swallowed the failure into a warning.
- **Ollama is outbound.** The api container calls *out* to `OLLAMA_URL`; nothing
  connects *in* to Postgres for AI. Do not widen a bind address for it.

---

## 7. Where to look first

| Question | File |
|---|---|
| Is a backup restorable? | `artifacts/api-server/src/lib/restoreVerification.ts`, `cron.ts` → `runRestoreVerificationJob` |
| Why did a backup silently degrade? | `routes/backupReplication.ts` → `exportDatabaseSqlFallback` header |
| What guards an internal endpoint? | `lib/secretStrength.ts`, `routes/internal-backup.ts`, `routes/internal-cron.ts` |
| How are permissions resolved client-side? | `artifacts/diagnostic-erp/src/lib/staffSession.ts` (`PERMISSION_ALIASES`, `canAccess`) |
| Why is nginx shaped like that? | `docker/nginx.conf` header comments — each block records the incident that caused it |
