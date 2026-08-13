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
});
