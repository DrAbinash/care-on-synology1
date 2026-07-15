# 06 — USG Structured Measurement & Calculation Audit

*Audit-only document. As-of commit: `15ed9dfc`. All formulas were re-verified numerically with a standalone script; the results quoted below reproduce.*

> **⚠ Critical finding, flagged separately for urgency:** `FetalUsgLevel4.tsx` — a live, nav-linked, real obstetric ultrasound page — is currently computing **wrong gestational ages** for real patients due to a unit mismatch (formulas calibrated for centimeters are fed millimeter inputs). A normal BPD of 82mm returns "243 weeks." A normal AC of 300mm returns "3559 weeks." The one formula that's actually textbook-correct (Hadlock EFW) collapses to ~0g for the same reason. This is a live bug, not an architecture gap, and is independent of the USG Reporting Workspace decision this audit otherwise addresses. It is documented in full in §3 below and should be treated as a priority fix regardless of what else is decided from this audit.

---

## 0. Architectural landscape (read this first — it explains why the same measurement shows up 3-4 times below)

There are **four largely independent, non-interoperating systems** that all touch "USG measurements," at very different levels of maturity:

1. **`usgMeasurementEngine.ts`** (`artifacts/api-server/src/lib/usgMeasurementEngine.ts`) — a small pure-function engine that parses free-text dimension strings (e.g. `"10.8 x 4.5 x 3.2 cm"`) into mm and computes ellipsoid volumes, RI, and two GA formulas. Has unit tests. **Its calculated outputs are computed and then discarded** — see §1 and §3.
2. **`fetalUsgLevel4.ts` route** (`artifacts/api-server/src/routes/fetalUsgLevel4.ts`) — a second, independent set of GA/EFW/AFI/cervical-length formulas, wired live to `FetalUsgLevel4.tsx` and persisted to `fetal_usg_measurements`. This is the only measurement calculation code that is actually **live end-to-end** (computed → saved → shown in UI).
3. **`radiologySmartEngine.ts`** (`artifacts/diagnostic-erp/src/lib/radiologySmartEngine.ts`) — a **third**, independent set of GA formulas used for auto-generating findings text in the general radiology reporting workspace.
4. **`structuredReport/*`** + **`seeds/radiology/content-packs/v1/*.yaml`** — a well-designed, modality-agnostic "finding + measurement catalog" schema (JSON Schema, validator, canonicalizer, golden fixtures for MRI *and* USG) with per-measurement `normal_range`, `abnormal` flags, and `provenance.origin: "calculated"` for derived values like RI. Per its own README: **"FOUNDATION ONLY... Nothing in the running product reads or writes `structured_json` yet."** The YAML content packs that reference `meas.liver_span`, `meas.portal_vein`, `meas.pvr`, `meas.et`, `meas.prostate_volume` etc. have **no loader found anywhere in `api-server/src`** — unwired spec/seed documents, not live catalog data.

Additionally, `radiologyMeasurementLibrary.ts` is a **fifth, much simpler pattern**: static text-insertion templates with `___` placeholders and a `normalRange` **string** shown as an annotation. Zero calculation logic — a "type this into the report" snippet library, not a measurement engine. It already spans both MRI and USG categories (`MRI_CERVICAL_MEASUREMENTS`, `USG_ABD_MEASUREMENTS`, `OBSTETRIC_MEASUREMENTS` all live in the same array), which matters for the architecture question in §5.

---

## 1. Abdomen / General

### Liver span
**EXISTING** (raw field only, no calculation needed — a direct linear measurement). Schema: `liverSpanMm`. Free-text capture + normalization to mm in `usgMeasurementEngine.ts`. Static reference-range annotation (not enforced): `radiologyMeasurementLibrary.ts` — "Liver span: ___ mm (normal 100-160 mm)." Catalog reference (unwired): `usg_abdomen.yaml` (`meas.liver_span`, with an unenforced contradiction-rule check that lives only in the unwired YAML).

### CBD (common bile duct) diameter
**EXISTING** (raw field only). Schema columns exist, parsed/normalized in `usgMeasurementEngine.ts`. Static reference range in `radiologyMeasurementLibrary.ts`. No abnormal-flagging logic anywhere in live code.

### Portal vein diameter
**MISSING.** No numeric field, no input, no storage column anywhere in the live product — searched the measurement schema, the review panel's field list, the engine's interfaces. The only place a portal-vein measurement *reference* exists at all is inside the unwired `usg_abdomen.yaml` content pack; `usgReportTemplates.ts` has only a **static prose line** ("Portal Vein: Normal calibre"), not a data field.

### Kidney dimensions (length/width/cortical thickness) → volume
**EXISTING, but dead code** (calculated, never persisted or displayed). Schema has full L/W/thickness + cortical-thickness columns for both kidneys. Ellipsoid volume formula:
```ts
// usgMeasurementEngine.ts
function volEllipsoid(l, w, h) {
  return Math.round((l * w * h * 0.523 / 1000) * 100) / 100;
}
```
This is the standard prolate-ellipsoid volume formula (π/6 ≈ 0.523) — **formula is correct**. But its output is only ever consumed inside the engine's own test file. Every real call site (`usgExtraction.ts`, two of them) destructures only `{ normalizedFields }` from `normalizeAndCalculate(...)` and discards `.calculations` entirely. So kidney volume is computed correctly and then thrown away — never written to a DB column, never returned in an API response, never rendered in `UsgMeasurementReviewPanel.tsx`. Cortical thickness columns exist but have no consumer anywhere.

### Prostate volume/dimensions
**EXISTING, but dead code** — same pattern as kidney. Same ellipsoid formula, verified numerically correct (4.0 × 3.0 × 3.0 cm → 18.83 mL, matching the engine's own passing test). Never persisted/displayed for the same reason as kidney.

### PVR (post-void residual)
**MISSING.** No PVR/residual column anywhere, no bladder-volume calculation. Only appearances: static template placeholders ("Residual urine: ___ ml" / "Post-void residue: ___ ml") and an unwired YAML catalog reference. No bladder pre/post-void volume fields, no ellipsoid-volume-difference calculation, no storage.

---

## 2. Gynaecology

### Endometrial thickness
**EXISTING** (raw field only — correctly doesn't need a formula, it's a direct caliper measurement). Text column, populated via extraction, shown in the review panel. No abnormal-thickness flagging logic anywhere live.

### Uterus dimensions → volume
**EXISTING, but dead code.** Same ellipsoid formula/discard pattern as kidney/prostate. Schema has the columns; never surfaced — the review panel and templates only show the raw `uterusSize` text string, not a computed mL volume.

### Ovarian volume
**EXISTING, but dead code.** Same pattern. Schema columns exist; never persisted/displayed, discarded at the same call sites.

### Follicle counting
**MISSING** (as an actual counting/AFC-interpretation feature). `follicleCount` and `largestFollicleMm` columns exist as plain manually-entered numbers — no image-based counting, no antral-follicle-count interpretation banding (low/normal/PCOM), and no formula consuming either field. The `PELVIS_FEMALE` template shows "Follicles: ___" as a hardcoded blank, not wired to these columns at all — the schema field and the template aren't even connected to each other.

---

## 3. Obstetric Biometry

This is where the most serious correctness problems live. There are **three separate, independently-coded GA-formula sets**, and at least two of them are numerically broken due to a unit mismatch (mm vs. cm).

### CRL (crown-rump length) → GA
**EXISTING, but NEEDS-REDESIGN (numerically broken in 2 of 3 implementations).**

- **Implementation A** — `usgMeasurementEngine.ts` (dead code, only exercised in its own test): `GA = 40.9 + 3.54 × log10(CRL)`. For CRL = 50mm (normal first-trimester, ~11-12 weeks by the real Robinson equation), returns **46.9 weeks**. The engine's own test asserts this as correct behavior. The real Robinson (1975) formula is `GA(days) = 8.052×√CRL(mm) + 23.73`, which for CRL=50mm gives ≈11.5 weeks — nothing like what's implemented.
- **Implementation B** — `fetalUsgLevel4.ts` (**live**, feeds `compositeGa`/`biometricGa` shown in `FetalUsgLevel4.tsx`): `GA = 40.9 + 3.2 × ln(CRL)` (natural log, different coefficients). For CRL=50mm: **53.4 weeks**.
- **Implementation C** — `radiologySmartEngine.ts` (feeds AI-assist findings text): identical formula to B.

None of these three match the standard Robinson/Hadlock CRL-dating formula. **This is a live, user-facing bug**: `FetalUsgLevel4.tsx` displays GA/EDD computed server-side from a composite of CRL/BPD/FL/AC — all broken — so the GA and EDD shown to a radiologist for a real patient will be wrong whenever these fields are populated.

### MSD (mean sac diameter)
**EXISTING** as a raw field only, no calculation logic. **MISSING** as a GA source specifically — MSD-based dating (used before CRL is measurable) is not implemented at all; only CRL/BPD/HC/AC/FL feed the composite GA.

### BPD (biparietal diameter) → GA
**EXISTING, but NEEDS-REDESIGN (broken — same unit-mismatch bug).** `fetalUsgLevel4.ts`: `weeks = 9.54 + 1.482×BPD + 0.0167×BPD²`. The UI collects BPD in **mm**. For BPD=82mm: **243.4 weeks**. The quadratic coefficients are recognizable as a Hadlock-style regression calibrated for **cm** input — feeding the mm value the UI actually collects produces a nonsense result. `radiologySmartEngine.ts` has a near-duplicate with slightly different coefficients — a fourth minor formula variant, same bug.

### HC (head circumference) → GA
**EXISTING, but NEEDS-REDESIGN.** Only present in `radiologySmartEngine.ts`: `GA = 10.3 + 0.028×HC + 0.00167×HC²`, same mm/cm calibration mismatch. **Not present at all** in `fetalUsgLevel4.ts`'s composite-GA calculation — HC is captured but is not one of the measurements averaged into composite/biometric GA, an inconsistency worth flagging independent of the unit bug.

### AC (abdominal circumference) → GA
**EXISTING, but NEEDS-REDESIGN (worst of the three — error compounds quadratically).** `fetalUsgLevel4.ts`: `weeks = -7.31 + 0.49×AC + 0.038×AC²`. For AC=300mm (normal term AC): **3559.7 weeks**. For the same value in cm (30): ≈41.6 weeks — plausible. Confirms the formula is cm-calibrated but fed mm.

### FL (femur length) → GA
**EXISTING, but NEEDS-REDESIGN.** `usgMeasurementEngine.ts`: `weeks = 1.29×FL + 7.31` (Hadlock simplified). For FL=62mm: **87.3 weeks** (matches the engine's own test assertion — the test bakes in the bug). `fetalUsgLevel4.ts` has yet another variant, also mm/cm-mismatched. `radiologySmartEngine.ts` has a **third** FL formula. Three different FL→GA formulas, all producing implausible results when fed the mm values the UI actually collects.

### EFW (estimated fetal weight)
**EXISTING, correct formula, NEEDS-REDESIGN for unit handling (same bug class).** `fetalUsgLevel4.ts`:
```ts
const efw = Math.pow(10, 1.326 - 0.00326*ac*fl + 0.0107*hc + 0.0438*ac + 0.158*fl);
```
This **is** the genuine, published Hadlock (1985) 3-parameter (HC/AC/FL) formula — coefficients match the literature exactly, a real strength of the codebase. **However**, the formula requires HC/AC/FL in **cm**, and the UI collects them in **mm**, with no cm conversion at the call site. Verified numerically: with mm inputs (BPD 82, HC 280, AC 300, FL 62) → **EFW = 0.0000 g**; with the same values correctly converted to cm → **EFW = 2055.1 g** (a clinically sane term-pregnancy EFW). The one formula in the whole OB biometry stack that is textbook-correct is silently producing ~0g for every real patient because of a units bug at the call site (a manually-typed EFW does bypass the broken auto-calc, so the UI allows a workaround, but the auto-calc itself is dead-on-arrival). `efwPercentile` is a schema column and UI input but is purely manually typed — no percentile computation exists anywhere.

### AFI (amniotic fluid index)
**EXISTING** for the interpretation banding, **MISSING** for the actual 4-quadrant summation. Interpretation thresholds are correct and live (`<5` oligohydramnios, `>24` polyhydramnios, standard ACOG-style cutoffs), computed on save and shown read-only. But AFI itself is a single manually-typed number — no 4-quadrant-sum calculator exists anywhere in the repo. Sonographers must sum the four quadrants themselves outside the system. SDP (single deepest pocket) is a separate raw field with no cross-check against AFI.

### EDD (estimated date of delivery)
**EXISTING, but incomplete** — LMP-based only; no USG/CRL-dating EDD. `fetalUsgLevel4.ts`'s `calcEddFromLmp()` correctly implements Naegele's rule (LMP + 280 days) and is live. **Missing**: EDD-by-ultrasound-dating (deriving EDD from CRL/composite GA rather than LMP), which is the clinically preferred method when LMP is unreliable or unknown and generally preferred over LMP-only dating after the first trimester. The extractor merely regex-captures an `edd` string if the machine/OCR reports one — it doesn't compute one.

### Growth charts / percentile plotting
**MISSING** (no percentile logic anywhere) — at best a REUSABLE-PATTERN-EXISTS-BUT-NOT-THIS-MEASUREMENT situation, in that a longitudinal-trend UI shell exists but carries no reference curve. A growth-charts endpoint returns the patient's **own** historical BPD/HC/AC/FL/EFW/AFI values over time (a simple join, trend-of-self, not against a population reference), plotted as a plain line chart with no percentile bands or Hadlock/INTERGROWTH-21st reference-curve overlay. `FetalUsgLevel4.tsx`'s "Growth" tab is explicitly a stub: *"WHO/ICB fetal growth reference charts (simplified preview). Full charts coming soon"* — just prints static hard-coded midpoint hints as prose next to the raw current value. No percentile/z-score engine of any kind exists anywhere in the repo.

---

## 4. Doppler

### RI (resistive index)
**EXISTING, correct formula, but dead code / never wired to the live Doppler entry flow.**
```ts
// usgMeasurementEngine.ts — RI = (PSV - EDV) / PSV
```
This is the textbook Pourcelot RI formula and is correctly implemented — but as established in §0, its output is discarded by every caller, and it is never invoked at all from the live Doppler reporting surface. In the live flow, PSV/EDV/RI/PI/S-D are **five independent free-text input fields** typed by the operator (`UsgDopplerReporting.tsx`), with no cross-check between them — an operator can type a PSV/EDV pair and an unrelated/inconsistent RI value with no validation. The `structuredReport` fixture `example5DopplerCarotid.json` shows what a wired system *should* look like — RI stored with `provenance.origin: "calculated"` and a `components` array referencing the PSV/EDV it was derived from — but per §0 this schema is unwired.

### PI (pulsatility index)
**MISSING** (no formula anywhere), and structurally under-supported: PI = (PSV − EDV) / mean velocity (TAMV), and **no field for mean/time-averaged velocity exists anywhere in the schema** — only PSV/EDV/RI/PI/S-D as independent text columns. So even a future PI-from-raw-velocities calculator would need a new input field first, not just wiring. `fetalUsgLevel4.ts` does capture UA-PI/MCA-PI/uterine-artery-PI/DV-PI as columns, but these are manually entered numbers too — plain number inputs with no calculation behind them.

### S/D ratio (systolic/diastolic ratio)
**MISSING** as a calculation, despite being trivial (S/D = PSV/EDV). No `sdRatio` calc function exists anywhere — only RI is computed. The live UI's `sdRatio` field is entered independently of PSV/EDV with no auto-derivation. The simplest of the three Doppler indices and the one most clearly a low-effort win, but not implemented anywhere.

### CPR (cerebroplacental ratio) — bonus finding, adjacent to Doppler
**EXISTING** as a raw manually-entered field, **MISSING** as a calculation. CPR is properly defined as MCA-PI ÷ UA-PI, and both inputs already exist as separate columns in the same table — a case where the two required inputs already exist side-by-side in the schema but nothing computes their ratio; the operator must calculate and type it manually.

---

## Summary table

| Measurement | Status | Formula quality (if present) | Live/wired? |
|---|---|---|---|
| Liver span | EXISTING (raw) | n/a | Yes (extraction only) |
| CBD diameter | EXISTING (raw) | n/a | Yes (extraction only) |
| Portal vein diameter | **MISSING** | — | — |
| Kidney L/W/thickness → volume | EXISTING | Correct ellipsoid | No — computed & discarded |
| Prostate volume | EXISTING | Correct ellipsoid | No — computed & discarded |
| PVR | **MISSING** | — | — |
| Endometrial thickness | EXISTING (raw) | n/a | Yes (extraction only) |
| Uterus volume | EXISTING | Correct ellipsoid | No — computed & discarded |
| Ovarian volume | EXISTING | Correct ellipsoid | No — computed & discarded |
| Follicle counting/AFC | **MISSING** (field exists, unwired) | — | — |
| CRL → GA | NEEDS-REDESIGN | 3 conflicting formulas, 2 numerically broken | Yes (broken) |
| MSD → GA | **MISSING** | — | — |
| BPD → GA | NEEDS-REDESIGN | 2 formulas, both broken | Yes (broken) |
| HC → GA | NEEDS-REDESIGN | 1 formula, broken; also excluded from composite GA | No (not in composite) |
| AC → GA | NEEDS-REDESIGN | 1 formula, severely broken | Yes (broken) |
| FL → GA | NEEDS-REDESIGN | 3 conflicting formulas, all broken | Yes (broken) |
| EFW | NEEDS-REDESIGN | **Correct Hadlock formula**, broken by unit mismatch at call site (→ ≈0g) | Yes (broken) |
| AFI interpretation | EXISTING | Correct thresholds | Yes |
| AFI 4-quadrant sum | **MISSING** | — | — |
| EDD (from LMP) | EXISTING | Correct Naegele's rule | Yes |
| EDD (from CRL/dating) | **MISSING** | — | — |
| Growth percentile charts | **MISSING** | — | — |
| RI (Doppler) | EXISTING | Correct Pourcelot formula | No — dead code, not in Doppler UI flow |
| PI (Doppler) | **MISSING** (also missing required TAMV input field) | — | — |
| S/D ratio (Doppler) | **MISSING** | — | — |
| CPR | **MISSING** calc (inputs already captured separately) | — | — |

---

## Final assessment: can MRI and USG share a "reporting-core" measurement library?

**They should, and there is already a design for it — but it's not the thing currently doing the work.**

Comparing the two libraries directly:

- **`radiologyMeasurementLibrary.ts`** (the closest thing to an "MRI-side" library) is a flat array of `{id, label, category, modality, bodyPart, template, normalRange (string), unit, insertText}` objects. Purely presentational — a searchable snippet-insertion tool. Never computes anything; `normalRange` is a free-text annotation, not a machine-checkable bound. **Already modality-agnostic in practice**: MRI cervical/LS-spine/brain templates and USG abdomen/obstetric templates sit in the same array, filtered by a `modality: "MR" | "US"` field on each entry. This proves the "template catalog" layer of the UI already treats MRI and USG uniformly.
- **`usgMeasurementEngine.ts`** is the opposite shape: a typed raw-dimension interface → a pure calculation function → a typed calculation-result. USG-specific by construction, no notion of "normal range" or modality tagging, and — as shown throughout this document — its actual computed values never reach a database column or a screen.
- **`structuredReport/*`** is the one component in the repo that is *actually* designed as a shared "reporting core": one JSON Schema and one validator already cover MRI brain, MRI cervical/LS spine, USG abdomen, and Doppler carotid as golden fixtures. Its `measurements[]` array is genuinely modality-neutral: each entry has a `measurement_ref` (a catalog key, e.g. `meas.liver_span` or `meas.doppler_ri`), a `normal_range: {low, high, unit, source}`, an `abnormal: boolean`, and — for derived values — a `components[]` array plus `provenance.origin: "calculated"`. This is exactly the shape a unified MRI/USG measurement library needs.

The catch, stated plainly by its own README: **this is foundation-only and not wired to any route, migration, or UI.** The YAML content packs that would populate its catalog with real USG measurement definitions have no loader anywhere in the codebase.

**Recommendation for a USG Reporting Workspace:** don't build it on top of `usgMeasurementEngine.ts` as-is (its GA/EFW formulas need a full rewrite for the unit bug alone, and its outputs are currently unreachable dead code), and don't extend `radiologyMeasurementLibrary.ts` (it has no calculation capability and was never meant to). The right foundation is to **finish wiring `structuredReport`'s catalog + validator** as the shared measurement library — its schema already spans MRI and USG in its golden fixtures, already models normal ranges and calculated-vs-manual provenance in a modality-neutral way, and already has a validator and hash/audit trail suitable for a medico-legal report. `usgMeasurementEngine.ts`'s ellipsoid-volume and RI formulas (the ones that are actually *correct*) could be salvaged as the "calculator" that populates `structuredReport` measurement entries with `provenance.origin: "calculated"` and `components[]`, once its outputs are actually connected to something. The GA/EFW formulas, however, need to be rewritten from scratch with correct units (or three of the four duplicate implementations deleted and one correct one shared) before they can be trusted in a new workspace — right now three different files disagree with each other and with the medical literature simultaneously.
