/**
 * reportValidator.ts — rule-based pre-finalize checks for radiology reports.
 *
 * WARN ONLY. The validator returns human-readable warnings shown to the
 * radiologist before finalize; it never blocks and never auto-corrects.
 * Rules are deliberately conservative (few false positives beat many).
 *
 * Pure, dependency-free, unit-tested (reportValidator.test.ts).
 */

export interface ReportForValidation {
  findings: string;
  impression: string[]; // one line per impression point
  recommendation?: string;
  // Cockpit→Workspace merge (F2/F8): optional context for the medical-
  // consistency checks below. Every check that reads one of these fields is a
  // no-op when it's absent, so existing callers are unaffected.
  technique?: string;
  clinicalHistory?: string;
  sex?: string | null;
  age?: string | null;
  modality?: string | null;
  studyDescription?: string | null;
}

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

export function validateReport(report: ReportForValidation): string[] {
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

  // 6b. Pathology merge contradictions (same validator — not a new AI service)
  warnings.push(...pathologyMergeContradictionWarnings(findings, impressionText));

  // 6. Un-filled measurement placeholders left in the text
  if (findings.includes("{value}") || impressionText.includes("{value}")) {
    warnings.push("An un-filled measurement placeholder {value} is still present in the report.");
  }

  warnings.push(...medicalConsistencyWarnings(report));
  warnings.push(...repeatedWordWarnings(findings));

  return warnings;
}

function extractSeverity(text: string): string | null {
  const m = text.match(/\b(mild|moderate|severe)\b/i);
  return m ? m[1]!.toLowerCase() : null;
}

function extractSpinalLevel(text: string): string | null {
  const m = text.match(/\b([LCST]\d{1,2}[-–][LCST]\d{1,2})\b/i);
  return m ? m[1]!.toUpperCase().replace("–", "-") : null;
}

function sharesAnatomyContext(a: string, b: string): boolean {
  const terms = ["stenosis", "disc", "herniation", "bulge", "protrusion", "canal", "foraminal"];
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  return terms.some((t) => al.includes(t) && bl.includes(t));
}

function pathologyMergeContradictionWarnings(findings: string, impression: string): string[] {
  const warnings: string[] = [];
  const hay = `${findings}\n${impression}`;

  const basalNormal =
    /basal ganglia[^\n.]{0,80}\b(normal|unremarkable)/i.test(hay)
    || /\b(normal|unremarkable)\b[^\n.]{0,80}basal ganglia/i.test(hay);
  const basalBleed = /basal ganglia[^\n.]{0,100}\b(ha?emorrhage|hematoma)\b/i.test(hay)
    || /\b(ha?emorrhage|hematoma)\b[^\n.]{0,100}basal ganglia/i.test(hay);
  if (basalNormal && basalBleed) {
    warnings.push("Possible contradiction: basal ganglia described as normal and as hemorrhage after merge.");
  }

  const noRestricted = /\bno restricted diffusion\b/i.test(hay)
    || /\bno evidence of restricted diffusion\b/i.test(hay);
  if (noRestricted && /\bacute (?:[a-z]+\s+){0,3}infarct\b/i.test(hay)) {
    warnings.push("Possible contradiction: \"no restricted diffusion\" coexists with acute infarct wording.");
  }

  const noIchFindings = /\bno (?:acute )?(?:intracranial )?(?:ha?emorrhage|ich)\b/i.test(findings)
    || /\bno evidence of (?:acute )?(?:intracranial )?(?:ha?emorrhage|ich)\b/i.test(findings);
  const ichImpression = /\b(ha?emorrhage|hematoma|ich)\b/i.test(impression)
    && !/\bno (?:acute )?(?:intracranial )?(?:ha?emorrhage|ich)\b/i.test(impression);
  if (noIchFindings && ichImpression) {
    warnings.push("Possible contradiction: Findings deny intracranial hemorrhage but Impression mentions hemorrhage.");
  }

  const normalImpression = /\b(normal (?:mri|ct|study)|no acute abnormality|unremarkable study)\b/i.test(impression);
  const pathologyFindings = PATHOLOGY_WORDS.some((w) => findings.toLowerCase().includes(w));
  if (normalImpression && pathologyFindings) {
    warnings.push("Possible contradiction: Impression reads normal but Findings describe significant pathology.");
  }

  const fSev = extractSeverity(findings);
  const iSev = extractSeverity(impression);
  if (fSev && iSev && fSev !== iSev && sharesAnatomyContext(findings, impression)) {
    warnings.push(`Possible severity mismatch: Findings say "${fSev}" but Impression says "${iSev}".`);
  }

  const fLevel = extractSpinalLevel(findings);
  const iLevel = extractSpinalLevel(impression);
  if (fLevel && iLevel && fLevel !== iLevel && sharesAnatomyContext(findings, impression)) {
    warnings.push(`Possible level mismatch: Findings mention ${fLevel} but Impression mentions ${iLevel}.`);
  }

  const fLeft = /\bleft\b/i.test(findings);
  const fRight = /\bright\b/i.test(findings);
  const iLeft = /\bleft\b/i.test(impression);
  const iRight = /\bright\b/i.test(impression);
  if (fLeft && !fRight && iRight && !iLeft) {
    warnings.push('Laterality check: Findings say "left" but Impression says "right".');
  }
  if (fRight && !fLeft && iLeft && !iRight) {
    warnings.push('Laterality check: Findings say "right" but Impression says "left".');
  }

  return warnings;
}

// ── Medical consistency (Cockpit→Workspace merge, F2) ───────────────────────
// Ported from the Cockpit's Inspector engine, adapted where the port
// exposed a real gap. Checks that key on sex/age/modality/studyDescription
// are no-ops when that field is absent; the text-only checks (anterior/
// posterior mismatch, findings-vs-impression contradiction) run whenever
// there's report text, same as the file's other pre-existing rules.

function medicalConsistencyWarnings(report: ReportForValidation): string[] {
  const warnings: string[] = [];
  const textFindings = report.findings || "";
  const textImpression = (report.impression || []).join("\n");
  const fullText = [report.clinicalHistory, report.technique, textFindings, textImpression, report.recommendation]
    .filter(Boolean).join(" ");
  const fullTextLower = fullText.toLowerCase();
  const studyDesc = (report.studyDescription || "").toUpperCase();

  // Laterality vs. study description. Word-boundary matched — plain
  // .includes("right")/.includes("left") false-positives on ordinary words
  // that contain those letters as a substring ("bright" signal on MRI,
  // "cleft" lip/palate on pediatric studies).
  const mentionsRight = /\bright\b/i.test(fullText);
  const mentionsLeft = /\bleft\b/i.test(fullText);
  if (studyDesc.includes("LEFT") && mentionsRight && !mentionsLeft) {
    warnings.push("Laterality contradiction: study description specifies LEFT, but the report only mentions RIGHT.");
  }
  if (studyDesc.includes("RIGHT") && mentionsLeft && !mentionsRight) {
    warnings.push("Laterality contradiction: study description specifies RIGHT, but the report only mentions LEFT.");
  }

  // NOTE: a per-structure "both left and right mentioned" check was
  // considered and deliberately dropped — for any paired organ (kidneys,
  // lungs, breasts...) documenting BOTH sides is the normal, correct way to
  // write a bilateral study, so this fired on nearly every routine report
  // and violated this file's own "few false positives beat many" design
  // goal. Genuine copy-paste laterality errors are still caught by the
  // study-description check above.

  // Anterior/posterior mismatch (common in spine reports)
  if (fullTextLower.includes("anterior protrusion") && fullTextLower.includes("posterior protrusion")) {
    warnings.push("Report mentions both anterior and posterior protrusions — verify the primary direction.");
  }

  // Gender vs. anatomy contradiction. `sex` arrives as the raw patients.gender
  // value ("female"/"male"/"other"), NOT the single-letter DICOM code — a
  // strict `=== "F"`/`=== "M"` check never matches a real patient and this
  // whole rule was silently dead. startsWith covers both "F"/"FEMALE" and
  // "M"/"MALE" (any caller passing a plain DICOM letter still matches too).
  const sex = (report.sex || "").toUpperCase();
  if (sex.startsWith("F") && (fullTextLower.includes("prostate") || fullTextLower.includes("seminal vesicle"))) {
    warnings.push("Gender contradiction: report for a female patient mentions male anatomy (prostate/seminal vesicle).");
  }
  if (sex.startsWith("M") && ["uterus", "ovary", "ovarian", "endometrium", "cervix", "uterine"].some((w) => fullTextLower.includes(w))) {
    warnings.push("Gender contradiction: report for a male patient mentions female anatomy (uterus/ovary/endometrium/cervix).");
  }

  // Age-inappropriate wording
  const ageMatch = (report.age || "").match(/(\d+)/);
  const ageVal = ageMatch ? parseInt(ageMatch[1], 10) : null;
  if (ageVal !== null && ageVal < 18 && ["degenerative changes", "senile", "osteoarthritis"].some((w) => fullTextLower.includes(w))) {
    warnings.push(`Age-inappropriate wording: pediatric patient (${report.age}) described using adult degenerative terms.`);
  }
  if (ageVal !== null && ageVal > 18 && ["growth plates open", "physes open"].some((w) => fullTextLower.includes(w))) {
    warnings.push(`Age-inappropriate wording: adult patient (${report.age}) described with pediatric phrasing (open growth plates).`);
  }

  // Cross-modality terminology contamination. `modality` arrives as the raw
  // DICOM/PACS code — this codebase's convention is "MR", not "MRI" (see the
  // queue modality filter a few hundred lines up in RadiologyReportingWorkspace.tsx,
  // and radiologyMeasurementLibrary.ts/radiologyMasterTemplates.ts) — an
  // exact `=== "MRI"` check never matches a real MR study and silently never
  // fires. startsWith("MR") covers both "MR" and "MRI".
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

  // Contrast contradiction. isNonContrastStudy must be checked FIRST and
  // isContrastStudy excludes it — "WITHOUT CONTRAST"/"NON-CONTRAST" both
  // contain the substring "CONTRAST", so a naive independent check made
  // every routine non-contrast study (the most common study type) match
  // BOTH conditions at once, firing a false contradiction warning whenever
  // the technique correctly stated no contrast was given.
  const isNonContrastStudy = studyDesc.includes("WITHOUT CONTRAST") || studyDesc.includes("NCCT") || studyDesc.includes("NON-CONTRAST");
  const isContrastStudy = !isNonContrastStudy &&
    (studyDesc.includes("CONTRAST") || studyDesc.includes("CECT") || studyDesc.includes("CEMRI"));
  if (isNonContrastStudy && ["gadolinium", "contrast enhancement", "post-contrast"].some((w) => fullTextLower.includes(w))) {
    warnings.push("Contrast contradiction: a non-contrast study mentions contrast enhancement or gadolinium.");
  }
  if (isContrastStudy && ["no contrast was administered", "non-contrast study"].some((w) => fullTextLower.includes(w))) {
    warnings.push("Contrast contradiction: a contrast study mentions that no contrast was administered.");
  }

  // Findings vs. Impression contradiction, both directions
  const findingsLower = textFindings.toLowerCase();
  const impressionLower2 = textImpression.toLowerCase();
  const hasNormalFindings = ["no abnormality", "within normal limits", "unremarkable"].some((w) => findingsLower.includes(w));
  // "mass" checked as a whole word — a plain substring match also fires on
  // ordinary normal phrasing like "normal muscle mass and bulk".
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

// ── Dictation quality (Cockpit→Workspace merge, F8) ─────────────────────────
// Catches a common voice-dictation artifact: an accidentally repeated word
// ("the the liver"). Pure client-side heuristic, no API dependency.

function repeatedWordWarnings(findings: string): string[] {
  const words = findings.split(/\s+/);
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    // A sentence boundary between the pair (e.g. "...appears normal. Normal
    // spleen...") isn't a dictation artifact — skip when the first word ends
    // a sentence, in its ORIGINAL form before punctuation is stripped below.
    if (/[.!?]$/.test(words[i])) continue;
    const w1 = words[i].toLowerCase().replace(/[^a-z]/g, "");
    const w2 = words[i + 1].toLowerCase().replace(/[^a-z]/g, "");
    if (w1 && w1 === w2 && w1.length > 2 && !seen.has(w1)) {
      warnings.push(`Repeated word "${words[i]}" in Findings — likely a dictation artifact.`);
      seen.add(w1); // one warning per distinct repeated word, not per occurrence
    }
  }
  return warnings;
}

// ── Report Quality Score (Phase 3) ───────────────────────────────────────────
// Live, warn-only completeness + consistency score shown in the workspace
// header. 100 = complete & consistent. Deductions are deliberately simple
// and explainable — each item in `issues` says exactly what to fix.

export interface QualityInput extends ReportForValidation {
  technique?: string;
  clinicalHistory?: string;
  /** Phase 5: protocol checklist completeness (0-100), if a protocol is active. */
  checklistPercent?: number;
  /** Phase 5: required measurement labels not yet present in the text. */
  missingRequiredMeasurements?: string[];
}

export interface QualityScore {
  score: number; // 0-100
  issues: string[];
}

export function computeQualityScore(input: QualityInput): QualityScore {
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

  // Consistency warnings from the validator each cost 5 points.
  const warnings = validateReport(input);
  for (const w of warnings) deduct(5, w);

  // Phase 5: protocol checklist + required measurements — warn only,
  // never blocks finalize (enforced by the caller, not this function).
  if (input.checklistPercent !== undefined && input.checklistPercent < 100) {
    deduct(10, `Protocol checklist incomplete (${input.checklistPercent}% addressed).`);
  }
  if (input.missingRequiredMeasurements?.length) {
    deduct(5, `Missing required measurement(s): ${input.missingRequiredMeasurements.join(", ")}.`);
  }

  return { score: Math.max(0, score), issues };
}
