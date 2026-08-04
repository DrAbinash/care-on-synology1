/**
 * Pick the best Quick Protocol for a study region.
 * Priority: isDefault → isGoldStandard → lowest sortOrder → name.
 */

export type QuickProtocolPick = {
  id: number;
  name: string;
  studyType: string;
  techniqueText: string;
  isGoldStandard: boolean;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
};

export function pickQuickProtocol<T extends QuickProtocolPick>(
  protocols: T[],
  studyRegion: string | null | undefined,
): T | null {
  if (!studyRegion) return null;
  const pool = protocols
    .filter((p) => p.isActive && p.studyType === studyRegion)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  if (pool.length === 0) return null;
  return pool.find((p) => p.isDefault)
    ?? pool.find((p) => p.isGoldStandard)
    ?? pool[0];
}
