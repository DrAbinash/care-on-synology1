/**
 * copilotCriticalModule.ts — critical-results safety Copilot module (MRI PR 3).
 *
 * Reuses the existing Copilot registry (PR #83) and the pure detector
 * (criticalResults.ts). It does NOT mark, communicate, or edit anything — it
 * surfaces a live advisory when the drafted report DESCRIBES a critical finding
 * that has not yet been flagged/communicated through the existing workspace
 * controls ("Mark Critical Finding" + the F5 communication checklist). The
 * radiologist acts via those existing controls; the Copilot only reminds.
 *
 * Registered on import, pure, alias-free — same pattern as the comparison and
 * measurement-completeness modules.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { detectCriticalFindings } from "./criticalResults";

export function criticalModuleItems(ctx: CopilotContext): CopilotItem[] {
  const hits = detectCriticalFindings(ctx.findings, ctx.impression, ctx.criticalWatchList);
  if (hits.length === 0) return [];
  const labels = hits.map((h) => h.label).join(", ");

  // Not flagged at all — the most important reminder.
  if (!ctx.criticalMarked) {
    return [{
      id: "critical:unflagged",
      category: "critical",
      severity: "critical",
      title: "Possible critical finding — not flagged",
      detail: `The report describes ${labels}, but "Mark Critical Finding" is off.`,
      why: "Critical/actionable results must be flagged and communicated to the referring clinician; flagging also records the communication for the audit trail. Review and mark it — the Copilot never changes the report or the flag for you.",
      confidence: "high",
    }];
  }

  // Flagged but the communication checklist shows it hasn't been telephoned.
  if (ctx.criticalCommunicated === false) {
    return [{
      id: "critical:uncommunicated",
      category: "critical",
      severity: "warning",
      title: "Critical finding not yet communicated",
      detail: "Marked critical, but the communication checklist shows the referring clinician has not been telephoned.",
      why: "A flagged critical result is not closed until it is communicated and that communication is documented.",
      confidence: "high",
    }];
  }

  return [];
}

registerCopilotModule({
  id: "critical-results",
  label: "Critical results safety",
  kind: "local",
  analyze: criticalModuleItems,
});
