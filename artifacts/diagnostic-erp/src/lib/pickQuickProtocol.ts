/**
 * Pick the best Quick Protocol / Technique for a Study Tab.
 * Prefer studyTabId match; merge legacy name-only rows so migrated data stays visible.
 * Priority: isDefault → isGoldStandard → lowest sortOrder → name.
 */

import { coreTokenInHint, studyRegionTokens } from "./studyRegion";

export type QuickProtocolPick = {
  id: number;
  name: string;
  studyType: string;
  studyTabId?: number | null;
  techniqueText: string;
  isGoldStandard: boolean;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
};

export type ProtocolsForStudyTabResult<T extends QuickProtocolPick> = {
  /** ID-matched + legacy name fallback (deduped by id). */
  matched: T[];
  /** Legacy rows with study_tab_id NULL matched only by studyType name. */
  unresolvedLegacy: T[];
};

export function protocolsForStudyTab<T extends QuickProtocolPick>(
  protocols: T[],
  studyTabId: number | null | undefined,
  studyRegionName?: string | null,
): T[] {
  return protocolsForStudyTabDetailed(protocols, studyTabId, studyRegionName).matched;
}

export function protocolsForStudyTabDetailed<T extends QuickProtocolPick>(
  protocols: T[],
  studyTabId: number | null | undefined,
  studyRegionName?: string | null,
): ProtocolsForStudyTabResult<T> {
  const active = protocols.filter((p) => p.isActive);
  const byId =
    studyTabId != null && Number.isInteger(studyTabId) && studyTabId > 0
      ? active.filter((p) => p.studyTabId === studyTabId)
      : [];
  const legacy = studyRegionName
    ? active.filter((p) => p.studyTabId == null && p.studyType === studyRegionName)
    : [];
  const seen = new Set<number>();
  const matched: T[] = [];
  for (const p of [...byId, ...legacy]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    matched.push(p);
  }
  return { matched, unresolvedLegacy: legacy };
}

export function pickQuickProtocol<T extends QuickProtocolPick>(
  protocols: T[],
  studyRegion: string | null | undefined,
  studyTabId?: number | null,
): T | null {
  const pool = protocolsForStudyTab(protocols, studyTabId, studyRegion)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  if (pool.length === 0) return null;
  return pool.find((p) => p.isDefault)
    ?? pool.find((p) => p.isGoldStandard)
    ?? pool[0];
}

/**
 * Normalize a billed / protocol name for comparison: lowercase, punctuation →
 * spaces, whitespace collapsed. The billing catalogue writes "X-RAY", "XRAY"
 * and "X Ray" for one thing, so those spellings are bridged BEFORE the
 * punctuation strip (the study-region tokenizer would otherwise split the
 * hyphenated form into "x"+"ray" tokens no billed name carries).
 */
function normalizeBilledProtocolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bx[\s-]*ray\b/g, "xray")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Let the billed / catalog procedure row name its own Technique, instead of
 * always loading the Study Tab default. Strength order:
 *
 *   1. Exact normalized name — the billing row names this protocol.
 *   2. Contiguous phrase containment — the billing row carries the protocol
 *      name inside a longer string (price suffixes, order codes). The longest
 *      contained phrase wins: more of the billed row is accounted for.
 *   3. Order-free token subset — every protocol token is present in the billed
 *      tokens (anatomy synonyms respected, "ls" ↔ "lumbar"). Word order
 *      differs between the catalogue and protocol naming often enough that a
 *      strict phrase would starve this pass.
 *
 * Fails closed: anything weaker than the above returns null and the caller
 * falls back to `pickQuickProtocol` (the region default). A Technique text
 * describing an acquisition that was not ordered — contrast on a plain study —
 * is worse than no auto-pick. Single-token names never match passes 2–3, so a
 * protocol literally named "Screening" cannot capture every billing row that
 * happens to contain the word. Inactive rows are invisible (the dropdown pool
 * they must match is the same one `protocolsForStudyTab` builds).
 */
export function pickQuickProtocolForBilledName<T extends QuickProtocolPick>(
  protocols: T[],
  billedTestName: string | null | undefined,
  studyRegion: string | null | undefined,
  studyTabId?: number | null,
): T | null {
  const billed = (billedTestName ?? "").trim();
  if (!billed) return null;
  const pool = protocolsForStudyTab(protocols, studyTabId, studyRegion);
  if (pool.length === 0) return null;

  const billedNorm = normalizeBilledProtocolName(billed);

  // Pass 1 — exact normalized name.
  const exact = pool.find((p) => normalizeBilledProtocolName(p.name) === billedNorm);
  if (exact) return exact;

  // Passes 2–3 need a name substantial enough to mean something on its own.
  const candidates = pool
    .map((p) => ({ p, norm: normalizeBilledProtocolName(p.name) }))
    .filter((c) => c.norm.split(" ").filter(Boolean).length >= 2);
  if (candidates.length === 0) return null;

  // Pass 2 — contiguous phrase containment, longest phrase wins.
  const padded = ` ${billedNorm} `;
  const contained = candidates
    .filter((c) => padded.includes(` ${c.norm} `))
    .sort((a, b) =>
      b.norm.length - a.norm.length
      || a.p.sortOrder - b.p.sortOrder
      || a.p.name.localeCompare(b.p.name),
    );
  if (contained.length > 0) return contained[0]!.p;

  // Pass 3 — order-free token subset, most tokens win (most specific name).
  // Tokenize the NORMALIZED billed string so the xray bridge holds here too;
  // studyRegionTokens adds the dotted-abbreviation re-joins on top.
  const billedTokens = new Set(studyRegionTokens(billedNorm));
  const subset = candidates.filter((c) =>
    c.norm.split(" ").every((token) => coreTokenInHint(token, billedTokens)),
  );
  if (subset.length === 0) return null;
  return subset
    .sort((a, b) => {
      const at = a.norm.split(" ").length;
      const bt = b.norm.split(" ").length;
      return bt - at
        || b.norm.length - a.norm.length
        || a.p.sortOrder - b.p.sortOrder
        || a.p.name.localeCompare(b.p.name);
    })[0]!.p;
}

/** Clinical history chips for a Study Tab (ID first; legacy name fallback). */
export function clinicalHistoryChipsForStudyTab<T extends { studyTabId?: number | null; studyType: string; isActive: boolean }>(
  chips: T[],
  studyTabId: number | null | undefined,
  studyRegionName?: string | null,
): { matched: T[]; unresolvedLegacy: T[] } {
  const active = chips.filter((c) => c.isActive);
  if (studyTabId != null && Number.isInteger(studyTabId) && studyTabId > 0) {
    const matched = active.filter((c) => c.studyTabId === studyTabId);
    if (matched.length > 0) return { matched, unresolvedLegacy: [] };
  }
  if (studyRegionName) {
    const legacy = active.filter((c) => c.studyType === studyRegionName && c.studyTabId == null);
    return { matched: legacy, unresolvedLegacy: legacy };
  }
  return { matched: [], unresolvedLegacy: [] };
}

/** Normalized name key for per–Study Tab duplicate checks (matches API migration). */
export function normalizeTechniqueName(name: string): string {
  return name.trim().toLowerCase();
}

/** Quick findings for a Study Tab (ID first; legacy name fallback). */
export function quickFindingsForStudyTab<T extends { studyTabId?: number | null; studyType: string; isActive: boolean; sortOrder?: number; label?: string }>(
  findings: T[],
  studyTabId: number | null | undefined,
  studyRegionName?: string | null,
): { matched: T[]; unresolvedLegacy: T[] } {
  const active = findings.filter((f) => f.isActive);
  if (studyTabId != null && Number.isInteger(studyTabId) && studyTabId > 0) {
    const matched = active.filter((f) => f.studyTabId === studyTabId);
    if (matched.length > 0) {
      return {
        matched: matched.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.label ?? "").localeCompare(String(b.label ?? ""))),
        unresolvedLegacy: [],
      };
    }
  }
  if (studyRegionName) {
    const legacy = active.filter((f) => f.studyType === studyRegionName && f.studyTabId == null);
    return {
      matched: legacy.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.label ?? "").localeCompare(String(b.label ?? ""))),
      unresolvedLegacy: legacy,
    };
  }
  return { matched: [], unresolvedLegacy: [] };
}
