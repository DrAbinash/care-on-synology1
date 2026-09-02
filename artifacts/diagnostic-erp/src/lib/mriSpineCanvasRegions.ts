/**
 * MRI Cervical + Dorsal Spine Canvas — shared spine infrastructure.
 *
 * Mirrors the existing MriLumbarCanvas architecture but uses cervical/dorsal
 * levels and anatomical regions appropriate for each segment.
 *
 * Cervical levels: C2-C3, C3-C4, C4-C5, C5-C6, C6-C7, C7-T1
 * Dorsal levels: T1-T2, T2-T3, ..., T11-T12, T12-L1
 *
 * Reuses the same option catalogs (DISC_MORPHOLOGY_OPTIONS, LATERALITY_OPTIONS,
 * CANAL_STENOSIS_OPTIONS, etc.) from mriLumbarRegions.ts — they are
 * clinically shared across all spine segments.
 *
 * Does NOT create a parallel reporting engine — uses the same
 * applyMacroBundle + buildLumbarLevelApplyBundle pattern.
 */

import {
  DISC_MORPHOLOGY_OPTIONS,
  LATERALITY_OPTIONS,
  CANAL_STENOSIS_OPTIONS,
  FORAMINAL_LATERALITY_OPTIONS,
  FORAMINAL_SEVERITY_OPTIONS,
  MODIC_OPTIONS,
  ROOT_RELATION_OPTIONS,
  type LumbarLevelSelection,
} from "./mriLumbarRegions";

// ─── Cervical Spine ─────────────────────────────────────────────────────

export type MriCervicalRegionKey =
  | "C2-C3"
  | "C3-C4"
  | "C4-C5"
  | "C5-C6"
  | "C6-C7"
  | "C7-T1"
  | "alignment"
  | "vertebral-marrow"
  | "cord"
  | "posterior-elements"
  | "paraspinal";

export type MriCervicalRegionDef = {
  key: MriCervicalRegionKey;
  label: string;
  kind: "disc-level" | "region";
  conflictGroup?: string;
};

export const MRI_CERVICAL_DISC_LEVELS: MriCervicalRegionDef[] = [
  { key: "C2-C3", label: "C2-C3", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "C3-C4", label: "C3-C4", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "C4-C5", label: "C4-C5", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "C5-C6", label: "C5-C6", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "C6-C7", label: "C6-C7", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "C7-T1", label: "C7-T1", kind: "disc-level", conflictGroup: "disc_contour" },
];

export const MRI_CERVICAL_EXTRA_REGIONS: MriCervicalRegionDef[] = [
  { key: "alignment", label: "Alignment", kind: "region", conflictGroup: "alignment" },
  { key: "vertebral-marrow", label: "Vertebral bodies / marrow", kind: "region", conflictGroup: "endplate" },
  { key: "cord", label: "Cord / Cervico-medullary junction", kind: "region", conflictGroup: "cord" },
  { key: "posterior-elements", label: "Posterior elements / facets", kind: "region", conflictGroup: "facet_joint" },
  { key: "paraspinal", label: "Paraspinal soft tissues", kind: "region", conflictGroup: "paraspinal" },
];

export const MRI_CERVICAL_ALL_REGIONS: MriCervicalRegionDef[] = [
  ...MRI_CERVICAL_DISC_LEVELS,
  ...MRI_CERVICAL_EXTRA_REGIONS,
];

// ─── Dorsal Spine ───────────────────────────────────────────────────────

export type MriDorsalRegionKey =
  | "T1-T2"
  | "T2-T3"
  | "T3-T4"
  | "T4-T5"
  | "T5-T6"
  | "T6-T7"
  | "T7-T8"
  | "T8-T9"
  | "T9-T10"
  | "T10-T11"
  | "T11-T12"
  | "T12-L1"
  | "alignment"
  | "vertebral-marrow"
  | "cord"
  | "posterior-elements"
  | "paraspinal";

export type MriDorsalRegionDef = {
  key: MriDorsalRegionKey;
  label: string;
  kind: "disc-level" | "region";
  conflictGroup?: string;
};

export const MRI_DORSAL_DISC_LEVELS: MriDorsalRegionDef[] = [
  { key: "T1-T2", label: "T1-T2", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T2-T3", label: "T2-T3", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T3-T4", label: "T3-T4", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T4-T5", label: "T4-T5", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T5-T6", label: "T5-T6", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T6-T7", label: "T6-T7", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T7-T8", label: "T7-T8", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T8-T9", label: "T8-T9", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T9-T10", label: "T9-T10", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T10-T11", label: "T10-T11", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T11-T12", label: "T11-T12", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "T12-L1", label: "T12-L1", kind: "disc-level", conflictGroup: "disc_contour" },
];

export const MRI_DORSAL_EXTRA_REGIONS: MriDorsalRegionDef[] = [
  { key: "alignment", label: "Alignment", kind: "region", conflictGroup: "alignment" },
  { key: "vertebral-marrow", label: "Vertebral bodies / marrow", kind: "region", conflictGroup: "endplate" },
  { key: "cord", label: "Cord / Conus", kind: "region", conflictGroup: "cord" },
  { key: "posterior-elements", label: "Posterior elements / facets", kind: "region", conflictGroup: "facet_joint" },
  { key: "paraspinal", label: "Paraspinal soft tissues", kind: "region", conflictGroup: "paraspinal" },
];

export const MRI_DORSAL_ALL_REGIONS: MriDorsalRegionDef[] = [
  ...MRI_DORSAL_DISC_LEVELS,
  ...MRI_DORSAL_EXTRA_REGIONS,
];

// ─── Cervical root inference ────────────────────────────────────────────

/** Prefill suggestion for cervical exiting root — user may override. */
export function inferCervicalExitingRoot(level: string): string {
  const m = level.toUpperCase().match(/C(\d)/);
  if (!m) return "nerve";
  return `C${m[1]}`;
}

/** Prefill suggestion for cervical traversing root — user may override. */
export function inferCervicalTraversingRoot(level: string): string {
  // For C7-T1, the traversing root is T1 (C8 is the cervical root but T1 is the next thoracic)
  if (/C7.*T1/i.test(level)) return "T1";
  const m = level.toUpperCase().match(/C(\d+)/);
  if (!m) return "nerve";
  const n = Number(m[1]);
  if (n >= 7) return "C8";
  return `C${n + 1}`;
}

// ─── Dorsal root inference ──────────────────────────────────────────────

/** Prefill suggestion for dorsal exiting root. */
export function inferDorsalExitingRoot(level: string): string {
  const m = level.toUpperCase().match(/T(\d+)/);
  if (!m) return "nerve";
  return `T${m[1]}`;
}

/** Prefill suggestion for dorsal traversing root. */
export function inferDorsalTraversingRoot(level: string): string {
  const m = level.toUpperCase().match(/T(\d+)/);
  if (!m) return "nerve";
  const n = Number(m[1]);
  if (n >= 12) return "L1";
  return `T${n + 1}`;
}

// ─── Cervical canvas activation ────────────────────────────────────────

import { canonicalContentRegion, spineSegmentFromRegion, type SpineSegment } from "./reportingStudyContext";

export function isMriCervicalReportingContext(opts: {
  modality?: string | null;
  region?: string | null;
  family?: string | null;
  spineSegment?: string | null;
  protocolName?: string | null;
  studyDescription?: string | null;
}): boolean {
  const mod = (opts.modality ?? "").toUpperCase();
  if (mod && mod !== "MR" && mod !== "MRI") return false;

  const regionRaw = (opts.region ?? "").trim();
  const canonical = canonicalContentRegion(regionRaw);
  const seg: SpineSegment | null =
    (opts.spineSegment as SpineSegment | null | undefined)
    ?? spineSegmentFromRegion(canonical || regionRaw);

  // Whole spine / screening → no detailed cervical canvas
  if (seg === "whole") return false;
  if (canonical === "Whole Spine" || /^whole\s*spine$/i.test(regionRaw)) return false;

  // Non-cervical segments
  if (seg === "lumbar" || seg === "dorsal") return false;
  if (canonical === "LS Spine" || canonical === "Dorsal Spine") return false;
  if (canonical === "Brain" || opts.family === "brain") return false;

  // Canonical Cervical Spine
  if (canonical === "Cervical Spine") return true;
  if (seg === "cervical") return true;

  // Last resort: exact cervical names
  const region = regionRaw.toLowerCase();
  if (
    region === "cervical spine"
    || region === "c spine"
    || region === "cspine"
    || region === "c-spine"
    || region === "c spine"
  ) {
    return true;
  }
  return false;
}

export function isMriDorsalReportingContext(opts: {
  modality?: string | null;
  region?: string | null;
  family?: string | null;
  spineSegment?: string | null;
  protocolName?: string | null;
  studyDescription?: string | null;
}): boolean {
  const mod = (opts.modality ?? "").toUpperCase();
  if (mod && mod !== "MR" && mod !== "MRI") return false;

  const regionRaw = (opts.region ?? "").trim();
  const canonical = canonicalContentRegion(regionRaw);
  const seg: SpineSegment | null =
    (opts.spineSegment as SpineSegment | null | undefined)
    ?? spineSegmentFromRegion(canonical || regionRaw);

  if (seg === "whole") return false;
  if (canonical === "Whole Spine" || /^whole\s*spine$/i.test(regionRaw)) return false;
  if (seg === "lumbar" || seg === "cervical") return false;
  if (canonical === "LS Spine" || canonical === "Cervical Spine") return false;
  if (canonical === "Brain" || opts.family === "brain") return false;

  if (canonical === "Dorsal Spine") return true;
  if (seg === "dorsal") return true;

  const region = regionRaw.toLowerCase();
  if (
    region === "dorsal spine"
    || region === "thoracic spine"
    || region === "d spine"
    || region === "t spine"
    || region === "dorsolumbar spine"
    || region === "dl spine"
  ) {
    return true;
  }
  return false;
}

// ─── AP Canal measurement levels ────────────────────────────────────────

export const CERVICAL_AP_LEVELS = ["C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7"] as const;
export const LUMBAR_AP_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"] as const;
export const DORSAL_AP_LEVELS = ["T1-T2", "T2-T3", "T3-T4", "T4-T5", "T5-T6", "T6-T7", "T7-T8", "T8-T9", "T9-T10", "T10-T11", "T11-T12", "T12-L1"] as const;

export type SpineApLevel = {
  level: string;
  value: number | null;
};

export type SpineApMeasurementSet = {
  segment: "cervical" | "lumbar" | "dorsal";
  levels: SpineApLevel[];
};

export function createCervicalApSet(): SpineApMeasurementSet {
  return {
    segment: "cervical",
    levels: CERVICAL_AP_LEVELS.map((level) => ({ level, value: null })),
  };
}

export function createLumbarApSet(): SpineApMeasurementSet {
  return {
    segment: "lumbar",
    levels: LUMBAR_AP_LEVELS.map((level) => ({ level, value: null })),
  };
}

export function createDorsalApSet(): SpineApMeasurementSet {
  return {
    segment: "dorsal",
    levels: DORSAL_AP_LEVELS.map((level) => ({ level, value: null })),
  };
}

export function formatApMeasurements(set: SpineApMeasurementSet): string {
  const parts = set.levels
    .filter((l) => l.value != null && Number.isFinite(l.value))
    .map((l) => `${l.level}: ${l.value} mm`);
  if (parts.length === 0) return "";
  const label = set.segment === "cervical"
    ? "Cervical Canal AP Diameter"
    : set.segment === "dorsal"
      ? "Dorsal Canal AP Diameter"
      : "Lumbar Canal AP Diameter";
  return `${label}\n${parts.join(" · ")}`;
}

// ─── Re-exports for canvas components ───────────────────────────────────

export {
  DISC_MORPHOLOGY_OPTIONS,
  LATERALITY_OPTIONS,
  CANAL_STENOSIS_OPTIONS,
  FORAMINAL_LATERALITY_OPTIONS,
  FORAMINAL_SEVERITY_OPTIONS,
  MODIC_OPTIONS,
  ROOT_RELATION_OPTIONS,
  type LumbarLevelSelection,
};
