# USG Companion Workspace — P0 + P1 Implementation Report

Implements Phases **P0 (dedicated USG shell)** and **P1 (Dynamic Finding
Builder)** from the approved review
(`docs/usg-companion/USG_COMPANION_WORKSPACE_REVIEW.md`). The dedicated USG
workspace is a **tenant** of the canonical reporting platform — it reuses the
draft/verify/finalize lifecycle, the study lock, the PCPNDT/Form F gate, the
embedded viewer, measurement review, prior comparison and knowledge pack, and
persists structured findings **inside** the canonical `findings_sections`. No
parallel report lifecycle, draft store, finalized-report store, USG backend,
auth, AI pipeline, PCPNDT gate or Quick Findings engine was created.

## Route & flag

- New route: **`/radiology/usg/:studyId`** (`:studyId` = worklist row id, same key
  the canonical `/radiology/report/:studyId` uses).
- Feature flag: **`ff_radiology_usg_workspace`** (added to `FEATURE_FLAG_DEFAULTS`,
  **default off**). Named with the `ff_radiology_` prefix so it hydrates from the
  server `/api/feature-flags` like the other radiology flags.
- Flag **off** ⇒ the page redirects to `/radiology/report/:studyId` and the
  worklist keeps opening US studies in the canonical workspace — **no regression**.
- Flag **on** ⇒ the worklist's "Report" button routes ultrasound studies to the
  new shell; all other modalities are unchanged.

## Files added

| File | Purpose |
|---|---|
| `artifacts/diagnostic-erp/src/lib/usgFindingBuilder.ts` | Pure P1 engine: extended parameter types (select/multiselect/yesno/number+unit/text/derived), numeric parse + mm⇄cm normalisation, **single frontend ellipsoid-volume source** (mirrors server `usgMeasurementEngine`), deterministic render (delegates grammar to the existing `structuredFindings.fillStructuredTemplate`), the `UsgFindingObject` model, warnings. |
| `artifacts/diagnostic-erp/src/lib/usgOrganLibrary.ts` | Organ list (sex/preset-gated) + one-click **normal statements** + the **3 reference findings** with deterministic derivation & clinical guards. |
| `artifacts/diagnostic-erp/src/lib/usgReportComposer.ts` | Organ sections ⇄ **canonical draft payload**; one-click Normal + normal-all-remaining (reuses `quickFindingsMerge`); reload parser. |
| `artifacts/diagnostic-erp/src/pages/UsgCompanionWorkspace.tsx` | The 3-column shell (named `UsgCompanionWorkspace`, not `UsgWorkspace`, to satisfy the platform-contract engine-identifier guard). |
| `artifacts/diagnostic-erp/src/components/radiology/usg/OrganRail.tsx` | Organ navigation + status dots + hotkeys + normal-all-remaining. |
| `artifacts/diagnostic-erp/src/components/radiology/usg/DynamicFindingBuilder.tsx` | Inline parameter form + live deterministic preview + volume/warnings. |
| `artifacts/diagnostic-erp/src/components/radiology/usg/OrganReportSection.tsx` | Per-organ editable report block + finding chips + Normal. |
| `…/lib/usgFindingBuilder.test.ts`, `usgOrganLibrary.test.ts`, `usgReportComposer.test.ts`, `usgWorkspaceContract.test.ts` | Unit + integration + structural-contract tests. |

## Files modified (minimal, flag-gated)

- `artifacts/diagnostic-erp/src/App.tsx` — lazy import + the new route (canonical
  routes untouched; routing guard still passes).
- `artifacts/diagnostic-erp/src/lib/staffSession.ts` — `ff_radiology_usg_workspace: false`.
- `artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx` — flag-gated US branch.

## Components / libraries reused (unchanged)

`saveRadiologyDraft` + `finalizeRadiologyReport` (`lib/radiologyReportLifecycle`),
`useRadiologyDraftId`, `useStudyLock`, `isUltrasoundModality`/`isObstetricUsgStudy`
(`lib/usgModality`), `structuredFindings.fillStructuredTemplate`,
`quickFindingsMerge` (mergeBlock/mergeImpression), `EmbeddedWadoViewer`,
`UsgMeasurementReviewPanel`, `ComparisonPanel`, `RadiologyKnowledgePanel`,
`api` (`lib/fetchApi`), `readStaffSession`, `useToast`.

## The three reference findings

- **Right renal calculus** — side/location/number/size(+unit)/shadowing/twinkle/
  hydronephrosis/ureteric dilatation → e.g. *"A single echogenic calculus
  measuring 5.5 mm is seen in the middle calyx of the right kidney, showing
  posterior acoustic shadowing. No hydronephrosis is noted."* / impression
  *"Right nephrolithiasis without hydronephrosis."* Single/multiple agreement and
  "both kidneys" (bilateral) are guaranteed by derived plural keys.
- **Cholelithiasis** — number/largest/mobility(+impaction)/wall/pericholecystic/
  Murphy/distension/sludge. **Guard:** the impression states *"without sonographic
  evidence of acute cholecystitis"* **only** when wall = Normal, Murphy = Negative
  and pericholecystic = Absent are all actually recorded.
- **Prostatomegaly** — AP/TR/CC → **ellipsoid volume `0.523·L·W·H`** (3.4 × 3.1 ×
  2.4 cm → **~13 cc, not 35 cc**). A manual volume is **never accepted blindly**:
  it is ignored unless a reason is recorded, and a material (>20%) divergence from
  the calculated volume is flagged. No numeric grade is invented; the
  "Prostatomegaly" label appears only at/above the referenced ~30 mL threshold.

Each finding is stored as a structured `UsgFindingObject` (organ, laterality,
finding type, parameters, units, derived values, source type/ref, generated
finding + impression text, radiologist edit, author, timestamps) **inside** the
canonical `findings_sections` JSON (`.passthrough()`ed by the save-draft Zod
schema) — a single structured format, not a second one.

## Tests run

- **New suites (39 tests) + structural contract + platform guards — all green:**
  `vitest run` over `usgFindingBuilder`, `usgOrganLibrary`, `usgReportComposer`,
  `usgWorkspaceContract`, `platform-contract`, `canonicalWorkspaceRouting` →
  **195 passed**. Covers: numeric parsing, mm/cm conversion, optional-clause
  grammar, renal-calculus text, single-vs-multiple wording, cholelithiasis text,
  the acute-cholecystitis guard, prostate ellipsoid volume, manual-volume mismatch
  warning, normal-all-remaining non-destructive merge, abnormal-not-overwritten,
  feature-flag-off default, canonical save/finalize transport reuse, PCPNDT-gate
  preservation, and a logic-level end-to-end (build → canonical payload → JSON
  round-trip → structured findings persist → no new store).
- **Typecheck:** `tsc -p tsconfig.json --noEmit` on the ERP package → **0 errors**.
- **Full `vitest run`:** the only failures are unrelated to this change — 8
  api-server suites that require `DATABASE_URL` (no Postgres in this ephemeral
  container) and 1 **pre-existing** migration-ordering issue in the earlier merged
  queue-display feature (`add_queue_display_enhancements.sql`, commit `6d303c26`,
  present on the base branch; not touched here).

## Migration / seed notes

**None required.** P0/P1 ride entirely on the existing schema
(`radiology_report_drafts.findings_sections` / `impression`) and existing
endpoints. The organ library and reference findings are a typed data module, not
a DB seed.

## Known limitations (honest)

- **Live screenshots not included.** Rendering the page needs the full running
  stack (API + Postgres + Orthanc), which is unavailable in this environment. The
  layout is validated by typecheck and by the approved annotated wireframe in the
  review doc. UI validation against a live dummy study should be done on a
  deployed instance.
- **Measurement provenance is honest, not exact.** Per the review, P0/P1 surface
  measurement value/unit/source/approval via the existing
  `UsgMeasurementReviewPanel`; exact frame/SCOORD/caliper navigation is **P3** and
  is deliberately **not** simulated.
- **Prior-study deltas** are display-only for now (the `ComparisonPanel` is
  mounted); interval intelligence is **P4**.
- **Legacy OB/Doppler forks are untouched** (consolidation is **P5**). Obstetric
  USG in the new shell still finalizes through the same server-side PCPNDT/Form F
  gate.

## Recommended next (P2)

1. Continuous companion readiness/checklist (wire `UsgCompanionPanel` into the
   shell) + insert-all-approved measurements.
2. Per-organ status persistence (`incomplete` state) and a discoverable shortcut
   legend overlay.
3. Extend the organ finding library beyond the three reference findings (seed the
   authored YAML packs: liver, KUB, Doppler…).
