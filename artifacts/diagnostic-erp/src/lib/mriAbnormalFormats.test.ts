import { describe, expect, it } from "vitest";
import {
  favoriteFormatIdsForDoctor,
  isMriAbnormalFormat,
  mriRegionKey,
  rankTopMriAbnormalFormats,
  recordDoctorFormatApply,
} from "./mriAbnormalFormats";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "./reportingStudyContext";

describe("mriAbnormalFormats", () => {
  it("classifies abnormal vs normal MRI formats", () => {
    const faz = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Fazekas 1")!;
    const normal = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
    expect(isMriAbnormalFormat(faz)).toBe(true);
    expect(isMriAbnormalFormat(normal)).toBe(false);
  });

  it("resolves region keys for brain / LS / cervical / dorsal", () => {
    const brain = buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Brain Plain",
      regions: ["Brain"],
      source: "auto",
    });
    expect(mriRegionKey(brain)).toBe("brain");
    const ls = buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI LS Spine",
      regions: ["LS Spine"],
      source: "auto",
    });
    expect(mriRegionKey(ls)).toBe("ls-spine");
  });

  it("ranks top brain abnormals; billed stroke test boosts infarct", () => {
    const ctx = buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Brain",
      regions: ["Brain"],
      source: "auto",
    });
    const ranked = rankTopMriAbnormalFormats({
      formats: DEFAULT_REPORT_FORMATS,
      ctx,
      billedTestName: "MRI Brain Stroke Protocol",
      limit: 10,
    });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((f) => isMriAbnormalFormat(f))).toBe(true);
    expect(ranked.some((f) => /infarct/i.test(f.name))).toBe(true);
  });

  it("doctor prefs float previously applied formats", () => {
    const mem: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => { mem[k] = v; },
      removeItem: (k: string) => { delete mem[k]; },
      clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
      key: () => null,
      length: 0,
    } as Storage;
    const hernia = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Disc herniation L4-L5")!;
    recordDoctorFormatApply(
      { referringDoctorId: 42, formatId: hernia.id },
      storage,
    );
    expect(favoriteFormatIdsForDoctor({ referringDoctorId: 42 }, storage)).toEqual([hernia.id]);
    const ctx = buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI LS Spine",
      regions: ["LS Spine"],
      source: "auto",
    });
    const ranked = rankTopMriAbnormalFormats({
      formats: DEFAULT_REPORT_FORMATS,
      ctx,
      billedTestName: "MRI Lumbar Spine",
      doctorFavoriteFormatIds: favoriteFormatIdsForDoctor({ referringDoctorId: 42 }, storage),
      limit: 5,
    });
    expect(ranked[0]?.id).toBe(hernia.id);
  });
});
