/**
 * copilotUsgScrotumModule.ts — Scrotum USG Copilot module
 * (PR B — USG Platform Consolidation, §12). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const SCROTUM_STUDY = /scrotum|testis|testes|epididym/i;

export function usgScrotumModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (!SCROTUM_STUDY.test(ctx.studyDescription)) return [];

  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;

  if (/lesion|mass|nodule/i.test(combined) && !/vascular|doppler|flow/i.test(combined)) {
    items.push({
      id: "usg-scrotum:vascularity-missing",
      category: "recommendation",
      severity: "warning",
      title: "Lesion described without vascularity assessment",
      detail: "A testicular/scrotal lesion is described, but Doppler vascularity is not mentioned.",
      why: "Vascularity assessment is essential in scrotal ultrasound to help distinguish torsion, inflammation, and neoplasm.",
      confidence: "medium",
    });
  }

  if (/abnormal|lesion|mass|nodule|hydrocele|varicocele/i.test(combined) && !/\b(left|right|bilateral)\b/i.test(combined)) {
    items.push({
      id: "usg-scrotum:laterality-missing",
      category: "missing",
      severity: "info",
      title: "Laterality not stated for an abnormal finding",
      detail: "An abnormal finding is described without stating which side it involves.",
      why: "Laterality is essential for a paired-organ study, particularly before any surgical referral.",
      confidence: "low",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-scrotum",
  label: "USG Scrotum advisor",
  kind: "local",
  analyze: usgScrotumModuleItems,
});
