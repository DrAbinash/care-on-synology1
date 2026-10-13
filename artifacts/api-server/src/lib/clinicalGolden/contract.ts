/**
 * Radiology golden reporting corpus — the contract.
 *
 * A case here is an EVALUATION ORACLE, not a fixture of prose: it states what a
 * radiologist supplied, what report text that supply justifies, and which
 * statements the same supply forbids. The tests in this directory then ask the
 * repository's own clinical engines (the report-quality rule engine and the
 * composer output validator) whether the real system catches each of the ten
 * defect classes when the same case is broken on purpose.
 *
 * Deliberate rules for anyone adding cases:
 *
 *  • Synthetic patients only. No name, no UHID, no accession, no dates.
 *  • `report` is the text the supplied observations justify — nothing more. If a
 *    sentence is not backed by an entry in `observations` or `measurements`, it
 *    does not belong in `report`, and it belongs in `prohibitedStatements`.
 *  • A required negative is a claim that something is normal, so it has to name
 *    the support for that claim (`supportedBy`). "No fracture" on a study that
 *    never assessed bone is an invented negative, which is the failure mode this
 *    field exists to make impossible.
 *  • Defects are DATA (a find/replace, a dropped measurement), never a function,
 *    so the corpus stays serialisable and can drive an AI evaluation run as
 *    easily as a unit test.
 */

export const EXAM_KEYS = [
  "mri-brain",
  "mri-cervical-spine",
  "mri-lumbar-spine",
  "mri-whole-spine-screening",
  "mrcp",
  "ct-brain-plain",
  "ct-abdomen-contrast",
  "usg-abdomen",
  "doppler-lower-limb-venous",
  "mammography-screening",
] as const;

export type ExamKey = (typeof EXAM_KEYS)[number];

/** Canonical modality codes as the report-quality engine expects them. */
export type ExamModality = "MR" | "CT" | "US" | "XR" | "MG";

export type ReportField = "technique" | "findings" | "impression" | "recommendation" | "clinicalHistory";

export type ReportText = {
  clinicalHistory: string;
  technique: string;
  findings: string;
  /** One entry per impression line, matching TextReportInput.impression. */
  impression: string[];
  recommendation: string;
};

/** What the radiologist actually put in, slot by slot. */
export type SuppliedObservation = {
  id: string;
  /** Snake-case concept key. Kept local to the corpus so a case cannot depend on
   *  a catalogue entry that may or may not exist in the checked-out tree. */
  concept: string;
  source: "quick-select" | "quick-findings" | "macro" | "manual" | "voice" | "structured";
  region?: string;
  level?: string;
  laterality?: "left" | "right" | "bilateral";
  severity?: string;
  measurement?: string;
  text: string;
};

export type SuppliedMeasurement = {
  key: string;
  label: string;
  value: number;
  unit: string;
  low?: number;
  high?: number;
};

/** A clinical concept that MUST appear in the report, with every wording the
 *  report could legitimately use for it. Matching is on these aliases, so the
 *  assertion is about the clinical content, not the sentence. */
export type ExpectedConcept = {
  concept: string;
  aliases: string[];
  /** Where the concept must appear. "impression" is the usual strictness lever:
   *  a finding that never reaches the Impression is a reporting failure even
   *  when the Findings section is perfect. */
  in?: ReportField;
};

/** A negative the report states, plus the supply that entitles it to. */
export type RequiredNegative = ExpectedConcept & {
  supportedBy: string[];
};

/** A statement the supplied observations do NOT support. */
export type ProhibitedStatement = {
  /** Stable name for the report, e.g. "gadolinium-enhancement". */
  id: string;
  aliases: string[];
  /** Why this is forbidden for THIS case — the clinical harm, in one line. */
  reason: string;
};

export type LateralityExpectation = "left" | "right" | "bilateral" | "none";

export type AnatomicalConstraints = {
  /** Regions the report may legitimately speak about. */
  regions: string[];
  /** Vertbral/slide levels supplied by the radiologist. Anything outside this
   *  list is a level the report invented. */
  levels: string[];
  laterality: LateralityExpectation[];
};

export const DEFECT_CLASSES = [
  "laterality",
  "level",
  "measurement",
  "findingsImpressionContradiction",
  "duplicateConclusion",
  "unsupportedContrast",
  "unsupportedScreeningClaim",
  "anatomicalMismatch",
  "inventedDiagnosis",
  "unsupportedNormalFinding",
] as const;

export type DefectClass = (typeof DEFECT_CLASSES)[number];

/**
 * What the real engines must produce for a defect to count as caught.
 *
 * Every array here is an ALTERNATIVE — a defect is caught when any one of the
 * listed signals fires. That is deliberate: the text tier and the composer
 * validator are two different production gates, and a defect that only one of
 * them can see is still a defect the clinic can be protected from. An empty
 * `expect` is a bug in the corpus, not a "no detection expected" marker — use
 * `undetected` for that, and it will be counted and reported.
 */
export type DefectExpectation = {
  ruleIds?: string[];
  composerErrors?: string[];
  composerWarnings?: string[];
  /** Laterality/level/severity vectors from the composer validator. */
  composerVectors?: ("lateralitySwaps" | "levelChanges" | "severityEscalations" | "unsupportedMentions")[];
  /** Stated when the corpus deliberately names no gate — see registers.ts. */
  noIntendedGate?: boolean;
};

export type DefectMutation = {
  id: string;
  class: DefectClass;
  /** The clinical harm, in one line. Shown in the test name so a failure reads
   *  as a patient-safety statement rather than as a diff. */
  harm: string;
  edit?: { field: ReportField; find: string; replace: string };
  append?: { field: ReportField; text: string };
  dropMeasurement?: string;
  changeMeasurement?: { key: string; value?: number; unit?: string };
  expect: DefectExpectation;
};

export type GoldenCase = {
  key: string;
  exam: ExamKey;
  polarity: "normal" | "abnormal";
  /** One line for the human reading the report. */
  summary: string;
  study: {
    modality: ExamModality;
    studyDescription: string;
    bodyPart?: string;
    regions: string[];
    protocol?: string;
    reportTitle?: string;
    sex: "M" | "F";
    age: string;
    contrast: "plain" | "contrast" | "not-applicable";
  };
  indication: string;
  observations: SuppliedObservation[];
  measurements: SuppliedMeasurement[];
  report: ReportText;
  expect: {
    concepts: ExpectedConcept[];
    requiredNegatives: RequiredNegative[];
    prohibitedStatements: ProhibitedStatement[];
    impressionConcepts: ExpectedConcept[];
    anatomy: AnatomicalConstraints;
  };
  defects: DefectMutation[];
};

/** Every section of the report as one blob, for containment checks. */
export function reportBlob(report: ReportText): string {
  return [report.clinicalHistory, report.technique, report.findings, report.impression.join("\n"), report.recommendation]
    .filter(Boolean)
    .join("\n");
}

export function containsAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

/**
 * The levels a report actually names. Deliberately loose about spelling — C5,
 * C5-C6 and "L4-L5" all count — but it must NOT read an MR sequence as a level:
 * "intrinsic T2 hyperintensity" is a signal description, and treating it as
 * vertebra T2 would invent a level the radiologist never reported.
 */
const LEVEL_RE = /\b([CLTD])\s*(\d{1,2})\b|\b([CLTD])(\d{1,2})\s*[-–]\s*([CLTD])(\d{1,2})\b/gi;
const NOT_A_LEVEL = /^(w|wi|weighted|hyperintensity|hypointensity|isointense|flair|stir|image|images|sequence|sequences|signal)\b/i;

export function levelsMentioned(text: string): string[] {
  const out = new Set<string>();
  const add = (v: string) => out.add(v);
  for (const m of text.matchAll(LEVEL_RE)) {
    const trailing = text.slice((m.index ?? 0) + m[0].length).match(/^\s*[-–]?\s*(\S+)/)?.[1] ?? "";
    if (NOT_A_LEVEL.test(trailing)) continue;
    if (m[1] && m[2]) add(`${m[1].toUpperCase()}${m[2]}`);
    if (m[3] && m[4] && m[5] && m[6]) {
      add(`${m[3].toUpperCase()}${m[4]}`);
      add(`${m[5].toUpperCase()}${m[6]}`);
    }
  }
  return [...out];
}

export function lateralityMentioned(text: string): LateralityExpectation[] {
  const t = text.toLowerCase();
  const out: LateralityExpectation[] = [];
  if (/\bbilateral\b|\bboth\b/.test(t)) out.push("bilateral");
  if (/\bleft\b/.test(t)) out.push("left");
  if (/\bright\b/.test(t)) out.push("right");
  if (out.length === 0) out.push("none");
  return out;
}

/**
 * Structural self-checks, run as a test over the corpus itself.
 *
 * These exist because a golden corpus rots silently: a case whose prohibited
 * phrase already appears in its own `report` proves nothing, and a required
 * negative with no `supportedBy` is exactly the invented negative the corpus is
 * supposed to catch in the product.
 */
export function auditCaseShape(c: GoldenCase): string[] {
  const problems: string[] = [];
  const blob = reportBlob(c.report);

  if (!c.observations.length && !c.measurements.length) {
    problems.push("no supplied observations or measurements — nothing grounds the report");
  }

  for (const neg of c.expect.requiredNegatives) {
    if (!neg.supportedBy.length) problems.push(`required negative "${neg.concept}" has no supportedBy`);
    if (!containsAny(blob, neg.aliases)) problems.push(`required negative "${neg.concept}" is not actually in the report`);
  }

  for (const pro of c.expect.prohibitedStatements) {
    if (containsAny(blob, pro.aliases)) problems.push(`prohibited statement "${pro.id}" is present in the report it forbids`);
    if (!pro.reason.trim()) problems.push(`prohibited statement "${pro.id}" has no reason`);
  }

  for (const con of [...c.expect.concepts, ...c.expect.impressionConcepts]) {
    if (!con.aliases.length) problems.push(`expected concept "${con.concept}" has no aliases`);
  }

  for (const d of c.defects) {
    if (d.edit) {
      const fieldText = d.edit.field === "impression" ? c.report.impression.join("\n") : c.report[d.edit.field] ?? "";
      if (!fieldText.includes(d.edit.find)) problems.push(`defect "${d.id}" edits text that is not in ${d.edit.field}`);
    }
    if (d.dropMeasurement && !c.measurements.some((m) => m.key === d.dropMeasurement)) {
      problems.push(`defect "${d.id}" drops measurement "${d.dropMeasurement}" which the case never supplied`);
    }
    if (d.changeMeasurement && !c.measurements.some((m) => m.key === d.changeMeasurement!.key)) {
      problems.push(`defect "${d.id}" changes measurement "${d.changeMeasurement.key}" which the case never supplied`);
    }
    // An empty `expect` means the corpus names no gate that should catch this
    // defect. That is legal and meaningful — the register in registers.ts records
    // it as an measured gap — so it is not reported as a shape problem here.
  }

  const suppliedLevels = new Set(c.observations.map((o) => o.level).filter(Boolean) as string[]);
  for (const lv of levelsMentioned(c.report.findings + "\n" + c.report.impression.join("\n"))) {
    if (!suppliedLevels.has(lv) && !c.expect.anatomy.levels.includes(lv)) {
      problems.push(`report names level ${lv}, which nothing in the case supplied`);
    }
  }
  return problems;
}
