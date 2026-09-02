/**
 * Chocolate macro ownership — same vocabulary as Quick Select / pathologyPatch.
 * Explicit metadata is preferred; weak inference is never auto-persisted.
 */

export type MacroSectionsOwned = Array<"findings" | "impression" | "recommendation" | "technique">;

export type ChocolateOwnership = {
  /** Explicit canonical concept (preferred). See conceptCanon/contentPacks.ts. */
  concept?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  supportsLaterality?: boolean;
  sectionsOwned?: MacroSectionsOwned;
  /** When true, treat as append-only (no ownership replace). */
  legacyAppend?: boolean;
};

/** High-confidence built-in ownership only — never auto-assign from weak text. */
const EXPLICIT_BUILTIN: Record<string, ChocolateOwnership> = {
  "brain-infarct": {
    concept: "infarct",
    anatomicalSection: "mca",
    conflictGroup: "infarct",
    baselineReplaces: "No focal cortical or subcortical signal abnormality, mass lesion, or acute infarct identified",
    supportsLaterality: true,
    sectionsOwned: ["findings", "impression"],
  },
  "brain-pituitary": {
    concept: "pituitary",
    anatomicalSection: "pituitary",
    conflictGroup: "pituitary",
    supportsLaterality: false,
    sectionsOwned: ["findings", "impression"],
  },
  "brain-normal": {
    concept: "normal_study",
    anatomicalSection: "brain parenchyma",
    conflictGroup: "normal-brain",
    supportsLaterality: false,
    sectionsOwned: ["findings"],
    legacyAppend: false,
  },
  "spine-disc-bulge": {
    concept: "disc_contour",
    anatomicalSection: "disc",
    conflictGroup: "disc-bulge",
    supportsLaterality: true,
    sectionsOwned: ["findings"],
  },
  "spine-normal": {
    concept: "normal_study",
    anatomicalSection: "disc",
    conflictGroup: "normal-spine",
    supportsLaterality: false,
    sectionsOwned: ["findings"],
  },
};

export function builtinOwnershipForTileId(id: string): ChocolateOwnership | undefined {
  return EXPLICIT_BUILTIN[id];
}

/**
 * Resolve ownership for merge:
 * 1) explicit tile metadata
 * 2) high-confidence built-in map by id
 * 3) otherwise legacy append (caller must not run replace)
 */
export function resolveChocolateOwnership(
  tile: { id: string; label?: string } & ChocolateOwnership,
): { ownership: ChocolateOwnership; mode: "explicit" | "builtin" | "legacy-append" } {
  const hasExplicit = Boolean(
    (tile.concept ?? "").trim()
    || (tile.anatomicalSection ?? "").trim()
    || (tile.conflictGroup ?? "").trim()
    || (tile.baselineReplaces ?? "").trim(),
  );
  if (hasExplicit && !tile.legacyAppend) {
    return {
      ownership: {
        concept: tile.concept,
        anatomicalSection: tile.anatomicalSection,
        conflictGroup: tile.conflictGroup,
        baselineReplaces: tile.baselineReplaces,
        supportsLaterality: tile.supportsLaterality,
        sectionsOwned: tile.sectionsOwned ?? ["findings"],
      },
      mode: "explicit",
    };
  }
  const builtin = builtinOwnershipForTileId(tile.id);
  if (builtin) return { ownership: { ...builtin }, mode: "builtin" };
  return {
    ownership: { legacyAppend: true, sectionsOwned: ["findings"] },
    mode: "legacy-append",
  };
}

export function chocolateSetToBodyPart(setKey: string): string {
  switch (setKey) {
    case "brain": return "Brain";
    case "cervical": return "Cervical Spine";
    case "dorsal": return "Dorsal Spine";
    case "lumbar": return "LS Spine";
    case "whole-spine": return "Whole Spine";
    case "spine": return "Spine";
    default: return setKey;
  }
}

export function chocolateSetToModality(setKey: string): string {
  void setKey;
  return "MR";
}
