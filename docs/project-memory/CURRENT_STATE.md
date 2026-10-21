# CURRENT STATE — CARE Diagnostics / Hope Hospital platform

> **Fourth baseline the same day (2026-10-20 ~23:05 IST / 17:35Z):** `origin/main` is now
> **`c199aea2`**. #1090, #1091 and #1092 (this directory's own PR) all merged between **17:14:26Z and
> 17:15:07Z**, so every `file:line` below that points into `zai-workspace/store.ts`,
> `observationLedger.ts`, `radiologyReportPdfExport.ts`, `useWorkspaceExportShare.ts`,
> `observationSlot.ts` or `useDraftPersistence.ts` was read from a tree that no longer exists, and
> every PR-state row in §4 is now history. The reconciliation of those three merges — with the merge
> SHAs, the CI evidence and what each one actually changed — is in **`OWNER_DASHBOARD.md`**, which is
> now the fast entry point to this directory and the file to update first on the next pass. Nothing
> below is deleted; the stale rows are marked as such where they were written.

Baseline `origin/main` **`dc8c3aba`**, measured 2026-10-20 (IST) against the tree and the GitHub REST
API. This same pass ran against `c4462041`, then `1c80f2d3`, then `47b739c8`, and finally `dc8c3aba`,
because `main` moved **six** times while it was being written — see the two banners below. Corrections
are marked in place; nothing is deleted.

> **What moved during the first pass (verified at ~09:20 IST / 03:48-03:49Z):** the owner marked
> **#1083, #1084 and #1085 ready and merged all three** — `d45370c3` (this documentation set),
> `d7abb9b3` (the AI Composer docs) and `47b739c8` (the print/PDF **code**). All three branches were
> deleted on merge, so `docs/project-memory/` and `docs/architecture/radiology-ai/AI_COMPOSER_*.md`
> **are now on `main`**, and the repository had **zero open PRs**. Any sentence in this directory that
> says otherwise was written minutes earlier and is being corrected, not quietly rewritten. **That
> clause is now itself superseded twice:** at `dc8c3aba` there is one ready PR (#1090) and by the time
> this pass finished there were **two** open PRs — #1090 and Draft **#1091** — see §4. Read "zero" as
> "at 03:49Z", not as a current fact.
>
> **What moved during the second pass (verified at ~20:55 IST / 15:10-15:11Z):** the owner merged
> **three more PRs in 47 seconds** — #1087 `8bbac44e` (this documentation set, the corrections above),
> #1088 `37a6758c` (the signer-of-record **code**) and #1089 `dc8c3aba` (the vision-trial image set).
> All three branches were deleted on squash-merge. **The consequence for this directory is specific and
> severe: #1088 deleted `lib/reportSignerSelection.ts`, the module §3 and four other files in this set
> cite as the fix for invented signer names.** Every citation of that module in `docs/project-memory/`
> is now a citation of a file that does not exist, and `CLINICAL_SAFETY_REGISTER.md` class 9's
> "OPEN-2" — the unsigned report that prints `"Signed: Dr. …"` — is **closed in merged code**. Both are
> corrected where they were written, with dates.

Companions in this set: `OWNER_VISION.md` (what the product must do, as approved by the owner),
`AUDIT_RECONCILIATION.md` (which historical audit findings survive on this tree),
`CLINICAL_SAFETY_REGISTER.md` (the nine patient-facing failure classes and their current evidence).

## 0. Status vocabulary — the whole point of this file

| Label | Means | How to verify |
|---|---|---|
| **MERGED** | The commit is an ancestor of `origin/main`. | `git merge-base --is-ancestor <sha> origin/main` |
| **DEPLOYED** | The clinic's NAS containers are running that code. | Only `deploy-synology.sh` does this, on the NAS, by hand. **No document in this repo records a deploy after 2026-10-12 22:22Z.** |
| **TESTED** | A named harness executed and its output was read. | The harness must be named; CI log line preferred over a local run. |
| **NOT TESTED** | Code exists and reads correctly. Nothing ran it. | — |
| **OPEN** | A PR exists, not merged. | `GET /pulls?state=open` |

The three most common agent errors on this repository are: calling MERGED "live", calling a green
local suite "tested", and trusting a document instead of the tree. This file labels all three.

## 1. What the clinic is actually running

**Last deploy anywhere that a document records:** containers `care-api`, `care-web`, `care-db`,
`care-redis` observed `Up 6 hours (healthy)`, created `2026-10-12T22:22:4xZ`, with
`care-db-patch-v2` and `care-schema-verify` `Exited (0)` in the same window —
`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:712-714`. Production database identity in that same pass:
`current_database()=diagnostic_erp`, `server_version 16.14`, not in recovery
(`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:719`, CL-1).

**That deploy's code identity is NOT proven.** The same register lists among claims *"Refuted by
this pass"*: `/api/health` reported commit `2d51e8d7` while the checkout was `46d36612`
(`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:357`, `:738-739`). So the honest statement is: *the clinic is
running something built on or about 2026-10-12, and no artifact proves which commit.* Treat
"deployed" as **2026-10-12, identity unproven** until someone re-runs
`node scripts/verify-deployed-identity.mjs` on the NAS.

**Volume of undeployed work:** **114** commits on `origin/main` since 2026-10-12 22:30Z
(`git rev-list --count --since=2026-10-12T22:30:00Z origin/main`, measured at `dc8c3aba`; it was 111 at
`47b739c8`, 108 at `1c80f2d3` and 106 at `c4462041` earlier the same day — count it, never recall it).
Almost all are squash-merged PRs. Everything in §3 is invisible in the clinic. A deploy is not
automatic: `deploy-synology.sh:39-47` hard-resets the NAS checkout to `origin/main` and rebuilds;
nothing triggers it.

**Which migrations the clinic database has is NOT VERIFIED.** The repo cannot answer it:
`version.json` is stamped *by the deploy* (`deploy-synology.sh:79-82` writes git/build metadata into
it so `resolveVersionInfo()` — `lib/operationsContext.ts:28,53` — reports a real SHA), so the
committed copy is stale by design and the live value only exists on the NAS. What the repo does
establish: `migrations/` carries **201 top-level `.sql` files plus 4 in `migrations/manual-only/`
(3 `.sql` + a README)**, applied by `docker/db-patch-entrypoint.sh` in plain alphabetical order, with
`scripts/check-migration-order.cjs` as the CI preflight; the **second, unrelated** system
`lib/db/drizzle/meta/_journal.json` has **15 entries** (latest `0014_baseline_manifest`). Two
migration systems in one repository is finding M18 of the master audit and it is still open — see
`AUDIT_RECONCILIATION.md` §3.

## 2. What `main` is

| Fact | Value | Evidence |
|---|---|---|
| HEAD at measurement | **`dc8c3aba`** *"The vision trial answered a shorter request than the operator made (#1089)"* — preceded by `37a6758c` (#1088, signer of record) and `8bbac44e` (#1087, this documentation set), merged 15:11:37Z / 15:11:14Z / 15:10:50Z | `git fetch origin main && git log --oneline -6 origin/main` |
| CI on that HEAD | **all 3 jobs success** in one run `39446153649`: `Build identity` completed 15:13:20Z · `Static checks` 15:14:50Z · `Tests + migration smoke` 15:21:55Z. `main` is green on its tip. | `GET /commits/dc8c3aba…/check-runs` (3/3 success) and `GET /actions/runs/39446153649/jobs` |
| Test totals at `dc8c3aba` | **15,489 passed / 49 skipped (15,538)** over **1,140 test files passed, 5 skipped (1,145)**, Duration **489.21 s** | run `39446153649`, log `Tests + migration smoke (real Postgres)/12_Vitest suite (sequential — one shared DB).txt` lines 6369, 6370, 6372 — +62 tests and +5 executed files over `47b739c8`. #1088 added 6 new test files and #1089 2 more (per their diffstats); the run's file count moved by 5, so **do not** arithmetic the two together — the counts are measured separately and the difference is not explained by anything in this file |
| CI on the two intermediate tips | Both **cancelled**, legitimately: the `ci-${{ github.ref }}` concurrency group with `cancel-in-progress` killed `8bbac44e` (run `39446038639`, 3 check-runs all `cancelled`) and `37a6758c` (run `39446097254`) the moment `dc8c3aba` landed 23 s later | `GET /actions/runs?branch=main` |
| **Reading hazard found while doing that row** | `GET /commits/37a6758c…/check-runs` returns **`total_count: 0`** — a run cancelled before any job *starts* creates no check-runs — while `GET /commits/8bbac44e…/check-runs` returns 3 (`cancelled`). Zero check-runs therefore does **not** mean "CI never ran"; and #1090's head `4598e8a9` also reports 0, because a PR pushed without a workflow trigger has never had one. Read `/actions/runs?branch=main` as well as `/commits/<sha>/check-runs` before writing any CI claim. | the three endpoints, read 2026-10-20 ~20:55 IST |
| Test totals at `47b739c8` (previous tip) | **15,427 passed / 49 skipped (15,476)** over **1,135 files passed, 5 skipped (1,140)**, Duration **538.27 s** | run `39366275815`, log lines 7579-7582 (measured in the first pass; kept as history) |
| CI on the previous tip `1c80f2d3` | **all 3 jobs success**, one run `39361881382`: `Static checks` 03:01:49Z, `Build identity` 03:00:11Z, `Tests + migration smoke` 03:13:42Z | `GET /commits/1c80f2d3…/check-runs` |
| Test totals at `1c80f2d3` | **15,406 passed / 49 skipped (15,455)** over **1,133 test files passed, 5 skipped (1,138)**, Duration **775.25 s** | run `39361881382`, log lines 9311-9314 |
| The suite that had been red | `aiReporting.imageEgress.request.test.ts (50 tests) 1926ms` — green at the tip `dc8c3aba`, **still 50 tests**, so #1086 retired the ordering demand without losing a case | run `39446153649`, step-12 log line **607** (job log line 1296). **Corrected:** this row previously cited "tip log line 2017", which was a reading of an *older* run's log; the same suite moved line as the logs changed, which is why §2 quotes the run id with every line number |
| Migration smoke at the tip | `feature migrations: 201/201 applied, 0 error(s)`, `RESULT: 95 passed, 0 failed`, and `apply-all-migrations: 15 drizzle applied, 201/201 feature migrations OK` — unchanged from `47b739c8`, as expected: neither #1088 nor #1089 touched `migrations/` | run `39446153649` log lines 567, 689, and step `10_Clean-boot + upgrade-safety migration smoke` |
| Build identity | job `Build identity (disposable docker build)` completed/success | `GET /commits/…/check-runs` |
| Typecheck | clean for **every** package at the tip: `diagno-booking-mobile` 15:13:33Z, `clinic-site` 15:13:41Z, `scripts` 15:13:49Z, `api-server` 15:14:20Z, `diagnostic-erp` 15:14:47Z all `typecheck: Done` | run `39446153649`, log `2_Static checks (typecheck, migration order, grounding).txt` lines 378-383 |
| Documentation gate | `grounding-check: 105 architecture claims` → `✓ All 105 architecture claims hold against the code.` | same run, log lines 350 |
| Log text that looks like a failure and is not | `[cron] Restore verification: FAIL — verified artifact /tmp/restore-artifact-…/backup_nightly.sql.enc` and `FAIL — verified a fresh pg_dump (NO stored backup artifact was available to test)` at 15:19:55Z — emitted by `restoreVerifiesRealArtifact.test.ts` while the job stayed **success**. Two occurrences again at this tip, both console output. Read the job conclusion, not the word FAIL | tip log lines 5716, 5719 |

**Superseded, kept for the record.** From 2026-10-19 20:29Z to 2026-10-20 02:59Z the tip of `main`
was `c4462041` and its `Tests + migration smoke` job was **red** on one order-dependent assertion in
`aiReporting.imageEgress.request.test.ts` TEST 15 (`expected [ 'medgemma1.5:4b', 'qwen3-vl:8b' ] to
deeply equal [ 'qwen3-vl:8b', 'medgemma1.5:4b' ]` at `:965:44`, run `39319802877`). It was reproduced
byte-identically on a documentation-only head (`38530427`, run `39321817651`), which is how it was
proved to be `main`'s rather than the PR's. **PR #1086 retired it** (merged as `1c80f2d3`): the arm
rows are now asserted as a deterministic `(armIndex, model, imageCount)` table and the transport
order as a sorted multiset, plus a new case (TEST 15b) that forces the arms to complete in the
opposite order behind a 2 s barrier. `main` therefore has a completed green test run again — the
first since `6a31307f`.

CI is three jobs, not four: *Tests + migration smoke (real Postgres)*, *Build identity (disposable
docker build)*, *Static checks (typecheck, migration order, grounding)* (`.github/workflows/ci.yml`
jobs `test`, `identity`, `static`).

## 3. Merged, not deployed — the register that matters

All rows verified as `merged: true` via `GET /pulls/{n}`. None is deployed (§1). The
`Deployed: no` column for the RIS rows is the repo's own register's verdict
(`docs/engineering/RIS-PACS-INTEGRATION-TODO.md:30-46`).

| PR | Merged as | What it changed (one line) | Deployed | Tested |
|---|---|---|---|---|
| #1089 | `dc8c3aba` 2026-10-20 15:11:37Z | **AI vision trial: 4 files +367/−17.** `POST …/report-composer/vision-trial` no longer trims the picture set — a set that breaks a ceiling is refused as a whole (new `lib/reportComposer/trialImageSet.ts`, ceilings read from the route's own old numbers: 6 pictures, 3.5 M base64 chars, jpeg/png/webp), so `sameImageCount`, each arm's `imageCount` and the prompt's own "Image count: N" can no longer describe fewer pictures than the operator sent. Closes the register/Audit finding **G-16** at the route door. | no | CI **3/3 success on the merge commit** (`dc8c3aba`, run `39446153649`). Its two new suites are `trialImageSet.test.ts` (133) and `reportComposer.visionTrialGate.test.ts` (46, a deliberate static guard — the commit message records that the DB-backed route suite destabilised two unrelated suites in a sequential run, and was replaced). **No live model run.** |
| #1088 | `37a6758c` 2026-10-20 15:11:14Z | **Signer of record: 20 files +1,658/−293.** Who may sign is decided from rows, not from a person's name: new `reportSignerEligibility.ts` replaces the `/sugandha/i` regex in `autoSignReport` and `useStudyFinalize`; a remembered `radiology_finalize_signer_id` is honoured only inside the eligible pool; `POST /:id/sign` refuses a **retired** block (`:2599`); a printed document reads its name from `patient_reports.signatureId` + `signedByName` (`recordedSignerForReport`/`loadSignerOfRecord`, `artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.ts:529`/`:568`); `signerUnsigned` makes both renderer doors print **NOT SIGNED** and no name (`reportPresentation.ts:506`, `patient-reports.ts:3482`); a draft preview prints no signer at all (`radiology-report-generator.ts:2451`); and the browser PDF door **refuses to render a signed report** (`SignedReportArtifactRequired`, `artifacts/diagnostic-erp/src/lib/radiologyReportPdfExport.ts:361,:378`), downloading the server artifact instead. **It deleted `lib/reportSignerSelection.ts`** (77 lines) and its 109-line test — every citation of that module in this set is now stale. | no | CI **3/3 success on its head** `54823338` **and 3/3 on the merge commit** `37a6758c`— and its run on the merge commit itself was cancelled 23 s later by #1089 (§2). Six new suites, two of them request-level against real Postgres (`draftPreviewNamesNoSigner.request.test.ts`, `radiologyReportLifecycle.test.ts` +237). **Not reviewed on a rendered page or PDF by a human.** |
| #1087 | `8bbac44e` 2026-10-20 15:10:50Z | This `docs/project-memory/` set, **9 files +1,067/−126**, documentation only — the first reconciliation pass, including the two self-corrections it recorded against itself. | no | docs only; CI 3/3 **cancelled** on this merge commit by the concurrency group when #1088 landed (legitimate — see §2) |
| #1085 | `47b739c8` 2026-10-20 03:49Z | Print/PDF quality: Doppler emphasis, an explicit *"IMAGE COULD NOT BE READ"* tile, **signatures chosen from the `signatures` table**, +320 lines of rendered-output harness. **Correction (2026-10-20, at `dc8c3aba`):** this row cited `lib/reportSignerSelection.ts` as the mechanism; **#1088 deleted it** two commits later, and replaced the whole "pick a block for a preview" question with "a draft prints no signer". The unreadable-image tile is unchanged and still the right claim. | no | CI **3/3 success on its head** `55de3cce` (02:53Z) **and 3/3 on the merge commit** — run `39366275815`, 15,427 tests (§2). Still **no rendered-output acceptance by a human**: the print/PDF claims are test-level, not browser-level (`CLINICAL_SAFETY_REGISTER.md` §8, §9) |
| #1084 | `d7abb9b3` 2026-10-20 03:48Z | The four AI Composer state docs (`AI_COMPOSER_{CURRENT_STATE,GAPS,WORKFLOW,NEXT_PHASE}.md`), **4 files +3,393/−0**, docs-only | no | docs only; CI green on its **final** head `a1b53e18` (the branch moved from `130fc9f5` before merge — read `head.sha` from the PR, not from a note) — **and its G-20 row is false against today's tree** (`AUDIT_RECONCILIATION.md` §2) |
| #1083 | `d45370c3` 2026-10-20 03:48Z | This `docs/project-memory/` set, in its **`c4462041` form** — i.e. the merged copy says `main` is red and #1081 is a Draft | no | docs only; CI green on head `2d8fbcea`. **The corrections in this file are the follow-up**; the merged copy is now superseded in place, not deleted |
| #1086 | `1c80f2d3` 2026-10-20 08:29 IST | The two-arm image comparison is no longer asserted in socket-arrival order; a new case forces the opposite order | no | **CI green on `main`** — run `39361881382`, 3/3 jobs, 15,406 tests, suite at 50 tests |
| #1081 | `c208cbfb` 2026-10-19 21:39Z | Isolated local development against a copy of production (`CARE_DEV_ISOLATED`, `pnpm dev:isolated`) | no | yes — CI green at head `1209ae49` |
| #1080 | `c4462041` 2026-10-19 20:29Z | A vision arm that was never sent the image can no longer claim it read it | no | green at head `76fe43b0` (3 jobs); **red after its own squash onto `main`** (TEST 15 arm order), retired by #1086 |
| #1082 | `80a09df4` 2026-10-19 20:22Z | Composer usability-first re-land (24 files) | no | the test job on that merge commit reads **cancelled** — the `ci-${{ github.ref }}` concurrency group killed it when #1080 landed seconds later. Read the PR head, not the merge commit |
| #1079 | `b67869ed` | Model comparison can run a picture, not only a prompt (6 ceilings in `routes/aiComparison.ts:36-40`) | no | request suite `aiReporting.imageEgress.request.test.ts` +909 |
| #1078 | `a787bafb` | Every interactive image route honours the egress mode | no | yes, CI + request tests |
| #1077 | `6a31307f` | Quick Select order-independence, Conclusion retirement, acceptance journeys | no | yes (15,243 tests) |
| #1076 | `66d2c116` | AI security mode is a resolved setting, not a constant | no | yes |
| #1073 | `ed3e00b4` | Screenshot→draft audit doc + corrections to the radiology-ai architecture set | n/a (docs) | n/a |
| #1072/#1071/#1070 | `6b64b2f0`/`d673f1cc`/`02e47dff` | One supersession rule for contradictory normals across all four write doors | no | yes at head |
| #1064 | `8d14b121` | Tracker recording **#1058, #1055, #1057, #1056, #1063 merged, not deployed** | — | — |
| #1063 | `bae32727` | AI Composer reads the canonical canal AP record (read-only) | no | 6 suites + 10/10 mutation battery |
| #1054 | `3d54c552` | Canal AP: one print authority, phrase dedupe removed | no | 20 rendered-artifact cases on real Postgres |
| #1058 | `d1f9b855` | RIS-014 finalize study-id authority + RIS-015 signed-state witness | no | 4/4 + 25/25 + 7/7 on real Postgres, 15/15 mutants killed |
| #1047 | `795eb069` | RIS-006 / RIS-012 linked-sibling report ownership | no | 3 of 8 red→green, mutants N1–N6 killed |
| #1050/#1053 | `1a93e4e4`/`9664a967` | RIS-010 PACS archive transaction safety + its two post-merge regressions | no | 21/21 on CI's Postgres, 28-mutant battery |
| #1044 | `877701f9` | RIS-005 right-patient-wrong-examination in the archive | no | 13/13, battery A–F |

**Consequence:** the P0 patient-identity fixes (#1040, #1042, #1044, #1058) are **not** what the
clinic is printing. That is the single most important sentence in this file.

## 4. Open work on GitHub (re-verified 2026-10-20 ~20:55 IST at `dc8c3aba`, **and again at ~22:02 IST / 16:32Z**)

**Two open PRs, both Drafts now, and they are different agents.** `GET /pulls?state=open` returns
**#1090 "Composer/99 9"** (`draft: true`, head **`06befc27`**, base `dc8c3aba`, **25 files
+2,655/−41**, `mergeable: false`, `mergeable_state: dirty`) and **#1091 "A restored unsaved draft
claimed the radiologist wrote the AI's sentences"** (`draft: true`, head `b9d8ef51`, base `dc8c3aba`,
1 commit, **6 files +816/−12**, `mergeable: true`, `mergeable_state: **clean**`, **3/3 check-runs
success**). **Both moved during this pass**, which is the second time in one day: at ~20:55 IST this
section recorded #1090 as `draft: false` with head `4598e8a9` and 23 files +2,041/−32, and #1091 as
`mergeable_state: unstable` with 2 of 3 jobs green. Those readings were true when taken and are kept
below rather than deleted; the rows marked *22:02 IST* supersede them. The earlier statements in
this section — *"zero open PRs"*, then *"one open PR"* — were each true when written and both stopped
being true while this file was being edited; keep the rows, correct the headline, that is the rule of
this file.

| Field | Measured | How |
|---|---|---|
| #1091 — what it is | The **candidate fix for the Restore-banner attribution defect** (`CLINICAL_SAFETY_REGISTER.md` §0.1 row 8, `AGENT_HANDOFF.md` D-12): new `lib/aiAttributionRestore.ts` (+145) and `aiAttributionRestore.test.ts` (+146) plus a 441-line `aiAttributionRestoreJourney.hardening.test.ts`, then `WorkspaceOverlays.tsx` **+9/−2**, `observationLedger.ts` +32/−0, `zai-workspace/store.ts` +43/−10 | `GET /pulls/1091`, `GET /pulls/1091/files` |
| #1091 — CI *(22:02 IST)* | **3 of 3 success** at head `b9d8ef51`: `Build identity`, `Static checks (typecheck, migration order, grounding)`, `Tests + migration smoke (real Postgres)` all `completed/success`, and `mergeable_state` is now `clean` | `GET /commits/b9d8ef51…/check-runs` |
| #1091 — CI | **2 of 3 jobs green at the head so far** (`Build identity` success, `Static checks` success; `Tests + migration smoke` has no conclusion yet), consistent with `mergeable_state: unstable` — *superseded by the row above, kept as the reading it was* | `GET /commits/b9d8ef51…/check-runs` |
| #1091 — status discipline | **NOT VERIFIED as a fix.** Green CI on a Draft is a machine verdict on code that has not been reviewed or run in a browser: it is unmerged, undeployed, and this pass did not run its tests. Its existence does **not** move class 7/§0.1 row 8 from OPEN, and it must not be described as fixed in `COMPLETED_WORK.md`. Now that CI is green and the tree is `clean`, **the merge decision is the owner's, not an agent's** | `GET /pulls/1091` → `merged: false` |
| Do the two open PRs conflict with each other? | **No, measured:** `git merge-base tmp-pr1090 tmp-pr1091` = `47b739c8`, and `git merge-tree --write-tree tmp-pr1090 tmp-pr1091` auto-merges `store.ts` and `observationLedger.ts` cleanly — the only `CONFLICT (content)` lines are `useWorkspaceExportShare.ts` and `radiologyReportPdfExport.ts`, i.e. **#1090's pre-existing conflicts with `main` (#1088), carried into the comparison**. Three agents are nonetheless editing `store.ts` and `observationLedger.ts` at once (#1090, #1091, and the Composer branch's own history) | local `git fetch origin "+refs/pull/1091/head:refs/heads/tmp-pr1091"` + merge-tree |

**#1090 in detail** (re-measured at this pass; every row below is about #1090, not #1091):

| Field | Measured | How |
|---|---|---|
| Draft or ready | **Draft** (`draft: true`) as of 22:02 IST. *At 20:55 IST this row read **ready** (`draft: false`), and the owner's brief called it "OPEN (Composer 99.9)"* — the Composer agent pushed new commits and flipped it to Draft in between. Nothing about the code changed in this file's reading; its state did | `GET /pulls/1090` → `draft`, `updated_at: 2026-10-20T16:30:40Z` |
| Its head | **`06befc27`**, 25 files **+2,655/−41** (was `4598e8a9`, 23 files +2,041/−32 at 20:55 IST) — work is still landing on the branch | `GET /pulls/1090` |
| CI at its head | **no check-runs at all** (`total_count: 0` for `06befc27`, and the same for the previous head `4598e8a9`) — converting a PR to Draft does not stop the workflow, so this branch has still never been run by CI: there is no green to quote for it | `GET /commits/06befc27…/check-runs` + §2's reading hazard |
| Merge conflict | **still exactly two content conflicts against `main`**, re-measured at the new head: `hooks/radiology-workspace/useWorkspaceExportShare.ts` and `lib/radiologyReportPdfExport.ts`. `git merge-base tmp-pr1090 origin/main` = **`47b739c8`** — the branch was **not** rebased, it added commits on top of the pre-#1088 tree, so pushing more work does not resolve the collision | `git fetch origin "+refs/pull/1090/head:…"`, then `git merge-tree --write-tree origin/main tmp-pr1090` |
| Why that pair specifically | #1088 added `signerOfRecord` / `unsigned` / `authorizedReportId` and the `SignedReportArtifactRequired` refusal to `radiologyReportPdfExport.ts`; #1090 adds a **different** unsigned-representation mechanism to the same function signature — `unsignedDraft` plus `lib/draftAwarePrintSettings.ts`, which sets a `DRAFT` watermark. Its own header says it deliberately does not touch `settings.signature` and "composes with" #1088, and it names #1085/#1088 in a comment — but it was branched at `47b739c8`, so it composes with a tree that no longer has that shape | both files read at `origin/main` and at `refs/pull/1090/head` |

**`mergeable: false` ≠ the code is wrong.** It means the merge has not been attempted against
today's `main`. Resolving it is a single agent's job (see `AGENT_HANDOFF.md` §7 — this is now a
cross-agent integration conflict, not a defect in either PR), and the Project Memory Agent must not
and did not touch it. What this file records is the state: **#1090 cannot be merged as it stands, and
the collision is over how an unsigned report should look.**

Also corrected here: this section's own first sentence said Draft #1087 was **9 files +1,052/−126**.
The merged PR is **9 files +1,067/−126** (`GET /pulls/1087`, 2026-10-20) — the earlier number was read
from the branch before the last documentation commit, which is exactly the mistake
`KNOWN_ISSUES.md` §4 warns about.

Historical table, kept as written in the first pass:

| PR | Was | Merged as | Head at merge | Fate and consequence |
|---|---|---|---|---|
| **#1083** | Draft — this `docs/project-memory/` set, 6 files +1188/−0 | `d45370c3` 2026-10-20 03:48:31Z | `2d8fbcea` | branch deleted on merge. **The copy that landed is the `c4462041` snapshot**, so `main` now carries a memory file that says `main` is red, that #1081 is a Draft and that one PR is open — all three overtaken the same day. This revision corrects them in place |
| **#1084** | Draft — the four `AI_COMPOSER_*.md` docs, 4 files **+3,393/−0** | `d7abb9b3` 03:48:48Z | `a1b53e18` (**not** `130fc9f5`, which this pass had read minutes before; an earlier revision of this file quoted its `+3,247` too) | branch deleted. Now on `main`, and its **G-20 row is false** against today's tree — `AUDIT_RECONCILIATION.md` §2 |
| **#1085** | Draft — print/PDF **code**, 10 files +783/−46 | `47b739c8` 03:49:09Z | `55de3cce` | branch deleted. CI 3/3 success on the head (02:53Z) **and 3/3 on the merge commit** (`Tests` completed 04:00:37Z, 15,427 tests) — **corrected 09:35 IST**, this row previously said the merge-commit job was still running |

Each of the three was `mergeable: true` and green on its own head when read at ~08:40 IST; all three
were branched at `c4462041` and were merged without a rebase, so `main` absorbed them as squashes.
**#1087, #1088 and #1089 were merged the same way eight hours later** (15:10:50Z / 15:11:14Z /
15:11:37Z). Their three heads `4589e224`, `54823338` and `d243430c` each report **3/3 success**
(`GET /commits/<sha>/check-runs`), and `GET /pulls/{n}` returns `mergeable: null` for a closed PR —
the field is only computed while a PR is open, so nobody should read that null as a problem.

**The open-work list has therefore moved wholesale into §3 (merged, not deployed) in one action.** A
reader must now treat `docs/project-memory/*` and `docs/architecture/radiology-ai/AI_COMPOSER_*` as
authority-bearing files **on `main` whose own text is out of date** — exactly the class of failure
`KNOWN_ISSUES.md` §2 exists to record. Nothing is deleted here; corrections are dated.

When a PR exists again, `unstable` ≠ conflict: `dirty` = content conflict, `unstable` = checks pending
or failing. A per-PR `GET /pulls/{n}` is required for `additions`/`deletions`/`changed_files`/
`mergeable` — the **list** endpoint omits all four, which is why #1090 first read as
`+undefined/undefined`.

Sibling repositories, all with **0 open PRs** — measured in the first pass (~09:20 IST) and again at
~21:00 IST against `GET /pulls?state=open` for each:

| Repo | `origin/main` last merge | Notes |
|---|---|---|
| `DrAbinash/care-pacs` | #19, 2026-10-12 | **Local checkout is NOT on main**: branch `fix/orthanc-mwl-housekeeper-crash` @ `53588a0`, `origin/main` = `247f0cc`. Reading that checkout reads a feature branch. |
| `DrAbinash/hope` | #191, 2026-10-14 | HOPE Hospital ERP |
| `DrAbinash/usg-reports` | #65, 2026-10-07 | Independent USG reporting app (no-AI pipeline) |
| `FuturekindHealth/futurekind-platform` | #9, 2026-10-15 | **not** `DrAbinash/futurekind-platform` — that URL 404s. Org is `FuturekindHealth`. |

## 5. Where the code lives, in one table

| Thing | Path | Verified |
|---|---|---|
| pnpm workspace globs | `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts` | `pnpm-workspace.yaml:2-5` |
| API server | `artifacts/api-server/src/index.ts`, `PORT` default **8080** | `index.ts:2835` |
| ERP SPA | `artifacts/diagnostic-erp/vite.config.ts`, **5173** | `:11` |
| Clinic site | `artifacts/clinic-site/vite.config.ts` 5173 default; mobile booking 3003 | package/vite files |
| Schema | `lib/db/src/schema/*.ts` — **187 files, 196 `pgTable("<name>")` definitions** | counted on `1c80f2d3` |
| Routes | `artifacts/api-server/src/routes/*.ts` — **202 non-test files** | counted on `1c80f2d3` |
| SQL migrations | `migrations/*.sql` — **201**, plus **4** in `migrations/manual-only/` (3 `.sql` + README) | `git ls-tree -r --name-only origin/main -- migrations` |
| Second migration system | `lib/db/drizzle/meta/_journal.json` — **15 entries**, latest `0014_baseline_manifest` | `git show origin/main:lib/db/drizzle/meta/_journal.json` |
| Tests | **1,118 `*.test.ts`** in `artifacts lib scripts` + **24 `*.test.mjs`**, of which **74 `*.request.test.ts`** — recounted at `dc8c3aba` (was 1,111 / 24 / 73 at `1c80f2d3`: #1088 added 6 files, #1089 2, and one request suite more). Two more `.test.ts` sit in `__super_admin_quarantine/`, which `pnpm -r` never runs. CI executes **1,145** files at `dc8c3aba` (1,140 pass, 5 skip); it executed **1,140** at `47b739c8`. | `git ls-tree -r --name-only origin/main` counts + Actions log lines 6369-6372 |
| Report section order | `artifacts/api-server/src/lib/structuredReport/renderer.ts` emits **Technique (`:311`) → Findings (`:320`) → Impression (`:241`/`:267`) → Recommendation (`:365`)**; the print/PDF path defaults to `sectionOrder: "Technique,Findings,Impression"` (`routes/radiology-report-generator.ts:1169`, `lib/institutionalReportStyle.ts:629`, `routes/radiology.ts:3543`) | grep on `1c80f2d3` — see `OWNER_VISION.md` |
| Super Admin portal | `__super_admin_quarantine/super-admin-portal` — **outside the workspace**, yet root `dev` still `--filter`s it (`package.json:12`), port 5174 | `pnpm-workspace.yaml` has no match for `super-admin` |
| Non-packages matching the globs | `artifacts/radiology-e2e-acceptance/`, `lib/pacs/` have **no `package.json`** | `pnpm -r` skips them silently |

## 6. This Windows development machine (measured, not assumed)

Nothing here was changed. Full procedure and intent in `ARCHITECTURE.md` §15.

| Intended (per the owner's brief) | Measured on this box |
|---|---|
| `C:\care-development` checkout | **absent** (`ls /c/care-development` → not found) |
| PostgreSQL `127.0.0.1:5411` db `care_dev` | **5411 not listening** |
| API `127.0.0.1:8181` | **8181 not listening** |
| Frontend `127.0.0.1:5173` | **5173 not listening** (a Vite dev server IS up on `127.0.0.1:5178`, another agent's session — left alone) |
| `CARE_DEV_ISOLATED=1`, `pnpm dev:isolated` | **now exists on `main`** — `package.json:14` `"dev:isolated": "node scripts/dev-erp-local.mjs --isolated"`, with `artifacts/api-server/src/devIsolationBoot.ts` and its door/startup tests. **Correction (2026-10-20):** an earlier revision of this file said it existed only on the Draft branch; #1081 merged as `c208cbfb` at 21:39Z while that revision was being written. It is merged, **not deployed**, and nothing on this box has run it — the ports in §6 are still not listening. |
| Restored production snapshot, 477 tables | **owner-reported, unverified by this pass.** Port `5432` answers and is `PostgreSQL 18.3 on x86_64-windows` (service `postgresql-x64-18`, running) but requires password auth, which this audit did not use. Note the version gap: production and CI are **PostgreSQL 16** (`server_version 16.14`, `postgres:16-alpine`); this box runs **18.3**. |
| — | Port `5445` is a second cluster (role `erp`) holding **51 scratch databases** created by past agent sessions. |

**So the intended Windows environment is still a plan, not a measurement.** **Correction
(2026-10-20):** the sentence that closed this section read *"one Draft PR away"* — #1081 merged as
`c208cbfb`, so the mechanism now exists on `main`; what is missing is someone to create
`C:\care-development`, start `care_dev` on 5411 and actually run `pnpm dev:isolated`. That has not
happened at the time of writing (8181 / 5173 / 5411 all still not listening).

## 7. Known-unproven areas (carry these forward)

* **Browser proof of the merged reporting stack: none since 2026-10-16.** `deployed` is 2026-10-12,
  so the clinic has not been shown any of §3. **Re-checked at `dc8c3aba`:** the three print/PDF and
  signature PRs that are now the most consequential un-deployed clinical changes — #1085, #1088, #1089 —
  have each been proved by CI and by unit/request tests, and **not once** by a rendered page, a real PDF
  or a browser session. #1089 is the sharpest case: its own commit message documents that its
  database-backed route suite destabilised two *unrelated* suites in a sequential local run and was
  therefore replaced by a static guard, so the "a refused set never opens a socket" claim is enforced by
  a test that reads source text plus CI, not by an executed route test on this repository's tip.
* **D2 displayed-image identity is dormant, not live.** `docs/CARE_ERP_PREDEPLOYMENT_GATE.md:723`
  (CL-5) fails viewer-side claims; the register's own words: *"Saying 'D2 is live' is false… it is
  dormant."*
* **HOPE delivery has never been observed.** CL-6: `integration_outbox` 0 rows,
  `integration_delivery_attempts` 0 rows, `external_result_links` 0/0/0 — reachability proved
  (HTTP 401 in 88 ms from the NAS to `172.16.1.139:7080`), delivery never
  (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:724`).
* **No restore has ever been proven on the NAS.** CL-2 NOT TESTED; `public.backup_verification`
  has 0 rows (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:719`).
* **Evaluation/governance machinery is unwired.** `runEvaluation` has no caller
  (`artifacts/api-server/src/lib/ai/evaluationRunner.ts:36` is the only definition site);
  `admitJob` likewise (`lib/ai/aiScheduler.ts:120`); the `ai_golden_cases` table exists
  (`lib/db/src/schema/aiEvaluation.ts:36`) and nothing inserts into it. Docs claiming an
  operating evaluation framework are wrong — see `KNOWN_ISSUES.md` §2.

## 8. Re-derive before quoting

```
git fetch origin main && git log --oneline -1 origin/main
git rev-list --count --since=2026-10-12T22:30:00Z origin/main     # undeployed volume
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  https://api.github.com/repos/DrAbinash/care-on-synology1/pulls?state=open
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  https://api.github.com/repos/DrAbinash/care-on-synology1/commits/<sha>/check-runs
```
Read `merged` / `merged_at`, never `merge_commit_sha` alone — an **open** PR also carries a
non-null `merge_commit_sha` (GitHub's test-merge preview) and it is not on `main`.
