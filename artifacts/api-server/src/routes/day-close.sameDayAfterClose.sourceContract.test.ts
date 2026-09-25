/**
 * Source contract: API exposes same-day-after-close markers for next-window UI.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("day-close same-day after close API contract", () => {
  const dayClose = readFileSync(join(__dirname, "day-close.ts"), "utf8");

  it("my-preview returns sameDayAfterPriorClose", () => {
    expect(dayClose).toContain("sameDayAfterPriorClose: s.sameDayAfterPriorClose");
  });

  it("overall preview returns same-day bill list for admin open window", () => {
    expect(dayClose).toContain("sameDayAfterPriorCloseBills");
    expect(dayClose).toContain("sameDayAfterPriorClose: summary.sameDayAfterPriorClose");
  });

  it("staff-status attaches postClosure + sameDayAfterPriorClose", () => {
    expect(dayClose).toContain("sameDayBillCount: pc.sameDayBillCount");
    expect(dayClose).toContain("sameDayAfterPriorClose: liveWindow.sameDayAfterPriorClose");
  });

  it("post-closure activity payload includes same-day totals", () => {
    expect(dayClose).toContain("sameDayBillCount: result.sameDayBillCount");
    expect(dayClose).toContain("sameDayPaymentTotal: result.sameDayPaymentTotal");
  });
});
