/**
 * Voice transcript normalization — corrections, negation and update hints.
 * Does not invent findings; surfaces ambiguity for zero-mutation paths.
 *
 * Task 15 (Part E) adds the conversational grammar the six-exam Smart
 * Dictation needs:
 *   - cervical / thoracic level extraction (C2-C3 … C7-T1, T4-T5 …)
 *   - concept-targeted removal: "remove ligamentum flavum hypertrophy"
 *   - severity / laterality / level updates: "make L4-L5 narrowing moderate
 *     on the left"
 */
import type { VoiceObservation } from "./schema";

export type NormalizedTranscript = {
  text: string;
  clarificationRequired?: string;
  isNegation?: boolean;
  /** Existing prefix-negation behaviour ("No hemorrhage.") — removes the last observation. */
  correctionLevel?: string;
  /** NEW — concept-targeted removal ("remove X"). Resolved by the composer. */
  removalTail?: string;
  /** NEW — update instruction ("make X {severity} (on the {side}) (at {level})"). */
  update?: {
    /** The concept-bearing tail, e.g. "L4-L5 narrowing" or "the L4-L5 foraminal stenosis". */
    tail: string;
    severity?: "mild" | "moderate" | "severe";
    laterality?: "left" | "right" | "bilateral";
    level?: string;
  };
};

const CORRECTION_TAIL_RE =
  /\b(?:correction|correct that to|actually|change (?:that )?to)\s+(.+)$/i;
const NEGATION_PREFIX_RE = /^(no |without |absence of |not |no evidence of )/i;
const LEVEL_RE = /\b([CLT])(\d{1,2})\s*[-–]\s*([CLT])?(\d{1,2})\b/gi;
const SINGLE_VERTEBRA_RE = /\b([CLT])(\d{1,2})\b(?!\s*[-–])/gi;

/** Map vertebral body shorthand (L4, C5, T9) to disc levels for multi-level dictation. */
function vertebralToDiscLevel(prefix: string, vertebra: number): string {
  const p = prefix.toUpperCase();
  if (p === "L") {
    return vertebra >= 5 ? "L5-S1" : `L${vertebra}-L${vertebra + 1}`;
  }
  if (p === "C") {
    return vertebra >= 7 ? "C7-T1" : `C${vertebra}-C${vertebra + 1}`;
  }
  // T12 pairs with L1.
  if (vertebra >= 12) return "T12-L1";
  return `T${vertebra}-T${vertebra + 1}`;
}

export function extractLevels(transcript: string): string[] {
  const levels: string[] = [];
  for (const m of transcript.matchAll(LEVEL_RE)) {
    const left = `${m[1].toUpperCase()}${m[2]}`;
    // "C7-T1" keeps its mixed prefix; "L4-5" repeats the family letter.
    const rightPrefix = (m[3] ?? m[1]).toUpperCase();
    const lv = `${left}-${rightPrefix}${m[4]}`;
    if (!levels.includes(lv)) levels.push(lv);
  }
  if (levels.length) return levels;

  for (const m of transcript.matchAll(SINGLE_VERTEBRA_RE)) {
    const lv = vertebralToDiscLevel(m[1].toUpperCase(), Number(m[2]));
    if (!levels.includes(lv)) levels.push(lv);
  }
  return levels;
}

/** Dictated severity words → canonical tile vocabulary. */
const SEVERITY_WORD_RE =
  /\b(mild|minimal|mildly|moderate|moderately|severe|marked)\b/i;
export function extractSeverity(transcript: string): "mild" | "moderate" | "severe" | null {
  const m = transcript.match(SEVERITY_WORD_RE);
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (/^(mild|minimal|mildly)$/.test(w)) return "mild";
  if (/^(moderate|moderately)$/.test(w)) return "moderate";
  return "severe";
}

/** Dictated side words → canonical tile vocabulary. */
const SIDE_WORD_RE =
  /\b(?:on the |left|right|bilateral|both|bilaterally|left-sided|right-sided)\b/ig;
export function extractLaterality(transcript: string): "left" | "right" | "bilateral" | null {
  const found: string[] = [];
  for (const m of transcript.matchAll(SIDE_WORD_RE)) {
    const w = m[0].toLowerCase().replace(/^on the /, "");
    if (/^left/.test(w) && !found.includes("left")) found.push("left");
    else if (/^right/.test(w) && !found.includes("right")) found.push("right");
    else if (/^(bilateral|both|bilaterally)/.test(w) && !found.includes("bilateral")) found.push("bilateral");
  }
  if (found.length === 1) return found[0] as "left" | "right" | "bilateral";
  return null;
}

/** Removal commands: "remove X", "delete X", "scratch X", "take off X", "drop X". */
const REMOVAL_RE =
  /^(?:please\s+)?(?:remove|delete|scratch|take\s+off|take\s+out|drop|undo)\s+(.+)$/i;
/** "remove the X" / "remove that X" — strip leading articles for tail matching. */
const REMOVAL_THE_RE = /^(?:the|that|my)\s+(.+)$/i;

/** Update/severity commands: "make X moderate", "change X to severe", "X is actually mild". */
const UPDATE_MAKE_RE =
  /^(?:please\s+)?(?:make|set|mark|change)\s+(.+?)\s+(?:to\s+|as\s+)?(mild|minimal|moderate|severe|marked)\b\s*(.*)$/i;
const UPDATE_ACTUALLY_RE =
  /^(.+?)\s+(?:is|are)\s+actually\s+(mild|minimal|moderate|severe|marked)\b\s*(.*)$/i;
const UPDATE_BECOMES_RE =
  /^(.+?)\s+(?:is\s+|becomes?\s+)?(mild|minimal|moderate|severe|marked)\s+on\s+the\s+(left|right)\b\s*(.*)$/i;
/** Side-only corrections: "make the infarct on the right", "put the bulge on the left". */
const UPDATE_SIDE_RE =
  /^(?:please\s+)?(?:make|set|mark|change|put|switch|move|flip)\s+(.+?)\s+(?:on|to|in)\s+the\s+(left|right|bilateral|both)\b\s*(?:side|sided)?\s*(.*)$/i;

const SEVERITY_TO_CANON: Record<string, "mild" | "moderate" | "severe"> = {
  mild: "mild", minimal: "mild",
  moderate: "moderate",
  severe: "severe", marked: "severe",
};

export function normalizeComposerTranscript(
  transcript: string,
  priorObservations?: VoiceObservation[],
): NormalizedTranscript {
  const trimmed = transcript.trim().replace(/\s+/g, " ");
  if (!trimmed) return { text: trimmed };

  // ── Concept-targeted removal ("remove ligamentum flavum hypertrophy") ─────
  const removal = trimmed.match(REMOVAL_RE);
  if (removal) {
    const rawTail = removal[1].trim();
    const tail = rawTail.replace(/^(the|that|my)\s+/i, "").replace(/[.?!]+$/, "");
    const levelInTail = extractLevels(tail);
    if (levelInTail.length > 1) {
      return { text: trimmed, clarificationRequired: "Removal mentions multiple levels — specify one level" };
    }
    return { text: trimmed, removalTail: tail };
  }

  // ── Severity / laterality updates ("make L4-L5 narrowing moderate on the left") ──
  // Severity-bearing patterns win over the side-only pattern: "make X moderate
  // on the left" is a severity+side update, never a side-only one.
  const update =
    trimmed.match(UPDATE_MAKE_RE)
    ?? trimmed.match(UPDATE_ACTUALLY_RE)
    ?? trimmed.match(UPDATE_BECOMES_RE);
  const sideOnly = update ? null : trimmed.match(UPDATE_SIDE_RE);
  if (update || sideOnly) {
    const tailRaw = (update?.[1] ?? sideOnly![1]).trim();
    const severityWord = update ? update[2].toLowerCase() : "";
    const rest = (update?.[3] ?? sideOnly![3]) ?? "";
    const severity = SEVERITY_TO_CANON[severityWord] ?? null;
    // The side and level may live in the tail or in the trailing fragment.
    const sideSource = `${tailRaw} ${rest} ${sideOnly?.[2] ?? ""}`;
    const laterality = extractLaterality(sideSource);
    const levels = extractLevels(sideSource);
    if (levels.length > 1) {
      return { text: trimmed, clarificationRequired: "Correction mentions multiple levels — specify one level" };
    }
    // Disambiguation is deferred to the composer (it sees prior observations).
    return {
      text: trimmed,
      update: {
        tail: tailRaw.replace(/^(the|that|my)\s+/i, "").replace(/[.?!]+$/, ""),
        severity: severity ?? undefined,
        laterality: laterality ?? undefined,
        level: levels[0],
      },
    };
  }

  if (
    NEGATION_PREFIX_RE.test(trimmed) &&
    (/^no\s+(hemorrhage|infarct|mass|lesion|stenosis|bulge|herniation)/i.test(trimmed) ||
      (trimmed.length < 80 && !/^no\s+significant/i.test(trimmed)))
  ) {
    return { text: trimmed, isNegation: true };
  }

  const correctionMatch = trimmed.match(CORRECTION_TAIL_RE);
  if (correctionMatch) {
    const correctedTail = correctionMatch[1].trim();
    const levels = extractLevels(correctedTail);
    if (levels.length > 1) {
      return {
        text: trimmed,
        clarificationRequired: "Correction mentions multiple levels — specify one level",
      };
    }
    if (priorObservations?.length && levels.length === 1) {
      const ambiguous = priorObservations.filter(
        (o) => o.level && o.level !== levels[0] && o.concept.includes("disc"),
      );
      if (ambiguous.length > 1) {
        return {
          text: trimmed,
          clarificationRequired: `Which level — ${ambiguous.map((o) => o.level).join(" or ")}?`,
        };
      }
    }
    return { text: correctedTail, correctionLevel: levels[0] };
  }

  const lateralityFlip = trimmed.match(/\bno[,]?\s+(right|left)\b/i);
  if (lateralityFlip && priorObservations?.length) {
    const side = lateralityFlip[1].toLowerCase();
    const opposite = side === "right" ? "left" : "right";
    const matching = priorObservations.filter(
      (o) => o.laterality?.toLowerCase() === opposite || new RegExp(opposite, "i").test(o.findingsText),
    );
    if (matching.length > 1) {
      return {
        text: trimmed,
        clarificationRequired: "Which finding should change laterality?",
      };
    }
  }

  return { text: trimmed };
}
