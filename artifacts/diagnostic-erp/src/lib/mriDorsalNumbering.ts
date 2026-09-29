/**
 * mriDorsalNumbering.ts — the dorsal/thoracic level resolver (spec §4).
 *
 * Thoracic reporting has a different failure mode from lumbar: the risk is not
 * a transitional vertebra, it is *acquired coverage*. A dedicated dorsal study
 * commonly stops at T10 or T11, and the thoracolumbar junction (T12-L1) plus the
 * conus may or may not be inside the field of view. If the software assumes a
 * fixed twelve-level list, the report claims levels that were never acquired and
 * emits a normal conus sentence for a study that never showed the conus.
 *
 * One resolver owns the active level list, the AP canal rows, the conus
 * availability answer and the numbering-confidence caveat; every consumer (UI
 * rows, ledger ownership keys, findings prose, impression references, screening
 * level chips, presets and validators) reads it. No component may keep its own
 * level array.
 *
 * Pure functions only — no store, no React.
 */

import { displayLevel, normalizeLevel } from "./observationSlot";

export type DorsalNumberingMode =
  | "localizer-confirmed"
  | "cervicothoracic-landmark"
  | "thoracolumbar-landmark"
  | "manual"
  | "uncertain";

/** How far the acquired series actually reaches. */
export type DorsalCoverageExtent =
  | "upper"           // T1-T2 … T9-T10
  | "complete"        // T1-T2 … T11-T12
  | "thoracolumbar";  // T1-T2 … T11-T12 plus the T12-L1 junction

export type DorsalLevelKey = {
  key: string;
  label: string;
  /** True for the thoracolumbar junction level. */
  junction?: boolean;
};

export type DorsalNumberingState = {
  mode: DorsalNumberingMode;
  coverage: DorsalCoverageExtent;
  /** A whole-spine or dedicated localizer supports absolute numbering. */
  wholeSpineLocalizer?: boolean;
  /** Manual override wording, e.g. "lowest rib-bearing vertebra taken as T12". */
  designationNote?: string | null;
};

export const DORSAL_NUMBERING_MODES: Array<{
  id: DorsalNumberingMode;
  label: string;
  hint: string;
}> = [
  {
    id: "localizer-confirmed",
    label: "Whole-spine / localizer confirmed",
    hint: "Levels counted from a whole-spine localizer or cervico-thoraco-lumbar survey.",
  },
  {
    id: "cervicothoracic-landmark",
    label: "Cervicothoracic landmark counting",
    hint: "Numbering starts from the C7/T1 junction seen on the acquired series.",
  },
  {
    id: "thoracolumbar-landmark",
    label: "Thoracolumbar landmark counting",
    hint: "Numbering is taken upward from the last rib-bearing vertebra.",
  },
  {
    id: "manual",
    label: "Stated by the reporting radiologist",
    hint: "Level naming is asserted manually in the report.",
  },
  {
    id: "uncertain",
    label: "Numbering uncertain",
    hint: "No reliable landmark supports absolute vertebral level assignment.",
  },
];

export const DORSAL_COVERAGE_OPTIONS: Array<{
  id: DorsalCoverageExtent;
  label: string;
  hint: string;
}> = [
  { id: "upper", label: "Upper / mid thoracic (to T9-T10)", hint: "Conus not covered." },
  { id: "complete", label: "Complete thoracic (to T11-T12)", hint: "Conus not covered." },
  { id: "thoracolumbar", label: "Includes thoracolumbar junction (T12-L1)", hint: "Conus may be assessed when visualised." },
];

const THORACIC_PAIRS = [
  "T1-T2", "T2-T3", "T3-T4", "T4-T5", "T5-T6", "T6-T7",
  "T7-T8", "T8-T9", "T9-T10", "T10-T11", "T11-T12",
];

const JUNCTION_KEY = "T12-L1";

export function defaultDorsalNumbering(): DorsalNumberingState {
  return { mode: "cervicothoracic-landmark", coverage: "complete", wholeSpineLocalizer: false };
}

/**
 * The active disc-level keys. Coverage decides whether the thoracolumbar
 * junction exists at all — a level that was not acquired is never offered.
 */
export function dorsalLevelKeys(n: DorsalNumberingState | null | undefined): DorsalLevelKey[] {
  const state = n ?? defaultDorsalNumbering();
  const pairs = state.coverage === "upper" ? THORACIC_PAIRS.slice(0, 9) : THORACIC_PAIRS;
  const keys: DorsalLevelKey[] = pairs.map((key) => ({ key, label: key }));
  if (state.coverage === "thoracolumbar") {
    keys.push({ key: JUNCTION_KEY, label: JUNCTION_KEY, junction: true });
  }
  return keys;
}

export function dorsalLevelKeyStrings(n: DorsalNumberingState | null | undefined): string[] {
  return dorsalLevelKeys(n).map((k) => k.key);
}

/** Levels at which the AP canal table is offered (same resolver, never a fixed list). */
export function dorsalApCanalLevels(n: DorsalNumberingState | null | undefined): string[] {
  return dorsalLevelKeyStrings(n);
}

export function isJunctionLevelKey(key: string, n: DorsalNumberingState | null | undefined): boolean {
  return dorsalLevelKeys(n).some((k) => k.key === key && k.junction === true);
}

/**
 * True only when the acquired coverage actually reaches the conus. Every conus
 * sentence — including the normal one — is gated on this (spec §12, §25).
 */
export function conusCovered(n: DorsalNumberingState | null | undefined): boolean {
  return (n ?? defaultDorsalNumbering()).coverage === "thoracolumbar";
}

/** True when the thoracolumbar junction is inside the field of view. */
export function junctionCovered(n: DorsalNumberingState | null | undefined): boolean {
  return conusCovered(n);
}

/** The highest labelled level, used by coverage wording. */
export function dorsalTopLevelLabel(n: DorsalNumberingState | null | undefined): string {
  const keys = dorsalLevelKeys(n);
  return keys[keys.length - 1]?.label ?? "T11-T12";
}

/**
 * Amber banner for the canvas header. Naming the counting basis and the coverage
 * limit is a safety statement, not a clinical finding.
 */
export function dorsalNumberingBanner(n: DorsalNumberingState | null | undefined): string | null {
  const state = n ?? defaultDorsalNumbering();
  const mode = DORSAL_NUMBERING_MODES.find((m) => m.id === state.mode);
  const parts = [`Numbering: ${mode?.label ?? state.mode}`, `Coverage: T1-T2 → ${dorsalTopLevelLabel(state)}`];
  if (!state.wholeSpineLocalizer && state.mode !== "localizer-confirmed") {
    parts.push("no whole-spine localizer — level certainty reduced");
  }
  if (state.mode === "uncertain") parts.push("absolute levels require review before finalization");
  return parts.join(" · ");
}

/**
 * Report-visible numbering caveat. Emitted only when the basis genuinely reduces
 * certainty, so a standard localizer-confirmed study stays clean.
 */
export function dorsalNumberingCautionSentence(n: DorsalNumberingState | null | undefined): string {
  const state = n ?? defaultDorsalNumbering();
  const localizer = state.wholeSpineLocalizer === true || state.mode === "localizer-confirmed";
  const parts: string[] = [];
  if (state.mode === "cervicothoracic-landmark") {
    parts.push("Thoracic levels are numbered from the cervicothoracic junction on the acquired series.");
  } else if (state.mode === "thoracolumbar-landmark") {
    parts.push("Thoracic levels are numbered from the last rib-bearing vertebra on the acquired series.");
  } else if (state.mode === "manual") {
    const note = (state.designationNote ?? "").trim();
    parts.push(note ? `Vertebral numbering is as stated by the reporting radiologist (${note}).`
      : "Vertebral numbering is as stated by the reporting radiologist.");
  } else if (state.mode === "uncertain") {
    parts.push("Absolute vertebral level assignment is uncertain on this examination.");
  }
  if (!localizer && state.mode !== "uncertain") {
    parts.push("A whole-spine or dedicated localizer was not available, so absolute vertebral level assignment carries reduced certainty.");
  }
  if (state.coverage !== "thoracolumbar") {
    parts.push(
      `Acquired coverage extends to ${dorsalTopLevelLabel(state)}; levels below the acquired field of view were not assessed.`,
    );
  }
  return parts.join(" ");
}

/** True when level naming must be re-checked across the report (validator hook). */
export function dorsalNumberingNeedsConsistencyCheck(n: DorsalNumberingState | null | undefined): boolean {
  const state = n ?? defaultDorsalNumbering();
  return state.mode === "uncertain" || (!state.wholeSpineLocalizer && state.mode !== "localizer-confirmed");
}

/**
 * A level key outside the acquired coverage is a safety defect, not a clinical
 * opinion — the resolver will not silently accept it.
 */
export function isDorsalLevelKeyAllowed(levelKey: string, n: DorsalNumberingState | null | undefined): boolean {
  const want = normalizeLevel(levelKey);
  if (!want) return false;
  return dorsalLevelKeys(n).some((k) => normalizeLevel(k.key) === want);
}

/**
 * Observations the current coverage cannot support. Changing coverage or the
 * numbering basis never re-labels an existing observation — the affected levels
 * are surfaced for explicit radiologist review before finalization (spec §4).
 */
export function dorsalObservationReviewWarnings(
  rows: Array<{ observation?: { level?: string }; ownership?: { anatomicalSection?: string | null } }>,
  numbering: DorsalNumberingState | null | undefined,
): string[] {
  const allowed = new Set(dorsalLevelKeys(numbering).map((k) => normalizeLevel(k.key)));
  const affected: string[] = [];
  for (const row of rows) {
    // CARE letters dorsal levels T or D; only those rows belong to this check.
    const raw = (row.observation?.level ?? row.ownership?.anatomicalSection ?? "").trim().toUpperCase();
    if (!/^[TD]\d/.test(raw)) continue;
    const canonical = normalizeLevel(raw);
    if (!canonical || allowed.has(canonical)) continue;
    affected.push(displayLevel(canonical));
  }
  const unique = [...new Set(affected)];
  if (unique.length === 0) return [];
  return [
    `Level naming: ${unique.length} dorsal observation${unique.length === 1 ? "" : "s"} (${unique.join(", ")}) `
      + "sit outside the acquired coverage. Review or remove them — the software never renumbers an existing observation.",
  ];
}

/** True while the radiologist has not changed the coverage / numbering at all. */
export function isDefaultDorsalNumbering(n: DorsalNumberingState | null | undefined): boolean {
  const d = defaultDorsalNumbering();
  const state = n ?? d;
  return state.mode === d.mode
    && state.coverage === d.coverage
    && !state.wholeSpineLocalizer
    && !(state.designationNote ?? "").trim();
}

/** Intercostal root wording for a level, deliberately number-free unless stated. */
export function dorsalRootDescription(levelKey: string): string {
  const upper = levelKey.split("-")[0] ?? "";
  if (/^T1[0-2]$/.test(upper)) return `the ${upper} nerve root at this level`;
  if (/^T\d$/.test(upper)) return `the intercostal nerve at this level`;
  return "the exiting nerve root at this level";
}
