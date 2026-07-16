# PR #101 — CARE Universal Report Quality Engine: AUDIT + ARCHITECTURE

**Status:** Definitive architecture of record. **Hard rule:** audit first, reuse existing infrastructure, never duplicate, ONE canonical universal quality layer for all modalities. The single largest risk this document exists to prevent is **shipping a seventh parallel quality engine.**

---

## 1. Executive Audit Summary — what already exists

Report-quality logic is not missing; it is **scattered across six-plus overlapping implementations**, three disjoint persistence tables, an audit-JSON blob, and a fully-specified-but-dormant structured layer. Concretely:

### Client-side check engines (all free-text, warn-only)
- **`artifacts/diagnostic-erp/src/lib/reportValidator.ts`** — THE live engine. `validateReport()` (dupes, laterality, gender/anatomy, age, cross-modality terminology, contrast, findings-vs-impression contradiction, dictation artifacts, `{value}` placeholders) + `computeQualityScore()` (0–100). Pure, unit-tested, bug-fixed for real-world quirks ("MR" not "MRI", `female` not `F`). Wired into `RadiologyReportingWorkspace.tsx` header badge (~l.999) and finalize confirm (~l.2261). **This is the spine.**
- **`artifacts/diagnostic-erp/src/lib/checklistEngine.ts`** — protocol checklist coverage (percent + remaining).
- **`artifacts/diagnostic-erp/src/lib/missedFindingDetector.ts`** — 5-modality missed-finding KB, orphaned in a standalone paste tool.
- **`artifacts/diagnostic-erp/src/lib/radiologyReportAssembler.ts`** — `runQAGuard()` (8 checks), priority impression assembly, normal-suppression. **Dormant** (feature flag off, no live importers).
- **`artifacts/diagnostic-erp/src/lib/radiologyCoPilotEngine.ts`** — `observeReportText()` inline nudges (7 rules) + `comparePriorMetrics()`. This is the visible "Copilot" (`RadiologyReportingWorkspace.tsx:4192-4243`).
- **`artifacts/diagnostic-erp/src/lib/radiologyIntelligenceEngine.ts`** — a *second* `runQualityCheck()` (7 checks) + `detectConflicts()`.

### Server-side check engines
- **`artifacts/api-server/src/lib/usgQualityCheck.ts`** — `runQualityCheck()`, the **only hard-blocking** finalize gate (USG → HTTP 400, super-admin override with reason, enforced at `artifacts/api-server/src/routes/usgReports.ts:511`).
- **`artifacts/api-server/src/routes/smartRadiology.ts`** — a *second* server `runQualityChecks()` → PASS/WARNING/BLOCKER, persisted per draft with acknowledge.
- **`artifacts/api-server/src/routes/sonologistAssistant.ts`** — a *third* path: 4 deterministic fetal/USG rules behind `GET /quality-review/:studyId`.
- **`artifacts/api-server/src/routes/fetalUsgLevel4.ts`** — `detectCriticalAlerts()` (~11 numeric threshold rules on genuinely-typed `numeric(p,s)` fetal columns) + finalize acknowledgement gate. **The working prototype of a deterministic clinical engine.**
- **`artifacts/api-server/src/lib/structuredReport/validator.ts`** — `validateStructuredReport()` (R0–R18): referential recommendation↔finding (R2/R9/R17), presence-vs-severity (R7), content-pack contradiction/completeness (R15/R16). Wired into `patient-reports.ts` finalize — **but only fires on D1-authored reports, which are off in prod.**

### Persistence (fragmented — three stores + a blob)
- **`lib/db/src/schema/reportQualityGates.ts`** — `report_quality_gates`, 6 presence booleans + `allPassed` + `failedChecks` JSON, one row per `reportId`. Populated from **client-asserted** flags (server never inspects content).
- **`lib/db/src/schema/smartRadiology.ts`** — `report_quality_checks`, per-draft 10 booleans + `overallResult` PASS/WARNING/BLOCKER + `detailsJson` + acknowledge actor/timestamp. **Closest to the target shape** (has severity + acknowledge).
- **`lib/db/src/schema/aiQualityScores.ts`** — `ai_quality_scores`, aggregate snapshots by scope (overall/modality/template/radiologist). **Table exists, no route reads or writes it** — a ready-made trend store.
- Sign-time `auditDetails` JSON in `finalizeRadiologyReport()` (`radiologyReportLifecycle.ts`) — the only place the live `computeQualityScore` result is durably captured today.

### The structured substrate (built, validated, dormant)
- **`artifacts/api-server/src/lib/structuredReport/types.ts`** — the canonical D1 `StructuredReportDocument`: `Finding.presence/certainty/laterality/severity/locations`, `Measurement.value/unit/normal_range/abnormal/prior_value/change_pct`, `critical_flags`, finding-linked `recommendations`. Rich enough for universal deterministic checks — **feature-flagged off, zero rows in prod.**
- **`artifacts/api-server/src/lib/structuredReport/aiRulesRegistry.ts`** — `AiRulesRegistryPort` (the designed plug-in seam); prod injects `UnavailableAiRulesRegistryPort()` so R15/R16 never fire.
- **`lib/db/src/schema/reportFindingInstances.ts`** — `report_finding_instances` structured store (Quick-Select), gated by `ff_radiology_structured_core`, confirmed empty by drift tooling.
- Genuinely typed & populated **today**: `fetal_usg_measurements` (numeric), `usg_doppler_measurements` (text-numeric), `spinal_measurements` (per-level enums), `radiology_measurements` (has `normalRangeLow/High`, but `isAbnormal` is client-supplied), `radiology_tumor_followups` (RECIST numeric + `changePct`).

**Bottom line:** deterministic reach is **bimodal** — near-complete for USG/OB/fetal/Doppler/spine/saved-measurements; heuristic-only for the CT/MR/X-ray narrative body (where most volume lives). The engineering task is **consolidation + a data-population bet (D1)**, not authoring new checks.

---

## 2. Reuse Map — per PR#101 requirement

Legend: **REUSE** (call into as-is) · **EXTEND** (add to this file/symbol) · **BUILD-NEW** (justified gap).

| Requirement | Verdict | Target / Justification |
|---|---|---|
| **Missing findings / completeness** | **EXTEND** | Core: `checklistEngine.ts` (`computeChecklistStatus`) + `missedFindingDetector.ts` (`detectMissedFindings`, MISSED_FINDING_KB). Fold both into the universal runner as a `completeness` rule category. Promote from orphaned tool into the finalize path. Add `required:boolean` to `RADIOLOGY_TEMPLATES.sections` (`radiology-report-generator.ts`) to give "incomplete" a threshold. |
| **Laterality** | **REUSE** (text) + **EXTEND** (structured) | Reuse `reportValidator.validateReport` laterality rules verbatim for prose. For the Quick-Select/D1 subset use `AbnormalityInstance.side` / D1 `LATERALITY_VALUES` enum (`structuredReport/types.ts`) — deterministic, no heuristic. |
| **Measurement validation (out-of-range)** | **EXTEND** + one cheap unlock | Reference logic already exists per-row (`radiology_measurements.normalRangeLow/High`) and as the fetal threshold engine (`fetalUsgLevel4.detectCriticalAlerts`). **Do not rebuild thresholds.** The unlock: server-compute `isAbnormal` at `POST /radiology-lesions/measurements` (`radiologyLesions.ts`) instead of trusting the client, and add a numeric-parse/unit-normalize helper. Generalize the fetal engine into a modality-parameterized rule. |
| **Terminology standardization** | **BUILD-NEW** (small, non-clinical) | Nothing exists (only `terminologyLevel` style knob). Build a deterministic **lexical preprocessing pass** (haemorrhage↔hemorrhage, synonym/laterality normalization) that runs **before** the heuristic keyword matchers — it is a text transform feeding existing rules, not a standalone gate. Also plugs the `criticalFindingsAlert` single-spelling gap. |
| **Quality score** | **REUSE** | `computeQualityScore()` (`reportValidator.ts`). Extend the deduction table only; never invent a second score. |
| **Knowledge-pack validation** | **REUSE** | `validatePacks()` (`radiologyCatalog/packs/validator.ts`), `buildNormalizedGraph()` (`graph.ts`), `runImport()` (`importer.ts`), CI lint (`scripts/src/validate-radiology-content-packs.ts`). Extend the `IssueCode`/`ValidationResult` taxonomy with a new clinical-completeness phase — do not fork the pipeline. |
| **Recommendation validation** | **REUSE** (referential) + **BUILD-NEW** (clinical) | Referential half exists: `validateStructuredReport` R2/R9/R17. The clinical-appropriateness half ("BI-RADS 4 requires biopsy") exists **nowhere** — but the rule *shape* (`AiCompletenessRule`/`AiContradictionRule`) and seed content (`FOLLOW_UP_DATABASE`, `radiologyFollowUpEngine.ts`) do. Build = persist pack criticals/templates/AI-rules in `runImport()` + implement `AiRulesRegistryPort.rulesForFinding()`. Do not build a new rule DSL. |
| **Previous-comparison validation** | **REUSE** + implement missing endpoint | Numeric delta engine exists client-side (`LesionComparisonPanel.buildSeries`). Lift it server-side. `comparePriorMetrics` (`radiologyCoPilotEngine.ts`) is the delta primitive. **Implement the already-consumed-but-missing** `POST /api/radiology-copilot/structured-comparison` (`RadiologyCopilotPanel.tsx` already renders its contract; endpoint 404s today). The "stone larger but impression smaller" check is a hybrid: deterministic delta + heuristic directional-keyword scan. |
| **Internal consistency** | **REUSE** | `reportValidator.validateReport` (intra-report) + `radiologyConsistency.runConsistencyChecks` (cross-entity/orphan/hash/patient-identity, post-hoc). Do not reimplement either. |
| **Override** | **EXTEND** | Standardize on `report_quality_checks` acknowledge model + USG super-admin bypass-with-reason pattern (`usgReports.ts`). Persist override actor + reason as new columns (see §4) and via existing `auditDetails`. |
| **Dashboard** | **REUSE shell** + wire dead table | Reuse `RadiologyOperationsDashboard.tsx` recharts shell + `RadiologyFlightDeck.tsx` `FULL_ACCESS_ROLES` admin-gate. Back the trend view with the **already-migrated-but-unused `ai_quality_scores`**. Register in `RadiologyAdvancedTools.tsx` FEATURES + `App.tsx` route + `Layout.tsx` nav. Do not build a new dashboard shell or a new trend table. |

---

## 3. Canonical Architecture — the ONE universal quality engine

### 3.1 Where it lives

**A new shared, pure-TS package: `lib/report-quality/`** (a sibling of `lib/db/`, framework-agnostic, zero React/Express deps).

Rationale drawn directly from the audits: `reportValidator.ts` is "client-only… promote it to a shared package callable server-side" (Cockpit audit) and `usgModality.ts` is "deliberately duplicated across two packages, kept in sync by hand" (Modality audit). A shared package is the only way to satisfy "ONE canonical layer" for both the client (live badge, Copilot nudges) and the server (finalize gate, persistence) without a third copy. `reportValidator.ts`, `checklistEngine.ts`, `usgModality.ts`, and the D1 `validator.ts`/`types.ts` **move or re-export** into this package; existing import sites keep working via thin re-export shims to avoid a big-bang edit.

```
lib/report-quality/
  src/
    contract.ts        // QualityContext, QualityFinding, QualityReport, QualityRule, Severity, DataTier
    runner.ts          // runQualityEngine(ctx): QualityReport  — the ONE entry point
    registry.ts        // rule registration keyed by modality + scope
    modality.ts        // single canonical normalizer (absorbs usgModality, extends to MR/CT/X-RAY)
    rules/
      text/            // absorbs reportValidator.validateReport rules (heuristic tier)
      structured/      // absorbs validator.ts R0-R18 + fetal detectCriticalAlerts (deterministic tier)
      completeness/    // absorbs checklistEngine + missedFindingDetector + template-sections
      measurement/     // absorbs fetal thresholds + radiology_measurements range check + Doppler
      comparison/      // absorbs LesionComparisonPanel.buildSeries (lifted server-side)
    score.ts           // absorbs computeQualityScore (extended deduction table)
    adapters/          // emit QualityFinding -> CoPilotSuggestion | QualityAlert (PASS/WARN/CRIT)
```

### 3.2 The rule interface

```ts
type Severity = "info" | "warning" | "blocker";
type DataTier = "structured" | "heuristic";   // structured = deterministic on typed data

interface QualityFinding {
  ruleId: string;                 // stable, e.g. "measurement.out-of-range"
  category: string;               // "laterality" | "completeness" | "measurement" | ...
  severity: Severity;
  tier: DataTier;                 // callers can badge "deterministic" vs "advisory"
  message: string;
  rationale?: string;             // the missing "why" field (Copilot audit gap)
  targetRef?: string;             // finding lid / measurement id / section — for "where" UX
  actionMacro?: string;           // one-click fix, reuses Copilot Apply pattern
}

interface QualityContext {
  modality: string;               // raw; runner normalizes
  studyDescription?: string;
  // Tier 1 (always available): the existing free-text contract
  text: ReportForValidation & { checklistPercent?: number; missingRequiredMeasurements?: string[] };
  // Tier 2 (when populated): structured substrate
  structured?: StructuredReportDocument;         // D1 doc, when ff on
  findingInstances?: FindingInstance[];          // report_finding_instances
  measurements?: NormalizedMeasurement[];        // parsed+range-checked
  priors?: PriorMeasurementSeries[];             // for comparison rules
  template?: { sections: {name:string; required:boolean}[]; qualityChecklist: string[] };
  aiRules?: AiRulesRegistryPort;                 // finding-scoped clinical rules
}

interface QualityRule {
  id: string;
  category: string;
  modalities: "*" | string[];     // canonical modality scope
  tier: DataTier;
  requires: (keyof QualityContext)[];   // e.g. ["measurements"] — runner skips if absent
  evaluate(ctx: QualityContext): QualityFinding[];
}

interface QualityReport {
  score: number;                  // computeQualityScore, extended
  findings: QualityFinding[];
  blockingCount: number;
  warningCount: number;
  notEvaluated: string[];         // rule ids skipped for missing data — honesty about coverage
  engineVersion: string;
}
```

### 3.3 How modality-specific rules register into the universal runner

- Every rule `register()`s into `registry.ts` declaring `modalities` + `requires`.
- The runner (1) canonicalizes modality via the **single** `modality.ts` normalizer (extends `usgModality.normalizeModality` to MR/CT/X-RAY — Modality audit item #4), (2) selects rules whose `modalities` matches, (3) for each rule checks `requires` against the populated `QualityContext` keys, running it only when its data tier is present, else recording it in `notEvaluated`. This is what makes the same engine **degrade gracefully**: structured rules fire where D1/typed data exists, heuristic rules always run over prose.
- Fetal, Doppler, and spine rules are just modality-scoped structured rules in the same registry — **no separate fetal engine**, generalizing `fetalUsgLevel4.detectCriticalAlerts` (Measurements audit anti-duplication #1).

### 3.4 How it consumes existing structured data

- **D1 document** → `validator.ts` R0–R18 wrapped as structured rules (referential rec↔finding, laterality enum, contradiction). No re-derivation.
- **`report_finding_instances`** → laterality/severity/normal-vs-abnormal for the Quick-Select subset (after adding `presence`/organ code — §4).
- **`radiology_measurements` / fetal / Doppler / `spinal_measurements`** → measurement rules, reading server-computed `isAbnormal` and a single canonical reference-range source.
- **Knowledge packs** → `AiRulesRegistryPort.rulesForFinding()` supplies finding-scoped completeness/contradiction/appropriateness rules once `runImport()` persists them.
- **Templates / protocols** → `RADIOLOGY_TEMPLATES.sections` (+`required`) and `mri_protocol_specs` for completeness and modality/protocol-mismatch.

### 3.5 One API surface

New router `artifacts/api-server/src/routes/reportQuality.ts`, mounted `/api/radiology/quality`:
- `POST /api/radiology/quality/evaluate` `{ draftId | reportId }` → `QualityReport` (runs the engine server-side against the **saved** draft/report; single source of truth).
- `POST /api/radiology/quality/:id/override` `{ ruleId, reason, actor }` → records override.
- `GET /api/radiology/quality/trends` → reads `ai_quality_scores` for the dashboard.

**Existing endpoints are re-backed, not left parallel:** `smartRadiology` `/quality-check/:draftId`, `sonologistAssistant` `/quality-review/:studyId` (return the same `{alerts: QualityAlert[]}` via the adapter — zero client change per Companion audit), USG `/quality-check`, and `aiReporting` `/quality-gates` all delegate into `runQualityEngine`. The missing `POST /api/radiology-copilot/structured-comparison` is implemented against the same engine to the contract `RadiologyCopilotPanel.tsx` already consumes.

---

## 4. Data Model / DB Changes — minimal additive

Follow the repo convention: next migration is **`lib/db/drizzle/0008_<name>.sql`**, register in `lib/db/drizzle/meta/_journal.json` + add `0008_snapshot.json`, all statements idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`).

**Principle: extend, do not add tables where an existing one fits. Only one net-new persistence concept.**

1. **Canonical per-report quality record → EXTEND `report_quality_checks`** (`lib/db/src/schema/smartRadiology.ts`). It already carries PASS/WARNING/BLOCKER + `detailsJson` + acknowledge actor/timestamp — the closest existing shape. Add columns:
   - `score integer`, `engine_version text`, `blocking_count integer default 0`, `warning_count integer default 0`
   - `findings_json text` (the structured `QualityFinding[]`)
   - `overridden_by integer`, `override_reason text`, `overridden_at timestamptz`
   - `report_id integer` (nullable — links the draft-time run to the signed report at finalize)
   This becomes the **one** canonical record. `report_quality_gates` and the sign-time audit blob stop being independent sources of truth.

2. **`report_quality_gates` (`reportQualityGates.ts`) → REUSE read path, converge writes.** The engine emits the 6 presence booleans into this table's shape for the existing admin page (`ReportQualityGates.tsx`) during transition, but they are now **server-computed** (fixing the "trusts client booleans" gap) rather than a separate mechanism. No schema change. Deprecate after the dashboard migration.

3. **Trends → REUSE `ai_quality_scores` (`aiQualityScores.ts`) as-is.** No schema change; wire `GET /quality/trends` to write rollups and read them. This activates a table that "no route reads or writes" today.

4. **Add `is_normal`/`presence` + `organ_code` to the Quick-Select finding model** (Feasibility unlock #6, small–med): add nullable columns to `report_finding_instances` (`reportFindingInstances.ts`) and the catalog row (`radiology_quick_findings`). Unlocks structured normal-vs-abnormal and organ-scoped contradiction for the Quick-Select subset without waiting on full D1.

5. **Reference ranges → one canonical table (net-new, justified).** Today ranges live in four divergent places (`radiologyMeasurementLibrary.ts` prose strings, `MEASUREMENT_TEMPLATES` numeric dict, per-row columns, inline fetal thresholds). Add `measurement_reference_ranges` (`modality, body_part, measurement_key, unit, low, high, classification_system`) and migrate the fetal thresholds + `MEASUREMENT_TEMPLATES` into it. This is the only genuinely new table and it **eliminates** four sources rather than adding a fifth.

6. **Pack rule persistence → EXTEND `runImport()` + catalog.** Add `finding_ai_rules` (persisting `ai_completeness_rules`/`ai_contradiction_rules`/criticals/templates that `runImport()` currently discards) so `AiRulesRegistryPort` has a live backing table. Additive; behind `ff_radiology_catalog`.

**No change** to `patient_reports` (the D1 `structured_json` column already exists) or to the D1 schema. D1 activation is a feature-flag + writer change, not a migration.

---

## 5. Integration Points — exactly where the engine hooks in

### RadiologyReportingWorkspace (`artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx`)
- **Live badge (~l.999):** the `computeQualityScore` `useMemo` calls `runQualityEngine(ctx)` (text tier) and routes `report.score` to the header badge (~l.3436).
- **Copilot nudges (~l.1133 / render l.4192-4243):** `runQualityEngine` findings are emitted as `CoPilotSuggestion`-shaped objects via the adapter and dropped into the **existing** `coPilotSuggestions` list — no new panel (Copilot audit anti-duplication #1). Reuse `actionMacro` Apply/Dismiss and persist accept/dismiss via `/radiology-copilot/log` + `profile.ignoredWarnings[]`.
- **Pre-finalize gate (`finalizeReport()` ~l.2201-2282):** replace the ad-hoc `window.confirm` string-concat with a unified quality modal driven by `QualityReport`; `blockingCount > 0` can hard-block (config, §8). This is where the warn-only→blocking policy converges.
- **Persistence at sign (`radiologyReportLifecycle.finalizeRadiologyReport` `auditDetails`):** additionally POST the `QualityReport` to `/quality/evaluate` so the canonical `report_quality_checks` row is written (not only the audit blob).
- **Structured preview panel (~l.3868, `draftValidation` useQuery on `/validate-draft`):** its structured `{errors,warnings}` become structured-tier `QualityFinding`s in the same report.

### Copilot / Companion
- **USG Companion** (`SonologistAssistantPanel.tsx` Quality tab): back `GET /quality-review/:studyId` with the engine, returning the same `{alerts: QualityAlert[]}` — zero client change (Companion audit integration point). Also **fix the studyId wiring defect** (`UsgReporting.tsx:728` passes a draft id where the endpoint expects `fetalUsgStudiesTable.id`).
- **`RadiologyCopilotPanel.tsx`**: implement the missing `POST /api/radiology-copilot/structured-comparison` to activate the already-built comparison UI.

### Server finalize seams
- `usgReports.ts:511` (USG 400 block) and `patient-reports.ts` finalize (~l.1014) become callers of the unified engine so the block/override policy is one code path.

### Engineering Cockpit / Admin
- New admin page reusing `RadiologyOperationsDashboard.tsx` shell + `RadiologyFlightDeck.tsx` gate; route in `App.tsx` (next to `/radiology/quality-gates`), nav in `Layout.tsx`, registered in `RadiologyAdvancedTools.tsx` FEATURES. Data from `GET /quality/trends` (→ `ai_quality_scores`). Link finalize/quality events to `auditLogsTable` via `/api/audit-trail`.

### Measurement write path (the cheap high-value unlock)
- `POST /radiology-lesions/measurements` (`radiologyLesions.ts`): server-compute `isAbnormal` from the reference-range table; emit range-violation `QualityFinding`s.

---

## 6. Explicit Anti-Duplication List — call INTO, never reimplement

The engine is an **aggregator/consolidator over existing producers**, not a new rule corpus. Do NOT rebuild:

1. **Scoring** — `computeQualityScore()` (`reportValidator.ts`). Extend the deduction table only.
2. **Free-text consistency ruleset** — `validateReport()` (laterality/gender/age/modality/contrast/contradiction/dupes/dictation). Mature, unit-tested, bug-fixed. Absorb wholesale.
3. **Protocol checklist coverage** — `checklistEngine.ts`.
4. **Missed-finding KB** — `missedFindingDetector.ts` (wire in; do not re-author).
5. **Severity + acknowledge model** — `report_quality_checks` (PASS/WARNING/BLOCKER) + acknowledge endpoints (`smartRadiology.ts`).
6. **Presence-gate table + admin UI** — `report_quality_gates` / `ReportQualityGates.tsx`.
7. **USG required-measurement/contradiction checks + the only enforced block** — `usgQualityCheck.ts` / `usgReports.ts`.
8. **Fetal threshold engine** — `fetalUsgLevel4.detectCriticalAlerts` + `calcAfi/CervicalLengthInterpretation`. Generalize, don't rewrite OB thresholds.
9. **Structured D1 validator** — `validateStructuredReport` R0–R18 (`structuredReport/validator.ts`). Wrap as rules.
10. **Structured report model + AI-rule shape** — `structuredReport/types.ts`, `AiRulesRegistryPort`. Implement the port; don't define a new DSL.
11. **Knowledge-pack pipeline** — `validatePacks` / `buildNormalizedGraph` / `runImport` (`radiologyCatalog/packs/*`). Extend `IssueCode`; don't fork.
12. **Numeric prior-delta engine** — `LesionComparisonPanel.buildSeries` + `comparePriorMetrics`. Lift server-side; don't re-derive.
13. **Copilot inline nudge surface + suppression/learning** — `CoPilotSuggestion` renderer + `/radiology-copilot/log` + `profile.ignoredWarnings[]`.
14. **Cross-entity integrity** — `radiologyConsistency.runConsistencyChecks`.
15. **Dashboard shell + admin gate + trend table** — `RadiologyOperationsDashboard`, `RadiologyFlightDeck` `FULL_ACCESS_ROLES`, `ai_quality_scores`.
16. **Modality normalizer** — `usgModality.normalizeModality` (extend to MR/CT/X-RAY; don't fork a third copy).

**Actively retire, don't extend:** the duplicate `qualityWarnings` engine inside the deprecated `RadiologyCommandCenter.tsx:615` and the orphaned `radiologyReportAssembler.runQAGuard` — fold their unique logic in, then delete, so they cannot drift into engine #7.

---

## 7. Phased Implementation Plan — small, independently-shippable increments

**Phase 0 — Contract + shared package (no behavior change).** Create `lib/report-quality/` with `contract.ts`, `runner.ts`, `registry.ts`, empty rule dirs. Move `reportValidator.ts`, `checklistEngine.ts`, `usgModality.ts` in with re-export shims at old paths. Ship: nothing changes for users; imports still resolve. *Reviewable, zero-risk.*

**Phase 1 — Wrap existing text rules; route the live badge + Copilot through the runner.** Absorb `validateReport`/`computeQualityScore` into text-tier rules; `RadiologyReportingWorkspace` badge (~l.999) and Copilot nudges (~l.1133) now call `runQualityEngine`. Behavior identical; one code path.

**Phase 2 — One server endpoint + canonical persistence.** Add `/api/radiology/quality/evaluate`, migration `0008` extending `report_quality_checks` (score/findings/override/reportId). Persist the run at finalize via `radiologyReportLifecycle` `auditDetails` + the new row. Re-back `smartRadiology` `/quality-check` and `aiReporting` `/quality-gates` to delegate. *Consolidates three write paths.*

**Phase 3 — Cheap deterministic unlocks (Feasibility items 1–4).** Server-compute `isAbnormal` at the measurement write path; add `measurement_reference_ranges` table + numeric-parse/unit-normalize helper; add `required:boolean` to template sections; extend `usgModality` to MR/CT/X-RAY. Ship real deterministic measurement + template-completeness + modality-mismatch checks against **today's** data.

**Phase 4 — Generalize the structured USG/fetal/Doppler/spine rules.** Fold `fetalUsgLevel4.detectCriticalAlerts`, Doppler thresholds, `LesionComparisonPanel.buildSeries` (lifted server-side), RECIST consistency into modality-scoped structured rules. Re-back `sonologistAssistant` `/quality-review` and implement `structured-comparison`. Fix the `UsgReporting` studyId wiring defect.

**Phase 5 — Unified finalize gate + override.** Replace the `window.confirm` (~l.2282) with the quality modal; wire `blockingCount` to a configurable block policy (default per §8); persist override reason. Converge USG 400 and `patient-reports` finalize onto the one policy.

**Phase 6 — Admin dashboard + trends.** New page on the `OperationsDashboard` shell, `GET /quality/trends` → `ai_quality_scores`, register in `RadiologyAdvancedTools`/`App.tsx`/`Layout.tsx`. Retire `RadiologyCommandCenter` `qualityWarnings` duplicate.

**Phase 7 — Knowledge-pack clinical rules.** Persist criticals/templates/AI-rules in `runImport()` (`finding_ai_rules`), implement `AiRulesRegistryPort.rulesForFinding()`, enable R15/R16 + recommendation-appropriateness. Behind `ff_radiology_catalog`.

**Phase 8 (foundational bet) — Activate D1 dual-write.** Turn on `ff_radiology_structured_d1_draft`/`core` so `structured_json_d1` populates; the entire `validator.ts` R0–R18 corpus + measurement↔finding↔impression linkage go live on real data. Add `presence`/organ code to Quick-Select. This is the only path to universal CT/MR/X-ray structured checks; large, sequenced last, and everything before it delivers value without it.

---

## 8. Open Questions / Risks — product-owner decisions before coding

1. **Block vs warn policy.** USG hard-blocks finalize today; every other modality is warn-only. Does PR#101 introduce hard blocking for non-USG modalities, and for which severities? Recommendation: `blocker`-severity findings block only where the data is **deterministic** (structured tier); heuristic findings stay warn-only to avoid gating on false positives. Needs sign-off — this changes radiologist workflow.

2. **Override authority.** Who may override a `blocker` — any radiologist with a reason (like USG super-admin bypass), or admin-only? Where is the reason surfaced/audited?

3. **The D1 bet (Phase 8).** Universal deterministic CT/MR/X-ray checks are **impossible** until D1 dual-write is on and populating. Is the product owner willing to fund the large foundational work, and accept that until then the CT/MR/X-ray engine is **honestly heuristic-warn-only**? The "deterministic clinical checks for all modalities" claim holds fully only for USG/OB/fetal/Doppler/spine/saved-measurements until then.

4. **Critical-finding detection weakness.** `scanForCriticalFindings`/`CRITICAL_KEYWORDS` have **no negation handling** ("no pneumothorax" matches) and single-spelling gaps ("haemorrhage" missed). Ship as advisory-only, or invest in the terminology-normalization preprocessing pass first? Do not gate finalize on this until hardened.

5. **Recommendation appropriateness scope.** The clinical-match half exists nowhere. Confirm the initial rule set (seed from `FOLLOW_UP_DATABASE` ~20 conditions) and accept that findings without a rule-catalog entry route to Copilot/AI, not the deterministic gate.

6. **Migration/backfill of the three legacy stores.** Do we backfill historical `report_quality_gates`/`report_quality_checks`/audit-blob data into the canonical record, or start fresh from cutover? Affects dashboard history depth.

7. **Reference-range ownership.** Consolidating four range sources into `measurement_reference_ranges` requires a clinical owner to validate the merged thresholds (esp. fetal). Who signs off?

8. **`ai_quality_scores` semantics collision.** That table currently *means* AI-draft feedback usefulness; reusing it for clinical-quality trends conflates two meanings. Confirm we repurpose it (add a `metric_kind` discriminator) vs. accept the overload.

---

### Key file paths (all absolute)

- Engine spine to reuse/promote: `/home/user/care-on-synology1/artifacts/diagnostic-erp/src/lib/reportValidator.ts`
- Structured model + validator (D1): `/home/user/care-on-synology1/artifacts/api-server/src/lib/structuredReport/types.ts`, `/home/user/care-on-synology1/artifacts/api-server/src/lib/structuredReport/validator.ts`, `/home/user/care-on-synology1/artifacts/api-server/src/lib/structuredReport/aiRulesRegistry.ts`
- Working deterministic prototype: `/home/user/care-on-synology1/artifacts/api-server/src/routes/fetalUsgLevel4.ts`
- Enforced gate to generalize: `/home/user/care-on-synology1/artifacts/api-server/src/lib/usgQualityCheck.ts`, `/home/user/care-on-synology1/artifacts/api-server/src/routes/usgReports.ts`
- Canonical persistence to extend: `/home/user/care-on-synology1/lib/db/src/schema/smartRadiology.ts` (report_quality_checks), reuse `/home/user/care-on-synology1/lib/db/src/schema/aiQualityScores.ts`, `/home/user/care-on-synology1/lib/db/src/schema/reportQualityGates.ts`
- Primary integration surface: `/home/user/care-on-synology1/artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx`
- Copilot surface: `/home/user/care-on-synology1/artifacts/diagnostic-erp/src/lib/radiologyCoPilotEngine.ts`, `/home/user/care-on-synology1/artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx:4192`
- Knowledge-pack pipeline: `/home/user/care-on-synology1/artifacts/api-server/src/lib/radiologyCatalog/packs/{validator,graph,importer,index}.ts`
- New shared package (to create): `/home/user/care-on-synology1/lib/report-quality/`
- New router (to create): `/home/user/care-on-synology1/artifacts/api-server/src/routes/reportQuality.ts`
- Migration convention: `/home/user/care-on-synology1/lib/db/drizzle/0008_<name>.sql` + `/home/user/care-on-synology1/lib/db/drizzle/meta/_journal.json` + `0008_snapshot.json` (next sequential after verified `0007`)