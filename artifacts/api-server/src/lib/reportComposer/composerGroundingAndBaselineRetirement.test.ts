/**
 * Two measured defects, both reproductions of real jobs run against the clinic's
 * own Ollama on 2026-11-01.
 *
 * G1 — the grounding rule compared hint strings by literal substring in both
 * directions, and `ABNORMALITY_HINTS` lists "infarct" and "infarction" as two
 * separate words. A radiologist whose Quick Select row carries `concept: "infarct"`
 * is therefore grounded for "infarct" but NOT for "infarction", and the model wrote
 * "Acute infarction…". Job A failed `unsupported_abnormality` with every proposed
 * field NULL; job B, the same clinical facts with the word "infarction" typed into
 * the observation, came back READY. One word form decided whether the report existed.
 *
 * G2 — `detectLateralitySwaps` read the whole grounded corpus, which includes
 * `clinicalHistory`. A left MCA infarct with right-sided weakness is the correct
 * contralateral picture, so a faithful report was warned as a swap. This file's own
 * `ungroundedSidesInAdvice` docstring (validateOutput.ts) already records that the
 * swap test "false-fires on prose that is right — mri-brain-infarct and
 * ct-brain-subdural both already trip it on their CLEAN text"; that was fixed for the
 * advice path only, and the findings/impression call still reads the history.
 *
 * Both fixes are deliberately narrow. A clinical *equivalence* is not a spelling
 * variant: "thrombus" must not ground "thrombosis", and "aneurysm" must not ground
 * "aneurysmal", because those are the diagnoses §21 says a radiologist has to select
 * themselves. Those arms are pinned below so a future widening has to be argued for.
 */
import { describe, expect, it } from "vitest";
import { retireDeclaredBaselines } from "./baselineRetirement";
import { validateComposerOutput } from "./validateOutput";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

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

describe("G1 grounding: a controlled word-form variant of a named abnormality is not an invention", () => {
  it("G1-1 the measured job A: concept 'infarct' grounds the model's 'infarction'", () => {
    const s = snap({
      findings: "Normal MRI brain baseline.",
      clinicalHistory: "Sudden right face and arm weakness.",
      observations: [
        {
          region: "parenchyma",
          concept: "infarct",
          level: null,
          findingsText: "Restricted diffusion in the left MCA territory",
          baselineReplaces: "Normal MRI brain baseline.",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft(
        "Acute infarction with restricted diffusion is identified in the left MCA territory.",
        "Acute infarction in the left MCA territory.",
      ),
    );
    expect(v.unsupportedMentions).not.toContain("infarction");
    expect(v.errors).not.toContain("unsupported_abnormality");
  });

  it("G1-2 the plural and the reverse direction stay grounded", () => {
    const s = snap({
      observations: [
        { region: "parenchyma", concept: "infarction", findingsText: "Multiple infarctions" },
      ],
    });
    const v = validateComposerOutput(s, draft("Several small infarcts are seen.", "Infarcts."));
    expect(v.errors).not.toContain("unsupported_abnormality");
  });

  it("G1-3 CONTROL fail-closed: an abnormality named nowhere in the input still fails", () => {
    const s = snap({
      findings: "Normal MRI brain baseline.",
      observations: [
        { region: "parenchyma", concept: "atrophy", findingsText: "Mild cerebral atrophy" },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft("Mild cerebral atrophy. A middle cerebral artery occlusion is present.", "Atrophy."),
    );
    expect(v.unsupportedMentions).toContain("occlusion");
    expect(v.errors).toContain("unsupported_abnormality");
    expect(v.ok).toBe(false);
  });

  /**
   * CONTROL for the widening below: `deniedFindingAssertions` compares hints with
   * a bare `includes`, so the denial it recognises is per-spelling. Same spelling
   * in and out must still refuse — grounding is not a licence to invert a denial.
   *
   * Measured, and deliberately NOT fixed here: "No intracranial haemorrhage." →
   * "There is intracranial hemorrhage." passes this file's other two gates too
   * (`GROUNDEDNESS_SPELLINGS` grounds the variant), so a trans-atlantic spelling
   * change slips a denied bleed into the report of record. Fixing it changes
   * fail-closed behaviour, which is outside this PR's four defects.
   */
  it("G1-4 CONTROL the denial rule is untouched: a denied haemorrhage must not come back asserted", () => {
    const s = snap({
      findings: "No intracranial haemorrhage.",
      observations: [],
    });
    const v = validateComposerOutput(
      s,
      draft("There is intracranial haemorrhage.", "Haemorrhage."),
    );
    expect(v.errors).toContain("denied_finding_asserted");
  });

  it("G1-4b the spelling hole above is measured, not accidental", () => {
    const s = snap({ findings: "No intracranial haemorrhage.", observations: [] });
    const v = validateComposerOutput(s, draft("There is intracranial hemorrhage.", "Hemorrhage."));
    expect(v.errors).not.toContain("denied_finding_asserted");
    expect(v.errors).not.toContain("unsupported_abnormality");
  });

  it("G1-5 doctrine: a clinical EQUIVALENCE is not a word form — thrombus does not ground thrombosis", () => {
    const s = snap({
      observations: [
        { region: "vessel", concept: "thrombus", findingsText: "A filling defect consistent with thrombus" },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft("A filling defect consistent with thrombus. Cerebral venous thrombosis is present.", "Thrombosis."),
    );
    expect(v.unsupportedMentions).toContain("thrombosis");
    expect(v.errors).toContain("unsupported_abnormality");
  });

  it("G1-6 doctrine: 'aneurysm' does not ground 'aneurysmal', and neither grounds an unmentioned aneurysm", () => {
    const s = snap({
      observations: [
        { region: "vessel", concept: "aneurysm", findingsText: "A 3 mm aneurysm at the ICA bifurcation" },
      ],
    });
    const named = validateComposerOutput(
      s,
      draft("A 3 mm aneurysm at the ICA bifurcation.", "Aneurysm."),
    );
    expect(named.errors).not.toContain("unsupported_abnormality");

    const invented = validateComposerOutput(
      snap({ observations: [{ region: "vessel", concept: "atrophy", findingsText: "Mild atrophy" }] }),
      draft("Mild atrophy. There is aneurysmal dilatation of the MCA.", "Atrophy."),
    );
    expect(invented.unsupportedMentions).toContain("aneurysmal");
    expect(invented.errors).toContain("unsupported_abnormality");
  });
});

describe("G2 laterality: the reason for the examination is not a report laterality claim", () => {
  it("G2-1 the measured false warning: right weakness with a left MCA lesion is NOT a swap", () => {
    const s = snap({
      findings: "Normal MRI brain baseline.",
      clinicalHistory: "Sudden right face and arm weakness.",
      observations: [
        {
          region: "parenchyma",
          concept: "infarction",
          findingsText: "Acute infarction with restricted diffusion in the left MCA territory",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft(
        "Acute infarction with restricted diffusion is identified in the left MCA territory.",
        "Acute infarction in the left MCA territory.",
      ),
    );
    expect(v.lateralitySwaps).toEqual([]);
  });

  it("G2-2 CONTROL a real swap inside the report narrative still fires", () => {
    const s = snap({
      findings: "Acute infarction in the right MCA territory.",
      observations: [],
    });
    const v = validateComposerOutput(
      s,
      draft("Acute infarction in the left MCA territory.", "Left MCA infarction."),
    );
    expect(v.lateralitySwaps).toContain("right→left");
  });

  it("G2-3 CONTROL laterality only the history named is still not invented by the draft", () => {
    const s = snap({
      findings: "Normal MRI brain baseline.",
      clinicalHistory: "Right-sided weakness.",
      observations: [],
    });
    const v = validateComposerOutput(
      s,
      draft("No acute intracranial abnormality.", "Normal MRI of the brain."),
    );
    expect(v.lateralitySwaps).toEqual([]);
    expect(v.errors).not.toContain("laterality_dropped");
  });
});

describe("G4 a declared baseline retirement must reach the composed report", () => {
  const SPINE_BASELINE = "No significant disc bulge.\nFacet joints preserved.";

  function spineSnap(observations: ComposerInputSnapshot["observations"]) {
    return snap({
      region: "LS_SPINE",
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      findings: SPINE_BASELINE,
      observations,
    });
  }

  it("G4-1 the measured arm C: the protrusion retires the bulge normal and keeps the facet normal", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5 contacting the traversing right L5 root",
        baselineReplaces: "No significant disc bulge.",
      },
    ]);
    const out = deterministicComposeFromSnapshot(s, "FULL_REPORT");
    expect(out.findings).not.toMatch(/No significant disc bulge/i);
    expect(out.findings).toMatch(/Facet joints preserved/i);
    expect(out.findings).toMatch(/disc protrusion/i);
  });

  it("G4-2 facet arthropathy retires only the facet normal it names", () => {
    const s = spineSnap([
      {
        region: "facet",
        concept: "arthropathy",
        level: "L4-L5",
        findingsText: "Mild bilateral facet arthropathy at L4-L5",
        baselineReplaces: "Facet joints preserved.",
      },
    ]);
    const out = deterministicComposeFromSnapshot(s, "FULL_REPORT");
    expect(out.findings).not.toMatch(/Facet joints preserved/i);
    expect(out.findings).toMatch(/No significant disc bulge/i);
  });

  it("G4-3 cerebral infarction retires the named normal baseline sentence", () => {
    const s = snap({
      findings: "Normal MRI brain baseline. Ventricles and sulci are age appropriate.",
      observations: [
        {
          region: "parenchyma",
          concept: "infarction",
          findingsText: "Acute infarction in the left MCA territory",
          baselineReplaces: "Normal MRI brain baseline.",
        },
      ],
    });
    const out = deterministicComposeFromSnapshot(s, "FULL_REPORT");
    expect(out.findings).not.toMatch(/Normal MRI brain baseline/i);
    expect(out.findings).toMatch(/Ventricles and sulci are age appropriate/i);
  });

  it("G4-4 an undeclared normal is never removed, and a near-miss is never guessed at", () => {
    const s = snap({
      findings: "Normal MRI brain baseline.\nNo midline shift.",
      observations: [
        {
          region: "parenchyma",
          concept: "infarction",
          findingsText: "Acute infarction in the left MCA territory",
          // The radiologist's copy of the line has moved on: it must retire nothing.
          baselineReplaces: "Normal MRI brain baseline with no midline shift.",
        },
      ],
    });
    const out = deterministicComposeFromSnapshot(s, "FULL_REPORT");
    expect(out.findings).toMatch(/Normal MRI brain baseline/i);
    expect(out.findings).toMatch(/No midline shift/i);
  });

  it("G4-5 retirement is idempotent and leaves the rest of the paragraph order alone", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        baselineReplaces: "No significant disc bulge.",
      },
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        baselineReplaces: "No significant disc bulge.",
      },
    ]);
    const out = deterministicComposeFromSnapshot(s, "FULL_REPORT");
    expect(out.findings).not.toMatch(/No significant disc bulge/i);
    expect(out.findings.startsWith("Facet joints preserved."))
      .toBe(true);
  });

  /**
   * Validated the way `jobService` validates a drafting job — with the kind
   * passed, so the relation rules run in `draft` scope against the retired
   * report. Conservation is not in that contract (it is a preserving-kind rule),
   * and the retirement is deliberately limited to the drafting kinds for that
   * reason: a "make this professional" answer must not lose a normal.
   */
  it("G4-6 the retired sentence does not come back as a validation error", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        impressionText: "L4-L5 disc protrusion.",
        baselineReplaces: "No significant disc bulge.",
      },
    ]);
    const out = deterministicComposeFromSnapshot(s, "FULL_REPORT");
    const v = validateComposerOutput(s, out, { kind: "FULL_REPORT" });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  /**
   * Conservation still guards everything the radiologist did NOT declare retired.
   *
   * The protected fact here is the thecal sac: `ANATOMICAL_LOCATION_TERMS` maps
   * "thecal sac" to the `central canal` class, so dropping that sentence is a
   * `location_dropped` failure. Nothing about the retirement rule gives that
   * guarantee away — it only ever removes a sentence the radiologist named.
   */
  it("G4-7 CONTROL a normal the radiologist never declared retired still cannot vanish", () => {
    const s = snap({
      region: "LS_SPINE",
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      findings: "No significant disc bulge.\nThe thecal sac is patent.",
      observations: [
        {
          region: "disc",
          concept: "protrusion",
          level: "L4-L5",
          findingsText: "Right paracentral disc protrusion at L4-L5",
          baselineReplaces: "No significant disc bulge.",
        },
      ],
    });
    // The proposal drops the thecal-sac sentence, which no retirement names.
    // Conservation is a preserving-kind rule, so this is the contract that has to
    // still hold — validated as a PROFESSIONALIZE answer.
    const v = validateComposerOutput(
      s,
      draft("Right paracentral disc protrusion at L4-L5.", "Disc protrusion at L4-L5."),
      { kind: "PROFESSIONALIZE" },
    );
    expect(v.conservation?.droppedLocations).toContain("central canal");
    expect(v.errors).toContain("location_dropped");
  });

  it("G4-8 CONTROL a preserving task never deletes: only the drafting kind retires", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        baselineReplaces: "No significant disc bulge.",
      },
    ]);
    // "Make this more professional" was asked to rewrite what he wrote, not to
    // remove part of it, so the retirement is not its instruction to obey.
    const out = deterministicComposeFromSnapshot(s, "PROFESSIONALIZE");
    expect(out.findings).toMatch(/No significant disc bulge/i);

    const aiDraft = draft(`${SPINE_BASELINE}\nRight paracentral disc protrusion at L4-L5.`, "");
    expect(retireDeclaredBaselines(aiDraft, s, "SHORTEN").findings).toMatch(/No significant disc bulge/i);
    expect(retireDeclaredBaselines(aiDraft, s, "FULL_REPORT").findings).not.toMatch(/No significant disc bulge/i);
  });

  /**
   * The workspace records which sentence came from where. A hand-typed line that
   * happens to read like the tile's baseline is the radiologist's own, and his
   * keystroke outranks a tile's declaration — the same protection
   * `detectProtectedConflicts` gives a voice plan over a manual sentence.
   */
  it("G4-9 CONTROL a hand-typed sentence is never retired by a tile's declaration", () => {
    const s = parseComposerSnapshot({
      modality: "MR",
      region: "LS_SPINE",
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      findings: SPINE_BASELINE,
      impression: "",
      recommendation: "",
      jobKindHint: "FULL_REPORT",
      fieldProvenanceSummary: {
        findings: { "no significant disc bulge": ["manual"] },
      },
      observations: [
        {
          region: "disc",
          concept: "protrusion",
          level: "L4-L5",
          findingsText: "Right paracentral disc protrusion at L4-L5",
          baselineReplaces: "No significant disc bulge.",
        },
      ],
    });
    const out = deterministicComposeFromSnapshot(s, "FULL_REPORT");
    expect(out.findings).toMatch(/No significant disc bulge/i);
    expect(out.findings).toMatch(/Facet joints preserved/i);
  });

  it("G4-10 retirement matches the whole sentence, not its punctuation or case", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        // The tile's copy has no full stop and a different case — the same
        // statement, so it still retires.
        baselineReplaces: "no significant disc bulge",
      },
    ]);
    const out = deterministicComposeFromSnapshot(s, "FULL_REPORT");
    expect(out.findings).not.toMatch(/No significant disc bulge/i);
    expect(out.findings).toMatch(/Facet joints preserved/i);
  });
});
