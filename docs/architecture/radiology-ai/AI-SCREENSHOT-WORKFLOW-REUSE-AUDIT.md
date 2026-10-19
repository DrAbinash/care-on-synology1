# AI screenshot → draft workflow — reuse audit (Stage 1 foundation)

**Status: audit and documentation only. No runtime behaviour was changed by this document.**

* **Purpose.** The owner's Stage 1 workflow is: radiologist takes screenshots of a study →
  a **local vision model** interprets them → a **local reporting model** drafts the complete
  report → the draft appears in the **existing** Composer → the radiologist reviews the full
  DICOM study in OHIF, edits, and signs. This audit answers one question: how much of that
  already exists, what exists but does not run, and what must be built.
* **Baselines.** CARE ERP `d968fc24` at the time of the audit; **revalidated line-by-line against
  `origin/main 6b64b2f0`** (2026-10-19) — every citation below was re-read from that commit.
  care-pacs `53588a0`, which is **11 commits behind** that repo's `origin/main 247f0cc`; §11 says
  which care-pacs facts came from the current remote tip.
* **Method.** Read-only code inspection; live-versus-decorative is decided by *caller*, not by
  file existence. "NO PRODUCTION CALLER" means: grepped repo-wide, the only other references are
  its own definition, its tests, or a re-export. Where a claim could not be measured it is
  labelled **HYPOTHESIS**.
* **Superseded belief, corrected here:** an AI-side "engine dependency map" was expected to exist
  at `docs/audits/ai-reporting-engine-dependency-map-2026-10-19.md`. It does not exist on
  `origin/main`, on any branch, or in any open PR (the repo has exactly one open PR, #1071). The
  reuse map in §9–§10 is therefore the current authority for the AI side.

---

## 1. Verdict

Stage 1 is **not a build-from-scratch**. The image leg, the job engine, the drafting model leg,
the acceptance boundary that protects the radiologist's text, and the rule that AI never signs are
all present and live. What is missing is narrow and specific: a screenshot entry point **in the
reporting workspace**, a **vision-model call that is actually wired** to that entry point, a
**local-only enforcement that cannot be toggled open**, **execution provenance for image sends**,
and a **benchmark that can pin its own parameters**.

| Part of the workflow | State on `6b64b2f0` |
| --- | --- |
| Screenshot bytes accepted, stored, ownership-checked | **REAL** — server-side, complete |
| Screenshots linked to patient + study + draft | **PARTIAL** — enforced only when the client volunteers it (§5) |
| Screenshot picker inside the reporting workspace | **ABSENT** — no file input exists there (§4) |
| Images reaching a model | **REAL but cloud-capable** — one door, admin-flag open (§6) |
| Vision model ≠ reporting model | **REAL** — two settings, two task routes (§10) |
| One click → complete draft in the existing Composer | **REAL machinery, wrong kind** — `FULL_REPORT` job exists; nothing feeds it screenshots (§9) |
| AI cannot overwrite typed findings | **REAL and server-enforced** (§9) |
| AI cannot sign | **REAL and server-enforced** (§9) |
| Model benchmark with pinned parameters | **PARTIAL** — harness exists, `seed` is not implemented anywhere (§7) |
| Examination knowledge in the prompt | **ABSENT** — no knowledge source reaches the prompt (§8) |
| Image-send audit trail | **ABSENT** on the Composer path (§6) |

---

## 2. Classification: REUSE / REPAIR / EXTEND / RETIRE

| # | Component | Where it lives | Verdict | Why |
| --- | --- | --- | --- | --- |
| 1 | `POST /key-images` (multipart PNG/JPEG/WebP, 8 MiB, full guard chain) | `artifacts/api-server/src/routes/radiology-report-generator.ts:2540-2796` | **REUSE** | Already a legal home for a screenshot; adding a second upload route would be a second image pipeline |
| 2 | `radiology_report_key_images` | `lib/db/src/schema/radiologyReportGenerator.ts:153-195` | **REUSE** | The table the Composer already reads |
| 3 | Disk-backed frozen storage + normalisation | `artifacts/api-server/src/lib/frozenKeyImages.ts:33-34, 93-147, 257-266` | **REUSE** | PNG→JPG at 1800 px q85, 240 px thumb, no object storage dependency |
| 4 | `resolveSelectedKeyImagesForCompose` (4 images / 2.5 MB each / 8 MB total, re-validates ownership) | `artifacts/api-server/src/lib/reportComposer/resolveSelectedKeyImages.ts:65, 26-27, 136, 184` | **REUSE** | This is exactly the owner's "retain the maximum of four images" rule, already enforced |
| 5 | `FrozenKeyImagesRail` | `artifacts/diagnostic-erp/src/components/radiology/FrozenKeyImagesRail.tsx`, mounted at `components/radiology/workspace/ViewerColumn.tsx:618` | **EXTEND** | The rail exists and works; it has no screenshot/attach affordance in the reporting canvas |
| 6 | `aiSelectedKeyImageIds` (which images the AI will see) | `artifacts/diagnostic-erp/src/hooks/radiology-workspace/useWorkspaceClinicalUi.tsx:1400` (`useState`) | **REPAIR** | Session-only React state: a reload loses the selection, so "persisted image selection" does not hold today |
| 7 | `PACS_SCREENSHOT` source type | whitelist at `radiology-report-generator.ts:2714`; comment `lib/db/src/schema/radiologyReportGenerator.ts:168` | **EXTEND** | In the whitelist, **no producer anywhere** — the value nothing ever sends |
| 8 | `radiology_image_references` + its routes | `lib/db/src/schema/radiologyReportGenerator.ts:202`; routes `:3373-3655`; reader `artifacts/api-server/src/lib/reportImages.ts` | **REUSE (legacy, do not extend)** | A second image store that holds Orthanc references, not pixels; Stage 1 must not add to it |
| 9 | `POST /vision-trial` (admin, accepts client base64, ≤6 × 3.5 MB) | `artifacts/api-server/src/routes/reportComposer.ts:725`, UI `artifacts/diagnostic-erp/src/pages/AiReportingSettings.tsx:1554` | **REPAIR or RETIRE** | A second, ungated way to push pixels that bypasses the key-image ownership chain |
| 10 | Interactive gateway `resolveInteractiveTarget` / `executeInteractiveAiCall` | `artifacts/api-server/src/lib/ai/interactiveAiGateway.ts:78-134, 174-247` | **REUSE** | One owner for provider/model; fails closed when disabled/unconfigured (`:110-117`) |
| 11 | `classifyEffectiveLocality` | `lib/ai-providers/src/providerLocality.ts:128-198` | **REUSE** | Endpoint-derived locality; live at `index.ts:1292-1294`, `cloudImagePolicy.ts:37` |
| 12 | Hardened DNS-pinned local transport | `lib/ai-providers/src/hardenedTransport.ts:284-369, 528-544` | **REPAIR** | SSRF-safe but **cannot be aborted**: zero `signal`/`abort`/`timeout` in the file, so every caller's `AbortSignal.timeout(...)` (`index.ts:853`, `ollamaComposerAdapter.ts:70`, `index.ts:1786`) is discarded |
| 13 | `assertCloudImageEgress` + `cloudImagePolicy` | `lib/ai-providers/src/index.ts:1356-1393`; `cloudImagePolicy.ts:31-57` | **REUSE** | Default-deny, and refuses a model that is not vision-capable (`:49-55`) |
| 14 | Cloud vision door on an admin flag | `artifacts/api-server/src/lib/ai/gatewayInferenceProvider.ts:90-92, 110-118, 129` | **REPAIR** | Sends patient pixels to a named provider with **no consent step and no audit row**; Stage 1 requires local-only |
| 15 | `/egress-preview` returning real patient pixels as base64 | `artifacts/api-server/src/routes/aiReporting.ts:971-1082` (`frames` at `:1058`) | **REPAIR** | Reachable by `["admin","super_admin","doctor","radiologist"]` by default (`:188`) — it is a PHI export dressed as a preview |
| 16 | `imageDeidentification.ts` (the repo's only identifier-stripping code) | `artifacts/api-server/src/lib/imageDeidentification.ts:187, 260, 319` | **REUSE, after wiring** | **NO PRODUCTION CALLER** — the documented pixel check does not run |
| 17 | `localBurnedInOcr.ts` | `artifacts/api-server/src/lib/localBurnedInOcr.ts:87` | **REUSE, after wiring** | **NO PRODUCTION CALLER** — burned-in-label detection is decorative |
| 18 | `endpointTrustPolicy.classifyEndpointTrust` / `isEndpointTrustedForPhi` | `lib/ai-providers/src/endpointTrustPolicy.ts:75, 122` | **RETIRE** | No production caller; `classifyEffectiveLocality` (#11) is the live vocabulary. Two trust vocabularies is one too many on an egress decision |
| 19 | `gatewayPrivacy.assertGatewayPrivacy` + `pixelProof` | `artifacts/api-server/src/lib/ai/gatewayPrivacy.ts:137, 68, 223, 287` | **REPAIR** | The gate is live (`compatibleComposerAdapters.ts:116` et al.) but nothing produces a `pixelProof` outside its own test, so the posture is permanently `"not_verified"` (`:97`) |
| 20 | `DICOM_REDACTION_PERFORMED = false` | `artifacts/api-server/src/lib/dicomRedaction.ts:17`, read at `aiReporting.ts:852, 873, 1496, 1642, 1752, 1901` | **REUSE as-is** | Honest constant: redaction is genuinely not performed; it must not become `true` without #16 wired |
| 21 | Composer job engine (`ai_report_compose_jobs` over `dicom_retry_queue`) | `lib/db/src/schema/aiReportComposer.ts:58-126`; `artifacts/api-server/src/lib/reportComposer/jobService.ts:155, 378-385, 415`; consumer `cron.ts:206-238` | **REUSE** | Durable, retried, and already the draft lifecycle Stage 1 needs |
| 22 | Kind gate: 11 of 12 job kinds forced `TEXT_ONLY` with `selectedKeyImages = []` | `jobService.ts:174-197`; belt-and-braces `composeEngine.ts:288-291` | **REUSE** | Only `FULL_REPORT` may carry pixels — the vision/text separation is already the code's own doctrine |
| 23 | Two-phase durable Apply (`captureComposeBaseline`, `authoriseComposeSaveTx`, `verifyComposeDurabilityTx`) | `artifacts/api-server/src/lib/reportComposer/composePersistence.ts` (588 lines), columns via `migrations/zzzzzzzzzzzzzzzzzz_composer_persisted_baseline.sql:50, 56` | **REUSE** | Server-side CAS refuses an Apply onto a report that moved: this is the "never overwrite the radiologist" guarantee |
| 24 | Accept path `applyAccepted` → `applyAiComposerAccepted` → `saveDraft` → `POST /jobs/:id/applied` | `artifacts/diagnostic-erp/src/hooks/useReportComposer.ts:420, 525`; `store.ts:4478`; `radiology-report-generator.ts:1835`; `reportComposer.ts:298` | **REUSE** | One acceptance boundary, enforced on both sides, with client rollback on server refusal |
| 25 | Validator battery | `artifacts/api-server/src/lib/reportComposer/validateOutput.ts:332, 551, 880, 1309, 1616, 1705, 1889` | **EXTEND** | Live in the worker (`jobService.ts:562`); a failure fails the job with no partial write (`:566-581, 633`). It has **no unresolved-placeholder check** — the `{token}`/`___ mm` class the screenshots will introduce |
| 26 | `unreviewedAiGuard.checkUnreviewedAiFinalize` | `artifacts/api-server/src/lib/reportComposer/unreviewedAiGuard.ts:146` on `routes/patient-reports.ts:2122, 2518`, `routes/internal-radiology.ts:1248` | **REUSE** | Server-side, fail-closed (`:153-158`); 409 on unreviewed, 503 when state is unreadable |
| 27 | `SIGN_DENY_ROLES = {typist, ai, system, bot}` | `artifacts/api-server/src/lib/radiologyD1FinalWriter.ts:76`, enforced `:91, 113`, `patient-reports.ts:2444` | **REUSE** | AI is not a permitted signer, server-side |
| 28 | `auto_sign` must be false | `artifacts/api-server/src/lib/structuredReport/validator.ts:775-776` (R13) | **REUSE** | Invariant, not a preference |
| 29 | Vision-capability detection (three mechanisms) | `lib/ai-providers/src/index.ts:1779-1803` (`/api/show`), `builtinModelCapabilities.ts:28-60, 74-112`, `visionCapability.ts:28-116` | **REUSE** | Live consumers `composeEngine.ts:580, 585`, `modelRegistry.ts:83`, `ocrProviderResolver.ts:61, 65`; a wrong built-in row for `gemma3:12b` was corrected there from `/api/show` (`:97-111`) |
| 30 | Model A/B harness | `artifacts/api-server/src/lib/reportComposer/localVisionModelsAb.live.test.ts` (opt-in `RUN_LIVE_OLLAMA=1`, candidates `:63`) | **EXTEND** | Measures structured form, level preservation, invented measurements, image-only leakage, latency — the right criteria, missing pinned `seed` |
| 31 | `scripts/benchmark-ocr-ai.mjs` → `docs/ai-ocr/BENCHMARK_RESULTS.json` | `scripts/benchmark-ocr-ai.mjs:79` | **NOT APPLICABLE** | OCR latency/confidence on a synthetic PNG; it is not a model comparison |
| 32 | Evaluation framework (`runEvaluation`, `ai_golden_cases`, `ai_model_versions`) | `artifacts/api-server/src/lib/ai/evaluationRunner.ts:36, 42, 74-89`; `lib/db/src/schema/aiEvaluation.ts:35`; `migrations/add_ai_gateway_and_evaluation.sql:50` | **REPAIR before Stage 1 acceptance** | **NO PRODUCTION CALLER anywhere in the repo** (the only hits are inside `evaluationRunner.ts`) and **no golden-case INSERT** in `migrations/`, `seeds/` or `scripts/` → there is no promotion gate today |
| 33 | `ai_job_queue` + admin screen | `lib/db/src/schema/radiologyWorkflow.ts:107-143`; CRUD `routes/radiologyWorkflow.ts:225, 237, 267, 289`; UI `artifacts/diagnostic-erp/src/pages/AiPipelineManager.tsx:57, 63` | **RETIRE (owner decision)** | No worker; the repo's own ops check calls it informational — `lib/operationsChecks.ts:678-685` "do not treat `ai_job_queue` as the live draft path" |
| 34 | `aiScheduler.admitJob` GPU admission | `artifacts/api-server/src/lib/ai/aiScheduler.ts:120` | **REPAIR, after wiring** | Pure logic, **NO PRODUCTION CALLER** — the documented VRAM guard does not run |
| 35 | Shadow pipeline (`ai_processing_manifests`, `ai_shadow_drafts`, `ai_evidence`) | `lib/db/src/schema/aiExecution.ts:52, 91, 130`; worker `artifacts/api-server/src/lib/ai/shadowPipeline.ts:65, 116, 349, 396, 437`; registered `cron.ts:338-362` | **REUSE (Phase 4 only)** | A live writer exists — this is the correct home for future full-DICOM work, not a new table set |
| 36 | `schedulerService` night batch | `artifacts/api-server/src/lib/ai/schedulerService.ts:70, 156, 322, 352, 436, 460`; cron `cron.ts:132, 143, 153` | **DO NOT WAKE (Stage 1)** | Real code paths, real starvation conditions (§6 of the night-reporting doc); Stage 1 must not restart the night pipeline |
| 37 | `fetchStudyAiRules` | `artifacts/diagnostic-erp/src/lib/zai-workspace/types.ts:59` | **REPAIR or RETIRE** | **NO PRODUCTION CALLER** — repo-wide the only hit is its own definition |
| 38 | Content-pack YAMLs (`seeds/radiology/content-packs/v1/*.yaml`) | served read-only by `routes/radiologyContentPackTiles.ts:277, 310, 331` | **REUSE for the UI; EXTEND to the prompt** | They reach the Quick Select tiles; they never reach a Composer prompt (§8) |
| 39 | Embeddings + `POST /rag-search` | `artifacts/api-server/src/lib/ai/embeddings.ts`; route `routes/aiReporting.ts:2447`; caller `artifacts/diagnostic-erp/src/pages/AiSearchRetrieval.tsx:44` | **REPAIR** | Retrieval exists, but no prompt consumes it |
| 40 | `ai-knowledge/care-radiologist/` (Master V4, MRI modules, SHA256SUMS, `model-configuration.json`) | committed, 5 markdown files | **REFERENCE ONLY** | Read by nothing at runtime (grep `ai-knowledge` in `artifacts/`, `lib/`, `scripts/` returns nothing). The owner's rule stands: an example of desired quality, not authoritative knowledge; do not paste it into production |

---

## 3. What is already real (and load-bearing for Stage 1)

* **The screenshot has a legal home.** `POST /key-images` runs, in this order: `keyImagesLocked`
  (`:2562`) → `assertDraftWritable` with the body's `studyId`/`patientId` (`:2569`) → filename
  safety (`:2583`) → `validateStoredImage` (`:2589`) → UID shape (`:2604`) →
  `assertImageUidBelongsToDraft` when a study UID is present (`:2617`) → `verifyImageIdentityClaim`
  when series+SOP are present (`:2631-2661`) → `assertObservationBelongsToDraft` (`:2692`) →
  `normalizeKeyImageForPrint` (`:2705`). Types jpeg/png/webp (`:157-162`), 8 MiB (`:163`).
* **Images are read from disk, never from the client.** `resolveSelectedKeyImages.ts:184` and it
  re-validates ownership at `:136` against a server-resolved context (`jobService.ts:490-517`).
* **The four-image cap is already a constant, not a wish.**
  `COMPOSER_MAX_SELECTED_KEY_IMAGES` (`artifacts/api-server/src/lib/reportComposer/types.ts`) is
  enforced at `jobService.ts:207` and again in `composerContextBudget.ts:181`.
* **The prompt already subordinates pixels to the radiologist.**
  `composeEngine.ts:274-276` injects *"SELECTED KEY IMAGE METADATA (supporting evidence only;
  observations remain authoritative)"* and *"Do NOT claim complete MRI review. Absence on these
  frames is not proof of normality."* The owner's clinical rule for Stage 1 is therefore already
  shipped wording, not a new invention.
* **Identity traps are handled server-side.** `lib/imageIdentity.ts:22-28` documents the OHIF
  `/frames/1` problem (WADO-RS always ends `/frames/1` for a single-frame instance) and callers
  `radiology-report-generator.ts:2637, 3445, 3694` and `routes/radiologyAnnotations.ts:71, 81` use it.
* **AI never signs and never applies over moved text uncheckd** — §2 rows 23, 26, 27, 28, each
  server-side.

---

## 4. The screenshot entry point does not exist where it is needed

Grepped for `type="file"` under `artifacts/diagnostic-erp/src/components/radiology`: **zero hits**.

* The workspace's only image-write path today is **viewer capture**: `ViewerColumn.tsx:572` and
  `hooks/radiology-workspace/useOhifViewerBridge.ts:618` send `sourceType = VIEWPORT_CAPTURE`, and
  `PacsImagePickerDialog.tsx:133` posts to `/key-images/from-pacs` (server pulls, no bytes from the
  client). The rail's upload helper is `FrozenKeyImagesRail.tsx:607-619`.
* A real file-picker upload **does** exist — `artifacts/diagnostic-erp/src/pages/RadiologyReportGenerator.tsx:2018-2032`
  → `uploadKeyImage` (`:797-820`) → `POST /key-images` — but **that page is unrouted**
  (`src/App.tsx:142` declares the lazy const and never uses it; `src/lib/usgWorkspaceContract.test.ts:153`
  asserts its absence). So the code to upload a screenshot exists and is unreachable.
* The worklist "Attach" is not an image path at all: it posts PDF/DOCX to `/api/uploads`
  (`RadiologyWorklist.tsx:2247, 1085`).

Consequence: Stage 1's UI work is *routing an existing call into the existing canvas*, not writing
an upload subsystem.

---

## 5. Patient / study / draft linkage is enforced unevenly

`radiology_report_key_images` carries `draft_id`, `study_id`, `patient_id`, `accession_number`,
`observation_id`, `study/series/sop_instance_uid`, `created_by` (`radiology-report-generator.ts:2780`).
There are **no foreign keys** (`lib/db/src/schema/radiologyReportGenerator.ts:153-195`) and the
server does not derive patient/study from the draft — it trusts what the client sends and validates
only what is sent:

* The OHIF viewport-capture path sends **neither** `study_id` nor `patient_id`
  (`useOhifViewerBridge.ts:615-630`) → those columns stay NULL.
* The Frames path sends both (`ViewerColumn.tsx:566-571`).
* `keyImageOwnership.ts:155-162` accepts a draft-only row, and `:166-180` refuses a study-only row
  with no patient linkage.

This is the single most important Stage 1 correctness constraint: a screenshot must be bound to the
draft **server-side**, from the draft row, not from the request body — otherwise an image can be
attached to the wrong patient's report and still pass every current check.

---

## 6. Privacy and PHI-egress: what actually gates pixels today

**Enforced:** endpoint-derived locality (`providerLocality.ts:128-198`), default-deny cloud-image
policy (`cloudImagePolicy.ts:31-57`, including `MODEL_NOT_VISION_CAPABLE` at `:49-55`), DNS-pinned
hardened transport for local calls (`hardenedTransport.ts`), the locked draft guard
(`radiologyIdentity.ts:454-533`), and `DICOM_REDACTION_PERFORMED = false` reported honestly.

**Not enforced:**

* **The one live image door is admin-flag controlled**: `gatewayInferenceProvider.ts:90-92` reads
  `deepseekCloudVisionAllowed` / `cloudVisionAllowed`, `:110-118` requires images + a named provider,
  and `:129` sets `cloudVisionAllowed: true`. **No consent step, and no audit row** — grepping the
  whole `artifacts/api-server/src/lib/reportComposer/` directory for an audit insert returns nothing,
  while the interactive paths do record image sends (`aiReporting.ts:1486-1502` logs `numImages`,
  executed provider/model, and `anonymized`).
* `/egress-preview` (`aiReporting.ts:971-1082`) returns **real patient pixels** as
  `data:image/jpeg;base64,…` (`:1058`) plus byte sizes, and its caller gate is
  `canUse(req, globalSettings.allowedRoles)` (`:974`) whose default is
  `["admin","super_admin","doctor","radiologist"]` (`:188`).
* The de-identification code that would satisfy "strip identifiers before egress" has **no
  production caller** (§2 rows 16, 17), and the pixel-proof posture can never leave `"not_verified"`
  (§2 row 19).

Therefore "Stage 1 is local-only" is **not** a documentation statement — it needs PR-A: a hard
local-only rule for screenshot-sourced images, an audit row per image send, and `/egress-preview`
either removed or pixel-free.

---

## 7. Models: the measured reality, and why Qwen3-VL 8B answered empty

`localVisionModelsAb.live.test.ts:42-49` records two consecutive runs on the clinic AI PC
(192.168.1.250) at `num_ctx 4679` for one image:

| Model | Result |
| --- | --- |
| `medgemma1.5:4b` | answered in the structured form in **9.3–9.6 s**, keeping every typed level and the typed laterality |
| `gemma3:12b` | same, in **39–41 s**, and additionally volunteered an image-only L5-S1 finding that CARE's `level_change` guard then blocked |
| `qwen3-vl:8b` | **`empty_model_response` on both runs, after 66–81 s** — and it is the model CARE still names as its local vision default |

**Root cause (verified as far as the code allows):** the budget is consumed by reasoning, not by
the answer. `detectOutputBudgetExhausted` (`artifacts/api-server/src/lib/ai/providerResourceErrors.ts:34-70`)
defines exactly this shape — zero-length response with `finishReason === "length"` or
`evalCount >= numPredict` (or `>= numPredict - 1` when thinking length is known).

**Why nobody in the product sees that cause:** the detector's only consumers are the self-test and
the **overnight/shadow** policy (`aiPipelineSelfTest.ts:789`, `productionVisionPolicy.ts:192`,
reached via `gatewayInferenceProvider.ts:157, 239`). The interactive `/draft` path and the Composer
path never consult it. In the Composer the cause is destroyed *upstream of any computation*:
`providers/ollamaComposerAdapter.ts:118-125` never reads `message.thinking`, `:136-146` returns a
generic `empty_model_response`, and `:154-168` reserves `composer_output_truncated` for non-empty
text. Where a cause *is* assembled it is then collapsed: `aiFailureContract.ts:141` maps
success-with-blank-text to `EMPTY_RESPONSE` and drops the classified detail, arriving at
`aiReporting.ts:1499` as free text. `AiFailureCode` (`:29-38`) contains `EMPTY_RESPONSE` as the only
member covering an empty draft; `OUTPUT_BUDGET_EXHAUSTED` / `EMPTY_MODEL_OUTPUT`
(`RESOURCE_FAILURE_CODES:6-15`) belong to the non-interactive vocabulary.

**Benchmark constraints that decide PR-E:** actually sent today — `num_ctx`
(`lib/ai-providers/src/index.ts:695`, `ollamaComposerAdapter.ts:78`), `num_predict` (`:697`, `:81`),
`temperature` (`:696`, `:77`), `think` (`:705`, `:75`), `format:"json"` (`:74`), `keep_alive` only as
`false`/`0` (`hardenedTransport.ts:305, 309`; `ai/ollamaRunnerDiagnostics.ts:162`). **Not implemented
anywhere:** `seed`, `top_p`, `repeat_penalty` (and `mirostat`, `f16_kv`, `num_thread`). A run-to-run
reproducible comparison with Open-WebUI-style `seed: 42` is therefore impossible today; PR-E must
either add the parameter plumbing or accept repeated runs as the reproducibility control.

**HYPOTHESIS, not measured here:** VRAM pressure as the operational trigger for the empty answers,
and context-starvation orderings. One schematic A/B is not a trial; PR-E's benchmark is what turns
this into evidence. No production model setting is changed on the basis of the recorded runs above.

---

## 8. Clinical knowledge: nothing reaches the prompt

The Composer prompt is `buildCareSystemPrompt(kind, snapshot)`
(`artifacts/api-server/src/lib/reportComposer/persona/index.ts:24`, assembled from MASTER + STYLE +
SAFETY + modality addenda at `router.ts:102-113`, versioned constant `router.ts:36`), called at
`composeEngine.ts:652` and `:754`; the user half is `buildUserPrompt` (`composeEngine.ts:245`) →
`buildRadiologistDraftContext` (a pure projection of the frozen snapshot: study identity, history,
observations, canal AP) plus the key-image metadata block (`composeEngine.ts:264-277`).

**No knowledge source is in that chain.** `fetchStudyAiRules` has no caller (§2 row 37); the 28
content-pack YAMLs are served to the SPA's tiles only (`routes/radiologyContentPackTiles.ts:277, 310, 331`);
embeddings are consumed only by `POST /rag-search` (`routes/aiReporting.ts:2447`) whose only caller is
the retrieval page (`pages/AiSearchRetrieval.tsx:44`). The staged `ai-knowledge/care-radiologist/`
assets are read by nothing. This is the owner's own rule respected: the Open WebUI CARE RADIOLOGIST
assistant and Master V4 are **reference assets**, and Stage 1 must not blind-import them — but it
does mean "examination-specific reporting knowledge" (§C item 4 of Stage 1) is currently an empty
capability, and PR-D/PR-E must decide whether it is filled by the content packs or not at all.

---

## 9. Composer integration points a screenshot draft must pass through

| Seam | File:line | What Stage 1 must do with it |
| --- | --- | --- |
| Enqueue | `jobService.ts:155` behind `POST /api/radiology/report-composer/jobs` (`routes/reportComposer.ts:140`, permission `ai_reporting.use` `:125-130`) | Reuse; add a screenshot-origin kind or flag, not a new queue |
| Durable lane | `enqueueRadiologyJob` (`jobService.ts:378-385`) over `dicom_retry_queue` (`lib/db/src/schema/risMonitoring.ts:14`) | Reuse |
| Worker | `processComposeJob` (`jobService.ts:415`) → `lib/radiologyJobHandlers.ts:294-300` → `startAiReportComposeJobConsumer` (`cron.ts:206-238`, bootstrapped `index.ts:2883`, runs regardless of `ENABLE_SCHEDULERS`) | Reuse |
| Pixels gate by kind | `jobService.ts:174-197`; `effectiveAiMode` `composeEngine.ts:288-291` | Only `FULL_REPORT` may carry pixels — keep |
| Image resolution | `composeEngine.ts:553` → `resolveSelectedKeyImages.ts:65` | Reuse; the four-image cap lives here |
| Model selection | `composerTaskKeys` `composeEngine.ts:308-320`; model pick `:570-577`; capability check `:580, 585` | Reuse — vision and text are already separate models |
| Baseline capture | `composePersistence.ts:captureComposeBaseline:267`, token `:160`, bound at `jobService.ts:307-374` | Reuse |
| Freshness | `evaluateJobFreshness` `jobService.ts:723`; `STALE_READY` refuses apply `:840-846` | Reuse |
| Apply | `useReportComposer.ts:420 → 525` → `store.ts:4478` → `saveDraft` → `radiology-report-generator.ts:1835` (`authoriseComposeSaveTx` + `recordComposeReceiptTx`) → `POST /jobs/:id/applied` (`reportComposer.ts:298`) → `markComposeApplied` (`jobService.ts:794`, CAS `READY→APPLIED` at `:952-981`) | Reuse — this is the "no intermediate approval, but never overwrite" path |
| Per-change accept | `ReportComposerAssistant.tsx:129` (Accept), `:374` (compose), `:567-571` gated by `canApply` `:181` | Reuse; the radiologist edits in the normal editor afterwards |
| Validation | `validateOutput.ts:1889` via `jobService.ts:562`; failure → `FAILED`, no READY draft (`:566-581`) | Extend: unresolved-placeholder check |
| Finalize | `unreviewedAiGuard.ts:146` at `patient-reports.ts:2122, 2518`; `radiologyD1FinalWriter.ts:76/91/113` | Reuse, unchanged |

**Correction to a prior belief, recorded so nobody re-derives it:** `insertTarget` is **not** the
Composer's acceptance boundary. Server-side it has zero references; it belongs to the Copilot /
LegacyBox surfaces (`components/radiology/LegacyBox.tsx:229-230`, `CareCopilotPanel.tsx:126`,
`LocalAiPanel.tsx:67`, `NeuroPromptPanel.tsx:209`). The Composer boundary is `composePersistence.ts`
(§2 row 23).

**Provenance durability, measured:** the sentence-level `fieldProvenance` map is written into the
store when AI text is applied (`store.ts:4508-4515`, source `"ai-draft"`, label "AI Draft" at
`reportFieldMerge.ts:38, 77, 96`, badge at `reporting-canvas/ObservationLedgerPanel.tsx:222`) but it
is **not part of what the draft save persists** — `useDraftPersistence.ts:290-336` extracts the
ledger, viewer measurements, canal-AP provenance, spine and vascular state from `structuredJson`, and
`fieldProvenance` appears only at `:259` inside the **different-patient refusal wipe** (that reset is
correct behaviour, not a bug). On reload, `store.ts:3681` uses
`parsed.fieldProvenance ?? reconstructProvenanceFromLedger(...)`, and that reconstructor
(`observationLedger.ts:538-550`) can only emit ledger-derived sources or `"template"`. **So an
AI-derived sentence that is not backed by a ledger row reads as "template" after a reload.** Stage 1
requirement D ("preserve existing provenance") therefore needs either the map persisted or the
image-derived findings written as ledger observations — and the second is the better answer, because
the ledger is the one record every later door consults.

---

## 10. AI gateway and model routing map (the live paths only)

* **Interactive surface** (`/draft`, `/polish`, `/image-review`):
  `routes/aiReporting.ts:1201, 1337 / 1615, 1629 / 1704, 1738` and `routes/radiologyOllama.ts:867, 872`
  → `interactiveAiGateway.ts:78` resolve → `:174` execute. `InteractiveCallOptions` (`:137-142`) has
  **no timeout field** — locality and timeout are read *back* from `result.execution` (`:216, 238-241`),
  so the gateway is not the timeout owner. `numCtx`/`think`/`endpointUrl` are passed only when
  `provider === "ollama"` (`:201, 207-213`).
* **Composer surface:** `composeEngine.ts` resolves through `resolveTaskRoute`
  (`lib/ai-providers/src/index.ts:1665-1675`) over `ai_model_routes` (`lib/db/src/schema/aiModelRoutes.ts:15`).
  Two settings drive two roles: `ollama_model` → vision (`voiceReportComposer/runtimeConfig.ts:77, 94-95`;
  schema `lib/db/src/schema/clinicSettings.ts:248`) and `ollama_composer_model` → text (`:56, 71`; schema `:260`).
* **Transport:** two live `/api/chat` POSTs (`index.ts:847-854` single attempt, timeout from
  `resolveRequestTimeoutMs` `:68-78`; `ollamaComposerAdapter.ts:65-86`). `/api/generate` survives only
  in the self-test probe (`aiPipelineSelfTest.ts:449`) and model unload (`ollamaRunnerDiagnostics.ts:156`).
  Retry is `gateway.ts:87` `maxAttempts ?? 2` over a capability chain; the overnight path sets
  `maxAttempts: 1` (`gatewayInferenceProvider.ts:217`).
* **`selected_image_vision` is not a column or a row flag** — it is a task-route key
  (`lib/ai-providers/src/index.ts:1532`; consumed `composeEngine.ts:312`). Any plan that treats it as
  stored state is wrong.

---

## 11. OHIF / viewer gaps for Stage 1

Verified from the ERP side at `6b64b2f0`:

* The viewer's own capture already writes key images (`ViewerColumn.tsx:572`,
  `useOhifViewerBridge.ts:618`, `VIEWPORT_CAPTURE`) — the review-after-draft step the owner wants is
  **already wired for images**, and the deep link exists (`artifacts/api-server/src/lib/ai/interop/viewerDeepLinks.ts`).
* The capture path does **not** send `study_id`/`patient_id` (§5) — fix in PR-B.
* `aiSelectedKeyImageIds` is session-only (§2 row 6) — the "persisted image selection" the owner asks
  for in PR-B does not hold today.
* care-pacs is at `247f0cc` on its remote while this audit's baseline was `53588a0`; the eleven
  intervening commits include the viewer-side identity work (`7f8e3c6` "name the image on screen from
  the object rendered", `d9a3eb9` "expose OHIF services as a live accessor, not a bundle-time
  snapshot") and ERP-sync durability (`ddef581`, `247f0cc`). Any PR touching the viewer↔ERP bridge
  must be measured against `origin/main`, not `53588a0`.

The care-pacs-side inventory (viewport capture primitives, Orthanc/OHIF reachability, DICOM-SR and
key-object-image handling, MWL identity chain) is carried in
`STAGE1-AI-SCREENSHOT-REPORTING-ARCHITECTURE.md` §B, which was written against `247f0cc`.

---

## 12. Three documentation overclaims corrected by this PR

| Claim, as written | What the code does | Where corrected |
| --- | --- | --- |
| `IMPLEMENTATION_TRACKER.md:15` — G8 "Evaluation Framework + Golden Dataset" **✅ Done**; `:35` "P2 — Trust: ✅ Complete (G7, G8, G9)"; `P2_IMPLEMENTATION_REPORT.md:16` — Evaluation ✅ with a "shadow → candidate → live lifecycle with a human approval gate" | `runEvaluation` (`artifacts/api-server/src/lib/ai/evaluationRunner.ts:36`) has **no caller anywhere in the repository**; `ai_golden_cases` has **no INSERT** in `migrations/`, `seeds/` or `scripts/`; there is **no editing UI** for `ai_golden_cases`, `ai_evaluation_runs` or `ai_model_versions`. Tables + a pure metrics module + an unreferenced runner. | both files, marked **NOT WIRED** |
| `07-orchestration-and-night-processing.md` reads as a description of a running engine — exponential backoff with `maxAttempts = 5` (`:63`), dead-letter view (`:65`), VRAM-aware admission (`:77`), bounded STAT preemption (`:115`), emergency paging (`:117`), and `:162` "It **does**: give `ai_job_queue` a real worker … make warm-pools, VRAM admission and single-flight real" | `ai_job_queue` has no worker (CRUD only, `routes/radiologyWorkflow.ts:225-289`; the ops check calls it informational, `lib/operationsChecks.ts:678-685`); `aiScheduler.admitJob` (`lib/ai/aiScheduler.ts:120`) has no production caller; there is no preemption and no warm pool in the runtime. The doc's own line 1 already says "Today there is *no engine*" — the closing "It does" contradicts its own opening. | `07` — status banner added; `:162` restated as design intent |
| `15-security-model.md:28` — "nothing in the tamper-evident spine is ever hard-deleted — 'retention end' means *de-identification or access-sunset*, never destructive erasure", with `:32` "PostgreSQL, no-delete" | `cron.ts:865 scheduleAuditLogPurge` runs daily at 03:00 with `RETENTION_DAYS = 730` (`:875`) and **deletes** the archived rows from `audit_logs`. It does archive first, gzip + SHA-256, deleting only the ids it durably wrote (`:882-907`, a fixed prior bug that used to destroy an unarchived backlog) — so records survive as **files**, not in the database, and only the last 730 days are queryable. Separately, image sends on the Composer path write **no audit row at all** (§6). | `15` — the A1.1 matrix row and the doctrine sentence corrected |

Nothing else in those documents was rewritten; the architecture, data model and design reasoning are
preserved as authored. The night-reporting architecture (`07`), the image-upload infrastructure (§3),
the Composer integration points (§9), the gateway and routing map (§10) and the clinical-knowledge
findings (§8) are all kept, because the future full-DICOM platform still needs them.

---

## 13. Decisions the owner still owes before Stage 1 is implemented

1. **Which model interprets.** Measured candidates: `medgemma1.5:4b` (fastest, form-correct),
   `gemma3:12b` (correct, slow, volunteered an image-only level that a guard had to block),
   `qwen3-vl:8b` (empty twice, and it is the current default name). Recommendation: keep 14B as the
   reporting benchmark, decide vision from PR-E's benchmark, and stop naming a model that returns
   empty as the default only after that benchmark confirms the replacement.
2. **Are image-derived findings provisional proposals or direct draft text?** Stage 1 says no
   mandatory intermediate approval before the draft exists — which the existing `FULL_REPORT` job
   already satisfies. The open question is whether an *image-derived* observation should also become a
   ledger row (recommended: yes, so it is attributable, withdrawable and restorable like every other
   observation — see #174's doors) or only narrative text (which loses provenance on reload, §9).
3. **Does cloud vision survive at all** for screenshot-origin images? If Stage 1 is local-only,
   PR-A should make the flag unable to open for that source type rather than merely unused.
4. **Retire the `ai_job_queue` admin screen** (`AiPipelineManager.tsx`) and the unreferenced
   `endpointTrustPolicy`? Both are currently capable of misleading an operator.
5. **What fills "examination-specific reporting knowledge"** in the prompt — the reviewed content
   packs, or nothing until they are reviewed? (§8)

---

## 14. How to re-verify this audit

```
# one production caller?
grep -rn "runEvaluation" --include=*.ts artifacts lib          → evaluationRunner.ts:36 only
grep -rn "fetchStudyAiRules" --include=*.ts artifacts lib      → types.ts:59 only
grep -rn "deidentifyImagesForCloudEgress" artifacts lib        → definition + tests only
grep -rn "ai_golden_cases" migrations seeds scripts            → CREATE TABLE only
grep -rn "seed:" --include=*.ts lib artifacts/api-server/src   → empty
grep -rn "type=\"file\"" artifacts/diagnostic-erp/src/components/radiology  → empty
sed -n '860,910p' artifacts/api-server/src/cron.ts             → 730-day purge, archive-before-delete
```

Live model A/B (operator-run, one schematic, not a trial):
`RUN_LIVE_OLLAMA=1 pnpm vitest run artifacts/api-server/src/lib/reportComposer/localVisionModelsAb.live.test.ts`
