/**
 * Mandatory preservation of dictated clinical detail.
 *
 * The AI-PC benchmark proved two silent-drop classes that no schema can catch:
 * a dictated measurement ("AP spinal canal diameter at L4-L5 is 9.2 mm")
 * vanishing from an otherwise-correct plan — right concept, right level, right
 * update target, and no "9.2" anywhere in 8/8 repetitions across two models —
 * and dictated severity / laterality modifiers ("mild", "bilateral") lost from
 * multi-finding plans. Both plans survive zod AND clinical validation today:
 * the validator guards the report against the plan, but nothing guards the
 * plan against the dictation itself.
 *
 * This module is that guard. It extracts the clinical detail the radiologist
 * actually dictated — measurements with their units, anatomical levels,
 * laterality, severity — and requires every one of them to survive into the
 * findingsText of the observations the plan ADDS or UPDATES. A dictated value
 * that cannot be mapped makes the composer refuse the plan with "dictation
 * preserved", so the radiologist restates or retypes it — nothing is ever
 * dropped silently. No wording is invented to fill a gap.
 *
 * Deliberately NOT treated as a drop (would be pedantic, not safe):
 * integer numbers without a clinical unit ("45 years of age"), severity-like
 * words outside the tile vocabulary, details in a removal-only plan (the intent
 * was removal, the value is meant to leave the report), and a plan that asks a
 * clarification (the question is surfaced by the validator, not dropped).
 */
import type { VoiceChangePlan } from "./schema";
import { extractLevels } from "./transcriptNormalize";

export type DictatedDetailKind = "measurement" | "level" | "laterality" | "severity";

/** One dictated clinical value that must survive into the applied findings. */
export type DictatedDetail = {
  kind: DictatedDetailKind;
  /** Canonical form to check against ("9.2 mm", "L4-L5", "left", "mild"). */
  token: string;
  /** As dictated, for the radiologist-facing refusal message ("9.2 mm"). */
  raw: string;
};

export type DictatedFidelity = {
  ok: boolean;
  dropped: DictatedDetail[];
};

/** Numbers WITH a clinical unit — the measurement form radiologists dictate. */
const MEASUREMENT_RE =
  /\b(\d+(?:\.\d+)?)\s*(mm|millimeters?|millimetres?|cm|centimeters?|centimetres?|ml|cc|mmhg|%|degrees)\b/gi;
/** Bare decimals are treated as measurements too ("diameter is 9.2"). */
const BARE_DECIMAL_RE = /(?<![\d.])(\d+\.\d+)(?![\d.])/g;

/** Unit synonym classes — "9.2 millimeters" satisfies a dictated "9.2 mm". */
const UNIT_CLASS: Record<string, RegExp> = {
  mm: /\b(?:mm|millimeters?|millimetres?)\b/i,
  cm: /\b(?:cm|centimeters?|centimetres?)\b/i,
  ml: /\bml\b/i,
  cc: /\bcc\b/i,
  mmhg: /\bmm\s*hg\b|\bmmhg\b/i,
  "%": /%/,
  degrees: /\bdegrees?\b/i,
};

/** Tile-vocabulary equivalence classes (mirrors transcriptNormalize mapping). */
const SEVERITY_CLASSES: Array<{ dictated: RegExp; canon: "mild" | "moderate" | "severe" }> = [
  { dictated: /\b(?:mild|minimal|mildly)\b/i, canon: "mild" },
  { dictated: /\b(?:moderate|moderately)\b/i, canon: "moderate" },
  { dictated: /\b(?:severe|marked|severely|markedly)\b/i, canon: "severe" },
];
const SEVERITY_CORPUS: Record<string, RegExp> = {
  mild: /\b(?:mild|minimal|mildly)\b/i,
  moderate: /\b(?:moderate|moderately)\b/i,
  severe: /\b(?:severe|marked|severely|markedly)\b/i,
};
const LATERALITY_CLASSES: Array<{ dictated: RegExp; canon: "left" | "right" | "bilateral" }> = [
  { dictated: /\bleft(?:\s*sided)?\b/i, canon: "left" },
  { dictated: /\bright(?:\s*sided)?\b/i, canon: "right" },
  { dictated: /\b(?:bilateral|bilaterally|both)\b/i, canon: "bilateral" },
];
const LATERALITY_CORPUS: Record<string, RegExp> = {
  left: /\bleft(?:\s*sided)?\b/i,
  right: /\bright(?:\s*sided)?\b/i,
  bilateral: /\b(?:bilateral|bilaterally|both)\b/i,
};

function canonicalUnit(word: string): string {
  const w = word.toLowerCase();
  if (/^millimet/.test(w)) return "mm";
  if (/^centimet/.test(w)) return "cm";
  return w;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "9.2" present — but "19.2" or "9.25" must never satisfy a dictated "9.2". */
function numberPresent(corpus: string, num: string): boolean {
  return new RegExp(`(^|[^\\d.])${escapeRegExp(num)}(?![\\d])`).test(corpus);
}

export function extractDictatedDetails(transcript: string): DictatedDetail[] {
  const details: DictatedDetail[] = [];
  const seen = new Set<string>();
  const push = (kind: DictatedDetailKind, token: string, raw: string): void => {
    const key = `${kind}:${token}`;
    if (!seen.has(key)) {
      seen.add(key);
      details.push({ kind, token, raw });
    }
  };

  const measuredNumbers = new Set<string>();
  for (const m of transcript.matchAll(MEASUREMENT_RE)) {
    const unit = canonicalUnit(m[2]);
    push("measurement", `${m[1]} ${unit}`, `${m[1]} ${m[2]}`);
    measuredNumbers.add(m[1]);
  }
  for (const m of transcript.matchAll(BARE_DECIMAL_RE)) {
    if (!measuredNumbers.has(m[1])) push("measurement", m[1], m[1]);
  }

  // Levels canonicalize the same way the normalizer does: "L4-5" and "L4-L5"
  // are the same segment — a formatting variation, never a clinical error.
  for (const lv of extractLevels(transcript)) push("level", lv, lv);

  for (const cls of LATERALITY_CLASSES) {
    if (cls.dictated.test(transcript)) push("laterality", cls.canon, cls.canon);
  }
  for (const cls of SEVERITY_CLASSES) {
    if (cls.dictated.test(transcript)) push("severity", cls.canon, cls.canon);
  }
  return details;
}

/**
 * Does the plan preserve everything the transcript dictated? Checks the
 * findingsText of the observations the plan ADDS or UPDATES — the report
 * Findings section is where a dictated value must live; an impressionText
 * parking spot is a placement error, not preservation.
 */
export function verifyDictatedDetailPreserved(
  transcript: string,
  plan: VoiceChangePlan,
): DictatedFidelity {
  const details = extractDictatedDetails(transcript);
  if (!details.length) return { ok: true, dropped: [] };

  // A surfaced clarification question is the honest path for an unmappable
  // dictation — the validator turns it into the user-facing reason and the
  // dictation stays preserved. Only SILENT drops fail this gate.
  if (plan.clarificationRequired?.trim()) return { ok: true, dropped: [] };

  // Removal-only (or empty) plans retire findings; the dictated values are
  // meant to leave the report, so there is nothing to preserve here. An empty
  // plan is refused separately by the validator ("No observations in change
  // plan") — never applied silently.
  const applied = plan.observations.filter((o) => o.operation !== "remove");
  if (!applied.length) return { ok: true, dropped: [] };

  const corpus = applied.map((o) => o.findingsText).join("\n");
  const corpusLevels = new Set(extractLevels(corpus));
  const dropped: DictatedDetail[] = [];

  for (const detail of details) {
    let preserved = false;
    if (detail.kind === "measurement") {
      const [num, unit] = detail.token.split(" ");
      preserved = numberPresent(corpus, num) && (!unit || UNIT_CLASS[unit].test(corpus));
    } else if (detail.kind === "level") {
      preserved = corpusLevels.has(detail.token);
    } else if (detail.kind === "laterality") {
      preserved = LATERALITY_CORPUS[detail.token].test(corpus);
    } else {
      preserved = SEVERITY_CORPUS[detail.token].test(corpus);
    }
    if (!preserved) dropped.push(detail);
  }
  return { ok: dropped.length === 0, dropped };
}

/** Radiologist-facing refusal — echoes the dictated words, never invents. */
export function dictationFidelityError(dropped: DictatedDetail[]): string {
  const listed = dropped.slice(0, 2).map((d) => `${d.kind} "${d.raw}"`).join(" and ");
  const more = dropped.length > 2 ? ` (+${dropped.length - 2} more)` : "";
  return `Dictated ${listed}${more} not preserved in the plan — dictation preserved`;
}
