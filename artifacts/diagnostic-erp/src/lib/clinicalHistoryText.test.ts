import { describe, it, expect } from "vitest";
import {
  appendClinicalPhrase,
  removeClinicalPhrase,
  hasPhrase,
  historyTemplateNeedsSide,
  resolveHistoryPhrase,
  hasHistoryChipContribution,
  toggleHistoryChipContribution,
} from "./clinicalHistoryText";

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
    const text = "Headache. Vomiting.";
    expect(removeClinicalPhrase(text, "Vomiting.")).not.toBe(text);
  });
});

describe("laterality history chips", () => {
  it("detects {side} templates and resolves them", () => {
    expect(historyTemplateNeedsSide("{side} upper limb weakness.")).toBe(true);
    expect(historyTemplateNeedsSide("Neck pain.")).toBe(false);
    expect(resolveHistoryPhrase("{side} upper limb weakness.", "right")).toMatch(/right upper limb weakness/i);
  });

  it("toggle asks for side then inserts; toggle off removes only that contribution", () => {
    const tpl = "{side} upper limb radiculopathy.";
    const ask = toggleHistoryChipContribution("", tpl);
    expect(ask.needsSide).toBe(true);
    expect(ask.next).toBe("");

    const inserted = toggleHistoryChipContribution("Neck pain.", tpl, "right");
    expect(inserted.needsSide).toBe(false);
    expect(inserted.next).toMatch(/Neck pain\..*right upper limb radiculopathy/i);
    expect(hasHistoryChipContribution(inserted.next, tpl)).toBe(true);

    const removed = toggleHistoryChipContribution(inserted.next, tpl);
    expect(removed.next).toBe("Neck pain.");
  });

  it("preserves manual text when laterality phrase was edited", () => {
    const tpl = "{side} upper limb weakness.";
    const edited = "Severe right upper limb weakness for 3 months.";
    expect(hasHistoryChipContribution(edited, tpl)).toBe(false);
  });
});
