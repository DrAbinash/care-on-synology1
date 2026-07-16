/**
 * copilotUsgGrowthModule.ts — dedicated fetal Growth Scan Copilot module
 * (PR C — CARE USG Gold Standard, §7). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import. Distinct from
 * copilotUsgObstetricModule.ts, which already checks generic GA/placenta/
 * liquor completeness for ANY obstetric study: this module fires only for
 * growth-scan-pattern studies and checks growth-specific completeness
 * (EFW/percentile, growth-restriction Doppler correlation) that the generic
 * module doesn't.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const GROWTH_STUDY = /growth\s*scan|fetal\s*growth|3rd\s*trimester|third\s*trimester/i;

export function usgGrowthModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (!GROWTH_STUDY.test(ctx.studyDescription)) return [];

  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;

  if (!/\befw\b|estimated\s*fetal\s*weight/i.test(combined)) {
    items.push({
      id: "usg-growth:efw-missing",
      category: "missing",
      severity: "warning",
      title: "Estimated fetal weight not stated",
      detail: "Neither the findings nor the impression states an estimated fetal weight (EFW).",
      why: "EFW is the primary deliverable of a growth scan.",
      confidence: "medium",
    });
  }

  if (/growth\s*restrict|small\s*for\s*gestational|\bfgr\b|\bsga\b/i.test(combined) && !/doppler|umbilical\s*artery|\bua\b\s*pi|\bmca\b/i.test(combined)) {
    items.push({
      id: "usg-growth:doppler-not-correlated",
      category: "recommendation",
      severity: "warning",
      title: "Growth restriction noted without Doppler correlation",
      detail: "Growth restriction / SGA is suggested, but no Doppler (umbilical artery, MCA) correlation is mentioned.",
      why: "Umbilical artery and MCA Doppler are standard surveillance whenever fetal growth restriction is suspected.",
      confidence: "medium",
    });
  }

  if (!/liquor|amniotic\s+fluid|\bafi\b/i.test(combined)) {
    items.push({
      id: "usg-growth:liquor-missing",
      category: "missing",
      severity: "info",
      title: "Liquor / AFI not mentioned",
      detail: "Amniotic fluid volume is not mentioned in this growth scan.",
      why: "Liquor volume is a required component of a third-trimester growth scan.",
      confidence: "low",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-growth",
  label: "USG Growth Scan advisor",
  kind: "local",
  analyze: usgGrowthModuleItems,
});
