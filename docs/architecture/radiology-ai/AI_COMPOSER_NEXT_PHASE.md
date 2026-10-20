# AI Composer — next phase

**Scope.** A sequencing plan for the 24 gaps recorded in `AI_COMPOSER_GAPS.md`, grouped into small
PRs. Written at `origin/main 80a09df4`.

**The governing rule, stated once and applied throughout:** these are **priorities to evaluate, not
permission to rewrite existing working systems.** Every item below is either (a) one rule added to a
mechanism that already exists, (b) one field carried through a path that already carries eight,
(c) a test that proves an ordering already implied by the code, or (d) a document corrected to match
execution. Nothing here proposes a new engine, a new ledger, a new settings subsystem, a new audit
subsystem, a new gateway or a new Quick Select implementation.

**Nothing in this document is authorised work.** It is a plan for the owner to review before the next
implementation phase is authorised.

Companion documents: `AI_COMPOSER_CURRENT_STATE.md` (what exists, component by component),
`AI_COMPOSER_WORKFLOW.md` (the 21-stage trace and its grades), `AI_COMPOSER_GAPS.md` (the seven-attribute
treatment of each gap).

---

## 1. What must not be touched

These are working, tested, and load-bearing. A next-phase PR that changes one of them is out of scope
by definition, and any such change should be sent back for separate review.

| Settled system | Why it stays |
| --- | --- |
| Deterministic-before-AI composition | The report exists before the model runs; the AI can only propose against it. This is the reason a model failure degrades instead of blanking. |
| Frozen snapshot as the authoritative input (Guard 8 / Model B) | The job is validated against the state it was enqueued with, not the state at execution time. Removing it re-opens the stale-apply class of defect. |
| Client-side Apply (Guard 3) with a persisted baseline token | Gated four ways — freshness, explicit Accept for clinically significant changes, the signed-report witness, and an undo frame with rollback on server refusal. Moving it server-side is a redesign. |
| Non-blocking enqueue (Guard 7) | A model timeout cannot take the reporting canvas down. |
| Two cloud image doors, both default-deny | `assertCloudImageEgress` (session-derived attestation) and `assertGatewayPrivacy` (demands a `PixelEgressProof`). Both fail safe and both name their remedy. **Relaxing either is not a next-phase item.** |
| `DICOM_REDACTION_PERFORMED = false` | Honest. G-12 is a documentation correction; flipping the constant would be a false statement about patient data. |
| Endpoint-derived locality + hardened transport | Provider locality is derived from the endpoint, not from a client-supplied boolean. `hardenedTransport.ts:357` passes the caller's abort signal. |
| The two running queues on `dicom_retry_queue` | `ai_shadow_pipeline` and `AI_REPORT_COMPOSE_JOB`, both with registered handlers (`radiologyJobHandlers.ts:290,294-300`). A third queue is not a next-phase item. |
| The 2230-line `validateComposerOutput` rule set | Thirteen rule families already fire. New rules are *added beside* them (N-1); none are weakened to obtain green CI. |
| Signature withdrawal in one transaction | `patient-reports.ts:2999-3051` reverts report and worklist atomically, refuses if already delivered, and is signer-or-admin only. |
| `COMPOSER_MAX_SELECTED_KEY_IMAGES = 4` and the 2.5 MB/8 MB compose ceilings | Correct as they stand. G-15 adds a check at *attach* time; it does not move these. |

---

## 2. The proof bar for every PR in this plan

A next-phase PR is not done when its tests are green. It is done when all four of these are in the PR
description:

1. **A positive control.** The clean case still passes. A rule that refuses everything is not a fix.
2. **A mutation.** The new behaviour removed by hand, and the new negative test observed going red.
   Without this, the test may be asserting nothing.
3. **A comparison against pristine `origin/main`.** The failure list before and after, so an
   environmental failure is not claimed as a fix and a new failure is not hidden.
4. **DB-gated suites actually executed.** `DATABASE_URL` exported and Postgres running. Per G-24, 73
   `*.request.test.ts` files are wrapped in `describe.skipIf(!hasDatabaseUrl())` and report green when
   skipped — a green run without a database is not evidence that any route works.

Two repo-specific traps that have already produced false verdicts here:

- Source-text greps cannot catch runtime faults. The `POST /api/billing/save` grep test stayed green
  while the endpoint returned 500 on every call. Prefer a `*.request.test.ts`.
- `pnpm typecheck` can break a worktree's `node_modules` by triggering an implicit install. Call `tsc`
  directly in a worktree rig.

---

## 3. The seven named work areas, mapped

The owner asked for the plan to be organised against seven areas. This is where each one actually
lands — including where an area turns out to have almost nothing left to do.

| Area | Real state at `80a09df4` | Gaps | PRs |
| --- | --- | --- | --- |
| **PACS image-to-local-AI validation** | The picker, ownership re-verification, normalisation and payload construction all work and are tested. What is missing is *honesty at the edges*: attach has no byte bound, `vision-trial` truncates silently, the Anthropic arm mislabels MIME, and the de-id/OCR modules that would produce an egress proof have no caller. | G-15, G-16, G-17, G-10, G-11, G-19 | N-8, N-11, D-4, Wave 4 |
| **Composer integration** | Working end to end: enqueue → snapshot → model → validate → propose → gated Apply → tracked change. The integration gap is that Apply's provenance does not survive a reload, and that a *second* AI-to-text door (copilot Insert) bypasses the review gate. | G-1, G-3, G-21, G-22 | N-2, N-3, N-7, D-5 |
| **Structured report generation** | Thirteen validator rule families fire and a failure writes nothing. Two clinical rule families are absent: unresolved placeholders, and a normal asserted about anatomy the selected images do not show. | G-2, G-5 | N-1 |
| **Findings ↔ Impression sync** | **Already IMPLEMENTED AND TESTED on the client** (workflow stage 14): `deriveImpressionDependency`, `mergeImpressionGuard`, `withdrawSupersededNormals`, `normalBootstrap`, plus the R2 round-trip test. The gap is that none of it is enforceable server-side, because the ledger lives in browser JSON. | G-9 | D-2 |
| **Radiologist review workflow** | The unreviewed-AI finalize gate is sound and fails closed, and `SIGN_DENY_ROLES` bars `ai`/`system`/`bot` from signing. Three holes: copilot Insert is invisible to the gate, `verify`/`amend` are unproven against it, and attribution is lost on reload. | G-1, G-3, G-4, G-7 | N-2, N-3, N-4, N-6 |
| **Final report quality** | Preview, print and PDF are IMPLEMENTED AND TESTED (stage 16); finalize and sign are IMPLEMENTED AND TESTED (stage 17); the signed body is frozen and mutation-refused. Residual quality risk is upstream of the paper, not in the renderer — the two missing validator rules, and whole-field Apply granularity that is documented nowhere a radiologist would see it. | G-2, G-5, G-21, G-9 | N-1, N-7, D-2 |
| **Performance and usability** | Timeouts, budgets and failure classification are all present and correct. What is missing is *remedy and record*: `CONTEXT_BUDGET_EXCEEDED` is named and never retried; truncation is diagnosed and never persisted; no model choice has a measured basis; two auto-compose switches exist and one does nothing. | G-13, G-18, G-19, G-22, G-23, G-24 | N-10, N-13, D-3, D-4, D-5, D-6 |

---

## 4. Top ten next improvements

Ranked by clinical weight per unit of risk. The first five are the S1s — the only gaps that can put a
wrong or unattributed statement in front of a radiologist or on paper.

| # | Improvement | Gap | Sev | Why it is here |
| --- | --- | --- | --- | --- |
| 1 | Composer validator refuses unresolved placeholders and normals about unimaged anatomy | G-2, G-5 | S1 | The only two gaps that can put a *wrong sentence on paper*. Both are one rule each, both reuse a vocabulary that already exists (#1057's placeholder detector, the `screening_limitation` concept), and both land in one PR so `validateOutput.ts` is touched once. |
| 2 | AI attribution survives a draft reload | G-1 | S1 | The whole provisional/authoritative design rests on provenance, and hydration currently relabels AI prose as `"template"` — a *stronger* claim than the truth. Additive `jsonb` key, no migration. |
| 3 | Copilot Insert is covered by the unreviewed-AI gate | G-3 | S1 | A live bypass of the one control that stops unreviewed AI text being signed. The correction writes into state the guard already reads — no second review vocabulary. |
| 4 | Prove — or close — the `verify`/`amend` gate ordering | G-4 | S1 | Test-first, and the most likely answer is "already safe, here is the proof", in which case **zero code changes**. Cheapest possible S1 closure. |
| 5 | A measured basis for model choice | G-13 | S2 | Blocks every defensible model-promotion decision, including Stage 1's acceptance. `runEvaluation` and `ai_evaluation_runs` already exist; what is missing is one caller and persistence of the A/B harness that already runs. |
| 6 | `strictAudit` reaches the interactive cloud writers | G-8 | S2 | In Clinical mode an unfiled audit row is supposed to stop a cloud send. On `/query`, `/draft`, `/polish` and `/ai-comparison` it does not — the `.catch(() => {})` is unconditional. The resolver is already threaded by #1078. |
| 7 | Audit evidence columns rendered where they can be read | G-7 | S2 | `endpointLocality`, `jobReference`, `correlationId`, `imageSourceTypes` are written to real rows and shown to nobody. Four fields on an existing page; no route or schema change. Free. |
| 8 | `resolveModelPin` filters on provider **and** model | G-6 step 1 | S2 | One line. It is wrong today and must not become load-bearing while wrong. Deliberately stops before step 2, which needs an owner decision and N-10's run data. |
| 9 | The image path refuses instead of silently degrading | G-15, G-16, G-17 | S3 | Three corrections, all the same shape: an oversized attach is refused rather than stored to fail later; `vision-trial` refuses rather than `.slice(0,6)`; and the three interactive cloud arms carry a real MIME instead of all hard-coding JPEG. |
| 10 | CI reports how many DB-gated suites actually ran | G-24 | S2 | Makes every other claim in this plan measurable. Until it exists, "CI green" cannot distinguish 44 passing egress tests from 44 tests that never ran. |

---

## 5. Recommended PR sequence

Four waves. **Wave 1 needs no owner decision, no migration and no CI change** — it can start the moment
this plan is approved. Wave 2 needs a Wave-1 merge or a measurement first. Wave 3 needs an explicit
owner decision. Wave 4 is not authorised by this plan at all.

### Wave 1 — independent, unblocked, small

Every PR here depends on nothing. They can be reviewed in any order, but **N-1 must merge before any
other PR that touches `validateOutput.ts`** so the file is not contended.

| PR | Closes | Size | Files | Must **not** |
| --- | --- | --- | --- | --- |
| **N-1** Validator: placeholder + unsupported-normal rules | G-2, G-5 | 2 rules, 1 failure code each, ~8 tests | `lib/reportComposer/validateOutput.ts:1889`; the `AiFailureCode` union; reads `composeEngine.ts:571,596-623,706` for selected-image provenance | Invent a second placeholder vocabulary (reuse #1057's); invent a second limitation concept (reuse `screening_limitation`); fire on a TEXT_ONLY job; weaken any of the thirteen existing rule families |
| **N-2** Provenance survives reload | G-1 | 1 `jsonb` key + 1 reader | `useDraftPersistence.ts:290-345,495`; `lib/observationLedger.ts` (`extractCare*` family); `store.ts:3681,4620-4633` | Add a migration (the column is already `jsonb`); make the write anything other than additive, so an older draft still restores |
| **N-3** Copilot Insert records a review state | G-3 | 1 write into existing state | `components/radiology/zai-workspace/copilot-rail.tsx:38-72`; `store.ts` (`insertCopilotText`); `lib/reportComposer/unreviewedAiGuard.ts:42-198` | Add a second guard or a second review vocabulary; double-count text that also arrives as a Composer change |
| **N-4** Prove the `verify`/`amend` gate ordering | G-4 | **Test-first; possibly zero code** | new `patient-reports` request test; reads `patient-reports.ts:1585-1650,2436-2634,2639`; `lib/peerReview.ts` (not yet read end to end) | Add a redundant guard call before the test has shown one is needed. If the test passes, the deliverable is the recorded proof |
| **N-5** `resolveModelPin` filters on model | G-6 step 1 | 1 line + 1 test | `lib/ai-providers/src/capabilityRegistry.ts:34-41` | Proceed to step 2. Step 2 is D-1 and is blocked on N-10 |
| **N-6** Render the four audit evidence fields | G-7 | 4 fields on an existing page | `pages/AiAuditLog.tsx:18-120`; extend `aiReporting.imageEgress.request.test.ts:199-231` | Display a NULL `endpointLocality` as "local" — it must read "not recorded (pre-dates this column)"; change the route or the schema |
| **N-7** Documentation truth pass | G-12, G-14, G-21, and the ten stale claims in `AI_COMPOSER_GAPS.md` §5 | Docs only | `15-security-model.md`, `07-orchestration-and-night-processing.md`, `04-ai-gateway.md`, `README.md`, `IMPLEMENTATION_TRACKER.md` (G8, G10) | Flip `DICOM_REDACTION_PERFORMED`; delete the de-id/OCR modules or their tests; mark G10 orchestration "✅ Done" |
| **N-8** Name the unbuilt proof producer | G-10 option (a), G-11 (marking only) | Behaviour-neutral comments | `lib/reportComposer/providers/gatewayPrivacy.ts:105`; headers of `lib/ai/imageDeidentification.ts`, `lib/ai/localBurnedInOcr.ts` | Wire the producer (that is Wave 4 and needs separate approval); change any control flow; delete the modules — their 23 tests encode real clinical requirements |

**Wave 1 exit condition:** all five S1 gaps closed or proven closed, and no document in
`docs/architecture/radiology-ai/` asserts something the code at that commit does not do.

### Wave 2 — needs a Wave-1 merge or a measurement

| PR | Closes | Precondition | Notes |
| --- | --- | --- | --- |
| **N-9** `strictAudit` on interactive cloud writers | G-8 | #1076/#1078 merged (they are) | Cloud **and** clinical ⇒ fail the request, mirroring `jobService.ts:603-614`. Local sends keep the non-critical `.catch` — a local audit miss is not a PHI event. **Must not change behaviour in development mode.** |
| **N-10** Evaluation runner gets one caller; A/B persists | G-13 | None, but **blocks D-1** | Admin-triggered route beside the existing `/api/radiology-ollama/pipeline-self-test` family (`radiologyOllama.ts:1020,1043,1067`). Persist into `ai_evaluation_runs`, which already exists. Also recover the two adapter diagnostics: `ollamaComposerAdapter.ts:136-146` returns empty *before* the `done_reason === "length"` branch at `:154-167`, so "spent the whole budget reasoning" is reported as `empty_model_response`. |
| **N-11** Image path refuses instead of degrading | G-15, G-16, G-17 | None | A size check in `POST /key-images/from-pacs` (`radiology-report-generator.ts:3659`) after normalisation and before the row insert; refuse-on-excess in `reportComposer.ts:746-762` matching `aiComparison.ts:36-55,138-146`; and one MIME correction shared by all three interactive cloud arms (`index.ts:531,590,635`, whose root cause is `AiQueryOptions.images: string[]` at `:278`). **Must not change the normalisation, which is correct**, and must not be fixed on the Anthropic arm alone. |
| **N-12** `save-winner` provenance + one screen test | G-20 | None | **Corrected after re-reading G-20: this row proposed a new `aiComparison.request.test.ts`, and that file would compete with coverage that already exists** — 18 request-level cases at this pin, 29 now, in `aiReporting.imageEgress.request.test.ts`. Do not fork a second suite. What is actually missing: (a) one assertion that a `save-winner` `model` the run never produced is rejected or recorded as operator-supplied rather than written to the audit log as the answering model (`aiComparison.ts:291-299` at this pin; the body read is `:409-414` and the values are written at `:424` and `:427` at `1c80f2d3`); (b) one test for `AiComparisonWorkspace.tsx`, which has none — the picker, arm chips, attestation checkbox and result cards are unexercised by any automated assertion. Making the existing 29 actually run in CI is **D-3**, an owner decision, not this PR. |
| **N-13** Bounded `num_ctx` retry | G-18 | Measure against `gpuContextCleanRunner.ts:163` first | One retry, one step, only for `CONTEXT_BUDGET_EXCEEDED`, only inside the existing budget ceiling, recorded via the field that already exists (`gatewayInferenceProvider.ts:301` `recoveredOnce`). **Not unbounded escalation** — on a shared GPU a larger context can evict another model. |

### Wave 3 — needs an explicit owner decision

Each of these is blocked on a ruling, not on code. They are listed with the question that has to be
answered.

| PR | Closes | The decision required |
| --- | --- | --- |
| **D-1** Capability table: wire it or delete it | G-6 step 2 | **PR #1080 has merged (`c4462041`) and answers half of this.** Its new `localModelCapabilities.ts` reuses `classifyOllamaModelCapability` — the same classifier the Composer's selected-image gate (`visionCapability.ts:45`) and the OCR resolver (`ocrProviderResolver.ts:63`) already consult — and its header forbids a second capability rule per surface. A DB-driven capability table would be exactly that second rule, so on this evidence **deleting is the better-supported option**: drop the table and the two dead functions, keep `ai_model_routes` (which has a writer and a UI). **Still blocked on N-10**, because no model-choice decision is defensible without run data. **Scope limit — deleting must not grow into a unification project.** Three *live* authorities already exist and are correctly partitioned by provider arm in `composeEngine.ts`: probe-first three-state for Ollama (`:637-641`, refusal `:652-664`), hard-coded `BUILTIN_MODEL_CAPABILITIES` for cloud (`:665-667`), per-endpoint Settings for `local_openai_compatible` (`:681`). Each fails closed for its own arm; a cloud arm cannot probe `/api/show`, and the Ollama arm must not be reduced to a hard-coded list. Removing the dead *fourth* is the correction. Collapsing the three live ones is a redesign and is **not authorised by this plan**. |
| **D-2** Server-side ledger validation inside the existing `/validate-draft` | G-9 | **Do not create a table** — the owner has ruled against a second observation ledger. The proposal is that `POST /validate-draft` (`radiology-report-generator.ts:2115`) parse `observationLedger` out of `structured_json` and run the same contradiction checks the client runs. **Scope check first:** confirm `mergeImpressionGuard.ts` and `withdrawSupersededNormals.ts` are importable from a server context. If they are not, this is larger than one PR and must be scoped separately rather than started. |
| **D-3** CI prints the skipped-suite count and fails on a named critical list | G-24 | A pipeline change, which the owner must approve. **Must not weaken the `skipIf`** — local development without Postgres is legitimate and `AGENTS.md` documents the environmental skips as expected. |
| **D-4** Two audit columns for truncation | G-19 | A schema change, so a forward-only `migrations/*.sql` that passes `scripts/check-migration-order.cjs`, `scripts/db-schema-verify.cjs`, `scripts/audit-migration-ledger.mjs` and `lib/db/src/schema/migrationColumnParity.test.ts`. **Never `pnpm db:push`.** Consider deferring: N-6 is free and N-10 needs run data anyway. |
| **D-5** One auto-compose switch | G-22 | A clinic-settings change. `reportComposerAutoCompose` (`clinicSettings.ts:268`, checkbox at `AiReportingSettings.tsx:1494`) is read by no behaviour; Mode A obeys `care.instantReport.modeA.enabled` (`lib/zai-workspace/instantReport.ts:37,158-159`) and is default ON. **Deleting the dead setting is safer** than wiring it, but "do not modify production settings" applies to the deployed value, so the owner rules. |
| **D-6** Personal macros onto the existing server table | G-23 | **Not recommended as a next-phase item.** If wanted, move personal macros onto the **existing** `radiologist_macros` table (`radiologyWorkflow.ts:320-337`) rather than adding a fourth store. |

### Wave 4 — not authorised by this plan

| Item | Closes | Why it is separate |
| --- | --- | --- |
| Wire `deidentifyImagesForCloudEgress` as the `PixelEgressProof` producer, enabling cloud composer vision | G-10 option (b), G-11 | The owner has ruled that **Composer cloud image transmission must not be enabled without a separate approved implementation.** The mechanism is built and its 23 tests encode the real requirements — metadata strip, JPEG q90 re-encode, 12 MB cap, burned-in identifier matching against the patient's own identifiers, refusal when OCR cannot attest, one bad image blocks the set. Wiring it is a security-posture change, not a gap closure. **Do not wire it as a side effect of another change.** `aiReporting.imageEgress.request.test.ts:1097-1133` already tests the forged-proof shape and must keep passing. |

---

## 6. Dependency graph

```
                       ┌─ N-1 (G-2,G-5) ──────────────┐
   no dependency ──────┼─ N-2 (G-1)                   │
   (Wave 1, parallel)  ├─ N-3 (G-3)                   │
                       ├─ N-4 (G-4, maybe zero code)  │
                       ├─ N-5 (G-6 step 1) ──┐        │
                       ├─ N-6 (G-7)          │        │
                       ├─ N-7 (docs)         │        │
                       └─ N-8 (G-10a,G-11)   │        │
                                             │        │
   PR #1080 merged (done) ─────┐           │        │
                                 ▼           ▼        │
   N-10 (G-13) ───────────────► D-1 (G-6 step 2)      │
                                                      │
   N-1 merges ──────────────────────────────────────► D-2 (G-9)
   (one PR in validateOutput.ts at a time)            │
                                                      │
   #1076 + #1078 merged (done) ──► N-9 (G-8)          │
   gpuContextCleanRunner measured ─► N-13 (G-18)      │
   owner approves CI change ───────► D-3 (G-24)       │
   owner approves migration ───────► D-4 (G-19) ◄─────┘ (defer behind N-6, N-10)
   owner rules on settings ────────► D-5 (G-22)
   owner asks for it ──────────────► D-6 (G-23)

   N-8 merges + separate approval ─► Wave 4 (G-10b, G-11 wired)
```

Two hard sequencing rules:

1. **N-10 before D-1.** No model-promotion decision is defensible without persisted run data, and
   D-1's whole question is which capability authority to keep.
2. **PR #1080 resolved before D-1 — satisfied.** This rule was written when #1080 was open, and it
   has since merged (`c4462041`, 2026-10-19). It added metadata-derived three-state capability
   detection on the interactive/overnight path, and its new `localModelCapabilities.ts` header
   forbids a second capability rule per surface, reusing `classifyOllamaModelCapability`. The rule
   has therefore done its job: D-1's capability-authority half is answered in favour of the
   classifier, and what is left in D-1 is only whether the dead `ai_model_capabilities` table is
   deleted or given a writer — which still waits on rule 1.

One soft rule: only one PR in `validateOutput.ts` at a time (N-1, then D-2 if it reaches that far).

---

## 7. Interaction with the open PRs

| PR | State at time of writing | Interaction with this plan |
| --- | --- | --- |
| **#1080** AI vision-capability honesty | **MERGED** 2026-10-19T20:29:55Z → `c4462041`, head `76fe43b0`, all three CI checks SUCCESS. It was OPEN when these documents were pinned at `80a09df4`. | Adds the metadata-derived three-state classifier and per-arm execution provenance on the **interactive/overnight** `lib/ai-providers` path, plus the verbatim warning "This model does not support image interpretation. Its response may be based only on the text prompt." It also adds `lib/ai/localModelCapabilities.ts`, which reuses `classifyOllamaModelCapability` — *the same classifier the Composer's selected-image gate and the OCR resolver consult* — and whose own header forbids a second capability rule per surface. **That resolves the capability-authority half of D-1 in favour of the existing per-arm authorities — the classifier for local models, `BUILTIN_MODEL_CAPABILITIES` for cloud — and against the DB table.** It does not touch the dead table's missing writer and does not fix `resolveModelPin`, so N-5 and the rest of D-1 stand. The **Composer** path (`visionCapability.ts`) already failed closed on `unknown`, so nothing in Wave 1 or 2 overlapped it. |
| **#1081** CARE_DEV_ISOLATED | **OPEN, `draft=true` when this plan was written; MERGED → `c208cbfb`** (head moved three times first: `469e928d` → `febf95f6` → `1209ae49`) | **Helps this plan rather than blocking it.** `lib/devIsolation.ts:88-90` names the two AI job consumers and suppresses them, `:189` keeps a **local Ollama and a local Orthanc on loopback working** while refusing production targets, and `pnpm dev:isolated` refuses to boot unless `DATABASE_URL` is the approved development DB. That is the sanctioned way to exercise Wave 2's image-path items (N-11, N-13) and Phase-3-style traces without a hand-built harness and without risking a real send. No item in this plan touches its files. |
| **#1086** comparison arm order | **MERGED → `1c80f2d3`** (current main) | Test-only. Adds TEST 15b to `aiReporting.imageEgress.request.test.ts`, so a comparison arm the provider serves second still gets the first card. It shifts every citation in that file after `:158` — see CURRENT_STATE §6. It also re-exposed that G-20's "zero tests" claim was wrong; see N-12. |
| #1076, #1078, #1079 | Merged 2026-10-19 (`66d2c116`, `a787bafb`, `b67869ed`) | N-9 reuses the mode resolver #1078 threaded at `aiReporting.ts:929` and `aiComparison.ts:181` — it adds no new policy framework. |
| #1082 | Merged; `80a09df4` is its commit | The baseline every citation in these four documents was read at. |

**Do not assume an open PR is merged.** Every state above was read from the GitHub REST API, not from
a poller or from a local branch name.

---

## 8. What this plan does not authorise

Recorded so that the absence is a decision rather than an oversight — the same convention as
`AI_COMPOSER_GAPS.md` §4.

- **No new reporting engine, Composer, observation ledger, audit subsystem, settings subsystem or
  security-mode framework.** Every item extends a mechanism that already exists.
- **No relaxation of any security control.** N-8 makes `strictAudit` *reach more* writers. N-11 makes
  the image path *refuse more*. N-9 makes `strictAudit` reach interactive cloud sends. Nothing opens a
  door.
- **No modification of PACS infrastructure.** N-11's attach-time size check sits in the reporting
  handler, after normalisation, and does not touch Orthanc, DICOMweb or the viewer.
- **No change to the deterministic Radiology Composer.** N-1 adds rules to the *validator*, which
  already fails jobs; it does not change composition.
- **No broad refactoring.** The largest single item is N-1 at two rules. D-2 is explicitly gated on a
  scope check that may conclude "larger than one PR — scope separately".
- **No weakening of tests to obtain green CI.** The proof bar in §2 requires the opposite: a mutation
  that makes the new negative test fail.
- **No client-supplied boolean as authorisation** for anything, including cloud image transfer.
- **No deletion of a proof requirement.** Where a mechanism does not exist, N-8 says so in the code
  rather than fabricating a proof or bypassing the gate.
- **No automatic merge, deploy, container restart or production configuration change.** Merged PRs are
  invisible in the clinic until someone runs `deploy-synology.sh` on the NAS, and that is the owner's
  action.

---

## 9. The first thing to do

If only one PR is authorised, it is **N-1**. It is the only item that closes two gaps capable of
putting a wrong sentence on paper, it touches one file, it reuses two vocabularies that already exist
in the tree, and its proof is a mutation that any reviewer can run in a minute.

If two are authorised, add **N-4** — it is test-first, it may need zero code, and it either closes an
S1 or converts an unproven assumption into a recorded proof.
