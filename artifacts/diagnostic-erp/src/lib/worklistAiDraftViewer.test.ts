import { describe, expect, it } from "vitest";
import { normalizeWorklistAiDraftViewer } from "./worklistAiDraftViewer";

describe("normalizeWorklistAiDraftViewer", () => {
  it("renders shaped findings and impression", () => {
    const n = normalizeWorklistAiDraftViewer({
      findings: [{ key: "f0", text: "Normal parenchyma" }],
      impression: ["Normal study"],
      empty: false,
      findingCount: 1,
    });
    expect(n.empty).toBe(false);
    expect(n.findings[0]?.text).toBe("Normal parenchyma");
    expect(n.impression).toEqual(["Normal study"]);
  });

  it("treats the legacy empty READY pointer as empty (not raw JSON dump)", () => {
    const n = normalizeWorklistAiDraftViewer({
      source: "ai_shadow",
      draftId: 19,
      version: 1,
      findingCount: 0,
      findings: "",
      impression: [],
      updatedAt: "2026-08-20T15:50:05.506Z",
    });
    expect(n.empty).toBe(true);
    expect(n.findings).toEqual([]);
    expect(n.draftId).toBe(19);
  });
});
