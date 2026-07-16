/**
 * copilotUsgPelvisModule.ts — dedicated general (TA/TV) Pelvis Copilot module
 * (PR C — CARE USG Gold Standard, §7). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import. Gated on "pelvis" generically
 * (not "TVS" — see copilotUsgTvsModule.ts for the dedicated transvaginal
 * module) and deliberately excludes obstetric-pattern studies, which
 * copilotUsgObstetricModule.ts already covers.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality, isObstetricUsgStudy } from "./usgModality";

const PELVIS_STUDY = /\bpelvis\b|uterus|adnex/i;

export function usgPelvisModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (isObstetricUsgStudy(ctx.modality, ctx.studyDescription)) return [];
  if (!PELVIS_STUDY.test(ctx.studyDescription)) return [];

  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;

  if (!/uterus/i.test(combined)) {
    items.push({
      id: "usg-pelvis:uterus-missing",
      category: "missing",
      severity: "warning",
      title: "Uterus not addressed",
      detail: "The uterus is not mentioned in the findings.",
      why: "The uterus is a mandatory section of a pelvic ultrasound.",
      confidence: "medium",
    });
  }

  if (!/endometri/i.test(combined)) {
    items.push({
      id: "usg-pelvis:endometrium-missing",
      category: "missing",
      severity: "info",
      title: "Endometrium not addressed",
      detail: "Endometrial thickness/appearance is not mentioned.",
      why: "Endometrial assessment is a standard component of a pelvic ultrasound.",
      confidence: "low",
    });
  }

  if (!/ovar/i.test(combined)) {
    items.push({
      id: "usg-pelvis:ovaries-missing",
      category: "missing",
      severity: "info",
      title: "Ovaries not addressed",
      detail: "Neither ovary is mentioned in the findings.",
      why: "Both ovaries are expected to be addressed on a pelvic ultrasound, even if only to state they are unremarkable.",
      confidence: "low",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-pelvis",
  label: "USG Pelvis advisor",
  kind: "local",
  analyze: usgPelvisModuleItems,
});
