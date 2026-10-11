/**
 * Clinical RELATIONS (owner's §2 and §3, PR #919 continuation).
 *
 * The conservation rules added in #919 count facts: is "8.2 mm" still in the
 * answer, is "left" still in the answer. Counting cannot catch the failures the
 * owner listed, because each of them keeps every token and changes the medicine:
 * a canal diameter that moves from L4-L5 to L5-S1, a "suspected infarct" that
 * becomes an infarct, a normal spinal cord for a study that never described one,
 * a 3T examination nobody scanned, contrast that was never given.
 *
 * So every case here holds the FACTS constant and breaks the RELATIONSHIP, then
 * checks the shipped validator blocks it — and every block has a positive control
 * that rewords the same study honestly and must pass. A guard that always fails
 * would be closed by the end of the week, and the owner would be right to.
 *
 * Fixtures deliberately carry the whole report in Findings, because a fact that
 * also sits in the Impression would still be "preserved" by it and the case would
 * measure nothing. The last describe block puts a fact in the Impression on
 * purpose, to prove that section is guarded too.
 *
 * All input is synthetic. No patient, no real study, no real name.
 */
import { describe, expect, it } from "vitest";
import {
  detectClinicalRelationLosses,
  detectConservationLosses,
  validateComposerOutput,
} from "./validateOutput";
import {
  parseComposerSnapshot,
  type ComposerDraftOutput,
  type ComposerInputSnapshot,
} from "./types";

/** The lumbar study CARE's own dictated templates describe, one fact per line. */
const LS_SPINE = [
  "Loss of normal lumbar lordosis.",
  "Disc desiccation at L2-L3, L3-L4 and L4-L5.",
  "Diffuse posterior disc bulge at L3-L4.",
  "Broad-based posterior disc bulge at L4-L5 with mild bilateral lateral recess narrowing.",
  "AP canal diameter 8.2 mm at L4-L5.",
  "Right paramedian disc extrusion at L5-S1 compressing the right S1 traversing root.",
  "Moderate left foraminal narrowing at L5-S1.",
  "Mild bilateral facet hypertrophy at L4-L5.",
  "Ligamentum flavum hypertrophy at L5-S1.",
  "No significant central canal stenosis at L1-L2.",
  "No spondylolisthesis.",
].join("\n");

/**
 * The same study, every sentence rewritten, no fact changed. This is the control
 * that decides whether the rules below are a guard or a blockade.
 */
const LS_REWRITTEN = [
  "The normal lumbar lordosis is lost.",
  "Desiccated discs are seen at L2-L3, L3-L4 and L4-L5.",
  "There is a diffuse posterior disc bulge at L3-L4.",
  "A broad-based posterior disc bulge is present at L4-L5, producing mild bilateral lateral recess narrowing.",
  "The AP diameter of the spinal canal measures 8.2 mm at L4-L5.",
  "A right paramedian disc extrusion is noted at L5-S1, compressing the right S1 traversing nerve root.",
  "Moderate left foraminal narrowing is seen at L5-S1.",
  "Mild bilateral facet arthropathy is present at L4-L5.",
  "Hypertrophy of the ligamentum flavum is noted at L5-S1.",
  "No significant stenosis of the central canal is seen at L1-L2.",
  "No spondylolisthesis is identified.",
].join("\n");

const CANAL_LINE = "The AP diameter of the spinal canal measures 8.2 mm at L4-L5.";
const EXTRUSION_LINE
  = "A right paramedian disc extrusion is noted at L5-S1, compressing the right S1 traversing nerve root.";

const BRAIN = [
  "Multiple punctate and confluent T2 and FLAIR hyperintensities in the periventricular and deep white matter, Fazekas grade 2.",
  "A 2.4 cm left MCA territory infarct with gyral swelling, showing DWI restriction with corresponding low ADC.",
  "No haemorrhage on SWI.",
  "A 6 mm right cerebellar lesion with no enhancement.",
  "Suspected small subdural empyema along the left frontoparietal region.",
  "Mild midline shift of 3 mm to the right.",
  "The ventricles are normal in size.",
].join("\n");

const BRAIN_REWRITTEN = [
  "Numerous punctate and confluent T2/FLAIR hyperintense foci are seen in the periventricular and deep white matter, corresponding to Fazekas grade 2 change.",
  "A 2.4 cm infarct is seen in the left MCA territory with associated gyral swelling; the lesion shows DWI restriction with corresponding low ADC values.",
  "SWI sequences demonstrate no haemorrhage.",
  "A 6 mm lesion is seen in the right cerebellum, showing no enhancement.",
  "A small subdural empyema is suspected along the left frontoparietal region.",
  "There is mild midline shift measuring 3 mm towards the right.",
  "The ventricles are normal in size.",
].join("\n");

const EMPYEMA_LINE = "A small subdural empyema is suspected along the left frontoparietal region.";

function snap(over: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    spineSegment: "LS",
    technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine at 1.5T.",
    findings: LS_SPINE,
    impression: "",
    recommendation: "",
    observations: [],
    ...over,
  });
}

const brainSnapshot = (findings = BRAIN) =>
  snap({ region: "Brain", spineSegment: undefined, findings, impression: "" });

function body(findings: string, impression = ""): ComposerDraftOutput {
  return { findings, impression, recommendation: "", unresolvedQuestions: [], warnings: [] };
}

/** Change exactly one sentence of the honest lumbar rewrite; assert it applied. */
function lsBroken(change: [string, string]): ComposerDraftOutput {
  const findings = LS_REWRITTEN.replace(change[0], change[1]);
  expect(findings, `the case did not change the text: ${change[0]}`).not.toBe(LS_REWRITTEN);
  return body(findings);
}

function brainBroken(change: [string, string]): ComposerDraftOutput {
  const findings = BRAIN_REWRITTEN.replace(change[0], change[1]);
  expect(findings, `the case did not change the text: ${change[0]}`).not.toBe(BRAIN_REWRITTEN);
  return body(findings);
}

const pro = (snapshot: ComposerInputSnapshot, draft: ComposerDraftOutput) =>
  validateComposerOutput(snapshot, draft, { kind: "PROFESSIONALIZE" });

describe("the rewrite contract does not block an honest rewrite", () => {
  it("accepts every sentence of the lumbar study reworded", () => {
    const r = pro(snap(), body(LS_REWRITTEN));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("accepts the brain study reworded, hedges and grades intact", () => {
    const r = pro(brainSnapshot(), body(BRAIN_REWRITTEN));
    expect(r.relations?.polarityFlips).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it("runs no relation rule when the caller gives no kind", () => {
    // The overnight draft path still calls the validator without a kind; the
    // guards above must not silently start blocking it.
    const moved = pro(snap(), lsBroken([CANAL_LINE, CANAL_LINE.replace("at L4-L5", "at L5-S1")]));
    const unkind = validateComposerOutput(snap(), lsBroken([CANAL_LINE, CANAL_LINE.replace("at L4-L5", "at L5-S1")]));
    expect(moved.errors).toContain("measurement_repositioned");
    expect(unkind.errors).not.toContain("measurement_repositioned");
  });
});

describe("a measurement may not change anatomical owner", () => {
  it("blocks the 8.2 mm canal diameter moving from L4-L5 to L5-S1", () => {
    const r = pro(snap(), lsBroken([CANAL_LINE, CANAL_LINE.replace("at L4-L5", "at L5-S1")]));
    expect(r.errors).toContain("measurement_repositioned");
    expect(r.relations?.repositionedMeasurements.join(" ")).toContain("8.2mm");
    expect(r.ok).toBe(false);
  });

  it("still accepts the same level written as its two vertebrae", () => {
    // "between L4 and L5" is how a radiologist spells L4-L5 when writing it out.
    // The pair shares a vertebra with its neighbour, so a flattened comparison
    // would read the honest version and the moved version identically.
    const r = pro(snap(), lsBroken([CANAL_LINE, CANAL_LINE.replace("at L4-L5", "between L4 and L5")]));
    expect(r.errors).not.toContain("measurement_repositioned");
  });

  it("blocks a measurement stated at one vertebra moving to another", () => {
    // The single-level form, which no pair-based case can reach: a dictation that
    // names one vertebra has no component pair, so a matcher that treated every
    // unmatched single as "close enough" would let L4 become L5 and report nothing.
    const source = snap({
      findings: "Disc desiccation at L4.\nAP canal diameter 8.2 mm at L4.\nNo spondylolisthesis.",
      impression: "",
    });
    const r = pro(source, body(
      "Disc desiccation is seen at L4.\nAP canal diameter 8.2 mm at L5.\nNo spondylolisthesis is identified.",
    ));
    expect(r.errors).toContain("measurement_repositioned");
  });

  it("is not demanded of a drafting kind, which may restructure prose", () => {
    const draft = validateComposerOutput(
      snap(),
      lsBroken([CANAL_LINE, CANAL_LINE.replace("at L4-L5", "at L5-S1")]),
      { kind: "FULL_REPORT" },
    );
    expect(draft.errors).not.toContain("measurement_repositioned");
  });
});

describe("right may not become left", () => {
  it("blocks the extrusion changing side", () => {
    const r = pro(snap(), lsBroken([
      EXTRUSION_LINE,
      EXTRUSION_LINE.replaceAll("right", "left"),
    ]));
    expect(r.errors).toContain("laterality_dropped");
    expect(r.ok).toBe(false);
  });

  it("blocks dropping 'bilateral' from a bilateral finding", () => {
    // A single-finding study, because conservation compares the SET of laterality
    // words: in a report where "bilateral" also appears on another line, deleting
    // it from one line is not visible to this rule at all, and pretending
    // otherwise here would pin a capability the guard does not have.
    const source = snap({
      findings: "Broad-based posterior disc bulge at L4-L5 with mild bilateral lateral recess narrowing.",
      impression: "",
    });
    const r = pro(source, body(
      "A broad-based posterior disc bulge is present at L4-L5, producing mild lateral recess narrowing.",
    ));
    expect(r.errors).toContain("laterality_dropped");
  });

  it("accepts a side that is re-stated in other words", () => {
    const r = pro(snap(), lsBroken([
      EXTRUSION_LINE,
      "A right paramedian disc extrusion at L5-S1 is noted, with compression of the traversing right S1 nerve root.",
    ]));
    expect(r.errors).not.toContain("laterality_dropped");
  });
});

describe("a suspected finding may not become a diagnosis", () => {
  it("blocks 'suspected' being dropped from a hedged abnormality", () => {
    const r = pro(brainSnapshot(), brainBroken([
      EMPYEMA_LINE,
      "A small subdural empyema is present along the left frontoparietal region.",
    ]));
    expect(r.errors).toContain("certainty_escalation");
    expect(r.relations?.lostUncertainty).toContain("empyema");
  });

  it("accepts the hedge carried by a different hedging word", () => {
    const r = pro(brainSnapshot(), brainBroken([
      EMPYEMA_LINE,
      "A small subdural empyema is likely along the left frontoparietal region, to be excluded clinically.",
    ]));
    expect(r.errors).not.toContain("certainty_escalation");
  });

  it("blocks a differential that has been resolved into a single cause", () => {
    const source = brainSnapshot("Differential includes demyelination versus small vessel disease.");
    const r = pro(source, body("Demyelination is the cause of the white matter changes."));
    expect(r.errors).toContain("certainty_escalation");
  });
});

describe("a normal finding nobody described may not be added", () => {
  it("blocks inventing a normal spinal cord", () => {
    const r = pro(snap(), body(`${LS_REWRITTEN}\nThe spinal cord is normal.`));
    expect(r.errors).toContain("invented_normal_finding");
    expect(r.relations?.inventedNormals).toContain("cord");
  });

  it("blocks inventing a normal pituitary in a spine report", () => {
    const r = pro(snap(), body(`${LS_REWRITTEN}\nThe pituitary gland is unremarkable.`));
    expect(r.errors).toContain("invented_normal_finding");
  });

  it("still accepts the negative the radiologist actually dictated", () => {
    // "No significant central canal stenosis" and "conus terminates normally" are
    // dictated text, so they are grounded. Refusing those is the failure mode that
    // made CARE's AI unusable before #919.
    const source = snap({ findings: `${LS_SPINE}\nConus terminates normally at L1.` });
    const r = pro(source, body(`${LS_REWRITTEN}\nThe conus medullaris terminates at L1 and is normal in signal.`));
    expect(r.errors).not.toContain("invented_normal_finding");
  });
});

describe("a documented abnormality may not come back as a negative", () => {
  it("blocks a disc extrusion that has been negated", () => {
    const r = pro(snap(), lsBroken([EXTRUSION_LINE, "No disc extrusion is seen at L5-S1."]));
    expect(r.errors).toContain("clinical_polarity_flip");
    expect(r.relations?.polarityFlips.join(" ")).toContain("extrusion");
  });

  it("accepts a negative that was already negative in the input", () => {
    const r = pro(snap(), lsBroken([
      "No significant stenosis of the central canal is seen at L1-L2.",
      "The central canal shows no significant stenosis at L1-L2.",
    ]));
    expect(r.errors).not.toContain("clinical_polarity_flip");
  });

  it("reports the reverse inversion once, under its existing owner", () => {
    // A denied finding coming back ASSERTED is the other half of a flipped
    // polarity, and #915 already guards it for the narrative fields — with a
    // per-sentence rule that runs for every kind, so it is the stronger of the
    // two. The relation guard used to check the same direction a second way,
    // which reached the radiologist as two faults for one inverted sentence. One
    // finding, one code.
    const r = pro(brainSnapshot(), brainBroken([
      "SWI sequences demonstrate no haemorrhage.",
      "SWI sequences demonstrate an intracranial haemorrhage.",
    ]));
    expect(r.errors).toContain("denied_finding_asserted");
    expect(r.errors).not.toContain("clinical_polarity_flip");
    expect(r.relations?.polarityFlips).toEqual([]);
  });
});

describe("the examination may not be embellished", () => {
  it("blocks inventing 3T on a study whose technique says 1.5T", () => {
    const r = pro(snap(), lsBroken([CANAL_LINE, "The study was performed at 3T. " + CANAL_LINE]));
    expect(r.errors).toContain("technique_invention");
    expect(r.relations?.inventedTechnique).toContain("3T");
  });

  it("accepts the field strength the technique actually states", () => {
    const r = pro(snap(), lsBroken([
      CANAL_LINE,
      "Multiplanar multisequence imaging at 1.5T was performed; " + CANAL_LINE,
    ]));
    expect(r.errors).not.toContain("technique_invention");
  });

  it("blocks sequences the study never had", () => {
    const r = pro(snap(), body(`${LS_REWRITTEN}\nDWI and SWI sequences were acquired.`));
    expect(r.errors).toContain("technique_invention");
  });

  it("blocks a comparison study that was not supplied", () => {
    const r = pro(snap(), body(`${LS_REWRITTEN}\nComparison with the prior CT of the lumbar spine.`));
    expect(r.errors).toContain("technique_invention");
  });

  it("blocks contrast on a non-contrast study", () => {
    const r = pro(snap(), body(`${LS_REWRITTEN}\nPost-contrast images show no abnormal enhancement.`));
    expect(r.errors).toContain("contrast_status_changed");
  });

  it("blocks a contrast study being reported as non-contrast", () => {
    const source = snap({ technique: "Multiplanar multisequence MRI of the lumbosacral spine with gadolinium." });
    const r = pro(source, body(`${LS_REWRITTEN}\nThe examination was performed without contrast.`));
    expect(r.errors).toContain("contrast_status_changed");
  });

  it("keeps technique facts the study really had", () => {
    const source = snap({
      technique:
        "Multiplanar multisequence non-contrast MRI of the lumbosacral spine at 1.5T with T2W and STIR sequences.",
    });
    const r = pro(source, body(`${LS_REWRITTEN}\n1.5T non-contrast MRI with T2W and STIR sequences.`));
    expect(r.errors).not.toContain("technique_invention");
    expect(r.errors).not.toContain("contrast_status_changed");
  });

  it("holds a drafting kind to the same rule about the examination", () => {
    const draft = validateComposerOutput(
      snap(),
      body(`${LS_REWRITTEN}\nThe study was performed at 3T.`),
      { kind: "FULL_REPORT" },
    );
    expect(draft.errors).toContain("technique_invention");
  });
});

describe("severity, morphology, location and grade are facts", () => {
  it("blocks a severity that has gone missing", () => {
    const losses = detectConservationLosses(snap(), body(
      LS_REWRITTEN
        .replace("Mild bilateral facet arthropathy", "Bilateral facet arthropathy")
        .replace("mild bilateral lateral recess narrowing", "bilateral lateral recess narrowing")
        .replace("Moderate left foraminal narrowing", "Left foraminal narrowing"),
    ));
    expect(losses.errors).toContain("severity_dropped");
    expect(losses.droppedSeverity).toEqual(expect.arrayContaining(["mild", "moderate"]));
  });

  it("blocks a broad-based bulge becoming a focal one", () => {
    const losses = detectConservationLosses(snap(), lsBroken([
      "A broad-based posterior disc bulge is present at L4-L5",
      "A focal posterior disc bulge is present at L4-L5",
    ]));
    expect(losses.errors).toContain("morphology_dropped");
    expect(losses.droppedMorphology).toContain("broad-based");
  });

  it("blocks a disc extrusion becoming a protrusion", () => {
    const losses = detectConservationLosses(snap(), lsBroken([
      EXTRUSION_LINE,
      "A right paramedian disc protrusion is noted at L5-S1, compressing the right S1 traversing nerve root.",
    ]));
    expect(losses.errors).toContain("morphology_dropped");
    expect(losses.droppedMorphology).toContain("extrusion");
  });

  it("allows facet hypertrophy to be written as facet arthropathy", () => {
    // The two words name the same degenerative joint in CARE's own templates, and
    // the honest rewrite above makes exactly that substitution. The fold is scoped
    // to the sentence naming the facet, which the next case proves.
    const losses = detectConservationLosses(snap(), body(LS_REWRITTEN));
    expect(losses.droppedMorphology).not.toContain("facet hypertrophy");
  });

  it("does not let facet hypertrophy satisfy ligamentum flavum hypertrophy", () => {
    // The word the answer keeps is exactly the one the dictation used, so this
    // cannot be caught by a membership test — only by requiring the alias to sit
    // in a sentence about the structure it belongs to. Removing that scoping from
    // `mentionsAnyClass` leaves this case green, which is why it is written this
    // way rather than by dropping "hypertrophy" from the answer altogether.
    const losses = detectConservationLosses(snap(), lsBroken([
      "Hypertrophy of the ligamentum flavum is noted at L5-S1.",
      "Facet hypertrophy is noted at L5-S1.",
    ]));
    expect(losses.errors).toContain("morphology_dropped");
    expect(losses.droppedMorphology).toContain("flavum hypertrophy");
    expect(losses.droppedMorphology).not.toContain("facet hypertrophy");
  });

  it("blocks a foraminal narrowing that has lost its foramen", () => {
    const losses = detectConservationLosses(snap(), lsBroken([
      "Moderate left foraminal narrowing is seen at L5-S1.",
      "Moderate left-sided symptoms are reported at L5-S1.",
    ]));
    expect(losses.errors).toContain("location_dropped");
    expect(losses.droppedLocations).toContain("foraminal");
  });

  it("blocks the paramedian attribution being dropped from an extrusion", () => {
    const losses = detectConservationLosses(snap(), lsBroken([
      EXTRUSION_LINE,
      EXTRUSION_LINE.replace("right paramedian", "right central"),
    ]));
    expect(losses.errors).toContain("location_dropped");
    expect(losses.droppedLocations).toContain("paramedian");
  });

  it("blocks a Fazekas grade being re-graded", () => {
    const losses = detectConservationLosses(brainSnapshot(), brainBroken([
      "corresponding to Fazekas grade 2 change",
      "corresponding to Fazekas grade 1 change",
    ]));
    expect(losses.errors).toContain("grade_changed");
    expect(losses.changedGrades.join(" ")).toContain("fazekas");
  });

  it("blocks a grade that has gone missing entirely", () => {
    const losses = detectConservationLosses(brainSnapshot(), brainBroken([
      ", corresponding to Fazekas grade 2 change",
      "",
    ]));
    expect(losses.errors).toContain("grade_changed");
  });

  it("preserves root, cord and DWI/ADC claims", () => {
    const lostDiffusion = detectConservationLosses(brainSnapshot(), brainBroken([
      "the lesion shows DWI restriction with corresponding low ADC values",
      "the lesion shows mass effect",
    ]));
    expect(lostDiffusion.droppedMorphology).toContain("DWI restriction");

    const cord = snap({
      region: "Dorsal Spine",
      spineSegment: "DL",
      findings: "Cord compression at D10 with abnormal cord signal.\nMild bilateral lateral recess narrowing.",
      impression: "",
    });
    const lostCord = detectConservationLosses(cord, body(
      "No abnormality at D10.\nMild bilateral lateral recess narrowing.",
    ));
    expect(lostCord.droppedMorphology).toEqual(
      expect.arrayContaining(["cord compression", "cord signal abnormality"]),
    );
  });
});

describe("facts carried only by the Impression are guarded too", () => {
  const source = snap({ findings: "Broad-based disc bulge at L4-L5.", impression: "Right S1 root compression by a disc extrusion at L5-S1." });

  it("blocks a laterality that disappears from the Impression", () => {
    const r = pro(source, body("Broad-based disc bulge is seen at L4-L5.", "S1 root compression by a disc extrusion at L5-S1."));
    expect(r.errors).toContain("laterality_dropped");
  });

  it("blocks a repositioned measurement that lives in the Impression", () => {
    const withCanal = snap({
      findings: "Disc bulge at L4-L5.",
      impression: "Canal AP diameter 8.2 mm at L4-L5.",
    });
    const r = pro(withCanal, body("Disc bulge is seen at L4-L5.", "Canal AP diameter 8.2 mm at L5-S1."));
    expect(r.errors).toContain("measurement_repositioned");
  });
});

describe("the structured answer carries the same obligations", () => {
  // One clause per sentence, because a measurement's anatomical owner is decided
  // inside the sentence that states it; a dictation that runs four facts together
  // in one comma-separated line names both levels in that line, and no rule can
  // honestly say which one the number belongs to.
  const DICTATION
    = "L4-5 diffuse disc bulge with bilateral LR narrowing and canal 8.2 mm. L5-S1 right paracentral extrusion compressing the right S1 root.";

  const row = (level: string, laterality: string, measurement: string, findingsText: string) => ({
    concept: "disc bulge",
    level,
    laterality,
    severity: "",
    measurement,
    findingsText,
  });

  const faithfulRows = () => [
    row(
      "L4-L5",
      "bilateral",
      "8.2 mm",
      "Diffuse disc bulge at L4-L5 with bilateral lateral recess narrowing and AP canal diameter 8.2 mm.",
    ),
    row(
      "L5-S1",
      "right",
      "",
      "Right paracentral disc extrusion at L5-S1 compressing the right S1 traversing root.",
    ),
  ];

  const asDraft = (observations: ReturnType<typeof faithfulRows>) => ({
    ...body("", ""),
    observations,
  });

  const observe = (observations: ReturnType<typeof faithfulRows>) =>
    validateComposerOutput(snap({ findings: DICTATION }), asDraft(observations) as ComposerDraftOutput, {
      kind: "OBSERVATIONS",
    });

  it("accepts a four-fact dictation carried by four faithful fields", () => {
    const r = observe(faithfulRows());
    expect(r.errors).toEqual([]);
  });

  it("blocks a row that puts the 8.2 mm canal on the L5-S1 row", () => {
    const moved = faithfulRows();
    const canal = moved[0]!;
    moved[0] = row(
      "L5-S1",
      "bilateral",
      "8.2 mm",
      canal.findingsText.replace("at L4-L5", "at L5-S1"),
    );
    const r = observe(moved);
    expect(r.errors).toContain("measurement_repositioned");
  });

  it("blocks a row that adds a normal conus the dictation never described", () => {
    // Level "L5-S1" is dictated, so the row survives grounding and reaches the
    // relation rules; a row naming the conus at a level nobody dictated would be
    // deleted by the pruner before this point, which the next case pins.
    const r = observe([
      ...faithfulRows(),
      row("L5-S1", "midline", "", "The conus medullaris is normal."),
    ]);
    expect(r.errors).toContain("invented_normal_finding");
    expect(r.relations?.inventedNormals).toContain("conus");
  });

  it("blocks a row that asserts what the dictation denied", () => {
    // The narrative-field denial rule reads Findings, Impression and
    // Recommendation — all three empty for this task, because the answer is the
    // rows. The row pruner keeps such a row on purpose (its own comment names
    // "restates a negation as a finding" as the cost), so without this wiring a
    // dictation of "No right disc extrusion at L5-S1" comes back as a proposed
    // extrusion at that level and the radiologist is asked to approve an absence
    // as a presence.
    const dictated
      = "L4-5 diffuse disc bulge with bilateral LR narrowing and canal 8.2 mm. No right disc extrusion at L5-S1.";
    const draft = asDraft([
      faithfulRows()[0]!,
      row("L5-S1", "right", "", "Right disc extrusion is present at L5-S1."),
    ]);
    const r = validateComposerOutput(snap({ findings: dictated }), draft as ComposerDraftOutput, {
      kind: "OBSERVATIONS",
    });
    expect(r.errors).toContain("denied_finding_asserted");
    expect(r.warnings.join(" ")).toContain(
      "A proposed observation asserts a finding the dictation denied",
    );
  });

  it("deletes a row whose level the dictation never named", () => {
    // The stronger guard for a structured answer: an ungrounded row is removed
    // before the radiologist is offered it, rather than blocking the whole job.
    const draft = asDraft([
      ...faithfulRows(),
      row("T12-L1", "midline", "", "Disc desiccation at T12-L1."),
    ]);
    const r = validateComposerOutput(snap({ findings: DICTATION }), draft as ComposerDraftOutput, {
      kind: "OBSERVATIONS",
    });
    expect(r.warnings.join(" ")).toContain("Observation dropped as ungrounded");
    expect(draft.observations).toHaveLength(2);
  });
});

describe("the detectors are reachable on their own", () => {
  it("returns no relation error for the honest rewrite", () => {
    // The mutation harness needs one entry point it can prove is wired: if the
    // call to `detectClinicalRelationLosses` is deleted from the validator, the
    // cases above go red, and this one is the control that says why.
    expect(detectClinicalRelationLosses(snap(), body(LS_REWRITTEN)).errors).toEqual([]);
  });
});
