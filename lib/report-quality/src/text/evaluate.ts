// text/evaluate.ts — the SINGLE source of truth for the free-text (heuristic)
// tier. Reproduces the legacy validateReport + computeQualityScore behaviour
// (same messages, same order, same score) but emits STRUCTURED findings each
// tagged with a stable rule id from ruleCatalog.ts. The legacy-shaped wrappers in
// ./legacy.ts derive from this, so there is one generator, not two.
//
// Parity is guarded at runtime by the shadow fixtures in
// artifacts/diagnostic-erp/src/lib/reportQualityShadow.test.ts — the only guard
// that exists (there is no script that diffs this file against reportValidator.ts,
// as an earlier version of this comment claimed). The contradiction rules read
// their vocabulary from ./clinicalTerms.ts, which the legacy validator imports
// from the same place, so those rules cannot drift by construction. They still
// cannot reach the legacy `pathologyMergeContradictionWarnings` block: its seven
// checks (eight messages) have no rule id in this tier, so the canonical engine
// under-reports what the workspace shows, and anything measured with it — the
// golden corpus census included — is measured against the smaller set.

import type { TextReportInput } from "../contract";
import type { RuleId } from "../ruleCatalog";
import {
  assertedAbnormality,
  assertedContrastMention,
  assertsStudyNormal,
  assessmentCategories,
  outOfScopeSpineContent,
  studyContrastState,
  ungroundedNamedDiagnoses,
  NAMED_LESION_TERMS,
  SUSPICIOUS_TERMS,
} from "./clinicalTerms";

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

  // Q103 — "normal study" contradiction. Both sides are read through the shared
  // clinical vocabulary: a denial ("no acute haemorrhage") is not an
  // abnormality, and a scoped negative ("no significant abnormality at other
  // levels") is not a claim that the study was normal.
  const saysNormal = assertsStudyNormal(findingsText) || assertsStudyNormal(impressionText);
  if (saysNormal) {
    const pathologyHit = assertedAbnormality(findingsText) ?? assertedAbnormality(impressionText);
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
  const hasPathology = assertedAbnormality(findingsText) !== null;
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

  // Q112 — contrast contradiction. The examination's own contrast state is read
  // from the study description AND the Technique line, because this clinic's
  // worklist titles a plain study "MRI CERVICAL SPINE (PLAIN)" and puts the
  // protocol in Technique. The check used to look only at the description and only
  // for WITHOUT CONTRAST / NCCT / NON-CONTRAST, so on this clinic's naming neither
  // branch was ever true and the rule never armed — measured, not assumed.
  // Enhancement is read with the same denial logic as a fracture: "no abnormal
  // gadolinium enhancement" on a plain study is the correct sentence, and treating
  // it as a claim would mark up every normal MRI in the building.
  const contrastState = studyContrastState(report.studyDescription, report.technique);
  const clinicalAssertions = `${findingsText} ${impressionText}`;
  if (contrastState === "plain" && assertedContrastMention(clinicalAssertions)) {
    emit("Q112", "Contrast contradiction: this study was performed without contrast, but the report describes enhancement.", W);
  } else if (contrastState === "contrast"
    && (/\b(?:no|not|without)\s+contrast\s+(?:was\s+)?(?:administered|given|injected|used|required)\b/i.test(clinicalAssertions)
      || /\bnon-?contrast\s+study\b/i.test(clinicalAssertions))) {
    emit("Q112", "Contrast contradiction: contrast was administered, but the report states that no contrast was given.", W);
  }

  // Q113 / Q114 — findings vs impression contradiction (both directions). The
  // vocabularies are the shared clinical ones, so a spine-and-brain list is no
  // longer the whole of what CARE can see, both spellings count, and a denial in
  // either section stops being read as the abnormality it names.
  const hasNormalFindings = assertsStudyNormal(findingsText);
  const abnormalImpression = assertedAbnormality(impressionText);
  if (hasNormalFindings && abnormalImpression) {
    emit("Q113", "Findings/Impression contradiction: Findings show a normal/unremarkable status, but Impression lists an abnormal diagnosis.", W);
  }
  const abnormalFindings = assertedAbnormality(findingsText);
  const hasNormalImpression = assertsStudyNormal(impressionText);
  if (abnormalFindings && hasNormalImpression) {
    emit("Q114", "Findings/Impression contradiction: Findings mention abnormalities, but Impression describes the study as normal/unremarkable.", W);
  }

  // Q116 — the BI-RADS assessment contradicts the Findings it is supposed to
  // summarise. A category is the mammogram's clinical conclusion, and no other
  // rule reads it: a 4C downgraded to 2 takes a suspicious mass out of the
  // cancer pathway, and a 4 asserted over findings that name nothing suspicious
  // recalls and biopsies a negative study.
  const categories = assessmentCategories(impressionText);
  if (categories.length > 0) {
    const highest = Math.max(...categories);
    // A study called benign throughout cannot also describe a suspicious lesion.
    // A category 3 or above needs something in the Findings to be about, even
    // when the other side of the same report is correctly negative.
    if (highest <= 2 && assertedAbnormality(findingsText, SUSPICIOUS_TERMS)) {
      emit("Q116", `BI-RADS contradiction: the study is given category ${highest} but the Findings describe a suspicious lesion.`, W);
    } else if (highest >= 3 && !assertedAbnormality(findingsText, NAMED_LESION_TERMS)) {
      emit("Q116", `BI-RADS contradiction: category ${highest} is asserted but the Findings name no lesion to support it.`, W);
    }
  }

  // Q117 — a named diagnosis no other section describes. Summary wording is
  // allowed: "mild chronic small vessel ischaemic disease" over punctate
  // white-matter lesions is correct radiology, which is why this rule is limited to
  // entity names (a tumour, an infection, an infarct) and asks only whether the
  // same entity appears anywhere else in the report. An entity that appears nowhere
  // else is not a re-description of anything — and a named diagnosis moves
  // patients: antibiotics, a biopsy, a Whipple, a laparotomy. An inflammatory
  // diagnosis also counts as described when the organ it names is described,
  // because "dilated blind-ending tubular structure with periappendiceal stranding"
  // is how this clinic writes appendicitis; a neoplasm gets no such reading.
  const ungrounded = ungroundedNamedDiagnoses(
    impressionText,
    `${findingsText} ${report.technique ?? ""} ${report.clinicalHistory ?? ""}`,
  );
  if (ungrounded.length > 0) {
    emit(
      "Q117",
      `Ungrounded impression: the Impression states ${ungrounded.slice(0, 3).join(", ")}, which no other section of this report describes.`,
      W,
    );
  }

  // Q118 — spine content from outside the examined region. Levels are a spine
  // report's identity: C5-C6 and L4-L5 are different operations on different nerve
  // roots, and "the dorsal spine is normal" clears a segment nobody imaged. Neither
  // is visible to a findings-vs-impression rule, because both sections agree with
  // each other — the report simply describes an examination that did not happen.
  const outOfScope = outOfScopeSpineContent(clinicalAssertions, report.studyDescription);
  if (outOfScope.length > 0) {
    emit(
      "Q118",
      `Anatomical scope: the report describes ${outOfScope.slice(0, 3).join(", ")}, which this examination did not cover.`,
      W,
    );
  }

  // Q115 — repeated word (dictation artifact). Only a true adjacency counts:
  // "the the liver". "common femoral, femoral and popliteal veins" is the correct
  // way to enumerate a venous segment, and flagging it meant every routine lower
  // limb Doppler was marked up — which trains a reporter to click past warnings.
  const words = findingsText.split(/\s+/);
  const seenWords = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    // A sentence boundary, or any punctuation between the pair, means the repeat
    // is list wording rather than a dictation slip. Checked on the ORIGINAL
    // tokens, before punctuation is stripped below.
    if (/[.!?;:]$/.test(words[i])) continue;
    if (words[i] !== words[i].replace(/[^A-Za-z]/g, "")) continue;
    const w1 = words[i].toLowerCase().replace(/[^a-z]/g, "");
    const w2 = words[i + 1].toLowerCase().replace(/[^a-z]/g, "");
    if (w1 && w1 === w2 && w1.length > 2 && !seenWords.has(w1)) {
      emit("Q115", `Repeated word "${words[i]}" in Findings — likely a dictation artifact.`, W);
      seenWords.add(w1);
    }
  }
}
