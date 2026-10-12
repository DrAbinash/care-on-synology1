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
  // Added 2026-10-11 with the cervical Quick Select catalogue, whose lines printed
  // in plain type: cord compression, myelomalacia, a syrinx, OPLL, kyphosis and an
  // atlanto-axial instability are the six findings a radiologist least wants to
  // scan past. Each is a stem, so "compressed"/"ossification"/"instabilities" all
  // read. `compress` is the one that leans on rule 1: every shipped normal says
  // "No cord compression is seen." / "…: No spinal canal or thecal sac compression
  // is seen.", which the denial arm cancels, and "Normal thoracic kyphosis is
  // maintained." likewise puts its denial ahead of the cue. Both word orders are
  // pinned by name in abnormalEmphasis.test.ts, so a normal reworded to "Thoracic
  // kyphosis is normal." fails a guard instead of bolding a normal page.
  "compress", "myelomalaci", "syrinx", "kyphos", "instabilit", "ossif",
  // Brain, head, orbit
  "infarct", "ischemi", "ischaemi", "lacune", "lacunar", "encephalomalaci",
  "hemorrhage", "haemorrhage", "bleed", "subdural", "epidural", "subarachnoid",
  "microbleed", "hemosiderin",
  "cavernoma", "avm", "arteriovenous", "contusion", "diffuse axonal",
  "aneurysm", "thrombo", "embol", "occlus", "mass effect",
  "midline shift", "hydrocephal", "atrophy", "fazekas", "leukoaraiosis",
  "demyelinat", "sclerosis", "hyperintens",
  "edema", "oedema", "space-occupying", "lesion", "tumor", "tumour",
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

/**
 * The cue named as the subject of a normality predicate: "Thoracic kyphosis is
 * within normal limits." Rule 1 is positional — it cancels a cue that has a denial
 * ahead of it — and the canonical dorsal alignment normal puts the cue first, so a
 * line of the one-click normal page came out bold. Same statement, other word
 * order, so it cancels the same way. The predicate must sit in the cue's own
 * clause: "Small disc bulge, the canal is normal." stays bold because the
 * normality belongs to the canal, not to the bulge.
 */
const NORMALITY_PREDICATE =
  /\b(is|are|was|were)\s+(within\s+|in\s+)?(the\s+)?(limits\s+of\s+)?(normal|unremarkable|preserved|maintained|intact|patent|adequate|free)\b/i;

/** Clause boundaries inside a sentence — a predicate only speaks for its own clause. */
const CLAUSE_SPLIT_CHARS = [",", ";"];

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
      if (NORMALITY_PREDICATE.test(clauseFromCue(lower, m.index, m[0].length))) continue;
      return true;
    }
  }
  return false;
}

/** From the cue to the end of its own clause: a normality predicate in a
 *  neighbouring clause is about other anatomy and must not cancel this cue. */
function clauseFromCue(lower: string, at: number, length: number): string {
  let end = lower.length;
  for (const ch of CLAUSE_SPLIT_CHARS) {
    const after = lower.indexOf(ch, at + length);
    if (after !== -1 && after < end) end = after;
  }
  return lower.slice(at, end);
}
