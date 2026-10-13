// text/clinicalTerms.ts — the curated clinical vocabulary and the clause-level
// negation and uncertainty reading that every findings-vs-impression
// contradiction rule shares.
//
// Why this exists: those rules were doing plain substring searches, so
//   • "No acute intracranial haemorrhage" counted as a haemorrhage,
//   • "Normal MRI of the cervical spine" was invisible to a rule that only knew
//     the literal "normal study", and
//   • "haemorrhage" — what this clinic writes — never matched a rule that only
//     knew "hemorrhage", while its own PATHOLOGY_WORDS carried both spellings.
// That is the whole Q103/Q113/Q114 problem class. The reading happens once, here,
// and both the canonical text tier (./evaluate.ts) and the live workspace
// validator (artifacts/diagnostic-erp/src/lib/reportValidator.ts) import it, so
// the two cannot drift apart — reportQualityShadow.test.ts asserts they agree
// message for message.

/** A vocabulary entry: `label` is what a warning names, `pattern` how it matches. */
export type ClinicalTerm = { readonly label: string; readonly pattern: string };

/**
 * Abnormalities a radiology report can assert, in both British and American
 * spelling, across the systems this clinic reports. Excluded on purpose:
 * wording that describes normal anatomy ("alignment", "densities"), benign-only
 * entities ("cyst", kept for the mammography rule's own list) and anything
 * contrast-related (Q112 owns contrast).
 */
export const ABNORMAL_TERMS: readonly ClinicalTerm[] = [
  // brain and cerebrovascular
  { label: "infarct", pattern: String.raw`\binfarct\w*` },
  { label: "haemorrhage", pattern: String.raw`\b(?:ha?emorrhage|ha?ematom\w*|ha?atemesis|bleed|bleeding)\b` },
  { label: "extra-axial collection", pattern: String.raw`\bsub(?:dural|arachnoid)\b|\bextradural\b|\bepidural\b` },
  { label: "midline shift", pattern: String.raw`\bmidline shift\b` },
  { label: "mass effect", pattern: String.raw`\bmass effect\b` },
  { label: "hydrocephalus", pattern: String.raw`\b(?:hydrocephalus|ventriculomegaly|transependymal)\b` },
  { label: "ischaemia", pattern: String.raw`\b(?:is|hae)mi(?:c|a)\b|\b(?:is|hae)chaemi\w*` },
  { label: "demyelination", pattern: String.raw`\bdemyelin\w*|\bplaque\b|\bdisc demyelination\b` },
  { label: "oedema", pattern: String.raw`\b(?:oe|e)dema\b` },
  { label: "atrophy", pattern: String.raw`\batrophi\w*|\batroph\w*` },
  { label: "gliosis", pattern: String.raw`\bgliosis\b|\bgliotic\b|\bencephalomalacia\b` },

  // spine
  { label: "herniation", pattern: String.raw`\bherniat\w*|\bdisc extrusion\b|\bsequestrat\w*` },
  { label: "protrusion", pattern: String.raw`\bprotrusi\w*` },
  { label: "disc bulge", pattern: String.raw`\bbulge\w*|\bbulgi\w*` },
  { label: "stenosis", pattern: String.raw`\bstenos\w*|\bnarrowing\b` },
  { label: "cord compression", pattern: String.raw`\bcompress(?:ion|ing|ed)\b|\bimpingement\b|\bthecal sac indentation\b` },
  { label: "myelopathy", pattern: String.raw`\b(?:myelopath|myelomalaci)\w*|\bcord oedema\b|\bcord edema\b` },
  { label: "nerve root involvement", pattern: String.raw`\bradiculopath\w*|\b(?:nerve )?root (?:contact|compression|impinge\w*)\b` },
  { label: "spondylolisthesis", pattern: String.raw`\bspondylolisthe\w*|\bspondyloptosis\b|\bisthmic\b` },
  { label: "infection", pattern: String.raw`\bspondylodiscit\w*|\bdiscitis\b|\bosteomyelit\w*|\bdisc infection\b|\btubercul\w*|\babscess\b` },
  { label: "fracture", pattern: String.raw`\bfractur\w*|\bsubluxation\b|\bdislocation\b|\bcompression fracture\b` },
  { label: "destructive lesion", pattern: String.raw`\bdestructive (?:lesion|change)\b|\blytic\b|\bmetastatic deposit\b` },

  // body, abdomen and soft tissue
  { label: "lesion", pattern: String.raw`\blesion\w*` },
  { label: "mass", pattern: String.raw`\bmass(?:es)?\b(?![a-z])` },
  { label: "tumour", pattern: String.raw`\b(?:tumor|tumour|neoplasm|nodule|nodular|deposit)\w*` },
  { label: "metastasis", pattern: String.raw`\bmetasta\w*|\bcarcinomatosis\b|\bsecondaries\b` },
  { label: "malignancy", pattern: String.raw`\bmalignan\w*|\b(?:carcinoma|lymphoma|sarcoma|myeloma|melanoma)\b` },
  { label: "collection", pattern: String.raw`\bcollection\w*|\bempyema\b` },
  { label: "fluid", pattern: String.raw`\bfree fluid\b|\bascites\b|\beffusion\w*` },
  { label: "stone", pattern: String.raw`\bstone\w*|\bgallstone\w*|\brenal stone\b|\bcalculus\b|\bcalculi\b|\blithiasis\b|\blith\b|\bappendicolith\w*` },
  { label: "obstruction", pattern: String.raw`\bobstruct\w*|\bocclus\w*|\bvolvulus\b|\bilus\b|\bnon-?compressibl\w*|\bnot compressible\b` },
  { label: "dilatation", pattern: String.raw`\bdilat\w*|\bdistension\b|\bhydroureter\b` },
  { label: "wall thickening", pattern: String.raw`\bthick(?:en|ening|ness)\b` },
  { label: "fat stranding", pattern: String.raw`\bstranding\b|\b(?:hyperaemia|hyperemia)\b|\bfat proliferation\b` },
  { label: "inflammation", pattern: String.raw`\b(?:appendicitis|cholecystitis|cholangitis|pancreatitis|diverticulitis|enteritis|colitis|gastritis|peritonitis|pyelonephritis|salpingitis|orchitis|encephalitis|meningitis|cellulitis|nephritis)\b` },
  { label: "perforation", pattern: String.raw`\bperforat\w*|\bpneumoperitoneum\b|\bfree (?:gas|air)\b|\bpneumothorax\b|\bpneumomediastinum\b` },
  { label: "chronic parenchymal change", pattern: String.raw`\bfibros\w*|\bcirrhos\w*|\bsteatos\w*|\bcalcific atherosclerosis\b` },
  { label: "organomegaly", pattern: String.raw`\b(?:hepato|spleno|cardio|reno|thyroid|prosto)megaly\b|\benlarged (?:liver|spleen|heart|kidney|prostate|uterus)\b` },
  { label: "lymphadenopathy", pattern: String.raw`\blymphadenopath\w*|\benlarged lymph nodes\b|\blap\b` },
  { label: "sclerosis", pattern: String.raw`\bscleros\w*` },
  { label: "calcification", pattern: String.raw`\b(?:micro|macro)?calcifi\w*` },
  { label: "consolidation", pattern: String.raw`\bconsolidat\w*|\binfiltrat\w*|\batelectas\w*|\bground[- ]glass\b|\bemphysemat\w*` },

  // breast
  { label: "suspicious breast lesion", pattern: String.raw`\bspiculat\w*|\barchitectural distortion\b|\bnipple retraction\b|\bdominant mass\b|\bgrouped microcalcification\w*` },

  // vascular and Doppler
  { label: "thrombus", pattern: String.raw`\b(?:thrombus|thrombi|thrombos\w*|thrombotic)\b|\bdvt\b` },
  { label: "embolism", pattern: String.raw`\b(?:embolus|emboli|embolism)\w*` },
  { label: "aneurysm", pattern: String.raw`\b(?:aneurysm|pseudoaneurysm|ectasia|dissection)\w*` },
  { label: "venous reflux", pattern: String.raw`\breflux\b|\bincompeten\w*|\bvaricositi\w*|\bvarices\b` },
] as const;

/**
 * Mammography wording that makes a finding *suspicious*. Narrower than
 * {@link ABNORMAL_TERMS} by design: a BI-RADS 2 sitting beside a benign-looking
 * entity is not a contradiction, so only worrying wording arms the downgrade
 * check.
 */
export const SUSPICIOUS_TERMS: readonly ClinicalTerm[] = [
  { label: "spiculation", pattern: String.raw`\bspiculat\w*` },
  { label: "suspicion", pattern: String.raw`\bsuspici\w*` },
  { label: "microcalcification", pattern: String.raw`\b(?:micro|grouped|clustered|pleomorphic)[ -]?calcif\w*|\bmicrocalcification\w*` },
  { label: "architectural distortion", pattern: String.raw`\barchitectural distortion\b` },
  { label: "dominant mass", pattern: String.raw`\bdominant mass\b|\bnew (?:mass|asymmetry)\b` },
  { label: "suspicious node", pattern: String.raw`\b(?:loss of the fatty hilum|morphologically (?:abnormal|suspicious)|suspicious (?:axillary )?nodes?)\b` },
] as const;
// Skin thickening, nipple retraction and increased density are deliberately NOT
// here: in BI-RADS usage they are signs only in context — a retraction that is
// unchanged after surgery or long-standing asymmetry is reported with a benign
// category every day. A rule that called those a contradiction would mark up
// routine reports, and the mammography rule has to keep its credibility.

/** Lesion wording that can support a stated BI-RADS assessment. */
export const NAMED_LESION_TERMS: readonly ClinicalTerm[] = [
  { label: "lesion", pattern: String.raw`\blesion\w*|\bmass(?:es)?\b(?![a-z])|\bnodule\w*|\bcyst\w*|\bcalcification\w*|\bthickening\b` },
] as const;

/**
 * Statements that the study as a whole was normal. A sentence carrying one of
 * {@link SCOPE_LIMITERS} is not one: "No significant abnormality at other
 * cervical levels." is the correct way to pair a focal herniation with clear
 * background tissue, and reading it as a whole-study normal is exactly what
 * made the correct cervical report look contradictory.
 */
export const STUDY_NORMAL_PATTERNS: readonly RegExp[] = [
  /\bno (?:acute |significant |gross |focal )?abnormality\b/i,
  /\bno (?:acute |significant |gross )?pathology\b/i,
  /\bnormal study\b/i,
  /\bunremarkable (?:exam|examination|study|scan|report)\b/i,
  /\bnormal(?:\s+\w+){0,2}\s+(?:mri|mr|mrcp|ct|us|usg|ultrasound|sonography|doppler|scan|examination|report|radiograph|x-?ray|mammogram|survey|study)\b/i,
  /\b(?:mri|ct|us|usg|ultrasound|mrcp|doppler|mammogram|radiograph|study|examination|scan)(?:\s+\w+){0,2}\s+(?:is|was) normal\b/i,
  /\bnegative (?:screening |study|examination|mammogram)\b/i,
] as const;

/** Qualifiers that limit a normal statement to part of the study. */
export const SCOPE_LIMITERS: readonly RegExp[] = [
  /\bother\b/i,
  /\brest of\b/i,
  /\bremaining\b/i,
  /\bexcept\b/i,
  /\bapart from\b/i,
  /\bbeyond\b/i,
  /\bsave for\b/i,
  /\bin isolation\b/i,
] as const;

/**
 * Uncertainty is not denial: "cannot be excluded", "possible", "suspected" and
 * "equivocal" leave an abnormality on the record, so a report whose impression
 * then calls the study normal still contradicts itself.
 */
const UNCERTAINTY =
  /\b(?:cannot (?:be )?(?:exclude|excluded|rule ?out|assessed|evaluated|demonstrated)|not excluded|possible|probable|likely|presumably|equivocal|query|questionable|suspected|suspicion for|to exclude|for exclusion|rule ?out|may (?:repre|be)|could (?:repre|be)|concern(?:s)? for|suggestive of|suspicious for|cannot be (?:seen|identified))\b/i;

/** Where an earlier "no" stops governing: a fresh assertion begins here. */
const SCOPE_RESET =
  /\b(?:but|however|although|though|yet|whereas|nevertheless|while|there (?:is|are|was|were)|has (?:been|revealed)|with (?:a|an)|show(?:s|ed|n)?|demonstrat\w+|reveal\w+|noted|present(?:ed)?|contains|identified|seen|detect\w+|correlate(?:d)? with)\b/gi;

/** Denial before the term: "no acute haemorrhage", "without calculus". */
const DENIAL_BEFORE =
  /\b(?:no|not|without|absence of|absent|lack of|negative for|free of|denies|denied|neither|excluding)\b/i;

/** Denial after the term: "disc herniation is not seen", "tumour excluded". */
const DENIAL_AFTER =
  /\b(?:not (?:seen|identified|detected|demonstrated|noted|present|evident|appreciable|found|apparent|discernible)|excluded|ruled ?out)\b/i;

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+|[;\n]+/;

function sentences(text: string): string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/**
 * The stretch a denial cue can still govern, from the last reset up to the term.
 * The split is by sentence rather than by comma because "No mass effect, midline
 * shift or herniation" keeps one negation across all three items — cutting at
 * the commas would have made a normal head CT report a herniation.
 */
function governingScope(sentence: string, termStart: number): string {
  const before = sentence.slice(0, termStart);
  let start = 0;
  SCOPE_RESET.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCOPE_RESET.exec(before)) !== null) start = m.index + m[0].length;
  return before.slice(start);
}

function windowAfter(sentence: string, termEnd: number): string {
  const tail = sentence.slice(termEnd);
  const stop = tail.search(/[,]/);
  return stop === -1 ? tail.slice(0, 48) : tail.slice(0, Math.min(stop, 48));
}

/**
 * What the text does with one mention of a term — denies it, asserts it, or holds
 * it open. The precedence is the one {@link assertedAbnormality} has always had,
 * written out as three states instead of a boolean: an unresolved abnormality still
 * contradicts a normal summary, but it is not the same clinical fact as a stated
 * one, and the findings signature has to tell those apart or "cannot be excluded"
 * and "is present" would read as the same report.
 */
function occurrenceState(sentence: string, start: number, end: number): ClinicalOccurrence["state"] {
  const scope = governingScope(sentence, start);
  const after = windowAfter(sentence, end);
  // Denial outranks a hedge: "no likely fracture" and "no definite abnormality"
  // are denials, and reading the hedge as the assertion is what marks up a
  // correct normal report. A hedge with NO denial cue is the other case —
  // "haemorrhage cannot be excluded" keeps the abnormality on the record.
  if (DENIAL_BEFORE.test(scope)) return "denied";
  if (UNCERTAINTY.test(scope) || UNCERTAINTY.test(after)) return "uncertain";
  if (DENIAL_AFTER.test(after)) return "denied";
  return "asserted";
}

/** One mention of one vocabulary term, and what the text did with it. */
export type ClinicalOccurrence = {
  label: string;
  state: "asserted" | "denied" | "uncertain";
};

/**
 * Every vocabulary mention in the text, in sentence order then term order. The
 * order is load-bearing: {@link assertedAbnormality} reports the first mention the
 * text does not deny, and the rule messages quote that label.
 */
export function clinicalOccurrences(
  text: string,
  terms: readonly ClinicalTerm[] = ABNORMAL_TERMS,
): ClinicalOccurrence[] {
  const out: ClinicalOccurrence[] = [];
  if (!text) return out;
  for (const sentence of sentences(text)) {
    const lower = sentence.toLowerCase();
    for (const term of terms) {
      for (const match of lower.matchAll(compiled(term.pattern))) {
        const at = match.index ?? 0;
        out.push({ label: term.label, state: occurrenceState(lower, at, at + match[0].length) });
      }
    }
  }
  return out;
}

/**
 * The first abnormality this text genuinely asserts, or null when every mention
 * of the vocabulary is denied ("no fracture", "without calculus"). Uncertain
 * mentions count as asserted.
 *
 * Patterns are compiled once: the live quality badge re-runs these rules on every
 * keystroke, and rebuilding ~50 patterns per sentence per call is work a
 * radiologist should not pay for while typing.
 */
const COMPILED = new Map<string, RegExp>();

function compiled(pattern: string): RegExp {
  let re = COMPILED.get(pattern);
  if (!re) {
    re = new RegExp(pattern, "gi");
    COMPILED.set(pattern, re);
  }
  return re;
}

export function assertedAbnormality(
  text: string,
  terms: readonly ClinicalTerm[] = ABNORMAL_TERMS,
): string | null {
  for (const occurrence of clinicalOccurrences(text, terms)) {
    if (occurrence.state !== "denied") return occurrence.label;
  }
  return null;
}

/** True when some sentence claims the whole study was normal. */
export function assertsStudyNormal(text: string): boolean {
  if (!text) return false;
  for (const sentence of sentences(text)) {
    if (SCOPE_LIMITERS.some((re) => re.test(sentence))) continue;
    if (STUDY_NORMAL_PATTERNS.some((re) => re.test(sentence))) return true;
  }
  return false;
}

/**
 * The BI-RADS assessment categories stated in the text, in order. Composition
 * categories (A-D) describe density rather than an assessment and are skipped,
 * and a suffix letter (4C) still reads as category 4.
 */
export function assessmentCategories(text: string): number[] {
  if (!text) return [];
  const found: number[] = [];
  const re = /\b(?:bi-?rads)\s+(?:assessment\s+)?category\s*([0-5])\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (text.slice(Math.max(0, m.index - 24), m.index).toLowerCase().includes("composition")) continue;
    found.push(Number(m[1]));
  }
  return found;
}

/** Spinal / vascular level, with the second digit's letter filled in so "C5-6"
 *  and "C5-C6" are one fact. */
const LEVEL_TOKEN = /\b([ctls])(\d{1,2})(?:\s*-\s*([ctls])?(\d{1,2}))?\b/gi;

const LATERALITY_TOKEN = /\b(left|right|bilateral|contralateral|unilateral)\b/gi;

/** A number with the unit it was written with — the canal diameter, the stone,
 *  the gestational age. Units are folded to one spelling so "8 mm" and "8mm"
 *  are one fact. */
const MEASUREMENT_TOKEN =
  /\b(\d+(?:[.,]\d+)?)\s*(mm|cm|cc|ml|hu|hounsfield|weeks?|days?|months?|years?)\b/gi;

/**
 * The qualifiers a radiologist would call a clinical change if one of them were
 * rewritten in the Findings: severity, acuity and extent. Deliberately a closed
 * list rather than every adjective — "adjacent" or "prominent" re-arranging is
 * prose, while "mild" becoming "severe" is a different patient.
 */
const SEVERITY_TOKEN =
  /\b(acute|chronic|subacute|mild|moderate|severe|minimal|marked|massive|complete|partial|focal|diffuse|small|large|significant)\b/gi;

const UNIT_CANON: Record<string, string> = {
  mm: "mm",
  cm: "cm",
  cc: "cc",
  ml: "ml",
  hu: "hu",
  hounsfield: "hu",
  week: "wk",
  weeks: "wk",
  day: "d",
  days: "d",
  month: "mo",
  months: "mo",
  year: "yr",
  years: "yr",
};

/**
 * The clinical content of a Findings block, as a comparable string.
 *
 * This is what the Impression is declared to summarise, so it is the value the
 * workspace records when the summary is written and compares against when the
 * report is reopened. Everything presentation-shaped is excluded — headings,
 * punctuation, capitalisation, sentence order, "the" — and everything
 * decision-shaped is included: which abnormalities are asserted, denied or held
 * open, at which level, on which side, at what size and severity. Re-formatting
 * the Findings therefore leaves the signature alone, while changing C5-C6 to
 * C6-C7, left to right, 8 mm to 18 mm, or withdrawing a denial does not.
 */
/**
 * Function words, and the cues the negation reading already consumes. Excluded so
 * that re-flowing a sentence — punctuation, case, articles, is/with — is not
 * mistaken for a clinical change. Every content word is kept, so a sentence added
 * or removed always counts as one: a radiologist's free-text note has no term,
 * level, side or number in it and must still arm the dependency, because prose the
 * vocabulary cannot classify is exactly the prose that needs re-reading.
 */
const SIGNATURE_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "nor", "to", "of", "in", "on", "at", "is", "are", "was", "were",
  "be", "been", "being", "with", "without", "within", "no", "not", "cannot", "that", "this",
  "these", "those", "there", "here", "it", "its", "their", "as", "by", "from", "than", "which",
  "can", "could", "may", "might", "for", "per", "into", "over", "under", "also", "still", "yet",
]);

/** A line with no lower-case letter in it is a heading, not prose. */
const HEADING_LINE = /^[^a-z]*$/;

function contentWords(text: string): string[] {
  const words: string[] = [];
  for (const line of text.split(/\n+/)) {
    if (!line.trim() || HEADING_LINE.test(line)) continue;
    for (const raw of line.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || SIGNATURE_STOP_WORDS.has(raw)) continue;
      words.push(raw);
    }
  }
  return words;
}

export function clinicalContentSignature(text: string): string {
  if (!text) return "";
  const tokens = new Set<string>();

  for (const occurrence of clinicalOccurrences(text)) {
    const marker =
      occurrence.state === "asserted" ? "A" : occurrence.state === "uncertain" ? "U" : "N";
    tokens.add(`${marker}:${occurrence.label}`);
  }

  for (const match of text.matchAll(LEVEL_TOKEN)) {
    const vertebral = match[1].toUpperCase();
    const level = `${vertebral}${match[2]}`;
    tokens.add(match[4] ? `L:${level}-${(match[3] ?? vertebral).toUpperCase()}${match[4]}` : `L:${level}`);
  }
  for (const match of text.matchAll(LATERALITY_TOKEN)) tokens.add(`S:${match[1].toLowerCase()}`);
  for (const match of text.matchAll(MEASUREMENT_TOKEN)) {
    const unit = UNIT_CANON[match[2].toLowerCase()] ?? match[2].toLowerCase();
    tokens.add(`M:${match[1].replace(",", ".")}${unit}`);
  }
  for (const match of text.matchAll(SEVERITY_TOKEN)) tokens.add(`Q:${match[1].toLowerCase()}`);
  for (const word of contentWords(text)) tokens.add(`W:${word}`);

  return [...tokens].sort().join("|");
}
