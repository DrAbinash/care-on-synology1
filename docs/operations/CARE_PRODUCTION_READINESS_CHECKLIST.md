# CARE ERP — Production Readiness Checklist

_The operator's document: what has to be true before a deploy, during one, after one, and in a
rollback — with the command that establishes each item and the answer that counts as evidence.
Nothing here is executed for you. This is instructions for a human on the NAS, not automation._

**Companion to, not a replacement for:** `CARE_ERP_DEPLOYMENT_RUNBOOK.md` (the exact 12-step
sequence and why each step exists), `CARE_ERP_BACKUP_COVERAGE.md` (which data is protected at
all), `CARE_ERP_SECOND_NAS_DISASTER_RECOVERY.md` (the standby), and
`docs/hope-care-integration/07_EVENT_COMPATIBILITY_VERIFICATION.md` (the HOPE contract).

**Status of this document: LOCAL.** The commands were read out of this repository at
`3f044107` and the tooling was tested against synthetic fixtures. **No item here has been
executed against the clinic box**, and the clinic's current readiness state is therefore not
recorded in this file — running it is the operator's action.

---

## 0. How to read an answer

| answer | meaning | deploy on it? |
|---|---|---|
| **PASS** | measured, and it is right | yes |
| **FAIL** | measured, and it is wrong | no — fix first |
| **UNKNOWN** | it could not be measured from here | **no for a critical row.** "Nobody has ever proved a restore on this box" is not the same fact as "the restore works" |
| **NOT_APPLICABLE** | deliberately out of scope | it is not a pass either |

Verdicts: `READY` (exit 0) · `NOT_READY` (1) · `INSUFFICIENT_EVIDENCE` (2). The last one is not a
green light and must never be treated as one.

The one command that fills in most of §1:

```sh
node scripts/ops-preflight.mjs
```

(`pnpm ops:preflight` on a dev box. `pnpm` and `npx` are not on PATH on Synology; the scripts are
Node-builtins-only, so `node scripts/<tool>.mjs` runs with the NAS's own `/usr/local/bin/node`.)

---

## 1. PRE-DEPLOYMENT

| # | Check | Command | Evidence that it passed | If it does not |
|---|---|---|---|---|
| P1 | Free space on the volume deploys write to | `df -h /volume1` | ≥ 10 % free | stop; a build that fills the volume mid-layer can leave a half-built image |
| P2 | Compose can interpolate its own variables | `docker compose config --quiet` | exit 0 | a required `${VAR:?}` is unset. **Never run `docker compose config` and read its output**: it prints secret values, and a line-based redactor misses YAML `KEY: value` |
| P3 | Guarded secrets are strong and not the published ones | `node scripts/check-env-secrets.mjs --file .env` | `Guarded secrets acceptable` | the values this repository shipped publicly are refused; rotate per `docs/hope-care-integration/06_CREDENTIAL_ROTATION.md` |
| P4 | Migration order and idempotency | `node scripts/check-migration-order.cjs` | `✓ No ordering violations` | fix the order before deploying; `schema_migrations_log(name, kind, sha256)` refuses to re-run an edited file |
| P5 | What this deploy will actually change | `git log --name-only --diff-filter=A $(cat .git-deployed 2>/dev/null \|\| echo HEAD)..origin/main -- migrations/*.sql lib/db/drizzle/` | every added file has been read by a named person | unread SQL is unreviewed schema change |
| P6 | A backup exists **and is proven** | `bash scripts/synology-nas-backup.sh` then `bash scripts/verify-backup-restore.sh <BACKUP_DIR>` | the verifier exits 0: it restored that artifact into a throwaway container with `ON_ERROR_STOP=1`, refused an incomplete schema, and printed non-zero `patients`/`bills`/`payments` counts | no deploy. `deploy-synology.sh` takes **no** backup itself and `git reset --hard` is one of its steps |
| P7 | The artifact inventory agrees with the plan | `BACKUP_DIR=<dir> node scripts/ops-backup-inventory.mjs --verify-checksums` | newest row `OK`, checksum `verified`, manifest names this database, no `MISSING` day you care about | `UNVERIFIED` = no sidecar (pre-#1004 dump: restorable, identity unproven); `INVALID` = the sidecar contradicts the bytes |
| P8 | The restore proof is recorded, not remembered | `node scripts/ops-preflight.mjs --record-restore --artifact <name> --tables <n> --patients <n>` | `restore.evidence` = PASS, naming the artifact | it stays UNKNOWN and blocks `READY`. A recorder that will not invent the artifact name is the point |
| P9 | Migration ledger matches the database | `docker compose run --rm --no-deps schema-verify node scripts/audit-migration-ledger.mjs --json=output/ledger-audit-$(date +%F).json` | no `RECORDED_BUT_ABSENT`, `CRITICAL_TABLE_MISSING`, `CRITICAL_COLUMN_MISSING` | this is the audit that finds a migration the ledger recorded and Postgres never finished — #955 prevents it, nothing undoes it |
| P10 | No patient data is deleted by what is merging | `grep -lnE "^\s*(DELETE\|TRUNCATE\|DROP TABLE\|DROP SCHEMA)" migrations/*.sql` | the matches are known and reviewed | a new destructive file is a stop, not a discussion |
| P11 | HOPE's *deployed* build refuses what it cannot interpret | the probe in §4 of the compatibility doc, then `node scripts/ops-preflight.mjs --record-hope-probe --refused` | `hope.receiver_version` = PASS with a dated record | `--not-refused` keeps it failing, which is correct: CARE records deliveries HOPE discarded |
| P12 | What to go back to is written down | `docker inspect --format '{{.Image}}' care-api care-web > /volume1/docker/backups/images-$(date +%F).txt` | the file exists and is non-empty | the app images are **built**, so `:latest` is replaced on the next deploy and the old image ID is the only way back without a rebuild |
| P13 | Orthanc is reachable **if** radiology depends on it | the `node`-based `/system` probe in `CARE_ERP_PREDEPLOYMENT_GATE.md` §C | JSON with the version | `care-api` ships no `wget`. `care-pacs` is a different compose project on its own bridge, so container DNS will not resolve across it |

**Orthanc/DICOM image backup is not a prerequisite and not a defect here.** It is excluded from
ERP disaster recovery by owner decision. PACS *connectivity* is in scope (P13); image
replication, restore, scheduling and freshness are not.

---

## 2. DEPLOYMENT

1. `bash deploy-synology.sh` from `/volume1/docker/care-erp-github/care-on-synology1`. It
   fetches and hard-resets `origin/main`, stamps the build into `.env`, refuses weak secrets,
   runs `down --remove-orphans` (**never** add `-v`; `db_data` is the external
   `care_main_db_data` holding real patients), then `up -d --build`.
2. Watch the sequence; do not intervene: `care-db` healthy → `care-db-patch-v2` exits 0 →
   `care-schema-verify` exits 0 → `care-api` → `care-web`. The API **cannot** start unless both
   migration and verification exited 0.
3. The script's own gates are live now: a migration timeout is a failure, and the health gate
   must pass before the banner prints. If it says `Deployment NOT verified`, that is the state,
   not a warning to scroll past.
4. **Never run `docker volume prune` on this box**, and never `git clean` a deploy directory:
   untracked `.env` backups and live TLS keys sit there.

## 3. POST-DEPLOYMENT

| # | Check | Command | Evidence |
|---|---|---|---|
| D1 | Container states | `docker ps --format '{{.Names}}\t{{.Status}}'` | `care-db`, `care-api`, `care-web`, `care-redis` `healthy`/`Up`; `care-db-patch-v2`, `care-schema-verify` `Exited (0)` |
| D2 | The endpoint gate, on the published port | `node scripts/deploy-health.mjs --host-port "${HOST_PORT:-8888}" --docker-prefix sudo` | exit 0. It checks the **bodies** of `/nginx-health`, `/api/healthz`, `/api/health/schema`, because an unknown path on `care-web` answers `index.html` at HTTP 200 |
| D3 | The deployed code is the reviewed code | `curl -fsS http://localhost:"${HOST_PORT:-8888}"/api/system/version` | the SHA from P5. A version stamp has lied before: cross-check the checkout's `git HEAD` and, for schema questions, the database |
| D4 | Migrations actually ran | `docker inspect --format='{{.State.Status}} {{.State.ExitCode}}' care-db-patch-v2` and `docker logs care-db-patch-v2 --tail 60` | `exited 0` and the log names each file applied |
| D5 | No drift was papered over | `sed -n '1,40p' STARTUP_SCHEMA_VERIFICATION.md` | know the limit: `SCHEMA_VERIFY_STRICT` defaults to `false`, so drift is **reported, not blocked** — D-none of this replaces P9 |
| D6 | Reliability metrics are live, not decorative | Admin → **Operations Cockpit** (`routes/index.ts:469`: `requireStaffAuth` + `requireAdminRole`, so it is a staff session in a browser — an `INTERNAL_API_KEY` curl will not reach it) | the System-health card shows dead-letter count, oldest unsent event and last recorded backup age. **"Not measured" is a red row, not an empty one** — a backup that has never been recorded must not read as "0 h" |
| D6b | The surface is actually enabled, and something is driving it | Admin → Feature Flags → `ff_ops_cockpit`; `docker logs care-api --timestamps 2>&1 \| grep "Ops anomaly scan" \| tail -3` | on, and the log shows a scan within the last hour. The scheduler runs it every 30 min (`cron.ts:1337-1349`) **inside the API process**, so it no-ops when `ENABLE_SCHEDULERS` is off — which is exactly the standby configuration. On a box without schedulers, "Run scan" is a human button, and an unpressed button produces no alerts rather than good news |
| D7 | Owner smoke | log in → Operational Health → `/radiology/usg-demo` | the checklist in `CARE_ERP_MASTER_HANDOVER.md`, plus a real bill and a real report print |
| D8 | Record what you deployed | `echo "<sha>" > .git-deployed` | the next P5 diff is measured from it |

## 4. ROLLBACK

Migrations are **forward-only**. There is no data rollback, and an older app runs against a newer
schema because migrations only add.

1. Read P12: the image IDs you saved. `docker compose up -d --build` replaces `:latest`, so
   without them a rollback means a rebuild.
2. `git reset --hard <previous-sha>` on `main`, then `docker compose up -d --build`.
3. To neutralise one migration: **remove its `migrations/*.sql` file** (a removed file never
   touches the database) and write a compensating additive one. Never edit an applied migration —
   the ledger records its `sha256`, and an edited file is refused rather than silently re-run.
4. For data corruption, restore: `scripts/verify-backup-restore.sh` to prove the artifact, then
   `scripts/synology-restore.sh <artifact>` (it decrypts, sniffs the gzip magic, and checks the
   schema in the right order — the reason it exists is that scheduler-written `.sql.enc` files
   are **not** gzipped and the old unconditional `gunzip -c` killed them).
5. Re-run D2 and D3. A rollback that was not verified is a second deploy.
6. Record it: `node scripts/ops-preflight.mjs --record-rollback --previous-commit <sha> --api-image <id> --web-image <id> --irreversible-migrations <list-or-empty>`.

---

## 5. The register

**The authoritative register is `docs/CARE_ERP_PREDEPLOYMENT_GATE.md` Part 2 — CL-1 … CL-10,
which carry live NAS measurements** (read from the box on 2026-10-13: the ledger's 206/17/19
disagreement, `backup_verification` at 0 rows with 1,272 artifacts, the HOPE callback that times
out from inside `care-api`, `ff_hope_care_referrals` switched on at the last deploy, ports
published on `0.0.0.0`). Do not maintain a second copy of those rows here; read them there, and
update them there when an item closes.

I12 adds six items, continuing the numbering rather than reusing it. None of them was measured
on the box — each says what this repository can prove and what still needs the operator.

| ID | Item | State from this repository | What it blocks |
|---|---|---|---|
| CL-11 | Uploaded documents and frozen key-image pixels are in no backup (`CARE_ERP_BACKUP_COVERAGE.md` §3–§4; `docker-compose.yml:418-422` states the insufficiency itself) | **NOT COVERED** — P1 | any claim that restoring the database returns the clinic to its previous state. A standby built from a dump reproduces the gap |
| CL-12 | `audit_logs` past retention are archived to `/app/data/archives` — a path on no volume — and then deleted | **active loss while the app runs** — P1 | the archive's existence. This is deletion by design, so it needs a decision, not a fix-up |
| CL-13 | The live `.env` and `BACKUP_PASSPHRASE` are in no backup, and `candidatePassphrases()` tries only `BACKUP_PASSPHRASE` and the current `SESSION_SECRET` (`backupCrypto.ts:71`) | **NOT COVERED** — P1, and it compounds CL-2: lose the `.env` and the encrypted dumps it protects become undecryptable | recovery from any `.enc` artifact |
| CL-14 | The standby role conflict: `docs/DS225_EMERGENCY_BILLING_ARCHITECTURE.md` forbids cloning the monorepo onto the DS225+, while the DR plan told it to do exactly that | **owner decision** (`CARE_ERP_SECOND_NAS_DISASTER_RECOVERY.md` PART 0b) | calling any box "the rehearsed standby" |
| CL-15 | Electronic films have no delivery path on either side; HOPE now refuses the type instead of acknowledging it | open **by design**, and visible for the first time (CL-6's counterpart, `07_EVENT_COMPATIBILITY_VERIFICATION.md` §9) | any statement that films reach HOPE. Not a deploy gate |
| CL-16 | The recovery binder kept runnable copies of `deploy-synology.sh`, `docker-compose.yml` and `Dockerfile` labelled "Active" | **CLOSED by this round**: replaced with retired pointers, and `deploy.config_single_source` fails the gate if an un-retired copy reappears | nothing, as long as the gate is run |

Anything not on either list is not a known blocker. Anything listed as UNKNOWN is a question for
the box, not a defect to code around — and CL-1/CL-2 in the authoritative register are exactly
that kind of question, which is why `ops-preflight` answers `INSUFFICIENT_EVIDENCE` rather than
`READY`.

---

## 6. What this checklist cannot tell you

It can only check what a repository can see. The following are never derivable from code, and a
tool that prints PASS for them would be lying: whether a DSM job exists, whether an image was
built and pushed, whether the deployed container runs this commit, whether a human rehearsed a
restore, whether HOPE's build answers 422 or 200, and whether the standby box can build at all.
Each item above names the command that asks the box — and the record that keeps the answer from
evaporating with the person who asked.

Three limits of this document specifically:

* **The cockpit metrics are merged, not deployed, and not rendered.** They are gated behind
  `ff_ops_cockpit`: with the flag off the router answers 503 and `runOpsAnomalyScan` returns
  `{ skipped: "disabled" }`, so an empty alert list is not a clean bill of health (D6b). The
  readings come from `integration_outbox` and `backup_logs`, and a `backup_logs` success is the
  app's own claim, not a restore proof — `ops-backup-inventory` is the artifact-level truth. And
  no browser has displayed the new rows yet.
* **Orthanc/DICOM is excluded by owner decision** (I12 §2). Its absence from every table here is a
  scope statement, not an open defect; PACS *connectivity* is in scope and appears at P13.
* **Nothing in the readiness checklist has been executed against the clinic**, so this document
  cannot state that the clinic is ready or not ready. `node scripts/ops-preflight.mjs`, run on the
  box, can — including the answer nobody wants: `INSUFFICIENT_EVIDENCE`.
