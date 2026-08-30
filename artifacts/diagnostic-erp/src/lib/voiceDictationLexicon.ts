/**
 * voiceDictationLexicon — radiology-aware spoken-text substitutions shared by
 * Care voice dictation (normalizeDictationText) and the field mic path.
 *
 * Implementation lives in voiceDictationNormalize.ts (levels, measurements,
 * context-aware punctuation, abbreviations, vocabulary). This module keeps
 * the historical export name for callers.
 */

import { normalizeRadiologyDictation } from "./voiceDictationNormalize";

export function applyRadiologyVoiceLexicon(text: string): string {
  return normalizeRadiologyDictation(text).normalizedTranscript;
}
