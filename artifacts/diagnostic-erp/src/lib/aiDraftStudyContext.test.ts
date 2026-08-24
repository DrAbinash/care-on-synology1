import { describe, expect, it } from "vitest";
import { impressionMatchesStudyContext } from "./aiDraftStudyContext";

describe("impressionMatchesStudyContext", () => {
  it("rejects chest radiograph impression on CT Brain", () => {
    expect(
      impressionMatchesStudyContext("Normal chest radiograph with no acute abnormalities.", {
        modality: "CT",
        studyDescription: "CT Brain Plain",
      }),
    ).toBe(false);
  });

  it("accepts brain impression on CT Brain", () => {
    expect(
      impressionMatchesStudyContext("Normal CT brain study. No acute intracranial abnormality.", {
        modality: "CT",
        studyDescription: "NCCT Brain",
      }),
    ).toBe(true);
  });

  it("accepts chest radiograph wording on chest XR", () => {
    expect(
      impressionMatchesStudyContext("Normal chest radiograph.", {
        modality: "CR",
        studyDescription: "X-Ray Chest PA",
      }),
    ).toBe(true);
  });
});
