import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ERP_SRC = resolve(__dirname, "..");

const workspace = readFileSync(resolve(ERP_SRC, "pages/RadiologyReportingWorkspace.tsx"), "utf8");
/** Phase 2: combination/protocol mergeField lives in useVoiceReporting. */
const voiceReporting = readFileSync(
  resolve(ERP_SRC, "hooks/radiology-workspace/useVoiceReporting.ts"),
  "utf8",
);
/** Phase 3: saveDraft / finalize live in dedicated hooks. */
const draftPersistence = readFileSync(
  resolve(ERP_SRC, "hooks/radiology-workspace/useDraftPersistence.ts"),
  "utf8",
);
const studyFinalize = readFileSync(
  resolve(ERP_SRC, "hooks/radiology-workspace/useStudyFinalize.ts"),
  "utf8",
);
const workspaceTree = `${workspace}\n${voiceReporting}\n${draftPersistence}\n${studyFinalize}`;

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
    expect(workspaceTree).toContain('mergeField("findings"');
    expect(workspaceTree).toContain('"quick-findings"');
    expect(workspaceTree).toContain('"protocol"');
    expect(workspaceTree).toContain('"companion"');
    expect(workspaceTree).toContain('"structured-template"');
    expect(workspace).toContain("StructuredFormatPanel");
    expect(workspaceTree).not.toContain("mergeReportFieldContent(");
    expect(workspaceTree).not.toContain("mergeBlock(");
    expect(workspaceTree).not.toContain("mergeImpression(");
  });

  it("does not auto-merge structured impression candidates; Accept does", () => {
    const applyStart = workspace.indexOf("const applyStructuredGeneration");
    const applyEnd = workspace.indexOf("const scheduleStructuredApply");
    expect(applyStart).toBeGreaterThan(-1);
    expect(applyEnd).toBeGreaterThan(applyStart);
    const applyBody = workspace.slice(applyStart, applyEnd);
    expect(applyBody).not.toContain('mergeField("impression"');
    expect(applyBody).not.toContain("structured-template-candidate");
    expect(workspace).toContain("onAcceptImpression");
    expect(workspace).toMatch(
      /mergeField\("impression",\s*\w+,\s*"structured-template-candidate"\)/,
    );
  });

  it("avoids unstable zustand selector fallback for technique provenance (React #185)", () => {
    expect(workspace).toContain("EMPTY_FIELD_PROVENANCE");
    expect(workspace).not.toMatch(/fieldProvenance\.technique\s*\?\?\s*\{\}/);
  });
});

const findingsEditor = readFileSync(
  resolve(ERP_SRC, "components/radiology/zai-workspace/findings-editor.tsx"),
  "utf8",
);
const previewHtml = readFileSync(resolve(ERP_SRC, "lib/radiologyReportPreviewHtml.ts"), "utf8");

describe("Provenance visualization — editor + screen-only preview", () => {
  it("FindingsEditor renders provenance legend/map as editor-only", () => {
    expect(findingsEditor).toContain('data-editor-only="provenance"');
    expect(findingsEditor).toContain("provenance-legend");
    expect(findingsEditor).toContain("formatProvenanceHover");
  });

  it("useWorkspaceSelector uses shallow equality (React #185 guard)", () => {
    const store = readFileSync(resolve(__dirname, "zai-workspace/store.ts"), "utf8");
    expect(store).toContain("useShallow(selector)");
    expect(store).toContain("export const EMPTY_FIELD_PROVENANCE");
  });

  it("FindingsEditor avoids unstable zustand selector fallback (React #185)", () => {
    expect(findingsEditor).toContain("EMPTY_FIELD_PROVENANCE");
    expect(findingsEditor).not.toMatch(/fieldProvenance\[field\]\s*\?\?\s*\{\}/);
  });

  it("preview HTML builder supports screen-only provenance tinting (stripped at print)", () => {
    expect(previewHtml).toContain("PROVENANCE_PREVIEW_CSS");
    expect(previewHtml).toContain("findingsProvenance");
    expect(previewHtml).toContain("preview-provenance-legend");
    expect(previewHtml).toContain("@media print");
    expect(previewHtml).toContain("preview only — not printed");
    expect(previewHtml).toMatch(
      /@media print[\s\S]*\.preview-provenance-legend[\s\S]*display:\s*none\s*!important/,
    );
  });
});

const structuredPanel = readFileSync(
  resolve(ERP_SRC, "components/radiology/StructuredFormatPanel.tsx"),
  "utf8",
);

describe("Structured impression candidates stay in the tray", () => {
  it("exposes Accept / Edit / Ignore without auto-inserting", () => {
    expect(structuredPanel).toContain("onAcceptImpression");
    expect(structuredPanel).toContain("structured-impression-candidates");
    expect(structuredPanel).toContain("data-testid={`structured-impression-accept-${i}`}");
    expect(structuredPanel).toContain("data-testid={`structured-impression-edit-${i}`}");
    expect(structuredPanel).toContain("data-testid={`structured-impression-ignore-${i}`}");
    expect(structuredPanel).toMatch(/>\s*Accept\s*</);
    expect(structuredPanel).toMatch(/>\s*Ignore\s*</);
  });
});

describe("Save/finalize payloads — provenance never persisted", () => {
  it("saveDraft posts plain clinical fields only (no fieldProvenance)", () => {
    const saveIdx = workspaceTree.indexOf("() => saveRadiologyDraft<{");
    expect(saveIdx).toBeGreaterThan(-1);
    const slice = workspaceTree.slice(saveIdx, saveIdx + 500);
    // Live store snapshot (editor-isolation) — plain strings, never provenance maps.
    expect(slice).toContain("rawFindings: live.findingsText");
    expect(slice).toContain("technique: live.techniqueText");
    expect(slice).not.toContain("fieldProvenance");
  });

  it("finalize validation uses plain field strings only", () => {
    const valIdx = workspaceTree.indexOf("const validationIssues = validateReport({");
    expect(valIdx).toBeGreaterThan(-1);
    const slice = workspaceTree.slice(valIdx, valIdx + 200);
    expect(slice).toContain("findings: live.findingsText");
    expect(slice).not.toContain("fieldProvenance");
  });
});
