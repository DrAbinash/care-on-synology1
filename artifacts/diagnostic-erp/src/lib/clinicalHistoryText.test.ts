import { describe, it, expect } from "vitest";
import { appendClinicalPhrase, removeClinicalPhrase, hasPhrase } from "./clinicalHistoryText";

// Tests for the Clinical History quick-select chip text model.
// Invariants:
//   1. A chip's exact phrase is never inserted twice (duplicate-safe).
//   2. Toggling a chip OFF removes exactly what it inserted, tidying only the
//      seam — line breaks and spacing typed elsewhere survive.
//   3. Manually typed history always survives insert + remove round-trips, and
//      an edited-away phrase is never force-removed.
//   4. "present" and "removable" use the same exact match, so a highlighted
//      chip can always be toggled back off.

describe("appendClinicalPhrase", () => {
  it("inserts into an empty field", () => {
    expect(appendClinicalPhrase("", "Headache.")).toBe("Headache.");
  });

  it("appends with a single space when the base already ends in a period", () => {
    expect(appendClinicalPhrase("Headache.", "Vomiting.")).toBe("Headache. Vomiting.");
  });

  it("adds a sentence terminator when the base does not end in one", () => {
    expect(appendClinicalPhrase("Headache", "Vomiting.")).toBe("Headache. Vomiting.");
  });

  it("is duplicate-safe for an exact repeat", () => {
    expect(appendClinicalPhrase("Headache. Vomiting.", "Vomiting.")).toBe("Headache. Vomiting.");
  });

  it("preserves a trailing line break, appending after it", () => {
    expect(appendClinicalPhrase("History:\n", "Headache.")).toBe("History:\nHeadache.");
  });

  it("never clobbers manually typed history — only appends", () => {
    const manual = "Patient with 3 days of fever.";
    expect(appendClinicalPhrase(manual, "Headache.")).toBe("Patient with 3 days of fever. Headache.");
  });
});

describe("removeClinicalPhrase", () => {
  it("removes a trailing inserted phrase and trims", () => {
    expect(removeClinicalPhrase("Headache. Vomiting.", "Vomiting.")).toBe("Headache.");
  });

  it("removes a leading inserted phrase and trims", () => {
    expect(removeClinicalPhrase("Headache. Vomiting.", "Headache.")).toBe("Vomiting.");
  });

  it("removes a middle phrase without leaving doubled spaces", () => {
    expect(removeClinicalPhrase("Headache. Vomiting. Seizure.", "Vomiting.")).toBe("Headache. Seizure.");
  });

  it("preserves an intentional blank line elsewhere in the field", () => {
    // The removed phrase is at the end; the paragraph break must survive.
    expect(removeClinicalPhrase("History:\n\nKnown hypertensive. Headache.", "Headache."))
      .toBe("History:\n\nKnown hypertensive.");
  });

  it("preserves double-spaces the user typed away from the seam", () => {
    expect(removeClinicalPhrase("Known  hypertensive. Headache.", "Headache."))
      .toBe("Known  hypertensive.");
  });

  it("is a no-op when the phrase was edited away (protects manual edits)", () => {
    const edited = "Severe headache since morning.";
    expect(removeClinicalPhrase(edited, "Headache.")).toBe(edited);
  });

  it("round-trips: append then remove restores the original manual text", () => {
    const manual = "Known hypertensive.";
    const withChip = appendClinicalPhrase(manual, "Stroke symptoms noted.");
    expect(removeClinicalPhrase(withChip, "Stroke symptoms noted.")).toBe(manual);
  });

  it("round-trips while preserving an internal line break", () => {
    const manual = "Line one.\nLine two.";
    const withChip = appendClinicalPhrase(manual, "Headache.");
    expect(withChip).toBe("Line one.\nLine two. Headache.");
    expect(removeClinicalPhrase(withChip, "Headache.")).toBe(manual);
  });
});

describe("hasPhrase", () => {
  it("detects an exact inserted phrase and matches removal semantics", () => {
    expect(hasPhrase("Headache. Vomiting.", "Vomiting.")).toBe(true);
    expect(hasPhrase("Headache.", "Seizure.")).toBe(false);
    // present ⇔ removable: if hasPhrase is true, removeClinicalPhrase changes it.
    const text = "Headache. Vomiting.";
    expect(removeClinicalPhrase(text, "Vomiting.")).not.toBe(text);
  });
});
