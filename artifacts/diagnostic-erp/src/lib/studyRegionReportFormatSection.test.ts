import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { regionSelectionAction } from "@/components/radiology/StudyRegionReportFormatSection";
import { lookupFormatsForPicker, DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  migrateLegacyQuickNamesToIds,
  pinQuickTabId,
  resolveQuickStudyTabs,
  toggleQuickTabId,
} from "@/lib/workspaceRegionPrefs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const TABS = [
  { id: 1, name: "Brain" },
  { id: 2, name: "Cervical Spine" },
  { id: 3, name: "LS Spine" },
  { id: 4, name: "Knee" },
];

describe("Section 1 — Study / Region + Report Format unification", () => {
  it("dropdown and quick buttons share the same selectPrimaryRegion action", () => {
    const selectPrimaryRegion = vi.fn();
    regionSelectionAction("Cervical Spine", selectPrimaryRegion);
    regionSelectionAction("Cervical Spine", selectPrimaryRegion);
    expect(selectPrimaryRegion).toHaveBeenCalledTimes(2);
    expect(selectPrimaryRegion).toHaveBeenNthCalledWith(1, "Cervical Spine");
    expect(selectPrimaryRegion).toHaveBeenNthCalledWith(2, "Cervical Spine");
  });

  it("Report Format list is filtered by the selected Study / Region", () => {
    const brainCtx = buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Brain Plain",
      regions: ["Brain"],
      source: "override",
      protocolName: null,
    });
    const brain = lookupFormatsForPicker(DEFAULT_REPORT_FORMATS, "MR", brainCtx, {
      bodyPartFallback: "Brain",
    });
    expect(brain.formats.length).toBeGreaterThan(0);
    expect(brain.formats.every((f) => f.bodyPart === "Brain" || /brain/i.test(f.name))).toBe(true);

    const lsCtx = buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI LS Spine",
      regions: ["LS Spine"],
      source: "override",
      protocolName: null,
    });
    const ls = lookupFormatsForPicker(DEFAULT_REPORT_FORMATS, "MR", lsCtx, {
      bodyPartFallback: "LS Spine",
    });
    expect(ls.formats.length).toBeGreaterThan(0);
    const brainIds = new Set(brain.formats.map((f) => f.id));
    const lsIds = new Set(ls.formats.map((f) => f.id));
    expect([...brainIds].filter((id) => lsIds.has(id)).length).toBe(0);
  });

  it("Quick chips resolve Study Tab IDs against the server catalog only", () => {
    expect(resolveQuickStudyTabs(TABS, [])).toEqual([]);
    expect(resolveQuickStudyTabs(TABS, [2, 4, 99])).toEqual([
      { id: 2, name: "Cervical Spine" },
      { id: 4, name: "Knee" },
    ]);
    // Unpin never invents/deletes catalog entries — only removes the ID shortcut
    expect(toggleQuickTabId([1, 2], 1)).toEqual([2]);
    expect(toggleQuickTabId([2], 1)).toEqual([2, 1]);
    expect(pinQuickTabId([2], 4)).toEqual([2, 4]);
    expect(pinQuickTabId([2, 4], 4)).toEqual([2, 4]);
  });

  it("legacy Quick name prefs migrate to Study Tab IDs", () => {
    expect(migrateLegacyQuickNamesToIds(TABS, ["Knee", "Gone", "Brain"])).toEqual([4, 1]);
  });

  it("Add Study / Region opens ownership + children dialog (server catalog only)", () => {
    const section = read("components/radiology/StudyRegionReportFormatSection.tsx");
    const dialog = read("components/radiology/AddStudyRegionDialog.tsx");
    const prefs = read("lib/workspaceRegionPrefs.ts");
    expect(section).toContain("AddStudyRegionDialog");
    expect(section).toContain("availableStudyTabs");
    expect(section).not.toContain('data-testid="whole-report-format-select"');
    expect(section).not.toContain("lookupFormatsForPicker");
    expect(section).toContain("pinQuickTabId");
    expect(section).not.toContain("CUSTOM_REGIONS");
    expect(section).not.toContain("addCustomRegion");
    expect(section).not.toContain("mergeRegionCatalog");
    expect(dialog).toContain('data-testid="add-study-region-dialog"');
    expect(dialog).toContain("/api/radiology/quick-select/tabs");
    expect(prefs).toContain("QUICK_STUDY_TAB_IDS_STORAGE_KEY");
    expect(prefs).toContain("resolveQuickStudyTabs");
    expect(prefs).not.toContain("export function addCustomRegion");
    expect(prefs).not.toContain("export function mergeRegionCatalog");
  });

  it("cascading Region → Sub-region selects (format lives in WholeReportFormatControl)", () => {
    const section = read("components/radiology/StudyRegionReportFormatSection.tsx");
    expect(section).toContain('data-testid="study-region-family-select"');
    expect(section).toContain('data-testid="study-region-select"');
    expect(section).toContain("groupStudyTabsByFamily");
    expect(section).toContain("studyTabFamily");
    expect(section).not.toContain('data-testid="format-show-all-modality"');
    expect(section).toContain("writeLastStudyFamily");
    expect(section).toContain("regionSelectionAction");
  });

  it("workspace mounts first-class Report Format before Technique; region strip has no format select", () => {
    const workspace = read("pages/RadiologyReportingWorkspace.tsx");
    const section = read("components/radiology/StudyRegionReportFormatSection.tsx");
    const formatControl = read("components/radiology/WholeReportFormatControl.tsx");
    expect(workspace).toContain("WholeReportFormatControl");
    expect(workspace).toContain('data-testid="report-format-primary-slot"');
    expect(workspace).toContain("StudyRegionReportFormatSection");
    expect(workspace).toContain("availableStudyTabs={studySetup.availableStudyTabs}");
    expect(workspace).toContain("onSelectRegion={studySetup.selectPrimaryRegion}");
    expect(workspace).toContain("setFormatApplyBridge");
    expect(formatControl).toContain('data-testid="whole-report-format-select"');
    expect(formatControl).toContain('data-testid="r2-applied-format"');
    expect(formatControl).toContain("applyFormatById");
    // Primary format selector appears before Technique accordion in source order.
    const formatIdx = workspace.indexOf("report-format-primary-slot");
    const techniqueIdx = workspace.indexOf('accordionProps("technique")');
    expect(formatIdx).toBeGreaterThan(0);
    expect(techniqueIdx).toBeGreaterThan(formatIdx);
    expect(section).toContain('data-testid="study-region-select"');
    expect(section).toContain('data-testid="study-region-family-select"');
    expect(section).not.toContain('data-testid="whole-report-format-select"');
    expect(section).toContain('data-testid="study-region-quick"');
    expect(section).toContain('data-testid="study-region-quick-edit"');
    expect(section).toContain('data-testid="study-region-add-toggle"');
    expect(section).toContain("onSelectRegion(t.name)");
    expect(section).not.toContain("QUICK_REGION_LIMIT");
    expect(section).not.toContain("More regions");
    expect(section).not.toContain("protocol-select");
    expect(section).not.toContain("handleRegionToggle");
  });
});

describe("workspaceRegionPrefs Quick ID storage", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    const localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("window", { localStorage });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips Quick Study Tab IDs", async () => {
    const {
      writeStoredQuickTabIds,
      readStoredQuickTabIds,
      QUICK_STUDY_TAB_IDS_STORAGE_KEY,
    } = await import("@/lib/workspaceRegionPrefs");
    writeStoredQuickTabIds([1, 3, 1, -2, 0]);
    expect(readStoredQuickTabIds()).toEqual([1, 3]);
    expect(JSON.parse(store[QUICK_STUDY_TAB_IDS_STORAGE_KEY])).toEqual([1, 3]);
  });
});
