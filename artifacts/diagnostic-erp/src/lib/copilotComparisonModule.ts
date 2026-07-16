/**
 * copilotComparisonModule.ts — the previous-study comparison Copilot module
 * (MRI PR 1, §7). Plugs into the EXISTING Copilot registry (PR #83) — it does
 * not touch the Copilot core. Advisory only: it flags when a prior is available
 * but no comparison is written, and when a measurement has changed meaningfully.
 *
 * Registered on import. Pure logic; the workspace supplies `ctx.prior`.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { formatStudyDate } from "./radiologyComparison";

const MENTIONS_COMPARISON = /compared with|comparison|interval (change|progression|improvement)|previously seen|no significant interval|prior study|prior mri|prior exam/i;

export function comparisonModuleItems(ctx: CopilotContext): CopilotItem[] {
  const prior = ctx.prior;
  if (!prior?.available) return [];
  const items: CopilotItem[] = [];
  const combined = `${ctx.findings}\n${ctx.impression.join("\n")}`;
  if (!MENTIONS_COMPARISON.test(combined)) {
    const when = prior.dateIso ? ` dated ${formatStudyDate(prior.dateIso)}` : "";
    items.push({
      id: "cmp:available", category: "suggestion", severity: "info",
      title: "Previous study available",
      detail: `A prior ${prior.studyName ?? "study"}${when} is available — consider adding a comparison.`,
      why: "Longitudinal comparison changes management; referrers expect it when a prior exists.",
      confidence: "medium",
    });
  }
  for (const c of prior.significantChanges ?? []) {
    items.push({
      id: `cmp:meas:${c.label.toLowerCase().replace(/\s+/g, "-")}`, category: "measurement", severity: "warning",
      title: `Interval change: ${c.label}`,
      detail: `${c.label} changed by ${c.deltaText} versus the prior study — state and classify it.`,
      why: "A meaningful interval size change should be described and classified (stable / progressed / improved).",
      confidence: "medium",
    });
  }
  return items;
}

registerCopilotModule({
  id: "comparison",
  label: "Previous-study comparison",
  kind: "local",
  analyze: comparisonModuleItems,
});
