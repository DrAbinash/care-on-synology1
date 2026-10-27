import type { Modality } from "./types";
import type { QuickSelectTile, QuickSelectField } from "./types";
import { canonicalContentRegion, contentStudyTypes, spineSegmentFromRegion, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import { DEFAULT_QUICK_SELECT_TILES as DEFAULT_QUICK_SELECT_TILES_DATA } from "./quick-select-tiles.data";

/** Re-export the data-only catalog with ERP tile types. */
export const DEFAULT_QUICK_SELECT_TILES = DEFAULT_QUICK_SELECT_TILES_DATA as QuickSelectTile[];

/** @deprecated Use lookupTilesForContext with ReportingStudyContext. DICOM bodyPart is provenance only. */
export function lookupTiles(tiles: QuickSelectTile[], field: QuickSelectField, modality: Modality | undefined, bodyPart: string | undefined): QuickSelectTile[] {
  return tiles.filter(t => t.field === field).map(t => ({ t, s: t.scopeModality === modality && t.scopeBodyPart === bodyPart ? 100 : t.scopeModality === modality && !t.scopeBodyPart ? 50 : !t.scopeModality ? 10 : -1 })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s || a.t.label.localeCompare(b.t.label)).map(x => x.t);
}

/** Scope tiles by the resolved ReportingStudyContext, not DICOM bodyPart. */
/**
 * A Whole Spine screening study is three examinations in one report and a
 * Dorso-Lumbar is two, but each bills as a single region — so the Quick Select
 * strip came up empty on exactly the study where findings from several regions
 * have to be recorded, leaving the radiologist to type them.
 *
 * Only the boxes are widened. Each keeps its own `scopeBodyPart`, which is what
 * the overlay uses as the patch region, so a lumbar click on a whole-spine study
 * still lands in the lumbar section and cannot overwrite the cervical report.
 * Format matching deliberately keeps its segment-exact rules: a whole-spine
 * study must not auto-open a lumbar-only Normal report.
 */
export function spineTileRegions(ctx: ReportingStudyContext): string[] {
  const segment = spineSegmentFromRegion(ctx.region);
  if (segment === "whole") return ["Cervical Spine", "Dorsal Spine", "LS Spine"];
  if (segment === "dorsolumbar") return ["Dorsal Spine", "LS Spine"];
  return [];
}

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
  for (const segment of spineTileRegions(ctx)) allowed.add(segment.toLowerCase());
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
export const MODALITIES: Record<string, string[]> = { MR: ["Brain","Cervical Spine","C Spine","LS Spine","Dorsal Spine","Thoracic Spine","Whole Spine","Shoulder","Knee"], CT: ["Brain","Chest","Abdomen","Neck","LS Spine","PNS","Pelvis"], XR: ["LS Spine","C Spine","Cervical Spine","Chest","Abdomen","Skull","PNS","Pelvis","KUB","Knee"], US: ["Abdomen","OB","KUB","Pelvis","Thyroid","Scrotum","Breast","Doppler"], MG: ["Breast"], DX: ["Chest","Abdomen"], NM: ["Whole Body","Bone"], PT: ["Whole Body"], DOPPLER: ["Carotid","Lower Limb","Upper Limb","Renal"], ECHO: ["Heart"], USG_OB: ["OB"] };
