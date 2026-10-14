/**
 * reportValidator.ts — rule-based pre-finalize checks for radiology reports.
 *
 * WARN ONLY. The validator returns human-readable warnings shown to the
 * radiologist before finalize; it never blocks and never auto-corrects.
 * Rules are deliberately conservative (few false positives beat many).
 *
 * Pure, unit-tested through its consumers (reportQualityShadow, smartReporting,
 * wholeReportPathology, section5Impression, impressionRecommendationWiring,
 * phase3, phase5). Every check here that reads clinical prose reads it through
 * `@workspace/report-quality`: the vocabulary and negation table from
 * `clinicalTerms`, and the six Findings↔Impression contradictions from
 * `findingsImpression`. Five of those used to be prose regexes of this file's own,
 * which meant the canonical text tier could not see them at all — the server
 * recorded nothing for a wrong spinal level the badge was printing. The sixth, the
 * laterality check, was the opposite fault: this file and the tier each carried a
 * byte-identical copy, agreed only by a parity test rather than by sharing the
 * code. Both faults are the same defect — a reading that can drift is a reading
 * that will. The checks still written inline below are the ones that still can.
 */

import {
  assertedAbnormality,
  assertedContrastMention,
  assertsStudyNormal,
  assessmentCategories,
  findingsImpressionContradictions,
  lateralityContradictions,
  outOfScopeSpineContent,
  studyContrastState,
  ungroundedNamedDiagnoses,
  NAMED_LESION_TERMS,
  SUSPICIOUS_TERMS,
} from "@workspace/report-quality";

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

export function validateReport(report: ReportForValidation): string[] {
  const warnings: string[] = [];
  const findings = report.findings || "";
  const impressionText = (report.impression || []).join("\n");

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

  // 3. "Normal study" contradiction: a whole-study normal claim alongside an
  //    asserted abnormality. Both are read through the shared clinical
  //    vocabulary, so "no acute haemorrhage" is a denial rather than a
  //    haemorrhage, and "no significant abnormality at other levels" is a scoped
  //    negative rather than a normal study.
  const saysNormal = assertsStudyNormal(findings) || assertsStudyNormal(impressionText);
  if (saysNormal) {
    const pathologyHit = assertedAbnormality(findings) ?? assertedAbnormality(impressionText);
    if (pathologyHit) {
      warnings.push(`Possible contradiction: report contains a "normal study" phrase AND mentions "${pathologyHit}".`);
    }
  }

  // 4. Laterality consistency: a side named in Impression must appear in Findings.
  //    Called rather than copied — the canonical text tier used to carry its own
  //    byte-identical version of these four regexes, which is how the Impression
  //    dependency came to ask two modules whether the same two sections agreed.
  for (const c of lateralityContradictions(findings, impressionText)) {
    warnings.push(c.message);
  }

  // 5. Pathology in Findings but Impression empty
  const hasPathology = assertedAbnormality(findings) !== null;
  const impressionEmpty = (report.impression || []).every((l) => !l.trim());
  if (hasPathology && impressionEmpty) {
    warnings.push("Findings describe pathology but the Impression section is empty.");
  }

  // 6b. Findings↔Impression contradictions. The same contract the canonical text
  //     tier evaluates, called rather than copied: these five checks used to live
  //     here as prose regexes with no rule id, so the server never recorded them and
  //     the golden-corpus census measured a smaller set than the radiologist saw.
  for (const c of findingsImpressionContradictions(findings, impressionText)) {
    warnings.push(c.message);
  }

  // 6. Un-filled measurement placeholders left in the text
  if (findings.includes("{value}") || impressionText.includes("{value}")) {
    warnings.push("An un-filled measurement placeholder {value} is still present in the report.");
  }

  warnings.push(...medicalConsistencyWarnings(report));
  warnings.push(...repeatedWordWarnings(findings));

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

  // Contrast contradiction, read the canonical way. The old version looked only at
  // the study description and only for "WITHOUT CONTRAST" / "NCCT" /
  // "NON-CONTRAST", so this clinic's own naming — "MRI CERVICAL SPINE (PLAIN)",
  // with the protocol in Technique — armed neither branch and the rule never
  // fired. It also matched "contrast enhancement" as a substring anywhere in the
  // report, so "no abnormal gadolinium enhancement" — the correct sentence on a
  // plain study — was read as a claim that contrast had been given. Both halves
  // now come from the shared vocabulary: the study's contrast state from the
  // description AND the Technique line, and the enhancement claim read with the
  // same negation logic that decides whether a described "fracture" is present.
  const clinicalAssertions = `${textFindings} ${textImpression}`;
  const contrastState = studyContrastState(report.studyDescription, report.technique);
  if (contrastState === "plain" && assertedContrastMention(clinicalAssertions)) {
    warnings.push("Contrast contradiction: this study was performed without contrast, but the report describes enhancement.");
  } else if (contrastState === "contrast"
    && (/\b(?:no|not|without)\s+contrast\s+(?:was\s+)?(?:administered|given|injected|used|required)\b/i.test(clinicalAssertions)
      || /\bnon-?contrast\s+study\b/i.test(clinicalAssertions))) {
    warnings.push("Contrast contradiction: contrast was administered, but the report states that no contrast was given.");
  }

  // Findings vs. Impression contradiction, both directions. Shared vocabulary:
  // the old spine-and-brain word lists meant a gallstone, a duct calculus, a
  // thrombus or an appendicitis could be described in Findings and cleared in the
  // Impression without either rule noticing, and "haemorrhage" — this clinic's
  // spelling — was invisible to a rule that only knew "hemorrhage".
  const abnormalImpression = assertedAbnormality(textImpression);
  if (assertsStudyNormal(textFindings) && abnormalImpression) {
    warnings.push("Findings/Impression contradiction: Findings show a normal/unremarkable status, but Impression lists an abnormal diagnosis.");
  }
  const abnormalFindings = assertedAbnormality(textFindings);
  if (abnormalFindings && assertsStudyNormal(textImpression)) {
    warnings.push("Findings/Impression contradiction: Findings mention abnormalities, but Impression describes the study as normal/unremarkable.");
  }

  // BI-RADS assessment vs the Findings it is supposed to summarise. The category
  // is the mammogram's clinical conclusion and nothing else read it: a 4C
  // downgraded to 2 leaves a suspicious mass outside the cancer pathway, and a 4
  // asserted over findings that name nothing suspicious recalls and biopsies a
  // negative study.
  const categories = assessmentCategories(textImpression);
  if (categories.length > 0) {
    const highest = Math.max(...categories);
    // A study called benign throughout cannot also describe a suspicious lesion.
    // A category 3 or above needs something in the Findings to be about, even
    // when the other side of the same report is correctly negative.
    if (highest <= 2 && assertedAbnormality(textFindings, SUSPICIOUS_TERMS)) {
      warnings.push(`BI-RADS contradiction: the study is given category ${highest} but the Findings describe a suspicious lesion.`);
    } else if (highest >= 3 && !assertedAbnormality(textFindings, NAMED_LESION_TERMS)) {
      warnings.push(`BI-RADS contradiction: category ${highest} is asserted but the Findings name no lesion to support it.`);
    }
  }

  // A named diagnosis the rest of the report never describes. An Impression is
  // allowed to re-describe — "mild chronic small vessel ischaemic disease" over
  // punctate white-matter lesions is correct radiology — so only entity names are
  // asked about, and an inflammatory diagnosis counts as described when the organ
  // it names is. A diagnosis nobody supplied still reaches the referrer as fact,
  // and it moves patients: antibiotics, a biopsy, a laparotomy.
  const ungrounded = ungroundedNamedDiagnoses(
    textImpression,
    `${textFindings} ${report.technique ?? ""} ${report.clinicalHistory ?? ""}`,
  );
  if (ungrounded.length > 0) {
    warnings.push(`Ungrounded impression: the Impression states ${ungrounded.slice(0, 3).join(", ")}, which no other section of this report describes.`);
  }

  // Spine content from outside the examined region. C5-C6 and L4-L5 are different
  // operations on different nerve roots, and "the dorsal spine is normal" clears a
  // segment nobody imaged. Neither is visible to a findings-vs-impression rule,
  // because both halves of the report agree with each other — it simply describes
  // an examination that did not happen.
  const outOfScope = outOfScopeSpineContent(clinicalAssertions, report.studyDescription);
  if (outOfScope.length > 0) {
    warnings.push(`Anatomical scope: the report describes ${outOfScope.slice(0, 3).join(", ")}, which this examination did not cover.`);
  }

  return warnings;
}

// ── Dictation quality (Cockpit→Workspace merge, F8) ─────────────────────────
// Catches a common voice-dictation artifact: an accidentally repeated word
// ("the the liver"). Only a true adjacency counts — "common femoral, femoral and
// popliteal veins" is the correct way to enumerate a venous segment, and the old
// punctuation-blind check marked up every routine lower limb Doppler.

function repeatedWordWarnings(findings: string): string[] {
  const words = findings.split(/\s+/);
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    // A sentence boundary or any other punctuation between the pair means the
    // repeat is list wording, not a dictation slip. Checked on the ORIGINAL form
    // of the token, before punctuation is stripped below.
    if (/[.!?;:]$/.test(words[i])) continue;
    if (words[i] !== words[i].replace(/[^A-Za-z]/g, "")) continue;
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
