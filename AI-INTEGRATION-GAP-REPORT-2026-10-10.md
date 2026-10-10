# CARE AI — Integration Gap Report (PROMPT 9, Phase 2)

**Baseline:** `origin/main` = `158f7ea4`. PR #907 merged as `bcb04b59`, #906 as `19c88b48`, #905 as `c4d5d84d`, #908 as `158f7ea4`.
**Method:** targeted read of the five areas named in the prompt; every claim below carries a `file:line`. Delegated findings were re-verified against source before being written here.
**Status:** no code was changed to produce this report.

---

## A. Gap table

| Component | Existing implementation | Working? | Missing functionality | Minimum change |
|---|---|---|---|---|
| Canonical observations | `appliedPathologyPatches` is the single authoritative runtime store — `diagnostic-erp/src/lib/zai-workspace/store.ts:310`, declared authoritative at `api-server/src/lib/reportComposer/composeObservations.ts:5-6`. All four entry paths funnel through one boundary: `applyPathologyOverlay` (`store.ts:1742`) → `buildCanonicalObservation` (`observationSlot.ts:298`) → `overlayPathology` (`pathologyPatch.ts:321`) | **WORKING** | nothing for text-only; a per-fact citation edge is absent (see row "Anti-hallucination") | none — do not add a second store |
| Composer snapshot | `buildSnapshot()` `hooks/useReportComposer.ts:211` → `ComposerInputSnapshot` (`reportComposer/types.ts:30-101`), carries modality/region/bodyPart/protocol/reportTitle + clinicalHistory/technique/findings/impression/recommendation + derived observations + `fieldProvenanceSummary`. `inputHash` mirrored client (`types.ts:311`) / server (`api-server/.../snapshot.ts:200,225-245`) | **WORKING** | — | none |
| Cloud text AI | Three cloud adapters registered (`providers/resolveComposerProvider.ts:37-40`: deepseek, openai, qwen) over the shared transport `lib/ai-providers/src/openAiCompatible.ts:88`. Text PHI gate is real and fails closed: `phiText.ts:89` detects name / patient_id / DOB / phone / email / address / national_id; `scrubPhiText` `:124`; `gatewayPrivacy.ts:176-211` re-scans after scrubbing and returns `PHI_TEXT_CLOUD_UNRESOLVABLE` | **WORKING (transport + policy)** | but see "Acceptance path": the Composer **cannot currently select a cloud provider's image mode**; text mode itself is reachable | pass `cloudVisionAllowed` / allow cloud text selection from the job path (1 call site) |
| Cloud multimodal AI | Wire format exists — `openAiCompatible.ts:141-146` sends `data:<mime>;base64,…`; vision model list is hardcoded in `builtinModelCapabilities.ts:17-120` (qwen3.7-plus, deepseek-v4-flash-vision-exp, gpt-4o, gpt-4o-mini; all `phiEligible:false`) | **BLOCKED** | `jobService.ts:432` calls `runReportComposer()` **without** `cloudVisionAllowed`, so `composeEngine.ts:218` computes `false` on every production job, and `assertComposerProviderPolicy.ts:106-109` returns `cloud_vision_not_allowed`. Cloud vision is structurally unreachable from the Composer | 1 threaded argument + per-request authorisation, **after** the pixel-PHI row is resolved |
| OHIF image selection | ERP side is complete: `displayed-anchor-request` / `viewport-capture-request` out, `active-anchor` / `viewport-capture-result` expected back (`diagnostic-erp/src/lib/ohifViewerBridge.ts:8-15,119-131,450,505`; `useOhifViewerBridge.ts:248-259`) | **BLOCKED — other repo** | the shipped viewer bridge answers only `care.viewer.ping` and `care.viewer.requestContext` and replies `care.viewer.pong`/`care.viewer.context`/`care.viewer.error` (`care-pacs/ohif/enterprise/care-customization/care-bridge.js:9-15,110-129`). Repo-wide grep for `active-anchor`/`displayed-anchor`/`key-image` in care-pacs = **zero hits**; the only `source:"care-ohif"` emitters are measurement (`care-measurement-adapter.js:227,244`). Nothing answers, so `resolveKeyImageCapturePath` returns `"unavailable"` (`keyImageCapturePath.ts:11-16`) | a viewport-derived anchor + capture emitter in care-pacs, **plus** a `care-ohif` container rebuild (not code-provable from here) |
| Image de-identification | **None exists.** `api-server/src/lib/ai/dicomRedaction.ts:17` = `export const DICOM_REDACTION_PERFORMED = false;`, and its own docstring states "No code path scrubs a prompt or masks a pixel today" and that modality **burned-in** text "survives untouched" | **MISSING** | DICOM tag stripping, pixel masking, re-encode, burned-in OCR — all absent (grep `deidentif`/`stripTags`/`removeOverlay`/`dicomEdit`/`pixelData` = 0 in api-server) | this is a subsystem, not a patch — see scope decision |
| Image attachment | Real and ownership-safe **for local Ollama**: `aiSelectedKeyImageIds` (`useWorkspaceClinicalUi.tsx:1336`) → `snapshot.selectedKeyImages` (IDs only) → `resolveSelectedKeyImagesForCompose` re-validates ownership then reads JPEG off disk (`resolveSelectedKeyImages.ts:98-152,155-221`) → `composeEngine.ts:447` | **WORKING (local only)** | cloud leg (row above). Also the worklist "Attach" button attaches a **report file**, not pixels (`RadiologyWorklist.tsx:1058-1060,1075-1099,2256`) — unchanged, and correctly so | none for local; cloud leg gated |
| Report preview | `pnpm preview:reports` renders the repo's own print/PDF pipeline (`AGENTS.md`) | **WORKING** | — | none |
| Accept / Edit / Reject | Per tracked change: `acceptChange`/`rejectChange` (`useReportComposer.ts:374,380`) → `updateTrackedChangeState` (`jobService.ts:647`). Apply re-checks freshness, blocks `STALE_READY` (`jobService.ts:725`), materialises accepted text, persists inside a transaction with compare-and-set (`jobService.ts:820-849`, PR #906), and `undoLastPatch()` on failure. `applyAiComposerAccepted` never touches the ledger and stamps accepted prose `ai-draft` only (`store.ts:3052-3088`) | **PARTIAL** | `EDITED` has **no server writer** — only the client sets it; no route writes it | 1 route if "Edit" must persist as a distinct state |
| Explicit cloud-image approval | Default-deny at `gatewayPrivacy.ts:156-158`, locality re-derived from the resolved URL (`:127-146`) | **PARTIAL** | the only opt-in is a **global admin toggle** (`deepseekCloudVisionAllowed`, `routes/reportComposer.ts:374,643-648` governs DeepSeek+Qwen+OpenAI together). The prompt requires approval **before cloud image transmission** — per-request consent does not exist, and `confirmCloudVisionTrial` is deliberately non-authorising (`reportComposer.ts:636-642`) | per-request consent flag threaded into the job |
| Burned-in identifier check | `flagPossibleBurnedInPhi` regexes **prompt text and filenames only** (`cloudPayloadPrivacy.ts:53-62`); `gatewayPrivacy.ts:81` types pixel posture as the literal `"not_verified"` and returns `ok:true` **even when flags exist** (`:219-229`) | **MISSING** | the prompt's rule "if burned-in identifiers cannot be reliably excluded, **block** cloud transmission" is not met. `assertNoRawDicomPayload` only rejects `.dcm`/`application/dicom` **names** (`gatewayPrivacy.ts:160-164`), so a PACS-rendered JPEG with a burned-in name egresses unchanged | fail-closed posture: block until a real check exists |
| Cross-patient / cross-study guard | Strong and server-side: `IMAGE_STUDY_UNKNOWN/REQUIRED/MISMATCH` → 409 (`imageIdentity.ts:193-254`), PACS-confirmed via QIDO (`:115-185`, PR #908), path never trusted alone (`:170-175`), browser drop (`ohifViewerBridge.ts:295-299`), disk re-verify + path jail (`resolveSelectedKeyImages.ts:98-152,165-171`) | **WORKING** | `describe.skipIf(!dbReady)` means the request test can silently skip in CI | none (note the CI caveat) |
| Snapshot freshness | Two axes (`snapshot.ts:169`, `jobService.ts:608`), enforced at poll, at Apply and server-side in `markComposeApplied` (`:747-758`) | **WORKING** | — | none |
| Anti-hallucination (per-fact citation) | `validateOutput.ts:96-103` builds a `groundedCorpus`; measurement check is regex token matching (`:262-303`) | **PARTIAL** | `TrackedChange` has no `sourceObservationIds` (`types.ts:106-120`); `trackedChanges.ts` sets only `source:"AI_COMPOSER"`; `ComposeObservation.id` is optional (`composeObservations.ts:127`) and identity excludes measurement/severity (`snapshot.ts:24-30`); provenance is text-keyed so a paraphrase breaks it (`types.ts:69-73`). No sentence→observation edge exists | citation edge, or keep prose-only grounding and say so honestly |

---

## B. Two defects worth separating from the integration

1. **Accepting an AI draft can delete a radiologist's own observation from the AI's future input.** `applyAiComposerAccepted` rewrites prose → `lastRendered` no longer matches → `reconcilePatchAgainstNarrative` marks the ledger row `stale` (`observationLedger.ts:687`) → `deriveComposeObservations` **drops** it (`composeObservations.ts:175`). This contradicts "clinical observations remain authoritative" and is independent of cloud AI. Highest severity finding in this report.
2. **PR #907 dropped the abort deadline on the path it made mandatory.** `boundRequest` builds `http.RequestOptions` from `method/hostname/port/path/headers/agent` only (`hardenedTransport.ts:343-350`) — grep for `signal` in that file returns **zero** — while every `hardenedLocalRequest` caller passes `AbortSignal.timeout(…)` (`index.ts` Ollama arm, `openAiCompatible.ts:382`, `radiologyOllama.ts:75`, and 6 others). The unpinned branch spreads `init` and is fine. A stalled Ollama or local-compatible socket can therefore hang past its configured deadline, which directly weakens "Ollama stays available as fallback". Cloud is unaffected (it uses the SDK path without `enforceLocalBinding`).

Neither belongs in the integration PR. Both should be their own commits with a failing test first.

---

## C. Honest scope verdict

The text-only leg is genuinely close: the canonical ledger, snapshot, hashing, freshness, durable Apply, cloud transport, text PHI gate and cross-study binding all exist and work. The gap is one threaded argument plus per-request authorisation.

The image leg is **not** a patch:

* selection is blocked in a **second repository** (`care-pacs`) and needs a container rebuild that cannot be proven from this repo;
* image de-identification **does not exist at all**, and burned-in identifiers cannot be reliably excluded without OCR of raster pixels;
* the prompt's own safety rule then forces the conclusion — *if burned-in identifiers cannot be reliably excluded, block cloud transmission* — so today the correct behaviour for cloud images is **refuse**.

Reporting the modality's own burned-in name is routine on ultrasound (noted in `dicomRedaction.ts:8-11`), so this is not a theoretical risk.

**Recommendation: PARTIALLY COMPLETE — BLOCKED** on the image leg, with the text leg implementable now at low risk. I have not written any code; the scope decision in the chat message is what determines what I build.

---

## D. What I did not verify

* Whether the running `care-ohif` container was rebuilt after D2 (deployment evidence, not code).
* The live value of `deepseekCloudVisionAllowed` and `erpOriginAllowlist` in the clinic's runtime config.
* Whether `radiology_report_drafts` persistence satisfies `verifyComposeDurabilityTx` in production (no live DB run locally).
* Whether `resolveTaskRoute("selected_image_vision")` is configured to a cloud provider anywhere real.
