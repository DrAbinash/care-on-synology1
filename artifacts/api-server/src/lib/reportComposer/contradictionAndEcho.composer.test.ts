/**
 * Two Composer-validator defects, both measured rather than imagined.
 *
 * P0 — a self-contradicting draft reached READY. On the 30-call clinical matrix run against the
 * clinic's own Ollama, 15 of 60 report sections denied a finding and reported it in the same
 * section, and not one of them raised a signal anywhere in the Composer path. The measured shape
 * is the MRI brain draft below, quoted from `case A/on/r1`: "No restricted diffusion is identified
 * on DWI/ADC sequences." eleven sentences before "Restricted diffusion is noted in the right basal
 * ganglia." The cross-section contract (Q119–Q123) reads the two sections against each other and
 * was silent, because both halves are in the same section. `retireDeclaredBaselines` was silent
 * too — it removes a normal an *observation* declares superseded, and here the model contradicted
 * itself in prose with no declaration to act on.
 *
 * It is advisory, never an error, and that is a clinical decision rather than a style one: a
 * Composer error discards the draft (`jobService` fails the job and NULLs every proposed field), so
 * hard-blocking here would delete the radiologist's own observations to punish a sentence the rule
 * is only guessing about. He keeps the draft and sees the pair.
 *
 * P1 — the repetition test only caught a sentence copied *exactly*, so an Impression that repeats
 * the Findings line by line, or stops inside one mid-sentence, passed as composition. The word
 * version of this test was measured first and rejected: `ct-brain-plain.abnormal`'s Impression
 * ("Right acute subdural haematoma (12 mm) with 7 mm midline shift and subfalcine herniation.") is
 * built entirely from the Findings' own words, which is what a good conclusion looks like. Both
 * predicates shipped here are containment, not overlap — measured on 66 units of correct prose
 * (the 20 golden-corpus reports and the 46 house normal templates) with no firing, and on the two
 * injected shapes below with both caught.
 */
import { describe, expect, it } from "vitest";
import { validateComposerOutput } from "./validateOutput";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

const CASE_A_FINDINGS =
  "Brain parenchyma demonstrates normal signal intensity with preserved grey-white differentiation. "
  + "No acute infarct is identified. No intracranial hemorrhage is seen. "
  + "No restricted diffusion is identified on DWI/ADC sequences. "
  + "The ventricular system and cisternal spaces are normal in size and configuration. "
  + "No extra-axial collection is identified. No midline shift is observed. "
  + "Restricted diffusion is noted in the right basal ganglia, with corresponding hyperintensity on "
  + "DWI and hypointensity on ADC.";

function snap(opts: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "BRAIN",
    bodyPart: "HEAD",
    family: "brain",
    findings: "",
    impression: "",
    recommendation: "",
    observations: [],
    jobKindHint: "FULL_REPORT",
    ...opts,
  });
}

function draft(findings: string, impression: string) {
  return {
    findings,
    impression,
    recommendation: "",
    unresolvedQuestions: [] as string[],
    warnings: [] as string[],
  };
}

const CONTRADICTION = /Possible contradiction in the (Findings|Impression)/;
const findContradictions = (warnings: string[]) => warnings.filter((w) => CONTRADICTION.test(w));

/** The measured draft, grounded by an input that contains the same two sentences it copied. */
function caseA(opts: Partial<ComposerInputSnapshot> = {}) {
  return snap({
    findings: CASE_A_FINDINGS,
    observations: [
      { region: "parenchyma", concept: "infarct", level: null, findingsText: CASE_A_FINDINGS, ...opts },
    ],
  });
}

describe("P0 the Composer names a draft that denies and reports the same finding", () => {
  it("P0-1 the measured case A draft raises the restricted-diffusion pair it used to accept silently", () => {
    const v = validateComposerOutput(caseA(), draft(CASE_A_FINDINGS, "Restricted diffusion in the right basal ganglia."));
    const hits = findContradictions(v.warnings);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain("restricted diffusion");
    // Both halves of the pair are quoted, so the radiologist reads which two sentences disagree.
    expect(hits[0]).toContain("No restricted diffusion is identified on DWI/ADC sequences.");
    expect(hits[0]).toContain("Restricted diffusion is noted in the right basal ganglia");
  });

  it("P0-2 it is advisory: the draft survives, because an error would delete his observations", () => {
    const d = draft(CASE_A_FINDINGS, "Restricted diffusion in the right basal ganglia.");
    const v = validateComposerOutput(caseA(), d);
    expect(v.errors.filter((e) => /contradiction/i.test(e))).toEqual([]);
    expect(v.ok).toBe(true);
    // Nothing is rewritten. The warning is the only effect on the draft.
    expect(d.findings).toBe(CASE_A_FINDINGS);
  });

  it("P0-3 an all-negative normal brain stays quiet — the shape the clinic's own formats use", () => {
    const normal =
      "The brain parenchyma is normal in signal intensity. No acute infarct is identified. "
      + "No intracranial hemorrhage is seen. No restricted diffusion is identified. "
      + "No extra-axial collection is identified. No midline shift is observed.";
    const v = validateComposerOutput(
      snap({ findings: normal, observations: [{ region: "parenchyma", concept: "normal_survey", findingsText: normal }] }),
      draft(normal, "Normal MRI of the brain."),
    );
    expect(findContradictions(v.warnings)).toEqual([]);
  });

  it("P0-4 a denial on one anatomy beside an abnormality on another is not a contradiction", () => {
    const doppler =
      "No thrombus is seen in the common femoral and femoral veins. "
      + "Thrombus is seen in the right popliteal vein with non-compressibility.";
    const v = validateComposerOutput(
      snap({
        modality: "US", region: "SOFT_TISSUE", bodyPart: "EXTREMITY", family: "doppler",
        findings: doppler,
        observations: [{ region: "vein", concept: "dvt", findingsText: doppler }],
      }),
      draft(doppler, "Right popliteal deep vein thrombosis."),
    );
    expect(findContradictions(v.warnings)).toEqual([]);
  });

  it("P0-5 the same finding at two spinal levels is a different fact, not a contradiction", () => {
    const spine =
      "No disc herniation or nerve root compression is seen at L3-L4. "
      + "There is a disc extrusion at L4-L5 indenting the thecal sac.";
    const v = validateComposerOutput(
      snap({
        modality: "MR", region: "LS_SPINE", bodyPart: "SPINE_LUMBAR", family: "spine", spineSegment: "lumbar",
        findings: spine,
        observations: [{ region: "disc", concept: "disc_extrusion", level: "L4-L5", findingsText: spine }],
      }),
      draft(spine, "Disc extrusion at L4-L5."),
    );
    expect(findContradictions(v.warnings)).toEqual([]);
  });

  it("P0-6 one section produces one warning per finding, not one per sentence pair", () => {
    const v = validateComposerOutput(caseA(), draft(CASE_A_FINDINGS, "Restricted diffusion in the right basal ganglia."));
    expect(findContradictions(v.warnings).length).toBe(1);
  });

  it("P0-7 an Impression that contradicts itself is named as the Impression's, not the Findings'", () => {
    const impression =
      "No acute intracranial hemorrhage is seen. There is a small right acute subdural hemorrhage with mass effect.";
    const v = validateComposerOutput(
      snap({
        findings: "Multifocal white matter hyperintensities.",
        observations: [{ region: "parenchyma", concept: "wmh", findingsText: "Multifocal white matter hyperintensities." }],
      }),
      draft("Multifocal white matter hyperintensities.", impression),
    );
    const hits = findContradictions(v.warnings);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain("in the Impression");
  });
});

describe("P1 the repetition test sees a restated sentence, not only an exact copy", () => {
  const BRAIN_FINDINGS =
    "The ventricles are normal in size and configuration. "
    + "There is a small acute infarct in the left middle cerebral artery territory with local mass effect.";

  function brainDraft(impression: string) {
    return snap({
      findings: BRAIN_FINDINGS,
      observations: [{ region: "parenchyma", concept: "infarct", findingsText: BRAIN_FINDINGS }],
    });
  }

  it("P1-1 an Impression truncated out of a Findings sentence is named", () => {
    const v = validateComposerOutput(
      brainDraft(""),
      draft(BRAIN_FINDINGS, "There is a small acute infarct in the left middle cerebral artery"),
    );
    expect(v.warnings.some((w) => w.includes("stops inside a Findings sentence"))).toBe(true);
  });

  it("P1-2 an Impression that copies the Findings line by line is named", () => {
    const v = validateComposerOutput(
      brainDraft(""),
      draft(BRAIN_FINDINGS, `${BRAIN_FINDINGS.split(". ")[0]}. There is a small acute infarct in the left middle cerebral artery territory with local mass effect.`),
    );
    expect(v.warnings.some((w) => /repeats the Findings line by line \(2 lines\)/.test(w))).toBe(true);
  });

  it("P1-3 a distilled conclusion made of the Findings' own words is not an echo", () => {
    // The corpus's best Impression, quoted from ct-brain-plain.abnormal. A word-overlap test fires
    // on it; containment does not, and this is the line a future "smart" rewrite must not cross.
    const findings =
      "Right acute subdural haematoma measuring 12 mm with 7 mm midline shift and subfalcine herniation.";
    const v = validateComposerOutput(
      snap({ findings, observations: [{ region: "extra-axial", concept: "sdh", findingsText: findings }] }),
      draft(findings, "Right acute subdural haematoma (12 mm) with 7 mm midline shift and subfalcine herniation."),
    );
    expect(v.warnings.some((w) => /repeats the Findings|stops inside a Findings|repeated a sentence/.test(w))).toBe(false);
  });

  it("P1-4 the verbatim duplicate test the change sits next to still fires", () => {
    const v = validateComposerOutput(
      brainDraft(""),
      draft(BRAIN_FINDINGS, "The ventricles are normal in size and configuration."),
    );
    expect(v.warnings.some((w) => w.startsWith("AI repeated a sentence verbatim"))).toBe(true);
    expect(v.warnings.some((w) => /repeats the Findings line by line/.test(w))).toBe(false);
  });

  it("P1-5 both echo warnings are advisory and leave the Impression intact", () => {
    const impression = "There is a small acute infarct in the left middle cerebral artery";
    const d = draft(BRAIN_FINDINGS, impression);
    const v = validateComposerOutput(brainDraft(""), d);
    expect(v.errors.filter((e) => /repeat|echo|redundan/i.test(e))).toEqual([]);
    expect(v.ok).toBe(true);
    // The clinically relevant sentence stays in the draft — the panel flags it, it does not cut it.
    expect(d.impression).toBe(impression);
  });

  it("P1-6 an OBSERVATIONS answer with empty prose raises neither warning", () => {
    const v = validateComposerOutput(
      snap({
        jobKindHint: "OBSERVATIONS",
        observations: [{ region: "parenchyma", concept: "infarct", findingsText: "Left MCA infarct" }],
      }),
      draft("", ""),
    );
    expect(v.warnings.some((w) => /repeats the Findings|stops inside a Findings/.test(w))).toBe(false);
  });
});
