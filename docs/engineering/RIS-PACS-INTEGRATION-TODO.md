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
| RIS-010 | PACS archive transaction safety (races, double archive, amend-after-archive) | P1 | Duplicate or superseded report filed as current | **MERGED, then post-merge compatibility audited**: the enforcement pass is on `main`; the audit found **2 demonstrated regressions**, both fixed and **MERGED through PR #1053**. Nothing deployed, nothing clinically verified | enforcement suite `pacsArchive.transaction.request.test.ts` **21 / 21** on real PostgreSQL; neighbours **244 tests / 13 files**; battery **28 mutants = 23 DETECTED with the owning case named + 5 EXPECTED-SURVIVE, 0 unexplained**; Command Center refusal badge **8/8 in real Chromium — control on `main`'s component 4/8**; typecheck adds nothing (see the audit numbers below) | evidence **#1048 → MERGED `1394ab79`**; enforcement **#1050 → MERGED `1a93e4e4`**; audit follow-up **PR #1053 → MERGED `9664a967`**, code commit `52434abb` | #1050 **green** (measured from the Actions log); **#1053 green** on `c1d868a1` (all three jobs, measured 2026-10-17 04:29Z from the Actions log, not from the tick): `Test Files 1086 passed | 5 skipped (1091)`, `Tests 14576 passed | 49 skipped (14625)`, and the line that matters — `✓ pacsArchive.transaction.request.test.ts (20 tests) 5562ms`, i.e. the suite **executed** on CI's `postgres:16-alpine` instead of `describe.skipIf`-ing away. and **#1053 merged green** on its final head `00fe117e` (21 tests executed on CI's Postgres 16) | **yes** — #1050 `1a93e4e4`, #1053 `9664a967` | **no** |
| RIS-011 | MWL reality per modality (MRI / CT / USG / X-ray) | P2 | Scans arrive unidentifiable | TODO | — | — | — | no | no |
| RIS-012 | Linked-sibling finalize refused by the ownership guard | P1 | Second study of an authorized combined pair never marked final | **CONFIRMED (runtime) → PR OPEN** | cases 2/5/6 of `linkedSiblingReportFinalize.request.test.ts` red at `877701f9` with 409 `REPORT_WORKLIST_MISMATCH`; 6/6 green after; mutants M1–M7 each killed | **#1047** | **green** — all 3 jobs on `0d784e98` | no | no |
| **RIS-013** | **Canal AP diameter: two measurement authorities, and the reachable one did not print** | **P1** | **A canal diameter the radiologist measured never reached the signed report** | **OWNER DECISIONS 1-4 IMPLEMENTED → MERGED (#1054, `3d54c552`)** (one print plan across segments, phrase dedupe gone, Generate writes no table, one live entry point + audited, Composer untouched) | `docs/audits/spinal-canal-ap-measurement-audit-2026-10-17.md` §RIS-013; 20-test rendered-artifact matrix V1-V10 on real PostgreSQL; ERP canal suites + 11-test entry-point contract; mutants M1 single-segment plan, M2a phrase guard, M2b/M2c valued/blank — each killed | **MERGED** `main` `3d54c552` (squash of `ad90a59a`; parent `71f68479`) | **green** — all 3 jobs on `ad90a59a`, 14,656 passed / 49 skipped over 1,089 files; merged tree `b84b5926` byte-equal to that head | no | **no** |
| **RIS-014** | **Finalize sent the queue row's id where a billed study id was keyed, and a flip that sent nothing was a "completion"** | **P0** | **Another patient's identity prefilled into the report being signed; the queue advanced on a study that was never written** | **CONFIRMED (runtime + request level) → PR #1058, owner approved** | `finalizeStudyIdAuthority.request.test.ts` 4/4 + `finalizeFalseSuccess.hardening.test.ts` 25/25 on real PostgreSQL; the row-id-as-billed-id collision measured on the fixture (`GET /from-study/4 -> 404` where the billed study is 306) | **#1058** (Draft, head `4327ce4f` + merge of main) | **green** — all 3 jobs on `8a72cd84` | no | no |
| **RIS-015** | **The workspace said "Report signed" for a report with no signature** | **P1** | **A radiologist believes an unsigned document is signed, prints it and sends it** | **REPRODUCED IN CHROMIUM → CORRECTED → PR #1058, owner approved** | `signedReportWitness.request.test.ts` 7/7 on real PostgreSQL; `signedReportDisplayState` client suite 29/29; **mutation battery 15/15 killed** (clean-tree control green first); chip read in Chromium for all three states + in-app switching + withdrawal before/after | **#1058** | **green** — all 3 jobs on `8a72cd84` | no | no |

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

## RIS-010 — archive transaction and retry safety (P1)

### Stage — recorded separately, because they are not the same claim

| Stage | Status | Evidence |
|---|---|---|
| CONFIRMED | yes | five behaviours measured against real PostgreSQL in `pacsArchive.transaction.request.test.ts` at `877701f9`, not inferred from source |
| RULED | yes | the owner's six approved decisions, 2026-10-17 (transcribed below) |
| IMPLEMENTED | yes, on `main` | `fix/ris010-archive-transaction-rules`, commit `7ac9662a`, **PR #1050** — 8 files, no migration, no new table, no new flag. The post-merge compatibility audit then needed **two more corrections**, merged as **PR #1053 → `9664a967`** (code commit `52434abb`) |
| TESTED | yes, locally | **21/21** request-level cases (13 enforcement + 8 compatibility) + **243** tests across the 13 affected files + **26**-mutant battery + real-Chromium UI probe **8/8** |
| CI GREEN | **yes for this queue's own work; #1053 is blocked by main, not by itself** — see the CI note under this table | All three jobs success. The suite line, read out of the Actions log rather than taken from the green tick: `Test Files 1086 passed \| 5 skipped (1091)`, `Tests 14569 passed \| 49 skipped (14618)`, and the specific line `✓ artifacts/api-server/src/lib/pacsArchive.transaction.request.test.ts (13 tests) 2501ms` — **13 executed, not skipped**, on CI's `postgres:16-alpine`, with `DATABASE_URL: ***localhost:5432/care_test` printed by the job. `pacsArchive.reportScope.request.test.ts (13 tests)` and `pacsArchive.d8.test.ts (3 tests)` also ran green there, so the enforcement suite is proven on the CI version too, not only on this box's 18.3. **#1053 (the audit follow-up) is green the same way** — 20 tests executed on `c1d868a1`, and again on `376153a2`. |
| MERGED | **yes for both passes** | #1048 merged as `1394ab79` ("measured, no fix"); **#1050 merged as `1a93e4e4`**, closed by the owner 2026-10-17 03:00Z. It was created Ready by the operator's own tooling — `PATCH {draft:true}` and `convert-to-draft` are both refused with this token, so the standing "Draft" instruction could not be honoured on that PR. The **audit follow-up is open as Draft PR #1053**, and is the first thing the owner should read below, because it changes two of the sentences #1050 shipped |
| DEPLOYED | no | the NAS is not reachable from this session; `deploy-synology.sh` was not run |
| CLINICALLY VERIFIED | no | nothing has been observed in the clinic |

**Then main went red, and it is not this queue's red.** #1053 was rebased onto `origin/main` for the
owner's closeout check (main had moved by exactly one commit, `0bca78ca` *"Fix nginx crash: default_type not
allowed in if context"*, touching only `docker/nginx.conf`). After that rebase the `Tests + migration smoke`
job fails on **one** case: `nginxLegacyLedgerResetBlock.test.ts > default_type is scoped inside the if, so
proxied 502s keep their own type` (1 failed / 13 passed in that file; the job reports
`Tests 1 failed | 14576 passed | 49 skipped`). Measured, not inferred: **main itself is red at `0bca78ca`**
and green at its parent `14109b8d`, and `git diff origin/main -- docker/nginx.conf
artifacts/api-server/src/lib/nginxLegacyLedgerResetBlock.test.ts` is empty in this branch, so #1053 touches
neither file. The crash fix moved `default_type application/json;` from inside the
`if ($legacy_ledger_reset_blocked)` body up to location level — which is what nginx accepts — while the
guard test still pins the old placement **and** the property that placement bought: with `default_type` at
location level, an nginx-generated 502 (a recreated api container) is announced as JSON while its body is
HTML. That is a decision for the owner, not a test to delete. **How it resolved:** main was fixed by **#1059**
(`71f68479`), which re-pinned the guard to the placement nginx actually accepts — location level, proven
outside the `if`, one occurrence file-wide, plus the exact directive text — and CI is green on main again.
A parallel branch here (`fix/nginx-default-type-placement`, PR **#1060**) reached the same structural
conclusion independently; #1059 landed first, so **#1060 was closed superseded rather than merged** and
`docker/nginx.conf` was left untouched.

One claim from that exchange is recorded because it will otherwise be re-litigated: `default_type` does
**not** apply to nginx's built-in error pages. Read from the source,
`ngx_http_special_response_handler()` clears the type and `ngx_http_send_special_response()` assigns
`text/html` explicitly, and `ngx_http_special_response.c` contains no reference to `clcf->default_type`
anywhere. `default_type` reaches a response through `ngx_http_send_response()` — what `return` with a text
body calls, which is why the 410 refusal is JSON — and through static-file handlers, i.e. the path a
*custom* `error_page` file would take. So the crash fix cost no 502 property. **This is a source read, not
a measurement** — there is no nginx or docker on this box or in CI — and it is checkable in two commands on
a disposable container: `curl -si -X POST …/api/ledgers/2/reset` expecting 410 + `application/json`, and
the same against any `/api/` path with the api container stopped expecting 502 + `text/html`. If the second
prints JSON, this paragraph is wrong and the guard's comment is right.

**#1053 was then closed out on a green main**: rebased onto `3d54c552` (which pulled in #1059's test file and
#1054's canal-AP work only, leaving this PR's four files byte-identical), CI green on the final head
`00fe117e` with `✓ pacsArchive.transaction.request.test.ts (21 tests) 5155ms` executed on
`postgres:16-alpine`, marked ready, and **squash-merged as `9664a967`**. `git diff origin/main HEAD` after
the merge is empty, so main's tree is exactly what was reviewed. **Still not deployed and not clinically
verified** — the clinic's archive behaviour changes only when `deploy-synology.sh` runs.

**MERGED is not DEPLOYED. DEPLOYED is not CLINICALLY VERIFIED.** The clinic's archive behaviour is
still the one described in the "What #1048 measured" section below until #1050 **and** the audit
follow-up deploy — which also means the two regressions recorded below are **not** live at the clinic
today; they were introduced and corrected between merges, entirely inside `main`.

### What the owner ruled, and the smallest change that implements it

| Decision | Ruling | Implementation | Mechanism reused |
|---|---|---|---|
| 1 | only a finalized **signed** report may be archived | `evaluateArchiveEligibility()` runs before the PDF is rendered and before any POST; a draft, a superseded revision, a missing `StudyInstanceUID` or a non-compliant obstetric Form-F all refuse | the product's own `planUsgPacsReturn` + `isObstetricUsgStudy` + `checkPcpndtFormFCompliance` — **no second policy** |
| 2 | nothing is filed when there is no eligible report | `"No report body text entered."` and the `prelim_report` fallback are gone; a refusal writes `pacs_archive_status='refused'`, the reason and block list into the response, and `PACS_ARCHIVE_REFUSED` to the audit log, and deliberately keeps `pacs_instance_id` (an earlier accepted object still exists) | existing columns + existing audit log |
| 3 | ordinary Retry must not create a second copy | the guard keys on `radiology_pacs_archive_revisions` for the revision actually being served: already-`success` ⇒ no render, no POST, existing instance id returned, `idempotent:true`, and the study summary rebuilt **from the revision row** so status/audit/record/job result agree; a failed attempt still uploads; an amendment still archives | the existing per-revision record as the idempotency key |
| 4 | a separately authorized restore, only if safe | one more action on the existing admin `/repair` route: `restore_archived_report` — `requireAdminRole`, dry-run by default, `confirmToken`, reason ≥ 10 chars, `affected` preview stating `willBypassDuplicateGuard`, and it deletes no history. It is the **only** bypass of the duplicate guard | the existing repair-route convention |
| 5 | two concurrent runs cannot both upload | `withStudyArchiveLock()` — `pg_try_advisory_lock(hashtext('care_pacs_archive_study_<id>'))` for the whole run; the loser writes an `ARCHIVE_IN_PROGRESS` refusal and nothing else | the exact shape `emergencyNasClient.ts:99-117` already uses, on the `pool` `@workspace/db` already exports |
| 6 | Orthanc accepted + ERP write failed must not invite a duplicate | write order reversed: revision row first, then the supersede sweep (logged, not fatal), then the study summary; a failure in either record returns `ARCHIVE_ACCEPTED_BUT_UNRECORDED` **carrying the instance id** instead of a plain `failed` | the existing revision table + `decideFailure`'s permanent-failure class so the durable queue stops retrying it |

The signature detail that decides whether any of this works: `POST /api/patient-reports/:id/sign` sets
`signedAt` and leaves `status` at `pending_verification` (`patient-reports.ts:2569-2574`), which is **not**
in `planUsgPacsReturn`'s `FINAL_STATUSES`. The archive therefore maps `signedAt ? "signed" : status`.
Feeding the raw status would have refused every freshly signed report in the clinic — the reuse the owner
asked for, applied naively, would have stopped archiving altogether.

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
| The durable re-archive job is restart-safe: an already-archived revision is a **no-op** (`radiologyJobHandlers.ts`, the `pacsRearchiveHandler`'s DUPLICATE-EFFECT GUARD — line 197-205 at `877701f9`, 217 after #1050), verified by enqueueing a real `radiology_pacs_rearchive` job and running a real `runRadiologyJobTick` — job outcome `success`, zero extra DICOM POSTs | case 3 |
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

### The five gaps — what was MEASURED at `877701f9`, and what #1050 does with each

> The wording below is the measurement record: each item states what the code did **before** #1050, so
> the audit trail stays readable. Each ends with its present status. The suite no longer asserts these
> as today's truth — it now asserts the rule, with the positive controls (a signed report archives, a
> failed upload really retries, an amendment really files a new object, legacy finals really stay
> eligible) still archiving for real.

1. **A second run on one revision writes a second DICOM object that nothing treats as a duplicate.**
   The duplicate-effect guard lives in the **job handler**, not in `archiveReportToPacs`, so every
   caller that reaches the function directly bypasses it. Two runs → two POSTs; because the revision
   record is upserted on `report_id`, the study row and the revision row both end up naming the
   **second** instance while PACS holds two. The first instance is remembered only in
   `radiology_audit_log` (two success rows, two distinct `instanceId`s — asserted, so the audit trail
   is genuinely the surviving record). Case 3.
   **After #1050: closed.** DECISION 3's guard is in `archiveReportToPacs` itself, so every caller gets
   it, and the study summary is rebuilt from the revision row rather than overwritten by a second
   object. Case 4 now asserts one POST, one revision row, one success audit row, and an
   `PACS_ARCHIVE_IDEMPOTENT_NOOP` entry.
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
   **After #1050: closed.** A study-scoped `pg_try_advisory_lock` now spans the whole run; case 6 makes
   the render take 150 ms so both runs are genuinely inside it, and asserts exactly **one** POST, the
   loser's `ARCHIVE_IN_PROGRESS` refusal, that the refusal stays *retryable* in `decideFailure` (unlike a
   no-report refusal — that difference is why there are two codes), and that a third run after the
   winner finishes gets the idempotent answer. Mutant **N3** (lock always grants) is detected by that
   case; **M10** still survives, which is the point: the `pending` write excludes nothing, the lock does.
3. **Reachable from the ERP over HTTP.** `POST /api/radiology/studies/:id/archive-retry` answers
   `200 {success: true}` and performs that second upload, with no finality, eligibility or
   duplicate-effect check in the route; the mount's only gate is
   `requireStaffPermission("/radiology")` (`routes/index.ts:888`). Case 7.
   **After #1050: closed at the route, because the route forwards the outcome object unchanged** — case 4
   drives `POST /api/radiology/studies/:id/archive-retry` over HTTP and asserts
   `{success:true, idempotent:true, instanceId}` with zero additional POSTs, so the button cannot reach
   the duplicate any more than the direct call can. The gate is the canonical function, not the route.
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
   **After #1050: closed, and this is the item that needed the owner's ruling rather than a cleverer
   filter.** Case 2 refuses a draft before anything is rendered — zero POSTs, zero revision rows, a
   `PACS_ARCHIVE_REFUSED` audit row, and the durable job for the same study ends `abandoned` because
   `PACS_ARCHIVE_REFUSED` is now a permanent failure class; signing the same report then archives it.
   Case 8b refuses a **retired** revision in the one shape that entrypoint can actually reach (the bound
   row superseded by an amendment whose own `study_id` is in the other half of the shared id space), with
   the version mode named rather than flag-defaulted; mutants **N1, N7 and N8** are detected by those two
   cases.
5. **A study with no report row files the placeholder and leaves no revision record.** The fallback HTML
   puts `No report body text entered.` into the DICOM object, the run records
   `ORTHANC_UPLOAD_SUCCESS`, and `radiology_pacs_archive_revisions` has **zero rows** for that study —
   the record is written only `if (v)` (`pacsArchive.ts:330`) and no version resolved — so the table
   that answers "what did we file for this study?" is empty while PACS holds an object, and the success
   audit row carries no `deliveredReportId`. This is the owner-decision-(b) case, now with its exact
   behaviour pinned. Case 6.
   **After #1050: closed, and the placeholder no longer exists in the file.** Case 3 asserts a
   `no_report` refusal, no render, no POST, no revision row, and — because the stubbed rasteriser records
   what it was handed — that the forbidden sentence reaches **no** document the study ever rendered.
   Decision 4's restore cannot archive around it either: a restore of an empty study is still refused.
   **One consequence kept honest rather than smoothed over:** a legacy free-text final
   (`radiology_studies.final_report` with no `patient_reports` row) is still eligible — case 12 proves it
   archives and that its text is what was rendered — but it has **no revision identity** to key the
   duplicate guard on, so re-archiving one uploads again. The case asserts the missing revision row
   rather than pretending otherwise. Giving it an identity is an architectural decision (the revision
   table's key is a `patient_reports` id), not a correction inside RIS-010.

### Still not measured (stated as such in the test file header, so nobody reads them as proven)

* **Orthanc accepted, ERP write failed — the runtime half is STILL unmeasured after #1050.** The order is
  now provably right by reading (revision first, then summary) and the recovery from that state is
  asserted (case 11: a revision recorded `success` with a lost study summary is repaired from the revision
  row and never re-uploaded, and `ARCHIVE_ACCEPTED_BUT_UNRECORDED` is classified permanent so the queue
  will not blindly retry). What is NOT asserted is the throw itself: no test can make either write fail
  after acceptance. All the columns involved are unbounded `text`, so there is no data-shape fault to
  induce, and the only remaining lever is a temporary trigger on `radiology_studies` — a table every other
  suite in this repo shares, and the repo runs table censuses. Mutant **N10** (replace the accepted-but-
  unrecorded branch with a plain failure) survives, and that survivor IS the evidence for this sentence.
  If the owner wants this closed, the honest route is a narrow `__forTesting` seam in the archive module,
  not a trigger.
* **The job handler's own early-exit guard is now untested.** Mutant **M7** (delete it) survives because
  the archive-level guard covers the same case: what remains of that line is a cheaper no-op, not a
  second safety property. Kept, but nobody should read it as tested.
* **`DRAFT (not signed)` is asserted by nothing.** The label is produced at
  `patient-reports.ts:3288-3290`; the only two places a test mentions it are
  `reportPresentation.test.ts:98` and `reportPresentation.reportingScope.test.ts:43`, and both pass their
  **own** stamp fixture rather than reading that source. Mutant **M5** (rename it) therefore survives.
  Since DECISION 1 makes a draft unreachable from the archive, this cannot be covered from here — it is a
  presentation-layer gap, recorded rather than fixed inside RIS-010.
* **Revision/audit writes no longer swallow their own errors on the archive path** — the revision insert's
  `.catch(() => undefined)` became a real failure return under DECISION 6; the success audit row is still
  best-effort by design, and the supersede sweep logs and continues because a failed sweep does not mean
  the object was lost.

### Verification numbers for the correction pass (measured 2026-10-17, scratch PostgreSQL 18 at
### 127.0.0.1:5445, `TZ=UTC`, `--maxWorkers=1`)

| Check | Result |
|---|---|
| The enforcement suite | `pacsArchive.transaction.request.test.ts` **13 / 13** |
| Consolidated run over every file the change can reach | **229 tests / 13 files, 0 failed** — `pacsArchive.d8`, `pacsArchive.reportScope.request`, `radiologyJobRules`, `radiologyJobs.claim.request`, `radiologyReportVersion`, `usgPacsReturnPolicy`, `usgPacsReturnService.integration`, `routes/usgPacsReturn`, `legacyReportAuthority.test`, `legacyReportAuthority.request`, `authoritativeReportingSurface.contract`, `canonicalWorkspaceRouting` |
| Mutation battery (`tmp/ris010-mutation-check.mjs`, gitignored) | baseline green **13/13** first, then **20 mutants, each byte-verified as applied**: **15 DETECTED with the owning case named**, **5 EXPECTED-SURVIVE** (M5, M7, M8, M10, N10 — each explained above), **0 unexplained**, `ALL MUTANTS ATTRIBUTED` |
| Two existing tests changed | `pacsArchive.d8.test.ts`: the case that asserted a historical archive *succeeds and is labelled SUPERSEDED* now asserts it is **refused**. `authoritativeReportingSurface.contract.test.ts`: the archive reader is pinned as `String(study.finalReport ?? "")` **and** `.not.toContain("study.prelimReport")` — strictly stronger than the assertion it replaced. Both are recorded in the PR, not silent |
| ERP source-contract tests that read this component's text | `canonicalWorkspaceRouting` 32/32, `authoritativeReportingSurface` 91/91 |
| Real-Chromium UI probe | **4/4** as expected (`tmp/ris010-ui/A-refused.png` … `D-archived.png`); **control run against the pre-correction JSX: 2/4** — a `refused` study rendered no badge and no Retry button at all, and an already-archived revision toasted "Report successfully archived to PACS!". Scratch probe files deleted; `git status` shows only the eight shipped files |
| Typecheck | `api-server` **58 errors — the pre-existing baseline, none in a touched file**. `diagnostic-erp` **61 before this change and 61 after** (measured by swapping in `HEAD~1`'s copy of the same file), i.e. zero added; the failures are the duplicate-`@types/react` class AGENTS.md describes and none is in `RadiologyCommandCenter.tsx` |
| One failure is NOT attributable to this work | `aiQueryContract.test.ts` fails on this box because it compares a **Windows absolute path** against `"lib/aiReportingClient.ts"` (`:52-54`), so the exclusion never matches and the allowed file reports as an offender. It runs no code this PR touches; left alone rather than widened into this PR |

> These are the **correction-pass** numbers, kept as measured at the time. The post-merge compatibility
> audit below supersedes them: the same file now runs **20** cases, the battery has **26** mutants, the
> browser probe has **8** cases, and the typecheck baseline was re-measured against `main`'s own copies
> (98 before / 98 after — the earlier "58" was main before #1049 landed).

### Post-merge compatibility audit of the policy #1050 enforced (the owner's eight points, measured on `main` at `1a93e4e4`, 2026-10-17)

Every point below was answered by **running** the real-PostgreSQL request suite against `main`, not by
reading the diff. Six points were already sound — their cases pass on `main` with no source change, so
they are recorded as verification, not as work. **Two were demonstrated regressions**, and only those
two got code.

| Owner's question | Verdict | Measured how |
|---|---|---|
| 1. A missing `StudyInstanceUID` must prevent an unsafe PACS association but must **not** block ordinary signing or printing | **SOUND** (case V1) | the real `POST /api/patient-reports/:id/sign` returns 200 and leaves `status='pending_verification'` with `signedAt` set, and the read surface the reporting screen and the print path use (`GET /api/patient-reports/:id`) returns 200 for that report. Nulling the UID afterwards changes **no** byte of the report row and only the archive refuses, with `no_study_uid` and zero POSTs. Stated exactly: printing is untouched **by construction** — the gate lives inside `archiveReportToPacs`, which no print or read path calls — and no browser print was performed, because nothing is deployed |
| 2. Obstetric Form-F restrictions use the existing statutory compliance policy | **SOUND** (case V2) | the archive calls the same `checkPcpndtFormFCompliance` the USG return service calls — no second policy. An **MRI with zero Form-F rows archives** (the restriction cannot reach a non-obstetric study); an obstetric USG is blocked on a `pcpndt*` reason and unblocks as soon as one compliant `form_f_records` row exists, uploading then, not before |
| 3. A refused archive displays the actual reason for refusal | **REGRESSION → fixed** (case V3) | see below |
| 4. Superseded reports cannot replace the current official signed report | **SOUND** (cases V4, 8b) | the refusal writes status/response only — `pacs_instance_id` survives it (mutant **N15**, which nulls it, is killed by V4); a retired revision is refused outright; and because the pick is newest-first this entrypoint cannot reach a superseded root row at all |
| 5. Signed amendments remain archivable as new legitimate revisions | **SOUND** (case V5, with 7+8) | after a `superseded_report` refusal, the study's **current** signed amendment still archives: a new revision row at `sequenceNumber 2`, labelled `v2/2 (amended)`, the root keeping its own instance id |
| 6. Legacy free-text signed reports retain their existing supported workflows | **REGRESSION → fixed** (case V6), **one limitation kept** | see below. Kept, not smoothed: a legacy free-text final has **no revision identity**, so the duplicate guard cannot key on it and re-archiving one uploads again. Giving it an identity means changing the revision table's key, which is an architectural decision, not a correction inside RIS-010 |
| 7. Restore / Re-archive cannot silently create duplicate DICOM objects | **SOUND** (cases V7, DECISION 4) | only `restore_archived_report` bypasses the duplicate guard, and only with `requireAdminRole`, dry-run by default, `confirmToken` and a reason ≥ 10 chars (no token → 400). Each object it accepts gets its own `ORTHANC_UPLOAD_SUCCESS` id, the audit row names the administrator (mutant **N16**, which writes `actor:'system'`, is killed). Honest limit: a **second** authorized restore leaves the earlier instance id named only in the audit log, not in the study row |
| 8. Accepted-but-unrecorded uploads remain visible for administrator reconciliation | **SOUND as far as it can be measured** (case V8) | an abandoned archive job appears in `GET /api/radiology-ops/jobs/dead-letter` carrying the refusal sentence — no SQL. Two limits stated rather than hidden: `listDeadLetterJobs` projects **no `status` column**, so the row is identified by `operationType` + `failureReason`; and DECISION 6's *runtime* half still cannot be forced (mutant **N10** survives by construction, as recorded above) |

**Regression 1 — every refusal said the same thing (owner point 3).** `planUsgPacsReturn` distinguishes
seven blockers; `pacsArchive.ts:462/477/479` on `main` collapsed all seven into
`NO_ELIGIBLE_REPORT_MESSAGE`. Clinically: a study refused because it has no Study Instance UID, or
because PCPNDT Form-F has not been evaluated, was told *"No finalized signed report available for this
examination"* — staff sent to sign a report that is already signed, while the real blocker (an
unregistered UID, an incomplete statutory record) stayed unfixed and the study stayed out of PACS.
Demonstrated byte-exactly by re-installing main's line and running the suite
(`tmp/ris010-control-failures.mjs`, gitignored):

```
FAIL … > V3 — a refusal names the blocker it actually found, not one sentence for every cause
AssertionError: refusal said: No finalized signed report available for this examination.:
expected 'No finalized signed report available …' not to be 'No finalized signed report available …'
Tests  1 failed | 19 passed (20)
```

Fixed by a refusal sentence per `PacsReturnBlockReason`, held **in the archive module** and keyed by the
policy's own codes — the shared statutory policy was deliberately **not** widened (an earlier attempt to
add `reasonMessages` there was reverted as unjustified scope). The stored refusal keeps `blockReasons`
and gains `reasons`; the no-report case keeps the owner's exact sentence; `PACS_ARCHIVE_REFUSED:` — the
prefix `decideFailure` reads to make a refusal terminal for the queue — is unchanged. The Command
Center badge now names the cause (No Study Instance UID / Form-F Hold / No Patient Record / No Signed
Report) and falls back to "See Retry" when the stored response cannot be parsed, with the full sentence
on hover; proved in real Chromium, **8/8**, control against `main`'s component **4/8** (it rendered
"No Signed Report" for a missing-UID refusal — the misdirection itself). The badge's data is **not** a
probe fiction: the panel reads the *detail* query (`RadiologyCommandCenter.tsx:146` →
`GET /api/internal/radiology/worklist/:id`), and that handler already selects `pacsArchiveResponse`
(`internal-radiology.ts:2039`, returned at `:2074`), so the codes the archive stored are what the browser
receives — the stub only stands in for the server, not for a field the server never sent.

**Regression 2 — a federated-bridge legacy final stopped being eligible (owner point 6).** #1050 keyed
the legacy free-text branch on `study.status === "reported_final"` (`pacsArchive.ts:226`), one spelling
of one status. The bridge writes its final through `routes/boundary.ts:369-372`, which stores
`status === "reported_final" ? "reported_final" : study.status` — the caller's `status` is unvalidated and
the study is **not** promoted unless the caller happens to send that exact word. A service that posts a
signed, attributed, dated final without it leaves the study `acquired`, so the report was refused, and
refused with the *missing signature* sentence on top. Same demonstration:

```
FAIL … > V6 — an attributed legacy final delivered by the federated bridge keeps archiving
AssertionError: bridge-delivered legacy final was refused: {"success":false,"refused":true,
"reason":"NO_ELIGIBLE_REPORT","message":"No finalized signed report available for this examination.",
"blockReasons":["no_report"],…}: expected true to be falsy
Tests  1 failed | 19 passed (20)
```

Fixed by keying on what the bridge actually writes — non-empty trimmed `final_report` **and**
`finalReportedBy` **and** `finalReportedAt` — instead of on a status word, with a cancelled examination
still refused (mutant **N11**, which drops that clause, is killed by V6; **N12**, which re-installs
main's status key, is killed by V6 too). Case V6 drives the real
`POST /api/boundary/studies/:accession/report` with `x-boundary-key`, so it is the bridge's own code path,
not a hand-made payload.

**Does the legacy predicate fail closed? Confirmed before merge, and now mutation-proven (case V9).**
Every writer of `radiology_studies.final_report` was enumerated rather than assumed —
`lib/peerReview.ts:85-93` (`finalizeReport`, called from `routes/radiology.ts:2423`),
`routes/internal-reporting-studio.ts:912-918` (writes a `patient_reports` row **and** mirrors the text onto
the billed study), `routes/teleradiologyPortal.ts:224-236` (rejects an empty report at `:214`, attributes
to the authenticated `user.name`), `routes/radiology.ts:1583-1592` (the legacy report-save route's
`stage: "final"` arm, behind `decideLegacyReportWrite`; its `stage: "preliminary"` arm writes only
`prelimReport`), and `routes/boundary.ts:369-372`. Each writes text + reporter + timestamp in the same
statement, so the predicate's three terms are exactly what those writers guarantee. A grep's apparent
sixth writer, `routes/aiReporting.ts:2717`, is a response body, not a write.

Two properties a grep cannot establish were then forced to fail, because they are the ones that matter
clinically:

* **A structured report row wins, always.** `POST /:id/withdraw-signature` clears `signedAt` and sets the
  row back to `draft` (`patient-reports.ts:2968-2970`) but does **not** clear the mirrored legacy text, so
  a withdrawn signature leaves attributed final text sitting on the study. The predicate's first term is
  `!reportRow`, so that text is never consulted while a report row exists: draft + stale legacy text is
  refused with `not_finalized`, nothing renders, nothing posts, no revision row (case V9). Mutant **N17**
  (drop `!reportRow`) is killed by exactly that case — without the guard a withdrawn or half-written report
  could be re-archived from the text it left behind, which is DECISION 1 routed around.
* **Attribution is required, not decorative.** Text with `finalReportedBy` null and a timestamp is refused
  with `no_report` (case V9's second shape), and mutant **N18** (drop `!!study.finalReportedBy`) is killed
  by it. `status !== "cancelled"` still bars a cancelled examination whatever its columns hold — mutant
  **N11** is killed by V6.

Relative to `main` the admitted set moved in one direction only: the word `reported_final` is no longer
required, which is what re-admits the federated bridge's finals and a study already `delivered` to its
patient. Every state `main` accepted still passes case 12.

**Numbers for the audit pass** (scratch PostgreSQL 18 at `127.0.0.1:5445`, `TZ=UTC`, `--maxWorkers=1`):
enforcement suite **21/21**; neighbours **244 tests / 13 files** (api-server 120/11, ERP contract
123/2); mutation battery **28 mutants, each anchor preflighted unique and byte-verified**: **23 DETECTED
with the owning case named + 5 EXPECTED-SURVIVE (M5, M7, M8, M10, N10), 0 unexplained**; browser probe
**8/8**, control **4/8**; typecheck `api-server` **98 before and 98 after** — measured by swapping
`main`'s copies of the two changed files back in, so zero added (the figure this file previously quoted,
58, was main **before #1049** landed; 10 of the 98 are that PR's own `radiologyQuickSelectBoxes.request.test.ts`),
and `diagnostic-erp` **61 = the recorded baseline**, none in `RadiologyCommandCenter.tsx`.

### What #1050 changes that a reviewer or the owner must actually look at

Two of these are visible in the clinic, which is why the PR is not merged on this session's own
authority:

1. **Preliminary and placeholder documents stop arriving in PACS**, and an unsigned draft is refused with
   "No finalized signed report available for this examination." (DECISION 1/2 — as ruled.)
2. **Fail-closed on three states the archive used to accept**: no `StudyInstanceUID`, a non-compliant
   obstetric Form-F, and a study whose only bound row has been superseded. These are consequences of
   reusing `planUsgPacsReturn`, which is what the owner asked for — but he has not seen the list.
3. Retry on an unchanged revision no longer creates a second object, and the badge/toast say so instead
   of claiming a fresh archive.
4. Two staff, or a staff Retry and the finalize trigger, can no both fire on one study: one wins, the
   other is told to try again and the job keeps it retryable.
5. A refusal is terminal for the durable queue; an in-progress refusal is not.
6. No migration, no new column, no new env var, no new flag. Rollback is a revert — the revision table
   this design reads and writes already exists on `main` and is already written there.



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

## RIS-013 — Canal AP diameter: the measurement the radiologist can reach now prints (P1, **merged into `main` as `3d54c552` — NOT deployed**)

**Status (2026-10-17, after the owner's four rulings).** PR **#1054** was squash-merged into `main` as
`3d54c552`, parent `71f68479`, from head `ad90a59a`. All three CI jobs were green on that head first —
Static checks, Tests + migration smoke on real PostgreSQL (**14,656 passed / 49 skipped over 1,089
files, 0 failed**; the Vitest run itself took 710.49 s), Build identity — and the merged tree is the tested tree:
`git rev-parse ad90a59a^{tree}` and `git rev-parse 3d54c552^{tree}` are both `b84b5926`, with
`git diff --stat ad90a59a 3d54c552` empty. The merge changed 31 files, +3,074/-309. `main` was then re-run
green on its own (`3d54c552`: static checks, tests + migration smoke on real PostgreSQL, build identity
all `success`, the tests job completing 09:47:15Z). **Nothing is
deployed**: the clinic keeps running whatever
`deploy-synology.sh` last installed, so no radiologist sees any of this until someone deploys `main`.
The five remaining gaps at the end of this section are the open part of the work.

**What was wrong (measured, `docs/audits/spinal-canal-ap-measurement-audit-2026-10-17.md`).** Two
stores held canal AP diameters and neither wrote the other. The Reporting Workspace grid saves
`structured_json.careCanalApProvenance`; every printed table was built from `spinal_measurements`.
One study showed **8.5 mm** in the grid and an empty table on the sheet. The 13 green canal request
tests all inserted `spinal_measurements` rows directly, so entry was tested and print was tested and
the join — which did not exist — was not.

**Correction.** One builder (`spinalCanalApTable.ts`) reads both stores and the canonical record
decides: `canalApLevelsFromCanonicalRecord` (:148) answers through `canalApValue`, and
`mergeCanalApLevels` (:166) lets the record win, deletes a level the record **declines** (two aliases
disagreeing, or a vertebra that moved under it) instead of falling back to the other store's older
guess, and keeps a level only `spinal_measurements` knows so nothing that printed before stops. All
three signed paths now take it: the create/finalize splice
(`patient-reports.ts:2284`, `:2301`), the structured finalize (`:1027`) and the amendment (`:1681`).
For the two D1 paths the table is pinned in the sanctioned `extensions.x_care_canal_ap`
(`radiologyD1DraftWriter.ts:282`) and emitted by the D4 renderer as its own section
(`structuredReport/renderer.ts:139`, `:339-344`), so the stored signed body stays byte-identical to a
re-render (`compareStoredVsRendered` → IDENTICAL) rather than becoming an unexplained clinical
difference; `STRUCTURED_RENDERER_VERSION` → `d4-structured-1.1.0` (:42), and the five §17 golden
digests are untouched because the extension is omitted when there is no measurement. Transitional
levels (`L5-T`, `L5-L6`, `L6-S1`) print in anatomical order. The draft preview passes the same record
(`radiology-report-generator.ts:2357`).

**One entry point (UI).** The lumbar grid was mounted twice in the same rail — Structure pane and
Measure pane — while cervical and dorsal were Structure-pane only. All four tables now mount once
inside a collapsed **AP Canal Measurements (mm)** panel on the Measure tab
(`ReportingToolsRail.tsx:982-1003`), gated on the same four predicates with the same full argument set
the canvases use (`:508-519`) and the same content lock; a study that earns no table says so instead of
showing an empty grid. The false comment claiming Brain's palette renders in the report body is
replaced with what is measured: those mounts live only inside the retired `{false && (` block
(`ReportCanvas.tsx:1044-1433`), which is why `mriBrainCanvasPlacement.test.ts` can be green over UI
that renders zero elements.

**Measured.** 285 tests / 16 api-server files green on real PostgreSQL (canal + `structuredReport` +
D5/D6/D7/D9); ERP canal suites 62/62. Chromium against the running app: the panel is reachable on the
Measure tab for LS (5 inputs), cervical (6) and dorsal (11), collapsed by default, and a typed value
survives Save Draft + reload; switching examinations does not mix values (11.1 lumbar / 22.2 cervical
each kept their own, and the other study's field is not present). The signed **PDF bytes** were taken
from `GET /api/patient-reports/:id/pdf` (681,166 B) and extracted with `pdftotext`: the heading, the
level row `L1-L2 … L5-S1` and `AP (mm) -- -- 15.2 6.4 8.1` are all in the printed page. Mutants: M1a
canonical override removed → **13 named failures**; M1b the D1 pin removed → **6 named failures**; M2
one canal gate disconnected → the mount-once guard red. `tsc` caught two things the tests could not:
the amendment transaction had lost its `let materialized` declaration (every
`POST /:id/amend` would have thrown), and `FinalWorklistRow` had no `studyId` to read the rows with.

**NOT RUN / limitations.** The **Dorso-Lumbar** entry point is unproven in a browser: this local
database has no dorso-lumbar reporting format, so neither the DL canvas nor the DL table mounted —
identical before and after the change, and the local worklist fixture names the exam
"MRI Dorso Lumbar Spine" while the clinic books "Dorsolumbar Spine" (35 such rows). Whole-spine and
screening bookings resolve no disc-level table at all, which is the reporting-context predicates'
existing decision, not a new one. OHIF caliper → level capture was NOT RUN (no PACS reachable).
Full-suite parity is **delegated to CI**: on this workstation the radiology signing request suites are
order-dependent against the shared scratch database — the same three files failed 20 tests at
`origin/main` and 13 at this branch with different membership, while each file is green in isolation
(`finalizeIntegrityGuard` 7/7 twice on both, `linkedSiblingReportFinalize` 6/6,
`signedArtifactTrust` 24/24, D5 17/17, D9 24/24). The local typecheck number is likewise unusable as
an absolute: the worktree's `lib/*` packages are unbuilt, so 2,179 of 2,180 diagnostics are the
TS6305/TS7006 cascade; only the errors named above sit in touched files.

**Owner decisions (2026-10-17) — all four ruled, all four implemented, and merged in `3d54c552` (31
files, +3,074/-309).**

**DECISION 1 — one combined Dorso-Lumbar table.** *"Fix the existing renderer so that every valid
measured dorsal and lumbar level appears in the signed report. Use one combined table. Do not select
only the most-filled segment. Do not invent values for unmeasured levels. Preserve canonical
vertebral numbering, including transitional anatomy. Do not create another table generator."*
Done inside the existing builder — `renderCanalApTable` (`spinalCanalApTable.ts:140`) now draws the
columns from `canalPrintPlan` (`lib/measurements/src/spineCanal.ts:230`), and the most-filled-segment
chooser is deleted from both sides (the server's chooser and the ERP's `pickPrintCanalSegment` /
`canalApTableHtml` / `canalApReportTable`). A plan is built from the levels that were *measured*:
columns in head-to-tail anatomical order, one section, and one title naming the span. Measured on the
signed artifact: a Dorso-Lumbar study with D6-D7, D10-D11, L2-L3, L4-L5 and L5-S1 prints
`DORSO-LUMBAR CANAL AP DIAMETER AT D1-D2 TO L5-S1 LEVELS` with all five levels carrying their numbers —
which is exactly the case that used to print a lumbar-only table and lose both dorsal discs. An
unmeasured level keeps its column but no value (the printed em-dash is the pre-existing shape, asserted
in V1). Transitional keys (`L5-T`, `L5-L6`, `L6-S1`) stay in the plan, and the junction level `D12-L1`
appears only when measured. The workspace's own PDF uses the same plan
(`canalApToPdfRows`, `spineCanalAp.ts:250`) instead of a segment of its own.

**DECISION 2 — measurements entered after Generate must still print.** *"Remove the unsafe
phrase-based deduplication condition. Use exact structured-table identity or the existing rendering
mechanism."* Two mechanisms were removed, and nothing was added in their place:
- the server's phrase rule (`if (body.includes("canal AP diameter")) return body;`) is gone from
  `insertCanalTableIntoBody` (`spinalCanalApTable.ts:227`); dedupe is now structural —
  `hasRenderedCanalApTable` (`spineCanal.ts:413`) says a body that already prints a canal table
  *carrying a number* is left alone, and `stripUnmeasuredCanalScaffold` (`:422`) removes a blank grid
  so the authoritative table replaces the placeholder instead of sitting beside it;
- Generate no longer writes a canal grid into Findings at all (`store.ts:1958-1964`), which was the
  actual blocker: the grid it appended read as an already-printed table, so the print renderer
  correctly declined to touch the body and every measurement taken after that press was locked out.
The canal table is now the print renderer's job on all four surfaces the owner named — Preview,
Finalized report, Signed PDF, Amendment — and one entry point can no longer silence another.

**DECISION 3 — one measurement entry point, and an audit before anything is removed.** The live
control is **Measure → AP Canal Measurements (mm)** (`ReportingToolsRail.tsx:982-999`), one section,
four tables gated by the same predicates the canvases use (`:508-520`). The old ReportCanvas grids are
**kept disabled, as ruled**: both `<SpineApCanalMeasurements>` mounts (`ReportCanvas.tsx:1168`, `:1232`)
sit inside the `{false && (` legacy-assistance block (`:1044-1433`) and render nothing. That is a
claim about JSX, so it is now a test with a false-positive control —
`workspace/canalApEntryPoints.contract.test.ts` (11 tests) proves the slice really is the retired
block, and proves that swapping `{false && (` for a flag flips the verdict to two live grids.
**The AI-tab measurement box is NOT a duplicate and stays.** Censused from the tree: it is the only
file that calls `recordCanalApViewerValue(` — the sole path by which an OHIF caliper number enters the
canonical record the signed report prints from — and the only writer of the legacy
`spinal_measurements` rows reachable while reporting (`SpineCanalApBox.tsx:258`), rows the print fold
still reads (`useWorkspaceExportShare.ts:303`). The owner's condition ("only after proving no existing
saved measurement or reporting workflow depends on them") is therefore **not met**; deleting the box
today would cost viewer capture and leave stored legacy numbers uncorrectable. Note the legacy
generator page keeps its own unrelated panel (`SpinalMeasurementPanel.tsx:103`, mounted at
`RadiologyReportGenerator.tsx:1903`) — outside this ruling's scope, and the reason the legacy store is
not empty.

**DECISION 4 — Composer: interface handed over, code untouched.** *"Do not modify Composer code.
Provide Qwen-Max with the exact canonical measurement interface and recommended read-only projection.
Do not allow Composer to write back into the measurement authority."* Verified at merge time: `git diff
71f68479 3d54c552 --name-only -- artifacts/api-server/src/lib/reportComposer` is **empty**, and no
Composer file appears among the 31 files the merge changed.

The canonical interface, exactly as it exists today:
- **Where**: `radiology_report_drafts.structured_json.careCanalApProvenance` — an object keyed by
  **canonical** level, one `CanalApMeasurement` per level (`lib/measurements/src/spineCanal.ts:437`).
  Fields that matter to a reader: `level`, `measurementId: "CANAL_AP"`, `unit: "mm"`,
  `region` (lumbar | cervical | dorsal), `viewerValue`, `reportValue`, `manualOverride`,
  `staleReason`, `aliasConflict`, plus the DICOM anchor
  (`studyInstanceUID`/`seriesInstanceUID`/`sopInstanceUID`/`frameNumber`) and `capturedAt`.
- **The only permitted read of a value** is `canalApValue(rec)` (`:488`): `reportValue` if the
  radiologist chose one, else `viewerValue`; **`null` when `aliasConflict` is set or
  `staleReason === "level_renumbered"`**. `null` is an answer — the record *declines* — and a reader
  must not fall back to another store or to its own guess. `printCanalApValue` (`:132`) renders it
  without turning an empty cell into `0`.
- **Level-by-level, no hand-rolling**: `canalApLevelsFromCanonicalRecord(raw)` (`:149`) returns
  `Map<canonicalLevel, string | null>`; `mergeCanalApLevels(serverByLevel, canonicalByLevel)` (`:168`)
  is the fold every print surface uses; `canalPrintPlan(measuredLevels)` (`:230`) gives the columns,
  their order and the section title.
- **Vocabulary**: `LUMBAR_CANAL_LEVELS` (:20, 5), `CERVICAL_CANAL_LEVELS` (:30, 6 — no C1-C2, there is
  no disc there), `DORSAL_CANAL_LEVELS` (:39, 11 in **D** form) plus `DORSAL_JUNCTION_LEVEL = "D12-L1"`
  (:49) only when measured, and the transitional keys above. `T8-T9` and `L4-5` are accepted *inputs*
  only; `canonicalizeCanalLevel` (:76) decides, and only canonical keys may be persisted or displayed.
- **No write-back** (`:11-15` states the rule). The only writers are the workspace store's
  `recordCanalApViewerValue` / `recordCanalApManualValue` (`store.ts:3183`, `:3194`) and the draft
  writer; both refuse when the content is locked (`refuseSignedMutation`).

Recommended read-only projection for the Composer — additive, and the only shape that cannot fabricate:
```jsonc
"canalAp": [                                  // omit the key entirely when nothing was measured
  { "level": "L4-L5", "valueMm": "6.4", "segment": "lumbar", "source": "radiologist-entered" },
  { "level": "L5-S1", "valueMm": "8.1", "segment": "lumbar", "source": "viewer-caliper" },
  { "level": "L3-L4", "valueMm": null,  "segment": "lumbar", "declined": "level_renumbered" }
]
```
`valueMm` is `printCanalApValue(canalApValue(rec))` — string, never re-parsed; `source` is
`rec.reportValue != null ? "radiologist-entered" : "viewer-caliper"`, because `applyCanalManualValue`
(`:656`) is the only thing that sets `reportValue`, and clearing a cell resets both it and
`manualOverride` back to the viewer's answer; a declined
level is listed with `valueMm: null` and its `declined` reason so the model is told to say nothing
about that disc, rather than being silently handed a record it might paraphrase into a number. The
prompt must be given the printed order from `canalPrintPlan`, and the model must be told the table is
already rendered by the report — it should not restate every level in prose (that is how a canal
number ends up in two places with two spellings).
**What this replaces, and the gap it leaves**: today the Composer scrapes unit-bearing numbers out of
prose (`buildRadiologistDraftContext.ts:60` `MEASUREMENT_RE`, `:82` `extractMeasurements`, surfaced at
`:287` as `measurements`), and `validateOutput`'s measurement rules (`:617`, `:661`, `:1106`) compare
against that same scraped bag. Since DECISION 2, canal numbers are *not* in the prose Generate writes,
so until the projection above is wired, a grid measurement is invisible to Generate/Refine and to the
measurement-loss validators — clinically safe (the pinned table `extensions.x_care_canal_ap` prints it
regardless, and the model cannot rewrite it), but the Composer cannot yet *use* the number it used to
copy. Handoff to the Composer owner; nothing on this branch changes it.

**The ten required verifications, run against rendered output.** Cases 1-5, 7, 8 and 10 are in
`artifacts/api-server/src/routes/signedReportCanalMeasurements.request.test.ts` on real PostgreSQL
(20 tests), and every one reads the **printed artifact** — headers, value cells, title, insertion
point and a structural duplicate-table count from `findCanalApTables` — not a database row.

| # | Case | Where proven |
| --- | --- | --- |
| 1 | MRI LS Spine | `:561` "V1 MRI LS Spine: every lumbar level measured prints, in one table" |
| 2 | MRI Cervical Spine | `:573` "V2 … the cervical grid prints, and C1-C2 is not invented" |
| 3 | MRI Dorsal Spine | `:595` "V3 … dorsal levels print on the dorsal grid, junction included when measured" |
| 4 | MRI Dorso-Lumbar Spine | `:623` "V4 … one combined table, no segment dropped and no second grid" + ERP `generateProfessionalReport.test.ts` (title `DORSO-LUMBAR CANAL AP DIAMETER AT D1-D2 TO L5-S1 LEVELS`, columns `[...DORSAL, ...LUMBAR]`) |
| 5 | Transitional vertebrae | `:648` "V5 …" and `:506` "signs a transitional level that no fixed vocabulary can express" |
| 6 | Save and reopen | `radiologyWorkspaceDraftRoundTrip.request.test.ts:295` "R4. measurements, canal provenance … all land" |
| 7 | Measurement entered after Generate | `:670` "V7 … still signs, even when the prose names the canal" + ERP "writes no canal table into Findings, so a later measurement still prints" |
| 8 | Final signed PDF | `:343` artifact test + `:742` "V8 the signed PDF artifact carries the table the print page carries" |
| 9 | Amendment | `radiologyD1CanalApSection.test.ts:211` "carries the amended draft's measurements and stays reproducible", `:220` keeps the signed section when only prose changes, `:233` leaves the parent byte-untouched |
| 10 | No duplicate tables | `:373` composed body already carrying a table, `:692` blank clinic scaffold replaced, `:718` a valued table is not edited into a second one — each counting `AP (mm)` rows and `CANAL AP DIAMETER` headings, plus `:287`/`:298` on the D1 renderer |

Freeze is a separate property and is still proven: a measurement taken *after signing* must not rewrite
a delivered document (`:355` for `spinal_measurements`, `:467` for the canonical record).

**Remaining gaps (nothing here is a claim of completeness).**
1. **V4 in a browser is still unproven.** This local database has no dorso-lumbar reporting format, so
   the DL canvas and DL table never mount locally; V4 is proven at the request/rendered-artifact level
   and by the ERP's own plan test, not by a click. The clinic books "Dorsolumbar Spine" (35 rows) while
   the local fixture names it "MRI Dorso Lumbar Spine". **Deployed `main` is the first place a radiologist
   can click it** — until someone runs `deploy-synology.sh`, `3d54c552` is not what the clinic is printing.
2. **OHIF caliper → level capture was NOT RUN** (no PACS reachable). The code path exists and is
   exercised by unit tests only.
3. **The Composer still reads measurements from prose** — see DECISION 4; the projection is a handoff,
   and the owner ruled it stays recorded in this register rather than as a separate handoff file, so no
   Composer work is scheduled by it.
4. **Two stores are still two stores at entry time.** Print folds them with one rule; the AI-tab box
   still writes both. Closing that needs viewer capture moved into the rail grid first (DECISION 3
   census above), which is an owner call about UI, not a defect.
5. **`mriBrainCanvasPlacement.test.ts` is still a source-text guard over UI that renders zero
   elements.** DECISION 3 keeps the `{false && (` block disabled, so the merge did not make this worse —
   but the test cannot see a control that stops mounting, which is exactly the failure class that made
   this audit necessary. Turning it into a render check is the natural next unit of work and needs no
   clinical ruling.

*Closed by the merge:* full-suite parity, which this section previously delegated to CI. All three jobs
are green on `ad90a59a` (14,656 passed / 49 skipped over 1,089 files, 0 failed), and the merged tree is
that same tree, so the number is the branch's own and not an inference from per-file local runs.


---

## RIS-014 / RIS-015 — the finalize identity bind, and the badge that said "signed" without a signature (P0/P1, PR #1058 Draft)

Both corrections are on `p0/finalize-study-id-authority`, measured against a scratch PostgreSQL 18 at
`127.0.0.1:5445`, `TZ=UTC`, `--no-file-parallelism`, and against the real Reporting Workspace in
headless Chromium (Vite from this tree on `:5181`, API on `:8097`, same database). Nothing merged or
deployed; nothing on the clinic's server was touched.

**RIS-014** — `useStudyFinalize` passed the workspace route param (a `radiology_worklist.id`) into
`FinalizeStudyContext.studyId`, which every reader treats as a `radiology_studies.id`. The two
sequences overlap by design, so the prefill returned whichever billed study happened to share the
number: `GET /from-study/4 -> 404` on a row whose billed study is 306, and request-level a case where
the colliding study belongs to a *different patient*, whose `testId`/`orderId` then arrived at the
finalize of the patient on screen. The mapping is now one exported builder
(`finalizeContextForWorkspaceStudy`: row id → `worklistId`, queue-row FK → `studyId`, null when
unbilled so the existing auto-link attempt still runs) and the server refuses the mismatched pairing
with typed `ORDER_MISMATCH` / `TEST_MISMATCH` instead of writing it.

**RIS-015** — the completion chip tested `linkedReportId`, which answers "does a report exist", and
wore the word "signed" on a row that was `status = 'draft'`, `signed_at IS NULL`. Reproduced as
`patient_reports` 171 in the browser, with the same finalize's own toast three seconds earlier saying
"Report saved but NOT signed". `signedReportDisplayState()` now decides the wording from the row the
workspace already fetches, asking `rowAlreadySigned()` — the existing client mirror of the server's
single authority `isSignedArtifact()`, so **no second signature authority was created**; the parity
matrix runs the same witness rows through both predicates. Four states, each with its own colour and
remedy: signed (emerald, attributed to the signer of record), saved-not-signed (amber, points at
Report Hub signing), study-final-no-report (rose), and `unknown` for the window where the id is known
and the row has not been read back — which refuses to guess in either direction. The finalize button's
caption comes from the same decision, and every finalize outcome now invalidates
`["workspace-final-report"]`, refusals included.

Evidence: **7/7** request-level witness cases (draft-unsigned reads unsigned at the wire; a signature
block that does not exist refuses and writes nothing; the signer of record is the CHOSEN block, never
a body-supplied name; re-signing is refused with the original instant intact; withdrawal clears the
witness and reopens the study; both doors into the no-report state — the status-only soft-final a
signing role cannot pass, and the unbilled `READY_TO_SEND` finalize the workspace legitimately sends;
two patients side by side keeping their own witnesses); **29/29** client classifier/badge/caption
tests including the `unknown` fail-closed case and the switching sequence; **15/15 mutants killed**
(M1 restore the defect, M2 guess while the row is in flight, M3–M6 mislabel or mis-colour, M7 let a
client flag stand in for a signature, M8–M10 revert the wiring, M11 drop DELIVERED from the closed
test, M11b compute the flag without returning it, M12 remove the invalidation, M13–M14 decouple the
button) with the clean-tree control measured green before any mutant ran; the full `diagnostic-erp`
package at **6900 passed / 1 failed** (`aiQueryContract.test.ts`, a pre-existing Windows path-separator
artifact: its offender list returns absolute paths so the `!== "lib/aiReportingClient.ts"` filter can
never match) and `api-server` at **5889 passed / 6 failed**, five environmental (backup/restore/mwl
filesystem, and `nginxLegacyLedgerResetBlock` which main has since fixed in `0bca78ca`) and the sixth —
`daily-summary.refundDetails.request.test.ts` — proven by control to be shared-database state, not
this change: **it passes 3/3 on a freshly cloned empty schema** and drifts between identical runs on
the shared scratch database, which is the order-dependence this file already records above.

Chromium, from the DOM's own claim (`[data-testid='report-outcome-badge']` →
`data-signature-state`, class, text):

| study | how the state was reached | chip | colour | button |
|---|---|---|---|---|
| 891 | seeded bound draft row, study final | "Report saved — NOT signed" | amber | "Not signed" |
| 889 | **the UI's own Confirm & Sign**: create 201, flip 200, signing declined | "Report saved — NOT signed" | amber | "Not signed" |
| 892 | final with `report_id` NULL | "Study marked final — NO report exists" | rose | "No report" |
| 893 | signed row | "Report signed — Dr. Sole …" | emerald | "Signed" |
| 890 | created, signed and flipped through the API, then withdrawn | before: "Report signed — Dr. Badge …" emerald; after: no chip at all, page says no "Report signed" anywhere | → | after: "Confirm & Sign", enabled |

In-app switching (the queue's own `select[data-testid='queue-jump']`, not a page reload): signed →
unsigned → UI-finalized → back to signed produced `signed / not-signed / not-signed / signed`, each
study fetching its own report row (`/api/patient-reports/1142`, `1141`, `1143`), and no study ever
showed another's attribution.

**The in-session chip after a *successful UI signing* — OBSERVED 2026-10-18** (`tmp/a1-ui-signing.mjs`,
`screenshot tmp/badge/ui-signing-126.png`, evidence `tmp/badge/ui-signing-126.json`), on a study whose
draft the app wrote itself: a scratch database seeded with one synthetic billed CT Brain (worklist row
126) and exactly one ACTIVE signature block, workspace opened, text typed into
`canonical-findings-editor`, Impression produced by the canvas's own `generate-local-impression`, the page
left to autosave, then Confirm & Sign in the same session with **auto-advance switched off**
(`care_auto_advance_after_finalize=false`) — the confound that destroyed the earlier read, which had
already navigated to study 890 before it looked. Request chain: `from-study/122` 200 →
`POST /api/patient-reports` 201 → `GET /api/signatures` 200 → **`POST /api/patient-reports/97/sign` 200** →
`report-status` 200 → `GET /api/patient-reports/97` (the invalidation refetch, not a reload). Chip at 2, 3,
5, 8 and 12 s: `signed` / emerald / "Report signed — Dr. Sole Verify (a1close)" with the lock line
"Locked — corrections need an administrator" and the button re-labelled "Signed" and disabled. The row
agrees: `radiology_worklist.status = REPORT_FINAL`, `report_id = 97`, `patient_reports.status =
pending_verification`, `signed_at NOT NULL`, `signed_by_name = Dr. Sole Verify (a1close)`. The only 4xx in
the run were HOPE/OHIF/DICOMweb paths this scratch stack does not serve (`send-report-to-hope` 409,
`invalid StudyInstanceUID`), none of them on the signing chain.

**Open, and not to be read as fixed:**
1. **SPLIT 2026-10-18 — it was not the fixture draft, and it is not an app defect either.** That run's own
   request log ends the finalize at create 201 → `GET /api/signatures` 200 → flip 200 with **no**
   `POST /api/patient-reports/:id/sign` anywhere in it, and `autoSignReport()` reaches "no sign request"
   on exactly two conditions — no ACTIVE block, or 2+ active with no clinic-radiologist match and no id
   chosen — both decided by the `signatures` table, which no draft row can influence. The app's own draft
   writer is now measured too: scenario 8 of `signedReportWitness.request.test.ts` saves through
   `/api/radiology/report-generator/save-draft` (it derives `worklist_id` **and** `study_id` from the
   resolved worklist row — the one column the hand-written fixture lacked), then creates, signs and flips
   over real HTTP, and the row comes back signed. Two claims in the paragraph this replaces were wrong,
   and are corrected here rather than left standing: the `DRAFT_WORKLIST_MISMATCH` belongs to study **890**
   (the log shows the queue auto-advanced — `worklist-lock/890/claim`, `drafts/241/print-preview` — before
   that autosave), so it was never evidence about the study being finalized; and the scratch database that
   run used no longer exists (no `*.request.test.ts` cluster on `5445` holds rows 889–893), so *which* of
   the two decline arms fired is unrecoverable — which is why both are pinned as tests instead:
   `radiologyReportLifecycle.test.ts` adds the arm that was missing, a retired block chosen in the dialog,
   and dropping `isActive` from the filter kills it plus the pre-existing retired-only arm.
   **No DEF-D PR is owed.** What is owed, and deliberately not taken here: (a) `useStudyFinalize.ts:337`
   types the block list `{ id, name }[]` and never reads `isActive`, and `FinalizeSignDialog.tsx:374`
   renders every block it is given, so a retired signer can be offered — or defaulted to, when the
   remembered id is gone — and the signing then refuses; the picker should filter to active, and
   `GET /api/signatures` must keep answering inactive rows because the admin screen needs them. (b) A
   finalize with no active block still closes the study `REPORT_FINAL`. #1058 makes that state *visible*
   ("Not signed", destructive toast) but blocking it is an owner workflow ruling, not a witness fix.
2. The refusal was again invisible to my toast selector, and the paragraph above is the second time the
   same mistake was made: the selector has now been re-armed (auto-advance off, same page session) and the
   signing chain reads correctly — so what the earlier run "saw" was the *next* study, not the one that
   was refused. A UI check that pins one selector, or reads after the queue has moved, is not a UI check;
   read rendered text, and pin the gesture that keeps the page where it is.
3. `reports-v2/` stays untracked; the nginx guard repair is task **#128** and main has taken it; the
   `daily-summary` order-dependence above is a test-hygiene item, not a clinical one. Measured again on
   the 12 files this PR touches, and it is the same disease: run in parallel against one scratch database
   they red 23 tests with `{"error":"Failed to create report"}` on inserts that all succeed serialized
   (184/184, 12/12 files); run with `--no-file-parallelism` they are green. Request-level files sharing a
   database are not parallel-safe, full stop — main's own `bills.searchFilters.request.test.ts` reds for
   the same reason in a full-suite run.

---

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
5. **RIS-010: the evidence pass is MERGED (#1048 → `1394ab79`) and the corrections are in review
   (#1050, head `7ac9662a`, open as Ready — not by choice: this token cannot convert a PR to draft.
   Measured 2026-10-17 while merging #1054: the opposite direction **does** work, over GraphQL
   `markPullRequestReadyForReview` with the `PR_kw…` node id from
   `repository.pullRequest(number:){id}`; every REST path for it — `POST /pulls/{n}/mark_as_ready`,
   `POST …/mark_ready_for_review`, `PATCH {draft:false}` — answers 404 or a 200 that silently keeps the
   PR in draft.)**
   Do not rebuild the mechanisms it records as VERIFIED, and **do not re-measure the five gaps as if they
   were still open** — each one now has a status line in its own paragraph. Read #1050's CI result, put
   it in the stage table above, then hand the two visible behaviour changes (section "What #1050 changes")
   to the owner. Nothing is deployed.
6. **RIS-007**, **RIS-011**: read-only evidence only; no scanner changes, no production C-FIND/C-MOVE.
7. **RIS-013: all four owner decisions are implemented and MERGED (#1054 → `main` `3d54c552`, CI green on
   the tested tree `b84b5926`) — not deployed. Do not re-derive the two authorities, and do not add a
   second table builder.** Read §RIS-013 first:
   DECISION 1 is one print plan over the measured levels, DECISION 2 is structural table identity with
   Generate no longer writing a grid, DECISION 3 is the rail Measure tab alone with the AI-tab box
   kept because the census proves it is load-bearing, DECISION 4 is a Composer handoff with the
   interface and the read-only projection spelled out and no Composer file touched. The work that is
   left is the five gaps listed at the end of that section — clicking a Dorso-Lumbar study in a browser
   (needs a deployed `main`, or a local database that carries the clinic's "Dorsolumbar Spine" format),
   OHIF caliper → level capture with a reachable PACS, wiring the Composer projection §RIS-013 defines,
   the owner's ruling on collapsing the AI-tab box's two writes, and turning
   `mriBrainCanvasPlacement.test.ts` into a render check.
8. **RIS-014 + RIS-015 / PR #1058 (Draft): both corrections are measured, mutation-killed 15/15 and
   read in Chromium — do not re-derive them, and do not add a second signature authority.** The witness
   is `rowAlreadySigned()` / `isSignedArtifact()`, and the display decision is
   `signedReportDisplayState()`. Task **#134 is SPLIT and closed** (2026-10-18, §RIS-014/015 item 1): the
   unsigned finalize was decided by the `signatures` table before any signing request existed, the app's
   own draft writer is now measured signing end to end, and no DEF-D PR is owed. The one UI claim that was
   never observed — the in-session chip after a *successful* signing — is now observed on an app-written
   draft, with auto-advance off and no reload (§RIS-014/015, the block above the open list). Two things
   are left,
   neither of them a witness question: the sign dialog offers blocks it will then refuse
   (`useStudyFinalize.ts:337` + `FinalizeSignDialog.tsx:374`, unfiltered by `isActive`), and whether a
   finalize with no active block should close the study at all is an owner ruling. Test-hygiene warning
   for whoever runs this suite next: the PR's 12 files red 23 tests when run in parallel against one
   scratch database and pass 184/184 with `--no-file-parallelism`.

**Owner decisions outstanding:** (a) — *answered 2026-10-17* — one signed report may cover several
examinations only when they are explicitly linked, and that ruling is now implemented in PR #1047;
(b) — **ANSWERED 2026-10-17 and implemented in #1050: nothing is archived.** DECISION 2 in his own words
was "if an examination has no authoritative eligible report, DO NOT ARCHIVE ANY DOCUMENT", with an
explicit understandable reason. The placeholder is deleted from the source, a no-report study ends in
`refused` with "No finalized signed report available for this examination.", and case 3 asserts the
forbidden sentence reaches no document; (c) once the NAS is reachable, the null-`study_id` census — if a
large number of historical signed reports carry no linkage, does the refusal need a visible warning path
instead of a hard block; (d) when the rebuilt NAS deployment is available, which commit to deploy and
with which verified backup; (e) — **ANSWERED and implemented in #1050**: DECISION 3 made an ordinary Retry
of an unchanged revision a no-op **everywhere**, including the button, and DECISION 4 gave the
force-a-fresh-object case its own authorized path (`POST /api/radiology-ops/repair`
`restore_archived_report`, admin + token + written reason) rather than leaving it to the Retry button;
(f) — **ANSWERED and implemented in #1050**: DECISION 1 said the general archive must honour the
eligibility authority, and it now calls `planUsgPacsReturn` before rendering. **Two rulings he has NOT
given, discovered while implementing (f)**, both recorded under "What #1050 changes": the reused policy
also fail-closes a study with no `StudyInstanceUID`, a non-compliant obstetric Form-F, or only a retired
revision — states the archive used to accept; and the legacy free-text final, which stays eligible,
cannot be idempotency-keyed because the revision table's key is a `patient_reports` id.

_Last updated: 2026-10-17 (fifth pass) — **the audit follow-up is merged.** The owner reviewed the two
compatibility fixes, accepted the clinical direction of both, and set five behaviours as approved: a refusal
must name the actual blocking condition; a missing `StudyInstanceUID` must not block ordinary signing; the
Form-F restriction stays the existing statutory policy; attributed finals arriving through the boundary
workflow remain archivable; a cancelled examination remains ineligible. Before merge he asked for the
closeout checks — fetch main, check overlap, re-run if a rebase changes code, verify CI on the final head,
**prove no unsigned or cancelled report can reach PACS through the legacy predicate**, and keep the legacy
idempotency limitation in this file. All of it is above: case **V9** plus mutants **N17/N18** are what turn
"the predicate checks `!reportRow`" from a reading into a measured property (a withdrawn signature leaves
its legacy text behind, and that text cannot re-open an archive). #1053 merged as `9664a967` on a green CI
run of its final head. Two side notes recorded where they belong: main's own red from `0bca78ca` was cleared
by **#1059**, and the parallel branch written here (**#1060**) was closed superseded rather than merged, with
the one factual disagreement it carried written up above. **Nothing is deployed and nothing is clinically
verified** — until `deploy-synology.sh` runs on the NAS, the clinic still archives the way it did before
#1050._

_Previous pass, 2026-10-17 (fourth pass) — **RIS-010 post-merge compatibility audit.** PR **#1050 merged
as `1a93e4e4`**, so the six rulings are on `main`; the audit then asked the owner's eight compatibility
questions of the merged code by **running** the request suite on `main`. Six were already sound (a missing
UID blocks only the association, signing and printing unaffected; the obstetric restriction is the existing
statutory engine and lifts when Form-F is satisfied; a refusal leaves the object PACS holds intact; a
signed amendment still archives as a new revision; only the token-bearing admin restore bypasses the
duplicate guard; a terminal failure reaches an operator through `/api/radiology-ops/jobs/dead-letter`).
**Two were demonstrated regressions**, each reproduced byte-for-byte by re-installing `main`'s line and
each fixed minimally: every refusal collapsed to one sentence that named a missing signature when the real
blocker was an unregistered `StudyInstanceUID` or an unevaluated PCPNDT Form-F, and the legacy free-text
branch was keyed on the single status spelling `reported_final`, which the federated boundary bridge never
writes — so a delivered, attributed legacy final stopped archiving and was refused with the wrong reason.
Evidence for the follow-up (**PR #1053**, branch `audit/ris010-post-merge-compatibility`, code commit `52434abb`): **20/20** request
cases, **243/243** neighbours across 13 files, **26 mutants → 21 detected with the owning case named + 5
surviving by documented reason + 0 unexplained**, browser **8/8** against a **4/8 control on `main`'s
component**, typecheck **98 before / 98 after** on api-server and 61 on the ERP (both unchanged, measured
by swapping `main`'s copies back in). No migration, no new column, no new flag, no production row, container
or Orthanc instance touched; nothing deployed; nothing clinically verified. The shared statutory policy was
**not** widened — the refusal wording lives in the archive module and is keyed by the policy's own codes.
Two limits are recorded rather than fixed: a legacy free-text final still has no revision identity to key
idempotency on, and a second authorized restore leaves the first instance id in the audit log only._

_Previous pass, 2026-10-17 (third pass) — **RIS-010 moved from measurement to correction.** The owner
ruled on all six questions; PR **#1050** (head `7ac9662a`, base `main`) implements those rulings in 8
files with no migration and no new subsystem: eligibility through the clinic's own `planUsgPacsReturn`
before any render or POST, the placeholder and `prelim_report` removed, per-revision idempotency on the
existing `radiology_pacs_archive_revisions` row, a study-scoped `pg_try_advisory_lock` copied from
`emergencyNasClient.ts`, the revision write moved **before** the study summary with
`ARCHIVE_ACCEPTED_BUT_UNRECORDED` carrying the instance id, both refusal codes permanent in
`decideFailure`, and DECISION 4 as one admin `/repair` action. Local evidence: **13/13** request-level
cases, **229/229** across the 13 affected files, a **20-mutant** battery with **15 detected (each naming
its own case) + 5 surviving by documented reason + 0 unexplained**, and the refusal wording proven in
**real Chromium 4/4** against a **2/4 control on the pre-correction JSX**. Measured on main at the time
of writing: `638fc2b9`, **and neither `49bdb856` nor `7ac9662a` is an ancestor of it** — #1050 is open,
not merged, not deployed, not clinically verified. Two things this pass did NOT get to decide: the reused
policy fail-closes three states the archive used to accept (no `StudyInstanceUID`, non-compliant
obstetric Form-F, only a retired revision), and the legacy free-text final stays eligible but cannot be
idempotency-keyed. #1050 was created Ready by the operator's tooling and this token cannot convert a PR
to draft (`PATCH {draft:true}` accepted and ignored; `convert-to-draft` and GraphQL both refused) — so
**review it before merging**, which was the intention anyway._

_Previous pass, 2026-10-17 (second pass) — **RIS-010** investigation closed as measurement: a committed
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
