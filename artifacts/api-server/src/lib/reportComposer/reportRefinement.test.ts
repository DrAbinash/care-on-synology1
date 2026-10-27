/**
 * Regression tests for the observation_dropped guard.
 *
 * The conservation framework compares token sets across entire input vs output.
 * A report can lose a complete observation while its constituent words survive
 * elsewhere — "Bilateral facet arthropathy at L4-L5" deleted, but "facet" appears
 * in another sentence and "L4-L5" appears in three more. The token-level check
 * sees no loss. These tests verify the per-observation preservation guard catches
 * this class of failure.
 */
import { describe, expect, it } from "vitest";
import type { ComposerDraftOutput, ComposerInputSnapshot, ComposeObservation } from "./types";
import { parseComposerSnapshot, parseComposerDraftJson } from "./types";
import { validateComposerOutput } from "./validateOutput";

const L45_FACET = "Bilateral facet arthropathy at L4-L5 and L5-S1.";
const BASE_FINDINGS = [
  "Loss of lumbar lordosis.",
  "Disc desiccation at L2-L3, L3-L4, L4-L5 and L5-S1.",
  "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.",
  L45_FACET,
  "AP canal diameter 9 mm at L4-L5.",
].join("\n");

const BASE_IMPRESSION = [
  "Multilevel degenerative changes.",
  "L4-L5 disc bulge with bilateral facet arthropathy and critical canal stenosis.",
].join("\n");

function observationsForFindings(findings: string): ComposeObservation[] {
  return [
    {
      concept: "loss of lordosis",
      findingsText: "Loss of lumbar lordosis.",
      region: "lumbar",
    },
    {
      concept: "disc desiccation",
      findingsText: "Disc desiccation at L2-L3, L3-L4, L4-L5 and L5-S1.",
      region: "lumbar",
      level: "L2-L3, L3-L4, L4-L5, L5-S1",
    },
    {
      concept: "disc bulge",
      findingsText: "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.",
      region: "lumbar",
      level: "L4-L5",
      laterality: "bilateral",
    },
    {
      concept: "facet arthropathy",
      findingsText: L45_FACET,
      region: "lumbar",
      level: "L4-L5, L5-S1",
      laterality: "bilateral",
    },
    {
      concept: "canal stenosis",
      findingsText: "AP canal diameter 9 mm at L4-L5.",
      region: "lumbar",
      level: "L4-L5",
      measurement: "9 mm",
    },
  ];
}

function snapshotFor(findings: string, impression: string = BASE_IMPRESSION): ComposerInputSnapshot {
  return parseComposerSnapshot({
    findings: BASE_FINDINGS,
    impression: BASE_IMPRESSION,
    technique: "MRI lumbar spine without contrast.",
    regions: ["lumbar"],
    observations: observationsForFindings(findings),
    jobKindHint: "SECTION_EDIT",
  });
}

function draftFor(findings: string, impression: string = BASE_IMPRESSION): ComposerDraftOutput {
  return {
    findings,
    impression,
    recommendation: "",
    unresolvedQuestions: [],
    warnings: [],
  };
}

describe("observation_dropped guard", () => {
  it("detects when a complete observation sentence is deleted", () => {
    const outputFindings = [
      "Loss of lumbar lordosis.",
      "Disc desiccation at L2-L3, L3-L4, L4-L5 and L5-S1.",
      "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.",
      "AP canal diameter 9 mm at L4-L5.",
    ].join("\n");
    const result = validateComposerOutput(snapshotFor(outputFindings), draftFor(outputFindings));
    expect(result.errors).toContain("observation_dropped");
    expect(result.warnings.join(" ")).toMatch(/facet arthropathy/i);
  });

  it("detects when an observation is replaced with unrelated text", () => {
    const outputFindings = [
      "Loss of lumbar lordosis.",
      "Disc desiccation at L2-L3, L3-L4, L4-L5 and L5-S1.",
      "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.",
      "Small joints are unremarkable.",
      "AP canal diameter 9 mm at L4-L5.",
    ].join("\n");
    const result = validateComposerOutput(snapshotFor(outputFindings), draftFor(outputFindings));
    expect(result.errors).toContain("observation_dropped");
  });

  it("passes when all observations are professionally rephrased", () => {
    const outputFindings = [
      "Lumbar lordosis is reduced.",
      "Multilevel disc desiccation is noted at L2-L3 through L5-S1.",
      "At L4-L5, a broad-based disc bulge causes bilateral lateral recess narrowing.",
      "Bilateral facet arthropathy is present at L4-L5 and L5-S1.",
      "The AP canal diameter measures 9 mm at L4-L5.",
    ].join("\n");
    const result = validateComposerOutput(snapshotFor(outputFindings), draftFor(outputFindings));
    expect(result.errors).not.toContain("observation_dropped");
  });

  it("passes for impression-only refinement when findings pass through", () => {
    const outputFindings = BASE_FINDINGS;
    const outputImpression = [
      "Multilevel degenerative disc disease.",
      "L4-L5 disc bulge with facet arthropathy and critical canal stenosis.",
    ].join("\n");
    const result = validateComposerOutput(
      snapshotFor(outputFindings, outputImpression),
      draftFor(outputFindings, outputImpression),
    );
    expect(result.errors).not.toContain("observation_dropped");
  });

  it("passes when input findings are empty (untouched)", () => {
    const snap = parseComposerSnapshot({
      findings: "",
      impression: "",
      technique: "MRI lumbar spine.",
      regions: ["lumbar"],
      observations: [
        {
          concept: "disc bulge",
          findingsText: "Disc bulge at L4-L5.",
          region: "lumbar",
          level: "L4-L5",
        },
      ],
      jobKindHint: "SECTION_EDIT",
    });
    const draft: ComposerDraftOutput = {
      findings: "",
      impression: "",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const result = validateComposerOutput(snap, draft);
    expect(result.errors).not.toContain("observation_dropped");
  });

  it("passes when a hedge is dropped but the finding remains", () => {
    const snap = parseComposerSnapshot({
      findings: "Suspected disc bulge at L4-L5.",
      impression: "Possible L4-L5 disc bulge.",
      technique: "MRI lumbar spine.",
      regions: ["lumbar"],
      observations: [
        {
          concept: "disc bulge",
          findingsText: "Suspected disc bulge at L4-L5.",
          region: "lumbar",
          level: "L4-L5",
        },
      ],
      jobKindHint: "SECTION_EDIT",
    });
    const draft: ComposerDraftOutput = {
      findings: "Disc bulge at L4-L5.",
      impression: "L4-L5 disc bulge.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const result = validateComposerOutput(snap, draft);
    expect(result.errors).not.toContain("observation_dropped");
  });

  it("skips ledger-only rows not present in input narrative", () => {
    const snap = parseComposerSnapshot({
      findings: "Disc bulge at L4-L5.",
      impression: "L4-L5 disc bulge.",
      technique: "MRI lumbar spine.",
      regions: ["lumbar"],
      observations: [
        {
          concept: "disc bulge",
          findingsText: "Disc bulge at L4-L5.",
          region: "lumbar",
          level: "L4-L5",
        },
        {
          concept: "posterior elements",
          findingsText: "Posterior elements are unremarkable.",
          region: "lumbar",
        },
      ],
      jobKindHint: "SECTION_EDIT",
    });
    const draft: ComposerDraftOutput = {
      findings: "Disc bulge at L4-L5.",
      impression: "L4-L5 disc bulge.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const result = validateComposerOutput(snap, draft);
    expect(result.errors).not.toContain("observation_dropped");
  });

  it("exempts TRANSLATE kind from observation_dropped check", () => {
    const snap = parseComposerSnapshot({
      findings: "Disc bulge at L4-L5.",
      impression: "L4-L5 disc bulge.",
      technique: "MRI lumbar spine.",
      regions: ["lumbar"],
      observations: [
        {
          concept: "disc bulge",
          findingsText: "Disc bulge at L4-L5.",
          region: "lumbar",
          level: "L4-L5",
        },
      ],
      jobKindHint: "TRANSLATE",
    });
    const draft: ComposerDraftOutput = {
      findings: "Hernia discal en L4-L5.",
      impression: "Hernia discal L4-L5.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const result = validateComposerOutput(snap, draft);
    expect(result.errors).not.toContain("observation_dropped");
  });

  it("fires both measurement_mutation and observation_dropped when measurement is dropped", () => {
    const outputFindings = [
      "Loss of lumbar lordosis.",
      "Disc desiccation at L2-L3, L3-L4, L4-L5 and L5-S1.",
      "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.",
      "Bilateral facet arthropathy at L4-L5 and L5-S1.",
    ].join("\n");
    const result = validateComposerOutput(snapshotFor(outputFindings), draftFor(outputFindings));
    expect(result.errors).toContain("observation_dropped");
    expect(result.errors).toContain("measurement_mutation");
  });
});

describe("observation preservation — clinical meaning, not exact sentences", () => {
  it("passes when two observations share one clinically equivalent sentence", () => {
    const snap = parseComposerSnapshot({
      findings: "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.\nBilateral facet arthropathy at L4-L5.",
      impression: "L4-L5 degenerative disc disease.",
      technique: "MRI lumbar spine.",
      regions: ["lumbar"],
      observations: [
        { concept: "disc bulge", findingsText: "Broad-based disc bulge at L4-L5.", region: "lumbar", level: "L4-L5", laterality: "bilateral" },
        { concept: "facet arthropathy", findingsText: "Bilateral facet arthropathy at L4-L5.", region: "lumbar", level: "L4-L5", laterality: "bilateral" },
      ],
      jobKindHint: "PROFESSIONALIZE",
    });
    const draft: ComposerDraftOutput = {
      findings: "At L4-L5 there is a broad-based disc bulge causing bilateral lateral recess narrowing, together with bilateral facet arthropathy.",
      impression: "L4-L5 degenerative disc disease with facet arthropathy.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const result = validateComposerOutput(snap, draft);
    expect(result.errors).not.toContain("observation_dropped");
  });

  it("passes when anatomical terminology is rewritten using accepted synonyms", () => {
    const snap = parseComposerSnapshot({
      findings: "Bilateral facet arthropathy at L4-L5 with facet joint effusion.",
      impression: "L4-L5 facet arthropathy.",
      technique: "MRI lumbar spine.",
      regions: ["lumbar"],
      observations: [
        { concept: "facet arthropathy", findingsText: "Bilateral facet arthropathy at L4-L5 with facet joint effusion.", region: "lumbar", level: "L4-L5", laterality: "bilateral" },
      ],
      jobKindHint: "PROFESSIONALIZE",
    });
    const draft: ComposerDraftOutput = {
      findings: "Facet arthrosis with joint effusion at L4-L5 bilaterally.",
      impression: "L4-L5 facet arthrosis.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const result = validateComposerOutput(snap, draft);
    expect(result.errors).not.toContain("observation_dropped");
  });

  it("detects when a finding is moved from Findings into Impression only", () => {
    const outputFindings = [
      "Loss of lumbar lordosis.",
      "Disc desiccation at L2-L3, L3-L4, L4-L5 and L5-S1.",
      "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.",
      "AP canal diameter 9 mm at L4-L5.",
    ].join("\n");
    const outputImpression = "L4-L5 facet arthropathy with critical canal stenosis.";
    const result = validateComposerOutput(
      snapshotFor(outputFindings),
      draftFor(outputFindings, outputImpression),
    );
    expect(result.errors).toContain("observation_dropped");
  });

  it("independently checks each observation when multiple share the same level", () => {
    const snap = parseComposerSnapshot({
      findings: "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.\nBilateral facet arthropathy at L4-L5.\nAP canal diameter 9 mm at L4-L5.",
      impression: "L4-L5 degenerative changes.",
      technique: "MRI lumbar spine.",
      regions: ["lumbar"],
      observations: [
        { concept: "disc bulge", findingsText: "Broad-based disc bulge at L4-L5.", region: "lumbar", level: "L4-L5" },
        { concept: "facet arthropathy", findingsText: "Bilateral facet arthropathy at L4-L5.", region: "lumbar", level: "L4-L5" },
        { concept: "canal stenosis", findingsText: "AP canal diameter 9 mm at L4-L5.", region: "lumbar", level: "L4-L5", measurement: "9 mm" },
      ],
      jobKindHint: "SECTION_EDIT",
    });
    const draft: ComposerDraftOutput = {
      findings: "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.\nAP canal diameter 9 mm at L4-L5.",
      impression: "L4-L5 degenerative changes.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const result = validateComposerOutput(snap, draft);
    expect(result.errors).toContain("observation_dropped");
    expect(result.warnings.join(" ")).toMatch(/facet arthropathy/i);
  });

  it("does not fire observation_dropped when no observation rows exist (narrative conservation applies)", () => {
    const snap = parseComposerSnapshot({
      findings: "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.\nBilateral facet arthropathy at L4-L5 and L5-S1.\nAP canal diameter 9 mm at L4-L5.",
      impression: "L4-L5 disc bulge with facet arthropathy.",
      technique: "MRI lumbar spine.",
      regions: ["lumbar"],
      observations: [],
      jobKindHint: "PROFESSIONALIZE",
    });
    const draft: ComposerDraftOutput = {
      findings: "Broad-based disc bulge at L4-L5 with bilateral facet arthropathy.\nAP canal diameter 9 mm at L4-L5.",
      impression: "L4-L5 disc bulge with facet arthropathy.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const result = validateComposerOutput(snap, draft);
    expect(result.errors).not.toContain("observation_dropped");
  });
});

describe("unresolvedQuestions contract", () => {
  it("survives through the schema parser as a string array", () => {
    const raw = JSON.stringify({
      findings: "Test findings.",
      impression: "Test impression.",
      recommendation: "",
      unresolvedQuestions: ["Is this right or left-sided?"],
      warnings: [],
    });
    const parsed = parseComposerDraftJson(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.unresolvedQuestions).toEqual(["Is this right or left-sided?"]);
  });

  it("defaults to an empty array when the model omits it", () => {
    const raw = JSON.stringify({
      findings: "F.",
      impression: "I.",
      recommendation: "",
    });
    const parsed = parseComposerDraftJson(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.unresolvedQuestions).toEqual([]);
  });
});
