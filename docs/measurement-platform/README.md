# Universal Measurement Platform — Foundation (Quality Engine Phase 4)

**Status: Platform Foundation.** No Measurement Engine V2, no Quality Engine V2, no
Comparison V2, no Viewer V2, no new reporting workspace. Everything extends the
existing CARE Reporting Platform. This document is the Step-16 deliverables report.

---

## 1. Audit summary (Step 1)

A three-track audit (workspaces/templates/quick-measurements · quality engine/knowledge
packs · viewer/comparison/companion/copilot) found measurements defined in **~23 distinct
sites across 5 layers**, keyed by **five non-interoperating identity schemes**:

| Identity scheme | Where |
|---|---|
| Free-text label | MeasurementAssistantPanel, radiologyLesions MEASUREMENT_TEMPLATES, radiology_quick_measurements, protocol `required_measurements` CSVs, pack manifests |
| Kebab id | radiologyMeasurementLibrary (`usg-cbd`, `ob-bpd`) |
| DB column name | usg_measurements, fetal_usg_measurements, usg_doppler_measurements, Companion EXPECTED_MEASUREMENTS |
| Viewer caliper kind | viewer_measurements.measurementType (`"linear"` — **no anatomical concept at all**) |
| Namespaced `meas.*` key | content-pack `_shared_libraries*.yaml` measurement_library (dormant, flag-off) |

## 2. Measurement duplication report

Worst clusters (full details in the catalog's per-entry `notes`):
- **CBD** — defined in **10 places**, 3 keying conventions, label differs in every layer.
- **Midline shift** — 3 spellings + a metric key; threshold disagreement (>2 abnormal vs ≥5 critical).
- **AFI/Liquor** — 3 labels (AFV / AFI / "Liquor / AFI"), 3 divergent ranges (8–18 / 5–24 / 5–25).
- **Prostate volume** — unit disagreement (cc vs g); **kidney length** — mm vs cm.
- **BPD & Doppler indices** — stored in two parallel DB tables each.
- Four comparison mechanisms used four different join keys (label / metric key / caliper kind / numeric token).

## 3. Registry design (Steps 2–3)

`lib/measurements` (`@workspace/measurements`) — pure TS, zero runtime deps, client+server:
- `contract.ts` — `MeasurementDefinition` with every Step-3 field: immutable `id`
  (STONE_SIZE, CBD, BPD…), `canonicalKey` (bridges the legacy `meas.*` namespace),
  displayName, aliases, description, modalities, bodyRegion, studyTypes, defaultUnit,
  allowedUnits, precision, viewerMapping (tool + DICOM-SR pattern), comparisonStrategy,
  normalRange, criticalRange, refs (packs/rules/companion/copilot/templates/usgColumns),
  version, deprecated/replacedBy, notes.
- `catalog.ts` — 48 canonical measurements covering US/CT/MR/XR, every legacy spelling
  from the audit registered as an alias. Where legacy sources disagreed the registry
  records ONE clinical truth + the disagreement in `notes`.
- `registry.ts` — validated, indexed registry; deterministic resolution
  (id → canonicalKey → normalized alias → parenthetical-stripped alias; **no fuzzy match**);
  `resolveByColumn` for the usg_measurements family; structured validation issues.
- `units.ts` / `compare.ts` — the single unit vocabulary + conversion, comparison and
  normal/critical classification inherited by every consumer.

## 4. Existing infrastructure reused (hard rules honored)

- **Identity pattern** mirrors `report-quality/src/ruleCatalog.ts` (stable id + canonical key + permanent aliases).
- **Quality Engine**: Phase-4 rules are `RuleDefinition`s compiled with the EXISTING
  `executor.ts` framework, bundled as a `RuleProvider` on the EXISTING `createQualityEngine`
  (shadow, exactly like the Phase-3 structured tier). One new executor, zero new engines.
- **Companion/Comparison/Copilot/Viewer**: additive fields + resolution at existing seams; no rewrites.
- The dormant YAML `meas.*` library's keys were adopted as `canonicalKey`, so the flagged-off
  radiologyCatalog pipeline converges on the same identities when it ships.

## 5. Files modified

- New package: `lib/measurements/*` (+ root tsconfig reference).
- `lib/report-quality/src/rules/measurements/*` (Phase-4 provider), `src/index.ts` exports.
- `lib/db/src/schema/radiologyLesions.ts` — nullable `measurement_id` on
  radiology_measurements + viewer_measurements.
- `artifacts/api-server`: `routes/radiologyLesions.ts` (persist canonical ids),
  `routes/measurementRegistry.ts` (admin console API), `routes/index.ts` (mount),
  `lib/usgCompanion.ts` (items carry `measurementId`), `lib/knowledgePackManifest.ts`
  (`resolvePackMeasurements`).
- `artifacts/diagnostic-erp`: `lib/radiologyComparison.ts` (id-keyed comparison),
  `lib/copilotMeasurementModule.ts` (alias-aware identity matching),
  `lib/usgCompanionAutoPopulate.ts` (type), `components/radiology/ViewerMeasurementsPanel.tsx`
  (canonical report lines), `pages/MeasurementRegistryManager.tsx` + `App.tsx` (admin page).

## 6. Migrations

`migrations/add_measurement_registry_ids.sql` — additive nullable `measurement_id` columns
+ partial indexes. Auto-discovered by care-db-patch-v2. The registry itself is code
(registry-as-code, like the rule catalog) — no registry table, no seed rows to drift.

## 7–10. Modality migration summaries (Step 4 — alias normalization)

All four modalities' legacy label spaces resolve through the registry (proven by the
fixture suite in `registry.test.ts`, one test per audited spelling):
- **MRI**: assistant labels, radiologyLesions templates, measurement library kebab-ids
  (canal AP, midline shift, cord/disc, 3rd ventricle…) ✅
- **USG**: usg_measurements/fetal/doppler columns, Companion keys, quick-measurement
  labels, protocol CSVs (both Title-Case and snake_case token dialects) ✅
- **CT**: CT gold-standard quick measurements + protocol tokens (midline shift,
  hemorrhage volume, stone size/HU, nodule size, RV:LV) ✅
- **X-Ray**: CTR, Cobb angle, vertebral height loss, stone size ✅
No data rewrite was needed or performed: resolution happens at read/compare/save time,
and new saves persist canonical ids alongside untouched legacy labels.

## 11. Viewer integration (Step 6)

`viewer_measurements` gains `measurement_id` (the bridge can now carry the anatomical
concept a caliper alone lacks — the audit's single most load-bearing gap); the POST
endpoint validates ids against the registry; report insertion lines use the canonical
display name instead of the bare tool kind whenever the id is present. Registry
`viewerMapping.dicomSrPattern` centralizes the concept-name matching that per-modality
extractor regexes did — no modality-specific parsing needed by new bridges.

## 12. Comparison integration (Step 5)

`compareMeasurementRows` joins prior/current by **canonical id** (never labels), inherits
units/precision/strategy from the registry (a prior "Common Bile Duct Diameter 0.6 cm"
now matches a current "CBD 7 mm" — converted, not "unit mismatch"). Unresolved labels
keep the original label-match behavior; all 16 pre-existing comparison tests pass unchanged.

## 13. Companion integration (Step 9)

Companion `MeasurementItem`s and missing-checklist entries carry `measurementId`
(server-resolved from usg columns). Downstream logic (obstruction/follow-up suggestions)
keys on ids, not parsed text.

## 14. Copilot integration (Step 10)

The measurement Copilot module matches by canonical identity: any registered alias of a
viewer measurement counts as "discussed in the report", and value-disagreement scanning
covers every alias spelling. No new text heuristics were added.

## 15. Knowledge Pack integration (Step 7)

Packs keep declaring *which* measurements as manifest strings (backward compatible);
`resolvePackMeasurements` resolves them to canonical identities, and the admin console
surfaces any manifest label that fails to resolve. Packs never define *what* a
measurement means. (Step 8: quick measurements are resolved the same way and reported
in impact analysis — their UI stays untouched.)

## 16. Quality Engine Phase 4 integration (Step 11)

`lib/report-quality/src/rules/measurements/` — one generated rule per registry
measurement with a range (currently 27), ids `care.measurement.range.<id>`. The ONLY
rule param is the canonical measurement id; thresholds/units/severity all come from the
registry at evaluate time (`measurement.id → value → range → severity → recommendation`).
Critical-range findings escalate to blocker severity. Shadow-tier discipline: separate
engine instance, `blockingEligibility: false`, never on the default engine.
**No rule depends on display labels.**

## 17. Admin Registry Manager (Steps 12–13)

`/measurement-registry` (admin/super_admin only, same gate as /diagnostics): search +
modality filter, full definition detail (aliases, units, ranges, comparison strategy,
viewer mapping, version, deprecation), the linked Phase-4 rule, and **live impact
analysis** per measurement — quick measurements, protocol requirements, knowledge packs,
stored assistant/viewer rows — plus an unresolved-labels banner (the breaking-change
early-warning). Backed by `GET /api/measurement-registry` and `/validation`.

## 18. Validation report (Step 14)

- Registry: **0 validation issues** (no duplicate ids, no duplicate aliases across
  measurements, no unit conflicts, no inverted ranges, no broken replacedBy).
- 80 package tests incl. one fixture per audited legacy spelling; 6 Phase-4 engine tests;
  full workspace suite **2447 tests / 160 files green**; workspace typecheck clean.
- Live validation is re-runnable in production: `GET /api/measurement-registry/validation`
  (registry issues + unresolved content labels + unreferenced measurements).

## 19. Performance report (Step 15)

Measured (node 22, warm):
| Path | Cost |
|---|---|
| Registry lookup by id | ~7 ns |
| Alias/label resolution (worst path) | ~565 ns |
| Comparison (with unit conversion) | ~477 ns |
| Quality classification | ~12 ns |

600k mixed resolutions in 339 ms; all maps are built once at module load. No measurable
impact on any request path; the admin impact scan is 5 parallel queries, admin-only.

## 20. Remaining measurements requiring future work

- Fetal biometry percentile ranges (BPD/HC/AC/FL/EFW are GA-dependent — registry carries
  identity + units; percentile tables are a future range provider).
- CRL-vs-GA consistency rule (id reserved in CRL notes).
- Organ-specific nodule sizes (thyroid vs lung TI-RADS/Lung-RADS splits of NODULE_SIZE).
- Echo/fetal-echo measurement space; BI-RADS/TI-RADS categorical scales.
- Backfill of `measurement_id` for historical rows (safe, optional, resolvable any time).
- Migrating Phase-3 structured rule params to registry references (kept verbatim this PR
  per shadow-tier discipline).

## 21. Regression risk

Low. Every integration is additive (nullable columns, optional fields, resolution with
label fallback). The two behavior changes are: comparison rows for registry-resolvable
labels now merge/convert (strictly better matches; label-fallback otherwise), and viewer
report lines prefer canonical names only when an id exists (new data only). Financial
code untouched. All pre-existing tests pass unmodified except none needed modification.

## 22. Platform readiness score

**Foundation: 8/10.** The canonical language exists, is validated, fast, and spoken at
every seam (viewer, comparison, companion, copilot, packs, quality). Held back from 10
by: modality workspaces still render their local template tables (they resolve, but
don't yet *read* from the registry), and Phase-4 stays in shadow until Phase-5 gating.
**Success criteria met**: a new modality references the registry instead of defining
measurements; Phase 4 consumes ids, not labels; all platform systems share one
measurement language.
