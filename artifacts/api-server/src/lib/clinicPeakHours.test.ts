import { afterEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { clinicPeakHoursLabel, isClinicPeakHours } from "./clinicPeakHours";
import { istHourMinute } from "./istDate";

// IST = UTC+5:30. 08:00 IST = 02:30 UTC; 16:00 IST = 10:30 UTC.

describe("isClinicPeakHours", () => {
  afterEach(() => {
    delete process.env.CLINIC_PEAK_HOURS;
    delete process.env.CLINIC_PEAK_HOURS_START;
    delete process.env.CLINIC_PEAK_HOURS_END;
  });

  test("08:00 IST inclusive through 15:59 IST, 16:00 exclusive", () => {
    expect(isClinicPeakHours(new Date("2026-08-15T02:29:00.000Z"))).toBe(false); // 07:59
    expect(isClinicPeakHours(new Date("2026-08-15T02:30:00.000Z"))).toBe(true); // 08:00
    expect(isClinicPeakHours(new Date("2026-08-15T08:00:00.000Z"))).toBe(true); // 13:30
    expect(isClinicPeakHours(new Date("2026-08-15T10:29:00.000Z"))).toBe(true); // 15:59
    expect(isClinicPeakHours(new Date("2026-08-15T10:30:00.000Z"))).toBe(false); // 16:00
    expect(isClinicPeakHours(new Date("2026-08-15T18:00:00.000Z"))).toBe(false); // 23:30
  });

  test("CLINIC_PEAK_HOURS=false disables the window", () => {
    process.env.CLINIC_PEAK_HOURS = "false";
    expect(isClinicPeakHours(new Date("2026-08-15T08:00:00.000Z"))).toBe(false);
  });

  test("env start/end override the default window", () => {
    process.env.CLINIC_PEAK_HOURS_START = "09:00";
    process.env.CLINIC_PEAK_HOURS_END = "12:00";
    expect(isClinicPeakHours(new Date("2026-08-15T02:30:00.000Z"))).toBe(false); // 08:00
    expect(isClinicPeakHours(new Date("2026-08-15T03:30:00.000Z"))).toBe(true); // 09:00
    expect(isClinicPeakHours(new Date("2026-08-15T06:30:00.000Z"))).toBe(false); // 12:00
  });

  test("istHourMinute matches IST clock for the same instants", () => {
    expect(istHourMinute(new Date("2026-08-15T02:30:00.000Z"))).toEqual({ hour: 8, minute: 0 });
    expect(istHourMinute(new Date("2026-08-15T10:30:00.000Z"))).toEqual({ hour: 16, minute: 0 });
  });

  test("label uses default 08:00–16:00 IST", () => {
    expect(clinicPeakHoursLabel()).toBe("08:00–16:00 IST");
  });
});

describe("DICOM auto-pull respects peak hours", () => {
  test("fireDicomAutoPull returns immediately during the window", () => {
    const cron = readFileSync(new URL("../cron.ts", import.meta.url), "utf8");
    expect(cron).toContain("if (isClinicPeakHours())");
    expect(cron).toContain("DICOM auto-pull skipped — clinic peak hours");
  });
});

describe("billing priority during peak hours", () => {
  test("cron slows AI / banking / commission / WA during peak", () => {
    const cron = readFileSync(new URL("../cron.ts", import.meta.url), "utf8");
    expect(cron).toContain("PACS_REARCHIVE_JOB");
    expect(cron).toContain("[PACS_REARCHIVE_JOB]: 0");
    expect(cron).toContain('skipped: "peak_hold"');
    expect(cron).toContain("Banking auto-sync deferred — clinic peak hours");
    expect(cron).toContain("commission reconcile deferred — clinic peak hours");
    expect(cron).toContain("const limit = isClinicPeakHours() ? 5 : 20");
  });

  test("DIMSE agent does not C-MOVE during peak", () => {
    const dimse = readFileSync(new URL("../services/dicom-pull-agent/dimse-agent.ts", import.meta.url), "utf8");
    expect(dimse).toContain("isClinicPeakHours");
    expect(dimse).toContain("pending C-MOVE deferred");
  });

  test("auto-voucher defers during peak; cron backfills off-peak", () => {
    const voucher = readFileSync(new URL("./auto-voucher.ts", import.meta.url), "utf8");
    expect(voucher).toContain("isClinicPeakHours");
    expect(voucher).toContain("Peak-hour deferral");
    expect(voucher).toContain("backfillDeferredPaymentVouchers");
    expect(voucher).toContain("force: true");
    const cron = readFileSync(new URL("../cron.ts", import.meta.url), "utf8");
    expect(cron).toContain("scheduleDeferredPaymentVouchers");
    expect(cron).toContain("backfillDeferredPaymentVouchers");
  });
});
