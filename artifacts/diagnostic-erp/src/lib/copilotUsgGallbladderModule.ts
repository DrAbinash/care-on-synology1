/**
 * copilotUsgGallbladderModule.ts — dedicated Gall Bladder Copilot module
 * (PR C — CARE USG Gold Standard, §7). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const GALLBLADDER_STUDY = /gall\s*bladder|gallbladder|\bcbd\b|bile\s*duct|cholecyst/i;

export function usgGallbladderModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (!GALLBLADDER_STUDY.test(ctx.studyDescription) && !GALLBLADDER_STUDY.test(ctx.findings)) return [];

  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;

  if (/wall\s*thick|cholecystitis/i.test(combined) && !/pericholecystic|murphy/i.test(combined)) {
    items.push({
      id: "usg-gallbladder:pericholecystic-fluid-not-mentioned",
      category: "missing",
      severity: "warning",
      title: "Wall thickening described without pericholecystic fluid statement",
      detail: "Gallbladder wall thickening or cholecystitis is mentioned, but pericholecystic fluid status is not stated.",
      why: "Pericholecystic fluid is one of the key sonographic criteria for acute cholecystitis and changes management urgency.",
      confidence: "medium",
    });
  }

  if (/calculus|calculi|stone/i.test(combined) && !/\d+(\.\d+)?\s*(mm|cm)/i.test(combined)) {
    items.push({
      id: "usg-gallbladder:calculus-size-missing",
      category: "missing",
      severity: "info",
      title: "Gallbladder calculus size not stated",
      detail: "A gallbladder calculus is mentioned but no size measurement is given.",
      why: "Calculus size (particularly whether it exceeds 2-3 cm) affects surgical planning and complication risk assessment.",
      confidence: "low",
    });
  }

  if (!/\bcbd\b|common\s*bile\s*duct|bile\s*duct/i.test(combined) && GALLBLADDER_STUDY.test(ctx.studyDescription)) {
    items.push({
      id: "usg-gallbladder:cbd-not-mentioned",
      category: "missing",
      severity: "info",
      title: "CBD (common bile duct) not mentioned",
      detail: "CBD caliber is not mentioned in the findings.",
      why: "CBD diameter is a standard part of a gallbladder/right-upper-quadrant ultrasound, especially before excluding biliary obstruction.",
      confidence: "low",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-gallbladder",
  label: "USG Gall Bladder advisor",
  kind: "local",
  analyze: usgGallbladderModuleItems,
});
