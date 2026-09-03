/**
 * Persona index — assembles the full CARE system prompt from selected
 * persona modules + job-kind-specific instruction.
 *
 * PR P0-3 (#657).
 */
import type { AiComposeJobKind } from "@workspace/db/schema";
import type { ComposerInputSnapshot } from "../types";
import {
  selectPersonaModules,
  hasScreeningComponent,
  CARE_PERSONA_VERSION,
  resolvePrimaryRegionLabel,
} from "./router";

/**
 * Build the CARE system prompt for a given job kind + frozen snapshot.
 *
 * Assembly order:
 *   1. Persona modules (MASTER + STYLE + SAFETY + modality/segment + selected-image)
 *   2. Screening safeguard (if applicable — §P)
 *   3. Job-kind-specific instruction
 */
export function buildCareSystemPrompt(
  kind: AiComposeJobKind,
  snapshot: ComposerInputSnapshot,
): string {
  const modules = selectPersonaModules(snapshot);
  const parts: string[] = [...modules];

  if (hasScreeningComponent(snapshot)) {
    parts.push(
      "SCREENING CONTEXT ACTIVE: This study includes a Whole Spine Screening component. " +
      "Screening studies are LIMITED-PLANAR and LIMITED-SEQUENCE. " +
      "Do NOT describe screening as full multiplanar multisequence imaging. " +
      "Use 'limited-planar, limited-sequence screening' wording in Technique. " +
      "Do NOT make full diagnostic claims about screening regions beyond supplied observations.",
    );
  }

  if ((snapshot.aiMode ?? "TEXT_ONLY") === "SELECTED_IMAGES") {
    parts.push(
      `SELECTED-IMAGE CONTEXT: Primary region = ${resolvePrimaryRegionLabel(snapshot)}. ` +
      `Selected frozen key images: ${(snapshot.selectedKeyImages ?? []).length}. ` +
      "Observations remain the highest-priority clinical truth.",
    );
  }

  switch (kind) {
    case "IMPRESSION":
      parts.push(
        "TASK: Generate or refine Impression only from the supplied Findings/observations. " +
        "Leave Findings unchanged in the JSON (copy input Findings). " +
        "IMPRESSION jobs are text-only — do not require or claim image review.",
      );
      break;
    case "SELECTION_EDIT":
    case "SECTION_EDIT":
    case "REPHRASE":
    case "SHORTEN":
    case "EXPAND":
    case "TRANSLATE":
      parts.push(
        "TASK: Apply the instruction only to the selected/target text. " +
        "Preserve meaning, laterality, levels, and numbers. Do NOT invent new clinical facts.",
      );
      break;
    default:
      parts.push(
        "TASK: Draft a COMPLETE radiologist-quality report (Findings, Impression, optional Recommendation) " +
          "from the CLINICAL TRUTH block. Preserve technique. Overlay abnormalities onto any normal scaffold. " +
          "Do not invent pathology, laterality, levels, measurements, or filler recommendations.",
      );
      break;
  }

  return parts.join("\n\n");
}

export {
  selectPersonaModules,
  hasScreeningComponent,
  CARE_PERSONA_VERSION,
  resolvePrimaryRegionLabel,
};
export {
  CARE_RADIOLOGY_MASTER,
  CARE_REPORT_STYLE,
  CARE_SAFETY_RULES,
  CARE_MRI_BRAIN,
  CARE_MRI_SPINE,
  CARE_CT,
  CARE_USG,
  CARE_MAMMOGRAPHY,
  CARE_MRI_CERVICAL,
  CARE_MRI_DORSAL,
  CARE_MRI_LUMBAR,
  CARE_SELECTED_IMAGE_ASSISTED,
} from "./router";
