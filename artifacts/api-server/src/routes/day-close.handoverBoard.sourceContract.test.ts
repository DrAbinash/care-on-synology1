import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The operator's instruction was explicit: merge the handover board INTO the
// Day Close screen he already opens at 6 pm — "dont build a new one". A board
// on its own page would have given him two places to look and a second
// definition of today to reconcile, which is the exact fault being fixed.
//
// There is no browser harness for the ERP on this machine, so the wiring is
// pinned at source and stated plainly rather than simulated.

const __dirname = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(__dirname, "day-close.ts"), "utf8");
const erp = join(__dirname, "../../../diagnostic-erp/src");
const page = readFileSync(join(erp, "pages/DayClose.tsx"), "utf8");

describe("the handover board rides on the request Day Close already makes", () => {
  it("staff-status returns the board", () => {
    const status = api.slice(
      api.indexOf('dayCloseRouter.get("/staff-status"'),
      api.indexOf('dayCloseRouter.get("/staff-close-detail'),
    );
    expect(status.length).toBeGreaterThan(1000);
    expect(status).toContain("handover: buildHandoverBoard({");
    // Reuses rows already fetched there — no second pass over the database.
    expect(status).toContain("todayCloseRows.map((c) => ({");
    expect(status).toContain("usersWithTodayCounts.map((u) => ({");
  });

  it("did not grow a separate endpoint or screen", () => {
    expect(api).not.toContain('dayCloseRouter.get("/handover-board"');
    expect(page).not.toContain("/api/day-close/handover-board");
    const app = readFileSync(join(erp, "App.tsx"), "utf8");
    const layout = readFileSync(join(erp, "components/Layout.tsx"), "utf8");
    expect(app).not.toContain("handover-board");
    expect(layout).not.toContain("handover-board");
  });

  it("keeps the arithmetic out of the route, where it can be tested without a database", () => {
    expect(api).toContain('from "../lib/handoverBoard"');
    expect(readFileSync(join(__dirname, "../lib/handoverBoard.ts"), "utf8"))
      .not.toContain("from \"@workspace/db\"");
  });
});

describe("Day Close shows what is handed over, what is still out, and why they differ", () => {
  it("gives the staff table a With staff column", () => {
    expect(page).toMatch(/>With staff<\/th>/);
    expect(page).toContain('data-testid="with-staff-cell"');
    expect(page).toContain("h.withStaffCarriedFrom");
    // The carried-over badge names a DAY. A first draft formatted it with
    // fmtTime(), which returns "12:00 am" for a midnight instant — a date read
    // as a clock time is the kind of wrong that survives code review.
    expect(page).toContain("since {fmtDay(h.withStaffCarriedFrom)}");
    expect(page).not.toMatch(/fmtTime\(`\$\{h\.withStaffCarriedFrom\}/);
  });

  it("numbers the slips and says what each one collected, not just what it counted", () => {
    expect(page).toContain("slipByClosureId");
    expect(page).toMatch(/#\$\{s\.slipNo\}/);
    expect(page).toMatch(/>Collected<\/th>/);
    expect(page).toMatch(/>Counted<\/th>/);
    expect(page).toMatch(/>Variance<\/th>/);
    // The reason the slips will not add up to the calendar day, said out loud.
    expect(page).toContain("spans earlier");
  });

  it("states the three reconciling figures and the calendar one separately", () => {
    expect(page).toContain('data-testid="handover-summary"');
    for (const label of ["Handed over today", "Still with staff", "Accounted for"]) {
      expect(page).toContain(`"${label}"`);
    }
    expect(page).toContain("handover.totals.collectedTodayCalendar");
    expect(page).toContain("handover.totals.carriedAcrossMidnight");
  });

  it("carries an unpaid handover forward instead of blocking the day", () => {
    // The operator's decision: closing the day is never blocked by somebody
    // else's missing cash — but the line must not be able to disappear either.
    expect(page).toContain('data-testid="carried-over-alert"');
    expect(page).toContain("role=\"alert\"");
    expect(page).toContain("handover.totals.carriedFromEarlierDays");
    expect(page).toContain('data-testid="board-open"');
    expect(page).toContain("these lines carry forward");
    expect(page).not.toMatch(/disabled=\{[^}]*!handover\.totals\.boardIsClear/);
  });
});
