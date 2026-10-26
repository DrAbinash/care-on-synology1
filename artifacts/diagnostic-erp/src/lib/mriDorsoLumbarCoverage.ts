/**
 * mriDorsoLumbarCoverage.ts — the coverage resolver for one dedicated
 * Dorso-Lumbar examination (spec §4, §5, §6).
 *
 * A study booked as "Dorso-Lumbar" does not necessarily cover T1 to S1, and the
 * report must not claim anatomy the series never showed. This module answers
 * three questions and nothing else:
 *
 *   1. which levels were actually acquired, in which order;
 *   2. which domain each of those levels belongs to — thoracic, the
 *      thoracolumbar junction, or lumbar — because the domain decides which
 *      neural structure exists there (cord, conus, cauda) and therefore which
 *      observations may be written at all;
 *   3. how much confidence the vertebral numbering carries.
 *
 * It composes the existing thoracic and lumbar resolvers instead of replacing
 * them: the thoracic half is `dorsalLevelKeys`, the lumbar half stays
 * `lumbarLevelKeys` so transitional (LSTV) anatomy keeps remapping the way the
 * lumbar module already does. Nothing here renumbers an observation.
 *
 * Pure functions only — no store, no React.
 */

import {
  dorsalLevelKeys,
  type DorsalNumberingMode,
} from "./mriDorsalNumbering";
import {
  defaultLumbarNumbering,
  lumbarLevelKeys,
  type LumbarNumberingState,
} from "./mriSpineNumbering";
import { displayLevel, normalizeLevel } from "./observationSlot";

/** How the level names were established across the junction. */
export type DorsoLumbarNumberingMode =
  | "localizer-confirmed"
  | "cervicothoracic-landmark"
  | "thoracolumbar-landmark"
  | "standard-morphology"
  | "manual"
  | "uncertain";

export type DorsoLumbarDomain = "thoracic" | "junction" | "lumbar";

export type DorsoLumbarLevelKey = {
  /** Canonical printed key, e.g. "D12-L1". */
  key: string;
  label: string;
  domain: DorsoLumbarDomain;
  /** The ledger region that owns observations at this level. */
  ledgerRegion: string;
  junction?: boolean;
  transitional?: boolean;
};

export type DorsoLumbarState = {
  numbering: DorsoLumbarNumberingMode;
  /** A whole-spine or dedicated localizer supports absolute numbering. */
  wholeSpineLocalizer: boolean;
  /** Manual designation wording, e.g. "lowest rib-bearing vertebra taken as T12". */
  designationNote?: string | null;
  /** First acquired disc level (superior bound), canonical key. */
  superior: string;
  /** Last acquired disc level (inferior bound), canonical key. */
  inferior: string;
  /** The lumbar half keeps using the LSTV-aware lumbar resolver. */
  lumbar: LumbarNumberingState;
};

/** The dorsolumbar bridge. One identity, one owner — see the note below. */
export const JUNCTION_LEVEL = "D12-L1";

/**
 * D12-L1 is the one level that both halves of this examination could claim.
 *
 * The ledger's slot identity is region + concept + level + laterality, so the
 * same finding written under "Dorsal Spine" and again under "LS Spine" is two
 * different observations — exactly the duplicated junction the specification
 * forbids (§6). The bridge therefore has a single owning region, and the
 * level-entry dispatcher routes both UI sides through it, whichever panel the
 * radiologist was looking at.
 */
export const JUNCTION_LEDGER_REGION = "Dorsal Spine";

export const DORSOLUMBAR_NUMBERING_MODES: Array<{
  id: DorsoLumbarNumberingMode;
  label: string;
  hint: string;
}> = [
  { id: "localizer-confirmed", label: "Whole-spine / localizer confirmed", hint: "Every level counted from a whole-spine localizer or survey." },
  { id: "cervicothoracic-landmark", label: "Cervicothoracic landmark counting", hint: "Thoracic levels counted down from C7/T1." },
  { id: "thoracolumbar-landmark", label: "Thoracolumbar landmark counting", hint: "Junction taken from the last rib-bearing vertebra; lumbar counted from below." },
  { id: "standard-morphology", label: "Standard morphology, no transitional concern", hint: "Five lumbar-type vertebrae and no counting conflict across the junction." },
  { id: "manual", label: "Stated by the reporting radiologist", hint: "Level naming is asserted manually in the report." },
  { id: "uncertain", label: "Numbering uncertain", hint: "No reliable landmark supports absolute level assignment across the junction." },
];

/** Thoracic coverage modes the existing dorsal resolver understands. */
const DORSAL_MODE_FOR: Record<DorsoLumbarNumberingMode, DorsalNumberingMode> = {
  "localizer-confirmed": "localizer-confirmed",
  "cervicothoracic-landmark": "cervicothoracic-landmark",
  "thoracolumbar-landmark": "thoracolumbar-landmark",
  "standard-morphology": "cervicothoracic-landmark",
  manual: "manual",
  uncertain: "uncertain",
};

function levelKey(raw: string | null | undefined): string {
  return normalizeLevel((raw ?? "").trim().toUpperCase()) || (raw ?? "").trim().toUpperCase();
}

/** The whole sequence this examination could cover, before the bounds are applied. */
export function dorsolumbarFullLevelSequence(lumbar: LumbarNumberingState | null | undefined): DorsoLumbarLevelKey[] {
  const thoracic = dorsalLevelKeys({
    mode: "localizer-confirmed",
    coverage: "thoracolumbar",
    wholeSpineLocalizer: true,
  }).map<DorsoLumbarLevelKey>((entry) => ({
    key: entry.key,
    label: entry.label,
    domain: entry.junction ? "junction" : "thoracic",
    ledgerRegion: entry.junction ? JUNCTION_LEDGER_REGION : "Dorsal Spine",
    junction: entry.junction === true,
  }));
  const lumbarKeys = lumbarLevelKeys(lumbar).map<DorsoLumbarLevelKey>((entry) => ({
    key: entry.key,
    label: entry.label,
    domain: "lumbar",
    ledgerRegion: "LS Spine",
    transitional: entry.transitional === true,
  }));
  return [...thoracic, ...lumbarKeys];
}

export function defaultDorsoLumbarState(
  overrides: Partial<DorsoLumbarState> = {},
): DorsoLumbarState {
  const sequence = dorsolumbarFullLevelSequence(defaultLumbarNumbering());
  return {
    numbering: "thoracolumbar-landmark",
    wholeSpineLocalizer: false,
    designationNote: null,
    // A conventional mid-thoracic-to-sacrum field of view. This is an editable
    // default, not an assumption about the study: every consumer below reads the
    // resolved bounds, and a statement outside them is reported.
    superior: "D8-D9",
    inferior: sequence[sequence.length - 1]!.key,
    lumbar: defaultLumbarNumbering(),
    ...overrides,
  };
}

function boundIndex(sequence: DorsoLumbarLevelKey[], bound: string, fallback: number): number {
  const want = levelKey(bound);
  if (!want) return fallback;
  const exact = sequence.findIndex((entry) => levelKey(entry.key) === want);
  if (exact >= 0) return exact;
  // A bound named by vertebra rather than by disc ("T9", "L1") resolves to the
  // first acquired disc level at or below that vertebra.
  const vertebra = want.match(/^([TDLS])(\d{1,2})$/);
  if (vertebra) {
    const letter = vertebra[1] === "T" ? "D" : vertebra[1]!;
    const numeric = Number(vertebra[2]);
    const near = sequence.findIndex((entry) => {
      const m = levelKey(entry.key).match(/^([TDLS])(\d{1,2})/);
      return Boolean(m) && m![1] === letter && Number(m![2]) >= numeric;
    });
    if (near >= 0) return near;
  }
  return fallback;
}

/**
 * The acquired levels, in order, each tagged with its domain and owning ledger
 * region. Everything downstream — level cards, the AP table, presets,
 * validators, the junction bridge — reads this list and nothing else.
 */
export function dorsolumbarLevelKeys(state: DorsoLumbarState | null | undefined): DorsoLumbarLevelKey[] {
  const s = state ?? defaultDorsoLumbarState();
  const sequence = dorsolumbarFullLevelSequence(s.lumbar);
  const from = boundIndex(sequence, s.superior, 0);
  const to = boundIndex(sequence, s.inferior, sequence.length - 1);
  if (to < from) return [];
  return sequence.slice(from, to + 1);
}

export function dorsolumbarLevelKeyStrings(state: DorsoLumbarState | null | undefined): string[] {
  return dorsolumbarLevelKeys(state).map((k) => k.key);
}

/** AP canal rows are offered at exactly the acquired levels (spec §13). */
export function dorsolumbarApLevels(state: DorsoLumbarState | null | undefined): string[] {
  return dorsolumbarLevelKeyStrings(state);
}

export function dorsolumbarDomains(state: DorsoLumbarState | null | undefined): Record<DorsoLumbarDomain, DorsoLumbarLevelKey[]> {
  const keys = dorsolumbarLevelKeys(state);
  return {
    thoracic: keys.filter((k) => k.domain === "thoracic"),
    junction: keys.filter((k) => k.domain === "junction"),
    lumbar: keys.filter((k) => k.domain === "lumbar"),
  };
}

/** Is this level inside the acquired field of view? */
export function isDorsoLumbarLevelAcquired(level: string, state: DorsoLumbarState | null | undefined): boolean {
  // Compared canonically, so a bridge written "L1-T12" matches the "T12-L1"
  // slot the sequence carries.
  const want = canonicalDorsoLumbarLevel(level)?.ledgerLevel ?? "";
  if (!want) return false;
  return dorsolumbarLevelKeys(state).some((entry) => levelKey(entry.key) === want);
}

/** Spellings of the bridge that must all land on one identity (dash-free). */
const JUNCTION_ALIASES = new Set(["T12L1", "D12L1", "L1T12", "L1D12", "TLS", "TL"]);

function isJunctionSpelling(raw: string | null | undefined): boolean {
  const dashed = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/[\/–—]/g, "-");
  return JUNCTION_ALIASES.has(dashed.replace(/-/g, ""));
}

/**
 * Which domain a level belongs to, decided by anatomy rather than by the panel
 * that asked. Unknown levels return null so a caller can never guess its way to
 * a cord, conus or cauda statement.
 */
export function dorsolumbarLevelDomain(level: string): DorsoLumbarDomain | null {
  // Every bridge spelling is the bridge, including the reversed "L1-T12" that
  // `normalizeLevel` leaves as "L1-D12": the leading letter alone would call it
  // lumbar and hand the junction to the cauda side of the anatomy model.
  if (isJunctionSpelling(level)) return "junction";
  const key = levelKey(level);
  if (!key) return null;
  // The leading vertebra decides the domain, so a transitional key such as
  // "L5-T" or "L6-S1" stays lumbar instead of falling through unmatched.
  const first = key.match(/^([TDLS])\d+/);
  if (!first) return null;
  return first[1] === "L" || first[1] === "S" ? "lumbar" : "thoracic";
}

/**
 * Which canal AP table a dorso-lumbar level's measurement belongs to.
 *
 * A Dorso-Lumbar examination crosses the junction, so no single segment table
 * describes it: thoracic and bridge rows are dorsal lettering, lumbar rows are
 * lumbar. Both the canal grid and the level-entry form ask this one function, so
 * the same disc cannot be filed under two tables by two surfaces.
 */
export function dorsolumbarCanalSegment(level: string | null | undefined): "lumbar" | "dorsal" {
  return dorsolumbarLevelDomain(level ?? "") === "lumbar" ? "lumbar" : "dorsal";
}

export type DorsoLumbarCanonicalLevel = {
  /** Canonical printed key. */
  key: string;
  /** Canonical ledger key (CARE letters thoracic levels D). */
  ledgerLevel: string;
  /** The one ledger region allowed to own observations at this level. */
  ledgerRegion: string;
  domain: DorsoLumbarDomain;
  junction: boolean;
};

/**
 * Canonicalize a level the radiologist or a panel supplied.
 *
 * Every spelling of the thoracolumbar bridge — "T12-L1", "D12-L1", "L1-T12",
 * "TLS" — resolves to the same key and the same owning region, so a junction
 * finding entered from the thoracic side and one entered from the lumbar side
 * collide in exactly one slot instead of producing two.
 */
export function canonicalDorsoLumbarLevel(
  raw: string | null | undefined,
): DorsoLumbarCanonicalLevel | null {
  const input = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!input) return null;
  if (isJunctionSpelling(input)) {
    return {
      key: JUNCTION_LEVEL,
      ledgerLevel: levelKey(JUNCTION_LEVEL),
      ledgerRegion: JUNCTION_LEDGER_REGION,
      domain: "junction",
      junction: true,
    };
  }
  const domain = dorsolumbarLevelDomain(input);
  if (!domain || domain === "junction") return null;
  const ledger = levelKey(input);
  return {
    key: displayLevel(ledger),
    ledgerLevel: ledger,
    ledgerRegion: domain === "thoracic" ? "Dorsal Spine" : "LS Spine",
    domain,
    junction: false,
  };
}

/** The neural structure actually present at a level (spec §12). */
export type DorsoLumbarNeuralStructure = "cord" | "conus" | "cauda" | "unknown";

export function dorsolumbarNeuralStructure(
  level: string,
  state: DorsoLumbarState | null | undefined,
): DorsoLumbarNeuralStructure {
  const canonical = canonicalDorsoLumbarLevel(level);
  if (!canonical) return "unknown";
  if (canonical.domain === "thoracic") return "cord";
  // The bridge is where the cord ends and the cauda begins; which of them the
  // report may describe depends on the coverage and the stated conus level.
  if (canonical.domain === "junction") return dorsolumbarConusCovered(state) ? "conus" : "cord";
  const key = canonical.ledgerLevel;
  const upper = key.match(/^L(\d+)/)?.[1];
  if (!upper) return "cauda";
  return Number(upper) === 1 && dorsolumbarConusCovered(state) ? "conus" : "cauda";
}

/** Conus assessment needs the bridge inside the field of view (spec §4, §12). */
export function dorsolumbarConusCovered(state: DorsoLumbarState | null | undefined): boolean {
  const keys = dorsolumbarLevelKeys(state);
  return keys.some((entry) => entry.junction === true)
    || keys.some((entry) => entry.domain === "lumbar" && /^L1/.test(entry.key));
}

export function dorsolumbarCaudaCovered(state: DorsoLumbarState | null | undefined): boolean {
  return dorsolumbarLevelKeys(state).some((entry) => entry.domain === "lumbar");
}

export function dorsolumbarCordCovered(state: DorsoLumbarState | null | undefined): boolean {
  return dorsolumbarLevelKeys(state).some((entry) => entry.domain === "thoracic");
}

/**
 * Is the bridge itself inside the acquired field of view?
 *
 * Stricter than `dorsolumbarConusCovered`: the conus may sit at L1-L2 and be
 * assessable when the junction disc was not acquired, but a junction statement
 * needs the T12-L1 level in the coverage.
 */
export function dorsolumbarJunctionCovered(state: DorsoLumbarState | null | undefined): boolean {
  return dorsolumbarDomains(state).junction.length > 0;
}

/** Header banner: naming the counting basis and the coverage is a safety line. */
export function dorsolumbarNumberingBanner(state: DorsoLumbarState | null | undefined): string {
  const s = state ?? defaultDorsoLumbarState();
  const keys = dorsolumbarLevelKeys(s);
  const first = keys[0]?.label ?? "—";
  const last = keys[keys.length - 1]?.label ?? "—";
  const mode = DORSOLUMBAR_NUMBERING_MODES.find((m) => m.id === s.numbering)?.label ?? s.numbering;
  const parts = [`Numbering: ${mode}`, `Coverage: ${first} → ${last}`];
  if (!s.wholeSpineLocalizer && s.numbering !== "localizer-confirmed") {
    parts.push("no whole-spine localizer — level certainty reduced");
  }
  if (s.numbering === "uncertain") parts.push("absolute levels require review before finalization");
  if (s.lumbar.mode !== "standard") parts.push("transitional lumbar anatomy");
  return parts.join(" · ");
}

/** Report-visible numbering caveat, emitted only when certainty is reduced. */
export function dorsolumbarNumberingCaution(state: DorsoLumbarState | null | undefined): string {
  const s = state ?? defaultDorsoLumbarState();
  const parts: string[] = [];
  if (s.numbering === "cervicothoracic-landmark") {
    parts.push("Thoracic levels are numbered from the cervicothoracic junction on the acquired series.");
  } else if (s.numbering === "thoracolumbar-landmark") {
    parts.push("The thoracolumbar junction is numbered from the last rib-bearing vertebra on the acquired series.");
  } else if (s.numbering === "standard-morphology") {
    parts.push("Level numbering assumes standard vertebral morphology without a transitional segment.");
  } else if (s.numbering === "manual") {
    const note = (s.designationNote ?? "").trim();
    parts.push(note
      ? `Vertebral numbering is as stated by the reporting radiologist (${note}).`
      : "Vertebral numbering is as stated by the reporting radiologist.");
  } else if (s.numbering === "uncertain") {
    parts.push("Absolute vertebral level assignment across the thoracolumbar junction is uncertain on this examination.");
  }
  if (!s.wholeSpineLocalizer && s.numbering !== "localizer-confirmed" && s.numbering !== "uncertain") {
    parts.push("A whole-spine or dedicated localizer was not available, so absolute vertebral level assignment carries reduced certainty.");
  }
  const keys = dorsolumbarLevelKeys(s);
  if (keys.length > 0) {
    parts.push(`Acquired coverage extends from ${keys[0]!.label} to ${keys[keys.length - 1]!.label}; levels outside this range were not assessed.`);
  }
  if (s.lumbar.mode === "lstv-sacralization" || s.lumbar.mode === "lstv-lumbarization") {
    parts.push("A lumbosacral transitional vertebra is present, so lumbar level designation should be correlated with whole-spine imaging before any intervention.");
  }
  return parts.join(" ");
}

export function dorsolumbarNeedsConsistencyCheck(state: DorsoLumbarState | null | undefined): boolean {
  const s = state ?? defaultDorsoLumbarState();
  return s.numbering === "uncertain"
    || s.numbering === "manual"
    || (!s.wholeSpineLocalizer && s.numbering !== "localizer-confirmed")
    || s.lumbar.mode === "lstv-sacralization"
    || s.lumbar.mode === "lstv-lumbarization";
}

/**
 * Observations the current coverage cannot support.
 *
 * Narrowing coverage never re-labels or deletes an existing finding: the
 * stranded levels are surfaced for the radiologist to review (spec §5).
 */
export function dorsolumbarStrandedLevels(
  rows: readonly {
    observation?: { level?: string | null } | null;
    ownership?: { anatomicalSection?: string | null } | null;
  }[],
  state: DorsoLumbarState | null | undefined,
): string[] {
  const allowed = new Set(dorsolumbarLevelKeys(state).map((entry) => levelKey(entry.key)));
  const affected: string[] = [];
  for (const row of rows) {
    const raw = (row.observation?.level ?? row.ownership?.anatomicalSection ?? "").trim().toUpperCase();
    if (!/^[TDLS]\d/.test(raw)) continue;
    const canonical = canonicalDorsoLumbarLevel(raw);
    if (!canonical) continue;
    if (allowed.has(levelKey(canonical.key))) continue;
    affected.push(canonical.key);
  }
  const unique = [...new Set(affected)];
  if (unique.length === 0) return [];
  return [
    `Level naming: ${unique.length} dorso-lumbar observation${unique.length === 1 ? "" : "s"} (${unique.join(", ")}) `
      + "sit outside the acquired coverage. Review or remove them — the software never renumbers an existing observation.",
  ];
}

/** Coverage wording for the technique / coverage line. */
export function dorsolumbarCoverageSummary(state: DorsoLumbarState | null | undefined): string {
  const keys = dorsolumbarLevelKeys(state);
  if (keys.length === 0) return "No acquired levels are recorded for this examination.";
  const domains = new Set(keys.map((k) => k.domain));
  const spans = [
    domains.has("thoracic") ? "thoracic" : null,
    domains.has("junction") ? "thoracolumbar junction" : null,
    domains.has("lumbar") ? "lumbar" : null,
  ].filter(Boolean);
  return `Coverage: ${keys[0]!.label} to ${keys[keys.length - 1]!.label} (${spans.join(", ")}).`;
}
