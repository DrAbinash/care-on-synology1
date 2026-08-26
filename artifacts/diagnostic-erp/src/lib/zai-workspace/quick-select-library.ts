import type { Modality } from "./types";
import type { QuickSelectTile, QuickSelectField } from "./types";
import { canonicalContentRegion, contentStudyTypes, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import { DEFAULT_QUICK_SELECT_TILES as DEFAULT_QUICK_SELECT_TILES_DATA } from "./quick-select-tiles.data";

const now = () => new Date().toISOString();
const uid = () => `qs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;

/** Re-export the data-only catalog with ERP tile types. */
export const DEFAULT_QUICK_SELECT_TILES = DEFAULT_QUICK_SELECT_TILES_DATA as QuickSelectTile[];

// ─────────────────────────────────────────────────────────────────────────────
// Content-pack tile merging — fetches per-study YAML content-pack tiles from the
// backend and merges them with the hardcoded defaults below. The catalog tiles
// take precedence (they're clinically authored per-study), but user-customized
// tiles (saved in localStorage) always win.
//
// The fetch is lazy and cached for 5 minutes. On failure, falls back to defaults.
// ─────────────────────────────────────────────────────────────────────────────
let catalogTilesCache: QuickSelectTile[] | null = null;
let catalogTilesFetchPromise: Promise<QuickSelectTile[]> | null = null;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let catalogFetchAt = 0;

interface CatalogTileResponse {
  tiles: Array<{
    id: string; field: string; scopeModality?: string; scopeBodyPart?: string;
    label: string; mnemonic?: string; category: string; sentence: string;
    impressionSentence?: string; packId?: string; findingId?: string;
  }>;
  count: number;
  packCount: number;
}

async function fetchCatalogTiles(): Promise<QuickSelectTile[]> {
  if (catalogTilesCache && Date.now() - catalogFetchAt < CATALOG_CACHE_TTL_MS) {
    return catalogTilesCache;
  }
  if (catalogTilesFetchPromise) return catalogTilesFetchPromise;
  catalogTilesFetchPromise = (async () => {
    try {
      const res = await fetch("/api/radiology/content-pack-tiles", { credentials: "include" });
      if (!res.ok) return catalogTilesCache || [];
      const data: CatalogTileResponse = await res.json();
      catalogTilesCache = (data.tiles || []).map((t) => ({
        id: t.id,
        field: t.field as QuickSelectField,
        scopeModality: t.scopeModality as Modality | undefined,
        scopeBodyPart: t.scopeBodyPart,
        label: t.label,
        mnemonic: t.mnemonic,
        category: (t.category as "normal" | "abnormal" | "variant" | "critical") || "normal",
        sentence: t.sentence,
        impressionSentence: t.impressionSentence,
        createdAt: now(),
        updatedAt: now(),
        // Mark as catalog-sourced so the UI can show a badge if needed
        custom: false,
      }));
      catalogFetchAt = Date.now();
      return catalogTilesCache;
    } catch {
      // Network error or server not ready — fall back to defaults silently
      return catalogTilesCache || [];
    } finally {
      catalogTilesFetchPromise = null;
    }
  })();
  return catalogTilesFetchPromise;
}

/**
 * Get all tiles: user-saved (localStorage) merged with catalog tiles merged
 * with defaults. User tiles take precedence, then catalog tiles, then defaults.
 */
export async function getAllTilesWithCatalog(): Promise<QuickSelectTile[]> {
  const [userTiles, catalogTiles] = await Promise.all([
    Promise.resolve(loadTiles()),
    fetchCatalogTiles(),
  ]);
  // Deduplicate by label+field — user tiles win, then catalog, then defaults.
  // We don't dedupe defaults against catalog by label because the catalog tiles
  // have richer content (impression fragments, AI rules) and should replace
  // the simpler hardcoded ones for the same study type.
  const seen = new Set<string>();
  const merged: QuickSelectTile[] = [];
  // User tiles first (highest priority)
  for (const t of userTiles) {
    const key = `${t.field}:${t.label.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); merged.push(t); }
  }
  // Catalog tiles next
  for (const t of catalogTiles) {
    const key = `${t.field}:${t.label.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); merged.push(t); }
  }
  // Defaults last (lowest priority — only fill gaps not covered by catalog)
  for (const t of DEFAULT_QUICK_SELECT_TILES) {
    const key = `${t.field}:${t.label.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); merged.push(t); }
  }
  return merged;
}

/** Prefetch catalog tiles so they're warm when the workspace mounts. */
export function prefetchCatalogTiles(): void {
  void fetchCatalogTiles();
}

/** @deprecated Use lookupTilesForContext with ReportingStudyContext. DICOM bodyPart is provenance only. */
export function lookupTiles(tiles: QuickSelectTile[], field: QuickSelectField, modality: Modality | undefined, bodyPart: string | undefined): QuickSelectTile[] {
  return tiles.filter(t => t.field === field).map(t => ({ t, s: t.scopeModality === modality && t.scopeBodyPart === bodyPart ? 100 : t.scopeModality === modality && !t.scopeBodyPart ? 50 : !t.scopeModality ? 10 : -1 })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s || a.t.label.localeCompare(b.t.label)).map(x => x.t);
}

/** Scope tiles by the resolved ReportingStudyContext, not DICOM bodyPart. */
export function lookupTilesForContext(
  tiles: QuickSelectTile[],
  field: QuickSelectField,
  modality: Modality | undefined,
  ctx: ReportingStudyContext | null | undefined,
): QuickSelectTile[] {
  if (!ctx?.region) {
    return tiles.filter((tile) => tile.field === field && !tile.scopeBodyPart && !tile.scopeModality);
  }
  const allowed = new Set(contentStudyTypes(ctx.regions.length > 0 ? ctx.regions : [ctx.region]).map((s) => s.toLowerCase()));
  return tiles
    .filter((tile) => tile.field === field)
    .map((tile) => {
      if (tile.scopeModality && tile.scopeModality !== modality) return { tile, s: -1 };
      if (tile.scopeBodyPart && !allowed.has((canonicalContentRegion(tile.scopeBodyPart) || tile.scopeBodyPart).toLowerCase())) return { tile, s: -1 };
      const exact = tile.scopeBodyPart && (canonicalContentRegion(tile.scopeBodyPart) || tile.scopeBodyPart).toLowerCase() === ctx.region!.toLowerCase();
      const s = exact ? 100 : tile.scopeBodyPart ? 80 : tile.scopeModality === modality ? 50 : 10;
      return { tile, s };
    })
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.tile.label.localeCompare(b.tile.label))
    .map((x) => x.tile);
}
const SK = "zai-rad-quickselect-v1";
export function loadTiles(): QuickSelectTile[] { try { const r = localStorage.getItem(SK); return r ? JSON.parse(r) : DEFAULT_QUICK_SELECT_TILES; } catch { return DEFAULT_QUICK_SELECT_TILES; } }
export function saveTiles(t: QuickSelectTile[]) { try { localStorage.setItem(SK, JSON.stringify(t)); } catch {} }
export function createTile(i: Omit<QuickSelectTile, "id" | "createdAt" | "updatedAt">): QuickSelectTile { return { ...i, id: uid(), createdAt: now(), updatedAt: now(), custom: true }; }
export function resetToDefaults(): QuickSelectTile[] { localStorage.removeItem(SK); return DEFAULT_QUICK_SELECT_TILES; }
export const MODALITIES: Record<string, string[]> = { MR: ["Brain","Cervical Spine","C Spine","LS Spine","Dorsal Spine","Thoracic Spine","Whole Spine","Shoulder","Knee"], CT: ["Brain","Chest","Abdomen","Neck","LS Spine","PNS","Pelvis"], XR: ["LS Spine","C Spine","Cervical Spine","Chest","Abdomen","Skull","PNS","Pelvis","KUB","Knee"], US: ["Abdomen","OB","KUB","Pelvis","Thyroid","Scrotum","Breast","Doppler"], MG: ["Breast"], DX: ["Chest","Abdomen"], NM: ["Whole Body","Bone"], PT: ["Whole Body"], DOPPLER: ["Carotid","Lower Limb","Upper Limb","Renal"], ECHO: ["Heart"], USG_OB: ["OB"] };
