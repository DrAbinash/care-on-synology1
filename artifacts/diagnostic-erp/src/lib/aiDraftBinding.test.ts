import { describe, it, expect } from "vitest";
import { shouldInsertOnAction, formatFindingForInsertion, appendToFindings, chooseReportPrefill } from "./aiDraftBinding";

describe("AI draft → editor binding (P3 patch)", () => {
  it("Accept and Edit insert into the draft; Ignore and Reject do not", () => {
    expect(shouldInsertOnAction("accept")).toBe(true);
    expect(shouldInsertOnAction("edit")).toBe(true);
    expect(shouldInsertOnAction("ignore")).toBe(false);
    expect(shouldInsertOnAction("reject")).toBe(false);
  });

  it("formats a finding with laterality for insertion", () => {
    expect(formatFindingForInsertion({ key: "f", text: "renal calculus", laterality: "left" })).toBe("Left: renal calculus");
    expect(formatFindingForInsertion({ key: "f", text: "midline mass", laterality: "none" })).toBe("midline mass");
  });

  it("appends accepted text to existing findings, preserving prior content (edits survive)", () => {
    expect(appendToFindings("Existing radiologist text.", "Left: renal calculus")).toBe("Existing radiologist text.\nLeft: renal calculus");
    expect(appendToFindings("", "first")).toBe("first");
    expect(appendToFindings("kept", "")).toBe("kept"); // empty insert never disturbs the draft
  });

  it("saved human draft ALWAYS wins over AI on reopen (AI never auto-prefills)", () => {
    expect(chooseReportPrefill("radiologist wrote this")).toEqual({ content: "radiologist wrote this", source: "human_draft" });
    // no saved draft → empty editor, NEVER the AI draft (AI enters only via explicit Accept)
    expect(chooseReportPrefill(null)).toEqual({ content: "", source: "empty" });
    expect(chooseReportPrefill("   ")).toEqual({ content: "", source: "empty" });
  });
});
