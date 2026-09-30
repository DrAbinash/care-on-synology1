/**
 * xrayLsLevels.ts — lumbosacral level vocabulary and numbering safety for plain
 * films (spec §4, §5, §18).
 *
 * The lumbar spine is where radiographic numbering actually goes wrong, and the
 * failure is not arithmetic but anatomy: a transitional lumbosacral vertebra
 * means the lowest mobile segment may be an L6-type vertebra, or the "L5" may be
 * partly fused to the sacrum. CARE's existing lumbar vocabulary
 * (`MRI_LUMBAR_DISC_LEVELS` in mriLumbarRegions.ts) is the five mobile segments
 * L1-L2 … L5-S1 and assumes exactly that, which is safe for a normal MRI protocol
 * and not safe for a plain-film report that has to say what it counted. This
 * module therefore covers T12-L1 through L5-S1 (spec §5: "T12-L1 if included"),
 * tolerates an L6/L7 label when the numbering model says a transitional vertebra
 * was designated, and reports the inconsistency rather than silently renumbering.
 *
 * Reuses the conservative contract of `normalizeLevel`
 * (lib/baseline-manifest): an unrecognized level returns null and is never
 * guessed into a patient report. CARE writes thoracic vertebrae as `D*`
 * internally while every piece of spine content — the seeded XR protocol, the
 * clinical libraries, `spineCanalAp.ts` — says `T12`, so display form is `T12`
 * and both spellings resolve to the same level.
 *
 * Pure functions only — no store, no React.
 */

/** Vertebrae an LS film can legitimately name, top to bottom. */
export const LS_VERTEBRAL_LEVELS = [
  "T12", "L1", "L2", "L3", "L4", "L5", "S1",
] as const;

/** Disc / motion segments the library comments on (spec §5, library §6). */
export const LS_DISC_LEVELS = [
  "T12-L1", "L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1",
] as const;

/** The lumbosacral junction, named once so prose and gates agree (spec §2). */
export const LS_JUNCTION_LEVEL = "L5-S1";

/** Segments that only exist when the upper junction is in the field of view. */
export const LS_UPPER_JUNCTION_LEVEL = "T12-L1";

export type LsVertbralLevel = (typeof LS_VERTEBRAL_LEVELS)[number];
export type LsDiscLevel = (typeof LS_DISC_LEVELS)[number];

/** Transitional anatomy can legitimately produce a sixth or seventh lumbar-type
 *  body; they are representable, but only when the numbering model allows it. */
export const LS_TRANSITIONAL_VERTEBRAE = ["L6", "L7"] as const;

/**
 * Numerical position of a vertebra, top-down. T12 = 0 so the T12-L1 disc sorts
 * before L1-L2; S1 = 6. Lumbar-type bodies counted below L5 (a fully lumbarized
 * S1) continue 6, 7 rather than being renamed.
 */
export function lsVertebraIndex(raw: string | null | undefined): number | null {
  const t = (raw ?? "").trim().toUpperCase();
  const m = /^(T|D)(\d{1,2})$/.exec(t);
  if (m) return Number(m[2]) === 12 ? 0 : null;
  const lumbar = /^L(\d{1,2})$/.exec(t);
  if (lumbar) {
    const n = Number(lumbar[1]);
    return n >= 1 && n <= 7 ? n : null;
  }
  const sacral = /^S(\d{1,2})$/.exec(t);
  if (sacral) return Number(sacral[1]) === 1 ? 6 : null;
  return null;
}

/** Display form: CARE's internal `D12` is written `T12` in a report. */
function displayVertebra(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (/^D12$/.test(t)) return "T12";
  return t;
}

/**
 * Canonical LS level from free text: "l4-5", "L4/L5", "L4 - L5", "L5 S1",
 * "T12-L1", "D12-L1", "L5" → "L4-L5" / "L5-S1" / "L5". Reversed pairs and
 * anything outside the thoracolumbosacral range return null rather than a guess.
 */
export function normalizeLsLevel(raw: string | null | undefined): string | null {
  const t = (raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s*[-/]\s*/g, "-")
    .replace(/\s+/g, "");
  if (!t) return null;

  const pair = /^([TDLS])(\d{1,2})-([TDLS])(\d{1,2})$/.exec(t);
  if (pair) return canonicalPair(`${pair[1]}${pair[2]}`, `${pair[3]}${pair[4]}`);

  // Shorthand pair: L4-5 (the lower number is the next vertebra).
  const short = /^L(\d{1,2})-(\d{1,2})$/.exec(t);
  if (short) return canonicalPair(`L${short[1]}`, `L${short[2]}`);

  // Space-separated pair collapses to this: "L5 S1" → "L5S1".
  const joined = /^([TDLS])(\d{1,2})([TDLS])(\d{1,2})$/.exec(t);
  if (joined) return canonicalPair(`${joined[1]}${joined[2]}`, `${joined[3]}${joined[4]}`);

  const single = /^([TDLS])(\d{1,2})$/.exec(t);
  if (single) {
    const one = `${single[1]}${single[2]}`;
    return lsVertebraIndex(one) === null ? null : displayVertebra(one);
  }
  return null;
}

function canonicalPair(upperRaw: string, lowerRaw: string): string | null {
  const a = lsVertebraIndex(upperRaw);
  const b = lsVertebraIndex(lowerRaw);
  if (a === null || b === null) return null;
  const upper = displayVertebra(upperRaw);
  const lower = displayVertebra(lowerRaw);
  // Two counting conventions for transitional anatomy coexist in practice: the
  // designated-L5 scheme calls the junction L5-S1, a scheme that numbers every
  // lumbar-type body calls the extra one L6 and the junction below it L6-S1. S1
  // and L6 occupy the same position in the top-down sequence, so the pair is
  // named here rather than dropped — levelIsAtLumbosacralJunction and the
  // coverage gates depend on seeing it.
  if (lower === "S1" && a >= 6 && a <= 7) return `${upper}-${lower}`;
  if (a >= b) return null; // reversed or same-vertebra pair is a numbering error
  return `${upper}-${lower}`;
}

/**
 * Every LS level a piece of prose mentions, canonical and de-duplicated. The
 * lower letter of a pair is captured, not dropped: "L5-S1" must read as one
 * segment, and rebuilding it from the first letter would turn "D12-L1" into a
 * reversed pair. A space-separated pair ("the L5 S1 junction") is captured only
 * when the second token carries its own letter, so "L5 6 mm of translation" does
 * not become an L5-L6 segment.
 */
export function lsLevelsInText(text: string | null | undefined): string[] {
  const t = (text ?? "");
  const out: string[] = [];
  const re = /\b([TDLS])(\d{1,2})(?:\s*[-/]\s*(?:([TDLS])?(\d{1,2}))|\s+([TDLS])(\d{1,2}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const upper = `${m[1]}${m[2]}`.toUpperCase();
    const lower = m[6] ? `${m[5]}${m[6]}` : m[4] ? `${m[3] ?? m[1]}${m[4]}` : null;
    if (lower) {
      const pair = normalizeLsLevel(`${upper}-${lower.toUpperCase()}`);
      if (pair && !out.includes(pair)) out.push(pair);
      continue;
    }
    const one = normalizeLsLevel(upper);
    if (one && !out.includes(one)) out.push(one);
  }
  return out;
}

/** The two vertebrae a disc level sits between (spec §8: "of [vertebra] over
 *  [vertebra]" must agree with the level named beside it). */
export function vertebraeOfLsDiscLevel(level: string | null | undefined): [string, string] | null {
  const norm = normalizeLsLevel(level);
  if (!norm || !norm.includes("-")) return null;
  const [a, b] = norm.split("-");
  return [a as string, b as string];
}

/** True when the level is at or below the lumbosacral junction (spec §2). */
export function levelIsAtLumbosacralJunction(level: string | null | undefined): boolean {
  const norm = normalizeLsLevel(level);
  if (!norm) return false;
  return norm === LS_JUNCTION_LEVEL || norm.endsWith("-S1");
}

/** True when the level needs the upper junction in the field of view. */
export function levelIsAboveConus(level: string | null | undefined): boolean {
  return normalizeLsLevel(level) === LS_UPPER_JUNCTION_LEVEL;
}

/**
 * Level numbering consistency (spec §18). `allowTransitional` comes from the
 * numbering module: an L6 label is a numbering error on a study that counted five
 * lumbar-type bodies, and is exactly what the radiologist means when a
 * transitional vertebra has been designated.
 */
export type LsLevelConsistencyOptions = {
  /** Lumbar-type vertebral bodies the radiologist counted, when known. */
  lumbarTypeCount?: number | null;
  /** True when a transitional vertebra has been designated (spec §4, §12). */
  allowTransitionalLevels?: boolean;
};

export type LsLevelConsistencyIssue = { level: string; detail: string };

const LISTHESIS_WORDS = /listhesis|subluxation|\bslip\b|translation/i;
const LISTHESIS_PAIR =
  /\b([TDLS])(\d{1,2})\s+(?:over|on(?:to)?|upon)\s+(?:the\s+)?(?:level\s+)?(?:([TDLS])?(\d{1,2}))\b/gi;
const REVERSED_PAIR = /\b([TDLS])(\d{1,2})\s*[-/]\s*([TDLS])(\d{1,2})\b/gi;
const CERVICAL_TOKEN = /\bC[1-7]\b/i;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function lsLevelConsistencyIssues(
  text: string | null | undefined,
  opts: LsLevelConsistencyOptions = {},
): LsLevelConsistencyIssue[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  const issues: LsLevelConsistencyIssue[] = [];
  const seen = new Set<string>();
  const add = (level: string, detail: string) => {
    const key = `${level}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ level, detail });
  };

  const allowTransitional = opts.allowTransitionalLevels === true;

  // L0 never exists; L6 / L7 only when a transitional vertebra was designated.
  for (const m of t.match(/\bL[0-9]\b/gi) ?? []) {
    const label = m.toUpperCase();
    const idx = lsVertebraIndex(label);
    if (idx === null || idx === 0) {
      add(label, `"${label}" is not a lumbar vertebra`);
      continue;
    }
    if (idx > 5 && !allowTransitional) {
      add(
        label,
        `${label} is named, but no transitional vertebra has been designated — numbering the lowest mobile segment requires an explicit basis (spec §4)`,
      );
    }
  }

  // A cervical label inside an LS report is a mis-keyed level.
  const cervical = CERVICAL_TOKEN.exec(t);
  if (cervical) {
    add(
      cervical[0].toUpperCase(),
      `"${cervical[0].toUpperCase()}" is cervical numbering in a lumbosacral report — check the level was not mis-keyed`,
    );
  }

  for (const sentence of sentencesOf(t)) {
    if (!LISTHESIS_WORDS.test(sentence)) continue;
    LISTHESIS_PAIR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LISTHESIS_PAIR.exec(sentence)) !== null) {
      const upperRaw = `${m[1]}${m[2]}`.toUpperCase();
      const lowerRaw = `${m[3] ?? m[1]}${m[4]}`.toUpperCase();
      const label = `${displayVertebra(upperRaw)} over ${displayVertebra(lowerRaw)}`;
      const ai = lsVertebraIndex(upperRaw);
      const bi = lsVertebraIndex(lowerRaw);
      if (ai === null || bi === null) {
        add(label, `"${label}" is outside the thoracolumbosacral range (T12-S1)`);
        continue;
      }
      if (bi !== ai + 1) {
        // "L6 over S1" is the same junction under the lumbar-type counting
        // convention; S1 shares L6's index, so adjacency is not arithmetic here.
        const lumbosacralJunction = lowerRaw === "S1" && (ai === 5 || ai === 6);
        if (!lumbosacralJunction) {
          add(
            label,
            `"${label}" names vertebrae that are not adjacent — a listhesis is one vertebra over the one directly below it`,
          );
          continue;
        }
      }
      const disc = `${displayVertebra(upperRaw)}-${displayVertebra(lowerRaw)}`;
      for (const quoted of lsLevelsInText(sentence).filter((l) => l.includes("-"))) {
        if (quoted !== disc) {
          add(disc, `"${label}" is the ${disc} segment, but the same sentence quotes the ${quoted} level`);
        }
      }
    }
  }

  REVERSED_PAIR.lastIndex = 0;
  let rp: RegExpExecArray | null;
  while ((rp = REVERSED_PAIR.exec(t)) !== null) {
    const firstRaw = `${rp[1]}${rp[2]}`.toUpperCase();
    const secondRaw = `${rp[3]}${rp[4]}`.toUpperCase();
    const fi = lsVertebraIndex(firstRaw);
    const si = lsVertebraIndex(secondRaw);
    if (fi === null || si === null || fi <= si) continue;
    const correct = `${normalizeLsLevel(secondRaw)}-${normalizeLsLevel(firstRaw)}`;
    add(
      correct,
      `"${rp[0].toUpperCase()}" is written with the lower vertebra first — the segment is ${correct}`,
    );
  }

  // Counting six lumbar-type bodies while calling the last disc L5-S1 is the
  // silent assumption spec §4 forbids.
  if (typeof opts.lumbarTypeCount === "number" && opts.lumbarTypeCount > 5 && !allowTransitional) {
    add(
      "L5-S1",
      `${opts.lumbarTypeCount} lumbar-type vertebrae are recorded while the numbering basis is not transitional — do not silently call the lowest mobile segment L5-S1`,
    );
  }

  return issues;
}

/** Level selectors for the canvas, in anatomical order. */
export const LS_LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  ...LS_DISC_LEVELS.map((l) => ({ value: l, label: l })),
  ...LS_VERTEBRAL_LEVELS.filter((v) => v !== "S1").map((v) => ({ value: v, label: v })),
];

export const LS_VERTEBRA_OPTIONS: Array<{ value: string; label: string }> =
  LS_VERTEBRAL_LEVELS.map((v) => ({ value: v, label: v }));
