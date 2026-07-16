// rules/measurements/index.ts — Quality Engine Phase 4: registry-driven
// measurement rules.
//
// SHADOW MODE (same discipline as the Phase-3 structured tier): compiled into
// a SEPARATE engine instance, never registered on the default global engine,
// blockingEligibility false on every definition.
//
// There is exactly ONE executor and ZERO hardcoded thresholds here: every
// RuleDefinition is GENERATED from the Universal Measurement Registry
// (@workspace/measurements), one rule per measurement that declares a normal
// or critical range. Adding a measurement (or range) to the registry
// automatically adds its Phase-4 rule — no rule authoring required, and no
// rule can ever disagree with the registry it consumes.

import { createExecutorRegistry, compileRule } from "../../executor";
import type { RuleDefinition } from "../../executor";
import type { QualityRule } from "../../contract";
import { createQualityEngine } from "../../engine";
import type { RuleProvider, QualityEngine } from "../../engine";
import { MEASUREMENT_EXECUTORS } from "./executors";
import {
  MEASUREMENT_CATALOG,
  MEASUREMENT_CATALOG_VERSION,
  type MeasurementDefinition,
} from "@workspace/measurements";

export const MEASUREMENT_RULE_SET_VERSION = "4.0.0";

/** Canonical rule id for a measurement's Phase-4 range rule. */
export function measurementRangeRuleId(measurementId: string): string {
  return `care.measurement.range.${measurementId.toLowerCase().replace(/_/g, "-")}`;
}

function toRuleDefinition(def: MeasurementDefinition): RuleDefinition {
  const id = measurementRangeRuleId(def.id);
  return {
    id,
    canonicalId: id,
    category: "measurement",
    tier: "structured",
    // Baseline severity for out-of-normal-range; the executor escalates
    // critical-range findings to "blocker" per finding.
    severity: "warning",
    modalities: [...def.modalities],
    owner: "care-core",
    pack: null,
    version: `${MEASUREMENT_RULE_SET_VERSION}+registry.${MEASUREMENT_CATALOG_VERSION}.${def.version}`,
    executor: "measurement.registry-range",
    // The ONLY parameter is the canonical id — thresholds/units/precision are
    // read from the registry at evaluate time, never copied here.
    params: { measurementId: def.id },
    requires: ["measurements"],
    blockingEligibility: false, // SHADOW — Phase 4 never blocks
    provenance: {
      source: `@workspace/measurements catalog ${def.id} (${def.canonicalKey})`,
      ref: "lib/measurements/src/catalog.ts",
    },
  };
}

/** One generated definition per registry measurement that declares a range. */
export const MEASUREMENT_RULE_DEFINITIONS: RuleDefinition[] = MEASUREMENT_CATALOG
  .filter((d) => !d.deprecated && (d.normalRange || d.criticalRange))
  .map(toRuleDefinition);

const executorRegistry = createExecutorRegistry();
for (const [name, exec] of Object.entries(MEASUREMENT_EXECUTORS)) executorRegistry.register(name, exec);

export const measurementRules: QualityRule[] = MEASUREMENT_RULE_DEFINITIONS.map((d) => compileRule(d, executorRegistry));

/** The Phase-4 registry-driven rule bundle. NOT registered on the global engine. */
export const measurementRegistryProvider: RuleProvider = {
  name: "care-core:measurement-registry-v4",
  rules: measurementRules,
};

/** A scoped engine containing ONLY the Phase-4 measurement rules. */
export function createMeasurementEngine(): QualityEngine {
  return createQualityEngine({ providers: [measurementRegistryProvider] });
}

export { resolveContextMeasurement } from "./executors";
