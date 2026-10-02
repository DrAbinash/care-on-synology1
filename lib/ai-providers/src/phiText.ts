/**
 * Patient identifiers in the free text CARE sends to an AI provider.
 *
 * This is the half of egress that actually leaks today. No AI path in CARE
 * sends a raw .dcm — every outbound call is a prompt plus rendered JPEGs — so
 * DICOM tag stripping would protect nothing, while the prompt routinely carries
 * a named patient. The clinical-note endpoint, for example, builds:
 *
 *   Patient: <first> <last>
 *   ID: <mrn>
 *   Gender: <g>
 *   Date of Birth: <yyyy-mm-dd>
 *
 * Detection is deliberately wider than scrubbing. Detection decides whether a
 * send is allowed, so it errs towards flagging. Scrubbing rewrites text that is
 * about to be sent, so it only touches patterns it can name with confidence —
 * over-eager replacement in a radiology prompt would eat dates in the history
 * ("pain since 12/03/19") and measurement series, turning a privacy fix into a
 * clinical regression.
 */

export type PhiCategory =
  | "name"
  | "patient_id"
  | "date_of_birth"
  | "phone"
  | "email"
  | "address"
  | "national_id";

type LabelRule = {
  category: PhiCategory;
  /** label + separator + the value to the end of the line */
  re: RegExp;
};

const LABEL_RULES: LabelRule[] = [
  {
    category: "name",
    re: /\b(?:patient(?:'?s)?\s+name|pt\.?\s*name|patient)\s*[:=\-]\s*([^\n,;]{2,80})/gi,
  },
  {
    category: "patient_id",
    re: /\b(?:mrn|uhid|ip\s*no|op\s*no|patient\s*id|pt\s*id|accession(?:\s*number)?|id)\s*[:=#\-.]\s*([A-Za-z0-9][A-Za-z0-9/\-_]{2,30})/gi,
  },
  {
    category: "date_of_birth",
    re: /\b(?:date\s*of\s*birth|birth\s*date|dob)\b\s*[:=\-]?\s*(\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4})/gi,
  },
  {
    category: "phone",
    re: /\b(?:phone|mobile|contact(?:\s*no(?:\.|umber)?)?)\s*[:=\-]\s*(\+?[\d][\d\s()-]{6,17})/gi,
  },
  {
    category: "email",
    re: /\b(?:e-?mail)\s*[:=\-]\s*([^\s,@]+@[^\s,@]+)/gi,
  },
  {
    category: "address",
    re: /\b(?:address|addr|residing at|ward)\s*[:=\-]\s*([^\n]{3,120})/gi,
  },
];

/**
 * A value we already replaced. Tested in code rather than with a lookahead in
 * each pattern: `\s*` in the separator backtracks to zero, which lets a
 * lookahead-anchored pattern capture the leading space instead and sail past
 * the guard — so "Patient: [REDACTED]" reads as a name on the next pass.
 */
const REDACTED = "[REDACTED]";

function isLiveValue(raw: string | undefined): boolean {
  const v = (raw ?? "").trim();
  return v.length > 0 && v !== REDACTED;
}

/**
 * Unlabelled shapes that are an identifier wherever they appear. Detected, and
 * scrubbed only where the pattern is specific enough not to collide with
 * clinical text.
 */
const BARE_RULES: Array<{ category: PhiCategory; re: RegExp; scrub: boolean }> = [
  { category: "email", re: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, scrub: true },
  { category: "national_id", re: /(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)/g, scrub: true },
  { category: "phone", re: /(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)/g, scrub: true },
];

/** Categories of identifier present in `text`. */
export function detectPhiCategories(text: string): PhiCategory[] {
  if (!text) return [];
  const found = new Set<PhiCategory>();

  for (const rule of LABEL_RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      if (isLiveValue(m[1])) {
        found.add(rule.category);
        break;
      }
      if (m.index === rule.re.lastIndex) rule.re.lastIndex += 1;
    }
  }

  for (const rule of BARE_RULES) {
    rule.re.lastIndex = 0;
    if (rule.re.test(text)) found.add(rule.category);
  }

  return [...found];
}

export type PhiScrubResult = {
  text: string;
  removedCategories: PhiCategory[];
  removedCount: number;
};

/**
 * Replace identifier *values* with a marker, keeping the label so the clinical
 * meaning survives: "Patient: [REDACTED]" still tells the model there is a
 * named patient without naming them.
 */
export function scrubPhiText(text: string): PhiScrubResult {
  if (!text) return { text, removedCategories: [], removedCount: 0 };

  let out = text;
  let removedCount = 0;
  const removed = new Set<PhiCategory>();

  for (const rule of LABEL_RULES) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (match, value: string) => {
      if (!isLiveValue(value)) return match;
      removedCount += 1;
      removed.add(rule.category);
      return match.slice(0, match.length - value.length) + REDACTED;
    });
  }

  for (const rule of BARE_RULES) {
    if (!rule.scrub) continue;
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, () => {
      removedCount += 1;
      removed.add(rule.category);
      return REDACTED;
    });
  }

  return { text: out, removedCategories: [...removed], removedCount };
}

/** True when anything identifying is present — the gate's condition. */
export function containsPhi(text: string): boolean {
  return detectPhiCategories(text).length > 0;
}
