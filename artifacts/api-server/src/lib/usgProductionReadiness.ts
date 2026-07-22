/**
 * usgProductionReadiness — safe-rollout readiness evaluator (P9).
 *
 * Encodes the ONE safe-rollout rule for the USG Companion: a feature flag may be
 * enabled only when (a) its phase has actually been clinic-validated and (b)
 * every flag it depends on is already enabled. Nothing is enabled automatically;
 * this module only *computes* what is safe to enable and what is still blocking.
 *
 * Honesty: the default validation state for every phase is `code_complete`, NOT
 * `clinic_validated`. No phase is marked clinic-validated here — that transition
 * is a human action recorded after a real staging/clinic smoke. So by default
 * this evaluator reports the whole workspace as NOT production-ready, which is
 * the truthful state. Pure + testable.
 */

export type PhaseValidationState = "not_started" | "code_complete" | "clinic_validated";

export interface UsgPhaseStatus {
  phase: string;              // "P0".."P8"
  flag: string;              // the phase's primary feature flag
  dependsOnFlags: string[];  // flags that must be enabled first
  validation: PhaseValidationState;
}

/**
 * The canonical phase → flag → dependency plan. `validation` defaults to
 * `code_complete` for the phases delivered in this project; callers override an
 * entry to `clinic_validated` only after a real staging/clinic smoke.
 */
export const USG_PHASE_PLAN: UsgPhaseStatus[] = [
  { phase: "P0/P1", flag: "ff_radiology_usg_workspace", dependsOnFlags: [], validation: "code_complete" },
  { phase: "P2", flag: "ff_radiology_usg_companion_p2", dependsOnFlags: ["ff_radiology_usg_workspace"], validation: "code_complete" },
  { phase: "P3a", flag: "ff_radiology_usg_dicom_extraction", dependsOnFlags: [], validation: "code_complete" },
  { phase: "P3b", flag: "ff_radiology_usg_exact_provenance", dependsOnFlags: ["ff_radiology_usg_dicom_extraction"], validation: "code_complete" },
  { phase: "P4a", flag: "ff_radiology_usg_prior_intelligence", dependsOnFlags: [], validation: "code_complete" },
  { phase: "P4b", flag: "ff_radiology_usg_pregnancy_timeline", dependsOnFlags: ["ff_radiology_usg_prior_intelligence"], validation: "code_complete" },
  { phase: "P5a", flag: "ff_radiology_usg_ob_canonical", dependsOnFlags: [], validation: "code_complete" },
  { phase: "P5b", flag: "ff_radiology_usg_doppler_canonical", dependsOnFlags: [], validation: "code_complete" },
  { phase: "P6", flag: "ff_radiology_usg_report_to_pacs", dependsOnFlags: [], validation: "code_complete" },
  { phase: "P7", flag: "ff_radiology_usg_cine", dependsOnFlags: ["ff_radiology_usg_dicom_extraction"], validation: "code_complete" },
  { phase: "P8a", flag: "ff_radiology_usg_ai_assistant", dependsOnFlags: [], validation: "code_complete" },
  { phase: "P8b", flag: "ff_radiology_usg_ai_growth", dependsOnFlags: ["ff_radiology_usg_ai_assistant", "ff_radiology_usg_pregnancy_timeline"], validation: "code_complete" },
];

export interface FlagEnableDecision {
  flag: string;
  canEnable: boolean;
  blockers: string[];
}

/** Whether a specific flag is safe to enable given phase states + enabled flags. */
export function canEnableFlag(
  flag: string,
  phases: UsgPhaseStatus[],
  enabledFlags: Iterable<string>,
): FlagEnableDecision {
  const enabled = new Set(enabledFlags);
  const phase = phases.find((p) => p.flag === flag);
  const blockers: string[] = [];
  if (!phase) return { flag, canEnable: false, blockers: [`Unknown flag "${flag}" — not in the USG phase plan.`] };

  if (phase.validation !== "clinic_validated") {
    blockers.push(`Phase ${phase.phase} is "${phase.validation}", not clinic-validated — do not enable in production.`);
  }
  for (const dep of phase.dependsOnFlags) {
    if (!enabled.has(dep)) blockers.push(`Dependency "${dep}" must be enabled first.`);
  }
  return { flag, canEnable: blockers.length === 0, blockers };
}

export interface ReadinessReport {
  productionReady: boolean;      // every phase clinic-validated
  enableableNow: string[];       // flags safe to enable right now
  blocked: FlagEnableDecision[]; // everything not yet enableable, with reasons
  summary: string;
}

/** Evaluate rollout readiness across all phases. */
export function evaluateUsgReadiness(
  phases: UsgPhaseStatus[] = USG_PHASE_PLAN,
  enabledFlags: Iterable<string> = [],
): ReadinessReport {
  const enabled = new Set(enabledFlags);
  const enableableNow: string[] = [];
  const blocked: FlagEnableDecision[] = [];

  for (const p of phases) {
    if (enabled.has(p.flag)) continue; // already on
    const d = canEnableFlag(p.flag, phases, enabled);
    if (d.canEnable) enableableNow.push(p.flag);
    else blocked.push(d);
  }

  const productionReady = phases.every((p) => p.validation === "clinic_validated");
  const validated = phases.filter((p) => p.validation === "clinic_validated").length;
  const summary = productionReady
    ? "All USG phases clinic-validated — production rollout may proceed per the flag plan."
    : `${validated}/${phases.length} phases clinic-validated. Not production-ready — enable nothing new until each phase passes a real staging/clinic smoke.`;

  return { productionReady, enableableNow, blocked, summary };
}

export interface SugandhaModeProfile {
  /** The curated, minimal baseline for a single-radiologist pilot. */
  flags: string[];
  note: string;
}

/**
 * "Sugandha mode" — the curated baseline for enabling the dedicated USG
 * workspace for one radiologist (Dr. Sugandha) once validated. It is the
 * validated daily-reporting baseline only (P0–P2); it deliberately does NOT
 * include the newer P3–P8 flags. This returns the PLAN — it does not enable
 * anything. Enabling remains a human, per-flag action gated by `canEnableFlag`.
 */
export function sugandhaModeProfile(): SugandhaModeProfile {
  return {
    flags: ["ff_radiology_usg_workspace", "ff_radiology_usg_companion_p2"],
    note:
      "Curated single-radiologist baseline (P0–P2). Enable per-flag only after a " +
      "real staging/clinic smoke; canonical RadiologyReportingWorkspace remains the " +
      "fallback. P3–P8 stay OFF until individually validated.",
  };
}
