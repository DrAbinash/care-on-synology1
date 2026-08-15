import { describe, expect, test } from "vitest";
import { isClinicPeakHours } from "./clinicPeakHours";
import { readFileSync } from "node:fs";

describe("clinicPeakHours (ERP)", () => {
  test("08:00 IST inclusive through 15:59, 16:00 exclusive", () => {
    expect(isClinicPeakHours(new Date("2026-08-15T02:29:00.000Z"))).toBe(false);
    expect(isClinicPeakHours(new Date("2026-08-15T02:30:00.000Z"))).toBe(true);
    expect(isClinicPeakHours(new Date("2026-08-15T10:29:00.000Z"))).toBe(true);
    expect(isClinicPeakHours(new Date("2026-08-15T10:30:00.000Z"))).toBe(false);
  });
});

describe("Layout new-studies poll throttles during peak hours", () => {
  const src = readFileSync(
    new URL("../components/Layout.tsx", import.meta.url),
    "utf8",
  );
  test("skips dicom-studies/new polls that are closer than 90s in peak hours", () => {
    expect(src).toContain("isClinicPeakHours()");
    expect(src).toContain("Date.now() - lastPollAt < 90_000");
  });
});
