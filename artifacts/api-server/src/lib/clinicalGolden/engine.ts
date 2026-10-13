/**
 * Engine glue for the golden corpus.
 *
 * Nothing here decides what is clinically correct. It only carries a case into
 * the two gates the clinic already runs — the report-quality rule engine
 * (@workspace/report-quality) and the composer output validator — and reports
 * which signals came back. When a defect is missed, the miss belongs to those
 * engines, not to this file.
 *
 * Three quality engines are consulted rather than one because they gate at
 * different moments in CARE: the default engine is the live badge and the
 * finalize advisory, while the structured and measurement engines are the
 * scoped (SHADOW) rule sets that own unit, range and laterality facts. A defect
 * that only the measurement engine sees is still a defect CARE can catch.
 */
import {
  createMeasurementEngine,
  createStructuredEngine,
  runQualityEngine,
  type QualityContext,
  type QualityFinding,
} from "@workspace/report-quality";
import { validateComposerOutput } from "../reportComposer/validateOutput";
import {
  parseComposerSnapshot,
  type ComposerDraftOutput,
  type ComposerInputSnapshot,
} from "../reportComposer/types";
import type { GoldenCase, ReportField, ReportText } from "./contract";
import { containsAny } from "./contract";

const FIELD_KEYS: ReportField[] = ["clinicalHistory", "technique", "findings", "impression", "recommendation"];

/** Apply one defect to a clean report. Data in, data out — no case is mutated. */
export function applyDefect(report: ReportText, defect: GoldenCase["defects"][number]): ReportText {
  const next: ReportText = { ...report, impression: [...report.impression] };
  if (defect.edit) {
    const { field, find, replace } = defect.edit;
    if (field === "impression") {
      next.impression = next.impression.map((line) => line.split(find).join(replace));
    } else if (field === "clinicalHistory" || field === "technique" || field === "findings" || field === "recommendation") {
      next[field] = next[field].split(find).join(replace);
    }
  }
  if (defect.append) {
    const { field, text } = defect.append;
    if (field === "impression") next.impression = [...next.impression, text];
    else next[field] = `${next[field]} ${text}`.trim();
  }
  return next;
}

/** The measurement keys the protocol asked for, as the report must show them. */
function missingRequiredMeasurements(c: GoldenCase, report: ReportText): string[] {
  const blob = [report.findings, report.impression.join("\n")].join("\n").toLowerCase();
  return c.measurements
    .filter((m) => !blob.includes(String(m.value)))
    .map((m) => m.label);
}

function qualityContext(c: GoldenCase, report: ReportText): QualityContext {
  const modality = c.study.modality;
  return {
    modality,
    studyDescription: c.study.studyDescription,
    text: {
      findings: report.findings,
      impression: report.impression,
      recommendation: report.recommendation,
      technique: report.technique,
      clinicalHistory: report.clinicalHistory,
      sex: c.study.sex,
      age: c.study.age,
      modality,
      studyDescription: c.study.studyDescription,
      missingRequiredMeasurements: missingRequiredMeasurements(c, report),
    },
    measurements: c.measurements.map((m) => ({ ...m })),
    study: {
      authoritativeSource: "worklist",
      authoritativeModality: modality,
      authoritativeModalityRaw: modality,
      authoritativeIsSentinel: false,
      declaredModality: modality,
      declaredModalityRaw: modality,
      studyName: c.study.studyDescription,
      studyDescription: c.study.studyDescription,
    },
  };
}

function composerSnapshot(c: GoldenCase): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: c.study.modality,
    region: c.study.regions[0],
    regions: c.study.regions,
    bodyPart: c.study.bodyPart,
    protocol: c.study.protocol,
    reportTitle: c.study.reportTitle,
    studyType: c.study.studyDescription,
    clinicalHistory: c.indication,
    technique: c.report.technique,
    findings: c.report.findings,
    impression: c.report.impression.join("\n"),
    recommendation: c.report.recommendation,
    observations: c.observations.map((o) => ({
      id: o.id,
      concept: o.concept,
      source: o.source,
      region: o.region ?? null,
      level: o.level ?? null,
      severity: o.severity ?? null,
      laterality: o.laterality ?? null,
      measurement: o.measurement ?? null,
      findingsText: o.text,
    })),
  });
}

export type EngineSignals = {
  /** Rule ids raised by the three quality engines, deduped and sorted. */
  ruleIds: string[];
  /** Rule ids raised at severity "blocker" — these are what can stop a signature. */
  blockerRuleIds: string[];
  score: number;
  /** Rules the engine admitted it could not evaluate (missing structured data). */
  notEvaluated: string[];
  evaluatedRuleCount: number;
  composer: {
    ok: boolean;
    errors: string[];
    warnings: string[];
    lateralitySwaps: string[];
    levelChanges: string[];
    severityEscalations: string[];
    unsupportedMentions: string[];
  };
};

function ids(findings: QualityFinding[]): string[] {
  return [...new Set(findings.map((f) => f.ruleId))].sort();
}

/**
 * Run every gate over one rendered report.
 *
 * `against` is the clean case: the composer validator needs the truth it is
 * checking the draft against, and in production that truth is the
 * radiologist's own supplied text, exactly as this corpus states it.
 */
export function signalsFor(c: GoldenCase, report: ReportText): EngineSignals {
  const ctx = qualityContext(c, report);
  const defaultRun = runQualityEngine(ctx, { evaluatedAtIso: "2026-01-01T00:00:00.000Z", now: () => 0 });
  const structuredRun = createStructuredEngine().evaluate(ctx);
  const measurementRun = createMeasurementEngine().evaluate(ctx);

  const all = [...defaultRun.findings, ...structuredRun.findings, ...measurementRun.findings];
  const snapshot = composerSnapshot(c);
  const draft: ComposerDraftOutput = {
    findings: report.findings,
    impression: report.impression.join("\n"),
    recommendation: report.recommendation,
    unresolvedQuestions: [],
    warnings: [],
  };
  const result = validateComposerOutput(snapshot, draft, { kind: "FULL_REPORT" });

  return {
    ruleIds: [...new Set([...ids(defaultRun.findings), ...ids(structuredRun.findings), ...ids(measurementRun.findings)])].sort(),
    blockerRuleIds: [...new Set(all.filter((f) => f.severity === "blocker").map((f) => f.ruleId))].sort(),
    score: defaultRun.score,
    notEvaluated: [...new Set([...defaultRun.notEvaluated, ...structuredRun.notEvaluated, ...measurementRun.notEvaluated])].sort(),
    evaluatedRuleCount: defaultRun.evaluatedRuleCount + structuredRun.evaluatedRuleCount + measurementRun.evaluatedRuleCount,
    composer: {
      ok: result.ok,
      errors: [...result.errors].sort(),
      warnings: [...result.warnings].sort(),
      lateralitySwaps: [...result.lateralitySwaps].sort(),
      levelChanges: [...result.levelChanges].sort(),
      severityEscalations: [...result.severityEscalations].sort(),
      unsupportedMentions: [...result.unsupportedMentions].sort(),
    },
  };
}

/** Does the rendered report still say what the case requires it to say? */
export function unmetExpectations(c: GoldenCase, report: ReportText): string[] {
  const problems: string[] = [];
  const fieldText = (f: ReportField) =>
    f === "impression" ? report.impression.join("\n") : (report[f] ?? "");
  const blob = FIELD_KEYS.map(fieldText).join("\n");

  for (const con of c.expect.concepts) {
    const where = con.in ? fieldText(con.in) : blob;
    if (!containsAny(where, con.aliases)) problems.push(`missing concept "${con.concept}"${con.in ? ` in ${con.in}` : ""}`);
  }
  for (const con of c.expect.impressionConcepts) {
    if (!containsAny(report.impression.join("\n"), con.aliases)) problems.push(`impression is missing "${con.concept}"`);
  }
  for (const pro of c.expect.prohibitedStatements) {
    if (containsAny(blob, pro.aliases)) problems.push(`prohibited statement "${pro.id}" is present`);
  }
  return problems;
}

/** Whether the defect's own text edit survived — a mutated string that is not in
 *  the rendered report means the mutation silently no-opped, which would otherwise
 *  read as "the engine missed nothing". */
export function defectApplied(c: GoldenCase, report: ReportText, defect: GoldenCase["defects"][number]): boolean {
  if (defect.edit) {
    const fieldText = defect.edit.field === "impression" ? report.impression.join("\n") : report[defect.edit.field] ?? "";
    if (!fieldText.includes(defect.edit.replace)) return false;
  }
  if (defect.append) {
    const fieldText = defect.append.field === "impression" ? report.impression.join("\n") : report[defect.append.field] ?? "";
    if (!fieldText.includes(defect.append.text)) return false;
  }
  if (defect.dropMeasurement && containsAny(report.findings + report.impression.join(""), [String(
    c.measurements.find((m) => m.key === defect.dropMeasurement)?.value ?? -1,
  )])) {
    // The value the defect removed is still in the text, so the removal had no effect.
    return false;
  }
  return true;
}

/** Signals present in one run and absent from another — the honest denominator.
 *
 * Detection is measured as a DELTA because several gates already fire on the
 * correct report (Q113 on a negated "lesion", the laterality advisory on a
 * contralateral symptom). Asking whether a rule fired at all would credit those
 * with catching a defect they never saw.
 */
export function signalDelta(clean: EngineSignals, mutated: EngineSignals): string[] {
  return allSignals(mutated).filter((s) => !allSignals(clean).includes(s));
}

/** A defect is caught when breaking it makes at least one gate say something new. */
export function detectionFor(signals: EngineSignals, expect: GoldenCase["defects"][number]["expect"]): string[] {
  const hits: string[] = [];
  for (const r of expect.ruleIds ?? []) if (signals.ruleIds.includes(r)) hits.push(`rule:${r}`);
  for (const e of expect.composerErrors ?? []) if (signals.composer.errors.includes(e)) hits.push(`error:${e}`);
  for (const w of expect.composerWarnings ?? []) if (signals.composer.warnings.includes(w)) hits.push(`warn:${w}`);
  for (const v of expect.composerVectors ?? []) {
    if (signals.composer[v].length) hits.push(`vector:${v}`);
  }
  return hits;
}

/** Everything a run flagged, for the report table. */
export function allSignals(signals: EngineSignals): string[] {
  return [
    ...signals.ruleIds.map((r) => `rule:${r}`),
    ...signals.composer.errors.map((r) => `error:${r}`),
    ...signals.composer.warnings.map((r) => `warn:${r}`),
  ];
}
