import { describe, expect, it } from "vitest";
import {
  nextStudyDraftsUrl,
  nextStudyMeasurementsUrl,
  nextStudyPriorsUrl,
} from "./nextStudyReportPrefetch";

describe("nextStudyReportPrefetch URLs", () => {
  it("builds drafts and measurements URLs", () => {
    expect(nextStudyDraftsUrl(42)).toContain("studyId=42");
    expect(nextStudyMeasurementsUrl("99")).toContain("studyId=99");
  });

  it("builds priors URL only for real patient ids", () => {
    expect(nextStudyPriorsUrl(7)).toContain("patientId=7");
    expect(nextStudyPriorsUrl("0")).toBeNull();
    expect(nextStudyPriorsUrl("")).toBeNull();
  });
});
