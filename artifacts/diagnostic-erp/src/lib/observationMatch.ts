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
    // A level-prefixed line ("L4-L5: <sentence>") carries the sentence as its
    // body — the overlay's own walk probes it exactly this way (`probe`), and
    // the restored/merged lines the engine writes back can carry a prefix the
    // row's `lastRendered` does not. Matching the line with its prefix
    // stripped closes the false "blocked" reads that turned applied tiles
    // amber ("manual kept") after an engine-side rewording; the sentence
    // content is still asserted, so the tile is not blocked.
    const prefixed = line.trim().match(/^((?:[CDLSST]\s?\d{1,2}\s?[-–—/]\s?(?:S\s?1|[CDLSST]\s?\d{1,2})|S1)\s*:)\s*(.*)$/i);
    if (prefixed) {
      const body = prefixed[2] ?? "";
      if (contributionsMatch(body, c)) return true;
      if (body.split(/(?<=[.!?]|[\u2013\u2014-])\s+/).some((p) => contributionsMatch(p, c))) return true;
    }
  }
  return false;
}
