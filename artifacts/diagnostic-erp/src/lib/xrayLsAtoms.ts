/**
 * xrayLsAtoms.ts — the only write path from the lumbosacral sub-master into the
 * observation ledger. Same shape as xrayCervicalAtoms.ts / xrayChestAtoms.ts (a
 * flat atom spec, one compile function, one bundle id per group) so the store
 * stays the single reconciler: ledger identity, provenance, baseline supersession,
 * manual protection and undo behave identically for every radiography region.
 *
 * What lumbar radiography adds on top of the cervical model: a level is only
 * meaningful together with the numbering basis that produced it (spec §4). The
 * level is still normalized and still keys the slot, but the numbering sentence
 * is a separate ledger observation rather than an assumption inside each atom —
 * so a report can never state "L5-S1" forty times without ever having said how
 * L5 was chosen.
 *
 * Pure functions only — no store, no React.
 */
import type { PendingPathologyPatch } from "./zai-workspace/store";
import type { XrayLsViewKey } from "./xrayLsViews";
import { normalizeLsLevel } from "./xrayLsLevels";

export type LsAtomSpec = {
  concept: string;
  findings: string;
  conflictGroup?: string;
  anatomicalSection?: string;
  impression?: string;
  recommendation?: string;
  /** Baseline normal sentence this atom supersedes on apply. */
  baselineReplaces?: string;
  /** "L4-L5" / "L5" — normalized so slot identity is stable. */
  level?: string;
  /** right | left | bilateral */
  laterality?: string;
  severity?: string;
  state?: string;
  measurement?: string;
  supportsLaterality?: boolean;
  /** "baseline" for the normal sentences an abnormality supersedes. */
  role?: "finding" | "baseline";
  /** The view a statement requires (spec §2), recorded on the label. */
  view?: XrayLsViewKey;
  /** Listhesis direction word, when the atom is a translation observation. */
  direction?: "anterolisthesis" | "retrolisthesis" | "lateral translation";
};

export const LS_ATOM_SOURCE: PendingPathologyPatch["source"] = "structured-template";

export const LS_DEFAULT_REGION = "Lumbar Spine";

const VIEW_WORDS: Record<XrayLsViewKey, string> = {
  ap: "AP",
  lateral: "lateral",
  obliqueRight: "right oblique",
  obliqueLeft: "left oblique",
  flexion: "flexion",
  extension: "extension",
  spotL5S1: "spot L5-S1",
  other: "other",
};

/**
 * Fill-in context for catalog prose. Tiles are written with bracket tokens
 * (`[level]`, `[upper]`, `[lower]`, `[side]`, `[mm]`, `[pct]`, `[deg]`, `[view]`,
 * `[grade]`, `[direction]`); anything unfilled stays a visible token rather than
 * becoming an invented clinical fact, and leftover tokens are caught by
 * validation.
 */
export type LsTemplateContext = {
  level?: string | null;
  upperLevel?: string | null;
  lowerLevel?: string | null;
  laterality?: "right" | "left" | "bilateral" | null;
  view?: XrayLsViewKey | null;
  mm?: string | null;
  percent?: string | null;
  degrees?: string | null;
  /** Meyerding grade, entered by the radiologist or derived in the panel. */
  grade?: string | null;
  direction?: LsAtomSpec["direction"] | null;
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function applyLsTemplate(text: string | null | undefined, ctx: LsTemplateContext = {}): string {
  const side = ctx.laterality ?? "";
  const resolvedLevel = ctx.level?.trim() ? normalizeLsLevel(ctx.level) ?? ctx.level.trim() : "";
  const level = resolvedLevel || "[level]";
  // The pair comes from the NORMALIZED level: a caller passing "l4-5" must not
  // put a lowercase "l4" and a bare "5" into the patient's report.
  const pair = resolvedLevel.includes("-") ? resolvedLevel.split("-") : [];
  const upper = ctx.upperLevel?.trim() || pair[0] || "[upper]";
  const lower = ctx.lowerLevel?.trim() || pair[1] || "[lower]";
  return (text ?? "")
    .replace(/\[Level\]/g, capitalize(level === "[level]" ? "" : level) || "[level]")
    .replace(/\[level\]/g, level)
    .replace(/\[upper\]/g, upper)
    .replace(/\[lower\]/g, lower)
    .replace(/\[Side\]/g, side ? capitalize(side) : "[Side]")
    .replace(/\[side\]/g, side || "[side]")
    .replace(/\[view\]/g, ctx.view ? VIEW_WORDS[ctx.view] : "[view]")
    .replace(/\[grade\]/g, ctx.grade?.trim() || "[grade]")
    .replace(/\[direction\]/g, ctx.direction ?? "[direction]")
    .replace(/\[mm\]/g, ctx.mm?.trim() || "[mm]")
    .replace(/\[pct\]/g, ctx.percent?.trim() || "[pct]")
    .replace(/\[deg\]/g, ctx.degrees?.trim() || "[deg]");
}

/** Bracket tokens still unfilled after rendering — surfaced by validation. */
export function unfilledLsTokens(text: string | null | undefined): string[] {
  return (
    (text ?? "").match(
      /\[(Level|level|upper|lower|Side|side|view|grade|direction|mm|pct|deg)\]/g,
    ) ?? []
  );
}

/**
 * Stable bundle ids: `xlsb` = X-ray Lumbar Spine Bundle. Re-applying the same
 * tile is idempotent and every atom of one tile shares a bundleId for atomic
 * apply / remove / undo.
 */
export function lsBundleId(kind: string, key: string): string {
  return `xlsb-${kind}-${key}`;
}

/** The view phrase a statement requires, or null when it is view-neutral. */
export function lsViewPhrase(view: XrayLsViewKey | null | undefined): string | null {
  if (!view) return null;
  return VIEW_WORDS[view] ?? null;
}

export function lsAtomsToPatches(
  region: string,
  bundleId: string,
  atoms: readonly LsAtomSpec[],
  template: LsTemplateContext = {},
): PendingPathologyPatch[] {
  return atoms.map((atom, i) => {
    const id = `${bundleId}-${i}`;
    const view = atom.view ?? template.view ?? null;

    // The projection is recorded in the observation LABEL, not spliced into the
    // sentence: baseline sentences are supersession contracts, and prose such as
    // "on the lateral view" already names its projection.
    const viewNote = lsViewPhrase(view);

    const findings = applyLsTemplate(atom.findings, template).trim();
    const impression =
      applyLsTemplate(atom.impression?.trim() || undefined, template).trim() || undefined;
    const recommendation =
      applyLsTemplate(atom.recommendation?.trim() || undefined, template).trim() || undefined;
    const laterality = atom.laterality ?? template.laterality ?? undefined;
    const levelRaw =
      atom.level ??
      template.level ??
      (template.upperLevel && template.lowerLevel
        ? `${template.upperLevel}-${template.lowerLevel}`
        : undefined);
    // Slot identity is keyed on the level, so "l4-5" and "L4-L5" must land on the
    // same observation. A level outside the thoracolumbosacral range is kept
    // verbatim rather than dropped, so the report cannot silently lose a level.
    const level = levelRaw ? normalizeLsLevel(levelRaw) ?? levelRaw.trim() : undefined;

    return {
      id,
      incoming: { findings, impression, recommendation },
      templates: { findings, impression, recommendation },
      ownership: {
        anatomicalSection: atom.anatomicalSection ?? "lumbosacral spine",
        conflictGroup: atom.conflictGroup ?? atom.concept,
        concept: atom.concept,
        baselineReplaces: atom.baselineReplaces ?? "",
        level,
        laterality,
      },
      source: LS_ATOM_SOURCE,
      region,
      concept: atom.concept,
      label:
        `${atom.concept}${level ? ` (${level})` : ""}${laterality ? ` ${laterality}` : ""}` +
        `${viewNote ? ` — ${viewNote} view` : ""}`,
      findingsText: findings,
      bundleId,
      sectionsOwned: impression ? ["findings", "impression"] : ["findings"],
      severity: atom.severity,
      state: atom.state,
      measurement: atom.measurement,
      level,
      laterality,
      supportsLaterality: atom.supportsLaterality ?? Boolean(laterality),
      role: atom.role,
    } satisfies PendingPathologyPatch;
  });
}

/** Shorthand used throughout the catalog. */
export const lsAtom = (
  concept: string,
  findings: string,
  extra?: Partial<LsAtomSpec>,
): LsAtomSpec => ({
  concept,
  conflictGroup: extra?.conflictGroup ?? concept,
  anatomicalSection: extra?.anatomicalSection ?? "lumbosacral spine",
  findings,
  ...extra,
});
