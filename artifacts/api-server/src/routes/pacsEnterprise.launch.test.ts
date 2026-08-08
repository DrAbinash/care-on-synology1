import { describe, expect, it } from "vitest";
import { buildOhifLaunchUrl } from "./pacsEnterprise";

// R1.3 — the viewer launch URL is built SERVER-SIDE, at the most specific
// level the configured template can express, degrading SOP → series → study.
// These tests pin the degradation ladder and the encoding discipline.

const base = { ohifBase: "http://172.16.1.139:3010", studyTemplate: null, studyInstanceUID: "1.2.840.10" };

describe("buildOhifLaunchUrl — default (no template)", () => {
  it("study level", () => {
    expect(buildOhifLaunchUrl(base)).toEqual({
      ohifUrl: "http://172.16.1.139:3010/viewer?StudyInstanceUIDs=1.2.840.10",
      launchLevel: "study",
    });
  });

  it("series level appends the standard OHIF series filter", () => {
    expect(buildOhifLaunchUrl({ ...base, seriesInstanceUID: "1.2.840.20" })).toEqual({
      ohifUrl: "http://172.16.1.139:3010/viewer?StudyInstanceUIDs=1.2.840.10&SeriesInstanceUIDs=1.2.840.20",
      launchLevel: "series",
    });
  });

  it("SOP request degrades to its series (SOP is not a stable OHIF URL param)", () => {
    const { launchLevel, ohifUrl } = buildOhifLaunchUrl({
      ...base, seriesInstanceUID: "1.2.840.20", sopInstanceUID: "1.2.840.30",
    });
    expect(launchLevel).toBe("series");
    expect(ohifUrl).toContain("SeriesInstanceUIDs=1.2.840.20");
    expect(ohifUrl).not.toContain("1.2.840.30");
  });
});

describe("buildOhifLaunchUrl — admin template", () => {
  it("standard study template still gets the series filter appended", () => {
    const { ohifUrl, launchLevel } = buildOhifLaunchUrl({
      ...base,
      studyTemplate: "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}",
      seriesInstanceUID: "1.2.840.20",
    });
    expect(ohifUrl).toBe("http://172.16.1.139:3010/viewer?StudyInstanceUIDs=1.2.840.10&SeriesInstanceUIDs=1.2.840.20");
    expect(launchLevel).toBe("series");
  });

  it("a SOP-capable template launches at exact SOP level", () => {
    const { ohifUrl, launchLevel } = buildOhifLaunchUrl({
      ...base,
      studyTemplate: "{OHIF_BASE_URL}/v?study={studyInstanceUID}&series={seriesInstanceUID}&sop={sopInstanceUID}",
      seriesInstanceUID: "1.2.840.20",
      sopInstanceUID: "1.2.840.30",
    });
    expect(ohifUrl).toBe("http://172.16.1.139:3010/v?study=1.2.840.10&series=1.2.840.20&sop=1.2.840.30");
    expect(launchLevel).toBe("sop");
  });

  it("an exotic template with no expressible deeper level degrades to study", () => {
    const { ohifUrl, launchLevel } = buildOhifLaunchUrl({
      ...base,
      studyTemplate: "{OHIF_BASE_URL}/open/{studyInstanceUID}",
      seriesInstanceUID: "1.2.840.20",
      sopInstanceUID: "1.2.840.30",
    });
    expect(ohifUrl).toBe("http://172.16.1.139:3010/open/1.2.840.10");
    expect(launchLevel).toBe("study");
  });

  it("unused placeholders are cleared, never leaked into the URL", () => {
    const { ohifUrl } = buildOhifLaunchUrl({
      ...base,
      studyTemplate: "{OHIF_BASE_URL}/v?study={studyInstanceUID}&series={seriesInstanceUID}",
    });
    expect(ohifUrl).not.toContain("{seriesInstanceUID}");
  });

  it("UIDs are URI-encoded into the URL", () => {
    const { ohifUrl } = buildOhifLaunchUrl({
      ohifBase: "http://x", studyTemplate: null,
      studyInstanceUID: "1.2.840.10", seriesInstanceUID: "1.2.840.20",
    });
    expect(ohifUrl).toBe("http://x/viewer?StudyInstanceUIDs=1.2.840.10&SeriesInstanceUIDs=1.2.840.20");
  });
});
