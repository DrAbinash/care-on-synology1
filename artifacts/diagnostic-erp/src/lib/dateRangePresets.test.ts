import { describe, expect, it } from "vitest";
import { daysAgoISO, shiftISODate, todayISO } from "./dateRangePresets";

// shiftISODate replaces the Appointments.tsx bug: navigateDate() used to do
// `new Date(selectedDate + "T00:00:00")` (parsed as LOCAL midnight, i.e. IST
// midnight for this app's users) then `.toISOString()` (re-serialized as
// UTC) — and IST midnight is 18:30 UTC the PREVIOUS day, so the round trip
// silently shifted dates by up to a day depending on the offset sign: +1 day
// did nothing (Next button appeared broken), -1 day jumped back two days.
// shiftISODate never does that round trip — it stays UTC-anchored
// throughout, so it's correct independent of the runner's local timezone
// (no TZ env trick needed for these assertions to mean anything).
describe("shiftISODate", () => {
  it("adds a day within the same month", () => {
    expect(shiftISODate("2026-07-26", 1)).toBe("2026-07-27");
  });

  it("subtracts a day within the same month", () => {
    expect(shiftISODate("2026-07-26", -1)).toBe("2026-07-25");
  });

  it("a zero-day shift is a no-op", () => {
    expect(shiftISODate("2026-07-26", 0)).toBe("2026-07-26");
  });

  it("crosses a month boundary going forward", () => {
    expect(shiftISODate("2026-07-31", 1)).toBe("2026-08-01");
  });

  it("crosses a month boundary going backward", () => {
    expect(shiftISODate("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("crosses a year boundary", () => {
    expect(shiftISODate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("supports multi-day offsets", () => {
    expect(shiftISODate("2026-07-26", 7)).toBe("2026-08-02");
    expect(shiftISODate("2026-07-26", -30)).toBe("2026-06-26");
  });
});

describe("daysAgoISO", () => {
  it("is yesterday of todayISO, not local-midnight shifted into IST", () => {
    expect(daysAgoISO(1)).toBe(shiftISODate(todayISO(), -1));
    expect(daysAgoISO(0)).toBe(todayISO());
  });
});
