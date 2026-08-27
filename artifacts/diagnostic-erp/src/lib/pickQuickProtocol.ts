/**
 * Pick the best Quick Protocol / Technique for a Study Tab.
 * Prefer studyTabId match; fall back to denormalized studyType name for legacy rows.
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

export function protocolsForStudyTab<T extends QuickProtocolPick>(
  protocols: T[],
  studyTabId: number | null | undefined,
  studyRegionName?: string | null,
): T[] {
  const active = protocols.filter((p) => p.isActive);
  if (studyTabId != null && Number.isInteger(studyTabId) && studyTabId > 0) {
    const byId = active.filter((p) => p.studyTabId === studyTabId);
    if (byId.length > 0) return byId;
  }
  if (studyRegionName) {
    return active.filter((p) => p.studyType === studyRegionName && (p.studyTabId == null || studyTabId == null));
  }
  return [];
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
