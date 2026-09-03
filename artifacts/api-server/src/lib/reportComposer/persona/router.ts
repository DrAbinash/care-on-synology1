/**
 * Persona router — selects modality/family-specific persona modules based
 * on the canonical ReportingStudyContext carried in the frozen snapshot.
 *
 * Uses ONLY fields from ComposerInputSnapshot (PR #656):
 *   modality, region, regions, bodyPart, family, spineSegment, protocol, aiMode
 *
 * Does NOT parse raw DICOM StudyDescription. Does NOT reread live frontend
 * state. Selection happens before the worker call and uses the frozen
 * snapshot context.
 *
 * Routing hierarchy (§J):
 *   MASTER + STYLE + SAFETY + modality/family-specific rules
 *   + spine-segment addendum (cervical/dorsal/lumbar)
 *   + selected-image assisted module when aiMode === SELECTED_IMAGES
 *
 * PR P0-3 (#657) + selected-image / region-aware extension.
 */
import type { ComposerInputSnapshot } from "../types";
import { CARE_RADIOLOGY_MASTER } from "./master";
import { CARE_REPORT_STYLE } from "./style";
import { CARE_SAFETY_RULES } from "./safety";
import { CARE_MRI_BRAIN } from "./mriBrain";
import { CARE_MRI_SPINE } from "./mriSpine";
import { CARE_MRI_CERVICAL } from "./mriSpineCervical";
import { CARE_MRI_DORSAL } from "./mriSpineDorsal";
import { CARE_MRI_LUMBAR } from "./mriSpineLumbar";
import { CARE_CT } from "./ct";
import { CARE_USG } from "./usg";
import { CARE_MAMMOGRAPHY } from "./mammography";
import { CARE_SELECTED_IMAGE_ASSISTED } from "./selectedImages";

export const CARE_PERSONA_VERSION = "care-persona-2026.09.selected-image.1";

/**
 * Select the ordered list of persona modules to load for a given snapshot.
 *
 * Returns the ALWAYS-LOADED base modules (MASTER + STYLE + SAFETY) plus
 * modality/family-specific module(s). Avoids loading irrelevant modules
 * to keep the prompt compact for local Ollama models.
 */
export function selectPersonaModules(snapshot: ComposerInputSnapshot): string[] {
  const modules: string[] = [
    CARE_RADIOLOGY_MASTER,
    CARE_REPORT_STYLE,
    CARE_SAFETY_RULES,
  ];

  const modality = (snapshot.modality ?? "").toUpperCase();
  const family = (snapshot.family ?? "").toLowerCase();
  const spineSegment = (snapshot.spineSegment ?? "").toLowerCase();

  if ((modality === "MG") || (modality === "DX" && family === "breast") || (family === "breast")) {
    modules.push(CARE_MAMMOGRAPHY);
  } else if (family === "brain" && (modality === "MR" || modality === "MRI")) {
    modules.push(CARE_MRI_BRAIN);
  } else if (family === "spine" && (modality === "MR" || modality === "MRI")) {
    modules.push(CARE_MRI_SPINE);
    if (spineSegment === "cervical") modules.push(CARE_MRI_CERVICAL);
    else if (spineSegment === "dorsal") modules.push(CARE_MRI_DORSAL);
    else if (spineSegment === "lumbar") modules.push(CARE_MRI_LUMBAR);
  } else if (modality === "CT") {
    modules.push(CARE_CT);
  } else if (modality === "US" || modality === "USG") {
    modules.push(CARE_USG);
  }

  // Selected-image assisted mode — additive safety module (never replaces region rules).
  if ((snapshot.aiMode ?? "TEXT_ONLY") === "SELECTED_IMAGES") {
    modules.push(CARE_SELECTED_IMAGE_ASSISTED);
  }

  return modules;
}

/**
 * Human-readable primary region label for UI / provenance.
 */
export function resolvePrimaryRegionLabel(snapshot: ComposerInputSnapshot): string {
  const family = (snapshot.family ?? "").toLowerCase();
  const segment = (snapshot.spineSegment ?? "").toLowerCase();
  if (family === "brain") return "MRI Brain";
  if (family === "spine") {
    if (segment === "cervical") return "MRI Cervical Spine";
    if (segment === "dorsal") return "MRI Dorsal Spine";
    if (segment === "lumbar") return "MRI Lumbosacral Spine";
    return "MRI Spine";
  }
  return snapshot.region?.trim() || snapshot.bodyPart?.trim() || "Unknown region";
}

/**
 * Check whether the snapshot carries a Whole Spine Screening component.
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
export { CARE_MRI_CERVICAL, CARE_MRI_DORSAL, CARE_MRI_LUMBAR, CARE_SELECTED_IMAGE_ASSISTED };
