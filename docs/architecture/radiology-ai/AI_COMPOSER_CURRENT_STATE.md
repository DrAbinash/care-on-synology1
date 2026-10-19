# AI Composer — current state, verified

**What this document is.** A component-by-component reconstruction of what the AI reporting stack
actually does today, read from source at `origin/main 80a09df4` ("Composer/usability first (#1082)").
Every claim carries a `file:line`. Every *negative* claim ("nothing writes this table") carries the
exact command that proves it, so it can be re-run rather than trusted.

**What this document is not.** It is not the blueprint. `README.md` in this folder is a ten-year
*design* document; `00`–`19` are the phase reports for gates G1–G22; `STAGE1-*` are a plan for work
not yet done. This file is the only one here that describes the shipped system as it stands, and where
it disagrees with an older document, this one is right and the older one is marked stale in
`AI_COMPOSER_GAPS.md` §5.

**Companion documents.**

| File | Answers |
| --- | --- |
| `AI_COMPOSER_CURRENT_STATE.md` (this) | What each component is, does, and is missing |
| `AI_COMPOSER_WORKFLOW.md` | The patient→signed-report trace, stage by stage, graded |
| `AI_COMPOSER_GAPS.md` | The real gaps, each with the smallest safe correction |
| `AI_COMPOSER_NEXT_PHASE.md` | Prioritized PR sequence, and what is *not* a priority |

## Evidence convention

- **`file:line`** — read in this worktree at `80a09df4`. Not recalled, not quoted from another document.
- **`$ grep …`** — a negative claim. The command is printed so the reader can reproduce the absence.
  Absence claims rot fastest, so they are the ones most in need of a re-runnable proof.
- **VERIFIED / PARTIAL / STUB / DEAD** — the reachability grade used throughout:
  - **VERIFIED** — a live caller chain exists from a routed HTTP endpoint or a started cron consumer
    down to the code, and the code does what its name says.
  - **PARTIAL** — reachable, but a stage in the chain is missing, unenforced, or client-only.
  - **STUB** — exists and is routed, but returns a refusal or a constant by design.
  - **DEAD** — compiled, tested, and unreachable: no production caller writes to it or reads from it.

Two claims in this document were established independently by two separate read passes and agree; they
are marked **[double-read]**.

## 0. The one-paragraph answer

Radiology reporting in CARE is **deterministic-first and works**: the Quick Select catalogue, the
observation ledger, the normal-format bootstrap, the Findings↔Impression dependency, the print/PDF
renderers and the signing gauntlet are all live, tested and reachable. The **AI layer on top of it is
real but narrower than its own documentation implies**. Exactly one AI path is reachable from a
radiologist's click and produces report text — the Report Composer job queue — and it produces a
*proposal* that the radiologist must accept change by change. A second AI path (the overnight shadow
draft) runs on cron and produces a draft nobody is required to read. A third (interactive
`/api/ai-reporting/*`) is reachable from settings and comparison panels but not from the reporting
canvas. The capability-based provider routing described in `04-ai-gateway.md` is **DEAD**: its table
has never had a row written to it. Cloud image egress is closed by two independent doors, one of which
(`PixelEgressProof`) can never open because nothing in the repository can produce a proof. De-identification
is built, tested with 23 cases, and never called. None of this is a safety hole — the failures are all
in the deny direction — but it means the platform's *stated* architecture and its *executed*
architecture have diverged, and the divergence is invisible from the UI.

---

## 1. Component inventory

Eighteen components, in the order they are touched by a real study.

### 1.1 Radiology worklist

| | |
| --- | --- |
| Source | `artifacts/api-server/src/routes/radiology.ts:337-468` (GET `/worklist`), `:470-560` (`/pacs-worklist`, `/pacs-worklist-stream`, `/pacs-worklist/count`), `:1387-1443` (status update); `routes/radiology-worklist-locks.ts:39,55,64,76,87`; `lib/studyLocks.ts`; `lib/radiologyIdentity.ts:70-130,220-245`; `artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx`; `hooks/useStudyLock.ts:105-130` |
| Grade | **VERIFIED** |

**Two worklists, not one.** `/api/radiology/worklist` (`radiology.ts:340`) reads `radiology_studies` —
the RIS/billed study. `/api/radiology/pacs-worklist` (`:522`) reads `radiology_worklist` — rows pushed
by PACS. The comment at `radiology.ts:521` states the distinction explicitly. The SPA fetches both
(`RadiologyWorklist.tsx:493` and `:838`) and opens a study with
`navigate(reportingWorkspacePath(entry.id))` (`:2148`, `:2189`) → `/radiology/report/:studyId`
(`App.tsx:493`).

**Status machine:** `scheduled → in_progress → acquired → reported_preliminary → reported_final →
delivered / cancelled`, valid list at `radiology.ts:1200` and `:1387`; `acquiredAt` stamped `:1443`;
schema default `"scheduled"` at `lib/db/src/schema/radiology.ts:35`.

**Locking is server-owned.** POST `/api/radiology/worklist-lock/:id/{claim,heartbeat,release,force-release}`
(`radiology-worklist-locks.ts:39,55,64,76,87`), owner identity always derived from the staff session
(header comment `:6-8`), mounted at `routes/index.ts:862`. The workspace auto-claims on open
(`useWorkspaceClinicalUi.tsx:839` → `useStudyLock.ts:112`).

**The id trap, still structurally present but defended.** `radiology_worklist.id` (the ROW) is not
`radiology_worklist.study_id` → `radiology_studies.id` (the BILLED study). `radiology_report_drafts.study_id`
canonically holds the ROW id (`lib/spinalCanalApTable.ts:68-69`; `routes/patient-reports.ts:2271`;
`lib/radiologyIdentity.ts:110` — "Always the worklist row id — store this on patient_reports.study_id").
`resolveWorklistFromStudyRef` tries the worklist PK first, then `study_id` (`radiologyIdentity.ts:78-90`).
The Composer refuses to trust the `drafts.study_id` fallback for exactly this reason and queries drafts
only by `worklistId`, accepting `draft.studyId === worklist.id || worklist.studyId`
(`lib/reportComposer/composeIdentity.ts:250-275`). Residual: `GET /api/patient-reports/from-study/:id`
is keyed on `radiology_studies.id`, so a worklist row id that happens to equal a study id resolves the
wrong study — mitigated by an order/patient cross-check *only when an order is cited*
(`radiologyIdentity.ts:225-240`).

**Tests.** `lib/studyLockRules.test.ts:37-108` — pure decision tables: expiry anchored on
`last_activity_at`, a corrupt owner row reads as expired, an active foreign lock is never stealable, an
expired lock is reclaimable visibly, same-user re-claim refreshes, completed studies refuse claims.
Also present: `lib/radiologyWorklistDedup.test.ts`, `lib/studioWorklistBillJoin.test.ts`,
`lib/worklistModalityFilter.test.ts`, `routes/pacsWorklistList.request.test.ts`.

**Missing.** No single canonical study id — every reader dual-resolves. No test asserts that
`from-study/:id` refuses a colliding worklist-row id when no order is cited.

**Traps.** A lock-column schema drift serves the queue *without locks* rather than 500-ing
(`radiology.ts:428-455`). Claim outcomes ride HTTP 200 (`radiology-worklist-locks.ts:47-49`); only
FORBIDDEN is a real 403 (`:83-84`).

### 1.2 The AI Report Composer

| | |
| --- | --- |
| Source | `lib/reportComposer/composeEngine.ts` (1045 lines), `jobService.ts`, `deterministicCompose.ts`, `types.ts`, `snapshot.ts`, `trackedChanges.ts`, `resolveComposeDraft.ts`, `composeIdentity.ts`, `composePersistence.ts`, `validateOutput.ts` (2230 lines); `routes/reportComposer.ts`; `lib/radiologyJobHandlers.ts:294-300`; `cron.ts:74,209,244-254`; ERP `hooks/useReportComposer.ts`, `components/radiology/ReportComposerAssistant.tsx`, `lib/reportComposer/api.ts` |
| Grade | **VERIFIED** for 8 of 11 job kinds; **PARTIAL** for 3 |

**This is the only AI path a radiologist can start from the reporting canvas.**

**Queue and worker are real.** `reportComposerRouter.post("/jobs")` (`routes/reportComposer.ts:140`)
freezes a snapshot with content hashes into `ai_report_compose_jobs`
(`lib/db/src/schema/aiReportComposer.ts:58-110`), including a server-derived
`source_persisted_token` / `source_draft_id` baseline. The job is enqueued onto the *existing*
radiology queue — `enqueueRadiologyJob` at `jobService.ts:384` — not a new one. The handler is
registered at `radiologyJobHandlers.ts:294-300` and consumed with **concurrency 1** by a consumer
started at `cron.ts:74` → `:209` → `:244-254`. `POST /jobs/:id/process-now` (`:776`) forces a run.
Full endpoint list: `reportComposer.ts:140,184,202,221,262,275,298,334,350,597,648,725,776,787`.
Mounted `/api/radiology/report-composer` behind `requireStaffAuth` (`routes/index.ts:1066`).

**Eleven job kinds** (`aiReportComposer.ts:28-56`): FULL_REPORT, IMPRESSION, SECTION_EDIT,
SELECTION_EDIT, TRANSLATE, REPHRASE, SHORTEN, EXPAND, PROFESSIONALIZE, COMBINE, OBSERVATIONS.
**The SPA enqueues eight.** FULL_REPORT and IMPRESSION (`useReportComposer.ts:627-629`);
SECTION_EDIT / SELECTION_EDIT via `refineReport` (`useReportComposer.ts:607` +
`lib/reportComposer/refineTarget.ts:22,46,56`); TRANSLATE / SHORTEN / EXPAND / REPHRASE via micro-edit
(`useReportComposer.ts:630`, kind mapping `WorkspaceOverlays.tsx:583`).

**[double-read] PROFESSIONALIZE, COMBINE and OBSERVATIONS have server code and no ERP caller.**

```
$ grep -rn '"PROFESSIONALIZE"\|"COMBINE"\|"OBSERVATIONS"' artifacts/diagnostic-erp/src --include=*.ts --include=*.tsx
artifacts/diagnostic-erp/src/lib/reportComposer/api.ts:14:  | "PROFESSIONALIZE"
artifacts/diagnostic-erp/src/lib/reportComposer/api.ts:16:  | "COMBINE"
artifacts/diagnostic-erp/src/lib/reportComposer/api.ts:18:  | "OBSERVATIONS";
artifacts/diagnostic-erp/src/lib/reportComposer/composeObservations.test.ts:1130:      jobKindHint: "COMBINE" as const,
artifacts/diagnostic-erp/src/lib/storedReportBody.ts:41:  "OBSERVATIONS": "findings",
```

Three hits: a type union, a test, and a kind→section map. No enqueue. The settings test panel posts
only `/test`, `/test/compare`, `/vision-trial` (`pages/AiReportingSettings.tsx:253,279,304`). These
three kinds are **PARTIAL** — API-reachable, product-unreachable.

**AI versus deterministic.** The model returns `ComposerDraftOutput {findings, impression,
recommendation, unresolvedQuestions, warnings}` (`types.ts`), parsed by `parseComposerDraftJson`. When
no provider answers, `composeEngine` falls back to `deterministicComposeFromSnapshot` at
`composeEngine.ts:452` and `:905`. That fallback never invents text: OBSERVATIONS → empty proposal
plus warning `deterministic_cannot_structure_dictation` (`deterministicCompose.ts:46`);
PROFESSIONALIZE / COMBINE → the radiologist's own text returned unchanged (`:31-62`); otherwise it
overlays observation `findingsText` not already present, derives Impression from observation impression
contributions, and takes Recommendation only from supplied text (`:64-103`).

**Apply is client-side, gated, and reversible.** `applyAccepted` (`useReportComposer.ts:420`) blocks a
blind apply when the report moved since the draft (`:429`, `:471`), requires explicit Accept for
clinically significant changes (`:476-486`), then `materializeAcceptedText` (`:507`) replaces the
**whole field text** for each accepted change (server twin `trackedChanges.ts:105-122`) →
`applyAiComposerAccepted` (`store.ts:4591`) writes findings/impression/recommendation, marks every
sentence provenance `ai-draft` (`:4620-4633`), refuses on a signed report (`:4619`
`refuseSignedMutation`), pushes an undo frame, and re-runs `deriveImpressionDependency` (`:4653`). The
draft is persisted *first*, then `POST /jobs/:id/applied` (`reportComposer.ts:298`) — which
**does not write clinical text server-side** (comment `:289-291`); `markComposeApplied`
(`jobService.ts:902`) re-resolves the target study from server rows and refuses a cross-patient apply.
On refusal the client rolls back via `undoLastPatch` (`useReportComposer.ts:551-560`).

**Can Apply overwrite manual text?** Yes — but only text the radiologist explicitly Accepted, only as a
whole-field replace, never on a signed report, never without an undo frame, and never silently because
the freshness hash gates at `:420-476`. The sharp edge is the granularity: accepting one FINDINGS
change swaps the *entire* Findings field, not the sentence (`trackedChanges.ts:34-51`).

**Mode A (the instant report) is a different thing and is live.** PR #1065 (`829c2daf`, an ancestor of
HEAD). `RadiologyReportingWorkspace.tsx:12` → `useWorkspaceClinicalUi.tsx:1971-1995` debounced effect
(700 ms, `instantReport.ts:41`) → `store.ts:2363 composeInstantReport` → `decideInstantReport`
(`instantReport.ts:82-108`: holds on off / locked / open confirmation / hand-written Impression /
first merge over dictation) → `generateProfessionalReport(ctx, {automatic:true,
requireOwnedApprovedNormal:true})` (`store.ts:2391`). **Default ON** — absent localStorage key means
enabled (`instantReport.ts:165-167`, key `care.instantReport.modeA.enabled` at `:37`). An automatic
pass that cannot conclude holds the Impression and shows `IMPRESSION_UNDECIDED_HOLD`. It calls **no
model** — it is deterministic composition on a debounce.

Note: the clinic setting `reportComposerAutoCompose` (`lib/db/src/schema/clinicSettings.ts:268`,
checkbox at `AiReportingSettings.tsx:1494`) is stored and read by nothing; Mode A uses its own
localStorage key. Two switches, one visible.

**Tests.** `routes/reportComposer.request.test.ts:72-178` — POST `/jobs` returns 202 with a jobId
without waiting for a model; `/diagnostics` exposes `defaultProvider=ollama`; process-now completes
**without mutating patient reports**. `zai-workspace/instantReport.test.ts:111-309` — decision table,
only clinic-approved manifests auto-build, a real-store pass builds with **zero network calls**,
idempotent second pass, never rewrites a hand-written Conclusion.
`generateProfessionalReport.test.ts:98-241` — builds from empty; refuses signed / unidentified /
confirmation-open / library-loading / no-approved-normal; keeps dictated text and existing
recommendation; idempotent; retires contradicted normals. Also present: `applyFreshnessRace.test.ts`,
`composePersistence.contract.test.ts`, `composePersistence.request.test.ts`,
`unreviewedAiGuard.failClosed.test.ts`, `softFinalAiGuard.request.test.ts`.

**Missing.** No UI door for the three orphan kinds. No server-side apply — the server trusts the
client's canonical-save + confirm sequence, guarded by persisted tokens and a re-resolved study.
`job_kind` is plain text with no DB CHECK constraint (`aiReportComposer.ts:41-43`).

### 1.3 Observation ledger, Findings and Impression editors

| | |
| --- | --- |
| Source | `artifacts/diagnostic-erp/src/lib/zai-workspace/store.ts:602-630,3182,3772,3845,4245`; `mergeImpressionGuard.ts:25-36`; `withdrawSupersededNormals.ts:1-30`; `normalBootstrap.ts`; `fullReportBaseline.ts`; `quick-select-library.ts`; `quickSelectBoxCatalogue.ts`; `components/radiology/zai-workspace/findings-editor.tsx`, `quick-select-strip.tsx`; server `lib/reportComposer/types.ts:7-31`, `snapshot.ts:33-159`, `routes/radiologyQuickFindings.ts` |
| Grade | **PARTIAL** — authoritative in the browser, opaque to the server |

**There is no observations table.**

```
$ grep -rn "pgTable(" lib/db/src/schema/*.ts | grep -i observation
(no output)
```

The canonical ledger is browser state (`appliedPathologyPatches` + `CanonicalObservation` in
`store.ts`). It reaches the database only as `observationLedger: serializeObservationLedger()` inside
the draft's `structured_json` payload (`hooks/radiology-workspace/useDraftPersistence.ts:495`;
column `structuredJson: jsonb` at `lib/db/src/schema/radiologyReportGenerator.ts:42`; hydration
`store.ts:3772`, serialization `:3845`). The server sees observations only frozen inside a compose
job's `input_snapshot_json` (`aiReportComposer.ts:73`).

**Consequence, stated plainly:** no route can query, audit or validate the ledger. A draft's
`structured_json` is opaque JSON to every server reader. Cross-workstation ledger merge does not
exist. Ledger integrity is enforced by client code that a crafted request bypasses — which is why the
server-side guards that matter (signed-report, identity, freshness) are all *outside* the ledger.

**Canonical identity** is `region|concept|level|laterality` (`types.ts:11-15`; `snapshot.ts:33`);
`measurement` participates in the input hash but not in identity (`types.ts:20-23`).

**Quick Select boxes are server-backed.** They load from `radiology_quick_findings` via
`quickSelectBoxCatalogue.ts`, behind `/api/radiology/quick-select` (`routes/index.ts:938-943`), scoped
by `lookupTilesForContext` in `quick-select-library.ts`.

**Findings↔Impression consistency is enforced in four places.** `deriveImpressionDependency`
(`store.ts:602-630`) re-evaluates after every write and arms `impressionNeedsRefresh` with a persisted
`impressionBasis`; merge doors withhold normality sentences over recorded abnormalities
(`withheldMergedImpression`, `mergeImpressionGuard.ts:25-36`); whole-report doors withdraw a
contradicted normal FINDING as a *suspension* recorded on the abnormal row
(`withdrawSupersededNormals.ts:1-30`, `prepareNormalSupersession`); and `normalBootstrap.ts` only
*chooses* an approved complete-normal format (MR/CT/XR whitelist), applying it through the same
`applyFormatById` path as a manual click.

**Provenance does not survive the round trip.** The save payload writes `observationLedger`
(`useDraftPersistence.ts:495`) but not `fieldProvenance`; the restore path reads ledger, viewer
measurements, canal AP, spine state, vascular technique, region transitions, quick-select ids and
linked studies (`:290-345`) — and never provenance. The only write of `fieldProvenance` in that file
is `fieldProvenance: {}` at `:259`, which is the *refusal* branch (a draft belonging to a different
patient). So AI-attributed narrative prose loses its `ai-draft` attribution on reload; a ledger row
does not, which is why the Stage-1 plan wants image-derived findings written as observations.

**Tests.** `radiologyWorkspaceDraftRoundTrip.request.test.ts:250-336` — R1 narrative boxes saved
byte-for-byte; **R2 the observation ledger survives with both sided rows and provenance**; R3 applied
format identity survives; R5 the reload route returns the same envelope; R7 a save without spine state
keeps the stored one. `reportingAssistant.observations.test.ts:58-161` — dictation structuring keeps
grounded rows including a stated measurement, drops ungrounded level/laterality/invented measurement
and names them, fails when the model returns no rows.

**Traps.** `structured_json` has a bounded payload size (`useDraftPersistence.ts:498`); an oversized
ledger can silently miss a save — the user-facing warning at `:560` admits measurements/ledger "may be
missing if you reopen". AI-applied wording can mark ledger rows `stale` on reopen without deleting
them (`store.ts:4610-4616`). `clearVoiceComposerSession` has "no caller today" (`store.ts:4657-4659`).

### 1.4 Recommendation generation

| | |
| --- | --- |
| Source | `artifacts/diagnostic-erp/src/lib/impressionRecommendationWiring.ts:20-60`; `store.ts:2163,3182,4245`; `lib/reportComposer/types.ts:27`; `deterministicCompose.ts:88-95`; `trackedChanges.ts:94-101` |
| Grade | **PARTIAL** — derived, weakly, client-side only |

Observations may carry `recommendationText` (`types.ts:27`, "radiologist-supplied recommendation
contribution"). `alignRecommendationToObservations` (`impressionRecommendationWiring.ts:20`) merges
each non-stale observation's recommendation sentences into the Recommendation box with provenance,
keeping existing sentences and anything typed by hand; untouched when no observation owns one. Called
from the Quick Select apply path (`store.ts:3182`) and the withdraw/restore path (`:4245`); the
clinical-significance chip merge also appends only if not already said (`:2163`).

AI may *propose* Recommendation — it is one of three tracked-change fields
(`trackedChanges.ts:94-101`) — but only via explicit Accept. The deterministic fallback fills it from
`snapshot.recommendation` or the first observation contribution (`deterministicCompose.ts:88-95`).
Mode A keeps whatever recommendation is already on the page
(`generateProfessionalReport.test.ts:200`).

**There is no inference engine that derives a recommendation from findings.** It is a merge of
template-supplied sentences plus a free-text box the AI may propose into.

**Tests.** `impressionRecommendationWiring.test.ts:8-34` — case-insensitive chip dedupe, sentence
splitting, and a Section-5 contradiction validator that flags a spinal level mismatch and "normal
impression with pathology findings".

**Traps.** `alignRecommendationToObservations` never *removes* a recommendation when its observation is
withdrawn by a path that does not call it; stale-flagged patches are skipped
(`impressionRecommendationWiring.ts:38`), so a stale row's recommendation can persist on the page.

### 1.5 Templates and report formats

| | |
| --- | --- |
| Source | `artifacts/diagnostic-erp/src/lib/zai-workspace/report-formats-library.ts:161-368,415-438,483-496`; `routes/radiologyReportFormats.ts:1-434`; `lib/zai-workspace/reportFormatsApi.ts:39-138`; `lib/db/src/schema/structuredReportTemplates.ts:14-51`; `routes/structuredReportTemplates.ts:873-1038`; `lib/zai-workspace/structuredNormalFormats.ts:76-138`; `lib/db/src/schema/presentationTemplates.ts:12-63`; `routes/presentation-templates.ts:58-238`; `lib/presentationTemplateStore.ts:408,500`; `lib/personalReportTemplates.ts:104-123`; `lib/snippet-macros-library.ts:41-43`; `lib/zai-workspace/normalBootstrap.ts:232-415` |
| Grade | **VERIFIED** for three systems; **PARTIAL** for personal templates/macros |

**Five distinct template systems coexist.** This is a fact about the codebase, not a criticism to act
on — three are server-backed and doing different jobs:

1. **Whole-report formats** persist as `radiology_snippets` rows with `type=report_format`
   (`radiologyReportFormats.ts:4,19,150`) — no dedicated table. GET/POST/PUT/DELETE(soft)/`/use`/`/migrate`
   at `:139-434`. localStorage is a cache after migration (`reportFormatsApi.ts:2-3,112-138`); the
   store hydrates via `hydrateReportFormatsLibrary` (`store.ts:5007`).
2. **Structured templates** live in `structured_report_templates` (schema `:14-51`, `sectionsJson`
   v1/v2, `macrosJson`, `previousVersions`); CRUD + `/seed` + `/upgrade-spine-formats`
   (`routes:873-1038`).
3. **Presentation templates** are versioned and immutable once published
   (`radiology_presentation_templates`) with a per-report `radiology_report_presentation_freeze`
   snapshot (schema `:12-63`); eight system templates are code seeds
   (`presentationTemplateSeeds.ts:29,280`).
4. **Personal templates and chocolate-box macros are browser-localStorage only**
   (`personalReportTemplates.ts:104-123`; `snippet-macros-library.ts:41-43`, key
   `zai-rad-snippetmacros-v1`). Neither file contains an `api.` call. A separate legacy
   `radiologist_macros` table exists at `/api/radiology-workflow/macros` (`radiologyWorkflow.ts:320-337`)
   used only by `pages/RadiologistTools.tsx:33,42`.
5. **Bootstrap baselines** are code-authored owned normals with a `baselineManifest` ownership
   contract.

**Auto-selection.** `resolveNormalBootstrapFormat` (`normalBootstrap.ts:232-415`) filters a modality
whitelist of MR/CT/XR (`:50-60`), canonicalises region (`:248-253`), accepts complete-normal formats
only, with an in-sentence pathology assertion test (`:63-125`), caps by the recorded region-transition
ceiling (`:278-300` via `documentedCoverageCeiling`), disambiguates
contrast/epilepsy/stroke/screening/orbit by regex markers (`:79-84`, `:303-373`), prefers
Templates-screen rows with owned manifests (`:393-395`), then owned baselines (`:399-400`), and
requires exactly one survivor else returns `ambiguous` (`:404-414`). Call sites: `store.ts:1972`
(Generate), `useWorkspaceClinicalUi.tsx:2418`, `ReportCanvas.tsx:715`. On no match the user is told
"Choose a format in Starting Canvas" (`normalBootstrap.ts:199-230`); the manual picker never returns
empty solely because a region is unresolved (`report-formats-library.ts:410-438`, scope fallback
region→bodyPart→modality→none).

**Documented coverage ceiling — yes, and it is pinned by a test.**
`normalBootstrapCoverage.test.ts:12-49` pins the measured table: `AUTO_OPEN` = 12 identities
(MR Brain / Cervical / Dorsal / LS / Whole Spine / Knee / Pelvis / Shoulder, CT Brain / Chest / PNS,
XR LS Spine; `:120-133`); `MANUAL_GAPS = []` (`:138`); MG and US never (`:202`).

**Mounts.** `/api/radiology/report-formats` at `routes/index.ts:986-991`;
`/api/radiology/structured-report-templates` at `:929-932`; presentation templates at `:885`.
Pages: `/radiology/structured-report-templates` (`App.tsx:177,580`);
`PresentationTemplateManager` rendered from `RadiologySettingsCenter.tsx:1410`.

**Missing.** No server persistence for personal templates or chocolate macros — they are lost on a
browser change. No US/MG auto-bootstrap, by design (`normalBootstrap.ts:15-17`). The Templates→normal-format
adapter's region map covers seven body parts and MRI/CT/X-RAY only
(`structuredNormalFormats.ts:48-65`); a structured row outside that map silently yields no normal
format (`:86-87`). `radiology_snippets` columns are overloaded (`expansionText` fallback parse,
`radiologyReportFormats.ts:97-104`). DELETE is soft-deactivate only (`:387-412`). The `/use` bump has
no ownership check (`:415-434`).

**Traps.** A Templates row named like a curated baseline inherits ownership only if its sentences
still match (`structuredNormalFormats.ts:107-113`). An un-owned row is barred from auto-open but
remains manually applicable (`normalBootstrap.ts:381-395`). Region-transition records can cap a format
out entirely, producing `no-match` with reason "documents anatomy outside…" (`:287-298`).

### 1.6 The AI gateway

| | |
| --- | --- |
| Source | `lib/ai-providers/src/gateway.ts:1-159`; `artifacts/api-server/src/lib/ai/gatewayInferenceProvider.ts:1-391`; `lib/ai/interactiveAiGateway.ts:1-286`; `lib/ai/shadowInference.ts:75-78`; `lib/ai/shadowPipeline.ts:34,65,116`; `lib/ai/usgGatewayProvider.ts:1-126`; `lib/aiPipeline/modelRouter.ts`, `modelRegistry.ts`; `lib/ai-providers/src/index.ts:1234-1523,1689-1699,1713-1740` |
| Grade | **PARTIAL** — six seams, and the one named "gateway" is not the one that routes |

`README.md` states a load-bearing invariant: *"One AI seam. All model calls go through the AI Gateway
(`generateAiForTask`)."* The executed reality is **six seams**, of which exactly one opens a socket:

1. **`generateAiResponse`** (`lib/ai-providers/src/index.ts:1234`) — the only code that opens a
   connection to a model. Resolves one deadline (`:1284`), derives locality from the *resolved URL*
   (`:1296-1316`), enforces the PHI-text cloud block (`:1339-1372`) and cloud image egress
   default-deny (`:1375-1379`).
2. **`requestStructuredReport`** (`gateway.ts:80`) — chain selection → circuit-breaker skip (`:97`) →
   per-attempt timeout/retry (`:103-111`) → contract validation `validateProvisionalReport` (`:117`) →
   degrades to an empty conforming draft, never throws (`:139,150-158`). **Its only production caller
   overrides the two dependencies that make it a gateway**: `gatewayInferenceProvider.ts:308-332`
   passes `call: async () => ({ success: true, text: direct.text })` (`:321`) and
   `selectChain: async () => [{ provider: authoritativeProvider, … }]` (`:322-330`), where
   `direct.text` came from a *direct* `generateAiResponse` at `:109`. So in production
   `requestStructuredReport` runs as a **schema validator over text already produced**. Chain
   selection, retry and the breaker never execute. `circuitState` and `recordHealth` are *not*
   overridden, so the breaker and health recording are live.
3. **`interactiveAiGateway.ts`** — `resolveInteractiveTarget` (`:79-135`, precedence
   request → task-route → settings default → global default, refuses disabled providers `:110-118`)
   and `executeInteractiveAiCall` (`:175-286`, calls `generateAiResponse` at `:240`, fails closed on a
   provider-identity mismatch `:256-271`). Used by `/api/ai-reporting/draft` and
   `routes/radiologyOllama.ts:29-32`.
4. **The overnight/shadow seam** — `ShadowInferenceProvider` (`shadowInference.ts:75-78`);
   `gatewayInferenceProvider` (`:66`) is injected into the job runner at
   `radiologyJobHandlers.ts:290` (`makeAiShadowPipelineHandler({ provider: gatewayInferenceProvider })`),
   consumed by cron (`cron.ts:338-362`) and by the admin self-test
   (`aiPipelineSelfTest.ts:1814-1857`). Default dep is a stub (`shadowPipeline.ts:62`).
5. **`usgGatewayProvider.ts:118`** — `generateAiForTask("usg_ai_assistant", …)` with defensive JSON
   extraction (`:58-99`).
6. **`aiPipeline/modelRouter.ts`** — a seventh, non-DB, deterministic router for the OCR pipeline;
   picks from `buildModelRegistry` (`modelRegistry.ts:31-89`) where all four tiers collapse to one
   canonical model (`:33`), falling back to `cfg.modelFast` or the first installed model when the
   requested one is missing (`modelRouter.ts:159-170`).

**Task routing that works** reads `ai_model_routes`: `resolveTaskRoute`
(`index.ts:1689-1699`). Callers: `aiReporting.ts:821,1125`, `interactiveAiGateway.ts:99`,
`usgGatewayProvider.ts:107`, `capabilityRegistry.ts:50`. See §1.9.

**Overnight provenance is genuinely good.** `gatewayInferenceProvider.ts:280-302` carries
`modelVersion`, `modelDigest: null`, `provider`, `degraded`, `detail`, `failureCode`,
`resourceFailureCode` (GPU_OUT_OF_MEMORY / CONTEXT_BUDGET_EXCEEDED / PROVIDER_TIMEOUT /
PROVIDER_HTTP_ERROR), `httpStatus`, `elapsedMs`, `requestedImages`, `selectedImages`, `numCtx`,
`recoveredOnce`. `RADIOLOGY_TASK_KEY = "overnight_vision"` (`:15`);
`P2_PROMPT_VERSION = "radiology-draft-mri-grounded-v2"` (`:16`); twelve HARD GROUNDING RULES at
`:19-50`; `classifyOvernightProviderFailure` at `:337-354`.

**Tests.** `gateway.test.ts` (injected deps: empty chain → degraded; invalid contract → next provider;
images → PHI flag); `capabilityLogic.test.ts`; `interactiveExecutionContract.test.ts`;
`gatewayInferenceProvider.localOnly.test.ts`, `.failureNaming.test.ts`;
`shadowPipeline.failureNaming.test.ts`. All mocked, all CI-runnable.

**Traps.** `getDefaultProviderName` falls back to `"gemini"` when nothing is enabled
(`index.ts:1683`). Two unrelated things are called "gateway" (`gateway.ts` vs
`interactiveAiGateway.ts`).

### 1.7 Local Ollama integration

| | |
| --- | --- |
| Source | `routes/radiologyOllama.ts:1-1165`; `lib/ai-providers/src/openAiCompatible.ts`; `index.ts:683-708,790-958`; `lib/ai/bindOllamaRuntime.ts`; `lib/ai/contextBudget.ts`; `lib/ai/providerResourceErrors.ts`; `lib/ai/gpuContextCleanRunner.ts`; `lib/ai-providers/src/hardenedTransport.ts`; `lib/ssrf/ollamaUrlGuard.ts` |
| Grade | **VERIFIED** |

**Endpoints** (all under `/api/radiology-ollama`, mounted `routes/index.ts:1064` with
`requireStaffAuth`): GET `/status:365`; POST `/test:455`, `/list-models:510`, `/probe:558`,
`/findings:664`, `/impression:695`, `/improve:711`, `/grammar:725`,
`/impression-from-findings:739`, `/format-care-style:755`, `/draft:769`, `/differential:804`,
`/multi-review:821`, `/multi-review/winner:948`, `/recycle-runner:968`; GET
`/pipeline-self-test/studies:1001`, POST `/pipeline-self-test:1020`, GET
`/pipeline-self-test/latest:1043`, GET `/pipeline-self-test/:id:1067`; POST `/verify:1097`, GET
`/verify/latest:1133`, GET `/verify/:id:1148`.

**`num_ctx` is the documented root cause of empty drafts.** `buildOllamaChatPayload` sends
`options.num_ctx` only when the caller supplies `numCtx` (`index.ts:695`); omitting it leaves Ollama's
~4096 default — precisely the failure documented at `contextBudget.ts:4-11` (six MRI JPEGs ≈ 6453
tokens rejected at 4096). `resolveInteractiveDraftNumCtx` (`contextBudget.ts:69-105`) prefers 8192 for
multi-image; `maxImagesForContextBudget` (`:108-127`) caps the overnight image count.

**Timeouts come from three independent places.** (a) `resolveRequestTimeoutMs` (`index.ts:64-78`):
caller wins, else env `AI_REQUEST_TIMEOUT_SECONDS` clamped 30–900 s, default 300 s, armed as
`AbortSignal.timeout` (`:853`). (b) DB `clinic_settings.ollamaTimeoutSeconds`, default 30 s clamped
5–120 s (`radiologyOllama.ts:112`), with per-action overrides (90 s findings `:691`, 120 s draft
`:800`, 45 s `:707`). (c) Constants: probes 3000 ms (`index.ts:1772,1806`), connection test 30 s
(`:112`), SDK default 120 s (`openAiCompatible.ts:131`).

**GPU/CPU awareness at runtime: none.** What exists is regex classification of CUDA OOM
(`index.ts:738-745,783-788`; `providerResourceErrors.ts:27-28`), a name heuristic
`isLikelyTooLargeForRtx3050` (`aiPipeline/modelRegistry.ts:101-106`), and a **diagnostic-only**
clean-runner probe matrix (`gpuContextCleanRunner.ts:2-3,19-35`) that unloads the model and probes
`/api/ps`; its own comment says it "does NOT change production defaults" (`:163`).

**Response validation.** The Ollama path parses JSON and strips `thinking` (`index.ts:904-907`) — no
schema check at provider level. Schema validation exists only in `requestStructuredReport`
(`gateway.ts:117`), i.e. only on the overnight path. Malformed output becomes
`PARSE_FAILED` / `EMPTY_MODEL_OUTPUT` / `OUTPUT_BUDGET_EXHAUSTED`
(`providerResourceErrors.ts:147-186`). The OpenAI-compatible arm fails closed on empty final content
(`openAiCompatible.ts:188-202`).

**Retry/fallback.** None inside `OllamaProvider.query`. `radiologyOllama` probes a primary then a
fallback URL and caches the winner for 5 min (`:127-168`), clearing the cache on failure but not
retrying in-request (`:644-646`). Gateway-level retry/breaker exists (`gateway.ts:96-137`) and is
bypassed (§1.6).

**Streaming: none.** `stream: false` (`index.ts:702`); non-streaming `chat.completions.create`
(`openAiCompatible.ts:166`).

**Errors are classified to stable codes** (`PROVIDER_TIMEOUT`, `GPU_OUT_OF_MEMORY`,
`CONTEXT_BUDGET_EXCEEDED`, `HTTP_nnn` — `index.ts:718-760`, `providerResourceErrors.ts:86-221`),
carried in `diagnostics` and in overnight `provenance.failureCode`; the route surfaces 502 + message
(`radiologyOllama.ts:647`) and writes audit rows (`:216-238`).

**SSRF.** `validateOllamaUrl` (`lib/ssrf/ollamaUrlGuard.ts:85-124`): metadata IPs always blocked,
`AI_EGRESS_ALLOWLIST` authoritative, private ranges require Local/LAN mode; trailing-dot and
IPv4-mapped-IPv6 evasions closed (`:58-83`). All local traffic goes through `hardenedLocalRequest`
(DNS pre-resolved, socket bound to the validated IP, redirects rejected —
`hardenedTransport.ts:1-38`, used at `index.ts:854`, `radiologyOllama.ts:75`). The caller's
`AbortSignal` is honoured at `hardenedTransport.ts:357`.

**Reachable from the UI:** `LocalAiPanel.tsx:60-123`, `MultiAIReviewPanel.tsx:212-289`,
`AiPipelineSelfTestPanel.tsx:120-163`, `OllamaAiDraftVerifyPanel.tsx:76-136`,
`AiReportingSettings.tsx:519-638`. Endpoint resolution is bound to `resolveLocalAiRuntime()` via
`bindOllamaRuntime.ts:13-19`.

**Missing.** No automatic `num_ctx` escalation on `CONTEXT_BUDGET_EXCEEDED` — the code classifies the
failure and stops. No token counting; estimates at 1076 tokens/image (`contextBudget.ts:11`). Fallback-URL
retry is probe-based, not per-request.

**Tests.** `contextBudget.test.ts` (payload omits `num_ctx` when unset, includes it when set),
`ollamaUrlGuard.test.ts` (bypass closures, allowlist authority), `providerResourceErrors.test.ts`,
`gpuContextCleanRunner.test.ts`, `gpuCtxResidency.test.ts`, `hardenedTransport.test.ts` +
`.abort.test.ts`, `ollamaChatPayload.test.ts`, `ollamaDiagnostics.test.ts`. All CI-runnable, no
network.

### 1.8 Cloud AI providers

| | |
| --- | --- |
| Source | `lib/ai-providers/src/index.ts:390-458,1104-1112,1671-1683`; `openAiCompatible.ts:222-312`; `openAiCompatibleProvider.ts`; `pricing.ts`; `lib/reportComposer/providers/{resolveComposerProvider.ts, cloudComposerConfig.ts, assertComposerProviderPolicy.ts, compatibleComposerAdapters.ts, localOpenAiCompatibleComposerAdapter.ts}` |
| Grade | **PARTIAL** — text reachable, vision closed by an unproducible proof |

**Catalogue:** openai, gemini, anthropic, ollama, qwen, deepseek, local_openai_compatible
(`index.ts:390-456`). Only openai/qwen/deepseek (+ the local compatible arm) share one OpenAI-wire
transport (`openAiCompatible.ts:1-9`), vendor base URLs and keys at `:235-269`.

**Keys** are stored in `ai_provider_settings.encryptedApiKey`, written by POST
`/api/ai-reporting/settings` with `encryptSecret` (`routes/aiReporting.ts:619`), read and decrypted by
`getProviderApiKey` (`index.ts:1104-1112`), with env fallbacks `DEEPSEEK_API_KEY`,
`QWEN_API_KEY`/`DASHSCOPE_API_KEY`, `OPENAI_API_KEY` (`openAiCompatible.ts:284-292`). The Composer
resolves DB-first, env-second (`cloudComposerConfig.ts:105-112`) and honours `isEnabled` (`:95-96`).

**Opt-in layers.** A provider must be enabled (`interactiveAiGateway.ts:110-118`). Cloud **images**
are default-deny, requiring a clinic flag *and* per-request attestation *and* provenance
(`assertComposerProviderPolicy.ts:124-155`; `index.ts:1375-1379`). Cloud **text** carrying detected
PHI is blocked unless the settings flag allows a redacted send (`index.ts:1339-1372`). A provider
named "local" but pointed at a public URL is reclassified as cloud and refused
(`assertComposerProviderPolicy.ts:98-103`).

**Default order:** the global default from `ai_provider_settings.__global__` settingsJson, else the
first enabled provider in local-first order, else `"gemini"` (`index.ts:1671-1683`).

**Fallback chain: not executed.** Only `requestStructuredReport` iterates a chain, and it does not run
(§1.6). Interactive routes, USG and the Composer each call **one** provider with no fallback
(`resolveComposerProvider.ts:69-78` returns a single adapter, default ollama `:53`).

**`pricing.ts`** holds hard-coded display-only price rows (`:14-60`) and `estimateUsageCostUsd`
(`:66`); its header says it "never influences clinical routing" (`:2`). That is accurate.

**gemini and anthropic have catalogue entries but no Composer adapter** — refused as
`composer_provider_not_configured` (`assertComposerProviderPolicy.ts:112-116`).

**Missing.** No executed multi-provider fallback. No per-request cost budget. Unknown-name providers
are refused rather than defaulted (`resolveComposerProvider.ts:22-34`) — correct, but it means a
typo'd model name surfaces as a hard failure.

**Tests.** `cloudComposerConfig.test.ts`, `composerProvider.foundation.test.ts`,
`composerCloudEgress.regression.test.ts`, `composerCloudPrivacy.test.ts`,
`defaultProviderOrder.test.ts` (asserts a newly enabled cloud key does not re-point unrouted tasks —
local-first), `phiTextCloudGuard.test.ts`, `phiImageCloudGuard.test.ts`. Live tests, skipped without
real credentials: `reportComposer/{localVisionModelsAb, mriRealModel.cloud, mriRealModel,
professionalReport}.live.test.ts`.

### 1.9 Model routing and the capability registry

| | |
| --- | --- |
| Source | `lib/db/src/schema/aiModelCapabilities.ts:12-37`; `aiModelRoutes.ts:15-36`; `builtinModelCapabilities.ts:28-278`; `lib/ai-providers/src/capabilityRegistry.ts:18-55`; `capabilityLogic.ts:28-49`; `lib/reportComposer/providers/modelRegistry.ts:27-118`; `lib/reportComposer/visionCapability.ts:28-116`; `pages/AiModelRouting.tsx:43-264`; `routes/aiModelRoutes.ts:40-135` |
| Grade | `ai_model_routes` **VERIFIED**; `ai_model_capabilities` **DEAD** |

**`ai_model_capabilities` has no writer.** This is the single most consequential finding in the
inventory, because `04-ai-gateway.md` describes capability-driven routing as the platform's spine.

```
$ grep -rn "aiModelCapabilities" artifacts lib scripts --include=*.ts --include=*.sql
lib/ai-providers/src/capabilityRegistry.ts:10   import { aiModelCapabilitiesTable } from "@workspace/db";
lib/ai-providers/src/capabilityRegistry.ts:21   .from(aiModelCapabilitiesTable)
lib/ai-providers/src/capabilityRegistry.ts:22   .where(eq(aiModelCapabilitiesTable.isEnabled, true));
lib/ai-providers/src/capabilityRegistry.ts:36   .select({ digest: aiModelCapabilitiesTable.modelDigest })
lib/ai-providers/src/capabilityRegistry.ts:37   .from(aiModelCapabilitiesTable)
lib/ai-providers/src/capabilityRegistry.ts:38   .where(eq(aiModelCapabilitiesTable.provider, provider))
lib/db/src/schema/aiModelCapabilities.ts:12     export const aiModelCapabilitiesTable = pgTable(
lib/db/src/schema/aiModelCapabilities.ts:38     export type AiModelCapability = …
lib/db/src/schema/index.ts:168                  export * from "./aiModelCapabilities";

$ grep -rniE "insert.{0,60}ai_model_capabilities" artifacts lib scripts migrations
(no output)
```

Every reference is a SELECT. `migrations/add_ai_gateway_and_evaluation.sql:14` CREATEs the table and
`:31` indexes `(provider, model)`; nothing ever INSERTs. So `loadCapabilities()` returns `[]`,
`selectProviderChain()` returns `[]`, and `requestStructuredReport` would degrade with "no eligible
provider (capability/PHI policy) — deterministic-only" (`gateway.ts:91-92`) — except that its one
production caller injects a chain (§1.6), which is why nobody has seen that message.

**A latent defect inside the dead code.** `resolveModelPin(provider, model)` filters on **provider
only** and takes `.limit(1)` (`capabilityRegistry.ts:34-41`, read in full):

```ts
export async function resolveModelPin(provider: string, model: string): Promise<string | null> {
  const [row] = await db
    .select({ digest: aiModelCapabilitiesTable.modelDigest })
    .from(aiModelCapabilitiesTable)
    .where(eq(aiModelCapabilitiesTable.provider, provider))   // ← model is never used
    .limit(1);
  return row?.digest ?? null;
}
```

The `model` parameter is unused in the query. Were the table ever populated, this would return an
arbitrary row's digest for the provider. It must be fixed *before* the table is wired, not after.

**`ai_model_routes` is the routing that works.** Upsert at `routes/aiModelRoutes.ts:100-118`, delete
at `:126-135`, guarded by `canConfigure` (`:28-33`), mounted `/api/ai-model-routing`
(`routes/index.ts:1034`). The UI persists: `AiModelRouting.tsx:64-78` PUTs `{provider, model,
isActive}`; page routed at `App.tsx:579`. Reads go through `resolveTaskRoute`
(`index.ts:1689-1699`) with callers at `aiReporting.ts:821,1125`, `interactiveAiGateway.ts:99`,
`usgGatewayProvider.ts:107`, `capabilityRegistry.ts:50`.

**The model name shown to a user comes from three unrelated places.** (a) The hard-coded builtin table
`BUILTIN_PROVIDER_CONFIGS[…].defaultModels`, served by GET `/api/ai-model-routing`
(`aiModelRoutes.ts:51-55`) and rendered as the picker (`AiModelRouting.tsx:204-218`). (b) Live Ollama
`/api/tags` via POST `/api/radiology-ollama/list-models` (`radiologyOllama.ts:510`, consumed at
`AiReportingSettings.tsx:519`). (c) Runtime resolution: `clinic_settings.ollamaModel` → env
`AI_MODEL_STANDARD`/`AI_MODEL_VISION` → canonical `qwen3-vl:8b` (`aiPipeline/runtimeConfig.ts:59-97`;
`lib/ai-providers/src/canonicalLocalAi.ts:27-30`) with a legacy alias remap
(`aiPipeline/canonicalLocalAi.ts:28-33`). The DB `model_digest` pinning is never populated.

**The Composer's vision gate is per provider arm, and each arm is sound.** `composeEngine.ts` branches
on the arm before it asks anyone about capability:

| Arm | Authority consulted | Where | Fails closed? |
| --- | --- | --- | --- |
| Ollama | `assertVisionCapableModel` — probe-first, three-state (`vision`, `text-only`, `unknown`) | `composeEngine.ts:637-641` (import `:25`) → `visionCapability.ts:28-116`; refusal at `composeEngine.ts:652-664` | Yes — `unknown` → `vision_capability_unverified` (`visionCapability.ts:87-115`). It also retries once with `runtime.model` before refusing (`composeEngine.ts:642-651`). |
| Cloud | `assertModelSupportsCapability(providerName, visionModel, "vision")` → the **hard-coded** builtin table | `composeEngine.ts:665-667` (import `:38`) → `modelRegistry.ts:102` → `builtinModelCapabilities.ts:219,231,248` | Yes — a model absent from `BUILTIN_MODEL_CAPABILITIES` (`:74`) is not vision-capable. |
| `local_openai_compatible` | the adapter enforces `Settings.supportsVision` | comment at `composeEngine.ts:681`; `localOpenAiCompatibleComposerAdapter.ts:112` | Yes |

So there are **three live capability authorities**, not one, and they are partitioned rather than in
conflict: the probe-first classifier for local Ollama, the code-level builtin table for cloud, and
per-endpoint Settings for the local OpenAI-compatible arm. `visionCapability.ts` in detail: it tries
`/api/tags` presence → `/api/show` `capabilities` → known-name fallback, and **fails closed on
`unknown`**: `:87-115` with `safeError: "vision_capability_unverified"` and detail "Could not
positively confirm vision capability for the configured model"; `text-only` → `vision_model_required`
(`:46-50`); `/api/show` reporting non-vision → `vision_model_required` (`:96-97`); cache 60 s (`:12`).
Its own header states "`unknown` name classification is NOT treated as vision-capable" (`:3`).

**The consequence for the dead table is narrower than it first looks.** Deleting `ai_model_capabilities`
removes a *fourth*, unused authority. It does **not** unify the three live ones, and it should not try
to: a cloud arm cannot probe `/api/show`, and the Ollama arm must not be reduced to a hard-coded list.
`builtinModelCapabilities.ts` already documents the cost of two lists disagreeing — its header records
that `classifyOllamaModelVisionByName` and the capability row for `gemma3:12b` contradicted each other
until measurement settled it (`:9-27`), and it holds "the one Ollama name-pattern list" (`:7`, `:28`).

This mattered for scoping PR #1080, **which has since merged** (`c4462041`): the Composer already fails
closed on unknown capability, and #1080 added the three-state classifier to the *interactive and
overnight* `lib/ai-providers` path, which did not have one. Verified absent **at the pin `80a09df4`**:

```
$ ls artifacts/api-server/src/lib/ai/localModelCapabilities.ts
ls: cannot access …: No such file or directory
```

At `c4462041` that file exists (159 lines) — see §6 for the line-shift table and for what #1080 does
and does not change about this finding.

**Tests.** `capabilityLogic.test.ts` (pure chain logic — local-first ordering, vision filter,
PHI-ineligible cloud excluded, digest kept); `gateway.test.ts` (injected deps);
`interactiveAiGateway.test.ts` (mocks the `ai_model_routes` columns at `:36-37`);
`providerModel.test.ts`; `openAiModelsProbe.test.ts`. **No test writes or seeds
`ai_model_capabilities`. No test asserts the routing UI persists end to end.** Both negatives
re-verified at `c4462041`:

```
$ git grep -l -e aiModelCapabilities -e ai_model_capabilities c4462041 -- '*.test.ts'
$ echo "exit=$?"
exit=1                                   # no match
$ git grep -l -e aiModelRoutes c4462041 -- '*.test.ts' | wc -l
13                                       # positive control: the same grep form does match
```

The table's nine non-test references at `c4462041`, in full:

```
$ git grep -l -e aiModelCapabilities -e ai_model_capabilities c4462041 | grep -v '\.test\.ts'
CHANGELOG.md
docs/architecture/radiology-ai/P2_IMPLEMENTATION_REPORT.md
docs/architecture/radiology-ai/P5_VALIDATION_REPORT.md
lib/ai-providers/src/builtinModelCapabilities.ts
lib/ai-providers/src/capabilityRegistry.ts
lib/db/src/schema/aiModelCapabilities.ts
lib/db/src/schema/index.ts
migrations/add_ai_gateway_and_evaluation.sql
scripts/grounding.manifest.json
```

Two docs, a changelog, a manifest, the CREATE migration, the schema, its barrel export, the dead
registry — and one comment in `builtinModelCapabilities.ts` (its header calls itself a *complement*
to the DB table). No producer, no consumer, no test.

### 1.10 PACS image picker and image attachment

| | |
| --- | --- |
| Source | `artifacts/diagnostic-erp/src/lib/pacsImagePicker.ts:1-199`; `components/radiology/PacsImagePickerDialog.tsx:1-340`; `components/radiology/ReportImagePicker.tsx:1-344`; `routes/pacsEnterprise.ts:746-878`; `routes/radiology-report-generator.ts:3627-3816`; `lib/reportComposer/resolveSelectedKeyImages.ts:1-255`; `keyImageOwnership.ts:1-190`; `lib/reportImages.ts`; `lib/frozenKeyImages.ts` |
| Grade | **VERIFIED** |

**The browser never talks to Orthanc.** All QIDO/rendered traffic goes through a same-origin proxy
`/api/radiology/dicom-web` (`pacsImagePicker.ts:14` via `browserDicomWeb.ts:12`; proxy handlers
`pacsEnterprise.ts:788,807,826,851`), with server-side Basic auth from `ORTHANC_USERNAME/PASSWORD`
(`:752-772`). The proxy forwards only `quality`, `viewport` and tag-number `includefield`
(`:778-786,834-836`) — no arbitrary Orthanc access — validates UIDs against the `LAUNCH_UID` regex
(`:790,809,830`), times out at 12 s, and turns errors into null → 502 (`:763-768`).

**Pixels** come from Orthanc DICOMweb `/rendered` JPEG (`Accept: image/jpeg`, `quality` + `viewport`
passthrough, `pacsEnterprise.ts:834-847`). Thumbnails: quality 80, viewport 120–220 px
(`pacsImagePicker.ts:189-199`, `PacsImagePickerDialog.tsx:27`).

**Attach ("ADD TO REPORT")** posts `/api/radiology/report-generator/key-images/from-pacs`
(`PacsImagePickerDialog.tsx:133`; handler `radiology-report-generator.ts:3659`). The **server
re-fetches the pixels itself** at print quality (`?quality=95&viewport=2000,2000`,
`reportImages.ts:171-183`), normalises with sharp (autorotate, max edge 1800 px, JPEG re-encode —
`frozenKeyImages.ts:39,90-110`), writes the file, and inserts a `radiology_report_key_images` row with
`sourceType:"DICOM"`, `viewer:"ORTHANC"` and verified UIDs (`:3779-3804`). Client bytes are not
trusted for the stored image.

**Identity guards before storage:** `assertDraftWritable`, `assertImageUidBelongsToDraft`,
`verifyImageIdentityClaim`; a contradicted claim → 409 (`radiology-report-generator.ts:3676-3715`).
UID regex plus frame 1..10,000 zod validation (`:3643-3657`); a duplicate SOP+frame → 409
(`:3754-3763`).

**Size and count limits, and where each is enforced:**

| Limit | Value | Enforced at |
| --- | --- | --- |
| Compose per-image bytes | 2,500,000 | `resolveSelectedKeyImages.ts:26-27` |
| Compose total bytes | 8,000,000 | `resolveSelectedKeyImages.ts:26-27,198-214` |
| Selected key images per compose | 4 | `types.ts:36`, `jobService.ts:213-216`, `composerContextBudget.ts:181` |
| Print inline ceiling | 2.5 MB | `frozenKeyImages.ts:37` |
| Report thumbnail | 400 KB | `reportImages.ts:33` |
| Picks per dialog session | 100 | `PacsImagePickerDialog.tsx:28` |
| Frame buttons per multiframe | 200 | `pacsImagePicker.ts:93` |
| Overnight images per study | ≤40 | `lib/ai/studyImageSelection.ts:38` |

**At compose time** `resolveSelectedKeyImagesForCompose` re-reads the rows, re-verifies ownership
(`keyImageOwnership.ts:66-190` — rejects both-null rows, cross-draft/cross-study/patient mismatch, and
legacy rows without provable linkage), path-safety-checks the file, reads bytes to base64 and carries
`sourceType` provenance (`resolveSelectedKeyImages.ts:141-231`). Called from `composeEngine.ts:571`.

**Reachable:** proxy + attach mounted under `/radiology` (staff auth + `/radiology` permission) at
`routes/index.ts:763`; report-generator at `:893`. The dialog is rendered in the reporting workspace at
`ViewerColumn.tsx:673` with trigger `openPacsPicker` (`:458-478`, which silently ensures a draft
first). `ReportImagePicker` is rendered from `ReportingToolsRail.tsx:1010` and
`useWorkspaceClinicalUi.tsx:157`.

**Missing.** No WADO raw-object download or true multi-frame pixel access beyond Orthanc's render. No
window/level control (Orthanc does the windowing). **No server-side byte-limit check at attach time** —
the limits above apply at compose/print time, so an arbitrarily large render can be stored. No caption
auto-suggestion (deliberate, `radiology-report-generator.ts:3773-3777`).

**Tests.** `routes/pacsImagePicker.request.test.ts` — 12 cases asserting the stored row carries
PACS-confirmed identity not browser-claimed, a cross-study attach is refused and leaves no file or row,
per-frame multiframe attach works, and a down PACS cannot fabricate a row. **DB-gated**:
`describe.skipIf(!hasDatabaseUrl())`, so it is skipped in CI without `DATABASE_URL`.
`lib/pacsPickerWiring.contract.test.ts` — a static source-shape test asserting `ViewerColumn.tsx`
contains `<PacsImagePickerDialog` with correctly-named props; runs in CI. `keyImageOwnership.test.ts`
(pure) and `.request.test.ts` (DB-gated). `radiologyWorkspaceNotes.test.ts:25` asserts the workspace
renders `<ReportImagePicker`.

### 1.11 DICOM extraction

| | |
| --- | --- |
| Source | `lib/ai/dicomRedaction.ts:1-17`; `routes/dicomWorkflow.ts:1-254`; `lib/usgExtractor.ts:1-1154`; `lib/ai/studyImageFetch.ts:1-231`; `lib/ai/studyImageSelection.ts:1-79`; `lib/ai/mriSeriesSelectionDesign.ts:1-148`; `lib/ai/localBurnedInOcr.ts:1-137`; `lib/ai/visionImageTokens.ts`; `lib/db/src/schema/dicomStudies.ts:1-251`; `lib/pacs/orthancChangesPoller.ts` |
| Grade | **PARTIAL** — SR extraction VERIFIED; redaction STUB; `/ai-extract` STUB |

**There is no DICOM redaction.** `dicomRedaction.ts` is a single constant,
`DICOM_REDACTION_PERFORMED = false` (`:17`), and its own docblock says "No code path scrubs a prompt or
masks a pixel today" (`:10-11`). Audit rows file this constant (e.g. `aiComparison.ts:204,312`). This
is honest, and it must stay honest — see `AI_COMPOSER_GAPS.md` G-12.

**Tags are read from Orthanc JSON, never parsed from binary on the AI path.** `studyImageFetch.ts`
lists via DICOMweb QIDO then Orthanc REST `/tools/find` (`:79-147`) and renders via `/rendered` then
`/instances/{id}/preview` (`:149-187`); the SR extractor consumes Orthanc
`/dicom-web/studies/{uid}/metadata` DICOM-JSON (`orthancChangesPoller.ts:258-270`).

```
$ grep -rn "dicom-parser" artifacts lib --include=*.ts
(no output)
```

`dicom-parser@1.8.21` is declared in `artifacts/api-server/package.json` and imported nowhere.
`dcmjs-dimse` is used only for C-FIND/C-MOVE in `services/dicom-pull-agent/dimse-agent.ts` and
`cron.ts:83` — network DIMSE, not tag parsing.

**The DICOM-SR extractor exists and runs.** `usgExtractor.ts:318+` `parseDicomSr` walks
`ContentSequence (0040,A730)` NUM items recursively with vessel/side context (`:347-359`), maps
SNOMED/DICOM concept names to measurement keys (`:593-602`), and groups Doppler PSV/EDV/RI/PI (`:542`).
Callers: `orthancChangesPoller.ts` (automatic intake), `routes/usgExtraction.ts`,
`routes/internal-radiology.ts`. Pipeline order is SR → tags → Gemini OCR on WADO frames → Gemini text
normalise (`usgExtractor.ts:5-11`); it never auto-finalises; results land `pending_review`.

**Overnight image selection is deterministic and sequence-blind.** `selectImageAnchors`
(`studyImageSelection.ts:34-79`) takes ≤3 evenly spaced slices per CT/MR/PT/NM series, the middle
instance otherwise, capped at `min(maxImages ?? 20, 40)`, with provenance
`{seriesUid, sopUid, frameNumber}`. Rendering resizes to width 512 JPEG q80 via sharp, with a base64
fallback if sharp is unavailable (`studyImageFetch.ts:207-215`). `mriSeriesSelectionDesign.ts` is
explicitly design/audit only — "DO NOT hard-code clinical sequence rules" (`:3-5`) — so selection does
not read `SeriesDescription` and cannot prefer, say, T2 over a scout.

**`dicomStudies.ts`** stores flat tag columns (patientName, studyDate, modality, bodyPartExamined,
numberOfSeries/Images, ingest/sync/link status — `:16-65`), populated from Orthanc by the poller →
internal intake endpoint (`orthancChangesPoller.ts:274-300`).

**`dicomWorkflow.ts`** is a technician scan-quality form (manual `imageQuality` enum
`good|acceptable|repeat_needed`, `:52`), a radiologist queue with filters (`:129-171`), a
`POST /ai-extract/:studyId` that **returns 501 fail-closed** — "DICOM AI extraction is not
configured" (`:205-217`) — and OCR review accept/reject with audit (`:230-252`).

**Orientation and quality.** Only sharp `.rotate()` EXIF autorotate on frozen images
(`frozenKeyImages.ts:90`). **No DICOM `ImageOrientationPatient` handling anywhere on the AI path**,
and no automated image-quality check.

**Tests.** `dicomRedaction.test.ts` asserts the constant **is false** and statically scans every route
writing `aiReportingAuditLogsTable` for a hard-coded `anonymized: true`. `localBurnedInOcr.test.ts`
(17 cases) covers attestation semantics: no model, an off-premises endpoint, or malformed JSON ⇒
`read:false`; a legible-but-empty transcript counts as a real attestation; errors are categorised, not
echoed. Nothing touches a real Orthanc; `pacsImagePicker.request.test.ts` uses a mock DICOMweb server.

**Trap.** `createLocalBurnedInOcrRunner` has zero production callers:

```
$ grep -rn "createLocalBurnedInOcrRunner" artifacts lib --include=*.ts | grep -v '\.test\.'
artifacts/api-server/src/lib/ai/localBurnedInOcr.ts:87:export function createLocalBurnedInOcrRunner(…
```

### 1.12 Image payload construction for AI

| | |
| --- | --- |
| Source | `lib/ai-providers/src/index.ts:683-708,1330-1418`; `cloudImagePolicy.ts:1-126`; `lib/ai/imageDeidentification.ts:1-342`; `imageSendAudit.ts:1-205`; `lib/ai/aiSecurityPolicy.ts:167-232`; `lib/reportComposer/providers/cloudPayloadPrivacy.ts`; `composerContextBudget.ts:1-60`; `lib/ai/visionImageTokens.ts`; `routes/reportComposer.ts:725-777` |
| Grade | payload + gate **VERIFIED**; de-identification **DEAD** |

`buildOllamaChatPayload` strips the `data:image/…;base64,` prefix and puts raw base64 into
`message.images`, setting `num_ctx`/`temperature`/`num_predict`/`think` (`index.ts:683-708`), sent via
the DNS-pinned `hardenedLocalRequest` to `/api/chat` (`:841-854`).

**A real defect on the interactive cloud arms:** `AiQueryOptions.images` is a bare `string[]`
(`index.ts:278`) carrying no MIME, so all three hard-code one — the OpenAI-compatible arm builds
`data:image/jpeg;base64,…` (`:531`), Gemini sets `inlineData.mimeType:"image/jpeg"` (`:590`), and
Anthropic sets `media_type:"image/jpeg"` (`:635`) despite its own union at `:632` admitting
png/gif/webp. A PNG's bytes travel labelled as JPEG. The **Composer** path is correct by contrast —
`ComposerProviderImage` carries `mimeType` (`gatewayPrivacy.ts:107`), whitelists jpeg/png/webp
(`:205-207`) and forwards the real value (`compatibleComposerAdapters.ts:132-133`). Anthropic has no
Composer adapter (§1.8), so its arm is reachable only from `/api/ai-reporting/*`.

**The egress gate sits inside `generateAiResponse`** at `index.ts:1378-1392` whenever
`imgs.length > 0` — one choke point every interactive send passes. Cloud prompt text is separately
PHI-scanned and scrubbed or blocked (`:1340-1373`).

**Policy threading.** `resolveInteractiveImageEgress` (`aiSecurityPolicy.ts:197-232`) reads mode and
opt-in from the DB once per request; called at `interactiveAiGateway.ts:233`, `aiReporting.ts:929`,
`aiComparison.ts:181`. Composer jobs pass `cloudVisionAllowed` (`jobService.ts:533`) and per-image
`imageSourceTypes` provenance taken from the DB rows (`composeEngine.ts:596-623,706`).

**De-identification never runs before egress.**

```
$ grep -rln "deidentifyImage" artifacts lib scripts
artifacts/api-server/src/lib/ai/imageDeidentification.test.ts
artifacts/api-server/src/lib/ai/imageDeidentification.ts
```

The module defines `deidentifyImageForCloudEgress` (`:260`) and `deidentifyImagesForCloudEgress`
(`:319`) — metadata-strip sharp re-encode at JPEG q90, a 12 MB cap, burned-in identifier matching
(`:107,217-342`) — and nothing outside its own test calls either. Its OCR dependency is likewise
uncalled (§1.11).

**Per-route image limits are inconsistent:**

| Route | Limit | Behaviour on excess |
| --- | --- | --- |
| `/api/ai-comparison/run` | ≤6 images × ≤3,500,000 base64 chars | rejected (`aiComparison.ts:36-55,138-146`) |
| `/api/radiology/report-composer/vision-trial` | mime jpeg/png/webp, ≤3.5 M chars | `.slice(0,6)` — **silently truncated** (`reportComposer.ts:746-762`) |
| Composer | ≤4 key images, 2.5 MB/image, 8 MB total | rejected (`resolveSelectedKeyImages.ts:26-27,198-214`) |
| Overnight | ≤40 images | capped at selection (`studyImageSelection.ts:38`) |

**Down-scaling differs per path:** overnight 512 px q80 (`studyImageFetch.ts:210`); frozen key images
1800 px (`frozenKeyImages.ts:39`); comparison images are browser-fetched 768 px renders sent **as-is**
(`AiComparisonWorkspace.tsx:102`, with its own warning "sent as they are" at `:466-469`).

**Count visibility is good.** `numImages` per audit row (`aiComparison.ts:203`); per-arm `imageCount`
returned to the UI (`:232`) and displayed as "Answered · N image(s)"
(`AiComparisonWorkspace.tsx:561`); Ollama diagnostics carry `numberOfImages`/`totalImageBytes`
(`index.ts:829-830`). `recordImageSendAudit` refuses to store bytes or prompt text
(`imageSendAudit.ts:17-24`).

`composerContextBudget.ts` sizes `num_ctx` from `EMPIRICAL_TOKENS_PER_VISION_IMAGE` (~1076/image) with
a cloud ceiling of 16,384, and fails clearly rather than truncating (`:1-60`).

**Tests.** `phiImageCloudGuard.test.ts` (2 cases: gemini + image ⇒ `PHI_IMAGE_CLOUD_BLOCKED`;
text-only not blocked). `imageDeidentification.test.ts` — 23 cases: EXIF-carrying-name dropped, output
bytes ≠ input bytes, surname/DOB-variant/MRN blocking, no-model ⇒ refusal, an empty transcript ≠
clean, raw DICOM refused, one bad image blocks the set. All CI-safe with an injected fake OCR — but
they test an unwired module. `ollamaChatPayload.test.ts` covers the builder.

### 1.13 AI comparison workspace

| | |
| --- | --- |
| Source | `routes/aiComparison.ts:1-318`; `pages/AiComparisonWorkspace.tsx:1-663` |
| Grade | **VERIFIED as a sandbox** — deliberately disconnected from the report |

`POST /api/ai-comparison/run` (`:103-239`) accepts `prompt`, `arms:[{provider,model}]` **or** the
legacy `providers[]` + `models` map (`resolveArms :66-97`), `images[]` (≤6 × ≤3.5 M base64 chars,
`:36-55`), a `studyInstanceUid` validated to exist in `radiologyStudiesTable` (`:168-179`), and
`attestCloudImageEgress`. ≤6 arms (`:40,93`). Permission: `ai_reporting.use` or a full-access role
(`:17-22`).

Egress is resolved **once per request** (`:181-184`) and spread into every `generateAiResponse` call
(`:189-192`). `imageSourceTypes` is deliberately omitted so browser-supplied bytes are treated as
unprovenanced (`:157-162`) — the fail-closed direction.

Per-arm provenance is returned: the `model` that actually answered, `locality`, `attempted` (false =
policy stopped it before any bytes left), `imageCount`, `elapsedMs`, `aiSafetyLabel` (`:217-234`). One
audit row per arm into `ai_reporting_audit_logs` with `numImages`, `anonymized:
DICOM_REDACTION_PERFORMED` (= false), `endpointLocality` (`:196-215`), non-critical (`.catch(()=>{})`).

`GET /providers` (`:252-279`) returns the builtin catalogue plus live policy `{mode,
cloudVisionAllowed, requireAttestation}` from the same resolver the run uses.

**The UI** uses today's worklist as the study source (`:155-163`), an inline PACS
series→instance→frame browser over the same `pacsImagePicker` helpers with 768 px rendered frames
converted to base64 in the browser (`:96-112,172-238,370-416`), JPG/PNG/WebP upload (`:240-259`),
local/cloud arm chips (`:313-324,499-500`), an attestation checkbox shown only when
`requireAttestation` && a cloud arm (`:502-519`), result cards with a locality badge and "Nothing left
the clinic for this arm" on policy stops (`:536-598`), Copy and "Keep this one" (`:579-594`), and an
honest warning that burned-in PHI travels with the pixels (`:466-469`).

**`POST /save-winner` (`:285-318`) writes only an audit row** — prompt truncated to 2000 chars, model,
`numImages:0`. There is no draft, report or observation write anywhere in the file. The UI banner
states "Nothing here has touched the report or the observation ledger" (`:600-606`). The only export is
clipboard copy (`:581`).

**Reachable:** mounted `router.use("/ai-comparison", requireStaffAuth, aiComparisonRouter)` at
`routes/index.ts:1040`; page lazy-loaded `App.tsx:162`, routed `/radiology/ai-comparison` at
`App.tsx:564`; in the Settings hub (`settingsHubCatalog.ts:124`,
`RadiologySettingsCenter.tsx:1602`) and the command palette (`globalCommandCatalog.ts:219`);
permission-mapped to `/radiology` (`staffSession.ts:166`).

**Tests: none.**

```
$ grep -rn "ai-comparison" artifacts --include=*.test.ts
(only lib/ai/interop/aiComparison.ts — an unrelated interop file — and the /query egress suite)
```

**Traps.** `save-winner` does not verify the response actually came from the provider/model named —
the text is client-supplied (`:291-299`). Audit insert failures are swallowed (`:215`). Images are
browser-fetched renders, so the server cannot vouch for their provenance — acknowledged in-route
(`:157-167`). The study-UID check proves the UID exists in this clinic's RIS, not that the pixels came
from it (`:163-167`).

### 1.14 Audit logging and provenance

| | |
| --- | --- |
| Source | `lib/db/src/schema/aiReporting.ts:30-121`; `lib/db/src/schema/radiologyAiReviewAudits.ts:9-20`; `migrations/zzz_ai_audit_anonymized_default.sql:24-28`; `lib/ai/imageSendAudit.ts:34-205`; `routes/aiReporting.ts:967-992,1671-1703,1827-1839,1948-1965,2102,2127-2144,2240-2242`; `pages/AiAuditLog.tsx:18-120` |
| Grade | **PARTIAL** — written everywhere, partly invisible, failures swallowed |

`ai_reporting_audit_logs` carries userId/userName, patientId, studyInstanceUID, accessionNumber,
provider, model, promptText (truncated to 2000 chars on interactive writers), numImages, anonymized,
includedDemographics, wasInsertedToReport, draftId, success, errorMessage, plus the PR-A egress-evidence
columns endpointLocality, jobReference, correlationId and imageSourceTypes
(`routes/aiReporting.ts:967-992`; schema `aiReporting.ts:30-91`).

**Writers:** `/query` `aiReporting.ts:967`; `/draft` `:1671`; `/polish` `:1827`; `/image-review`
`:1948`; `/compare` `:2102`; `aiComparison.ts:196,303`; and the durable writer
`recordImageSendAudit` (`imageSendAudit.ts:153,163`) called from the Composer at `jobService.ts:571`
and from the overnight gateway at `gatewayInferenceProvider.ts:157,174,205`.
`radiology_ai_review_audits` is written only by `radiologyOllama.ts:229,927,955` (multi-provider review
winner selection) and has no prompt or locality fields.

**Provider, model and locality are recorded per request from the execution layer's reported identity,
not the requested one** (`aiReporting.ts:973-974,984-988`; `imageSendAudit.ts:112-120`, preference
order executedLocality > resolvedUrl > "unknown"). An identity mismatch discards the answer
(`interactiveAiGateway.ts:255-271`, `aiReporting.ts:951-962`).

**UI:** `GET /audit-log` requires `canConfigure` (admin/superadmin) (`aiReporting.ts:2129`), rendered
by `AiAuditLog.tsx` at `/radiology/ai-audit-log` (`App.tsx:581`), linked from
`RadiologyAdvancedTools.tsx:189`.

**The PR-A evidence columns are invisible in the only audit UI.**

```
$ grep -n "endpointLocality\|jobReference\|correlationId\|imageSourceTypes" artifacts/diagnostic-erp/src/pages/AiAuditLog.tsx
(no output)
```

The page's row interface (`AiAuditLog.tsx:18-36`) does not declare them, so locality, correlation id,
job reference and image source types are written to the database on every send and shown to nobody.

**Audit-write failure handling is split.** Interactive writers append `.catch(() => {})` — swallowed
unconditionally (`aiReporting.ts:992,1703,1839`). `recordImageSendAudit` never throws but returns
`{filed}` (`imageSendAudit.ts:153-204`); in Clinical mode (`strictAudit`) an unfiled CLOUD send fails
the Composer job (`jobService.ts:603-614`) and withholds the cloud shadow answer
(`gatewayInferenceProvider.ts:228`). So `strictAudit` covers cloud image sends only, not
`/query`, `/draft` or `/image-review`.

**Why a draft was empty is recorded — for shadow drafts.** `shadowDraftUsability.ts:87-165` classifies
READY / EMPTY / QUARANTINED with `emptyReason` plus `providerFailureCode/Detail`
(OUTPUT_BUDGET_EXHAUSTED, EMPTY_MODEL_OUTPUT, PARSE_FAILED, …), persisted into the worklist pointer
JSON (`:168-201`) and surfaced by `worklistAiDraftViewer.ts`. The audit table itself has only
`errorMessage`.

**Missing.** No tamper evidence or hash chain. `wasInsertedToReport` is updated post-hoc
(`aiReporting.ts:2240`). The quarantine super-admin path can DELETE audit rows
(`__super_admin_quarantine/.../super-admin.ts:835,1200`). `/query` and `/draft` store up to 2000 chars
of prompt text while the durable writer refuses prompt text outright
(`imageSendAudit.ts:175`) — two privacy postures in one table.

**Tests.** `imageSendAudit.request.test.ts` asserts locality derivation ("files a private endpoint as
local", "records the send layer's answer over the settings' guess", "writes unknown…"); DB-gated
(`describe.skipIf(!hasDatabaseUrl())` at `:102`), so skipped in CI without `DATABASE_URL`.
`aiReporting.imageEgress.request.test.ts` — 44 end-to-end mode/attestation tests reading real audit
rows; `describe.skip` without `DATABASE_URL` (`:52`). `dicomRedaction.test.ts` scans route sources
statically.

**Traps.** `anonymized` is hard-written `false` (`imageSendAudit.ts:180`) from
`DICOM_REDACTION_PERFORMED`; the migration comment (`zzz_ai_audit_anonymized_default.sql:8-11`)
confirms live DBs previously defaulted it to true. Pre-PR-A rows have NULL `endpointLocality`, which
"means the send predates this column, not that it was local" (schema comment `aiReporting.ts:62-67`).

### 1.15 Report preview and PDF generation

| | |
| --- | --- |
| Source | `artifacts/diagnostic-erp/src/lib/reportPdfGenerator.ts` (1442 lines, jsPDF + jspdf-autotable at `:13-14`); `lib/radiologyReportPdfExport.ts:1-60`; `lib/radiologyReportPrintLiveMerge.ts:1-50,201`; `lib/radiologyReportPreviewHtml.ts`; server `lib/reportPresentation.ts:231,280,282,572`; `routes/radiology-report-generator.ts:2227,69,2476`; `routes/patient-reports.ts:3108-3208,3524,3558,3586`; `lib/htmlToPdf.ts:13-16`; `scripts/preview-reports.mjs:1-76`; `lib/reportPreviewHarness.test.ts` (975 lines) |
| Grade | **VERIFIED** — two independent renderers |

**Both a client and a server PDF exist, and they are different engines.** The workspace export builds
a PDF client-side in jsPDF from live editor state, embedding selected key images fetched over DICOMweb
(`radiologyReportPdfExport.ts:2-24`; call site `useWorkspaceExportShare.ts:357`). Signed and report-hub
surfaces print server-side: GET `/api/patient-reports/:id/print` and `/:id/pdf`
(`patient-reports.ts:3524,3558`) build the artifact from the **stored `patient_reports.body`** rendered
as trusted HTML through `renderReportDocument` (`renderReportVersionHtml :3182`;
`reportPresentation.ts:1-24` — "every rendered report surface flows through renderReportDocument");
`/pdf` rasterises that HTML with headless Chromium (`htmlToPdf.ts:13-16`). **The signed stored body
drives the paper**, not a re-render from structured data (except the D6 flag-gated structured read at
`:3203-3208`).

**Draft preview:** GET `/api/radiology/report-generator/drafts/:id/print-preview`
(`radiology-report-generator.ts:2227`) renders the last *saved* draft row through the presentation
template; the client merges unsaved editor text into it (`radiologyReportPrintLiveMerge.ts:1-8`) and
can pop up with `autoPrint=true&likeFinal=true` (`useWorkspaceExportShare.ts:424`). The screen page is
`buildPreviewHtml` via `ReportExportPanel.tsx:241`.

**Key images** are included in the client PDF and in the server artifact
(`patient-reports.ts:3550-3551`; `radiology-report-generator.ts:3634-3636`).

**`pnpm preview:reports`** (`package.json:23`) runs vitest on `reportPreviewHarness.test.ts` and writes
`tmp/report-preview/` — per case a `.pdf`, `.print.html`, `.screen.html`, `audit.json`, plus
`index.html` (harness `:747-770,796-807`). The script refuses to open the output if the harness fails
(`preview-reports.mjs:38-46`). Nothing is stored or deployed.

**Missing.** The two renderers have no common engine; visual parity rests on shared conventions
(`reportPresentation.ts:50-58` mirrors `parseInlineMarkdown`), not on shared code. Live-merge print is
withheld for signed reports (`reportPrintRoute.test.ts:26`).

**Tests.** `reportPreviewHarness.test.ts` asserts on **rendered print HTML** — bold impression (`:754`),
bold-findings counts (`:757-760`), advice presence/absence (`:763-768`) — and on the PDF only as byte
length > 2000 (`:747`). `reportPdfGenerator.pagination.test.ts:147-251` **does** assert rendered-PDF
content against source text: an instrumented jsPDF captures placed text and the test proves every
clinical token of findings/impression/history/technique/measurements appears and none lands in the
footer band. Also `radiologyReportPdfExport.test.ts:8-88`, `reportPrintRoute.test.ts`,
`reportPresentation.printLayout.test.ts`, `.markdown.test.ts`, `e2eAcceptancePdfGeneration.test.ts`.

**Traps.** Print-preview HTML comes from the last **saved** draft — an unsaved editor needs the
live-merge or the paper shows a stale or empty body (`radiologyReportPrintLiveMerge.ts:1-8`). Harness
output is watermarked PREVIEW/DRAFT (`reportPreviewHarness.test.ts:13-15,751`). `/print` (not the
preview) writes delivery bookkeeping — share log, `markDeliveredIfVerified`
(`patient-reports.ts:3541-3548`).

### 1.16 Finalization and signing

| | |
| --- | --- |
| Source | `routes/patient-reports.ts:1585,2008,2140-2170,2354-2431,2436-2634,2639,2934-3060,3129-3150`; `lib/signedReportContentGuard.ts:276-388`; `lib/signedArtifactGuard.ts:31,50-149`; `lib/reportComposer/unreviewedAiGuard.ts:146`; `lib/radiologyD1FinalWriter.ts:76,91,113`; ERP `hooks/radiology-workspace/useStudyFinalize.ts:42,434`; `lib/radiologyReportLifecycle.ts:309-325,572-754`; `hooks/useFinalizeFlow.ts:98`; `components/radiology/FinalizeSignDialog.tsx:30`; `lib/reportSignatureWithdrawal.ts:113`; `lib/zai-workspace/signedMutationRefusalNotice.ts`; `store.ts:538` |
| Grade | **VERIFIED** for sign/withdraw; **PARTIAL** for amend |

**Finalize is a client gauntlet that produces a server-frozen artifact.** `useStudyFinalize` →
`finalizeRadiologyReport` (`radiologyReportLifecycle.ts:572`) renders the signed body HTML
**client-side** (`buildSignedReportBodyHtml`, `useStudyFinalize.ts:434` →
`radiologyReportPrintLiveMerge.ts:201`), POSTs `/api/patient-reports` with `body: content.htmlBody`
stored **verbatim** (`radiologyReportLifecycle.ts:118` comment, `:639,652`), then POSTs `/:id/sign`
(`:309-325`) and `/api/internal/radiology/report-status` (`:734`).

**Sign** freezes signer identity from server facts only (`patient-reports.ts:2584-2615`: signatureId,
signedByName, signedAt, status `pending_verification`), then `freezeSignedReportPresentation`
snapshots the resolved presentation template **and patient/study identity** into
`radiology_report_presentation_freeze` (`:2617`, `:3129-3150`; `presentationTemplateStore.ts:408`).
Sign does not rewrite the body — it stamps and freezes.

**Guards before sign, in order:** deny-roles (`:2444`); already verified (`:2454`);
structured-signed → 409 pointing at `/verify` countersign (`:2465-2478`); already_signed → 409
pointing at withdraw-signature (`:2482-2511`); **the unreviewed-AI gate (`:2517-2531`)**; the content
guard `assessSignableContent`/`classifySignedReportBody` (`:2536-2560`). The refusal text is explicit
(`signedReportContentGuard.ts:354-375`): *"This report has no authored content, so it cannot be
finalized or signed as a blank document… Pass contentOverride: true with a contentOverrideReason of at
least 3 characters… attributed and audited"* — and the override is audited as
`signed_content_override` (`:2566-2581`).

**AI cannot sign, server-side.** `checkUnreviewedAiFinalize` (`unreviewedAiGuard.ts:146`) has exactly
three production call sites:

```
$ grep -rn "checkUnreviewedAiFinalize" artifacts --include=*.ts | grep -v '\.test\.'
routes/internal-radiology.ts:51    (import)
routes/internal-radiology.ts:1248  (call)
routes/patient-reports.ts:50       (import)
routes/patient-reports.ts:2122     (call, inside POST /)
routes/patient-reports.ts:2518     (call, inside POST /:id/sign)
```

`SIGN_DENY_ROLES = new Set(["typist","ai","system","bot"])` (`radiologyD1FinalWriter.ts:76`), enforced
at `:91,:113` and again at `patient-reports.ts:2444`. The guard fails closed — a database error yields
"unknown", which refuses (`unreviewedAiGuard.failClosed.test.ts`).

**`/:id/amend`, `/:id/verify` and `/:id/withdraw-signature` do not call the AI guard.** Withdrawal does
not need it (it un-signs, and is separately gated); verify and amend are the ones to check — see
`AI_COMPOSER_GAPS.md` G-4.

**Post-sign mutation.** PATCH refuses body/parameters/title/impression via
`classifySignedReportPatch` (`signedArtifactGuard.ts:31,91-128`) with the message *"A signed report
cannot be edited in place. To correct it, withdraw the signature from Report Hub — only the signer or
an administrator can. A verified or delivered report cannot be withdrawn."* The client store refuses 21
guarded mutators through one witness, `refuseSignedMutation` (`store.ts:538`).

**Withdrawal reopens the study in one transaction** (`patient-reports.ts:2999-3051`): authoritative
re-read; report → `draft` with the signature nulled (`:3007-3012`); the bound worklist row →
`REPORT_IN_PROGRESS` with reportId/deliveryStatus cleared (`:3032-3042`); `already_delivered` thrown
*inside* the transaction (`:3028-3030`); signer-or-admin only (`:2978-2991`); reason mandatory
(`:2943-2947`); audited (`:2982-2988`). Client caller `reportSignatureWithdrawal.ts:113`.

**Amendment exists but is narrow and has no UI.** POST `/:id/amend` (`:1585`) requires a reason, the
feature flag `ff_radiology_structured_final` (`:1594`), structured sign authority (`:1598`), and a
parent whose `structuredJson` carries `audit.signature.state === "final"` plus a document_id
(`:1610-1616`), in a linear chain (`:1620-1627`). No ERP page calls
`/api/patient-reports/:id/amend` — matching the route's own comment "no ERP page calls for"
(`:2367-2369`). A legacy-signed (non-structured) report cannot be amended at all (`:2490-2509`,
`:2962-2968`); correction requires withdraw + re-sign.

**Distinct writers able to mutate a signed row:** PATCH of non-protected fields — templateId,
criticalNote, `isCritical` **escalation** (audited `critical_state_changed`, `:2407-2423`);
withdraw-signature; amend (structured only); verify (countersign status; SPA caller
`WhatsAppReportShareDialog.tsx:113`); acknowledge-critical (`:2853`); public-link/share (delivery
metadata only, `:2831,3658`). **Body, title, impression and parameters have exactly zero in-place
writers once signed.**

**Tests.** `signedReportContentGuard.test.ts:80-123` (classification of five producers' real body
shapes including the em-dash sentinel); `signedContent.request.test.ts:316-451` (blank finalize refused
and nothing written; positive control; override signs + audit row; override needs flag AND reason;
refusal audited); `signedArtifactGuard.test.ts:28-85`; `patient-reports.d9.test.ts:295-382`
(session-only signer identity; structured-signed 409; a typist can never sign; countersign commits row
+ audit together); `reportSignatureWithdrawal.test.ts:119-147`;
`finalizeDialogResult.contract.test.ts`.

**Traps.** The signed body is client-rendered HTML trusted verbatim server-side
(`radiologyReportLifecycle.ts:118`; rendered as trusted HTML — `signedReportContentGuard.ts:6-8`).
POST `/` create is idempotent for an already-bound worklist and **discards a new body**
(`:2141-2145` comment) — re-finalizing cannot repair a blank signed draft. The presentation freeze is
best-effort (`catch {}`, `:3149`); a failed freeze silently falls back to live template selection
(`presentationTemplates.ts:47-49`).

### 1.17 Interactive AI operations in the workspace

| | |
| --- | --- |
| Source | `artifacts/diagnostic-erp/src/lib/reportComposer/api.ts:4-139`; `hooks/useReportComposer.ts:107-640`; `components/radiology/ReportComposerAssistant.tsx:240-442`; `components/ai/AiDraftPanel.tsx:34-257`; `components/radiology/zai-workspace/copilot-rail.tsx:38-72`; `lib/aiFinalizeGate.ts`; server `jobService.ts:89-93,522-614`, `unreviewedAiGuard.ts:42-198`, `resolveComposeDraft.ts:18-77`, `interactiveAiGateway.ts:79-286`, `draftService.ts:1-40` |
| Grade | **VERIFIED** for the proposal model; **PARTIAL** for the three orphan operations |

**The workspace calls only `/api/radiology/report-composer/*`** — enqueue, getJob, latest, freshness,
changes/:id/accept, changes/:id/reject, applied, discard, process-now, diagnostics, test
(`api.ts:20-139`; call sites `useReportComposer.ts:107,152,213,361,370,375,395,401,459,493,538,570`).
The composer hook does not call `/api/ai-reporting/*`.

**Output is always a proposal.** Jobs produce `TrackedChange[]` with `reviewState`
PENDING/ACCEPTED/REJECTED; accept/reject are per-change endpoints (`api.ts:78-90`); materialisation
requires `confirmApplied` with content hashes and a server-verified study target (`api.ts:92-115`).
OBSERVATIONS jobs have "no Apply path" (`api.ts:17`).

**Anti-silent-replacement is doubled:** client Guard 10 (`lib/aiFinalizeGate.ts`, surfaced at
`WorkspaceOverlays.tsx:591+`) plus the server guard `checkUnreviewedAiFinalize`, fail-closed 409/503.

**Copilot lifecycle:** rail items Insert (append via `insertCopilotText`) or dismiss
(`acknowledgeCopilotItem`) (`copilot-rail.tsx:70`). Job staleness: the client recomputes `inputHash`,
the server flips READY→STALE_READY on mismatch (`api.ts:49-76`, `useReportComposer.ts:152-160`).

**The shadow draft IS surfaced.** `AiDraftPanel` (in the copilot rail's Orient stage,
`copilot-rail.tsx:67`) reads `/api/ai/draft` via `aiClient.getDraft` (`aiClient.ts:103-106`) and stages
per-finding through `onStageProposal` — "Accept stages for Composer Apply — AI never writes the report
alone" (`AiDraftPanel.tsx:88-99,155-157`); empty/quarantined reasons render from
`worklistAiDraftViewer.ts`.

**`/api/ai-reporting` has 60+ endpoints** — settings, test-provider, query, egress-preview, draft,
polish, image-review, previous-reports, compare, audit-log, drafts, insert-to-report, plus
quality-scores, rag, anomaly, billing-suggestions, voice-transcriptions and more
(`aiReporting.ts:392-3890`) — mounted at `routes/index.ts:1029` with `requireStaffAuth` only.

**Missing.** No UI affordance for PROFESSIONALIZE / COMBINE / OBSERVATIONS. Copilot `Insert` appends AI
text **without a tracked-change record** — only composer jobs are guarded, so a copilot insert is not
covered by the unreviewed-AI finalize gate. `AiDraftPanel` feedback is best-effort swallowed
(`AiDraftPanel.tsx:105`).

**Tests.** `interactiveAiGateway.test.ts` (22 tests, DB mocked at `:43`) asserts provider precedence,
disabled-provider refusal, identity-mismatch failure, and that the audit insert follows the call
(source-order check `:602`). `unreviewedAiGuard.test.ts` (12 pure tests).
`unreviewedAiGuard.failClosed.test.ts` ("database unreachable → unknown, not clear").
`shadowDraftUsability.test.ts` (11 pure tests). `reportComposer.request.test.ts` and the other
`*.request.test.ts` suites need a real DB.

**Traps.** `resolveComposeDraft.ts:24-44` verifies a client `hintDraftId` against worklist/study and
returns null on mismatch — the browser is never trusted. `jobService.ts:535-537` deliberately sets no
attestation for queued jobs, so in Clinical mode a cloud image send from the Composer is refused *by
design*.

### 1.18 Screenshot-to-draft and cloud image egress

| | |
| --- | --- |
| Source | `lib/ai-providers/src/cloudImagePolicy.ts:19-125`; `providerLocality.ts:89-227`; `phiText.ts:89-155`; `index.ts:1375-1417` (door 1); `lib/reportComposer/providers/gatewayPrivacy.ts:105-311` (door 2); `lib/ai/aiSecurityPolicy.ts:31-227`; `lib/ai/imageDeidentification.ts:187-342`; `imageSendAudit.ts`; `pages/AiEgressInspector.tsx:12-242` |
| Grade | **VERIFIED** on the deny side; the enabling path is **DEAD** |

**Door 1 — `assertCloudImageEgress`** (`cloudImagePolicy.ts:69-125`), invoked inside
`generateAiResponse` at `index.ts:1381`. Default-deny for non-local. Locality is derived from the
resolved URL (`:78-82`). Requires `cloudVisionAllowed === true` (`:84`); requires per-request
attestation for patient-derived or unprovenanced images unless `requireAttestation === false`
(`:102-115`); requires a vision-capable model (`:117-123`).
`PATIENT_DERIVED_IMAGE_SOURCES = ["UPLOAD","PACS_SCREENSHOT","VIEWPORT_CAPTURE","DICOM"]` (`:19-24`).

**One ordering detail worth knowing:** `:82` returns `{ ok: true }` for a local endpoint *before* the
`:117` vision-capability check. A local text-only model is therefore never refused by this policy. That
is correct for egress (nothing left the building) and was exactly the hole PR #1080 addressed on the
capability side — the two are different concerns, and #1080 (merged `c4462041`) does not weaken this
door: it changed no line of `gatewayPrivacy.ts`.

**Door 2 — `assertGatewayPrivacy`** (`gatewayPrivacy.ts:137-311`), called by all three
cloud/composer adapters (`compatibleComposerAdapters.ts:116`, `deepseekVisionTrial.ts:145`,
`localOpenAiCompatibleComposerAdapter.ts:112`). The local arm bypasses only if the URL is truly private
(`:161-182`). The cloud arm needs `cloudVisionAllowed`, a MIME allowlist, no raw DICOM, PHI text
scrub-or-refuse (`:242-277`), and a `PixelEgressProof` with an exact image-count match (`:222-240`);
the bytes sent are the proof's bytes (`:287-295`).

**No code can produce a `PixelEgressProof`.**

```
$ grep -rn "pixelProof\|PixelEgressProof" artifacts lib --include=*.ts | grep -v '\.test\.'
lib/reportComposer/providers/gatewayPrivacy.ts:68:   pixelProof?: PixelEgressProof | null;
lib/reportComposer/providers/gatewayPrivacy.ts:105:  export type PixelEgressProof = {
lib/reportComposer/providers/gatewayPrivacy.ts:223:  const proof = input.pixelProof ?? null;
lib/reportComposer/providers/gatewayPrivacy.ts:287:  const approvedProof = hasImages ? input.pixelProof ?? null : null;
```

A type declaration and two reads of `input.pixelProof`, both inside the module that consumes it. No
producer. Read `:222-231`: with images present and `proof === null`, the result is
`{ ok: false, safeError: "cloud_image_not_verified" }` and the detail *"No on-premises verification
that these images are free of patient identifiers, so nothing was sent. Configure the local vision
model, or keep this task on a local provider."*

**So cloud Composer vision is denied by absence, not by inspection.** This is the safe direction and
it is documented in the refusal text. It is not a bug to "fix" by relaxing the check; it is a door
whose key was never cut. `aiReporting.imageEgress.request.test.ts:1097` already tests the forged-proof
shape.

**Consent and attestation.** The clinic opt-in (`deepseekCloudVisionAllowed` — named for one vendor,
gating all of them, `aiSecurityPolicy.ts:127-133`) is necessary but not sufficient. Per-request
attestation comes from the **session**, not the body: `attestationSubject`
(`aiReporting.ts:379-383`) turns the body flag `attestCloudImageEgress` plus the authenticated
subjectId into `staff-user:<id>`, threaded at `/query` (`:932`), `/draft` (`:1525`) and in
`aiComparison.ts`. The single decision point is `resolveInteractiveImageEgress`
(`aiSecurityPolicy.ts:197-227`), called at `interactiveAiGateway.ts:231-238`; the mode is read
per-send from the DB and fails closed to `clinical` (`aiSecurityPolicy.ts:36,96-101,141`).

**Two security modes** (`aiSecurityPolicy.ts:31`): `AI_SECURITY_MODES = ["development","clinical"]`.
development ⇒ `requireAttestation:false, strictAudit:false`; clinical ⇒ both true (`:68-69`). Honoured
by the interactive routes via `resolveInteractiveImageEgress`; by the Composer at
`jobService.ts:522,603-614`; by the overnight path at `gatewayInferenceProvider.ts:102-103,136-147,228`;
by `aiComparison.ts:269`; and by `/egress-preview` (`aiReporting.ts:1149`).

**`AiEgressInspector.tsx`** is a read-only preview over `POST /egress-preview` (`:70`; route
`aiReporting.ts:1107`, `canUse` permission `:1110`) showing destination/locality, image frames and
bytes, prompt identifier categories, gates, and security mode/attestation/strictAudit
(`:37-44,184-190`). It is routed (`App.tsx:582`), in `ERP_NAV_ORDER` (`App.tsx:308`) and linked from
`RadiologyAdvancedTools.tsx:197`.

**Tests.** `cloudImagePolicy.stage1.test.ts` (21 pure tests): a LAN/tailnet Ollama passes with no
flag; a provider "called local" is classified by URL; cloud is refused with no flag; and *"never calls
a cloud host local even when the admin flag and consent both agree"*. `phiImageCloudGuard.test.ts` (2).
`phiTextCloudGuard.test.ts` (6, DB mocked at `:31`): a named patient with no opt-in is blocked; opt-in
sends redacted; *"opt-in merely present but not true still denies"*; a local provider is ungated.
`imageDeidentification.test.ts` (23, mocked). `aiReporting.imageEgress.request.test.ts` (44,
DB-gated).

---

## 2. The evaluation framework (G8) is built and has no caller

`IMPLEMENTATION_TRACKER.md` already marks G8 "⚠️ Built, not wired". Confirmed at `80a09df4`:

```
$ grep -rn "runEvaluation\|evaluationRunner" artifacts lib scripts --include=*.ts --include=*.mjs | grep -v '\.test\.'
artifacts/api-server/src/lib/ai/evaluationRunner.ts:36:export async function runEvaluation(
lib/ai-providers/src/evaluation.ts:4: * No DB. The DB-backed runner (artifacts/api-server/.../evaluationRunner.ts)

$ grep -rn "aiGoldenCases" artifacts lib scripts --include=*.ts | grep -v '\.test\.'
artifacts/api-server/src/lib/ai/evaluationRunner.ts:11   (import)
artifacts/api-server/src/lib/ai/evaluationRunner.ts:42   db.select().from(aiGoldenCasesTable)…
lib/db/src/schema/aiEvaluation.ts:35                     pgTable(
lib/db/src/schema/aiEvaluation.ts:51                     type

$ grep -rn "admitJob" artifacts lib --include=*.ts | grep -v '\.test\.'
artifacts/api-server/src/lib/ai/aiScheduler.ts:120:export function admitJob(…)
```

`runEvaluation` has no caller. `ai_golden_cases` is read only by `runEvaluation` and written by
nothing. `aiScheduler.admitJob` has no caller. The scheduler's own header says enqueue goes through
`enqueueAiShadowJob` (`aiScheduler.ts:6`), and the only caller of that is `schedulerService.ts:136`.

**Consequence for any next phase:** there is no measured basis on this platform for choosing a model.
The A/B harness (`reportComposer/localVisionModelsAb.live.test.ts`) is opt-in
(`RUN_LIVE_OLLAMA=1`) and its results are not persisted. Any "model X is better" claim in a document,
including this one, is an observation, not evidence.

## 3. Reachability summary

| Component | Grade | One-line reason |
| --- | --- | --- |
| Worklist (both) | VERIFIED | routed, fetched, navigated, lock claimed |
| Report Composer (8 kinds) | VERIFIED | button → queue → worker → proposal → gated apply |
| Report Composer (3 kinds) | PARTIAL | server code, no ERP caller |
| Mode A instant report | VERIFIED | debounced, default-on, zero network |
| Observation ledger | PARTIAL | authoritative in browser; no server table or query |
| Recommendation | PARTIAL | template merge only; no inference |
| Report formats / structured / presentation templates | VERIFIED | three server-backed systems, all mounted |
| Personal templates / chocolate macros | PARTIAL | localStorage only, never synced |
| `generateAiResponse` (the socket) | VERIFIED | the single choke point, gates inside |
| `requestStructuredReport` chain/retry/breaker | DEAD in production | caller injects `call` + `selectChain` |
| Interactive gateway | VERIFIED | `/api/ai-reporting/*` + `radiologyOllama` |
| Overnight shadow pipeline | VERIFIED | cron consumer + registered handler |
| `ai_model_routes` | VERIFIED | UI → API → `resolveTaskRoute` |
| `ai_model_capabilities` | DEAD | no writer, no seed, no INSERT anywhere |
| Composer `visionCapability` | VERIFIED | fails closed on `unknown` |
| Ollama runtime | VERIFIED | reachable from five panels |
| Cloud text | PARTIAL | reachable if enabled + keyed; gemini/anthropic have no adapter |
| Cloud images (door 1) | VERIFIED deny | default-deny, attestation from session |
| Cloud images (door 2) | DEAD-enabling | `PixelEgressProof` has no producer |
| De-identification | DEAD | 23 tests, zero callers |
| Burned-in OCR | DEAD | zero callers |
| PACS image picker + attach | VERIFIED | server re-fetches pixels, identity verified |
| DICOM-SR extraction | VERIFIED | poller-driven, lands `pending_review` |
| `dicomWorkflow /ai-extract` | STUB | 501 fail-closed by design |
| DICOM redaction | STUB | one constant, `false`, honestly |
| Comparison workspace | VERIFIED sandbox | no report integration, by design and by banner |
| Audit logging | PARTIAL | written everywhere; new columns unseen; interactive failures swallowed |
| Preview + PDF | VERIFIED | two independent renderers |
| Sign / withdraw | VERIFIED | one witness, one transaction |
| Amend | PARTIAL | server-complete, no ERP caller, structured-only |
| Evaluation framework (G8) | DEAD | no caller, no golden rows |
| `aiScheduler.admitJob` | DEAD | no caller |

## 4. What changed since the Stage-1 documents were written

`STAGE1-AI-SCREENSHOT-REPORTING-ARCHITECTURE.md` and `STAGE1-IMPLEMENTATION-PLAN.md` cite
`origin/main 6b64b2f0`. PRs #1074–#1082 have landed since. Four of their claims are now **stale**:

| Stage-1 claim | Status at `80a09df4` |
| --- | --- |
| "`artifacts/api-server/src/lib/reportComposer/**` writes no audit row at all" | **STALE.** `recordImageSendAudit` is called at `jobService.ts:571`. |
| "`hardenedTransport` does not pass `signal`" | **STALE.** `hardenedTransport.ts:357` — `signal: init?.signal ?? undefined`. |
| "`endpointTrustPolicy.ts` must be retired" | **DONE.** The file does not exist in this tree. |
| "PR-A is a precondition, not started" | **DONE.** #1075/#1076/#1078/#1079 landed the security mode, the interactive egress threading, and the comparison image path. |

Still accurate: no unresolved-placeholder check in `validateComposerOutput` (G-2 of
`AI_COMPOSER_GAPS.md`); `fieldProvenance` not persisted (§1.3 above); `DICOM_REDACTION_PERFORMED =
false` (`dicomRedaction.ts:17`).

## 5. Test census at this commit

```
$ find artifacts/api-server/src -name '*.test.ts' | wc -l          → 558
$ find artifacts/api-server/src/lib/reportComposer -name '*.test.ts' | wc -l → 56
$ find artifacts/api-server/src/lib/ai -name '*.test.ts' | wc -l    → 52
$ find lib/ai-providers/src -name '*.test.ts' | wc -l               → 25
$ find artifacts/api-server/src -name '*.request.test.ts' | wc -l   → 73
```

**The 73 request-level tests are the ones that matter most and the ones CI is least likely to run.**
They boot the real router over supertest against PostgreSQL and are wrapped in
`describe.skipIf(!hasDatabaseUrl())`, so without `DATABASE_URL` exported they skip silently and the
suite still reports green. Every DB-gated suite named in this document is marked as such. This is the
largest single reason a green CI run is not evidence that the AI paths work.

Live/credential-gated, never run in CI: `localVisionModelsAb.live.test.ts`,
`mriRealModel.live.test.ts`, `mriRealModel.cloud.live.test.ts`, `professionalReport.live.test.ts`.

## 6. Pending PRs at the time of writing

Verified against the GitHub API, not assumed:

| PR | State | Head | Note |
| --- | --- | --- | --- |
| #1076 | **merged** 2026-10-19T16:11:35Z → `66d2c116` | `security/stage1-pr-a2-security-mode@30616415` | security mode setting |
| #1078 | **merged** 16:59:35Z → `a787bafb` | `security/stage1-pr-a2b-interactive-egress@673f1e1c` | interactive egress threading |
| #1079 | **merged** 17:31:35Z → `b67869ed` | `ui/pr-a2c-image-comparison@35ffb84b` | comparison image path |
| #1080 | **OPEN at the pin**; **merged afterwards** 2026-10-19T20:29:55Z → `c4462041` | `fix/ai-vision-capability-honesty@76fe43b0` | three-state capability; CI green on all three checks |
| #1081 | **OPEN**, `draft=true` | `feat/care-dev-isolated@febf95f6` (head moved during this work) | separate workstream |

**The body of this document describes `main` at `80a09df4`, one commit before #1080 merged.** Every
citation was read at that pin and is correct there. #1080 landed as `c4462041` immediately afterwards
and touched seven files — `lib/ai/localModelCapabilities.ts` (new, 159 lines), `routes/aiComparison.ts`,
`routes/aiReporting.imageEgress.request.test.ts`, `routes/radiologyOllama.ts`,
`pages/AiComparisonWorkspace.tsx`, `lib/ai-providers/src/index.ts`, `lib/ai-providers/src/ollamaVision.test.ts`.
**Line numbers in those seven files shift at `c4462041`;** the findings themselves were re-verified and
still hold. The shifts that matter:

| Claim | At the pin `80a09df4` | At `c4462041` | Still true? |
| --- | --- | --- | --- |
| `AiQueryOptions.images` is a bare `string[]` (G-17) | `index.ts:278` | `index.ts:279` | **Yes** |
| Three cloud arms hard-code JPEG (G-17) | `index.ts:531,590,635` | `index.ts:532,591,636` | **Yes** |
| `generateAiResponse` is the socket-opening seam | `index.ts:1234` | `index.ts:1235` | **Yes** |
| `num_ctx` sent only when the caller supplies it (G-18) | `index.ts:695` | `index.ts:696` | **Yes** |
| Audit evidence columns asserted in real rows (G-7) | `imageEgress…test.ts:199-231` | `:222` onward | **Yes** |
| Forged-proof shape tested (G-10) | `imageEgress…test.ts:1097-1133` | `:1482` onward | **Yes** |
| `/pipeline-self-test` family (G-13) | `radiologyOllama.ts:1020,1043,1067` | `:1035,1057,…` | **Yes** |
| `aiComparison` limits and egress resolution (G-20) | `:36-55,138-146,181,215` | `:37-46,…,295,329` | **Yes** |
| `localModelCapabilities.ts` absent from the tree | absent | **present** | **Changed — see below** |

**What #1080 changes substantively.** It adds `lib/ai/localModelCapabilities.ts`, a cached capability
reader for the clinic's own Ollama models that reuses `classifyOllamaModelCapability` from
`@workspace/ai-providers` — *the same metadata-first classifier the Composer's selected-image gate and
the OCR resolver already consult* — and its own header forbids a second capability rule per surface
("if a state is wrong, the classifier is wrong, and both surfaces change"). That resolves the
capability-*authority* half of G-6 **against** `ai_model_capabilities`: a DB-driven capability row
would be precisely the second rule #1080's header forbids. It does **not** touch the dead table's
missing writer, and it does **not** fix `resolveModelPin`'s ignored `model` argument
(`capabilityRegistry.ts:34-41`), both of which stand.

**Which citations are pin-only.** Only seven files differ between the pin and current main, so every
other line number in this document is valid at both — proved by asking git for the complete list
rather than by spot-checking:

```
$ git diff --name-only 80a09df4 c4462041
artifacts/api-server/src/lib/ai/localModelCapabilities.ts
artifacts/api-server/src/routes/aiComparison.ts
artifacts/api-server/src/routes/aiReporting.imageEgress.request.test.ts
artifacts/api-server/src/routes/radiologyOllama.ts
artifacts/diagnostic-erp/src/pages/AiComparisonWorkspace.tsx
lib/ai-providers/src/index.ts
lib/ai-providers/src/ollamaVision.test.ts
```

Spot-check by blob hash, for the files the capability finding in §1.9 rests on:

```
$ [ "$(git rev-parse 80a09df4:artifacts/api-server/src/lib/reportComposer/composeEngine.ts)" \
  = "$(git rev-parse c4462041:artifacts/api-server/src/lib/reportComposer/composeEngine.ts)" ] \
  && echo UNCHANGED
UNCHANGED
```

The same holds for `modelRegistry.ts`, `builtinModelCapabilities.ts`, `visionCapability.ts`,
`ocrProviderResolver.ts`, `capabilityRegistry.ts`, `gatewayPrivacy.ts` and `cloudImagePolicy.ts`. So the
three live capability authorities in §1.9 and both cloud-image doors in §1.18 need no re-reading at the
new main.

