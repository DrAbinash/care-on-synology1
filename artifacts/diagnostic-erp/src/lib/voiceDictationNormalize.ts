/**
 * Deterministic radiology dictation normalization.
 *
 * Faithful transcription first — never invents anatomy, severity, laterality,
 * measurements, or negation. Idempotent: normalize(normalize(t)) === normalize(t).
 *
 * Replaces crude global lexicon swaps (e.g. blind "colon" → ":") with
 * context-aware punctuation commands and CARE-oriented spinal/measurement rules.
 */

export type DictationNormalizeResult = {
  rawTranscript: string;
  normalizedTranscript: string;
};

/** Format a spoken spinal pair. Preserves L/C/D/S/T as spoken — do NOT force
 *  CARE slot-key T→D conversion here (reporting may use either letter). */
function formatSpinalPair(a: string, d1: string, b: string, d2: string): string {
  return `${a.toUpperCase()}${d1}-${b.toUpperCase()}${d2}`;
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
  thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70",
  eighty: "80", ninety: "90",
};

const SPINE_LETTER = "LCDST";

function wordToDigit(w: string): string | null {
  const n = NUMBER_WORDS[w.toLowerCase()];
  return n ?? (/^\d{1,2}$/.test(w) ? w : null);
}

/** Spoken spinal levels → L4-L5 / C5-C6 / D11-D12 when unambiguous. */
export function normalizeSpokenSpinalLevels(text: string): string {
  let out = text;

  // L four L five / C five C six / D eleven D twelve / T eleven T twelve
  out = out.replace(
    new RegExp(
      `\\b([${SPINE_LETTER}])\\s*(?:dash|hyphen|to)?\\s*(${Object.keys(NUMBER_WORDS).join("|")}|\\d{1,2})\\s+([${SPINE_LETTER}])\\s*(${Object.keys(NUMBER_WORDS).join("|")}|\\d{1,2})\\b`,
      "gi",
    ),
    (_m, a: string, n1: string, b: string, n2: string) => {
      const d1 = wordToDigit(n1);
      const d2 = wordToDigit(n2);
      if (!d1 || !d2) return _m;
      return formatSpinalPair(a, d1, b, d2);
    },
  );

  // L four five / C six seven — only when second token is a digit/word and no second letter
  out = out.replace(
    new RegExp(
      `\\b([${SPINE_LETTER}])\\s+(${Object.keys(NUMBER_WORDS).join("|")}|\\d{1,2})\\s+(${Object.keys(NUMBER_WORDS).join("|")}|\\d{1,2})\\b`,
      "gi",
    ),
    (m, letter: string, n1: string, n2: string) => {
      const d1 = wordToDigit(n1);
      const d2 = wordToDigit(n2);
      if (!d1 || !d2) return m;
      // Avoid turning "L 4 5 years" — require adjacent small levels
      const a = Number(d1);
      const b = Number(d2);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 2) return m;
      return formatSpinalPair(letter, d1, letter, d2);
    },
  );

  return out;
}

/** six point six millimeters → 6.6 mm; 26.9 by 24.0 millimeters → 26.9 × 24.0 mm */
export function normalizeSpokenMeasurements(text: string): string {
  let out = text;

  const tensOnes = (tens: string, ones: string | undefined): string | null => {
    const t = wordToDigit(tens);
    if (!t) return null;
    if (!ones) return t;
    const o = wordToDigit(ones);
    if (!o) return null;
    // twenty + six → 26 (tens words are 20/30/…); ten+ones is invalid
    const tn = Number(t);
    const on = Number(o);
    if (tn >= 20 && tn % 10 === 0 && on < 10) return String(tn + on);
    return null;
  };

  const WORD = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|one|two|three|four|five|six|seven|eight|nine|zero";
  const UNIT = "millimeters?|centimeters?|mm|cm|milliliters?|ml";

  // Compound: twenty six point nine [unit]
  out = out.replace(
    new RegExp(
      `\\b(${WORD})\\s+(${WORD})\\s+point\\s+(zero|one|two|three|four|five|six|seven|eight|nine|\\d)\\s*(${UNIT})?\\b`,
      "gi",
    ),
    (m, tens: string, ones: string, frac: string, unit?: string) => {
      const whole = tensOnes(tens, ones);
      if (!whole) return m;
      const f = wordToDigit(frac) ?? frac;
      const u = unit
        ? /centi/i.test(unit) || /^cm$/i.test(unit)
          ? " cm"
          : /milli?lit/i.test(unit) || /^ml$/i.test(unit)
            ? " mL"
            : " mm"
        : "";
      return `${whole}.${f}${u}`;
    },
  );

  // Simple: six point six [unit]
  out = out.replace(
    new RegExp(
      `\\b(${WORD}|\\d+)\\s+point\\s+(zero|one|two|three|four|five|six|seven|eight|nine|\\d)\\s*(${UNIT})?\\b`,
      "gi",
    ),
    (_m, whole: string, frac: string, unit?: string) => {
      const w = wordToDigit(whole) ?? whole;
      const f = wordToDigit(frac) ?? frac;
      const u = unit
        ? /centi/i.test(unit) || /^cm$/i.test(unit)
          ? "cm"
          : /milli?lit/i.test(unit) || /^ml$/i.test(unit)
            ? "mL"
            : "mm"
        : "";
      return u ? `${w}.${f} ${u}` : `${w}.${f}`;
    },
  );

  // Compound whole numbers with unit: twenty six millimeters
  out = out.replace(
    new RegExp(`\\b(${WORD})\\s+(${WORD})\\s+(${UNIT})\\b`, "gi"),
    (m, tens: string, ones: string, unit: string) => {
      const whole = tensOnes(tens, ones);
      if (!whole) return m;
      const u = /centi/i.test(unit) || /^cm$/i.test(unit)
        ? "cm"
        : /milli?lit/i.test(unit) || /^ml$/i.test(unit)
          ? "mL"
          : "mm";
      return `${whole} ${u}`;
    },
  );

  // Numeric × dimensions: 26.9 by 24.0 millimeters
  out = out.replace(
    /\b(\d+(?:\.\d+)?)\s*(?:by|×|x)\s*(\d+(?:\.\d+)?)\s*(millimeters?|centimeters?|mm|cm)\b/gi,
    (_m, a: string, b: string, unit: string) => {
      const u = /centi/i.test(unit) || /^cm$/i.test(unit) ? "cm" : "mm";
      return `${a} × ${b} ${u}`;
    },
  );

  // eight millimeters / 8 millimeters
  out = out.replace(
    new RegExp(`\\b(\\d+(?:\\.\\d+)?|(?:${WORD}))\\s+(millimeters?|centimeters?|milliliters?)\\b`, "gi"),
    (_m, n: string, unit: string) => {
      const num = wordToDigit(n) ?? n;
      const u = /centi/i.test(unit) ? "cm" : /lit/i.test(unit) ? "mL" : "mm";
      return `${num} ${u}`;
    },
  );

  out = out.replace(/\bmillimeters?\b/gi, "mm");
  out = out.replace(/\bcentimeters?\b/gi, "cm");
  return out;
}

/** Context-aware punctuation commands — never rewrite anatomy "colon". */
export function applySpokenPunctuationCommands(text: string): string {
  // Protect anatomical colon mentions before command pass.
  const protectedColon = "\uE000COLON\uE001";
  let out = text.replace(/\b(the|ascending|descending|sigmoid|transverse)\s+colon\b/gi, (_m, adj: string) => `${adj} ${protectedColon}`);
  out = out.replace(/\bcolon\s+(appears|is|shows|wall|cancer|ca|polyp|thickened|distended)\b/gi, (_m, rest: string) => `${protectedColon} ${rest}`);

  out = out
    .replace(/\bnew[- ]?paragraph\b/gi, "\n\n")
    .replace(/\bnew[- ]?line\b/gi, "\n")
    .replace(/\s*\bfull[- ]?stop\b/gi, ".")
    // "period" only as a trailing punctuation command — not "latent period".
    .replace(/(^|[\s])period(?=\s|$)/gi, "$1.")
    .replace(/\s*\bcomma\b/gi, ",")
    .replace(/\s*\bsemicolon\b/gi, ";")
    .replace(/\bopen[- ]?bracket\b/gi, "(")
    .replace(/\bclose[- ]?bracket\b/gi, ")")
    .replace(/\bopen[- ]?parenthesis\b/gi, "(")
    .replace(/\bclose[- ]?parenthesis\b/gi, ")")
    .replace(/\bhyphen\b/gi, "-")
    .replace(/\bdash\b/gi, "—")
    .replace(/\bslash\b/gi, "/");

  // Bare "colon" as command only when it looks like a punctuation command
  // (start / after whitespace and not followed by a verb/anatomy cue already protected).
  out = out.replace(/(^|[\s])colon(?=\s|$|[.,;])/gi, "$1:");

  out = out.replace(new RegExp(protectedColon, "g"), "colon");
  // Collapse spaces before punctuation introduced by commands.
  out = out.replace(/ +([.,;:])/g, "$1");
  return out;
}

export function normalizeRadiologyAbbreviations(text: string): string {
  return text
    .replace(/\bd\s*w\s*i\b/gi, "DWI")
    .replace(/\ba\s*d\s*c\b/gi, "ADC")
    .replace(/\bs\s*w\s*i\b/gi, "SWI")
    .replace(/\bm\s*r\s*c\s*p\b/gi, "MRCP")
    .replace(/\bc\s*t\b/gi, "CT")
    .replace(/\bm\s*r\s*i\b/gi, "MRI")
    .replace(/\bt[- ]?1[- ]?w\b/gi, "T1W")
    .replace(/\bt[- ]?2[- ]?w\b/gi, "T2W")
    // Spoken MRI weighting: "T one" / "T two" (after spinal pairs already resolved)
    .replace(/\bt\s+one\b/gi, "T1")
    .replace(/\bt\s+two\b/gi, "T2")
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
    .replace(/\bhrct\b/gi, "HRCT")
    .replace(/\busg\b/gi, "USG")
    // Whole-word CT only (not "intact", "direct")
    .replace(/(^|[^a-z])ct(?=[^a-z]|$)/gi, "$1CT");
}

/** Known CARE / radiology spellings — conservative exact-ish fixes only. */
export function normalizeRadiologyVocabulary(text: string): string {
  const pairs: Array<[RegExp, string]> = [
    [/\bfazekas\b/gi, "Fazekas"],
    [/\bmodic\b/gi, "Modic"],
    [/\banterolisthesis\b/gi, "anterolisthesis"],
    [/\bretrolisthesis\b/gi, "retrolisthesis"],
    [/\bspondylolisthesis\b/gi, "spondylolisthesis"],
    [/\bspondylosis\b/gi, "spondylosis"],
    [/\bspondylodiscitis\b/gi, "spondylodiscitis"],
    [/\bforaminal\b/gi, "foraminal"],
    [/\bforamina narrowing\b/gi, "foraminal narrowing"],
    [/\bligamentum flavum\b/gi, "ligamentum flavum"],
    [/\bgliosis\b/gi, "gliosis"],
    [/\bgliotic\b/gi, "gliotic"],
    [/\bencephalomalacia\b/gi, "encephalomalacia"],
    [/\bventriculomegaly\b/gi, "ventriculomegaly"],
    [/\bhydronephrosis\b/gi, "hydronephrosis"],
    [/\bnephrolithiasis\b/gi, "nephrolithiasis"],
    [/\bcholedocholithiasis\b/gi, "choledocholithiasis"],
    [/\bcholelithiasis\b/gi, "cholelithiasis"],
    [/\blymphadenopathy\b/gi, "lymphadenopathy"],
    [/\bintussusception\b/gi, "intussusception"],
    [/\bpyelonephritis\b/gi, "pyelonephritis"],
    [/\bhyper[- ]?echoic\b/gi, "hyperechoic"],
    [/\bhypo[- ]?echoic\b/gi, "hypoechoic"],
    [/\biso[- ]?echoic\b/gi, "isoechoic"],
    [/\bgrade (one|1)\b/gi, "Grade 1"],
    [/\bgrade (two|2)\b/gi, "Grade 2"],
    [/\bgrade (three|3)\b/gi, "Grade 3"],
    [/\bgrade (four|4)\b/gi, "Grade 4"],
  ];
  let out = text;
  for (const [re, rep] of pairs) out = out.replace(re, rep);
  return out;
}

/** Negation phrases that must survive byte-stable through normalization. */
export const NEGATION_GUARD_PHRASES = [
  "no diffusion restriction is seen",
  "no significant spinal canal stenosis",
  "no focal lesion is identified",
  "no hydronephrosis",
  "without cord compression",
  "no evidence of choledocholithiasis",
  "no evidence of",
  "negative for",
  "absent",
] as const;

function tidyWhitespace(text: string): string {
  return text
    .replace(/ +([.,;:/])/g, "$1")
    .replace(/([\/]) +/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Full conservative dictation normalize. Does not capitalize or add periods —
 * callers may do that via autoPunctuation.
 */
export function normalizeRadiologyDictation(raw: string): DictationNormalizeResult {
  const rawTranscript = raw ?? "";
  let t = rawTranscript;
  // Levels/measurements before punctuation so "dash"/"point" remain tokens for those passes.
  t = normalizeSpokenSpinalLevels(t);
  t = normalizeSpokenMeasurements(t);
  t = applySpokenPunctuationCommands(t);
  t = normalizeRadiologyAbbreviations(t);
  t = normalizeRadiologyVocabulary(t);
  t = tidyWhitespace(t);
  return { rawTranscript, normalizedTranscript: t };
}

/** Idempotent check helper for tests. */
export function normalizeRadiologyDictationIdempotent(raw: string): string {
  const once = normalizeRadiologyDictation(raw).normalizedTranscript;
  return normalizeRadiologyDictation(once).normalizedTranscript;
}
