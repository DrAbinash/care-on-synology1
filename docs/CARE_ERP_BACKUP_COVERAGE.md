# CARE ERP — Backup Coverage Matrix (I12-C)

_What the clinic's data actually is, where each part physically lives, and whether
anything in this repository protects it. Every cell cites the file and line that
makes it true, or says plainly that there is no evidence._

**Status of this document: LOCAL.** Measured against the repository at
`3f044107` (2026-10-14). Nothing here was executed against the clinic box, and no
row is a claim about what the NAS is doing tonight — see
[What this matrix cannot say](#what-this-matrix-cannot-say).

**Orthanc/DICOM is out of scope by owner decision.** I12 §2 excludes Orthanc image
backup, replication, restore, scheduling and freshness alerting from ERP disaster
recovery. This matrix therefore does not list the DICOM store as a gap, does not
recommend replicating it, and does not treat its absence as an open defect. It does
keep the two things that are *not* the DICOM store but are frequently confused with
it: frozen key-image pixels and modality-worklist files (§4, §5).

---

## The one sentence this whole document exists to correct

`docs/CARE_ERP_BACKUP_RESTORE.md:3` states that everything patient-, report- and
billing-related lives in one PostgreSQL database, so backing that up backs up
everything.

That premise is load-bearing and **wrong for four classes of data**, each of which
the repository itself contradicts:

| the claim | the counter-evidence |
|---|---|
| uploads are in the DB | `docker-compose.yml:418-422` — "**DB backup alone is NOT sufficient** for frozen key-image evidence — include this volume in backup/restore" |
| the same, again | `artifacts/api-server/src/lib/frozenKeyImages.ts:6-13` — "DB backup alone is insufficient for Phase 1 evidence" |
| audit history is retained | `artifacts/api-server/src/cron.ts:912` deletes `audit_logs` rows after archiving them to a path that is on no volume (see §9) |
| object storage is backed up | `lib/objectStorage.ts:12` is the Replit GCS sidecar client, not local disk; `OBJECT_STORAGE_DIR` has no writer found anywhere in `artifacts/api-server/src` |

The consequence is concrete: **a successful `pg_dump` of this clinic does not
contain an invoice attachment, a referral document, a frozen key image, or the
audit trail older than two years.** Those are exactly the records a dispute or an
inspection asks for.

---

## How to read the columns

* **CURRENT BACKUP METHOD** — the mechanism that exists *in this repository*, named
  by file. "None found" means no evidence was found after searching for
  `pg_dump`, `tar`, `rsync`, `cp -r`, `docker run --volumes-from`, `restic`, `borg`,
  and every `scripts/*backup*` — not that the owner has not configured something
  outside the repo (a DSM Hyper Backup task would not appear here; see
  [What this matrix cannot say](#what-this-matrix-cannot-say)).
* **INTEGRITY CHECK** — does anything prove the artifact is a restorable copy of
  *this* database rather than a file that exists?
* **RESTORE EVIDENCE** — has a restore of this class ever been *proved* by a tool
  in this repository. `NONE IN REPO` is a statement about evidence, not a claim that
  the data is unrecoverable.
* **STATUS** — `COVERED`, `PARTIAL`, `NOT COVERED`, `NOT APPLICABLE`.

---

## 1. The database

| | |
|---|---|
| Dataset | All patient, billing, accounting, radiology-report, HOPE-integration and operational state held in PostgreSQL |
| Storage location | `care-db` → `/var/lib/postgresql/data` (`docker-compose.yml:86`); volume `db_data`, declared `external: true, name: care_main_db_data` (`docker-compose.yml:645-647`). This is the clinic's real patient database, not a copy |
| Current backup method | `scripts/synology-nas-backup.sh:79-81` — `docker exec care-db pg_dump --no-owner --no-privileges --clean --if-exists \| gzip`, staged to `*.partial` then renamed. In-app alternative: `artifacts/api-server/src/cron.ts:690` `exportDatabaseSql()`, destination `cron.ts:727-729` onto the host bind at `docker-compose.yml:445` |
| Frequency | Daily by schedule; the job itself is documented in `SOP/RECOVERY/12_BACKUPS/BACKUP.md:15-18`. **The schedule lives in DSM Task Scheduler, outside this repository** — see the caveat section |
| Retention | `scripts/synology-nas-backup.sh:173-195`: `RETENTION_DAYS` (default 14) with a `KEEP_MIN_COPIES=2` floor, and the delete list is computed and *shown* before removal. In-app jobs: `cron.ts:758-775`, `retentionDays` default 30 |
| Integrity check | `scripts/synology-nas-backup.sh:90-112` refuses an empty gzip, a missing banner, a missing `CREATE TABLE` and a missing completion trailer; writes a `.meta` sidecar (`:158-171`) whose `source_database` the gate now compares against `DB_NAME` (#1008). `pnpm ops:preflight` → `backup.metadata`, `backup.freshness`, `backup.artifacts_present` |
| Restore evidence | `scripts/verify-backup-restore.sh` restores the real artifact into a throwaway container with `ON_ERROR_STOP=1`, refuses a data-only dump, checks the sidecar's database and checksum, and fails when `patients`/`bills` restore empty. **Rows in `backup_verification`: 0 on the clinic box as measured 2026-10-13 — so the correct value for this cell today is NOT PROVEN** |
| Status | **COVERED** for the dump path. **NOT PROVEN** for restorability |
| How it is still lost | `docker compose down -v`, `docker volume rm care_main_db_data`, or `docker volume prune` on this box — `db_data` is `external` but not immune. Guarded by prose only (`docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md:186`), and the loss is total if the dump destination is on the same volume set |

## 1a. What is actually on the clinic box — measured read-only 2026-10-15

Everything above describes what the repository *defines*. This section is what the
DS1522+ *holds*, listed as the `abinash` SSH account with no sudo: file names, sizes
and dates only, no contents read, nothing written, nothing deleted. It changes the
reading of the table above, which is why it is here rather than in a footnote.

| Destination | Measured |
|---|---|
| `/volume1/backup/care-erp/db` | **The live CARE destination.** 1277 files, every one named `backup_DB_<YYYY-MM-DDTHH-MM-SS-mmmZ>.sql.enc`. Newest `backup_DB_2026-10-15T09-31-02-967Z.sql.enc`, oldest 2026-09-15 → about **hourly**, ~30-day retention, and **two files within the same hour** (e.g. `…T08-30-13-062Z` and `…T08-31-32-149Z`), which is roughly double the storage a single job would need. Sizes grew from ~425 MB (15 Sep) to ~818 MB (15 Oct). `owner root:root`, mode `644`. **Zero `.meta` sidecars** |
| `/volume1/docker/backups/postgres/care` | 62 files `care_erp_<YYYY-MM-DD>_<HH-MM>.dump`, and **20 of them are 0 bytes — including six consecutive nights, 2026-10-10 through 2026-10-15.** `owner abinash:users`, mode `777`. The job exits, the file appears with today's name, and there is nothing in it |
| `/volume1/docker/backups/postgres/hope` | 62 files `hope_erp_…dump`, 2 zero-byte. HOPE's database, not CARE's — and not this gate's job |
| `/volume1/docker/backups/{auto-db,config,db}` | Stale hourly sets, last write 2026-08-26T18:30 (111 / 635 / 1270 files). These are the predecessors of the live `care-erp/db` destination |
| `/volume1/docker/backups/posgres/` | A misspelled second tree holding `redis`, `synoscheduler` and an empty `care` |

Three consequences, stated plainly:

1. **`synology-nas-backup.sh` is not what runs on this box.** No `caredeoghar_*`
   artifact exists in any destination above. The script, the `.meta` sidecar it writes,
   and every integrity claim that depends on that sidecar describe a job that is not
   producing the files the clinic actually has. The live writer produces
   `backup_DB_*.sql.enc` with no sidecar at all, so `backup.metadata` reports UNKNOWN
   about the newest real artifact — correctly, and that UNKNOWN is now documented here
   instead of being argued away.
2. **A zero-byte artifact used to count as a backup.** `backup.artifacts_present`
   passed on any file it recognised, and freshness was dated from the newest file's
   mtime whatever its size — so the six empty nights above read as a healthy week of
   backups. Now: an empty artifact is `INVALID` in
   `node scripts/ops-backup-inventory.mjs`, is excluded from the coverage span, and
   in the gate the newest **non-empty** artifact is what freshness is measured
   against, with the empty newer file named in the same line. A directory in which
   every artifact is empty is `FAIL`.
3. **The dates came from mtimes because no parser understood the names.** The live
   files carry ISO dates (`2026-10-15T09-31-02-967Z`); the old parser matched only a
   run of eight digits, so it fitted just the `caredeoghar_20261015_023000`
   convention this box does not use. The inventory now reads ISO and compact names
   alike, validates them against the real calendar (`2026-02-30` is not a day), and
   prints which source answered — `sidecar=N, name=N, mtime=N` — because an
   mtime-dated tree describes when files were copied, not when they were taken.

Not changed here, and left as owner decisions: which job should own the CARE dump,
whether the duplicate hourly writer is stopped (it doubles ~800 MB every hour it
runs), whether `.enc` artifacts get sidecars, and what the retention target is.
Nothing above was deleted, moved or replaced.

## 2. Signed and finalized reports

Two different things wear the same name; they have different coverage.

### 2a. Report content (the words a radiologist signed)

| | |
|---|---|
| Storage location | `patient_reports`, `radiology_report_drafts.structured_json` / `structured_json_d1` (`lib/db/src/schema/radiologyReportGenerator.ts:42,50`) — inside `db_data` |
| Current backup method | In the `pg_dump` above |
| Integrity / restore evidence | Same as §1 |
| Status | **COVERED** |
| Note | The signed *content* is the clinical record, and it is in the database. A reprint also needs the frozen pixels in §4, which is where the coverage claim breaks |

### 2b. Rendered PDF bytes

| | |
|---|---|
| Storage location | **No durable file exists.** PDFs are rendered on demand into a Buffer (`artifacts/api-server/src/lib/htmlToPdf.ts:15-27`, headless Chromium) by `routes/patient-reports.ts:3516,3564` and served as a URL (`:2705,2785`); `routes/whatsappDelivery.ts:513` stores only the URL string |
| Current backup method | Not applicable to the ERP dump. The one durable copy of a finalized PDF is archived into Orthanc at `REPORT_FINAL` (`lib/pacsArchive.ts:225`, tracked by `radiology_pacs_archive_revisions`) — **owner-excluded from ERP DR scope** |
| Consequence | A PDF is reproducible from the database plus the deployed rendering code, so losing bytes is not losing the record — **except** when the report's frozen images (§4) are gone, when the re-render is silently a different document |
| Status | **NOT APPLICABLE as a backup target**; listed so nobody reads the absence of a PDF store as a defect |
| Evidence gap | `/app/data/reports` appears in the backup folder list (`lib/backupHealth.ts:38`) but **no writer was found anywhere in `artifacts/api-server/src`**. It is a phantom entry: a backup of that folder today copies nothing, and its presence makes a files backup look broader than it is |

## 3. Uploaded documents

| | |
|---|---|
| Dataset | Referral and prescription scans, patient documents, invoice/receipt images, expense attachments, queue-display and site assets |
| Storage location | `/app/data/uploads/**` on named volume `uploads_data` (`docker-compose.yml:423,649`). Writers: `routes/uploads.ts:19,116` (modules `reports`, `patient_documents`, `billing`, `site_assets`), `lib/expenseAttachments.ts:21-22`, `routes/scans.ts:25,116-126`, `routes/scan-sessions.ts:14,40`, `routes/radiology-report-attachments.ts:65`, `routes/website.ts:578,630`, `routes/queueDisplaySettings.ts:578,605`; served back by `app.ts:348` |
| Current backup method | **Nothing scheduled.** `scripts/synology-uploads-archive.sh` now writes this volume with a manifest and a sidecar, in the same envelope as the database dump — but no DSM task, cron entry or scheduler in this repository runs it, so until someone installs it the coverage is a script in a git tree. The only code that used to be able to capture it is `exportFilesZip()` (`routes/backupReplication.ts:418-454`) over `lib/backupHealth.ts:34-43`, reachable **only** from admin HTTP routes (`:713-722`, `:837`, `:875`), never from the scheduler — and its output goes to `TEMP_BACKUP_DIR = /tmp/care-diagnostics-backups` (`:24`), which is in the container's ephemeral layer and is deleted after 24 h (`:25,64-78`) |
| Frequency | Never, unless a person ran the script. `pnpm ops:uploads-backup` does not exist and no schedule names it |
| Retention | No automated deletion of uploaded bytes; `routes/uploads.ts:211-213` is a **soft** delete (record only, bytes remain). The archive's own retention is OFF unless `KEEP_DAYS` is a positive integer **and** `DELETE_OLD=1` |
| Integrity check | Per-file SHA-256 in `MANIFEST.sha256` stored **inside** the archive, hashed into the `.meta` sidecar (`manifest_sha256`, `manifest_files`, `manifest_bytes`, `manifest_empty_dirs`); the artifact's own digest is `sha256_artifact`. `scripts/verify-uploads-restore.mjs` recomputes all of it rather than trusting what was recorded |
| Restore evidence | **None yet.** `scripts/verify-uploads-restore.mjs` extracts into a throwaway directory it made itself and re-hashes every file, and reports four states separately — ARCHIVE FOUND, STRUCTURALLY VALID, ENCRYPTION VERIFIED, RESTORE VERIFIED. An operator has to run it; nothing runs it for them, and a `verified` state is only ever produced by a run that actually decrypted and re-hashed the bytes |
| Status | **NOT COVERED ON THE CLINIC BOX** — a writer and a prover exist in code; no artifact of this class has ever been written by the clinic |
| How it is lost | Loss of `…_uploads_data` under `/volume1/@docker/volumes/`, `down -v`, or `volume prune`. Silent: the ERP keeps working, the documents are just gone |

## 3a. What "the uploads are backed up" has to mean before it may be said

The database matrix learned this the hard way, and the document volumes are being held to
the same standard from the first day. Four separate facts, and none of them is the next:

| State | What it proves | Who says it |
|---|---|---|
| **ARCHIVE FOUND** | the bytes are on disk and match the digest in their own sidecar | `verify-uploads-restore.mjs`, recomputing the hash |
| **STRUCTURALLY VALID** | it is a gzip tarball whose members a restore can represent — no traversal path, no absolute or drive-qualified name, no symlink, hard-link, device or FIFO member, no repeated path, and a manifest inside it | the same run, before anything is extracted |
| **ENCRYPTION VERIFIED** | THIS run decrypted it with the passphrase it was given. A sidecar that says `encrypted=yes` proves nothing about restorability | the same run |
| **RESTORE VERIFIED** | every file was re-hashed against the manifest carried inside the archive, and nothing the manifest does not account for appeared | the same run |

A state is written as `verified` only when the process produced the evidence for it. A
digest recorded by the backup job is reported as recorded, never as verified. The verb the
clinic used before this existed — "the backup is fine" — was reading the first state and
answering the fourth.

Read-only, in the order an operator would use it:

```sh
# 1. write an archive of the volume (this is the only step that touches the volume, and it
#    only reads it):
sh scripts/synology-uploads-archive.sh --class uploads \
     --src /volume1/@docker/volumes/care-erp-github_uploads_data/_data \
     --dest /volume1/backup/care-erp/uploads
# 2. prove it restores, into a directory the tool makes and deletes:
BACKUP_PASSPHRASE="$(cat /volume1/scripts/.pass)" \
  node scripts/verify-uploads-restore.mjs /volume1/backup/care-erp/uploads/backup_uploads_<ts>.tar.gz.enc
# 3. ask what the backup roots hold, class by class:
node scripts/ops-backup-inventory.mjs
```

Step 2 is a drill, not the restore. Putting documents back on the clinic box is a
`tar -xpf` into the volume's host path with the API stopped, which is an owner-approved
incident action and is deliberately not something this tool can do to a live volume.

## 4. Frozen key images — the highest-value gap

| | |
|---|---|
| Dataset | The pixels frozen into a finalized report as printed evidence |
| Storage location | `/app/data/uploads/radiology-key-images` (`lib/frozenKeyImages.ts:33`) on `uploads_data` (`docker-compose.yml:423`), written by `routes/radiology-report-generator.ts:3768-3774` from Orthanc at print quality (`:3751-3757`). The DB holds only rows and references (`radiology_report_key_images`, `radiology_image_references` — `schema/radiologyReportGenerator.ts:153-155,198-202`), never the image |
| Current backup method | **None.** Not in `pg_dump` (bytes are not in the DB), not in any script, and the two files that describe the requirement say so in as many words (`docker-compose.yml:421-422`, `lib/frozenKeyImages.ts:6-13`) |
| Frequency / retention | n/a / orphan cleanup only (`lib/frozenKeyImages.ts:120-135`) |
| Integrity check | None |
| Restore evidence | None |
| Status | **NOT COVERED — P1** |
| How it fails | Not loudly. `lib/frozenKeyImages.ts:46-54` substitutes `FROZEN_UNAVAILABLE_PLACEHOLDER_SRC`, so a finalized report reprints **with the evidence replaced by a placeholder** and the document still prints, still looks signed, and still downloads. A clinic cannot tell from the reprint that the image is gone |

This is the single row a radiology clinic should care about most: the report that
was signed is no longer the report that is reproduced, and the only durable copy of
what the radiologist attached is on the one volume nothing backs up.

## 5. CARE-produced DICOM-adjacent files (not the DICOM store)

| | |
|---|---|
| Dataset | Modality Worklist files generated by CARE (`dump2dcm` output), plus its quarantine |
| Storage location | Host bind mounts, not named volumes: `${ORTHANC_WORKLIST_HOST_DIR:-/volume1/docker/care-pacs/orthanc/worklists}` (`docker-compose.yml:453-454`), quarantine read-only at `:457`; live value `deploy/synology/care.env:83`. Writers `lib/pacs/mwlWorklistWriter.ts:250-263,347`, staging on the same mount (`:112-128`) |
| Current backup method | None found for `/volume1/docker/care-pacs/**` |
| Status | **NOT COVERED — LOW.** Regenerable by re-synchronising the worklist, so it is a service-interruption risk rather than a data-loss risk |
| Deliberately not listed | The Orthanc DICOM store itself, its replication, restore and scheduling — **out of scope by owner decision (I12 §2)**. No electronic-film export feature was found in this repository at all, so there is no CARE-produced e-film artifact to cover |

## 6. Configuration and secrets

| | |
|---|---|
| Dataset | The live `.env`, the HOPE/CARE integration secrets, `docker-compose.yml`, `Dockerfile`, migrations, SOP binder |
| Storage location | `.env` in the deployment directory, **not in git** (`.gitignore:52`). `docker-compose.yml`, `Dockerfile`, `migrations/**`, `SOP/**`, `deploy/synology/*.env` templates are tracked |
| Current backup method | Git remote is the backup for the tracked half. For the live `.env`: **none** — and the open item is recorded in the repo's own remediation plan (`docs/audits/care-erp-master-remediation-plan-2026-09-30.md:198`) |
| Status | **NOT COVERED — P1, and it is worse than it looks** |
| Why it compounds | `BACKUP_PASSPHRASE` and the current `SESSION_SECRET` are the *only* candidates the restore path will try (`artifacts/api-server/src/lib/backupCrypto.ts:71` `candidatePassphrases()`; `docker-compose.yml:302-306` is the comment that records the rotation trap); there is no slot for a previous value. Lose the `.env` and every older **encrypted** dump becomes undecryptable. So the unprotected config item is the key to the protected data item |
| Second compounding | `docs/CARE_ERP_PREDEPLOYMENT_GATE.md:144-145` records that the live `BACKUP_HOST_DIR` differs from the compose default `:445`. That variable selects the bind mount the scheduler writes into; drift there sends future backups to a path nothing reads, while the app keeps reporting success |

## 7. HOPE integration state

| | |
|---|---|
| Dataset | `integration_outbox` (`schema/integrationOutbox.ts:18`), `integration_delivery_attempts` (`:46`), `external_result_links` (`schema/externalResultLinks.ts:15`), `integration_partners` + `integration_partner_audit_log` (`schema/integrationPartners.ts:18,52`), `hl7_integration_settings` (`schema/hl7Schema.ts:9`) |
| Current backup method | In the `pg_dump` (§1) |
| Status | **COVERED** |
| Caveat that matters | Covering the *rows* does not cover the *delivery*. An outbox row restored from a backup is a row that HOPE may already have received; the idempotency keys and the fencing added in #995-#998 are what make a replay safe. Restoring an old database therefore replays old events — which is why the restore runbook insists on the recorded proof (§1) rather than a file count |

## 8. WhatsApp / messaging outbox

| | |
|---|---|
| Dataset | `wa_outbox`, `wa_delivery_attempts` (`schema/whatsappOutbox.ts:15,59`), `wa_delivery_queue`, `wa_delivery_audit` (`schema/whatsappDelivery.ts:8,33`), plus conversation/template/audit tables (`schema/whatsapp.ts:14-107`) |
| Current backup method | In the `pg_dump` (§1) |
| Status | **COVERED** |
| Evidence gap | No WhatsApp **media** write path was found, so there is nothing to cover beyond the tables. If media is ever written to disk it inherits §3's gap and must be added to this row |

## 9. Operational and audit records the clinic cannot reconstruct

| Dataset | Location | Backup | Status |
|---|---|---|---|
| Observation ledger | `radiology_report_drafts.structured_json(_d1)` (`schema/radiologyReportGenerator.ts:42,50,170-171`) | `pg_dump` | **COVERED** |
| Billing, payments, ledgers, vouchers, purchase invoices | `bills`, `payments`, `ledgers`, `bill_audits`, `voucher_audits`, `purchase_invoices*` | `pg_dump`; `verify-backup-restore.sh` fails on an empty `bills` restore | **COVERED** |
| Day close, drawer audit | `day_closures`, `user_day_closures`, `drawer_audit_log` | `pg_dump` | **COVERED** |
| Migration ledger | `schema_migrations_log` (`docker/db-patch-entrypoint.sh:223,370,444`) | `pg_dump` | **COVERED** — and its loss is what re-migration drift (`migrations/zz_schema_reconcile_20260709.sql:6`) was written to repair |
| Restore/ops evidence | `backup_verification` (`schema/risMonitoring.ts:75-76`), `radiology_ops_checks` (`schema/radiologyOps.ts:92-93`) | `pg_dump` | **COVERED** as rows |
| **`audit_logs` older than 730 days** | rows deleted at `cron.ts:912`; the archive is written to `path.join(process.cwd(), "data", "archives", "audit-logs")` at `cron.ts:877` as `.json.gz` + `.sha256` (`:907-909`) | **NOT COVERED — P1** |

The last row is the finding of this survey, and it is not a missing backup — it is
**an automated, scheduled deletion whose destination is not persisted**:

* `/app/data/archives` is on **no volume**. `docker-compose.yml` mounts only
  `object_storage:/app/data/object-storage` (`:417`) and `uploads_data:/app/data/
  uploads` (`:423`). Everything else under `/app` is the image layer.
* `archives` is **not** in the files-backup folder list (`lib/backupHealth.ts:34-43`
  covers `uploads`, `reports`, `object-storage`, `attached_assets`).
* The cron expression is `0 3 * * *` (`cron.ts:866`), registered from
  `startCronScheduler()` (`:66`), which runs only when `ENABLE_SCHEDULERS=1|true`
  (`index.ts:2884`). `deploy/synology/care.env` sets `ENABLE_SCHEDULERS=1`, so on a
  box that follows the template this job **is** live.
* The deletion is correctly gated on the archive write succeeding ("Gate G2",
  `cron.ts:880-900`) — which it always does, because the container can write to its
  own layer. The archive then dies on the next `docker compose up --build`.

So the honest summary of the audit trail is: rows older than two years are removed
from `pg_dump`'s reach and written into a location that a routine rebuild erases.
Whether that has already happened at the clinic cannot be answered from this
repository — it needs the two read-only queries in
[Closing the gaps](#closing-the-gaps) run on the box.

## 10. Everything else written outside a volume or the database

| Path | What it is | Verdict |
|---|---|---|
| `/tmp/care-diagnostics-backups` (`routes/backupReplication.ts:24`) | every manual export and snapshot | ephemeral, purged at 24 h (`:25,64-78`) — **a manual backup that deletes itself** |
| `/app/data/reports` (`lib/backupHealth.ts:38`) | phantom; no writer found | remove or explain — it inflates what a files backup appears to cover |
| `/app/attached_assets` (`lib/backupHealth.ts:41`) | legacy path; directory absent in-tree, only a Vite build alias | always reported in `missingFolders` (`:429`) |
| `${BACKUP_HOST_DIR}:/volume1/docker/backups` (`docker-compose.yml:445`) | the scheduler's dump destination | host bind, covered by nothing but the dumps themselves; if `BACKUP_HOST_DIR` drifts, output goes where no reader looks |
| repo checkout (`schema-verify` writes to `/repo/output:rw`, `:200`) | startup MD in the git working tree | uncommitted local edits to the live checkout are invisible to `pg_dump` and to git |
| Redis (`:631`) | feature-flag/session/rate-limit cache | `--save "" --appendonly no`, no volume — **not applicable by design** |

---

## What this matrix cannot say

Three things are genuinely unknowable from a repository, and pretending otherwise
would repeat the mistake this round is fixing:

1. **Whether a DSM job exists.** Hyper Backup, Snapshot Replication and Task
   Scheduler configuration live in DSM, not in git. Nothing in this repository
   proves or disproves them. I12 §10 forbids assuming they are configured, so every
   Frequency cell above says what the *script* does, and the schedule is marked as
   external. `Antigravity/07_DEPLOYMENT/ERP_DEPLOYMENT_RUNBOOK.md:182-184` describes
   a Hyper Backup job for `/volume1/care-diagnostics/` — that path is a legacy
   non-Docker layout and **cannot see `object_storage`/`uploads_data`**, whose host
   location is under `/volume1/@docker/volumes/<project>_…_data`.
2. **Whether the scheduler is running on the clinic box.** Every in-app backup path
   is behind `ENABLE_SCHEDULERS` (`cron.ts:435`, `:530`, `:582`; gate
   `index.ts:2884`), and `BACKUP_TEMP_DIR`, `BACKUP_HOST_DIR` and `CARE_DATA_DIR`
   are set in neither `deploy/synology/care.env` nor `.env.example`. `pnpm
   ops:preflight` reports `schedulers.consistent` and says UNKNOWN when it cannot
   see the live environment — which is the correct answer from here.
3. **Whether anything has ever been restored.** That is `restore.evidence` in the
   gate, and it is UNKNOWN until `scripts/verify-backup-restore.sh` exits 0 on a
   real artifact and the result is recorded with `--record-restore`.

## Closing the gaps

Ordered by what a clinic loses, not by how hard the fix is. None of these is
implemented by this document; they are the P1 register for §18P.

| # | Gap | Smallest safe step | Owner decision needed |
|---|---|---|---|
| 1 | `audit_logs` >730 d deleted into a non-persisted path (§9) | Point the archive at a mounted location (a `data_archive` volume or the existing `uploads_data`), or stop deleting. Two read-only checks first: `docker exec care-api ls -la /app/data/archives/audit-logs` and `select min(created_at), count(*) from audit_logs` | Yes — this changes what the ERP retains and is a records-policy decision, not a bug fix |
| 2 | Frozen key images and all uploads have no backup *running* at all (§3, §4) | The writer and the prover are in the tree (`synology-uploads-archive.sh`, `verify-uploads-restore.mjs`) and read the volume from its host path — no Docker socket, no `--volumes-from`, no container dependency. What is left is one DSM Task Scheduler entry pointing at them, and one drill recorded. `radiology-key-images` lives inside `uploads_data`, so the same job covers §4 with no extra code | Yes — installing a schedule and choosing its retention window are the owner's, per I12 §10 |
| 3 | The live `.env` is unbacked, and losing `BACKUP_PASSPHRASE` makes old encrypted dumps unreadable (§6) | A protected copy of `.env` outside the volume set (DSM shared folder with restricted ACL, or the DS225+), created *before* the next rotation. Rotate `BACKUP_PASSPHRASE` only with both old and new retained for the decrypt window | Yes — rotation is the owner's, per I11-A |
| 4 | A scheduled `FULL` job is not a full backup | `cron.ts:654` routes `DB`, `FULL` and `CONFIG` to the same DB-only branch (`:690`); `exportFilesZip` is never imported by `cron.ts`. Either make `FULL` mean files too, or rename it so nobody relies on it. Until then, no row in this matrix may claim files coverage from a `FULL` job | No — but it is a behaviour change to a job the clinic may be counting on, so it needs a decision on which meaning is intended |
| 5 | Manual exports land in `/tmp` and self-delete in 24 h (§10) | Write them under `BACKUP_DIR` and give them a sidecar, or say plainly in the admin UI that a manual export is temporary | No |
| 6 | Restore has never been *proven* on this box (§1) | `bash scripts/verify-backup-restore.sh "$BACKUP_DIR"` then `node scripts/ops-preflight.mjs --record-restore …` | No — this is an action, not a change |
| 7 | `/app/data/reports` and `/app/attached_assets` are in the backup folder list but do not exist (§2b, §10) | Remove them, or create them on a volume and start writing to them. A folder list that includes phantom entries makes a files backup look broader than it is | No |

Row 2 and row 4 are the same trap seen from two sides: a backup that is named
`FULL`, or a folder list containing `uploads`, is evidence of *intent*, not of
coverage. This matrix records only what a file in this repository can prove.
