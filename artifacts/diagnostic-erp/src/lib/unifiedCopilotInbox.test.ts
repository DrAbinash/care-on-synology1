import { describe, expect, it } from "vitest";
import { buildUnifiedInboxExtras, mergeCopilotItems } from "./unifiedCopilotInbox";
import type { CopilotItem } from "./copilotOrchestrator";

describe("buildUnifiedInboxExtras", () => {
  it("adds prior comparison item when missing", () => {
    const items = buildUnifiedInboxExtras({
      measurementSafetyIssues: [],
      comparisonSectionMissing: true,
      checklistRemaining: [],
      qualityIssues: [],
    });
    expect(items.some((i) => i.id === "inbox-prior-comparison-missing")).toBe(true);
  });

  it("adds measurement safety issues", () => {
    const items = buildUnifiedInboxExtras({
      measurementSafetyIssues: [{ id: "meas-1", severity: "critical", message: "LVEF not mentioned" }],
      comparisonSectionMissing: false,
      checklistRemaining: [],
      qualityIssues: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("measurement");
  });
});

describe("mergeCopilotItems", () => {
  it("dedupes by id", () => {
    const core: CopilotItem[] = [{
      id: "a", category: "missing", severity: "info", title: "A", detail: "", why: "", confidence: "high",
    }];
    const extras: CopilotItem[] = [
      { id: "a", category: "critical", severity: "critical", title: "dup", detail: "", why: "", confidence: "low" },
      { id: "b", category: "missing", severity: "warning", title: "B", detail: "", why: "", confidence: "medium" },
    ];
    const merged = mergeCopilotItems(core, extras);
    expect(merged).toHaveLength(2);
    expect(merged[0].title).toBe("A");
  });
});
