import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("empty report names the generator the workspace actually shows", () => {
    const s = deriveStudyReadyStatus({
      restoredDraft: false,
      appliedNormalFormat: false,
      protocolLoaded: false,
      emptyNeedsStart: true,
    });
    expect(s.label).toBe("Empty report · press Generate Professional Report");
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

  // A normal report that did not arrive used to be visible only as an empty page.
  describe("why no normal report arrived", () => {
    const REASON = "No normal report for this exam — Choose a format in Starting Canvas.";

    it("says it on the blank page, instead of a generic empty-report line", () => {
      const s = deriveStudyReadyStatus({
        restoredDraft: false,
        appliedNormalFormat: false,
        protocolLoaded: true,
        protocolName: "MRI LS Spine",
        emptyNeedsStart: true,
        normalSkipReason: REASON,
      });
      expect(s.kind).toBe("normal_not_applied");
      expect(s.label).toBe(REASON);
      // Undo would be a lie: nothing was mutated.
      expect(s.canUndo).toBe(false);
    });

    it("stays quiet when a normal report did arrive", () => {
      const s = deriveStudyReadyStatus({
        restoredDraft: false,
        appliedNormalFormat: true,
        normalFormatName: "MRI Brain — Standard Normal",
        protocolLoaded: true,
        emptyNeedsStart: false,
        normalSkipReason: REASON,
      });
      expect(s.kind).toBe("applied_normal_format");
      expect(s.label).not.toContain("No normal report");
    });

    it("stays quiet when his own draft came back — the page is not empty", () => {
      const s = deriveStudyReadyStatus({
        restoredDraft: true,
        appliedNormalFormat: false,
        protocolLoaded: false,
        emptyNeedsStart: false,
        normalSkipReason: REASON,
      });
      expect(s.label).toBe("Restored your draft");
    });

    it("says nothing it did not actually decide", () => {
      const s = deriveStudyReadyStatus({
        restoredDraft: false,
        appliedNormalFormat: false,
        protocolLoaded: false,
        emptyNeedsStart: true,
      });
      expect(s.label).toBe("Empty report · press Generate Professional Report");
      expect(s.kind).toBe("empty_start");
    });
  });

  // The rule above is pure; this is the wiring that makes it reach his eyes. There is
  // no browser harness on this machine, so the effect is pinned at source rather than
  // simulated — stated plainly so nobody reads the green as a clicked-through UI.
  describe("the workspace actually reports the reason", () => {
    const hook = readFileSync(
      resolve(__dirname, "../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx"),
      "utf8",
    );

    it("records the same wording the Quick Normal button gives", () => {
      expect(hook).toMatch(/const why = quickNormalOutcomeMessage\(decision\);/);
      expect(hook).toMatch(/setNormalSkipReason\(`\$\{why\.title\} — \$\{why\.description\}`\)/);
    });

    it("clears it when a normal report did arrive, and hands it to the status strip", () => {
      expect(hook).toContain("setNormalSkipReason(null)");
      // Inside the options object, not merely somewhere after it: the dependency
      // array mentions the same name, and a guard that matches that would pass
      // whether or not the strip is actually fed.
      expect(hook).toMatch(/deriveStudyReadyStatus\(\{[^}]*normalSkipReason,/);
    });
  });
});
