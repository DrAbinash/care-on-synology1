/**
 * copilotUsgBreastModule.ts — Breast USG Copilot module
 * (PR B — USG Platform Consolidation, §12). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const BREAST_STUDY = /breast|bi-?rads|axill/i;

export function usgBreastModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (!BREAST_STUDY.test(ctx.studyDescription)) return [];

  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;

  if (/lesion|mass|nodule|cyst/i.test(combined) && !/bi-?rads/i.test(combined)) {
    items.push({
      id: "usg-breast:birads-missing",
      category: "recommendation",
      severity: "warning",
      title: "Lesion described without a BI-RADS category",
      detail: "A breast lesion is described, but no BI-RADS category is stated.",
      why: "BI-RADS categorization is the standard way a breast ultrasound communicates management (follow-up vs. biopsy) to the referring clinician.",
      confidence: "medium",
    });
  }

  if (!/\b(left|right|bilateral)\b/i.test(combined)) {
    items.push({
      id: "usg-breast:laterality-missing",
      category: "missing",
      severity: "info",
      title: "Laterality not stated",
      detail: "The report does not clearly state which breast(s) were examined.",
      why: "Laterality is required for a breast study, especially when a lesion is described.",
      confidence: "low",
    });
  }

  if (!/axilla/i.test(combined)) {
    items.push({
      id: "usg-breast:axilla-missing",
      category: "missing",
      severity: "info",
      title: "Axilla not mentioned",
      detail: "Axillary status is not mentioned in the findings.",
      why: "Axillary nodal assessment is a standard component of a breast ultrasound, particularly when a suspicious lesion is present.",
      confidence: "low",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-breast",
  label: "USG Breast advisor",
  kind: "local",
  analyze: usgBreastModuleItems,
});
