# COMPLETED WORK — what has actually been built

Baseline `origin/main` `c4462041`. Volume: **727 squash-merged PRs** are in `main`'s history, from
`(#9)` to `(#1080)`; by month **2026-07 45 · 2026-08 293 · 2026-09 130 · 2026-10 259**
(`git log --format="%s" origin/main | grep -cE '\(#[0-9]+\)$'`).

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
  it — #1080 `c4462041` (merged 2026-10-19 20:29:55Z). Test level: CI at head; **not yet
  re-verified on `main` by this pass** (CI was still running when this audit was taken).
* **Audit row for image sends** now exists on the Composer path too
  (`reportComposer/jobService.ts:571` → `lib/ai/imageSendAudit.ts:153`) and on the gateway path
  (`lib/ai/gatewayInferenceProvider.ts:157,174,205`).
* **Deterministic (no-AI) Generate** and Refine shipped earlier (#917, #920, #926 lineage) with
  Accept/Discard and no auto-finalize.

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
  PostgreSQL, plus **1107** `*.test.ts` and 23 `*.test.mjs` files in workspace scope. CI runs the whole
  thing on
  `postgres:16-alpine`: at tip `6a31307f`, **15,243 passed / 49 skipped over 1127 files** in 619.89 s
  (read from the Actions log, not inferred).
* Two Playwright specs are wired as scripts: `pnpm e2e:smoke`, `pnpm e2e:voice-composer`.

## J. What "completed" does **not** mean here

1. **Not deployed.** Every item above this baseline except the 2026-10-12 build is invisible in the
   clinic. 106 commits since.
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
