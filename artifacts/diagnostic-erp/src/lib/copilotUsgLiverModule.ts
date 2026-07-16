/**
 * copilotUsgLiverModule.ts — dedicated Liver Copilot module
 * (PR C — CARE USG Gold Standard, §7). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import. Distinct from `copilotUsgAbdomenModule.ts`:
 * this module checks liver-specific completeness (fatty-liver grading, focal-lesion
 * characterization, key liver measurements) beyond the generic organ-coverage checklist.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const LIVER_STUDY = /liver|hepat(?!ic\s*artery|ic\s*vein|ic\s*doppler)/i;

export function usgLiverModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (!LIVER_STUDY.test(ctx.studyDescription) && !/\bliver\b/i.test(ctx.findings)) return [];

  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;

  if (/increased\s*echogenicity|fatty\s*liver|hepatic\s*steatosis/i.test(combined) && !/grade\s*[i1]|grade\s*[ii2]|grade\s*[iii3]|mild|moderate|severe/i.test(combined)) {
    items.push({
      id: "usg-liver:fatty-liver-grade-missing",
      category: "missing",
      severity: "info",
      title: "Fatty liver described without a grade",
      detail: "Increased hepatic echogenicity / fatty liver is mentioned, but no severity grade is stated.",
      why: "Grading fatty infiltration (mild/moderate/severe) is standard and clinically actionable for the referring physician.",
      confidence: "low",
    });
  }

  if (/lesion|nodule|mass/i.test(combined) && /liver|hepatic/i.test(combined) && !/cystic|solid|complex|anechoic|hyperechoic|hypoechoic/i.test(combined)) {
    items.push({
      id: "usg-liver:lesion-not-characterized",
      category: "recommendation",
      severity: "warning",
      title: "Hepatic lesion described without echotexture characterization",
      detail: "A liver lesion is mentioned, but its echotexture (cystic/solid/complex) is not described.",
      why: "Cystic-vs-solid characterization is the first branch point for any liver lesion work-up.",
      confidence: "medium",
    });
  }

  if (!/liver\s*span|liver.{0,10}measur/i.test(combined) && /liver/i.test(combined)) {
    items.push({
      id: "usg-liver:span-not-stated",
      category: "missing",
      severity: "info",
      title: "Liver span not stated",
      detail: "Liver is described, but a craniocaudal span measurement is not mentioned.",
      why: "Liver span is a standard, simple measurement expected on every abdominal ultrasound including the liver.",
      confidence: "low",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-liver",
  label: "USG Liver advisor",
  kind: "local",
  analyze: usgLiverModuleItems,
});
