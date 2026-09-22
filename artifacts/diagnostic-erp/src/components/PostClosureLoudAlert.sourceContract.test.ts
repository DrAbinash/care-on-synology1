/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("post-closure billing visibility (source contract)", () => {
  const root = join(__dirname, "..");

  it("My Day Close uses loud post-closure alert", () => {
    const src = readFileSync(join(root, "pages/MyDayClose.tsx"), "utf8");
    expect(src).toContain("PostClosureLoudAlert");
    expect(src).not.toContain("Post-Closure Activity Chocolate Box");
  });

  it("My Daily Summary marks same-day-after-prior-close open-window bills", () => {
    const src = readFileSync(join(root, "pages/MyDailySummary.tsx"), "utf8");
    expect(src).toContain("PostClosureLoudAlert");
    expect(src).toContain("SameDayAfterCloseBadge");
    expect(src).toContain("sameDayAfterPriorClose");
  });

  it("admin Day Close shows staff post-closure overview + open-window same-day mark", () => {
    const src = readFileSync(join(root, "pages/DayClose.tsx"), "utf8");
    expect(src).toContain("StaffPostClosureOverviewBanner");
    expect(src).toContain("overall-same-day-after-close");
    expect(src).toContain("sameDayAfterPriorCloseBills");
    expect(src).toContain("billed after close");
  });

  it("loud alert component exposes same-day badge test ids", () => {
    const src = readFileSync(join(root, "components/PostClosureLoudAlert.tsx"), "utf8");
    expect(src).toContain('data-testid="post-closure-loud-alert"');
    expect(src).toContain('data-testid="same-day-after-close-badge"');
    expect(src).toContain('data-testid="same-day-after-close-row-badge"');
    expect(src).toContain('data-testid="staff-post-closure-overview"');
  });
});
