/**
 * One precedence for "was contrast given", and a disagreement that says so.
 *
 * `studyContrastState` used to join every field it was handed into one string and run
 * three patterns over the join. That has two consequences, and both were wrong in
 * opposite directions:
 *
 *  * whichever pattern matched first answered for the whole study, and the study's own
 *    fields were never compared. "MRI BRAIN (PLAIN)" beside a Technique line reading
 *    "Post-contrast T1 sequences." was called PLAIN — the denial ran before the
 *    affirmation — with nothing recorded that the two fields had disagreed.
 *  * the Quick Select gate kept its own copy of the same question and tested its
 *    affirmation first, so the identical study was called `given` on the wall that
 *    decides whether an enhancement box is offered. One patient, two answers, neither
 *    chosen on purpose (see `quickSelectContrastConflict.test.ts` for that half).
 *
 * Every field is therefore read on its own now and the readings are combined, so a
 * study whose sources positively disagree reports `conflict`. The tests below pin the
 * three properties that makes safe:
 *
 *  1. a field alone is read exactly as it always was, so today's plain studies stay
 *     plain and today's enhanced ones stay enhanced;
 *  2. silence is not a side of an argument — one field describing the study and the
 *     other saying nothing yields the description, not a conflict. This is what keeps
 *     the change from marking up the corpus;
 *  3. two fields that positively disagree yield `conflict`, in either order, and Q112
 *     then says the record contradicts itself instead of asserting a contrast state
 *     it cannot know.
 *
 * Every case is synthetic. None of it is a patient.
 */
import { describe, expect, it } from "vitest";
import { evaluateTextTier } from "./evaluate";
import {
  contrastConflictSentence,
  contrastStateOfField,
  contrastStateOfReadings,
  studyContrastState,
  studyContrastVerdict,
} from "./clinicalTerms";

const ENHANCED_TECHNIQUE = "Post-contrast T1 sequences obtained after intravenous gadolinium.";
const PLAIN_TECHNIQUE = "Multiplanar multisequence MRI performed without intravenous contrast.";

describe("one field, read on its own", () => {
  it("keeps this clinic's naming for a plain study", () => {
    expect(contrastStateOfField("MRI CERVICAL SPINE (PLAIN)")).toBe("plain");
    expect(contrastStateOfField("CT HEAD, NON-CONTRAST")).toBe("plain");
    expect(contrastStateOfField("NCCT HEAD")).toBe("plain");
    // The abbreviated form the Quick Select gate has always recognised. It is in the
    // shared vocabulary now because the gate reads this one, and dropping a word the
    // gate knew would silently widen what it withholds.
    expect(contrastStateOfField("NCT HEAD")).toBe("plain");
    expect(contrastStateOfField("MRI brain performed without intravenous contrast.")).toBe("plain");
  });

  it("keeps this clinic's naming for an enhanced study", () => {
    expect(contrastStateOfField("MRI BRAIN WITH CONTRAST")).toBe("contrast");
    expect(contrastStateOfField("CT ABDOMEN AND PELVIS (WITH CONTRAST)")).toBe("contrast");
    // CE-MRI is how this clinic titles a contrast MRI in its own format library
    // (`reportTitle: "CE-MRI BRAIN"`). The shared pattern used to know only the closed
    // spelling "CEMRI", which no worklist writes.
    expect(contrastStateOfField("CE-MRI BRAIN")).toBe("contrast");
    expect(contrastStateOfField("Contrast was administered. Post-contrast sequences obtained.")).toBe("contrast");
    expect(contrastStateOfField(ENHANCED_TECHNIQUE)).toBe("contrast");
  });

  it("calls a two-phase study BOTH, which is how 'contrast was given' is written here", () => {
    expect(contrastStateOfField("MRI BRAIN WITH AND WITHOUT CONTRAST")).toBe("both");
    expect(contrastStateOfField("Pre- and post-contrast sequences.")).toBe("both");
  });

  it("leaves a study nobody described unknown, and a denial wins over an affirmation in one field", () => {
    expect(contrastStateOfField("MRI BRAIN")).toBe("unknown");
    expect(contrastStateOfField("")).toBe("unknown");
    expect(contrastStateOfField(null)).toBe("unknown");
    expect(contrastStateOfField(undefined)).toBe("unknown");
    // The documented single-field rule, unchanged: "plain, no contrast" is one
    // statement, and the last two words of it decide.
    expect(contrastStateOfField("CT HEAD (PLAIN), NO CONTRAST")).toBe("plain");
  });
});

describe("combining the fields without picking a winner", () => {
  it("agreement and silence both answer the way the join did", () => {
    expect(studyContrastState("MRI BRAIN (PLAIN)", PLAIN_TECHNIQUE)).toBe("plain");
    expect(studyContrastState("MRI BRAIN (PLAIN)", "Multiplanar T1, T2, FLAIR.")).toBe("plain");
    // One field silent is not a disagreement. This is the case that decides how much
    // of the corpus the change touches: today's data is mostly this, and it must not move.
    expect(studyContrastState("MRI BRAIN", PLAIN_TECHNIQUE)).toBe("plain");
    expect(studyContrastState("CT ABDOMEN AND PELVIS (WITH CONTRAST)", "CT abdomen with intravenous contrast.")).toBe("contrast");
    expect(studyContrastState("MRI BRAIN", "Multiplanar T1, T2, FLAIR.")).toBe("unknown");
    expect(studyContrastState()).toBe("unknown");
    expect(studyContrastState(null, undefined, "")).toBe("unknown");
  });

  it("reports a conflict when the sources positively disagree, in either order", () => {
    expect(studyContrastState("MRI BRAIN (PLAIN)", ENHANCED_TECHNIQUE)).toBe("conflict");
    // Order-independence is the property the concatenation could not have: the join
    // answered whichever rule ran first, so the same study was plain or enhanced
    // depending on the precedence table rather than on the record.
    expect(studyContrastState(ENHANCED_TECHNIQUE, "MRI BRAIN (PLAIN)")).toBe("conflict");
    expect(studyContrastState("CT HEAD (WITH CONTRAST)", "Non-contrast images were also acquired.")).toBe("conflict");
  });

  it("lets a two-phase field settle a disagreement, because contrast was in fact given", () => {
    // An "MRI BRAIN (PLAIN)" title beside a protocol written "with and without
    // contrast" is a naming slip in one field, not an unknowable study: the patient
    // received contrast, which is what the two-phase wording asserts. Calling this a
    // conflict would withhold enhancement boxes from every two-phase MRI in the clinic.
    expect(studyContrastState("MRI BRAIN (PLAIN)", "MRI brain with and without contrast.")).toBe("contrast");
    expect(studyContrastVerdict([
      { label: "the examination name", text: "MRI BRAIN (PLAIN)" },
      { label: "the protocol", text: "Brain, pre- and post-contrast" },
    ]).state).toBe("contrast");
  });

  it("combines more than two sources", () => {
    expect(contrastStateOfReadings(["plain", "unknown", "contrast"])).toBe("conflict");
    expect(contrastStateOfReadings(["unknown", "unknown"])).toBe("unknown");
    expect(contrastStateOfReadings([])).toBe("unknown");
    expect(contrastStateOfReadings(["both"])).toBe("contrast");
  });
});

describe("the disagreement in the operator's words", () => {
  it("names which source denied and which affirmed", () => {
    const verdict = studyContrastVerdict([
      { label: "the examination name", text: "MRI BRAIN (PLAIN)" },
      { label: "the Technique line", text: ENHANCED_TECHNIQUE },
    ]);
    expect(contrastConflictSentence(verdict.readings))
      .toBe("the examination name says no contrast while the Technique line says contrast was given");
  });

  it("names both affirming sources, and none when nothing disagrees", () => {
    const three = studyContrastVerdict([
      { label: "the examination name", text: "MRI BRAIN (PLAIN)" },
      { label: "the protocol", text: "MRI Brain with contrast" },
      { label: "the Technique line", text: ENHANCED_TECHNIQUE },
    ]);
    expect(contrastConflictSentence(three.readings))
      .toBe("the examination name says no contrast while the protocol and the Technique line say contrast was given");

    expect(contrastConflictSentence(studyContrastVerdict([
      { label: "the examination name", text: "MRI BRAIN (PLAIN)" },
      { label: "the Technique line", text: PLAIN_TECHNIQUE },
    ]).readings)).toBeNull();
  });

  it("quotes no study text", () => {
    // These sentences reach server-side records as well as the screen, so the label
    // is what the operator gets, not an echo of the field.
    const verdict = studyContrastVerdict([
      { label: "the examination name", text: "MRI BRAIN (PLAIN) — Ref. Dr. SYNTH" },
      { label: "the Technique line", text: ENHANCED_TECHNIQUE },
    ]);
    const sentence = contrastConflictSentence(verdict.readings) ?? "";
    expect(sentence).not.toContain("SYNTH");
    expect(sentence).not.toContain("gadolinium");
  });
});

function q112(input: Parameters<typeof evaluateTextTier>[0]) {
  return evaluateTextTier(input).findings.filter((f) => f.ruleId === "Q112").map((f) => f.message);
}

const CLAIM = {
  findings: "There is an enhancing mass in the right frontal lobe with surrounding oedema.",
  impression: ["Enhancing right frontal mass."],
};

describe("Q112 says the record contradicts itself instead of guessing", () => {
  it("still calls a plain study that describes enhancement", () => {
    const warnings = q112({
      modality: "MR",
      studyDescription: "MRI BRAIN (PLAIN)",
      technique: PLAIN_TECHNIQUE,
      ...CLAIM,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("this study was performed without contrast");
  });

  it("still calls a contrast study that denies the contrast", () => {
    const warnings = q112({
      modality: "CT",
      studyDescription: "CT ABDOMEN AND PELVIS (WITH CONTRAST)",
      technique: "CT abdomen and pelvis with intravenous contrast, portal venous phase.",
      findings: "No contrast was administered. The liver is normal.",
      impression: ["Normal CT of the abdomen and pelvis."],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("contrast was administered, but the report states that no contrast was given");
  });

  it("reports the disagreement, and does not assert a contrast state it cannot know", () => {
    const warnings = q112({
      modality: "MR",
      studyDescription: "MRI BRAIN (PLAIN)",
      technique: ENHANCED_TECHNIQUE,
      ...CLAIM,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Contrast contradiction unresolved");
    expect(warnings[0]).toContain("the examination name says no contrast");
    expect(warnings[0]).toContain("the Technique line says contrast was given");
    // The two assertions the old code could make — either verdict was a guess.
    expect(warnings[0]).not.toContain("this study was performed without contrast");
    expect(warnings[0]).not.toContain("contrast was administered, but the report");
    // The live badge filters on this word; a message without it never reaches the screen.
    expect(warnings[0]).toMatch(/contradict/i);
  });

  it("stays quiet on a conflicted study whose prose says nothing about contrast", () => {
    // The rule is about the report and the examination disagreeing. Where the report
    // makes no contrast claim, a self-contradictory worklist row is a data problem,
    // not a defect in this report, and marking it would be noise on every page of it.
    expect(q112({
      modality: "MR",
      studyDescription: "MRI BRAIN (PLAIN)",
      technique: ENHANCED_TECHNIQUE,
      findings: "A 6 mm T2 hyperintense focus in the left insular cortex.",
      impression: ["Left insular focus, non-specific."],
    })).toEqual([]);
  });

  it("carries the disagreement through the denial direction too", () => {
    const warnings = q112({
      modality: "CT",
      studyDescription: "CT HEAD (PLAIN)",
      technique: "CT head with intravenous contrast, bone windows.",
      findings: "As this was a non-contrast study, no enhancement is seen.",
      impression: ["Unremarkable CT of the head."],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Contrast contradiction unresolved");
  });
});
