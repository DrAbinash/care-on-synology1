/**
 * Neuro-Spine Grading Engine — clinical definitions + finding composition.
 *
 * Standardized neurosurgical grades for MRI spine canvases (lumbar /
 * cervical / dorsal). Emits canonical observation atoms that flow through
 * the existing applyMacroBundle / applyPathologyOverlay ledger — does NOT
 * create a second reporting engine or alter the Zustand store shape.
 *
 * Grades:
 *   Pfirrmann I–V   — disc degeneration
 *   Modic 0–III     — endplate marrow (0 = none)
 *   Meyerding 0–IV  — spondylolisthesis (0 = none)
 *   Cord signal 0–2 — 0 normal, 1 faint T2, 2 bright T2
 *   Foraminal       — None / Mild / Moderate / Severe
 */

export const PFIRRMANN_GRADES = [
  {
    id: "I" as const,
    label: "I",
    roman: "I",
    findings: "Pfirrmann grade I disc (homogeneous bright T2, normal height)",
    short: "Pfirrmann I",
  },
  {
    id: "II" as const,
    label: "II",
    roman: "II",
    findings: "Pfirrmann grade II disc (inhomogeneous bright T2, normal height)",
    short: "Pfirrmann II",
  },
  {
    id: "III" as const,
    label: "III",
    roman: "III",
    findings: "Pfirrmann grade III disc degeneration (inhomogeneous intermediate T2, unclear nucleus–annulus distinction)",
    short: "Pfirrmann III",
  },
  {
    id: "IV" as const,
    label: "IV",
    roman: "IV",
    findings: "Pfirrmann grade IV disc degeneration (inhomogeneous dark T2, height mildly reduced)",
    short: "Pfirrmann IV",
  },
  {
    id: "V" as const,
    label: "V",
    roman: "V",
    findings: "Pfirrmann grade V disc degeneration (inhomogeneous dark T2 with collapsed disc space)",
    short: "Pfirrmann V",
  },
] as const;

export type PfirrmannGradeId = (typeof PFIRRMANN_GRADES)[number]["id"];

/** Modic endplate changes — 0 = none. */
export const MODIC_GRADES = [
  { id: "0" as const, label: "0", roman: "0", findings: "", short: "No Modic change" },
  {
    id: "I" as const,
    label: "I",
    roman: "I",
    findings: "Modic type I endplate changes (T1 hypointense, T2 hyperintense)",
    short: "Modic I",
  },
  {
    id: "II" as const,
    label: "II",
    roman: "II",
    findings: "Modic type II endplate changes (T1 and T2 hyperintense)",
    short: "Modic II",
  },
  {
    id: "III" as const,
    label: "III",
    roman: "III",
    findings: "Modic type III endplate changes (T1 and T2 hypointense)",
    short: "Modic III",
  },
] as const;

export type ModicGradeId = (typeof MODIC_GRADES)[number]["id"];

/** Meyerding spondylolisthesis — 0 = none / no listhesis. */
export const MEYERDING_GRADES = [
  { id: "0" as const, label: "0", roman: "0", findings: "", short: "No listhesis" },
  {
    id: "I" as const,
    label: "I",
    roman: "I",
    findings: "Meyerding grade I spondylolisthesis (<25% slip)",
    short: "Meyerding I",
  },
  {
    id: "II" as const,
    label: "II",
    roman: "II",
    findings: "Meyerding grade II spondylolisthesis (25–50% slip)",
    short: "Meyerding II",
  },
  {
    id: "III" as const,
    label: "III",
    roman: "III",
    findings: "Meyerding grade III spondylolisthesis (50–75% slip)",
    short: "Meyerding III",
  },
  {
    id: "IV" as const,
    label: "IV",
    roman: "IV",
    findings: "Meyerding grade IV spondylolisthesis (>75% slip)",
    short: "Meyerding IV",
  },
] as const;

export type MeyerdingGradeId = (typeof MEYERDING_GRADES)[number]["id"];

/** Cord T2 signal — 0 normal, 1 faint, 2 bright. */
export const CORD_SIGNAL_GRADES = [
  {
    id: "0" as const,
    label: "0",
    findings: "Cord signal is normal at this level.",
    short: "Cord normal",
  },
  {
    id: "1" as const,
    label: "1",
    findings: "Faint intramedullary T2 hyperintensity is noted in the cord at this level.",
    short: "Faint T2",
  },
  {
    id: "2" as const,
    label: "2",
    findings: "Bright intramedullary T2 hyperintensity is noted in the cord at this level — myelopathic signal change.",
    short: "Bright T2",
  },
] as const;

export type CordSignalGradeId = (typeof CORD_SIGNAL_GRADES)[number]["id"];

export const FORAMINAL_STENOSIS_GRADES = [
  { id: "none" as const, label: "None", findings: "", short: "Foramina patent" },
  { id: "mild" as const, label: "Mild", findings: "mild", short: "Mild foraminal" },
  { id: "moderate" as const, label: "Moderate", findings: "moderate", short: "Moderate foraminal" },
  { id: "severe" as const, label: "Severe", findings: "severe", short: "Severe foraminal" },
] as const;

export type ForaminalStenosisGradeId = (typeof FORAMINAL_STENOSIS_GRADES)[number]["id"];

export const CENTRAL_CANAL_STENOSIS_GRADES = [
  { id: "none" as const, label: "None", findings: "", severity: "" },
  { id: "mild" as const, label: "Mild", findings: "mild central canal stenosis", severity: "mild" },
  { id: "moderate" as const, label: "Moderate", findings: "moderate central canal stenosis", severity: "moderate" },
  { id: "severe" as const, label: "Severe", findings: "severe central canal stenosis", severity: "severe" },
] as const;

export type CentralCanalStenosisGradeId = (typeof CENTRAL_CANAL_STENOSIS_GRADES)[number]["id"];

/** Shared grading selection fields for lumbar / cervical / dorsal level Apply. */
export type SpineNeuroGradingSelection = {
  pfirrmann?: PfirrmannGradeId | null;
  /** Standardized Modic 0–III (maps to legacy type1/2/3 in lumbar UI). */
  modicGrade?: ModicGradeId | null;
  meyerding?: MeyerdingGradeId | null;
  cordSignal?: CordSignalGradeId | null;
  /** Foraminal severity — same vocabulary as existing canvas chips. */
  foraminalSeverity?: ForaminalStenosisGradeId | null;
  foraminalLaterality?: "left" | "right" | "bilateral" | null;
  /** Central canal stenosis severity for composed neurosurgical wording. */
  centralCanalSeverity?: CentralCanalStenosisGradeId | null;
  canalApMm?: number | null;
};

/** Map legacy lumbar Modic option ids ↔ standardized Modic grades. */
export function modicGradeFromLegacy(legacy?: string | null): ModicGradeId | null {
  if (!legacy || legacy === "none") return "0";
  if (legacy === "type1") return "I";
  if (legacy === "type2") return "II";
  if (legacy === "type3") return "III";
  if (legacy === "0" || legacy === "I" || legacy === "II" || legacy === "III") {
    return legacy as ModicGradeId;
  }
  return null;
}

export function legacyModicFromGrade(grade?: ModicGradeId | null): "none" | "type1" | "type2" | "type3" | null {
  if (grade == null || grade === "0") return "none";
  if (grade === "I") return "type1";
  if (grade === "II") return "type2";
  if (grade === "III") return "type3";
  return null;
}

export function spineGradingHasContent(g: SpineNeuroGradingSelection): boolean {
  return !!(
    g.pfirrmann
    || (g.modicGrade && g.modicGrade !== "0")
    || (g.meyerding && g.meyerding !== "0")
    || (g.cordSignal && g.cordSignal !== "0")
    || (g.foraminalSeverity && g.foraminalSeverity !== "none")
    || (g.centralCanalSeverity && g.centralCanalSeverity !== "none")
  );
}

/**
 * Compose a single neurosurgical finding sentence for a disc level.
 *
 * Example:
 *   "L4-L5: Pfirrmann IV disc degeneration with severe central canal stenosis
 *    (AP: 8mm) and moderate bilateral foraminal narrowing."
 */
export function composeNeuroSpineFinding(
  level: string,
  g: SpineNeuroGradingSelection,
): { findings: string; impression: string } {
  const lvl = (level || "").trim() || "This level";
  const pf = PFIRRMANN_GRADES.find((o) => o.id === g.pfirrmann);
  const canal = CENTRAL_CANAL_STENOSIS_GRADES.find((o) => o.id === g.centralCanalSeverity);
  const foram = FORAMINAL_STENOSIS_GRADES.find((o) => o.id === g.foraminalSeverity);
  const modic = MODIC_GRADES.find((o) => o.id === g.modicGrade);
  const meyer = MEYERDING_GRADES.find((o) => o.id === g.meyerding);
  const cord = CORD_SIGNAL_GRADES.find((o) => o.id === g.cordSignal);

  const headParts: string[] = [];
  if (pf) {
    headParts.push(`${pf.short} disc degeneration`);
  }

  const withParts: string[] = [];
  if (canal && canal.id !== "none") {
    let canalPhrase = canal.findings;
    if (g.canalApMm != null && Number.isFinite(g.canalApMm)) {
      canalPhrase += ` (AP: ${g.canalApMm}mm)`;
    }
    withParts.push(canalPhrase);
  } else if (g.canalApMm != null && Number.isFinite(g.canalApMm)) {
    withParts.push(`AP canal diameter ${g.canalApMm} mm`);
  }

  if (foram && foram.id !== "none") {
    const side = g.foraminalLaterality ?? "bilateral";
    withParts.push(`${foram.id} ${side} foraminal narrowing`);
  }

  if (modic && modic.id !== "0" && modic.findings) {
    withParts.push(modic.findings);
  }
  if (meyer && meyer.id !== "0" && meyer.findings) {
    withParts.push(meyer.findings);
  }
  if (cord && cord.id !== "0") {
    withParts.push(
      cord.id === "1"
        ? "faint cord T2 hyperintensity"
        : "bright cord T2 hyperintensity (myelopathic)",
    );
  }

  let findings: string;
  if (headParts.length === 0 && withParts.length === 0) {
    return { findings: "", impression: "" };
  }

  if (headParts.length > 0 && withParts.length > 0) {
    findings = `${lvl}: ${headParts.join("; ")} with ${joinWithAnd(withParts)}.`;
  } else if (headParts.length > 0) {
    findings = `${lvl}: ${headParts.join("; ")}.`;
  } else {
    findings = `${lvl}: ${joinWithAnd(withParts)}.`;
  }

  const impBits = [
    pf ? pf.short : "",
    canal && canal.id !== "none" ? canal.severity + " canal stenosis" : "",
    foram && foram.id !== "none"
      ? `${foram.id} ${(g.foraminalLaterality ?? "bilateral")} foraminal narrowing`
      : "",
    meyer && meyer.id !== "0" ? meyer.short : "",
    cord && cord.id !== "0" ? cord.short : "",
  ].filter(Boolean);

  return {
    findings,
    impression: impBits.length ? `${lvl}: ${impBits.join("; ")}.` : "",
  };
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export type SpineGradingAtomicObs = {
  concept: string;
  laterality?: string;
  severity?: string;
  state?: string;
  measurement?: string;
  findings: string;
  impression: string;
  baselineReplaces?: string;
};

const BASELINE_PFIRRMANN = "Disc signal and height are preserved (no Pfirrmann degeneration described).";
const BASELINE_MODIC = "No Modic endplate changes.";
const BASELINE_MEYERDING = "No spondylolisthesis.";
const BASELINE_CORD_SIGNAL = "Cord signal is normal.";

/**
 * Atomic ledger rows for selected neuro-spine grades.
 * Callers wrap these into PendingPathologyPatch via their segment patchId helper.
 */
export function buildSpineGradingAtoms(
  level: string,
  g: SpineNeuroGradingSelection,
): SpineGradingAtomicObs[] {
  const lvl = (level || "").trim();
  const out: SpineGradingAtomicObs[] = [];

  const pf = PFIRRMANN_GRADES.find((o) => o.id === g.pfirrmann);
  if (pf) {
    out.push({
      concept: "pfirrmann",
      severity: pf.id,
      findings: `At ${lvl}, ${pf.findings} is noted.`,
      impression: `${lvl}: ${pf.short} disc degeneration.`,
      baselineReplaces: BASELINE_PFIRRMANN,
    });
  }

  const modic = MODIC_GRADES.find((o) => o.id === g.modicGrade);
  if (modic && modic.id !== "0" && modic.findings) {
    out.push({
      concept: "endplate",
      severity: modic.id,
      findings: `At ${lvl}, ${modic.findings} are present.`,
      impression: `${lvl}: ${modic.short}.`,
      baselineReplaces: BASELINE_MODIC,
    });
  }

  const meyer = MEYERDING_GRADES.find((o) => o.id === g.meyerding);
  if (meyer && meyer.id !== "0" && meyer.findings) {
    out.push({
      concept: "spondylolisthesis",
      severity: meyer.id,
      findings: `At ${lvl}, ${meyer.findings} is noted.`,
      impression: `${lvl}: ${meyer.short}.`,
      baselineReplaces: BASELINE_MEYERDING,
    });
  }

  const cord = CORD_SIGNAL_GRADES.find((o) => o.id === g.cordSignal);
  if (cord && cord.id !== "0") {
    out.push({
      concept: "cord_signal",
      severity: cord.id,
      state: cord.id === "2" ? "bright" : "faint",
      findings: `At ${lvl}, ${cord.findings}`,
      impression: `${lvl}: ${cord.short}.`,
      baselineReplaces: BASELINE_CORD_SIGNAL,
    });
  }

  return out;
}

/** Parse grade ids back from ledger findings / severity for chip rehydrate. */
export function parsePfirrmannFromText(findings: string, severity?: string): PfirrmannGradeId | null {
  const sev = (severity || "").toUpperCase();
  if (sev === "I" || sev === "II" || sev === "III" || sev === "IV" || sev === "V") {
    return sev as PfirrmannGradeId;
  }
  const m = findings.match(/pfirrmann\s*(?:grade\s*)?(I{1,3}|IV|V)\b/i);
  if (!m) return null;
  return m[1]!.toUpperCase() as PfirrmannGradeId;
}

export function parseMeyerdingFromText(findings: string, severity?: string): MeyerdingGradeId | null {
  const sev = (severity || "").toUpperCase();
  if (sev === "0" || sev === "I" || sev === "II" || sev === "III" || sev === "IV") {
    return sev as MeyerdingGradeId;
  }
  const m = findings.match(/meyerding\s*(?:grade\s*)?(I{1,3}|IV)\b/i);
  if (!m) return null;
  return m[1]!.toUpperCase() as MeyerdingGradeId;
}

export function parseCordSignalFromText(findings: string, severity?: string, state?: string): CordSignalGradeId | null {
  if (severity === "0" || severity === "1" || severity === "2") return severity as CordSignalGradeId;
  if (state === "bright" || /bright.*t2|t2.*bright|myelopath/i.test(findings)) return "2";
  if (state === "faint" || /faint.*t2|t2.*faint/i.test(findings)) return "1";
  if (/normal.*cord|cord.*normal/i.test(findings)) return "0";
  return null;
}

export function parseModicGradeFromText(findings: string, severity?: string): ModicGradeId | null {
  const sev = (severity || "").toUpperCase();
  if (sev === "0" || sev === "I" || sev === "II" || sev === "III") return sev as ModicGradeId;
  if (/type\s*3|modic\s*(?:type\s*)?III?\b/i.test(findings) && /III|type\s*3/i.test(findings)) {
    if (/type\s*3|modic\s*(?:type\s*)?III\b/i.test(findings)) return "III";
  }
  if (/type\s*3|modic 3|modic type 3/i.test(findings)) return "III";
  if (/type\s*2|modic 2|modic type 2|modic\s*(?:type\s*)?II\b/i.test(findings)) return "II";
  if (/type\s*1|modic 1|modic type 1|modic\s*(?:type\s*)?I\b/i.test(findings)) return "I";
  return null;
}
