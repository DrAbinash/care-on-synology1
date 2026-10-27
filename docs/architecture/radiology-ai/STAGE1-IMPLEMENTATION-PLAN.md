# Stage 1 — implementation plan (PR sequence, not implementation)

**Planning document only. No code in this repository was changed to produce it.** Each PR below is a
minimal, reviewable unit with the eight required attributes. Citations are at `origin/main 6b64b2f0`;
the evidence base is `AI-SCREENSHOT-WORKFLOW-REUSE-AUDIT.md` (PR #1073) and
`STAGE1-AI-SCREENSHOT-REPORTING-ARCHITECTURE.md` (this branch's companion document).

## Ordering and the one deviation from the suggested sequence

The suggested order A→B→C→D→E is kept, with one dependency correction the actual graph forces: the
**unresolved-placeholder validator** (listed under PR-E) must ship **inside PR-D**, not after it.
Reason: a draft produced from a schematic is the first content that can arrive carrying `___ mm` /
`{token}` text, and the composer validator has no such check today
(`validateOutput.ts:1889` covers mutations, conservation, relations and dropped observations only),
while the equivalent hole on the Quick Select path was already closed in PR #1057. Shipping D without
it would put a known-defect class in front of the radiologist.

Nothing else reorders: PR-A is a precondition for screenshots of patient images existing at all, and
PR-B must precede PR-C because C's image set is B's selection.

---

## PR-A — Security and image-egress safeguards (precondition)

1. **Reused:** the interactive path's existing image-send audit record
   (`artifacts/api-server/src/routes/aiReporting.ts:1486-1502`), `assertCloudImageEgress`
   (`lib/ai-providers/src/index.ts:1356-1393` → `cloudImagePolicy.ts:31-57`), the hardened DNS-pinned
   transport (`lib/ai-providers/src/hardenedTransport.ts`), `classifyEffectiveLocality`
   (`lib/ai-providers/src/providerLocality.ts:128-198`).
2. **Files/functions to modify:**
   `artifacts/api-server/src/lib/ai/gatewayInferenceProvider.ts:90-92, 110-118, 129` (a source-type
   aware local-only branch); a new audit writer used by `lib/reportComposer/**` (mirror the
   `aiReporting.ts:1486-1502` record shape); `routes/aiReporting.ts:971-1082` (`/egress-preview`
   returns `data:image/jpeg;base64,…` at `:1058`); `lib/ai-providers/src/hardenedTransport.ts:284-369`
   (pass `signal` into `requestOptions`); delete
   `lib/ai-providers/src/endpointTrustPolicy.ts:75, 122` (no production caller) after confirming
   `index.ts:1833-1834` re-export removal; `routes/reportComposer.ts:725` `/vision-trial` — either
   route it through the same local-only + audit branch or remove it.
3. **Why necessary:** today one admin flag sends patient pixels to a named cloud provider with no
   consent and no audit row, and the Composer path writes no audit record at all. "Stage 1 is
   local-only" is not enforceable without this.
4. **Migration:** none.
5. **Clinical safety:** none of the report-writing path changes; the risk is a false refusal to send
   images, which degrades to a text-only draft — the existing `effectiveAiMode` behaviour
   (`composeEngine.ts:288-291`) already defines that outcome.
6. **Security:** this *is* the security PR. Acceptance in §"Security criteria" below.
7. **Tests:** a request-level test per refusal (existing convention: `*.request.test.ts` under
   `artifacts/api-server/src/routes/`); a mutation battery proving the local-only branch fails closed
   (flip the branch, the suite must go red); an audit-row assertion that no bytes or prompt text are
   stored; a test that `AbortSignal` actually cancels a hung Ollama call — measured against a real
   server socket, not a mock, because a mocked `http.request` cannot catch a dropped `signal`.
8. **Rollback:** feature-free changes except the `/egress-preview` restriction; revert is a clean
   `git revert` of one commit. No schema, no data.

## PR-B — Screenshot upload inside the existing reporting workspace

1. **Reused:** `POST /key-images` (`routes/radiology-report-generator.ts:2540-2796`) with its whole
   guard chain; `frozenKeyImages.ts:33-34, 93-147` disk storage; `FrozenKeyImagesRail.tsx:607-619`
   upload helper; `source_type` whitelist entry `PACS_SCREENSHOT` (`:2714`, currently sent by nothing);
   `/key-images/from-pacs` (`:3659`) as the preferred source when the study is in Orthanc.
2. **Files/functions to modify:**
   `artifacts/diagnostic-erp/src/components/radiology/FrozenKeyImagesRail.tsx` (attach control +
   `PACS_SCREENSHOT`), mounted today only at `components/radiology/workspace/ViewerColumn.tsx:618` —
   surface it in the findings/canvas area of the **existing** workspace, not a new page;
   `radiology-report-generator.ts:2569-2661` (derive `study_id`/`patient_id`/`accession_number` from
   the **draft row** and reject a disagreeing body); `hooks/radiology-workspace/useWorkspaceClinicalUi.tsx:1400`
   and `useDraftPersistence.ts:290-336` (persist `aiSelectedKeyImageIds` with the other draft slices,
   via an `extractCare*`-style reader). Optionally un-route-reuse
   `src/lib/reportComposer/api.ts`'s upload helper rather than the dead page
   `src/pages/RadiologyReportGenerator.tsx:797-820, 2018-2032`.
3. **Why necessary:** there is no way to give the AI a screenshot from the reporting workspace today
   (zero `type="file"` under `components/radiology`); and a screenshot that carries no patient/study
   binding can attach to the wrong report and pass every current check — the cross-patient class closed
   for text in PR #834.
4. **Migration:** none, if the selection rides `structuredJson`. If the owner prefers a column, it is a
   forward-only `migrations/*.sql` and must pass `scripts/check-migration-order.cjs`,
   `scripts/db-schema-verify.cjs`, `scripts/audit-migration-ledger.mjs` and
   `lib/db/src/schema/migrationColumnParity.test.ts` — never `pnpm db:push`.
5. **Clinical safety:** images are additive; nothing composes text yet. The rail's `include_in_report`
   and print path are untouched, so a screenshot cannot reach a printed report without the existing
   eligibility rules. Locked drafts stay locked via `keyImagesLocked` (`:2562`) +
   `assertDraftWritable` (`lib/radiologyIdentity.ts:454-533`).
6. **Security:** upload only to the draft the caller may write; ownership verified server-side; no new
   route; no client-supplied patient id accepted.
7. **Tests:** browser test in the real workspace (Playwright, existing harness) covering attach →
   rail shows it → reload → selection survives → attach to a signed draft refused → attach to study B
   while study A is open refused; route-level tests for the derived-binding change; a cross-patient
   negative test with two real drafts.
8. **Rollback:** revert removes the control and the persistence reader; any rows already written are
   inert (they are only read by the Composer selection, which reverts with them).

## PR-C — Local vision interpretation and model routing

1. **Reused (this is the part that already works):** `resolveSelectedKeyImagesForCompose`
   (`lib/reportComposer/resolveSelectedKeyImages.ts:65`, caps `:26-27`, disk read `:184`, ownership
   re-check `:136`); the four-image cap (`types.ts` `COMPOSER_MAX_SELECTED_KEY_IMAGES`, enforced
   `jobService.ts:207`, `composerContextBudget.ts:181`); `assertVisionCapableModel`
   (`composeEngine.ts:580, 585` → `visionCapability.ts:28-116`, `/api/show` capabilities
   `lib/ai-providers/src/index.ts:1779-1803`); vision-vs-text model split
   (`composeEngine.ts:308-320, 570-577`; settings `voiceReportComposer/runtimeConfig.ts:56-95` over
   `clinicSettings.ts:248, 260`); pixel attach
   (`providers/ollamaComposerAdapter.ts:60-62`); the pixel/text kind gate (`jobService.ts:174-197`).
2. **Files/functions to modify:** none for the plumbing. Config and two small gaps: the vision task
   route `selected_image_vision` (`lib/ai-providers/src/index.ts:1532`) must resolve to the model the
   benchmark picks; the capability-fallback branch (`composeEngine.ts:578-592`) should record, not
   silently swap; and the discarded classification (PR-E item) is read here.
3. **Why necessary:** Stage 1 needs the radiologist to see *which* model interpreted the images, and
   today a failed capability check quietly falls back to the text model.
4. **Migration:** none.
5. **Clinical safety:** images never change text directly — they feed one drafting call whose output is
   validated (PR-D). The image-only-leak case is already guarded (`level_change` blocked the volunteered
   L5-S1 finding in the recorded A/B, `localVisionModelsAb.live.test.ts:44-47`).
6. **Security:** local endpoint only, hardened transport, no cloud fallback (PR-A enforces it),
   four-image and byte caps unchanged.
7. **Tests:** capability matrix test against a stubbed `/api/show`; "no silent fallback" test; byte/count
   cap tests; a test that a non-vision model configured for vision fails the job visibly rather than
   drafting text-only without saying so.
8. **Rollback:** settings revert (a task-route change) — no schema, no code path removed.

## PR-D — One-click complete AI draft in the existing Composer

1. **Reused:** enqueue `jobService.ts:155` via `POST /api/radiology/report-composer/jobs`
   (`routes/reportComposer.ts:140`, permission `ai_reporting.use`); worker `cron.ts:206-238`;
   prompt assembly `composeEngine.ts:245, 652, 754` with its existing authority wording (`:274-276`);
   validator `validateOutput.ts:1889` and the fail-with-no-partial-write rule (`jobService.ts:566-581`);
   baseline + freshness + CAS (`composePersistence.ts:267, 160, 360, 401`; `jobService.ts:723, 840-846,
   952-981`); Apply chain (`useReportComposer.ts:420 → 525`, `store.ts:4478`,
   `radiology-report-generator.ts:1835`, `reportComposer.ts:298`); review UI
   (`ReportComposerAssistant.tsx:374, 129, 567-571`).
2. **Files/functions to modify:** one button + one enqueue call in the existing workspace
   (`useWorkspaceClinicalUi.tsx:1579`, `ReportingToolsRail.tsx:1143`) with `kind = FULL_REPORT` and the
   persisted selection; **add the unresolved-placeholder check** to `validateOutput.ts` and a matching
   `AiFailureCode`; **write image-derived findings as ledger observations** (source `ai-draft`,
   `reportFieldMerge.ts:38, 77, 96`) carrying the key-image id in the existing anchor shape
   (`observationAnchor.ts:113`, `observationSlot.ts:86`) instead of narrative-only prose.
3. **Why necessary:** the one-click requirement, and because `fieldProvenance` is not persisted
   (`useDraftPersistence.ts:290-336`) while hydration's fallback can only emit `"template"`
   (`observationLedger.ts:538-550`) — narrative-only AI text loses its attribution on reload, which
   breaks the provisional/unprovisional distinction the owner asked for.
4. **Migration:** none (ledger rows already ride `structuredJson.observationLedger`,
   `artifacts/api-server/src/lib/structuredJsonColumn.ts:288-303`).
5. **Clinical safety:** the draft is a proposal; Apply is refused when the report moved
   (`compose_report_moved`, `composePersistence.ts:367`); manual text is protected
   (`pathologyPatch.ts:197-207`); AI cannot sign (`unreviewedAiGuard.ts:146`,
   `radiologyD1FinalWriter.ts:76`); no invented normals — the prompt rule plus the validator; the
   three-way limitation vocabulary (demonstrated / not identified / not sufficiently evaluated) must be
   represented, reusing the existing `screening_limitation` concept rather than a new one.
6. **Security:** no new route; images already local-only from PR-A; execution provenance recorded per
   PR-A's audit writer.
7. **Tests:** job-level tests (validate → READY → apply → receipt) against the real DB (this repo's
   request-level convention, not mocks); a golden-ish clinical battery of schematics asserting
   *no invented normal, no invented measurement, no laterality/severity claim*; save/reload test
   asserting the AI attribution survives (which fails unless the ledger-observation choice is taken);
   a refusal test that a draft with `___ mm` cannot be produced; browser test of the single click.
8. **Rollback:** the button is the feature flag. Reverting removes the enqueue call; ledger rows created
   in a draft stay as ordinary (deletable) observations — no schema migration to reverse.

## PR-E — Clinical validation, provenance and benchmark-based acceptance

1. **Reused:** `localVisionModelsAb.live.test.ts` (opt-in `RUN_LIVE_OLLAMA=1`, candidates `:63`,
   criteria `:24-29`); `visionCapability.ts`; the A/B's existing guards; `reportPreviewHarness.test.ts`
   + `scripts/preview-reports.mjs` for rendered evidence; `ops-preflight.mjs` / `deploy-health.mjs` for
   the operational gate (no deployment is part of this PR).
2. **Files/functions to modify:** the harness records `usage` per run — the adapter already builds it
   (`providers/ollamaComposerAdapter.ts:118-135`, `completionTokens` from `eval_count`) and the empty-return
   already carries it (`:144`), while the harness prints only `safeError` + `detail`
   (`localVisionModelsAb.live.test.ts:252`), so this is one added column, not new plumbing; **and** the
   empty-text return at `:136-146` is evaluated before the `done_reason === "length"` branch at `:154-167`
   and does **not** include `done_reason`, so a model whose entire budget went to reasoning is reported as
   `empty_model_response` with the one field that would have explained it discarded — either move the empty
   check after the length branch or include `json.done_reason` in that return. The shared classifier
   (`lib/ai-providers/src/aiFailureContract.ts:141`) is not imported anywhere under `lib/reportComposer/**`
   (grep: zero hits), so the Composer path must call it rather than keep its own string; optional
   decode-parameter plumbing
   (`seed`/`top_p`/`repeat_penalty`, absent from the repo today) in `index.ts:695-705`; a persisted
   run ledger so promotion is evidence-based; `ai_golden_cases` + `runEvaluation`
   (`lib/ai/evaluationRunner.ts:36`) get a caller **or** are documented as unexercised — the audit's §12
   correction must not be left standing on an unreferenced runner.
3. **Why necessary:** Stage 1's acceptance is a model choice, and the current harness cannot pin or
   explain its own results — `qwen3-vl:8b` returning empty is recorded but not diagnosed.
4. **Migration:** only if the run ledger is a table; otherwise none. Prefer extending
   `ai_evaluation_runs`, which already exists.
5. **Clinical safety:** this PR decides which model interprets images, so its output is the acceptance
   evidence; nothing ships enabled on a single run.
6. **Security:** no egress change; benchmark images are synthetic or clinic-approved schematics, and any
   real study used must go through the same local-only path.
7. **Tests:** the benchmark itself, run ≥3 times per candidate at fixed `num_ctx`/`num_predict`;
   regression on the existing composer validator corpus; a mutation battery on the new provenance and
   placeholder checks; full ERP + api-server suite compared against a pristine-main control, with every
   failure classified pre-existing or new.
8. **Rollback:** harness and failure-code surfacing only; model settings unchanged until the owner
   approves the measured winner.

---

## Clinical safety acceptance criteria (Stage 1 gate)

1. A draft never contains a normal statement for anatomy the selected images do not demonstrate, and
   never contains an invented measurement, laterality, severity or diagnosis. Each is a validator rule
   with a test, not a prompt request.
2. Radiologist-typed text survives an AI Apply byte-for-byte, including when it contradicts the draft;
   the apply is refused, visibly, when the report moved underneath the job.
3. Every AI-derived finding is attributable (`ai-draft`), survives save → close → reopen with that
   attribution, is removable as one observation, and restores any normal it had withdrawn — the same
   suspension semantics ruling #174 established.
4. A report with unreviewed AI changes cannot be finalized; AI is never the signer; `auto_sign` stays
   false. Server-side, not only in the UI.
5. A signed report refuses every door that touches it, including the screenshot attach path.
6. Printed page, on-screen report and the signed PDF agree, proven from rendered HTML rather than from
   a timestamped PDF.
7. No unresolved placeholder reaches the editor or the paper.
8. A wrong-study or wrong-patient image is refused at the server, proven by a two-draft negative test.

## Security acceptance criteria (Stage 1 gate)

1. For `source_type ∈ {PACS_SCREENSHOT, UPLOAD}` there is **no code path** that sends pixels to a
   non-local endpoint, demonstrated by a test that attempts it and expects refusal — an admin flag
   cannot open it.
2. Every image send writes one audit row (study + draft identity, image ids or hashes, provider, model,
   locality, image count, prompt/config version, outcome, timing) and **never** stores pixels or prompt
   text.
3. `/egress-preview` returns no patient pixels; `/vision-trial` is either behind the same rules or gone.
4. Endpoint locality remains derived from the endpoint itself (`providerLocality.ts:128-198`); the
   hardened transport keeps its DNS-pinning and redirect rejection, and now honours cancellation.
5. One trust vocabulary survives: `endpointTrustPolicy` is retired or made authoritative — not both.
6. `DICOM_REDACTION_PERFORMED = false` keeps reporting the truth; if de-identification is still
   un-wired at the end of Stage 1, the docs say so rather than implying a pixel check exists.

## Owner decisions blocking the first implementation PR

PR-A is not blocked. PR-B is blocked by decision J2 (persist the selection in `structuredJson` or a
column). PR-D is blocked by J3 (examination knowledge in or out) and by the architecture's
ledger-observation choice. PR-E is blocked by J1 (no model decision before its own benchmark) and J6
(fate of `/vision-trial`).

**No PR in this plan may be merged, deployed or enabled in the clinic without the owner's explicit
approval, and the clinic sees nothing until `deploy-synology.sh` runs on the NAS.**
