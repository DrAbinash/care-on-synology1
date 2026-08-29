/**
 * Workspace-local Quick chip preferences for Section 1.
 *
 * Authoritative Study / Region catalog = server radiology_study_tabs only.
 * LocalStorage stores personal Quick shortcut Study Tab IDs — never a parallel
 * region catalog. Unpinning a Quick chip must not delete a Study Tab.
 */

export const QUICK_STUDY_TAB_IDS_STORAGE_KEY = "care_workspace_quick_study_tab_ids_v1";

/** Legacy name-based key from #615 — migrated once to IDs, then ignored. */
export const LEGACY_QUICK_REGIONS_STORAGE_KEY = "care_workspace_quick_regions_v1";

export type StudyTabRef = { id: number; name: string };

export function normalizeRegionName(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

export function readStoredQuickTabIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUICK_STUDY_TAB_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: number[] = [];
    const seen = new Set<number>();
    for (const item of parsed) {
      const id = Number(item);
      if (!Number.isInteger(id) || id <= 0) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

export function writeStoredQuickTabIds(ids: number[]): void {
  if (typeof window === "undefined") return;
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const item of ids) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  localStorage.setItem(QUICK_STUDY_TAB_IDS_STORAGE_KEY, JSON.stringify(unique));
}

/**
 * One-time migration: map legacy Quick region *names* onto current Study Tab IDs.
 * Does not invent tabs; drops names that are not in the server catalog.
 */
export function migrateLegacyQuickNamesToIds(
  tabs: StudyTabRef[],
  legacyNames: string[],
): number[] {
  const byName = new Map(tabs.map((t) => [t.name.toLowerCase(), t.id]));
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of legacyNames) {
    const name = normalizeRegionName(raw);
    if (!name) continue;
    const id = byName.get(name.toLowerCase());
    if (id == null) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function readLegacyQuickRegionNames(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LEGACY_QUICK_REGIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const name = normalizeRegionName(String(item ?? ""));
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

export function clearLegacyQuickRegionNames(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LEGACY_QUICK_REGIONS_STORAGE_KEY);
  // Also drop obsolete custom-region catalog key if present.
  localStorage.removeItem("care_workspace_custom_regions_v1");
}

/**
 * Resolve Quick chips from stored Study Tab IDs against the live server catalog.
 * Drops IDs that no longer exist (deleted tabs). Never creates catalog entries.
 */
export function resolveQuickStudyTabs(tabs: StudyTabRef[], quickIds: number[]): StudyTabRef[] {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const out: StudyTabRef[] = [];
  const seen = new Set<number>();
  for (const id of quickIds) {
    if (!Number.isInteger(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    const tab = byId.get(id);
    if (!tab) continue;
    seen.add(id);
    out.push(tab);
  }
  return out;
}

/** Pin or unpin a Study Tab ID as a Quick shortcut (never deletes the tab). */
export function toggleQuickTabId(quickIds: number[], tabId: number): number[] {
  if (!Number.isInteger(tabId) || tabId <= 0) return quickIds;
  if (quickIds.includes(tabId)) return quickIds.filter((id) => id !== tabId);
  return [...quickIds, tabId];
}

export function pinQuickTabId(quickIds: number[], tabId: number): number[] {
  if (!Number.isInteger(tabId) || tabId <= 0) return quickIds;
  if (quickIds.includes(tabId)) return quickIds;
  return [...quickIds, tabId];
}

/** Last-chosen Study Tab family for cascading Region → Sub-region picker. */
export function lastStudyFamilyStorageKey(modality: string | null | undefined): string {
  const m = (modality ?? "").trim().toUpperCase() || "ANY";
  return `careLastStudyFamily:${m}`;
}

export function readLastStudyFamily(modality: string | null | undefined): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(lastStudyFamilyStorageKey(modality));
    const v = String(raw ?? "").trim();
    return v || null;
  } catch {
    return null;
  }
}

export function writeLastStudyFamily(modality: string | null | undefined, family: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const key = lastStudyFamilyStorageKey(modality);
    const v = String(family ?? "").trim();
    if (!v) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}
