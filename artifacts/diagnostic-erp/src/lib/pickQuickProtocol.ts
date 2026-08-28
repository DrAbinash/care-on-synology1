/**
 * Pick the best Quick Protocol / Technique for a Study Tab.
 * Prefer studyTabId match; merge legacy name-only rows so migrated data stays visible.
 * Priority: isDefault → isGoldStandard → lowest sortOrder → name.
 */

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
