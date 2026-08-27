import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { regionSelectionAction } from "@/components/radiology/StudyRegionReportFormatSection";
import { lookupFormatsForPicker, DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  mergeRegionCatalog,
  resolveQuickRegions,
  toggleQuickRegionPick,
} from "@/lib/workspaceRegionPrefs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

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

  it("quick regions are a user-picked subset of the dropdown catalog (not hard-coded)", () => {
    const catalog = ["Brain", "Cervical Spine", "LS Spine", "Knee"];
    expect(resolveQuickRegions(catalog, [])).toEqual([]);
    expect(resolveQuickRegions(catalog, ["Cervical Spine", "Knee", "Gone"])).toEqual([
      "Cervical Spine",
      "Knee",
    ]);
    expect(toggleQuickRegionPick(["Brain"], "Brain")).toEqual([]);
    expect(toggleQuickRegionPick([], "Brain")).toEqual(["Brain"]);
  });

  it("catalog merges server regions (selected region included even if not yet in list)", () => {
    const catalog = mergeRegionCatalog(["Brain", "Cervical Spine"], [], "Knee MRI");
    expect(catalog).toContain("Knee MRI");
    expect(catalog).toContain("Brain");
  });

  it("Add Study / Region opens ownership + children dialog (not name-only localStorage)", () => {
    const section = read("components/radiology/StudyRegionReportFormatSection.tsx");
    const dialog = read("components/radiology/AddStudyRegionDialog.tsx");
    expect(section).toContain("AddStudyRegionDialog");
    expect(section).toContain('data-testid="study-region-add-toggle"');
    expect(section).not.toContain("addCustomRegion");
    expect(section).not.toContain("CUSTOM_REGIONS_STORAGE_KEY");
    expect(section).not.toContain("study-region-add-input");
    expect(dialog).toContain('data-testid="add-study-region-dialog"');
    expect(dialog).toContain('data-testid="add-study-region-children"');
    expect(dialog).toContain("WorkspaceQuickFindingEditor");
    expect(dialog).toContain("/api/radiology/quick-select/tabs");
    expect(dialog).toContain("Ownership");
  });

  it("workspace Section 1 mounts editable quick + add-region UI", () => {
    const workspace = read("pages/RadiologyReportingWorkspace.tsx");
    const section = read("components/radiology/StudyRegionReportFormatSection.tsx");
    expect(workspace).toContain("StudyRegionReportFormatSection");
    expect(workspace).toContain("onSelectRegion={studySetup.selectPrimaryRegion}");
    expect(section).toContain('data-testid="study-region-select"');
    expect(section).toContain('data-testid="whole-report-format-select"');
    expect(section).toContain('data-testid="study-region-quick"');
    expect(section).toContain('data-testid="study-region-quick-edit"');
    expect(section).toContain('data-testid="study-region-add-toggle"');
    expect(section).toContain("onSelectRegion(r)");
    expect(section).not.toContain("QUICK_REGION_LIMIT");
    expect(section).not.toContain("More regions");
    expect(section).not.toContain("protocol-select");
    expect(section).not.toContain("handleRegionToggle");
  });
});

describe("POST tabs accepts technique + normals (API)", () => {
  it("route inserts techniqueText and normalText on create", () => {
    const route = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../api-server/src/routes/radiologyQuickFindings.ts"),
      "utf8",
    );
    // Create path must persist Abnormality Engine texts in one shot
    expect(route).toMatch(/router\.post\("\/tabs"[\s\S]*techniqueText[\s\S]*normalText[\s\S]*\.returning\(\)/);
  });
});
describe("workspaceRegionPrefs storage helpers", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    const localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    // Helpers gate on `window` (Node vitest has none) — stub both.
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("window", { localStorage });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips quick picks", async () => {
    const { writeStoredRegionList, readStoredRegionList, QUICK_REGIONS_STORAGE_KEY } = await import("@/lib/workspaceRegionPrefs");
    writeStoredRegionList(QUICK_REGIONS_STORAGE_KEY, ["Brain", "LS Spine", "Brain"]);
    expect(readStoredRegionList(QUICK_REGIONS_STORAGE_KEY)).toEqual(["Brain", "LS Spine"]);
  });
});
