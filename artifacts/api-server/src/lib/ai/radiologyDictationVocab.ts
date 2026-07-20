/**
 * radiologyDictationVocab.ts — medical-grade post-processing for voice dictation.
 *
 * Two responsibilities, both raising transcription accuracy for radiology/USG
 * dictation without ever changing clinical MEANING (deterministic, no AI):
 *
 *  1. RADIOLOGY_WHISPER_PROMPT — an `initial_prompt` seed handed to Whisper
 *     (faster-whisper / whisper.cpp / OpenAI-compatible). Whisper biases its
 *     decoding toward the vocabulary present in this prompt, so domain terms
 *     ("hyperintense", "Fazekas", "thecal sac", "biometry", "anteverted") stop
 *     coming back as their nearest common-English mis-hearing. This is the
 *     single biggest accuracy lever for a general-purpose STT model used on
 *     radiology speech, and it costs nothing at runtime.
 *
 *  2. normalizeDictation() — a conservative, high-confidence text fix-up applied
 *     to the transcript AFTER recognition, for EVERY provider (local Whisper,
 *     server Gemini). It only performs transforms that are unambiguous radiology
 *     dictation conventions:
 *       - canonical casing of acronyms (t1w → T1W, flair → FLAIR, efw → EFW)
 *       - spoken units → symbols (millimetres → mm, mls → mL)
 *       - spoken decimals ("three point five" already numeric "3 point 5" → 3.5)
 *       - spoken dimensions ("3 by 4" → "3 x 4")
 *       - a small set of frequent, unambiguous mis-hearings (hyper intense →
 *         hyperintense).
 *     It deliberately does NOT rephrase, add, remove, or reinterpret findings —
 *     that stays the radiologist's job. Anything ambiguous is left untouched.
 *
 * No AI, no network, no state. Safe to run on every transcript.
 */

// ── Whisper vocabulary-biasing prompt ─────────────────────────────────────────
//
// Kept broad across CT / MRI / X-ray / USG (incl. obstetric biometry for GE
// Voluson studies) and under Whisper's ~224-token prompt window. It reads as a
// plausible dictation so the model treats it as in-domain context, not a list.

export const RADIOLOGY_WHISPER_PROMPT =
  "Radiology dictation. Findings on CT, MRI, ultrasound, X-ray and Doppler. " +
  "Terms: hyperintense, hypointense, isointense, hyperechoic, hypoechoic, isoechoic, " +
  "T1W, T2W, FLAIR, DWI, ADC, SWI, GRE, STIR, MRA, MRV, contrast enhancement, " +
  "restricted diffusion, mass effect, midline shift, Fazekas, lacunar infarct, " +
  "periventricular white matter, thecal sac, neural foramina, ligamentum flavum, " +
  "cortex, parenchyma, hepatomegaly, splenomegaly, cholelithiasis, hydronephrosis, " +
  "corticomedullary, ejection fraction, IVC, common bile duct. " +
  "Obstetric ultrasound: single live intrauterine gestation, cephalic, biometry, " +
  "BPD, HC, AC, FL, EFW, amniotic fluid index, placenta, anterior, posterior, " +
  "gestational age, liquor, umbilical artery, PI, RI, systolic-diastolic ratio. " +
  "Impression: no acute abnormality. Measurements in mm and cm.";

// ── Acronym / symbol canonicalisation ─────────────────────────────────────────
//
// Map of lower-cased spoken/written form → canonical form. Applied on word
// boundaries, case-insensitively. Only unambiguous radiology acronyms and units
// belong here (never plain words that have a non-radiology meaning).

const CANONICAL_TERMS: Record<string, string> = {
  // Modalities
  mri: "MRI", ct: "CT", usg: "USG", pet: "PET", "x ray": "X-ray", xray: "X-ray",
  // MRI sequences / physics
  t1: "T1", t2: "T2", t1w: "T1W", t2w: "T2W", flair: "FLAIR", dwi: "DWI",
  adc: "ADC", swi: "SWI", gre: "GRE", stir: "STIR", mra: "MRA", mrv: "MRV",
  fdg: "FDG", hu: "HU",
  // Vessels / cardiac
  ica: "ICA", mca: "MCA", aca: "ACA", pca: "PCA", sma: "SMA", ima: "IMA",
  ivc: "IVC", svc: "SVC", cbd: "CBD", lvef: "LVEF", "ef": "EF",
  // Doppler indices
  ri: "RI", pi: "PI", psv: "PSV", edv: "EDV",
  // Obstetric biometry (GE Voluson etc.)
  bpd: "BPD", hc: "HC", ac: "AC", fl: "FL", efw: "EFW", crl: "CRL",
  nt: "NT", afi: "AFI", ga: "GA", lmp: "LMP", edd: "EDD", hl: "HL",
};

// Frequent, unambiguous mis-hearings (spaced compounds Whisper tends to split,
// or clear homophone errors). Conservative on purpose.
const PHRASE_FIXES: Array<[RegExp, string]> = [
  [/\bhyper[\s-]?intense\b/gi, "hyperintense"],
  [/\bhypo[\s-]?intense\b/gi, "hypointense"],
  [/\biso[\s-]?intense\b/gi, "isointense"],
  [/\bhyper[\s-]?echoic\b/gi, "hyperechoic"],
  [/\bhypo[\s-]?echoic\b/gi, "hypoechoic"],
  [/\biso[\s-]?echoic\b/gi, "isoechoic"],
  [/\bgrey[\s-]?white\b/gi, "grey-white"],
  [/\bgray[\s-]?white\b/gi, "grey-white"],
  [/\bwell[\s-]?defined\b/gi, "well-defined"],
  [/\bill[\s-]?defined\b/gi, "ill-defined"],
  [/\bspace[\s-]?occupying\b/gi, "space-occupying"],
];

// Spoken units → symbol. Applied on word boundaries.
const UNIT_FIXES: Array<[RegExp, string]> = [
  [/\b(?:milli[\s-]?met(?:er|re)s?)\b/gi, "mm"],
  [/\b(?:centi[\s-]?met(?:er|re)s?)\b/gi, "cm"],
  [/\bmillilit(?:er|re)s?\b/gi, "mL"],
  [/\bmls\b/gi, "mL"],
  [/\bcubic centimet(?:er|re)s?\b/gi, "cc"],
];

/**
 * Conservative, meaning-preserving normalisation of a raw dictation transcript.
 * Order matters: phrase/unit fixes first, then decimals/dimensions, then
 * per-word acronym casing, then whitespace tidy-up.
 */
export function normalizeDictation(raw: string): string {
  if (!raw) return "";
  let text = raw;

  for (const [re, repl] of PHRASE_FIXES) text = text.replace(re, repl);
  for (const [re, repl] of UNIT_FIXES) text = text.replace(re, repl);

  // Spoken decimal between digits: "3 point 5" → "3.5" (only digit-point-digit).
  text = text.replace(/\b(\d+)\s+point\s+(\d+)\b/gi, "$1.$2");

  // Spoken dimensions between numbers: "3 by 4" / "3 into 4" → "3 x 4".
  text = text.replace(/\b(\d+(?:\.\d+)?)\s+(?:by|into)\s+(\d+(?:\.\d+)?)\b/gi, "$1 x $2");

  // Per-word canonical casing. Split on whitespace, strip trailing punctuation
  // for the lookup, then re-attach it so "flair." → "FLAIR." is preserved.
  text = text.replace(/[A-Za-z][A-Za-z0-9]*/g, (word) => {
    const key = word.toLowerCase();
    return CANONICAL_TERMS[key] ?? word;
  });

  // Collapse the double spaces the substitutions can introduce.
  text = text.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:])/g, "$1");

  return text.trim();
}
