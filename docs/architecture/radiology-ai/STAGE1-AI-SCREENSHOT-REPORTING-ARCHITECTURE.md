# Stage 1 — screenshot-assisted AI reporting: canonical architecture

**Status: architecture and plan only. Nothing in this document is implemented, and no runtime file
was changed.** Every component named as *reused* was read at `origin/main 6b64b2f0`; line numbers are
from that commit. The evidence behind the claims is
`docs/architecture/radiology-ai/AI-SCREENSHOT-WORKFLOW-REUSE-AUDIT.md` (submitted as PR #1073).

```
radiologist attaches screenshots in the EXISTING workspace
        ↓  POST /key-images  (existing route, existing guards)
radiology_report_key_images + disk    (existing table + frozen storage)
        ↓  selection persisted on the draft   ← NEW, small
"Generate AI Report"  (one click)
        ↓  enqueueComposeJob kind=FULL_REPORT  (existing)
resolveSelectedKeyImagesForCompose → capability check → VISION model   (existing, live)
        ↓  one model call produces the complete draft   (existing)
validateComposerOutput → READY proposal → ReportComposerAssistant   (existing)
        ↓  Apply  (existing two-phase durable, server-authorised apply)
the same findings/impression editor + observation ledger   (existing)
        ↓  radiologist reviews the full study in OHIF, edits, then signs by hand
```

## 0. The contract this architecture must not break

1. **One reporting surface.** The draft lands in the `ReportComposerAssistant`
   (`artifacts/diagnostic-erp/src/components/radiology/ReportComposerAssistant.tsx:168`) and is edited
   in the existing findings/impression editor. No second Composer, no AI-only editor, no second
   report store, no second finalization path.
2. **One ledger.** `appliedPathologyPatches` (`store.ts:385`) remains the only record of what the
   report asserts. Ruling #175 §C R-7 and the reporting-engine dependency map both make this an
   invariant; image-derived findings therefore become **ledger observations**, not loose prose.
3. **No mandatory intermediate approval.** One click produces the whole draft. The existing job kinds
   already enforce the split: 10 of the 11 kinds (`AI_COMPOSE_JOB_KINDS`,
   `lib/db/src/schema/aiReportComposer.ts:27-54`) are forced `TEXT_ONLY` with their selected images
   cleared (`jobService.ts:174-197`, re-checked at `composeEngine.ts:288-291`), and only `FULL_REPORT`
   may carry pixels — so "vision then drafting" is one job, not a gate the radiologist must clear.
4. **The draft is always editable and unsigned.** AI cannot sign, server-side:
   `unreviewedAiGuard.checkUnreviewedAiFinalize` (`artifacts/api-server/src/lib/reportComposer/unreviewedAiGuard.ts:146`)
   runs on both finalize routes (`routes/patient-reports.ts:2122, 2518`) and
   `SIGN_DENY_ROLES = {typist, ai, system, bot}` (`lib/radiologyD1FinalWriter.ts:76`, enforced `:91, 113`);
   `auto_sign` must be `false` (`lib/structuredReport/validator.ts:775-776`).
5. **Mode A is not modified to accommodate this.** The instant report pass stays as shipped
   (default-on unless `care.instantReport.modeA.enabled === "0"`, `instantReport.ts:159`), and the
   signed-report guards stay as shipped: all four whole-report doors refuse on a signed report through
   the single witness `refuseSignedMutation` (`store.ts:533`, called at `:1930`, `:2407`, `:2687`,
   `:4597`), and the strip is already gated by `disabled={contentLocked}`
   (`components/radiology/workspace/ReportCanvas.tsx:1659-1665`).
6. **Local-only for patient images in Stage 1.** Not a policy note — see §F for the three code changes
   that make it true.

## A. Screenshot input — reuse, and the two things that must change

**Reused unchanged:**

| Existing component | Location | Why it is enough |
| --- | --- | --- |
| `POST /key-images` (multipart `image`; jpeg/png/webp; 8 MiB) | `artifacts/api-server/src/routes/radiology-report-generator.ts:2540-2796`, types `:157-162`, size `:163` | A screenshot upload is already a legal, guarded write |
| Guard chain | `keyImagesLocked:2562` → `assertDraftWritable:2569` → filename safety `:2583` → `validateStoredImage:2589` → UID shape `:2604` → `assertImageUidBelongsToDraft:2617` → `verifyImageIdentityClaim:2631-2661` → `assertObservationBelongsToDraft:2692` | Ownership and locked-draft checks exist; PR-B widens one of them (§A.2) |
| `radiology_report_key_images` | `lib/db/src/schema/radiologyReportGenerator.ts:153-195` | Already the table the Composer reads — no new table |
| Frozen disk storage | `artifacts/api-server/src/lib/frozenKeyImages.ts:33-34` (dir + URL prefix), `:39-40` (max edge 1800 px, JPEG q85), `:93-147` (`normalizeKeyImageForPrint`: autorotate, resize, JPEG re-encode in place); thumb written by `routes/radiology-report-generator.ts:257-271` (240 px, q80) | Normalisation happens once at write time, on local disk, with no object-store dependency |
| `FrozenKeyImagesRail` | `artifacts/diagnostic-erp/src/components/radiology/FrozenKeyImagesRail.tsx`, upload helper `:607-619` | The rail already renders, selects and uploads |
| `/key-images/from-pacs` | `radiology-report-generator.ts:3659`, writes `source_type=DICOM` at `:3792` | When the study is in Orthanc, **this is the better source**: the server pulls the pixels, no client bytes, identity verified |

**A.1 Add the attach control to the existing canvas, do not add a page.**
There is no file input anywhere under `components/radiology` (grepped `type="file"`: zero hits). The
only real picker is `src/pages/RadiologyReportGenerator.tsx:2018-2032` → `uploadKeyImage` (`:797-820`),
and that page is unrouted (`src/App.tsx:142` declares the lazy import and never uses it;
`src/lib/usgWorkspaceContract.test.ts:153` asserts its absence). So the change is to surface the
already-written call inside the reporting workspace — the rail's own `uploadFrozenKeyImage`
(`FrozenKeyImagesRail.tsx:607-619`), which the viewer column already uses
(`ViewerColumn.tsx:588`) — with `sourceType: "PACS_SCREENSHOT"`, a value that is whitelisted at
`:2714` and sent by **nothing today**.

**A.2 Bind the screenshot to the draft server-side, not from the request body.**
Today the row-identity columns `study_id`/`patient_id` are validated only when the client volunteers
them, and neither capture path volunteers them reliably: the OHIF annotated-capture path appends DICOM
UIDs when the bridge message carries them (`studyInstanceUID`/`seriesInstanceUID`/`sopInstanceUID`/
`frameNumber`) but **no `studyId`/`patientId` at all**
(`hooks/radiology-workspace/useOhifViewerBridge.ts:615-628`), and the frames path appends both only
`if (reportIdentity?.…)` (`ViewerColumn.tsx:563-571`, lines 566 and 569 are the guards) — so on any
draft whose identity has not resolved, the columns stay NULL and the image is bound to nothing but a
`draftId`. There are no foreign keys (`schema:153-195`) and the server never derives patient/study from
the draft row. Requirement: for screenshot-origin uploads the server resolves
`draft_id → study_id, patient_id, accession_number` itself and refuses any body-supplied value that
disagrees. Without this, a screenshot can be attached to the wrong patient's report and pass every
current check — the one defect class this platform has already closed for text (#834 study isolation)
must not be re-opened for images.

**A.3 Persist the AI image selection.** `aiSelectedKeyImageIds` is React session state
(`useWorkspaceClinicalUi.tsx:1400`, refs built `:1551-1566`, fed to the composer `:1593-1594`), so a
reload silently changes what the next draft will see. Persist it with the rest of the draft's
workspace slices — the existing pattern is `structuredJson` + an `extractCare*` reader
(`useDraftPersistence.ts:290-336`), which needs **no migration**. Adding a column is the alternative
and would require a forward-only `migrations/*.sql` (never `db:push`).

**Identity and provenance of an image.** A pasted screenshot has no machine identity: care-pacs contains
**no viewport-capture code at all** (zero hits for `getCaptureImage` / `toDataURL` /
`canvas.toBlob` / `kikulus` / `screenshot`; the only mentions are an operator instruction "a screenshot
is fine" and a documented deferred capture request in `docs/CARE_OHIF_MEASUREMENT_BRIDGE.md:144`), and
the OHIF↔CARE bridge moves **identity, never pixels** — `care-displayed-image.js` emits
Study/Series/SOPInstanceUID (and `frameNumber` only when the imageId names one) by `postMessage`, and
`care-security.js:26` forbids a `pixelData` key. Stage 1 therefore records what it can honestly claim:
`source_type=PACS_SCREENSHOT`, the capturing user, the timestamp, the draft it was dropped onto, and
the image hash — and does **not** imply the pixels came from a verified DICOM instance. Where a true
instance identity is required, use `/key-images/from-pacs` instead of a screenshot.

## B. Image interpretation — the vision leg is already live

Do not build it. Trace on `6b64b2f0`:
`enqueueComposeJob` (`jobService.ts:155`) → `processComposeJob` (`:415`) →
`runReportComposer` (`composeEngine.ts`) → `resolveSelectedKeyImagesForCompose`
(`composeEngine.ts:553` → `resolveSelectedKeyImages.ts:65`), which reads from **disk** (`:184`) and
re-validates ownership (`:136` → `keyImageOwnership.ts:66`) against a server-resolved context
(`jobService.ts:490-517`) → capability check `assertVisionCapableModel` (`composeEngine.ts:580, 585`
using `visionCapability.ts:28-116`, which queries Ollama `/api/show` capabilities at
`lib/ai-providers/src/index.ts:1779-1803`) → model call with images attached
(`providers/ollamaComposerAdapter.ts:60-62`) over the DNS-pinned hardened local transport (`:65-86`).

* **Four images stays the limit.** `COMPOSER_MAX_SELECTED_KEY_IMAGES` is enforced at
  `jobService.ts:207` and again in `composerContextBudget.ts:181`; per-image 2.5 MB and total 8 MB at
  `resolveSelectedKeyImages.ts:26-27`. Stage 1 changes none of these.
* **No automatic whole-study processing** in Stage 1: no series enumeration, no frame batch, no
  scheduler wake. The night engine stays asleep (§J).
* **Preprocessing is already done once,** at write time (`frozenKeyImages.ts:93-147`), so the vision
  call sees the same normalised bytes the rail shows.

## C. Report generation — one action, one draft, four clinical rules

**One button.** "Generate AI Report" calls the existing enqueue path
(`src/lib/reportComposer/api.ts:36` → `hooks/useReportComposer.ts:361`, wired at
`useWorkspaceClinicalUi.tsx:1579`, rendered in `ReportingToolsRail.tsx:1143`) with
`kind = FULL_REPORT` and the selected screenshot ids. Internally it is still vision-then-drafting
inside a single model call; the radiologist approves nothing in between.

**Authority order, and who enforces each rung:**

| Rank | Source | Enforced by |
| --- | --- | --- |
| 1 | Radiologist-authored findings/impression | `isProtectedManualSentence` (`artifacts/diagnostic-erp/src/lib/pathologyPatch.ts:197-207`, sources `manual`/`radiologist-voice`), `refuseSignedMutation` (`store.ts:533`), and the apply-time CAS in `composeSaveAuthorisation` / `authoriseComposeSaveTx` (`composePersistence.ts:360, 401`) which refuses when the report moved |
| 2 | Accepted ledger observations and measurements | the prompt projection `buildRadiologistDraftContext` (typed observations, canal AP) + `detectDroppedObservations` / `observation_dropped` (`validateOutput.ts:1616, 1659`) |
| 3 | AI image-derived suggestions | prompt wording already shipped: *"supporting evidence only; observations remain authoritative"* and *"Do NOT claim complete MRI review. Absence on these frames is not proof of normality"* (`composeEngine.ts:274-276`) + `pruneUngroundedObservationRows` (`:1705`) |
| 4 | Approved examination knowledge | **nothing today** — no knowledge source reaches the prompt (§H of the audit). Either PR-D wires content packs or Stage 1 proceeds without rank 4, stated honestly |
| 5 | Generic report formatting | persona (`reportComposer/persona/index.ts:24`, `router.ts:102-113`) |

**Provisional, not applied.** Image-derived sentences are labelled and are **written as ledger
observations** (source `ai-draft`, `reportFieldMerge.ts:38, 77, 96`; badge
`reporting-canvas/ObservationLedgerPanel.tsx:222`) rather than as bare narrative. This is required, not
stylistic: `fieldProvenance` is **not persisted by the draft save** (`useDraftPersistence.ts:290-336`
extracts ledger/measurements/canal/spine/vascular but not provenance), and hydration falls back to
`reconstructProvenanceFromLedger` (`store.ts:3681` → `observationLedger.ts:538-550`), which can only
emit ledger-derived sources or `"template"`. Narrative-only AI prose therefore **loses its AI
attribution on reload**; a ledger row does not.

**The three-way clinical distinction the draft must keep.** The system already has the parts to say
"abnormality demonstrated" vs "no abnormality identified in adequately visualized anatomy" vs "anatomy
or sequences not sufficiently evaluated": the prompt's own "absence on these frames is not proof of
normality" rule (`composeEngine.ts:276`), the screening-limitation concept already modelled in the
catalogue (`screening_limitation` baseline slots, and ruling #937's ownership work), and the supersession
rule that forbids printing a whole-study normal over a recorded abnormality
(`normalClaimSupersededBy` / `sentenceOwnedBySlot`, PR #1071). Stage 1 must reuse those, and PR-D must
not let the drafter invent normals for anatomy the images do not show — enforced as a validator rule,
not as a prompt wish.

**Unsupported claims are already blocked, and this is where the battery extends.**
`validateOutput.ts` refuses definite mutations (`detectDefiniteClinicalMutations:332` —
`measurement_mutation:368`, `laterality_swap:414`, `level_change:424`, `severity_escalation:456`),
canal divergence (`:551`), conservation loss (`:880` — measurement/level/laterality/severity/morphology/
location dropped, grade changed, section dropped), relation loss (`:1309`) and dropped observations
(`:1616`); a failure fails the job with **no partial write** (`jobService.ts:566-581, 633`). Missing
and required for screenshots: an **unresolved-placeholder check** (`{token}`, `___ mm`) — there is none
in this validator today, though the same class was closed on the Quick Select path by PR #1057.

## D. Composer integration — what is reused verbatim

| Seam | Existing code | Stage 1 |
| --- | --- | --- |
| Enqueue | `jobService.ts:155`, route `POST /api/radiology/report-composer/jobs` (`routes/reportComposer.ts:140`, permission `ai_reporting.use`) | unchanged |
| Durability lane | `enqueueRadiologyJob` (`jobService.ts:378-385`) over `dicom_retry_queue` (`lib/db/src/schema/risMonitoring.ts:14`) | unchanged — no new queue |
| Worker | `startAiReportComposeJobConsumer` (`cron.ts:206-238`, bootstrapped `index.ts:2883`) | unchanged |
| Baseline/freshness | `captureComposeBaseline` (`composePersistence.ts:267`), bound at enqueue (`jobService.ts:307-374`), `evaluateJobFreshness` (`:723`), `STALE_READY` refuses apply (`:840-846`) | unchanged |
| Apply | `applyAccepted` (`useReportComposer.ts:420`) → `applyAiComposerAccepted` (`store.ts:4478`) → `saveDraft` → `authoriseComposeSaveTx` + `recordComposeReceiptTx` (`radiology-report-generator.ts:1835`) → `POST /jobs/:id/applied` (`reportComposer.ts:298`) → `markComposeApplied` (`jobService.ts:794`, CAS `READY→APPLIED` `:952-981`) | unchanged |
| Review UI | `ReportComposerAssistant.tsx:374` (compose), `:129` (per-change accept), `:567-571` gated by `canApply:181` | unchanged; screenshots appear in the rail it already reads |
| Save/reload | `hydrateObservationLedger` (`store.ts:3659-3730`), re-derives `stale` per row and preserves `protected` | unchanged |
| Finalize | `finalizeSafety.ts:51/96` + `aiFinalizeGate.ts:29` client-side, `unreviewedAiGuard.ts:146` server-side | unchanged |
| Print/PDF | `buildLivePrintBodyHtml` (`radiologyReportPrintLiveMerge.ts:117`) used for both the live preview and the signed artifact (`buildSignedReportBodyHtml:201-215`, called from `useStudyFinalize.ts:434`), server template `reportPresentation.ts:572` | unchanged |

**Correction recorded so the plan does not rest on it:** `insertTarget` is **not** the Composer
acceptance boundary (zero server references; it belongs to `LegacyBox.tsx:229-230`,
`CareCopilotPanel.tsx:126`, `LocalAiPanel.tsx:67`, `NeuroPromptPanel.tsx:209`). The boundary is
`composePersistence.ts`.

## E. Model routing — two roles, one benchmark

Two settings already name two roles: `ollama_model` → vision
(`voiceReportComposer/runtimeConfig.ts:77, 94-95`; schema `lib/db/src/schema/clinicSettings.ts:248`)
and `ollama_composer_model` → report writer (`:56, 71`; schema `:260`), consumed through task routes
`selected_image_vision` / `report_composer` (`composeEngine.ts:308-320`, resolved by
`resolveTaskRoute`, `lib/ai-providers/src/index.ts:1665-1675` over `ai_model_routes`).
`selected_image_vision` is a **task-route key, not a column** — any plan that stores state on it is wrong.

* **Do not hardcode a vision model.** `qwen3-vl:8b` is currently named as the local default yet returned
  `empty_model_response` on both recorded A/B runs (66–81 s), while `gemma3:12b` answered in 39–41 s and
  `medgemma1.5:4b` in 9.3–9.6 s (`localVisionModelsAb.live.test.ts:42-49`). The cause is **not**
  established, and now we can say why it cannot be: the adapter returns on empty text
  (`ollamaComposerAdapter.ts:136-146`) *before* the `done_reason === "length"` branch at `:154-167` and
  without carrying `done_reason`, and the A/B harness prints `safeError`/`detail` but not `usage`
  (`localVisionModelsAb.live.test.ts:252`) — so the one field that would separate "spent the budget
  reasoning" from "refused" is dropped at both ends. `think: false` **is** already sent (`:75`), which
  removes the simplest explanation without replacing it. PR-E recovers the field before any model choice.
* **Keep Qwen3 14B as the reporting benchmark candidate**; do not replace it without measured advantage.
* **Open WebUI assets are reference only.** `ai-knowledge/care-radiologist/` (Master V4, MRI modules,
  SHA256SUMS) is read by nothing at runtime; it stays an example of desired quality until reviewed.
* **Benchmarking cannot pin its own parameters today:** `num_ctx`, `num_predict`, `temperature`,
  `think`, `format` are sent (`index.ts:695-705`, `ollamaComposerAdapter.ts:77-81`) but `seed`, `top_p`
  and `repeat_penalty` appear nowhere in the repo. PR-E adds them or states repeated runs as the
  reproducibility control.

## F. Security — the three changes that make "local-only" true

1. **Close the cloud door for screenshot-origin images.**
   `artifacts/api-server/src/lib/ai/gatewayInferenceProvider.ts:90-92` reads
   `cloudVisionAllowed` from ops settings, `:111-118` opens the cloud arm when that flag, images and a
   named provider (`ab`/`deepseek`/`qwen`/`openai`) all line up, and `:129` re-passes
   `cloudVisionAllowed: true` into the call. Two reachable callers put pixels through it:
   the scheduled shadow worker (`cron.ts:338-362` → `lib/radiologyJobHandlers.ts:290`), and the
   admin-triggered pipeline self-test (`routes/radiologyOllama.ts:1028` →
   `aiPipelineSelfTest.ts:1857`, which passes `imageData: img.jpegBase64`). Neither writes an audit row.
   Stage 1 makes the flag unable to open for `source_type ∈ {PACS_SCREENSHOT, UPLOAD}` — a policy
   branch, not a new engine — and keeps `assertCloudImageEgress`
   (`lib/ai-providers/src/cloudImagePolicy.ts:31-57`) as the default-deny gate.
2. **Make every image send auditable on the Composer path.** The interactive paths already log
   `numImages`, executed provider/model and `anonymized` (`routes/aiReporting.ts:1486-1502`);
   `artifacts/api-server/src/lib/reportComposer/**` writes **no audit row at all**. PR-A adds that one writer, recording study
   and draft identity, image ids or hashes, model+provider, locality, image count, prompt/config version,
   outcome and timing — and never the pixels or the prompt text.
3. **`/egress-preview` must stop returning patient pixels.** `routes/aiReporting.ts:1058` currently hands back
   `data:image/jpeg;base64,…` frames, and its gate defaults to
   `["admin","super_admin","doctor","radiologist"]` (`:974`, roles at `:188`). Either make it metadata-only or
   restrict it to `super_admin` with an audit row.

Also required, all small and local to this plan: **honour the abort signal** —
`lib/ai-providers/src/hardenedTransport.ts` contains zero occurrences of `signal`, `abort` or `timeout`
(grep count 0), so the `AbortSignal.timeout(…)` it is handed at `lib/ai-providers/src/index.ts:853`, the
`signal:` at `providers/ollamaComposerAdapter.ts:70` and the vision probe's own `AbortController`
(`index.ts:1784-1790`) are all discarded; retire
`endpointTrustPolicy.classifyEndpointTrust`/`isEndpointTrustedForPhi` (`lib/ai-providers/src/endpointTrustPolicy.ts:75, :122`, no production
caller) so exactly one trust vocabulary gates egress; and either wire `imageDeidentification.ts:187/260/319`
+ `localBurnedInOcr.ts:87` (both `artifacts/api-server/src/lib/ai/`) or stop describing them as a pixel check. `DICOM_REDACTION_PERFORMED = false`
(`lib/ai/dicomRedaction.ts:17`) stays false and stays reported. Existing PHI, authorization, image-ownership and
SSRF protections are not weakened anywhere in this plan.

## G. OHIF review step

The post-draft review is the existing viewer launch, unchanged: `viewerDeepLinks.ts` for the launch,
`EmbeddedWadoViewer` + the anchor rail for provenance, and the displayed-image identity bridge
(`care-displayed-image.js` → Study/Series/SOP, `frameNumber` only when the imageId names one).
Two known bridge weaknesses are recorded, not fixed by Stage 1: `care-bridge.js:44-72` still answers
`care.viewer.context` from **launch-URL params**, giving two divergent identities for one viewport, and
AccessionNumber never reaches OHIF (only `?StudyInstanceUIDs=`, `care-bridge.js:53-60`). Orthanc is
reachable and unauthenticated on this network (`orthanc.json:7 AuthenticationEnabled: false`, CORS `*`,
port published `docker-compose.yml:71`) — an accepted owner risk, not to be re-raised, but the reason
Stage 1 must not pretend an Orthanc fetch is an authorization boundary.

## H. What Stage 1 explicitly does not do

No new reporting engine, Composer, ledger, catalogue or finalization path. No automatic DICOM study
processing, no series enumeration, no frame batching, no multi-slice analysis. No wake of the night
pipeline (`schedulerService.runNightBatch:352` stays as-is), no `ai_job_queue` worker, no re-enable of
`ff_radiology_ai` overnight paths. No change to Mode A, to the four report doors, or to the shipped
14B configuration. No cloud vision for patient images. No auto-signing, and no deployment.

## I. Future full-DICOM capability, preserved by construction

Stage 1 keeps Phase 4 reachable because it lands on assets that already exist and already have a live
writer, rather than on new ones:

| Asset | Location | State |
| --- | --- | --- |
| `ai_processing_manifests`, `ai_shadow_drafts`, `ai_evidence` | `lib/db/src/schema/aiExecution.ts:52, 91, 130` | written by a live worker: `lib/ai/shadowPipeline.ts:65, 116, 349, 396, 437`, registered `cron.ts:338-362` |
| Durable job engine | `enqueueRadiologyJob` over `dicom_retry_queue` | the same lane Stage 1 uses |
| Study arrival hook | `routes/internal-radiology.ts:1048-1059` → `scheduleStudyOnDicomArrival` (`schedulerService.ts:156`) | present, gated off |
| Batch/planning logic | `aiScheduler.decideScheduling:73` / `admitJob:120`; `schedulerService.runNightBatch:352`, `runScheduledReprocessing:436` | pure logic, unexecuted — the wake-up point |
| Observability | `lib/pacs/radiologyAdminOverview.ts:85-113`, `lib/radiologyDeploymentDiagnostics.ts:902-906` | live |
| Sequence/slice identity | Orthanc `/dicom-web` metadata reads (`care_erp_sync.py:303-311`), ERP `lib/pacs/*` | present |

Evidence-linked findings are already modelled: `observationAnchor.coerceObservationAnchor`
(`artifacts/diagnostic-erp/src/lib/observationAnchor.ts:113`) → `CanonicalObservation.anchor`
(`observationSlot.ts:86`), consumed by `EmbeddedWadoViewer`, `AnchorRail.tsx`, `ActiveAnchorChip.tsx`,
`ObservationLedgerPanel.tsx`. A screenshot-derived observation records the **key-image id** in that same
anchor rather than inventing a new provenance mechanism, so when real DICOM selection arrives, the
ledger shape does not change.

## J. Unresolved decisions (owner, before PR-B)

1. Which model interprets — PR-E benchmark first, no decision on a single run.
2. Whether `structuredJson` carries the AI image selection or a column does (this document recommends
   `structuredJson`, which needs no migration).
3. Whether rank-4 examination knowledge is wired into the prompt in Stage 1 or left absent, stated to
   the radiologist.
4. Whether cloud vision remains reachable at all for any image source after PR-A.
5. Retire `ai_job_queue` + `AiPipelineManager.tsx`, and unreferenced `endpointTrustPolicy`?
6. Whether `/vision-trial` (`routes/reportComposer.ts:725`) is folded into the audited path or removed.
   Its gate is `canUse` (`:125-130` — a full-access role **or** the `ai_reporting.use` permission, so not
   admin-only), and it takes arbitrary client `base64` (`:746-760`, 3.5 MB each) with no draft, key-image
   or ownership binding. Its cloud arm is honestly gated — the admin ops flag is the only authority and a
   settings load failure denies (`:731-743`) — but it remains a second way to put pixels in front of a
   model that the ownership and audit rules above would not cover.
