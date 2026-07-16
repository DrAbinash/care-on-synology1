// text/legacy.ts — a FAITHFUL SHADOW COPY of the live client validator
// (artifacts/diagnostic-erp/src/lib/reportValidator.ts): validateReport +
// computeQualityScore, ported verbatim so the canonical engine can reproduce
// their exact warnings and score.
//
// STRANGLER FAÇADE (PR #101, shadow-first migration): the original in
// diagnostic-erp is the live, user-visible source and is NOT modified or
// deleted. This copy runs in shadow; golden parity tests in the consumer
// (reportQualityShadow.test.ts) assert byte-for-byte equivalence before any
// caller is migrated onto the engine. When parity is proven and callers
// migrated, the original becomes a thin re-export of this and is eventually
// removed. Until then, KEEP THIS IN SYNC WITH reportValidator.ts — any change
// here must keep the parity tests green.

import type { TextReportInput } from "../contract";

// Sentence split good enough for report prose (period/newline boundaries).
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12); // ignore tiny fragments like headings
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

/** Verbatim port of reportValidator.validateReport — warn-only, exact strings. */
export function validateReportText(report: TextReportInput): string[] {
  const warnings: string[] = [];
  const findings = report.findings || "";
  const impressionText = (report.impression || []).join("\n");
  const findingsLower = findings.toLowerCase();
  const impressionLower = impressionText.toLowerCase();

  // 1. Duplicate sentences inside Findings
  const seen = new Map<string, number>();
  for (const s of sentences(findings)) {
    const key = s.toLowerCase().replace(/\s+/g, " ");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      warnings.push(`Duplicate sentence in Findings (appears ${count}×): "${key.slice(0, 70)}${key.length > 70 ? "…" : ""}"`);
    }
  }

  // 2. Duplicate impression lines
  const impSeen = new Set<string>();
  for (const line of report.impression || []) {
    const key = line.trim().toLowerCase();
    if (!key) continue;
    if (impSeen.has(key)) warnings.push(`Duplicate impression line: "${line.trim().slice(0, 70)}"`);
    impSeen.add(key);
  }

  // 3. "Normal study" contradiction: normal phrases + pathology words together
  const saysNormal = NORMAL_PHRASES.some((p) => findingsLower.includes(p) || impressionLower.includes(p));
  if (saysNormal) {
    const pathologyHit = PATHOLOGY_WORDS.find(
      (w) => findingsLower.includes(w) || impressionLower.includes(w),
    );
    if (pathologyHit) {
      warnings.push(`Possible contradiction: report contains a "normal study" phrase AND mentions "${pathologyHit}".`);
    }
  }

  // 4. Laterality consistency: a side named in Impression must appear in Findings
  const findingsLeft = /\bleft\b/i.test(findings);
  const findingsRight = /\bright\b/i.test(findings);
  const impLeft = /\bleft\b/i.test(impressionText);
  const impRight = /\bright\b/i.test(impressionText);
  if (impLeft && !findingsLeft && findingsRight) {
    warnings.push('Laterality check: Impression says "left" but Findings only mention "right".');
  }
  if (impRight && !findingsRight && findingsLeft) {
    warnings.push('Laterality check: Impression says "right" but Findings only mention "left".');
  }

  // 5. Pathology in Findings but Impression empty
  const hasPathology = PATHOLOGY_WORDS.some((w) => findingsLower.includes(w));
  const impressionEmpty = (report.impression || []).every((l) => !l.trim());
  if (hasPathology && impressionEmpty) {
    warnings.push("Findings describe pathology but the Impression section is empty.");
  }

  // 6. Un-filled measurement placeholders left in the text
  if (findings.includes("{value}") || impressionText.includes("{value}")) {
    warnings.push("An un-filled measurement placeholder {value} is still present in the report.");
  }

  warnings.push(...medicalConsistencyWarnings(report));
  warnings.push(...repeatedWordWarnings(findings));

  return warnings;
}

function medicalConsistencyWarnings(report: TextReportInput): string[] {
  const warnings: string[] = [];
  const textFindings = report.findings || "";
  const textImpression = (report.impression || []).join("\n");
  const fullText = [report.clinicalHistory, report.technique, textFindings, textImpression, report.recommendation]
    .filter(Boolean).join(" ");
  const fullTextLower = fullText.toLowerCase();
  const studyDesc = (report.studyDescription || "").toUpperCase();

  const mentionsRight = /\bright\b/i.test(fullText);
  const mentionsLeft = /\bleft\b/i.test(fullText);
  if (studyDesc.includes("LEFT") && mentionsRight && !mentionsLeft) {
    warnings.push("Laterality contradiction: study description specifies LEFT, but the report only mentions RIGHT.");
  }
  if (studyDesc.includes("RIGHT") && mentionsLeft && !mentionsRight) {
    warnings.push("Laterality contradiction: study description specifies RIGHT, but the report only mentions LEFT.");
  }

  if (fullTextLower.includes("anterior protrusion") && fullTextLower.includes("posterior protrusion")) {
    warnings.push("Report mentions both anterior and posterior protrusions — verify the primary direction.");
  }

  const sex = (report.sex || "").toUpperCase();
  if (sex.startsWith("F") && (fullTextLower.includes("prostate") || fullTextLower.includes("seminal vesicle"))) {
    warnings.push("Gender contradiction: report for a female patient mentions male anatomy (prostate/seminal vesicle).");
  }
  if (sex.startsWith("M") && ["uterus", "ovary", "ovarian", "endometrium", "cervix", "uterine"].some((w) => fullTextLower.includes(w))) {
    warnings.push("Gender contradiction: report for a male patient mentions female anatomy (uterus/ovary/endometrium/cervix).");
  }

  const ageMatch = (report.age || "").match(/(\d+)/);
  const ageVal = ageMatch ? parseInt(ageMatch[1], 10) : null;
  if (ageVal !== null && ageVal < 18 && ["degenerative changes", "senile", "osteoarthritis"].some((w) => fullTextLower.includes(w))) {
    warnings.push(`Age-inappropriate wording: pediatric patient (${report.age}) described using adult degenerative terms.`);
  }
  if (ageVal !== null && ageVal > 18 && ["growth plates open", "physes open"].some((w) => fullTextLower.includes(w))) {
    warnings.push(`Age-inappropriate wording: adult patient (${report.age}) described with pediatric phrasing (open growth plates).`);
  }

  const modality = (report.modality || "").toUpperCase();
  const isCT = modality.startsWith("CT");
  const isMR = modality.startsWith("MR");
  if (isCT && ["magnetic resonance", "flair", "t1-weighted", "t2-weighted", "signal intensity"].some((w) => fullTextLower.includes(w))) {
    warnings.push("Modality terminology mismatch: MRI wording (FLAIR/T1/T2/signal intensity) found inside a CT report.");
  }
  if (isMR && (/\bhu\b/.test(fullTextLower) || ["hounsfield", "computed tomography", "radiation dose"].some((w) => fullTextLower.includes(w)))) {
    warnings.push("Modality terminology mismatch: CT wording (HU/Hounsfield/computed tomography) found inside an MRI report.");
  }
  if ((isCT || isMR) && ["hyperechoic", "anechoic", "acoustic shadowing", "transducer"].some((w) => fullTextLower.includes(w))) {
    warnings.push("Modality terminology mismatch: ultrasound wording (hyperechoic/acoustic shadowing) found inside a cross-sectional report.");
  }

  const isNonContrastStudy = studyDesc.includes("WITHOUT CONTRAST") || studyDesc.includes("NCCT") || studyDesc.includes("NON-CONTRAST");
  const isContrastStudy = !isNonContrastStudy &&
    (studyDesc.includes("CONTRAST") || studyDesc.includes("CECT") || studyDesc.includes("CEMRI"));
  if (isNonContrastStudy && ["gadolinium", "contrast enhancement", "post-contrast"].some((w) => fullTextLower.includes(w))) {
    warnings.push("Contrast contradiction: a non-contrast study mentions contrast enhancement or gadolinium.");
  }
  if (isContrastStudy && ["no contrast was administered", "non-contrast study"].some((w) => fullTextLower.includes(w))) {
    warnings.push("Contrast contradiction: a contrast study mentions that no contrast was administered.");
  }

  const findingsLower = textFindings.toLowerCase();
  const impressionLower2 = textImpression.toLowerCase();
  const hasNormalFindings = ["no abnormality", "within normal limits", "unremarkable"].some((w) => findingsLower.includes(w));
  const hasAbnormalImpression =
    ["acute infarct", "fracture", "hemorrhage", "stenosis", "lesion", "metastasis"].some((w) => impressionLower2.includes(w)) ||
    /\bmass\b/.test(impressionLower2);
  if (hasNormalFindings && hasAbnormalImpression) {
    warnings.push("Findings/Impression contradiction: Findings show a normal/unremarkable status, but Impression lists an abnormal diagnosis.");
  }
  const hasAbnormalFindings = ["herniation", "fracture", "hemorrhage", "lesion", "infarct", "stenosis"].some((w) => findingsLower.includes(w));
  const hasNormalImpression = ["no significant abnormality", "normal study", "unremarkable exam"].some((w) => impressionLower2.includes(w));
  if (hasAbnormalFindings && hasNormalImpression) {
    warnings.push("Findings/Impression contradiction: Findings mention abnormalities, but Impression describes the study as normal/unremarkable.");
  }

  return warnings;
}

function repeatedWordWarnings(findings: string): string[] {
  const words = findings.split(/\s+/);
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (/[.!?]$/.test(words[i])) continue;
    const w1 = words[i].toLowerCase().replace(/[^a-z]/g, "");
    const w2 = words[i + 1].toLowerCase().replace(/[^a-z]/g, "");
    if (w1 && w1 === w2 && w1.length > 2 && !seen.has(w1)) {
      warnings.push(`Repeated word "${words[i]}" in Findings — likely a dictation artifact.`);
      seen.add(w1);
    }
  }
  return warnings;
}

export interface TextQualityScore {
  score: number; // 0-100
  issues: string[];
}

/** Verbatim port of reportValidator.computeQualityScore — exact score + issues. */
export function computeTextQualityScore(input: TextReportInput): TextQualityScore {
  const issues: string[] = [];
  let score = 100;

  const deduct = (points: number, reason: string) => {
    score -= points;
    issues.push(reason);
  };

  if (!(input.findings || "").trim()) deduct(30, "Findings section is empty.");
  if ((input.impression || []).every((l) => !l.trim())) deduct(25, "Impression section is empty.");
  if (!(input.technique || "").trim()) deduct(10, "Technique not documented.");
  if (!(input.clinicalHistory || "").trim()) deduct(5, "Clinical history not documented.");
  if (!(input.recommendation || "").trim()) deduct(5, "No recommendation/advice given.");

  const warnings = validateReportText(input);
  for (const w of warnings) deduct(5, w);

  if (input.checklistPercent !== undefined && input.checklistPercent < 100) {
    deduct(10, `Protocol checklist incomplete (${input.checklistPercent}% addressed).`);
  }
  if (input.missingRequiredMeasurements?.length) {
    deduct(5, `Missing required measurement(s): ${input.missingRequiredMeasurements.join(", ")}.`);
  }

  return { score: Math.max(0, score), issues };
}
