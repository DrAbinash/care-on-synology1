# CARE Clinical Decision Support — the Clinical Recommendation Registry

**Status: clinical intelligence by composition.** No new engine, no AI/Copilot/
Companion/Quality V2. The platform becomes a clinical decision-support platform
by adding **one shared registry** (`clinicalRecommendations.ts`) that every
existing system consumes. A recommendation is never hardcoded inside an MRI,
USG, CT or X-Ray code path — it always comes from the registry.

This document is the 15-part deliverable.

---

## 1. Audit

Every deterministic recommendation already in the platform was located first:

| Source | What it holds | Finding |
|---|---|---|
| `radiologyFollowUpEngine.ts` | `FOLLOW_UP_DATABASE` — 18 graded condition groups (meningioma, BI-RADS, TI-RADS, Bosniak, PI-RADS, AAA, nodule, stenosis, …) | **Hardcoded** — the exact anti-pattern this PR removes; now derived from the registry |
| Knowledge Pack manifests (CT 28, XR 40) | `recommendations`, `criticalFindings`, `qualityRules`, `companionRules` | Pack-level data — packs now *activate* registry entries via `knowledgePackRefs`; text not duplicated |
| Copilot impression rules (`impressionRule*` + CT/XR seeds) | Deterministic impression lines | Left untouched — impression phrasing, not follow-up recommendations |
| Copilot modules (comparison / measurement / critical / USG clinical) | Advisories with `why` | Reused as the consumption pattern; the new module follows it |
| Companion (`usgCompanionSuggestions`) | questionsJson follow-up questions | Reused as the question surface; registry questions append to it |
| Quality Engine (`lib/report-quality`) | Structured rules over measurements | Reused as trigger *inputs* (rule ids referenced via `qualityRuleRefs`) |
| Comparison (`radiologyComparison`) | Significant interval changes | Reused as trigger *inputs* (`priorChanges`) |
| Knowledge Base / Teaching | Reference articles | Referenced via `references`; not duplicated |

## 2. Existing recommendations reused

All 44 graded follow-up conditions from `FOLLOW_UP_DATABASE` were **migrated
into the registry** (trigger kind `condition`) and the legacy database is now
**derived** from the registry (`legacyFollowUpDatabase()`) — the Follow-Up
panel and `RadiologyAICopilotPanel` keep their exact API and data shape, with
one source of truth. Knowledge-Pack `recommendations` strings remain pack data;
the measurement-triggered registry entries reference their packs instead of
duplicating them.

## 3. Registry

`artifacts/diagnostic-erp/src/lib/clinicalRecommendations.ts` — 53 entries,
v1.0.0. Every entry carries the full contract: **id** (hierarchical `rec.*`),
title, description, **trigger conditions** (measurement threshold / comparison
delta / finding text / graded condition), **measurement references**, **quality
rule references**, **knowledge pack references**, severity, priority,
**evidence level**, **recommended follow-up** (action + interval),
**contraindications**, **references**, follow-up questions, **version**.
`matchRecommendations()` is a **pure lookup/filter** (same stateless registry
semantics as `matchStudyRegion`) — not an engine: no state, no I/O, no AI.

## 4. Quality integration

Triggers consume Quality-Engine-adjacent outputs deterministically, exactly as
specified: `Stone size > 6 mm → urology opinion` · `Midline shift > 5 mm →
urgent neurosurgical review` · `CBD > 7 mm → correlate with LFT` · `Nodule ≥
6 mm → Fleischner guidance` · `CRL inconsistent → review dating` · `CTR > 0.5 →
clinical correlation`. Entries carry `qualityRuleRefs` (e.g.
`care.structured.range.brain.midline-shift`) linking them to the rule catalog.
Nothing hardcoded — all registry-driven.

## 5. Measurement integration

Trigger labels match the seeded Measurement Registry labels verbatim ("Stone
size", "Midline shift", "CBD diameter", "Nodule size", "Cardiothoracic ratio").
Values arrive through the data the workspace already threads to Copilot
(`viewerMeasurements` — accepted viewer/DICOM-SR/quick measurements). mm↔cm is
reconciled before comparison; incompatible units are skipped (never guess), the
same convention as the Quality-Engine executors.

## 6. Knowledge Pack integration

Packs **activate** recommendations: entries list `knowledgePackRefs`
(`ct.kub`, `ct.brain_plain`, `ct.hrct_chest`, `usg.whole_abdomen`,
`usg.thyroid`, `usg.breast`, …). The admin manager shows per-pack coverage.
Packs do not duplicate recommendation text.

## 7. Companion integration

The Companion **consumes** the registry and **asks questions** — it creates
nothing. `recommendationQuestions()` returns the matched entries' follow-up
questions ("Hydronephrosis present?", "Stone density (HU)?", "Basal cisterns
effaced?") which `UsgCompanionPanel` appends to its existing quick-select
suggestions (same `CompanionSuggestion` shape, `kind: "followup"`).

## 8. Copilot integration

`copilotRecommendationModule.ts` — registered into the existing module registry
(same self-registering pattern as comparison/measurement/critical). Copilot
explains **WHY, not WHAT**: each advisory's `why` carries the rationale,
evidence level, references, caveats, and the registry entry id + version
(provenance — no hidden logic). `insertText` remains advisory; the radiologist
decides.

## 9. Comparison integration

Comparison-triggered entries consume the existing Previous-Comparison
significant-change output: `Stone increased → document interval progression` ·
`Nodule grew → short-interval follow-up CT (growth exits routine surveillance)`
· `Disc herniation changed → correlate with symptoms`. All deterministic.

## 10. Dashboard

The Registry Manager's dashboard block shows: entries by severity (top
triggers), trigger kinds, and Knowledge-Pack coverage — computed
deterministically from the registry. **Honest limitation:** frequently
overridden / most-ignored recommendation rates require runtime telemetry
(acceptance events) that does not exist yet; adding it needs a schema change
and is documented as follow-up rather than smuggled in.

## 11. Admin

`/settings/radiology/recommendations` → `ClinicalRecommendationRegistryManager`
(admin-gated like the Knowledge Pack Manager): search across id/title/pack/
rule/measurement, severity + modality filters, and per-entry **impact
analysis** (Knowledge Pack usage, Quality Rule usage, Measurement usage,
Companion question count, Copilot surfacing). Read-only: the registry is
versioned data changed through code review, like the executor rule catalog.

## 12. Validation

`clinicalRecommendations.test.ts` covers all four modalities: the six worked
examples fire with correct severity/priority; unit reconciliation (0.7 cm fires
a 6 mm rule; HU never guesses); comparison triggers; modality scoping (XR/X-RAY
variants, MRI excluded from CTR); **no duplicate ids; no conflicting advice**
(one entry per measurement-label × comparator × modality); **no orphans**
(every entry anchors to a pack, rule, measurement, or graded condition);
complete metadata; legacy DB derivation intact (18 groups, priorities
preserved); Copilot + Companion consumption. All assertions were additionally
executed offline against the **compiled real code** (tsc → node) — all pass —
and the merged platform-contract invariants were re-verified (no new engine, no
modality fork introduced).

## 13. Performance

`matchRecommendations` is a single pass over 53 entries with label/threshold
comparisons — microseconds per evaluation, run inside the existing debounced
Copilot analysis; no new queries, no new renders on any non-matching path.

## 14. Remaining recommendations (backlog — data only)

Fetal biometry thresholds (AFI/FHR/cervical length → registry entries referencing
the existing `care.structured.range.fetal.*` rules) · aneurysm size tiers (CTA)
· hydronephrosis grading → urology · interval-change entries for hemorrhage
volume and pleural effusion · MRI-specific packs (`mri.*`) currently have no
measurement-triggered entries. All are additive registry rows.

## 15. Clinical readiness

The six guideline-anchored measurement entries and three comparison entries are
conservative, evidence-labeled (`guideline`/`consensus`) and advisory-only —
they never block, never auto-insert, and always show their provenance. The 44
migrated condition entries carry unchanged, already-in-production text. Ready
for shadow clinical use immediately; the registry's `evidenceLevel` +
`version` fields support the same clinical-review lifecycle the Quality Rule
Authoring Guide defines before any future gating.

---

**Success criterion met:** no recommendation is hardcoded inside any modality
path. Copilot, Companion, the Follow-Up panel and Knowledge Packs all draw from
the one shared Clinical Recommendation Registry — clinical decision support
without a single new engine.
