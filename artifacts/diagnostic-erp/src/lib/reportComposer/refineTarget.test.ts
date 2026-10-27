import { describe, expect, it } from "vitest";
import { resolveRefineTarget } from "./refineTarget";

/**
 * The radiologist writes an instruction in ordinary language. Nothing here may
 * decide what it means — the model reads the words. What this module does decide,
 * and must keep deciding correctly, is which text the instruction applies to.
 */
describe("Refine Report — the instruction is never reclassified", () => {
  const findings = "Loss of lumbar lordosis. Disc desiccation L2-S1.";
  const impression = "Multilevel degenerative change.";

  for (const instruction of [
    "Make this report more professional",
    "Add a canal measurement table",
    "Organise the findings by anatomical level",
    "Remove the duplicated conclusion",
    "Shorten the impression",
    "Expand the findings",
    "Highlight abnormal findings",
    "Suggest follow-up imaging when indicated",
  ]) {
    it(`"${instruction}" reaches the model as itself, as a section refinement`, () => {
      const t = resolveRefineTarget({ instruction, findings, impression, selection: "" });
      expect(t).not.toBeNull();
      expect(t!.instruction).toBe(instruction);
      expect(t!.jobKind).toBe("SECTION_EDIT");
    });
  }

  it("no instruction is silently mapped to REPHRASE any more", () => {
    // The replaced code produced jobKind "REPHRASE" for every phrase that did not
    // contain translate/shorten/expand — most of the list above.
    const kinds = new Set(
      ["add a canal measurement table", "correct terminology", "improve the impression"].map(
        (instruction) => resolveRefineTarget({ instruction, findings, impression, selection: "" })!.jobKind,
      ),
    );
    expect(kinds).toEqual(new Set(["SECTION_EDIT"]));
  });
});

describe("Refine Report — the whole draft is the target", () => {
  const LONG_TAIL = "Incidental findings: a 14 mm exophytic cyst on the right lower pole of the kidney.";

  function longFindings(): string {
    const filler = Array.from({ length: 30 }, (_unused, i) =>
      `L${Math.floor(i / 5) + 1}-L${(i % 5) + 2}: preserved disc height and signal at position ${i}.`).join(" ");
    return `${filler}\n\n${LONG_TAIL}`;
  }

  it("sends every character of Findings, not the first 800", () => {
    const findings = longFindings();
    expect(findings.length).toBeGreaterThan(1200); // the old slice bound
    const t = resolveRefineTarget({ instruction: "Expand the findings", findings, impression: "", selection: "" });
    expect(t!.selectionText.length).toBeGreaterThan(1200);
    expect(t!.selectionText).toContain("14 mm exophytic cyst");
  });

  it("carries Findings and Impression as labelled sections", () => {
    const t = resolveRefineTarget({
      instruction: "Improve the impression",
      findings: "Disc bulge at L4-L5.",
      impression: "Degenerative disc disease.",
      selection: "",
    });
    expect(t!.selectionText).toContain("FINDINGS:\nDisc bulge at L4-L5.");
    expect(t!.selectionText).toContain("IMPRESSION:\nDegenerative disc disease.");
  });

  it("includes Recommendation only when the report has one", () => {
    const without = resolveRefineTarget({
      instruction: "Tidy it", findings: "F", impression: "I", recommendation: "  ", selection: "",
    });
    const withRec = resolveRefineTarget({
      instruction: "Tidy it", findings: "F", impression: "I", recommendation: "MRI lumbar spine follow-up.", selection: "",
    });
    expect(without!.selectionText).not.toContain("RECOMMENDATION:");
    expect(without!.selectionText).not.toContain("MRI lumbar spine follow-up.");
    expect(withRec!.selectionText).toContain("RECOMMENDATION:\nMRI lumbar spine follow-up.");
  });
});

describe("Refine Report — a selection refines the selection", () => {
  it("keeps the selected text as the target", () => {
    const t = resolveRefineTarget({
      instruction: "Make this sentence concise",
      findings: "Broad-based disc bulge at L4-L5 with lateral recess narrowing.",
      impression: "Multilevel degenerative change.",
      selection: "Broad-based disc bulge at L4-L5",
    });
    expect(t!.jobKind).toBe("SELECTION_EDIT");
    expect(t!.selectionText).toBe("Broad-based disc bulge at L4-L5");
    expect(t!.selectionField).toBe("FINDINGS");
  });

  it("attributes a selection to the Impression when only the Impression contains it", () => {
    const t = resolveRefineTarget({
      instruction: "Shorten this",
      findings: "Disc desiccation L4-L5.",
      impression: "Multilevel degenerative disc disease with facet arthropathy.",
      selection: "facet arthropathy",
    });
    expect(t!.selectionField).toBe("IMPRESSION");
  });

  it("stays with Findings when the text appears in both sections", () => {
    const shared = "disc desiccation";
    const t = resolveRefineTarget({
      instruction: "Tighten this",
      findings: `Multilevel ${shared}.`,
      impression: `Facet joints normal; ${shared} noted.`,
      selection: shared,
    });
    expect(t!.selectionField).toBe("FINDINGS");
  });

  it("attributes a selection taken from the Recommendation to the Recommendation", () => {
    // The bug this pins: the Recommendation box is the third editable prose
    // section, the snapshot carries `recommendationText`, and the server's
    // `selectionField` enum and `materializeAcceptedText` both already handle
    // RECOMMENDATION — but this module could only ever answer FINDINGS or
    // IMPRESSION. Selecting "6-month interval follow-up" and pressing Refine
    // therefore asked the model to refine the Findings, and Accept wrote the
    // reworded recommendation sentence into the Findings section.
    const t = resolveRefineTarget({
      instruction: "Make this clearer",
      findings: "Broad-based disc bulge at L4-L5.",
      impression: "Multilevel degenerative change.",
      recommendation: "Clinical correlation. 6-month interval follow-up.",
      selection: "6-month interval follow-up",
    });
    expect(t!.jobKind).toBe("SELECTION_EDIT");
    expect(t!.selectionField).toBe("RECOMMENDATION");
  });

  it("does not hand the Recommendation over when the same words are in the Findings", () => {
    // Findings keeps winning every tie it used to win: the recommendation often
    // repeats a level or a sign that is also in the body of the report.
    const t = resolveRefineTarget({
      instruction: "Tighten this",
      findings: "Disc bulge at L4-L5.",
      impression: "Degenerative change.",
      recommendation: "Focus on L4-L5 for follow-up.",
      selection: "L4-L5",
    });
    expect(t!.selectionField).toBe("FINDINGS");
  });

  it("still reports FINDINGS for a selection that is in no prose section", () => {
    // Unchanged behaviour, pinned: a selection from the clinical-history box, or
    // text the radiologist edited away between selecting and pressing Refine,
    // must not become a RECOMMENDATION edit it was never asked for.
    const t = resolveRefineTarget({
      instruction: "Explain this",
      findings: "Disc bulge at L4-L5.",
      impression: "Degenerative change.",
      recommendation: "Follow-up in 6 months.",
      selection: "right leg pain since 3 weeks",
    });
    expect(t!.selectionField).toBe("FINDINGS");
  });
});

describe("Refine Report — nothing is invented when the draft is empty", () => {
  it("refuses to enqueue an empty instruction", () => {
    expect(resolveRefineTarget({ instruction: "   ", findings: "F", impression: "I", selection: "" })).toBeNull();
  });

  it("still returns a target when the draft has no text yet, so Generate is the action to use", () => {
    const t = resolveRefineTarget({ instruction: "Add normal anatomy", findings: "", impression: "", selection: "" });
    expect(t!.selectionText).toContain("FINDINGS:");
  });
});
