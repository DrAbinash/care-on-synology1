/**
 * Operation 1 grounding: a dictated line becomes structured rows, and nothing
 * that the dictation did not say becomes a row.
 *
 * This is the operation the radiologist uses most and the one where a helpful
 * model is most dangerous: asked to structure "L4-5 diffuse bulge, bilateral
 * recess narrowing, LF hypertrophy, canal 8.2 mm", a model that also adds
 * "L3-L4 mild bulge" or "no high-grade canal stenosis" has written two findings
 * that never existed. The rows below are what a radiologist then inserts into the
 * canonical ledger and what the deterministic engine composes from, so an
 * ungrounded row is not a bad suggestion — it is a false clinical fact with a
 * clean provenance trail.
 *
 * Rows are DROPPED and named, not silently kept, and the drop is visible.
 */
import { describe, expect, it } from "vitest";
import { pruneUngroundedObservationRows, validateComposerOutput } from "./validateOutput";
import {
  parseComposerSnapshot,
  parseComposerDraftJson,
  type ComposerDraftOutput,
  type ProposedObservation,
} from "./types";

const DICTATION = "L4-5 diffuse bulge, bilateral recess narrowing, LF hypertrophy, canal 8.2 mm.";

function snap(dictation = DICTATION) {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    findings: dictation,
    impression: "",
    recommendation: "",
    observations: [],
  });
}

function obsDraft(observations: ProposedObservation[]): ComposerDraftOutput {
  return {
    findings: "",
    impression: "",
    recommendation: "",
    unresolvedQuestions: [],
    warnings: [],
    observations,
  };
}

const FAITHFUL: ProposedObservation = {
  concept: "disc bulge",
  level: "L4-5",
  laterality: null,
  severity: null,
  measurement: null,
  findingsText: "Diffuse disc bulge at L4-5.",
};

describe("grounded rows survive", () => {
  it("keeps every row the dictation supports", () => {
    const rows = [
      FAITHFUL,
      {
        concept: "recess narrowing",
        level: "L4-5",
        laterality: "bilateral",
        findingsText: "Bilateral recess narrowing at L4-5.",
      },
      {
        concept: "ligamentum flavum hypertrophy",
        findingsText: "Hypertrophy of the ligamentum flavum.",
        measurement: "8.2 mm",
        level: null,
        laterality: null,
        severity: null,
      },
    ];
    const draft = obsDraft(rows);
    const out = pruneUngroundedObservationRows(snap(), draft);
    expect(out.errors).toEqual([]);
    expect(draft.observations).toHaveLength(3);
  });

  it("accepts a measurement the dictation states", () => {
    const draft = obsDraft([
      { ...FAITHFUL, measurement: "8.2 mm", findingsText: "Canal AP 8.2 mm at L4-5." },
    ]);
    expect(pruneUngroundedObservationRows(snap(), draft).errors).toEqual([]);
    expect(draft.observations).toHaveLength(1);
  });
});

describe("ungrounded rows are dropped and named", () => {
  it("drops a level the dictation never mentioned", () => {
    const draft = obsDraft([
      { ...FAITHFUL, level: "L3-4", findingsText: "Diffuse disc bulge at L3-4." },
    ]);
    const out = pruneUngroundedObservationRows(snap(), draft);
    expect(draft.observations).toHaveLength(0);
    expect(out.warnings.join(" ")).toMatch(/level L3-4/);
    expect(out.errors).toContain("no_grounded_observations");
  });

  it("drops a laterality the dictation never claimed", () => {
    const draft = obsDraft([
      { ...FAITHFUL, laterality: "left", findingsText: "Left recess narrowing at L4-5." },
    ]);
    pruneUngroundedObservationRows(snap(), draft);
    // The dictation says "bilateral". A row that narrows it to one side invents
    // the side it dropped as well as claiming one that was not stated.
    expect(draft.observations).toHaveLength(0);
  });

  it("drops an invented measurement", () => {
    const draft = obsDraft([
      { ...FAITHFUL, measurement: "11 mm", findingsText: "Canal AP 11 mm at L4-5." },
    ]);
    const out = pruneUngroundedObservationRows(snap(), draft);
    expect(draft.observations).toHaveLength(0);
    expect(out.warnings.join(" ")).toMatch(/measurement/);
  });

  it("drops a finding class the dictation does not contain", () => {
    const draft = obsDraft([
      {
        concept: "cord compression",
        findingsText: "No cord compression.",
        level: null,
        laterality: null,
        severity: null,
        measurement: null,
      },
    ]);
    pruneUngroundedObservationRows(snap(), draft);
    expect(draft.observations).toHaveLength(0);
  });

  it("drops only the bad row, keeping the good ones", () => {
    const draft = obsDraft([
      FAITHFUL,
      { ...FAITHFUL, concept: "foraminal stenosis", findingsText: "Right foraminal stenosis at L5-S1." },
    ]);
    const out = pruneUngroundedObservationRows(snap(), draft);
    expect(draft.observations).toHaveLength(1);
    expect(draft.observations?.[0]?.concept).toBe("disc bulge");
    expect(out.errors).toEqual([]);
  });
});

describe("the OBSERVATIONS task through the shipped validator", () => {
  it("does not read an empty Findings/Impression as an empty answer", () => {
    const result = validateComposerOutput(snap(), obsDraft([FAITHFUL]), { kind: "OBSERVATIONS" });
    expect(result.errors).not.toContain("empty_output");
    expect(result.errors).not.toContain("no_grounded_observations");
    // One row is judged by the row rules instead, and here they bite: the
    // dictation also stated a side and a canal measurement, and this answer
    // carries neither. `ok` is false for the omission, never for the empty prose.
    expect(result.errors).toContain("measurement_dropped");
    expect(result.errors).toContain("laterality_dropped");
  });

  it("fails when the model returns no rows at all", () => {
    const result = validateComposerOutput(snap(), obsDraft([]), { kind: "OBSERVATIONS" });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("no_observations_returned");
  });

  it("is not applied to a report-text task", () => {
    const result = validateComposerOutput(snap(), obsDraft([{ ...FAITHFUL, level: "L3-4" }]), {
      kind: "FULL_REPORT",
    });
    // FULL_REPORT answers in prose; rows it happens to carry are not this rule's
    // business, and the narrative guards still run.
    expect(result.errors).not.toContain("no_grounded_observations");
  });
});

describe("the answer the model gave becomes the draft CARE keeps", () => {
  // Operations 1, 2 and 3 all cross this one parse boundary, so what it does to
  // the text is what the radiologist reviews and what later reaches the report.
  it("drops chat emphasis markers, which print literally in a report", () => {
    // Measured live 2026-10-11: gemma3:12b returned a whole-spine Findings
    // section as `**Cervical Spine:** …`, and every clinical guard passed it.
    const draft = parseComposerDraftJson(
      JSON.stringify({
        findings: "**Cervical Spine:** Loss of lordosis. **Lumbar Spine:** L4-5 bulge.",
        impression: "__Multilevel__ degenerative change.",
        recommendation: "",
        observations: [
          {
            concept: "disc bulge",
            level: "L4-5",
            findingsText: "**Diffuse** disc bulge at L4-5.",
          },
        ],
      }),
    );
    expect(draft).not.toBeNull();
    expect(draft?.findings).toBe("Cervical Spine: Loss of lordosis. Lumbar Spine: L4-5 bulge.");
    expect(draft?.impression).toBe("Multilevel degenerative change.");
    expect(draft?.observations?.[0]?.findingsText).toBe("Diffuse disc bulge at L4-5.");
  });

  it("keeps clinical content that merely looks adjacent to a marker", () => {
    const draft = parseComposerDraftJson(
      JSON.stringify({
        findings: "Grade 2/4 hydronephrosis. 3*3*4 cm lymph node.",
        impression: "No hydrocephalus.",
        recommendation: "",
      }),
    );
    expect(draft?.findings).toBe("Grade 2/4 hydronephrosis. 3*3*4 cm lymph node.");
  });
});
