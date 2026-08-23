import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  resolve(__dirname, "../components/radiology/ReportExportPanel.tsx"),
  "utf8",
);

describe("ReportExportPanel — enlarge preview before finalize", () => {
  it("exposes a compact-preview enlarge control without a full-bleed overlay", () => {
    expect(src).toContain('data-testid="report-layout-preview-enlarge"');
    expect(src).toContain("Print Preview");
    // Full-bleed overlay over the preview steals wheel → parent column scrolls.
    expect(src).not.toMatch(
      /report-layout-preview-inline-scroll[\s\S]{0,500}absolute inset-0[\s\S]{0,200}report-layout-preview-enlarge/,
    );
  });

  it("opens a full-page dialog with the same preview HTML", () => {
    expect(src).toContain('data-testid="report-layout-preview-dialog"');
    expect(src).toContain('data-testid="report-layout-preview-enlarged"');
    expect(src).toContain("Review before finalize");
  });

  it("exposes Enlarge actions in the toolbar", () => {
    expect(src).toContain('data-testid="report-layout-preview-enlarge-btn"');
    expect(src).toContain('data-testid="report-layout-preview-enlarge-header"');
    expect(src).toMatch(/report-layout-preview-enlarge-header[\s\S]{0,400}Print Preview/);
  });

  it("keeps enlarged preview scroll on the outer pane (iframe does not eat wheel)", () => {
    expect(src).toContain('data-testid="report-layout-preview-scroll"');
    expect(src).toContain("overflow-y-auto");
    expect(src).toMatch(/report-layout-preview-enlarged[\s\S]{0,200}pointer-events-none|pointer-events-none[\s\S]{0,200}report-layout-preview-enlarged/);
    expect(src).toMatch(/width:\s*794/);
  });

  it("scrolls the compact Classic/Premium preview on an outer pane (not the iframe)", () => {
    expect(src).toContain('data-testid="report-layout-preview-inline-scroll"');
    expect(src).toMatch(
      /report-layout-preview-inline-scroll[\s\S]{0,160}overflow-y-scroll|overflow-y-scroll[\s\S]{0,160}report-layout-preview-inline-scroll/,
    );
    expect(src).toContain("inlineScrollRef");
    expect(src).toContain("measureIframeDocHeight");
    expect(src).toContain('onLoad={(e) => syncPreviewHeight');
    expect(src).toMatch(/addEventListener\("wheel"/);
    expect(src).toMatch(/passive:\s*false/);
    expect(src).toMatch(/el\.scrollTop \+= e\.deltaY/);
    expect(src).toContain("docHeightPx");
    expect(src).toContain("MIN_PREVIEW_PAGE_PX");
  });

  it("measures multi-page print HTML so the scrollbar reaches every page", () => {
    expect(src).toContain(".care-doc-page");
    expect(src).toContain("enlargedScrollRef");
  });

  it("supports preview section edit when onEditSection is wired", () => {
    expect(src).toContain('data-testid="report-preview-edit-sections"');
    expect(src).toContain("double-click to edit a section");
    expect(src).toContain("onEditSection");
  });

  it("double-click opens section picker when onEditSection is wired", () => {
    expect(src).toContain("onEditSection");
    expect(src).toContain("handlePreviewDoubleClick");
    expect(src).toContain('data-testid="report-preview-edit-sections"');
    expect(src).toMatch(/onDoubleClick=\{handlePreviewDoubleClick\}/);
  });

  it("exposes Finalize in the export toolbar and enlarged preview", () => {
    expect(src).toContain("onFinalize");
    expect(src).toContain('data-testid="report-layout-finalize-btn"');
    expect(src).toContain('data-testid="report-preview-finalize"');
  });
});
