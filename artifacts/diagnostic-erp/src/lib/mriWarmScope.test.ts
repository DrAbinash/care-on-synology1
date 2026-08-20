import { describe, expect, it } from "vitest";
import { filterMriTodayYesterday, isMriModality, mriWarmTargetsFromRows } from "./mriWarmScope";

describe("mriWarmScope", () => {
  it("detects MR modalities", () => {
    expect(isMriModality("MR")).toBe(true);
    expect(isMriModality("MRI")).toBe(true);
    expect(isMriModality("CT")).toBe(false);
  });

  it("filters MR studies to today and yesterday only", () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const rows = [
      { studyInstanceUID: "1.2.3", modality: "MR", createdAt: `${today}T10:00:00.000Z` },
      { studyInstanceUID: "1.2.4", modality: "MR", createdAt: "2020-01-01T10:00:00.000Z" },
      { studyInstanceUID: "1.2.5", modality: "CT", createdAt: `${today}T10:00:00.000Z` },
    ];
    expect(filterMriTodayYesterday(rows)).toHaveLength(1);
    expect(filterMriTodayYesterday(rows)[0]?.studyInstanceUID).toBe("1.2.3");
  });

  it("builds DICOMweb prefetch targets", () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const targets = mriWarmTargetsFromRows(
      [{ studyInstanceUID: "1.2.3", modality: "MR", createdAt: `${today}T08:00:00.000Z` }],
      "http://localhost:8042/dicom-web",
    );
    expect(targets).toEqual([{ studyInstanceUID: "1.2.3", dicomWebBaseUrl: "http://localhost:8042/dicom-web" }]);
  });
});
