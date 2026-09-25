import { describe, expect, test } from "vitest";
import {
  PURGE_CONFIRM_PHRASE,
  buildStudyDateQuery,
  resolvePurgePeriod,
} from "./orthancPurgePeriod";

describe("resolvePurgePeriod", () => {
  const today = "2026-09-21";

  test("older_than_1_month ends day before one month ago", () => {
    const p = resolvePurgePeriod({ preset: "older_than_1_month" }, today);
    expect(p.dateFrom).toBeNull();
    expect(p.dateTo).toBe("2026-08-20");
    expect(p.label).toContain("older than 1 month");
  });

  test("older_than_2_months", () => {
    const p = resolvePurgePeriod({ preset: "older_than_2_months" }, today);
    expect(p.dateTo).toBe("2026-07-20");
  });

  test("custom from–to", () => {
    const p = resolvePurgePeriod({
      preset: "custom",
      dateFrom: "2026-01-01",
      dateTo: "2026-03-31",
    }, today);
    expect(p.dateFrom).toBe("2026-01-01");
    expect(p.dateTo).toBe("2026-03-31");
    expect(buildStudyDateQuery(p)).toBe("20260101-20260331");
  });

  test("custom open start uses dateTo only", () => {
    const p = resolvePurgePeriod({ preset: "custom", dateTo: "2026-06-01" }, today);
    expect(p.dateFrom).toBeNull();
    expect(p.dateTo).toBe("2026-06-01");
    expect(buildStudyDateQuery(p)).toBe("-20260601");
  });

  test("rejects inverted range", () => {
    expect(() =>
      resolvePurgePeriod({
        preset: "custom",
        dateFrom: "2026-06-01",
        dateTo: "2026-01-01",
      }, today),
    ).toThrow(/dateFrom must be on or before/);
  });

  test("confirm phrase constant", () => {
    expect(PURGE_CONFIRM_PHRASE).toBe("DELETE STUDIES");
  });
});
