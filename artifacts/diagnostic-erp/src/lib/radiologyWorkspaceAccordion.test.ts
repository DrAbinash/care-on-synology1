import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ERP_SRC = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

const workspace = read("pages/RadiologyReportingWorkspace.tsx");
const section1 = read("components/radiology/StudyRegionReportFormatSection.tsx");
const accordion = read("components/radiology/zai-workspace/report-section-accordion.tsx");
const findingsEditor = read("components/radiology/zai-workspace/findings-editor.tsx");
const quickFindings = read("components/radiology/QuickFindingsPanel.tsx");
const settings = read("pages/RadiologyQuickSelectSettings.tsx");

/** Index of a marker in the workspace source, asserting it exists. */
function at(marker: string): number {
  const i = workspace.indexOf(marker);
  expect(i, `expected workspace to contain ${marker}`).toBeGreaterThan(-1);
  return i;
}

describe("main reporting pane — progressive accordion", () => {
  it("renders all nine major sections through the shared header helper", () => {
    for (const id of [
      "demography",
      "refDoctor",
      "region",
      "history",
      "technique",
      "findings",
      "impression",
      "recommendation",
      "report",
    ]) {
      expect(workspace).toContain(`accordionProps("${id}")`);
    }
    // Progressive accordion remains the live pane (R2 pieces sit inside Findings).
    expect(workspace).toContain('data-testid="reporting-canvas-r2"');
    expect(workspace).toContain('data-report-accordion="progressive"');
    expect(workspace).not.toContain("continuous: true");
  });

  it("keeps the clinical top-to-bottom order", () => {
    const order = [
      'accordionProps("demography")',
      'accordionProps("refDoctor")',
      'accordionProps("region")',
      'accordionProps("history")',
      'accordionProps("technique")',
      'accordionProps("findings")',
      'accordionProps("impression")',
      'accordionProps("recommendation")',
      'accordionProps("report")',
    ].map(at);
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
  });

  it("drives one-active-section state through the accordion helpers", () => {
    expect(workspace).toContain("activeReportSection");
    expect(workspace).toContain("nextActiveSection");
    expect(workspace).toContain("activeFindingsTool");
    expect(workspace).toContain("nextFindingsTool");
  });

  it("collapsing is visual only — children stay mounted so state survives", () => {
    // Progressive mode hides inactive bodies with `hidden` (display:none);
    // children stay mounted so editors/drawers never lose state.
    expect(accordion).toMatch(/active \? "min-h-0 flex-1 overflow-y-auto[^"]*" : "hidden"/);
    expect(accordion).toContain("{children}");
    // Guard against a regression to conditional rendering.
    expect(accordion).not.toMatch(/\{active && children\}/);
    expect(accordion).not.toMatch(/\{!collapsed && children\}/);
    expect(accordion).not.toMatch(/\{showBody && children\}/);
  });

  it("the active section owns the remaining height and scrolls internally", () => {
    expect(accordion).toContain("min-h-0 flex-1 border-emerald-300/80");
    expect(accordion).toContain("overflow-y-auto");
    expect(workspace).toContain('className="flex flex-1 min-w-0 flex-col min-h-0"');
  });

  it("adds Alt+1…9 without colliding with existing shortcuts", () => {
    expect(workspace).toContain("sectionForAltDigit");
    expect(workspace).toMatch(/e\.altKey && !e\.ctrlKey && !e\.metaKey && \/\^\[1-9\]\$\/\.test\(e\.key\)/);
    // Ctrl+1–6 (templates) and Ctrl+1–9 (quick add tabs) stay untouched.
    expect(quickFindings).toContain("e.ctrlKey && !e.altKey");
  });

  it("does not steal Alt+digit while the radiologist is typing in an editor", () => {
    expect(workspace).toContain('if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;');
  });
});

describe("clicking the workspace collapses chrome, keeps OHIF", () => {
  it("enters reporting focus from the accordion and from the viewer column", () => {
    expect(workspace).toContain("onMouseDown={enterReportingFocusMode}");
    expect(workspace).toContain('data-testid="embedded-viewer-column"');
  });

  it("collapses the reading queue, Orient rail, and app sidebar without hiding OHIF", () => {
    expect(workspace).toContain("leftPanelRef.current?.collapse()");
    expect(workspace).toContain("rightPanelRef.current?.collapse()");
    expect(workspace).toContain("setViewerFocus(true)");
    expect(workspace).toContain('new CustomEvent("care:workspace-focus", { detail: true })');
    expect(workspace).toContain("collapsible");
    expect(workspace).toContain('data-testid="right-panel-expand"');
  });
});

describe("Findings workspace — macros, hero editor, one drawer at a time", () => {
  it("puts region-aware macros above the editor", () => {
    const macros = at("<ChocolateBoxMacros");
    const editor = at('field="findings"');
    expect(macros).toBeLessThan(editor);
  });

  it("lets the radiologist add and edit macro boxes from the workspace", () => {
    const box = read("components/radiology/zai-workspace/chocolate-box-macros.tsx");
    expect(workspace).toContain("<ChocolateBoxMacros");
    expect(box).toContain('data-testid="chocolate-box-add"');
    expect(box).toContain("upsertChocolateTile");
    expect(settings).toContain("<ChocolateBoxSettingsPanel");
  });

  it("keeps the editor as the hero by moving its tile wall into a drawer", () => {
    expect(workspace).toContain("hideQuickSelect");
    expect(findingsEditor).toContain("{!hideQuickSelect && <QuickSelectStrip field={field} onAfterPick={onQuickSelectPick} />}");
    expect(workspace).toMatch(/<QuickSelectStrip[\s\S]*?field="findings"/);
  });

  it("scopes Findings Quick Select tiles to the selected region", () => {
    // PACS rows have no BodyPartExamined, so study.bodyPart is "" and every
    // region-scoped tile used to score out of lookupTiles. Tiles now follow
    // ReportingStudyContext (synced from the workspace region), not DICOM bodyPart.
    const strip = read("components/radiology/zai-workspace/quick-select-strip.tsx");
    expect(strip).toContain("bodyPart?: string | null");
    expect(strip).toContain("lookupTilesForContext(tiles, field, study?.modality, reportingContext)");
    expect(workspace).toContain('bodyPart={studySetup.matchedStudyRegion}');
  });

  it("hosts exactly four assistance drawers, all mounted", () => {
    expect(workspace).toContain("<FindingsToolTabs");
    for (const id of ["quickSelect", "quickAdd", "structured", "suggestions"]) {
      expect(workspace).toContain(`<FindingsToolDrawer id="${id}"`);
    }
    expect(accordion).toMatch(/active \? "max-h-\[38vh\] overflow-y-auto" : "hidden"/);
  });

  it("mounts Quick Add and Structured exactly once (moved, not duplicated)", () => {
    expect(workspace.match(/<QuickFindingsPanel/g) ?? []).toHaveLength(1);
    expect(workspace.match(/<StructuredFormatPanel/g) ?? []).toHaveLength(1);
    expect(workspace.match(/data-testid="clinic-quick-select"/g) ?? []).toHaveLength(1);
  });

  it("routes suggestion engines into the Suggestions drawer", () => {
    const drawer = at('<FindingsToolDrawer id="suggestions"');
    for (const marker of [
      "<PriorComparisonToolbar",
      "<ViewerMeasurementsBanner",
      "<ObDashboardStrip",
      "<UsgCompanionPanel",
    ]) {
      expect(workspace.indexOf(marker)).toBeGreaterThan(drawer);
    }
  });

  it("keeps Structured/Highlight toggles and the findings mic reachable", () => {
    expect(workspace).toContain("Highlight scan");
    expect(workspace).toContain('target="findings"');
    expect(workspace).toContain("setUseStructured(on)");
  });
});

describe("Region context drives the Findings tools", () => {
  it("macros follow the selected region, not just the DICOM description", () => {
    const macrosLib = read("lib/findingsMacros.ts");
    expect(macrosLib).toContain("ReportingStudyContext");
    expect(macrosLib).toContain("ctx.spineSegment");
    expect(macrosLib).not.toContain("BRAIN_RE");
    const setup = read("../src/hooks/useReportingStudySetup.ts");
    expect(setup).toContain("resolvedChocolateBoxSet(studyContext)");
    expect(setup).toContain("nextStudyRegions(studyRegions, regionName)");
    // Section 1 quick buttons + dropdown both call selectPrimaryRegion
    expect(workspace).toContain("onSelectRegion={studySetup.selectPrimaryRegion}");
    expect(section1).toContain("onSelectRegion(t.name)");
    expect(section1).toContain('data-selected={selected ? "true" : "false"}');
    expect(section1).toContain("availableStudyTabs");
    expect(section1).toContain('data-testid="whole-report-format-select"');
  });

  it("Quick Add folds its region grid away but keeps cross-region access", () => {
    expect(workspace).toContain("compactRegions");
    expect(quickFindings).toContain('data-testid="quick-add-region-compact"');
    expect(quickFindings).toContain('data-testid="quick-add-change-region"');
    // The original body-region select and study tabs are still rendered.
    expect(quickFindings).toContain('data-testid="quick-add-region"');
    expect(quickFindings).toContain("activeTabs.map((tab, i)");
  });
});

describe("Sources / provenance is compact and read-only", () => {
  it("shows counted sources by default and details on demand", () => {
    expect(findingsEditor).toContain("formatProvenanceSummary");
    expect(findingsEditor).toContain("provenance-details-toggle-");
    expect(findingsEditor).toMatch(/showProvenanceUi && provenanceOpen &&/);
  });

  it("stays editor-only and keeps the existing hover attribution", () => {
    expect(findingsEditor).toContain('data-editor-only="provenance"');
    expect(findingsEditor).toContain("formatProvenanceHover");
    expect(findingsEditor).toContain("provenance-legend");
  });

  it("has no manual source checkboxes to maintain", () => {
    expect(findingsEditor).not.toMatch(/<Checkbox[^>]*provenance/i);
    expect(findingsEditor).not.toMatch(/onCheckedChange[^\n]*source/i);
  });
});

describe("no reporting feature was deleted by the re-layout", () => {
  const section1Markers = new Set([
    'data-testid="study-setup-strip"',
    'data-testid="study-region-select"',
    'data-testid="whole-report-format-select"',
    'data-testid="study-region-quick"',
    'data-testid="reapply-defaults"',
  ]);
  const techniqueStrip = read("components/radiology/TechniqueChoiceStrip.tsx");
  const historyStrip = read("components/radiology/ClinicalHistoryChipStrip.tsx");
  const section23Markers = new Set([
    'data-testid="technique-choice-select"',
    "ClinicalHistoryChipStrip",
  ]);
  const preserved: Array<[string, string | RegExp]> = [
    ["Demography card", "<ReportDemographyCard"],
    ["Referring doctor quick select", "<ReferringDoctorQuickSelect"],
    ["Start Report", 'data-testid="start-report-banner"'],
    ["Undo Start Report", "undoStartReport"],
    ["Study setup strip", 'data-testid="study-setup-strip"'],
    ["Study / Region select", 'data-testid="study-region-select"'],
    ["Whole report format select", 'data-testid="whole-report-format-select"'],
    ["Region quick buttons", 'data-testid="study-region-quick"'],
    ["Unified Section 1 component", "StudyRegionReportFormatSection"],
    ["Technique choice select", 'data-testid="technique-choice-select"'],
    ["Technique editor", 'data-testid="canonical-technique-editor"'],
    ["Re-apply defaults", 'data-testid="reapply-defaults"'],
    ["MRI readiness", "<MriReadinessStrip"],
    ["Template mismatch + load", 'data-testid="load-correct-template"'],
    ["History chips", "ClinicalHistoryChipStrip"],
    ["Clinical history editor", 'field="clinicalHistory"'],
    ["Technique editor", 'data-testid="canonical-technique-editor"'],
    ["Region macros", "<ChocolateBoxMacros"],
    ["Anatomy-grouped findings", "<FindingsAnatomyStrip"],
    ["Sticky anatomy chips", "<FindingsAnatomyChips"],
    ["Structured findings cards", 'data-testid="structured-findings-cards"'],
    ["Highlight editor", "<FindingsHighlightEditor"],
    ["Findings editor", 'field="findings"'],
    ["Findings Quick Select", /<QuickSelectStrip[\s\S]*?field="findings"/],
    ["Quick Add / Clinic Quick Select", "<QuickFindingsPanel"],
    ["Structured format panel", "<StructuredFormatPanel"],
    ["Prior comparison", "<PriorComparisonToolbar"],
    ["Viewer measurements", "<ViewerMeasurementsBanner"],
    ["OB dashboard", "<ObDashboardStrip"],
    ["USG/CT companion", "<UsgCompanionPanel"],
    ["Generate Impression", 'data-testid="generate-local-impression"'],
    ["Impression editor", 'field="impression"'],
    ["Recommendation chips", 'data-testid="recommendation-chips"'],
    ["Recommendation editor", 'field="recommendation"'],
    ["Critical finding", 'data-testid="critical-finding-panel"'],
    ["Report layout & export", "<ReportExportPanel"],
    ["Report images rail", 'data-testid="selected-images-rail"'],
    ["Dictation mics", "<FieldCareMic"],
    ["Structured finding dialog", "<StructuredFindingDialog"],
  ];

  for (const [feature, marker] of preserved) {
    it(`still mounts ${feature}`, () => {
      let src = workspace;
      if (typeof marker === "string" && section1Markers.has(marker)) src = section1;
      else if (typeof marker === "string" && section23Markers.has(marker)) {
        src = marker.includes("technique") ? techniqueStrip : historyStrip + workspace;
      }
      if (marker instanceof RegExp) expect(src).toMatch(marker);
      else expect(src).toContain(marker);
    });
  }

  it("keeps Classic/Premium, preview, Enlarge, Word and PDF in the export panel", () => {
    const exportPanel = read("components/radiology/ReportExportPanel.tsx");
    expect(exportPanel).toContain("ReportLayoutQuickSelect");
    expect(exportPanel).toContain("Enlarge");
    expect(exportPanel).toContain("onExportWord");
    expect(exportPanel).toContain("onExportPdf");
    expect(exportPanel).toContain("onPrintLikeFinal");
  });

  it("does not duplicate Word/PDF on the workspace toolbar", () => {
    expect(workspace).not.toMatch(/title="Export Word/);
    expect(workspace).not.toMatch(/title="Export PDF with selected images/);
    expect((workspace.match(/handleExportWord/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
