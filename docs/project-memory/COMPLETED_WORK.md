# COMPLETED WORK — what has actually been built

Baseline `origin/main` **`b0610551`** (advanced from `c199aea2` by #1093 `2ec675ab` on 2026-10-20
17:38:08Z, then by three merges inside **44 seconds** on 2026-10-21 — 02:06:47Z, 02:07:07Z, 02:07:31Z).
Volume: **742 squash-merged PRs** are in `main`'s history, from
`(#9)` to `(#1096)`; by month **2026-07 45 · 2026-08 293 · 2026-09 130 · 2026-10 274**
(`git log --format="%s" origin/main | grep -cE '\(#[0-9]+\)$'`, monthly from the same pipe with
`--date=format:%Y-%m` keyed on **committer date**; keyed on author date the four numbers are identical,
because a squash merge lands the same day it is authored). A previous revision of this file read
**727 / up to (#1080)** at `c4462041`, then **729** at `1c80f2d3`, then **732 / up to (#1086)** at
`47b739c8`, then **738 / up to (#1092)** at `c199aea2`; #1083, #1084 and #1085 merged while it was being
written, and so did #1094, #1095 and #1096 while this line was being re-measured. The count is by
*PR-number range*, not by row: at `47b739c8` the newest PR number present was #1086 even though #1085's
merge was the tip, because three PRs landed in a single minute (03:48:31Z, 03:48:48Z, 03:49:09Z). At
this baseline the range and the tip agree — #1096's squash **is** `b0610551`.

Nothing in this file says "live". `main` was last deployed **2026-10-12**; see
`CURRENT_STATE.md` §1 and §3. Each line states the **test level** honestly:
*CI* = executed by GitHub Actions on a real Postgres 16; *local* = executed on a scratch cluster or
rendered artifact; *browser* = a real Chromium pass; *code* = read/reasoned only.

---

## A. Patient and report identity (the P0 class)

| Work | PR / merge | Test level |
|---|---|---|
| Finalize identity bound atomically to the study; reset on study transition | #874 lineage, later #1058 | CI + browser |
| Viewer must reset state per study (another patient's image on screen) | #1040 `c2b81046` | CI |
| PACS archive report pick must be patient-scoped | #1042 `2c8bdccd` | CI |
| Right patient, wrong examination filed into the series | #1044 `877701f9` | CI — 13/13 cases, mutation battery A–F |
| Finalize sent the queue **row id** where a billed **study id** was keyed, and a flip that wrote nothing reported "completion" | #1058 `d1f9b855` | CI on real Postgres: 4/4 + 25/25, 15/15 mutants killed |
| The workspace said "Report signed" for a report with no signature | #1058 same squash, RIS-015 | CI 7/7 + client 29/29 + Chromium 3 states |
| Null `patient_reports.study_id` ownership; linked-sibling finalize refused | #1047 `795eb069` | CI, red→green, mutants N1–N6 killed |
| Composer study identity anchored on `radiology_worklist.id` (ids collide across sequences) | #905 | CI |
| Signed report identity metadata (`patient_reports.study_id` is a shared id) | #993 | CI |
| Worklist row vs billed study id documented as a trap | `radiologyReportLifecycle.ts:32-76` | code + CI |

## B. Clinical integrity of the report itself

* **Four write doors, one supersession rule.** A contradictory normal is now withdrawn by every
  door that writes Findings — Quick Select, merge, full-normal format, AI accept
  (#1070 `02e47dff`, #1071 `d673f1cc`, #1072 `6b64b2f0`; test level CI + mutation). The shared
  rule is `normalClaimSupersededBy` + `sentenceOwnedBySlot`.
* **Signed-report mutation boundary.** Refusals are enforced in `saveDraft` itself, not in its ten
  callers (#859), with a distinct `refused` autosave status (#862) and a refusal message that names
  a real recovery path (#863). CI.
* **Withdrawal reopens the study** in one transaction (#847) and invalidates the right caches
  (#860). CI.
* **Draft restore no longer offers to overwrite a signed report** (#867). CI.
* **Amendments** are the only post-sign path; the signed row is frozen and content-hashed.
* **Canal AP diameter: one measurement authority for print.** #1054 `3d54c552` — one print plan
  across segments, phrase-based dedupe replaced by structured-table identity, Generate writes no
  table, Dorso-Lumbar renders as one combined table, one live entry point. 20 rendered-artifact
  cases on real Postgres + mutation battery. **Then** the AI Composer was given a read-only view of
  the canonical record: #1063 `bae32727` (`canonicalCanalAp.ts:39/:55`,
  `resolveComposeDraft.ts:117`), 6 suites + a 10/10 mutation battery, explicitly **no writes**.
* **Technique paragraph duplication** closed non-destructively (#878, #879, #964/#971 lineage). CI.
* **DWI/ADC ownership** so a chronic infarct no longer implies restricted diffusion (#928). CI.
* **Normal supersession** for focal intra-axial lesions (#930); region override survives reload
  (#967); the un-owned clinic normal no longer outranks the curated baseline (#1036/#1037). CI.
* **Impression numbering** no longer turns hand-typed "1. " into an empty preference (#1028). CI.

## C. Reporting surface consolidation (B-10 family)

One authoritative reporting surface. `UsgCompanionWorkspace.tsx` deleted and proven by contract test
(`usgWorkspaceContract.test.ts` suite `:48-49`), `/radiology/usg/:studyId` redirected, RadiologyLegacy
contained, server-side write guards added (#884, #885). Command Center's second authoring surface was
stripped and deeplinks to the workspace. CI + browser.

## D. Financial and inventory integrity (B-11..B-13)

Consumption idempotency behind an advisory lock (#886); ledger-vs-balance concurrency with
deterministic lock order across seven writers (#887, #892); bill number on every money row (#891);
day-close rulings honoured (auto-fill kept, no forced denominations). Red-first races reproduced on
**real Postgres**, mutation proofs. CI.

## E. AI: egress, honesty, comparison

* **Security mode is a resolved setting**, not a compile-time constant — #1076 `66d2c116`
  (`aiSecurityPolicy.ts:31`, fail-closed to `clinical` `:36`).
* **Every interactive image route** honours the egress gate — #1078 `a787bafb`
  (`resolveInteractiveImageEgress:197`).
* **Model comparison can send a picture** — #1079 `b67869ed`, ceilings at
  `routes/aiComparison.ts:36-40`, request evidence `aiReporting.imageEgress.request.test.ts` (+909).
* **Vision-arm honesty**: a model that was never shown the image can no longer answer as if it read
  it — #1080 `c4462041` (merged 2026-10-19 20:29:55Z). Test level: **green at the PR head `76fe43b0`,
  red after the squash onto `main`** — TEST 15 of the same suite failed on an arm-order assertion at
  `aiReporting.imageEgress.request.test.ts:965`. **Now retired by #1086** (`1c80f2d3`, 2026-10-20): the
  suite runs **50 tests** green in CI on `main`. `CURRENT_STATE.md` §2 keeps the full red window.
* **A vision trial that cannot show every picture now shows none** — #1089 `dc8c3aba` (merged
  2026-10-20 15:11:37Z). `lib/reportComposer/trialImageSet.ts:68` refuses the whole set above the
  ceilings (`:25` 6 images, 3.5 M characters, `:27` jpeg/png/webp) and `routes/reportComposer.ts:755`
  returns `400 {error, suppliedCount, droppedIndexes}` instead of silently trimming. It adopts the rule
  #1079's comparison UI already followed (`routes/aiComparison.ts:36-40`): reject the set, never a
  shortened list. **Test level: CI green plus one *static* guard** —
  `reportComposer.visionTrialGate.test.ts:62` asserts the handler source contains the call, and the
  DB-backed suite was removed before merge (recorded in the commit message), so there is no
  request-level proof. The provider's own `opts.images.slice(0, 6)`
  (`lib/reportComposer/providers/deepseekVisionTrial.ts:112`) is still there, unreachable only because
  its single caller sits behind the gate.
* **Audit row for image sends** now exists on the Composer path too
  (`reportComposer/jobService.ts:571` → `lib/ai/imageSendAudit.ts:153`) and on the gateway path
  (`lib/ai/gatewayInferenceProvider.ts:157,174,205`).
* **Deterministic (no-AI) Generate** and Refine shipped earlier (#917, #920, #926 lineage) with
  Accept/Discard and no auto-finalize.

### E1. Merged PR ladder #1076–#1089 (Composer, image egress, signer identity, project memory — kept separate on purpose)

Ladder legend — **I** implemented · **T** tested (by what) · **M** merged · **D** deployed ·
**C** clinically validated by a radiologist on a deployed build. `✔` yes, `✘` no, `—` not applicable.
No row has `C`. Nothing has `D`.

| PR | Purpose (the PR's own sentence) | Head | Merged as | Tests that exist | Known limitations | I·T·M·D·C |
|---|---|---|---|---|---|---|
| **#1076** | *"AI image-egress strictness was a constant, so comparing a local and a cloud vision model cost a redeploy"* — the AI security mode becomes one server-decided setting with two strictness levels (`lib/ai/aiSecurityPolicy.ts:31`, fail-closed `:36`) | `30616415` | `66d2c116` (2026-10-19 16:11Z), 22 files +1990/−45 | request suites `aiSecurityPolicy.request.test.ts`, `imageSendAudit.request.test.ts`; CI green at head | the PR body still reads **"Status: DRAFT… nothing enabled"** — a merged PR whose own header says Draft; the mode is a resolved **setting**, so the clinic's value is whatever its DB holds, which this pass could not read | ✔ ✔ ✔ ✘ ✘ |
| **#1078** | *"Every interactive route that sends images refused the cloud arm in both modes"* — the egress gate is applied at every image door (`resolveInteractiveImageEgress:197`) | `673f1e1c` | `a787bafb` (16:59Z), 6 files +1189/−6 | `aiReporting.imageEgress.request.test.ts` (now 50 tests) | **two image doors existed historically**; this closed the interactive ones. De-identification itself is still uncalled (**G-11**, `CLINICAL_SAFETY_REGISTER.md` §5) | ✔ ✔ ✔ ✘ ✘ |
| **#1079** | *"The model comparison screen could run a prompt but never a picture"* — comparison UI picks images and a model per arm (`routes/aiComparison.ts:36-40` ceilings) | `35ffb84b` | `b67869ed` (17:31Z), 4 files +1020/−149 | request evidence +909 lines in the imageEgress suite | never used by a radiologist on deployed code; two owner decisions left open when it landed | ✔ ✔ ✔ ✘ ✘ |
| **#1077** | *"Composer usability-first (Tasks A, C, E): Quick Select order-independence, Conclusion retirement, executable acceptance journeys"* | `1d5a49b7` | `6a31307f` (17:54Z), 21 files +2651/−86 | CI **15,243 tests** on that merge commit; acceptance journeys in `lib/clinicalAcceptanceJourney.test.ts` | the PR **title** still begins "Draft —"; its body records that only the *first round* merged, with a **final corrections round** still pending | ✔ ✔ ✔ ✘ ✘ |
| **#1082** | *"Composer/usability first"* — the re-land of the tasks that #1077 left unfinished | `01a98d3f` | `80a09df4` (20:22Z), 24 files +1207/−67 | its test job on the merge commit reads **cancelled** (concurrency group); green on the PR head | **empty PR body** — the purpose exists only in the 6-word title, which is why this row had to be reconstructed from the diff | ✔ ✔(head) ✔ ✘ ✘ |
| **#1080** | *"A model that was never shown the picture could still answer as an image reading"* — a vision arm must have been sent the image to claim it read it | `76fe43b0` | `c4462041` (20:29Z), 7 files +1289/−23 | green at head; **red on `main` after its own squash** (TEST 15 arm order) | the merged tree carried a failing test for ~8 hours until #1086; a merge is not a verdict | ✔ ✔ ✔ ✘ ✘ |
| **#1081** | *"A development checkout on a copy of production could reach the live clinic, so `CARE_DEV_ISOLATED=1` makes it impossible"* | `1209ae49` | `c208cbfb` (2026-10-19 21:39Z), 25 files +2392/−138 | `devIsolationDoors.test.ts`, `devIsolationStartup.test.ts` + CI green at head | merged, never run on this Windows box (`CURRENT_STATE.md` §6: 8181/5173/5411 all not listening). Not deployed — and it does not need to be, since it is a development guard | ✔ ✔ ✔ ✘(n/a) — |
| **#1085** | *"Radiology print and PDF quality: Doppler emphasis, missing-image notice, harness coverage, **signatures from records**"* | `55de3cce` | **`47b739c8`** (2026-10-20 03:49:09Z), 10 files **+783/−46** | CI 3/3 success **on the head** (completed 02:53:22Z) **and 3/3 on the merge commit** — run `39366275815`, 15,427 tests / 1,140 files. Its own new rendered-output harness is ~+320 lines; `lib/reportSignerSelection.ts` is now the single chooser of the signature block — **dated correction, same day:** that module **no longer exists**. #1088 (`37a6758c`, 15:11:14Z) deleted it and its 109-line test; the chooser is now `artifacts/diagnostic-erp/src/lib/reportSignerEligibility.ts` on the front end, where `recordedSignerForReport()`/`loadSignerOfRecord()` also live (`artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.ts:529`, `:568` — **not** the server; corrected in place 2026-10-20 after an earlier draft of this row put them there). Quote the correction, not this sentence | merged, **not deployed**, and **no human has looked at a rendered page or PDF produced by it** — the print/PDF and signature claims stay OPEN in `CLINICAL_SAFETY_REGISTER.md` §8, §9 until someone reviews produced artifacts. Tests render synthetic cases; that is a harness, not acceptance. **Re-scoped by #1088:** §9.1's preview and PDF doors are now closed in merged code (PP-5A/PP-5B); what this row still buys nobody is a *rendered* review, plus §9.2 and §9.3 which it never touched | ✔ ✔ ✔ ✘ ✘ |
| **#1086** | *"A two-model comparison was pinned to the order the provider read their sockets"* — retire a fragile test demand, keep the clinical invariant | `a608eee0` | `1c80f2d3` (2026-10-20 08:29 IST), 1 file **+90/−5** | the suite itself: **50 tests** green on both `1c80f2d3` and the current tip (tip log line 2017, 2,281 ms); new **TEST 15b** forces out-of-order completion behind a 2 s barrier with a positive control; mutation battery M1–M3 with a clean-baseline control | test-only. It proves the harness catches completion-order bugs (M2); it does not prove anything about production behaviour | ✔ ✔ ✔ ✘ — |
| **#1083** | *"Project memory reconstructed from the tree: merged is not deployed, and 15,243 green tests are not a browser pass"* — this documentation set | `2d8fbcea` | `d45370c3` (03:48:31Z), 6 files **+1,188/−0** | docs only; CI green on the head | **the landed copy is the `c4462041` snapshot**: it says `main` is red, that #1081 is a Draft and that three PRs are open. All three were overtaken the same day. The follow-up commit on this branch corrects them in place and keeps the wrong text visible | ✔ ✔ ✔ ✘ — |
| **#1084** | *"Reconstruct the AI Composer's actual state at 80a09df4, and separate it from what the docs claim"* | `a1b53e18` (final; `130fc9f5` was its head minutes earlier) | `d7abb9b3` (03:48:48Z), 4 files **+3,393/−0** | docs only; CI green on the head | sits on `main` as `docs/architecture/radiology-ai/AI_COMPOSER_*.md`, and **its G-20 row is false against today's tree** (`AUDIT_RECONCILIATION.md` §2). Docs merged ≠ docs correct | ✔ ✔ ✔ ✘ — |
| **#1087** | *"Project memory synchronised to 47b739c8 (documentation only)"* — that branch: the dated corrections plus `OWNER_VISION.md`, `AUDIT_RECONCILIATION.md`, `CLINICAL_SAFETY_REGISTER.md` | `4589e224` (head at merge; this row was first written against `405c7192`, and the head moved underneath it — the caveat this row carried is now a demonstrated fact) | **`8bbac44e`** (2026-10-20 **15:10:50Z**), 9 files **+1,067/−126** | markdown only. **CI 3/3 success on the head** (`GET /commits/4589e224/check-runs`: Static, Build identity, Tests + migration smoke all completed/success); **all three jobs `cancelled` on the merge commit** because #1088 landed 24 s later and the concurrency group is `ci-${{ github.ref }}` with `cancel-in-progress` — a docs-only squash, so nothing was skipped | the owner's approved vision and the two newest registers are **now on `main`**, so every agent working from `main` is expected to read them. It carried no clinical fix, and its own text said the letter-pad `"Signed:"` door was open pending D-8 — **#1088 closed that door 24 seconds after this merged**, so that claim is already stale and is corrected in `CLINICAL_SAFETY_REGISTER.md` §9.1 | ✔ ✔(CI, docs-only) ✔ ✘ ✘ |
| **#1088** | *"The name on a finalized report is the person who authorized it (PP-5A, PP-5B)"* | `54823338` | **`37a6758c`** (2026-10-20 **15:11:14Z**), 20 files **+1,658/−293** | **CI 3/3 success on the head.** `GET /commits/37a6758c/check-runs` returns **`total_count: 0`** — not a failure, not a pass: no run is recorded for that merge commit at all (see `CURRENT_STATE.md` §2 for how to read this). New suites: `reportSignerEligibility.test.ts` (102), `reportSignerNoNameRule.test.ts` (85 — a ratchet over 6 pathway files), `draftPreviewNamesNoSigner.request.test.ts` (168), `radiologyReportPdfExport.signedArtifact.test.ts` (171), `reportPdfGenerator.signerOfRecord.test.ts` (257), `signedArtifactTrust.request.test.ts` +144. It **deleted** `lib/reportSignerSelection.ts` + its 109-line test, which #1085's row above recommended one day earlier | Closed in **merged code**: a preview signs nobody (`previewSignatures: []` + `signerUnsigned: true` + the `PREVIEW — NOT SIGNED` stamp), the print route renders `NOT SIGNED` from `signatureSlotHtml()` (`reportPresentation.ts:506`), an unsigned row cannot be exported as a signed artifact (`SignedReportArtifactRequired`, `radiologyReportPdfExport.ts:361`), and an inactive signature is refused at sign time (`signature_not_active`, `patient-reports.ts:2599`). **Still open after it:** the Studio bridge relays the signer name in the request body (`internal-reporting-studio.ts:845`, `:889` → §9.2 / D-4), a staff row can bind any *active* signature on its own user while `SIGN_DENY_ROLES` (`patient-reports.ts:2442`) gates who may sign at all and not which signature (**§9.3 / R-19 / D-10, new finding of this pass**), and the verify route (`patient-reports.ts:2650-2680`) still does not call `checkUnreviewedAiFinalize`. Not deployed, not rendered, not reviewed by a radiologist | ✔ ✔ ✔ ✘ ✘ |
| **#1089** | *"The vision trial answered a shorter request than the operator made"* — the A/B image trial mapped, mime-filtered and then `.slice(0, 6)` the survivors, so a nine-image trial answered images 1–6 and the prompt, token counts and verdict were all computed from the survivors | `d243430c` | **`dc8c3aba`** = the current tip (2026-10-20 **15:11:37Z**), 4 files **+367/−17** | **CI 3/3 success on the head and on this merge commit** — run `39446153649`, 15,489 passed / 49 skipped over 1,140 test files (5 skipped) in 489.21 s. New `lib/reportComposer/trialImageSet.ts` (`:25` `VISION_TRIAL_MAX_IMAGES = 6`, `:27` jpeg/png/webp, `:68 normalizeTrialImageSet`), called at `routes/reportComposer.ts:755`, which refuses the **whole set** with `400 {error, suppliedCount, droppedIndexes}`. `reportComposer.visionTrialGate.test.ts` is a **static** guard: it asserts the handler source contains `normalizeTrialImageSet(body.images)` (`:62`) — the DB-backed suite was removed before merge, and the commit message records that | **One door, not the class.** Only one caller passes through the gate: `runDeepSeekVisionAbTrial` is called at `reportComposer.ts:767`, i.e. *after* `:755`, so the provider's own silent `opts.images.slice(0, 6)` (`lib/reportComposer/providers/deepseekVisionTrial.ts:112`) is currently unreachable with a >6 set — it is still trimming code, untested, that any second caller would hit. And this is the **trial** path; the report-Composer image reader is untouched: `lib/reportImages.ts:147`/`:186` return `null` with no reason, `:238` drops tiles on a character budget ("skip gracefully, keep order"), `:254` sends `src: src ?? ""` — last line of that file's history is `4eeb9bc3` (#918). **NOT VERIFIED:** nothing here was exercised against a real Orthanc or a real trial | ✔ ✔ ✔ ✘ ✘ |
| **#1090** | *"CARE Composer 99.9: the facet contradiction fixed, reconstruction regressions closed, signer authority reconciled"* | `913c2f18` (final head; 12 commits. Earlier heads this directory recorded — `4598e8a9`, `06befc27` — were real readings of the same PR minutes earlier, and the branch-side conflict resolution is merge commit `104d3f48`, parents `06befc27`+`dc8c3aba`, **unreachable from `main`** because the PR squash-merged: `KNOWN_ISSUES.md` §4 item 25) | **`ed04acbc`** (2026-10-20 **17:14:26Z**), 29 files **+2,675/−41** | New suites in the PR: `composerApplyGate.test.ts`, `draftPrintSafety.test.ts`, `draftAwarePrintSettings` (the DRAFT watermark rule), `staleAutosaveAck.test.ts`, `clinicalAcceptanceCorpus.test.ts`, `facetStudyWideRetirement.test.ts`, `lateralityDeselectBoundaries.test.ts`, `replacementChainRestoration.test.ts`, `__debugPollution.test.ts`; CI **3/3 green at its head** and **3/3 on `main` tip** | **This pass measured what it composed, not just what it added:** it is the PR that had to resolve R-18 against #1088, and the composition is correct — `radiologyReportPdfExport.ts:391` refuses a signed report before `:397` composes the watermark, with `unsignedDraftRef` mirrored from the record (`useWorkspaceExportShare.ts:621`). **Moved line numbers it left behind:** `SignedReportArtifactRequired` `:361→:374`, its throw `:378→:391`, the artifact download `:299-306→:312-320` — **and #1093 moved two of those again** (`:374`/`:391` unchanged, but the download is now `:320-328` and the `unsignedDraftRef` mirror `:621→:629`), which is precisely why `KNOWN_ISSUES.md` §4 item 23 says to cite the construct and re-grep it. **New findings it did not close:** PI-1, PI-2, PI-3 (`CLINICAL_SAFETY_REGISTER.md` §0.2.1), owner decision **D-13** (a clinic watermark outranks `DRAFT`, `draftAwarePrintSettings.ts:46-48`, pinned by `draftPrintSafety.test.ts:92`), and R-20 (the census suite it changed the store under). It also landed `CARE_COMPOSER_99_9_PROGRESS.md` at the repo root — R-21 | ✔ ✔ ✔ ✘ ✘ |
| **#1091** | *"A restored unsaved draft claimed the radiologist wrote the AI’s sentences"* | `b9d8ef51` (1 commit) | **`0799d175`** (2026-10-20 **17:14:45Z**), 6 files **+816/−12** | `lib/aiAttributionRestore.ts` + `aiAttributionRestore.test.ts` + a 441-line `aiAttributionRestoreJourney.hardening.test.ts`; CI **3/3 green at the head** (it read 2-of-3 with Tests undecided an hour earlier in this directory’s log) | Closes register row 8 and decision **D-12** in **code**: the restore banner now carries provenance only inside a verified context with the same `reportId`, and `RESTORE_FALLBACK_SOURCE = "manual"` is a *named* fallback rather than a silent stamp. **Not claimed by this pass:** no test was run here, no browser restored a draft against it, and row 8’s four downstream consumers (`observationSlot.ts`, `conceptCanon/normalImpression.ts`, `impressionProvenance.ts`, `useReportComposer.ts:261-264`) were not re-verified against the merged behaviour | ✔ ✔ ✔ ✘ ✘ |
| **#1092** | *"Project memory reconciled to dc8c3aba (documentation only)"* — this directory | `e9444a4c` (2 commits) | **`c199aea2`** (2026-10-20 **17:15:07Z**), 9 files **+1,062/−364** | no tests (markdown only); CI **3/3 green** — the grounding job does **not** cover `docs/project-memory/`, so its green says nothing about these files | Made two things true that this file had previously only asserted: every path citation resolves **and** names the right package, and every markdown table is well-formed. Two throwaway scripts found five real defects a full prose read had missed. **Superseded by its own successor within four hours** — `OWNER_DASHBOARD.md` was added by the next pass, so the corpus is ten files, and `CURRENT_STATE.md` carries a fourth-baseline banner | ✔ ✔ ✔ ✘ ✘ |
| **#1093** | *"An unsigned report must not borrow this workstation's signature"* — the print/PDF/Word doors and the Report Hub dialogs | `200f6c8a` (final head; `ea00849a` before it, and that earlier head's red was the census suite, not this PR — R-20) | **`2ec675ab`** (2026-10-20 **17:38:08Z**), 7 files **+135/−10**, of which 3 are test files (+94) | CI **3/3 green at the head**, and **3/3 on `main` at `2ec675ab` and again at `b0610551`**. **This pass ran its three suites itself** (`radiologyReportLifecycle.test.ts` 27, `radiologyReportPdfExport.signedArtifact.test.ts` 10, `radiologyReportPrintLiveMerge.test.ts` 8): **45 passed in 696 ms** at `2ec675ab` in a clean worktree. The author's separate claim — *6 assertions fail with the three changes removed* — was **not** re-derived here. The author's browser reproduction of PI-1/PI-2/PI-3 is the author's and is recorded as such | Closes **PI-1** (`radiologyReportLifecycle.ts:579` now `{ signerOfRecord: null, unsigned: true }`, fail-closed, same shape at `:588`), **PI-2** (`useWorkspaceExportShare.ts:258` asks the record, `:261` passes `authorizedArtifact`, `radiologyReportPrintLiveMerge.ts:381` returns the server artifact untouched) and **PI-3** (`ReportHub.tsx:1004` `SIGN_WITHOUT_BLOCK = "as-me"`, mapped to `null` at `:1019`/`:1072`, used at `:1041`/`:1096`). **What it did not close:** D-13's watermark precedence (untouched, `draftAwarePrintSettings.ts:46-49`), the Option A/B question of whether Word export of a signed report should be blocked outright, D-10, D-11, R-14, R-10 — and it is **not deployed**, so PI-3's dead-end dialog is still the clinic's reality | ✔ ✔(CI + this agent's local run) ✔ ✘ ✘ |
| **#1094** | *"The AI audit trail knew where every send went; the audit page showed none of it"* | head per the PR record at merge | **`9fcd1e8e`** (2026-10-21 **02:06:47Z**), 3 files **+522/−18** | Author reports 21 unit tests, **8/8 mutants killed**, 16/16 browser checks on a synthetic database. **This pass ran neither** — no test from this PR was executed here, and no browser was opened | `GET /api/ai-reporting/audit-log` already selected `endpoint_locality`, `image_source_types`, `job_reference`, `correlation_id` (written by PR-A, #1076, #1078); `AiAuditLog.tsx` declared and rendered none of them. New pure module `lib/aiAuditDisplay.ts` + its test: a missing locality renders **LOCALITY UNKNOWN, never "local"**, TEXT-ONLY vs VISION come from the row's pixel count, and an image-source list absent or shorter than that count is **PROVENANCE UNVERIFIED** — deliberately the same asymmetry the egress gate uses, so the table and the gate cannot disagree about one send. No policy, provider, signing or access-control change. **All of it is invisible in the clinic until deploy** | ✔ ✔(author's) ✔ ✘ ✘ |
| **#1095** | *"Project memory reconciled to c199aea2, with the first Owner Dashboard"* — this directory | `9afd135e` (2 commits) | **`93fb53ad`** (2026-10-21 **02:07:07Z**), 13 files, markdown only | **`GET /commits/93fb53ad/check-runs` returns no check-runs at all** — not green, not red, nothing recorded. Do not cite this merge as "docs passed CI"; the *tip* is green, this commit has no verdict | Added `OWNER_DASHBOARD.md` (so the corpus is ten files in `docs/project-memory/`), corrected R-18 to CLOSED on measured composition, opened R-20/R-21/R-22/R-23, and recorded the first byte census of the tracked tree — which is how the corpus in D-14 was found at all. **Superseded by #1096 24 seconds later**, exactly the failure mode its own R-21 row describes, and superseded on its numbers by this pass: its 4,975 / 280.8 MiB corpus figure was off by 15 files (`KNOWN_ISSUES.md` §4 item 27) | ✔ ✔ ✔ ✘ — |
| **#1096** | *"Composer: the owner's 16-step workflow as one integration journey across #1090/#1091/#1088"* | `25d92bc4` | **`b0610551`** = the current tip (2026-10-21 **02:07:31Z**), 1 file **+344/−0** | CI **3/3 green at its head and on `main` at this SHA**. No explicit per-test timeout on either `it` (`:124` is the async 16-step chain, `:337` a source-contract check) — the **second** long suite now riding Vitest's 5 s default alongside R-20's census | Chains Mode A normal → Quick Select retire → severity lineage → deselect restore → manual text survival → draft-envelope round trip → unsaved-draft banner restore with preserved AI attribution → DRAFT watermark composition → finalize → signed-artifact redirect → every writer refusing after signature, all at the **real store and exporter boundary** on controlled synthetic data. **Its own header records the limit, which is why it is not clinical evidence:** *"this container has no browser and no PostgreSQL … never claims a rendered page or a database row."* It converts #1090+#1091+#1088 from "each green alone" to "one green continuous run", and nothing beyond that | ✔ ✔ ✔ ✘ ✘ |

**Reading rules for this table.** `T ✔` names the harness; a CI job on a *merge commit* can read
`cancelled` (concurrency group `ci-${{ github.ref }}`) without anything being wrong, so this pass read
the PR head **and** the merge commit and said which. A merge commit can also return
**`total_count: 0` check-runs** — #1088's `37a6758c` does — which is neither a pass nor a failure but
*no evidence at all*; the rule then is to read `GET /actions/runs?branch=main` for the run that
covered it (tip `dc8c3aba`, run `39446153649`) and to say plainly that a green tip is not a verdict on
the intervening squash. `M ✔` came from `merged`/`merged_at`, never from `merge_commit_sha`. `D ✘` for
every row because the last deploy a document records is 2026-10-12.
`C` is `✘` for every row because no radiologist has been observed using any of it.

## F. Delivery, HOPE, outbox

Outbox retry accuracy and stale-`sending` reclaim (`services/integration/outbox.ts:218/253/282`
`FOR UPDATE SKIP LOCKED`); per-row lease fencing (#996); reconcile fair progress (#997); duplicate
link race closed with one advisory-lock key (#998); external link integrity (#999); abandoned
delivery recovery (#995); WhatsApp outbox recovery (#1000); HOPE evidence per report (#1001);
receiver-ack durability (care-pacs/hope side, #190/#191). CI.
**None of this has ever delivered a report in production** — the outbox has 0 rows (§ CURRENT_STATE
§2/§7).

## G. Print, PDF, presentation, export

Frozen key images drive print/PDF when present and never silently substitute live pixels
(`lib/frozenKeyImages.ts:1-14`, the unavailable placeholder at `:46` used at `:198`; the legacy
fallback is `resolveDraftKeyImages` (`lib/reportImages.ts:219`) reached from
`lib/frozenKeyImages.ts:287` and `:295` — this line used to read "`reportImages.ts:219` via
`:287/:295`", which is ambiguous, because those two lines are in `frozenKeyImages.ts`, not
`reportImages.ts`, and `reportImages.ts` is only 279 lines long). HMAC grant-token distribution with
600 s TTL (`lib/keyImageAccessToken.ts:46`), enforced in
`lib/radiologyKeyImageStatic.ts`; key-image ownership proven at compose time
(`reportComposer/keyImageOwnership.ts`). PDF pagination (`ensureSpace`) #1021; key images on the PDF
(#944/#945); sub-headings (#818); enterprise summary export — Word table, compressed PDF, styled
Excel (#895). **Signer identity on the produced document — #1088, `37a6758c`, 2026-10-20 15:11:14Z:**
an unsigned row prints `NOT SIGNED` from `signatureSlotHtml()` (`lib/reportPresentation.ts:506`, the
`.signot` style, fed by `signerUnsigned` from `routes/patient-reports.ts:3482`); a
Composer preview signs nobody (`previewSignatures: []` + `signerUnsigned: true` at
`routes/radiology-report-generator.ts:2451`, stamped `PREVIEW — NOT SIGNED`); the browser PDF
generator refuses a signed row before it fetches a pixel — `SignedReportArtifactRequired` is declared
at `artifacts/diagnostic-erp/src/lib/radiologyReportPdfExport.ts:361` and thrown at `:378` — so a
signed report downloads the server artifact instead (`GET /api/patient-reports/:id/pdf`,
`routes/patient-reports.ts:3577`); and the front-end PDF writer draws
`doc.text("NOT SIGNED"…)` (`artifacts/diagnostic-erp/src/lib/reportPdfGenerator.ts:1403`), with the
unreadable-key-image notice at `:772`. **Which package each door lives in matters:** the PDF is built
in the browser (`artifacts/diagnostic-erp`), the print HTML server-side (`artifacts/api-server`) — a
claim about "the PDF" and a claim about "the print page" are different code, and this line originally
cited both as `lib/…` under the API server, which is where `reportPresentation.ts` is and where the
other two are not. `reportSignerNoNameRule.test.ts` ratchets
that no pathway file may name a doctor. **CI + rendered-output harness checks only — no human has
reviewed a page or PDF produced by #1085 or #1088, and neither is deployed.** **PDF bytes are
timestamp-nondeterministic: prove layout from the print/screen HTML, never the PDF.**

## H. Deployment, ops, backup, DR

`deploy-synology.sh` hardened: branch pin `:39-47`, build identity `:56-95`, secret refusal
`:108-133` + `check-env-secrets.mjs` gate, migration timeout is now a failure `:232-264`,
`deploy-health.mjs` gate `:283`, `verify-deployed-identity.mjs` `:307-317`. Loopback-only DB publish
(`docker-compose.yml:80`) after an audit found the port reachable across the clinic LAN.
Backups: `scripts/synology-nas-backup.sh` designated PRIMARY, retention 14 d / floor 2 copies /
10 KiB floor (`:36`), restore `scripts/synology-restore.sh`, sandboxed proof
`verify-backup-restore.sh`, uploads proof `verify-uploads-restore.mjs`, inventory
`ops-backup-inventory.mjs`. Migration ledger audit cut 167 false criticals to 1 (#957). CI.

## I. Verification infrastructure (the most reused asset)

* `scripts/grounding-check.cjs` + `scripts/grounding.manifest.json` — **105 architecture claims**
  (27 table, 21 column, 37 function, 20 contains) over 53 files, validated statically, **fails the
  build** if any is contradicted. Its own header records why: *"An architecture document that
  disagrees with the schema is a defect, not a design."*
* `scripts/check-migration-order.cjs`, `migration-manifest.mjs`, `migration-bootstrap-smoke.mjs`,
  `api-route-coverage.mjs`, `ops-preflight.mjs`, `build-identity.mjs`,
  `docker-build-identity.mjs`, `verify-deployment.mjs`, `preview-reports.mjs`.
* **74 `*.request.test.ts`** route suites that boot the real router over supertest against
  PostgreSQL, plus **1,118** `*.test.ts` and **24** `*.test.mjs` files in `artifacts lib scripts`
  (counted with `git ls-tree -r --name-only origin/main -- …` against the *tree*, not a checkout). CI
  runs the whole thing on `postgres:16-alpine`: at tip **`dc8c3aba`**, **15,489 passed / 49 skipped
  (15,538)** over **1,140 files passed / 5 skipped (1,145)** in **489.21 s** (run `39446153649`, step
  log `12_Vitest suite (sequential — one shared DB).txt`, lines 6369/6370/6372 — not inferred). The
  previous tip `47b739c8` was 15,427 / 15,476 over 1,140 files in 538.27 s (run `39366275815`'s
  `0_Tests + migration smoke (real Postgres).txt`, lines 7579-7582, kept as history); before that
  `1c80f2d3` was 15,406 / 15,455 over 1,138 files in 775.25 s (run `39361881382`, lines 9311-9314),
  and an earlier revision of this file quoted `6a31307f`: 15,243 / 1127 files / 619.89 s. Note that
  the executed-file count moved **1,140 → 1,145** while #1088 alone added **six** new test files and
  #1089 two: **do not reconcile these by arithmetic** — the two intermediate merge commits have no
  test run of their own (`8bbac44e` cancelled, `37a6758c` reports zero check-runs), so only the tip's
  number is a verdict on the full tree. The
  **duration varies by ~40 % between runs of the same tree** — never read a slow CI job as a regression.
  The same log contains two literal `FAIL` strings from `restoreVerifiesRealArtifact.test.ts` (step-12
  lines 5716, 5719) inside a job whose conclusion is `success`.
* Two Playwright specs are wired as scripts: `pnpm e2e:smoke`, `pnpm e2e:voice-composer`.

## J. What "completed" does **not** mean here

1. **Not deployed.** Every item above this baseline except the 2026-10-12 build is invisible in the
   clinic. **117** commits since 2026-10-12 22:30Z (`git rev-list --count --since=2026-10-12T22:30:00Z
   origin/main`, measured at `c199aea2`; **121** at `b0610551`; it read **114** at `dc8c3aba`, 111 at `47b739c8`, 108 at
   `1c80f2d3`, 106 at `c4462041` — all four earlier numbers are correct for their own baseline, which is
   why the instruction is to re-run it, not to recall it). **13** of those 117 merged on 2026-10-20
   (committer date, all PR-suffixed: ten by 15:11Z and #1090/#1091/#1092 in the 41 seconds at 17:14-17:15Z).
2. **Not browser-proven on the merged tree.** D2/displayed-image identity FAILS CL-5 and is
   described as dormant; the comparison UI (#1079) has never been used by a radiologist on deployed
   code.
3. **Not observed end-to-end.** HOPE delivery: 0 rows in three tables. Restore: 0 rows in
   `public.backup_verification`.
4. **Unwired governance.** `runEvaluation` (`lib/ai/evaluationRunner.ts:36`) and `admitJob`
   (`lib/ai/aiScheduler.ts:120`) have **no production caller**, and `ai_golden_cases`
   (`lib/db/src/schema/aiEvaluation.ts:36`) has no inserter anywhere in the repo. The tables and
   functions exist; the loop does not.
5. **Dead seams kept on purpose.** The Super Admin portal is outside the workspace but still in the
   root `dev` script; `ff_radiology_usg_workspace` defaults OFF and gates nothing; the Orthanc Lua
   fast path is written but never loaded. These are recorded in `OPEN_WORK.md` rather than silently
   deleted.
