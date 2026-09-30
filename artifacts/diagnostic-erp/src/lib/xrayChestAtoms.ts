/**
 * xrayChestAtoms.ts — the only write path from the chest sub-master into the
 * observation ledger. Mirrors mriBrainAtoms.ts exactly: a flat atom spec, one
 * compile function, one bundle id per group.
 *
 * The store remains the single reconciler — this module never touches state,
 * so ledger identity, provenance, baseline supersession, manual protection and
 * undo behave identically to MRI Brain.
 *
 * Pure functions only — no store, no React.
 */
import type { PendingPathologyPatch } from "./zai-workspace/store";

export type ChestAtomSpec = {
  concept: string;
  findings: string;
  conflictGroup?: string;
  anatomicalSection?: string;
  impression?: string;
  recommendation?: string;
  /** Baseline normal sentence this atom supersedes on apply. */
  baselineReplaces?: string;
  /** Zone / lobe where radiography supports it (spec §4). */
  level?: string;
  /** right | left | bilateral */
  laterality?: string;
  severity?: string;
  state?: string;
  measurement?: string;
  supportsLaterality?: boolean;
  /** "baseline" for protocol-aware normal sentences, so an abnormal atom in the
   *  same slot supersedes them instead of contradicting them. */
  role?: "finding" | "baseline";
};

export const CHEST_ATOM_SOURCE: PendingPathologyPatch["source"] = "structured-template";

export const CHEST_DEFAULT_REGION = "Chest";

/**
 * Fill-in context for catalog prose. Tiles are written with bracket tokens
 * (`[side]`, `[zone]`, `[size]`, `[level]`, `[date]`) — the same convention the
 * chocolate-box macros use — and are rendered when the radiologist has actually
 * chosen a value. Anything unfilled stays a visible token rather than becoming
 * an invented clinical fact, and leftover tokens are caught by validation.
 */
export type ChestTemplateContext = {
  laterality?: "right" | "left" | "bilateral" | null;
  zone?: string | null;
  size?: string | null;
  level?: string | null;
  priorDate?: string | null;
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function applyChestTemplate(
  text: string | null | undefined,
  ctx: ChestTemplateContext = {},
): string {
  const side = ctx.laterality ?? "";
  return (text ?? "")
    .replace(/\[Side\]/g, side ? capitalize(side) : "[side]")
    .replace(/\[side\]/g, side || "[side]")
    .replace(/\[zone\]/g, ctx.zone?.trim() || "[zone]")
    .replace(/\[size\]/g, ctx.size?.trim() || "[size]")
    // On a chest film the zone IS the level (apex / upper / mid / lower / base),
    // so one selector fills both; an unchosen locality stays a visible token.
    .replace(/\[level\]/g, ctx.level?.trim() || ctx.zone?.trim() || "[level]")
    .replace(/\[date\]/g, ctx.priorDate?.trim() || "[date]");
}

/** Bracket tokens still unfilled after rendering — surfaced by validation. */
export function unfilledChestTokens(text: string | null | undefined): string[] {
  return (text ?? "").match(/\[(side|zone|size|level|date)\]/g) ?? [];
}

/**
 * Stable bundle ids: `xcb` = X-ray Chest Bundle. Re-applying the same tile is
 * idempotent (same-slot noop / update) and every atom of one tile shares a
 * bundleId for atomic apply / remove / undo.
 */
export function chestBundleId(kind: string, key: string): string {
  return `xcb-${kind}-${key}`;
}

export function chestAtomsToPatches(
  region: string,
  bundleId: string,
  atoms: readonly ChestAtomSpec[],
  template: ChestTemplateContext = {},
): PendingPathologyPatch[] {
  return atoms.map((atom, i) => {
    const id = `${bundleId}-${i}`;
    const findings = applyChestTemplate(atom.findings, template).trim();
    const impression = applyChestTemplate(atom.impression?.trim() || undefined, template) || undefined;
    const recommendation = applyChestTemplate(atom.recommendation?.trim() || undefined, template) || undefined;
    const laterality = atom.laterality ?? template.laterality ?? undefined;
    const level = atom.level ?? template.zone ?? template.level ?? undefined;
    return {
      id,
      incoming: { findings, impression, recommendation },
      templates: { findings, impression, recommendation },
      ownership: {
        anatomicalSection: atom.anatomicalSection ?? "chest",
        conflictGroup: atom.conflictGroup ?? atom.concept,
        concept: atom.concept,
        baselineReplaces: atom.baselineReplaces ?? "",
        level,
        laterality,
      },
      source: CHEST_ATOM_SOURCE,
      region,
      concept: atom.concept,
      label: `${atom.concept}${laterality ? ` (${laterality})` : ""}`,
      findingsText: findings,
      bundleId,
      sectionsOwned: impression ? ["findings", "impression"] : ["findings"],
      severity: atom.severity,
      state: atom.state,
      measurement: atom.measurement,
      laterality,
      level,
      supportsLaterality: atom.supportsLaterality ?? Boolean(laterality),
      role: atom.role,
    } satisfies PendingPathologyPatch;
  });
}

/** Shorthand used throughout the catalog (see mriBrainSubMasters.ts `a()`). */
export const chestAtom = (
  concept: string,
  findings: string,
  extra?: Partial<ChestAtomSpec>,
): ChestAtomSpec => ({
  concept,
  conflictGroup: extra?.conflictGroup ?? concept,
  anatomicalSection: extra?.anatomicalSection ?? "chest",
  findings,
  ...extra,
});
