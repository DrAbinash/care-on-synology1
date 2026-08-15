import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const warmer = readFileSync(join(__dirname, "mriStudyWarmer.ts"), "utf8");

describe("mriStudyWarmer contract", () => {
  it("defaults to today+yesterday mode and last-N of 20", () => {
    expect(warmer).toContain('mode: "today_yesterday"');
    expect(warmer).toContain("const DEFAULT_LAST_N = 20");
    expect(warmer).toContain('modeRaw === "last_n" ? "last_n" : "today_yesterday"');
  });

  it("touches Orthanc via tools/find + series/instances/preview (no ERP pixel store)", () => {
    expect(warmer).toContain("/tools/find");
    expect(warmer).toContain("/preview");
    expect(warmer).not.toContain("indexedDB");
    expect(warmer).not.toContain("INSERT INTO");
  });

  it("is gated by mri_warm_cache_enabled and MRI_WARM_CACHE env", () => {
    expect(warmer).toContain("mri_warm_cache_enabled");
    expect(warmer).toContain('process.env.MRI_WARM_CACHE === "false"');
    expect(warmer).toContain("startMriStudyWarmer");
  });

  it("skips automatic ticks during clinic peak hours unless force=true", () => {
    expect(warmer).toContain("isClinicPeakHours");
    expect(warmer).toContain("pausedForPeakHours");
    expect(warmer).toContain("clinic peak hours (billing / USG DICOM priority)");
    expect(warmer).toContain("if (!opts?.force && isClinicPeakHours())");
  });
});
