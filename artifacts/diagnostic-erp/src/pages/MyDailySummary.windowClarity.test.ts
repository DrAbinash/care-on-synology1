/**
 * MyDailySummary.windowClarity.test.ts — the page mixes two clocks (selected
 * calendar dates vs drawer windows). Every box must say which one it shows,
 * because a live after-close number next to yesterday's KPIs read as a
 * shortage. Source contracts with positive controls, same as the activityLog
 * suite: a check that could pass by matching nothing is not a check.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSrc = readFileSync(resolve(__dirname, "./MyDailySummary.tsx"), "utf8");
const alertSrc = readFileSync(
  resolve(__dirname, "../components/PostClosureLoudAlert.tsx"),
  "utf8",
);

describe("page legend — the two clocks are named where the dates are picked", () => {
  it("says calendar boxes follow the dates and drawer boxes do not", () => {
    expect(pageSrc).toContain('data-testid="window-legend"');
    expect(pageSrc).toContain("use these calendar dates (IST, midnight–midnight)");
    expect(pageSrc).toContain("do not follow these dates");
  });
});

describe("drawer card — states its window and what a close means", () => {
  it("has a status-aware window note for frozen, live and reopened", () => {
    expect(pageSrc).toContain('data-testid="drawer-window-note"');
    expect(pageSrc).toContain("Frozen snapshot of one shift window");
    expect(pageSrc).toContain("Live shift window since the last close");
    expect(pageSrc).toContain("Reopened for review");
    // Positive control: the old unlabelled subtitle is gone.
    expect(pageSrc).not.toContain("Shift window snapshot — not the calendar-day cash total above");
  });

  it("names the close instant and the automatic same-day next window", () => {
    expect(pageSrc).toContain("Window covered:");
    expect(pageSrc).toContain("(the moment Close was pressed)");
    expect(pageSrc).toContain('data-testid="drawer-next-window-note"');
    expect(pageSrc).toContain("automatically opens the next window");
    expect(pageSrc).toContain("No reopen is needed to keep billing on the same day");
  });
});

describe("live open-window box — labelled LIVE and scoped to the last close", () => {
  it("says it ignores the date filter and opened at the last close", () => {
    expect(pageSrc).toContain('data-testid="live-window-range"');
    expect(pageSrc).toContain("LIVE next window, ignores the date filter above");
    expect(pageSrc).toContain('data-testid="live-window-next-note"');
    expect(pageSrc).toContain("opened automatically at the last close");
    // Positive control: the old ambiguous wording is gone.
    expect(pageSrc).not.toContain("not calendar Today (IST)");
  });
});

describe("staff activity — calendar columns vs the live after-close column", () => {
  it("marks the After close column Live and scopes the main columns to the dates", () => {
    expect(pageSrc).toContain("Main columns use the selected calendar dates");
    expect(pageSrc).toContain("not filtered by the dates above");
    expect(pageSrc).toContain(
      'title="Live since each staff\'s last drawer close — belongs to the next window; ignores the date filter"',
    );
    expect(pageSrc).toContain(">Live</span>");
  });

  it("banner says live since last close, next window, ignores the date filter", () => {
    expect(pageSrc).toContain("next window, not closed drawer · LIVE since last close (ignores the date filter above)");
  });
});

describe("individual post-closure alert — carries the page's window note", () => {
  it("passes a LIVE note and the shared component renders it", () => {
    expect(pageSrc).toContain('note="LIVE since the last close — ignores the date filter above');
    expect(alertSrc).toContain('data-testid="post-closure-window-note"');
    expect(alertSrc).toContain("{note && (");
    // Positive control: pages without a date filter are unaffected (prop optional).
    expect(alertSrc).toContain("note?: string;");
  });
});

describe("activity log — names the calendar window", () => {
  it("header says selected calendar dates, not an unlabelled period", () => {
    expect(pageSrc).toContain("— selected calendar dates (IST, midnight–midnight)");
    expect(pageSrc).not.toContain("— document activity in this period");
  });
});