/**
 * finalizeSafety.ts — pre-finalization safety aggregation (MRI PR 3,
 * "Finalization Safety").
 *
 * This does NOT introduce a second finalize path or a new modal. The workspace
 * `finalizeReport()` already persists the draft, runs the backend validate-draft
 * + the client `validateReport` warnings, and shows ONE window.confirm carrying
 * the identity being signed. This module composes the extra pre-sign safety
 * checks PR 3 adds — protocol completeness and critical-result handling — into a
 * uniform list the existing confirm dialog (and the pre-sign preview gate) can
 * render. Advisory only: it returns messages, it never blocks — the radiologist
 * still owns the decision by clicking OK (Copilot §17 safety philosophy).
 *
 * Pure and alias-free (root-testable).
 */

export interface FinalizeSafetyIssue {
  id: string;
  /** "critical" = red / clinically important; "warn" = amber / completeness. */
  severity: "critical" | "warn";
  message: string;
}

export interface FinalizeSafetyInput {
  /** True when a protocol with a content checklist is active. */
  checklistActive: boolean;
  /** 0-100 checklist completeness (only meaningful when checklistActive). */
  checklistPercent: number;
  /** Checklist items not yet addressed (for a specific, actionable message). */
  checklistRemaining?: string[];
  /** Required-measurement labels the protocol expects but the report lacks. */
  missingRequiredMeasurements?: string[];
  /** Critical findings detected in the report text (criticalResults.ts). */
  criticalHits: { label: string }[];
  /** Whether the radiologist has toggled "Mark Critical Finding". */
  criticalMarked: boolean;
  /** Whether the critical result is documented as communicated (telephoned). */
  criticalCommunicated: boolean;
}

const MAX_LISTED = 4;
function joinLabels(labels: string[]): string {
  const shown = labels.slice(0, MAX_LISTED).join(", ");
  return labels.length > MAX_LISTED ? `${shown}, +${labels.length - MAX_LISTED} more` : shown;
}

/**
 * Compose the pre-finalization safety issues, most-important first (critical
 * before warn). Empty array = nothing to flag.
 */
export function computeFinalizeSafety(input: FinalizeSafetyInput): FinalizeSafetyIssue[] {
  const critical: FinalizeSafetyIssue[] = [];
  const warn: FinalizeSafetyIssue[] = [];

  // ── Critical results (clinically most important) ──
  if (input.criticalHits.length > 0 && !input.criticalMarked) {
    critical.push({
      id: "critical-unflagged",
      severity: "critical",
      message: `The report describes a critical finding (${joinLabels(
        input.criticalHits.map((h) => h.label),
      )}) but "Mark Critical Finding" is off — flag and communicate it before signing.`,
    });
  } else if (input.criticalHits.length > 0 && input.criticalMarked && !input.criticalCommunicated) {
    critical.push({
      id: "critical-uncommunicated",
      severity: "critical",
      message:
        'Critical finding is marked but the communication checklist shows the referring clinician has not been telephoned.',
    });
  }

  // ── Protocol completeness (warn) ──
  if (input.checklistActive && input.checklistPercent < 100) {
    const remaining = (input.checklistRemaining ?? []).filter(Boolean);
    const tail = remaining.length ? ` — remaining: ${joinLabels(remaining)}` : "";
    warn.push({
      id: "protocol-checklist",
      severity: "warn",
      message: `Protocol checklist ${input.checklistPercent}% addressed${tail}.`,
    });
  }
  const missing = (input.missingRequiredMeasurements ?? []).filter(Boolean);
  if (missing.length > 0) {
    warn.push({
      id: "missing-measurements",
      severity: "warn",
      message: `Missing required measurement(s): ${joinLabels(missing)}.`,
    });
  }

  return [...critical, ...warn];
}

/** True when critical findings require hard acknowledgment before finalize. */
export function criticalFindingBlocksFinalize(input: FinalizeSafetyInput): boolean {
  return (
    (input.criticalHits.length > 0 && !input.criticalMarked) ||
    (input.criticalHits.length > 0 && input.criticalMarked && !input.criticalCommunicated)
  );
}

/** Render the issues as a block for the existing window.confirm dialog. Empty
 *  string when there is nothing to add, so the confirm text stays clean. */
export function formatFinalizeSafety(issues: FinalizeSafetyIssue[]): string {
  if (issues.length === 0) return "";
  const lines = issues.map((i, n) => `  ${n + 1}. ${i.severity === "critical" ? "⚠ " : ""}${i.message}`);
  return `\nSafety checks:\n${lines.join("\n")}\n`;
}
