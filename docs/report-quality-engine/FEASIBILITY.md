# PR#101 Universal Quality Engine — Feasibility Assessment

## Headline verdict

The decisive fact: **the authoritative signed artifact is free text.** `patient_reports.body` is HTML narrative, `impression` is text, and `parameters` is null for radiology. The rich structured model that would make deterministic clinical checks universal — the D1 `StructuredReportDocument` (`structuredReport/types.ts`) with `Finding.presence/certainty/laterality/severity`, `Measurement.value/unit/normal_range/abnormal/prior_value/change_pct`, `critical_flags`, and finding-linked recommendations — **is fully specified AND already has a deterministic validator (`validator.ts` R0–R18), but is feature-flagged off and holds zero rows in prod** (`report_finding_instances` confirmed empty by drift tooling; `patient_reports.structuredJson` "not read or written by any route yet").

So deterministic reach today is **bimodal**:
- **Near-complete** for USG/OB/fetal, Doppler, and spine — these have genuinely typed side tables.
- **Text-heuristic only** for the CT/MR/X-ray narrative body, which is where most reporting volume lives.

The engineering move PR#101 should make is **not authoring new checks** (six-plus overlapping engines already exist — `reportValidator`, `checklistEngine`, `missedFindingDetector`, `radiologyReportAssembler.runQAGuard`, `smartRadiology.runQualityChecks`, `usgQualityCheck`, plus `validator.ts`), but **consolidating them behind one contract and activating/populating the D1 layer so the already-written rules can fire on real data.**

Critically distinguish three states below: **LIVE-deterministic** (works now), **built-but-dormant** (rule coded, no data to run on), and **needs-build**.

---

## (1) Achievable deterministically TODAY

These run on data that is genuinely structured and populated in prod now.

**Fetal/OB — the gold standard, already live.** `fetal_usg_measurements` is all `numeric(p,s)` (crl/bpd/hc/ac/fl/efw, fetalHeartRate integer, afi, umbilicalArteryPi, etc.). `fetalUsgLevel4.ts` already runs `detectCriticalAlerts()` with ~11 hardcoded threshold rules (FHR 110–160, impossible FHR<50/>250, AFI<5/>24, CL<25, UA PI>1.5, EFW-vs-GA IUGR/macrosomia, twin discordance>20%, BPP<6) plus `calcAfiInterpretation`/`calcCervicalLengthInterpretation`, and it gates finalize on `criticalAlertsAcknowledged`. This *is* the working prototype of a deterministic clinical engine — it just needs generalizing, not building.
- **Measurement out-of-range / impossible values** ✅
- **EDD-vs-LMP+280d consistency** ✅ (structured date fields, `sonologistAssistant.ts`)
- **Kidney symmetry** ✅ (the newer `real()` mm columns)

**RECIST response consistency** ✅ — `radiology_tumor_followups` stores `sizeMmAxis1/2/3` numeric + auto-computed `changePct`; checking that client-supplied `responseStatus` (CR/PR/SD/PD) agrees with computed change% is a pure deterministic add-on.

**Prior-vs-current numeric measurement delta** ✅ (where measurements were saved) — `radiology_measurements` grouped by label across studies; `LesionComparisonPanel.buildSeries` already computes delta/%change/trend/abnormal-vs-range client-side. Caveat: only exists when a radiologist explicitly saved ≥2 studies of measurements, and `value` is TEXT so it needs a `parseFloat`.

**Doppler index thresholds** ✅-with-parse — `usg_doppler_measurements` psv/edv/ri/pi/sdRatio are per-vessel structured, but stored as text strings ('0.73'); trivial parse.

**Structural / lexical checks — genuinely deterministic (not heuristic):**
- **Unfilled placeholder detection** (`{value}`, `___`) ✅ — the literal token is present or it isn't.
- **Duplicate sentence / duplicate impression line / repeated-word** ✅ — exact-match dedup (`reportValidator`, `quickFindingsMerge`).
- **Field presence completeness** (findings/impression/technique/history/recommendation/signature non-empty) ✅ — `computeQualityScore`, `reportQualityGates`.

**Protocol/study MODALITY mismatch** ✅-with-normalization — `RADIOLOGY_TEMPLATES[template_id].modality` (or `mri_protocol_specs.modality`) vs `dicom_studies.modality` (NOT NULL). Both structured; the only friction is three inconsistent vocabularies (DICOM `MR/CT/US/CR`; draft `MRI/CT/USG/X-RAY`; template-family `CT_BRAIN`). One normalizer fixes it.

**Referential recommendation↔finding & critical↔finding** — *built-but-dormant.* `validateStructuredReport` R2/R9/R17 deterministically prove every `recommendation.finding_refs`/`critical_flag.finding_ref` resolves to a real `finding.lid`, and R7 blocks presence=normal carrying positive severity. This is coded and wired into `patient-reports.ts` finalize — **but only fires on reports authored through the D1 writer, which is off.** Deterministic-ready, blocked on data population, not on logic.

---

## (2) Require more structure — and the minimal unlock

**Full-report normal-vs-abnormal contradiction.** Needs an explicit normal/abnormal flag. Today `AbnormalityInstance` (side/severity/chronicity/level/value) has **no `is_normal` boolean and no organ/anatomy code**; the `QuickFinding` catalog has only free-text `category`/`studyType`/`tags`. **Minimal unlock:** add `presence`/`is_normal` + an organ code to the catalog row + instance. The D1 model already has `Finding.presence` — activating D1 unlocks this for the Quick-Select subset for free.

**Measurement out-of-range for general (non-fetal/spine) modalities.** `radiology_measurements` already carries `normalRangeLow/High` per row — but `value` is TEXT and `isAbnormal` is **client-supplied and never computed against the range** (route does `m.isAbnormal ?? false`). **Minimal unlock (cheapest high-value change in the whole PR):** at `POST /radiology-lesions/measurements`, server-compute `isAbnormal = parseNumeric(value) ∉ [low,high]`. Add a single canonical reference-range table to replace the four divergent sources (`radiologyMeasurementLibrary.ts` prose strings, `MEASUREMENT_TEMPLATES` numeric dict, per-row columns, inline fetal thresholds).

**Measurement-vs-impression cross-check** ("measurement abnormal but impression says normal"). Blocked by the **hard linkage gap**: there is NO FK from any measurement row to a report/finding, and measurements reach the impression only as regex-inserted prose (`measurementVars.upsertMeasurement`), leaving no back-reference. **Minimal unlock:** D1 `Measurement.abnormal` + `measurement_refs` (measurement→finding→impression). Requires D1 population — no cheap shortcut.

**Recommendation appropriateness** ("BI-RADS 4 requires biopsy"). The referential half exists (R2); the **clinical-match half does not exist anywhere.** The rule *shape* is defined (`AiCompletenessRule.require[]`, `AiContradictionRule.when[]/forbid[]`) and the seed content exists (`FOLLOW_UP_DATABASE`, ~20 condition→followup entries) — but `rec.*`/`crit.*` codes have **no live backing table**, and the importer **discards** pack criticals/templates/AI-rules at import (validation-only). **Minimal unlock:** persist those in `runImport()` + implement `AiRulesRegistryPort.rulesForFinding()` against that table (the port is the designed seam; today `patient-reports.ts` injects `UnavailableAiRulesRegistryPort()` so R15/R16 never fire). Medium effort, all scaffolding present.

**Template completeness (missing sections).** `RADIOLOGY_TEMPLATES.sections` is a structured ordered `string[]` and `findings_sections` is a JSON keyset — comparing them is deterministic, **but no section is marked mandatory**, so "incomplete" has no threshold. **Minimal unlock:** add `required:boolean` to the section list. Trivial.

**Protocol "all required sequences present."** Expected side is structured (`mri_protocol_specs.sequences[]`); **actual acquired side is not** (`dicom_study_series.seriesDescription` is free text; no structured "sequences acquired" record). Unlock requires parsing series descriptions (heuristic) or reading the manual QA checklist — so this is only partially escapable.

---

## (3) Only feasible as heuristic text-scan warnings

Everything that must read the free-text CT/MR/X-ray body is inherently keyword/regex — ship as warn-only, expect FP/FN. `reportValidator.validateReport` already implements most of these; **reuse, don't rebuild.**

- **Laterality mismatch in typed prose** (`/\bleft\b/` vs study description) — heuristic. (Note: laterality IS deterministic for the Quick-Select subset via `AbnormalityInstance.side` / D1 laterality enum; only the free-text path is heuristic.)
- **findings-vs-impression contradiction over prose** — keyword pairs, heuristic.
- **normal-vs-pathology contradiction** (`NORMAL_PHRASES` vs `PATHOLOGY_WORDS`) — heuristic, no structured normal flag on the full body.
- **gender/anatomy mismatch** (`.includes('prostate')` in a female study) — heuristic but robust/low-FP.
- **age-appropriateness, cross-modality terminology contamination, contrast contradiction** — keyword arrays, heuristic.
- **Critical-finding keyword detection** (`scanForCriticalFindings` 10 terms, `CRITICAL_KEYWORDS`) — heuristic and currently weak: **no negation handling** ("no pneumothorax" matches), single US spelling ("haemorrhage" missed). Ship as advisory only.
- **"Stone larger but impression says smaller"** — *hybrid.* The delta DIRECTION is deterministic from `radiology_measurements`; matching it to the impression's directional wording is text-scan. Emit only when a real numeric delta exists AND impression contains a contradicting directional keyword — otherwise it's noise.
- **Missed-finding / completeness checklist** (`detectMissedFindings`), **comparison-section-missing** (COMPARISON_KEYWORDS scan) — heuristic.
- **Terminology standardization / spelling normalization** (haemorrhage↔hemorrhage, synonyms): a deterministic *text transform*, but it's lexical normalization, not a clinical check. Best value is as a **preprocessing pass feeding the heuristic matchers above** (normalize spelling before keyword matching) rather than a standalone gate. None exists today.

---

## (4) Route through Copilot/AI, not the deterministic engine

- **Prior-report narrative comparison across two prose bodies** where no saved measurements exist — `POST /api/ai-reporting/compare` (LLM). The deterministic keyword versions (`compareReports`, `extractSize()` grabbing the first `\d+mm` with no anatomy binding) are too fragile to gate on. Route to Copilot.
- **Extracting structured clinical facts out of legacy free-text reports** (stone size, organ dimension, anatomy binding) so they can be checked — an NLP extraction problem. Route to AI extraction, or better, **capture structure at authoring time** (Quick Select / D1) instead of re-parsing prose.
- **Open-ended recommendation appropriateness** for findings with no rule-catalog entry ("hepatic hemangioma <5cm must not trigger urgent referral") — deterministic where a rule exists (bucket 2), AI otherwise.
- **Impression / differential / follow-up generation** (`suggestImpression`, `DIFFERENTIAL_DATABASE`, `FOLLOW_UP_DATABASE`) — generation, not a check; already knowledge-base/AI.
- **Any check requiring semantic negation / hedging / temporality understanding in prose** — route to AI; do not fake it deterministically.

Surface all of these through the **existing** `CoPilotSuggestion` inline-nudge UI (`observeReportText` → `RadiologyReportingWorkspace.tsx:4192`) with Apply/Dismiss, and persist accept/dismiss via `/radiology-copilot/log` + `profile.ignoredWarnings[]`. Do not build a parallel AI surface.

---

## Minimal-structuring priority list (what buys the most deterministic reach)

| # | Change | Unlocks | Effort |
|---|--------|---------|--------|
| 1 | Server-compute `isAbnormal` from `normalRangeLow/High` at `POST /radiology-lesions/measurements` | Out-of-range for every modality with saved measurements | Trivial |
| 2 | Numeric parse + unit normalization (mm/cm) layer over TEXT numeric columns (Doppler, `radiology_measurements.value`, `usg_measurements`) | Reliable numeric comparison & prior-delta | Small |
| 3 | Add `required:boolean` to template section lists (`RADIOLOGY_TEMPLATES`, structured templates) | Template-completeness threshold | Trivial |
| 4 | One modality canonicalizer covering MR/CT/X-ray (extend `usgModality.normalizeModality`) | Protocol/study modality-mismatch, single rule scope | Small |
| 5 | Persist pack criticals/templates/AI-rules in `runImport()` + implement `AiRulesRegistryPort` | R15/R16 completeness/contradiction + recommendation appropriateness | Medium |
| 6 | Add `is_normal`/presence + organ code to QuickFinding catalog + `AbnormalityInstance` | Structured normal-vs-abnormal & organ-scoped contradiction for Quick-Select | Small–Med |
| 7 | Activate D1 dual-write (`ff_radiology_structured_d1_draft`/`core`) so `structured_json_d1` populates | The entire `validator.ts` R0–R18 corpus + measurement↔finding↔impression linkage on real data | Large / foundational |

Items 1–4 are cheap and deliver real deterministic checks against **today's** data. Item 7 is the foundational bet: it converts a large body of already-written, already-validated deterministic logic from "dormant" to "live," and is the only path to universal (CT/MR/X-ray) structured checks. Until it lands, treat the CT/MR/X-ray narrative engine as **heuristic-warn-only** and be honest that the "deterministic clinical checks" claim holds fully only for USG/OB/fetal, Doppler, spine, and saved-measurement comparisons.

**Cross-cutting caveat:** consolidate the three disjoint persistence stores (`report_quality_gates` booleans, `report_quality_checks` PASS/WARNING/BLOCKER, `ai_quality_scores` analytics, plus the sign-time audit blob) into one canonical per-report quality record, and standardize on `computeQualityScore`/`validateReport` + `validator.ts` as the core. Adding a seventh engine is the primary duplication risk flagged in every audit.