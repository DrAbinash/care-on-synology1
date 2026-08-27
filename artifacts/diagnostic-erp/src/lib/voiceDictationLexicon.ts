/**
 * voiceDictationLexicon — radiology-aware spoken-text substitutions shared by
 * Care voice dictation (normalizeDictationText) and the field mic path.
 */
export function applyRadiologyVoiceLexicon(text: string): string {
  return text
    // Punctuation (spoken)
    .replace(/\bnew[- ]?line\b/gi, "\n")
    .replace(/\bnew[- ]?paragraph\b/gi, "\n\n")
    .replace(/\bfull[- ]?stop\b/gi, ".")
    .replace(/\bperiod\b/gi, ".")
    .replace(/\bcomma\b/gi, ",")
    .replace(/\bopen[- ]?bracket\b/gi, "(")
    .replace(/\bclose[- ]?bracket\b/gi, ")")
    .replace(/\bopen[- ]?parenthesis\b/gi, "(")
    .replace(/\bclose[- ]?parenthesis\b/gi, ")")
    .replace(/\bcolon\b/gi, ":")
    .replace(/\bsemicolon\b/gi, ";")
    .replace(/\bhyphen\b/gi, "-")
    .replace(/\bdash\b/gi, "—")
    // Spoken slash so "s slash o" keeps "/" (not glued "so")
    .replace(/\bslash\b/gi, "/")
    // MRI / modality sequences
    .replace(/\bt[- ]?1[- ]?w\b/gi, "T1W")
    .replace(/\bt[- ]?2[- ]?w\b/gi, "T2W")
    .replace(/\bt[- ]?1\b/gi, "T1")
    .replace(/\bt[- ]?2\b/gi, "T2")
    .replace(/\bflair\b/gi, "FLAIR")
    .replace(/\bdwi\b/gi, "DWI")
    .replace(/\badc\b/gi, "ADC")
    .replace(/\bswi\b/gi, "SWI")
    .replace(/\bgre\b/gi, "GRE")
    .replace(/\bstir\b/gi, "STIR")
    .replace(/\bmra\b/gi, "MRA")
    .replace(/\bmrv\b/gi, "MRV")
    .replace(/\bmri\b/gi, "MRI")
    .replace(/\bct\b/gi, "CT")
    .replace(/\bhrct\b/gi, "HRCT")
    .replace(/\busg\b/gi, "USG")
    .replace(/\bpet\b/gi, "PET")
    // Common anatomy / descriptors
    .replace(/\bfazekas\b/gi, "Fazekas")
    .replace(/\bhyper[- ]?echoic\b/gi, "hyperechoic")
    .replace(/\bhypo[- ]?echoic\b/gi, "hypoechoic")
    .replace(/\biso[- ]?echoic\b/gi, "isoechoic")
    .replace(/\bcentimeter(s)?\b/gi, "cm")
    .replace(/\bmillimeter(s)?\b/gi, "mm")
    .replace(/\bgrade (one|1)\b/gi, "Grade 1")
    .replace(/\bgrade (two|2)\b/gi, "Grade 2")
    .replace(/\bgrade (three|3)\b/gi, "Grade 3")
    .replace(/\bgrade (four|4)\b/gi, "Grade 4")
    // Spacing cleanup after substitutions
    .replace(/ +([.,;:/])/g, "$1")
    .replace(/([\/]) +/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}
