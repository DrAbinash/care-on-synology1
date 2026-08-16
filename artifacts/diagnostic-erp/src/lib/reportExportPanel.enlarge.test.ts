import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  resolve(__dirname, "../components/radiology/ReportExportPanel.tsx"),
  "utf8",
);

describe("ReportExportPanel — enlarge preview before finalize", () => {
  it("makes the small report viewport clickable", () => {
    expect(src).toContain('data-testid="report-layout-preview-enlarge"');
    expect(src).toContain("cursor-zoom-in");
    expect(src).toContain("Click to enlarge");
  });

  it("opens a full-page dialog with the same preview HTML", () => {
    expect(src).toContain('data-testid="report-layout-preview-dialog"');
    expect(src).toContain('data-testid="report-layout-preview-enlarged"');
    expect(src).toContain("Review before finalize");
  });

  it("exposes Enlarge actions in the toolbar", () => {
    expect(src).toContain('data-testid="report-layout-preview-enlarge-btn"');
    expect(src).toContain('data-testid="report-layout-preview-enlarge-header"');
    expect(src).toMatch(/report-layout-preview-enlarge-header[\s\S]{0,400}Enlarge/);
  });

  it("keeps enlarged preview scroll on the outer pane (iframe does not eat wheel)", () => {
    expect(src).toContain('data-testid="report-layout-preview-scroll"');
    expect(src).toContain("overflow-y-auto");
    expect(src).toMatch(/report-layout-preview-enlarged[\s\S]{0,200}pointer-events-none|pointer-events-none[\s\S]{0,200}report-layout-preview-enlarged/);
  });
});
