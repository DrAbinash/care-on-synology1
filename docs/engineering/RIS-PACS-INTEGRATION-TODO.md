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
| **RIS-006** | **Null `patient_reports.study_id` ownership** | **P0** | **Report claimed onto a second exam of the same patient** | **CONFIRMED → PR OPEN** (patient equality alone was sufficient; now a recorded linkage is required) | 3 of 8 cases red at `877701f9` — patient-alone association and same-patient sibling reuse both returned 200; mutants N1–N6 each killed | **#1047** | pending | no | no |
| RIS-007 | CT/DICOM pull: "success" without received instances | P1 | A study believed acquired but never arrived | CONFIRMED (code) / NOT REPRODUCIBLE live | `dimse-agent.ts:363`, `:488` | none yet | — | no | n/a |
| RIS-008 | Re-verify RIS-001's matrix after the merges on main | P1 | Regression in format selection | RE-RUN GREEN (`studyRegion.test.ts` 39/39 at `b2ecdef9`, which is current main plus the archive fix only) | `tmp/ris008-009.log` (gitignored) | — | — | n/a | no |
| RIS-009 | Re-verify RIS-002 across Next / Previous / Park / deep link | P1 | Regression in viewer identity | PARTIAL — the two source-contract guards are green; the Chromium multi-navigation re-probe was **not** re-run this session | `viewerStudyScopedReset.contract.test.ts` 2/2 | — | — | n/a | no |
| RIS-010 | PACS archive transaction safety (races, double archive, amend-after-archive) | P1 | Duplicate or superseded report filed as current | TODO | — | — | — | no | no |
| RIS-011 | MWL reality per modality (MRI / CT / USG / X-ray) | P2 | Scans arrive unidentifiable | TODO | — | — | — | no | no |
| RIS-012 | Linked-sibling finalize refused by the ownership guard | P1 | Second study of an authorized combined pair never marked final | **CONFIRMED (runtime) → PR OPEN** | cases 2/5/6 of `linkedSiblingReportFinalize.request.test.ts` red at `877701f9` with 409 `REPORT_WORKLIST_MISMATCH`; 6/6 green after; mutants M1–M7 each killed | **#1047** | pending | no | no |

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
   Nothing further is owed on `pacsArchive.ts` unless RIS-010 finds a transaction defect.
3. **RIS-012 + RIS-006 / PR #1047: both confirmed at runtime, corrected, mutation-checked, opened as a
   Draft on `fix/linked-sibling-report-ownership` (`0d784e98`).** Do not re-derive them. Read its CI
   result, then hand it to the owner to merge; rebase onto main if #1046 or anything else moved first.
   If it merges, the next measurement is the production census named under RIS-006 — the number decides
   whether the null-study refusal needs a Match-Center-visible presentation as well.
4. **RIS-009**: the Chromium multi-navigation re-probe (Next / Previous / Park / deep link) is the only
   unfinished verification left from the P1 list. `studyRegion.test.ts` was re-run green.
5. **RIS-010**: archive transaction safety, starting from `radiology_pacs_archive_revisions` and
   `pacsArchiveStatus`/`pacsInstanceId` — record what already protects the clinic before proposing
   anything.
6. **RIS-007**, **RIS-011**: read-only evidence only; no scanner changes, no production C-FIND/C-MOVE.

**Owner decisions outstanding:** (a) — *answered 2026-10-17* — one signed report may cover several
examinations only when they are explicitly linked, and that ruling is now implemented in PR #1047;
(b) should a study with no authoritative report archive at all, given the fallback prints
`No report body text entered.` into the DICOM object (RIS-005 case 9); (c) once the NAS is reachable, the
null-`study_id` census — if a large number of historical signed reports carry no linkage, does the
refusal need a visible warning path instead of a hard block; (d) when the rebuilt NAS deployment is
available, which commit to deploy and with which verified backup.

_Last updated: 2026-10-17 — the owner's examination-ownership ruling is recorded as a standing rule and
implemented: **RIS-012** (an authorized combined report could not finish its second study — refused with
`REPORT_WORKLIST_MISMATCH`, proven at request level) and **RIS-006** (a report with no `study_id` was
attributable to any study of that patient — proven at request level) are corrected in one Draft,
**PR #1047**, with 14 request-level cases and mutation batteries M1–M7 / N1–N6 each killed. RIS-005
stays merged-not-deployed. Nothing was deployed, no container restarted, no production row touched._
