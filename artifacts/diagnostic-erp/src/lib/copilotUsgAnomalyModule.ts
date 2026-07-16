/**
 * copilotUsgAnomalyModule.ts — dedicated fetal Anomaly Scan (Level II / TIFFA)
 * Copilot module (PR C — CARE USG Gold Standard, §7). Plugs into the EXISTING
 * Copilot registry (`copilotModules.ts`, PR #83) — it does not touch the
 * Copilot core.
 *
 * Advisory only, pure, registered on import. Distinct from
 * copilotUsgObstetricModule.ts (generic GA/placenta/liquor completeness):
 * this module checks the systematic organ-by-organ anatomical survey a
 * Level II anomaly scan is expected to document.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const ANOMALY_STUDY = /anomaly\s*scan|level\s*ii|level\s*2|\btiffa\b/i;

const ANOMALY_ORGANS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "cranium", label: "Cranium/ventricles", pattern: /cran|ventricle|cerebell|posterior\s*fossa/i },
  { key: "spine", label: "Spine", pattern: /spine|vertebra/i },
  { key: "cardiac", label: "Cardiac (4-chamber/outflow)", pattern: /cardiac|four.?chamber|4.?chamber|outflow/i },
  { key: "abdomen", label: "Abdominal wall/stomach", pattern: /abdominal\s*wall|stomach|cord\s*insertion/i },
  { key: "kidneys", label: "Kidneys/bladder", pattern: /kidney|bladder/i },
  { key: "limbs", label: "Limbs", pattern: /limb|extremit|femur|humerus/i },
];

export function usgAnomalyModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (!ANOMALY_STUDY.test(ctx.studyDescription)) return [];

  const items: CopilotItem[] = [];
  const findingsText = ctx.findings || "";

  const missingOrgans = ANOMALY_ORGANS.filter((o) => !o.pattern.test(findingsText));
  if (missingOrgans.length > 0 && findingsText.trim().length > 0) {
    items.push({
      id: "usg-anomaly:survey-incomplete",
      category: "missing",
      severity: missingOrgans.length >= 3 ? "warning" : "info",
      title: "Anatomical survey not yet complete",
      detail: `Findings do not yet address: ${missingOrgans.map((o) => o.label).join(", ")}.`,
      why: "A Level II / TIFFA anomaly scan is expected to systematically document cranium, spine, cardiac, abdominal wall, kidneys, and limbs.",
      confidence: "medium",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-anomaly",
  label: "USG Anomaly Scan advisor",
  kind: "local",
  analyze: usgAnomalyModuleItems,
});
