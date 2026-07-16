// text/evaluate.ts — the SINGLE source of truth for the free-text (heuristic)
// tier. Reproduces the legacy validateReport + computeQualityScore behaviour
// EXACTLY (same messages, same order, same score) but emits STRUCTURED findings
// each tagged with a stable rule id from ruleCatalog.ts. The legacy-shaped
// wrappers in ./legacy.ts derive from this, so there is one generator, not two.
//
// Parity is guarded at runtime by the golden shadow tests in the consumer and
// by scripts that diff this against the original reportValidator.ts. Any edit
// here must keep those green.

import type { TextReportInput } from "../contract";
import type { RuleId } from "../ruleCatalog";

export interface TextTierFinding {
  ruleId: RuleId;
  message: string;
  /** Points this finding deducts from the 100-point quality score. */
  deduct: number;
}

export interface TextTierResult {
  score: number;
  findings: TextTierFinding[];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
}

const PATHOLOGY_WORDS = [
  "infarct", "hemorrhage", "tumor", "tumour", "lesion", "fracture", "stenosis",
  "compression", "bulge", "herniation", "collection", "edema", "oedema",
  "demyelination", "atrophy", "gliosis", "spondylodiscitis", "tuberculosis",
  "mass effect", "midline shift", "impingement",
];

const NORMAL_PHRASES = [
  "no significant abnormality", "normal study", "unremarkable study",
  "no focal parenchymal lesion",
];

/**
 * Evaluate the free-text tier. Findings are emitted in the EXACT order the
 * legacy computeQualityScore produced its `issues` array:
 *   completeness (Q001-Q005) → validateReport warnings (Q101-Q115) →
 *   checklist (Q006) → missing measurements (Q007).
 */
export function evaluateTextTier(input: TextReportInput): TextTierResult {
  const findings: TextTierFinding[] = [];
  const emit = (ruleId: RuleId, message: string, deduct: number) =>
    findings.push({ ruleId, message, deduct });

  // ── Completeness (Q001-Q005), same points as computeQualityScore ──
  if (!(input.findings || "").trim()) emit("Q001", "Findings section is empty.", 30);
  if ((input.impression || []).every((l) => !l.trim())) emit("Q002", "Impression section is empty.", 25);
  if (!(input.technique || "").trim()) emit("Q003", "Technique not documented.", 10);
  if (!(input.clinicalHistory || "").trim()) emit("Q004", "Clinical history not documented.", 5);
  if (!(input.recommendation || "").trim()) emit("Q005", "No recommendation/advice given.", 5);

  // ── validateReport warnings (Q101-Q115), each -5, in validateReport order ──
  emitWarnings(input, emit);

  // ── checklist + measurements (Q006/Q007) ──
  if (input.checklistPercent !== undefined && input.checklistPercent < 100) {
    emit("Q006", `Protocol checklist incomplete (${input.checklistPercent}% addressed).`, 10);
  }
  if (input.missingRequiredMeasurements?.length) {
    emit("Q007", `Missing required measurement(s): ${input.missingRequiredMeasurements.join(", ")}.`, 5);
  }

  const total = findings.reduce((s, f) => s + f.deduct, 0);
  return { score: Math.max(0, 100 - total), findings };
}

/** The validateReport rule sequence — each finding deducts 5, order preserved. */
function emitWarnings(report: TextReportInput, emit: (id: RuleId, msg: string, deduct: number) => void): void {
  const findingsText = report.findings || "";
  const impressionText = (report.impression || []).join("\n");
  const findingsLower = findingsText.toLowerCase();
  const impressionLower = impressionText.toLowerCase();
  const W = 5;

  // Q101 — duplicate sentences in Findings
  const seen = new Map<string, number>();
  for (const s of sentences(findingsText)) {
    const key = s.toLowerCase().replace(/\s+/g, " ");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      emit("Q101", `Duplicate sentence in Findings (appears ${count}×): "${key.slice(0, 70)}${key.length > 70 ? "…" : ""}"`, W);
    }
  }

  // Q102 — duplicate impression lines
  const impSeen = new Set<string>();
  for (const line of report.impression || []) {
    const key = line.trim().toLowerCase();
    if (!key) continue;
    if (impSeen.has(key)) emit("Q102", `Duplicate impression line: "${line.trim().slice(0, 70)}"`, W);
    impSeen.add(key);
  }

  // Q103 — "normal study" contradiction
  const saysNormal = NORMAL_PHRASES.some((p) => findingsLower.includes(p) || impressionLower.includes(p));
  if (saysNormal) {
    const pathologyHit = PATHOLOGY_WORDS.find((w) => findingsLower.includes(w) || impressionLower.includes(w));
    if (pathologyHit) {
      emit("Q103", `Possible contradiction: report contains a "normal study" phrase AND mentions "${pathologyHit}".`, W);
    }
  }

  // Q104 — laterality: impression side not in findings
  const findingsLeft = /\bleft\b/i.test(findingsText);
  const findingsRight = /\bright\b/i.test(findingsText);
  const impLeft = /\bleft\b/i.test(impressionText);
  const impRight = /\bright\b/i.test(impressionText);
  if (impLeft && !findingsLeft && findingsRight) {
    emit("Q104", 'Laterality check: Impression says "left" but Findings only mention "right".', W);
  }
  if (impRight && !findingsRight && findingsLeft) {
    emit("Q104", 'Laterality check: Impression says "right" but Findings only mention "left".', W);
  }

  // Q105 — pathology in findings but impression empty
  const hasPathology = PATHOLOGY_WORDS.some((w) => findingsLower.includes(w));
  const impressionEmpty = (report.impression || []).every((l) => !l.trim());
  if (hasPathology && impressionEmpty) {
    emit("Q105", "Findings describe pathology but the Impression section is empty.", W);
  }

  // Q106 — unfilled placeholder
  if (findingsText.includes("{value}") || impressionText.includes("{value}")) {
    emit("Q106", "An un-filled measurement placeholder {value} is still present in the report.", W);
  }

  // ── medical consistency (Q107-Q114) ──
  const fullText = [report.clinicalHistory, report.technique, findingsText, impressionText, report.recommendation]
    .filter(Boolean).join(" ");
  const fullTextLower = fullText.toLowerCase();
  const studyDesc = (report.studyDescription || "").toUpperCase();

  // Q107 — laterality vs study description
  const mentionsRight = /\bright\b/i.test(fullText);
  const mentionsLeft = /\bleft\b/i.test(fullText);
  if (studyDesc.includes("LEFT") && mentionsRight && !mentionsLeft) {
    emit("Q107", "Laterality contradiction: study description specifies LEFT, but the report only mentions RIGHT.", W);
  }
  if (studyDesc.includes("RIGHT") && mentionsLeft && !mentionsRight) {
    emit("Q107", "Laterality contradiction: study description specifies RIGHT, but the report only mentions LEFT.", W);
  }

  // Q108 — protrusion direction
  if (fullTextLower.includes("anterior protrusion") && fullTextLower.includes("posterior protrusion")) {
    emit("Q108", "Report mentions both anterior and posterior protrusions — verify the primary direction.", W);
  }

  // Q109 — gender/anatomy
  const sex = (report.sex || "").toUpperCase();
  if (sex.startsWith("F") && (fullTextLower.includes("prostate") || fullTextLower.includes("seminal vesicle"))) {
    emit("Q109", "Gender contradiction: report for a female patient mentions male anatomy (prostate/seminal vesicle).", W);
  }
  if (sex.startsWith("M") && ["uterus", "ovary", "ovarian", "endometrium", "cervix", "uterine"].some((w) => fullTextLower.includes(w))) {
    emit("Q109", "Gender contradiction: report for a male patient mentions female anatomy (uterus/ovary/endometrium/cervix).", W);
  }

  // Q110 — age appropriateness
  const ageMatch = (report.age || "").match(/(\d+)/);
  const ageVal = ageMatch ? parseInt(ageMatch[1], 10) : null;
  if (ageVal !== null && ageVal < 18 && ["degenerative changes", "senile", "osteoarthritis"].some((w) => fullTextLower.includes(w))) {
    emit("Q110", `Age-inappropriate wording: pediatric patient (${report.age}) described using adult degenerative terms.`, W);
  }
  if (ageVal !== null && ageVal > 18 && ["growth plates open", "physes open"].some((w) => fullTextLower.includes(w))) {
    emit("Q110", `Age-inappropriate wording: adult patient (${report.age}) described with pediatric phrasing (open growth plates).`, W);
  }

  // Q111 — modality terminology
  const modality = (report.modality || "").toUpperCase();
  const isCT = modality.startsWith("CT");
  const isMR = modality.startsWith("MR");
  if (isCT && ["magnetic resonance", "flair", "t1-weighted", "t2-weighted", "signal intensity"].some((w) => fullTextLower.includes(w))) {
    emit("Q111", "Modality terminology mismatch: MRI wording (FLAIR/T1/T2/signal intensity) found inside a CT report.", W);
  }
  if (isMR && (/\bhu\b/.test(fullTextLower) || ["hounsfield", "computed tomography", "radiation dose"].some((w) => fullTextLower.includes(w)))) {
    emit("Q111", "Modality terminology mismatch: CT wording (HU/Hounsfield/computed tomography) found inside an MRI report.", W);
  }
  if ((isCT || isMR) && ["hyperechoic", "anechoic", "acoustic shadowing", "transducer"].some((w) => fullTextLower.includes(w))) {
    emit("Q111", "Modality terminology mismatch: ultrasound wording (hyperechoic/acoustic shadowing) found inside a cross-sectional report.", W);
  }

  // Q112 — contrast contradiction
  const isNonContrastStudy = studyDesc.includes("WITHOUT CONTRAST") || studyDesc.includes("NCCT") || studyDesc.includes("NON-CONTRAST");
  const isContrastStudy = !isNonContrastStudy &&
    (studyDesc.includes("CONTRAST") || studyDesc.includes("CECT") || studyDesc.includes("CEMRI"));
  if (isNonContrastStudy && ["gadolinium", "contrast enhancement", "post-contrast"].some((w) => fullTextLower.includes(w))) {
    emit("Q112", "Contrast contradiction: a non-contrast study mentions contrast enhancement or gadolinium.", W);
  }
  if (isContrastStudy && ["no contrast was administered", "non-contrast study"].some((w) => fullTextLower.includes(w))) {
    emit("Q112", "Contrast contradiction: a contrast study mentions that no contrast was administered.", W);
  }

  // Q113 / Q114 — findings vs impression contradiction (both directions)
  const hasNormalFindings = ["no abnormality", "within normal limits", "unremarkable"].some((w) => findingsLower.includes(w));
  const hasAbnormalImpression =
    ["acute infarct", "fracture", "hemorrhage", "stenosis", "lesion", "metastasis"].some((w) => impressionLower.includes(w)) ||
    /\bmass\b/.test(impressionLower);
  if (hasNormalFindings && hasAbnormalImpression) {
    emit("Q113", "Findings/Impression contradiction: Findings show a normal/unremarkable status, but Impression lists an abnormal diagnosis.", W);
  }
  const hasAbnormalFindings = ["herniation", "fracture", "hemorrhage", "lesion", "infarct", "stenosis"].some((w) => findingsLower.includes(w));
  const hasNormalImpression = ["no significant abnormality", "normal study", "unremarkable exam"].some((w) => impressionLower.includes(w));
  if (hasAbnormalFindings && hasNormalImpression) {
    emit("Q114", "Findings/Impression contradiction: Findings mention abnormalities, but Impression describes the study as normal/unremarkable.", W);
  }

  // Q115 — repeated word (dictation artifact)
  const words = findingsText.split(/\s+/);
  const seenWords = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    if (/[.!?]$/.test(words[i])) continue;
    const w1 = words[i].toLowerCase().replace(/[^a-z]/g, "");
    const w2 = words[i + 1].toLowerCase().replace(/[^a-z]/g, "");
    if (w1 && w1 === w2 && w1.length > 2 && !seenWords.has(w1)) {
      emit("Q115", `Repeated word "${words[i]}" in Findings — likely a dictation artifact.`, W);
      seenWords.add(w1);
    }
  }
}
