/**
 * Voice transcript normalization — corrections and negation hints.
 * Does not invent findings; surfaces ambiguity for zero-mutation path.
 */
import type { VoiceObservation } from "./schema";

export type NormalizedTranscript = {
  text: string;
  clarificationRequired?: string;
  isNegation?: boolean;
  correctionLevel?: string;
};

const CORRECTION_TAIL_RE =
  /\b(?:correction|correct that to|actually|change (?:that )?to)\s+(.+)$/i;
const NEGATION_PREFIX_RE = /^(no |without |absence of |not |no evidence of )/i;
const LEVEL_RE = /\bL(\d)\s*[-–]\s*L?(\d)\b/gi;
const SINGLE_VERTEBRA_RE = /\bL(\d)\b(?!\s*[-–])/gi;

/** Map vertebral body shorthand (L4, L5) to disc levels for multi-level dictation. */
function vertebralToDiscLevel(vertebra: number): string {
  if (vertebra >= 5) return "L5-S1";
  return `L${vertebra}-L${vertebra + 1}`;
}

export function extractLevels(transcript: string): string[] {
  const levels: string[] = [];
  for (const m of transcript.matchAll(LEVEL_RE)) {
    const lv = `L${m[1]}-L${m[2]}`;
    if (!levels.includes(lv)) levels.push(lv);
  }
  if (levels.length) return levels;

  for (const m of transcript.matchAll(SINGLE_VERTEBRA_RE)) {
    const lv = vertebralToDiscLevel(Number(m[1]));
    if (!levels.includes(lv)) levels.push(lv);
  }
  return levels;
}

export function normalizeComposerTranscript(
  transcript: string,
  priorObservations?: VoiceObservation[],
): NormalizedTranscript {
  const trimmed = transcript.trim();
  if (!trimmed) return { text: trimmed };

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
