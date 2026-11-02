/**
 * The owner's clinical cases A–E, replayed through CARE's SHIPPED validator.
 *
 * This is the half of the Text-to-Report acceptance battery that needs no model: the
 * corpus is built the way the reporting workspace builds it (the live normal template's
 * own sentences plus the radiologist's dictation, projected as observations), and the
 * draft is the report the brief asks for. Every verdict here comes from
 * `validateComposerOutput` — the same function the job worker runs before a draft is
 * ever offered to a radiologist — so a case that fails here would fail on the clinic's
 * own model too, and no latency is involved.
 *
 * WHY THE CORPUS IS THE POINT. A normal template loads when the examination opens, so
 * an MRI brain study that becomes a stroke report still begins as twelve sentences, two
 * of which read "No acute infarct is seen." and "No restricted diffusion is seen on
 * DWI/ADC." Those are unreviewed scaffolding (PR #1257 established the provenance); the
 * rules under test decide whether CARE can tell a scaffold's negation from a
 * radiologist's denial, whether the remaining anatomy may be reported at all, and
 * whether it may say "infarct" when the radiologist supplied the DWI/ADC evidence and
 * not the word.
 *
 * Fixture construction, patient content and the template-mirror caveat all live in
 * `testSupport/textToReportCases.ts`; the live-model half of the same battery is
 * `textToReportClinicalJobs.request.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { parseComposerSnapshot } from "./types";
import { validateComposerOutput } from "./validateOutput";
import {
  brainStudy,
  lsStudy,
  draft,
  CLINICAL_CASES,
  MRI_BRAIN_NORMALS,
} from "../../testSupport/textToReportCases";

describe("the owner's clinical cases through CARE's shipped validator", () => {
  for (const c of CLINICAL_CASES) {
    it(`${c.id} — ${c.name}: the correct report is not refused`, () => {
      const snapshot = parseComposerSnapshot(c.study);
      const v = validateComposerOutput(snapshot, c.ideal, { kind: "FULL_REPORT" });
      console.log(
        `\n[case ${c.id}] errors=${JSON.stringify(v.errors)} ungrounded=${JSON.stringify(
          v.unsupportedMentions,
        )}\n  warnings=${JSON.stringify(v.warnings)}`,
      );
      expect(v.errors).toEqual([]);
    });
  }
});

describe("the guards that must stay armed", () => {
  it("refuses an acute infarct the radiologist himself ruled out", () => {
    const snapshot = parseComposerSnapshot(
      brainStudy([["acute_change", "No acute infarct."]], { withScaffold: false }),
    );
    const v = validateComposerOutput(
      snapshot,
      draft({
        findings: "Acute infarct in the right basal ganglia.",
        impression: "Acute infarct in the right basal ganglia.",
      }),
      { kind: "FULL_REPORT" },
    );
    expect(v.errors).toContain("denied_finding_asserted");
  });

  it("names the denial when the observation's own concept is the denied term", async () => {
    // The same sentence, the same draft, the same report — only the ledger `concept`
    // differs. `reportSideCorpus` joins `concept` and `findingsText` with a space, so
    // a row concept named after the finding puts the bare word at position 0 of what
    // the denial detector reads as one sentence, and `findDeniedFindings` requires
    // `at > 0` before it will call anything a denial. Quick Select and voice rows are
    // named exactly that way (`concept: "infarct"`), so the rule the report depends on
    // is silently disarmed by the row's own identity.
    const withConcept = parseComposerSnapshot(
      brainStudy([["infarct", "No acute infarct."]], { withScaffold: false }),
    );
    const v = validateComposerOutput(
      withConcept,
      draft({
        findings: "Acute infarct in the right basal ganglia.",
        impression: "Acute infarct in the right basal ganglia.",
      }),
      { kind: "FULL_REPORT" },
    );
    expect(v.errors).toContain("denied_finding_asserted");
  });

  it("refuses a diagnosis with no supported evidence behind it", () => {
    const snapshot = parseComposerSnapshot(brainStudy([], { withScaffold: false }));
    const v = validateComposerOutput(
      snapshot,
      draft({
        findings: "Brain parenchyma is normal.",
        impression: "Acute infarct in the right basal ganglia.",
      }),
      { kind: "FULL_REPORT" },
    );
    expect(v.errors).toContain("unsupported_abnormality");
  });

  it("refuses a diagnosis built on evidence the input denied", () => {
    // Case C's shape with an invented conclusion: the scaffold says no restricted
    // diffusion, so nothing licenses an infarct.
    const snapshot = parseComposerSnapshot(brainStudy([]));
    const v = validateComposerOutput(
      snapshot,
      draft({
        findings: "No restricted diffusion is seen on DWI/ADC.",
        impression: "Acute infarct in the right basal ganglia.",
      }),
      { kind: "FULL_REPORT" },
    );
    // The refusal is `unsupported_abnormality`, not `denied_finding_asserted`: a
    // template negation is unreviewed scaffolding (PR #1257), so it cannot be the thing
    // the radiologist denied. What matters is that the draft IS stopped — before this
    // change the same draft came back READY, because "No acute infarct is seen."
    // supplied the very word the invented diagnosis needed.
    expect(v.errors).toContain("unsupported_abnormality");
    expect(v.unsupportedMentions).toContain("infarct");
  });

  it("licenses the diagnosis an Impression reaches from Findings that only describe", () => {
    // The shape the clinic's model actually produces: the Findings report the pattern
    // ("restricted diffusion … low ADC") and the Impression names the diagnosis. The
    // `impression_ungrounded` rule reads a DIFFERENT corpus than the grounding loop — it
    // counts the draft's own Findings as support — so a licence that only reached the
    // first rule would still NULL this report. Measured on the first live stroke draft,
    // which came back READY from one rule and refused by the other.
    //
    // No scaffold rows, and that is deliberate: the impression loop still reads the
    // UNstripped corpus, so `No acute infarct is seen.` would supply the word there and
    // this test would measure nothing. That leak is not a safety hole — the same draft is
    // refused by the grounding loop, which does read `authored`, and
    // "refuses a diagnosis built on evidence the input denied" above proves it.
    const dictated = "Restricted diffusion in the right basal ganglia with corresponding low ADC.";
    const snapshot = parseComposerSnapshot(
      brainStudy([["diffusion", dictated]], { withScaffold: false }),
    );
    const v = validateComposerOutput(
      snapshot,
      draft({ findings: dictated, impression: "Acute infarct in the right basal ganglia." }),
      { kind: "FULL_REPORT" },
    );
    expect(v.errors).toEqual([]);
    expect(
      v.warnings.some((w) => w.includes("mri-brain-v1 §58")),
      `the inference must be declared: ${JSON.stringify(v.warnings)}`,
    ).toBe(true);
  });

  it("refuses a canal measurement nobody entered when no canal record exists", () => {
    const snapshot = parseComposerSnapshot(
      lsStudy([["disc_contour", "L5-S1: Diffuse posterior disc bulge."]]),
    );
    const v = validateComposerOutput(
      snapshot,
      draft({
        findings: "L5-S1: Diffuse posterior disc bulge with canal AP diameter 8.2 mm.",
        impression: "L5-S1 disc bulge with canal stenosis.",
      }),
      { kind: "FULL_REPORT" },
    );
    // `canal_measurement_invented` exists but only runs against a non-empty canonical
    // record; with no measurements entered — the state the brief's case E describes —
    // a fabricated diameter currently reaches the radiologist unlabelled.
    expect(v.errors).toContain("canal_measurement_invented");
  });

  it("refuses a normal for anatomy this examination never discussed", () => {
    const snapshot = parseComposerSnapshot(
      lsStudy([["disc_contour", "L5-S1: Diffuse posterior disc bulge."]]),
    );
    const v = validateComposerOutput(
      snapshot,
      draft({
        findings: "L5-S1: Diffuse posterior disc bulge. The orbits and paranasal sinuses are normal.",
        impression: "L5-S1 disc bulge.",
      }),
      { kind: "FULL_REPORT" },
    );
    expect(v.errors).toContain("invented_normal_finding");
  });

  // COMPLETENESS (discovered, pinned). The brief asks for the remaining normal anatomy
  // to stay in the report, and the browser leg measured what happens when it does not: a
  // draft carrying only the dictated abnormalities reached the radiologist with
  // `errors: []` and 11 of the 16 required anatomy stems absent — parenchyma, thalami,
  // brainstem, cerebellum, haemorrhage, midline, sellar, flow voids, orbits, sinuses,
  // mastoids (`t2r-testf-evidence.log` checks F6 and F16, identical in 2 of 2 runs). The
  // guard above catches a normal ADDED for anatomy the study never discussed; nothing
  // compares the scaffold the study SUPPLIED against the scaffold the draft KEPT, so an
  // eighteen-sentence report and a three-sentence one validate the same way. Pinned on
  // anatomy none of the other rules writes about, so this fails for the missing
  // comparison and not for some neighbouring message.
  it.fails("names the normal anatomy a draft discarded", () => {
    const dropped = ["brainstem", "cerebellum", "sellar", "mastoid", "orbital"];
    const scaffoldText = MRI_BRAIN_NORMALS.filter(([concept]) => dropped.includes(concept)).map(
      ([, text]) => text,
    );
    const caseA = CLINICAL_CASES.find((c) => c.id === "A")!;
    const incomplete = caseA.ideal.findings
      .split(/(?<=[.!?])\s+/)
      .filter((s) => !scaffoldText.some((t) => s.trim() === t.trim()))
      .join(" ");
    expect(incomplete).not.toContain("Brainstem shows normal morphology");
    const v = validateComposerOutput(
      parseComposerSnapshot(caseA.study),
      draft({ findings: incomplete, impression: caseA.ideal.impression, recommendation: caseA.ideal.recommendation }),
      { kind: "FULL_REPORT" },
    );
    console.log(
      `\n[completeness pin] scaffoldDropped=${scaffoldText.length} findingsLen=${incomplete.length} `
      + `errors=${JSON.stringify(v.errors)} warnings=${JSON.stringify(v.warnings)}`,
    );
    const reported = [...v.errors, ...v.warnings].join(" ").toLowerCase();
    expect(dropped.some((concept) => reported.includes(concept.replace("_", " ")))).toBe(true);
  });
});
