/**
 * The radiologist's optional instruction must reach a FULL_REPORT draft — until now the
 * panel's "Instructions to AI" box only affected micro-edits, so a click of Draft from
 * Observations silently ignored whatever was typed.
 *
 * Two properties matter and are asserted together: the instruction IS delivered, and it is
 * delivered as a subordinate voice that cannot change a clinical fact. Existing micro-edit
 * behaviour is pinned unchanged.
 *
 * Synthetic text only; no provider, no database.
 */
import { describe, expect, it } from "vitest";
import {
  buildRadiologistDraftContext,
  renderRadiologistDraftContextPrompt,
} from "./buildRadiologistDraftContext";
import { buildUserPrompt } from "./composeEngine";
import type { ComposerInputSnapshot } from "./types";

const INSTRUCTION =
  "Prepare a detailed professional MRI LS Spine report. Include the AP canal measurement table. Prioritize L4-L5 canal narrowing in the impression.";

function snapshotOf(over: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return {
    modality: "MR",
    region: "LS Spine",
    regions: ["LS Spine"],
    bodyPart: "SPINE_LUMBAR",
    family: "spine",
    spineSegment: "lumbar",
    protocol: "Plain",
    clinicalHistory: "Low back pain with left L5 radiculopathy.",
    technique: "Sagittal T1/T2 and axial T2.",
    findings: "Lumbar alignment is normal. Conus terminates at L1.",
    impression: "",
    recommendation: "",
    observations: [
      {
        concept: "canal_ap",
        source: "structured",
        region: "LS Spine",
        level: "L4-L5",
        measurement: "9.4",
        findingsText: "Diffuse disc bulge at L4-L5 with bilateral lateral recess narrowing.",
      },
    ],
    ...over,
  } as ComposerInputSnapshot;
}

describe("additional instructions reach the full-report prompt", () => {
  it("FULL_REPORT prompt carries the instruction verbatim", () => {
    const prompt = buildUserPrompt("FULL_REPORT", snapshotOf({ instruction: INSTRUCTION }));
    expect(prompt).toContain("RADIOLOGIST'S ADDITIONAL INSTRUCTIONS FOR THIS DRAFT");
    expect(prompt).toContain(INSTRUCTION);
  });

  it("the instruction is explicitly subordinate to clinical truth", () => {
    const prompt = buildUserPrompt("FULL_REPORT", snapshotOf({ instruction: INSTRUCTION }));
    expect(prompt).toContain("They cannot add, remove or change an observation");
    expect(prompt).toContain("signing anything");
    expect(prompt).toContain("never from invented ones");
  });

  it("no instruction section is invented when the radiologist wrote none", () => {
    for (const blank of [undefined, "", "   \n  "]) {
      expect(
        buildUserPrompt("FULL_REPORT", snapshotOf({ instruction: blank })),
      ).not.toContain("RADIOLOGIST'S ADDITIONAL INSTRUCTIONS");
    }
  });

  it("the instruction sits after the observations and before the task, as additional context", () => {
    const prompt = buildUserPrompt("FULL_REPORT", snapshotOf({ instruction: INSTRUCTION }));
    expect(prompt.indexOf("RADIOLOGIST OBSERVATIONS")).toBeLessThan(
      prompt.indexOf("RADIOLOGIST'S ADDITIONAL INSTRUCTIONS"),
    );
    expect(prompt.indexOf("RADIOLOGIST'S ADDITIONAL INSTRUCTIONS")).toBeLessThan(
      prompt.indexOf("Task: Compose a COMPLETE"),
    );
  });

  it("an instruction never displaces the clinical content it comments on", () => {
    const prompt = buildUserPrompt("FULL_REPORT", snapshotOf({ instruction: INSTRUCTION }));
    expect(prompt).toContain("Diffuse disc bulge at L4-L5 with bilateral lateral recess narrowing.");
    expect(prompt).toContain("L4-L5");
    expect(prompt).toContain("bilateral");
    expect(prompt).toContain("Measurement: 9.4");
    expect(prompt).toContain("Conus terminates at L1.");
    expect(prompt).toContain("Sagittal T1/T2 and axial T2.");
  });

  it("IMPRESSION drafts receive it too, without being asked to rewrite Findings", () => {
    const prompt = buildUserPrompt("IMPRESSION", snapshotOf({ instruction: "Be terse." }));
    expect(prompt).toContain("Be terse.");
    expect(prompt).toContain("Generate Impression only");
    expect(prompt).not.toContain("Task: Compose a COMPLETE");
  });
});

describe("existing micro-edit behaviour is unchanged", () => {
  for (const kind of ["REPHRASE", "SHORTEN", "EXPAND", "TRANSLATE", "SECTION_EDIT", "SELECTION_EDIT"] as const) {
    it(`${kind} still uses its own JSON contract`, () => {
      const prompt = buildUserPrompt(kind, snapshotOf({
        instruction: "Shorten this paragraph.",
        selectionText: "Diffuse disc bulge at L4-L5.",
        selectionField: "FINDINGS",
        targetLanguage: "en",
      }));
      const parsed = JSON.parse(prompt);
      expect(parsed).toMatchObject({
        jobKind: kind,
        instruction: "Shorten this paragraph.",
        selectionField: "FINDINGS",
        selectionText: "Diffuse disc bulge at L4-L5.",
      });
      // micro kinds keep their truncated grounding and do not gain the FULL_REPORT sections
      expect(parsed.groundingFindings).toBe("Lumbar alignment is normal. Conus terminates at L1.");
      expect(prompt).not.toContain("RADIOLOGIST'S ADDITIONAL INSTRUCTIONS FOR THIS DRAFT");
    });
  }

  it("a micro kind with no instruction falls back to the kind name, as before", () => {
    expect(JSON.parse(buildUserPrompt("REPHRASE", snapshotOf())).instruction).toBe("REPHRASE");
  });
});

describe("context projection", () => {
  it("carries the instruction trimmed, and empty when absent", () => {
    expect(buildRadiologistDraftContext(snapshotOf({ instruction: `  ${INSTRUCTION}\n ` })).additionalInstruction).toBe(INSTRUCTION);
    expect(buildRadiologistDraftContext(snapshotOf()).additionalInstruction).toBe("");
  });
});
