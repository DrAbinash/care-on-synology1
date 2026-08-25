/**
 * Local (non-AI) impression synthesis from findings text or structured sections.
 * Fast first pass before optional AI polish.
 *
 * Picks ABNORMAL / clinically significant lines — never collapses a mixed report
 * to "No significant abnormality" just because some sentences say "normal".
 */

/** Section headers like "White Matter" / "Basal Ganglia and Thalami" (no sentence). */
const SECTION_HEADER_RE = /^[A-Z][A-Za-z0-9 /&()-]{2,40}$/;

/** Pure normal / negative lines that should not become impression points. */
const PURE_NORMAL_RE =
  /^(otherwise[,:]?\s*)?(no\s+(mass|evidence|diffusion|extra-?axial|post[-\s]?contrast|abnormal|acute)|normal\b|morphology and signal|gray[-\s]?white|brainstem is normal|differentiation is preserved|signal (intensity )?are preserved|within normal limits|unremarkable|appears? normal|no significant abnormality)/i;

/** Pathology / abnormality cues worth promoting to impression. */
const ABNORMAL_CUE_RE =
  /\b(infarct|atrophy|fazekas|hyperintense|hypointense|lesion|stenosis|edema|ha?emorrhage|fracture|compression|desiccation|bulge|herniation|displacement|mass effect|midline shift|hydrocephalus|grade\s*[ivx\d]+|ischemic|lacunar|changes are consistent|noted in|seen in)\b/i;

function splitFindingsLines(findingsText: string): string[] {
  return findingsText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[\u2022\-*•]\s*/, "").trim())
    .filter((s) => s.length > 8 && !SECTION_HEADER_RE.test(s));
}

export function isAbnormalFindingLine(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  if (PURE_NORMAL_RE.test(s) && !ABNORMAL_CUE_RE.test(s)) return false;
  if (ABNORMAL_CUE_RE.test(s)) return true;
  // Negated normals ("No acute infarction.") are not primary impression points
  // when stronger positives exist — still skip as standalone "normal" filler.
  if (/^no\b/i.test(s)) return false;
  if (/\bnormal\b/i.test(s) && !ABNORMAL_CUE_RE.test(s)) return false;
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
