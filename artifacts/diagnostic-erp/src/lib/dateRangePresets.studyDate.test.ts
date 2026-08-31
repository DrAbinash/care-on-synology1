import { describe, expect, it } from "vitest";
import { studyDateInRange, studyDateToISO } from "./dateRangePresets";

describe("studyDateToISO", () => {
  it("parses compact DICOM YYYYMMDD", () => {
    expect(studyDateToISO("20260820")).toBe("2026-08-20");
  });

  it("parses ISO date prefix", () => {
    expect(studyDateToISO("2026-08-20")).toBe("2026-08-20");
  });
});

describe("studyDateInRange", () => {
  it("matches scan date not received time", () => {
    expect(studyDateInRange("20260820", "2026-08-31T10:00:00Z", "2026-08-20", "2026-08-20")).toBe(true);
    expect(studyDateInRange("20260820", "2026-08-31T10:00:00Z", "2026-08-31", "2026-08-31")).toBe(false);
  });
});
