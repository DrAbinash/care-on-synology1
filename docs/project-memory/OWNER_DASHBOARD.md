# OWNER DASHBOARD — CARE ecosystem

Read this in two minutes. Every row is a measurement taken for this file, with the command or API
call that produced it. Nothing here is inferred from a PR title, a CI badge or an agent's summary.

**Verified at `2026-10-21 03:45Z` (09:15 IST).** `care-on-synology1` `origin/main` = **`6fd16cda`**.
Status vocabulary is the five-category set in `CURRENT_STATE.md` §0:
**IMPLEMENTED → TESTED → MERGED → DEPLOYED → CLINICALLY VERIFIED.** A row never moves right without
evidence of the specific step. "Browser-tested" is reported separately from "regression-tested", and
who ran the browser is named — this pass ran no browser.

**The one-line state:** the three print-integrity defects (PI-1/PI-2/PI-3) are **fixed in source and
merged** (`2ec675ab`), their regressions pass locally at that commit, and **none of it is in the
clinic** — the deployed build is 126 commits behind. **Nine PRs have merged since the last
reconciliation** (`c199aea2`), the last two while this revision was being written: **#1100 merged the
signature-ownership fix** (D-10) at 03:29:53Z and **#1101 merged the previous revision of this very
directory** at 03:30:08Z, so these files are now on `main`. `main` carries **two unapplied migrations**
(#1097's factory seed, #1100's `signatures.user_id`). See §1.
This pass also measured the repository's legacy report corpus, and the privacy question D-14 posed as
unknown now has an answer: the files are real clinical records. See §5 D-14.

---

## 1. Project health

| | State | Evidence |
|---|---|---|
| `main` | **`6fd16cda`** (2026-10-21 03:30:08Z) — **nine** squash merges since `c199aea2`: `2ec675ab` (#1093), `9fcd1e8e` (#1094), `93fb53ad` (#1095), `b0610551` (#1096), `4765f583` (#1098), `18699b9b` (#1099), `27f53bda` (#1097), `daff1400` (#1100), `6fd16cda` (#1101, this directory's previous revision). **1,992 commits total on `main`** | `git fetch origin && git rev-parse --short=8 origin/main` = `6fd16cda`; `git rev-list --count c199aea2..origin/main` = **9**; `git rev-list --count origin/main` = 1,992 |
| CI on `main` | **`main` IS RED at the current tip.** At `6fd16cda`: `Static checks` success 03:33:14Z, `Build identity` success 03:32:05Z, **`Tests + migration smoke` FAILURE 03:46:57Z — one failing test: `quickSelectClickOrderCensus.test.ts:174 — Error: Test timed out in 5000ms`** (read from `GET /check-runs/{id}/annotations`, since Actions job logs 404 for this token). **That is R-20 recurring on `main`** — the exact defect PR #1102 repairs, now demonstrated on the repository's own trunk, in the file #1101 did not touch. The immediately preceding commit `27f53bda` was **3/3 green** (`Tests` 03:20:32Z) and remains the only completed green whole-suite run covering #1098+#1099+#1097. `4765f583` = all three **cancelled**; `18699b9b` = Static + Build success, Tests cancelled; `daff1400` = **all three cancelled** because #1101 landed 15 s later; `b0610551` = 3/3 | `GET /commits/{sha}/check-runs` + `GET /check-runs/{id}/annotations`, read 03:39Z / 03:42Z / 03:51Z. **Two consecutive runner failures, two different tests**: #1102's own run at 03:36:44Z died on `providers.test.ts:318`, main's at 03:46:57Z on the census — so a red `Tests` job does not name your PR. Second trap: **`status` lags `completed_at`**, so one read of a finished run can still look unfinished (`KNOWN_ISSUES.md` §4 items 29 and 30) |
| Test volume | **15,622 passed, 49 skipped (15,671)** over **1,150 files, 5 skipped (1,155)** — *carried forward, dated 2026-10-20, not re-measured*: Actions job logs return 404 for this token | job `118772471534` log, ANSI stripped. Re-derive from a job log, never from the check-run verdict |
| Production (Synology) | **NOT DEPLOYED — 126 commits behind `main`** (117 → 121 → 124 → 126 across this one file's revisions), last verified deploy **2026-10-12** | `git rev-list --count --since=2026-10-12T22:30:00Z origin/main` = 126. The NAS was **not contacted this pass** (read-only rule), so the deployed SHA stays a carried-forward, dated fact |
| Pending migrations | **Two, both unapplied.** #1097: `migrations/zzzzzzzzzzzzzzzzzzzzz_quick_select_factory_boxes_r006_215e2a0c52d9.sql` (+286). #1100: `migrations/zzzzzzzzzzzzzzzzzzzz_signatures_owner_user_id.sql` (+60) with `lib/db/src/schema/signatures.ts` +6/−1 (`userId: integer("user_id")`, **no foreign key, no NOT NULL, no default** — deliberate, and the reason a NULL-owner block is still usable). None in #1093–#1096, #1098, #1099 or #1101 | `git log --format='%h' c199aea2..origin/main` × `git show --name-only \| grep '\.sql$'` returns exactly those two rows. **Re-implementation risk, measured:** #1100's file is written to be re-run (`ADD COLUMN IF NOT EXISTS`, two idempotency guards, no `INSERT`); **#1097's is not** — it is a bare `INSERT INTO radiology_quick_findings (…)` at `:259` with **no `ON CONFLICT`, no existence guard and no `BEGIN/COMMIT`**, while that table carries **five unique indexes** including `radiology_quick_findings_factory_key_uq`. So a second execution of the seed step is expected to raise a unique violation rather than duplicate rows. **Not verified here:** whether `deploy-synology.sh`'s migration chain runs each file inside one transaction or continues after an error — that determines whether a re-run is a warning or a halted deploy, and it is the first thing to read before the deploy window, not during it. Consequence: the clinic's next deploy is **not** a code-only restart — it runs two schema steps, one of which changes who can sign a report |
| Critical clinical risks | 0 open print-integrity defects; **D-10 is decided-and-merged but not yet in force** (see §5 D-10: the guard is inert until the migration deploys, and stays permissive for every block the clinic has never claimed); R-14 and R-10 stand; D-14 is a measured privacy exposure; #1097 left two Impression defects failing on purpose (R2-4, R2-6) — §4 | `CLINICAL_SAFETY_REGISTER.md` §0.4, and §5 below for the corpus |

**The single most important sentence:** every fix on this list — signer identity, the unsigned-export
watermark, the Word/PDF live-merge gate, AI attribution, the AI-Apply overwrite gate, the audit page's
egress columns, the audit row's right to call an empty answer a failure, the vision-model gate that now
believes the server over the name table, the regional tile catalogue, and **the rule that a signature
block belongs to an account** — is **merged and running in nobody's clinic.** The clinic is still printing
the 2026-10-12 build, which is 126 commits and **two** schema changes behind `main`. One of those schema
changes is the reason D-10's protection is not yet real: the code that refuses another clinician's block
reads a column the production database does not have yet.

---

## 2. Development

**Open PRs: two** (`GET /pulls?state=open`, read 2026-10-21 03:51Z) — this directory's CI-repair PR
**#1102**, and **Draft #1103**, opened at 03:50:55Z by the print agent on top of the tree #1100 created.
Everything else opened in this cycle has merged, including the two that landed while an earlier revision of
this file was being written: **#1100 (D-10, signature ownership) at 03:29:53Z** and **#1101 (that previous
revision of these files) at 03:30:08Z**, 15 seconds apart.

| PR | Owner | State at read | What it decides, and its real blocker |
|---|---|---|---|
| **#1103** "A signed report kept reading the clinic's live style row, so editing it rewrote who signed it" | Qwen (print/PDF/signature — the correct owner) | **Draft**, 7 files **+679/−68**, base **`6fd16cda` (the current tip)**, `mergeable: true / unstable`, `Static checks` **success 03:53:00Z**, `Build identity` **success 03:51:34Z**, `Tests` **in progress at 03:53Z**. Files: `patient-reports.ts` +96/−62, `presentationTemplateModel.ts` +12/−3, `presentationTemplateStore.ts` +17/−2, new `reportStudyIdentity.ts` +84/−0, new `reportSignerDisplay.test.ts` +91, `presentationTemplateModel.test.ts` +23/−1, new `signedPresentationFreeze.request.test.ts` +356 | **It answers the presentation-precedence question this directory has kept open — D-13's neighbour, not D-13 itself.** Six signer-display flags are captured into the **existing** jsonb `radiology_report_presentation_freeze.snapshot` at signing — **no migration**, which the author records as the owner's instruction (a new table was rejected) — and `resolveTemplatePrecedence` puts the freeze **above** an explicit `?template=` for `copyType === "standard"`. Two preconditions had to hold: the store must **load** the freeze even when the parameter is present (it short-circuited on `!explicit`, `presentationTemplateStore.ts:503`), and style resolution had to be extracted so signing captures what rendering would use. **No missing-module defect, checked rather than assumed:** `reportSignerDisplay.test.ts` has no same-named file because its three functions (`signerDisplayFromStyle`, `captureSignerDisplay`, `effectiveSignerDisplay`) live in the PR's own `reportStudyIdentity.ts`. **Integration risk, measured not inferred:** it is the **second** PR in 25 minutes to rewrite `patient-reports.ts`'s signer path — #1100 added `authorizeSignatureBlock` at `:706`/`:2651`/`:2768`, #1103 now edits the same route's live-style read (`:3256`/`:3304`, +96/−62). Different lines, so not a textual conflict, but they are the *same authority*: who the printed report says signed it. And it **lands on `main` while `main` is RED** on the census timeout (§1), so its `Tests` job inherits that failure and cannot attribute its own. **Blocker:** the suite, plus three owner questions the PR body itself names — withdraw-then-re-sign keeps the **first** signing's flags (write-once); a pinned `?template=` is then ignored **silently**; `?useUpdatedStyle` still switches to live layout |
| **#1102** "The click-order census ran on Vitest's default 5 s, and the tree just moved" | this agent (CI tooling; the census file itself belongs to Z.ai's Quick Select area and its assertions are untouched) | 1 file **+25/−2**, base `27f53bda`, `mergeable: true / unstable`. Opened as a **Draft** at 03:27:07Z; **the owner marked it ready for review at 03:30:57Z** (`GET /issues/1102/timeline`: `ready_for_review by=DrAbinash`), so it is no longer a Draft and is now mergeable by decision. `Static checks` **success** 03:29:32Z, `Build identity` **success** 03:27:50Z, **`Tests + migration smoke` FAILURE 03:36:44Z** | **Its red is not its own change, and that is the finding.** The single failing annotation on the run is `artifacts/api-server/src/lib/pacs/providers.test.ts:318 — Error: Test timed out in 5000ms` — a PACS SSRF-guard test in a *different package* from the one file this PR edits (`artifacts/diagnostic-erp/src/lib/quickSelectClickOrderCensus.test.ts`). Same failure class as R-20, second instance, **unowned**: `resolveAndCheckHost` (`providers.ts:240`) calls `dns.lookup(host, {all:true, verbatim:true})` at `:248` with **no timeout**, and `providers.test.ts:318` asks it to resolve `this-hostname-does-not-exist-xyz.invalid`. On this box that lookup returns `ENOTFOUND` in **64 ms** and the whole 46-test suite runs in **83 ms**; on the Linux runner it crossed 5 s. So the flake is the runner's resolver, not the assertion, and the uncapped lookup sits in a **security control** — `tcpProbe` caps its socket at 3 s (`providers.ts:292-294`) but its DNS leg does not. **Blocker:** none for this PR's content — and its urgency changed mid-pass. At **03:46:57Z `main` itself
went red on this exact test** (`quickSelectClickOrderCensus.test.ts:174`, §1), so #1102 is no longer a
hypothesis about a slow file: it is the repair for the repository's current CI state. The owner decides
whether it merges on a green re-run or whether the PACS DNS cap is fixed first (that file is AI
Architecture's, so it stays a *separate* PR, not a ride-along). See §7 and `KNOWN_ISSUES.md` R-20 |

**#1100 was the integration item of this cycle, and the overlap was checked before it merged.** It edits
`radiologyReportLifecycle.ts` and `ReportHub.tsx` — the two files #1093 changed for PI-1 and PI-3 three
hours earlier — and `patient-reports.ts`. That is a real overlap on real lines, not a same-filename
coincidence, so this pass read the merged tree at `6fd16cda` rather than trusting either PR. **PI-1's
fail-closed guard survived it intact:** `loadSignerOfRecord` still returns `unsigned: true` for a missing
report id (`radiologyReportLifecycle.ts:584`) and for a failed read (`:593`), with `unsigned` computed as
`signerOfRecord === null` (`:591`); #1100's only change in that file is **one argument, 200 lines further
up**, inside `autoSignReport` (`:300` → `resolveSignerChoice(signatures, preferredSignatureId,
readStaffSession()?.user?.id ?? null)`), so the browser declines to attempt another account's block
instead of eating a 403. `ReportHub.tsx` still carries PI-3's sentinel at `:1019`
(`SIGN_WITHOUT_BLOCK = "as-me"`), used at `:1034`/`:1056` and `:1088`/`:1112`. **What is *not* proven:**
this pass re-ran nothing at `6fd16cda` — the tree this directory works in is checked out at `e0991715`
(§8), so PI-1/PI-3 are **MERGED and source-verified against #1100, not re-executed on the combined tree**.
The first whole-suite attempt on a tree containing #1100 was the tip run at `6fd16cda`, which **failed at
03:46:57Z on the Quick Select census timeout** (§1) — an unrelated test, so it neither passes nor faults
#1100; it simply means the combined tree has no green suite yet. See §5 D-10 and §6 priority 3.

> **What happened to the census timeout that blocked #1093.** It did not recur on `main`: #1093 merged at
> 2026-10-20T17:38:08Z as `2ec675ab`, and `main` has been 3/3 green at `2ec675ab`, at `b0610551` and at
> `27f53bda`. This pass measured the test directly (see priority 4 and `KNOWN_ISSUES.md` R-20): in
> isolation its heavy case runs in **2,326 / 2,409 ms** on this box at `b0610551` and **2,854 ms** at
> `27f53bda` against Vitest's 5 s default — 57% of the ceiling, after #1097 landed *without touching that
> file* — and it fires **834 un-awaited `POST /api/radiology/report-formats/:id/use` calls**, each
> scheduling a real ~400 ms backoff timer because no server is listening in a unit test. It is a slow test
> carrying network noise, not a broken one, and not any print agent's bug. The repair is now **PR #1102**
> and is test-only: one explicit measured timeout (`20_000`, ~7× the slowest sample) plus a stubbed
> `fetch`, with no assertion added, changed, skipped or removed — the census register is byte-identical
> before and after (`tiles=29 pairs=406 identical=351 sequence-only=52 content-within-group=3
> content-across-groups=0`), and a one-line production mutant still fails 3 of its 5 tests.
> **The finding that outranks the census:** #1102's own CI run went red at 03:36:44Z on a *different*
> test — `providers.test.ts:318` timing out at the same 5 s default in an uncapped `dns.lookup` inside the
> PACS SSRF guard. Same class, second instance, different owner's file (§2 and §7).

**Merged since the last reconciliation — nine, all squash-merged by `DrAbinash`, six of them inside
58 minutes and the last two inside 15 seconds:**

| PR | Merge | What it actually did (read from the diff, not the title) | Files | CI |
|---|---|---|---|---|
| **#1093** print integrity | `2ec675ab` 2026-10-20 17:38:08Z | **PI-1/PI-2/PI-3** — `loadSignerOfRecord(null)` now answers `unsigned: true` (fail closed); `handleExportWord` asks the record who signed and passes `authorizedArtifact` so a signed report's Word export is no longer re-merged from live editor text; `SIGN_WITHOUT_BLOCK = "as-me"` sentinel replaces the `value=""` that threw while rendering and killed both dialogs | 7 files +135/−10, of which 3 are test files (+94) | 3/3 green at head `200f6c8a`; **this pass re-ran its three suites at `2ec675ab`: 45 tests, 3 files, all pass in 696 ms** |
| **#1094** AI audit visibility | `9fcd1e8e` 2026-10-21 02:06:47Z | The audit page renders what the API already returned: `endpoint_locality`, `image_source_types`, `job_reference`, `correlation_id`, via a new pure `aiAuditDisplay.ts`. Missing locality is **LOCALITY UNKNOWN, never "local"**; an image-source list shorter than the pixel count is **PROVENANCE UNVERIFIED**. No policy, provider, signing or access-control change | 3 files +522/−18 | 3/3 at head; **cancelled on `main`** 20 s later when #1095 stacked over it |
| **#1095** this directory | `93fb53ad` 2026-10-21 02:07:07Z | Reconciled the ten memory files to `c199aea2` and added `OWNER_DASHBOARD.md`; machine-checked paths/tables, which is how R-22's byte census was found | 13 files, markdown only | **no check-runs recorded on `main`** — markdown is not excluded from CI here, it simply never ran |
| **#1096** composer integration journey | `b0610551` 2026-10-21 02:07:31Z | One 344-line suite that chains the owner's 16 steps across #1090/#1091/#1088 at the real store/exporter boundary on synthetic data. Its own header records the limit: *"this container has no browser and no PostgreSQL … never claims a rendered page or a database row"* | 1 file +344/−0 | 3/3 green, including on `main` at this SHA |
| **#1097** Composer Phase 2 — regional coverage + the retire gaps it surfaced | `27f53bda` 2026-10-21 03:05:05Z | 14 new regional cases in `clinicalAcceptanceCorpus.regional.test.ts` (+366) pin replacement/restoration beyond spine and brain, **and three engine fixes the expansion surfaced**: cholelithiasis/renal/pulmonary-nodule concepts now carry the shipped normal wording as aliases (so "Gallstones" retires the normal it contradicts instead of printing beside it); the **restore path is now side-aware** (`namesOtherSide` in the falsifies oracle + laterality through `claimOf` and both store claim sites), which is the D-27 independence ruling finally carried into restoration; and MSK/abdomen/pelvis abnormal tiles that had **no `impressionSentence`** now restate their own finding — before this, the Impression could say *"Normal MRI of the knee."* over a described tear. It also carries the factory-seed migration | 11 files +705/−16, incl. `migrations/zzzzzzzzzzzzzzzzzzzzz_quick_select_factory_boxes_r006_215e2a0c52d9.sql` +286 and **4 re-baked binary PDFs** (2,522,239 B, §7) | 3/3 **success at its head `cb2eafce`** (`Tests` completed 03:05:00Z, five seconds before the merge) **and 3/3 success at the tip `27f53bda` it created** (`Tests` 03:20:32Z) — that tip run is the only completed whole-suite verdict covering #1098 + #1099 + #1097 together |
| **#1098** vision capability by server claim | `4765f583` 2026-10-21 02:56:26Z | **Order, not policy.** `assertVisionCapableModel` (`visionCapability.ts:28`) now calls the server first (`:78` `probeOllamaModelVision`) and consults the name table only when the server answered *nothing* (`show === null`): `:103` can confirm a family CARE already knows sees, `:108` can refuse a family CARE knows is text-only, and anything else still fails closed at `:121`. The name table can no longer refuse a model the local Ollama says can see — which is the `gemma4:latest` case the PR measured | 2 files +107/−10 | 3/3 green at head `b4f39167`; **all three cancelled on `main`** when #1099 landed 18 s later — the combined tree's only verdict is the run at the tip (§1) |
| **#1099** the audit row may not call an empty answer a success | `18699b9b` 2026-10-21 02:56:44Z | One rule written down once — `lib/ai/aiAuditOutcome.ts`: `isUsableAnswerText` `:29`, `NO_USABLE_CONTENT_MESSAGE` `:64`, `resolveAiAuditOutcome` `:74` (order of certainty: provider-reported → identity → normalized failure → content). **This pass counted the writers itself rather than trusting the PR text:** 8 insert sites into `ai_reporting_audit_logs` on `main` — `imageSendAudit.ts:163` and `aiReporting.ts:1687` already obeyed, **5 now route through the resolver** (`aiComparison.ts:338`; `aiReporting.ts:971`, `:1847`, `:1991`, `:2169`), and 1 is a deliberate carve-out: `aiComparison.ts:436` files the clinician's *winner selection* with `success: true` (`:452`), disambiguated only by `jobReference: "ai_comparison_winner"` (`:450`). No HTTP status changed | 9 files +1,155/−20, incl. two new request suites (`aiReportingAuditOutcome.request.test.ts` 534, `aiComparisonAuditOutcome.request.test.ts` 211) | **On `main` its `Tests + migration smoke` was `cancelled`** when #1097 took the tip eight minutes later, so the only completed run covering this tree is the tip's `27f53bda` (`success`, 03:20:32Z). Its own request tests need PostgreSQL, which this box does not have for these routes, so nothing here was executed by this pass |
| **#1100** signature ownership — **D-10, decided by merge** | `daff1400` 2026-10-21 03:29:53Z | **R-19 closed at the server.** One rule: a block may authorize a report only for its owner. `authorizeSignatureBlock` (`signedArtifactGuard.ts`, +45) answers `signature_not_active` for a retired block and `signature_not_yours` for another account's block, and is called at **three server doors** — `patient-reports.ts:706` (structured sign), `:2651` (legacy sign,
audited `legacy_sign_rejected`) and `:2768` (verify / countersign, audited `verify_rejected`), the last of
which also gains the retired-block check `verify` never had. Refusals are audited as `legacy_sign_rejected` / `verify_rejected` **with the block's owner**, so an attempted cross-user sign is on the record instead of swallowed by a toast. Schema: `signatures.user_id` (integer, **no FK, no NOT NULL, no default** — the migration's own stated reason is that an FK would refuse historical reports whose signer has since been deleted, and a default would make every historical block look owned by someone). New blocks self-claim (`POST /api/signatures` stamps its creator). **No administrator exemption**, in the PR's words: *"a delegation that a caller can take by itself is not a delegation."* Client side: `reportSignerEligibility.ts` filters the offered pool and `autoSignReport` declines rather than attempting a colleague's block | 11 files +626/−17, incl. `migrations/zzzzzzzzzzzzzzzzzzzz_signatures_owner_user_id.sql` (+60), `lib/db/src/schema/signatures.ts` +6/−1, `patient-reports.ts` +100, and `signerOwnership.request.test.ts` (+288) | 3/3 **success at its head `e325ef62`** (`Tests` 03:19:26Z) — **all three `cancelled` on `main` at `daff1400`** (§2 merge-order note), and the first suite attempt on a tree containing it (`6fd16cda`) failed on an unrelated census timeout (§1). **Browser-tested — by its author, and named as such:** the Qwen session that built it reports live measurements against a scratch DB after rebuilding the bundle — a colleague's block → **403 `signature_not_yours`** with the row left `draft`; its own retired block → 400; no block → 200 with `identitySource: "session"`; and the picker as a non-owner showing **only** "— None / sign as me —" while the same dialog as the block's owner preselects it, which is the control that proves the pool is *filtered*, not blanked. **This directory re-ran none of it** and has no browser open. The same author reports the honest suite attribution: **7 failures at head, 8 at the exact baseline with their code removed**, and the canal suite flaking in both directions because it shares one scratch database — i.e. a single full-suite run on this box cannot attribute a failure to a PR (added to `KNOWN_ISSUES.md` §4 item 30). So: IMPLEMENTED ✔ TESTED ✔ (author's request suites + author's browser) **MERGED ✔ (`daff1400`)** DEPLOYED ✘ CLINICALLY VERIFIED ✘ |
| **#1101** the previous revision of this directory | `6fd16cda` 2026-10-21 03:30:08Z | Markdown only: reconciled the memory corpus to `b0610551`, added the first `OWNER_DASHBOARD.md` content for that baseline, and published the D-14 legacy-corpus measurement (4,161 files with a clinical header block; 738 under name-shaped directories) | 6 files +407/−114 | `Static` success 03:33:14Z, `Build identity` success 03:32:05Z, **`Tests` in progress at 03:42Z**. Same trap as #1095: markdown is not excluded from CI here, so a docs merge is a *repo* change that also has to wait for the suite |

**Merge order note (this is now the *sixth* occurrence of the same pattern, so it is a process fact,
not an anecdote):** #1094, #1095 and #1096 all targeted `2ec675ab` and landed at 02:06:47Z, 02:07:07Z
and 02:07:31Z; **#1098 and #1099 targeted `b0610551` and landed at 02:56:26Z and 02:56:44Z — 18 seconds
apart; #1097 then landed at 03:05:05Z, 28 minutes later; #1100 landed at 03:29:53Z and #1101 15 seconds
later at 03:30:08Z.** Chronological order on `main` is therefore
`9fcd1e8e → 93fb53ad → b0610551 → 4765f583 → 18699b9b → 27f53bda → daff1400 → 6fd16cda` (PR order
#1094, #1095, #1096, #1098, #1099, #1097, #1100, #1101 — the numbers do not run in the order they landed).
Each was green against the *old* main; #1094's and #1098's `main` runs were cancelled by the next merge,
#1095 recorded nothing at all, #1099's `Tests` was **cancelled**, and **#1100's three jobs on `daff1400`
all ended `cancelled`** between 03:30:42Z and 03:31:31Z because #1101 landed 15 seconds after it. So the
clinical signing change has **no completed whole-suite run on its own merge commit**, and the tree it
produced (`daff1400`) was never covered by the `27f53bda` tip run, which does not contain it. The first
completed whole-suite verdict for the current tree can only come from the run on `6fd16cda`, which was
still `in_progress` at 03:42Z (§1). #1096 landed **24 seconds after the documentation pass that describes
the tree it changed**, and #1098/#1099/#1097/#1100/#1101 arrived while *this* revision was being written.
Nothing was wrong with any PR; it means a documentation verdict must be re-read against the tip, which is
what this pass has now done five times in one sitting.

**Merge order note:** #1090 landed, then #1091 **19 seconds later**, both against `dc8c3aba`, both
editing `observationLedger.ts` and `zai-workspace/store.ts`. Each was green only against the *old*
main. The combined tree was therefore unverified until the `main` run at `c199aea2` came back 3/3.
Their two edits to `observationLedger.ts` are complementary, not competing (#1090 exported
`dropProvenanceForRemoved`; #1091 added a new function at a different offset) — verified by reading
both diffs.

**Agent ownership** (unchanged, `AGENT_HANDOFF.md` §3.1): Z.ai — Composer/editor/Quick Select ·
Qoder/Qwen — print, PDF, signer authorization · AI Architecture — providers, vision, provenance,
PACS images · this agent — records, integration analysis, coordination.

**Integration conflicts: none open.** The one real collision #1090 describe — the PDF export door,
where its draft watermark and #1088's signer authority both wrote — was resolved **by the owning
agent**, in branch-side merge commit `104d3f48` ("Merge origin/main (dc8c3aba): signer authority (#1088)
and the DRAFT watermark compose", parents `06befc27` + `dc8c3aba`, 2026-10-20 16:38:21Z, 37 files), by
keeping **two fields with a documented boundary** rather than one, as this directory had prescribed.
*Citation form matters here:* all three of yesterday's merges landed as **single-parent squash commits**
(`ed04acbc` parent `dc8c3aba`; `0799d175` parent `ed04acbc`; `c199aea2` parent `0799d175`), so
`104d3f48` is **not an ancestor of `main`** and `git cat-file -t 104d3f48` fails on a checkout that has
not fetched `refs/pull/1090/head` — it is real, and it is reachable only through the GitHub commits API.
**Re-read at `27f53bda`, because four more merges landed since the first read of this section:** the
composition is unchanged and still in the right order — `radiologyReportPdfExport.ts:391` refuses a signed
report **before** any key image is fetched (`:393-396`) and **before** `:397` composes the watermark
through `draftAwarePrintSettings(loadPrintSettings(), { unsigned: input.unsignedDraft })`, so an
authoritative document can never be re-drawn with a `DRAFT` mark. `draftPrintSafety.test.ts` still pins the
composition — `:92` *"the clinic's own configured watermark outranks the draft default"*, which is the
behaviour **D-13** below asks the owner to confirm, and `:97` that the watermark helper does not touch
the signature block. **R-18 stays closed** (`KNOWN_ISSUES.md` R-18 carries the full re-measurement and
the three residuals it did **not** close). **One correction to this paragraph's own claim:** "Integration
conflicts: none open" is still true of merged code, but Draft #1100 opens the first *live* overlap this
cycle — it edits `radiologyReportLifecycle.ts` and `ReportHub.tsx` three hours after #1093 changed them
for PI-1/PI-3. That is a sequential edit by the same owning agent, not a collision, and §2 above states
what must be re-run when it lands.

---

## 3. Clinical readiness by component

TESTED here means *regression-tested* — an assertion in the repo that fails when the rule is broken.
**Browser-tested is a different grade and is named in the last column, with who ran it.** Nothing on
this table is DEPLOYED.

| Component | IMPLEMENTED | TESTED | MERGED | DEPLOYED | CLINICALLY VERIFIED |
|---|---|---|---|---|---|
| Reporting workspace / Composer | yes | 15,622-test suite + clinical acceptance corpus | yes (#1090) | **no** | **no** — no human has clicked the combined tree |
| AI-Apply cannot overwrite typed text | yes (`composerApplyGate.ts`) | yes, against the real store | yes (#1090) | no | no |
| AI attribution on draft restore | yes (`aiAttributionRestore.ts`) | unit + the 344-line journey suite (#1096) | yes (#1091) | no | no |
| Print / PDF signer identity | yes (#1088 + #1090 watermark + #1093 gates) | yes — 45 tests in 3 files, re-run by this agent at `2ec675ab`, all pass | yes (`2ec675ab`) | no | **no** — the *author* of #1093 reproduced all three defects in a real browser and re-ran them against the fix; this pass did not repeat that, and no clinician has reviewed a printed report since |
| Signing authorization | yes | yes | yes | no | **decided (option (a), merged as `daff1400`) — but not in force**: the column does not exist in the clinic's database, and unclaimed blocks stay usable by design (**D-10 residual**) |
| Report delivery (Report Hub verify → print) | was **broken on `main`**; the dead-end dialog is fixed | yes (`SIGN_WITHOUT_BLOCK` sentinel + its regressions in #1093) | **yes** (`2ec675ab`) | **no** | **no** — so in the clinic today verify→print is *still* unreachable: the deployed build predates the fix |
| AI audit visibility (locality / image provenance) | yes (`aiAuditDisplay.ts`) | 21 unit tests, author reports 8/8 mutants killed and 16/16 browser checks | yes (`9fcd1e8e`) | no | no — the browser checks are the author's, not reproduced here |
| AI audit **truthfulness** (an empty answer is not a success) | yes (`aiAuditOutcome.ts`, one rule, 5 call sites) | 2 new request suites (534 + 211 lines) that **need PostgreSQL**; not executed by this pass and not executed on this box | yes (`18699b9b`) | no | no — and no auditor has read a post-#1099 audit page in a browser. The row-level claim is *now* honest in code; whether the audit page tells it that way to a human is unverified |
| Vision-capable model gate (which local model may see images) | yes (`visionCapability.ts:28`, server-probe-first) | 86 new lines in `visionCapability.test.ts` — unit level, mocking the probes | yes (`4765f583`) | no | no — never exercised against the clinic's real Ollama, so `gemma4:latest` seeing is the PR's measurement, not this one |
| Cross-agent workflow (Mode A → Quick Select → AI Apply → restore → sign) | n/a (test only) | yes, at the store/exporter boundary: one 16-step journey, 2 `it`s | yes (`b0610551`) | no | **explicitly not** — the file's own header records "no browser and no PostgreSQL … never claims a rendered page or a database row" |
| PACS / OHIF / DICOM | see `ARCHITECTURE.md` | — | — | not inspected this pass | — |
| HOPE integration | implemented | — | — | **never delivered anything** (R-8, 0 rows) | no |

**Integration-status legend applied:** CONNECTED — ERP↔Postgres, ERP↔Orthanc read path.
PARTIALLY CONNECTED — OHIF image selection→ERP, Report Hub→delivery. FIXED-BUT-NOT-LIVE — Report Hub
Sign/Verify dialogs: PI-3 was a hard break on `main`, the fix is merged at `2ec675ab`, and because
nothing has deployed since 2026-10-12 **it is still broken in the clinic**. That is the whole difference
between "merged" and "verified", in one row. UNKNOWN / NOT INSPECTED — `futurekind-platform`
(API returns *Not Found* for this token), and the NAS runtime.

**Repositories inspected vs not:**

| Repo | Inspected | How | Head | Open PRs |
|---|---|---|---|---|
| `care-on-synology1` | **yes, deeply** | code + diffs + CI check-runs + API + one local Vitest run | `18699b9b` | 1 (#1097, Draft) |
| `hope` | metadata only | API | `c2644c7e`, last push 2026-10-14 | 0 |
| `care-pacs` | metadata only | API | `247f0ccf`, last push 2026-10-18 | 0 |
| `usg-reports` | metadata only | API | `9df0364a`, last push 2026-10-07 | 0 |
| `futurekind-platform` | **NO ACCESS** | API → *Not Found* | — | — |

Repositories existing is **not** evidence their systems are integrated. Cross-repo runtime behaviour
was not tested this pass.

---

## 4. Clinical safety — what is open right now

The three PI findings are kept below **with their original wording**, because the finding is the
history; only the State column moves. Each now carries the five-category verdict separately, since the
categories are what changed this cycle.

| ID | Risk (as found) | Fixed in source | Regression-tested | Browser-tested | Deployed | Clinically verified |
|---|---|---|---|---|---|---|
| **PI-3** | A signed report **cannot be verified in the UI**: `ReportHub.tsx` passed `value=""` to a Radix `SelectItem`, which throws while rendering, so neither the Sign nor the Verify dialog opens — and Print/PDF/Share render only for `verified`/`delivered`. The recovery path the sign dialog names out loud ("sign later from Report Hub") leads to a dead end. | **yes** — `ReportHub.tsx:1004` `SIGN_WITHOUT_BLOCK = "as-me"`, converted back to `null` at `:1019`/`:1072`, used by both dialogs at `:1041`/`:1096`. Re-read at `27f53bda` | yes, in #1093's own suites (see the line below this table) | **by #1093's author only** — reproduced in a real browser before and after; this pass ran no browser | **no** | **no** |
| **PI-2** | **Word export rewrote a signed report**: `handleExportWord` fetched the signed print HTML and then let `finalizePrintPreviewHtml` overwrite body and demographics with live editor text — the produced `.docx` had the authorized findings, **no signer at all**, while the same report's PDF carried name, registration number and timestamp. A signature attached to altered content. | **yes** — `useWorkspaceExportShare.ts:258` asks the record (`loadSignerOfRecord(reportId).signerOfRecord !== null`) and `:261` passes it as `authorizedArtifact`; `radiologyReportPrintLiveMerge.ts:381` returns the server artifact untouched when set (option declared `:362`). Re-read at `27f53bda` | yes — `radiologyReportPrintLiveMerge.test.ts` (8 tests) | **by #1093's author only** — proven on the produced `.docx` | **no** | **no** |
| **PI-1** | **An unsaved draft printed the workstation's own signature** ("Dr. Station Alpha MD (Station Default), Reg. No: ALPHA-9") with no `NOT SIGNED` anywhere. Cause: `loadSignerOfRecord(null)` returned `unsigned: false`, so the generator took its `settings.signature` branch. This is the "no report row behind it" case that `CLINICAL_SAFETY_REGISTER.md` §9 recorded as a *deliberate carve-out* — a browser pass has now shown it prints a false authorization. | **yes** — `radiologyReportLifecycle.ts:579` now returns `{ signerOfRecord: null, unsigned: true }` (fail-closed), with the same shape on the load-failure path at `:588`; `loadSignerOfRecord` itself at `:575`, `recordedSignerForReport` at `:529`. Re-read at `27f53bda` | yes — `radiologyReportLifecycle.test.ts` (27 tests) + `radiologyReportPdfExport.signedArtifact.test.ts` (10 tests) | **by #1093's author only** — reproduced twice on clean studies | **no** | **no** |

**Regression evidence this pass added, not the author's:** those three suites were run locally at
`2ec675ab` (the merge that carries them) — **45 tests, 3 files, all pass, 696 ms**. That re-confirms the
assertions exist and hold on the merged tree; it is *not* a mutation proof (the author's claim, "6
assertions fail with these three changes removed", was not re-derived here) and it is not a render.

Standing, untouched by any of the four merges:

| ID | Risk | State | Where |
|---|---|---|---|
| **R-19 / D-10** | Was: any non-denied staff session could apply **any active** signature block — the sign route's subject check was a role deny-list, not a staff↔signature binding. | **FIXED IN SOURCE AND MERGED (`daff1400`, #1100) — but NOT in force.** Server-side `authorizeSignatureBlock` now refuses another account's block at all three doors, with no admin exemption. **Not deployed** (the column it reads does not exist in the clinic's database yet), **not browser-tested**, and by design **still permissive for every block whose `user_id` is NULL** — i.e. every historical block the backfill could not match to exactly one account. | register §9.3, §5 D-10 below |
| **R2-4 / R2-6** *(surfaced and pinned by #1097, not closed by it)* | Two Impression-integrity defects the regional expansion found: **R2-6** a same-slot upgrade in the Impression field leaves the *vacated* assessment's stale fragments behind; **R2-4** an assessment tile can **add** over a format-owned contradicting assessment, because format-started studies seed no ledger row for the impression. #1097 pins both as `it.fails` with full diagnoses, so they are **documented failing tests, not passing ones** — and both need an owner ruling on the interaction contract | OPEN, deliberately unfixed by the PR that found them, **owner decision required** | `clinicalAcceptanceCorpus.regional.test.ts` on `main` at `27f53bda`; commit text of `27f53bda` |
| **R-14 / C2** | Structured Findings edits stay invisible to dirty-detection, the leave warning and the local backup — unsaved structured work can be lost silently. | OPEN | register §7 |
| **R-10** | The **report** image reader still discards *why* an image failed and can drop image cells by budget with no record of the omission (the vision-trial door was fixed by #1089; this one was never the same door). | OPEN | register §8 |
| **D-11** | `POST /:id/verify` still never calls the unreviewed-AI finalize gate (amend, sign and structured finalize do). | OPEN, owner decision | register §0.1 row 9 |
| **D-13** | A workstation's configured non-empty watermark **outranks** the `DRAFT` mark, so an unauthorized export can leave that station with no draft indication. | OPEN, confirmed unchanged at `27f53bda` (`draftAwarePrintSettings.ts:46-49`) | §5 below |
| **PIV-1** *(new this pass)* | Images of real patients and their clinical text sit in a **public-repository-hosted directory tree whose folder names are personal names** — see D-14. This is a standing exposure, not a code defect, and it is the only item in this register that no agent may act on. | OPEN, measured, **owner decision required** | §5 D-14, `KNOWN_ISSUES.md` R-23 |

### 4.1 #1098 merged at `4765f583`: what the vision door now trusts

**Recorded as asked (2026-10-21 02:15Z), when it was a Draft, and kept here in its original wording
because the question is the history:** *"Draft #1098 (green, clean, 2 files) moves one authority:
`assertVisionCapableModel` no longer refuses a model whose *name* matches
`OLLAMA_TEXT_ONLY_NAME_PATTERNS` before asking the server. … The reading that needs an owner is the
opposite direction: CARE now trusts a server's self-reported capability list over its own table."*

**The owner answered by merging it.** Re-read at the tip, the merge is exactly the change the Draft
described, and nothing else: `visionCapability.ts:28` runs the reachability and `/api/show` probes first
(`:78`) and only then falls back to the name table when the server answered nothing — `:103` to confirm a
known-vision family, `:108` to refuse a known-text-only one, `:121` `unknown` still fails closed.
**The two bounding facts still hold, re-grepped at `18699b9b`:** the PHI egress decision is upstream of
this door (`composeEngine.ts:597` `assertComposerProviderPolicy`, with `:621` *"cloud egress refused"*,
then `:638`/`:643` the vision check), and #1098 touched neither. So it can only widen *which local model*
sees images; it cannot open a cloud door. **Residual, not reopened:** the trust now rests on a LAN Ollama
answering honestly about its own capabilities, which is a strictly better authority than a name regex —
and if that Ollama is ever not the clinic's own, this door inherits that decision. Orthanc/LAN posture is
an owner-accepted risk and is not re-raised here.

**#1099 and the print doors — the integration read this pass was asked for.** #1099 rewrote the AI audit
contract; the print/signature doors were re-read to confirm the two did not disturb each other. They did
not: no file in #1099's 9 is a file #1090/#1093 changed, and the PDF door is untouched — at
`radiologyReportPdfExport.ts` the refusal is still `:391` (`SignedReportArtifactRequired`), still *before*
any key image is fetched (`:393-396`) and before the watermark composes at `:397`;
`draftPrintSafety.test.ts:92` still pins the clinic-watermark-over-`DRAFT` precedence (D-13, unchanged);
`radiologyReportLifecycle.ts:579` still returns `{ signerOfRecord: null, unsigned: true }` for a draft and
`:588` for a failed load. **One new, small audit finding of this pass, in #1099's own shape:** the
save-writer `aiComparison.ts:436` keeps `success: true` (`:452`) for an event that is not a generation.
It is deliberate, commented, and separable by `jobReference` (`:450`) — but **any query that counts
`success = true` over `ai_reporting_audit_logs` without filtering `jobReference` still overstates
generations by one row per saved winner.** That is a reporting trap for whoever reads the audit page, not
a clinical defect; it is listed in §7 and no code was touched for it.

Closed this cycle: **PI-1, PI-2, PI-3** as *source and CI* items (all three merged at `2ec675ab`) — they
remain open as *clinic* items until the deploy in priority 1. Closed earlier and still closed: **R-18**,
**D-12**, **G-16**.

---

## 5. Decisions needing the owner (only these five, in priority order)

### D-14 — the legacy report corpus. **Answered, and the answer is worse than the question.**

Last pass this was posed as unknown ("are the `.doc` samples clinic *formats* or real *reports*?"). It
has now been measured read-only, with **no file opened in an editor, no value printed, and nothing
reproduced into any document**. The exposure category is **patient-identifiable clinical records in a
public source-code repository**, and three separate things carry it:

| What | Measured at `b0610551`, **re-measured byte-for-byte at `27f53bda` with no change** | How |
|---|---|---|
| **The repository is public** | `visibility: "public"`, `private: false`, 0 forks, 0 stars, 166 MiB packed | `GET /repos/DrAbinash/care-on-synology1` |
| **Directory names are personal names** | **17 distinct name-shaped path components** under `docs/report-formats/`, with **738 tracked files** living beneath them — so a patient name is in the *path*, visible in `git ls-files`, in every clone's filesystem tree, and in GitHub's code search, without any file being opened | `git ls-files docs/report-formats` scanned for components holding 2+ capitalised non-anatomy tokens |
| **The bodies carry a clinical header** | Of 4,990 files: **4,161** match a name/age/sex/referrer header block, **2,089** carry guardian / relation / "son of · d/o" filiation phrasing, **990 distinct** name-shaped values, **1,029** date-shaped, **8** UHID/OP-ID-labelled, **3** mobile-shaped, **3** twelve-digit-shaped; **204** files are too short or opaque to read | Byte-level printable-run extraction (ASCII + UTF-16LE) over every tracked blob; counts and categories only |
| **Format census** | 4,022 Word 97 OLE2, 286 OOXML zip, 492 other binary, 19 plain text, 16 XML/HTML, **7 PDF**, **5 JPEG**, 128 zero-byte. By directory: ct 2,016 / 167.8 MiB · usg 1,962 / 65.7 · xray 691 / 20.1 · mri 320 / 27.5 · total **4,990 files / 281.2 MiB** | magic-byte census + `git ls-tree -r -l` |
| **Not needed at runtime** | No shipped code reads `docs/report-formats/**`. The only code hits for that string are the unrelated API route `/api/radiology/report-formats` and one comment naming `docs/mri-report-formats/`. The runtime asset is the **derived** `artifacts/diagnostic-erp/public/data/radiology-findings-library.json` (**1,232,106 B tracked**, `git ls-tree -r -l`), whose own README already claims *"the library holds no patient data"* — a claim about the derived JSON, not the corpus under it | `git grep` over `origin/main` |
| **Historical, not active** | 3 commits, all on 2026-07-22 (`92d9b5b9` + `78c1efbf` + `cab0d9c1`), never revisited | `git log --format -- docs/report-formats` |
| **`.SynologyWorkingDirectory/` is a different case** | 19,596 files / 28.5 MiB, 14,422 opaque binaries + 5,174 zero-byte. **No long printable run, no word-like sequence, no date or phone shape in any file** — Synology Drive's signature cache, not a document store. Size/hygiene problem, **not** a privacy one | the same extraction over every blob in the directory |

**Limits of this evidence, stated so it is not over-read.** OLE2 `.doc` and OOXML `.docx` bodies are not
parsed here — text is recovered from raw printable runs, so **a negative is not proof of absence**: the
286 OOXML files (whose text lives in compressed parts), the 7 PDFs and the 5 JPEGs (a scanned report is
PHI by nature) were counted by type and not read. The name-shaped and header-block detectors are
patterns, not identities: they can match a referring doctor or a city. None of this changes what the
owner must decide, because the *directory names* need no parsing at all to be identifying.

**Recommended order of actions — every one of them is the owner's to take; no agent may execute any
of them, and none is done by editing code:**

1. **Stop the widening, before anything else.** Decide whether this repository stays public. Every
   clone, fork, CI runner, contributor laptop and GitHub-side cache already has the tree; while the
   repo is public the population is not bounded by the 0 forks the API reports.
2. **Confirm the category in one minute, locally**: open five random files from the largest directory in
   Word and read the header block only. This step belongs to the owner because he knows whether these
   came off the clinic's printer or out of a de-identified sample set — and because doing it himself
   means the contents never pass through an agent.
3. **Decide retention, then move, then ignore — in that order.** Retention is a clinical-records question
   (whose signatures are on those reports, and does the clinic need them as records). Moving means
   `git rm -r --cached docs/report-formats` + a `.gitignore` entry + a `README` pointer to wherever the
   clinic keeps them. **Deleting from `HEAD` does not remove them from history**, so step 3 alone leaves
   the exposure open in every existing clone and in `git log`.
4. **History rewrite only with explicit owner approval, and treated as a separate decision.** `git
   filter-repo` (or BFG) rewrites every commit after the first, which invalidates every open branch and
   PR — there are two Drafts right now and ~90 worktrees on this box — and requires a force-push to
   `main`, which then breaks the NAS's `git fetch && git reset --hard origin/main` deploy flow for any
   checkout that has the old history. It is also not a recall: clones taken before the rewrite keep the
   files. If the corpus must be gone from GitHub's own copies, the documented route is a GitHub
   support removal request (sensitive data), not a rewrite the owner performs locally.
5. **Whichever path is chosen, record the decision** in `CLINICAL_SAFETY_REGISTER.md` as D-14's closure,
   with the date and the reasoning, so the next agent does not re-litigate it — and so the register
   shows that the clinic found it, measured it, and answered it, rather than an agent quietly deleting
   files.

The two mechanical halves that follow from this and are **not** privacy decisions — untracking
`.SynologyWorkingDirectory/` and shrinking the deploy payload — sit in §7 as RETIRE items.

### D-10 — signature ownership policy. **Decided, by merge, at 03:29:53Z. What is left is operational.**

Any non-denied staff session may apply **any active** signature block: the sign route's subject check is
a role deny-list, not a staff↔signature binding (R-19, register §9.3). Options as put to the owner:
**(a)** 1:1 binding, **(b)** keep the deny-list + audit, **(c)** allow delegation with an explicit
recorded delegate. **What this pass warned:** "(a) stops the single-radiologist clinic signing today if
signers lack their own accounts. Nothing here should be 'fixed' by an agent."

**It has been fixed by an agent, and the owner accepted it by merging.** #1100 implemented **(a)**:
`signatures.user_id` + a forward migration, server-side `authorizeSignatureBlock` refusing another
account's block with `signature_not_yours`, client-side pool filtering so the dialog cannot default to a
colleague, and **no administrator exemption** (its own words: *"a delegation that a caller can take by
itself is not a delegation"*). The timeline makes the ruling unambiguous, because the three events are
six seconds apart and all carry the same actor: `ready_for_review` **03:29:47Z**, `merged` **03:29:53Z**,
`closed` **03:29:54Z** (`GET /issues/1100/timeline`, read 03:40Z). **This directory reads that as the
owner choosing (a) over (b) and (c)** — which is exactly the evidence the brief asks for: the finding is
resolved in `main` and must not stay listed as open, and it is *not* clinically resolved because the
merged tree has no completed suite run on its own merge commit (§2) and nobody in the clinic has signed a
report with it. **The browser evidence that does exist belongs to the author, and is named as such:** the
Qwen session that built #1100 measured, against a scratch database after rebuilding the bundle, a
colleague's block → **403 `signature_not_yours`** with the row left `draft`, its own retired block → 400,
no block → 200 `identitySource: "session"`, and a non-owner picker offering **only** "— None / sign as me —"
while the owner's dialog preselects the block — the control proving the pool is filtered, not blanked.
This directory re-ran none of it; independent browser verification is priority 3.

**What is still the owner's, and is now a task rather than a debate:**
(1) **The grandfather is the policy's real edge.** A block with `user_id IS NULL` — every block created
before the column, plus any whose display name matched zero or several accounts, which the migration
deliberately refuses to guess at — **still authorizes a report for anyone**, and is audited `owned: false`.
So on deploy day the protection covers only the blocks the backfill could bind plus the new ones the
Signatures manager stamps. **Nothing in the repo counts how many that leaves.** The one measurement that
answers it is a read-only `SELECT count(*) FILTER (WHERE user_id IS NULL) FROM signatures` on the clinic
database — which this pass did not run and cannot from here (§8). Until it is run, the honest status is
"binding enforced where claimed, unchanged where not".
(2) **"No admin exemption" is now law**, and its corollary stands: there is no emergency path to sign on
a colleague's behalf when a radiologist is unavailable; the route is `signatureId: null` ("sign as me"),
which #1093's `as-me` sentinel already supports.
(3) **(c) — recorded delegation — remains open and deliberately unimplemented.** If the clinic ever wants
"senior resident signs under the consultant's block", that is a new decision, not a loosening of this one.
Merging #1100 also added the **second migration** to the pending deploy set, so D-15's answer now covers
two schema changes — and D-15's answer is the thing that makes any of this real.

### D-11 — is `verify` a finalization?

`POST /:id/verify` is the one signed-artifact door with **no unreviewed-AI gate** (amend, sign and
structured finalize all have one). It is now reachable again for real users — PI-3 merged — so the door
that was theoretical last cycle has a working handle. Owner's call, then one rule enforced in code.

### D-13 — may a workstation's configured watermark suppress the `DRAFT` mark?

Measured again at `27f53bda`, **unchanged**: `draftAwarePrintSettings.ts:46-49` — any non-empty clinic
watermark **outranks** `DRAFT`, and `draftPrintSafety.test.ts:92` pins that as intended behaviour. So an
unauthorized document leaves that station with no draft indication. Deliberate in the code's own words;
the owner should confirm or overrule it. **Re-read at `6fd16cda`, still word-for-word the same** (the
function is `draftAwarePrintSettings.ts:40-51`; the clinic-watermark return is `:49`), and neither #1100
nor #1101 nor #1103 touches it or its pinning test — `git show 6fd16cda --stat` matches neither name.
**Do not confuse it with Draft #1103**, which is a *different* precedence: it freezes the six
signer-display flags at signing and puts that freeze above an explicit `?template=` for standard copies.
D-13 asks whether a workstation's watermark can hide `DRAFT`; #1103 asks whether a live style row can
rewrite who a signed report says signed it. Both are owner calls, and #1103's own body leaves three more
(write-once flags across withdraw-then-re-sign, a silently ignored pinned template, `?useUpdatedStyle`).
⚠️ *Naming hazard:* this register's `D-n` sequence collides with
Composer's internal finding IDs (`#1090`'s `composerApplyGate.ts` header cites "D-13's cross-study arm"
meaning something else). Reserve `D-n` for this register.

### D-15 — deployment readiness: is "not deployed" a policy or an accident?

**124** merged commits, last verified deploy **2026-10-12**. Every clinical row in §3 and §4 above stops at
MERGED for the same reason. This is now the largest single gap between what the codebase promises and
what the clinic does: PI-3's dead-end dialog, PI-1's borrowed workstation signature and PI-2's rewritten
Word export are all **live in the clinic right now**, because the fix that closed them is not deployed.
**What changed this pass, and it is a material change:** the gap is no longer code-only. `main` carries an
unapplied migration (`migrations/zzzzzzzzzzzzzzzzzzzzz_quick_select_factory_boxes_r006_215e2a0c52d9.sql`, #1097) and Draft #1100 would add
a second (`migrations/zzzzzzzzzzzzzzzzzzzz_signatures_owner_user_id.sql`). A deploy from here runs the repo's migration+verify pipeline
against the clinic's real database, which is a different class of action from restarting containers — it is
why `deploy-synology.sh` exists as a script and not as a `git reset`. The owner decides when to run it (a
NAS deploy takes the clinic down); what is needed from this directory is that the decision is *recorded*,
so "merged" is never again read as "done", and so the 2026-10-12 → 2026-10-21 accumulation gets a
deliberate date rather than drifting — 117 → 121 → 124 across the three reads of this one file today.

A **sixth** decision has arrived and is deliberately ranked below these five, so the list stays the
owner's and not the corpus's: **#1097 surfaced two Impression-integrity defects it chose not to fix**
(R2-6 same-slot upgrade leaves the vacated assessment's stale fragments; R2-4 an assessment tile can add
over a format-owned contradicting assessment because format-started studies seed no impression ledger
row). Both are pinned as `it.fails` on `main`, and the PR's own text says each "needs an owner decision on
the interaction contract". Read them in `CLINICAL_SAFETY_REGISTER.md` when there is time for a sixth.

Already settled — **do not re-ask**: D-1…D-7, D-9 (answered by #1093's rig), D-8 and D-12 (superseded by
merges). Closed by events: the **merge decision on #1093** — it merged at 2026-10-20T17:38:08Z as
`2ec675ab` with its three suites passing; and the **merge decision on #1098**, which the owner took by
merging it at 02:56:26Z.

---

## 6. Five next actions, ranked

| # | Action | Why it matters | Benefit | Owner agent | Dependencies | Acceptance |
|---|---|---|---|---|---|---|
| 1 | **Decide and execute a deploy**, with commit-identity proof (D-15) | PI-1/PI-2/PI-3 are fixed in source and merged but **still live in the clinic**, because the deployed build predates them. 126 commits of clinical work are unfelt, and now so is the rule that a signature block belongs to an account | Turns merged work into patient-facing reality, and retires the "merged = done" illusion in the same step | **Owner** runs `deploy-synology.sh`; this agent records evidence | a deploy window; `27f53bda` is **3/3 green (Tests 03:20:32Z)** but the **current tip `6fd16cda` had not finished at 03:42Z**, and its tree contains #1100, which has never had a completed whole-suite run on its own merge commit (§2). **It is not a code-only restart any more: two migrations are pending** — `migrations/zzzzzzzzzzzzzzzzzzzzz_quick_select_factory_boxes_r006_215e2a0c52d9.sql` and `migrations/zzzzzzzzzzzzzzzzzzzz_signatures_owner_user_id.sql` | Post-deploy probe reports the running commit = `6fd16cda` or later **and** the migration ledger confirms **both** files applied; one real signed report and one unsaved draft printed from the clinic, and the four entry points (PDF, Word, print, verify) reviewed on each |
| 2 | **Answer D-14: is this repository allowed to stay public, and what happens to `docs/report-formats/`?** | Measured: 738 files sit under name-shaped directories, 4,161 files match a clinical header block, and the repo is `visibility: public`. This is the only item here that is not a code problem | Stops an active exposure; everything else in this table is quality | **Owner** alone — an agent must not delete, rewrite history, or open the files | none; it is independent of every other row | A dated decision in `CLINICAL_SAFETY_REGISTER.md`: visibility + retention + which of the four remediation steps is taken, and which are explicitly refused |
| 3 | **Close D-10's operational tail: claim the blocks, then browser-verify the gate** — the policy itself is settled by the merge | #1100 merged at 03:29:53Z (owner: `ready_for_review` → `merged` → `closed` inside seven seconds). What it does **not** yet do is protect an unclaimed block: every `signatures` row the name-backfill could not bind to exactly one account keeps `user_id NULL` and stays usable by any staff session, by design | Converts a merged rule into an enforced one. Until the NULL population is counted and claimed, the clinic's exposure is unchanged in practice even after deploy | **Owner** (claim the blocks in the Signatures manager; decide whether NULL should eventually be refused), **Qwen** (the code — correct owner per §3.1; no other agent should touch these files) | deploy (D-15) must come first — the column does not exist in the clinic's database yet | A read-only count of `user_id IS NULL` blocks before and after claiming, then a browser pass showing (i) a colleague's block is not offered, (ii) posting a colleague's `signatureId` directly is refused with `signature_not_yours`, (iii) an **unclaimed** block still signs and is audited `owned: false`, (iv) a **retired** block is refused at all three doors including `verify`, which never checked, and (v) PI-1's `unsigned: true` for a no-report-row draft still holds after the `autoSignReport` change |
| 4 | **Get #1102 green, and decide separately whether the PACS DNS leg gets a cap** | The census repair is measured and test-only, but its CI went red at 03:36:44Z on `providers.test.ts:318` — an uncapped `dns.lookup` inside the SSRF guard (`providers.ts:248`), in a different package from the one file the PR touches. Same 5 s class, second instance, and this one sits in **production security code**, not a test | Ends cross-agent false blame on the census **and** names a real availability risk: a slow resolver makes the PACS reachability check exceed its own request budget | **this agent** (#1102, tooling) · **AI Architecture** owns `providers.ts`; the cap belongs in **its own PR**, not riding on this one | none for #1102's content; the DNS cap needs a decision on timeout value + error wording | #1102: two consecutive green runs, the census register byte-identical, and the one-line tile-order mutant still failing 3 of 5 tests (already measured). DNS cap: a test that the guard **refuses** rather than hangs when resolution exceeds the cap — refusing to answer is not the same as failing closed |
| 5 | **Browser-verify the combined tree** — Restore → AI Apply → typed edit → Print → verify → sign with a colleague's block id → audit page, one study, on the **current tip** | #1096 gives this a store-boundary journey but its own header says it stops there: no browser, no PostgreSQL. #1094's audit columns are rendered logic nobody has looked at in a browser but the author. #1097 re-arranged which tiles write which Impression sentences, so four regional exams print new text nobody has read. #1100 changed who may sign, and its only evidence is a request suite this box could not run | Converts "merged" toward "clinically verified" for attribution, lost-edit protection, egress visibility and **signer identity** | **AI Architecture** (provenance, audit) + **Qwen** (print, sign), one report each | a scratch DB only; never the NAS | A dated, reproducible browser transcript per agent naming what each saw **and what each did not test**; specifically the D-13 case (clinic watermark set, report unsigned) and the five D-10 checks in row 3 |

---

## 7. Technical debt noticed this pass (classify only — no code touched)

| Item | Evidence | Class |
|---|---|---|
| Four rendered PDFs in `artifacts/radiology-e2e-acceptance/reports-v2/` — `CASE-1{A,B}.pdf`, `CASE-2{A,B}.pdf`, **2,522,239 bytes (2.4 MiB)** across 4 files, identical byte sizes at `b0610551` and again at `27f53bda` | `git ls-tree -r -l origin/main -- artifacts/radiology-e2e-acceptance`; per-file sizes 620,589 / 628,576 / 626,419 / 646,655. **Now demonstrated, not predicted:** #1097 re-baked all four — same lengths, different blobs (`git show 27f53bda -- …` shows 4 modified binaries inside a Composer PR) | **INVESTIGATE**. Rendered PDFs are timestamp-nondeterministic, so they churn on every regeneration and cannot serve as byte-goldens; nothing on `main` reads them back. **And a scope limit this directory must state: these 4 files are NOT covered by D-14's measurement.** A PDF stream is compressed, so the printable-run method that read the `.doc` corpus cannot read them either way — it can neither show identifiers in them nor clear them. They are unmeasured, not cleared |
| **The PR count this corpus publishes is derived from commit subjects, and two of the last six merges are invisible to it** | `git log --format="%s" origin/main \| grep -cE '\(#[0-9]+\)$'` = **742 at `b0610551` and 742 at `27f53bda`**, because `4765f583` (#1098) and `18699b9b` (#1099) landed with hand-written subjects carrying no `(#N)` tail — 2 of the last 40. The API truth is **1,068 merged, 30 closed-unmerged, 1 open, 1,099 ever opened** (`GET /pulls?state=all`, 11 pages) | **REPAIR the rule, not the number.** A subject-derived count silently stops counting the moment the squash title drops the convention; the honest figure is the API's, and any subject-derived figure must name its rule and its blind spot. `COMPLETED_WORK.md`'s volume line now carries both |
| **#1099's audit carve-out leaves one two-meaning column behind** | `aiComparison.ts:436` writes `success: true` (`:452`) for a *winner selection*, not a generation, distinguished only by `jobReference: "ai_comparison_winner"` (`:450`) | **INVESTIGATE (reporting trap, not a clinical defect).** Every other writer in `ai_reporting_audit_logs` now means "usable clinical content", so any count of `success = true` without a `jobReference` filter overstates generations by one row per saved winner. The audit page is #1094's; whoever browser-verifies it should query both ways |
| `docs/report-formats/**` — **4,990 files / 281.2 MiB** (ct 2,016 / 167.8 · usg 1,962 / 65.7 · xray 691 / 20.1 · mri 320 / 27.5), 64% of the tracked tree's bytes, committed 2026-07-22 (`92d9b5b9`) and never classified | `git ls-tree -r -l origin/main` summed by directory at `b0610551` | **SPLIT**. The *privacy* half is decision **D-14** and is now measured — no agent may act on it. The *size* half is RETIRE: nothing at runtime reads the directory, the derived `radiology-findings-library.json` is the asset. Note the correction: last pass this row said 4,975 / 280.8 MiB with ct 2,011 · mri 316 · xray 685; the per-directory parse under-counted 15 files. Both counts came from the same command, so the difference is this directory's parser, not a change on `main` |
| The tracked tree is **437.3 MiB over 29,694 paths** at `27f53bda`, of which these two directories are 70.8% of bytes and 82.8% of paths | same command over the whole tree; at `b0610551` it read 437.1 MiB / 29,688 paths, and the 6 new ones are #1099's four (`aiAuditOutcome.ts` + its test, two new request suites) plus #1097's two (the regional corpus + the factory-seed migration) | **RETIRE the two blocks, then re-measure.** Consequence unchanged: `deploy-synology.sh` does `git reset --hard origin/main` on the NAS, so a one-line change ships 437 MiB; and `execFileSync`'s 1 MiB default `maxBuffer` kills any tool that shells out to `git ls-tree -r` here (that is how R-22 was found) |
| `.SynologyWorkingDirectory/Sign/**` — **19,596 files / 28.5 MiB** of Synology Drive Client's own signature cache, committed wholesale in `5cb9956e` *"initial care erp upload from synology production"* | magic-byte + text census over every blob: 14,422 opaque binary, 5,174 zero/tiny, **no** long printable run, **no** word-like sequence, **no** date or phone shape | **RETIRE** (hygiene, not privacy — this pass can now say that from a measurement instead of a guess). `.gitignore` plus untracking; not done here because `git rm -r --cached` changes what the NAS's `git reset --hard` lays down, which is an owner/infra decision |
| **Three suites run against Vitest's 5,000 ms default with no declared timeout — and one of them is a security control** | `vitest.config.ts` sets no `testTimeout`. (1) the census pair loop (measured 2,326/2,409 ms at `b0610551`, **2,854 ms at `27f53bda`** = 57% of the ceiling); (2) `composerIntegrationJourney.test.ts:124`, a 16-step chain, same class; (3) **new this pass, caught in the wild:** `GET /check-runs/119021055420/annotations` on #1102's run returns exactly one failing test — `providers.test.ts:318 — Error: Test timed out in 5000ms` | **REPAIR, cheap for (1)(2); DECIDE for (3).** (1) is PR #1102. (2) deserves the same derived timeout — it is the *only* cross-agent workflow guard, and if it flakes the agents will read that as a Composer/print integration failure rather than a clock. (3) is **not a test problem**: `resolveAndCheckHost` (`providers.ts:240`) calls `dns.lookup(host, {all, verbatim})` at `:248` with **no timeout**, and `tcpProbe` caps only its socket (`:292-294`), so the SSRF guard's DNS leg is unbounded. On this box the same lookup returns `ENOTFOUND` in **64 ms** and the suite runs 46 tests in **83 ms**; on the runner it exceeded 5 s. **AI Architecture's file** — cap it in its own PR, and assert the guard **refuses** on a slow resolver rather than hanging: an uncapped lookup in a fail-closed control can turn a network stall into an open door |
| Unit tests fire real network calls: the census run emits **834 `POST /api/radiology/report-formats/:id/use`** failures, one warning each, because `store.ts:2371` and `:2641` do `void bumpReportFormatUsage(...)` and `reportFormatsApi.ts:65` posts through `fetchApi`, whose first-failure path schedules a jittered ~400 ms backoff timer | counted from `[fetchApi]` warnings in two local runs (834 both times); `fetchApi.ts:104-106` `MAX_RETRIES = 3`, `BASE_DELAY_MS = 400` | **INVESTIGATE, then REPAIR in the test, not the store.** Fire-and-forget is right in a browser (a template-use counter must not block a click) and wrong in a unit test with no server. A `fetch` stub inside the census file removes 834 real timers and their log noise without touching one clinical assertion. Not done here: this is Z.ai's suite and the counter is production behaviour |
| ~~**#1097 carries a byte-identical copy of a file `main` already has**~~ — **closed by events at 03:05:05Z.** It was flagged when its base was `2ec675ab`; it rebased onto `b0610551`, its file list dropped `composerIntegrationJourney.test.ts` entirely, and its diff shrank **+763 → +705** before merging | `GET /pulls/1097/files` at head `cb2eafce` (11 files, no journey file) versus the earlier read at base `2ec675ab` | **CLOSED, and the lesson stays:** an identical blob is *not* a conflict — git auto-resolves it — but it inflates a review surface (45% of that diff was already-merged work) and invites a reviewer to read a merged test as new. The repair is rebase-before-review, which is what happened |
| `CARE_COMPOSER_99_9_PROGRESS.md` — an 11th project-memory file, at the repo root, owned by another agent, referenced by **none** of the other files in this directory until `OWNER_DASHBOARD.md` cited it twice | `grep -rn CARE_COMPOSER_99_9_PROGRESS docs/project-memory/` → only this file | **CONSOLIDATE**. It uniquely records how R-18 was resolved (merge commit `104d3f48`) and also still carries the deleted-module claim this directory corrected: it describes #1085's "server-side `reportSignerSelection`", which #1088 deleted (`git ls-files \| grep -c reportSignerSelection` → 0) |
| Two ID namespaces collide (`D-n` in this register vs `D-n` inside Composer's code comments) | §5 above | **REPAIR** by convention, in writing, at near-zero cost |
| The documentation checks this directory keeps asking for were prototyped here and **the false positives, not the defects, were the work** | this pass ran a throwaway validator over all ten files: **0 table defects**, 44 "dead path" hits of which every one is a documented convention (bare-path shorthand), an other-repo path (`PACS/...`), a deliberately-cited deleted module, a glob placeholder, or this directory's own filenames; 20 "odd backtick" hits of which all are wrapped inline code or a fenced block | **KEEP the check, scope it honestly**: it needs (1) fenced-block skipping and logical-line joining, (2) an allow-list for other repos and for paths cited *because* they are gone, (3) `maxBuffer` raised above 1 MiB or `git ls-tree -r` kills it silently. Zero of the ten files currently fail a *structural* check — `OPEN_WORK.md` priority 10 should build on this, not start over. This pass re-ran it over the rewritten files before committing (§8) |
| Knowledge loss actually happened: the Composer branch's **nine prior commits were never pushed and died with a container reset**, then were rebuilt from a worklog | `CARE_COMPOSER_99_9_PROGRESS.md` §"Provenance of this branch" | **REPAIR the process** — push-per-stage is now that agent's habit; this dashboard exists so no other agent's only copy lives in a container |

---

## 8. How to re-verify this file in one minute

```
git fetch origin && git rev-parse --short=8 origin/main
gh api repos/DrAbinash/care-on-synology1/commits/$(git rev-parse origin/main)/check-runs
gh api "repos/DrAbinash/care-on-synology1/pulls?state=open"
git rev-list --count --since=2026-10-12T22:30:00Z origin/main
gh api repos/DrAbinash/care-on-synology1 -q .visibility          # D-14: public or private, right now
git ls-tree -r -l origin/main -- docs/report-formats | wc -l      # and its byte sum, same command
git show --name-only origin/main | grep '\.sql$'                  # does the tip carry a migration today?
gh api "repos/DrAbinash/care-on-synology1/pulls?state=all&per_page=100" -q 'length'   # page 11 is the tail
git log --format="%s" origin/main | grep -cE '\(#[0-9]+\)$'       # subject-derived PR count — see §7
git log --oneline origin/main..HEAD                                # does THIS checkout hold unpushed work?
git rev-list --count c199aea2..origin/main                         # merges since the last reconciliation
git log --format='%h' c199aea2..origin/main | while read h; do git show --name-only --format= $h | grep -F '\.sql' | sed "s|^|$h |"; done
                                                                   # which merges carried a migration, and when
gh api repos/DrAbinash/care-on-synology1/check-run/<id>/annotations # the ONLY way to see a failed test name here:
                                                                   # Actions job logs return 404 for this token
gh api repos/DrAbinash/care-on-synology1/issues/1100/timeline       # ready_for_review/merged timestamps + actor
node node_modules/vitest/vitest.mjs run artifacts/diagnostic-erp/src/lib/quickSelectClickOrderCensus.test.ts --reporter=verbose
node node_modules/vitest/vitest.mjs run artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.test.ts \
  artifacts/diagnostic-erp/src/lib/radiologyReportPdfExport.signedArtifact.test.ts \
  artifacts/diagnostic-erp/src/lib/radiologyReportPrintLiveMerge.test.ts
```

**The trap that cost this pass a wrong grep: the primary working directory is not `main`.**
`C:\Users\Admin\Documents\GitHub\care-on-synology1` is checked out at **`e0991715` (2026-10-12)** — 206
commits behind `origin/main`, and its one local-only commit is the branch side of squash-merged **#929**
(`55db036f`), so **no work is stranded there** (`git diff --name-only` proves its files are on `main`, and
`scripts/preview-staff-reconciliation.mjs` is byte-identical). But `Grep`/`Read` against that tree answer
questions about **the deployed era, not `main`**: `authorizeSignatureBlock` greps to **zero hits** in the
working tree and to four in `git show origin/main:…`. So: for anything merged after 2026-10-12, cite from
`git show origin/main:<path>`, never from the checkout. This pass used that rule for every #1100/#1101
citation above, and it is the reason PI-1/PI-3 were verified by *reading* the merged tree rather than by
re-running tests there (§2, priority 1).

The last two lines are what this pass added to the method: **the census numbers and the 45-test print
verdict come from a run, not from a badge** — so they are this box's timings, not CI's, and re-measure
before quoting them elsewhere. `--reporter=basic` does not exist in Vitest 4 and silently runs nothing;
read the `Test Files` line before believing any result.

If the first four disagree with anything above, **they are right and this file is stale** — that is the
normal state of a document about this repository, which is why every row above carries its date.
