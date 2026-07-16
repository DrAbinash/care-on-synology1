# CARE Clinical Content Coverage Dashboard

**Status: platform analytics.** One management dashboard answering: which
studies are clinically complete, what content is missing, where future work
should focus. No new engine, no runtime change to reporting, no schema change.

## 1. Audit (what already existed — and is reused)

The Knowledge Pack engine already computed everything per pack: live content
coverage (`packCoverage` — protocols/findings/history/measurements/templates/
teaching/knowledge joined by studyType/builderType/bodyPart/knowledgeCategory),
15-section presence (`packSections`), validation issues + readiness
(`validatePack`), and aggregate stats (`/stats` → `goldStandardCompletion`,
`modalityReadiness`) surfaced on the Engineering Cockpit
(`RadiologyOperationsDashboard`). A Measurement Registry API
(`/api/measurement-registry`, impact analysis) exists. The Recommendation
Registry is client-resident versioned data. **The dashboard composes these; it
computes nothing the platform didn't already know.**

## 2. Coverage algorithm

- Server: `GET /api/radiology/knowledge-packs/coverage` — the exact loop
  `/stats` already runs, returned per-pack (identity, status, version, 15
  sections, issues, readiness, health, raw counts, manifest counts). Thin
  aggregation over existing helpers; read-only.
- Client (`lib/clinicalCoverage.ts`, pure): weighted **Clinical Coverage
  Score** per study = Σ(weight of covered sections)/Σ(all weights) × 100.
  `DEFAULT_COVERAGE_WEIGHTS` is data; every function takes weights as a
  parameter and the UI edits them (persisted locally). **No hardcoded
  percentages; no hardcoded study names** — everything derives from pack rows.
- Recommendation dimension joins the Clinical Recommendation Registry
  client-side by `knowledgePackRefs` (entries activated per pack).

## 3. Dashboard

`/settings/radiology/content-coverage` (admin-gated): overall platform
readiness, per-modality summary cards (filter on click), completeness heatmap,
configurable weights panel, top-priority studies, per-study drill-down
(score, health, registry recommendations, missing sections). The Engineering
Cockpit's Gold-Standard gauge links directly to it (drill-down of the same
numbers — reused UI, no second dashboard).

## 4. Heatmaps

Modality × section grid; cell = % of that modality's packs covering the
section; color-coded (≥80 green / ≥50 amber / red). MRI, USG, CT, X-Ray rows
derive from whatever modalities exist in the registry.

## 5. Gap analysis

Per study: missing sections sorted by clinical weight, each deep-linking to the
REAL owning admin route (quick-select settings, structured templates,
measurement registry, knowledge packs, recommendation registry, teaching
cases) — link targets verified against `App.tsx` by the test suite.

## 6. Priority generator

`priorityRank` = need (100 − score) × status factor (enabled > placeholder >
disabled) × critical-findings impact × largest-gap weight. This is the content
roadmap. **Honest limitation:** per-study usage frequency is not recorded
anywhere, so "most frequently used" cannot be an input yet — stated in the UI,
not silently faked.

## 7. Validation

`clinicalCoverage.test.ts`: 0/100 bounds, weights provably change scores
(never hardcoded), arbitrary-weight bounds, gap labels/weights/links (links
pinned to registered routes), missing-list ordering, per-modality averages,
heatmap math, priority ordering (incomplete-enabled first, complete last),
overall-score bounds, no duplicate rows, registry join against the real
registry (ct.kub > 0, unknown = 0). All additionally executed offline against
the compiled real code — ALL PASS.

## 8. Performance

One request; server does the same per-pack work `/stats` already did (bounded
by pack count, ~89), client scoring is a single O(packs × 15) pass —
microseconds. No polling, no writes.

## 9. Technical debt

None added: one endpoint (projection of existing loop), one pure lib, one
admin page, one cockpit link. No schema, no engine.

## 10–12. Scores

- **Platform coverage score:** overall readiness gauge (enabled packs weighted
  double) — live on the dashboard.
- **Per-modality score:** summary cards + heatmap rows (live).
- **Per-study score:** drill-down list, ranked worst-first (live).
(This doc intentionally reports the *mechanism*, not a frozen snapshot — the
numbers are live, e.g. Gold-Standard completion from `/stats` at freeze: CT
~69%, XR ~80% enabled-average from the gold-standard PRs.)

## 13. Remaining work

The dashboard's own priority list IS the remaining-work report, computed live.
Known standing items: 28 placeholder packs, CT quick-finding breadth (6/26
tabs), CT/XR structured templates, teaching-case seeding.

## 14. Future roadmap

- **Trend analysis (Step 8):** requires coverage snapshots over time — a small
  append-only table. Architecture does not support it today; documented as
  future work rather than added (no schema per hard rules).
- **Usage-weighted priority:** needs per-study reporting telemetry.
- Both are additive, constitution-compliant follow-ups.

## 15. Honest limitations

- Coverage is **presence-based** (section has content), not depth-based
  (whether 12 findings are the *right* 12) — depth is the Content Validator's
  and clinical review's job.
- Companion/Copilot columns reflect pack manifest + content signals, not
  runtime activation counts.
- "Recently improved studies" requires the trend snapshots above — omitted
  until data exists (shown as future work in the UI footer).
- Weights are clinical judgment surfaces — editable per deployment, defaults
  are a starting point.
