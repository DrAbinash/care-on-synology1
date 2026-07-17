// units.ts — the single unit vocabulary + conversion for laboratory analytes.
//
// Two jobs, mirroring lib/measurements/src/units.ts:
//   1. Normalize the many spellings of a unit ("gm/dl", "g%", "g/dL") to one
//      canonical symbol, so alias resolution and validation are deterministic.
//   2. Convert a value between units of the SAME physical dimension, by exact
//      factors only. Conversions that need extra information (molar mass to go
//      mg/dL -> mmol/L, ionic valence to go mmol/L -> mEq/L) are intentionally
//      NOT supported: convertUnitValue returns null and the caller keeps the
//      value in the unit given rather than risk a clinically wrong number.
//
// Unknown units are preserved verbatim (canonicalUnit returns the trimmed
// input); conversion simply returns null.

/** Canonical unit symbol per accepted spelling (matched case-insensitively). */
const UNIT_SYNONYMS: Record<string, string> = {
  // ── Mass concentration ────────────────────────────────────────────────────
  "g/dl": "g/dL", "gm/dl": "g/dL", "gms/dl": "g/dL", "g%": "g/dL", "gm%": "g/dL", "gms%": "g/dL",
  "g/l": "g/L", "gm/l": "g/L",
  "mg/dl": "mg/dL", "mgs/dl": "mg/dL", "mg%": "mg/dL", "mgs%": "mg/dL",
  "mg/l": "mg/L",
  "ug/dl": "µg/dL", "µg/dl": "µg/dL", "mcg/dl": "µg/dL",
  "ug/l": "µg/L", "µg/l": "µg/L", "mcg/l": "µg/L",
  "ng/dl": "ng/dL", "ng/l": "ng/L",
  "ng/ml": "ng/mL", "µg/l ": "µg/L",
  "pg/ml": "pg/mL",
  "pg": "pg",
  // ── Volume (RBC indices) ──────────────────────────────────────────────────
  "fl": "fL", "femtoliter": "fL", "femtolitre": "fL",
  // ── Percent / ratio ───────────────────────────────────────────────────────
  "%": "%", percent: "%", "per cent": "%",
  ratio: "ratio",
  index: "ratio",
  // ── Enzyme / catalytic activity (IU/L and U/L are the same magnitude) ──────
  "u/l": "U/L", "iu/l": "U/L", "units/l": "U/L", "iu/liter": "U/L",
  // ── Molar concentration ───────────────────────────────────────────────────
  "mmol/l": "mmol/L", "mmols/l": "mmol/L",
  "umol/l": "µmol/L", "µmol/l": "µmol/L", "mcmol/l": "µmol/L",
  "meq/l": "mEq/L", "meq/liter": "mEq/L",
  // ── Hormone units ─────────────────────────────────────────────────────────
  "uiu/ml": "µIU/mL", "µiu/ml": "µIU/mL", "mciu/ml": "µIU/mL",
  "miu/l": "mIU/L", "miu/ml": "mIU/mL", "iu/ml": "IU/mL",
  "iu/dl": "IU/dL",
  // ── Counts / concentration (per volume) ───────────────────────────────────
  "/ul": "/µL", "/µl": "/µL", "cells/ul": "/µL", "cells/µl": "/µL",
  "/cumm": "/µL", "cumm": "/µL", "/cu mm": "/µL", "cells/cumm": "/µL",
  "/mm3": "/µL", "/mm³": "/µL", "cells/mm3": "/µL",
  "10^3/ul": "10^3/µL", "10^3/µl": "10^3/µL", "x10^3/ul": "10^3/µL", "10*3/ul": "10^3/µL",
  "10³/µl": "10^3/µL", "k/ul": "10^3/µL", "thou/ul": "10^3/µL", "thousand/ul": "10^3/µL", "/nl": "10^3/µL",
  "10^9/l": "10^9/L", "10*9/l": "10^9/L", "10⁹/l": "10^9/L",
  "10^6/ul": "10^6/µL", "10^6/µl": "10^6/µL", "x10^6/ul": "10^6/µL", "10*6/ul": "10^6/µL",
  "mill/ul": "10^6/µL", "million/ul": "10^6/µL", "10⁶/µl": "10^6/µL",
  "10^12/l": "10^12/L", "10*12/l": "10^12/L", "10¹²/l": "10^12/L",
  // ── Microscopy fields / misc ──────────────────────────────────────────────
  "/hpf": "/hpf", hpf: "/hpf", "per hpf": "/hpf",
  "/lpf": "/lpf", lpf: "/lpf", "per lpf": "/lpf",
  "mm/hr": "mm/hr", "mm/hour": "mm/hr", "mm 1st hr": "mm/hr", "mm/1hr": "mm/hr",
  sec: "sec", secs: "sec", seconds: "sec", second: "sec",
  "": "",
};

/** Factor to a family base; conversion is exact within a family only. */
const TO_BASE: Record<string, { family: string; factor: number }> = {
  // Mass concentration — base g/L. Every entry is an exact mass/volume scale.
  "g/dL": { family: "mass-conc", factor: 10 },       // 1 g/dL = 10 g/L
  "g/L": { family: "mass-conc", factor: 1 },
  "mg/dL": { family: "mass-conc", factor: 0.01 },    // 1 mg/dL = 0.01 g/L
  "mg/L": { family: "mass-conc", factor: 0.001 },
  "µg/dL": { family: "mass-conc", factor: 1e-5 },
  "µg/L": { family: "mass-conc", factor: 1e-6 },
  "ng/mL": { family: "mass-conc", factor: 1e-6 },    // 1 ng/mL = 1 µg/L
  "ng/dL": { family: "mass-conc", factor: 1e-8 },
  "ng/L": { family: "mass-conc", factor: 1e-9 },
  "pg/mL": { family: "mass-conc", factor: 1e-9 },
  // Molar concentration — base mmol/L.
  "mmol/L": { family: "molar-conc", factor: 1 },
  "µmol/L": { family: "molar-conc", factor: 0.001 },
  // Cell/particle concentration — base /µL.
  "/µL": { family: "count-conc", factor: 1 },
  "10^3/µL": { family: "count-conc", factor: 1e3 },
  "10^9/L": { family: "count-conc", factor: 1e3 },   // 10^9/L = 10^3/µL
  "10^6/µL": { family: "count-conc", factor: 1e6 },
  "10^12/L": { family: "count-conc", factor: 1e6 },
  // TSH-family activity concentration — base µIU/mL (== mIU/L numerically).
  "µIU/mL": { family: "iu-tsh", factor: 1 },
  "mIU/L": { family: "iu-tsh", factor: 1 },
};

export function canonicalUnit(raw: string): string {
  const key = raw.trim().toLowerCase();
  return UNIT_SYNONYMS[key] ?? raw.trim();
}

export function isKnownUnit(raw: string): boolean {
  return raw.trim().toLowerCase() in UNIT_SYNONYMS;
}

/**
 * Convert a value between units of the same family. Returns null when the units
 * are not interconvertible without extra data (different families, or unknown
 * units), so the caller keeps the original value+unit rather than guess.
 */
export function convertUnitValue(value: number, fromUnit: string, toUnit: string): number | null {
  const from = canonicalUnit(fromUnit);
  const to = canonicalUnit(toUnit);
  if (from === to) return value;
  const f = TO_BASE[from];
  const t = TO_BASE[to];
  if (!f || !t || f.family !== t.family) return null;
  return (value * f.factor) / t.factor;
}
