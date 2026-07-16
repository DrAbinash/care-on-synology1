/**
 * copilotUsgAbdomenModule.ts — General Abdomen / KUB Copilot module
 * (PR B — USG Platform Consolidation, §12). Plugs into the EXISTING Copilot
 * registry (`copilotModules.ts`, PR #83) exactly like copilotComparisonModule.ts
 * and copilotMeasurementModule.ts — it does not touch the Copilot core.
 *
 * Advisory only, pure, registered on import. Gated on modality + study
 * description so it contributes nothing for MRI/CT or non-abdominal USG.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { isUltrasoundModality } from "./usgModality";

const ABDOMEN_STUDY = /(whole\s*abdomen|\bkub\b|abdomen|liver|gallbladder|pancreas)/i;
const KUB_STUDY = /\bkub\b|kidney.*bladder|bladder.*kidney/i;

// Mirrors the organ set `usgReportTemplates.ts`'s WHOLE_ABDOMEN template and
// UsgMeasurementReviewPanel.tsx's field list both already cover.
const ABDOMEN_ORGANS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "liver", label: "Liver", pattern: /liver/i },
  { key: "gallbladder", label: "Gallbladder / CBD", pattern: /gall\s*bladder|gallbladder|\bcbd\b|bile\s*duct/i },
  { key: "pancreas", label: "Pancreas", pattern: /pancrea/i },
  { key: "spleen", label: "Spleen", pattern: /spleen/i },
  { key: "kidneys", label: "Kidneys", pattern: /kidney/i },
  { key: "bladder", label: "Urinary bladder", pattern: /bladder/i },
];

export function usgAbdomenModuleItems(ctx: CopilotContext): CopilotItem[] {
  if (!isUltrasoundModality(ctx.modality)) return [];
  if (!ABDOMEN_STUDY.test(ctx.studyDescription)) return [];

  const items: CopilotItem[] = [];
  const findingsText = ctx.findings || "";

  const missingOrgans = ABDOMEN_ORGANS.filter((o) => !o.pattern.test(findingsText));
  if (missingOrgans.length > 0 && findingsText.trim().length > 0) {
    items.push({
      id: "usg-abd:organ-coverage",
      category: "missing",
      severity: missingOrgans.length >= 4 ? "warning" : "info",
      title: "Organs not yet addressed",
      detail: `Findings do not yet mention: ${missingOrgans.map((o) => o.label).join(", ")}.`,
      why: "A Whole Abdomen / KUB report is expected to state a finding (even 'normal') for every scanned organ.",
      confidence: "medium",
    });
  }

  if (KUB_STUDY.test(ctx.studyDescription) && !/post[-\s]?void|residual\s*urine|\bpvr\b/i.test(findingsText)) {
    items.push({
      id: "usg-abd:pvr-missing",
      category: "missing",
      severity: "info",
      title: "Post-void residue not stated",
      detail: "KUB studies conventionally report a post-void residual urine volume.",
      why: "PVR is part of the standard KUB protocol and is expected by referring urologists.",
      confidence: "low",
      insertText: "Post-void residual urine: ___ ml.",
      insertTarget: "findings",
    });
  }

  if (/ascites|free\s+fluid/i.test(findingsText) && !ctx.impression.some((i) => /ascites|free\s+fluid/i.test(i))) {
    items.push({
      id: "usg-abd:ascites-in-impression",
      category: "impression",
      severity: "warning",
      title: "Ascites noted in findings but not in impression",
      detail: "Free fluid / ascites is described in the findings — consider carrying it into the impression.",
      why: "A finding significant enough to describe in detail is usually significant enough to summarize in the impression.",
      confidence: "medium",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-abdomen",
  label: "USG General Abdomen / KUB advisor",
  kind: "local",
  analyze: usgAbdomenModuleItems,
});
