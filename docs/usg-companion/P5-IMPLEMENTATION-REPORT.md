# USG Companion — Phase P5 (OB & Doppler consolidation)

**Branch:** `claude/usg-companion-p5-ob-doppler` (stacked on P4 `claude/usg-companion-p4-comparison`).
**Flags:** `ff_radiology_usg_ob_canonical`, `ff_radiology_usg_doppler_canonical` — **default OFF**.

P5 consolidates obstetric and Doppler reporting onto the **one** canonical
obstetric engine and the canonical structured-section model. Both builders are
pure, suggestion-only, and emit the canonical persisted shape (a
`findings_sections`-compatible section + `impression` bullets) — no second store,
no reimplemented formula, no autonomous diagnosis, nothing finalized.

## Gap map

- OB and Doppler were reported only through `autoGenerateReport` (flat text),
  which **string-substitutes pre-computed measurement fields** and does not run
  the engine. GA/EDD/EFW/AFI/RI/PI/S-D/CPR live in `obstetricCalculations` but
  were **not wired** into a structured OB/Doppler section + impression.
- No GA-by-US vs GA-by-dates discrepancy surfacing.
- No engine-guard against feeding absent/reversed EDV (edv ≤ 0) into the RI/SD
  functions — which would return the engine's error text.
- PCPNDT: needed an explicit guarantee that the OB builder can never emit sex.

## Delivered (all pure + unit-tested)

| Module | Capability |
|---|---|
| `usgObSection.ts` | Establishes GA **once** (CRL > LMP) via `establishGa`; EDD via `calcEddFromEstablishedGa`/`calcEddFromLmp`; EFW via `calcEfwGrams`; AFI via `calcAfiFromQuadrants` + `calcAfiInterpretation` — **no formula/chart reimplemented**. Emits a canonical structured OB section + impression bullets. **PCPNDT-safe: never accepts, derives, or emits fetal sex.** A US-vs-dates GA gap beyond tolerance is a **descriptive caveat**, never an auto-diagnosis. Missing inputs drop their clause (no fabrication). |
| `usgDopplerSection.ts` | RI/PI/S-D via `calcRi`/`calcPi`/`calcSdRatio`; CPR via `calcCpr` (only with MCA-PI + paired UA-PI). **PI only when TAMV present** (never fabricated). Absent/reversed end-diastolic flow and CPR < 1 are **descriptive flags** that ask for clinical correlation — never an autonomous diagnosis. Guards the engine from edv ≤ 0 so its error strings never leak into report warnings. |

**Tests:** 11 new (usgObSection 5, usgDopplerSection 6) — all green. Full-workspace `pnpm typecheck` 0 errors; flag-registry validation (`radiologyOpsHealth`) green with the 2 new entries; api-server production build succeeds.

## Non-negotiable constraints honored

- **One engine.** Every obstetric/Doppler number comes from `obstetricCalculations`. No parallel formula.
- **No second store.** Output is the canonical `findings_sections` section shape + canonical `impression` string[].
- **PCPNDT fail-safe.** The OB builder has no sex input/output path — verified by a test asserting no sex/gender token ever appears.
- **No autonomous clinical judgment.** GA discrepancy and Doppler waveform states are descriptive + "correlate clinically"; no IUGR/hypoxia/distress classification.
- **Flags default OFF, `wired:false`.** No production route enabled; legacy autofill remains until a flag is turned on.

## Remaining P5 integration (documented, needs live data)

1. Wire `buildObSection`/`buildDopplerSection` into the USG workspace behind the
   two flags, merging their `section`/`impression` through the existing
   `composeFindingsSections`/`composeImpression` path (no auto-insert without the
   radiologist's review).
2. Route OB studies through the existing PCPNDT Form-F gate (unchanged, fail-closed).
3. Clinic validation on staging with dummy OB/Doppler studies.

**Flags stay OFF** until validated.

## Classification

**CODE COMPLETE (core) — INTEGRATION & CLINIC VALIDATION PENDING.**
