# USG Companion — Phase P4 (Prior-study intelligence & pregnancy timeline)

**Branch:** `claude/usg-companion-p4-comparison` (stacked on P3 `claude/usg-companion-p3-dicom-provenance`).
**Flags:** `ff_radiology_usg_prior_intelligence`, `ff_radiology_usg_pregnancy_timeline` — **default OFF**.

P4 adds deterministic prior-study comparison and an obstetric growth timeline as
a **pure, suggestion-only** core. Nothing here writes to a report, classifies
clinical progression, or compares across patients. The canonical
draft→verify→finalize lifecycle remains the only write path, and the canonical
`obstetricCalculations` engine remains the only source of obstetric formulas.

## Gap map

- No canonical "find the comparable priors for this study" selector — and any
  ad-hoc matcher risks cross-patient comparison (a patient-safety hazard).
- No structured current-vs-prior delta: interval change was free-text only, with
  no unit alignment and no honest "not comparable" signal.
- Obstetric follow-up had per-scan GA/EFW but no episode grouping or trend
  series, and no guard against merging two separate pregnancies.
- Comparison text, if ever auto-generated, must never assert progression or be
  inserted without radiologist review.

## Delivered (all pure + unit-tested)

| Module | Capability |
|---|---|
| `usgPriorMatch.ts` | Canonical prior-study matcher. **Cross-patient comparison is impossible by construction** — a candidate is dropped unless its canonical `patientId` (and crosswalk id, when present) matches. Never returns the study as its own prior; excludes future-dated priors; scores by modality/region/final/episode/accession; sorts score-desc then most-recent-first. |
| `usgStructuredComparison.ts` | Deterministic deltas by canonical key: `increased`/`decreased`/`unchanged` (configurable tolerance) / `new` / `resolved` / `not_comparable`. Aligns prior→current units via `@workspace/measurements`; flags non-convertible units honestly. **Never auto-classifies clinical progression.** |
| `usgPregnancyEpisodes.ts` | Groups scans into pregnancies by anchor EDD (explicit EDD > LMP+280 > studyDate+(280−GA)). **Never merges separate pregnancies** (anchor-EDD tolerance = 21d); deterministic episode ids; manual override map for audited regrouping. |
| `usgPregnancyTimeline.ts` | GA-by-ultrasound established once (earliest CRL/LMP) and projected forward, GA-by-dates from LMP, EFW from HC/AC/FL — **all via the canonical `obstetricCalculations` engine** (no reimplemented formulas or embedded charts). Builds BPD/HC/AC/FL/EFW/AFI trend series. |
| `usgComparisonText.ts` | Editable **draft** suggestions that always cite the underlying current/prior values + interval, mark new/resolved/caveated rows as `needsReview`, and drop unchanged rows by default. Returns text only — **never inserts into a report or the draft lifecycle**. |

**Tests:** 33 new (usgPriorMatch 9, usgStructuredComparison 8, usgPregnancyEpisodes 8, usgPregnancyTimeline 4, usgComparisonText 6 — approx.) — all green. Full-workspace `pnpm typecheck` 0 errors. Flag-registry validation (`radiologyOpsHealth`) green with the two new entries.

## Non-negotiable constraints honored

- **No second store / engine.** Reuses `@workspace/measurements` for unit
  conversion and `obstetricCalculations` for GA/EDD/EFW. No new report/draft/
  measurement/obstetric store is introduced.
- **Same-patient only.** `usgPriorMatch` discards any candidate whose canonical
  patient identity differs — verified by tests.
- **No autonomous clinical judgment.** Comparison reports magnitude and
  direction only; it never says "worsening"/"response"/"malignant". AI/automation
  cannot sign, finalize, or write report text here.
- **Flags default OFF, `wired:false`.** No production route is enabled.

## Remaining P4 integration (documented, needs live data)

1. Wire `usgPriorMatch` to the canonical worklist/PACS prior query behind
   `ff_radiology_usg_prior_intelligence` (source the candidate `StudyRef[]` from
   the canonical study index; no new store).
2. Surface `buildComparisonSuggestions` in the workspace comparison panel as
   editable drafts routed through the existing draft editor (no auto-insert).
3. Render `buildPregnancyTimeline` trends behind `ff_radiology_usg_pregnancy_timeline`.
4. Persist manual episode-regrouping overrides through the canonical audit trail.

These need real multi-study patient data / a live PACS prior index to validate
end-to-end and are listed in the clinic checklist. **Flags stay OFF** until validated.

## Classification

**CODE COMPLETE (core) — INTEGRATION & CLINIC VALIDATION PENDING.** The
deterministic prior-comparison and obstetric-timeline logic is implemented and
tested; worklist/PACS wiring, UI surfacing, and clinic validation remain and
need real data to validate.
