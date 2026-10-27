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

  it("My Daily Summary merges all-staff post-closure into Staff Activity", () => {
    const src = readFileSync(join(root, "pages/MyDailySummary.tsx"), "utf8");
    expect(src).toContain('data-testid="staff-activity-panel"');
    expect(src).toContain('data-testid="staff-post-closure-overview"');
    expect(src).toContain("/api/day-close/staff-status");
    expect(src).toContain("showIndividualPostClosure");
    expect(src).toContain("After close");
    // All-staff orange is in Staff Activity — not a detached duplicate banner call
    expect(src).not.toContain("<StaffPostClosureOverviewBanner");
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

  it("loud alert starts collapsed with crisp ribbon summary still visible", () => {
    const src = readFileSync(join(root, "components/PostClosureLoudAlert.tsx"), "utf8");
    expect(src).toContain("defaultOpen = false");
    expect(src).toContain('data-testid="post-closure-loud-alert-toggle"');
    expect(src).toContain('data-testid="post-closure-loud-alert-summary"');
    expect(src).toContain('data-testid="post-closure-loud-alert-body"');
    expect(src).toContain("{open && (");
  });

  it("the payments-after-close row names its bill, patient and referral", () => {
    const src = readFileSync(join(root, "components/PostClosureLoudAlert.tsx"), "utf8");
    expect(src).toMatch(/\{p\.billNumber \|\| `Bill #\$\{p\.billId\}`\}/);
    expect(src).toContain("p.patientName");
    expect(src).toContain("p.referringDoctor");
    expect(src).toContain("No referral");
    // Positive control: the cell used to be this line on its own, and the ban below
    // is only a ban because it would fire on it.
    const oldCell = "                          Bill #{p.billId}\n";
    expect(oldCell).toMatch(/^\s*Bill #\{p\.billId\}\s*$/m);
    expect(src).not.toMatch(/^\s*Bill #\{p\.billId\}\s*$/m);
    // The bills half of this same component already printed the real number; the
    // payments half did not. Asserting both keeps the two halves from drifting.
    expect(src).toContain("{b.billNumber}");
  });
});
