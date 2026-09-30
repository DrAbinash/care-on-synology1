/**
 * mriBrainVessels.ts — one identity per vessel or segment (mra/mrv spec §5, §11, §12).
 *
 * The ledger identifies a slot by region + concept + level + laterality, and the
 * Dorso-Lumbar phase already proved what happens without a canonical level: the
 * same anatomy written from two panels becomes two observations that both survive
 * and then contradict each other in the printed report. Vessel reporting multiplies
 * that risk, because "right MCA M1", "R M1 segment" and "middle cerebral artery,
 * M1, right" are one vessel that must hold exactly one status.
 *
 * So every vessel this task can report is declared once here, with the words that
 * name it, and `resolveVessel()` collapses spellings onto one key.
 *
 * Two deliberate refusals:
 *
 *   - A bare "vertebral artery" is ambiguous. The posterior-circulation row of §5
 *     and the neck row of §11 are different vessels, so resolution needs the
 *     territory the caller is reporting in. Without it, null — never a guess.
 *   - Side is not invented. An unpaired structure that is told "right" is a
 *     question for the radiologist, not a silent rewrite.
 *
 * Pure functions only — no store, no React.
 */

export type VascularTerritory = "intracranialArterial" | "neckArterial" | "venous";

export type VesselSystem =
  | "anteriorCirculation"
  | "posteriorCirculation"
  | "carotidSystem"
  | "vertebralSystem"
  | "duralSinus"
  | "deepVenous"
  | "otherVeins";

export type VesselSide = "right" | "left" | "unpaired";

export type VesselDefinition = {
  /** Canonical key, stable in the ledger. Never derived from prose. */
  key: string;
  label: string;
  territory: VascularTerritory;
  system: VesselSystem;
  side: VesselSide;
  /** Grouping label used by the panel rows and the Findings order. */
  vessel: string;
  segment?: string;
  /** The anatomic variant slots of §10 belong to a vessel but not to pathology. */
  variantOnly?: boolean;
};

type BaseVessel = {
  id: string;
  vessel: string;
  segment?: string;
  /** Every spelling that names this structure, most specific first. */
  words: string[];
  territory: VascularTerritory;
  system: VesselSystem;
  paired: boolean;
  short?: string[];
  variantOnly?: boolean;
};

const BASE: BaseVessel[] = [
  // ── §5 anterior circulation ────────────────────────────────────────────
  { id: "ica-intracranial", vessel: "intracranial ICA", words: ["intracranial internal carotid artery", "intracranial ICA", "terminal internal carotid"], short: ["C1", "ica"], territory: "intracranialArterial", system: "anteriorCirculation", paired: true },
  { id: "ica-terminus", vessel: "ICA terminus", segment: "terminus", words: ["ICA terminus", "internal carotid terminus", "carotid T"], territory: "intracranialArterial", system: "anteriorCirculation", paired: true },
  { id: "aca-a1", vessel: "ACA", segment: "A1", words: ["A1 segment of the anterior cerebral artery", "ACA A1", "A1"], territory: "intracranialArterial", system: "anteriorCirculation", paired: true },
  { id: "aca-a2", vessel: "ACA", segment: "A2", words: ["A2 segment of the anterior cerebral artery", "ACA A2", "A2"], territory: "intracranialArterial", system: "anteriorCirculation", paired: true },
  { id: "acom", vessel: "ACom region", words: ["anterior communicating artery region", "anterior communicating artery", "ACom"], territory: "intracranialArterial", system: "anteriorCirculation", paired: false },
  { id: "mca-m1", vessel: "MCA", segment: "M1", words: ["M1 segment of the middle cerebral artery", "middle cerebral artery M1", "MCA M1", "M1"], territory: "intracranialArterial", system: "anteriorCirculation", paired: true },
  { id: "mca-m2", vessel: "MCA", segment: "M2", words: ["M2 segment of the middle cerebral artery", "middle cerebral artery M2", "MCA M2", "M2"], territory: "intracranialArterial", system: "anteriorCirculation", paired: true },
  { id: "mca-branches", vessel: "MCA major branches", words: ["middle cerebral artery major branches", "MCA branches", "MCA major branches"], territory: "intracranialArterial", system: "anteriorCirculation", paired: true },
  // ── §5 posterior circulation ───────────────────────────────────────────
  { id: "vertebral-intracranial", vessel: "vertebral artery (intracranial)", words: ["intracranial vertebral artery", "V4 segment of the vertebral artery", "vertebral artery"], short: ["V4"], territory: "intracranialArterial", system: "posteriorCirculation", paired: true },
  { id: "pica-origin", vessel: "PICA origin", words: ["PICA origin", "posterior inferior cerebellar artery origin"], territory: "intracranialArterial", system: "posteriorCirculation", paired: true },
  { id: "pica-termination-variant", vessel: "vertebral terminating in PICA", words: ["vertebral artery terminating in PICA", "vertebral termination in PICA", "PICA termination of the vertebral artery"], territory: "intracranialArterial", system: "posteriorCirculation", paired: true, variantOnly: true },
  { id: "basilar", vessel: "basilar artery", words: ["basilar artery", "basilar"], territory: "intracranialArterial", system: "posteriorCirculation", paired: false },
  { id: "pca-p1", vessel: "PCA", segment: "P1", words: ["P1 segment of the posterior cerebral artery", "PCA P1", "P1"], territory: "intracranialArterial", system: "posteriorCirculation", paired: true },
  { id: "pca-p2", vessel: "PCA", segment: "P2", words: ["P2 segment of the posterior cerebral artery", "PCA P2", "P2"], territory: "intracranialArterial", system: "posteriorCirculation", paired: true },
  { id: "pcom", vessel: "PCom", words: ["posterior communicating artery", "PCom"], territory: "intracranialArterial", system: "posteriorCirculation", paired: true },
  { id: "fetal-pca", vessel: "fetal PCA configuration", words: ["fetal posterior cerebral artery", "fetal PCA", "partial fetal PCA"], territory: "intracranialArterial", system: "posteriorCirculation", paired: true, variantOnly: true },
  // ── §10 variants that are not tied to one segment ──────────────────────
  { id: "a1-hypoplasia", vessel: "A1 caliber asymmetry", words: ["hypoplastic A1", "aplastic A1", "asymmetric A1", "A1 asymmetry"], territory: "intracranialArterial", system: "anteriorCirculation", paired: true, variantOnly: true },
  { id: "vertebral-dominance", vessel: "vertebral dominance", words: ["vertebral artery dominance", "vertebral dominance", "dominant vertebral artery"], territory: "intracranialArterial", system: "posteriorCirculation", paired: true, variantOnly: true },
  { id: "vertebral-hypoplasia", vessel: "vertebral hypoplasia", words: ["vertebral artery hypoplasia", "hypoplastic vertebral artery"], territory: "intracranialArterial", system: "posteriorCirculation", paired: true, variantOnly: true },
  { id: "pcom-asymmetry", vessel: "PCom asymmetry", words: ["asymmetric PCom", "PCom asymmetry", "asymmetric posterior communicating artery"], territory: "intracranialArterial", system: "posteriorCirculation", paired: true, variantOnly: true },
  // ── §11 neck ───────────────────────────────────────────────────────────
  { id: "cca", vessel: "CCA", words: ["common carotid artery", "CCA"], territory: "neckArterial", system: "carotidSystem", paired: true },
  { id: "carotid-bifurcation", vessel: "carotid bifurcation", words: ["carotid bifurcation", "bifurcation of the common carotid artery"], territory: "neckArterial", system: "carotidSystem", paired: true },
  { id: "carotid-bulb", vessel: "carotid bulb", words: ["carotid bulb", "internal carotid artery bulb"], territory: "neckArterial", system: "carotidSystem", paired: true },
  { id: "ica-cervical", vessel: "cervical ICA", words: ["cervical segment of the internal carotid artery", "cervical internal carotid artery", "cervical ICA"], short: ["V2", "V3"], territory: "neckArterial", system: "carotidSystem", paired: true },
  { id: "ica-proximal", vessel: "proximal ICA", words: ["proximal internal carotid artery", "proximal ICA"], territory: "neckArterial", system: "carotidSystem", paired: true },
  { id: "eca", vessel: "ECA", words: ["external carotid artery", "ECA"], territory: "neckArterial", system: "carotidSystem", paired: true },
  { id: "vertebral-cervical", vessel: "vertebral artery (extracranial)", words: ["extracranial vertebral artery", "cervical vertebral artery", "vertebral artery"], short: ["V1", "V2"], territory: "neckArterial", system: "vertebralSystem", paired: true },
  { id: "vertebral-origin", vessel: "vertebral origin", words: ["vertebral artery origin", "origin of the vertebral artery"], territory: "neckArterial", system: "vertebralSystem", paired: true },
  // ── §12 venous ─────────────────────────────────────────────────────────
  { id: "sss", vessel: "superior sagittal sinus", words: ["superior sagittal sinus", "SSS"], territory: "venous", system: "duralSinus", paired: false },
  { id: "iss", vessel: "inferior sagittal sinus", words: ["inferior sagittal sinus", "ISS"], territory: "venous", system: "duralSinus", paired: false },
  { id: "straight-sinus", vessel: "straight sinus", words: ["straight sinus"], territory: "venous", system: "duralSinus", paired: false },
  { id: "torcular", vessel: "torcular herophili", words: ["torcular herophili", "torcular", "confluence of sinuses"], territory: "venous", system: "duralSinus", paired: false },
  { id: "transverse-sinus", vessel: "transverse sinus", words: ["transverse sinus"], territory: "venous", system: "duralSinus", paired: true },
  { id: "sigmoid-sinus", vessel: "sigmoid sinus", words: ["sigmoid sinus"], territory: "venous", system: "duralSinus", paired: true },
  { id: "cavernous-sinus", vessel: "cavernous sinus", words: ["cavernous sinus"], territory: "venous", system: "duralSinus", paired: true },
  { id: "internal-cerebral-vein", vessel: "internal cerebral vein", words: ["internal cerebral veins", "internal cerebral vein"], territory: "venous", system: "deepVenous", paired: true },
  { id: "vein-of-galen", vessel: "vein of Galen", words: ["vein of Galen", "great cerebral vein"], territory: "venous", system: "deepVenous", paired: false },
  { id: "basal-vein", vessel: "basal vein", words: ["basal veins of Rosenthal", "basal vein"], territory: "venous", system: "deepVenous", paired: true },
  { id: "cortical-veins", vessel: "cortical veins", words: ["cortical veins", "surface veins"], territory: "venous", system: "otherVeins", paired: false },
  { id: "jugular-bulb", vessel: "jugular bulb", words: ["jugular bulb"], territory: "venous", system: "otherVeins", paired: true },
  { id: "ijv-proximal", vessel: "proximal IJV", words: ["proximal internal jugular vein", "internal jugular vein", "IJV"], territory: "venous", system: "otherVeins", paired: true },
  { id: "transverse-sinus-hypoplasia", vessel: "transverse sinus hypoplasia / aplasia", words: ["transverse sinus hypoplasia", "transverse sinus aplasia", "hypoplastic transverse sinus", "aplastic transverse sinus"], territory: "venous", system: "duralSinus", paired: true, variantOnly: true },
];

function normalize(text: string): string {
  return text
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\bB\/L\b/g, " BILATERAL ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(?:THE|OF|SEGMENT|PORTION)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every name form this structure answers to, without a side attached. */
function nameForms(base: BaseVessel): string[] {
  const names = [...base.words, base.vessel, ...(base.short ?? [])];
  if (base.segment) names.push(`${base.vessel} ${base.segment}`, base.segment);
  return names;
}

/** Every name form a paired structure can arrive as. */
const SIDE_WORDS: Record<Exclude<VesselSide, "unpaired">, string[]> = {
  right: ["RIGHT", "R", "RT"],
  left: ["LEFT", "L", "LT"],
};

function sideForms(base: BaseVessel, side: VesselSide): string[] {
  if (side === "unpaired") return nameForms(base);
  const out: string[] = [];
  for (const name of nameForms(base)) {
    for (const sideWord of SIDE_WORDS[side]) {
      out.push(`${sideWord} ${name}`, `${name} ${sideWord}`);
    }
  }
  return out;
}

function sidesOf(base: BaseVessel): VesselSide[] {
  return base.paired ? ["right", "left"] : ["unpaired"];
}

/**
 * The one side-aware display name: "right MCA M1", "basilar artery". Segment is only
 * appended when the vessel name does not already carry it, so "ICA terminus" never
 * prints as "ICA terminus terminus".
 */
export function vesselDisplayName(
  vessel: { vessel: string; segment?: string; side: VesselSide },
): string {
  const base =
    vessel.segment && !vessel.vessel.includes(vessel.segment)
      ? `${vessel.vessel} ${vessel.segment}`
      : vessel.vessel;
  return vessel.side === "unpaired" ? base : `${vessel.side} ${base}`;
}

function makeDefinition(base: BaseVessel, side: VesselSide): VesselDefinition {
  return {
    key: side === "unpaired" ? base.id : `${base.id}-${side}`,
    label: vesselDisplayName({ vessel: base.vessel, segment: base.segment, side }),
    territory: base.territory,
    system: base.system,
    side,
    vessel: base.vessel,
    segment: base.segment,
    variantOnly: base.variantOnly,
  };
}

export const VESSEL_DEFINITIONS: VesselDefinition[] = BASE.flatMap((base) =>
  sidesOf(base).map((side) => makeDefinition(base, side)),
);

const DEFINITION_BY_KEY = new Map(VESSEL_DEFINITIONS.map((d) => [d.key, d]));

/**
 * Alias → the definitions that spelling can name. A bare spelling is registered
 * against both sides of a paired vessel so that territory/side disambiguation,
 * not insertion order, decides the answer. Two bases are allowed to share the bare
 * "vertebral artery" and "V2" spellings because they live in different territories
 * or systems — the tests pin that behaviour rather than the index shape.
 */
const ALIAS_INDEX = (() => {
  const index = new Map<string, VesselDefinition[]>();
  const add = (raw: string, definition: VesselDefinition) => {
    const norm = normalize(raw);
    if (!norm) return;
    const bucket = index.get(norm) ?? [];
    if (!bucket.some((d) => d.key === definition.key)) bucket.push(definition);
    index.set(norm, bucket);
  };
  for (const base of BASE) {
    for (const side of sidesOf(base)) {
      const definition = DEFINITION_BY_KEY.get(side === "unpaired" ? base.id : `${base.id}-${side}`);
      if (!definition) throw new Error(`mriBrainVessels: missing definition for ${base.id}/${side}`);
      for (const name of nameForms(base)) add(name, definition);
      for (const name of sideForms(base, side)) add(name, definition);
    }
  }
  return index;
})();

/** The same words in any order name the same vessel, so index them as a set too. */
const ALIAS_SET_INDEX = (() => {
  const index = new Map<string, VesselDefinition[]>();
  for (const [alias, definitions] of ALIAS_INDEX) {
    const key = [...alias.split(" ")].sort().join(" ");
    const bucket = index.get(key) ?? [];
    for (const definition of definitions) {
      if (!bucket.some((d) => d.key === definition.key)) bucket.push(definition);
    }
    index.set(key, bucket);
  }
  return index;
})();

/** Longest alias first, so the most specific structure named in a phrase wins. */
const ALIAS_BY_LENGTH_DESC = [...ALIAS_INDEX.keys()]
  .filter((alias) => alias.length >= 3)
  .sort((a, b) => b.length - a.length || a.localeCompare(b));

export type ResolveVesselOptions = {
  /** Which vascular territory the caller is reporting in. */
  territory?: VascularTerritory;
  /** Side stated outside the text (a side selector in the panel). */
  side?: VesselSide;
};

/** Narrows a candidate set to one definition, or null when it cannot be narrowed. */
function pickUnique(
  candidates: readonly VesselDefinition[],
  opts: ResolveVesselOptions,
): VesselDefinition | null {
  if (candidates.length === 0) return null;
  const byTerritory = opts.territory
    ? candidates.filter((d) => d.territory === opts.territory)
    : candidates;
  if (byTerritory.length === 1) return byTerritory[0]!;
  const bySide = opts.side
    ? byTerritory.filter((d) => d.side === opts.side || d.side === "unpaired")
    : byTerritory;
  return bySide.length === 1 ? bySide[0]! : null;
}

const RIGHT_TOKEN = /\b(?:RIGHT|RT|R)\b/;
const LEFT_TOKEN = /\b(?:LEFT|LT|L)\b/;

/**
 * Split a normalised phrase into its side and the phrase with that side removed.
 *
 * Removing the side is what lets "cervical segment of the right ICA" find the
 * "right cervical ICA" alias: a side can be written anywhere in a vessel name, so
 * word order must not be part of vessel identity. A phrase that names both sides has
 * no single identity and is refused outright rather than resolving to whichever
 * alias the index happens to test first.
 */
function sidedNorm(
  norm: string,
  stated: VesselSide | undefined,
): { text: string; side: VesselSide | null } | null {
  if (/\bBILATERAL\b/.test(norm)) return { text: norm, side: stated ?? null };
  const right = RIGHT_TOKEN.test(norm);
  const left = LEFT_TOKEN.test(norm);
  if (right && left) return null;
  if (!right && !left) return { text: norm, side: stated ?? null };
  const side: VesselSide = right ? "right" : "left";
  // A panel selector that contradicts the written side is a question, not a merge.
  if (stated && stated !== "unpaired" && stated !== side) return null;
  return {
    text: (right ? norm.replace(RIGHT_TOKEN, " ") : norm.replace(LEFT_TOKEN, " "))
      .replace(/\s+/g, " ")
      .trim(),
    side,
  };
}

/**
 * Collapse any naming form onto one vessel identity.
 *
 * Returns null when the wording is unknown, when it names a structure that exists
 * in two territories ("vertebral artery") without the caller saying which panel it
 * is reporting from, when a paired vessel is named without a side, or when the text
 * and the caller disagree about the side. Callers must then ask, not guess — an
 * invented identity is how one vessel ends up with two observations that contradict
 * each other in the printed report.
 */
export function resolveVessel(
  raw: string | null | undefined,
  opts: ResolveVesselOptions = {},
): VesselDefinition | null {
  const norm = normalize(raw ?? "");
  if (!norm) return null;
  const sided = sidedNorm(norm, opts.side);
  if (!sided) return null;
  const scoped: ResolveVesselOptions = { ...opts, side: sided.side ?? undefined };
  const text = sided.text;
  const exact = ALIAS_INDEX.get(text) ?? ALIAS_SET_INDEX.get([...text.split(" ")].sort().join(" "));
  if (exact) return pickUnique(exact, scoped);
  // Padded so containment matches whole name tokens: "BILATERAL TRANSVERSE SINUS"
  // must not match the alias "L TRANSVERSE SINUS" through the letters of BILATERAL,
  // and "CERVICAL" must not match "ICA".
  const padded = ` ${text} `;
  for (const alias of ALIAS_BY_LENGTH_DESC) {
    if (!padded.includes(` ${alias} `)) continue;
    const match = pickUnique(ALIAS_INDEX.get(alias) ?? [], scoped);
    if (match) return match;
  }
  return null;
}

/** The side explicitly written in a phrase. Bilateral, unsided and two-sided text return null. */
export function sideFromText(raw: string | null | undefined): VesselSide | null {
  const norm = normalize(raw ?? "");
  if (!norm || /\bBILATERAL\b/.test(norm)) return null;
  const right = RIGHT_TOKEN.test(norm);
  const left = LEFT_TOKEN.test(norm);
  if (right && !left) return "right";
  if (left && !right) return "left";
  return null;
}

/** Accepts either the canonical key or the upper-cased `level` stored in the ledger. */
export function vesselByKey(key: string | null | undefined): VesselDefinition | null {
  if (!key) return null;
  return DEFINITION_BY_KEY.get(key) ?? DEFINITION_BY_KEY.get(key.toLowerCase()) ?? null;
}

export function vesselsForTerritory(territory: VascularTerritory): VesselDefinition[] {
  return VESSEL_DEFINITIONS.filter((d) => d.territory === territory);
}

export function vesselsForSystem(system: VesselSystem): VesselDefinition[] {
  return VESSEL_DEFINITIONS.filter((d) => d.system === system);
}

/**
 * The ledger slot identity a vessel row owns: `level` is the canonical vessel key
 * and `laterality` the side, so two spellings of one vessel collide in one slot.
 * Unpaired structures carry an empty laterality, exactly like the unpaired spine
 * levels do, so the ledger never grows a phantom side.
 */
export function canonicalVesselSlot(
  raw: string | null | undefined,
  opts: ResolveVesselOptions = {},
): { level: string; laterality: string; label: string; vessel: VesselDefinition } | null {
  const side = opts.side ?? sideFromText(raw) ?? undefined;
  const resolved = resolveVessel(raw, { ...opts, side });
  if (!resolved) return null;
  return {
    // A ledger `level` is free text elsewhere in this app, but the slot key must
    // survive normalize()/uppercase round-trips, so store the canonical key upper.
    level: resolved.key.toUpperCase(),
    laterality: resolved.side === "unpaired" ? "" : resolved.side,
    label: resolved.label,
    vessel: resolved,
  };
}
