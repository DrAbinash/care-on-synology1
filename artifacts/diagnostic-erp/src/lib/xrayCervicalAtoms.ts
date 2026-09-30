/**
 * xrayCervicalAtoms.ts — the only write path from the cervical sub-master into
 * the observation ledger. Same shape as xrayChestAtoms.ts (which mirrors
 * mriBrainAtoms.ts): a flat atom spec, one compile function, one bundle id per
 * group. The store stays the single reconciler, so ledger identity, provenance,
 * baseline supersession, manual protection and undo behave identically.
 *
 * The one addition radiography needs and the chest did not: every cervical
 * finding is level-bearing, and a measurement is meaningless without the view
 * it came from (spec §13). So an atom carries `level` and `view`; the level is
 * normalized and feeds the slot key, and the view is recorded on the
 * observation label. Sentences keep their own wording, because a baseline
 * sentence is the supersession contract and prose such as "on the right oblique
 * view" already names its projection.
 *
 * Pure functions only — no store, no React.
 */
import type { PendingPathologyPatch } from "./zai-workspace/store";
import type { XrayCervicalViewKey } from "./xrayCervicalViews";
import { normalizeCervicalLevel } from "./xrayCervicalLevels";

export type CervicalAtomSpec = {
  concept: string;
  findings: string;
  conflictGroup?: string;
  anatomicalSection?: string;
  impression?: string;
  recommendation?: string;
  /** Baseline normal sentence this atom supersedes on apply. */
  baselineReplaces?: string;
  /** "C5-C6" / "C5" — normalized so slot identity is stable. */
  level?: string;
  /** right | left | bilateral */
  laterality?: string;
  severity?: string;
  state?: string;
  measurement?: string;
  supportsLaterality?: boolean;
  /** "baseline" for the normal sentences an abnormality supersedes. */
  role?: "finding" | "baseline";
  /**
   * The view a statement requires (spec §13). Rendered into the prose so the
   * report itself carries which projection it came from.
   */
  view?: XrayCervicalViewKey | "neutral";
};

export const CERVICAL_ATOM_SOURCE: PendingPathologyPatch["source"] = "structured-template";

export const CERVICAL_DEFAULT_REGION = "Cervical Spine";

const VIEW_WORDS: Record<XrayCervicalViewKey | "neutral", string> = {
  ap: "AP",
  lateral: "lateral",
  odontoid: "open-mouth odontoid",
  obliqueRight: "right oblique",
  obliqueLeft: "left oblique",
  flexion: "flexion",
  extension: "extension",
  swimmers: "swimmer's",
  other: "other",
  neutral: "neutral",
};

/**
 * Fill-in context for catalog prose. Tiles are written with bracket tokens
 * (`[level]`, `[upper]`, `[lower]`, `[side]`, `[mm]`, `[pct]`, `[deg]`,
 * `[view]`); anything unfilled stays a visible token rather than becoming an
 * invented clinical fact, and leftover tokens are caught by validation.
 */
export type CervicalTemplateContext = {
  level?: string | null;
  upperLevel?: string | null;
  lowerLevel?: string | null;
  laterality?: "right" | "left" | "bilateral" | null;
  view?: XrayCervicalViewKey | "neutral" | null;
  mm?: string | null;
  percent?: string | null;
  degrees?: string | null;
  /** Which of the four cervical alignment lines is meant (spec §6). */
  line?: string | null;
  /** Meyerding grade, entered by the radiologist or derived in the panel. */
  grade?: string | null;
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function applyCervicalTemplate(
  text: string | null | undefined,
  ctx: CervicalTemplateContext = {},
): string {
  const side = ctx.laterality ?? "";
  const resolvedLevel = ctx.level?.trim() ? normalizeCervicalLevel(ctx.level) ?? ctx.level.trim() : "";
  const level = resolvedLevel || "[level]";
  // The pair comes from the NORMALIZED level: a caller passing "c5-6" must not
  // put a lowercase "c5" and a bare "6" into the patient's report.
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
    .replace(/\[line\]/g, ctx.line?.trim() || "[line]")
    .replace(/\[grade\]/g, ctx.grade?.trim() || "[grade]")
    .replace(/\[mm\]/g, ctx.mm?.trim() || "[mm]")
    .replace(/\[pct\]/g, ctx.percent?.trim() || "[pct]")
    .replace(/\[deg\]/g, ctx.degrees?.trim() || "[deg]");
}

/** Bracket tokens still unfilled after rendering — surfaced by validation. */
export function unfilledCervicalTokens(text: string | null | undefined): string[] {
  return (
    (text ?? "").match(
      /\[(Level|level|upper|lower|Side|side|view|line|grade|mm|pct|deg)\]/g,
    ) ?? []
  );
}

/**
 * Stable bundle ids: `xccb` = X-ray Cervical Bundle. Re-applying the same tile
 * is idempotent and every atom of one tile shares a bundleId for atomic
 * apply / remove / undo.
 */
export function cervicalBundleId(kind: string, key: string): string {
  return `xccb-${kind}-${key}`;
}

/** The view phrase a statement must carry, or null when it is view-neutral. */
export function cervicalViewPhrase(view: XrayCervicalViewKey | "neutral" | null | undefined): string | null {
  if (!view) return null;
  return VIEW_WORDS[view] ?? null;
}

export function cervicalAtomsToPatches(
  region: string,
  bundleId: string,
  atoms: readonly CervicalAtomSpec[],
  template: CervicalTemplateContext = {},
): PendingPathologyPatch[] {
  return atoms.map((atom, i) => {
    const id = `${bundleId}-${i}`;
    const view = atom.view ?? template.view ?? null;

    // The projection is recorded in the observation LABEL, not spliced into the
    // sentence. Baseline sentences are supersession contracts and several
    // catalog lines already name their own view ("on the right oblique view",
    // "in flexion and … in extension"); rewriting the prose to say it again both
    // mangles the contract and reads like boilerplate in a patient report.
    const viewNote = cervicalViewPhrase(view);

    const findings = applyCervicalTemplate(atom.findings, template).trim();
    const impression =
      applyCervicalTemplate(atom.impression?.trim() || undefined, template).trim() || undefined;
    const recommendation =
      applyCervicalTemplate(atom.recommendation?.trim() || undefined, template).trim() || undefined;
    const laterality = atom.laterality ?? template.laterality ?? undefined;
    const levelRaw =
      atom.level ?? template.level ?? (template.upperLevel && template.lowerLevel
        ? `${template.upperLevel}-${template.lowerLevel}`
        : undefined);
    // Slot identity is keyed on the level, so "c6-7" and "C6-C7" must land on the
    // same observation. A level outside the cervical range is kept verbatim
    // rather than dropped, so the report cannot silently lose a level.
    const level = levelRaw ? normalizeCervicalLevel(levelRaw) ?? levelRaw.trim() : undefined;

    return {
      id,
      incoming: { findings, impression, recommendation },
      templates: { findings, impression, recommendation },
      ownership: {
        anatomicalSection: atom.anatomicalSection ?? "cervical spine",
        conflictGroup: atom.conflictGroup ?? atom.concept,
        concept: atom.concept,
        baselineReplaces: atom.baselineReplaces ?? "",
        level,
        laterality,
      },
      source: CERVICAL_ATOM_SOURCE,
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

/** Shorthand used throughout the catalog (see chest's `chestAtom`). */
export const cervicalAtom = (
  concept: string,
  findings: string,
  extra?: Partial<CervicalAtomSpec>,
): CervicalAtomSpec => ({
  concept,
  conflictGroup: extra?.conflictGroup ?? concept,
  anatomicalSection: extra?.anatomicalSection ?? "cervical spine",
  findings,
  ...extra,
});
