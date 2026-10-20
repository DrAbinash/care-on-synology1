# CLINICAL SAFETY REGISTER — the nine patient-facing failure classes

Baseline `origin/main` **`1c80f2d3`**, measured 2026-10-20, then **re-checked at `47b739c8`** the same
day (PR #1085 — the print/PDF and signature PR — merged in the interval). The nine classes are the
owner's list, in the owner's order; nothing was added and nothing was renamed. Where the re-check
changed a verdict it is marked **(re-checked at `47b739c8`)**; the two classes it touched are §8
(image honesty now rendered, so no longer silent) and §9 (one invented-name door closed, a second one
found open on the print surface).

Status vocabulary is deliberately narrower than "fixed/open", because on this repository the honest
answer usually has three parts:

| Status | Means |
|---|---|
| **guarded, undeployed** | Code enforces the property on `main`, with a test that runs — and the clinic is not running it (last deploy 2026-10-12, identity unproven) |
| **guarded, gap named** | Enforced for the cases tested, with a specific remaining door that this file names |
| **OPEN** | Measured on `1c80f2d3` to be absent, silent, or reachable |
| **NOT VERIFIED** | No evidence either way this pass. Say so; do not infer from a PR number |

Nothing in this file constitutes clinical readiness. A green CI run is not a radiologist's acceptance,
and **no class below has been proven by a deployed, observed clinical workflow.**

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
  (`:68-69`) both default to `false`, so the D1 structured impression path is not the default
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
  `1c80f2d3` **and re-checked true at `47b739c8`** (the file is not in #1085's diff): structured-mode
  findings edits can be invisible to dirty-detection, the leave warning
  and local rescue. **Class 7 is therefore OPEN, and it is the recommended next code priority.**

## 8. Printed report differing from the saved report

**Status: guarded, gap named (re-checked at `47b739c8` — this class changed).**

* **Fixed by #1085 (`47b739c8`, merged 2026-10-20 03:49Z, not deployed):** a key image whose pixels
  could not be fetched used to print as a black square, indistinguishable on paper from a legitimately
  dark study. It now says so, in the same words on every surface:
  `lib/reportPresentation.ts:515` emits `IMAGE COULD NOT BE READ` for a pending cell (its comment at
  `:510` records why) and hides it if pixels arrive; `artifacts/diagnostic-erp/src/lib/radiologyReportPdfExport.ts:131` emits the same
  tile on the letter-pad export; `lib/reportPdfGenerator.ts:752` prints
  `KEY IMAGE #<n> COULD NOT BE READ` in the jsPDF grid. The module comment states the invariant in the
  owner's own terms: *"one report must not say two different things depending on which button was
  pressed."* Tests: `reportPresentation.test.ts:169`, `:174`, `radiologyReportPdfExport.test.ts:235`,
  `reportPdfGenerator.allKeyImages.test.ts:351`, plus 320 new lines in `reportPreviewHarness.test.ts`.
* **The gap that remains (name it, don't re-litigate it):** the *reader* still cannot say **why**.
  `lib/reportImages.ts:147` and `:186` both `return null` for every non-OK response, and
  `resolveDraftKeyImages` converts that into `src: src ?? ""` (`:254`) with the comment *"Empty src
  renders as a black square until the client fills pixels."* So Orthanc-down, timeout, zero bytes and
  over-max-bytes are four different faults with one indistinguishable outcome. The tile is now honest
  to the patient; it is still useless to the operator troubleshooting a print run. Also note
  `if (budget < reserve) continue` (`:238`): a report with enough large images silently prints *fewer*
  cells than the draft has attachments, and that truncation is not reported anywhere.
* Frozen key images do drive print/PDF when present (`lib/frozenKeyImages.ts:1-14`) and a missing file
  renders a placeholder with `integrityOk:false` (`:46`).
* **The read surface is flag-gated off:** `ff_radiology_structured_read` defaults to `false`
  (`lib/radiologyFeatureFlagRegistry.ts:68-69`), and its own rollback text says what that means:
  *"disable → read surfaces fall back to stored legacy HTML/body"*. So viewer/print/PDF/PACS render the
  **stored body**, not the structured render — a legitimate design choice that must be stated, not
  assumed, whenever a printed-vs-saved comparison is discussed.
* **Not yet acceptance-tested:** everything above is CI + a synthetic preview harness. No radiologist
  has printed a report through this code, and it is **not deployed** (last deploy 2026-10-12). The
  correct claim is "the silence is closed in code and tested"; the claim "the clinic gets an honest
  page" is NOT VERIFIED.

## 9. Incorrect signature attribution

**Status: guarded on the ERP sign path; OPEN on the Studio integration path **and** on the letter-pad
print default. Display name ≠ signature.**

* **Fixed and testable:** the legacy `patient-reports` sign route no longer trusts the client.
  `routes/patient-reports.ts:2584-2618` — *"The signer of record comes from the server: the chosen
  signature block's own database row, or the authenticated session subject. A name in the request body
  is never used — it is only recorded when it differs, because a client asserting somebody else's name
  is the mis-attribution to catch."* It resolves `signatureId` → `signaturesTable.name`, calls
  `resolveSignerIdentity({ sessionName, signatureName, callerSuppliedName })`, answers
  `400 signer_identity_unavailable` when neither proves a signer, persists `signatureId` +
  `signedByName` + `signedAt`, and audits `identitySource`. Evidence test:
  `routes/signedArtifactTrust.request.test.ts:694`.
* **Still open — the second door:** the USG Reporting Studio bridge writes
  `signedByName: radiologistName` at `routes/internal-reporting-studio.ts:889` (and
  `createdBy: radiologistName` at `:891`), where `radiologistName` is
  `boundRelayedPersonName(b.radiologistName, "Reporting Studio")` from `:845` — i.e. **a name supplied
  in the request body**, normalised and truncated by `lib/signedArtifactGuard.ts:183-187`, falling
  back to the literal string `"Reporting Studio"`. The router is guarded by a machine key
  (`requireStudioKey`, `:77`, `:91`) and mounted at `/internal/reporting-studio`
  (`routes/index.ts:297`) — **not** by a staff session. The row does carry
  `source: "reporting-studio"` and a server-side receipt instant alongside the relayed `signedAt`,
  which is what makes this *recorded* rather than *hidden* — but two doors now attribute a signature
  with two different levels of proof, and the owner's rule is that a report display name must never be
  confused with an authorized digital signature.
* **Related client-side default:** `lib/zai-workspace/sign-off-profiles.ts:6`
  `DEFAULT_RADIOLOGIST_NAME = "Dr. Sugandha Priyadarshini"`, with `sign-off-profiles.test.ts:31`/`:39`
  asserting profiles collapse to that default. A hard-coded printed name in the client is a display
  default, not an identity: **NOT VERIFIED** whether every surface that renders it resolves it back to
  a `signatureId` first. Treat that as the follow-up probe for class 9.
* **Cross-check rule present:** verify must be a different person —
  `routes/patient-reports.ts:673-676` compares `signatureId`/`signedByName` and audits
  `verify_rejected` with reason `verifier_must_differ_from_signer`.
* **Merged, not deployed (re-checked at `47b739c8`):** PR **#1085** *"signatures from records"* closed
  one door and named the rule for the others. Before it, `GET /drafts/:id/print-preview` chose the
  signature block with a **name regex** and, when the clinic had configured no block, **invented one**:
  `- const fallbackName = "Dr. Sugandha Priyadarshini";` / `- qualification: "MD (Radiodiagnosis &
  Medical Imaging)"` in the diff. It now calls `printSigner()` from the new
  `lib/reportSignerSelection.ts`, which selects **structurally** (active block with role
  `Radiologist`, else first in the Signatures list order) and returns **`null`** when there is no
  record — its own header states the rule: *"a preview of an unsigned draft that names a person who
  was never configured is an invented attribution on a clinical document"*, and it keeps four facts
  apart: printed name / qualification / uploaded image / **authorization**, which it says is decided by
  `patient_reports.signatureId` on the final print path and *"deliberately NOT decided here"*. Tests:
  `lib/reportSignerSelection.test.ts` (new, 109 lines) + `reportPresentation.test.ts`. CI 3/3 on both
  the head and the merge commit.
* **A second invented-name door is still open — and this one is on the clinic's print surface.**
  `routes/patient-reports.ts:3460-3463` builds `signatures: [sigModel(sigPrimary, …),
  sigModel(sigVerifier, …)]`, and `sigModel` returns `null` when there is neither a `signatureId` row
  **nor** a `signedByName` (`:3334`) — so an unsigned report reaches the renderer with
  `signatures: []`. `lib/reportPresentation.ts:715-717` then substitutes the static letterhead:
  `[{ name: pad.radiologist, qualification: pad.credentials, label: "Signed:", whenLabel: "" }]`, where
  `pad` is `careLetterheadChrome.ts:24-25` (`radiologist: "Dr. Sugandha Priyadarshini"`,
  `credentials: "MD (Radiodiagnosis & Medical Imaging)"`). The surface is
  `GET /api/patient-reports/:id/print` (`patient-reports.ts:3524`), which has **no signed-status gate**
  and `?preview=true` documented as *"renders the SAME artifact for on-screen preview"*. So a page whose
  body says DRAFT/PENDING can still carry a footer reading **"Signed: Dr. …, MD (…)"** for a person who
  never signed it. The behaviour is deliberate and pinned: `reportPresentation.test.ts:202` is titled
  *"letter-pad header, footer, Sugandha default, key images on the right"* and `:214` asserts the name.
  **Class 9 therefore stays OPEN, and this is an owner decision, not a code bug to fix silently:**
  either the letter-pad default becomes the `printSigner()` chooser (which returns null → no signer
  prints) or a status gate is added. A one-radiologist clinic may well decide the letterhead default is
  correct for *previews*; printing an unsigned report for a patient is the case that must not look
  signed.
* **Deployment reality:** the ERP-side hardening above is on `main`; the clinic's 2026-10-12 build
  predates it, **and it also predates the invented-name fallback being removed from the preview door**.
  **What the clinic's sign dialogs do today is NOT VERIFIED.**

---

## Summary table

| # | Class | Status | One-line evidence |
|---|---|---|---|
| 1 | Wrong-patient binding | guarded, undeployed | `finalizeIntegrityGuard.request.test.ts:10,:410`; row-id/billed-id duality still documented at `barcode-resolver.ts:270` |
| 2 | Wrong laterality | NOT VERIFIED (guards exist) | `aiDraftBinding.ts`, `aiDraftValidation.ts` + tests; no adversarial probe run |
| 3 | Positive → negative | guarded, gap named | one supersession rule, four doors (#1070/#1071/#1072); `normalSuppression`, `withdrawSupersededNormals` |
| 4 | Critical omitted from Impression | guarded, door switched off | `renderer.ts:75`/`:163` tiers; `ff_radiology_critical_result_comms` default **false** (`registry:194`) |
| 5 | Invented measurements | guarded, gap named | `canonicalCanalAp.ts:39/:55` read-only; **G-2 validator file absent** → NOT VERIFIED |
| 6 | Manual text overwritten | guarded, one deferral | #878/#879 non-destructive merges; #1031 caret-reveal deferred |
| 7 | Autosave / reopen | **OPEN** (re-checked at `47b739c8`) | `workspaceReportState.ts:63` snapshot omits `findingsMap`; `:74` dirty check, `:85` backup built on it — the file #1085 did not touch |
| 8 | Printed ≠ saved | **guarded, gap named** (changed by #1085) | unreadable image now prints `IMAGE COULD NOT BE READ` (`reportPresentation.ts:515`, `radiologyReportPdfExport.ts:131`, `reportPdfGenerator.ts:752`); the reader still cannot say **why** (`reportImages.ts:147,:186`, `src: src ?? ""` at `:254`) and can drop cells on budget (`:238`); `ff_radiology_structured_read` default **false**; **merged, not deployed, not human-reviewed** |
| 9 | Signature attribution | guarded / **OPEN on two doors** | `patient-reports.ts:2584-2618` server-authoritative sign route; **OPEN-1** `internal-reporting-studio.ts:845,:889` name relayed in the request body; **OPEN-2** `reportPresentation.ts:715-717` prints `"Signed: Dr. …"` from the static letterhead when a report has no signer at all, on ungated `GET /:id/print` (`patient-reports.ts:3524`) — #1085 removed the same class of invented name from the preview door |

**Recommended order of work implied by this register:** class 7 (one field in one function, patient
records at stake) → **class 9 OPEN-2 (an unsigned report that looks signed — smallest fix in this file,
one line plus its pinned test, and it needs an owner ruling first)** → class 8's remaining gap (say
*why* an image could not be read, and report budget truncation) → class 9 OPEN-1 (the Studio bridge's
signer attribution) → class 4/§"flags" (an owner decision about `structured_final` and
`structured_read`, because the entire structured clinical path is currently defaulted off).
