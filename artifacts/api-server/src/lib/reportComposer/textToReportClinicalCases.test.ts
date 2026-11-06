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
import { omittedTemplateAnatomy, validateComposerOutput } from "./validateOutput";
import { contradictedProvisionalNormals } from "./baselineRetirement";
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

  // COMPLETENESS (discovered, pinned, now shipped). The brief asks for the remaining
  // normal anatomy to stay in the report, and the browser leg measured what happens when
  // it does not: a draft carrying only the dictated abnormalities reached the radiologist
  // with `errors: []` and 11 of the 16 required anatomy stems absent — parenchyma,
  // thalami, brainstem, cerebellum, haemorrhage, midline, sellar, flow voids, orbits,
  // sinuses, mastoids (`t2r-testf-evidence.log` checks F6 and F16, identical in 2 of 2
  // runs). `invented_normal_finding` catches a normal ADDED for anatomy the study never
  // discussed; `omittedTemplateAnatomy` is the missing comparison the other way round —
  // the scaffold the study SUPPLIED against the anatomy the draft KEPT — so an
  // eighteen-sentence report and a three-sentence one no longer validate the same way.
  // Pinned on anatomy none of the other rules writes about, and advisory: a report is
  // never withheld for restructuring its prose.
  it("names the normal anatomy a draft discarded", () => {
    const dropped = ["brainstem", "cerebellum", "sellar", "mastoid", "orbital"];
    const scaffoldText = MRI_BRAIN_NORMALS.filter(([concept]) => dropped.includes(concept)).map(
      ([, text]) => text,
    );
    const caseA = CLINICAL_CASES.find((c) => c.id === "A")!;
    const incomplete = caseA.ideal.findings
      .split(/(?<=[.!?])\s+/)
      .filter((s) => !scaffoldText.some((t) => s.trim() === t.trim()))
      .join(" ");
    const v = validateComposerOutput(
      parseComposerSnapshot(caseA.study),
      draft({ findings: incomplete, impression: caseA.ideal.impression, recommendation: caseA.ideal.recommendation }),
      { kind: "FULL_REPORT" },
    );
    for (const concept of dropped) {
      expect(incomplete, `the fixture must actually lose ${concept}`)
        .not.toContain(MRI_BRAIN_NORMALS.find(([c]) => c === concept)![1]);
    }
    const warning = v.warnings.find((w) => w.includes("Normal anatomy this examination supplied"));
    expect(warning, JSON.stringify(v.warnings)).toBeDefined();
    for (const concept of dropped) {
      expect(warning, "every discarded anatomy is named, not one of them")
        .toContain(concept.replace("_", " "));
    }
    // Contradicted is not omitted, and this is the half that proves it. The study's own
    // dictation affirms restricted diffusion with an ADC correlate, so the scaffold's
    // "No restricted diffusion is seen on DWI/ADC." was retired on the radiologist's words,
    // not lost. Naming it here would tell him to go and write a normal he deliberately
    // removed — the two blockers interacting, so the pair is asserted in one place.
    expect(warning, "a normal the report replaced is not reported as a normal it dropped")
      .not.toContain("diffusion");
    // Advisory by design: the completeness gap is told, never withheld.
    expect(v.errors).toEqual([]);
  });

  it("does not alarm on a report that keeps the examination's anatomy", () => {
    // The control the alarm class needs. A draft that rewords an anatomy is not missing it
    // ("Ventricular system is normal" reported as "The ventricles … are prominent"), and a
    // normal study reported in full must reach the radiologist with no completeness line at
    // all — the same failure mode `unresolvedBaselineContradictions` refuses (G4-15).
    const caseC = CLINICAL_CASES.find((c) => c.id === "C")!;
    const v = validateComposerOutput(parseComposerSnapshot(caseC.study), caseC.ideal, { kind: "FULL_REPORT" });
    expect(
      v.warnings.filter((w) => w.includes("Normal anatomy this examination supplied")),
      JSON.stringify(v.warnings),
    ).toEqual([]);
  });

  it("reads a reworded anatomy as the same anatomy, not as a deleted one", () => {
    // The alarm class this guard creates, measured. The scaffold writes the adjectives —
    // "Ventricular system …", "Cerebellar hemispheres …" — and a report in prose says the
    // nouns: "The ventricles …", "the cerebellum …". Comparing the two word-for-word calls
    // a reported structure an omitted one, and a guard that cries wolf on every second
    // report is a guard the radiologist learns to ignore. So the stem decides, and the
    // pair below pins both halves: reworded is not missing, absent IS missing.
    const snapshot = parseComposerSnapshot(
      brainStudy([["course", "Left-sided weakness improved at review."]]),
    );
    const reworded = draft({
      findings:
        "The ventricles are normal in size and configuration, and the cerebellum is normal in " +
        "morphology and signal intensity.",
      impression: "No acute intracranial abnormality.",
    });
    const absent = draft({
      findings: "The basal ganglia are normal in signal intensity.",
      impression: "No acute intracranial abnormality.",
    });
    expect(omittedTemplateAnatomy(snapshot, reworded), "a stem match is the anatomy present")
      .not.toContain("ventricles");
    expect(omittedTemplateAnatomy(snapshot, reworded), "a stem match is the anatomy present")
      .not.toContain("cerebellum");
    const dropped = omittedTemplateAnatomy(snapshot, absent);
    expect(dropped, JSON.stringify(dropped)).toContain("ventricles");
    expect(dropped, JSON.stringify(dropped)).toContain("cerebellum");

    // The other side of the same coin, and the one that set the stem length. A report of
    // "generalized cerebral volume loss" says nothing about the posterior fossa, so the
    // supplied cerebellar normal is still unreported — a stem one letter shorter matched
    // `cereb-` to "cerebral" and told the radiologist his cerebellum had been covered.
    const cerebralOnly = draft({
      findings:
        "The ventricles are normal in size and configuration, with generalized cerebral " +
        "volume loss.",
      impression: "No acute intracranial abnormality.",
    });
    const cerebralMissing = omittedTemplateAnatomy(snapshot, cerebralOnly);
    expect(cerebralMissing, JSON.stringify(cerebralMissing)).toContain("cerebellum");
    expect(cerebralMissing, "cerebral volume loss is not a cerebellar statement")
      .not.toContain("ventricles");
  });

  it("does not report a normal the radiologist replaced as a normal he lost", () => {
    // The two guards meeting, on the case where they genuinely disagree. The scaffold's
    // "No acute infarct is seen." is answered — retired on his own words — by a typed
    // infarct, and the anatomy word the completeness guard reads out of that sentence is
    // its QUALIFIER ("acute"), which a replacement sentence has no reason to repeat.
    // So without `contradictedProvisionalNormals` being excluded here, the guard tells the
    // radiologist to put back a denial he removed deliberately. Named concepts are the
    // unit under test, so the retirement is asserted first: a silent change in the
    // retirement rule must not be able to pass this test by never reaching the guard.
    const snapshot = parseComposerSnapshot(
      brainStudy([["infarct_site", "Cytotoxic oedema with an infarct in the left MCA territory."]]),
    );
    const replaced = draft({
      findings: "Cytotoxic oedema with an infarct in the left MCA territory.",
      impression: "Left MCA infarction.",
    });
    expect(
      contradictedProvisionalNormals(snapshot).map((hit) => hit.concept),
      "the premise: his sentence retires the scaffold denial",
    ).toContain("infarct");
    expect(omittedTemplateAnatomy(snapshot, replaced), "a replaced normal is not an omission")
      .not.toContain("infarct");
  });
});
