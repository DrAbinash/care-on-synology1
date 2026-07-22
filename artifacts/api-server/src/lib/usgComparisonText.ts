/**
 * usgComparisonText — editable, non-autonomous comparison suggestions (P4.5).
 *
 * Turns deterministic ComparisonRows into DRAFT comparison sentences the
 * radiologist can accept, edit, or discard. It is suggestion-only:
 *   - it NEVER writes into a report or draft directly;
 *   - it NEVER classifies clinical progression ("worsening"/"response");
 *   - every suggestion carries the underlying current/prior values and interval
 *     so the reader verifies before accepting.
 * The canonical draft→verify→finalize lifecycle remains the only write path.
 * Pure + testable.
 */

import type { ComparisonRow } from "./usgStructuredComparison";
import { comparisonPhrase } from "./usgStructuredComparison";

export interface ComparisonSuggestion {
  key: string;
  label: string;
  /** Draft sentence — editable, never auto-inserted. */
  text: string;
  /** Values behind the sentence, surfaced for verification. */
  evidence: {
    current: string | null;
    prior: string | null;
    absoluteChange: number | null;
    percentChange: number | null;
    intervalDays: number | null;
    unit: string | null;
  };
  direction: ComparisonRow["direction"];
  /** Honest caveat carried through from the comparison (unit/plane mismatch). */
  caveat: string | null;
  /** True when the reader should confirm before accepting (caveats/new/resolved). */
  needsReview: boolean;
}

function intervalText(days: number | null): string {
  if (days == null || days <= 0) return "";
  if (days < 14) return ` over ${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.round(days / 7);
  return ` over ${weeks} week${weeks === 1 ? "" : "s"}`;
}

/**
 * Build a single editable suggestion from a comparison row. The sentence states
 * the change and always cites the values; it does not assert clinical meaning.
 */
export function comparisonSuggestion(row: ComparisonRow): ComparisonSuggestion {
  const cur = row.current?.value ?? null;
  const pri = row.prior?.value ?? null;
  const phrase = comparisonPhrase(row);
  const unit = row.current?.unit ?? row.prior?.unit ?? null;

  let text: string;
  switch (row.direction) {
    case "increased":
    case "decreased":
      text = `${row.label} ${phrase}${intervalText(row.intervalDays)} (${pri ?? "?"} → ${cur ?? "?"}).`;
      break;
    case "unchanged":
      text = `${row.label} ${phrase} (${cur ?? pri ?? "?"}).`;
      break;
    case "new":
      text = `${row.label} ${cur ?? ""} — no prior value for comparison.`.replace(/\s+—/, " —");
      break;
    case "resolved":
      text = `${row.label} ${phrase} (prior ${pri ?? "?"}).`;
      break;
    case "not_comparable":
      text = `${row.label}: ${phrase} (current ${cur ?? "?"}, prior ${pri ?? "?"}).`;
      break;
  }

  const needsReview =
    !!row.note ||
    row.direction === "new" ||
    row.direction === "resolved" ||
    row.direction === "not_comparable";

  return {
    key: row.key,
    label: row.label,
    text: text.trim(),
    evidence: {
      current: cur,
      prior: pri,
      absoluteChange: row.absoluteChange,
      percentChange: row.percentChange,
      intervalDays: row.intervalDays,
      unit,
    },
    direction: row.direction,
    caveat: row.note,
    needsReview,
  };
}

/**
 * Build suggestions for a set of comparison rows. Order is preserved. Rows that
 * did not change at all (unchanged AND no caveat) can optionally be dropped, so
 * the draft only foregrounds the differences worth a sentence.
 */
export function buildComparisonSuggestions(
  rows: ComparisonRow[],
  opts: { includeUnchanged?: boolean } = {},
): ComparisonSuggestion[] {
  const includeUnchanged = opts.includeUnchanged ?? false;
  return rows
    .filter((r) => includeUnchanged || r.direction !== "unchanged" || !!r.note)
    .map(comparisonSuggestion);
}

/**
 * Compose a draft "Comparison" paragraph from suggestions. This returns text for
 * the editor to review — it is NOT inserted anywhere automatically.
 */
export function composeComparisonParagraph(suggestions: ComparisonSuggestion[]): string {
  if (!suggestions.length) return "";
  return suggestions.map((s) => s.text).join(" ");
}
