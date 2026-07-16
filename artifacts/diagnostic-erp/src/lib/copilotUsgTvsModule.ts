/**
 * copilotUsgTvsModule.ts — dedicated Transvaginal Sonography (TVS) Copilot module
 * (PR C — CARE USG Gold Standard, §7). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import. Distinct from
 * copilotUsgPelvisModule.ts (generic TA/TV pelvis): fires specifically on a
 * TVS study description and checks TVS-specific completeness (endometrial
 * pattern, adnexal mass characterization) rather than bare organ presence.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality, isObstetricUsgStudy } from "./usgModality";

const TVS_STUDY = /\btvs\b|transvaginal/i;

export function usgTvsModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (isObstetricUsgStudy(ctx.modality, ctx.studyDescription)) return [];
  if (!TVS_STUDY.test(ctx.studyDescription)) return [];

  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;

  if (/endometri/i.test(combined) && !/pattern|trilaminar|homogeneous|heterogeneous/i.test(combined)) {
    items.push({
      id: "usg-tvs:endometrial-pattern-missing",
      category: "missing",
      severity: "info",
      title: "Endometrial pattern not described",
      detail: "Endometrial thickness is mentioned, but its pattern (e.g. trilaminar, homogeneous) is not described.",
      why: "Endometrial pattern, alongside thickness, is part of a complete TVS assessment, particularly for infertility or AUB indications.",
      confidence: "low",
    });
  }

  if (/adnexal|ovarian/i.test(combined) && /mass|lesion|cyst/i.test(combined) && !/simple|complex|septat|solid|vascular/i.test(combined)) {
    items.push({
      id: "usg-tvs:adnexal-mass-not-characterized",
      category: "recommendation",
      severity: "warning",
      title: "Adnexal mass described without characterization",
      detail: "An adnexal/ovarian mass or cyst is mentioned, but it is not characterized as simple/complex, septated, solid, or vascular.",
      why: "Structured characterization (in the spirit of IOTA criteria) is what allows risk stratification of an adnexal mass.",
      confidence: "medium",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-tvs",
  label: "USG TVS advisor",
  kind: "local",
  analyze: usgTvsModuleItems,
});
