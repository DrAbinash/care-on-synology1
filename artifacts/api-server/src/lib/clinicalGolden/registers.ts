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
 * defect — which is how the cervical cord-compression case stayed on this list
 * long after its contradiction rules were written: the rules were shouting at the
 * correct report, so a broken one made no new sound.
 */
export const UNDETECTED_DEFECTS: Record<string, UndetectedEntry> = {
  // ── unsupported contrast ──
  "brain-normal.unsupported-contrast": {
    class: "unsupportedContrast",
    harm: "A plain MRI reports enhancement the patient never received.",
    mechanism:
      "CONTRAST_GIVEN_RE (reportComposer/validateOutput.ts:1082) matches 'post-contrast', 'contrast-enhanced' and 'gadolinium', but not the phrase 'contrast enhancement'. Q112 (lib/report-quality/src/text/evaluate.ts) arms only when the StudyDescription reads WITHOUT CONTRAST / NCCT / NON-CONTRAST — and this clinic's own naming is '(PLAIN)'.",
  },
  "ct-brain-normal.unsupported-contrast": {
    class: "unsupportedContrast",
    harm: "A plain head CT reports enhancement.",
    mechanism: "The two causes above apply unchanged: '(PLAIN)' is not a Q112 trigger and 'contrast enhancement' is not in CONTRAST_GIVEN_RE.",
  },
  "usg-normal.unsupported-contrast": {
    class: "unsupportedContrast",
    harm: "An ultrasound claims an intravenous contrast bolus.",
    mechanism:
      "Not fully established. This defect is written into Technique, which is the protected field read on both sides of the contrast comparison, and an ultrasound StudyDescription carries no Q112 marker. Measured: no reaction.",
  },

  // ── invented diagnosis: the closed 26-term vocabulary ──
  "brain-normal.invented-diagnosis": {
    class: "inventedDiagnosis",
    harm: "A lesion nobody described appears in the Impression of a normal study.",
    mechanism:
      "The ungrounded-impression check reads a CLOSED list, ABNORMALITY_HINTS (validateOutput.ts:1050-1082, 26 entries). 'meningioma' is not one of them.",
  },
  "cervical-abnormal.invented-diagnosis": {
    class: "inventedDiagnosis",
    harm: "An infection nobody described triggers antibiotics and a contrast study.",
    mechanism: "Same closed list: 'spondylodiscitis' is a PATHOLOGY_WORDS term in the text tier but not an ABNORMALITY_HINTS term, so the composer never sees it.",
  },
  "mrcp-normal.invented-diagnosis": {
    class: "inventedDiagnosis",
    harm: "A pancreatic mass nobody saw routes the patient to a Whipple.",
    mechanism: "'mass' is matched by Q113's separate regex but is absent from ABNORMALITY_HINTS.",
  },
  "ct-appendicitis.invented-diagnosis": {
    class: "inventedDiagnosis",
    harm: "Spread nobody described converts a keyhole appendicectomy into a laparotomy.",
    mechanism: "'peritonitis' is not an ABNORMALITY_HINTS entry.",
  },
  "usg-abnormal.invented-diagnosis": {
    class: "inventedDiagnosis",
    harm: "A duct stone nobody saw changes the pathway to ERCP first.",
    mechanism: "Neither 'stone' nor 'calculus' is an ABNORMALITY_HINTS entry.",
  },
  "mammo-abnormal.invented-diagnosis": {
    class: "inventedDiagnosis",
    harm: "Histology asserted before any tissue has been taken.",
    mechanism: "'malignancy' and 'metastasis' are hints; named histological entities ('invasive ductal carcinoma') are not.",
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
  "cervical-normal.unsupported-normal-finding": {
    class: "unsupportedNormalFinding",
    harm: "A segment that was never imaged is reported as normal.",
    mechanism: "Same preserving-kind restriction.",
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
  "cervical-abnormal.wrong-level": {
    class: "level",
    harm: "Wrong-level surgery: the Impression names a different examined disc space.",
    mechanism:
      "level_change compares output against the supplied scaffold, and Technique legitimately states the imaged range ('C3-C4 to C6-C7'), so every cervical disc space counts as supplied and a swap between two of them is invisible.",
  },
  "lumbar-abnormal.wrong-level": {
    class: "level",
    harm: "Exploring L5-S1 for an L4-L5 lesion leaves the pathology untouched.",
    mechanism: "Same cause: the examined range in Technique makes every level in it 'supplied'.",
  },
  "whole-spine.wrong-level": {
    class: "level",
    harm: "The conus level is the tethering question; moving it changes the neurosurgical decision.",
    mechanism: "Not established. Measured no reaction. Single-vertebra tokens appear to be handled differently from disc-space pairs, which is unconfirmed.",
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
  "doppler-lower-limb-dvt": [
    { signal: "warn:recommendation_not_clearly_supported", kind: "FALSE POSITIVE", why: 'Support is judged by keyword search of the supplied corpus; "Anticoagulation as per protocol" is supported by the diagnosis, not by a keyword, so a correct report is marked up.' },
  ],
};
