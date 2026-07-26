/**
 * Fuzzy-matches an OCR-extracted invoice line description (e.g. "PARACETAMOL
 * 500MG TAB (10x10)") against the inventory/medicine catalog, so a scanned
 * supplier invoice can auto-suggest which catalog item each line refers to
 * instead of requiring every line to be picked by hand.
 *
 * Pure, DOM/DB-free — takes the catalog as plain data so it's testable
 * without a database, same pattern as inventoryReagentLogic.ts.
 */

export interface CatalogItem {
  id: number;
  name: string;
}

export interface LineMatch {
  itemId: number | null;
  itemName: string | null;
  /** 0-100. Below AUTO_MATCH_THRESHOLD, treat as a suggestion only — staff
   *  must confirm or pick a different item before the invoice can be posted. */
  confidence: number;
}

/** Confidence at/above which a match is considered reliable enough to
 *  pre-select automatically (still shown to staff for review, not silently
 *  applied) — same tiering spirit as the bill-scan confidence bands
 *  elsewhere in this codebase (>=95 high-trust, lower needs a closer look). */
export const AUTO_MATCH_THRESHOLD = 85;

export function normalizeItemName(s: string): string {
  return s
    .toLowerCase()
    // Keep letters/digits/%/. (dosage strengths like "500mg", "0.5%") and
    // collapse everything else (punctuation, parentheses, commas) to spaces.
    .replace(/[^a-z0-9%.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Collapse "500 mg" -> "500mg": a scanned invoice and the catalog
    // routinely differ only in whether a space separates a dosage number
    // from its unit (mg/ml/mcg/g/iu/%). Verified by actually running the
    // matcher against a real "PARACETAMOL 500 MG TAB" invoice line — without
    // this, that space alone dropped a correct match from a high-confidence
    // hit to well below the auto-match threshold.
    .replace(/(\d+(?:\.\d+)?)\s+(mg|ml|mcg|g|iu|%)\b/g, "$1$2");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0-100 similarity from edit distance, normalized by the longer string's length. */
function levenshteinRatio(a: string, b: string): number {
  if (!a && !b) return 100;
  const maxLen = Math.max(a.length, b.length, 1);
  return Math.max(0, 100 * (1 - levenshtein(a, b) / maxLen));
}

/** 0-100 Jaccard overlap of whitespace-separated tokens — robust to word
 *  reordering and extra packaging/dosage-form words on either side. */
function tokenSetOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = new Set([...ta, ...tb]).size;
  return 100 * (intersection / union);
}

/** Score a single (invoice line, catalog item) pair, 0-100. */
export function scoreLineMatch(descriptionRaw: string, itemName: string): number {
  const normDesc = normalizeItemName(descriptionRaw);
  const normItem = normalizeItemName(itemName);
  if (!normDesc || !normItem) return 0;
  // One name fully containing the other is treated as a near-exact hit —
  // the common case where the invoice line is a longer free-text description
  // ("Paracetamol 500mg Tab 10x10 Strip") that contains the shorter catalog
  // name ("Paracetamol 500mg") verbatim, or vice versa.
  const containment = normDesc.includes(normItem) || normItem.includes(normDesc) ? 92 : 0;
  const blended = 0.6 * tokenSetOverlap(normDesc, normItem) + 0.4 * levenshteinRatio(normDesc, normItem);
  return Math.round(Math.max(containment, blended));
}

/** Find the best catalog match for one invoice line. Returns itemId: null
 *  (no suggestion) when the catalog is empty or nothing scores above 0. */
export function matchInvoiceLineToCatalog(descriptionRaw: string, catalog: CatalogItem[]): LineMatch {
  let best: LineMatch = { itemId: null, itemName: null, confidence: 0 };
  for (const item of catalog) {
    const confidence = scoreLineMatch(descriptionRaw, item.name);
    if (confidence > best.confidence) best = { itemId: item.id, itemName: item.name, confidence };
  }
  return best;
}
