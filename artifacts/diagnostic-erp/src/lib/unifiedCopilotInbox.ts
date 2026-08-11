/**
 * Merges scattered advisory signals into the single CARE Copilot feed.
 * Sources: viewer-measurement safety, prior-comparison QA, protocol checklist,
 * and report-quality issues — items that previously lived in separate panels.
 */

import type { CopilotItem } from "./copilotOrchestrator";

export type MeasurementSafetyIssue = {
  id: string;
  severity: "critical" | "important";
  message: string;
};

export function buildUnifiedInboxExtras(opts: {
  measurementSafetyIssues: MeasurementSafetyIssue[];
  comparisonSectionMissing: boolean;
  checklistRemaining: string[];
  qualityIssues: string[];
}): CopilotItem[] {
  const items: CopilotItem[] = [];

  for (const m of opts.measurementSafetyIssues) {
    items.push({
      id: m.id,
      category: "measurement",
      severity: m.severity === "critical" ? "critical" : "warning",
      title: "Viewer measurement not in report",
      detail: m.message,
      why: "Imported caliper values must appear in the report text before sign-off.",
      confidence: "high",
    });
  }

  if (opts.comparisonSectionMissing) {
    items.push({
      id: "inbox-prior-comparison-missing",
      category: "missing",
      severity: "warning",
      title: "Prior comparison wording missing",
      detail: "This patient has prior imaging on file but the report does not mention comparison with previous studies.",
      why: "Institutional style requires interval comparison when priors exist.",
      confidence: "high",
      insertText: "Compared with the prior study, there is no significant interval change.",
      insertTarget: "findings",
    });
  }

  for (const label of opts.checklistRemaining) {
    items.push({
      id: `inbox-checklist-${label.toLowerCase().replace(/\s+/g, "-")}`,
      category: "missing",
      severity: "warning",
      title: `Protocol checklist: ${label}`,
      detail: `Required protocol element "${label}" is not documented in the report.`,
      why: "Active reporting protocol defines this as a required observation.",
      confidence: "medium",
    });
  }

  opts.qualityIssues.forEach((issue, idx) => {
    items.push({
      id: `inbox-quality-${idx}`,
      category: "impression",
      severity: "info",
      title: "Report quality",
      detail: issue,
      why: "Live quality score flagged this while you type.",
      confidence: "medium",
    });
  });

  return items;
}

/** Dedupe by id — core engine items win over extras with the same id. */
export function mergeCopilotItems(core: CopilotItem[], extras: CopilotItem[]): CopilotItem[] {
  const valid = (items: CopilotItem[]) =>
    items.filter((i): i is CopilotItem => !!i && typeof i.id === "string" && i.id.length > 0);
  const safeCore = valid(core);
  const seen = new Set(safeCore.map((i) => i.id));
  return [...safeCore, ...valid(extras).filter((i) => !seen.has(i.id))];
}
