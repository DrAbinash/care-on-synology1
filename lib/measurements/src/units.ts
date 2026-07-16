// units.ts — the single unit vocabulary + conversion for measurements.
//
// HARD RULE upstream: no duplicated units. The quality engine's structured
// executors already convert mm↔cm↔m (lib/report-quality/src/rules/structured/
// executors.ts); this module is the shared home for that knowledge so every
// consumer (comparison, viewer, quality, companion) converts identically.
// Unknown units are preserved verbatim — conversion simply returns null and
// callers compare in the unit given.

/** Canonical unit symbol per accepted spelling (case-insensitive). */
const UNIT_SYNONYMS: Record<string, string> = {
  mm: "mm",
  millimeter: "mm",
  millimeters: "mm",
  cm: "cm",
  centimeter: "cm",
  centimeters: "cm",
  m: "m",
  ml: "ml",
  cc: "ml",
  l: "l",
  g: "g",
  gm: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  hu: "HU",
  bpm: "bpm",
  deg: "deg",
  "°": "deg",
  degree: "deg",
  degrees: "deg",
  "%": "%",
  percent: "%",
  ratio: "ratio",
  "cm/s": "cm/s",
  "mm/s": "mm/s",
  weeks: "weeks",
  wk: "weeks",
  "": "",
};

/** Factor to the family's base unit (length→mm, volume→ml, mass→g). */
const TO_BASE: Record<string, { family: string; factor: number }> = {
  mm: { family: "length", factor: 1 },
  cm: { family: "length", factor: 10 },
  m: { family: "length", factor: 1000 },
  ml: { family: "volume", factor: 1 },
  l: { family: "volume", factor: 1000 },
  g: { family: "mass", factor: 1 },
  kg: { family: "mass", factor: 1000 },
};

export function canonicalUnit(raw: string): string {
  const key = raw.trim().toLowerCase();
  return UNIT_SYNONYMS[key] ?? raw.trim();
}

export function isKnownUnit(raw: string): boolean {
  return raw.trim().toLowerCase() in UNIT_SYNONYMS;
}

/**
 * Convert a value between units of the same family. Returns null when the
 * units are not interconvertible (caller keeps the original value+unit).
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
