# CLINICAL SAFETY REGISTER — the nine patient-facing failure classes

Baseline `origin/main` **`1c80f2d3`**, measured 2026-10-20, **re-checked at `47b739c8`** the same day
(PR #1085 — the print/PDF and signature PR — merged in the interval), and **re-checked a third time at
`dc8c3aba`** (after PRs #1087 documentation, #1088 signer-of-record and #1089 vision-trial all merged at
15:10-15:11Z). The nine classes are the owner's list, in the owner's order; nothing was added and
nothing was renamed. Where a re-check changed a verdict it is marked with the SHA it was measured at.

**`dc8c3aba` moved two verdicts and deleted one citation.** Class 9's *OPEN-2* — an unsigned report
printing `"Signed: Dr. …"` from the static letterhead, the finding this file raised on `47b739c8` and
turned into owner decision D-8 — is **closed in merged code by #1088**, and the module this file cites
as the fix for the *preview* door (`lib/reportSignerSelection.ts`, #1085) **no longer exists**: #1088
deleted it and stopped asking the question. A third door, staff-to-signature authority, was opened by
reading what #1088 did *not* check — see class 9 OPEN-3.

Status vocabulary is deliberately narrower than "fixed/open", because on this repository the honest
answer usually has three parts:

| Status | Means |
|---|---|
| **guarded, undeployed** | Code enforces the property on `main`, with a test that runs — and the clinic is not running it (last deploy 2026-10-12, identity unproven) |
| **guarded, gap named** | Enforced for the cases tested, with a specific remaining door that this file names |
| **OPEN** | Measured on the current baseline (`dc8c3aba`) to be absent, silent, or reachable |
| **NOT VERIFIED** | No evidence either way this pass. Say so; do not infer from a PR number |

Nothing in this file constitutes clinical readiness. A green CI run is not a radiologist's acceptance,
and **no class below has been proven by a deployed, observed clinical workflow.**

## 0.1 The nine findings as the current brief lists them, and where each stands at `dc8c3aba`

The continuous-reconciliation brief lists nine items in its own order. They are the same territory as
the classes below, differently cut, so this table maps them rather than inventing a second register.

| # | Brief's finding | Verdict at `dc8c3aba` | Measured evidence |
|---|---|---|---|
| 1 | `findingsMap` persistence and restoration | **Still unresolved** (class 7) | `serializeReportSnapshot` (`lib/workspaceReportState.ts:63`) still serialises `ch/t/rf/im/re/qs` and nothing else; `grep findingsMap` in that file → **zero matches** at `dc8c3aba`. Neither #1088 nor #1089 touched the file |
| 2 | Unsigned report displaying a signed identity | **Confirmed fixed in merged code, not deployed** (class 9 OPEN-2 → closed) | `reportPresentation.ts:506` prints `NOT SIGNED` and no name when `model.signerUnsigned`; the print/PDF door sets it from the row (`patient-reports.ts:3482` `!isSignedArtifact(r)`), the draft-preview door sets it unconditionally (`radiology-report-generator.ts:2451`). Two request tests, three unit tests. Residual named in class 9 |
| 3 | Studio bridge signer identity | **Still unresolved** (class 9 OPEN-1) | `internal-reporting-studio.ts:845` `boundRelayedPersonName(b.radiologistName, "Reporting Studio")` → `:889 signedByName`. Not in #1088's 20-file diff — the second door was not opened |
| 4 | AI image provenance and silent image reduction | **Partially addressed** (class 8 + Audit G-16) | #1089 closed the vision-trial door (`trialImageSet.ts`, refusals carry `suppliedCount`/`droppedIndexes`). **Unchanged:** `reportImages.ts:147`/`:186` still `return null` for any non-OK response, `:238` still drops on budget, `:254` still `src: src ?? ""` — the file's last touch is `4eeb9bc3` (#918) |
| 5 | Structured reporting feature flags | **Still unresolved — by design, and it is an owner decision** | `radiologyFeatureFlagRegistry.ts` every entry `defaultValue: false` at `dc8c3aba`: `ff_radiology_structured_final` `:55-56`, `ff_radiology_structured_read` `:69-70` (**line moved: this file cited `:68-69`, the entry is one line lower now**), `ff_radiology_critical_result_comms` `:194` |
| 6 | Signed-report artifact integrity | **Materially strengthened, not deployed** (class 8) | #1088 makes one record mean one document: the workspace PDF door **refuses to re-render** a signed report (`radiologyReportPdfExport.ts:361` `SignedReportArtifactRequired`, raised at `:377` before any pixel is fetched) and downloads `GET /api/patient-reports/:id/pdf` instead (`useWorkspaceExportShare.ts:299-306`); the client PDF signer comes from the record, not from Print Settings (`reportPdfGenerator.ts:1403`) |
| 7 | Staff-to-signature authorization | **Partially addressed — and one new gap named** (class 9 OPEN-3) | #1088 refuses a **retired** block on the write door (`patient-reports.ts:2599-2605`, `400 signature_not_active`) and eligibility is structural (`reportSignerEligibility.ts:60-64`). **Still absent:** nothing binds the authenticated staff subject to the `signatureId` they pass (`:2586-2612`), and the role gate is a deny-list of `typist/ai/system/bot` (`radiologyD1FinalWriter.ts:76`), which `reportIdentityIntegrity.request.test.ts:333` explicitly notes does not stop a staff account |
| 8 | AI attribution after draft reload | **Partially addressed — the persistence claim in the gap register is refuted, and one door is genuinely open** (Audit G-1) | *Server round trip is sound:* `fieldProvenance` already travels inside the `careObservationLedger` envelope — read at `observationLedger.ts:510-513`, restored by `store.ts:3794` (`parsed.fieldProvenance ?? reconstructProvenanceFromLedger(...)`, `observationLedger.ts:538`) into the store at `:3823-3830`, and asserted against real Postgres by `radiologyWorkspaceDraftRoundTrip.request.test.ts:268` ("R2. the observation ledger survives with both sided rows and **its provenance**"). So `AI_COMPOSER_GAPS.md` **G-1** as written — "attribution is in neither the save payload nor the restore list" — is **false at `dc8c3aba`**, and building it would add a second competing persistence key for data that already persists. *The open door is the local restore banner:* `workspace/WorkspaceOverlays.tsx:814` handles "Restore" by calling `setEditorContent` with **five text fields and no provenance**, and `store.ts:1590-1595` stamps every sentence in all five as `"manual"`. A saved AI sentence that came back from the banner therefore **attests human authorship** — and four consumers act on that label (`observationSlot.ts` protection, `conceptCanon/normalImpression.ts` seeding, `impressionProvenance.ts` Mode-A hold, `reportFieldMerge.ts` display + `useReportComposer.ts:261-264` which sends it into the next AI request). `useDraftPersistence.ts:259` `fieldProvenance: {}` is **not** this bug — it is the different-patient hydration refusal. **A candidate fix is in flight and unmerged:** Draft **#1091** (`feat/ai-attribution-restore-pr-a`, head `b9d8ef51`, 6 files +816/−12, opened 2026-10-20 16:07:04Z) adds `lib/aiAttributionRestore.ts` + tests and edits `WorkspaceOverlays.tsx` (+9/−2), `observationLedger.ts` (+32) and `store.ts` (+43/−10); **2 of 3 CI jobs green at its head, the Tests job had no conclusion, and this pass ran none of its tests** — so row 8 stays *partially addressed* and the door stays open until it merges and is reviewed. **Ownership: AI provenance, not this agent** — see `AGENT_HANDOFF.md` §3.1 |
| 9 | Copilot Insert finalization safeguards | **Partially addressed, one gap named, and NOT VERIFIED as a bypass** (Audit G-3 + G-4) | *Insert is bounded:* `store.ts:1726 insertCopilotText` refuses a signed report (`:1732 refuseSignedMutation`) and routes acceptance through `resolveCopilotAcceptance` (`:1784`, `copilotAcceptanceContract.ts`), attributing `ai-draft`; the target the server named is authoritative (#880), pinned by `aiAcceptanceBoundary.hardening.test.ts:302`, `:345`, `:401`. *The finalize boundary is wider than it was:* the server unreviewed-AI gate (`reportComposer/unreviewedAiGuard.ts:146 checkUnreviewedAiFinalize`, fail-closed → `unknown` = 503) is now called on **amend** (`patient-reports.ts:2122`), on **sign** (`:2518`) and on the structured finalize (`internal-radiology.ts:1248`) — this file's earlier note that only the workspace's Guard 10 applied it is out of date. *Two gaps, named not judged:* **`POST /:id/verify` (`:2650-2680`) still never calls it**, and a Copilot-inserted sentence creates **no `ai_report_compose_jobs` tracked-change row**, so neither gate can see it as pending — both gates read `tracked_changes_json.reviewState` (`unreviewedAiGuard.ts:64-86`, `diagnostic-erp/src/lib/aiFinalizeGate.ts:29-41`), never `fieldProvenance`. Whether the Insert click **is** the review or is a bypass of it is a clinical-authority question: **NOT VERIFIED**, and it is owner decision **D-11**, not an agent's fix. |

---

## 1. Wrong-patient report binding

**Status: guarded, undeployed — and the two-id trap is still a live reading hazard.**

* Finalize binds identity atomically to the study and resets on study transition (#874 lineage,
  later #1058 `d1f9b855`), and a flip that wrote nothing used to report "completion" — now refused.
* The mechanism that caused it is still present in the data model and named in current code:
  `routes/barcode-resolver.ts:270` — *"patient_reports.study_id may be radiology_worklist.id
  (workspace finalize)"* — and `routes/careUsgCompanion.ts:156`/`:166` reads **both** conventions
  (worklist row id, else legacy billed `radiology_studies.id`).
* The integrity guard is a request-level test against real Postgres:
  `routes/finalizeIntegrityGuard.request.test.ts:10` (the reproduced fault: `report_id=NULL` while
  `patient_reports` held **zero** rows for that study) and `:410` (row id vs billed id).
* **Remaining exposure:** every reader that guesses which sequence an id came from. `OPEN_WORK.md` §1
  tracks this; `radiologyReportLifecycle.ts:32-76` is the documented trap.

## 2. Wrong laterality

**Status: NOT VERIFIED as a defect; guards exist and are named.**

* Laterality is carried through the AI-draft path — `lib/aiDraftBinding.ts` and
  `lib/aiDraftValidation.ts` (both with tests: `aiDraftBinding.test.ts`, `aiDraftValidation.test.ts`)
  and `lib/abnormalityEngine.ts` all reference laterality — so a side flip is a recognised, tested
  property rather than an unconsidered one.
* The owner's standing rule is recorded in `AGENT_HANDOFF.md` §3: anatomy, **laterality**,
  measurements and uncertainty must stay in the sentence; a guard that asks otherwise is the defect.
* **What was NOT done this pass:** no adversarial probe of "tile says right, report says left". Do not
  claim class 2 is closed.

## 3. A positive finding converted into a negative

**Status: guarded, gap named — this is the class with the most deliberate engineering.**

* One supersession rule now covers **all four write doors** (Quick Select, merge, full-normal format,
  AI accept): `normalClaimSupersededBy` + `sentenceOwnedBySlot`, merged as #1070 `02e47dff`,
  #1071 `d673f1cc`, #1072 `6b64b2f0`.
* Implementation and tests on `main`: `lib/clinicalSelection/normalSuppression.ts` +
  `normalSuppression.test.ts`, `zai-workspace/withdrawSupersededNormals.ts` +
  `withdrawSupersededNormalFindings.test.ts`, `lib/sharedBaselineRetirement.test.ts`.
* The AI-acceptance side is bounded: acceptance writes only into the target the server named
  (#880 `insertTarget` authoritative), and an accepted AI sentence is not silently allowed to retire a
  normal it does not own.
* **Gap named:** a normal that is *un-owned* — a clinic-authored normal from the `Templates` row that
  outranks the curated baseline — was fixed as DEF-2 (#1036/#1037) but **has never been observed
  working in the clinic**, because nothing since 2026-10-12 is deployed.

## 4. A critical abnormality omitted from the Impression

**Status: guarded, with one door that is switched off by design.**

* The renderer types severity and ranks it: `ImpressionTier = "critical" | "significant" | "routine"`
  (`structuredReport/renderer.ts:75`) with `TIER_RANK` (`:163`), so an impression line can be ordered
  by clinical weight rather than by insertion order.
* Impression "worthiness" of a finding is derived, not hand-curated (#778 lineage), and the golden
  corpus carries per-modality cases that fail if an expected critical line disappears
  (`lib/clinicalGolden/*`).
* **The switch that is off:** the critical-result *communication* workflow sits behind
  `ff_radiology_critical_result_comms`, `defaultValue: false`
  (`lib/radiologyFeatureFlagRegistry.ts:194`), and its routes answer **404** while off
  (`routes/aiReporting.ts:3492`, `:3515`, `:3546`). Shipped, tested, **not enabled** — an owner
  decision, not a bug.
* **Also off:** `ff_radiology_structured_final` (`:55-56`) and `ff_radiology_structured_read`
  (`:69-70` — **line moved since `47b739c8`, where this read `:68-69`**) both default to `false`, so the D1 structured impression path is not the default
  clinical path at all. That is the single most consequential configuration fact in this register.

## 5. Invented measurements

**Status: guarded, gap named.**

* The canonical spinal-canal record is server-resolved and **read-only** to the Composer
  (`reportComposer/canonicalCanalAp.ts:39`/`:55`, consumed at `resolveComposeDraft.ts:117`, #1063
  `bae32727`); print has one measurement authority (#1054 `3d54c552`), and phrase-based dedupe was
  replaced by structured-table identity.
* A measurement must be *entered* to appear: `mergeCanalApLevels(legacy, canonical)` deletes the
  legacy row when canonical is null (`canonicalCanalAp.ts:39`) — a deliberate fail-closed, and a trap
  in the other direction (argument order matters).
* **Gap:** the Composer validator's unresolved-placeholder rule (finding **G-2** in
  `AUDIT_RECONCILIATION.md`) could not be located — the file the audit named,
  `lib/reportComposer/validateOutput.ts`, **does not exist** at `1c80f2d3`. Until the live validator
  is found and tested, "the AI cannot emit a fabricated number" is **NOT VERIFIED**.

## 6. Manual text overwritten

**Status: guarded, one behaviour deliberately deferred.**

* Merges are non-destructive: the word-subset and Jaccard folds that used to discard sentences were
  removed (#878 B-02 findings merge, #879 B-02A technique merge — only exact duplicates fold).
* A hand-typed Findings line no longer silently becomes an Impression line, and an automatic
  sentence is distinguished from a pressed one (DEF-1, #1036/#1037).
* A draft-restore banner can no longer offer to overwrite a signed report (#867), and the
  signed-elsewhere ratchet was widened after it pinned one spelling of the lock and missed the rest
  (#868).
* Quick Select cannot dim out of reach of a signed report and the strip's gating was restored (#871,
  #877 parameter contract).
* **Deferred:** the findings caret-reveal behaviour (#1031) is a Draft-era deferral, deliberately
  left until the acceptance battery can observe it (`lib/reportSectionCaretReveal.test.ts` exists on
  `main`).

## 7. Autosave / reopen inconsistencies

**Status: OPEN — the strongest current finding in this register.**

* The autosave vocabulary is correct and refused-saves are no longer reported as failures:
  `AutoSaveStatus` with a distinct `refused` state (#862), driven from
  `hooks/radiology-workspace/useDraftPersistence.ts:164`, `:465`, `:469`, `:555`, and displayed in
  `components/radiology/ReportingStickyActionBar.tsx`. Refusals are enforced in `saveDraft` itself,
  not in its ten callers (#859), and the refusal message names a real recovery path (#863).
* Server round-trip is tested: `routes/radiologyWorkspaceDraftRoundTrip.request.test.ts` asserts the
  `structuredJson` envelope survives (`:271`, `:288`, `:297`, `:314`, `:328`, `:354`).
* **The gap, measured:** `serializeReportSnapshot` (`lib/workspaceReportState.ts:63-71`) hashes only
  `clinicalHistory, technique, rawFindings, impression, recommendation, quickSelectIds` — **not
  `findingsMap`** — and `isReportDirty` (`:74`) plus the local `BackupEnvelope` (`:85`) are built on
  that snapshot. `findingsMap` is live UI state (`workspace/ReportCanvas.tsx:249`, `:1487`, and read
  by `ReportingToolsRail.tsx:205`, `ViewerColumn.tsx:159`, `WorklistPanel.tsx:127`,
  `WorkspaceFooter.tsx:124`). This is finding **C2** of the July independent audit, still true at
  `1c80f2d3`, **re-checked true at `47b739c8`** (the file is not in #1085's diff) and **re-checked true
  again at `dc8c3aba`**: `grep -n findingsMap artifacts/diagnostic-erp/src/lib/workspaceReportState.ts`
  → zero matches, and neither #1088 (20 files) nor #1089 (4 files) names that file. **Class 7 is
  therefore still OPEN, three baselines running, and it remains the recommended next code priority.**

## 8. Printed report differing from the saved report

**Status: guarded, gap named (re-checked at `47b739c8` — this class changed; re-checked again at
`dc8c3aba`, where it narrowed).**

* **Fixed by #1085 (`47b739c8`, merged 2026-10-20 03:49Z, not deployed):** a key image whose pixels
  could not be fetched used to print as a black square, indistinguishable on paper from a legitimately
  dark study. It now says so, in the same words on every surface:
  `lib/reportPresentation.ts:548` emits `IMAGE COULD NOT BE READ` for a pending cell (its comment at
  `:543` records why) and hides it if pixels arrive; `artifacts/diagnostic-erp/src/lib/radiologyReportPdfExport.ts:131` emits the same
  tile on the letter-pad export; `lib/reportPdfGenerator.ts:772` prints
  `KEY IMAGE #<n> COULD NOT BE READ` in the jsPDF grid. The module comment states the invariant in the
  owner's own terms: *"one report must not say two different things depending on which button was
  pressed."* Tests: `reportPresentation.test.ts:170`, `:175`, `radiologyReportPdfExport.test.ts:235`,
  `reportPdfGenerator.allKeyImages.test.ts:351`, plus 320 new lines in `reportPreviewHarness.test.ts`.
  **Line numbers corrected at `dc8c3aba`:** this bullet cited `:515`/`:510`/`:752`/`test.ts:169`/`:174`;
  #1088 added a `signerUnsigned` field and a `signatureSlotHtml` function above them, so each moved
  (as did `ff_radiology_structured_read`, now `:69-70`). The behaviour they name is unchanged.
* **Narrowed by #1088 (`37a6758c`, merged 15:11:14Z, not deployed) — the strongest print-integrity
  change in this register:** the browser door used to *draw* a signed report from whatever the screen
  held, so a valid signature could sit over content nobody authorized. It now refuses.
  `radiologyReportPdfExport.ts:361` declares `SignedReportArtifactRequired`; the guard at `:377`
  throws it at `:378` **before any pixel is fetched**; `useWorkspaceExportShare.ts:299` reads the
  authorization first and,
  if the row has a signer of record, downloads `GET /api/patient-reports/:id/pdf` (`:306`) — the same
  frozen artifact Report Hub has always produced. The signer printed on a client-drawn PDF now comes
  from the record (`reportPdfGenerator.ts:1403` draws `NOT SIGNED`, no name, no image) rather than from
  this station's `radiology_print_settings`. Proved by `reportPdfGenerator.signerOfRecord.test.ts` (257
  lines, instrumented jsPDF) and `radiologyReportPdfExport.signedArtifact.test.ts` (171).
  **Residual, and it is deliberate:** a document with **no report row behind it** (`authorizedReportId`
  null — an unsaved draft, or the non-radiology generators) still draws this browser's configured
  signer, because `loadSignerOfRecord(null)` returns `{signerOfRecord: null, unsigned: false}`
  (`radiologyReportLifecycle.ts:568`, the early return at `:572`). That carve-out is what #1090's
  `draftAwarePrintSettings.ts` (a `DRAFT` watermark, currently on the open PR, not on `main`) exists to
  cover, and it is the reason the two PRs collide — see `AGENT_HANDOFF.md` §7. **NOT VERIFIED:** that no
  patient-facing surface can reach that carve-out with a signed-looking layout.
* **The gap that remains (name it, don't re-litigate it):** the *reader* still cannot say **why**.
  `lib/reportImages.ts:147` and `:186` both `return null` for every non-OK response, and
  `resolveDraftKeyImages` converts that into `src: src ?? ""` (`:254`) with the comment *"Empty src
  renders as a black square until the client fills pixels."* So Orthanc-down, timeout, zero bytes and
  over-max-bytes are four different faults with one indistinguishable outcome. The tile is now honest
  to the patient; it is still useless to the operator troubleshooting a print run. Also note
  `if (budget < reserve) continue` (`:238`): a report with enough large images silently prints *fewer*
  cells than the draft has attachments, and that truncation is not reported anywhere.
  **Re-verified at `dc8c3aba`:** this file's last change is `4eeb9bc3` (#918) — neither #1085, #1088 nor
  #1089 touched it, so the gap is exactly as wide as it was, and no claim of a fix may be inherited
  from #1089's sibling change.
* **Fixed by #1089 (`dc8c3aba`, merged 15:11:37Z, not deployed) at the *other* image door:**
  `POST /api/radiology/report-composer/vision-trial` used to `map → filter → slice(0, 6)`, so a seventh
  picture vanished and an unsupported mime removed itself, while `sameImageCount`, each arm's
  `imageCount` and the prompt's own "Image count: N" were computed from the survivors. The operator was
  judging an answer to a shorter request than the one they made. The set is now normalised by
  `lib/reportComposer/trialImageSet.ts` (constants `VISION_TRIAL_MAX_IMAGES`/`_MAX_IMAGE_CHARS`/
  `_ALLOWED_MIMES` at `:25-27`, read from the route's own previous ceilings) and a rule-breaking set is
  **refused as a whole** with `400 {error, suppliedCount, droppedIndexes}` (`routes/reportComposer.ts`).
  **What is NOT claimed here:** the provider function still contains its own
  `opts.images.slice(0, 6)` (`providers/deepseekVisionTrial.ts:112`). It has exactly one caller — this
  route — which now cannot hand it more than six, so the slice is a second ceiling rather than a silent
  trim; that is the honest statement, not "the slice is gone". And this class of fix is *proved by
  running code* only in `trialImageSet.test.ts`; the route-level refusal ("a refused set never opens a
  socket") is enforced by a static guard, `reportComposer.visionTrialGate.test.ts`, because the
  database-backed route version destabilised two unrelated suites — recorded in #1089's own commit
  message and in `COMPLETED_WORK.md` §E1.
* Frozen key images do drive print/PDF when present (`lib/frozenKeyImages.ts:1-14`) and a missing file
  renders a placeholder with `integrityOk:false` (`:46`).
* **The read surface is flag-gated off:** `ff_radiology_structured_read` defaults to `false`
  (`lib/radiologyFeatureFlagRegistry.ts:69-70`), and its own rollback text says what that means:
  *"disable → read surfaces fall back to stored legacy HTML/body"*. So viewer/print/PDF/PACS render the
  **stored body**, not the structured render — a legitimate design choice that must be stated, not
  assumed, whenever a printed-vs-saved comparison is discussed.
* **Not yet acceptance-tested:** everything above is CI + a synthetic preview harness. No radiologist
  has printed a report through this code, and it is **not deployed** (last deploy 2026-10-12). The
  correct claim is "the silence is closed in code and tested"; the claim "the clinic gets an honest
  page" is NOT VERIFIED.

## 9. Incorrect signature attribution

**Status at `dc8c3aba`: guarded on the ERP sign path and on both patient-facing print doors;
`guarded, undeployed` for the parts #1088 closed; still OPEN on the Studio integration path, and a
third door is now named. Display name ≠ signature.**

### 9.1 What #1088 (`37a6758c`, merged 2026-10-20 15:11:14Z, not deployed) closed

Four separate mechanisms were attributing a signer. All four are now decided from rows:

* **The name was matched with a regular expression on the write side.** `autoSignReport`
  (`radiologyReportLifecycle.ts`) and `useStudyFinalize.ts` each ran `/sugandha/i` over every row
  `GET /api/signatures` returns, and the finalize dialog hid its "Sign as" picker whenever the name
  matched (`multi = signatures.length > 1 && !sugandha`). With a second radiologist on file, her
  reports recorded, printed and delivered under the first one's signature with no way to object. Both
  call sites now ask `reportSignerEligibility.ts`: `eligibleSigners()` (`:60-64`) = active rows, and
  the `Radiologist`-role subset when the clinic has marked any (it falls back to the active set,
  because the role dropdown opens on *Pathologist* and POST defaults to `"Doctor"` — a correctly
  configured one-radiologist clinic has no `Radiologist` string anywhere); `resolveSignerChoice()`
  (`:66-78`) returns `preferred` / `single` / **`choose`** / `refused` / `none`. Two or more eligible
  blocks now leave the picker **blank** and Confirm disabled
  (`FinalizeSignDialog.tsx:129-130`, `:162-163`), and a remembered
  `radiology_finalize_signer_id` is honoured only while it is still in *this* study's pool.
* **A retired block could authorize a new report.** `patient-reports.ts:2599-2605` now answers
  `400 signature_not_active`; `GET /api/signatures` still returns retired rows (the admin screen needs
  them), which is why the picker had to be filtered rather than the read gated.
* **Whichever workstation printed decided who signed.** The finalized PDF took its name from this
  browser's `radiology_print_settings`. `recordedSignerForReport()` (`radiologyReportLifecycle.ts:529`)
  and `loadSignerOfRecord()` (`:568`) now read the authorization off the report row
  (`signatureId` + `signedByName`, witnessed by the same `rowAlreadySigned` the badge, the content lock
  and the finalize caption use), and `reportPdfGenerator.ts` prints that person — or `NOT SIGNED`
  (`:1403`) — never a configured default. A block retired *after* signing still describes that old
  report: `isActive` gates who may sign from here on, not what an old report may say.
* **An unsigned document implied authorization.** New `signerUnsigned` on the model
  (`reportPresentation.ts:184`) is honoured by **both** renderer doors through one
  `signatureSlotHtml()` (`:506`): the letter-pad footer *and* the plain page print `NOT SIGNED` and no
  name. `patient-reports.ts:3482` sets it from `!isSignedArtifact(r)`, and the draft preview sets it
  unconditionally (`radiology-report-generator.ts:2451`) with the stamp now labelled
  `"PREVIEW — NOT SIGNED"`. **This is the closure of what this file called OPEN-2 and of R-17 /
  decision D-8.**
* **The chooser module this file cited is gone.** #1085 shipped `lib/reportSignerSelection.ts`
  (`pickSignerRecord`/`printSigner`, 77 lines + a 109-line test) to select the block *structurally*
  instead of by name. #1088 **deleted both** — `git grep reportSignerSelection origin/main` → zero
  matches — because the answer to "which configured block should a draft wear?" became "none; a draft
  has no signer". Its own comment records that: *"This also retires #1085's preview selector."* Every
  citation of that module anywhere in `docs/project-memory/` is a citation of a deleted file.
* **Tests, all green at `dc8c3aba`:** `reportSignerEligibility.test.ts` (102),
  `reportSignerNoNameRule.test.ts` (85 — a deliberate source-text ratchet over the six files on the
  signing pathway, pattern `/\/sugandha\/i|\/abinash\/i|name\s*===?\s*["']Dr\./i`),
  `draftPreviewNamesNoSigner.request.test.ts` (168, real Postgres),
  `reportPdfGenerator.signerOfRecord.test.ts` (257),
  `radiologyReportPdfExport.signedArtifact.test.ts` (171), plus +144 lines in
  `signedArtifactTrust.request.test.ts` — whose new cases include *"the downloaded PDF pairs the signed
  content with the signed name"* (`:784`) and *"the signed artifact is readable and byte-identical
  after signing"* (`:827`), with `NOT SIGNED` asserted at `:318`/`:697` and asserted **absent** at
  `:299`/`:807` as the control.

### 9.2 OPEN-1 — the Studio bridge (unchanged, third baseline running)

`routes/internal-reporting-studio.ts:845` still computes
`boundRelayedPersonName(b.radiologistName, "Reporting Studio")` and `:889` still writes it as
`signedByName` (`:891` `createdBy`), i.e. **a name supplied in the request body**, normalised and
truncated by `lib/signedArtifactGuard.ts:183-187`, falling back to the literal string
`"Reporting Studio"`. The router is guarded by a machine key (`requireStudioKey`, `:77`, `:91`) and
mounted at `/internal/reporting-studio` — **not** by a staff session. The row does carry
`source: "reporting-studio"` and a server-side receipt instant alongside the relayed `signedAt`, which
is what makes this *recorded* rather than *hidden*. That is owner decision **D-4**, unchanged; #1088's
20-file diff does not include this route, so nothing about it has been re-litigated, only re-read.

### 9.3 OPEN-3 — staff-to-signature authority is a deny-list, not a binding (new at `dc8c3aba`)

Reading what #1088 did **not** check, measured at `dc8c3aba`:

* The sign route's only subject check is `SIGN_DENY_ROLES` (`radiologyD1FinalWriter.ts:76` =
  `{typist, ai, system, bot}`), applied to the session role at `patient-reports.ts:2442-2448`. It is a
  deny-list, not an allow-list: **a cashier, nurse or reception session is not denied**.
  `reportIdentityIntegrity.request.test.ts:333` states the consequence plainly — *"radiologist" is not
  in SIGN_DENY_ROLES, so the route's role gate passes*.
* Given any non-denied staff session, `signatureId` selects **any active block** (`:2586-2597`), and
  `resolveSignerIdentity()` (`signedArtifactGuard.ts:165-178`) prefers `signatureName` over the session
  subject. So the report's signer of record becomes that block's person regardless of who is logged in.
* The request body's own name is never used (`rejectedCallerName` is captured and audited, and
  `legacy_sign` records `identitySource` + `signatureId` + `rejectedCallerName`) — so the event is
  **traceable after the fact, not refused**.

This is not a regression introduced by #1088 — it is the boundary that was always there, and #1088
moved it (retired blocks can no longer be chosen, and no browser setting can overwrite a record).
Whether CARE intends *"any staff member may apply any active radiologist's block"* to remain the
model, or a session must own the block it signs under, is **owner decision D-10**. An agent must not
silently tighten it: the single-radiologist clinic today signs through the auto path, and a binding
that assumes a 1:1 staff↔signature mapping would stop the clinic signing.

### 9.4 What was written at `47b739c8`, kept as history

> **A second invented-name door is still open — and this one is on the clinic's print surface.**
> `routes/patient-reports.ts:3460-3463` builds `signatures: [sigModel(sigPrimary, …), sigModel(sigVerifier, …)]`,
> and `sigModel` returns `null` when there is neither a `signatureId` row **nor** a `signedByName`
> (`:3334`) — so an unsigned report reaches the renderer with `signatures: []`.
> `lib/reportPresentation.ts:715-717` then substitutes the static letterhead:
> `[{ name: pad.radiologist, …, label: "Signed:", whenLabel: "" }]`, where `pad` is
> `careLetterheadChrome.ts:24-25` (`radiologist: "Dr. Sugandha Priyadarshini"`). The surface is
> `GET /api/patient-reports/:id/print` (`:3524`), which has no signed-status gate… The behaviour is
> deliberate and pinned: `reportPresentation.test.ts:202`.

**Closed by #1088 on 2026-10-20 (same day, four hours after it was written).** The same mechanism still
exists at `reportPresentation.ts:750` (`pad.radiologist` is still the substituted value when a caller
passes an empty list **and says nothing about authorization**), and it is still asserted by
`reportPresentation.test.ts:203`/`:215` — but that test is now a **deliberate control** for the
surfaces with no report row behind them (template samples at `presentation-templates.ts:136`, the
non-radiology generators), and `patient-reports.ts:3482` no longer lets a radiology report row reach it
unsigned. Line numbers in the quote are the `47b739c8` ones; at `dc8c3aba` they are `:750`, `:203`/`:215`,
`:3471`, `:3344`, `:3543`. **NOT VERIFIED:** that every non-radiology generator that reaches that
default is a surface no patient can be handed. That is the remaining probe for class 9.

* **Related client-side default:** `lib/zai-workspace/sign-off-profiles.ts:6`
  `DEFAULT_RADIOLOGIST_NAME = "Dr. Sugandha Priyadarshini"`, with `sign-off-profiles.test.ts:31`/`:39`
  asserting profiles collapse to that default. **Re-checked at `dc8c3aba`:** unchanged, and the print
  doors no longer take their signer from any client default (`9.1`), so the open question is now
  narrower — which surface still renders it as *text*.
* **Cross-check rule present:** verify must be a different person —
  `routes/patient-reports.ts:673-676` compares `signatureId`/`signedByName` and audits `verify_rejected`
  with reason `verifier_must_differ_from_signer`. **`POST /:id/verify` still never calls the
  unreviewed-AI gate** (`:2650-2680`) — see `§0.1` item 9 and Audit G-4.
* **Deployment reality:** every `dc8c3aba` improvement above is on `main`; the clinic's 2026-10-12
  build predates #1085, #1088 and #1089 alike. **What the clinic's sign dialogs and printed pages do
  today is NOT VERIFIED, and it is the pre-fix behaviour.**

---

## Summary table

| # | Class | Status at `dc8c3aba` | One-line evidence |
|---|---|---|---|
| 1 | Wrong-patient binding | guarded, undeployed | `finalizeIntegrityGuard.request.test.ts:10,:410`; row-id/billed-id duality still documented at `barcode-resolver.ts:270` |
| 2 | Wrong laterality | NOT VERIFIED (guards exist) | `aiDraftBinding.ts`, `aiDraftValidation.ts` + tests; no adversarial probe run. **#1090 adds a laterality test file on the open PR** (`zai-workspace/lateralityDeselectBoundaries.test.ts`, 158 lines) — not on `main`, so the verdict does not move |
| 3 | Positive → negative | guarded, gap named | one supersession rule, four doors (#1070/#1071/#1072); `normalSuppression`, `withdrawSupersededNormals` |
| 4 | Critical omitted from Impression | guarded, door switched off | `renderer.ts:75`/`:163` tiers; `ff_radiology_critical_result_comms` default **false** (`registry:194`) |
| 5 | Invented measurements | guarded, gap named | `canonicalCanalAp.ts:39/:55` read-only; **G-2 validator file absent** → NOT VERIFIED |
| 6 | Manual text overwritten | guarded, one deferral | #878/#879 non-destructive merges; #1031 caret-reveal deferred |
| 7 | Autosave / reopen | **OPEN** (three baselines: `1c80f2d3`, `47b739c8`, `dc8c3aba`) | `workspaceReportState.ts:63` snapshot omits `findingsMap`; `:74` dirty check, `:85` backup built on it. `grep findingsMap` in that file → zero matches. #1085, #1088 and #1089 all left it alone; **#1090 edits the file two lines below (`useDraftPersistence.ts +17/−3`), so this may be the PR that finally closes it — but it is not on `main`** |
| 8 | Printed ≠ saved | **guarded, gap named, and narrowed by #1088 + #1089** | unreadable image prints `IMAGE COULD NOT BE READ` (`reportPresentation.ts:548`, `radiologyReportPdfExport.ts:131`, `reportPdfGenerator.ts:772`); one record = one document (`radiologyReportPdfExport.ts:361/:377` refuses, `useWorkspaceExportShare.ts:299-306` downloads the frozen artifact); vision trial refuses a partial set (`trialImageSet.ts`). **Still:** `reportImages.ts:147,:186,:238,:254` unchanged since #918, and `ff_radiology_structured_read` default **false** (`:69-70`); **merged, not deployed, not human-reviewed** |
| 9 | Signature attribution | **guarded, undeployed on four doors; OPEN on two** | #1088: eligibility from rows (`reportSignerEligibility.ts:60-78`), retired block refused on write (`patient-reports.ts:2599-2605`), signer read from the record (`radiologyReportLifecycle.ts:529,:568`), `NOT SIGNED` on both renderer doors (`reportPresentation.ts:506`, set at `patient-reports.ts:3482` and `radiology-report-generator.ts:2451`). **OPEN-1** Studio relay `internal-reporting-studio.ts:845,:889`. **OPEN-3 (new)** any non-denied staff session may apply any active block (`radiologyD1FinalWriter.ts:76`, `patient-reports.ts:2442-2448`, `signedArtifactGuard.ts:165-178`). **Closed:** former OPEN-2, the letter-pad `"Signed:"` default |

**Recommended order of work implied by this register (re-ranked at `dc8c3aba`):**

1. **Class 7** — `findingsMap` into `serializeReportSnapshot`. Unchanged as the top code priority, and
   it is now a *coordination* item as well: #1090 edits `useDraftPersistence.ts` and `store.ts`, so the
   two changes should not land blind to each other.
2. **Review #1085 + #1088 + #1089 against rendered output** (`pnpm preview:reports`, a real print, a real
   PDF, a real Studio-signed report) before any further signature work. Three merged print/PDF PRs now
   sit un-reviewed, and #1088 is the largest clinical print change since the register began.
3. **Resolve the #1090 conflict** (owner/agent coordination, decision **D-12**): the collision is between
   two representations of "unsigned" — `signerOfRecord`/`unsigned`/`SignedReportArtifactRequired` on main
   versus `unsignedDraft`/`draftAwarePrintSettings` on the PR — in exactly two files.
4. **Class 8's remaining gap** — make the image reader say *why*, and report the budget drop.
5. **Class 9 OPEN-3** (staff↔block binding) — needs owner decision **D-10** before code, because a
   tightening that assumes a 1:1 mapping stops the clinic signing.
6. **Class 9 OPEN-1** — the Studio bridge, decision **D-4**, unchanged.
7. **Class 4 / §flags** — the owner decision on `structured_final` and `structured_read`; the entire
   structured clinical path is still defaulted off, three baselines running.
