/**
 * usgDopplerSection — canonical Doppler report section builder (P5.2).
 *
 * Consolidates Doppler reporting onto the ONE canonical engine
 * (`obstetricCalculations`): RI, PI, S/D and CPR come from
 * `calcRi`/`calcPi`/`calcSdRatio`/`calcCpr` — no index formula is reimplemented.
 * It emits a canonical structured section (`findings_sections`-compatible) plus
 * impression bullets. It does NOT create a second store and does NOT finalize.
 *
 * Honesty: an index is computed only when its inputs are present; a missing
 * input drops the index (never guessed). Waveform flags (absent/reversed
 * end-diastolic flow, elevated S/D, CPR abnormal) are DESCRIPTIVE and always
 * ask for clinical correlation — this builder never renders an autonomous
 * diagnosis.
 */

import { calcRi, calcPi, calcSdRatio, calcCpr } from "./obstetricCalculations";

export interface DopplerVesselInput {
  vessel: string;                 // e.g. "Umbilical artery", "Right CCA"
  side?: string | null;
  psv?: number | null;            // cm/s
  edv?: number | null;            // cm/s (negative → reversed diastolic flow)
  tamv?: number | null;          // cm/s (for PI)
  /** For CPR only, when this row is the MCA and a paired UA-PI is supplied. */
  pairedUaPi?: number | null;
  absentEndDiastolicFlow?: boolean | null;
}

export interface DopplerVesselResult {
  vessel: string;
  side: string | null;
  psv: number | null;
  edv: number | null;
  ri: number | null;
  pi: number | null;
  sdRatio: number | null;
  cpr: number | null;
  flags: string[];                // descriptive, correlate-clinically flags
  text: string;
}

export interface StructuredSection {
  label: string;
  normal: boolean;
  text: string;
}

export interface DopplerSectionResult {
  section: StructuredSection;
  impression: string[];
  vessels: DopplerVesselResult[];
  warnings: string[];
}

function fmt(v: number | null, digits = 2): string {
  return v == null ? "—" : v.toFixed(digits).replace(/\.0+$/, "");
}

export function buildDopplerSection(
  vessels: DopplerVesselInput[],
  opts: { label?: string } = {},
): DopplerSectionResult {
  const warnings: string[] = [];
  const impression: string[] = [];
  const rows: DopplerVesselResult[] = [];

  for (const v of vessels) {
    let ri: number | null = null, pi: number | null = null, sd: number | null = null, cpr: number | null = null;
    const flags: string[] = [];

    // Reversed diastolic flow → EDV negative. Absent → EDV 0 / flagged.
    const reversed = v.edv != null && v.edv < 0;
    const absent = v.absentEndDiastolicFlow === true || v.edv === 0;

    // RI needs EDV ≥ 0; S/D needs EDV > 0. Absent/reversed flow drops those
    // indices (the flags below carry the meaning) — we never feed the engine a
    // value it would reject and surface its error text as a report warning.
    if (v.psv != null && v.edv != null && v.edv >= 0) {
      const r = calcRi(v.psv, v.edv); ri = r.value; warnings.push(...r.warnings);
      if (v.edv > 0) { const s = calcSdRatio(v.psv, v.edv); sd = s.value; warnings.push(...s.warnings); }
    }
    if (v.psv != null && v.edv != null && v.tamv != null) {
      const p = calcPi(v.psv, v.edv, v.tamv); pi = p.value; warnings.push(...p.warnings);
    }
    if (pi != null && v.pairedUaPi != null && v.pairedUaPi > 0) {
      const c = calcCpr(pi, v.pairedUaPi); cpr = c.value; warnings.push(...c.warnings);
      if (cpr != null && cpr < 1) flags.push("cerebroplacental ratio below 1.0 — correlate clinically");
    }
    if (reversed) flags.push("reversed end-diastolic flow — correlate clinically");
    else if (absent) flags.push("absent end-diastolic flow — correlate clinically");

    const indices = [
      v.psv != null ? `PSV ${fmt(v.psv)}` : null,
      v.edv != null ? `EDV ${fmt(v.edv)}` : null,
      ri != null ? `RI ${fmt(ri)}` : null,
      pi != null ? `PI ${fmt(pi)}` : null,
      sd != null ? `S/D ${fmt(sd)}` : null,
      cpr != null ? `CPR ${fmt(cpr)}` : null,
    ].filter(Boolean).join(", ");
    const side = v.side && v.side !== "unknown" ? ` (${v.side})` : "";
    const flagText = flags.length ? ` — ${flags.join("; ")}` : "";
    const text = `${v.vessel}${side}: ${indices || "no numeric indices recorded"}${flagText}.`;

    rows.push({ vessel: v.vessel, side: v.side ?? null, psv: v.psv ?? null, edv: v.edv ?? null, ri, pi, sdRatio: sd, cpr, flags, text });

    for (const f of flags) impression.push(`${v.vessel}${side}: ${f}.`);
  }

  const normal = rows.length > 0 && rows.every((r) => r.flags.length === 0);

  return {
    section: {
      label: opts.label ?? "Doppler",
      normal,
      text: rows.map((r) => r.text).join("\n"),
    },
    impression,
    vessels: rows,
    warnings: [...new Set(warnings)],
  };
}
