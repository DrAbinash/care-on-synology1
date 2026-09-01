/**
 * Persona router — selects modality/family-specific persona modules based
 * on the canonical ReportingStudyContext carried in the frozen snapshot.
 *
 * Uses ONLY fields from ComposerInputSnapshot (PR #656):
 *   modality, region, regions, bodyPart, family, spineSegment, protocol
 *
 * Does NOT parse raw DICOM StudyDescription. Does NOT reread live frontend
 * state. Selection happens before the worker call and uses the frozen
 * snapshot context.
 *
 * Routing hierarchy (§J):
 *   MASTER + STYLE + SAFETY + modality/family-specific rules
 *
 * PR P0-3 (#657).
 */
import type { ComposerInputSnapshot } from "../types";
import { CARE_RADIOLOGY_MASTER } from "./master";
import { CARE_REPORT_STYLE } from "./style";
import { CARE_SAFETY_RULES } from "./safety";
import { CARE_MRI_BRAIN } from "./mriBrain";
import { CARE_MRI_SPINE } from "./mriSpine";
import { CARE_CT } from "./ct";
import { CARE_USG } from "./usg";
import { CARE_MAMMOGRAPHY } from "./mammography";

/**
 * Select the ordered list of persona modules to load for a given snapshot.
 *
 * Returns the ALWAYS-LOADED base modules (MASTER + STYLE + SAFETY) plus
 * at most ONE modality/family-specific module. Avoids loading irrelevant
 * modules to keep the prompt compact for local Ollama models.
 */
export function selectPersonaModules(snapshot: ComposerInputSnapshot): string[] {
  const modules: string[] = [
    CARE_RADIOLOGY_MASTER,
    CARE_REPORT_STYLE,
    CARE_SAFETY_RULES,
  ];

  // Modality/family-specific routing. Only ONE module is loaded to keep
  // the prompt compact. Priority: explicit modality match > family match.
  const modality = (snapshot.modality ?? "").toUpperCase();
  const family = (snapshot.family ?? "").toLowerCase();

  // Mammography: modality MG or family breast.
  if (modality === "MG" || modality === "DX" && family === "breast" || family === "breast") {
    modules.push(CARE_MAMMOGRAPHY);
    return modules;
  }

  // MRI Brain: family brain + modality MR.
  if (family === "brain" && (modality === "MR" || modality === "MRI")) {
    modules.push(CARE_MRI_BRAIN);
    return modules;
  }

  // MRI Spine: family spine + modality MR.
  if (family === "spine" && (modality === "MR" || modality === "MRI")) {
    modules.push(CARE_MRI_SPINE);
    return modules;
  }

  // CT: modality CT.
  if (modality === "CT") {
    modules.push(CARE_CT);
    return modules;
  }

  // USG: modality US/USG.
  if (modality === "US" || modality === "USG") {
    modules.push(CARE_USG);
    return modules;
  }

  // Unknown family / modality: only MASTER + STYLE + SAFETY loaded.
  // No crash, no irrelevant rules. (§S test 13: Unknown family → master/safety only.)
  return modules;
}

/**
 * Check whether the snapshot carries a Whole Spine Screening component.
 *
 * Used by the prompt builder to inject the screening safeguard explicitly
 * (§P). The MRI_SPINE persona already carries the screening rule, but we
 * also inject a compact explicit flag so the model cannot miss it.
 */
export function hasScreeningComponent(snapshot: ComposerInputSnapshot): boolean {
  const regions = snapshot.regions ?? [];
  return regions.some((r) => {
    const lower = (r ?? "").toLowerCase();
    return lower.includes("screening") || lower.includes("whole spine");
  });
}

export { CARE_RADIOLOGY_MASTER, CARE_REPORT_STYLE, CARE_SAFETY_RULES };
export { CARE_MRI_BRAIN, CARE_MRI_SPINE, CARE_CT, CARE_USG, CARE_MAMMOGRAPHY };
