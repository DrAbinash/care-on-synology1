# CARE USG Companion — Phase 2

## Intelligent Auto Report Population

Deterministic, non-destructive population of the report **before the radiologist
starts typing**, inside the existing Reporting Workspace. Not AI image
interpretation — pure medical-workflow automation. Everything composes engines
that already exist; no V2 of anything.

> Design stance (from the hard rule "not an autonomous report generator"):
> the Companion **offers** a fully-explainable population plan and the
> radiologist applies it with one click, then reviews a provenance ledger of
> exactly what came from where. It never silently rewrites the report.

---

## 1. Audit summary (fresh, against current HEAD)

The second audit confirmed Phase 2 is a **composition** task — every mechanism is
already live:

| Need | Existing mechanism reused | Status |
|---|---|---|
| Study recognition | `suggestTemplate()` (`usgReportTemplates.ts`) | live |
| Template normals + technique | `radiology_protocols.normalText` / `techniqueText` via `applyProtocol`/`handleInsertNormals` | live, **USG protocols seeded** (21+11, all `isDefault`) |
| Machine measurements | Phase 1 assembly (`usg_measurements`) + `handleUsgMeasurementInsert` upsert | live |
| Rule-based impression | template `defaultImpression` / `POST /api/radiology/smart/generate` rule evaluator | live (dormant unified `impressionRuleEngine` deliberately NOT wired) |
| Companion suggestions | `QuickFinding.suggests` co-occurrence + `questionsJson` follow-ups | live (mechanism); USG `suggests`/`conflictGroup` newly seeded here |
| Previous comparison | `radiologyComparison.ts` (`extractMeasurements` + `compareMeasurementRows`) | live, pure |
| Copilot | existing `CopilotContext` + registered module | live |
| Checklist | protocol `checklistJson` / free-text presence | live |
| Reliability | `reliability.ts`, `ModuleErrorBoundary`, `requestBaselineRecapture` | live |

Two deliberate non-choices: the well-designed but **dormant** `impressionRuleEngine.ts`
(flag never seeded, no route, DB maps recommendations to `[]`) is left alone — wiring
it would be new engine surface; and USG uses the **free-text `rawFindings`** path
(structured `findingsMap` is inert for USG because `anatomicalSection` is blank on every
USG row), so population targets `rawFindings` via the existing merge primitives.

---

## 2. Existing engines reused

- **Population primitives (workspace):** `handleAutoTechnique` (fill-empty technique), `handleInsertNormals`/`mergeBlock` (dedupe-merge findings normals), `handleUsgMeasurementInsert` (upsert "Label: value"), `applyProtocol` (recommendation), `requestBaselineRecapture` (so auto-filled text is the clean baseline and later edits register as edits).
- **Suggestions:** `QuickFinding.suggests` + `questionsJson` from `GET /api/radiology/quick-select` (shared React-Query cache — zero extra network).
- **Comparison:** `radiologyComparison.extractMeasurements` + `compareMeasurementRows`.
- **Copilot:** `CopilotContext.usgCompanion` (extended) + the Phase-1 registered module.
- **Telemetry:** the Phase-1 `companion_runs` table (extended with 5 columns).

---

## 3. Auto-population workflow

```
Voluson → measurements imported → study recognized → template + protocol loaded
  → Companion computes a deterministic PLAN (buildAutoPopulatePlan):
      Technique      ← protocol.techniqueText        (fill-empty)
      Findings       ← protocol.normalText           (dedupe-merge)
                     + machine measurements          (upsert, high/med confidence only)
      Impression     ← rule lines only, if empty     (else left blank — never invented)
      Recommendation ← protocol.recommendationText   (dedupe-merge)
  → radiologist clicks "Auto-Populate"
  → workspace applies the plan through EXISTING setters (non-destructive)
  → provenance ledger shows each sentence: Machine Derived / Template Normal /
    Rule-based / Protocol, and Auto / Edited / Removed
  → radiologist reviews & edits → Finalize
```

**Population rules (encoded in `usgCompanionAutoPopulate.ts`):** only high/medium-
confidence measurements populate (low-confidence is skipped with an explicit
"verify manually" reason — never invented); Technique/Impression fill only when
empty; Findings-normals/Recommendation dedupe-merge (re-run safe); nothing
populates a finalized/locked report. Every block carries its provenance kind.

---

## 4. Highlight, checklist, confidence, suggestions, comparison

- **Provenance ledger** — each auto-generated block tagged with origin (Machine
  Derived / Template Normal / Rule-based / Protocol) and live status (Auto /
  Edited / Removed, derived by checking whether the block text is still present
  verbatim). Machine blocks link to the Phase-1 **Trace** dialog.
- **Intelligent checklist** — ✔/⚠ live rows: Template, Protocol, Measurements,
  History, Findings, Impression, Recommendation, plus a ⚠ per missing measurement,
  unaddressed protocol-checklist topic, and mismatch.
- **Report confidence** (workflow metrics, not AI): Machine completeness,
  Clinical completeness, Report completeness, and a "Ready to finalize" flag.
- **Companion suggestions** — from the existing `suggests` co-occurrence and
  `questionsJson` follow-ups for detected findings (gallstones→related, hydronephrosis
  grade/side, fatty-liver grade). DB-driven and admin-editable — nothing hardcoded.
- **Previous comparison** — the most-recent prior USG report body is diffed
  against the current measurements via the existing comparison engine, surfacing
  interval change (kidney/stone/fibroid/cyst/fetal growth/liquor…).

---

## 5. Files modified / added

**New (client):** `lib/usgCompanionAutoPopulate.ts` (+test), `lib/usgCompanionSuggestions.ts` (+test).
**Extended (client):** `components/radiology/UsgCompanionPanel.tsx` (Auto-Populate, ledger, checklist, confidence, suggestions, comparison), `pages/RadiologyReportingWorkspace.tsx` (`handleCompanionAutoPopulate` + ledger + props), `lib/usgCompanionTypes.ts`, `lib/copilotOrchestrator.ts` + `lib/copilotUsgCompanionModule.ts` (auto-populated advice), `pages/RadiologyOperationsDashboard.tsx` (Phase-2 card metrics).
**Extended (server):** `lib/db/schema/usgCompanion.ts` (5 telemetry columns), `routes/careUsgCompanion.ts` (prior-USG text for comparison, telemetry fields, dashboard metrics).

## 6. Database changes

- `migrations/add_companion_autopopulation_columns.sql` — `ALTER TABLE companion_runs ADD COLUMN IF NOT EXISTS` × 5 (`auto_populated`, `sections_populated`, `edits_after_populate`, `report_completion_pct`, `rejected_measurements_json`). Idempotent, auto-discovered.
- `migrations/seed_usg_companion_suggestions.sql` — data-only, idempotent UPDATEs seeding `conflict_group` (fatty-liver grades) + `suggests` (renal-tract co-occurrence) on existing USG rows.

No new tables; no measurement duplication.

## 7. Tests

- `usgCompanionAutoPopulate.test.ts` — eligibility, section population, impression-only-from-rules, non-overwrite, low-confidence skip, re-run safety, provenance status/edits (12 cases).
- `usgCompanionSuggestions.test.ts` — detected findings, co-occurrence + follow-up suggestions, dedupe, live checklist, report confidence (7 cases).
- Full suite **2060/2060 assertions pass**; both apps typecheck clean; no regression (the 7 DB-less-environment file failures are pre-existing and identical on the base branch).

## 8. Performance impact

One extra study-scoped GET already existed (Phase 1); Phase 2 adds only the
shared `radiology-quick-select` cache read (no new network) and pure client-side
computation (plan/suggestions/checklist/confidence/comparison memoised). Telemetry
remains fire-and-forget with backoff; dashboard stats tolerate a pre-migration table.

## 9. Remaining opportunities

- Seed more USG impression rules (`POST /impression-rules`) so rule-based impression
  fires for more study types.
- Add GB-wall-thickening / pericholecystic-fluid finding rows so the gallstones
  triad surfaces via `suggests` (currently via knowledge reporting tips).
- Optional: wire the dormant unified `impressionRuleEngine` (needs flag seed + route
  + recommendation columns) for fragment-level impression provenance.
- Optional inline tinting of auto-generated lines in `FindingsHighlightEditor`.

## HARD RULES compliance

No USG Workspace V2 / Template Engine V2 / Protocol Engine V2 / Measurement
Engine V2 / Copilot V2. Auto-population is deterministic, explainable, radiologist-
initiated, non-destructive, and never invents findings — a senior radiologist's
assistant, not an autonomous generator.
