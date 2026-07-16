# Fetal USG Calculation Correction — PR A

**Status: implemented.**
**Scope: `artifacts/api-server/src/lib/obstetricCalculations.ts` (new), `artifacts/api-server/src/routes/fetalUsgLevel4.ts`, `lib/db/src/schema/fetalUsgLevel4.ts`, `artifacts/diagnostic-erp/src/pages/FetalUsgLevel4.tsx`, `migrations/fetal_usg_calculation_correctness.sql`.**
**Builds on: [`docs/usg-reporting-audit/06-measurements-and-calculations.md`](../usg-reporting-audit/06-measurements-and-calculations.md) §3, which first identified the GA/EFW calculation defects.**

This document records what was wrong, what was changed, why, and what is intentionally still out of scope.

---

## 1. Confirmed bugs (as found, before this PR)

### 1.1 Obstetric GA/EFW formulas produced clinically impossible results

`fetalUsgLevel4.ts` computed gestational age (GA) independently from BPD, HC, AC, and FL on every visit, using coefficients that do not correspond to any standard obstetric reference formula. Reproducing the task's exact scenario against the pre-fix code:

| Input | Old output | Clinically expected |
|---|---|---|
| BPD = 82 mm | "243 weeks" | ~32 weeks (the page's own static reference text says "BPD ~80mm at 32w") |
| AC = 300 mm | "3559 weeks" | ~32-34 weeks |
| Hadlock EFW (HC=300mm, AC=300mm, FL=65mm) | collapsed toward 0 g | ~2000-2400 g |

The initial hypothesis (carried over from the audit) was a simple mm/cm unit mismatch — the Hadlock EFW coefficients are calibrated for **centimeters**, and the code was feeding them raw millimeter measurements. That is confirmed and is the entire defect in the EFW formula (§2.3). It is **not** the whole story for the per-parameter GA formulas: converting BPD=82mm to 8.2cm and feeding it through the *existing* GA-from-BPD coefficients still produces ~22.8 weeks, not ~32 — proving those specific coefficients are wrong regardless of unit interpretation. Rather than fabricate new, unverified regression coefficients to replace them (repeating the exact failure mode this PR exists to fix), the per-parameter GA-from-biometry formulas were **removed** and replaced with a clinically-standard alternative (§2.2).

### 1.2 Hardcoded `patientId: 1, studyId: 1` on study creation

`FetalUsgLevel4.tsx`'s `createStudy()` called `POST /api/fetal-usg/study` with a literal `{ patientId: 1, studyId: 1 }`, regardless of which patient the user was working with. Every new Fetal USG study was silently attached to patient/study #1.

### 1.3 Duplicate `POST /:studyId/extract-measurements` route registration

The route was registered twice in `fetalUsgLevel4.ts`. Express dispatches to the first matching handler only, so the first (a bare stub) always ran and the second, more-developed handler was permanently unreachable dead code.

---

## 2. What changed

### 2.1 One authoritative calculation module

`artifacts/api-server/src/lib/obstetricCalculations.ts` is now the single source of truth for every obstetric-USG calculation used by the Fetal USG module. It is a **pure module**: no React, no DB, no API calls, no side effects — every function takes plain numbers/strings and returns a `CalculationResult<T>`:

```ts
interface CalculationResult<T> {
  value: T | null;
  status: "valid" | "warning" | "invalid";
  formulaId: string;
  formulaName: string;
  inputValues: Record<string, number>;
  inputUnits: Record<string, string>;
  warnings: string[];
  error?: string;
}
```

`status` is the three-level clinical sanity guardrail required by this PR:
- **`valid`** — inputs are plausible, value computed normally.
- **`warning`** — value computed, but flagged for radiologist review (e.g. biometry outside the typical range, but not impossible).
- **`invalid`** — value could not be computed safely (missing/negative/zero/NaN/Infinity input, or a value outside any physically plausible range). `value` is `null`; the caller must not substitute zero or any other default.

57 unit tests cover this module (`obstetricCalculations.test.ts`), all passing.

### 2.2 GA is established once, then projected — not re-derived every visit

The old code recomputed GA from whatever biometry was on hand at every single visit, which is neither standard obstetric practice nor (per §1.1) achievable with formula coefficients that survive scrutiny. The corrected model:

1. **Establish GA once**, from the most reliable dating source available, in strict preference order: **CRL > MSD > LMP > manual**.
2. **Hold it fixed.** At every later visit, the established GA is **projected forward** by elapsed calendar days (`projectGaForwardDays`) — never re-derived from second/third-trimester BPD/HC/AC/FL.
3. **One-time upgrade path.** If GA was only established from LMP or a manual entry so far, and a genuine dating measurement (CRL/MSD) becomes available on a later visit, the system upgrades to the more reliable source once (standard practice: first-trimester ultrasound dating supersedes an LMP estimate). If the upgrade shifts GA by more than 7 days, an explicit warning is generated so the radiologist reviews it — it is never silently changed.
4. Once GA has been established via CRL or MSD, it is **never re-derived again** for that pregnancy, by any subsequent measurement.

This logic lives in `establishOrProjectGa()` in `fetalUsgLevel4.ts`, backed by `establishGa()` / `projectGaForwardDays()` in the calculation module.

### 2.3 Formula-by-formula status

| Calculation | Formula used | Reference | Units (input → normalized) | Status |
|---|---|---|---|---|
| GA from CRL | `GA_days = 8.052 × √CRL_mm + 23.73` | Robinson & Fleming, 1975 | mm (used directly — this formula is mm-calibrated) | ✅ Corrected/verified |
| GA from MSD | `GA_days = MSD_mm + 30` | Standard early-pregnancy MSD rule (valid ~2-10mm MSD, ≤ 6 weeks) | mm | ✅ Corrected/verified |
| GA from LMP | Elapsed days from LMP to as-of-date | Standard | ISO date | ✅ Unchanged (was already correct), now guardrailed (rejects future LMP, > 45 weeks elapsed) |
| GA from BPD / HC / AC / FL individually | — | — | — | ❌ **Removed.** No verifiable individual-parameter regression formula was available; see §1.1. GA is established via CRL/MSD/LMP only (§2.2); these measurements now feed EFW instead. |
| Composite/averaged GA (old multi-parameter blend) | — | — | — | ❌ **Removed** along with the above — averaging several already-unverifiable numbers doesn't fix them. |
| EFW (Hadlock) | `log10(EFW_g) = 1.326 + 0.0107·HC_cm + 0.0438·AC_cm + 0.158·FL_cm − 0.00326·AC_cm·FL_cm` | Hadlock et al., 1985 | **mm in, converted to cm before the formula** (this conversion was the actual defect) | ✅ Corrected/verified |
| EDD | `EDD = LMP + 280 days` (or from established GA) | Naegele's rule | ISO date, UTC-safe arithmetic | ✅ Corrected — old code had latent month/year/leap-year boundary risk; new code uses `setUTCDate` throughout and is boundary-tested |
| AFI (4-quadrant) | Sum of 4 quadrant depths | Standard AFI technique | cm per quadrant → cm total | ✅ New — previously only a single, ungrounded manual total field existed |
| AFI interpretation | `<5` oligohydramnios, `5-24` normal (with a borderline-low band), `>24` polyhydramnios | Standard clinical thresholds | cm | ✅ Corrected/verified |
| Cervical length interpretation | `<25mm` short cervix, `25-29mm` borderline, `≥30mm` normal, with a GA-context advisory (threshold most validated 16-24 weeks) | Standard screening threshold | mm | ✅ Corrected/verified |
| UA Resistive Index (RI) | `RI = (PSV − EDV) / PSV` | Pourcelot | ratio | ✅ Unchanged formula, now guardrailed (divide-by-zero) |
| UA Pulsatility Index (PI) | `PI = (PSV − EDV) / TAMV` | Standard | ratio | ✅ Unchanged formula, now guardrailed |
| UA S/D ratio | `S/D = PSV / EDV` | Standard | ratio | ✅ Unchanged formula, now guardrailed |
| S/D ↔ RI cross-derivation | `S/D = 1 / (1 − RI)` and its inverse | Algebraic identity of the same PSV/EDV pair — not a separate clinical formula | ratio | ✅ New — lets either field auto-fill the other consistently |
| CPR | `CPR = MCA-PI / UA-PI` | Standard cerebroplacental ratio | ratio | ✅ Corrected/verified, guardrailed |
| Twin growth discordance | `(EFW_larger − EFW_smaller) / EFW_larger × 100` | Standard | % | ✅ Corrected/verified — symmetric regardless of which twin is A/B, guardrailed against zero/missing EFW |

### 2.4 Validation ranges (guardrails)

| Measurement | Valid range | Unit |
|---|---|---|
| CRL | 10–84 | mm |
| MSD | 2–10 | mm |
| HC | 50–400 | mm |
| AC | 50–400 | mm |
| FL | 10–90 | mm |

Values outside these ranges produce a `warning`-status result (value still computed, but flagged for review) rather than being silently accepted as if normal. Negative, zero, `NaN`, `Infinity`, and missing values are always `invalid` (never coerced to `0`, which would otherwise misrepresent "not measured" as "measured as zero" — a distinct historical risk called out explicitly in the task spec).

### 2.5 Patient/study context fix

`POST /api/fetal-usg/study` (`fetalUsgLevel4.ts`) now:
1. Requires a real, positive-integer `patientId` and `studyId` in the request body — rejects (400) if either is missing or non-numeric.
2. Looks up the patient; rejects if not found.
3. Looks up the radiology study (`radiology_studies` row); rejects if not found.
4. Rejects if the study belongs to a different patient than the one selected.
5. Rejects if the study's modality is not ultrasound (via the shared `isUltrasoundModality` normalizer).
6. Rejects if the study is already linked to an existing Fetal USG record.
7. Only then creates the record, using the **actual** `patientId`/`studyId` supplied — never a default.

A new `GET /api/fetal-usg/available-studies/:patientId` endpoint powers the frontend picker: given a patient, it returns their ultrasound `radiology_studies` rows that are not yet linked to a Fetal USG record. `radiology_studies` requires a full billed-test order chain (`accessionNumber`, `testId` are `NOT NULL`), so the fix is "select an existing, real, already-ordered study" — fabricating a lightweight placeholder study inline was considered and rejected as out of this PR's scope (it would require synthesizing an order/billing chain, which is unrelated to calculation correctness).

The frontend (`FetalUsgLevel4.tsx`) "New Study" button now opens a dialog: search for a real patient (reusing the same `GET /api/patients?search=` pattern used elsewhere in the app), then pick one of that patient's real, unlinked ultrasound studies. Study creation is disabled until both are selected.

### 2.6 Route duplication fix

The second, dead `POST /:studyId/extract-measurements` registration was deleted. The single remaining handler returns an honest capability status rather than a fabricated result:

```json
{
  "available": false,
  "status": "not_implemented",
  "message": "DICOM-SR extraction is not currently available for the Fetal USG module.",
  "srInstanceUid": null
}
```

The frontend's "DICOM Extract" button now reads this shape (it previously read a `res.extracted.status` field the backend never actually returned).

---

## 3. Historical-data policy

- A `calc_version` column was added to both `fetal_usg_studies` and `fetal_usg_measurements`. New rows computed by this corrected engine are stamped `"v2"`. Existing rows keep `calc_version = NULL`.
- **No existing row is recalculated or altered by this PR or its migration.** `NULL` means "computed by the pre-fix formulas — treat gaWeeks/gaDays/edd/efw on this row as unverified until reviewed," not "invalid" — the row is left exactly as it was.
- A **finalized** report's stored values are never touched, regardless of `calc_version`.
- An **active draft** re-opened after this PR will show recalculated values (from the corrected engine) the next time measurements are saved, along with any `warnings` the recalculation produces (e.g. a GA-establishment-method upgrade) — the radiologist reviews and explicitly re-saves; nothing is silently overwritten without a save action from a human.
- All new studies created after this PR use the corrected engine and are stamped `"v2"` from creation.

---

## 4. Clinical sanity guardrails at the route level

`detectCriticalAlerts()` (`fetalUsgLevel4.ts`) gained one new check, ahead of all pre-existing alerts: if GA could not be established at all (no CRL, MSD, or LMP on file), a critical alert is raised: *"Gestational age could not be established — no CRL, MSD, or LMP on file. Enter a dating measurement or a manual GA before finalizing."* Every other pre-existing critical-alert check (abnormal FHR, elevated NT, low/high EFW-for-GA, oligo/polyhydramnios, short cervix, elevated UA PI, abnormal DV a-wave, twin discordance > 20%, low BPP) is unchanged.

Critical alerts must be acknowledged before `POST /:studyId/final-sign` will succeed (pre-existing mechanism, unchanged). Calculation `warnings` (the softer, `CalculationResult.warnings` output) are surfaced to the UI but never block a draft save or block finalization by themselves — only genuine critical alerts do, consistent with the task's requirement that draft saves are never blocked by warnings, and only truly-invalid states block finalization via the existing permission/finalization pattern.

---

## 5. Test coverage

`artifacts/api-server/src/lib/obstetricCalculations.test.ts` — 57 tests: realistic CRL values, the exact task reproduction case (BPD~82mm/HC~300mm/AC~300mm/FL~65mm) verified to no longer produce an impossible GA, partial/missing data never treated as zero, unit normalization, EDD date boundaries (leap year, month/year rollovers, UTC-safety), Doppler divide-by-zero guards and the RI↔S/D algebraic cross-check, twin discordance symmetry.

`artifacts/api-server/src/routes/fetalUsgLevel4.test.ts` — 14 tests: patient/study context validation (missing/invalid patientId or studyId, patient not found, study not found, patient/study mismatch, non-ultrasound modality, already-linked study, and the **regression test that the created study uses the real selected patientId/studyId, never 1/1**), the available-studies picker (invalid patient, patient not found, non-ultrasound filtering), and route duplication (asserts exactly one handler is registered for `extract-measurements`, and that it returns the honest not-implemented shape).

All 71 tests pass. Both `artifacts/api-server` and `artifacts/diagnostic-erp` typecheck clean; the frontend production build succeeds.

---

## 6. Known limitations and remaining duplicates (explicitly not fixed by this PR)

- **`artifacts/api-server/src/lib/usgMeasurementEngine.ts`** still contains its own, separate, differently-wrong GA-from-CRL and GA-from-FL formulas (different coefficients again from either the old `fetalUsgLevel4.ts` code or the corrected module here). This file is not used by the Fetal USG Level-4 module and was out of this PR's stated scope (general USG measurement engine, not fetal-USG-specific) — flagged here as a known duplicate for a future, separately-scoped correction pass.
- **`artifacts/diagnostic-erp/src/lib/radiologySmartEngine.ts`** independently contains its own set of per-parameter `calculateGAFromCRL/BPD/HC/AC/FL` functions, used by the general Radiology Reporting Workspace's obstetric content (not the Fetal USG Level-4 page this PR covers). Per this PR's explicit non-goals ("do not modify Smart Findings", "do not modify `RadiologyReportingWorkspace.tsx`"), this file was left untouched. It has the same category of defect as §1.1 and should be corrected in a future, separately-scoped PR against the shared reporting workspace.
- The per-parameter GA-from-biometry approach was removed rather than replaced with new coefficients (§1.1, §2.2) because no independently verifiable source formula could be confirmed within this PR's scope. If a specific, citable regression (e.g. a validated Hadlock multi-parameter composite-GA formula from a primary source) is later sourced and verified, it can be added to `obstetricCalculations.ts` as an additional, clearly-labeled option — it should not be reintroduced as a guess.
- AFI 4-quadrant entry is additive; the single manual "AFI total" field remains for cases where only a total was measured (e.g. imported from an external report). If all four quadrants are entered, they take precedence over the manual total.
- This PR does not touch `UsgReporting.tsx`/`UsgDopplerReporting.tsx` or the general (non-fetal) USG measurement/finalize systems flagged as separate, duplicate systems in the prior architecture audit (doc 09, Phase 4) — that reconciliation remains explicitly out of scope, as stated in the task.
- Screenshots of the corrected UI in a live browser/database environment could not be produced from this sandbox (no live database, no browser against a running instance) — verification here is via unit/route tests, typecheck, and production build only.
