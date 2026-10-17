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
| RIS-003 | Auto-link must not replace an APPROVED association | P0 | Wrong patient on a signed report | MERGED → verifying (lanes green on current main) | `67fbf901`; 5/5 `approvedPatientAssociationAutoLink.request.test.ts` on `2c8bdccd` | #1041 | green | yes | **no** |
| RIS-004 | PACS archive report pick must be patient-scoped | P0 | Another patient's report in the image archive | MERGED | `2c8bdccd` | #1042 | green | yes | **no** |
| **RIS-005** | **Correct patient is not yet correct examination in the archive** | **P0** | **Right patient, wrong exam filed into the study series** | **MERGED — not deployed, not clinically verified** | 7/13 cases red at `2c8bdccd` (Brain study returned report **637** = the LS Spine row, not **636**); 13/13 green at `b2ecdef9`; mutation battery A–F all killed; on `origin/main` as `877701f9` (tree-verified) | **#1044** (merged by the owner 2026-10-16 20:18Z) | **green** — see the CI note below | yes | **no** |
| **RIS-006** | **Null `patient_reports.study_id` ownership** | **P0** | **Report claimed onto a second exam of the same patient** | **CONFIRMED → PR OPEN** (patient equality alone was sufficient; now a recorded linkage is required) | 3 of 8 cases red at `877701f9` — patient-alone association and same-patient sibling reuse both returned 200; mutants N1–N6 each killed | **#1047** | **green** — all 3 jobs on `0d784e98` | no | no |
| RIS-007 | CT/DICOM pull: "success" without received instances | P1 | A study believed acquired but never arrived | CONFIRMED (code) / NOT REPRODUCIBLE live | `dimse-agent.ts:363`, `:488` | none yet | — | no | n/a |
| RIS-008 | Re-verify RIS-001's matrix after the merges on main | P1 | Regression in format selection | RE-RUN GREEN (`studyRegion.test.ts` 39/39 at `b2ecdef9`, which is current main plus the archive fix only) | `tmp/ris008-009.log` (gitignored) | — | — | n/a | no |
| RIS-009 | Re-verify RIS-002 across Next / Previous / Park / deep link | P1 | Regression in viewer identity | PARTIAL — the two source-contract guards are green; the Chromium multi-navigation re-probe was **not** re-run this session | `viewerStudyScopedReset.contract.test.ts` 2/2 | — | — | n/a | no |
| RIS-010 | PACS archive transaction safety (races, double archive, amend-after-archive) | P1 | Duplicate or superseded report filed as current | **TESTING — evidence committed, behaviour deliberately unchanged** (protections recorded VERIFIED, five gaps MEASURED, one still unmeasured) | `pacsArchive.transaction.request.test.ts` **8/8** green on `origin/main` `877701f9`; mutation battery M1–M10 = **8 DETECTED with named attribution + 2 survived-as-designed**; neighbours 83/83 across 10 files; typecheck unchanged (58 pre-existing, 0 in the new file) | **#1048** (Draft, head `3905b8d3`) | **green** — all 3 jobs on `3905b8d3` (measured 2026-10-16 21:49Z) | no | no |
| RIS-011 | MWL reality per modality (MRI / CT / USG / X-ray) | P2 | Scans arrive unidentifiable | TODO | — | — | — | no | no |
| RIS-012 | Linked-sibling finalize refused by the ownership guard | P1 | Second study of an authorized combined pair never marked final | **CONFIRMED (runtime) → PR OPEN** | cases 2/5/6 of `linkedSiblingReportFinalize.request.test.ts` red at `877701f9` with 409 `REPORT_WORKLIST_MISMATCH`; 6/6 green after; mutants M1–M7 each killed | **#1047** | **green** — all 3 jobs on `0d784e98` | no | no |

**Deployment, all rows:** nothing above is deployed. Measured 2026-10-16 from the development
workstation: `192.168.1.137` answers ping in 7 ms, but `:8888` (care-web), `:8042` (Orthanc),
`:3010` (OHIF) and `:8080` (API) all refuse connections while `:80` returns 200. So the deployed
CARE stack is currently unreachable from here and **no deployment state can be confirmed**. The
clinic is rebuilding that deployment; until `deploy-synology.sh` is run against a known commit,
every row stays `MERGED`, not `DEPLOYED`.

**CI flake already paid for (do not re-diagnose).** PR #1044's first `Tests + migration smoke (real
Postgres)` run failed in `artifacts/api-server/src/services/integration/reconcileFairProgress.db.test.ts`
with two FK violations inside that file's own `clearAll` (`external_result_links_referral_id_fkey`,
`external_result_links_emitted_outbox_id_fkey`) plus `Test timed out in 5000ms` at its line 246. The
file is untouched by this queue, it passes locally against the scratch PostgreSQL 18 with all 193
migrations applied, and the same job on `origin/main` was green minutes earlier. `POST
/actions/runs/38957784294/rerun-failed-jobs` returned **all three jobs success** on attempt 2, which is
the whole of the evidence that it was order/timing dependent rather than caused by the archive change.
`origin/main` at that moment was `1066065b`; `main` is now `877701f9`.

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

**Reproduced against PostgreSQL at `2c8bdccd` (the merged #1042).** One patient, an MRI BRAIN study
and an MRI LS SPINE study, the LS worklist row's primary key forced equal to the Brain study's — the
accident the two independent sequences produce by themselves. Archiving the Brain study resolved to
report **637**, the LS Spine report, instead of **636**. 7 of the 13 cases in
`pacsArchive.reportScope.request.test.ts` were red there; all 13 are green at `b2ecdef9`.

**Correction made (`b2ecdef9`, PR #1044 — merged into `877701f9`, not yet deployed).** The legacy
spelling must name the examination:

* `test_id` must equal the study's (NOT NULL on both `patient_reports` and `radiology_studies`, so no
  row can claim to be exempt);
* `bill_id`, `order_id` and `order_test_id` must not **contradict** it — absence is allowed, a
  mismatch refuses. `order_test_id` is UNIQUE on `radiology_studies`, which is the only thing that
  separates two studies of the *identical* test;
* these are the same fields `bindRadiologyIdentity`/`bindRadiologyReportIdentity`
  (`lib/radiologyIdentity.ts:115-232`) already raise `TEST_MISMATCH` / `ORDER_MISMATCH` on when the
  report is written, and copies onto the row at `routes/patient-reports.ts:2193-2195` and `:2255-2258`.
  So no report the finalize path could legitimately produce for this examination is stranded;
* the worklist leg collects **every** worklist row bound to the study rather than one, because
  duplicate modality intake binds two;
* `study_id IS NULL` stays unreachable, ambiguity returns `null`, and nothing is guessed.

Step 1 of the earlier plan — preferring `radiology_worklist.report_id` as the primary evidence — was
**not** taken: legacy rows have no back-link at all (so preferring it would delete the legacy
spelling the clinic depends on), and one report may legitimately be linked to two worklist rows
(RIS-012), so a back-link preference would refuse a flow the ERP performs today.

**Mutation battery** (`tmp/ris005-mutation-check.mjs`, gitignored; each mutant is verified to apply
before its verdict is read):

```
CONTROL (unmutated):                  Tests  13 passed (13)
A legacy leg without test_id          1 failed  × legacy row with no billing identity…
B without bill/order/order_test       1 failed  × refuses the previous year's report…
C only the first bound worklist row   1 failed  × finds the report through either worklist row
D without the patient predicate       1 failed  × never renders another patient's report…
E without newest-first order          2 failed  × deterministic pick, × amendment
F legacy leg = study_id + patient     6 failed  (#1042 exactly as merged)
```

Two fixtures had to be re-ordered before they became evidence: with the correct report written last,
a wrong-but-unsighted resolver still returned the right row because `desc(id)` happened to pick it.
The colliding and previous-year reports are now written **after** the correct one, so only a real
refusal can make those cases pass.

**Owner test cases 1-10:** 1 ✅ 2 ✅ 3 ✅ 4 ✅ (unchanged from #1042) 5 ✅ 6 ✅ 7 ✅ (the amendment
contract at `routes/patient-reports.ts:1815-1820` copies the parent's identity verbatim, so an
amendment stays in-scope and newest-first selects it) 8 ✅ 9 ✅ as behaviour (a null return makes
`archiveReportToPacs` fall back to the study's own free text, or the literal
`No report body text entered.` — never another report; worth an owner ruling on whether that fallback
should archive at all) 10 → **RIS-010**, not covered here.

**Remaining limitations.**
* Not exercised: the Chromium + Orthanc legs (no Orthanc reachable). Only the SQL pick before them is
  proven.
* Residual hole: a legacy row with **no** `bill_id`, `order_id` or `order_test_id`, naming the **same**
  test, whose `study_id` coincides with a different study of the same patient, is indistinguishable
  from its true owner and would still be adopted. Nothing in the schema separates them; guessing on
  dates would be worse. Counting such rows is the same production measurement RIS-006 needs.
* `pacsArchive.d8.test.ts`'s mocked `db` discards its `where` argument — it is structurally incapable
  of proving either half of this defect, which is now said in the file.

---

## RIS-006 — null `study_id` report ownership (P0, PR #1047)

`assertReportBelongsToWorklist` (`lib/radiologyIdentity.ts:235-287`) asked only "same patient?" when
`report.study_id IS NULL`, because the whole worklist comparison sat inside `if (report.studyId)`.
**Confirmed at runtime on `877701f9`, not inferred from the trace**: a study-less report of patient A
was accepted for a second, unrelated study of patient A with HTTP 200, and the worklist row took the
`report_id` of a document written for a different examination.

Measured census (still accurate; the untracked note at `tmp/null-study-ownership-note.md` carries the
same list with line numbers 5–12 lines stale):

* call sites: `reportComposer/composeIdentity.ts:239`, `:362`, `:572` and
  `routes/internal-radiology.ts:1367` — the last is load-bearing, because finalize takes `reportId`
  from the request body;
* sign / amend / deliver do not call it;
* study-less radiology reports are **created deliberately**: `routes/patient-reports.ts:1980-1985`
  keeps legacy / D5-fixture / non-workspace creates on the pre-hardening path and calls binding all
  `type=radiology` "a separate product decision with fixture updates";
* every ERP caller that sends a `reportId` to `report-status`: `radiologyReportLifecycle.ts:486` (the
  row it just finalized, which always carries `study_id`) and `:505` (the same `reportId` against a
  linked sibling — that one is RIS-012, now allowed explicitly).
  `pages/RadiologyWorklist.tsx:1037` sends no `reportId`, so it never reaches the guard.

**Correction implemented (PR #1047).** The null branch requires a linkage the database already holds
and refuses without one — see the owner's ruling above for the three accepted linkages and the
duplicate-intake rule. Tests: `nullStudyReportOwnership.request.test.ts`, 8 cases, 3 of them red
before the change; mutants N1–N6 each killed with attributed failures. The refused report is asserted
byte-identical afterwards (`study_id` still NULL, body/Impression/`updatedAt` unchanged) because a
guard that "fixes" history by writing an id onto it would be a worse defect than the one it closes.

**What is still not known.** The production census of `patient_reports` rows with
`type='radiology' AND study_id IS NULL AND status IN ('final','verified','delivered')`, and how many of
those carry no `order_test_id`/`bill_id` and no promoted draft — i.e. how many historical reports this
rule newly refuses. The NAS refuses `:8080` from this workstation, so it is unreadable here. If the
count turns out to be large, the correction is still right but its **presentation** may need to be a
Match-Center-visible warning plus a hard refusal only on new writes; that is the owner's call, and it
is the reason this row is `PR OPEN` rather than `VERIFIED`.

---

## RIS-003 — post-merge verification of the APPROVED-association guard (P0)

Merged as `67fbf901`. Verify on current `main`, without changing behaviour: the guard sits at the
single shared writer `applyWorklistStudyLink`, so all five entry points inherit it — accession lane,
name±referral lane, USG DICOM intake (`internal-radiology.ts:991`), worklist entry load (`:2013`),
Reporting Studio (`internal-reporting-studio.ts:804`) and the backfill script — and `preview` refuses
with the same reason as the run. Same-patient approvals must still link, or the clinic's ultrasound
billing backlog is stranded. Status moves to `VERIFIED` only with the clinic's own data observed;
until then `MERGED`.

**Re-verified 2026-10-16 at `2c8bdccd`** (no code changed for this task): the guard is still the only
writer path, `approvedPatientAssociationAutoLink.request.test.ts` is 5/5 green against real
PostgreSQL — including the two cases that must NOT freeze: an approved row may still link a billed
study of the **same** patient, and an unapproved (`matchDecision = "NONE"`) row still links freely.
Part of the 138/138 neighbour run recorded under RIS-005. What remains outstanding is clinic-side only:
the USG billing backlog and the Match Center UI observed on the deployed build, which cannot be done
while the NAS refuses connections. **`MERGED`, and ready for the owner's own review — not `VERIFIED`.**

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

## RIS-010 — archive transaction and retry safety (P1, evidence committed in #1048)

Read from `877701f9` before proposing anything, as instructed. The investigation is now a **committed
test file**, not a probe: `artifacts/api-server/src/lib/pacsArchive.transaction.request.test.ts`
(8 request-level cases, real PostgreSQL, Draft PR **#1048**, head `3905b8d3`). It is deliberately
**tests only — no archive behaviour was changed**, because three of the findings below are the owner's
clinical/architectural calls, not mine.

**Why this file had to exist.** One successful `archiveReportToPacs()` run writes four records that
must agree about the same object — (1) `radiology_studies.pacsArchiveStatus` / `_Response` /
`pacsInstanceId`, (2) `radiology_pacs_archive_revisions`, (3) `radiology_audit_log`, (4) the DICOM
object and its tags. Nothing read them together: `pacsArchive.d8.test.ts` mocks `db` in a way that
**discards the `where` argument** (the file says so at its own line 40-42), so it can count calls but
cannot see state — which is precisely why the RIS-005 association defect survived it;
`pacsArchive.reportScope.request.test.ts` proves the SQL pick and stops before the upload. Edges
stubbed: Chromium's PDF rasteriser and the Orthanc HTTP endpoint. The stubbed rasteriser **records the
HTML it was handed**, so what entered the DICOM object is asserted instead of inferred. Everything
that decides what the clinic's PACS holds runs for real: the pick, `buildReportArtifact` + the
amendment-chain resolution, the status writes, the revision upsert and supersede sweep, the audit rows,
and the durable job queue's claim/execute cycle.

### Protections that already exist — now VERIFIED with evidence

| Protection | Measured as |
|---|---|
| The four records agree on a successful archive; the object carries this study's `StudyInstanceUID`, accession and `PatientID` | case 1 |
| An Orthanc **rejection** is recorded as `failed` everywhere — status, response, revision row (`status='failed'` + error detail) and an `ORTHANC_UPLOAD_FAILURE` audit row with **no** success row | case 2 |
| An **unconfigured endpoint** posts nothing at all and never claims success | case 2 |
| The durable re-archive job is restart-safe: an already-archived revision is a **no-op** (`radiologyJobHandlers.ts:197-205`), verified by enqueueing a real `radiology_pacs_rearchive` job and running a real `runRadiologyJobTick` — job outcome `success`, zero extra DICOM POSTs | case 3 |
| An amendment after an archive **marks the earlier revision `superseded`** rather than overwriting its row: two revision rows, the root keeping its own `orthancInstanceId`, the amendment recorded `success` at `sequenceNumber 2`, and the second object labelled `Radiology Report PDF v2/2 (amended)` | case 4 |
| `UNIQUE(report_id)` on `radiology_pacs_archive_revisions` means retries cannot duplicate the *record* even when they duplicate the *object* | cases 3, 4 |

**One correction to what this section claimed before the test existed.** It said
`buildReportArtifact(..., { surface: "pacs", versionMode })` "resolves to the latest signed version by
default". Measured: the archive passes `versionMode` through unchanged, and `effectiveResolveMode`
(`patient-reports.ts:433-440`) maps an absent mode to `"latest"` **only when
`ff_radiology_structured_final` is enabled**; otherwise `"specific"`. So the default is flag-dependent,
not "latest signed". Related, and also measured: because the pick is newest-first, the row the archive
requests *is* the newest revision, so `versionMode: "specific"` cannot reach a superseded root row from
this entrypoint at all — the archived object for a study can never silently be a superseded report, but
it also cannot be re-issued as a labelled historical copy without a different entrypoint. Cases that
make a claim about which revision was delivered pass `versionMode` explicitly.

### Gaps — MEASURED, asserted as today's truth, nothing changed

1. **A second run on one revision writes a second DICOM object that nothing treats as a duplicate.**
   The duplicate-effect guard lives in the **job handler**, not in `archiveReportToPacs`, so every
   caller that reaches the function directly bypasses it. Two runs → two POSTs; because the revision
   record is upserted on `report_id`, the study row and the revision row both end up naming the
   **second** instance while PACS holds two. The first instance is remembered only in
   `radiology_audit_log` (two success rows, two distinct `instanceId`s — asserted, so the audit trail
   is genuinely the surviving record). Case 3.
2. **Two archives started together overlap instead of excluding each other — MEASURED (case 8).** The
   finalize trigger fires `archiveReportToPacs` **un-awaited** the moment the worklist row flips to
   `REPORT_FINAL` (`internal-radiology.ts:1425-1431`), so a staff Retry can be in flight at the same
   time. With the render made to take 60 ms so both runs are genuinely inside render → POST together,
   measured: both return success, **two distinct** Orthanc instances are created, the study row still
   holds one `pacsInstanceId`, `radiology_pacs_archive_revisions` still holds one row for that revision
   (`UNIQUE(report_id)`), and only `radiology_audit_log` references both objects. The study is set to
   `pacsArchiveStatus: "pending"` at `:143` with no lock, no compare-and-set and no transaction — and
   mutant **M10** proves that rather than asserting it: deleting the pending write changes nothing
   observable anywhere in the file, because no code depends on it for mutual exclusion. The patterns to
   reuse already exist (`claimWorklistForFinalize`'s `SELECT … FOR UPDATE` at
   `radiologyIdentity.ts:263`, the advisory-lock style of the outbox and ledger writers). Reuse; do not
   invent a queue or a state machine.
3. **Reachable from the ERP over HTTP.** `POST /api/radiology/studies/:id/archive-retry` answers
   `200 {success: true}` and performs that second upload, with no finality, eligibility or
   duplicate-effect check in the route; the mount's only gate is
   `requireStaffPermission("/radiology")` (`routes/index.ts:888`). Case 7.
4. **An unsigned report is archived, and the only safeguard is a label.** `resolveArchiveReportRow`
   applies no finality filter, so a study whose newest row is `status='draft'` with no signature gets
   that row; `buildReportArtifact` does **not** refuse it — the render carries
   `<div class="stamp draft">DRAFT (not signed)</div>` (`patient-reports.ts:3286-3290`), and the run
   still records `pacsArchiveStatus='success'` **and a revision row with `status='success'`**. For the
   same two rows, the product's own eligibility authority — `planUsgPacsReturn`
   (`usgPacsReturnPolicy.ts:89-92`, whose header states the clinic's rule as *"only a
   finalized/verified/signed report is eligible (never a draft)"*) — returns `eligible:false`,
   `blockReasons:['not_finalized']`, `tags:null`. The two surfaces disagree about the same examination,
   and the direct paths never consult the policy. This replaces the earlier throwaway probe (draft
   1726/1727), which measured the pick only. Case 5.
   **The wrong fix is now ruled out by measurement:** passing `deliverableStatuses` to
   `buildReportArtifact` cannot gate a draft, because that selector only walks an **existing amendment
   chain** (`radiologyReportVersion.ts:333-343`) and an unchained draft has none — mutant **M8** survived
   exactly as designed, which is why it is kept in the battery. If the owner rules that unsigned reports
   must not be archived, the authority to reuse is `usgPacsReturnPolicy`, not the version resolver.
5. **A study with no report row files the placeholder and leaves no revision record.** The fallback HTML
   puts `No report body text entered.` into the DICOM object, the run records
   `ORTHANC_UPLOAD_SUCCESS`, and `radiology_pacs_archive_revisions` has **zero rows** for that study —
   the record is written only `if (v)` (`pacsArchive.ts:330`) and no version resolved — so the table
   that answers "what did we file for this study?" is empty while PACS holds an object, and the success
   audit row carries no `deliveredReportId`. This is the owner-decision-(b) case, now with its exact
   behaviour pinned. Case 6.

### Still not measured (stated as such in the test file header, so nobody reads them as proven)

* **Orthanc accepted, ERP write failed.** The success `UPDATE` (`:317-324`) is not in a transaction with
  the revision writes, so a throw there lands in the catch branch and records `failed` for a study whose
  object **does** exist — and the next attempt adds a second one. The ordering is readable in the source;
  no test reaches it without injecting a fault between two statements, which on this repo means a
  temporary trigger on `radiology_studies` — a table every other suite shares. Not done. This is now the
  **only** unmeasured item in the original gap list; the concurrency question above was answered in the
  same pass.
* **Revision/audit writes swallow their own errors** — `.catch(() => undefined)` at `:346`, `:354`,
  `:407`, so a study can read `success` with no per-revision row behind it. Case 4's "no revision row for
  the placeholder path" is adjacent evidence that the record can be absent, but the swallowed-error
  branch itself is not exercised.

### Verification of the evidence itself

Baseline **8/8** green, re-run on this branch's own base (`origin/main` `877701f9`) rather than the branch
it was written on. Mutation battery **M1–M10** (`tmp/ris010-mutation-check.mjs`, gitignored), each mutant
requiring its own named failing test: 8 **DETECTED** (supersede sweep, revision `success` status,
requested-vs-delivered audit key, placeholder text, the `DRAFT` label string, a finality filter *added*
to the pick, the job guard, study status), 2 **EXPECTED-SURVIVE** — **M8** (`deliverableStatuses` cannot
gate an unchained draft) and **M10** (deleting the `pending` status write changes nothing observable,
which is what makes the claim "the pending write is not a lock" a measurement rather than an opinion).
Neighbours **83/83** across
10 files (`pacsArchive.d8`, `pacsArchive.reportScope`, `radiologyJobRules`, `radiologyJobs.claim`,
`radiologyReportVersion`, `usgPacsReturnPolicy`, `usgPacsReturnService.integration`,
`routes/usgPacsReturn`, `finalizeIntegrityGuard.request`, plus this file). `api-server` typecheck
unchanged at 58 pre-existing worktree `TS6305` errors, none in the new file.

**No queue, revision engine or state machine is proposed.** The remaining engineering questions are (i)
whether the job handler's duplicate-effect rule should move into the canonical function, and (ii) whether
the eligibility authority should gate the direct paths — both are owner decisions below, not code
decisions.



---

## RIS-011 — MWL reality per modality (P2)

For MRI, CT, USG and X-ray separately, and never conflating **NOT CONFIGURED / NOT SUPPORTED /
NOT TESTED / CONFIGURED BUT FAILING / WORKING**: is MWL configured, is the scanner actually querying
it, does the modality send an accession, is `StudyInstanceUID` stable, is PatientID/UHID transmitted,
is billing-to-DICOM identity reliable. Known starting facts: USG has no MWL at all (which is why the
bill-desk name±referral lane exists — `internal-radiology.ts:975-991`); MR/CT do receive MWL
accessions. Recommendations land here; this is not permission to rebuild MWL infrastructure.

---

## RIS-012 — linked-sibling finalize was refused, now authorized explicitly (P1, PR #1047)

Found while enumerating the `report-status` callers for RIS-006, then **confirmed at runtime** rather
than left as a trace: after signing, `diagnostic-erp/src/lib/radiologyReportLifecycle.ts:505` posts the
**same** `reportId` against a **different** `worklistId` — the linked sibling of a paired study — and
`internal-radiology.ts:1367` ran `assertReportBelongsToWorklist`, which resolved the report's own
`study_id` to the primary worklist row and threw `REPORT_WORKLIST_MISMATCH` (HTTP 409) because that is
not the row being flipped. The ERP swallowed it into `linkedMarkError`, so nothing surfaced.

**Clinical meaning.** A radiologist who reports an MRI Brain and an MRI LS Spine as one combined
document got the brain study marked final and the spine study left in the worklist as though nothing
had been reported for it — while a signed, delivered report covering it already existed. The partner
accession can then be re-reported or re-billed against that existing document.

**Correction (PR #1047).** The guard now reads the combine the radiologist actually performed: the
report's own draft, found with the same "latest draft for this study reference" lookup finalize itself
uses (`routes/patient-reports.ts:973-977`), whose `structured_json` envelope carries
`linkedStudyId` / `careLinkedStudy` written by `POST /api/radiology/report-generator/save-draft`
(`radiology-report-generator.ts:1683`) and read through the existing `extractCareLinkedStudy`. The flip
is allowed **only** when the row being flipped is exactly the row that envelope names; the patient
equality check still runs first, so a combine that points at another patient's row refuses. No new
column, no second identity system, and no bypass — the guard itself does the reading.

Tests: `linkedSiblingReportFinalize.request.test.ts` (6 cases, drives
`save-draft → POST /api/patient-reports → /sign → report-status` and re-reads the rows). Cases 2, 5 and
6 were red at `877701f9`; 1, 3 and 4 (single exam, unlinked same-patient reuse, cross-patient reuse)
were already green and stayed green. Mutants M1–M7 each killed with attributed failures — including M3,
which keys the allowance on *a* combine rather than *this* row and is caught by cases 2, 3, 5 and 6.

**Not yet observed:** no browser has run a real combined report end to end on a deployed build. The
ERP's own error swallowing (`linkedMarkError`) is unchanged by this PR, so a future sibling-flip failure
would still be quiet; worth a follow-up if the owner wants it surfaced to the radiologist.

## Standing constraints for anyone working this queue

**Owner's examination-ownership ruling (2026-10-17), which settles what RIS-006 and RIS-012 were
waiting on:**

> One signed radiology report MAY legitimately cover multiple worklist examinations, but ONLY when those
> examinations are explicitly linked under an authorized combined-report workflow. The same patient alone
> is never sufficient.

Operational consequences, all of them already enforced by code in
`artifacts/api-server/src/lib/radiologyIdentity.ts`:

* the explicit link is the one the product persists — `radiology_report_drafts.structured_json`
  `linkedStudyId` / `careLinkedStudy`, read through the existing `extractCareLinkedStudy` — not a
  similarity score, not a shared appointment, not a shared bill;
* for a report with no `study_id`, an authoritative existing linkage must name the row being written:
  the row's own `report_id` back-link, the draft promoted to the report, or the report's
  `order_test_id` (UNIQUE per examination) resolving to the study that row is bound to;
* nothing is inferred from `patient_id` alone, and no historical report is back-filled or re-keyed to
  make a check pass;
* where no linkage names the row, the association is refused and the message names the action that
  resolves it (open the report from its own study, or link it in Match Center).

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

## Next session, in this order

1. Read `docs/engineering/RIS-PACS-INTEGRATION-TODO.md` (this file) and `GET /pulls` — do not assume
   the statuses below survived the night.
2. **RIS-005 / PR #1044: DONE — merged by the owner into `877701f9`, CI green on the rerun.** It is
   **not deployed**, so the clinic still files the wrong examination's report until someone deploys.
   RIS-010 has since found four *separate* archive defects/gaps (below); none of them is the association
   bug #1044 fixed, and none of them reopens it.
3. **RIS-012 + RIS-006 / PR #1047: both confirmed at runtime, corrected, mutation-checked, opened as a
   Draft on `fix/linked-sibling-report-ownership` (`0d784e98`).** Do not re-derive them. Read its CI
   result, then hand it to the owner to merge; rebase onto main if #1046 or anything else moved first.
   If it merges, the next measurement is the production census named under RIS-006 — the number decides
   whether the null-study refusal needs a Match-Center-visible presentation as well.
4. **RIS-009**: the Chromium multi-navigation re-probe (Next / Previous / Park / deep link) is the only
   unfinished verification left from the P1 list. `studyRegion.test.ts` was re-run green.
5. **RIS-010: evidence committed — Draft PR #1048 (head `3905b8d3`), tests only, no behaviour changed.** Do
   not rebuild the mechanisms it records as VERIFIED. What remains is (a) the owner rulings (b), (e) and
   (f) below, (b) one unmeasured item — the Orthanc-accepted-but-status-write-failed path, which needs a
   fault injected between two statements and has no safe harness on a shared table, and (c) only *then*,
   reusing the existing eligibility policy or the existing `FOR UPDATE`/advisory-lock patterns rather
   than a new queue.
6. **RIS-007**, **RIS-011**: read-only evidence only; no scanner changes, no production C-FIND/C-MOVE.

**Owner decisions outstanding:** (a) — *answered 2026-10-17* — one signed report may cover several
examinations only when they are explicitly linked, and that ruling is now implemented in PR #1047;
(b) should a study with no authoritative report archive at all — measured in #1048: it currently files
the placeholder text `No report body text entered.` **and** records `ORTHANC_UPLOAD_SUCCESS`, while
`radiology_pacs_archive_revisions` gets **no row at all**, so the archive's own history table cannot say
what was filed; (c) once the NAS is reachable, the null-`study_id` census — if a large number of
historical signed reports carry no linkage, does the refusal need a visible warning path instead of a
hard block; (d) when the rebuilt NAS deployment is available, which commit to deploy and with which
verified backup; (e) **new, from #1048** — should a re-archive of an *unchanged* revision be a no-op
everywhere (the durable job's rule), or must the manual Retry button stay able to force a fresh object,
e.g. after Orthanc data loss? Today the direct path posts a second object and only the audit log
remembers the first; (f) **new, from #1048** — should the general archive honour the eligibility
authority the product already states for PACS return (*"only a finalized/verified/signed report is
eligible (never a draft)"*)? Today an unsigned draft reaches Orthanc carrying only the rendered
`DRAFT (not signed)` label, and the ERP records it as archived successfully.

_Last updated: 2026-10-17 (second pass) — **RIS-010** investigation closed as measurement: a committed
request-level file (Draft **PR #1048**, head `3905b8d3`) reads all four records one archive run writes
together — 8/8 green on `origin/main`, mutation battery M1–M10 = 8 detected + 2 survived-as-designed. It
records six protections as VERIFIED (including the durable job's duplicate-effect guard and the
amendment supersede sweep) and five gaps as MEASURED (double object from the canonical function and from
the retry route, two archives overlapping because the `pending` write is not a lock, an unsigned draft
archived with only a label, a placeholder archived with no revision row), corrects this section's earlier
claim that the archive resolves to "latest signed by default" (the mode is flag-gated), and leaves exactly
one item unmeasured — the Orthanc-accepted-but-status-write-failed path. **CI measured 2026-10-16 21:49Z
and 22:03Z: #1048 green on `3905b8d3` (all three jobs), #1047 green on `0d784e98` (all three jobs); this
file's own PR #1046 is docs-only and every one of its runs today was green, so the number that carries
risk is the code PRs, whose heads are named above.** Re-read them before acting — a verdict recorded here
is a measurement of a moment, not a guarantee. Nothing was merged or deployed by this session; no
production row, container or Orthanc instance was touched._

_Previous pass, 2026-10-17 — the owner's examination-ownership ruling was recorded as a standing rule
and implemented: **RIS-012** (an authorized combined report could not finish its second study — refused
with `REPORT_WORKLIST_MISMATCH`, proven at request level) and **RIS-006** (a report with no `study_id`
was attributable to any study of that patient — proven at request level) corrected in one Draft,
**PR #1047**, with 14 request-level cases and mutation batteries M1–M7 / N1–N6 each killed. RIS-005
stayed merged-not-deployed. Nothing was deployed, no container restarted, no production row touched._
