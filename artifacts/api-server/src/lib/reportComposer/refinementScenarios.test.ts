/**
 * Prompt 2, Step 6 — the six refinements the feature claims to perform, each run
 * through the real prompt builder and the real validator.
 *
 * Every case has three parts: the instruction must reach the model inside the
 * current draft (so the model is refining what the radiologist can see, not a
 * summary of it), a revision that keeps the medicine must be accepted, and the
 * version of that same instruction carried out by changing the medicine must be
 * refused by the named rule. No provider is called, so these run on every CI job;
 * the live model round-trip is the opt-in suite.
 */
import { describe, expect, it } from "vitest";
import type { AiComposeJobKind } from "@workspace/db/schema";
import { buildUserPrompt } from "./composeEngine";
import { buildCareSystemPrompt } from "./persona";
import { validateComposerOutput } from "./validateOutput";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

type Scenario = {
  snap: ComposerInputSnapshot;
  instruction: string;
  good: { findings: string; impression: string };
  bad: { findings: string; impression: string };
  /** The code CARE must refuse the bad version for. */
  refusesWith: string;
};

function draftOf(scenario: Scenario, which: "good" | "bad") {
  return {
    ...scenario[which],
    recommendation: scenario.snap.recommendation,
    unresolvedQuestions: [],
    warnings: [],
  };
}

function targetText(snap: ComposerInputSnapshot): string {
  const sections = [`FINDINGS:\n${snap.findings}`, `IMPRESSION:\n${snap.impression}`];
  if (snap.recommendation.trim()) sections.push(`RECOMMENDATION:\n${snap.recommendation}`);
  return sections.join("\n\n");
}

function run(scenario: Scenario): Scenario & { kind: AiComposeJobKind } {
  return { ...scenario, kind: "SECTION_EDIT" as AiComposeJobKind };
}

const LUMBAR = run({
  snap: parseComposerSnapshot({
    modality: "MR", region: "LS Spine", family: "spine", spineSegment: "lumbar",
    reportTitle: "MRI LUMBOSACRAL SPINE",
    technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine.",
    findings: "Multilevel disc bulges with canal narrowing.",
    impression: "Multilevel lumbar disc bulges with canal narrowing.",
    recommendation: "",
    observations: [
      { id: "o1", concept: "disc_contour", level: "L4-L5", findingsText: "Broad-based disc bulge at L4-L5." },
      { id: "o2", concept: "canal_ap", level: "L4-L5", measurement: "9 mm", findingsText: "AP canal diameter 9 mm at L4-L5." },
      { id: "o3", concept: "disc_desiccation", level: "L5-S1", findingsText: "Disc desiccation at L5-S1." },
    ],
    jobKindHint: "SECTION_EDIT",
  }),
  instruction: "Expand the findings level by level and add the canal measurement table",
  good: {
    findings: [
      "Disc Contour:",
      "Broad-based disc bulge at L4-L5.",
      "Disc desiccation at L5-S1.",
      "",
      "Canal Diameter:",
      "| Level | AP Canal (mm) |",
      "| L4-L5 | 9 mm |",
    ].join("\n"),
    impression: "Multilevel lumbar disc bulges with canal narrowing.",
  },
  bad: {
    findings: [
      "Disc Contour:",
      "Broad-based disc bulge at L4-L5 with L1-L2 spondylolisthesis.",
      "Disc desiccation at L5-S1.",
    ].join("\n"),
    impression: "Multilevel lumbar disc bulges with canal narrowing.",
  },
  // The expanded version invented a level the input never named.
  refusesWith: "level_change",
});

const BRAIN = run({
  snap: parseComposerSnapshot({
    modality: "MR", region: "Brain", family: "brain",
    reportTitle: "MRI BRAIN",
    technique: "Multiplanar multisequence MRI of the brain with diffusion.",
    findings: "Restricted diffusion in the left middle cerebral artery territory.",
    impression: "Acute left middle cerebral artery territory infarct.",
    recommendation: "",
    observations: [
      { id: "o1", concept: "diffusion", laterality: "left", findingsText: "Restricted diffusion in the left MCA territory." },
    ],
    jobKindHint: "SECTION_EDIT",
  }),
  instruction: "Improve the impression",
  good: {
    findings: "Restricted diffusion in the left middle cerebral artery territory.",
    impression: "Findings are of an acute infarct in the left middle cerebral artery territory.",
  },
  bad: {
    findings: "Mild periventricular white matter change.",
    impression: "Expected age-related small vessel change.",
  },
  // The refinement rewrote both sections into boilerplate and the infarct went with them.
  refusesWith: "observation_dropped",
});

const CT_ABDOMEN = run({
  snap: parseComposerSnapshot({
    modality: "CT", region: "Abdomen", family: "abdomen",
    reportTitle: "CT ABDOMEN WITH CONTRAST",
    technique: "Contrast enhanced CT of the abdomen.",
    findings: "Fluid and fat stranding around an appendix containing an appendicolith.",
    impression: "Acute appendicitis.",
    recommendation: "",
    observations: [
      { id: "o1", concept: "appendix", findingsText: "Appendix contains an appendicolith with periappendiceal stranding." },
    ],
    jobKindHint: "SECTION_EDIT",
  }),
  instruction: "Correct the terminology",
  good: {
    findings: "The appendix is distended and contains an appendicolith, with periappendiceal fat stranding and free fluid.",
    impression: "Acute appendicitis.",
  },
  bad: {
    findings: "Bowel loops are unremarkable.",
    impression: "No acute abnormality.",
  },
  // "Correcting" terminology turned the inflamed appendix into a normal abdomen.
  refusesWith: "observation_dropped",
});

const DOPPLER = run({
  snap: parseComposerSnapshot({
    modality: "US", region: "Lower Limb Venous Doppler", family: "vascular",
    reportTitle: "DOPPLER LOWER LIMB VENOUS",
    technique: "Compression and colour Doppler of the bilateral lower limb deep venous systems.",
    findings: "Non-compressible thrombus in the right common femoral vein.",
    impression: "Right common femoral deep vein thrombosis.",
    recommendation: "",
    observations: [
      { id: "o1", concept: "thrombus", laterality: "right", findingsText: "Non-compressible thrombus in the right common femoral vein." },
    ],
    jobKindHint: "SECTION_EDIT",
  }),
  instruction: "Format the report by vessel and side",
  good: {
    findings: [
      "Deep Venous System:",
      "Common femoral vein: non-compressible thrombus on the right.",
      "Femoral and popliteal segments compress normally.",
    ].join("\n"),
    impression: "Right common femoral deep vein thrombosis.",
  },
  bad: {
    findings: "Non-compressible thrombus in the left common femoral vein.",
    impression: "Left common femoral deep vein thrombosis.",
  },
  // A formatting pass moved the clot to the other leg.
  refusesWith: "laterality_swap",
});

const LONG_IMPRESSION = run({
  snap: parseComposerSnapshot({
    modality: "MR", region: "LS Spine", family: "spine", spineSegment: "lumbar",
    reportTitle: "MRI LUMBOSACRAL SPINE",
    technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine.",
    findings: "Loss of lumbar lordosis. Disc desiccation L2-L3 to L5-S1.",
    impression: [
      "Loss of lumbar lordosis.",
      "Multilevel disc desiccation from L2-L3 to L5-S1.",
      "Severe canal stenosis at L4-L5.",
      "These appearances should be correlated clinically.",
    ].join(" "),
    recommendation: "",
    observations: [
      { id: "o1", concept: "lordosis", findingsText: "Loss of lumbar lordosis." },
      { id: "o2", concept: "disc_desiccation", level: "L2-L3", findingsText: "Disc desiccation L2-L3." },
      { id: "o3", concept: "canal_stenosis", level: "L4-L5", severity: "severe", findingsText: "Severe canal stenosis at L4-L5." },
    ],
    jobKindHint: "SECTION_EDIT",
  }),
  instruction: "Make the impression concise",
  good: {
    findings: "Loss of lumbar lordosis. Disc desiccation L2-L3 to L5-S1.",
    impression: "Loss of lordosis, multilevel disc desiccation and severe canal stenosis at L4-L5.",
  },
  bad: {
    findings: "Loss of lumbar lordosis. Disc desiccation L2-L3 to L5-S1.",
    impression: "Multilevel disc desiccation from L2-L3 to L5-S1.",
  },
  // Shortening removed the severe stenosis — the one finding that needed correlation.
  refusesWith: "observation_dropped",
});

const NUMBERS = run({
  snap: parseComposerSnapshot({
    modality: "MR", region: "LS Spine", family: "spine", spineSegment: "lumbar",
    reportTitle: "MRI LUMBOSACRAL SPINE",
    technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine.",
    findings: "AP canal diameter 9 mm at L4-L5.",
    impression: "Canal diameter 9 mm at L4-L5.",
    recommendation: "",
    observations: [
      { id: "o1", concept: "canal_ap", level: "L4-L5", measurement: "9 mm", findingsText: "AP canal diameter 9 mm at L4-L5." },
    ],
    jobKindHint: "SECTION_EDIT",
  }),
  instruction: "Tidy up the wording of the findings",
  good: {
    findings: "The AP canal diameter measures 9 mm at L4-L5.",
    impression: "Canal diameter 9 mm at L4-L5.",
  },
  bad: {
    findings: "The AP canal diameter measures 12 mm at L4-L5.",
    impression: "Canal diameter 12 mm at L4-L5.",
  },
  refusesWith: "measurement_mutation",
});

const SCENARIOS: Scenario[] = [LUMBAR, BRAIN, CT_ABDOMEN, DOPPLER, LONG_IMPRESSION, NUMBERS];

describe("the six refinements Prompt 2 promises", () => {
  it.each([
    ["1 expand a short MRI lumbar report", LUMBAR],
    ["2 improve an MRI brain impression", BRAIN],
    ["3 correct CT abdomen terminology", CT_ABDOMEN],
    ["4 format a lower-limb venous Doppler", DOPPLER],
    ["5 shorten an over-long impression", LONG_IMPRESSION],
    ["6 tidy the wording of a measurement", NUMBERS],
  ] as const)("%s: the instruction and the current draft both reach the model", (_label, scenario) => {
    const prompt = buildUserPrompt("SECTION_EDIT" as AiComposeJobKind, {
      ...scenario.snap,
      instruction: scenario.instruction,
      selectionText: targetText(scenario.snap),
      selectionField: "FINDINGS",
    });
    expect(prompt).toContain(scenario.instruction);
    expect(prompt).toContain(scenario.snap.findings);
    expect(prompt).toContain(scenario.snap.impression);
  });

  it("sends the rules that say what a refinement may never do", () => {
    const rules = buildCareSystemPrompt("SECTION_EDIT" as AiComposeJobKind, LUMBAR.snap);
    expect(rules).toContain("Apply the instruction to the TARGET TEXT only");
    expect(rules).toMatch(/never removes clinical content/i);
    expect(rules).toMatch(/do NOT comply and do NOT guess/i);
  });

  it.each([
    ["1 expand a short MRI lumbar report", LUMBAR],
    ["2 improve an MRI brain impression", BRAIN],
    ["3 correct CT abdomen terminology", CT_ABDOMEN],
    ["4 format a lower-limb venous Doppler", DOPPLER],
    ["5 shorten an over-long impression", LONG_IMPRESSION],
    ["6 tidy the wording of a measurement", NUMBERS],
  ] as const)("%s: the honest revision is accepted", (_label, scenario) => {
    const v = validateComposerOutput(scenario.snap, draftOf(scenario, "good"));
    expect(v.errors, v.warnings.join(" | ")).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it.each([
    ["1 expand a short MRI lumbar report", LUMBAR],
    ["2 improve an MRI brain impression", BRAIN],
    ["3 correct CT abdomen terminology", CT_ABDOMEN],
    ["4 format a lower-limb venous Doppler", DOPPLER],
    ["5 shorten an over-long impression", LONG_IMPRESSION],
    ["6 tidy the wording of a measurement", NUMBERS],
  ] as const)("%s: the revision that changes the medicine is refused", (_label, scenario) => {
    const v = validateComposerOutput(scenario.snap, draftOf(scenario, "bad"));
    expect(v.errors).toContain(scenario.refusesWith);
    expect(v.ok).toBe(false);
  });

  it("names the statement it removed, not just the code", () => {
    const v = validateComposerOutput(LONG_IMPRESSION.snap, draftOf(LONG_IMPRESSION, "bad"));
    expect(v.warnings.join(" ")).toMatch(/severe canal stenosis at L4-L5/i);
  });

  it("does not treat a correlation sentence as clinical content", () => {
    // "These appearances should be correlated clinically" is about the report, not the
    // patient, and CARE's own style rules discourage it. A refinement that drops it
    // must not be reported as a deleted finding.
    const v = validateComposerOutput(LONG_IMPRESSION.snap, {
      findings: LONG_IMPRESSION.snap.findings,
      impression: "Loss of lordosis and severe canal stenosis at L4-L5.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors, v.warnings.join(" | ")).toEqual([]);
  });

  it("does not refuse an impression that honestly disagrees with the findings", () => {
    // Deliberate limit, stated here so it is not mistaken for coverage: the mirror of
    // the deleted-finding rule would refuse any impression that denies what the
    // findings asserted. Radiologists write that on purpose — an appendicolith without
    // appendicitis, a subacute infarct reported against an acute clinical question —
    // so refusing it would push honest reports into the failure path. It stays the
    // reviewer's call, which is what the tracked-change screen is for.
    const v = validateComposerOutput(BRAIN.snap, {
      findings: BRAIN.snap.findings,
      impression: "No acute infarct; the diffusion change is subacute and should be read with the clinical picture.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).not.toContain("observation_dropped");
  });

  it("teaches a canal table CARE's own measurement check can read", () => {
    // The persona's printed-structure grammar and the validator's measurement grammar
    // have to agree, or the prompt tells the model to write a table the validator then
    // refuses for losing the number. The example row is taken from the prompt itself.
    const rules = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, LUMBAR.snap);
    const exampleCell = rules.match(/\| L1-L2 \| ([^|]+)\|/)?.[1]?.trim() ?? "";
    expect(exampleCell).toMatch(/^\d+(\.\d+)?\s*mm$/);

    const snap = parseComposerSnapshot({
      modality: "MR", region: "LS Spine", family: "spine", spineSegment: "lumbar",
      reportTitle: "MRI LUMBOSACRAL SPINE",
      technique: "Non-contrast MRI of the lumbosacral spine.",
      findings: "AP canal diameter 14 mm at L1-L2.",
      impression: "Normal canal at L1-L2.",
      recommendation: "",
      observations: [
        { id: "o1", concept: "canal_ap", level: "L1-L2", measurement: "14 mm", findingsText: "AP canal diameter 14 mm at L1-L2." },
      ],
      jobKindHint: "FULL_REPORT",
    });
    const v = validateComposerOutput(snap, {
      findings: ["Canal Diameter:", "| Level | AP Canal (mm) |", `| L1-L2 | ${exampleCell} |`].join("\n"),
      impression: "Normal canal at L1-L2.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors, v.warnings.join(" | ")).toEqual([]);
  });
});
