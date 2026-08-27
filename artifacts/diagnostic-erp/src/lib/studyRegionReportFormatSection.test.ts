import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { regionSelectionAction } from "@/components/radiology/StudyRegionReportFormatSection";
import { lookupFormatsForPicker, DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  addCustomRegion,
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

  it("UI can add a region into the Study / Region catalog", () => {
    const custom = addCustomRegion(["Brain"], "  Knee  ");
    expect(custom).toEqual(["Brain", "Knee"]);
    const catalog = mergeRegionCatalog(["Brain", "Cervical Spine"], custom, null);
    expect(catalog).toContain("Knee");
    expect(catalog).toContain("Brain");
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
