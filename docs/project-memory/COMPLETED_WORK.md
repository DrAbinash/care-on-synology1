# COMPLETED WORK — what has actually been built

Baseline `origin/main` **`47b739c8`**. Volume: **732 squash-merged PRs** are in `main`'s history, from
`(#9)` to `(#1086)`; by month **2026-07 45 · 2026-08 293 · 2026-09 130 · 2026-10 264**
(`git log --format="%s" origin/main | grep -cE '\(#[0-9]+\)$'`, monthly from the same pipe with
`--date=format:%Y-%m`). A previous revision of this file read **727 / up to (#1080)** at `c4462041`
and then **729** at `1c80f2d3`; #1083, #1084 and #1085 merged while it was being written. The count is
by *PR-number range*, not by row: the newest PR number present is #1086 even though #1085's merge is
the tip, because three PRs landed in a single minute (03:48:31Z, 03:48:48Z, 03:49:09Z).

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
* **Audit row for image sends** now exists on the Composer path too
  (`reportComposer/jobService.ts:571` → `lib/ai/imageSendAudit.ts:153`) and on the gateway path
  (`lib/ai/gatewayInferenceProvider.ts:157,174,205`).
* **Deterministic (no-AI) Generate** and Refine shipped earlier (#917, #920, #926 lineage) with
  Accept/Discard and no auto-finalize.

### E1. Composer / image-egress PR history #1076–#1086 (the ladder, kept separate on purpose)

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
| **#1085** | *"Radiology print and PDF quality: Doppler emphasis, missing-image notice, harness coverage, **signatures from records**"* | `55de3cce` | **`47b739c8`** (2026-10-20 03:49:09Z), 10 files **+783/−46** | CI 3/3 success **on the head** (completed 02:53:22Z) **and 3/3 on the merge commit** — run `39366275815`, 15,427 tests / 1,140 files. Its own new rendered-output harness is ~+320 lines; `lib/reportSignerSelection.ts` is now the single chooser of the signature block | merged, **not deployed**, and **no human has looked at a rendered page or PDF produced by it** — the print/PDF and signature claims stay OPEN in `CLINICAL_SAFETY_REGISTER.md` §8, §9 until someone reviews produced artifacts. Tests render synthetic cases; that is a harness, not acceptance | ✔ ✔ ✔ ✘ ✘ |
| **#1086** | *"A two-model comparison was pinned to the order the provider read their sockets"* — retire a fragile test demand, keep the clinical invariant | `a608eee0` | `1c80f2d3` (2026-10-20 08:29 IST), 1 file **+90/−5** | the suite itself: **50 tests** green on both `1c80f2d3` and the current tip (tip log line 2017, 2,281 ms); new **TEST 15b** forces out-of-order completion behind a 2 s barrier with a positive control; mutation battery M1–M3 with a clean-baseline control | test-only. It proves the harness catches completion-order bugs (M2); it does not prove anything about production behaviour | ✔ ✔ ✔ ✘ — |
| **#1083** | *"Project memory reconstructed from the tree: merged is not deployed, and 15,243 green tests are not a browser pass"* — this documentation set | `2d8fbcea` | `d45370c3` (03:48:31Z), 6 files **+1,188/−0** | docs only; CI green on the head | **the landed copy is the `c4462041` snapshot**: it says `main` is red, that #1081 is a Draft and that three PRs are open. All three were overtaken the same day. The follow-up commit on this branch corrects them in place and keeps the wrong text visible | ✔ ✔ ✔ ✘ — |
| **#1084** | *"Reconstruct the AI Composer's actual state at 80a09df4, and separate it from what the docs claim"* | `a1b53e18` (final; `130fc9f5` was its head minutes earlier) | `d7abb9b3` (03:48:48Z), 4 files **+3,393/−0** | docs only; CI green on the head | sits on `main` as `docs/architecture/radiology-ai/AI_COMPOSER_*.md`, and **its G-20 row is false against today's tree** (`AUDIT_RECONCILIATION.md` §2). Docs merged ≠ docs correct | ✔ ✔ ✔ ✘ — |

| **#1087** | *"Project memory synchronised to 47b739c8 (documentation only)"* — this branch: the dated corrections plus `OWNER_VISION.md`, `AUDIT_RECONCILIATION.md`, `CLINICAL_SAFETY_REGISTER.md` | `db264aa5` | **open DRAFT** — `GET /pulls/1087` returns `merged: false`; `merge_commit_sha` is GitHub's test-merge preview and is not on `main` | 9 files **+1,052/−126**, markdown only; CI on its own head (verdict recorded in `CURRENT_STATE.md` §2 once read) | the owner's approved product vision and the two newest registers are **not on `main` until this merges**, so no other agent is obliged to read them; it also carries no clinical fix — the letter-pad `"Signed:"` door it documents stays open pending owner decision D-8 | ✔(docs) ✔(CI, docs-only) ✘ ✘ — |

**Reading rules for this table.** `T ✔` names the harness; a CI job on a *merge commit* can read
`cancelled` (concurrency group `ci-${{ github.ref }}`) without anything being wrong, so this pass read
the PR head **and** the merge commit and said which. `M ✔` came from `merged`/`merged_at`, never from
`merge_commit_sha`. `D ✘` for every row because the last deploy a document records is 2026-10-12.
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
(`lib/frozenKeyImages.ts:1-14`, `:46`, legacy fallback `lib/reportImages.ts:219` via `:287/:295`);
HMAC grant-token distribution with 600 s TTL (`lib/keyImageAccessToken.ts:46`), enforced in
`lib/radiologyKeyImageStatic.ts`; key-image ownership proven at compose time
(`reportComposer/keyImageOwnership.ts`). PDF pagination (`ensureSpace`) #1021; key images on the PDF
(#944/#945); sub-headings (#818); enterprise summary export — Word table, compressed PDF, styled
Excel (#895). CI + rendered-output checks. **PDF bytes are timestamp-nondeterministic: prove layout
from the print/screen HTML, never the PDF.**

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
* **73 `*.request.test.ts`** route suites that boot the real router over supertest against
  PostgreSQL, plus **1111** `*.test.ts` and **24** `*.test.mjs` files in `artifacts lib scripts`. CI runs the whole
  thing on `postgres:16-alpine`: at tip **`47b739c8`**, **15,427 passed / 49 skipped (15,476) over
  1,135 files passed / 5 skipped (1,140)** in **538.27 s** (read from run `39366275815`'s
  `0_Tests + migration smoke (real Postgres).txt`, lines 7579-7582, not inferred). The previous tip
  `1c80f2d3` was 15,406 / 15,455 over 1,138 files in 775.25 s (run `39361881382`, lines 9311-9314),
  and an earlier revision of this file quoted `6a31307f`: 15,243 / 1127 files / 619.89 s. The
  **duration varies by ~40 % between runs of the same tree** — never read a slow CI job as a regression.
  The same log contains two literal `FAIL` strings from `restoreVerifiesRealArtifact.test.ts` (lines
  6927, 6930) inside a job whose conclusion is `success`.
* Two Playwright specs are wired as scripts: `pnpm e2e:smoke`, `pnpm e2e:voice-composer`.

## J. What "completed" does **not** mean here

1. **Not deployed.** Every item above this baseline except the 2026-10-12 build is invisible in the
   clinic. **111** commits since 2026-10-12 22:30Z (`git rev-list --count --since=2026-10-12T22:30:00Z
   origin/main`, measured at `47b739c8`; 108 at `1c80f2d3`, 106 at `c4462041` — re-run it, do not
   recall it).
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
