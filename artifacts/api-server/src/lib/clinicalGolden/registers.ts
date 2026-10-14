/**
 * What CARE's clinical validation actually does with the golden corpus, measured
 * rather than assumed.
 *
 * Both tables were produced by running the repository's own engines over the
 * corpus (see clinicalGolden.test.ts), not by reading the rule list. Every entry
 * is ratcheted in BOTH directions: if a gate starts catching a registered gap the
 * test fails and the entry must be deleted, and if a declared piece of noise stops
 * firing the test fails too. This is a defect register with an expiry date, not an
 * excuse list — nothing here is presented as intended behaviour.
 */

export type UndetectedEntry = {
  class: string;
  harm: string;
  /** Stated only where it was verified in origin/main source. Otherwise it says so. */
  mechanism: string;
};

/**
 * Defects that produced NO new signal from any gate once introduced into an
 * otherwise correct report — CARE cannot see these today.
 *
 * Detection is measured as a delta against the same case's correct report, so a
 * rule that already fires on correct text cannot be credited with catching a
 * defect. That is exactly how the cervical cord-compression contradiction hid
 * for as long as it did: Q103 and Q114 were already shouting at the CORRECT
 * report, so breaking it made no new sound. Both entries left this list when the
 * scoped-negative reading fixed the noise and the delta appeared with it.
 *
 * SCOPE OF THIS LIST — what the CANONICAL ENGINE cannot see: `runQualityEngine`
 * plus the structured, measurement and composer gates. That is the set the server
 * runs (the finalize quality evaluation, the persisted findings, the AI safety
 * path), so it is the set the clinic can be held to.
 *
 * It was not always the set the workstation printed. Until 2026-10-14 the live
 * `reportValidator.ts` carried five Findings-vs-Impression checks as prose regexes
 * in a function of its own, with no rule id, so a warning a radiologist could see
 * on screen was never recorded, never persisted and never counted here. Measured
 * across all 92 corpus inputs (20 correct reports + 72 defects), 84 agreed
 * message for message and 8 diverged, every divergence a warning only the
 * workstation emitted — 6 findings-vs-impression laterality and 2 spinal level.
 * Those checks now live in lib/report-quality/src/text/findingsImpression.ts as
 * Q119-Q123, called by both paths rather than copied into either, and the same
 * measurement reads 92 agree / 0 diverge / 0 score mismatches. An entry below is
 * therefore "nobody can see this", not "the API cannot see it while the screen
 * can" — which was the difference between a wrong-level surgery going unnoticed
 * and going unnoticed only by the record of it.
 */
export const UNDETECTED_DEFECTS: Record<string, UndetectedEntry> = {
  // ── unsupported contrast ──
  // Q112 used to be inert on every study this clinic reports: it read the study
  // description only, and only for "WITHOUT CONTRAST" / "NCCT" / "NON-CONTRAST",
  // while this clinic titles a plain study "(PLAIN)" and puts the protocol in
  // Technique. It now reads both fields, and the opposite direction is live —
  // ct-abdomen-normal.contradiction-no-contrast is measured as rule:Q112. These
  // four still produce no engine signal for one shared reason: each claim is
  // written as a denial ("No abnormal gadolinium enhancement is seen"), and the
  // negation reading that stops "no acute haemorrhage" reading as a haemorrhage
  // declines it too. The two of them the corpus does catch are caught by the
  // composer's contrast_status_changed, which matches "gadolinium" and
  // "post-contrast" with no negation reading at all — so the same sentence is a
  // hard error on the AI path and invisible on the typed path.
  "brain-normal.unsupported-contrast": {
    class: "unsupportedContrast",
    harm: "A plain MRI reports enhancement the patient never received.",
    mechanism:
      "The claim is a denial — 'No abnormal contrast enhancement is seen.' — so assertedContrastMention() returns null. Clinically 'no ABNORMAL enhancement' presupposes enhancement was assessable, so contrast was given; whether a denial may ever carry that presupposition is a negation-scope policy decision, not a vocabulary gap.",
  },
  "ct-brain-normal.unsupported-contrast": {
    class: "unsupportedContrast",
    harm: "A plain head CT reports enhancement.",
    mechanism:
      "Same denial shape as brain-normal.unsupported-contrast ('No abnormal contrast enhancement.') on a '(PLAIN)' CT head title, which Q112 now does read.",
  },
  "usg-normal.unsupported-contrast": {
    class: "unsupportedContrast",
    harm: "An ultrasound claims an intravenous contrast bolus.",
    mechanism:
      "Written into Technique, which Q112 deliberately does not treat as a clinical assertion — a protocol line describes the acquisition. The ultrasound StudyDescription carries no contrast marker either way, so studyContrastState() returns 'unknown' and there is nothing to contradict. Measured: no reaction.",
  },

  // ── invented diagnosis: the closed 26-term vocabulary ──
  // Four of this class left the register when Q117 replaced the composer's closed
  // ABNORMALITY_HINTS list with the shared named-diagnosis table: a meningioma, a
  // spondylodiscitis, a peritonitis and an invasive ductal carcinoma in the
  // Impression now each produce a signal the server records. A fifth left when
  // Q119 read the two sections against each other instead of against a vocabulary:
  // an invented "Common bile duct stone with obstructive dilatation" contradicts
  // the same report's "common bile duct … without dilatation", and seeing that
  // needs no term list at all. What is left is the shape that cannot be named
  // without also naming an ordinary finding.
  "mrcp-normal.invented-diagnosis": {
    class: "inventedDiagnosis",
    harm: "A pancreatic mass nobody saw routes the patient to a Whipple.",
    mechanism: "'mass' is matched by Q113's separate regex but is absent from ABNORMALITY_HINTS.",
  },

  // ── unsupported normal findings ──
  "brain-normal.unsupported-normal-finding": {
    class: "unsupportedNormalFinding",
    harm: "An unexamined structure declared normal closes a question nobody answered.",
    mechanism:
      "inventedNormals lives in ClinicalRelationLosses, which validateComposerOutput runs ONLY for preserving job kinds (validateOutput.ts:1903-1917, isPreservingComposeKind). The drafting path that Generate uses has no invented-normal check.",
  },
  "ct-brain-normal.unsupported-normal-finding": {
    class: "unsupportedNormalFinding",
    harm: "Neck vessels cleared by a head CT.",
    mechanism: "Same preserving-kind restriction as brain-normal.unsupported-normal-finding.",
  },
  "doppler-dvt.unsupported-normal-finding": {
    class: "unsupportedNormalFinding",
    harm: "A negative stated about a segment the report itself says was not assessed.",
    mechanism: "Same preserving-kind restriction — and no gate holds the examined-segment list against the Impression.",
  },

  // ── unsupported screening claims ──
  "doppler-normal.unsupported-screening-claim": {
    class: "unsupportedScreeningClaim",
    harm: "Unexamined calf veins declared patent — the classic miss of an isolated distal DVT.",
    mechanism:
      "No gate holds the examined-segment list against the report. Q007 reasons about required MEASUREMENTS, not required anatomical coverage. Established by absence.",
  },
  "whole-spine.unsupported-screening-claim": {
    class: "unsupportedScreeningClaim",
    harm: "A limited screening protocol presented as a full diagnostic examination.",
    mechanism:
      "screening_wording_may_be_missing (validateOutput.ts:1929-1943) arms from DRAFT FINDINGS matching 'multiplanar multisequence … whole spine' or 'whole spine MRI'. Deleting the limitation sentence from Technique is not such a claim, so the guard never arms.",
  },
  "whole-spine-lesion.unsupported-screening-claim": {
    class: "unsupportedScreeningClaim",
    harm: "The whole spine cleared for metastasis on a limited screen.",
    mechanism: "'metastatic' does not match the ABNORMALITY_HINTS entry 'metastasis' (suffix differs), and the screening guard reads Findings only, never the Impression.",
  },

  // ── wrong level ──
  // Two of the three left this register when Q120 paired the levels by finding
  // rather than reading one level from each section: a cervical C5-C6 herniation
  // summarised as C6-C7, and a lumbar L4-L5 extrusion summarised as L5-S1, are now
  // both recorded by the server and printed by the workstation in the same words.
  "whole-spine.wrong-level": {
    class: "level",
    harm: "The conus level is the tethering question; moving it changes the neurosurgical decision.",
    mechanism:
      "The defect moves a level INSIDE the Findings ('the conus at the L1 level' becomes L4) and the Impression names no level at all — it says 'no focal vertebral lesion or cord abnormality on this limited screening study'. Q120 is a Findings-vs-Impression comparison and needs a level on both sides for one finding, so there is nothing for it to pair. What would see this is a check that the conus sits at a plausible level in the first place, which is a clinical-knowledge rule rather than a consistency one.",
  },

  // ── findings/impression contradiction ──
  // This class no longer appears below: the shared clinical vocabulary in
  // lib/report-quality/src/text/clinicalTerms.ts (negation, both spellings,
  // study-level versus scoped normal claims) plus Q116 now react to every
  // contradiction the corpus injects. The entries left with it when they stopped
  // being gaps — that is what the ratchet in the test is for.

  // ── measurements ──
  "whole-spine.invented-measurement": {
    class: "measurement",
    harm: "A Cobb angle nobody measured decides whether a child is braced.",
    mechanism:
      "Q007 and measurement_mutation both reason from measurements that EXIST. Nothing checks that a number appearing in the text was ever supplied, so an invented value is invisible by construction.",
  },
  "mrcp-stone.measurement-altered": {
    class: "measurement",
    harm: "The duct diameter decides obstruction versus normal variation.",
    mechanism:
      "The composer's alteration guard applies only when the scaffold holds exactly ONE measurement token ('if (inputMeasurements.size === 1)', validateOutput.ts:322). This report carries two (9 mm and 14 mm), so changing one is unchecked.",
  },
  "ct-brain-subdural.measurement-altered": {
    class: "measurement",
    harm: "Shift and thickness are the operative thresholds.",
    mechanism: "Same single-measurement restriction as mrcp-stone.measurement-altered.",
  },

  // ── laterality ──
  "mammo-abnormal.wrong-side": {
    class: "laterality",
    harm: "Biopsy of the wrong breast.",
    mechanism:
      "Q104 fires only when Findings mention exactly one side and the Impression the other. A diagnostic mammogram that correctly reports both breasts names both sides, so flipping the lesion's side changes nothing the rule can see.",
  },
};

export type CleanSignal = {
  signal: string;
  kind: "FALSE POSITIVE" | "JUSTIFIED" | "BY DESIGN";
  why: string;
};

/**
 * Everything the gates say about a CLINICALLY CORRECT report, case by case.
 *
 * This is the noise floor: the signals staff see on text that has nothing wrong
 * with it. A validation layer that cries wolf on correct reports trains the
 * clinic to click through — which is how a real blocker gets missed. The false
 * positives declared below are therefore as much of this register as the gaps
 * are, and each one is ratcheted in the same way: when it stops firing the test
 * says so and the entry has to go.
 * JUSTIFIED means the rule is right (the value really is abnormal); BY DESIGN
 * means documented product behaviour, not a defect.
 */
export const CLEAN_REPORT_NOISE: Record<string, CleanSignal[]> = {
  "mri-brain-normal": [
    { signal: "warn:filler_recommendation_cleared", kind: "BY DESIGN", why: "The composer clears a boilerplate 'Clinical correlation.' recommendation. Product behaviour, recorded so it is not mistaken for a defect." },
  ],
  "mri-brain-infarct": [
    { signal: "vector:lateralitySwaps, warn:AI may have swapped laterality (advisory): left→right", kind: "FALSE POSITIVE", why: "A right hemispheric infarct with left-sided weakness is the correct contralateral picture. The check reads the clinical history as a competing side, so every hemispheric lesion with contralateral symptoms is marked up." },
  ],
  "mri-cervical-normal": [
    { signal: "warn:filler_recommendation_cleared", kind: "BY DESIGN", why: "As above." },
  ],
  "mri-cervical-cord-compression": [
    { signal: "rule:care.measurement.range.canal-ap", kind: "JUSTIFIED", why: "An 8 mm canal is genuinely below the 10 mm threshold, so the range rule is right about this report." },
  ],
  "mri-lumbar-normal": [
    { signal: "warn:filler_recommendation_cleared", kind: "BY DESIGN", why: "As above." },
  ],
  "mri-lumbar-herniation": [
    { signal: "rule:care.measurement.range.canal-ap", kind: "JUSTIFIED", why: "An 8 mm canal is genuinely below the 10 mm threshold." },
  ],
  "mrcp-normal": [
    { signal: "warn:filler_recommendation_cleared", kind: "BY DESIGN", why: "As above." },
  ],
  "mrcp-cbd-stone": [
    { signal: "blocker:care.measurement.range.cbd", kind: "JUSTIFIED", why: "A 14 mm common bile duct is dilated. This is the case where a blocker on a correct report is the correct outcome." },
  ],
  "ct-brain-normal": [
    { signal: "error:measurement_mutation", kind: "FALSE POSITIVE", why: 'The unique-measurement guard counts the slice thickness in Technique ("axial 5 mm slices") as the report\'s only measurement and then demands it in the draft — and Technique is a protected field the composer never echoes. A HARD composer error on a correct report.' },
    { signal: "warn:AI may have dropped measurements (advisory): 5mm, warn:Unique supplied measurement '5mm' was dropped or changed.", kind: "FALSE POSITIVE", why: "The two advisory lines that accompany that error. Same cause: a Technique numeral treated as a report measurement." },
    { signal: "warn:filler_recommendation_cleared", kind: "BY DESIGN", why: "As above." },
  ],
  "ct-brain-subdural": [
    { signal: "blocker:care.measurement.range.midline-shift", kind: "JUSTIFIED", why: "7 mm of shift is abnormal." },
    { signal: "vector:lateralitySwaps, warn:AI may have swapped laterality (advisory): left→right", kind: "FALSE POSITIVE", why: "Contralateral symptoms again: left hemiparesis with a right-sided collection." },
    { signal: "warn:AI may have dropped measurements (advisory): 5mm", kind: "FALSE POSITIVE", why: "The Technique slice thickness counted as a report measurement, as in ct-brain-normal." },
  ],
  "ct-abdomen-normal": [
    { signal: "warn:filler_recommendation_cleared", kind: "BY DESIGN", why: "As above." },
  ],
  "ct-abdomen-appendicitis": [
    { signal: "rule:care.measurement.range.appendix-diameter", kind: "JUSTIFIED", why: "An 11 mm appendix is abnormal." },
  ],
  "usg-abdomen-normal": [
    { signal: "warn:filler_recommendation_cleared", kind: "BY DESIGN", why: "As above." },
  ],
};
