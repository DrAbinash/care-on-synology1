/**
 * Local (non-AI) impression synthesis from findings text or structured sections.
 * Fast first pass before optional AI polish.
 *
 * Picks ABNORMAL / clinically significant lines — never collapses a mixed report
 * to "No significant abnormality" just because some sentences say "normal".
 */

/** Section headers like "White Matter" / "Basal Ganglia and Thalami" (no sentence). */
const SECTION_HEADER_RE = /^[A-Z][A-Za-z0-9 /&()-]{2,40}$/;

/** Pathology / abnormality cues worth promoting to impression. */
const ABNORMAL_CUE_RE =
  /\b(infarct|atrophy|fazekas|hyperintense|hypointense|lesion|stenosis|edema|ha?emorrhage|fracture|compression|desiccation|bulge|herniation|displacement|mass effect|midline shift|hydrocephalus|grade\s*[ivx\d]+|ischemic|lacunar|changes are consistent|noted in|seen in)\b/i;

/**
 * Normal wording, recognised anywhere in the sentence rather than only at its
 * front. CARE's authored normals do not begin with a normal word: "Lumbar facet
 * joints are unremarkable." and "Ligamentum flavum is not hypertrophied." both
 * fell through to the length rule and arrived in the Impression as findings,
 * which is how a complete normal report restated its own body in its conclusion.
 */
const NORMAL_PREDICATE_RE =
  /\b(unremarkable|within normal limits|appears?\s+normal|normal(?:ly)?\b|preserved|maintained|patent|intact|unchanged|no significant|not\s+\w+ed|limited)\b/i;

/**
 * A leading anatomical label — `C5-C6:`, `Cervical spine:` — is not prose.
 *
 * CARE's per-level normals are all written `<level>: <sentence>`, and the denial
 * that opens the sentence denies everything the sentence then names. Testing the
 * label-prefixed line against `^` instead said the label had pushed the denial
 * out of scope, so 20 of the shipped per-level normals read as pathology:
 * "C5-C6: No spinal canal or thecal sac compression is seen." arrived in a
 * signed Conclusion as a compression. A label carrying a period or semicolon
 * could be a sentence of its own, so the pattern refuses those.
 */
const LEADING_LABEL_RE = /^[^.;:]{1,40}:\s+/;

/** The same sentence without the `<level>:` / `<region>:` it may open with. */
function unlabelled(s: string): string {
  return s.replace(LEADING_LABEL_RE, "");
}

/** How far from a cue a negation still governs it, in words. */
const NEGATION_LOOK_BACK = 4;
const NEGATION_LOOK_FORWARD = 4;

/** A sentence that opens by denying something. */
const LEADING_NEGATION_RE = /^(otherwise[,:]?\s*)?(there (?:is|are)\s+)?(no|without|absence of|negative for|free of)\b/i;

/** Words that deny a finding sitting anywhere later in the same sentence. */
const NEGATION_WORDS = new Set(["no", "not", "without", "absent", "lacking", "negative", "unless"]);

/** A denial that only covers the first half of a compound sentence. */
const CONTRAST_RE = /\b(but|however|whereas|although|though|while|except|besides|rather than|other than)\b/i;

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/**
 * Does this clause deny the cue at `at`?
 *
 * The scan stops at the clause boundary, because "No hemorrhage, but a small
 * infarct is present." must NOT lose its infarct — and it does not stop at a
 * comma when the sentence opened with a denial, because "No mass lesion, midline
 * shift, or hydrocephalus." denies all three items, not just the first.
 */
function denied(s: string, at: number, end: number): boolean {
  const before = s.slice(0, at);
  const clause = before.slice(Math.max(before.lastIndexOf(","), before.lastIndexOf(";")) + 1);
  // The words the cue is sitting on, not the words the clause started with:
  // "A 2 cm lesion is not seen in the frontal lobe." denies the lesion twice —
  // once in front of `lesion` and once in front of `seen in` — and scanning only
  // the clause's opening words left the second cue uncounted, so the sentence
  // came back as a finding.
  if (words(clause).slice(-NEGATION_LOOK_BACK).some((w) => NEGATION_WORDS.has(w))) return true;
  if (words(s.slice(end)).slice(0, NEGATION_LOOK_FORWARD).some((w) => NEGATION_WORDS.has(w))) return true;
  return LEADING_NEGATION_RE.test(unlabelled(s)) && !CONTRAST_RE.test(before);
}

/**
 * Does this sentence actually assert pathology, or does it deny it?
 *
 * `ABNORMAL_CUE_RE` matches a word, not a claim, so "No acute infarct is seen."
 * reads as abnormal to it — the infarct survives its own negation. Every cue
 * occurrence is therefore tested against the words around it, and a sentence
 * whose cues are all denied asserts nothing. With no cue at all, a sentence that
 * says "unremarkable / preserved / maintained / patent / not …ed" anywhere in it
 * is a normal, not a finding.
 */
export function assertsAbnormality(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  const scan = new RegExp(ABNORMAL_CUE_RE.source, "gi");
  let positive = 0;
  let deniedCount = 0;
  for (let m = scan.exec(s); m !== null; m = scan.exec(s)) {
    if (denied(s, m.index, m.index + m[0].length)) deniedCount += 1;
    else positive += 1;
  }
  if (positive > 0) return true;
  if (deniedCount > 0) return false;
  // Nothing on the cue list, so decide between a normal and an unrecognised
  // finding. Denial wording counts as a normal here: "Brain parenchyma shows no
  // gross signal abnormality on screening sequences." denies a thing this file's
  // cue list does not name, and defaulting it to a finding put the sentence in
  // the Conclusion as though it asserted one.
  return !NORMAL_PREDICATE_RE.test(s)
    && !LEADING_NEGATION_RE.test(unlabelled(s))
    && !words(s).some((w) => NEGATION_WORDS.has(w));
}

function splitFindingsLines(findingsText: string): string[] {
  return findingsText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[\u2022\-*•]\s*/, "").trim())
    .filter((s) => s.length > 8 && !SECTION_HEADER_RE.test(s));
}

export function isAbnormalFindingLine(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  // A sentence that denies its own finding, or that only says nothing was seen,
  // is not an impression point however long it is.
  if (!assertsAbnormality(s)) return false;
  if (ABNORMAL_CUE_RE.test(s)) return true;
  // Prose outside CARE's vocabulary of cues and normals keeps the long-standing
  // default: a dictated sentence goes to the Impression rather than being
  // silently dropped for not matching a list.
  return s.length > 24;
}

function sentencesFromFindings(findingsText: string): string[] {
  const text = findingsText.trim();
  if (!text) return [];

  const lines = splitFindingsLines(text);
  const abnormal = lines.filter(isAbnormalFindingLine);
  if (abnormal.length > 0) return abnormal.slice(0, 6);

  // Entire findings read as normal / negative.
  if (lines.length > 0) return ["No significant abnormality detected."];
  return [text.slice(0, 200)];
}

function abnormalFromStructured(
  structuredSections: Record<string, { normal: boolean; text: string }>,
): string[] {
  const fromFlag = Object.entries(structuredSections)
    .filter(([, v]) => !v.normal && v.text.trim())
    .map(([label, v]) => `${label}: ${v.text.trim()}`);
  if (fromFlag.length > 0) return fromFlag.slice(0, 6);

  // Cards marked Normal but text still has pathology (mis-toggled cards).
  const fromText = Object.entries(structuredSections)
    .filter(([, v]) => v.text.trim() && isAbnormalFindingLine(v.text))
    .map(([label, v]) => `${label}: ${v.text.trim()}`);
  return fromText.slice(0, 6);
}

export function generateLocalImpression(
  findingsText: string,
  structuredSections?: Record<string, { normal: boolean; text: string }>,
): string[] {
  if (structuredSections && Object.keys(structuredSections).length > 0) {
    const fromStructured = abnormalFromStructured(structuredSections);
    if (fromStructured.length > 0) return fromStructured;

    const fromFreeText = sentencesFromFindings(findingsText);
    if (fromFreeText.length > 0 && fromFreeText[0] !== "No significant abnormality detected.") {
      return fromFreeText;
    }
    return ["No significant abnormality detected."];
  }

  return sentencesFromFindings(findingsText);
}
