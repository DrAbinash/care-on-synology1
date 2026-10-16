# RIS/PACS Integration — Persistent Engineering TODO

**Purpose.** The single, Git-maintained tracker for radiology/PACS integration work on
`DrAbinash/care-on-synology1` (with `DrAbinash/care-pacs` where relevant). It exists so this work
survives context-window resets, session changes, agent handovers and machine restarts. **Read this
file before writing any code in this area, and update it before ending any session that touches it.**

**Do not** create a competing task list. Point-in-time audit reports live in `docs/audits/` and
`docs/CARE_ERP_OPEN_ISSUES.md`; those are records of past passes. This file is the live queue.

**Session start protocol:** 1) read this file; 2) `GET /repos/DrAbinash/care-on-synology1/pulls?state=all`
for the PRs named below; 3) `git fetch && git log origin/main -5`; 4) resume the first row that is
not `MERGED`/`DEPLOYED`/`VERIFIED` or explicitly `BLOCKED`; 5) do not restart a completed audit.

**Status vocabulary (deliberately not interchangeable):**

`TODO` → `INVESTIGATING` → `CONFIRMED` → `IMPLEMENTING` → `TESTING` → `PR OPEN` → `MERGED` →
`DEPLOYED` → `VERIFIED`, plus `BLOCKED` and `NOT REPRODUCED`.

- **MERGED is not DEPLOYED.** A merge to `main` changes nothing at the clinic until someone runs
  `scripts/deploy-synology.sh` on the NAS, which hard-resets to `origin/main` and rebuilds.
- **DEPLOYED is not CLINICALLY VERIFIED.** Verified means a real study, in the real workspace, on
  the deployed build, was observed behaving correctly.
- A task is never completed because a commit was written or because CI passed.

---

## Running status table

| ID | Task | Pri | Clinical risk | Status | Evidence | PR | CI | Merged | Deployed |
|---|---|---|---|---|---|---|---|---|---|
| RIS-001 | Primary examination must choose the report format | P1 | Wrong protocol document for the exam | MERGED | `2c9ec1db` | #1039 | green | yes | **no** |
| RIS-002 | Viewer must reset its state per study | P0 | Another patient's image on screen | MERGED | `c2b81046` | #1040 | green | yes | **no** |
| RIS-003 | Auto-link must not replace an APPROVED association | P0 | Wrong patient on a signed report | MERGED → verifying | `67fbf901` | #1041 | green | yes | **no** |
| RIS-004 | PACS archive report pick must be patient-scoped | P0 | Another patient's report in the image archive | MERGED | `2c8bdccd` | #1042 | green | yes | **no** |
| **RIS-005** | **Correct patient is not yet correct examination in the archive** | **P0** | **Right patient, wrong exam filed into the study series** | **INVESTIGATING** | mechanism read from code; Postgres proof pending | planned | — | no | no |
| **RIS-006** | **Null `patient_reports.study_id` ownership** | **P0** | **Report claimed onto a second exam of the same patient** | **INVESTIGATING** | `tmp/null-study-ownership-note.md` (untracked) | planned | — | no | no |
| RIS-007 | CT/DICOM pull: "success" without received instances | P1 | A study believed acquired but never arrived | CONFIRMED (code) / NOT REPRODUCIBLE live | `dimse-agent.ts:363`, `:488` | none yet | — | no | n/a |
| RIS-008 | Re-verify RIS-001's matrix after the merges on main | P1 | Regression in format selection | TODO | — | — | — | no | no |
| RIS-009 | Re-verify RIS-002 across Next / Previous / Park / deep link | P1 | Regression in viewer identity | TODO | — | — | — | no | no |
| RIS-010 | PACS archive transaction safety (races, double archive, amend-after-archive) | P1 | Duplicate or superseded report filed as current | TODO | — | — | — | no | no |
| RIS-011 | MWL reality per modality (MRI / CT / USG / X-ray) | P2 | Scans arrive unidentifiable | TODO | — | — | — | no | no |

**Deployment, all rows:** nothing above is deployed. Measured 2026-10-16 from the development
workstation: `192.168.1.137` answers ping in 7 ms, but `:8888` (care-web), `:8042` (Orthanc),
`:3010` (OHIF) and `:8080` (API) all refuse connections while `:80` returns 200. So the deployed
CARE stack is currently unreachable from here and **no deployment state can be confirmed**. The
clinic is rebuilding that deployment; until `deploy-synology.sh` is run against a known commit,
every row stays `MERGED`, not `DEPLOYED`.

---

## RIS-005 — correct patient is not yet correct examination (P0, active)

**In plain language.** PR #1042 stopped the PACS archive from filing *another patient's* report.
It did not yet prove the report belongs to the *right examination* of the right patient. If it is
wrong here, a radiologist could open a patient's PACS study and find the MRI Brain report sitting
inside the MRI LS Spine series — same name, same patient ID, wrong question answered.

**Mechanism read from `origin/main` (`artifacts/api-server/src/lib/pacsArchive.ts:49-78`).** The
candidate list is `[worklistRowId, billedStudyId]` matched against `patient_reports.study_id`.
Because that column holds a **worklist row id** on the canonical path and a **billed study id** on
the legacy path, a report keyed to patient A's LS-Spine worklist row is reachable when archiving
patient A's Brain study **if the two integers coincide** — which they do, because the two tables
count independently.

**Required invariant.** The archived report must belong to (A) the correct patient **and** (B) the
correct radiology examination.

**Planned correction — reuse, do not rebuild.** `patient_reports` already carries the examination's
order identity: the finalize path writes `orderTestId`, `orderId`, `billId` and `testId` from the
billed study (`routes/patient-reports.ts:2190-2195` structured path, `:2255-2258` create path), and
writes `radiology_worklist.reportId` as the authoritative back-link (`:2208`, `:2275`). So:

1. Prefer the worklist row's own `reportId` back-link — examination-specific, written by finalize,
   no integer-space inference at all.
2. Keep the canonical `study_id = worklistRow.id` spelling.
3. Keep the legacy `study_id = billedStudyId` spelling **only when the report's `billId`/`orderId`
   agrees with the billed study's**, which is what a coincidence cannot fake.
4. A report with `study_id IS NULL` stays unreachable (it already is, by `inArray`), and must not
   be widened into a patient-only match.
5. Ambiguity returns `null` — the existing safe failure path — never a guess.

No new identity module, no second report-ownership system, no schema change.

**Tests required (real PostgreSQL, not a mocked `db` — a mock that discards its `where` argument
cannot prove ownership; see the lesson recorded under RIS-004).** The ten cases named by the owner,
with the collision created by inserting the two rows at an explicitly shared integer id, which is
exactly the accident the production sequences produce:

1. Patient A, MRI Brain, correct report → archives.
2. Patient A, MRI LS Spine, correct report → archives.
3. Patient A, Brain study archived while the only reachable report is the LS Spine one → **refuse**.
4. Cross-patient integer collision → refuse (already covered by #1042's suite; must stay green).
5. Legacy report keyed by billed study id → still resolves.
6. Modern report keyed by worklist row id → still resolves.
7. Multiple reports/amendments → the established amendment contract decides the version
   (`buildReportArtifact` resolves the chain; `versionMode: "specific"` stays row-exact).
8. `study_id IS NULL` → never associated with an arbitrary examination.
9. No authoritative report → explicit safe failure, no guess.
10. Re-running the archive → no incorrectly-associated duplicate DICOM report.

**Remaining limitations after the fix.** A report whose `billId`/`orderId` are both null and whose
`study_id` is ambiguous cannot be attributed to an examination by any means available in the schema;
that case must refuse and be surfaced, not repaired by guessing.

---

## RIS-006 — null `study_id` report ownership (P0)

`assertReportBelongsToWorklist` (`lib/radiologyIdentity.ts:222-248`) skips its worklist check
entirely when `report.study_id IS NULL`, leaving patient equality alone — insufficient for a patient
with two studies. Note: `tmp/null-study-ownership-note.md` (untracked, this workstation) has the
call-site census: the two client-supplied entry points are `internal-radiology.ts:1362` (finalize's
`b.reportId`) and `composeIdentity.ts:239`; the other three resolve server-stored ids.

**First, read-only:** why `study_id` is null, which workflows create it, whether signed reports
depend on it, and whether order/bill/test identity is a stronger available linkage. Then either the
smallest correction in the shared pathway, or `BLOCKED` naming the exact missing evidence — the
production count of `patient_reports` rows with `study_id IS NULL AND status = 'final'`, which this
workstation cannot read. Never retro-assign study ids; never break legacy reports.

---

## RIS-003 — post-merge verification of the APPROVED-association guard (P0)

Merged as `67fbf901`. Verify on current `main`, without changing behaviour: the guard sits at the
single shared writer `applyWorklistStudyLink`, so all five entry points inherit it — accession lane,
name±referral lane, USG DICOM intake (`internal-radiology.ts:991`), worklist entry load (`:2013`),
Reporting Studio (`internal-reporting-studio.ts:804`) and the backfill script — and `preview` refuses
with the same reason as the run. Same-patient approvals must still link, or the clinic's ultrasound
billing backlog is stranded. Status moves to `VERIFIED` only with the clinic's own data observed;
until then `MERGED`.

---

## RIS-007 — pull "success" without received instances (P1)

Confirmed in code on `main`: `moveStudy()` resolves `ok: true` on `Status.Success` **without
consulting `completed`** (`artifacts/api-server/src/services/dicom-pull-agent/dimse-agent.ts:357-368`),
and a job whose C-FIND matched nothing is finished as `completed` (`:488-492`). Whether that
misrepresented an actual clinic study is **not reproducible from this workstation** (see the
deployment note above), so the cause of any specific missing study stays unverified: it may be
(1) no studies found, (2) Success with zero objects, (3) a UTC vs local study-date window (the job's `queryDateFrom`/`queryDateTo` are built from
`toISOString()`, so a clinic day starts 5:30 UTC-off — `routes/dicom.ts:265,271`), (4) missing
instance-count verification after the move, or (5) an absent telemetry route.

**Required behaviour, expressed with the existing job/event schema (no second status framework):**
`REQUEST ACCEPTED`, `STUDIES FOUND`, `TRANSFER STARTED`, `INSTANCES RECEIVED`, `TRANSFER VERIFIED`,
`NO MATCHES`, `PARTIAL TRANSFER`, `FAILED` must remain distinguishable to the operator. Instance
counts are already recorded in `dicom_events` (`"C-MOVE OK: … (N instances)"` plus
`rawPayload.completed`), so **the first action is a read-only count of Success-with-zero rows in the
clinic's own history**, not a code change. No indefinite automatic retry. No scanner configuration.
No production C-FIND/C-MOVE without explicit owner approval.

---

## RIS-008 / RIS-009 — regression protection after the merges (P1)

Re-run the existing suites on current `main` rather than re-deriving them:
`artifacts/diagnostic-erp/src/lib/studyRegion.test.ts` (RIS-001's matrix, including the billed-name
precedence and the modality-dispatch cases longest-wins exists for) and
`artifacts/diagnostic-erp/src/lib/viewerStudyScopedReset.contract.test.ts` plus the Chromium probe
described below (RIS-002). The ERP has no DOM test harness — no jsdom, no `@testing-library` — so
viewer behaviour is proven by mounting the shipped component in a scratch Vite page and stubbing
`/api/**` in Playwright; that is the route that produced #1040's evidence.

---

## RIS-010 — archive transaction safety (P1)

Questions to answer from the existing code before proposing anything: can two archive jobs race;
can the same report be archived twice; what happens when Orthanc accepts the object but the ERP
status update fails; what happens when the report is amended afterwards; can an unsigned draft enter
the archive; can a superseded report be mistaken for the current final one; are `StudyInstanceUID`
and accession preserved. Existing mechanisms to look for first: `radiology_pacs_archive_revisions`
(per-revision records with `onConflictDoUpdate`, added by BEND-1), `pacsArchiveStatus` /
`pacsInstanceId` on `radiology_studies`, and `buildReportArtifact`'s version resolution. If they
already cover a case, record it as `VERIFIED` rather than rebuilding it.

---

## RIS-011 — MWL reality per modality (P2)

For MRI, CT, USG and X-ray separately, and never conflating **NOT CONFIGURED / NOT SUPPORTED /
NOT TESTED / CONFIGURED BUT FAILING / WORKING**: is MWL configured, is the scanner actually querying
it, does the modality send an accession, is `StudyInstanceUID` stable, is PatientID/UHID transmitted,
is billing-to-DICOM identity reliable. Known starting facts: USG has no MWL at all (which is why the
bill-desk name±referral lane exists — `internal-radiology.ts:975-991`); MR/CT do receive MWL
accessions. Recommendations land here; this is not permission to rebuild MWL infrastructure.

---

## Standing constraints for anyone working this queue

Owner is a practising doctor, not a coder: explain the clinical consequence in plain language, and
never ask them to resolve an implementation detail that the code can answer. Audit first; reuse the
existing authoritative system; one purpose = one implementation; minimal corrections; regression test
each one; never touch production data during testing; no automatic deployment, merge, container
restart, image/volume deletion, PostgreSQL change, Orthanc data change or scanner setting change.
The AI Composer (generation, finding composition, Impression, Composer architecture) is assigned
separately — do not modify it. Patient/billing/DICOM matching generally works in the clinic: do not
redesign it, and do not treat historical match statistics as proof that the current code is broken.

**Clinical safety invariants these tasks exist to protect:** one DICOM study belongs to the correct
patient and examination; a manual Match Center approval cannot be silently replaced by automated
matching; one signed report cannot be archived under another patient's identity or another
examination merely because the patient is the same; ambiguous identity must fail safely; a signed
report must not be silently changed; a previous patient's images must not appear in another
patient's workspace; screening sequences must not change the primary examination's format; a DICOM
transfer is not successful merely because a request completed; no automated operation may substitute
a guessed identity for an approved one.

## Working-environment facts that cost the most time to rediscover

- Vitest and the API bundle need win32 native bindings that the pnpm store (populated on Linux) does
  not carry: drop `@rollup/rollup-win32-x64-msvc` and `@esbuild/win32-x64` into the worktree's
  `.pnpm/…`, and copy `lightningcss-win32-x64-msvc` / `@tailwindcss/oxide-win32-x64-msvc` from the
  main checkout. Without them `vitest run` dies inside `rollup/dist/native.js`.
- A scratch PostgreSQL 18 cluster on `127.0.0.1:5445` (never the operator's 5432, never the NAS) makes
  every `*.request.test.ts` runnable locally: `createdb` + `ALTER DATABASE … SET timezone='UTC'` +
  `DATABASE_URL=… node scripts/apply-all-migrations.mjs` (193 feature migrations).
- `@workspace/*` links in a worktree resolve into the **main checkout**, so a schema edit in the
  worktree is invisible to its own tests.
- CI runs the full suite on PostgreSQL 16; PG18's `ON DELETE RESTRICT` raises `23001` where PG16
  raises `23503`, so assert the constraint name, not the code.
- GitHub: no `gh` CLI here; REST with the operator's token file, and `git push` needs a one-off
  credential helper because Git Credential Manager hangs on a prompt that cannot render.

_Last updated: 2026-10-16 by the integration agent, session start (tracker created; RIS-005/006
investigation opened)._
