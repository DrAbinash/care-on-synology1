// volume.ts — canonical organ-volume math (SINGLE SOURCE OF TRUTH).
//
// The prolate-ellipsoid formula V = 0.523 · L · W · H (0.523 ≈ π/6) is used for
// prostate, kidney, thyroid-lobe, ovary and uterus volumes throughout CARE.
// It lives here so the frontend Dynamic Finding Builder
// (artifacts/diagnostic-erp/src/lib/usgFindingBuilder.ts) and the server
// measurement engine (artifacts/api-server/src/lib/usgMeasurementEngine.ts)
// compute IDENTICALLY — no mirrored copies, no drift. Unit conversion is
// delegated to this package's own units module, so there is one conversion path
// as well. Pure TS, no runtime deps — usable on client and server.

import { convertUnitValue } from "./units";

/** Prolate-ellipsoid factor, ≈ π/6. */
export const ELLIPSOID_FACTOR = 0.523;

/** Round to 2 decimals — matches the historical server rounding. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ellipsoid volume in millilitres (= cc) from three linear dimensions already
 * in millimetres. Returns null if any dimension is missing or non-positive.
 *
 * e.g. 34 × 31 × 24 mm → 13.23 mL (the spec's ~13.2 cc, NOT 35 cc).
 */
export function ellipsoidVolumeMlFromMm(
  lMm: number | null | undefined,
  wMm: number | null | undefined,
  hMm: number | null | undefined,
): number | null {
  if (lMm == null || wMm == null || hMm == null) return null;
  if (!(lMm > 0) || !(wMm > 0) || !(hMm > 0)) return null;
  return round2((lMm * wMm * hMm * ELLIPSOID_FACTOR) / 1000);
}

/**
 * Ellipsoid volume in millilitres from three linear dimensions in a stated unit
 * (default "mm"). Conversion to millimetres goes through the shared units
 * module, so mm/cm/m all resolve identically to every other consumer.
 */
export function ellipsoidVolumeMl(
  l: number | null | undefined,
  w: number | null | undefined,
  h: number | null | undefined,
  unit: string = "mm",
): number | null {
  const toMm = (v: number | null | undefined): number | null => {
    if (v == null) return null;
    if (unit === "mm") return v;
    return convertUnitValue(v, unit, "mm");
  };
  return ellipsoidVolumeMlFromMm(toMm(l), toMm(w), toMm(h));
}
