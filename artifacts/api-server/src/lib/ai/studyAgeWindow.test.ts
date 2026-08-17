import { describe, expect, it } from "vitest";
import {
  isStudyInAgeWindow,
  parseStudyAgeWindow,
  resolveStudyAgeBounds,
} from "./studyAgeWindow";

/** 2026-08-17 10:00 IST = 2026-08-17 04:30 UTC */
const NOW = new Date("2026-08-17T04:30:00.000Z");

describe("study age windows", () => {
  it("does not treat Today and Last 24 hours as the same", () => {
    const yesterdayEveningIst = new Date("2026-08-16T16:30:00.000Z"); // 22:00 IST Aug 16
    expect(isStudyInAgeWindow({
      window: "today",
      createdAt: yesterdayEveningIst,
      now: NOW,
    })).toBe(false);
    expect(isStudyInAgeWindow({
      window: "last_24h",
      createdAt: yesterdayEveningIst,
      now: NOW,
    })).toBe(true);
  });

  it("includes a study from this IST calendar day in Today", () => {
    const thisMorning = new Date("2026-08-17T00:30:00.000Z"); // 06:00 IST Aug 17
    expect(isStudyInAgeWindow({
      window: "today",
      createdAt: thisMorning,
      now: NOW,
    })).toBe(true);
  });

  it("uses DICOM study date for Today when present", () => {
    expect(isStudyInAgeWindow({
      window: "today",
      studyDate: "20260817",
      createdAt: new Date("2026-08-16T01:00:00.000Z"),
      now: NOW,
    })).toBe(true);
    expect(isStudyInAgeWindow({
      window: "today",
      studyDate: "2026-08-16",
      createdAt: NOW,
      now: NOW,
    })).toBe(false);
  });

  it("applies rolling 48h / 3d / 7d from now", () => {
    const h47 = new Date(NOW.getTime() - 47 * 3600_000);
    const h49 = new Date(NOW.getTime() - 49 * 3600_000);
    const d6 = new Date(NOW.getTime() - 6 * 24 * 3600_000);
    const d8 = new Date(NOW.getTime() - 8 * 24 * 3600_000);
    expect(isStudyInAgeWindow({ window: "last_48h", createdAt: h47, now: NOW })).toBe(true);
    expect(isStudyInAgeWindow({ window: "last_48h", createdAt: h49, now: NOW })).toBe(false);
    expect(isStudyInAgeWindow({ window: "last_3d", createdAt: h49, now: NOW })).toBe(true);
    expect(isStudyInAgeWindow({ window: "last_7d", createdAt: d6, now: NOW })).toBe(true);
    expect(isStudyInAgeWindow({ window: "last_7d", createdAt: d8, now: NOW })).toBe(false);
  });

  it("all / unknown windows do not filter", () => {
    expect(parseStudyAgeWindow("nope")).toBe("all");
    expect(isStudyInAgeWindow({ window: "all", createdAt: new Date(0), now: NOW })).toBe(true);
  });

  it("custom range is inclusive of the end calendar day", () => {
    const bounds = resolveStudyAgeBounds({
      window: "custom",
      customFrom: "2026-08-16",
      customTo: "2026-08-16",
      now: NOW,
    });
    expect(isStudyInAgeWindow({
      window: "custom",
      studyDate: "2026-08-16",
      now: NOW,
      customFrom: "2026-08-16",
      customTo: "2026-08-16",
    })).toBe(true);
    expect(bounds.from?.toISOString()).toBe("2026-08-15T18:30:00.000Z");
  });
});
