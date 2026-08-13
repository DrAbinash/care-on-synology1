import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ERP_SRC = resolve(__dirname, "..");

const workspace = readFileSync(resolve(ERP_SRC, "pages/RadiologyReportingWorkspace.tsx"), "utf8");

describe("RadiologyReportingWorkspace — consolidation contracts", () => {
  it("uses the canonical report demography model", () => {
    expect(workspace).toContain("mergeReportDemography");
    expect(workspace).toContain("resolveDisplayAge");
    expect(workspace).toContain("canonicalDemography");
  });

  it("renders exactly one visible Technique editor", () => {
    const matches = workspace.match(/field="technique"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("marks the technique editor as canonical", () => {
    expect(workspace).toContain('data-testid="canonical-technique-editor"');
  });

  it("keeps the demography card as the first editor section", () => {
    const demographyIdx = workspace.indexOf("<ReportDemographyCard");
    const techniqueIdx = workspace.indexOf('data-testid="canonical-technique-editor"');
    const findingsIdx = workspace.indexOf('field="findings"');
    expect(demographyIdx).toBeGreaterThan(-1);
    expect(demographyIdx).toBeLessThan(techniqueIdx);
    expect(techniqueIdx).toBeLessThan(findingsIdx);
  });

  it("Preview + PDF export consume canonicalDemography", () => {
    expect(workspace).toMatch(/patientName:\s*canonicalDemography\.patientName/);
    expect(workspace).toMatch(/age:\s*canonicalDemography\.age/);
    expect(workspace).toMatch(/sex:\s*canonicalDemography\.sex/);
  });

  it("uses shared mergeField for Quick Findings / protocol / companion (provenance)", () => {
    expect(workspace).toContain('mergeField("findings"');
    expect(workspace).toContain('"quick-findings"');
    expect(workspace).toContain('"protocol"');
    expect(workspace).toContain('"companion"');
    expect(workspace).not.toContain("mergeReportFieldContent(");
  });
});

const findingsEditor = readFileSync(
  resolve(ERP_SRC, "components/radiology/zai-workspace/findings-editor.tsx"),
  "utf8",
);
const previewHtml = readFileSync(resolve(ERP_SRC, "lib/radiologyReportPreviewHtml.ts"), "utf8");

describe("Provenance visualization — editor only", () => {
  it("FindingsEditor renders provenance legend/map as editor-only", () => {
    expect(findingsEditor).toContain('data-editor-only="provenance"');
    expect(findingsEditor).toContain("provenance-legend");
    expect(findingsEditor).toContain("formatProvenanceHover");
  });

  it("preview HTML builder never references provenance", () => {
    expect(previewHtml).not.toMatch(/provenance|quick-select|quick-findings|Source:/i);
  });
});
