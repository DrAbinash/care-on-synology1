/**
 * USG Structured Measurement Engine
 * Auto-calculates derived values from raw numeric measurements.
 * All formulas are standard sonography references.
 */

export interface MeasurementSet {
  // Kidney
  rightKidneyLengthMm?: number | null;
  rightKidneyWidthMm?: number | null;
  rightKidneyThicknessMm?: number | null;
  leftKidneyLengthMm?: number | null;
  leftKidneyWidthMm?: number | null;
  leftKidneyThicknessMm?: number | null;
  rightCorticalThicknessMm?: number | null;
  leftCorticalThicknessMm?: number | null;

  // Prostate
  prostateLengthMm?: number | null;
  prostateWidthMm?: number | null;
  prostateHeightMm?: number | null;

  // Thyroid
  thyroidRightLobeLengthMm?: number | null;
  thyroidRightLobeWidthMm?: number | null;
  thyroidRightLobeThicknessMm?: number | null;
  thyroidLeftLobeLengthMm?: number | null;
  thyroidLeftLobeWidthMm?: number | null;
  thyroidLeftLobeThicknessMm?: number | null;
  thyroidIsthmusMm?: number | null;
  thyroidNoduleSizeMm?: number | null;
  thyroidTiradsScore?: string | null;

  // Liver / GB / CBD
  liverSpanMm?: number | null;
  cbdMm?: number | null;
  gbWallMm?: number | null;

  // Uterus / Ovaries
  uterusLengthMm?: number | null;
  uterusWidthMm?: number | null;
  uterusHeightMm?: number | null;
  rightOvaryLengthMm?: number | null;
  rightOvaryWidthMm?: number | null;
  rightOvaryHeightMm?: number | null;
  leftOvaryLengthMm?: number | null;
  leftOvaryWidthMm?: number | null;
  leftOvaryHeightMm?: number | null;
  follicleCount?: number | null;
  largestFollicleMm?: number | null;

  // Fetal
  bpdMm?: number | null;
  hcMm?: number | null;
  acMm?: number | null;
  flMm?: number | null;
  crlMm?: number | null;

  // Doppler
  psvCmS?: number | null;
  edvCmS?: number | null;
}

export interface CalculationResult {
  rightKidneyVolumeMl: number | null;
  leftKidneyVolumeMl: number | null;
  prostateVolumeMl: number | null;
  rightThyroidVolumeMl: number | null;
  leftThyroidVolumeMl: number | null;
  rightOvaryVolumeMl: number | null;
  leftOvaryVolumeMl: number | null;
  uterusVolumeMl: number | null;
  ri: number | null;               // resistive index
  estimatedGaWeeks: number | null; // from CRL only
  gestationalAgeByFl: number | null; // from FL (Hadlock)
}

function volEllipsoid(l?: number | null, w?: number | null, h?: number | null): number | null {
  if (l == null || w == null || h == null || l <= 0 || w <= 0 || h <= 0) return null;
  return Math.round((l * w * h * 0.523 / 1000) * 100) / 100;
}

function volProstate(l?: number | null, w?: number | null, h?: number | null): number | null {
  if (l == null || w == null || h == null || l <= 0 || w <= 0 || h <= 0) return null;
  // Prostate uses same ellipsoid formula, convert mm^3 to ml by dividing by 1000
  return Math.round((l * w * h * 0.523 / 1000) * 100) / 100;
}

export function calculateMeasurements(m: MeasurementSet): CalculationResult {
  // Kidney volume = ellipsoid (0.523 × L × W × Thickness)
  const rightKidneyVolumeMl = volEllipsoid(
    m.rightKidneyLengthMm, m.rightKidneyWidthMm, m.rightKidneyThicknessMm,
  );
  const leftKidneyVolumeMl = volEllipsoid(
    m.leftKidneyLengthMm, m.leftKidneyWidthMm, m.leftKidneyThicknessMm,
  );

  const prostateVolumeMl = volProstate(m.prostateLengthMm, m.prostateWidthMm, m.prostateHeightMm);

  const rightThyroidVolumeMl = volEllipsoid(
    m.thyroidRightLobeLengthMm, m.thyroidRightLobeWidthMm, m.thyroidRightLobeThicknessMm,
  );
  const leftThyroidVolumeMl = volEllipsoid(
    m.thyroidLeftLobeLengthMm, m.thyroidLeftLobeWidthMm, m.thyroidLeftLobeThicknessMm,
  );

  const rightOvaryVolumeMl = volEllipsoid(
    m.rightOvaryLengthMm, m.rightOvaryWidthMm, m.rightOvaryHeightMm,
  );
  const leftOvaryVolumeMl = volEllipsoid(
    m.leftOvaryLengthMm, m.leftOvaryWidthMm, m.leftOvaryHeightMm,
  );
  const uterusVolumeMl = volEllipsoid(m.uterusLengthMm, m.uterusWidthMm, m.uterusHeightMm);

  // RI = (PSV - EDV) / PSV
  let ri: number | null = null;
  if (m.psvCmS != null && m.edvCmS != null && m.psvCmS > 0) {
    ri = Math.round(((m.psvCmS - m.edvCmS) / m.psvCmS) * 100) / 100;
  }

  // GA from CRL (Robinson 1975): GA = 40.9 + 3.54 × log10(CRL) — simplified to weeks
  let estimatedGaWeeks: number | null = null;
  if (m.crlMm != null && m.crlMm > 0) {
    estimatedGaWeeks = Math.round((40.9 + 3.54 * Math.log10(m.crlMm)) * 10) / 10;
  }

  // GA from FL (Hadlock 1984 simplified): weeks = 1.29 × FL + 7.31
  let gestationalAgeByFl: number | null = null;
  if (m.flMm != null && m.flMm > 0) {
    gestationalAgeByFl = Math.round((1.29 * m.flMm + 7.31) * 10) / 10;
  }

  return {
    rightKidneyVolumeMl,
    leftKidneyVolumeMl,
    prostateVolumeMl,
    rightThyroidVolumeMl,
    leftThyroidVolumeMl,
    rightOvaryVolumeMl,
    leftOvaryVolumeMl,
    uterusVolumeMl,
    ri,
    estimatedGaWeeks,
    gestationalAgeByFl,
  };
}

export function parseDimension(val: string | null | undefined, defaultUnit: "mm" | "cm" = "mm"): number | null {
  if (val == null || val === "") return null;
  const cleaned = String(val).trim();
  const match = cleaned.match(/^([\d.]+)\s*(mm|cm|cc|ml)?\s*$/i);
  if (!match) {
    const numMatch = cleaned.match(/([\d.]+)/);
    if (!numMatch) return null;
    const num = parseFloat(numMatch[1]);
    if (isNaN(num)) return null;
    return defaultUnit === "cm" ? num * 10 : num;
  }
  const num = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();
  if (isNaN(num)) return null;
  if (unit === "cm") return num * 10;
  if (unit === "mm") return num;
  if (unit === "cc" || unit === "ml") return num;
  return defaultUnit === "cm" ? num * 10 : num;
}

export function parseTripleDimensions(val: string | null | undefined): { l: number; w: number; h: number } | null {
  if (val == null || val === "") return null;
  const cleaned = String(val).trim();
  const hasCm = /cm/i.test(cleaned);
  const defaultUnit = hasCm ? "cm" : "mm";
  const parts = cleaned.split(/[\sx*×]+/i).map(p => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const l = parseDimension(parts[0], defaultUnit);
  const w = parseDimension(parts[1], defaultUnit);
  const h = parseDimension(parts[2], defaultUnit);
  if (l == null || w == null || h == null) return null;
  return { l, w, h };
}

export function normalizeAndCalculate(m: any): {
  normalizedFields: Partial<MeasurementSet>;
  calculations: CalculationResult;
} {
  const updates: Partial<MeasurementSet> = {};

  // Kidney
  const rkDims = parseTripleDimensions(m.rightKidney);
  if (rkDims) {
    updates.rightKidneyLengthMm = rkDims.l;
    updates.rightKidneyWidthMm = rkDims.w;
    updates.rightKidneyThicknessMm = rkDims.h;
  }
  const lkDims = parseTripleDimensions(m.leftKidney);
  if (lkDims) {
    updates.leftKidneyLengthMm = lkDims.l;
    updates.leftKidneyWidthMm = lkDims.w;
    updates.leftKidneyThicknessMm = lkDims.h;
  }

  // Prostate
  const prosDims = parseTripleDimensions(m.prostateVolume);
  if (prosDims) {
    updates.prostateLengthMm = prosDims.l;
    updates.prostateWidthMm = prosDims.w;
    updates.prostateHeightMm = prosDims.h;
  }

  // Uterus
  const utDims = parseTripleDimensions(m.uterusSize);
  if (utDims) {
    updates.uterusLengthMm = utDims.l;
    updates.uterusWidthMm = utDims.w;
    updates.uterusHeightMm = utDims.h;
  }

  // Ovaries
  const roDims = parseTripleDimensions(m.rightOvary);
  if (roDims) {
    updates.rightOvaryLengthMm = roDims.l;
    updates.rightOvaryWidthMm = roDims.w;
    updates.rightOvaryHeightMm = roDims.h;
  }
  const loDims = parseTripleDimensions(m.leftOvary);
  if (loDims) {
    updates.leftOvaryLengthMm = loDims.l;
    updates.leftOvaryWidthMm = loDims.w;
    updates.leftOvaryHeightMm = loDims.h;
  }

  // Liver / CBD / GB
  const liverVal = parseDimension(m.liverSize, "cm");
  if (liverVal) updates.liverSpanMm = liverVal;

  const cbdVal = parseDimension(m.cbd, "mm");
  if (cbdVal) updates.cbdMm = cbdVal;

  const gbWallVal = parseDimension(m.gbWall, "mm");
  if (gbWallVal) updates.gbWallMm = gbWallVal;

  // Fetal
  const bpdVal = parseDimension(m.bpd, "mm");
  if (bpdVal) updates.bpdMm = bpdVal;

  const hcVal = parseDimension(m.hc, "mm");
  if (hcVal) updates.hcMm = hcVal;

  const acVal = parseDimension(m.ac, "mm");
  if (acVal) updates.acMm = acVal;

  const flVal = parseDimension(m.fl, "mm");
  if (flVal) updates.flMm = flVal;

  const crlVal = parseDimension(m.crl, "mm");
  if (crlVal) updates.crlMm = crlVal;

  const combinedSet = {
    ...m,
    ...updates,
  };

  const calc = calculateMeasurements(combinedSet);

  return {
    normalizedFields: updates,
    calculations: calc,
  };
}
