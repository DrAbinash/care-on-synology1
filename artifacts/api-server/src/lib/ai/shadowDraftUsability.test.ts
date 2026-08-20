import { describe, expect, it } from "vitest";
import {
  classifyShadowDraftUsability,
  buildWorklistAiDraftPointer,
  hasUsableClinicalDraft,
} from "./shadowDraftUsability";

describe("classifyShadowDraftUsability", () => {
  it("marks READY when grounded findings exist", () => {
    const u = classifyShadowDraftUsability({
      acceptedFindings: [{ text: "Normal parenchyma" }],
      quarantinedFindings: [],
      impression: [],
      candidateCount: 1,
    });
    expect(u.clinicalStatus).toBe("READY");
    expect(u.usable).toBe(true);
  });

  it("marks READY when impression alone is usable (normal study)", () => {
    const u = classifyShadowDraftUsability({
      acceptedFindings: [],
      quarantinedFindings: [],
      impression: ["No significant intracranial abnormality detected on the supplied images."],
      candidateCount: 0,
    });
    expect(u.clinicalStatus).toBe("READY");
    expect(u.usable).toBe(true);
    expect(u.impressionCount).toBe(1);
  });

  it("marks EMPTY for gateway/model empty output — never READY", () => {
    const u = classifyShadowDraftUsability({
      acceptedFindings: [],
      quarantinedFindings: [],
      impression: [],
      candidateCount: 0,
      degraded: true,
      imageCount: 8,
    });
    expect(u.clinicalStatus).toBe("EMPTY");
    expect(u.emptyReason).toBe("degraded_empty");
    expect(u.usable).toBe(false);
  });

  it("marks QUARANTINED when all candidates are withheld", () => {
    const u = classifyShadowDraftUsability({
      acceptedFindings: [],
      quarantinedFindings: [
        { reasons: ["ungrounded — no valid evidence anchor in the study snapshot"] },
        { reasons: ["ungrounded — no valid evidence anchor in the study snapshot"] },
      ],
      impression: [],
      candidateCount: 2,
    });
    expect(u.clinicalStatus).toBe("QUARANTINED");
    expect(u.quarantinedCount).toBe(2);
    expect(u.quarantineReasonClasses[0]?.count).toBe(2);
  });

  it("buildWorklistAiDraftPointer carries clinicalStatus EMPTY for draftId-19 shape", () => {
    const usability = classifyShadowDraftUsability({
      acceptedFindings: [],
      quarantinedFindings: [],
      impression: [],
      candidateCount: 0,
      degraded: false,
    });
    const pointer = buildWorklistAiDraftPointer({
      draftId: 19,
      version: 1,
      source: "ai_shadow",
      findingsText: "",
      impression: [],
      usability,
      imageCount: 0,
      degraded: false,
    });
    expect(pointer.clinicalStatus).toBe("EMPTY");
    expect(pointer.findingCount).toBe(0);
    expect(hasUsableClinicalDraft({ findingsText: "", impression: [] })).toBe(false);
  });
});
