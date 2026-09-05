import { describe, expect, it } from "vitest";
import { deriveStudyReadyStatus } from "./studyReadyStatus";

describe("deriveStudyReadyStatus", () => {
  it("restored draft status is accurate and has no Undo", () => {
    const s = deriveStudyReadyStatus({
      restoredDraft: true,
      appliedNormalFormat: false,
      protocolLoaded: false,
      emptyNeedsStart: false,
    });
    expect(s.label).toBe("Restored your draft");
    expect(s.canUndo).toBe(false);
  });

  it("auto-applied format status is accurate and Undo-able", () => {
    const s = deriveStudyReadyStatus({
      restoredDraft: false,
      appliedNormalFormat: true,
      normalFormatName: "Normal MRI Brain",
      protocolLoaded: true,
      protocolName: "MRI Brain",
      emptyNeedsStart: false,
    });
    expect(s.label).toBe("Applied Normal MRI Brain");
    expect(s.canUndo).toBe(true);
    expect(s.kind).toBe("applied_normal_format");
  });

  it("never claims Applied Normal unless that mutation happened", () => {
    const s = deriveStudyReadyStatus({
      restoredDraft: false,
      appliedNormalFormat: false,
      protocolLoaded: true,
      protocolName: "MRI Brain",
      emptyNeedsStart: true,
    });
    expect(s.label).not.toMatch(/Applied/i);
    expect(s.label).toContain("Protocol loaded");
    expect(s.canUndo).toBe(false);
  });

  it("empty report · Start Report", () => {
    const s = deriveStudyReadyStatus({
      restoredDraft: false,
      appliedNormalFormat: false,
      protocolLoaded: false,
      emptyNeedsStart: true,
    });
    expect(s.label).toBe("Empty report · Start Report");
    expect(s.canUndo).toBe(false);
  });

  it("restored draft · protocol", () => {
    const s = deriveStudyReadyStatus({
      restoredDraft: true,
      appliedNormalFormat: false,
      protocolLoaded: true,
      protocolName: "MRI Brain",
      emptyNeedsStart: false,
    });
    expect(s.label).toBe("Restored draft · protocol MRI Brain");
    expect(s.canUndo).toBe(false);
  });
});
