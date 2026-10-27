# AI Composer — the workflow, traced and graded

**Scope.** One study, from arrival to delivered report, with every stage graded. Read at
`origin/main 80a09df4`. Companion to `AI_COMPOSER_CURRENT_STATE.md` (component detail) and
`AI_COMPOSER_GAPS.md` (what is missing and the smallest safe correction).

**The instruction this document exists to satisfy:** *"Do not confuse a UI component with a working
end-to-end feature."* Every stage below is graded on whether a caller chain reaches it and whether a
test exercises it — not on whether a component renders.

## Grading key

| Grade | Meaning |
| --- | --- |
| **IMPLEMENTED AND TESTED** | A live caller chain exists, and a test exercises the behaviour (not just the source text). DB-gated tests are flagged, because they skip silently in CI without `DATABASE_URL`. |
| **IMPLEMENTED BUT UNVERIFIED** | A live caller chain exists; no test exercises the behaviour, or the only test is a source-text grep or a skipped suite. |
| **PARTIALLY IMPLEMENTED** | Some stages of the path exist; a required stage is missing, client-only, or unenforced. |
| **NOT IMPLEMENTED** | No code, or code that returns a refusal/constant by design. |

## The trace

```
 1  Study arrives (Orthanc → poller → intake)                    IMPLEMENTED AND TESTED
 2  Worklist triage, claim, lock                                 IMPLEMENTED AND TESTED
 3  Open the reporting workspace                                 IMPLEMENTED AND TESTED
 4  Image review — OHIF viewer + PACS image picker               IMPLEMENTED AND TESTED (DB-gated)
 5  Attach key images to the draft                               IMPLEMENTED AND TESTED (DB-gated)
 6  Structured entry — Quick Select → observation ledger         IMPLEMENTED AND TESTED
 7  Draft composition — Mode A instant / Generate format         IMPLEMENTED AND TESTED
 8  AI path A — Report Composer job → proposal → gated apply     IMPLEMENTED AND TESTED
 9  AI path B — overnight shadow draft → AiDraftPanel staging    PARTIALLY IMPLEMENTED
10  AI path C — interactive /api/ai-reporting/*                  PARTIALLY IMPLEMENTED
11  AI path D — comparison workspace                             ROUTE TESTED, CI-SKIPPED; SCREEN UNVERIFIED
12  Output validation (validateComposerOutput)                   PARTIALLY IMPLEMENTED
13  Draft save / reload round trip                               IMPLEMENTED AND TESTED (DB-gated)
14  Findings ↔ Impression consistency                            IMPLEMENTED AND TESTED
15  Recommendation                                               PARTIALLY IMPLEMENTED
16  Preview, print, PDF                                          IMPLEMENTED AND TESTED
17  Finalize and sign                                            IMPLEMENTED AND TESTED
18  Verify / countersign                                         IMPLEMENTED BUT UNVERIFIED
19  Deliver (WhatsApp / HOPE / public link)                      out of scope of this document
20  Withdraw signature                                           IMPLEMENTED AND TESTED
21  Amend                                                        PARTIALLY IMPLEMENTED (no UI)
```

---

## 1. Study arrives — IMPLEMENTED AND TESTED

Orthanc changes are polled (`lib/pacs/orthancChangesPoller.ts`), metadata is fetched as DICOM-JSON
from `/dicom-web/studies/{uid}/metadata` (`:258-270`), and rows are written to `dicom_studies` through
the internal intake endpoint (`:274-300`; flat tag columns at `lib/db/src/schema/dicomStudies.ts:16-65`).
Where a DICOM-SR is present, `parseDicomSr` (`lib/usgExtractor.ts:318+`) walks
`ContentSequence (0040,A730)` NUM items recursively with vessel/side context (`:347-359`), maps
SNOMED/DICOM concept names to measurement keys (`:593-602`) and groups Doppler PSV/EDV/RI/PI (`:542`).
Results land `pending_review`; the extractor never auto-finalises (`usgExtractor.ts:5-11`).

At intake, two automations fire and both are explicitly non-blocking with a logged failure
(`routes/internal-radiology.ts:1044-1060`): a DICOM automation, and
`scheduleStudyOnDicomArrival({ studyInstanceUid, modality })` — the entry point for the overnight AI
draft.

**Grade reason:** the poller and the SR extractor have callers and tests; the intake automation is
fire-and-forget by design, and a silent failure is logged, not surfaced.

## 2. Worklist triage, claim, lock — IMPLEMENTED AND TESTED

Two worklists are served: `/api/radiology/worklist` from `radiology_studies` (RIS/billed,
`routes/radiology.ts:340`) and `/api/radiology/pacs-worklist` from `radiology_worklist` (PACS-pushed,
`:522`). The SPA fetches both (`pages/RadiologyWorklist.tsx:493`, `:838`).

Claiming is server-owned: `POST /api/radiology/worklist-lock/:id/{claim,heartbeat,release,force-release}`
(`routes/radiology-worklist-locks.ts:39,55,64,76,87`), owner identity always derived from the staff
session (header comment `:6-8`), mounted `routes/index.ts:862`. The workspace auto-claims on open
(`useWorkspaceClinicalUi.tsx:839` → `hooks/useStudyLock.ts:112`).

**Tests:** `lib/studyLockRules.test.ts:37-108` — a pure decision table: expiry anchored on
`last_activity_at`, a corrupt owner row reads expired, an active foreign lock is never stealable, an
expired lock is reclaimable visibly, same-user re-claim refreshes, completed studies refuse claims.

**Trap carried forward:** a lock-column schema drift serves the queue *without locks* rather than
erroring (`radiology.ts:428-455`).

## 3. Open the reporting workspace — IMPLEMENTED AND TESTED

`navigate(reportingWorkspacePath(entry.id))` (`RadiologyWorklist.tsx:2148`, `:2189`) →
`/radiology/report/:studyId` (`App.tsx:493`) → `<RadiologyReportingWorkspace studyId={…} />`
(`App.tsx:145,494`). There is **one** reporting surface; `usgWorkspaceContract.test.ts:153` asserts
the unrouted legacy page stays absent.

**The id hazard at this step.** `radiology_report_drafts.study_id` canonically holds the **worklist
ROW** id (`lib/radiologyIdentity.ts:110` — "Always the worklist row id"; also
`lib/spinalCanalApTable.ts:68-69`, `routes/patient-reports.ts:2271`), while
`GET /api/patient-reports/from-study/:id` is keyed on `radiology_studies.id`. Every reader must
dual-resolve; `resolveWorklistFromStudyRef` tries the worklist PK first, then `study_id`
(`radiologyIdentity.ts:78-90`). The Composer refuses the `drafts.study_id` fallback for exactly this
reason (`lib/reportComposer/composeIdentity.ts:250-275`).

## 4. Image review — IMPLEMENTED AND TESTED (DB-gated)

The browser never talks to Orthanc. All QIDO/rendered traffic goes through a same-origin proxy
`/api/radiology/dicom-web` (`lib/pacsImagePicker.ts:14` via `browserDicomWeb.ts:12`; handlers
`routes/pacsEnterprise.ts:788,807,826,851`), server-side Basic auth from `ORTHANC_USERNAME/PASSWORD`
(`:752-772`). The proxy forwards only `quality`, `viewport` and tag-number `includefield`
(`:778-786,834-836`), validates UIDs against the `LAUNCH_UID` regex (`:790,809,830`), times out at
12 s and turns errors into null → 502 (`:763-768`).

Pixels come from Orthanc `/rendered` JPEG (`:834-847`). The picker dialog is rendered in the workspace
at `components/radiology/workspace/ViewerColumn.tsx:673`, trigger `openPacsPicker` (`:458-478`, which
silently ensures a draft first). UI caps: 100 picks per session
(`PacsImagePickerDialog.tsx:28`), ≤200 frame buttons per multiframe (`pacsImagePicker.ts:93`).

**What is not here:** no window/level control (Orthanc does the windowing), no WADO raw-object
download, no DICOM `ImageOrientationPatient` handling on the AI path, no automated image-quality check.
Orientation is only sharp's EXIF `.rotate()` at write time (`lib/frozenKeyImages.ts:90`). Scan quality
is a **manual** enum on a technician form — `good|acceptable|repeat_needed`
(`routes/dicomWorkflow.ts:52`).

**Tests:** `routes/pacsImagePicker.request.test.ts`, 12 cases — **DB-gated**
(`describe.skipIf(!hasDatabaseUrl())`), so skipped in CI without `DATABASE_URL`.
`lib/pacsPickerWiring.contract.test.ts` runs in CI but is a source-shape assertion.

## 5. Attach key images to the draft — IMPLEMENTED AND TESTED (DB-gated)

`POST /api/radiology/report-generator/key-images/from-pacs`
(`routes/radiology-report-generator.ts:3660`; dialog caller `PacsImagePickerDialog.tsx:133`). The
**server re-fetches the pixels itself** at print quality (`?quality=95&viewport=2000,2000`,
`lib/reportImages.ts:171-183`) — client bytes are not trusted for the stored image — normalises with
sharp (autorotate, max edge 1800 px, JPEG re-encode, `frozenKeyImages.ts:39,90-110`), writes the file,
and inserts a `radiology_report_key_images` row with `sourceType:"DICOM"`, `viewer:"ORTHANC"` and
verified UIDs (`:3779-3804`).

**Guards before storage, in order:** `assertDraftWritable` → `assertImageUidBelongsToDraft` →
`verifyImageIdentityClaim`; a contradicted claim → 409 (`:3676-3715`). UID regex + frame 1..10,000 zod
validation (`:3643-3657`). Duplicate SOP+frame → 409 (`:3754-3763`).

**Gap at this step:** no byte-limit check *at attach time*. The 2.5 MB/image and 8 MB/total limits
apply at compose and print time (`lib/reportComposer/resolveSelectedKeyImages.ts:26-27`,
`frozenKeyImages.ts:37`), so an arbitrarily large render can be stored and only fails later.

**Tests:** the same DB-gated `pacsImagePicker.request.test.ts` — asserts the stored row carries
PACS-confirmed identity not browser-claimed, a cross-study attach is refused and leaves no file or row,
per-frame multiframe attach works, and a down PACS cannot fabricate a row. `keyImageOwnership.test.ts`
(pure) + `.request.test.ts` (DB-gated).

## 6. Structured entry — Quick Select → observation ledger — IMPLEMENTED AND TESTED

Boxes load from `radiology_quick_findings` via `lib/zai-workspace/quickSelectBoxCatalogue.ts`, behind
`/api/radiology/quick-select` (`routes/index.ts:938-943`), scoped by `lookupTilesForContext`
(`quick-select-library.ts`). Applying a box writes a `CanonicalObservation` into
`appliedPathologyPatches` in the store; identity is `region|concept|level|laterality`
(`lib/reportComposer/types.ts:11-15`, `snapshot.ts:33`), with `measurement` in the input hash but not
in identity (`types.ts:20-23`).

**The ledger has no server table.**

```
$ grep -rn "pgTable(" lib/db/src/schema/*.ts | grep -i observation
(no output)
```

It persists only as `observationLedger: serializeObservationLedger()` inside the draft's
`structured_json` (`hooks/radiology-workspace/useDraftPersistence.ts:495`; column
`structuredJson: jsonb` at `lib/db/src/schema/radiologyReportGenerator.ts:42`). **No route can query,
audit or validate it.** The server sees observations only frozen inside a compose job's
`input_snapshot_json` (`lib/db/src/schema/aiReportComposer.ts:73`).

**Tests:** `radiologyWorkspaceDraftRoundTrip.request.test.ts:250-336` — R1 narrative boxes saved
byte-for-byte; **R2 the ledger survives with both sided rows and provenance**; R3 applied-format
identity survives; R5 the reload route returns the same envelope; R7 a save without spine state keeps
the stored one. **DB-gated.**

**Trap:** `structured_json` has a bounded payload size (`useDraftPersistence.ts:498`); an oversized
ledger can silently miss a save, and the user-facing warning at `:560` admits measurements/ledger "may
be missing if you reopen".

## 7. Draft composition — Mode A instant report / Generate format — IMPLEMENTED AND TESTED

Two deterministic composition doors, neither of which calls a model.

**Mode A (automatic, default ON).** `RadiologyReportingWorkspace.tsx:12` →
`useWorkspaceClinicalUi.tsx:1971-1995` debounced effect (700 ms,
`lib/zai-workspace/instantReport.ts:41`) → `store.ts:2363 composeInstantReport` →
`decideInstantReport` (`instantReport.ts:82-108`) → `generateProfessionalReport(ctx,
{automatic:true, requireOwnedApprovedNormal:true})` (`store.ts:2391`). Default ON because an absent
localStorage key means enabled (`instantReport.ts:165-167`, key
`care.instantReport.modeA.enabled` at `:37`). It **holds** on: off, locked, an open confirmation, a
hand-written Impression, or a first merge over dictation. An automatic pass that cannot conclude holds
the Impression and shows `IMPRESSION_UNDECIDED_HOLD`.

**Generate (explicit).** `store.ts:1972` → `resolveNormalBootstrapFormat`
(`normalBootstrap.ts:232-415`) → `applyFormatById` — the same path as a manual click.

**Auto-selection filters:** modality whitelist MR/CT/XR (`normalBootstrap.ts:50-60`), canonical region
(`:248-253`), complete-normal-only with an in-sentence pathology assertion test (`:63-125`), a cap by
the recorded region-transition ceiling (`:278-300`), regex disambiguation of
contrast/epilepsy/stroke/screening/orbit (`:79-84`, `:303-373`), preferring Templates-screen rows with
owned manifests (`:393-395`) then owned baselines (`:399-400`), requiring exactly one survivor else
`ambiguous` (`:404-414`). On no match the user is told "Choose a format in Starting Canvas"
(`:199-230`).

**Coverage is pinned by a test, not a claim:** `normalBootstrapCoverage.test.ts:12-49` — `AUTO_OPEN` =
12 identities (MR Brain / Cervical / Dorsal / LS / Whole Spine / Knee / Pelvis / Shoulder, CT Brain /
Chest / PNS, XR LS Spine; `:120-133`), `MANUAL_GAPS = []` (`:138`), MG and US never (`:202`).

**Tests:** `instantReport.test.ts:111-309` — decision table, only clinic-approved manifests auto-build,
a real-store pass builds with **zero network calls**, idempotent second pass, never rewrites a
hand-written Conclusion. `generateProfessionalReport.test.ts:98-241` — builds from empty; refuses
signed / unidentified / confirmation-open / library-loading / no-approved-normal; keeps dictated text
and the existing recommendation; idempotent; retires contradicted normals.

**Two switches, one visible:** the clinic setting `reportComposerAutoCompose`
(`lib/db/src/schema/clinicSettings.ts:268`, checkbox at `AiReportingSettings.tsx:1494`) is stored and
read by nothing. Mode A obeys its own localStorage key.

## 8. AI path A — the Report Composer — IMPLEMENTED AND TESTED

**This is the only AI path a radiologist can start from the reporting canvas.**

```
ReportComposerAssistant → useReportComposer.composeFull / composeImpression / refineReport / microEdit
  → POST /api/radiology/report-composer/jobs          (routes/reportComposer.ts:140)
  → snapshot frozen with content hashes + server-derived baseline token
                                                      (lib/db/src/schema/aiReportComposer.ts:58-110)
  → enqueueRadiologyJob                               (jobService.ts:384)
  → handler registered                                (radiologyJobHandlers.ts:294-300)
  → consumer started at boot, concurrency 1           (cron.ts:74 → :209 → :244-254)
  → processComposeJob → runReportComposer             (jobService.ts:421, composeEngine.ts)
  → resolveSelectedKeyImagesForCompose                (composeEngine.ts:571)
  → assertVisionCapableModel                          (visionCapability.ts:28-116)
  → provider call, or deterministicComposeFromSnapshot (composeEngine.ts:452, :905)
  → validateComposerOutput                            (validateOutput.ts:1889)
  → READY proposal of TrackedChange[]
  → radiologist accepts change by change              (reportComposer.ts:262, :275)
  → applyAccepted → materializeAcceptedText           (useReportComposer.ts:420, :507)
  → applyAiComposerAccepted                           (store.ts:4591)
  → draft saved, then POST /jobs/:id/applied          (reportComposer.ts:298)
```

**Eight of eleven job kinds are reachable.** FULL_REPORT and IMPRESSION
(`useReportComposer.ts:627-629`); SECTION_EDIT / SELECTION_EDIT via `refineReport` (`:607` +
`lib/reportComposer/refineTarget.ts:22,46,56`); TRANSLATE / SHORTEN / EXPAND / REPHRASE via micro-edit
(`:630`, mapping `WorkspaceOverlays.tsx:583`).

**[double-read] PROFESSIONALIZE, COMBINE and OBSERVATIONS have no ERP caller** — only a type union
(`lib/reportComposer/api.ts:14,16,18`), a test, and a kind→section map
(`lib/storedReportBody.ts:41`). The settings test panel posts only `/test`, `/test/compare`,
`/vision-trial` (`AiReportingSettings.tsx:253,279,304`).

**Apply is gated four ways.** (1) Freshness: a blind apply is blocked when the report moved since the
draft (`useReportComposer.ts:429`, `:471`), and the server flips READY→STALE_READY on an `inputHash`
mismatch (`api.ts:49-76`, `useReportComposer.ts:152-160`). (2) Explicit Accept required for clinically
significant changes (`:476-486`). (3) Signed reports refuse through one witness,
`refuseSignedMutation` (`store.ts:4619` → `:538`). (4) An undo frame is pushed before the write, and a
server refusal rolls back via `undoLastPatch` (`:551-560`).

**Applied text is attributed:** every sentence is marked provenance `ai-draft` (`store.ts:4620-4633`),
and `deriveImpressionDependency` re-runs (`:4653`).

**Can Apply overwrite manual text?** Yes — but only text explicitly Accepted, only as a **whole-field
replace** (`trackedChanges.ts:34-51,105-122`), never on a signed report, never without an undo frame,
never silently. The granularity is the sharp edge: accepting one FINDINGS change swaps the entire
Findings field, not the sentence.

**`POST /jobs/:id/applied` does not write clinical text server-side** (comment
`reportComposer.ts:289-291`); `markComposeApplied` (`jobService.ts:902`) re-resolves the target study
from server rows and refuses a cross-patient apply. **The clinical write happens in the browser.** The
server's role is authorisation and receipt, not composition — which is why the identity and freshness
guards matter more than they would in a server-applies design.

**Tests:** `routes/reportComposer.request.test.ts:72-178` — POST `/jobs` returns 202 with a jobId
without waiting for a model; `/diagnostics` exposes `defaultProvider=ollama`; **process-now completes
without mutating patient reports**. Plus `applyFreshnessRace.test.ts`,
`composePersistence.contract.test.ts`, `composePersistence.request.test.ts`,
`softFinalAiGuard.request.test.ts`.

## 9. AI path B — the overnight shadow draft — PARTIALLY IMPLEMENTED

**It runs.** Two enqueue triggers: `scheduleStudyOnDicomArrival` at DICOM intake
(`routes/internal-radiology.ts:1050-1055`), and the cron night batch
(`cron.ts:132` → `schedulerService.runNightBatch`), with weekly reprocessing (`cron.ts:143`) and weekly
learning aggregation (`:153`). Registered under `ff_radiology_ai` with a peak-hours hold
(`cron.ts:128-130`, console line `:158`). Jobs land on `dicom_retry_queue` with
`operationType = "ai_shadow_pipeline"` (`shadowPipeline.ts:34,65-69`), consumed by a cron tick with
`claimStrategy: "overnight_ai"`, `maxJobs: 1`, legacy-backlog hold and a fail-closed
`ops_unreadable`/`peak_hold` skip (`cron.ts:338-370`). The handler is
`makeAiShadowPipelineHandler({ provider: gatewayInferenceProvider })`
(`radiologyJobHandlers.ts:290`).

**It is surfaced.** `AiDraftPanel` (copilot rail, Orient stage, `copilot-rail.tsx:67`) reads
`GET /api/ai/draft` (`routes/aiClinical.ts:65`, via `aiClient.getDraft`, `aiClient.ts:103-106`) and
stages per-finding through `onStageProposal` — "Accept stages for Composer Apply — AI never writes the
report alone" (`AiDraftPanel.tsx:88-99,155-157`). Empty/quarantined reasons render from
`worklistAiDraftViewer.ts`, classified by `shadowDraftUsability.ts:87-165` (READY / EMPTY /
QUARANTINED with `emptyReason` + `providerFailureCode/Detail`), persisted into the worklist pointer
JSON (`:168-201`).

**Why PARTIAL.**

1. **The gateway it runs through does not route.** `gatewayInferenceProvider.ts:308-332` calls
   `requestStructuredReport` with `call` and `selectChain` both injected (`:321`, `:322-330`), so the
   chain, retry and breaker logic never executes; the call is a schema validation over text already
   produced by a direct `generateAiResponse` at `:109`.
2. **Its capability source is empty.** The chain it injects is one entry built from the authoritative
   provider, with `modelDigest: null` (`:326`) — because `ai_model_capabilities` has never had a row
   written (§1.9 of the current-state doc).
3. **Its results are not measured.** `runEvaluation` has no caller and `ai_golden_cases` has no writer,
   so nothing on this platform can say whether a shadow draft was good.
4. **Nobody is required to read it.** It is a panel in a rail stage, not a gate.

**Tests:** `gatewayInferenceProvider.localOnly.test.ts`, `.failureNaming.test.ts`,
`shadowPipeline.failureNaming.test.ts`, `shadowDraftUsability.test.ts` (11 pure tests). All mocked.

## 10. AI path C — interactive `/api/ai-reporting/*` — PARTIALLY IMPLEMENTED

60+ endpoints (`routes/aiReporting.ts:392-3890`) mounted at `routes/index.ts:1029` with
`requireStaffAuth` only — settings, test-provider, query, egress-preview, draft, polish, image-review,
previous-reports, compare, audit-log, drafts, insert-to-report, quality-scores, rag, anomaly,
billing-suggestions, voice-transcriptions.

Target resolution is sound: `resolveInteractiveTarget` (`interactiveAiGateway.ts:79-135`) with
precedence request → task-route → settings default → global default, refusing disabled providers
(`:110-118`); execution fails closed on a provider-identity mismatch (`:255-271`).

**Why PARTIAL.** These endpoints are reachable from **settings and admin panels**, not from the
reporting canvas. The canvas calls only `/api/radiology/report-composer/*` (`api.ts:20-139`). The
panels that do reach them — `LocalAiPanel.tsx:60-123`, `MultiAIReviewPanel.tsx:212-289`,
`AiPipelineSelfTestPanel.tsx:120-163`, `OllamaAiDraftVerifyPanel.tsx:76-136`,
`AiReportingSettings.tsx:519-638` — live under `/radiology/advanced-tools` and the Settings hub. A
radiologist reporting a study does not pass through them.

**And one hole:** copilot `Insert` appends AI text via `insertCopilotText` (`copilot-rail.tsx:70`)
**without a tracked-change record**, so it is not covered by the unreviewed-AI finalize gate that
guards composer output. See `AI_COMPOSER_GAPS.md` G-3.

## 11. AI path D — the comparison workspace — ROUTE TESTED (every case CI-skips); SCREEN UNVERIFIED

`POST /api/ai-comparison/run` (`routes/aiComparison.ts:103-239`) runs up to 6 arms
(`{provider, model}` each, `resolveArms :66-97`) over ≤6 images × ≤3.5 M base64 chars (`:36-55`),
against a `studyInstanceUid` validated to exist in `radiologyStudiesTable` (`:168-179`). Egress is
resolved once per request (`:181-184`) and spread into every call (`:189-192`); `imageSourceTypes` is
deliberately omitted so browser-supplied bytes are treated as unprovenanced (`:157-162`). Per-arm it
returns the model that actually answered, `locality`, `attempted` (false = policy stopped it before any
bytes left), `imageCount`, `elapsedMs`, `aiSafetyLabel` (`:217-234`), and writes one audit row per arm
(`:196-215`).

`POST /save-winner` (`:285-318`) writes **only an audit row**. No draft, report or observation write
exists in the file; the UI banner says "Nothing here has touched the report or the observation ledger"
(`AiComparisonWorkspace.tsx:600-606`); the only export is clipboard copy (`:581`).

**Why this is graded the way it is.** The route **is** tested — 18 request-level cases at this pin, 29
by `1c80f2d3`, all inside `aiReporting.imageEgress.request.test.ts`. This section previously said
"zero tests", which was wrong: the grep found the file and the finding dismissed it as "the `/query`
egress suite" without opening it. What is actually true is narrower and still matters:

- Every one of those 18 sits behind `const maybe = hasDatabaseUrl() ? describe : describe.skip`
  (`:52`), so with no `DATABASE_URL` they skip and CI reports green. Verified in CI, this route has
  never been exercised.
- `pages/AiComparisonWorkspace.tsx` has no test of any kind (`git grep -l AiComparisonWorkspace origin/main
  -- '*.test.ts' '*.test.tsx'` → exit 1, no match; the only non-test importer is `App.tsx`). The picker,
  the arm chips, the attestation checkbox and the result cards are unexercised.

The coverage that does exist is good: it proves arm resolution from both request shapes, the ≤6 arm and
≤6 image ceilings, an oversized image stopping the whole set, an unknown study refused before any socket
opens, a policy stop surfaced as `attempted:false` rather than a model failure, one audit row per arm,
`save-winner` creating a preference and no report, and a 401 that never reaches a provider.

Also: `save-winner` does not verify the response came from the provider/model named — the text,
`provider` and `model` are all client-supplied (`:291-299`) and are written into the audit row as if
observed — and the study-UID check proves the UID exists in this clinic's RIS, not that the pixels came
from it (`:163-167`). `save-winner` is at `:285-318` at this pin and `:403-436` at `1c80f2d3`.

## 12. Output validation — PARTIALLY IMPLEMENTED

`validateComposerOutput` (`lib/reportComposer/validateOutput.ts:1889`, 2230-line file) refuses:

| Rule | Line |
| --- | --- |
| Missing measurements | `:177` |
| Laterality swaps | `:227` |
| Level changes | `:281` |
| Severity escalations | `:302` |
| Definite clinical mutations (umbrella) | `:332` |
| Canonical canal divergences | `:551` |
| Conservation losses (measurement/level/laterality/severity/morphology/location dropped, grade changed, section dropped) | `:880` |
| Clinical relation losses | `:1309` |
| Dropped observations | `:1616` |
| Ungrounded observation rows pruned | `:1705` |

A failure fails the job with **no partial write** (`jobService.ts:566-581`).

**Missing: an unresolved-placeholder check.** There is no rule for `___ mm` or `{token}`:

```
$ grep -n "___\|placeholder\|{token}\|unresolved" artifacts/api-server/src/lib/reportComposer/validateOutput.ts
1743:        if (!dictationMeasurements.has(token)) problems.push(`measurement ${token}`);
```

One hit, and it is about measurement tokens in dictation, not placeholders. The same class **was**
closed on the Quick Select path (PR #1057), so the validator vocabulary and the finalize-side
placeholder guard already exist elsewhere in the codebase — the Composer validator simply does not
call them.

**Also missing:** nothing enforces the three-way clinical distinction the Stage-1 architecture
requires — *abnormality demonstrated* vs *no abnormality identified in adequately visualized anatomy*
vs *anatomy or sequences not sufficiently evaluated*. The prompt asks for it
(`composeEngine.ts:274-276`: "supporting evidence only; observations remain authoritative", "Do NOT
claim complete MRI review. Absence on these frames is not proof of normality"), and
`pruneUngroundedObservationRows` (`:1705`) removes rows with no support, but a *prompt request* is not
a validator rule.

## 13. Draft save / reload round trip — IMPLEMENTED AND TESTED (DB-gated)

`POST /api/radiology/report-generator/save-draft` (`radiology-report-generator.ts:1717`); drafts listed
at `:2061`, read at `:2209`, validated at `:2115`, print-previewed at `:2227`.

The restore path reads back: care structured format state, **the observation ledger**, viewer
measurements, canal AP provenance, spine reporting state (numbering / sequences / screening /
impression-order-frozen), vascular technique, region transitions (ADR-004), quick-select ids and linked
studies (`useDraftPersistence.ts:290-345`).

**It does not read back `fieldProvenance`.** The save writes `observationLedger` (`:495`) but no
provenance; the only `fieldProvenance` write in the file is `fieldProvenance: {}` at `:259`, which is
the *different-patient refusal* branch. So AI-attributed **narrative prose** loses its `ai-draft`
attribution on reload, while a **ledger row** does not. This is the mechanical reason the Stage-1 plan
insists image-derived findings be written as observations rather than as prose.

**Tests:** `radiologyWorkspaceDraftRoundTrip.request.test.ts:250-336` (R1/R2/R3/R5/R7 above).
**DB-gated.**

## 14. Findings ↔ Impression consistency — IMPLEMENTED AND TESTED

Enforced in four client-side places:

1. `deriveImpressionDependency` (`store.ts:602-630`) re-evaluates after every write and arms
   `impressionNeedsRefresh` with a persisted `impressionBasis`.
2. Merge doors withhold normality sentences over recorded abnormalities — `withheldMergedImpression`
   (`mergeImpressionGuard.ts:25-36`).
3. Whole-report doors withdraw a contradicted normal FINDING as a **suspension recorded on the abnormal
   row** (`withdrawSupersededNormals.ts:1-30`, `prepareNormalSupersession`) — so the normal is
   restorable, not deleted.
4. `normalBootstrap.ts` only *chooses* a format; applying goes through the same `applyFormatById` path
   as a manual click, so it inherits rules 2 and 3.

**Tests:** `mergeDoorFollowsQuickSelectRules.test.ts`,
`withdrawSupersededNormalFindings.test.ts`, `normalBootstrap.test.ts` / `.scenes` / `.ownership` /
`.billedName`, `impressionRecommendationWiring.test.ts:8-34` (a Section-5 contradiction validator
flags a spinal level mismatch and "normal impression with pathology findings").

**Structural limit:** all four are client-side. With no server observations table (stage 6), a
crafted `save-draft` request can persist a Findings/Impression pair that contradicts itself, and no
server rule would refuse it. `POST /validate-draft` (`:2115`) exists but is a helper, not a gate on
the write.

## 15. Recommendation — PARTIALLY IMPLEMENTED

Observations may carry `recommendationText` (`lib/reportComposer/types.ts:27`, "radiologist-supplied
recommendation contribution"). `alignRecommendationToObservations`
(`lib/impressionRecommendationWiring.ts:20-60`) merges each non-stale observation's recommendation
sentences into the Recommendation box with provenance, keeping existing sentences and anything typed by
hand; untouched when no observation owns one. Called from the Quick Select apply path (`store.ts:3182`)
and the withdraw/restore path (`:4245`); the clinical-significance chip merge appends only if not
already said (`:2163`).

The AI may *propose* Recommendation — it is one of three tracked-change fields
(`trackedChanges.ts:94-101`) — but only via explicit Accept. The deterministic fallback fills it from
`snapshot.recommendation` or the first observation contribution (`deterministicCompose.ts:88-95`).
Mode A keeps whatever is already on the page (`generateProfessionalReport.test.ts:200`).

**There is no inference engine that derives a recommendation from findings.** It is a merge of
template-supplied sentences plus a free-text box.

**Traps:** `alignRecommendationToObservations` never *removes* a recommendation when its observation is
withdrawn by a path that does not call it, and stale-flagged patches are skipped
(`impressionRecommendationWiring.ts:38`) — so a stale row's recommendation can persist on the page.

## 16. Preview, print, PDF — IMPLEMENTED AND TESTED

Two independent renderers.

**Client (workspace export):** jsPDF + jspdf-autotable (`lib/reportPdfGenerator.ts:13-14`, 1442 lines)
built from live editor state, embedding selected key images fetched over DICOMweb
(`lib/radiologyReportPdfExport.ts:2-24`; call site `useWorkspaceExportShare.ts:357`).

**Server (signed and report-hub surfaces):** GET `/api/patient-reports/:id/print` and `/:id/pdf`
(`routes/patient-reports.ts:3524,3558`) render the **stored `patient_reports.body`** as trusted HTML
through `renderReportDocument` (`renderReportVersionHtml :3182`; `lib/reportPresentation.ts:1-24` —
"every rendered report surface flows through renderReportDocument"); `/pdf` rasterises with headless
Chromium (`lib/htmlToPdf.ts:13-16`). **The stored signed body drives the paper**, not a re-render from
structured data (except the D6 flag-gated structured read at `:3203-3208`).

**Draft preview:** GET `/api/radiology/report-generator/drafts/:id/print-preview`
(`radiology-report-generator.ts:2227`) renders the last **saved** draft row through the presentation
template; the client merges unsaved editor text into it (`radiologyReportPrintLiveMerge.ts:1-8`) and can
pop up with `autoPrint=true&likeFinal=true` (`useWorkspaceExportShare.ts:424`).

**Offline proof harness:** `pnpm preview:reports` (`package.json:23`) runs
`lib/reportPreviewHarness.test.ts` (975 lines) over synthetic cases and writes `tmp/report-preview/` —
per case a `.pdf`, `.print.html`, `.screen.html`, `audit.json`, plus `index.html`
(`:747-770,796-807`). `scripts/preview-reports.mjs:38-46` refuses to open the output if the harness
fails. No server, no database, nothing stored, output watermarked PREVIEW/DRAFT (`:13-15,751`).

**Tests:** the harness asserts on **rendered print HTML** — bold impression (`:754`), bold-findings
counts (`:757-760`), advice presence/absence (`:763-768`) — and on the PDF only as byte length > 2000
(`:747`). But `reportPdfGenerator.pagination.test.ts:147-251` **does** assert rendered-PDF content
against source text: an instrumented jsPDF captures placed text and the test proves every clinical token
of findings/impression/history/technique/measurements appears, and none lands in the footer band. Also
`radiologyReportPdfExport.test.ts:8-88`, `reportPrintRoute.test.ts`,
`reportPresentation.printLayout.test.ts`, `.markdown.test.ts`, `e2eAcceptancePdfGeneration.test.ts`.

**Missing:** no common engine between the two renderers. Parity rests on shared conventions
(`reportPresentation.ts:50-58` mirrors `parseInlineMarkdown`), not shared code. Live-merge print is
withheld for signed reports (`reportPrintRoute.test.ts:26`).

**Trap:** `/print` (not the preview) writes delivery bookkeeping — share log,
`markDeliveredIfVerified` (`patient-reports.ts:3541-3548`). Printing is a clinical event.

## 17. Finalize and sign — IMPLEMENTED AND TESTED

```
FinalizeSignDialog → useFinalizeFlow → useStudyFinalize
  → buildSignedReportBodyHtml  (CLIENT renders the body)   useStudyFinalize.ts:434
  → POST /api/patient-reports  (body stored verbatim)      radiologyReportLifecycle.ts:639,652
  → POST /api/patient-reports/:id/sign                     patient-reports.ts:2436
  → POST /api/internal/radiology/report-status             internal-radiology.ts:1076
```

**Sign** freezes signer identity from server facts only (`patient-reports.ts:2584-2615`: signatureId,
signedByName, signedAt, status `pending_verification`), then `freezeSignedReportPresentation`
snapshots the resolved presentation template **and patient/study identity** into
`radiology_report_presentation_freeze` (`:2617`, `:3129-3150`; `presentationTemplateStore.ts:408`).
Sign does not rewrite the body — it stamps and freezes.

**Guards, in the order they run:** deny-roles (`:2444`) → already verified (`:2454`) →
structured-signed 409 pointing at `/verify` countersign (`:2465-2478`) → already_signed 409 pointing
at withdraw-signature (`:2482-2511`) → **the unreviewed-AI gate (`:2517-2531`)** → the content guard
`assessSignableContent`/`classifySignedReportBody` (`:2536-2560`).

**AI cannot sign, server-side.**

```
$ grep -rn "checkUnreviewedAiFinalize" artifacts --include=*.ts | grep -v '\.test\.'
routes/internal-radiology.ts:51    (import)     :1248 (call)
routes/patient-reports.ts:50       (import)     :2122 (call, POST /)   :2518 (call, POST /:id/sign)
```

Three call sites. `SIGN_DENY_ROLES = new Set(["typist","ai","system","bot"])`
(`lib/radiologyD1FinalWriter.ts:76`), enforced at `:91,:113` and again at `patient-reports.ts:2444`.
The guard **fails closed** — a database error yields "unknown", which refuses
(`unreviewedAiGuard.failClosed.test.ts`).

A blank report cannot be signed. The refusal names its own remedy
(`lib/signedReportContentGuard.ts:354-375`): *"This report has no authored content, so it cannot be
finalized or signed as a blank document… Pass contentOverride: true with a contentOverrideReason of at
least 3 characters… attributed and audited"* — and the override is audited as
`signed_content_override` (`:2566-2581`).

**Post-sign, exactly zero in-place writers exist for body, title, impression and parameters.**
`classifySignedReportPatch` (`lib/signedArtifactGuard.ts:31,91-128`) refuses them with: *"A signed
report cannot be edited in place. To correct it, withdraw the signature from Report Hub — only the
signer or an administrator can. A verified or delivered report cannot be withdrawn."* The client store
refuses 21 guarded mutators through one witness, `refuseSignedMutation` (`store.ts:538`).

**Tests:** `signedReportContentGuard.test.ts:80-123` (five producers' real body shapes including the
em-dash sentinel); `signedContent.request.test.ts:316-451` (blank finalize refused and nothing
written; positive control; override signs + audit row; override needs flag AND reason; refusal
audited); `signedArtifactGuard.test.ts:28-85`; `patient-reports.d9.test.ts:295-382` (session-only
signer identity; structured-signed 409; a typist can never sign; countersign commits row + audit
together); `finalizeDialogResult.contract.test.ts`.

**Traps.** The signed body is **client-rendered HTML trusted verbatim server-side**
(`radiologyReportLifecycle.ts:118`; rendered as trusted HTML — `signedReportContentGuard.ts:6-8`).
POST `/` create is idempotent for an already-bound worklist and **discards a new body**
(`:2141-2145` comment) — re-finalizing cannot repair a blank signed draft. The presentation freeze is
best-effort (`catch {}`, `:3149`); a failed freeze silently falls back to live template selection
(`presentationTemplates.ts:47-49`).

## 18. Verify / countersign — IMPLEMENTED BUT UNVERIFIED

`POST /api/patient-reports/:id/verify` (`patient-reports.ts:2639`). SPA caller
`WhatsAppReportShareDialog.tsx:113`. `patient-reports.d9.test.ts:295-382` covers "countersign commits
row + audit together".

**It does not call `checkUnreviewedAiFinalize`.** The three call sites are POST `/`, `/:id/sign` and
`internal-radiology.ts:1248`. Whether verify needs the AI guard depends on whether verify can be the
*first* signature on a report that carries unreviewed AI text — for a structured report, `/sign`
refuses and points at `/verify` (`:2465-2478`), which means **verify is the second signature on an
already-signed report**, so the first signature already passed the gate. That reading is consistent
with the code but is not proven by a test. Recorded as `AI_COMPOSER_GAPS.md` G-4.

## 20. Withdraw signature — IMPLEMENTED AND TESTED

`POST /api/patient-reports/:id/withdraw-signature` (`patient-reports.ts:2934-3060`) reopens the study
**in one transaction** (`:2999-3051`): authoritative re-read; report → `draft` with the signature
nulled (`:3007-3012`); the bound worklist row → `REPORT_IN_PROGRESS` with reportId/deliveryStatus
cleared (`:3032-3042`); `already_delivered` thrown *inside* the transaction (`:3028-3030`);
signer-or-admin only (`:2978-2991`); reason mandatory (`:2943-2947`); audited (`:2982-2988`). Client
caller `lib/reportSignatureWithdrawal.ts:113`.

**Tests:** `reportSignatureWithdrawal.test.ts:119-147` — the client gate mirrors the server refusals.

## 21. Amend — PARTIALLY IMPLEMENTED (no UI)

`POST /api/patient-reports/:id/amend` (`:1585`) requires a reason, the feature flag
`ff_radiology_structured_final` (`:1594`), structured sign authority (`:1598`), and a parent whose
`structuredJson` carries `audit.signature.state === "final"` plus a document_id (`:1610-1616`), in a
linear chain (`:1620-1627`).

**No ERP page calls it** — matching the route's own comment "no ERP page calls for" (`:2367-2369`). A
legacy-signed (non-structured) report cannot be amended at all (`:2490-2509`, `:2962-2968`);
correction requires withdraw + re-sign.

---

## Clinical reporting quality (objective 5)

Assessed against the requirement that *AI output must never silently replace manually entered clinical
content.*

### Professional language and structured anatomy

The Composer prompt carries twelve HARD GROUNDING RULES (`lib/ai/gatewayInferenceProvider.ts:19-50`)
and authority wording that is already shipped: *"supporting evidence only; observations remain
authoritative"* and *"Do NOT claim complete MRI review. Absence on these frames is not proof of
normality"* (`composeEngine.ts:274-276`). Persona and formatting come from
`lib/reportComposer/persona/index.ts:24` and `router.ts:102-113`.

Structured anatomy is carried by the canonical observation (`region|concept|level|laterality`,
`types.ts:11-15`) and by the Quick Select catalogue in `radiology_quick_findings`. **Grade: strong on
the deterministic side, prompt-only on the AI side.**

### Modality templates

Twelve auto-openable identities, pinned by `normalBootstrapCoverage.test.ts:12-49`: MR Brain / Cervical
/ Dorsal / LS / Whole Spine / Knee / Pelvis / Shoulder, CT Brain / Chest / PNS, XR LS Spine. MG and US
never auto-bootstrap, by design (`normalBootstrap.ts:15-17`). The Templates→normal-format adapter's
region map covers seven body parts and MRI/CT/X-RAY only (`structuredNormalFormats.ts:48-65`); a
structured row outside that map **silently yields no normal format** (`:86-87`).

### Normal vs abnormal

Handled by supersession, not by deletion. A contradicted normal FINDING is withdrawn **as a suspension
recorded on the abnormal row** (`withdrawSupersededNormals.ts:1-30`), so it is restorable; merge doors
withhold normality over recorded abnormalities (`mergeImpressionGuard.ts:25-36`). **Grade: IMPLEMENTED
AND TESTED, client-side only.**

### Highlighting and measurements

Bold impression items and bold-findings counts are asserted against **rendered print HTML**
(`reportPreviewHarness.test.ts:754,757-760`). Measurements are conserved by
`extractConservationMeasurements` (`validateOutput.ts:658`) and `detectMissingMeasurements` (`:177`);
a measurement mutation is refused (`:368` region of `detectDefiniteClinicalMutations`). The canal AP
grid has its own divergence rule (`:551`).

### Laterality

`detectLateralitySwaps` (`validateOutput.ts:227`); observation identity includes `laterality`
(`types.ts:11-15`); the ledger round-trip test asserts "both sided rows" survive
(`radiologyWorkspaceDraftRoundTrip.request.test.ts` R2).

### Findings–impression consistency

Four client-side mechanisms (stage 14) plus `deriveImpressionDependency` (`store.ts:602-630`).
**No server-side rule**, because there is no server observations table.

### Recommendations

Template-supplied sentences merged with provenance (stage 15). **No inference.**

### Manual editing and preservation of radiologist changes

This is the strongest part of the system, and it is enforced in depth:

| Protection | Where |
| --- | --- |
| Manual sentences are protected by source | `lib/pathologyPatch.ts:197-207` (`manual` / `radiologist-voice`) |
| Mode A holds on a hand-written Impression | `instantReport.ts:82-108` |
| Mode A never rewrites a hand-written Conclusion | `instantReport.test.ts:111-309` |
| Mode A keeps dictated text and the existing recommendation | `generateProfessionalReport.test.ts:98-241` |
| Composer Apply requires explicit Accept per change | `useReportComposer.ts:476-486` |
| Apply refuses when the report moved | `useReportComposer.ts:429,471`; server STALE_READY `api.ts:49-76` |
| Apply pushes an undo frame and rolls back on server refusal | `store.ts:4591+`, `useReportComposer.ts:551-560` |
| AI text is attributed `ai-draft` | `store.ts:4620-4633` |
| A report with unreviewed AI cannot be finalized | `unreviewedAiGuard.ts:146`, three call sites |
| AI can never be the signer | `radiologyD1FinalWriter.ts:76,91,113` |
| Signed reports refuse 21 mutators through one witness | `store.ts:538` |

**Two real weaknesses.** (1) `materializeAcceptedText` is a **whole-field replace**
(`trackedChanges.ts:34-51,105-122`) — accepting one FINDINGS change swaps the entire Findings field.
The undo frame and the explicit Accept are what make this survivable, not the granularity.
(2) Copilot `Insert` appends AI text with **no tracked-change record** (`copilot-rail.tsx:70`), so it
sits outside the unreviewed-AI gate.

### The verdict on "never silently replace"

**No silent replacement path was found on the Composer.** Every route from AI output to report text
passes an explicit Accept, a freshness check, an undo frame, or a signed-report refusal. The two
residual risks are granularity (whole-field replace) and attribution loss on reload
(`fieldProvenance` not persisted) — neither is silent replacement, and both are recorded as gaps.

---

## Two AI queues exist; one runs

Worth stating separately because it is the kind of divergence that misleads a reader of
`07-orchestration-and-night-processing.md`.

| Queue | Table | Enqueued by | Consumed by |
| --- | --- | --- | --- |
| Overnight shadow pipeline | `dicom_retry_queue` (`operationType = "ai_shadow_pipeline"`) | `schedulerService.ts:136` via `enqueueAiShadowJob` (`shadowPipeline.ts:65-69`), triggered by `internal-radiology.ts:1050` and `cron.ts:132,143` | `cron.ts:338-370`, handler `radiologyJobHandlers.ts:290` |
| Report Composer | `dicom_retry_queue` (`AI_REPORT_COMPOSE_JOB`) | `jobService.ts:384` | `cron.ts:74 → :209 → :244-254`, handler `radiologyJobHandlers.ts:294-300` |
| **`ai_job_queue`** | `aiJobQueueTable` | `routes/radiologyWorkflow.ts:261` | **nothing** |

```
$ grep -rn "aiJobQueue" artifacts/api-server/src --include=*.ts | grep -v '\.test\.'
routes/radiologyWorkflow.ts:18    (import)
routes/radiologyWorkflow.ts:229,231,232   (SELECT — a dashboard list)
routes/radiologyWorkflow.ts:261           (INSERT)
routes/radiologyWorkflow.ts:285,293,295   (UPDATE — status by hand)
```

Rows can be inserted and their status updated by hand, and a list endpoint renders them, but no worker
claims them. `aiScheduler.admitJob` (`lib/ai/aiScheduler.ts:120`) — the admission control that would
feed it — also has no caller. This is the G10 orchestration described in `07-orchestration…`: built,
exposed, not running.
