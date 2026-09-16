import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(SRC, rel), "utf8");
const workspace = read("pages/RadiologyReportingWorkspace.tsx");
const tools = read("components/radiology/ReportingToolsPanel.tsx");
const quickSelect = read("components/radiology/zai-workspace/quick-select-strip.tsx");

describe("authoritative manual reporting surface", () => {
  it("has one Starting Canvas and one Reporting Tools shell", () => {
    expect(workspace.match(/data-testid="full-normal-starting-canvas"/g)).toHaveLength(1);
    expect(workspace.match(/<ReportingToolsPanel/g)).toHaveLength(1);
    expect(tools.match(/data-testid="reporting-tools"/g)).toHaveLength(1);
  });

  it("keeps exactly one runtime canonical Findings and Impression editor", () => {
    expect(workspace.match(/field="findings"/g)).toHaveLength(1);
    expect(workspace.match(/field="impression"/g)).toHaveLength(2);
    // The second impression occurrence is QuickSelectStrip support; only one
    // FindingsEditor owns the canonical impression textarea.
    expect(workspace.match(/<FindingsEditor field="impression"/g)).toHaveLength(1);
    expect(workspace).toContain("{false && useStructured ? (");
    expect(workspace).toContain(") : false && studySetup.highlightFindings ? (");
  });

  it("offers every Quick Insert source without combining its plumbing", () => {
    for (const source of ["quick-select", "quick-add", "macros", "snippets", "composer"]) {
      expect(tools).toContain(`id: "${source}"`);
      expect(workspace).toContain(`quickInsertSource === "${source}"`);
    }
    expect(workspace).toContain("<QuickSelectStrip");
    expect(workspace).toContain("<QuickFindingsPanel");
    expect(workspace).toContain("<ChocolateBoxMacros");
    expect(workspace).toContain("<PersonalTemplateRail");
    expect(workspace).toContain("<FindingComposer");
  });

  it("Reporting Tools shell owns no clinical report textarea", () => {
    expect(tools).not.toContain("<textarea");
    expect(tools).not.toContain("<Textarea");
    expect(tools).not.toContain("setField(");
    expect(tools).not.toContain("findingsText");
    expect(tools).not.toContain("impressionText");
  });

  it("removes the unsafe abnormal force bypass", () => {
    expect(quickSelect).not.toContain('force: tile.category === "abnormal"');
    expect(quickSelect).not.toContain('force: tile.category === "critical"');
  });

  it("keeps proven clinical plumbing wired", () => {
    for (const marker of [
      "useStudyLock",
      "useLocalDraftBackup",
      "registerDraftRescueSaver",
      "createEnsureDraftOnce",
      "subscribeCareOhifBridge",
      "finalizeReport",
      "handleExportPdf",
      "handlePrintLikeFinal",
      "<FinalizeSignDialog",
      "<ReportingStickyActionBar",
    ]) {
      expect(workspace).toContain(marker);
    }
  });

  it("keeps one primary finalize affordance in the workspace body", () => {
    expect(workspace).not.toContain("{/* Finalize */}");
    expect(workspace).toContain("onFinalize={finalizeReport}");
    expect(workspace).not.toContain("<ReportExportPanel\n                      onFinalize=");
  });
});
