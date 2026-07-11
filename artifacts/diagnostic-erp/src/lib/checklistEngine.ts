/**
 * checklistEngine.ts — Protocol Checklist Engine (Phase 5).
 *
 * A protocol (e.g. "MRI Brain Trauma") carries a checklist of anatomical
 * items the radiologist must consider (Skull, SDH, EDH, SAH, …). The
 * radiologist doesn't tick items manually — an item is considered
 * "addressed" the moment ANY quick-select button whose label or tags
 * matches it has been selected, OR the radiologist manually marks it
 * reviewed with no abnormality (implicit via the protocol's normal
 * paragraph, which covers everything not explicitly abnormal).
 *
 * This module is pure matching/scoring logic — no React, no fetch —
 * unit-tested in phase5.test.ts.
 */

export interface ChecklistItem {
  label: string;
  addressed: boolean;
  /** Labels of selected quick findings that satisfied this item, if any. */
  matchedBy: string[];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** A checklist item is addressed if a selected finding's label or tags
 *  contains it as a substring (word-normalized) in either direction —
 *  e.g. checklist "SDH" matches finding "Subdural" only if configured
 *  with matching tags; simple substring keeps this dependency-free and
 *  admin-controllable via tags without a fixed synonym table. */
function isAddressedBy(checklistLabel: string, selectedLabel: string, selectedTags: string): boolean {
  const a = normalize(checklistLabel);
  const bLabel = normalize(selectedLabel);
  const bTags = normalize(selectedTags);
  if (!a) return false;
  return bLabel.includes(a) || a.includes(bLabel) || bTags.includes(a);
}

export interface SelectedFindingRef {
  label: string;
  tags: string;
}

/** Computes checklist coverage for a protocol given the currently selected findings. */
export function computeChecklistStatus(checklist: string[], selected: SelectedFindingRef[]): ChecklistItem[] {
  return checklist.map((label) => {
    const matches = selected.filter((f) => isAddressedBy(label, f.label, f.tags));
    return { label, addressed: matches.length > 0, matchedBy: matches.map((m) => m.label) };
  });
}

export interface ChecklistSummary {
  total: number;
  addressed: number;
  percent: number; // 0-100, rounded
  remaining: string[];
}

export function summarizeChecklist(items: ChecklistItem[]): ChecklistSummary {
  const total = items.length;
  const addressed = items.filter((i) => i.addressed).length;
  return {
    total,
    addressed,
    percent: total === 0 ? 100 : Math.round((addressed / total) * 100),
    remaining: items.filter((i) => !i.addressed).map((i) => i.label),
  };
}

/** Parses the checklist_json column safely (never throws on bad data). */
export function parseChecklist(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
