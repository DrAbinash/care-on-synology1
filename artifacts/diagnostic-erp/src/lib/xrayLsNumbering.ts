/**
 * xrayLsNumbering.ts — how a lumbosacral film decides what its vertebrae are
 * called (spec §4, §12; library §3, §14). This is the highest-priority module in
 * the feature, because in lumbar radiography the commonest report error is not a
 * missed fracture but a wrong level.
 *
 * There is no `LumbarNumberingResolver` in this repository — the whole-spine MRI
 * and lumbar canvas code assumes five mobile segments (`MRI_LUMBAR_DISC_LEVELS`
 * is L1-L2 … L5-S1, full stop). That assumption is safe for a fixed MRI protocol
 * and unsafe for a plain film, where a transitional lumbosacral vertebra is
 * present in a large minority of adults and the technician's field of view decides
 * what can be counted. So the *conceptual safety* is what is reused here — an
 * explicit basis, an explicit count, and a conservative refusal to guess — while
 * the model itself is authored for radiography:
 *
 *  - numbering is UNSET until the radiologist establishes it. Nothing in the
 *    reporting path infers that the lowest mobile segment is L5-S1;
 *  - every scheme is anchored on a **designated L5** (spec §4: "lowest prominent
 *    lumbar-type vertebra designated L5"), and the display labels are derived
 *    from that anchor, so an extra or fused body changes the labels rather than
 *    silently producing "L6";
 *  - confidence is reduced for every non-standard basis, and a reduced-confidence
 *    study cannot emit level-specific *normal* prose without the caution
 *    (spec §6: "Transitional anatomy/numbering uncertainty must prevent falsely
 *    confident level-specific normal prose");
 *  - Castellvi type is radiologist-selected and only ever recorded when the
 *    transitional anatomy is demonstrated (spec §12). Bertolotti syndrome and
 *    any other syndromic label are never generated.
 *
 * Pure functions only — no store, no React.
 */
import {
  lsLevelConsistencyIssues,
  lsLevelsInText,
  normalizeLsLevel,
  type LsLevelConsistencyIssue,
} from "./xrayLsLevels";

export type LsNumberingBasis =
  /** Nothing established yet — the default, and never silently treated as standard. */
  | "unset"
  /** Five lumbar-type bodies counted, no transitional anatomy. */
  | "standard"
  /** Transitional lumbosacral vertebra present (enlarged TP / pseudoarticulation / fusion). */
  | "lstv"
  /** The lowest lumbar-type body is fused to the sacrum. */
  | "sacralization"
  /** The first sacral segment is lumbarized, so an extra mobile body sits above the sacrum. */
  | "lumbarization"
  /** Numbering anchored by designating the lowest prominent lumbar-type body as L5. */
  | "designatedL5"
  /** Numbering taken from a whole-spine / localizer series that shows the thoracic count. */
  | "wholeSpineLocalizer"
  /** Radiologist designation in words, without one of the named bases above. */
  | "manual";

export type LsNumberingConfidence = "confident" | "reduced";

/** Castellvi types, radiologist-selected, never derived here. */
export const CASTELLVI_TYPES = ["Ia", "Ib", "IIa", "IIb", "IIIa", "IIIb", "IV"] as const;
export type CastellviType = (typeof CASTELLVI_TYPES)[number];

export const LS_NUMBERING_BASIS_LABELS: Record<LsNumberingBasis, string> = {
  unset: "not established",
  standard: "standard numbering — five lumbar-type vertebrae",
  lstv: "transitional lumbosacral vertebra",
  sacralization: "sacralization of the lowest lumbar vertebra",
  lumbarization: "lumbarization of S1",
  designatedL5: "lowest prominent lumbar-type vertebra designated L5",
  wholeSpineLocalizer: "numbering based on whole-spine / localizer information",
  manual: "manual designation by the reporting radiologist",
};

export const LS_NUMBERING_BASIS_OPTIONS: Array<{ value: LsNumberingBasis; label: string }> =
  (Object.keys(LS_NUMBERING_BASIS_LABELS) as LsNumberingBasis[])
    .filter((b) => b !== "unset")
    .map((b) => ({ value: b, label: LS_NUMBERING_BASIS_LABELS[b] }));

export type LsNumbering = {
  basis: LsNumberingBasis;
  /**
   * Lumbar-type vertebral bodies actually counted on the film, when counted.
   * null means "not counted", which keeps confidence reduced.
   */
  lumbarTypeCount: number | null;
  /**
   * Which counted body is L5, 1-based from the top of the lumbar sequence. The
   * display labels are derived from this anchor, so a sixth body above it becomes
   * L6 only if the radiologist counts one, and a fused lowest body does not
   * silently rename the junction. null means "not anchored".
   */
  designatedL5Position: number | null;
  /**
   * Evidence the numbering rests on, in the radiologist's words — e.g. "Twelve
   * rib-bearing thoracic vertebrae confirmed on the standing whole-spine film.".
   */
  evidence: string | null;
  /** Radiologist-selected Castellvi type, only when adequately demonstrated. */
  castellvi: CastellviType | null;
};

export const UNSET_LS_NUMBERING: LsNumbering = {
  basis: "unset",
  lumbarTypeCount: null,
  designatedL5Position: null,
  evidence: null,
  castellvi: null,
};

const TRANSITIONAL_BASES: LsNumberingBasis[] = [
  "lstv",
  "sacralization",
  "lumbarization",
  "designatedL5",
  "manual",
];

export function lsNumberingIsEstablished(n: LsNumbering): boolean {
  return n.basis !== "unset";
}

/**
 * Confidence. Only an explicitly counted five-body sequence, or a whole-spine /
 * localizer basis that also counted five, is confident. Everything else is
 * reduced, and reduced numbering is what turns off falsely level-specific normal
 * prose in the baseline builder (spec §6).
 */
export function lsNumberingConfidence(n: LsNumbering): LsNumberingConfidence {
  if (!lsNumberingIsEstablished(n)) return "reduced";
  if (n.lumbarTypeCount !== 5) return "reduced";
  if (n.basis === "standard" || n.basis === "wholeSpineLocalizer") return "confident";
  if (n.basis === "manual" && n.designatedL5Position === null) return "reduced";
  return "reduced";
}

/** An L6 / L7 label is only meaningful when a transitional body was designated. */
export function lsNumberingAllowsTransitionalLevels(n: LsNumbering): boolean {
  if (!lsNumberingIsEstablished(n)) return false;
  if (TRANSITIONAL_BASES.includes(n.basis)) return true;
  return typeof n.lumbarTypeCount === "number" && n.lumbarTypeCount > 5;
}

/**
 * The display labels implied by the numbering. The anchor is the designated L5;
 * bodies above it are numbered upward and the segment below it is L5-S1, which is
 * what "designated L5" means in practice and what keeps a transitional film from
 * inventing an L6 or renaming the junction.
 *
 * Returns [] when the numbering is not established or not anchored — an empty
 * label set is how the rest of the feature knows it may not make level-specific
 * claims.
 */
export function lsNumberingVertebraLabels(n: LsNumbering): string[] {
  const count = n.lumbarTypeCount;
  const anchor = n.designatedL5Position;
  if (typeof count !== "number" || count < 1 || count > 8) return [];
  const position = typeof anchor === "number" && anchor >= 1 && anchor <= count ? anchor : count;
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    if (i <= position) {
      const ordinal = 5 - (position - i);
      // An anchor that would push the topmost counted body below L1 means the
      // designation is wrong, not that an "L0" exists.
      if (ordinal < 1) return [];
      out.push(`L${ordinal}`);
      continue;
    }
    // Bodies counted BELOW the designated L5 are sacral-type segments — a
    // lumbarized S1 is labelled S1, and the junction above it is still L5-S1.
    out.push(`S${i - position}`);
  }
  // A sequence that cannot start at L1 means the count and the designation
  // disagree: three bodies above a designated L5 is four lumbar vertebrae, not
  // five. Refuse to publish labels rather than silently numbering from L2 — an
  // empty label set is what tells the rest of the feature it may not make
  // level-specific claims.
  if (out[0] !== "L1") return [];
  return out;
}

export function lsNumberingDiscLabels(n: LsNumbering): string[] {
  const bodies = lsNumberingVertebraLabels(n);
  if (bodies.length < 2) return [];
  const discs: string[] = [];
  for (let i = 0; i < bodies.length - 1; i++) {
    discs.push(`${bodies[i]}-${bodies[i + 1]}`);
  }
  // The lumbosacral junction is the disc below the designated L5.
  const last = bodies[bodies.length - 1];
  if (last && !last.startsWith("S")) discs.push(`${last}-S1`);
  return discs;
}

/** Levels the current numbering can legitimately name (T12-L1 is coverage-based). */
export function lsNumberingAllowedLevels(n: LsNumbering): string[] {
  const discs = lsNumberingDiscLabels(n);
  const bodies = lsNumberingVertebraLabels(n);
  if (!discs.length) return [];
  return [...new Set(["T12-L1", ...discs, ...bodies, "S1"])].filter(
    (l) => normalizeLsLevel(l) !== null,
  );
}

/**
 * The Findings sentence that states how the spine was numbered. Written by the
 * model rather than free text so the same sentence drives the ledger, the report
 * and the consistency checks.
 */
export function composeLsNumberingSentence(n: LsNumbering): string {
  if (!lsNumberingIsEstablished(n)) {
    return "The number of lumbar-type vertebrae is not established on these radiographs; segment levels are described as counted and the lowest lumbar-type segment is not assumed to be L5.";
  }
  const parts: string[] = [];
  const counted =
    typeof n.lumbarTypeCount === "number"
      ? `${n.lumbarTypeCount} lumbar-type vertebrae are counted`
      : "The lumbar-type vertebrae are not explicitly counted";
  parts.push(`${counted}; ${LS_NUMBERING_BASIS_LABELS[n.basis]}.`);

  // The designation is only worth stating when it is not the trivial case: on a
  // five-body film with five counted, "designated L5" says nothing a radiologist
  // needs to read.
  const trivial = n.basis === "standard" && n.lumbarTypeCount === 5 && n.designatedL5Position === 5;
  if (typeof n.designatedL5Position === "number" && !trivial) {
    const labels = lsNumberingVertebraLabels(n);
    parts.push(
      `The lowest prominent lumbar-type vertebra is designated L5${
        labels.length ? ` (labelled sequence ${labels.join(", ")})` : ""
      }.`,
    );
  }
  if (n.castellvi) parts.push(`Castellvi type ${n.castellvi} transitional anatomy, as selected by the reporting radiologist.`);
  const evidence = (n.evidence ?? "").trim();
  if (evidence) parts.push(/[^.]$/.test(evidence) ? `${evidence}.` : evidence);
  if (lsNumberingConfidence(n) === "reduced") {
    parts.push(
      "Level numbering is therefore approximate, and level-specific statements should be read with that caution.",
    );
  }
  return parts.join(" ");
}

/** The caution line shown when confidence is reduced (spec §4: "Display caution"). */
export function composeLsNumberingCaution(n: LsNumbering): string | null {
  if (lsNumberingConfidence(n) === "confident") return null;
  if (!lsNumberingIsEstablished(n)) {
    return "Numbering basis not established — do not assume the lowest mobile segment is L5-S1.";
  }
  return "Transitional lumbosacral anatomy present — level labels follow the designated L5, not the segment count.";
}

export type LsNumberingIssue = LsLevelConsistencyIssue;

/**
 * Numbering / level consistency (spec §18: "inconsistent level numbering", "LSTV
 * with conflicting labels"). Combines the pure level checks with the numbering
 * model: a label the current scheme cannot produce, or a transitional film that
 * still calls its junction the fifth lumbar disc without anchoring it.
 */
export function lsNumberingConsistencyIssues(
  text: string | null | undefined,
  n: LsNumbering,
): LsNumberingIssue[] {
  const t = (text ?? "").trim();
  if (!t) return [];

  const issues = lsLevelConsistencyIssues(t, {
    lumbarTypeCount: n.lumbarTypeCount,
    allowTransitionalLevels: lsNumberingAllowsTransitionalLevels(n),
  });

  const allowed = lsNumberingAllowedLevels(n);
  if (allowed.length) {
    for (const level of lsLevelsInText(t)) {
      if (allowed.includes(level)) continue;
      // T12-L1 is a coverage statement rather than a numbering statement.
      if (level === "T12-L1" || level === "T12") continue;
      issues.push({
        level,
        detail: `${level} cannot be produced by the recorded numbering (${LS_NUMBERING_BASIS_LABELS[n.basis]}) — the labels are ${allowed.join(", ")}`,
      });
    }
  }

  // The specific silent assumption §4 forbids.
  if (
    lsNumberingIsEstablished(n) &&
    lsNumberingAllowsTransitionalLevels(n) &&
    n.designatedL5Position === null &&
    /\bL5-S1\b/i.test(t)
  ) {
    issues.push({
      level: "L5-S1",
      detail:
        "L5-S1 is named on a transitional film without a designated L5 — anchor the numbering before labelling the lumbosacral junction",
    });
  }

  // Counted six or more bodies but described as a normal five-segment lumbar spine.
  if (typeof n.lumbarTypeCount === "number" && n.lumbarTypeCount > 5 && /\bnormal five\b|\bfive lumbar vertebrae\b/i.test(t)) {
    issues.push({
      level: "L5",
      detail: `The report states five lumbar vertebrae while ${n.lumbarTypeCount} lumbar-type bodies are recorded`,
    });
  }

  // Transitional anatomy asserted without a Castellvi selection is fine; a
  // Castellvi type recorded while the basis says standard is not.
  if (n.castellvi && n.basis === "standard") {
    issues.push({
      level: "L5-S1",
      detail: `Castellvi type ${n.castellvi} is recorded while the numbering basis is standard`,
    });
  }

  return issues;
}

/**
 * Whether level-specific NORMAL prose may be written confidently. Spec §6: a
 * transitional or unanchored study must not certify "L4-L5 disc space preserved"
 * with the same confidence as a study that counted five segments.
 */
export function lsLevelSpecificNormalAllowed(n: LsNumbering): boolean {
  return lsNumberingIsEstablished(n) && lsNumberingConfidence(n) === "confident";
}

/** Parse a numbering record from stored/JSON-ish input, defensively. */
export function parseLsNumbering(raw: unknown): LsNumbering {
  if (!raw || typeof raw !== "object") return UNSET_LS_NUMBERING;
  const o = raw as Record<string, unknown>;
  const basis = LS_NUMBERING_BASIS_LABELS[o.basis as LsNumberingBasis]
    ? (o.basis as LsNumberingBasis)
    : "unset";
  const count = typeof o.lumbarTypeCount === "number" && Number.isFinite(o.lumbarTypeCount) ? o.lumbarTypeCount : null;
  const position =
    typeof o.designatedL5Position === "number" && Number.isFinite(o.designatedL5Position)
      ? o.designatedL5Position
      : null;
  const castellvi = CASTELLVI_TYPES.includes(o.castellvi as CastellviType)
    ? (o.castellvi as CastellviType)
    : null;
  return {
    basis,
    lumbarTypeCount: count,
    designatedL5Position: position,
    evidence: typeof o.evidence === "string" ? o.evidence : null,
    castellvi,
  };
}

const NUMBERING_COUNT =
  /(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+lumbar[- ]type (?:vertebral bodies|vertebrae)/i;
const NUMBERING_SEQUENCE = /labelled sequence ([^)]+)/i;

/** Castellvi is radiologist-selected prose, never derived from an image here. */
const CASTELLVI_WORD = /castellvi type (IV|III[ab]|II[ab]|I[ab])\b/i;

/** Dictated counts are spelled as often as they are typed as digits. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Basis labels, in the order they may be tested. `designatedL5` goes LAST: its
 * label wording ("lowest prominent lumbar-type vertebra designated L5") is a
 * substring-shaped phrase that the anchor sentence of EVERY basis also comes close
 * to, so matching it earlier would erase the real basis.
 */
const BASIS_LABEL_ORDER: LsNumberingBasis[] = [
  "wholeSpineLocalizer",
  "lumbarization",
  "sacralization",
  "lstv",
  "manual",
  "standard",
  "designatedL5",
];

/**
 * Basis patterns for prose a radiologist typed by hand. Same order discipline as
 * the labels: transitional anatomy outranks the designation wording, because every
 * transitional sentence also says which body was designated L5.
 */
const NUMBERING_BASIS_PATTERNS: Array<[LsNumberingBasis, RegExp]> = [
  ["wholeSpineLocalizer", /whole[- ]spine\s*\/?\s*localizer|localizer information|numbering based on (?:a |the )?whole[- ]spine/i],
  ["lumbarization", /lumbari[sz]ation of (?:the first sacral segment|s1)/i],
  ["sacralization", /sacrali[sz]ation of the lowest (?:prominent )?lumbar/i],
  ["lstv", /transitional lumbosacral (?:vertebra|anatomy)|transitional vertebra/i],
  ["manual", /manual designation|radiologist[- ]selected numbering/i],
  ["standard", /numbering is standard|standard numbering/i],
  ["designatedL5", /(?:lowest prominent lumbar[- ]type vertebra is )?designated (?:as )?L5/i],
];

/**
 * Read a numbering record back out of report prose.
 *
 * The numbering basis is persisted as an ordinary Findings sentence — this feature
 * adds no schema, so the state travels with the report exactly the way the
 * Technique field carries views. That only works if the prose can be read again:
 * without this parser, reopening a saved study would silently fall back to
 * "numbering not established" and switch off every level-bearing tile that was
 * available while the report was being written.
 *
 * Deliberately conservative. An unrecognizable sentence yields UNSET — the same
 * record that refuses level-specific claims — rather than a guessed basis.
 */
export function parseLsNumberingFromText(text: string | null | undefined): LsNumbering {
  const t = (text ?? "").trim();
  if (!t) return UNSET_LS_NUMBERING;
  const lower = t.toLowerCase();

  let basis: LsNumberingBasis | null = null;
  for (const candidate of BASIS_LABEL_ORDER) {
    if (candidate === "unset") continue;
    if (lower.includes(LS_NUMBERING_BASIS_LABELS[candidate].toLowerCase())) {
      basis = candidate;
      break;
    }
  }
  if (!basis) {
    const found = NUMBERING_BASIS_PATTERNS.find(([, re]) => re.test(t));
    if (!found) return UNSET_LS_NUMBERING;
    basis = found[0];
  }

  const countMatch = NUMBERING_COUNT.exec(t);
  let lumbarTypeCount: number | null = null;
  if (countMatch) {
    const token = (countMatch[1] ?? "").toLowerCase();
    const digits = Number(token);
    lumbarTypeCount = Number.isFinite(digits) ? digits : (NUMBER_WORDS[token] ?? null);
  }

  // The anchor is what the labelled sequence says it is. A designation with no
  // sequence means the lowest counted body was designated L5, which is the
  // definition the library gives ("lowest prominent lumbar-type vertebra
  // designated L5").
  let designatedL5Position: number | null = null;
  const sequence = NUMBERING_SEQUENCE.exec(t);
  if (sequence) {
    const labels = sequence[1].split(",").map((label) => label.trim().toUpperCase());
    const index = labels.indexOf("L5");
    if (index >= 0) designatedL5Position = index + 1;
  } else if (/designated (?:as )?L5/i.test(t)) {
    designatedL5Position = lumbarTypeCount;
  }
  // "Five lumbar-type vertebrae are counted, and numbering is standard."
  // states the count and the convention, which IS the standard anchor.
  if (designatedL5Position === null && basis === "standard" && lumbarTypeCount === 5) {
    designatedL5Position = 5;
  }

  // The declared types are mixed case ("IIa"), so the dictated form is matched
  // case-insensitively and then canonicalized back to the declared spelling.
  const castellviMatch = CASTELLVI_WORD.exec(t);
  const castellvi =
    castellviMatch
      ? (CASTELLVI_TYPES.find((type) => type.toLowerCase() === castellviMatch[1].toLowerCase()) ?? null)
      : null;

  return { basis, lumbarTypeCount, designatedL5Position, evidence: null, castellvi };
}
