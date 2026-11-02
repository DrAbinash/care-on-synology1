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
 *
 * N1 (added in the follow-up round) — the same spelling table had to be applied to
 * the DENIAL rule as well, or the widening above became a hole: "No intracranial
 * haemorrhage." grounded "hemorrhage" as an acceptable word, and `includes` then
 * compared a denial against a different string, so a radiologist's explicit negative
 * could come back positive on an "ae". G1-4b and G1-4c close it in both directions,
 * and G1-4e/G1-4f pin the two ways it must NOT fire — restating a denial in the
 * other spelling, and an input that both denies and affirms the same finding.
 *
 * The retirement half also reports what it refuses to do: a drafted report that
 * still carries a declared normal is named in `validation.warnings` for the
 * radiologist to review (G4-14, G4-14b), while a declaration that matches nothing
 * stays silent (G4-15), because an alarm on every near-miss is how these validators
 * stop being read.
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
   * CONTROL for the widening below: a denial the input states in one spelling is
   * refused when the answer keeps that spelling. Grounding is not a licence to
   * invert a denial.
   */
  it("G1-4 CONTROL a denied haemorrhage in the input cannot come back asserted", () => {
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

  /**
   * The hole G1-4 was written around, now closed. Measured 2026-11-01: with this
   * same input, an answer that said "hemorrhage" instead of "haemorrhage" was
   * grounded by `GROUNDEDNESS_SPELLINGS`, compared by `includes` against a
   * different string, and went READY — a bleed the radiologist had explicitly
   * excluded, in the report of record, because of an "ae".
   *
   * Closing it uses the SAME narrow table that fixed the false rejection, and only
   * its orthographic edges. G1-5 and G1-6 are the proof that it did not become a
   * clinical-equivalence list.
   */
  it("G1-4b negation safety: a British denial still refuses an American assertion", () => {
    const s = snap({ findings: "No intracranial haemorrhage.", observations: [] });
    const v = validateComposerOutput(s, draft("There is intracranial hemorrhage.", "Hemorrhage."));
    expect(v.errors).toContain("denied_finding_asserted");
    expect(v.warnings.join(" ")).toMatch(/haemorrhage/);
  });

  it("G1-4c negation safety, both directions: an American denial still refuses a British assertion", () => {
    const s = snap({ findings: "No intracranial hemorrhage.", observations: [] });
    const v = validateComposerOutput(s, draft("There is intracranial haemorrhage.", "Haemorrhage."));
    expect(v.errors).toContain("denied_finding_asserted");
  });

  /**
   * The structured arm was measured, not assumed: it refuses EARLIER than the
   * denial rule, because `pruneUngroundedObservationRows` will not carry a row for
   * a finding a dictation that only denies it. So the widened denial is not what
   * stops this job — the point of the test is that the row path is not a second
   * door, and that the failure names the rows it refused instead of going READY
   * with an empty plan.
   */
  it("G1-4d the same pair cannot arrive as an OBSERVATIONS row either", () => {
    const s = snap({ findings: "No intracranial haemorrhage.", observations: [] });
    const v = validateComposerOutput(
      s,
      {
        findings: "",
        impression: "",
        recommendation: "",
        unresolvedQuestions: [],
        warnings: [],
        observations: [
          {
            concept: "hemorrhage",
            region: "parenchyma",
            findingsText: "Intracranial hemorrhage, right basal ganglia",
          },
        ],
      },
      { kind: "OBSERVATIONS" },
    );
    expect(v.ok).toBe(false);
    expect(v.errors).toContain("no_grounded_observations");
  });

  it("G1-4e CONTROL legitimate findings survive the widening: a restated denial and an unrelated positive", () => {
    // The output denies in its own words, and separately asserts a finding the input
    // AFFIRMED. Neither is an inversion, and neither may be refused — a negation
    // rule that alarms on honest reports is the failure mode this file keeps hitting.
    const s = snap({
      findings: "No intracranial haemorrhage.\nMild cerebral atrophy is present.",
      observations: [{ region: "parenchyma", concept: "atrophy", findingsText: "Mild cerebral atrophy" }],
    });
    const v = validateComposerOutput(
      s,
      draft("No intracranial hemorrhage is seen. Mild cerebral atrophy is present.", "Mild cerebral atrophy."),
      { kind: "FULL_REPORT" },
    );
    expect(v.errors).not.toContain("denied_finding_asserted");
    expect(v.errors).not.toContain("unsupported_abnormality");
  });

  it("G1-4f doctrine: an input that both denies and affirms one spelling-variant is a mixed statement, not a denial", () => {
    // "No significant hemorrhage" beside "A small haemorrhage is noted" is a
    // level- or size-specific finding, and the existing rule refuses to call that a
    // denial. Widening the comparison to spellings must keep refusing it, or honest
    // reports start failing.
    const s = snap({
      findings: "No significant hemorrhage. A small haemorrhage is noted along the left convexity.",
      observations: [],
    });
    const v = validateComposerOutput(
      s,
      draft("A small haemorrhage along the left convexity.", "Small left convexity hemorrhage."),
      { kind: "FULL_REPORT" },
    );
    expect(v.errors).not.toContain("denied_finding_asserted");
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

  /**
   * The shapes the declaration actually arrives in, measured rather than assumed.
   * A Findings block is not one sentence per line: Quick Select writes bullets,
   * templates write paragraphs, and a radiologist's own line often carries two
   * statements. Each of these retires exactly the named sentence and nothing more.
   */
  /**
   * The shape Quick Select actually writes: a bullet carrying the baseline AND the
   * next statement. Retiring the sentence must not renumber the list or silently
   * reformat the item that survives it — so the retired normal shares this line with
   * a survivor, which is the only arrangement where the marker can be lost.
   */
  it("G4-11 a bulleted normal retires and the surviving bullet keeps its marker", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        baselineReplaces: "No significant disc bulge.",
      },
    ]);
    const out = retireDeclaredBaselines(
      draft("- No significant disc bulge. Facet joints preserved.\n- Conus normal.", ""),
      s,
      "FULL_REPORT",
    );
    expect(out.findings).not.toMatch(/disc bulge/i);
    expect(out.findings).toBe("- Facet joints preserved.\n- Conus normal.");
  });

  it("G4-12 a normal inside a longer paragraph retires, its neighbours untouched byte for byte", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        baselineReplaces: "No significant disc bulge.",
      },
    ]);
    const paragraph =
      "The lumbar alignment is preserved. No significant disc bulge. The conus medullaris is normal in signal.";
    const out = retireDeclaredBaselines(draft(paragraph, ""), s, "FULL_REPORT");
    expect(out.findings).toBe(
      "The lumbar alignment is preserved. The conus medullaris is normal in signal.",
    );
  });

  it("G4-13 two declared normals in one paragraph both retire, an undeclared one stays", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        baselineReplaces: "No significant disc bulge.",
      },
      {
        region: "canal",
        concept: "stenosis",
        level: "L4-L5",
        findingsText: "Mild canal stenosis at L4-L5",
        baselineReplaces: "Thecal sac is patent.",
      },
    ]);
    const out = retireDeclaredBaselines(
      draft(
        "No significant disc bulge. Thecal sac is patent. Facet joints preserved.",
        "",
      ),
      s,
      "FULL_REPORT",
    );
    expect(out.findings).toBe("Facet joints preserved.");
  });

  /**
   * A sentence cannot be retired safely — the radiologist typed it, so a tile's
   * declaration does not speak for it — so it is kept AND named. The warning is
   * advisory, never `errors`: the report is not withheld for something only he can
   * decide, and it lands in the box the workspace already renders for a READY job
   * (`ai-validation-warnings`, ReportComposerAssistant.tsx:533).
   */
  it("G4-14 a protected hand-typed normal is reported for review instead of vanishing silently", () => {
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

    const v = validateComposerOutput(s, out, { kind: "FULL_REPORT" });
    expect(v.warnings.join(" ")).toMatch(/wording you typed/);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    // The other normal was retired, so exactly one contradiction is reported.
    expect(v.warnings.filter((w) => /check it before accepting/.test(w))).toHaveLength(0);
  });

  /**
   * The validator cannot know which upstream handed it the text, so the promise is
   * made about the TEXT: a drafted report that still carries a declared normal is
   * reported, whether or not the retirement step ran. Pinned here rather than left
   * as a comment, because "the Composer never ships this silently" is exactly the
   * kind of claim a refactor breaks in one line.
   */
  it("G4-14b a draft that reaches validation still contradicted is reported", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        baselineReplaces: "No significant disc bulge.",
      },
    ]);
    const v = validateComposerOutput(
      s,
      draft(`${SPINE_BASELINE}\nRight paracentral disc protrusion at L4-L5.`, "Disc protrusion at L4-L5."),
      { kind: "FULL_REPORT" },
    );
    expect(v.warnings.filter((w) => /check it before accepting/.test(w))).toHaveLength(1);
    expect(v.warnings.join(" ")).toMatch(/No significant disc bulge\./);
    // Only the declared normal is named; the facet normal is unrelated and unremarked.
    expect(v.warnings.join(" ")).not.toMatch(/Facet joints preserved/);
  });

  /**
   * Alarm fatigue is the other known failure of this class of validator: a rule
   * that fires on normal reports trains the radiologist to dismiss it. A
   * declaration that matches nothing in the draft is NOT reported — either the
   * normal is already gone, in which case there is no contradiction to review, or
   * the model reworded it, and telling those apart is the clinical resemblance
   * matching this module refuses to do.
   */
  it("G4-15 CONTROL an unmatched declaration raises no alarm, retired or reworded", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        baselineReplaces: "No significant disc bulge.",
      },
    ]);

    const clean = retireDeclaredBaselines(
      draft("Right paracentral disc protrusion at L4-L5.", "Disc protrusion at L4-L5."),
      s,
      "FULL_REPORT",
    );
    expect(clean.findings).toBe("Right paracentral disc protrusion at L4-L5.");
    expect(
      validateComposerOutput(s, clean, { kind: "FULL_REPORT" }).warnings.some((w) =>
        /check it before accepting|wording you typed/.test(w),
      ),
    ).toBe(false);

    // Reworded so the whole-sentence rule cannot match: nothing is deleted (no
    // guessing) and no alarm is raised, rather than alarming on every tile.
    const reworded = draft(
      "No significant disc bulge is seen at any level. Right paracentral disc protrusion at L4-L5.",
      "Disc protrusion at L4-L5.",
    );
    const kept = retireDeclaredBaselines(reworded, s, "FULL_REPORT");
    expect(kept.findings).toBe(reworded.findings);
    expect(
      validateComposerOutput(s, kept, { kind: "FULL_REPORT" }).warnings.some((w) =>
        /check it before accepting|wording you typed/.test(w),
      ),
    ).toBe(false);
  });

  it("G4-16 CONTROL retirement is never a side effect on a kind that does not draft", () => {
    const s = spineSnap([
      {
        region: "disc",
        concept: "protrusion",
        level: "L4-L5",
        findingsText: "Right paracentral disc protrusion at L4-L5",
        baselineReplaces: "No significant disc bulge.",
      },
    ]);
    const both = draft(`${SPINE_BASELINE}\nRight paracentral disc protrusion at L4-L5.`, "");
    expect(retireDeclaredBaselines(both, s, "IMPRESSION").findings).toBe(both.findings);
    expect(retireDeclaredBaselines(both, s, undefined).findings).toBe(both.findings);
    // The advisory report keeps the same gate, so a preserving kind is never told
    // to review a normal it was never allowed to delete.
    expect(
      validateComposerOutput(s, both, { kind: "PROFESSIONALIZE" }).warnings.some((w) =>
        /check it before accepting|wording you typed/.test(w),
      ),
    ).toBe(false);
  });
});
