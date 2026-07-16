// rules/structured/executors.ts — the seven generic, reusable structured-tier
// executors (Phase 3). Each is deterministic over typed context data; none read
// free text. Parameterized by a RuleDefinition.params drawn from real protocol/
// pack/threshold data. All findings are advisory in shadow (blockingEligibility
// is false on every Phase-3 definition; the finalize gate is Phase 5).

import type {
  FindingInstance,
  NormalizedMeasurement,
  QualityContext,
  Severity,
} from "../../contract";
import type { Executor, ExecutorFinding, RuleDefinition } from "../../executor";

// ── param shapes ──
interface RangeSpec {
  key: string;
  low?: number;
  high?: number;
  unit?: string;
  classify?: { below?: string; withinLabel?: string; above?: string };
  severity?: Severity;
}
interface NumericRangeParams { ranges: RangeSpec[]; skipWhenNoRange?: boolean }
interface UnitValidationParams { expectedUnits?: Record<string, string>; nullableWhenClassification?: boolean; mmCmHazardKeys?: string[] }
interface RequiredMeasurementParams { requiredMeasurements?: string[]; matchBy?: "label" | "key"; caseInsensitive?: boolean }
interface StudyModalityParams { ignoreSentinel?: string; severity?: Severity }
interface ExclusiveParams { mode: "conflictGroup" | "enumField"; groupBy?: string[]; maxSelected?: number; key?: string; abnormalValues?: string[]; allowed?: string[] }
interface LateralityParams { mode: "finding" | "pair"; field?: string; allowed?: string[]; appliesWhen?: { property: string }; pairs?: [string, string][] }
interface RequiredSectionParams { requiredSections?: string[]; coverageFrom?: "findingInstances"; excludeNotApplicable?: boolean }

const norm = (s: string): string => s.trim().toLowerCase();

function matchMeasurement(measurements: NormalizedMeasurement[], key: string): NormalizedMeasurement | undefined {
  const k = norm(key);
  return measurements.find((m) => norm(m.key) === k || norm(m.label) === k);
}

// 2a. numeric-range — reads `measurements`
export const numericRange: Executor = (def, ctx) => {
  const p = (def.params as unknown) as NumericRangeParams;
  const measurements = ctx.measurements ?? [];
  const skipWhenNoRange = p.skipWhenNoRange !== false;
  const out: ExecutorFinding[] = [];
  for (const range of p.ranges ?? []) {
    const m = matchMeasurement(measurements, range.key);
    if (!m || Number.isNaN(m.value)) continue;
    const hasLow = typeof range.low === "number";
    const hasHigh = typeof range.high === "number";
    if (!hasLow && !hasHigh) {
      if (skipWhenNoRange) continue;
    }
    const unit = range.unit ?? m.unit ?? "";
    if (hasLow && m.value < (range.low as number)) {
      out.push({
        message: `${m.label} ${m.value}${unit} is below the expected range (≥ ${range.low}${unit}).`,
        evidence: `${m.value}${unit}`,
        suggestedFix: range.classify?.below ? `Consider: ${range.classify.below}.` : "Verify the measurement and interpret the low value.",
        targetRef: m.targetRef,
        severity: range.severity,
      });
    } else if (hasHigh && m.value > (range.high as number)) {
      out.push({
        message: `${m.label} ${m.value}${unit} is above the expected range (≤ ${range.high}${unit}).`,
        evidence: `${m.value}${unit}`,
        suggestedFix: range.classify?.above ? `Consider: ${range.classify.above}.` : "Verify the measurement and interpret the high value.",
        targetRef: m.targetRef,
        severity: range.severity,
      });
    }
  }
  return out;
};

// 2b. unit-validation — reads `measurements` (+ protocolRequiredMeasurements.expectedUnits)
export const unitValidation: Executor = (def, ctx) => {
  const p = (def.params as unknown) as UnitValidationParams;
  const measurements = ctx.measurements ?? [];
  const expected: Record<string, string> = { ...(ctx.protocolRequiredMeasurements?.expectedUnits ?? {}), ...(p.expectedUnits ?? {}) };
  const hazard = new Set((p.mmCmHazardKeys ?? []).map(norm));
  const out: ExecutorFinding[] = [];
  for (const m of measurements) {
    const key = Object.keys(expected).find((k) => norm(k) === norm(m.key) || norm(k) === norm(m.label));
    if (key === undefined) continue; // no expected unit → free measurement, skip
    const exp = expected[key];
    const actual = (m.unit ?? "").trim();
    const isCategorical = m.classification !== undefined && m.classification !== "";
    if ((actual === "") && (exp === "" || (p.nullableWhenClassification && isCategorical))) continue;
    if (norm(actual) === norm(exp)) continue;
    const isHazard = hazard.has(norm(m.key)) || hazard.has(norm(m.label));
    out.push({
      message: isHazard
        ? `${m.label} unit "${actual || "—"}" differs from expected "${exp}" — mm/cm normalization hazard.`
        : `${m.label} unit "${actual || "—"}" does not match expected unit "${exp || "(none)"}".`,
      evidence: `${m.value}${actual}`,
      suggestedFix: `Record ${m.label} in ${exp || "the expected unit"}.`,
      targetRef: m.targetRef,
    });
  }
  return out;
};

// 2c. required-measurement — reads `protocolRequiredMeasurements` + `measurements`
export const requiredMeasurement: Executor = (def, ctx) => {
  const p = (def.params as unknown) as RequiredMeasurementParams;
  const required = p.requiredMeasurements ?? ctx.protocolRequiredMeasurements?.requiredMeasurements ?? [];
  const measurements = ctx.measurements ?? [];
  const out: ExecutorFinding[] = [];
  for (const req of required) {
    if (!matchMeasurement(measurements, req)) {
      out.push({
        message: `Required measurement "${req}" is missing.`,
        suggestedFix: `Record the ${req} measurement.`,
        targetRef: req,
      });
    }
  }
  return out;
};

// 2d. study-modality-consistency — reads `study`
export const studyModalityConsistency: Executor = (def, ctx) => {
  const s = ctx.study;
  if (!s) return [];
  if (s.authoritativeIsSentinel) return []; // unknown authoritative modality, not a mismatch
  if (s.declaredModalityRaw == null) return []; // manual draft, nothing declared to contradict
  if (s.authoritativeModality === s.declaredModality) return [];
  return [{
    message: `Study modality mismatch: report is authored as ${s.declaredModalityRaw} but the study is ${s.authoritativeModalityRaw} (${s.authoritativeSource}).`,
    evidence: `declared=${s.declaredModalityRaw} authoritative=${s.authoritativeModalityRaw}`,
    suggestedFix: `Confirm the correct modality/study before finalizing.`,
    targetRef: s.studyName ?? undefined,
  }];
};

// 2e. mutually-exclusive-state — reads `findingInstances` (conflictGroup) or `measurements` (enumField)
export const mutuallyExclusiveState: Executor = (def, ctx) => {
  const p = (def.params as unknown) as ExclusiveParams;
  const out: ExecutorFinding[] = [];
  if (p.mode === "conflictGroup") {
    const instances = ctx.findingInstances ?? [];
    const maxSelected = p.maxSelected ?? 1;
    const groups = new Map<string, FindingInstance[]>();
    for (const f of instances) {
      if (!f.conflictGroup) continue;
      const gkey = `${f.studyType}::${f.conflictGroup}`;
      const arr = groups.get(gkey) ?? [];
      arr.push(f);
      groups.set(gkey, arr);
    }
    for (const [gkey, members] of groups) {
      if (members.length > maxSelected) {
        out.push({
          message: `Mutually-exclusive findings selected together: ${members.map((m) => m.label).join(", ")}.`,
          evidence: gkey,
          suggestedFix: `Keep only one of the ${gkey.split("::")[1]} options.`,
          targetRef: members[0].targetRef,
        });
      }
    }
    return out;
  }
  // enumField
  const measurements = ctx.measurements ?? [];
  const key = p.key ?? "";
  const m = matchMeasurement(measurements, key);
  if (!m) return [];
  const state = (m.classification ?? "").trim();
  if (!state) return [];
  const abnormal = (p.abnormalValues ?? []).map(norm);
  const allowed = p.allowed?.map(norm);
  if (abnormal.length && abnormal.includes(norm(state))) {
    out.push({ message: `${m.label} is "${state}".`, evidence: state, targetRef: m.targetRef, suggestedFix: `Confirm the ${m.label} state.` });
  } else if (allowed && !allowed.includes(norm(state))) {
    out.push({ message: `${m.label} has an unexpected state "${state}".`, evidence: state, targetRef: m.targetRef, suggestedFix: `Expected one of: ${(p.allowed ?? []).join(", ")}.` });
  }
  return out;
};

// 2f. required-laterality — reads `findingInstances` (finding) or `measurements` (pair)
export const requiredLaterality: Executor = (def, ctx) => {
  const p = (def.params as unknown) as LateralityParams;
  const out: ExecutorFinding[] = [];
  if (p.mode === "finding") {
    const instances = ctx.findingInstances ?? [];
    const allowed = (p.allowed ?? ["left", "right", "bilateral"]).map(norm);
    const gateProp = p.appliesWhen?.property;
    for (const f of instances) {
      if (gateProp && !f.properties.includes(gateProp)) continue;
      const side = norm(f.side);
      if (!side || !allowed.includes(side)) {
        out.push({
          message: `Finding "${f.label}" is missing a valid laterality (side="${f.side || "—"}").`,
          evidence: f.label,
          suggestedFix: `Set the side (left/right/bilateral) for ${f.label}.`,
          targetRef: f.targetRef,
        });
      }
    }
    return out;
  }
  // pair
  const measurements = ctx.measurements ?? [];
  for (const [right, left] of p.pairs ?? []) {
    const hasRight = !!matchMeasurement(measurements, right);
    const hasLeft = !!matchMeasurement(measurements, left);
    if (hasRight !== hasLeft) {
      const present = hasRight ? right : left;
      const missing = hasRight ? left : right;
      out.push({
        message: `Paired measurement recorded on one side only: "${present}" present, "${missing}" missing.`,
        evidence: `${present} present`,
        suggestedFix: `Record the contralateral measurement (${missing}).`,
        targetRef: missing,
      });
    }
  }
  return out;
};

// 2g. required-section — reads `template` (+ findingInstances, + knowledgePack)
export const requiredSection: Executor = (def, ctx) => {
  const p = (def.params as unknown) as RequiredSectionParams;
  const required = p.requiredSections
    ?? (ctx.template?.sections ?? []).filter((s) => s.required).map((s) => s.name);
  let requiredSet = required;
  if (p.excludeNotApplicable && ctx.knowledgePack) {
    const na = new Set(ctx.knowledgePack.notApplicableSections.map(norm));
    requiredSet = required.filter((s) => !na.has(norm(s)));
  }
  const covered = new Set((ctx.findingInstances ?? []).map((f) => norm(f.anatomicalSection)).filter(Boolean));
  const out: ExecutorFinding[] = [];
  for (const section of requiredSet) {
    if (!covered.has(norm(section))) {
      out.push({
        message: `Required section "${section}" is not covered by any structured finding.`,
        evidence: section,
        suggestedFix: `Document findings for ${section}.`,
        targetRef: section,
      });
    }
  }
  return out;
};

/** Register all seven executors on a registry under stable names. */
export const STRUCTURED_EXECUTORS: Record<string, Executor> = {
  "structured.numeric-range": numericRange,
  "structured.unit-validation": unitValidation,
  "structured.required-measurement": requiredMeasurement,
  "structured.study-modality-consistency": studyModalityConsistency,
  "structured.mutually-exclusive-state": mutuallyExclusiveState,
  "structured.required-laterality": requiredLaterality,
  "structured.required-section": requiredSection,
};

// Re-export the definition type for the rule configs module.
export type { RuleDefinition };
