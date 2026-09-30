/**
 * Lumbar vertebral numbering resolver (MRI Lumbar Sub-Master V3, spec §5).
 *
 * Transitional lumbosacral vertebra (LSTV) anatomy is the single highest-risk
 * failure mode in lumbar reporting: if the software silently assumes the lowest
 * mobile segment is L5-S1, every downstream level reference (level rows, AP
 * canal table, findings prose, impression, root mapping, screening) drifts by
 * one segment. One resolver owns the level-key array and every consumer reads
 * it — no component may hard-code a level list.
 */

export type LumbarNumberingMode =
  | "standard"
  | "lstv-sacralization"
  | "lstv-lumbarization"
  | "localizer-based"
  | "manual";

export type CastellviGrade = "I" | "IIa" | "IIb" | "IIIa" | "IIIb" | "IV";

export type LstvSide = "unilateral" | "bilateral";

export type LumbarNumberingState = {
  mode: LumbarNumberingMode;
  castellvi?: CastellviGrade | null;
  side?: LstvSide | null;
  /** Sacralization / lumbarization laterality wording is captured separately. */
  pseudoarthrosis?: boolean;
  reactiveMarrowChange?: boolean;
  /** A whole-spine or dedicated localizer supports absolute numbering. */
  wholeSpineLocalizer?: boolean;
  /** Manual override: label of the vertebra designated L5. */
  designatedL5Label?: string | null;
};

export type LumbarLevelKey = {
  /** Stable key used for ledger ownership, AP rows and slot identity. */
  key: string;
  /** Printed label. */
  label: string;
  /** True when this level sits at the transitional segment. */
  transitional?: boolean;
};

export const LUMBAR_NUMBERING_MODES: Array<{
  id: LumbarNumberingMode;
  label: string;
  hint: string;
}> = [
  { id: "standard", label: "Standard numbering", hint: "Five lumbar-type vertebrae; lowest mobile segment is L5-S1." },
  { id: "lstv-sacralization", label: "LSTV present (sacralization)", hint: "L5 partially or fully fused to the sacrum." },
  { id: "lstv-lumbarization", label: "LSTV present (lumbarization)", hint: "S1 retains lumbar-type morphology." },
  { id: "localizer-based", label: "Numbering based on whole-spine / localizer", hint: "Levels counted from a whole-spine localizer." },
  { id: "manual", label: "Other / manual", hint: "Numbering stated by the reporting radiologist." },
];

export const CASTELLVI_OPTIONS: Array<{ id: CastellviGrade; label: string }> = [
  { id: "I", label: "Castellvi I — enlarged transverse process (>19 mm)" },
  { id: "IIa", label: "Castellvi IIa — unilateral pseudoarthrosis" },
  { id: "IIb", label: "Castellvi IIb — bilateral pseudoarthrosis" },
  { id: "IIIa", label: "Castellvi IIIa — unilateral complete fusion" },
  { id: "IIIb", label: "Castellvi IIIb — bilateral complete fusion" },
  { id: "IV", label: "Castellvi IV — fusion on one side with pseudoarthrosis on the other" },
];

const STANDARD_KEYS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"];

export function defaultLumbarNumbering(): LumbarNumberingState {
  return { mode: "standard", castellvi: null, side: null, wholeSpineLocalizer: false };
}

/** Transitional anatomy or a manual/localizer scheme — anything but plain standard. */
export function isNonStandardNumbering(n: LumbarNumberingState | null | undefined): boolean {
  return (n?.mode ?? "standard") !== "standard";
}

/**
 * The active disc-level keys. Sacralization removes one mobile lumbar disc and
 * adds the transitional segment; lumbarization adds a sixth lumbar-type
 * segment. "Lowest prominent lumbar-type vertebra designated L5" keeps the
 * familiar L5-S1 label by design (designatedL5Label), so it is a manual mode
 * with standard keys plus the caution sentence.
 */
export function lumbarLevelKeys(n: LumbarNumberingState | null | undefined): LumbarLevelKey[] {
  const state = n ?? defaultLumbarNumbering();
  const toKeys = (list: string[]): LumbarLevelKey[] =>
    list.map((key) => ({ key, label: key }));

  if (state.mode === "lstv-sacralization") {
    return [
      ...toKeys(["L1-L2", "L2-L3", "L3-L4", "L4-L5"]),
      { key: "L5-T", label: "L5-T (transitional segment)", transitional: true },
    ];
  }
  if (state.mode === "lstv-lumbarization") {
    return [
      ...toKeys(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-L6"]),
      { key: "L6-S1", label: "L6-S1 (transitional segment)", transitional: true },
    ];
  }
  return toKeys(STANDARD_KEYS);
}

export function lumbarLevelKeyStrings(n: LumbarNumberingState | null | undefined): string[] {
  return lumbarLevelKeys(n).map((k) => k.key);
}

export function isTransitionalLevelKey(key: string, n: LumbarNumberingState | null | undefined): boolean {
  return lumbarLevelKeys(n).some((k) => k.key === key && k.transitional === true);
}

/** Levels at which the AP canal table is offered (same resolver, never a fixed list). */
export function lumbarApCanalLevels(n: LumbarNumberingState | null | undefined): string[] {
  return lumbarLevelKeyStrings(n);
}

/**
 * Expected nerve roots for a level key. Traversing root = the root passing to
 * the level below; exiting root = the root leaving above the disc. Suggestions
 * only — the radiologist always overrides.
 */
export function lumbarRootSuggestion(
  levelKey: string,
  n: LumbarNumberingState | null | undefined,
): { traversing: string; exiting: string; uncertain: boolean } {
  const state = n ?? defaultLumbarNumbering();
  const transitional = isTransitionalLevelKey(levelKey, state);
  const upper = levelKey.split("-")[0] ?? "";
  const upperNum = Number(upper.replace(/[^0-9]/g, ""));

  if (Number.isFinite(upperNum) && upperNum >= 5) {
    // At or below the transitional segment the root naming is not reliable
    // without a whole-spine localizer.
    const traversing = state.mode === "lstv-lumbarization" ? "S1" : "S1";
    return { traversing, exiting: upper, uncertain: transitional || !state.wholeSpineLocalizer };
  }
  if (!Number.isFinite(upperNum)) {
    return { traversing: "the traversing root", exiting: "the exiting root", uncertain: true };
  }
  return { traversing: `L${upperNum + 1}`, exiting: `L${upperNum}`, uncertain: false };
}

/** Conflict-group / observation id for a root so two roots at one level coexist (spec §8). */
export function lumbarRootConflictGroup(
  levelKey: string,
  root: string,
  kind: "traversing" | "exiting",
): string {
  const lvl = levelKey.replace(/\s+/g, "");
  const prefix = kind === "traversing" ? "root-trav" : "root-exit";
  return `${prefix}-${root}-${lvl}`;
}

export function lstvDescriptionPhrase(n: LumbarNumberingState | null | undefined): string {
  const state = n ?? defaultLumbarNumbering();
  if (state.mode !== "lstv-sacralization" && state.mode !== "lstv-lumbarization") return "";
  const kind = state.mode === "lstv-sacralization" ? "sacralization" : "lumbarization";
  const bits: string[] = [`transitional lumbosacral vertebra with ${kind}`];
  if (state.castellvi) bits.push(`Castellvi type ${state.castellvi}`);
  if (state.side) bits.push(state.side);
  if (state.pseudoarthrosis) bits.push("with pseudoarthrosis at the transitional articulation");
  if (state.reactiveMarrowChange) bits.push("with reactive marrow change adjacent to it");
  return bits.join(", ");
}

/**
 * Amber banner + composer caution. Deliberately says what was done rather than
 * asserting a specific vertebral count, so it stays true in every LSTV variant.
 */
export function numberingCautionSentence(n: LumbarNumberingState | null | undefined): string {
  const state = n ?? defaultLumbarNumbering();
  const lstv = lstvDescriptionPhrase(state);
  const parts: string[] = [];
  if (lstv) {
    parts.push(
      `Vertebral numbering: ${lstv}. Level designations assume this transitional anatomy, `
      + "and the lowest mobile segment may not correspond to the conventional L5-S1 level.",
    );
  } else if (state.mode === "localizer-based") {
    parts.push("Vertebral numbering is based on the whole-spine / localizer series.");
  } else if (state.mode === "manual") {
    const designated = (state.designatedL5Label ?? "").trim();
    parts.push(
      designated
        ? `Vertebral numbering is as stated by the reporting radiologist (${designated}).`
        : "Vertebral numbering is as stated by the reporting radiologist.",
    );
  }
  if (parts.length === 0) return "";
  if (!state.wholeSpineLocalizer && state.mode !== "standard") {
    parts.push(
      "A whole-spine or dedicated localizer was not available, so absolute vertebral level assignment carries reduced certainty.",
    );
  }
  return parts.join(" ");
}

/** Banner text shown in the canvas while non-standard numbering is active. */
export function numberingBanner(n: LumbarNumberingState | null | undefined): string | null {
  const state = n ?? defaultLumbarNumbering();
  if (state.mode === "standard") return null;
  const mode = LUMBAR_NUMBERING_MODES.find((m) => m.id === state.mode);
  const lstv = lstvDescriptionPhrase(state);
  const head = `Numbering: ${mode?.label ?? state.mode}`;
  const detail = lstv ? ` · ${lstv}` : "";
  const certainty = !state.wholeSpineLocalizer ? " · no whole-spine localizer — level certainty reduced" : "";
  return `${head}${detail}${certainty}`;
}

/** True when level naming must be re-checked across the report (used by the validator). */
export function numberingNeedsConsistencyCheck(n: LumbarNumberingState | null | undefined): boolean {
  return isNonStandardNumbering(n);
}

/**
 * A level key that was derived from a different numbering mode is a safety
 * defect, not a clinical opinion — the resolver will not silently accept it.
 */
export function isLevelKeyAllowed(levelKey: string, n: LumbarNumberingState | null | undefined): boolean {
  const want = levelKey.trim().toUpperCase().replace(/\s+/g, "");
  if (!want) return false;
  return lumbarLevelKeyStrings(n).some((k) => k.toUpperCase() === want);
}
