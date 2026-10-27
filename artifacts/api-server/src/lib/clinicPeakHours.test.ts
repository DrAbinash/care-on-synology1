import { afterEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { clinicPeakHoursLabel, isClinicPeakHours, isXrayModality, XRAY_MODALITY_CODES } from "./clinicPeakHours";
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

describe("isXrayModality", () => {
  test("DX and CR are X-ray", () => {
    expect(XRAY_MODALITY_CODES).toEqual(["DX", "CR"]);
    expect(isXrayModality("DX")).toBe(true);
    expect(isXrayModality("CR")).toBe(true);
  });

  test("case and surrounding whitespace do not matter", () => {
    expect(isXrayModality("dx")).toBe(true);
    expect(isXrayModality(" dx ")).toBe(true);
    expect(isXrayModality("cr")).toBe(true);
  });

  test("other modalities and empty values are not X-ray", () => {
    expect(isXrayModality("MR")).toBe(false);
    expect(isXrayModality("CT")).toBe(false);
    expect(isXrayModality("US")).toBe(false);
    expect(isXrayModality("OT")).toBe(false);
    expect(isXrayModality("")).toBe(false);
    expect(isXrayModality(null)).toBe(false);
    expect(isXrayModality(undefined)).toBe(false);
  });
});

describe("DICOM auto-pull respects peak hours", () => {
  test("during peak, job creation is limited to X-ray nodes", () => {
    const cron = readFileSync(new URL("../cron.ts", import.meta.url), "utf8");
    expect(cron).toContain("isClinicPeakHours()");
    expect(cron).toContain("isXrayModality(node.modality)");
    expect(cron).toContain("DICOM auto-pull limited to X-ray");
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

  test("DIMSE agent runs only X-ray jobs during peak", () => {
    const dimse = readFileSync(new URL("../services/dicom-pull-agent/dimse-agent.ts", import.meta.url), "utf8");
    expect(dimse).toContain("isClinicPeakHours");
    expect(dimse).toContain("XRAY_MODALITY_CODES");
    expect(dimse).toContain("non-X-ray C-MOVE deferred");
    // Both the poll-tick pending check AND the processor's peak selection
    // must filter by X-ray modality — deleting either arm would let MRI/CT
    // C-MOVE run into the billing window again.
    expect(dimse.match(/inArray\(dicomNodesTable\.modality, XRAY_MODALITY_CODES\)/g)).toHaveLength(2);
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
