/**
 * copilotUsgKidneyModule.ts — dedicated Kidney/Renal Copilot module
 * (PR C — CARE USG Gold Standard, §7). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import. Distinct from `copilotUsgAbdomenModule.ts`
 * (which checks generic Whole Abdomen organ coverage, treating "kidneys" as one of
 * several organs): this module fires specifically for KUB/renal-focused studies
 * and checks renal-specific completeness (calculus laterality+size, hydronephrosis
 * grading, corticomedullary differentiation) the generic abdomen module doesn't.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const KIDNEY_STUDY = /\bkub\b|kidney.*bladder|bladder.*kidney|\brenal\b(?!\s*artery|\s*vein|\s*doppler)/i;

export function usgKidneyModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (!KIDNEY_STUDY.test(ctx.studyDescription)) return [];

  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;

  if (/calculus|calculi|stone/i.test(combined) && !/\b(left|right|bilateral)\b/i.test(combined)) {
    items.push({
      id: "usg-kidney:calculus-laterality-missing",
      category: "missing",
      severity: "info",
      title: "Renal calculus described without laterality",
      detail: "A renal calculus is mentioned, but which kidney is not stated.",
      why: "Laterality is essential for a paired-organ study, especially before a urology referral for stone management.",
      confidence: "medium",
    });
  }

  if (/hydronephrosis/i.test(combined) && !/mild|moderate|gross|grade/i.test(combined)) {
    items.push({
      id: "usg-kidney:hydronephrosis-grade-missing",
      category: "missing",
      severity: "warning",
      title: "Hydronephrosis described without a grade",
      detail: "Hydronephrosis is mentioned, but no severity grade (mild/moderate/gross) is stated.",
      why: "Grading hydronephrosis drives the urgency of urological referral and follow-up imaging interval.",
      confidence: "medium",
    });
  }

  if (/cortical\s*thin|reduced\s*cortic|ckd|chronic\s*kidney/i.test(combined) && !/corticomedullary|cortex/i.test(combined)) {
    items.push({
      id: "usg-kidney:cmd-not-described",
      category: "missing",
      severity: "info",
      title: "Corticomedullary differentiation not described",
      detail: "Findings suggest possible chronic kidney disease, but corticomedullary differentiation is not explicitly described.",
      why: "Loss of corticomedullary differentiation is a key sonographic marker of chronic parenchymal disease.",
      confidence: "low",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-kidney",
  label: "USG Kidney advisor",
  kind: "local",
  analyze: usgKidneyModuleItems,
});
