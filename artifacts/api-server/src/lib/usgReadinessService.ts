/**
 * usgReadinessService — the LIVE bridge behind the P9 admin/rollout control
 * plane (final-integration wiring; not a pure core).
 *
 * It joins three real sources of truth:
 *   1. USG_PHASE_PLAN            (phase → flag → dependency, from the P9 core)
 *   2. RADIOLOGY_FLAG_REGISTRY   (wired?, dependsOn, purpose, rollbackEffect)
 *   3. feature_flags table       (the live enabled/disabled state)
 * and produces the readiness matrix the admin page renders, plus the
 * server-enforced enable/disable decisions.
 *
 * Safe-rollout invariants enforced here (NOT just in the UI):
 *   - a flag cannot be enabled while a dependency flag is OFF (hard block);
 *   - a flag whose phase is not clinic-validated can only be enabled with an
 *     explicit admin acknowledgement (force + reason), which the caller audits;
 *   - disabling is always allowed (rollback), and cascades a warning about
 *     dependents that are still ON.
 */

import { db } from "@workspace/db";
import { featureFlagsTable } from "@workspace/db/schema";
import {
  USG_PHASE_PLAN, evaluateUsgReadiness, type PhaseValidationState,
} from "./usgProductionReadiness";
import { RADIOLOGY_FLAG_REGISTRY } from "./radiologyFeatureFlagRegistry";

export interface UsgFlagStatus {
  phase: string;
  flag: string;
  /** The pure core always has the module, so code is available. */
  codeAvailable: boolean;
  /** Server code actually gates on this flag today (registry.wired). */
  wired: boolean;
  /** Live feature_flags value. */
  enabled: boolean;
  dependsOn: string[];
  /** Dependencies that are currently OFF (hard blockers for enabling). */
  unmetDependencies: string[];
  validation: PhaseValidationState;
  /** Dependents (flags depending on this one) that are still ON. */
  enabledDependents: string[];
  purpose: string | null;
  rollbackEffect: string | null;
  ownerSubsystem: string | null;
  /** True when this flag can be enabled right now with no override. */
  enableableNow: boolean;
  /** True when the only thing blocking is clinic validation (force-able). */
  validationOverrideRequired: boolean;
  blockers: string[];
}

export interface UsgReadinessMatrix {
  productionReady: boolean;
  summary: string;
  flags: UsgFlagStatus[];
  /** Flags currently enabled — the live rollout surface. */
  enabledFlags: string[];
}

const registryByKey = new Map(RADIOLOGY_FLAG_REGISTRY.map((e) => [e.key, e]));

/** Read the live feature_flags table into a {key: enabled} map. */
export async function loadLiveFlags(): Promise<Record<string, boolean>> {
  const rows = await db.select().from(featureFlagsTable);
  return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
}

/** All USG phase flags (from the canonical phase plan). */
export function usgPhaseFlags(): string[] {
  return USG_PHASE_PLAN.map((p) => p.flag);
}

/** Build the readiness matrix from the phase plan + registry + live flags. */
export function buildReadinessMatrix(live: Record<string, boolean>): UsgReadinessMatrix {
  const enabledSet = new Set(Object.entries(live).filter(([, v]) => v).map(([k]) => k));

  const flags: UsgFlagStatus[] = USG_PHASE_PLAN.map((p) => {
    const reg = registryByKey.get(p.flag);
    const dependsOn = reg?.dependsOn ?? p.dependsOnFlags;
    const unmetDependencies = dependsOn.filter((d) => !enabledSet.has(d));
    const enabledDependents = USG_PHASE_PLAN
      .filter((q) => (registryByKey.get(q.flag)?.dependsOn ?? q.dependsOnFlags).includes(p.flag))
      .map((q) => q.flag)
      .filter((f) => enabledSet.has(f));

    const validationPending = p.validation !== "clinic_validated";
    const blockers: string[] = [];
    for (const d of unmetDependencies) blockers.push(`Dependency "${d}" must be enabled first.`);
    if (validationPending) blockers.push(`Phase ${p.phase} is "${p.validation}", not clinic-validated.`);

    return {
      phase: p.phase,
      flag: p.flag,
      codeAvailable: true,
      wired: reg?.wired ?? false,
      enabled: enabledSet.has(p.flag),
      dependsOn,
      unmetDependencies,
      validation: p.validation,
      enabledDependents,
      purpose: reg?.purpose ?? null,
      rollbackEffect: reg?.rollbackEffect ?? null,
      ownerSubsystem: reg?.ownerSubsystem ?? null,
      enableableNow: unmetDependencies.length === 0 && !validationPending,
      validationOverrideRequired: unmetDependencies.length === 0 && validationPending,
      blockers,
    };
  });

  const readiness = evaluateUsgReadiness(USG_PHASE_PLAN, [...enabledSet]);
  return {
    productionReady: readiness.productionReady,
    summary: readiness.summary,
    flags,
    enabledFlags: flags.filter((f) => f.enabled).map((f) => f.flag),
  };
}

export type EnableOutcome =
  | { ok: true; requiresForce: false }
  | { ok: true; requiresForce: true }        // allowed but only because force was supplied
  | { ok: false; reason: string; blockers: string[] };

/**
 * Decide whether `flag` may be enabled given the live state. Dependency gaps
 * are a hard refusal; a not-yet-validated phase is refused UNLESS force+reason
 * were supplied (the route audits that acknowledgement).
 */
export function decideEnable(
  flag: string,
  live: Record<string, boolean>,
  opts: { force?: boolean; reason?: string } = {},
): EnableOutcome {
  const matrix = buildReadinessMatrix(live);
  const status = matrix.flags.find((f) => f.flag === flag);
  if (!status) return { ok: false, reason: "unknown_flag", blockers: [`"${flag}" is not a USG phase flag.`] };
  if (status.enabled) return { ok: true, requiresForce: false };

  if (status.unmetDependencies.length > 0) {
    return { ok: false, reason: "unmet_dependencies", blockers: status.blockers };
  }
  if (status.validationOverrideRequired) {
    if (opts.force && (opts.reason?.trim().length ?? 0) >= 3) {
      return { ok: true, requiresForce: true };
    }
    return { ok: false, reason: "validation_pending", blockers: status.blockers };
  }
  return { ok: true, requiresForce: false };
}

export interface KillSwitchResult {
  disabled: string[];   // flags that were ON and are now being turned OFF
}

/** All USG flags that are currently enabled — the kill-switch target set. */
export function killSwitchTargets(live: Record<string, boolean>): KillSwitchResult {
  const usg = new Set(usgPhaseFlags());
  return { disabled: Object.entries(live).filter(([k, v]) => v && usg.has(k)).map(([k]) => k) };
}
