# 3. AI Report Composer Audit

Sections 10–15. Everything is code-level unless marked *measured*. Two independent AI authoring systems ship side by side; this document keeps them apart deliberately.

* **Interactive Composer** — the radiologist clicks, reviews tracked changes, accepts, applies. `lib/reportComposer/` + `routes/reportComposer.ts`, state on `radiology_worklist.ai_compose_status`.
* **Overnight VISION draft** — background batch on arrival/night window. `lib/ai/draftService.ts` + `overnightDraftQueue.ts` + `cron.ts:178-202`, state on `ai_draft_status`/`ai_draft_json`.
They share neither model configuration nor id space, and both can write a draft for the same study.

---

## 3.1 Route inventory — what the product can actually call

Mounted at `/api/radiology/report-composer` (`routes/index.ts:1064`; auth + `canUse` at `reportComposer.ts:103`) and `/api/ai-reporting` (`index.ts:1027`).

| Route | file:line | Frontend caller | Verdict |
|---|---|---|---|
| `POST /jobs` (enqueue) | `reportComposer.ts:118` | `api.ts:30` ← `useReportComposer.ts:342` | **LIVE** |
| `GET /jobs/:id`, `/jobs/latest` | `:157`, `:175` | `api.ts:34`, `:39` | **LIVE** |
| `POST /jobs/:id/freshness` | `:194` | `api.ts:67` | **LIVE** |
| `accept` / `reject` a tracked change | `:235`, `:248` | `api.ts:74`, `:81` | **LIVE** |
| `POST /jobs/:id/applied` | `:271` | `api.ts:106` | **LIVE** |
| `discard`, `process-now` | `:307`, `:681` | `api.ts:112`, `:117` | **LIVE** |
| `GET /diagnostics` | `:323` | `api.ts:127`; `AiReportingSettings.tsx:458` | **LIVE** |
| `POST /test`, `/test/compare`, `/vision-trial` | `:554`, `:576`, `:630` | `ReportComposerTestPanel.tsx:253/279/304`, mounted at `AiReportingSettings.tsx:1547` | **LIVE (settings only)** — note: an earlier audit called `/test/compare` dead; it is **not** |
| `POST /prune-snapshots` | `:692` | none | admin-only, **never scheduled** |
| `POST /api/ai-reporting/draft` | `aiReporting.ts:1079` | `useTriggerAiImpression.ts:97`; warm-up `useWorkspaceClinicalUi.tsx:2279` | **LIVE** |
| `POST /polish`, `POST /compare` | `aiReporting.ts:1565`, `:1815` | only `RadiologyAICopilotPanel.tsx:770/635` — **a component that is never imported** | **DEAD** |
| `POST /image-review` | `:1646` | `ImageReviewAssistant.tsx:52` (`App.tsx:566`) | **LIVE** |
| `GET /command-center` | `:3421` | zero callers | **DEAD** |
| `POST /fallback-chain` | — | `pages/ProviderFallback.tsx:48` posts to it, and `/radiology/provider-fallback` **is routed** (`App.tsx:165,567`) | **404: no such server route exists** (verified by grep across `routes/`). A staff-visible page whose only action cannot work |
| `POST /api/ai-comparison/run` | `aiComparison.ts:33` | `AiComparisonWorkspace` (`App.tsx:564`) | **LIVE** |
| overnight ops / canary / queue | `aiClinical.ts:146-396` | admin settings | LIVE |

Worker: `cron.ts:208-226` → `radiologyJobHandlers.ts:274` → `processComposeJob`. **No compose request is served inside the HTTP request**; `/jobs` only enqueues.

## 3.2 Providers and models — supported vs reachable

Local-vs-cloud is decided at `composeEngine.ts:174-177` (`isCloud = deepseek | qwen | openai`) and enforced by `assertComposerProviderPolicy.ts:56-98`, `gatewayPrivacy.ts:111-147`, `providerLocality.ts:128-147`.

| Provider | Default base URL | Key env name | Models registered (vision / structured-JSON) | Actual status |
|---|---|---|---|---|
| `openai` | `api.openai.com/v1` (`openAiCompatible.ts:250`) | `OPENAI_API_KEY` / `OPENAI_BASE_URL` | `gpt-4o` V+J, `gpt-4o-mini` V+J (`builtinModelCapabilities.ts:179,190`) | adapter + registry complete; **never proven against the real API** |
| `qwen` | `dashscope-intl.aliyuncs.com/compatible-mode/v1` | `QWEN_API_KEY` \| `DASHSCOPE_API_KEY` | `qwen3.7-plus` V+J (`:145`), `enable_thinking:false` (`:122`) | as above |
| `deepseek` | `api.deepseek.com` | `DEEPSEEK_API_KEY` | `deepseek-v4-pro` text-only; `deepseek-v4-flash-vision-exp` V | as above |
| `local_openai_compatible` | must be configured | `LOCAL_OPENAI_COMPATIBLE_*` | `bonsai` V+J | local by policy |
| `ollama` | LAN endpoint | — | `qwen3-vl:8b`, `gemma3:12b`, `medgemma1.5:4b` | **the only arm with measured live success** (*measured 2026-10-11, three runs, §3.7*) |
| `gemini`, `anthropic` | `index.ts:399-414` | `GEMINI_API_KEY`/`ANTHROPIC_API_KEY` | none registered | **structurally unreachable from the Composer**: `parseComposerProviderName` (`providers/resolveComposerProvider.ts:19-31`) coerces any unrecognised name to **`ollama`** |

**That last row is a fail-open.** Typing an unsupported provider name into the Composer settings silently means "use the local Ollama", rather than refusing. For a system whose whole purpose is knowing *which* model wrote a sentence, an unknown provider must be an error.

**Gateway asymmetry.** `lib/ai/interactiveAiGateway.ts` is the hardened path — one owner resolves the provider (`:78-134`), the executor reports its identity (`:216-232`), and an unattributable answer is discarded. It serves `/draft` and `/polish`. **The Composer does not use it.** Production Composer drafts therefore skip the attribution check that the interactive path was built to enforce (`provenanceIntact` exists only on `/test`, `reportComposer.ts:466`).

**`isEnabled` is ignored on the Composer cloud path.** `cloudComposerConfig.ts` contains no reference to enabled/isEnabled, and `getProviderApiKey` (`lib/ai-providers/src/index.ts:1104-1116`) selects only `encryptedApiKey` by provider name. A provider the admin has switched **off** can still be used to send PHI if its key row exists.

## 3.3 Prompt anatomy

System prompt = `buildCareSystemPrompt` (`persona/index.ts:24-78`) = MASTER + STYLE + SAFETY, plus a modality/segment module chosen by `persona/router.ts:42-74` (`mriSpineLumbar/Cervical/Dorsal`, `mriBrain`, `ct`, `usg`, `mammography`, `selectedImages`), plus screening and task blocks. The persona directory exists and holds 14 files; per-exam modules are real, not aspirational.

Verbatim rules that matter clinically (`persona/master.ts`):
* `:22` *"NEVER invent pathology or lesions."*
* `:23` *"NEVER invent measurements — preserve exact numbers and units."*
* `:25` *"NEVER invent or change vertebral/disc levels."*
* `:29` *"NEVER auto-finalize. NEVER sign."*
* `:33` *"NEVER invent normality for an unobserved critical structure."*
* `:51-57` the JSON contract; `:9` *"No examples injected."*

Style (`persona/style.ts`): `:11` technique is the radiologist's; `:13,30-33` impression rules; **`:19` "Avoid teaching text, patient-directed language, and unnecessary differentials"** — differentials are *suppressed*, not supported.

Context assembly (`buildRadiologistDraftContext.ts`): technique protected `:257`; observations as the "CLINICAL TRUTH" block `:272`; measurement de-duplication `:226`; measurements block `:286`; the radiologist's own instruction is honoured for **"Style and emphasis only … cannot authorise sending or signing"** (`:275-285`).

**Not in the prompt and not in the snapshot:** patient age, sex, and any prior study/prior report (`types.ts:71-136` has no such fields); no reference-normal tables; no measurement-table template; `CT_GOLD_STANDARD.md` / `XRAY_GOLD_STANDARD.md` are documents, not prompt input. A model therefore cannot be asked to compare with a prior, because it is never told a prior exists — and the D1 writer hardcodes `comparison: { has_prior: false }` (`lib/radiologyD1DraftWriter.ts:217`).

## 3.4 Context budget, limits, retries

| Control | Value | File | Applies to |
|---|---|---|---|
| `num_ctx` clamp | 2048–8192 | `voiceReportComposer/runtimeConfig.ts:58` | ollama |
| temperature | ≤ 1, default 0.1 | `:59` | both |
| timeout | 10–120 s, default 45 s | `:60` → `openAiCompatible.ts:131` | both |
| vision context planner | `planComposerVisionContext` | `composerContextBudget.ts:63-106`, called at `composeEngine.ts:411` | **ollama only** |
| `max_tokens` | **never sent** — declared in `providers/types.ts:134`, set nowhere in the composer | `openAiCompatible.ts:161` conditional | cloud output is unbounded |
| model-level retry | gated `isOllama` | `composeEngine.ts:507,533` | cloud gets **no** retry and **no** cross-provider fallback |
| queue retry | `maxRetries: 2` | `jobService.ts:349` | both |
| non-retryable errors | list | `jobService.ts:450-465` | both |

Failure vocabulary (each is a named, user-visible code): `empty_model_response` (`ollamaComposerAdapter.ts:121`, with `think:false` at `:72`), `empty_final_content` for chain-of-thought burn (`openAiCompatible.ts:188-198`), `composer_context_budget_exceeded`, `composer_num_ctx_insufficient`, `malformed_json`, `PHI_TEXT_CLOUD_BLOCKED` / `_UNRESOLVABLE` (`gatewayPrivacy.ts:186,204`), `cloud_vision_not_allowed`, `local_provider_url_points_to_cloud`, `vision_capability_unverified`, `composer_provider_not_supported`.

## 3.5 Output handling and the acceptance boundary

`parseComposerDraftJson` (`types.ts:190-201`) uses a greedy `/\{[\s\S]*\}/` then Zod with defaults — so a **truncated** JSON object can still "parse" into a partial draft. `validateComposerOutput` (`validateOutput.ts:382-533`) blocks with hard errors: `empty_output`, `unsupported_abnormality` (a ~40-term vocabulary at `:25-72`), `measurement_mutation`, `laterality_swap`, `level_change`, `severity_escalation`, `impression_ungrounded`, `selected_images_*`, and modality-specific fabrications (`unsupported_diffusion_restriction`, `enhancement_claim`, `myelomalacia`). A validation failure means **FAILED, never READY** (`jobService.ts:469-481`).

Grounding is **substring matching over ~40 terms** (`validateOutput.ts:399-403`): a model that writes "clot" where the observation said "thrombus" is not flagged. Precise but shallow.

The safety boundary is genuinely strong and I could not find a way round it in code:
* changes are created `reviewState: "PENDING"` (`trackedChanges.ts:45,61`);
* `markComposeApplied` requires an **explicit** `acceptedChangeIds` list and auto-rejects anything still PENDING (`jobService.ts:785,789`);
* finalizing a report with unreviewed AI content is **blocked server-side, failing closed** — `unreviewedAiGuard.ts:146-161`, enforced at `patient-reports.ts:2080`, `:2453` and `internal-radiology.ts:1187` (409 with a named reason);
* `STALE_READY` jobs are unapplyable (`jobService.ts:725`);
* the prompt itself forbids auto-finalize/auto-sign.

**Provenance persistence is the weak link.** The provider/model/fallback record is stored *only inside* `validation_json` (`jobService.ts:504`). `ai_report_compose_jobs` has **no `provider`, `usage`, `cost` or `model_version` column** (`lib/db/src/schema/aiReportComposer.ts:39-97`, verified by grep: zero matches for provider/usage/cost/tokens), and **the composer path writes no `ai_audit` row at all** (zero references in `lib/reportComposer/`). Answering "which model produced this sentence, and what did it cost" currently requires parsing a JSON blob, and after snapshot pruning the blob may be gone.

## 3.6 Persistence, jobs, and what is not atomic

State machine: `QUEUED → COMPOSING → READY | FAILED → (STALE_READY) → APPLIED | DISCARDED | CANCELLED | OBSOLETE`.

Apply is deliberately two-phase (verified): enqueue captures a **server-derived** baseline (`jobService.ts:272-339`) → a composer-tagged save performs a locked read + compare-and-set + receipt (`radiology-report-generator.ts:1817-1830`; `composePersistence.ts:401-462`) → `POST /applied` proves the accepted text is actually inside the report before flipping APPLIED (`jobService.ts:820-849`; `composePersistence.ts:535-587`).

Remaining gaps, all visible in code:
* the provider call (`jobService.ts:432`) and the READY write (`:495`) are **outside any transaction**; apply is two separate client requests (save-draft then `/applied`), so a crash between them leaves READY-but-unapplied. Only the 30-second autosave `previous` arm (`composePersistence.ts:373`) legitimises the comparison.
* jobs whose `source_persisted_token` is NULL are **permanently unapplyable** (`compose_baseline_missing`, `:370/549`);
* `queueJobId` is nulled when the queue id is non-positive (`:354`), leaving a QUEUED row nobody drains;
* snapshots are pruned 1–90 days (`:891-910`) **only when someone calls the admin route** — PHI therefore accrues in `input_snapshot_json` indefinitely despite the 14-day default.

## 3.7 Can it produce a report like ChatGPT's? (sections 11, 13)

Test input: *"MRI LS spine. Loss of lumbar lordosis. Disc desiccation L2-S1. Diffuse bulges L3-4 and L4-5. Facet arthropathy. Canal AP 12, 11, 9, 10, 13 mm."*

| Expected capability | Verdict | Evidence |
|---|---|---|
| Examination title | supported — **not AI-authored** | `reportTitle` is carried as identity (`buildRadiologistDraftContext.ts:204`); typography from `reportPresentation.ts:190,212` |
| Technique | supported and **protected from the model** | `persona/style.ts:11`; `PROTECTED TECHNIQUE` block `:257`; print merge `radiologyReportPrintLiveMerge.ts:128-132` |
| Structured findings with headings | **partial** | the document model can hold tables/headings (`findingsDocument.ts:36-96`) and the renderer prints them (`radiologyReportPreviewHtml.ts:205,210-221`), **but the AI output contract asks for three flat strings** (`master.ts:51-57`) — nothing asks for, or preserves, structure |
| Level-wise description | partial | prompt orders levels (`master.ts:38`, `persona/mriSpine.ts:16-19`); real level blocks come from the shipped template `routes/structuredReportTemplates.ts:148-152,183-194` |
| **Spinal canal AP measurement table** | **partial — template-authored, never dictated-authored** | a working renderer exists, but **no code turns "12, 11, 9, 10, 13 mm" into rows**: `SpineCanalApBox.tsx:377-385` inserts `formatCanalApTableText` which is **tab-separated** (`spineCanalAp.ts:226-241`) → parses as a paragraph, tabs collapse in HTML; the helper that *does* build a table, `canalApTableHtml` (`:254-271`), has **no production caller** (grep: only its own test). The server separately builds a grid from `spinal_measurements` (`radiology-report-generator.ts:2320-2372`) — so a table appears only if the numbers are entered through the measurement UI, never from dictated prose |
| Impression | supported | `style.ts:13,30-33` |
| Recommendations | supported but **auto-cleared** | `style.ts:35-40`; `validateOutput.ts:460-464` |
| No invented measurements | **weak** | the enforcer (`validateOutput.ts:110`) needs number-unit adjacency, so *"AP 12, 11, 9, 10, 13 mm"* yields one token (`13 mm`); **dropped measurements are advisory only** (`:428-431`) and never block |
| No invented/altered levels | strong for invention, **silent for loss** | hard error `level_change` (`:326-333`); nothing errors when a level disappears |
| Bold abnormal findings | supported | generated at render (`abnormalEmphasis.ts`, `radiologyReportPreviewHtml.ts:189-199`, PDF `reportPdfGenerator.ts:334`) |
| Prior-study comparison | **absent** | `radiologyD1DraftWriter.ts:217` hardcodes `comparison:{has_prior:false}` |
| Differentials | **actively suppressed** | `persona/style.ts:19` |

### Where reporting style lives (and how often)

Same rule, several owners — only one of which the AI sees:

| Rule | Sources |
|---|---|
| bold demographics | **`institutionalReportStyle.ts:444-449` (DB-backed, authoritative)** vs hard-coded `radiologyReportPreviewHtml.ts:322-341` vs `reportPresentation.ts:740-743` |
| centred title | presentation slot vs inline `text-align:center` (`:326`) vs `institutionalReportStyle.ts:159,274-292` |
| underlined headings | institutional style (`:47,143,233-254`) vs `.section-heading` CSS (`reportPresentation.ts:791-797`) vs `<u>` in preview (`:327-334`) — **the prompt says nothing** (`style.ts:10-14`) |
| bold abnormal | institutional CSS vs the *producer* `abnormalEmphasis.ts` vs `validateOutput.ts:25-72`'s **third, different** vocabulary |
| level-wise spine | `structuredReportTemplates.ts:183-194` (LS) vs `:246-256` (cervical) vs `persona/mriSpine.ts:16-19`. **Unreachable promise:** the template offers a `| Level | AP Canal (mm) |` scaffold, but the AI contract cannot emit a table and the radiologist's own "include the canal table" instruction is explicitly capped at *"Style and emphasis only"* (`buildRadiologistDraftContext.ts:275-285`) |
| cervical vs lumbar table choice | `spineCanalAp.ts:203-224` and a **second private copy** at `radiology-report-generator.ts:2340-2360` |
| no duplicate conclusion | prompt only (`style.ts:13,20`, `master.ts:40`) — **no validator anywhere** |
| follow-up wording | `style.ts:37-39`; the support-test regex (`validateOutput.ts:466`) accepts `correlation`, so almost anything passes |

**Single source of truth to adopt:** keep `radiology_institutional_styles` (DB) as the only presentation authority, and add one `reporting_preferences` document (per-radiologist, since there is one radiologist) holding *content* preferences — section order, whether to state relevant normals, canal-table thresholds, differential policy, recommendation house style. The AI consumes that document; the renderer consumes the institutional style; no third place.

### Formatting survival, hop by hop

AI JSON strings → tracked changes ("DATA only — never HTML", `trackedChanges.ts:1,104`) → DB `radiology_report_drafts.raw_findings / findings_sections / impression / recommendation` as **plain TEXT** (`radiologyReportGenerator.ts:27-33`) → `patient_reports.body` as **HTML** (`patientReports.ts:30`) with **five disagreeing writers** (`storedReportBody.ts:4-14`) → screen/print via `radiologyReportPreviewHtml.ts:176,205` → PDF via `reportPdfGenerator.ts:317-330`.

Three concrete drop points:
1. `reportFieldMerge.ts:102-117` — `normalizeForDedupe` strips `|` and `.`, so two canal rows differing only in formatting collide and **one is silently merged away** (verified in source: `.replace(/[^a-z0-9\s]/g," ")`).
2. `radiology-report-generator.ts:2303-2311` — the server print-preview escapes raw findings into a single `<p>` and never calls the document renderer, so **a table stored in the body prints as a run-on paragraph** (the live workspace hides this by re-rendering, `radiologyReportPrintLiveMerge.ts:117-157`).
3. Tab-formatted `formatCanalApTableText` collapses to prose (§ table above).

**PDF ≠ print ≠ screen.** jsPDF draws from raw strings; print draws HTML; the PDF path additionally fetches measurements the print path never fetches (`useWorkspaceExportShare.ts:271-286`). Verified independently: rendered PDFs are timestamp-nondeterministic, so only the screen/print HTML is admissible evidence for a layout claim.

## 3.8 Refinement (section 12)

Kinds: `REPHRASE / SHORTEN / EXPAND / SECTION_EDIT / SELECTION_EDIT` (`composeEngine.ts:60-83`).

What the refiner actually receives: the instruction, the selected text, **findings truncated to 1,200 characters, impression to 600, and only the first 12 observations** — no technique, no study identity, no spine segment or protocol, no key images. Persona modules still load, so style rules apply.

Consequences, each traceable:
* **"Preserve all findings and measurements" cannot be honoured as stated** — anything past character 1,200 or observation #12 is not in the request, so the model cannot keep what it was never given, and the validator then has nothing to compare against.
* Validation is the same `validateComposerOutput`, so invented levels/measurements are blocked — but **dropped** measurements remain advisory (`validateOutput.ts:428-431`).
* Overwrite protection is real but whole-field: `STALE_READY` rejected (`jobService.ts:725-731`), freshness via `reportRevision` + `inputHash` (`:746-757`), finalized reports refused (`:760-765`), then the finalize-time unreviewed-AI guard. At apply time the **edited field is replaced wholesale** (`trackedChanges.ts:115-119`). Note `microEdit` supplies `reportRevision` from the client (`useReportComposer.ts:577`), so the guard is client-cooperative, and an accepted-then-rejected round trip that leaves the hashes unchanged is not detected.

**Simplest reliable implementation** (no new infrastructure): pass the *complete* current draft plus the complete observation list, ask for a field-scoped result with the same JSON contract, and add a **conservation check** to the validator — every measurement token and every level present in the input must be present in the output, else hard-fail rather than advise. That is one context change plus one rule, and it makes "preserve all findings" a fact instead of a wish.

## 3.9 Local model behaviour, measured (not asserted)

*Measured 2026-10-11 against the clinic AI PC `http://192.168.1.250:11434`, three runs of the shipped selected-image path with one synthetic drawn lumbar schematic + six typed observations* (`localVisionModelsAb.live.test.ts`, opt-in `RUN_LIVE_OLLAMA=1`):

| model | answered | ms | structured JSON | typed levels kept | laterality | invented mm |
|---|---|---|---|---|---|---|
| `medgemma1.5:4b` | yes | 9,285 / 9,582 / 8,268 | yes | all 3 | as typed | 0 |
| `gemma3:12b` | yes | 39,443 / 40,743 / 38,454 | yes | all 3 | as typed | 0 |
| `qwen3-vl:8b` — CARE's registered local vision default | **no** | 66,034 / 80,727 / 66,237 | no | none | dropped | 0 |

`qwen3-vl:8b` returned `empty_model_response` on **all three** attempts: same failure mode as bill OCR (2026-10-01) — it spends the budget on chain-of-thought and answers with nothing. A persona-free read probe settled what each model can see: `gemma3:12b` 5/7 printed labels in 12.0 s, `qwen3-vl:8b` 5/7 in 25.0 s, `medgemma1.5:4b` 2/7 in 4.7 s. So `qwen3-vl:8b` has working eyesight and fails on the *report* prompt; MedGemma reads pixels but recovers much less fine print. **None of this measures diagnostic accuracy**, and no model should be judged on a drawn label card.

## 3.10 Image-assisted reporting and cloud egress (sections 14, 15)

| Hop | what travels | what the model sees |
|---|---|---|
| browser capture → ERP | multipart blob + SOP/series/study UIDs + frame + caption (`radiology-report-generator.ts:2549-2551`), identity verified `:2646` | a **browser canvas**: window/level and any annotation burned in |
| ERP store | file on disk, `data/uploads/radiology-key-images/<uuid>.jpg` | sharp autorotate, ≤1800 px edge, **JPEG q85** (`frozenKeyImages.ts:31-33,86-108`) |
| radiologist selection → ERP | **`keyImageId` refs only, max 4, never base64** (`types.ts:36,45-53`) | — |
| ERP → provider | `fs.readFile` → base64 as stored (`resolveSelectedKeyImages.ts:155-221` → `composeEngine.ts:447`) | the frozen JPEG — **usable pixels, lossy 8-bit, window level baked** |
| overnight / interactive arm | Orthanc `/rendered` | **re-rendered at 512 px, q80**, Orthanc default windowing (`studyImageFetch.ts:190-221`) |

So: cloud/local models receive **real pixels, not identifiers** — but a small lossy derivative, never the DICOM object, and never the original monotone greyscale range. Limitations by modality: MRI/CT are acceptable for *localisation and pattern* but not for quantitative reading (window/level is fixed at capture; HU and tiny focus are unrecoverable); mammography needs full-resolution grey-level presentation and to-mosynthesis views — a 1800 px q85 JPEG is inadequate; ultrasound is the best fit (small frames, loops already summarised by SR).

**Ten gates stand between a clinic image and the internet, and one of them is never opened by production code.**

| Gate | file:line | default | who can change it | user-visible refusal |
|---|---|---|---|---|
| per-job `cloudVisionAllowed` | `jobService.ts:432-437` — **omitted** | false | **nobody: no UI, no setting** | `cloud_vision_not_allowed` |
| ops `deepseekCloudVisionAllowed` | `overnightOpsControls.ts:36,67,157` | false | admin `PUT /ai-clinical/overnight-ops` + `OvernightAiSettings.tsx:608` | `cloud_vision_trial_not_confirmed` |
| re-check inside the adapter | `gatewayPrivacy.ts:156` | deny | — | `cloud_vision_not_allowed` |
| no raw DICOM ever | `cloudPayloadPrivacy.ts:33-49` | enforce | — | `raw_dicom_upload_forbidden` |
| MIME allowlist | `gatewayPrivacy.ts:166-174` | jpeg/png/webp | — | `cloud_image_mime_not_allowed` |
| vision capability | `compatibleComposerAdapters.ts:60`, `cloudImagePolicy.ts:49` | registry | admin `supportsVision` | `MODEL_NOT_VISION_CAPABLE` |
| PHI in text | `gatewayPrivacy.ts:176-211`, `cloudTextPhiAllowed` | false | admin AI settings | `PHI_TEXT_CLOUD_BLOCKED` / `_UNRESOLVABLE` |
| endpoint-derived locality | `gatewayPrivacy.ts:127`, `assertComposerProviderPolicy.ts:80-84` | reclassify-as-cloud | admin endpoint URL | `local_provider_url_points_to_cloud` |
| image ownership | `composeEngine.ts:289`, `resolveSelectedKeyImages.ts:136` | enforce | — | `selected_images_ownership_unverified` |
| **de-identification proof** | `imageDeidentification.ts:319` | **not wired** | — | *(never runs)* |

**Verdict:** from the radiologist's Composer, **cloud image requests are structurally unreachable** — `jobService.ts:432` never sets the flag. The only arm that has ever passed `cloudVisionAllowed: true` is the overnight path (`gatewayInferenceProvider.ts:124-130`), behind two admin toggles. `/vision-trial` (settings screen) accepts browser-supplied base64 up to 3.5 MB and silently discards anything larger (`reportComposer.ts:658`) — the one place a person can deliberately send an image.

**The de-identification checker exists and is excellent — and nothing calls it.** `deidentifyImagesForCloudEgress` and `createLocalBurnedInOcrRunner` have **zero non-test callers** (`imageDeidentification.ts`, `localBurnedInOcr.ts:87`). Its inspection is honest about being weak: it OCRs the raster locally and matches this patient's name/surname tokens, DOB in 7 renderings, patientId, MRN, accession, plus generic PHI patterns; it **cannot** see non-text marks, ignores name tokens under 3 characters, and blocks on `not_verified`. It never reads DICOM tags (there are none in a raster) and its output is in-memory only — originals stay in Orthanc and the ERP keeps the untouched frozen JPEG.

**Fields sent externally.** Name, phone, email, address, MRN and UHID are **never selected** (`aiReporting.ts:771-778`) — keep that. Age/sex are opt-in and clinically necessary. Free-text clinical history **is** sent and is where residual PHI lives. Accession and StudyInstanceUID are sent on the overnight arm (up to 20 series/SOP anchors, `gatewayInferenceProvider.ts:53`) — **they buy the model nothing and should be dropped from cloud prompts**. Internal `keyImageId`/`observationId` (`composeEngine.ts:91-98`) likewise.

**Keys.** `ai_provider_settings.encrypted_api_key`, AES-256-CBC with a key derived from `SESSION_SECRET` (`cryptoUtils.ts:3-22`) — so **key confidentiality is only as strong as the session secret**. `GET /ai-reporting/settings` returns a `hasApiKey` boolean (`aiReporting.ts:403`); composer status returns `*Configured` + base URL (`reportComposer.ts:363-383`). **No provider key or fragment reaches the browser** — verified. One exception worth naming: `/egress-preview` returns **real patient frames as base64 to the caller** (`aiReporting.ts:1040-1050`), which is a PHI export surface behind staff auth rather than a leak; treat it as sensitive.

**PHI already stored.** `ai_reporting_audit_logs.prompt_text` (first 2,000 chars) with patientId/studyUID/accession; `ai_reporting_drafts.prompt_text` + `ai_response` in full; composer `input_snapshot_json` until (never) pruned.

**Retry, timeouts, cost.** Delivery is at-least-once: a stale `running` job is requeued after 10 minutes (`radiologyJobs.ts:94`), and the enqueue-dedupe unique index only covers QUEUED/COMPOSING (`aiReportComposer.ts:103`) — **a slow cloud call is re-sent and re-billed**. Timeouts range 45 s (composer) to 600 s (overnight). Usage *is* read from the provider (`openAiCompatible.ts:170-176` → `compatibleComposerAdapters.ts:125-135`) and then **discarded**: `ComposeRunResult` has no usage field (`composeEngine.ts:43-52`), `/test` hard-codes `promptTokens/completionTokens/approximateCostUsd: null` (`reportComposer.ts:518-522`), `recordDeepSeekTelemetry` is a stub returning `[]`, and the pricing rows are self-labelled "placeholder" (`pricing.ts:28-57`). **Cloud cost is not measurable today, in any form.**

## 3.11 Minimum work to make cloud AI the primary engine

Twelve proven blockers, smallest-first; each is a code change, not new infrastructure.

| # | Blocker | file:line |
|---|---|---|
| 1 | Cloud output is unbounded — `max_tokens` is declared and never sent | `openAiCompatible.ts:161`; `providers/types.ts:134` |
| 2 | No usage/provider/cost storage → spend invisible | `aiReportComposer.ts:39-97`; `composeEngine.ts:43-52` |
| 3 | Unknown provider names silently become `ollama` (fail-open) | `providers/resolveComposerProvider.ts:19-31` |
| 4 | Composer cloud path ignores `isEnabled` → a disabled provider can still receive PHI | `providers/cloudComposerConfig.ts:72`, `lib/ai-providers/src/index.ts:1104-1116` |
| 5 | Composer bypasses the interactive gateway → no attribution check on production drafts | `interactiveAiGateway.ts:78-134` unused here |
| 6 | No cloud retry, no cross-provider fallback; `/fallback-chain` has no backend while its page is routed | `composeEngine.ts:507,533`; `pages/ProviderFallback.tsx:48` |
| 7 | No cloud token pre-flight (the budget planner is ollama-only) | `composeEngine.ts:411` |
| 8 | PHI scrub failure hard-blocks the draft, and free-text history makes that unpredictable per study | `gatewayPrivacy.ts:183-208` |
| 9 | Grounding is substring matching over ~40 terms | `validateOutput.ts:399-403` |
| 10 | Truncated JSON can "parse" into a partial draft | `types.ts:190-201` |
| 11 | Prompt lacks age/sex/priors/structure; differentials suppressed; no measurement-table contract | `types.ts:71-136`; `style.ts:19`; `master.ts:51-57` |
| 12 | Every cloud model row is `experimental:true, phiEligible:false` and no cloud accuracy evidence exists | `builtinModelCapabilities.ts:145-199` |

Order that buys the most: **(1) + (2)** make cloud usable and watchable at all → **(3)(4)(6)(7)** make it safe and survivable → **(11)** is what makes the report *good* → **(5)(9)(10)** close the audit gaps → **(8)(12)** need one real, de-identified clinical test agreed by the radiologist before any patient study goes out.
