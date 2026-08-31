import { describe, expect, it } from "vitest";
import { buildPacsWorklistUrl, shouldIncludeOrthanc } from "./pacsWorklistQuery";

describe("buildPacsWorklistUrl", () => {
  it("includes date and orthanc params", () => {
    const url = buildPacsWorklistUrl({
      dateFrom: "2026-08-20",
      dateTo: "2026-08-20",
      search: "KARISHM",
      orthanc: true,
    });
    expect(url).toContain("dateFrom=2026-08-20");
    expect(url).toContain("orthanc=1");
    expect(url).toContain("search=KARISHM");
  });
});

describe("shouldIncludeOrthanc", () => {
  it("enables for back-date or search when toggled on", () => {
    expect(shouldIncludeOrthanc({ enabled: true, dateFrom: "2026-08-01" })).toBe(true);
    expect(shouldIncludeOrthanc({ enabled: true, search: "pat" })).toBe(true);
    expect(shouldIncludeOrthanc({ enabled: false, dateFrom: "2026-08-01" })).toBe(false);
  });
});
