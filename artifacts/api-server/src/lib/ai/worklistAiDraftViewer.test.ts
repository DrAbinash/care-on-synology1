import { describe, expect, it } from "vitest";
import { shapeWorklistAiDraftViewer } from "./worklistAiDraftViewer";
import type { WorkspaceDraft } from "./draftService";

const shadow = (overrides: Partial<WorkspaceDraft> = {}): WorkspaceDraft => ({
  draftId: 19,
  version: 1,
  studyInstanceUid: "1.2.3",
  status: "shadow",
  degraded: false,
  qualityScore: 80,
  findings: [
    {
      key: "f0",
      text: "Brain parenchyma demonstrates normal signal intensity.",
      laterality: "none",
      evidence: [],
    },
  ],
  quarantinedCount: 0,
  measurements: [],
  impression: ["Normal MRI brain study."],
  provenance: {
    modelVersion: "m1",
    promptVersion: "p1",
    rulesVersion: "r1",
    degraded: false,
    createdAt: "2026-08-20T15:50:05.506Z",
  },
  ...overrides,
});

describe("shapeWorklistAiDraftViewer", () => {
  it("prefers authoritative shadow draft over empty worklist pointer", () => {
    const shaped = shapeWorklistAiDraftViewer({
      stored: {
        source: "ai_shadow",
        draftId: 19,
        version: 1,
        findingCount: 0,
        findings: "",
        impression: [],
        updatedAt: "2026-08-20T15:50:05.506Z",
      },
      shadow: shadow(),
    });

    expect(shaped.usable).toBe(true);
    expect(shaped.clinicalStatus).toBe("READY");
    expect(shaped.findingsText).toContain("Brain parenchyma");
    expect(shaped.impression).toEqual(["Normal MRI brain study."]);
    expect(shaped.findingCount).toBe(1);
    expect(shaped.draftId).toBe(19);
  });

  it("classifies draftId-19 empty pointer as EMPTY (not READY)", () => {
    const shaped = shapeWorklistAiDraftViewer({
      stored: {
        source: "ai_shadow",
        draftId: 19,
        version: 1,
        findingCount: 0,
        findings: "",
        impression: [],
        updatedAt: "2026-08-20T15:50:05.506Z",
      },
      shadow: shadow({ findings: [], impression: [], quarantinedCount: 0 }),
    });

    expect(shaped.usable).toBe(false);
    expect(shaped.clinicalStatus).toBe("EMPTY");
    expect(shaped.findingsText).toBe("");
    expect(shaped.impression).toEqual([]);
  });

  it("classifies all-quarantined drafts as QUARANTINED", () => {
    const shaped = shapeWorklistAiDraftViewer({
      stored: {
        source: "ai_shadow",
        draftId: 21,
        findingCount: 0,
        findings: "",
        impression: [],
        candidateCount: 2,
        quarantinedCount: 2,
        clinicalStatus: "QUARANTINED",
        quarantineReasonClasses: [
          { reason: "ungrounded — no valid evidence anchor in the study snapshot", count: 2 },
        ],
      },
      shadow: null,
    });
    expect(shaped.clinicalStatus).toBe("QUARANTINED");
    expect(shaped.usable).toBe(false);
    expect(shaped.quarantineReasonClasses[0]?.count).toBe(2);
  });

  it("falls back to stored findings string when no shadow row exists", () => {
    const shaped = shapeWorklistAiDraftViewer({
      stored: {
        source: "ai_shadow",
        draftId: 7,
        findings: "Line A\nLine B",
        impression: ["Impression A"],
        findingCount: 2,
        clinicalStatus: "READY",
      },
      shadow: null,
    });

    expect(shaped.usable).toBe(true);
    expect(shaped.findings).toEqual([{ text: "Line A\nLine B" }]);
    expect(shaped.impression).toEqual(["Impression A"]);
  });

  it("returns empty payload when nothing is stored", () => {
    const shaped = shapeWorklistAiDraftViewer({ stored: null, shadow: null });
    expect(shaped.usable).toBe(false);
    expect(shaped.clinicalStatus).toBe("EMPTY");
    expect(shaped.draftId).toBeNull();
  });
});
