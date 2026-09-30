/**
 * xrayCervicalLevels.ts — cervical level vocabulary and numbering safety for
 * plain-film reporting (spec §4, §6, §15).
 *
 * Why this exists next door to the MRI modules: the repo has two level
 * conventions and both are load-bearing. `normalizeLevel`
 * (lib/baseline-manifest) and `normalizeDiscLevel` (spineCanalAp.ts) rewrite
 * thoracic `T*` into CARE's `D*` form, while the cervical clinical content — the
 * canonical library ("C2-3 through C7-T1"), the seeded XR protocol checklist
 * ("Adequacy (C7-T1 seen)") and the MRI cervical canvas levels — all say
 * `C7-T1`. A patient report must read C7-T1; the ledger slot key must be stable
 * whichever spelling produced it. So this module owns the DISPLAY form for
 * radiography and treats T↔D as the same level when checking consistency,
 * instead of inventing a third numbering scheme.
 *
 * Reuses the conservative contract of `normalizeLevel`: an unrecognized level
 * returns null and is never guessed into a patient report.
 *
 * Pure functions only — no store, no React.
 */

/** Vertebral bodies a cervical film comments on. */
export const CERVICAL_VERTEBRAL_LEVELS = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "T1",
] as const;

/** Disc / motion-segment levels, library wording (spec §4: C2-3 … C7-T1). */
export const CERVICAL_DISC_LEVELS = [
  "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
] as const;

/** Craniocervical junction level, separate from the subaxial disc levels. */
export const CERVICAL_CCJ_LEVEL = "C1-C2";

export type CervicalLevel = (typeof CERVICAL_VERTEBRAL_LEVELS)[number] | (typeof CERVICAL_DISC_LEVELS)[number];

const MAX_CERVICAL = 7;

/** Numerical position of a single vertebra, with T1 (and CARE's D1) = 8. */
export function vertebraIndex(raw: string): number | null {
  const m = /^([CDT])(\d{1,2})$/.exec(raw);
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1] === "C") return n >= 1 && n <= MAX_CERVICAL ? n : null;
  // T1 / D1 is the first thoracic vertebra, immediately below C7. CARE writes
  // the dorsal column D1 internally, so both spellings mean the same level.
  if (m[1] === "T" || m[1] === "D") return n === 1 ? 8 : null;
  return null;
}

/**
 * Canonical cervical level from free text: "c5-6", "C5/C6", "C5-C6", "C7-T1",
 * "C7-D1", "C5", "C1 C2" → "C5-C6" / "C5". Anything outside the cervical
 * range, or a reversed pair, returns null rather than a guessed level.
 */
export function normalizeCervicalLevel(raw: string | null | undefined): string | null {
  const t = (raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s*[-/]\s*/g, "-")
    .replace(/\s+/g, "");
  if (!t) return null;

  // Explicit pair form: C5-C6 / C5-6 / C7-T1 / C1-C2
  const pairMatch = /^([CDT])(\d{1,2})-([CDT])(\d{1,2})$/.exec(t);
  if (pairMatch) {
    return canonicalPair(`${pairMatch[1]}${pairMatch[2]}`, `${pairMatch[3]}${pairMatch[4]}`);
  }
  // Shorthand pair: C5-6 (the lower number is the next vertebra)
  const shortMatch = /^C(\d{1,2})-(\d{1,2})$/.exec(t);
  if (shortMatch) {
    return canonicalPair(`C${shortMatch[1]}`, `C${shortMatch[2]}`);
  }
  // Space-separated pair, once the spaces are gone: "C5 C6" / "C5 C6 level"
  const joined = /^([CDT])(\d{1,2})([CDT])(\d{1,2})$/.exec(t);
  if (joined) {
    return canonicalPair(`${joined[1]}${joined[2]}`, `${joined[3]}${joined[4]}`);
  }
  // Single vertebra
  const single = /^([CDT])(\d{1,2})$/.exec(t);
  if (single) {
    const one = `${single[1]}${single[2]}`;
    return vertebraIndex(one) === null ? null : displayVertebra(one);
  }
  return null;
}

/** C5 + C6 → "C5-C6" in display form; null when the pair is not cervical. */
function canonicalPair(upperRaw: string, lowerRaw: string): string | null {
  const a = vertebraIndex(upperRaw);
  const b = vertebraIndex(lowerRaw);
  if (a === null || b === null) return null;
  if (a >= b) return null; // reversed or same-level pair is a numbering error
  return `${displayVertebra(upperRaw)}-${displayVertebra(lowerRaw)}`;
}

/** CARE writes the first thoracic vertebra as D1 internally; reports read T1. */
function displayVertebra(raw: string): string {
  const m = /^([CDT])(\d{1,2})$/.exec(raw);
  if (!m) return raw;
  if (m[1] === "D") return `T${m[2]}`;
  if (m[1] === "T" && Number(m[2]) === 1) return "T1";
  return raw;
}

/**
 * Every level token a piece of prose mentions, in canonical display form.
 *
 * The lower letter of a pair is captured, not just consumed: "C7-T1" must read
 * as the C7-T1 segment. Dropping the `T` and re-attaching it to `1` would
 * produce "C7-C1", i.e. a reversed pair, and the most important adequacy level
 * in cervical radiography would silently disappear from consistency checking.
 */
export function cervicalLevelsInText(text: string | null | undefined): string[] {
  const t = (text ?? "");
  const out: string[] = [];
  const re = /\b([CDST])(\d{1,2})\s*(?:[-/]\s*(?:([CDST])?(\d{1,2})))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const upper = `${m[1]}${m[2]}`.toUpperCase();
    if (m[4]) {
      const lower = `${m[3] ?? m[1]}${m[4]}`.toUpperCase();
      const pair = normalizeCervicalLevel(`${upper}-${lower}`);
      if (pair && !out.includes(pair)) out.push(pair);
      continue;
    }
    const one = normalizeCervicalLevel(upper);
    if (one && !out.includes(one)) out.push(one);
  }
  return out;
}

/**
 * The two vertebrae a disc level sits between (spec §6: "anterolisthesis of
 * [vertebra] over [vertebra]" must agree with the level the report names).
 */
export function vertebraeOfDiscLevel(level: string | null | undefined): [string, string] | null {
  const norm = normalizeCervicalLevel(level);
  if (!norm || !norm.includes("-")) return null;
  const [a, b] = norm.split("-");
  return [a as string, b as string];
}

export type LevelConsistencyIssue = {
  level: string;
  detail: string;
};

const LISTHESIS_WORDS = /listhesis|subluxation|\bslip\b/i;

/**
 * "[Antero]listhesis of C6 over C7" — the prefix is part of the word, so the
 * pattern must not require a boundary before `listhesis` or every real
 * anterolisthesis sentence would slip past the check.
 */
const LISTHESIS_PAIR =
  /\b([CDT])(\d{1,2})\s+(?:over|on(?:to)?|upon)\s+(?:the\s+)?(?:level\s+)?(?:([CDT])?(\d{1,2}))\b/gi;

/** "C6-C7" written with the vertebrae the wrong way round. */
const REVERSED_PAIR = /\b([CDT])(\d{1,2})\s*[-/]\s*([CDT])(\d{1,2})\b/gi;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Numbering / level consistency (spec §15). Detects the mistakes a human
 * editor actually makes in a cervical report: a vertebra quoted outside the
 * cervical range, a "X over Y" listhesis pair that names non-adjacent
 * vertebrae or contradicts the level quoted in the same sentence, a reversed
 * pair, and a cervical report that carries lumbar/sacral numbering.
 *
 * Deliberately conservative: it reports what cannot be true, never a guessed
 * correction, and it only compares levels inside one sentence, because a
 * cervical report legitimately quotes several levels across paragraphs.
 */
export function cervicalLevelConsistencyIssues(
  text: string | null | undefined,
): LevelConsistencyIssue[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  const issues: LevelConsistencyIssue[] = [];
  const seen = new Set<string>();
  const add = (level: string, detail: string) => {
    const key = `${level}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ level, detail });
  };

  // C8 does not exist; neither does C0, and C9 is never meant.
  const impossible = /\bC(?:0|8|9)\b/i.exec(t);
  if (impossible) {
    add(
      impossible[0].toUpperCase(),
      `${impossible[0].toUpperCase()} is not a cervical vertebra — the cervical spine is C1 to C7`,
    );
  }

  // Lumbar / sacral numbering in a cervical report.
  const otherRegion = /\b(?:L[1-5]|S[1-5])\b/.exec(t);
  if (otherRegion) {
    add(
      otherRegion[0],
      `"${otherRegion[0]}" is lumbar / sacral numbering in a cervical report — check the level was not mis-keyed`,
    );
  }

  for (const sentence of sentencesOf(t)) {
    if (!LISTHESIS_WORDS.test(sentence)) continue;
    LISTHESIS_PAIR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LISTHESIS_PAIR.exec(sentence)) !== null) {
      const upperRaw = `${m[1]}${m[2]}`.toUpperCase();
      const lowerRaw = `${m[3] ?? m[1]}${m[4]}`.toUpperCase();
      const label = `${upperRaw} over ${lowerRaw}`;
      const upper = normalizeCervicalLevel(upperRaw);
      const lower = normalizeCervicalLevel(lowerRaw);
      if (!upper || !lower) {
        add(label, `"${label}" is outside the cervical range (C1-T1)`);
        continue;
      }
      const ai = vertebraIndex(upperRaw);
      const bi = vertebraIndex(lowerRaw);
      if (ai === null || bi === null) {
        add(label, `"${label}" is outside the cervical range (C1-T1)`);
        continue;
      }
      if (bi !== ai + 1) {
        add(
          label,
          `"${label}" names vertebrae that are not adjacent — a listhesis is one vertebra over the one directly below it`,
        );
        continue;
      }
      const disc = `${upper}-${lower}`;
      const quoted = cervicalLevelsInText(sentence).filter((l) => l.includes("-"));
      for (const q of quoted) {
        if (q !== disc) {
          add(
            disc,
            `"${label}" is the ${disc} segment, but the same sentence quotes the ${q} level`,
          );
        }
      }
    }
  }

  REVERSED_PAIR.lastIndex = 0;
  let rp: RegExpExecArray | null;
  while ((rp = REVERSED_PAIR.exec(t)) !== null) {
    const firstRaw = `${rp[1]}${rp[2]}`.toUpperCase();
    const secondRaw = `${rp[3]}${rp[4]}`.toUpperCase();
    const fi = vertebraIndex(firstRaw);
    const si = vertebraIndex(secondRaw);
    if (fi === null || si === null || fi <= si) continue;
    const correct = `${normalizeCervicalLevel(secondRaw)}-${normalizeCervicalLevel(firstRaw)}`;
    add(
      correct,
      `"${rp[0].toUpperCase()}" is written with the lower vertebra first — the segment is ${correct}`,
    );
  }

  return issues;
}

/** Options for the canvas level selectors, in anatomical order. */
export const CERVICAL_LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  ...[{ value: CERVICAL_CCJ_LEVEL, label: "C1-C2 (craniocervical)" }],
  ...CERVICAL_DISC_LEVELS.map((l) => ({ value: l, label: l })),
];

export const CERVICAL_VERTEBRA_OPTIONS: Array<{ value: string; label: string }> =
  CERVICAL_VERTEBRAL_LEVELS.map((l) => ({ value: l, label: l }));
