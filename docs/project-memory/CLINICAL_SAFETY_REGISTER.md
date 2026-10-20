# CLINICAL SAFETY REGISTER — the nine patient-facing failure classes

Baseline `origin/main` **`1c80f2d3`**, measured 2026-10-20. The nine classes are the owner's list, in
the owner's order; nothing was added and nothing was renamed.

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
  `1c80f2d3`: structured-mode findings edits can be invisible to dirty-detection, the leave warning
  and local rescue. **Class 7 is therefore OPEN, and it is the recommended next code priority.**

## 8. Printed report differing from the saved report

**Status: OPEN (silence) + guarded-with-a-flag-off.**

* **Silent image loss is still live:** `lib/reportImages.ts:147` and `:186` both return `null` for
  every non-OK response, so a print or PDF that quietly lost a picture is indistinguishable from one
  that never had it (finding R-10 / CL-8 in `KNOWN_ISSUES.md` §1).
* Frozen key images do drive print/PDF when present (`lib/frozenKeyImages.ts:1-14`) and a missing file
  renders a placeholder with `integrityOk:false` (`:46`) — the honest path exists, the silent path
  also still exists.
* **The read surface is flag-gated off:** `ff_radiology_structured_read` defaults to `false`
  (`lib/radiologyFeatureFlagRegistry.ts:68-69`), and its own rollback text says what that means:
  *"disable → read surfaces fall back to stored legacy HTML/body"*. So viewer/print/PDF/PACS render the
  **stored body**, not the structured render — a legitimate design choice that must be stated, not
  assumed, whenever a printed-vs-saved comparison is discussed.
* **In flight, not merged:** PR **#1085** (Draft, head `55de3cce`, 10 files, +783/−46) carries the
  print/PDF quality fixes — Doppler emphasis, missing-image honesty, signature-block layout. Its CI is
  green on its own head (run completed 2026-10-20 02:53:22Z). It is **not merged, not deployed, and
  has no rendered-output acceptance recorded by this pass**, so class 8 stays OPEN until the PR is
  reviewed against produced artifacts.

## 9. Incorrect signature attribution

**Status: guarded on the ERP path; OPEN on the integration path. Display name ≠ signature.**

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
* **In flight, unmerged:** PR **#1085**'s own title carries *"signatures from records"*, and its body
  describes the same split — one shared server renderer with two PDF doors. It is the relevant
  in-flight work for class 9 as well as class 8, and it is a **Draft at head `55de3cce`** (its
  `merge_commit_sha` `3ad277d1` is GitHub's test-merge preview, not a merge). Nothing in it counts
  until it is merged, deployed and observed.
* **Deployment reality:** the ERP-side hardening above is on `main`; the clinic's 2026-10-12 build
  predates it. **What the clinic's sign dialogs do today is NOT VERIFIED.**

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
| 7 | Autosave / reopen | **OPEN** | `workspaceReportState.ts:63-71` snapshot omits `findingsMap`; `:74` dirty check, `:85` backup built on it |
| 8 | Printed ≠ saved | **OPEN** + flag off | `reportImages.ts:147,:186` silent `null`; `ff_radiology_structured_read` default **false**; #1085 unmerged |
| 9 | Signature attribution | guarded / **OPEN on the Studio path** | `patient-reports.ts:2584-2618` server-authoritative; `internal-reporting-studio.ts:845,:889` still body-relayed |

**Recommended order of work implied by this register:** class 7 (one field in one function, patient
records at stake) → class 8 (the two silent `return null`s + #1085 review) → class 9 (the Studio
bridge's signer attribution) → class 4/§"flags" (an owner decision about `structured_final` and
`structured_read`, because the entire structured clinical path is currently defaulted off).
