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

  it("shows the named provider cause in the dialog payload and technical block", () => {
    const shaped = shapeWorklistAiDraftViewer({
      stored: {
        source: "ai_shadow_degraded",
        draftId: 19,
        version: 1,
        findingCount: 0,
        findings: "",
        impression: [],
        clinicalStatus: "EMPTY",
        imageCount: 6,
        degraded: true,
        providerFailureCode: "OUTPUT_BUDGET_EXHAUSTED",
        providerFailureDetail:
          "num_predict budget exhausted with empty content (eval=4096 num_predict=4096 thinkingLen=4090)",
      },
      shadow: shadow({ findings: [], impression: [], degraded: true }),
    });

    expect(shaped.clinicalStatus).toBe("EMPTY");
    expect(shaped.emptyReasonLabel).toMatch(/entire answer budget/);
    expect(shaped.providerFailureCode).toBe("OUTPUT_BUDGET_EXHAUSTED");
    expect(shaped.technical).toMatchObject({
      providerFailureCode: "OUTPUT_BUDGET_EXHAUSTED",
      providerFailureDetail: expect.stringContaining("eval=4096"),
    });
  });

  it("reports no cause for a row written before failures were named", () => {
    const shaped = shapeWorklistAiDraftViewer({
      stored: {
        source: "ai_shadow_degraded",
        draftId: 12,
        findingCount: 0,
        findings: "",
        impression: [],
        clinicalStatus: "EMPTY",
        degraded: true,
      },
      shadow: null,
    });

    expect(shaped.providerFailureCode).toBeNull();
    expect(shaped.providerFailureDetail).toBeNull();
    expect(shaped.emptyReasonLabel).toMatch(/provider\/parse failure/);
  });
});
