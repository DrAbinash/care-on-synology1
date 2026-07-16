/**
 * copilotUsgThyroidModule.ts — Thyroid USG Copilot module
 * (PR B — USG Platform Consolidation, §12). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const THYROID_STUDY = /thyroid|tirads|neck/i;

export function usgThyroidModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (!THYROID_STUDY.test(ctx.studyDescription)) return [];

  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;

  if (/nodule/i.test(combined) && !/ti-?rads/i.test(combined)) {
    items.push({
      id: "usg-thyroid:tirads-missing",
      category: "recommendation",
      severity: "warning",
      title: "Nodule described without a TI-RADS category",
      detail: "A thyroid nodule is described, but no TI-RADS category is stated.",
      why: "TI-RADS categorization drives the referring clinician's biopsy/follow-up decision and is expected whenever a nodule is reported.",
      confidence: "medium",
    });
  }

  if (!/isthmus/i.test(combined)) {
    items.push({
      id: "usg-thyroid:isthmus-missing",
      category: "missing",
      severity: "info",
      title: "Isthmus not mentioned",
      detail: "The isthmus is not mentioned in the findings.",
      why: "A complete thyroid study addresses both lobes and the isthmus.",
      confidence: "low",
    });
  }

  if (!/lymph\s*node|cervical\s+(lymph|node)|adenopathy/i.test(combined)) {
    items.push({
      id: "usg-thyroid:nodes-missing",
      category: "missing",
      severity: "info",
      title: "Cervical lymph node status not mentioned",
      detail: "Cervical lymph node status is not mentioned in the findings.",
      why: "Cervical nodal status is part of the standard thyroid/neck ultrasound protocol, particularly relevant when a nodule is present.",
      confidence: "low",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-thyroid",
  label: "USG Thyroid advisor",
  kind: "local",
  analyze: usgThyroidModuleItems,
});
