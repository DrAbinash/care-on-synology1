// rules/measurements/executors.ts — the Phase-4 executor: range evaluation
// driven ENTIRELY by the Universal Measurement Registry.
//
// Phase 4 contract: measurement.id → measurement.value → registry range →
// severity → recommendation. No rule here depends on display labels — context
// measurements are resolved to canonical ids first (aliases, columns, and all
// legacy spellings resolve via @workspace/measurements), and thresholds/units/
// precision are INHERITED from the registry definition, never duplicated into
// rule params (contrast with the Phase-3 structured tier, whose params carry
// hardcoded ranges — those stay as-is per shadow-tier discipline and now have
// a registry-backed successor).

import type { Executor, ExecutorFinding, RuleDefinition } from "../../executor";
import type { QualityContext } from "../../contract";
import {
  DEFAULT_MEASUREMENT_REGISTRY,
  classifyMeasurementValue,
  formatMeasurementValue,
  convertUnitValue,
  canonicalUnit,
  type MeasurementDefinition,
} from "@workspace/measurements";

/** Resolve a context measurement (by key, then label) to a registry definition. */
export function resolveContextMeasurement(m: { key: string; label: string }): MeasurementDefinition | undefined {
  return (
    DEFAULT_MEASUREMENT_REGISTRY.resolve(m.key)?.definition ??
    DEFAULT_MEASUREMENT_REGISTRY.resolveByColumn(m.key) ??
    DEFAULT_MEASUREMENT_REGISTRY.resolve(m.label)?.definition
  );
}

/**
 * `measurement.registry-range` — params: { measurementId: string }.
 * Fires when a context measurement resolves to that canonical id and its value
 * falls outside the registry's normal range (warning) or into the critical
 * range (severity escalated to "blocker" via the finding override).
 */
const registryRange: Executor = (def: RuleDefinition, ctx: QualityContext): ExecutorFinding[] => {
  const measurementId = String(def.params["measurementId"] ?? "");
  const definition = DEFAULT_MEASUREMENT_REGISTRY.get(measurementId);
  if (!definition || !ctx.measurements) return [];

  const findings: ExecutorFinding[] = [];
  for (const m of ctx.measurements) {
    const resolved = resolveContextMeasurement(m);
    if (!resolved || resolved.id !== definition.id) continue;
    if (!Number.isFinite(m.value)) continue;

    const verdict = classifyMeasurementValue(definition, m.value, m.unit);
    if (verdict.status !== "abnormal" && verdict.status !== "critical") continue;

    const inDefault =
      m.unit && canonicalUnit(m.unit) !== canonicalUnit(definition.defaultUnit)
        ? convertUnitValue(m.value, m.unit, definition.defaultUnit)
        : m.value;
    const shown = inDefault !== null ? formatMeasurementValue(definition, inDefault) : `${m.value} ${m.unit ?? ""}`.trim();
    const range = verdict.status === "critical" ? definition.criticalRange : definition.normalRange;
    const bounds = [
      range?.low !== undefined ? `low ${range.low}` : null,
      range?.high !== undefined ? `high ${range.high}` : null,
    ].filter(Boolean).join(", ");

    findings.push({
      message: `${definition.displayName} is ${shown} — ${verdict.status === "critical" ? "CRITICAL" : "outside the normal range"} (${bounds} ${definition.defaultUnit}).`,
      evidence: `${m.label || m.key} = ${m.value} ${m.unit ?? definition.defaultUnit} → ${definition.id}`,
      rationale: verdict.detail ?? range?.note,
      suggestedFix: verdict.status === "critical"
        ? `Verify the value and address the critical-range protocol for ${definition.displayName}.`
        : `Confirm the measurement and reflect it in the impression if clinically significant.`,
      targetRef: m.targetRef,
      severity: verdict.status === "critical" ? "blocker" : undefined,
    });
  }
  return findings;
};

export const MEASUREMENT_EXECUTORS: Record<string, Executor> = {
  "measurement.registry-range": registryRange,
};
