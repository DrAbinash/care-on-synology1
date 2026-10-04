/**
 * Which findings lines assert something abnormal, read from the text alone.
 *
 * The editor colours what a Quick Select box contributed, because the store holds
 * provenance. Provenance is deliberately NOT persisted — a saved draft carries the
 * plain clinical fields only — so the print surface cannot ask "which line did a
 * box add?" and has to read the sentence instead. This module is that reading, and
 * every output shares it (screen Preview, Word export, live print body, letter-pad
 * PDF) so a line is bold in all four or in none.
 *
 * Two rules, both learned from measuring the shipped libraries:
 *
 *  1. A denial anywhere earlier in the SAME SENTENCE cancels the cue. A fixed
 *     character window was not enough: "No gross disc herniation, canal stenosis
 *     or cord compression" put "stenosis" outside the window and bolded a normal
 *     cervical-screening impression.
 *  2. This vocabulary is NOT the impression vocabulary. Impression synthesis
 *     trades precision for recall and counts "grade II" or "seen in" as points;
 *     bolding those printed "Single live intrauterine gestation… Placenta is
 *     posterior, fundal, grade II" — a normal obstetric report in bold. A false
 *     positive here falls on the one-click normal report, which is the page the
 *     radiologist scans and prints without reading.
 */

/** Words that assert pathology rather than describe an examination. */
const PATHOLOGY_TERMS = [
  // Spine
  "bulge", "bulging", "protrusion", "extrusion", "sequestr", "herniat", "discitis",
  "desiccat", "degenerat", "stenosis", "narrowing", "spondylosis", "listhesis",
  "arthropathy", "hypertroph", "schmorl", "modic", "osteophyte", "discopathy",
  "myelopathy", "radiculopath", "loss of", "flavum thickening", "reduced",
  // Brain, head, orbit
  "infarct", "ischemi", "ischaemi", "lacune", "lacunar", "hemorrhage",
  "haemorrhage", "bleed", "aneurysm", "thrombo", "embol", "occlus", "mass effect",
  "midline shift", "hydrocephal", "atrophy", "fazekas", "leukoaraiosis",
  "demyelinat", "edema", "oedema", "space-occupying", "lesion", "tumor", "tumour",
  "neoplasm", "metast", "proptosis", "cellulitis", "sinusitis",
  "thickening", "effusion",
  // Chest, abdomen, pelvis
  "consolidat", "infiltrat", "cavitat", "pneumothorax", "atelectasis", "ascites",
  "collection", "abscess", "obstruct", "perforat", "cirrhosis", "fibrosis",
  "fatty", "hepatomegal", "splenomegal", "prostatomegal", "hydronephro",
  "hydroureter", "pyelonephritis", "cystitis", "cholecystitis", "cholelith",
  "pancreatitis", "appendicit", "diverticul", "calcul", "stone", "sludge",
  "polyp", "cyst", "shadowing", "hyperechoic", "hypoechoic",
  "heterogene", "echotexture", "granulomat",
  // Musculoskeletal, breast, general
  "fracture", "sublux", "dislocat", "tear", "sprain", "bursitis", "tendinopath",
  "tendinitis", "enthesophyt", "nodule", "spiculated", "ground-glass", "malignan",
  "suspicious", "abnormal",
];

/** Denials that cancel a cue appearing after them, within one sentence. */
const DENIAL_TERMS = [
  "no", "not", "without", "absence", "unremarkable", "normal", "negative",
  "intact", "free", "clear", "preserved", "maintained", "adequate", "patent",
  "unlikely", "excluded",
];

/** Stem-only cues that live inside a longer word, so they cannot carry a leading
 *  word boundary: "spondylolisthesis" is one word, and `\blisthesis` never matches. */
const PATHOLOGY_SUFFIX_STEMS = ["olisthesis"];

const termRe = (terms: string[]) => new RegExp(`\\b(${terms.join("|")})`, "i");

const PATHOLOGY_RE = new RegExp(
  `\\b(${PATHOLOGY_TERMS.join("|")})|\\w*(${PATHOLOGY_SUFFIX_STEMS.join("|")})`,
  "i",
);
const DENIAL_RE = termRe(DENIAL_TERMS);

/** Sentence boundaries, keeping the delimiter out of the fragments. */
const SENTENCE_SPLIT = /(?<=[.!?;])\s+|\n+/;

/** A heading, a table row or a bare label is not a sentence to emphasise, and a
 *  short token ("Normal.", "—") is never worth the risk. */
function isEmphasisCandidate(line: string): boolean {
  const s = line.trim();
  if (s.length < 8) return false;
  if (s.endsWith(":")) return false;
  if (s.startsWith("|")) return false;
  if (/^#{1,3}\s/.test(s)) return false;
  return true;
}

/**
 * True when the line reports pathology. Each cue is judged inside its own
 * sentence, so "No significant stenosis. Disc bulge at L4-L5." is bold and
 * "No gross disc herniation, canal stenosis or cord compression." is not.
 */
export function isAbnormalFindingsLine(line: string | null | undefined): boolean {
  const s = (line ?? "").trim();
  if (!isEmphasisCandidate(s)) return false;
  for (const sentence of s.split(SENTENCE_SPLIT)) {
    const lower = sentence.toLowerCase();
    const re = new RegExp(PATHOLOGY_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      if (DENIAL_RE.test(lower.slice(0, m.index))) continue;
      return true;
    }
  }
  return false;
}
