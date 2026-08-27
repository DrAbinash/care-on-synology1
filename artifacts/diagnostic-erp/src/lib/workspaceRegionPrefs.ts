/**
 * Workspace-local Study / Region preferences (UI only — no new backend).
 * Quick chips are a user-chosen subset of the Study / Region dropdown.
 * Custom regions extend the dropdown from the reporting workspace itself.
 */

export const QUICK_REGIONS_STORAGE_KEY = "care_workspace_quick_regions_v1";
export const CUSTOM_REGIONS_STORAGE_KEY = "care_workspace_custom_regions_v1";

export function normalizeRegionName(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

export function readStoredRegionList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
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

export function writeStoredRegionList(key: string, regions: string[]): void {
  if (typeof window === "undefined") return;
  const cleaned = regions
    .map(normalizeRegionName)
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of cleaned) {
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(name);
  }
  localStorage.setItem(key, JSON.stringify(unique));
}

/** Merge server catalog + UI-added custom regions (+ currently selected). */
export function mergeRegionCatalog(
  serverRegions: string[],
  customRegions: string[],
  selectedRegion?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of [...serverRegions, ...customRegions, selectedRegion ?? ""]) {
    const n = normalizeRegionName(name);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/**
 * Quick chips = user-picked subset of the catalog.
 * Drops names no longer in the catalog. Does not invent defaults.
 */
export function resolveQuickRegions(catalog: string[], quickPicks: string[]): string[] {
  const catalogKeys = new Map(catalog.map((r) => [r.toLowerCase(), r]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pick of quickPicks) {
    const n = normalizeRegionName(pick);
    if (!n) continue;
    const canonical = catalogKeys.get(n.toLowerCase());
    if (!canonical) continue;
    const k = canonical.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(canonical);
  }
  return out;
}

export function toggleQuickRegionPick(quickPicks: string[], region: string): string[] {
  const name = normalizeRegionName(region);
  if (!name) return quickPicks;
  const key = name.toLowerCase();
  const exists = quickPicks.some((r) => r.toLowerCase() === key);
  if (exists) return quickPicks.filter((r) => r.toLowerCase() !== key);
  return [...quickPicks, name];
}

export function addCustomRegion(customRegions: string[], region: string): string[] {
  const name = normalizeRegionName(region);
  if (!name) return customRegions;
  const key = name.toLowerCase();
  if (customRegions.some((r) => r.toLowerCase() === key)) return customRegions;
  return [...customRegions, name];
}
