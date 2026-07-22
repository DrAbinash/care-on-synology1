/**
 * usgMeasurementInsert — Insert-All-Approved planning + conflict reconciliation
 * (Phases P2.2 / P2.3). Pure logic only: it decides what would be inserted and
 * surfaces conflicts; the UI applies the plan and the radiologist resolves
 * conflicts. Never inserts an unapproved value, never silently overwrites.
 */

import { parseMeasurement } from "./usgFindingBuilder";

export type MeasurementSourceType = "sr" | "ge_tag" | "ocr" | "pdf" | "manual";
export type MeasurementReviewState = "pending" | "approved" | "rejected";

export interface ApprovedMeasurement {
  key: string;                       // canonical measurement id (e.g. "cbd", "prostateVolume")
  label: string;
  value: string;                     // original value (may include unit)
  unit: string;
  organ: string;                     // mapped organ key
  sourceType: MeasurementSourceType;
  sourceRef?: string | null;         // study/series/sop/frame reference where known
  acquiredAt?: string | null;
  reviewState: MeasurementReviewState;
}

export type InsertAction =
  | "insert"
  | "already_present"
  | "conflict"
  | "skip_unapproved"
  | "unmapped";

export interface InsertPlanItem {
  measurement: ApprovedMeasurement;
  action: InsertAction;
  existingValue?: string;
  diff?: { absolute: number | null; percent: number | null };
}

export interface InsertPlanSummary {
  inserted: number;
  alreadyPresent: number;
  conflicts: number;
  pending: number;         // unapproved (pending or rejected) left untouched
  unmapped: number;
}

export interface InsertPlan {
  items: InsertPlanItem[];
  summary: InsertPlanSummary;
}

function numeric(v: string): number | null {
  return parseMeasurement(v, {}).value;
}

function sameValue(a: string, b: string): boolean {
  const na = numeric(a), nb = numeric(b);
  if (na != null && nb != null) return Math.abs(na - nb) < 1e-6;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function computeDiff(existing: string, incoming: string): { absolute: number | null; percent: number | null } {
  const a = numeric(existing), b = numeric(incoming);
  if (a == null || b == null) return { absolute: null, percent: null };
  const absolute = Math.round((b - a) * 100) / 100;
  const percent = a !== 0 ? Math.round((absolute / Math.abs(a)) * 1000) / 10 : null;
  return { absolute, percent };
}

/**
 * Plan an Insert-All-Approved run.
 * @param measurements approved+unapproved candidates.
 * @param currentByKey the values already in the report, keyed by canonical id.
 * @param presetOrganKeys organs relevant to the current examination preset.
 */
export function planInsertAllApproved(
  measurements: ApprovedMeasurement[],
  currentByKey: Record<string, string>,
  presetOrganKeys: string[],
): InsertPlan {
  const expected = new Set(presetOrganKeys);
  const items: InsertPlanItem[] = [];
  const summary: InsertPlanSummary = { inserted: 0, alreadyPresent: 0, conflicts: 0, pending: 0, unmapped: 0 };

  for (const m of measurements) {
    if (m.reviewState !== "approved") {
      items.push({ measurement: m, action: "skip_unapproved" });
      summary.pending++;
      continue;
    }
    if (!expected.has(m.organ)) {
      items.push({ measurement: m, action: "unmapped" });
      summary.unmapped++;
      continue;
    }
    const existing = currentByKey[m.key];
    if (existing == null || existing === "") {
      items.push({ measurement: m, action: "insert" });
      summary.inserted++;
    } else if (sameValue(existing, m.value)) {
      items.push({ measurement: m, action: "already_present", existingValue: existing });
      summary.alreadyPresent++;
    } else {
      items.push({ measurement: m, action: "conflict", existingValue: existing, diff: computeDiff(existing, m.value) });
      summary.conflicts++;
    }
  }
  return { items, summary };
}

/** Items the UI actually inserts (conflicts require reconciliation first). */
export function insertableItems(plan: InsertPlan): InsertPlanItem[] {
  return plan.items.filter((i) => i.action === "insert");
}

// ── P2.3 conflict reconciliation ─────────────────────────────────────────────

export type ReconciliationDecision =
  | "keep_report"
  | "use_incoming"
  | "keep_both"
  | "mark_unresolved"
  | "reject_incoming";

export interface ReconciliationRecord {
  key: string;
  organ: string;
  reportValue: string;
  incomingValue: string;
  incomingSource: MeasurementSourceType;
  incomingSourceRef?: string | null;
  decision: ReconciliationDecision;
  finalValue: string | null;       // null when unresolved
  reason?: string | null;
  author: string | null;
  decidedAt: string | null;
}

/** Resolve a conflict deterministically into a persistable record. Never
 *  silently replaces — the decision is explicit and audited. */
export function resolveConflict(
  item: InsertPlanItem,
  decision: ReconciliationDecision,
  ctx: { author?: string | null; timestamp?: string | null; reason?: string | null },
): ReconciliationRecord {
  const m = item.measurement;
  const reportValue = item.existingValue ?? "";
  let finalValue: string | null;
  switch (decision) {
    case "keep_report": finalValue = reportValue; break;
    case "use_incoming": finalValue = m.value; break;
    case "keep_both": finalValue = `${reportValue} / ${m.value}`; break;
    case "reject_incoming": finalValue = reportValue; break;
    case "mark_unresolved": finalValue = null; break;
  }
  return {
    key: m.key, organ: m.organ, reportValue, incomingValue: m.value,
    incomingSource: m.sourceType, incomingSourceRef: m.sourceRef ?? null,
    decision, finalValue, reason: ctx.reason ?? null,
    author: ctx.author ?? null, decidedAt: ctx.timestamp ?? null,
  };
}
