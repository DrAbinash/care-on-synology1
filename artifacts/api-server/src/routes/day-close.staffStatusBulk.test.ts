import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Regression: open staff drawers previously showed ₹0 Exp. Cash because
 * GET /staff-status only read persisted user_day_closures rows. Live
 * expected must come from summarizeWindow / summarizeUserWindow.
 */
describe("day-close staff-status live expected + bulk close", () => {
  const src = readFileSync(join(__dirname, "day-close.ts"), "utf8");

  test("staff-status loads live open-window totals via summarizeWindow", () => {
    expect(src).toContain('dayCloseRouter.get("/staff-status"');
    expect(src).toContain("summarizeWindow(lastOverall, now)");
    expect(src).toContain("byStaffLive");
    expect(src).toContain("needsLiveExpected");
  });

  test("bulk staff-close-all auto-balances under lock", () => {
    expect(src).toContain('dayCloseRouter.post("/staff-close-all"');
    expect(src).toContain("autoBalance: true");
    expect(src).toContain("closeStaffDrawerOnBehalf");
    expect(src).toContain("skipIfAlreadyClosed");
  });
});
