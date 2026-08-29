/**
 * Shared lastRendered ↔ narrative match normalization.
 * ONE helper used at write time (renderedInField) and strip time
 * (contributionPresent / stripContribution). Exact match stays the fast path.
 */

const SMART_QUOTES = /[\u2018\u2019\u201A\u201B]/g;
const SMART_DBL = /[\u201C\u201D\u201E\u201F]/g;
const SMART_DASH = /[\u2013\u2014\u2212]/g;

export function normalizeContributionMatch(s: string): string {
  return (s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(SMART_QUOTES, "'")
    .replace(SMART_DBL, '"')
    .replace(SMART_DASH, "-")
    .replace(/-(?=\s|$)/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "");
}

export function contributionsMatch(a: string, b: string): boolean {
  const na = normalizeContributionMatch(a);
  const nb = normalizeContributionMatch(b);
  if (!na || !nb) return false;
  return na === nb;
}

/** True when `contribution` appears in `fieldText` after shared normalization. */
export function fieldContainsContribution(fieldText: string, contribution: string): boolean {
  const c = (contribution ?? "").trim();
  if (!c) return false;
  if (fieldText.includes(c)) return true;
  const want = normalizeContributionMatch(c);
  if (!want) return false;
  if (normalizeContributionMatch(fieldText) === want) return true;
  const lines = fieldText.split(/\n+/);
  for (const line of lines) {
    if (contributionsMatch(line, c)) return true;
    const parts = line.split(/(?<=[.!?]|[\u2013\u2014-])\s+/);
    if (parts.some((p) => contributionsMatch(p, c))) return true;
  }
  return false;
}
