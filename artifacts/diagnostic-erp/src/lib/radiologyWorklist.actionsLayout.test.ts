import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  resolve(__dirname, "../pages/RadiologyWorklist.tsx"),
  "utf8",
);

describe("PACS worklist actions + unlinked bills UX", () => {
  it("keeps Focus on the same nowrap row immediately after Weasis", () => {
    expect(src).toContain('data-testid="worklist-actions-row"');
    expect(src).toContain("flex flex-nowrap");
    const weasisIdx = src.indexOf('label="Weasis"');
    const focusIdx = src.indexOf('label="Focus"');
    const ohifIdx = src.indexOf('label="OHIF"');
    expect(weasisIdx).toBeGreaterThan(0);
    expect(focusIdx).toBeGreaterThan(weasisIdx);
    expect(ohifIdx).toBeGreaterThan(focusIdx);
  });

  it("clarifies unlinked bills and offers auto-link", () => {
    expect(src).toContain("without a linked bill");
    expect(src).toContain('data-testid="pacs-auto-link-bills"');
    expect(src).toContain("auto-link-billed-study");
    expect(src).toContain("Unlinked");
  });

  it("overnight AI drafts filter surfaces the AI Draft column and status chips", () => {
    expect(src).toContain("toggleOvernightAiDrafts");
    expect(src).toContain("aiDraft: true");
    expect(src).toContain('data-testid="overnight-ai-drafts-filters"');
    expect(src).toContain("compareOvernightWorklistRows");
  });
});
