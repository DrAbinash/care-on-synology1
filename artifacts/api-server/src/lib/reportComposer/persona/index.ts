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
    case "PROFESSIONALIZE":
      parts.push(
        "TASK: Rewrite the SUPPLIED REPORT so it reads as a polished radiology report — " +
        "grammar, terminology, ordering, conventional prose, a clear Impression. " +
        "The supplied Findings and Impression ARE the clinical truth; you are not drafting from observations. " +
        "CONSERVATION IS THE CONTRACT: every abnormality, measurement, vertebral level, laterality and " +
        "relevant negative in the supplied text must be present in your answer. " +
        "Improve wording only. Never add a finding, never remove one, never normalise something that was " +
        "abnormal, and never state a normal for a structure the report did not describe. " +
        "If a sentence is too ambiguous to rewrite faithfully, keep it verbatim and list it in unresolvedQuestions.",
      );
      break;
    case "OBSERVATIONS":
      parts.push(
        "TASK: Structure the supplied dictation into discrete observation rows. " +
        "You are NOT writing a report: leave findings and impression empty. " +
        "Do NOT complete anatomy, do NOT add a normal or a negative the radiologist did not state, " +
        "and do NOT supply a level, side, severity or measurement that is absent from the dictation — " +
        "leave that field empty instead. Every row must trace to words the radiologist actually wrote.",
      );
      break;
    case "COMBINE":
      parts.push(
        "TASK: Merge the CURRENT REPORT with the SUPPLIED ADDITIONAL REPORT(S) into one coherent " +
        "Findings and one Impression. Both texts are clinical truth; carry the content of each. " +
        "Keep every measurement, level, laterality and negative finding from either side. " +
        "Remove duplicated statements, never duplicated facts. Do not average or soften two descriptions " +
        "into one weaker one. If the two reports conflict about the same structure, keep both statements " +
        "and put the conflict in unresolvedQuestions rather than choosing between them.",
      );
      break;
    default:
      parts.push(
        "TASK: Draft a COMPLETE professional radiology report (Findings, Impression, optional Recommendation) " +
          "from the CLINICAL TRUTH block, in CARE's printed order: technique (supplied text only); Findings by " +
          "anatomy and by LEVEL using the printed-structure convention (`Label:` section lines, a pipe table for " +
          "a per-level series); normal anatomy the input covers; a concise prioritised Impression that agrees " +
          "with the Findings and is not repeated as a second conclusion; a Recommendation only if supported. " +
          "Do not invent pathology, laterality, levels, measurements, or filler recommendations. CARE's printer " +
          "adds the examination title, the patient lines and the heading style — do not write a title, a patient " +
          "name line, or markdown emphasis.",
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
  CARE_XRAY,
  CARE_DOPPLER,
  CARE_MRCP,
} from "./router";
