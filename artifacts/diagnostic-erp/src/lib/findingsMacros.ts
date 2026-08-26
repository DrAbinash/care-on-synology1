// "Chocolate Box" quick-macro engine for the freeform Findings & Observation
// editor — context-aware macro sets keyed off the resolved ReportingStudyContext
// (radiology_study_tabs.name), each tile's text inserted at the live cursor
// position (see insertAtCursor below), with any [bracketed] variable auto-selected
// for immediate typing/dictation overwrite.
//
// These are DRAFT narrative starting points, same spirit as every other
// template/macro/snippet mechanism already in this workspace (Templates
// tab, Normal Shortcuts, applyMacro) — inserted text is always reviewed
// and edited by the radiologist before Finalize, never auto-signed.
//
// Study association is NOT done by re-parsing modality + StudyDescription.
// Callers pass the already-resolved ReportingStudyContext. Generic Spine is
// only an inherited fallback under a specific spine segment.
//
// Built-in tiles ship as defaults. Radiologists can add / edit / delete
// boxes from the reporting workspace (pencil + blank add box) and from
// Settings → Radiology → Quick Select. Customisations persist in
// localStorage (with an in-memory fallback for tests / private mode).

import type { ReportingStudyContext } from "./reportingStudyContext";
import {
  builtinOwnershipForTileId,
  type ChocolateOwnership,
  type MacroSectionsOwned,
} from "./chocolateMacroOwnership";

export type MacroObservationSpec = {
  concept?: string;
  conflictGroup?: string;
  anatomicalSection?: string;
  level?: string;
  laterality?: string;
  findingsText: string;
  impressionText?: string;
  recommendationText?: string;
  baselineReplaces?: string;
  supportsLaterality?: boolean;
  sectionsOwned?: MacroSectionsOwned;
};

export type ChocolateTile = {
  id: string;
  label: string;
  text: string;
  custom?: boolean;
  /** Server row id when synced to radiology_chocolate_findings. */
  serverId?: number;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  supportsLaterality?: boolean;
  sectionsOwned?: MacroSectionsOwned;
  /** Append-only legacy/generic macro (no pathology replace). */
  legacyAppend?: boolean;
  impressionText?: string;
  /** Atomic observations sharing one bundleId when this macro is applied. */
  observations?: MacroObservationSpec[];
};
export type ChocolateBoxSet = { key: string; label: string; tiles: ChocolateTile[] };

type StoredSets = Record<string, ChocolateTile[]>;

const BRAIN_SET: ChocolateBoxSet = {
  key: "brain",
  label: "Brain",
  tiles: [
    {
      id: "brain-infarct",
      label: "Infarct",
      text: "Focal area of restricted diffusion with corresponding T2/FLAIR hyperintensity in the [location], consistent with an acute infarct involving the [vascular territory] territory.",
      impressionText: "Acute infarct in the [vascular territory] territory.",
      ...builtinOwnershipForTileId("brain-infarct"),
    },
    {
      id: "brain-senile",
      label: "Senile Changes",
      text: "Mild age-related cerebral volume loss with prominence of the cortical sulci and ventricular system, in keeping with senile/involutional changes. No focal mass lesion or acute infarct.",
      legacyAppend: true,
    },
    {
      id: "brain-pituitary",
      label: "Pituitary Tumor",
      text: "The pituitary gland is enlarged, measuring approximately [size] cm, with a [homogeneous/heterogeneous] lesion suggestive of a pituitary macroadenoma. [Optic chiasm/cavernous sinus] involvement [is/is not] noted.",
      ...builtinOwnershipForTileId("brain-pituitary"),
    },
    {
      id: "brain-normal",
      label: "Normal Brain",
      text: "Grey-white matter differentiation is preserved. No focal cortical or subcortical signal abnormality, mass lesion, or acute infarct identified. Ventricles and sulci are normal for age.",
      ...builtinOwnershipForTileId("brain-normal"),
    },
    {
      id: "brain-basal-ganglia-hemorrhage",
      label: "Basal Ganglia Hemorrhage",
      text: "Acute intraparenchymal hemorrhage in the {side} basal ganglia with surrounding edema. Mass effect with midline shift of ___ mm.",
      impressionText: "Acute {side} basal ganglia hemorrhage.",
      anatomicalSection: "basal ganglia",
      conflictGroup: "hemorrhage",
      baselineReplaces: "Basal ganglia are normal",
      supportsLaterality: true,
      sectionsOwned: ["findings", "impression"],
    },
  ],
};

/** Shared spine tiles — inherited by cervical / dorsal / lumbar / whole. */
const SPINE_COMMON_TILES: ChocolateTile[] = [
  {
    id: "spine-disc-bulge",
    label: "Disc Bulge",
    text: "Diffuse disc bulge at the [Level] level indenting the anterior thecal sac, [with/without] impingement on the [exiting nerve root].",
    ...builtinOwnershipForTileId("spine-disc-bulge"),
  },
  {
    id: "spine-desiccation",
    label: "Disc Desiccation",
    text: "Loss of normal T2 signal intensity (desiccation) of the intervertebral disc at [Level], in keeping with early degenerative disc disease.",
    legacyAppend: true,
  },
  {
    id: "spine-degenerative",
    label: "Degenerative Changes",
    text: "Degenerative disc disease of the lumbar spine with disc desiccation, reduced disc height, marginal osteophytes, facet arthropathy, and endplate changes.",
    impressionText: "Lumbar degenerative disc disease.",
    observations: [
      {
        concept: "disc_signal",
        conflictGroup: "disc_signal",
        findingsText: "Lumbar discs show loss of T2 signal (desiccation).",
        sectionsOwned: ["findings"],
      },
      {
        concept: "disc_height",
        conflictGroup: "disc_height",
        level: "L4-L5",
        findingsText: "Disc height is reduced at L4-L5.",
        sectionsOwned: ["findings"],
      },
      {
        concept: "osteophytes",
        conflictGroup: "osteophytes",
        findingsText: "Marginal osteophytes are present at the lumbar vertebral endplates.",
        sectionsOwned: ["findings"],
      },
      {
        concept: "facet_joint",
        conflictGroup: "facet_joint",
        level: "L4-L5",
        findingsText: "Facet arthropathy at L4-L5.",
        sectionsOwned: ["findings"],
      },
      {
        concept: "endplate",
        conflictGroup: "endplate",
        level: "L4-L5",
        findingsText: "Modic type endplate changes at L4-L5.",
        sectionsOwned: ["findings"],
      },
    ],
  },
  {
    id: "spine-normal",
    label: "Normal Spine",
    text: "Vertebral body heights and alignment are maintained throughout. No disc bulge, herniation, or significant canal/foraminal stenosis identified. Visualized cord/cauda equina and paraspinal soft tissues are unremarkable.",
    ...builtinOwnershipForTileId("spine-normal"),
  },
];

const CERVICAL_TILES: ChocolateTile[] = [
  {
    id: "cervical-c5-6",
    label: "C5-6 Level",
    text: "At the C5-6 level: vertebral body height and alignment are maintained. Disc space is [normal/reduced]. [Findings].",
  },
];

const DORSAL_TILES: ChocolateTile[] = [
  {
    id: "dorsal-d7-8",
    label: "D7-8 Level",
    text: "At the D7-8 level: vertebral body height and alignment are maintained. Disc space is [normal/reduced]. [Findings].",
  },
];

const LUMBAR_TILES: ChocolateTile[] = [
  {
    id: "spine-l1-2",
    label: "L1-2 Level",
    text: "At the L1-2 level: vertebral body height and alignment are maintained. Disc space is [normal/reduced]. [Findings].",
  },
];

function box(key: string, label: string, extra: ChocolateTile[]): ChocolateBoxSet {
  return { key, label, tiles: [...extra, ...SPINE_COMMON_TILES] };
}

const CERVICAL_SET = box("cervical", "Cervical Spine", CERVICAL_TILES);
const DORSAL_SET = box("dorsal", "Dorsal Spine", DORSAL_TILES);
const LUMBAR_SET = box("lumbar", "LS Spine", LUMBAR_TILES);
const WHOLE_SET = box("whole-spine", "Whole Spine", []);
const SPINE_GENERIC_SET: ChocolateBoxSet = {
  key: "spine",
  label: "Spine",
  tiles: SPINE_COMMON_TILES,
};

const SETS: ChocolateBoxSet[] = [
  BRAIN_SET,
  CERVICAL_SET,
  DORSAL_SET,
  LUMBAR_SET,
  WHOLE_SET,
  SPINE_GENERIC_SET,
];

const STORAGE_KEY = "care-rad-chocolate-boxes-v1";
export const CHOCOLATE_BOX_CHANGED = "care:chocolate-box-changed";

let memoryStore: StoredSets = {};

function uid(): string {
  return `cb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function slug(value: string): string {
  const s = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s || "custom";
}

function readLocal(): StoredSets | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSets;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function readStore(): StoredSets {
  return { ...memoryStore, ...(readLocal() ?? {}) };
}

function writeStore(store: StoredSets): void {
  memoryStore = { ...store };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }
  } catch {
    /* private mode / quota */
  }
  try {
    window.dispatchEvent(new Event(CHOCOLATE_BOX_CHANGED));
  } catch {
    /* SSR / tests */
  }
}

export function resetAllChocolateBoxes(): void {
  memoryStore = {};
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function catalogSetForKey(key: string): ChocolateBoxSet | undefined {
  return SETS.find((s) => s.key === key);
}

export function defaultsForKey(key: string): ChocolateTile[] {
  return (catalogSetForKey(key)?.tiles ?? []).map((t) => ({ ...t }));
}

function hydrateTile(raw: Partial<ChocolateTile> & { id: string; label: string; text: string }): ChocolateTile {
  const builtin = builtinOwnershipForTileId(raw.id);
  return {
    ...builtin,
    ...raw,
    anatomicalSection: raw.anatomicalSection ?? builtin?.anatomicalSection,
    conflictGroup: raw.conflictGroup ?? builtin?.conflictGroup,
    baselineReplaces: raw.baselineReplaces ?? builtin?.baselineReplaces,
    supportsLaterality: raw.supportsLaterality ?? builtin?.supportsLaterality,
    sectionsOwned: raw.sectionsOwned ?? builtin?.sectionsOwned,
    legacyAppend: raw.legacyAppend ?? builtin?.legacyAppend,
  };
}

export function loadChocolateTiles(key: string): ChocolateTile[] {
  const stored = readStore()[key];
  if (Array.isArray(stored)) return stored.map((t) => hydrateTile(t as ChocolateTile));
  return defaultsForKey(key);
}

export function saveChocolateTiles(key: string, tiles: ChocolateTile[]): void {
  const store = readStore();
  store[key] = tiles.map((t) => ({ ...t }));
  writeStore(store);
}

export function upsertChocolateTile(
  key: string,
  input: {
    id?: string;
    label: string;
    text: string;
    impressionText?: string;
  } & ChocolateOwnership,
): ChocolateTile {
  const label = input.label.trim();
  const text = input.text.trim();
  const tiles = loadChocolateTiles(key);
  const ownership: ChocolateOwnership = {
    anatomicalSection: input.anatomicalSection,
    conflictGroup: input.conflictGroup,
    baselineReplaces: input.baselineReplaces,
    supportsLaterality: input.supportsLaterality,
    sectionsOwned: input.sectionsOwned,
    legacyAppend: input.legacyAppend,
  };
  if (input.id) {
    const i = tiles.findIndex((t) => t.id === input.id);
    if (i >= 0) {
      tiles[i] = {
        ...tiles[i],
        label,
        text,
        impressionText: input.impressionText ?? tiles[i].impressionText,
        ...ownership,
      };
      saveChocolateTiles(key, tiles);
      return tiles[i];
    }
  }
  const next: ChocolateTile = {
    id: input.id || uid(),
    label,
    text,
    custom: true,
    impressionText: input.impressionText,
    ...ownership,
    legacyAppend: ownership.legacyAppend ?? !(
      (ownership.anatomicalSection ?? "").trim()
      || (ownership.conflictGroup ?? "").trim()
    ),
  };
  tiles.push(next);
  saveChocolateTiles(key, tiles);
  return next;
}

export function deleteChocolateTile(key: string, id: string): void {
  saveChocolateTiles(
    key,
    loadChocolateTiles(key).filter((t) => t.id !== id),
  );
}

export function resetChocolateTiles(key: string): void {
  const store = readStore();
  delete store[key];
  writeStore(store);
}

/**
 * Picks the catalog macro set for the already-resolved study context.
 * Unknown / unmatched studies return null (no unrelated clinical tiles).
 * `tiles` here are the built-in defaults — call `loadChocolateTiles(set.key)`
 * (or `resolvedChocolateBoxSet`) for the workstation's edited list.
 */
export function chocolateBoxSetFor(ctx: ReportingStudyContext | null | undefined): ChocolateBoxSet | null {
  if (!ctx?.region) return null;
  if (ctx.family === "brain") return BRAIN_SET;
  if (ctx.family === "spine") {
    switch (ctx.spineSegment) {
      case "cervical": return CERVICAL_SET;
      case "dorsal": return DORSAL_SET;
      case "lumbar": return LUMBAR_SET;
      case "whole": return WHOLE_SET;
      default: return SPINE_GENERIC_SET;
    }
  }
  return null;
}

/**
 * Always returns a set so Findings can show the blank "add macro" box even
 * when the study is not Brain/Spine. Custom keys persist independently.
 */
export function resolvedChocolateBoxSet(
  ctx: ReportingStudyContext | null | undefined,
): ChocolateBoxSet {
  const catalog = chocolateBoxSetFor(ctx);
  if (catalog) {
    return { ...catalog, tiles: loadChocolateTiles(catalog.key) };
  }
  const label = ctx?.region?.trim() || "Findings";
  const key = slug(label);
  return { key, label, tiles: loadChocolateTiles(key) };
}

export function allChocolateBoxSets(): ChocolateBoxSet[] {
  return SETS;
}

export function listedChocolateBoxSets(): ChocolateBoxSet[] {
  const storedKeys = Object.keys(readStore());
  const extras = storedKeys.filter((k) => !SETS.some((s) => s.key === k));
  return [
    ...SETS.map((s) => ({ ...s, tiles: loadChocolateTiles(s.key) })),
    ...extras.map((k) => ({ key: k, label: k, tiles: loadChocolateTiles(k) })),
  ];
}

/**
 * Splices `insertText` into `currentValue` at the given textarea's cursor
 * (falls back to appending at the end if the element/selection isn't
 * available). Calls `onChange` with the new full value, then — after
 * React has re-rendered the controlled textarea with that value — restores
 * focus and either:
 *   - selects the FIRST `[bracketed]` variable in the inserted text (so the
 *     radiologist can immediately type or voice-dictate over it), or
 *   - places a plain caret right after the inserted text.
 */
export function insertAtCursor(
  el: HTMLTextAreaElement | null,
  currentValue: string,
  insertText: string,
  onChange: (next: string) => void,
) {
  const start = el?.selectionStart ?? currentValue.length;
  const end = el?.selectionEnd ?? currentValue.length;
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const separator = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
  const spliced = separator + insertText;
  const next = before + spliced + after;
  onChange(next);

  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    const bracketMatch = spliced.match(/\[[^\]]*\]/);
    if (bracketMatch && bracketMatch.index != null) {
      const selStart = start + bracketMatch.index;
      const selEnd = selStart + bracketMatch[0].length;
      el.setSelectionRange(selStart, selEnd);
    } else {
      const caret = start + spliced.length;
      el.setSelectionRange(caret, caret);
    }
  });
}
