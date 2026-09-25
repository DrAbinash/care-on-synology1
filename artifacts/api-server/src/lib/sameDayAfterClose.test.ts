import { describe, expect, it } from "vitest";
import {
  isSameDayAfterClose,
  summarizeSameDayBills,
  summarizeSameDayPayments,
} from "./sameDayAfterClose";

describe("isSameDayAfterClose", () => {
  // 18:00 IST on 2026-09-21 == 12:30 UTC
  const closedAt = new Date("2026-09-21T12:30:00.000Z");

  it("true for billing later the same IST day", () => {
    // 20:00 IST == 14:30 UTC
    expect(isSameDayAfterClose(new Date("2026-09-21T14:30:00.000Z"), closedAt)).toBe(true);
  });

  it("false for billing before the close", () => {
    expect(isSameDayAfterClose(new Date("2026-09-21T11:00:00.000Z"), closedAt)).toBe(false);
  });

  it("false for next IST calendar day (next-day additions without same-day flag)", () => {
    // 2026-09-22 09:00 IST == 2026-09-22 03:30 UTC
    expect(isSameDayAfterClose(new Date("2026-09-22T03:30:00.000Z"), closedAt)).toBe(false);
  });

  it("false when closedAt missing", () => {
    expect(isSameDayAfterClose(new Date("2026-09-21T14:30:00.000Z"), null)).toBe(false);
  });
});

describe("summarizeSameDay*", () => {
  const closedAt = new Date("2026-09-21T12:30:00.000Z");

  it("sums only same-day-after-close bills", () => {
    const r = summarizeSameDayBills(
      [
        { createdAt: "2026-09-21T14:30:00.000Z", totalAmount: 500 },
        { createdAt: "2026-09-22T03:30:00.000Z", totalAmount: 900 },
      ],
      closedAt,
    );
    expect(r).toEqual({ billCount: 1, billTotal: 500 });
  });

  it("sums only same-day-after-close payments", () => {
    const r = summarizeSameDayPayments(
      [
        { createdAt: "2026-09-21T15:00:00.000Z", amount: 200 },
        { createdAt: "2026-09-22T04:00:00.000Z", amount: 300 },
      ],
      closedAt,
    );
    expect(r).toEqual({ paymentCount: 1, paymentTotal: 200 });
  });
});
