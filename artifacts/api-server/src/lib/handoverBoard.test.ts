import { describe, expect, it } from "vitest";
import { buildHandoverBoard, type BoardSlipRow } from "./handoverBoard";

// No database, no request layer: this module is arithmetic over rows the route
// has already fetched, so every case below is a real behavioural test that runs
// on a machine where PostgreSQL is not reachable.

const IST_TODAY = "2026-10-06";
// 2026-10-06 00:00 IST = 2026-10-05T18:30:00Z
const TODAY_START = new Date("2026-10-05T18:30:00.000Z");
const NOW = new Date("2026-10-06T13:00:00.000Z"); // 6:30 pm IST

function slip(over: Partial<BoardSlipRow> & { id: number; userName: string }): BoardSlipRow {
  const collected = over.totalExpected ?? 0;
  const counted = over.totalActual ?? collected;
  return {
    id: over.id,
    userName: over.userName,
    closedAt: over.closedAt ?? new Date("2026-10-06T12:30:00.000Z"),
    coveredFromTs: over.coveredFromTs ?? new Date("2026-10-06T03:00:00.000Z"),
    totalExpected: collected,
    totalActual: counted,
    variance: over.variance ?? counted - collected,
    drawerStatus: over.drawerStatus ?? "balanced",
  };
}

function board(args: Partial<Parameters<typeof buildHandoverBoard>[0]> = {}) {
  return buildHandoverBoard({
    now: NOW,
    istToday: IST_TODAY,
    todayStartIst: TODAY_START,
    lastOverallClose: null,
    collectedTodayCalendar: 0,
    slips: [],
    live: [],
    ...args,
  });
}

describe("one row per person, one slip per handover", () => {
  it("numbers a second same-evening handover #2 without rewriting #1", () => {
    const b = board({
      slips: [
        slip({
          id: 11, userName: "Sanjeev Kumar",
          coveredFromTs: new Date("2026-10-05T09:46:00.000Z"),
          closedAt: new Date("2026-10-06T12:32:00.000Z"),
          totalExpected: 243000, totalActual: 243000,
        }),
        slip({
          id: 12, userName: "Sanjeev Kumar",
          coveredFromTs: new Date("2026-10-06T12:32:00.000Z"),
          closedAt: new Date("2026-10-06T15:10:00.000Z"),
          totalExpected: 4100, totalActual: 4100,
        }),
      ],
    });
    const row = b.rows[0];
    expect(row.slips.map((s) => s.slipNo)).toEqual([1, 2]);
    // Ordered by time, not by the order the database happened to return them.
    expect(row.slips[0].closureId).toBe(11);
    expect(row.slips[1].closureId).toBe(12);
    expect(row.handedOver).toBe(247100);
    expect(b.totals.slipsToday).toBe(2);
  });

  it("shows a cashier who has not closed as still open, with their cash in hand", () => {
    const b = board({ live: [{ userName: "Deepa Rani", withStaff: 1200, withStaffPayments: 2 }] });
    const row = b.rows[0];
    expect(row.slips).toEqual([]);
    expect(row.state).toBe("still_open");
    expect(row.handedOver).toBe(0);
    expect(row.withStaff).toBe(1200);
    expect(row.lastHandoverAt).toBeNull();
  });

  it("marks a closed cashier who collected more afterwards as awaiting handover", () => {
    const b = board({
      slips: [slip({ id: 21, userName: "Sanjeev Kumar", totalExpected: 5000, totalActual: 5000 })],
      live: [{ userName: "Sanjeev Kumar", withStaff: 900, withStaffPayments: 1 }],
    });
    expect(b.rows[0].state).toBe("awaiting_handover");
    expect(b.rows[0].withStaff).toBe(900);
    expect(b.totals.awaitingHandoverStaff).toBe(1);
  });
});

describe("the day boundary is stated, not assumed", () => {
  it("flags a slip whose window began before today's IST midnight", () => {
    const b = board({
      slips: [
        // Sanjeev's real 5 Oct drawer: window opened the previous afternoon.
        slip({
          id: 31, userName: "Sanjeev Kumar",
          coveredFromTs: new Date("2026-10-04T09:46:00.000Z"),
          closedAt: new Date("2026-10-05T11:45:00.000Z"),
          totalExpected: 243000, totalActual: 243000,
        }),
        slip({
          id: 32, userName: "Vijay Yadav",
          coveredFromTs: new Date("2026-10-06T03:30:00.000Z"),
          totalExpected: 10000, totalActual: 10000,
        }),
      ],
    });
    expect(b.rows.find((r) => r.userName === "Sanjeev Kumar")!.slips[0].spansYesterday).toBe(true);
    expect(b.rows.find((r) => r.userName === "Vijay Yadav")!.slips[0].spansYesterday).toBe(false);
  });

  it("keeps the handover frame and the calendar frame as separate numbers", () => {
    // ₹2,43,000 handed over today, but most of it was collected yesterday.
    const b = board({
      slips: [slip({
        id: 41, userName: "Sanjeev Kumar",
        coveredFromTs: new Date("2026-10-04T09:46:00.000Z"),
        totalExpected: 243000, totalActual: 243000,
      })],
      collectedTodayCalendar: 60000,
    });
    expect(b.totals.handedOver).toBe(243000);
    expect(b.totals.accountedFor).toBe(243000);
    expect(b.totals.collectedTodayCalendar).toBe(60000);
    // The gap is reported, never hidden inside either figure.
    expect(b.totals.carriedAcrossMidnight).toBe(183000);
  });
});

describe("the three totals reconcile by definition", () => {
  it("adds handed over and with staff to everything accounted for", () => {
    const b = board({
      slips: [
        slip({ id: 51, userName: "Sanjeev Kumar", totalExpected: 243000, totalActual: 243000 }),
        slip({ id: 52, userName: "Vijay Yadav", totalExpected: 102500, totalActual: 102500 }),
      ],
      live: [
        { userName: "Sanjeev Kumar", withStaff: 4100, withStaffPayments: 2 },
        { userName: "Deepa Rani", withStaff: 1200, withStaffPayments: 1 },
      ],
    });
    expect(b.totals.handedOver).toBe(345500);
    expect(b.totals.withStaff).toBe(5300);
    expect(b.totals.accountedFor).toBe(b.totals.handedOver + b.totals.withStaff);
  });

  it("counts a shortage against the slip, keeping counted minus expected", () => {
    const b = board({
      slips: [slip({
        id: 61, userName: "Rakesh", totalExpected: 8400, totalActual: 8000,
        drawerStatus: "mismatch",
      })],
    });
    expect(b.rows[0].variance).toBe(-400);
    expect(b.totals.slipsUnbalanced).toBe(1);
    expect(b.totals.boardIsClear).toBe(false);
  });

  it("is clear only when every slip matches and nobody holds cash", () => {
    const slips = [slip({ id: 71, userName: "Sanjeev Kumar", totalExpected: 5000, totalActual: 5000 })];
    const clean = board({
      slips,
      live: [{ userName: "Sanjeev Kumar", withStaff: 0, withStaffPayments: 0 }],
    });
    expect(clean.totals.boardIsClear).toBe(true);

    const cashStillOut = board({
      slips,
      live: [{ userName: "Sanjeev Kumar", withStaff: 100, withStaffPayments: 1 }],
    });
    expect(cashStillOut.totals.boardIsClear).toBe(false);
  });
});

describe("yesterday's unaccepted handover follows the person, not the day", () => {
  it("marks cash that has been sitting since an earlier day", () => {
    const b = board({
      slips: [slip({ id: 91, userName: "Rakesh", totalExpected: 8000, totalActual: 8000 })],
      live: [{
        userName: "Rakesh", withStaff: 5300, withStaffPayments: 4,
        withStaffSinceIstDate: "2026-10-05",
      }],
    });
    expect(b.rows[0].withStaffCarriedFrom).toBe("2026-10-05");
    expect(b.totals.carriedFromEarlierDays).toBe(5300);
    expect(b.totals.carriedStaffCount).toBe(1);
    expect(b.totals.boardIsClear).toBe(false);
  });

  it("does not mark cash collected today as carried over", () => {
    const b = board({
      live: [{ userName: "Rakesh", withStaff: 5300, withStaffPayments: 4, withStaffSinceIstDate: IST_TODAY }],
    });
    expect(b.rows[0].withStaffCarriedFrom).toBeNull();
    expect(b.totals.carriedFromEarlierDays).toBe(0);
    expect(b.totals.carriedStaffCount).toBe(0);
  });

  it("ranks an older unpaid line above a larger one from today", () => {
    const b = board({
      live: [
        { userName: "Rakesh", withStaff: 400, withStaffPayments: 1, withStaffSinceIstDate: "2026-10-05" },
        { userName: "Sanjeev Kumar", withStaff: 9000, withStaffPayments: 6, withStaffSinceIstDate: IST_TODAY },
      ],
    });
    expect(b.rows.map((r) => r.userName)).toEqual(["Rakesh", "Sanjeev Kumar"]);
  });

  it("closes the day anyway, with the carried amount still on the board", () => {
    // The owner's decision: nothing blocks the close. What blocks is forgetting.
    const b = board({
      slips: [slip({ id: 92, userName: "Vijay", totalExpected: 10000, totalActual: 10000 })],
      live: [
        { userName: "Vijay", withStaff: 0, withStaffPayments: 0 },
        { userName: "Rakesh", withStaff: 5300, withStaffPayments: 4, withStaffSinceIstDate: "2026-10-05" },
      ],
      collectedTodayCalendar: 10000,
    });
    expect(b.totals.handedOver).toBe(10000);
    expect(b.totals.withStaff).toBe(5300);
    expect(b.totals.accountedFor).toBe(15300);
    expect(b.totals.carriedFromEarlierDays).toBe(5300);
    expect(b.totals.boardIsClear).toBe(false);
  });
});

describe("the board is a queue at closing time", () => {
  it("puts whoever still owes cash first, largest amount at the top", () => {
    // Deliberately fed in reverse-alphabetical order for the settled staff, so
    // the name tie-break is the only thing that can put Anil before Zaira.
    // (A first draft of this test passed against a broken sort, because the
    // input order already matched the expected output.)
    const b = board({
      slips: [
        slip({ id: 82, userName: "Zaira", totalExpected: 900, totalActual: 900 }),
        slip({ id: 81, userName: "Anil", totalExpected: 1000, totalActual: 1000 }),
      ],
      live: [
        { userName: "Zaira", withStaff: 0, withStaffPayments: 0 },
        { userName: "Anil", withStaff: 0, withStaffPayments: 0 },
        { userName: "Deepa", withStaff: 500, withStaffPayments: 1 },
        { userName: "Rakesh", withStaff: 2500, withStaffPayments: 3 },
      ],
    });
    expect(b.rows.map((r) => r.userName)).toEqual([
      "Rakesh", "Deepa", // owing, biggest first
      "Anil", "Zaira",   // settled, alphabetical — not input order
    ]);
  });
});
