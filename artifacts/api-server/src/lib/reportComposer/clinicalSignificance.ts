/**
 * Deterministic clinically-significant token diff.
 * NEVER ask the LLM whether its edit is clinically important.
 */
export type ClinicalSignificanceResult = {
  significant: boolean;
  reasons: string[];
};

const LATERALITY = /\b(right|left|bilateral|rt\.?|lt\.?|r\/l|l\/r)\b/gi;
const SPINE_LEVEL =
  /\b(?:C|c)([1-7])(?:\s*[-–—\/]\s*(?:C|c)?([1-7]))?\b|\b(?:D|T|d|t)([1-9]|1[0-2])(?:\s*[-–—\/]\s*(?:D|T|d|t)?([1-9]|1[0-2]))?\b|\b(?:L|l)([1-5])(?:\s*[-–—\/]\s*(?:L|l)?([1-5]|S1|s1))?\b|\b(?:S|s)1\b/g;
const MEASUREMENT = /\b\d+(?:\.\d+)?\s*(?:mm|cm|%|ml|cc)\b/gi;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;
const GRADE =
  /\b(?:fazekas|modic|bi-?rads|ti-?rads|grade|type)\s*[:=]?\s*[0-9ivx]+|\bfazekas\s*[0-4]\b|\bmodic\s*(?:type\s*)?[123]\b/gi;
const TEMPORAL = /\b(?:acute|chronic|subacute)\b/gi;
const POLARITY =
  /\b(?:present|absent|positive|negative|with|without|no\s+significant|no\s+evidence)\b/gi;
const CONTRAST = /\b(?:contrast|plain|non[-\s]?contrast|post[-\s]?contrast)\b/gi;
const STENOSIS = /\b(?:stenosis|no\s+stenosis|compression|no\s+compression)\b/gi;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function collect(re: RegExp, text: string): string[] {
  const out: string[] = [];
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const r = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    out.push(normalize(m[0]));
  }
  return out.sort();
}

function setDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const as = new Set(a);
  const bs = new Set(b);
  return {
    added: [...bs].filter((x) => !as.has(x)),
    removed: [...as].filter((x) => !bs.has(x)),
  };
}

function pushDiff(
  reasons: string[],
  label: string,
  a: string[],
  b: string[],
): void {
  const { added, removed } = setDiff(a, b);
  for (const x of removed) reasons.push(`${label} removed: ${x}`);
  for (const x of added) reasons.push(`${label} added: ${x}`);
}

/**
 * Compare original vs proposed text for clinically sensitive token changes.
 */
export function detectClinicalSignificance(
  originalText: string,
  proposedText: string,
): ClinicalSignificanceResult {
  const o = originalText ?? "";
  const p = proposedText ?? "";
  if (normalize(o) === normalize(p)) return { significant: false, reasons: [] };

  const reasons: string[] = [];
  pushDiff(reasons, "Laterality", collect(LATERALITY, o), collect(LATERALITY, p));
  pushDiff(reasons, "Spinal level", collect(SPINE_LEVEL, o), collect(SPINE_LEVEL, p));
  pushDiff(reasons, "Measurement", collect(MEASUREMENT, o), collect(MEASUREMENT, p));
  pushDiff(reasons, "Grade/score", collect(GRADE, o), collect(GRADE, p));
  pushDiff(reasons, "Acuity", collect(TEMPORAL, o), collect(TEMPORAL, p));
  pushDiff(reasons, "Polarity", collect(POLARITY, o), collect(POLARITY, p));
  pushDiff(reasons, "Contrast", collect(CONTRAST, o), collect(CONTRAST, p));
  pushDiff(reasons, "Stenosis/compression", collect(STENOSIS, o), collect(STENOSIS, p));

  // Bare numbers only when measurements didn't already capture them and counts differ meaningfully
  const numsO = collect(NUMBER, o).filter((n) => !collect(MEASUREMENT, o).some((m) => m.includes(n)));
  const numsP = collect(NUMBER, p).filter((n) => !collect(MEASUREMENT, p).some((m) => m.includes(n)));
  pushDiff(reasons, "Number", numsO, numsP);

  return { significant: reasons.length > 0, reasons };
}
