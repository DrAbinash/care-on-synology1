import { describe, expect, it } from "vitest";
import { normalizeWorklistAiDraftViewer } from "./worklistAiDraftViewer";

describe("normalizeWorklistAiDraftViewer", () => {
  it("renders shaped findings and impression as usable READY", () => {
    const n = normalizeWorklistAiDraftViewer({
      findings: [{ key: "f0", text: "Normal parenchyma" }],
      impression: ["Normal study"],
      empty: false,
      usable: true,
      clinicalStatus: "READY",
      findingCount: 1,
    });
    expect(n.usable).toBe(true);
    expect(n.clinicalStatus).toBe("READY");
    expect(n.findings[0]?.text).toBe("Normal parenchyma");
    expect(n.impression).toEqual(["Normal study"]);
  });

  it("treats the legacy empty READY pointer as EMPTY (not raw JSON dump)", () => {
    const n = normalizeWorklistAiDraftViewer({
      source: "ai_shadow",
      draftId: 19,
      version: 1,
      findingCount: 0,
      findings: "",
      impression: [],
      updatedAt: "2026-08-20T15:50:05.506Z",
    });
    expect(n.usable).toBe(false);
    expect(n.clinicalStatus).toBe("EMPTY");
    expect(n.findings).toEqual([]);
    expect(n.draftId).toBe(19);
  });
});
