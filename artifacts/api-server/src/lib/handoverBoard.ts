// The handover board: what cash has been handed to the owner today, what is
// still sitting with a staff member, and whether those two add up.
//
// Deliberately a pure module — no `db` import — so it runs in a unit test on a
// machine with no database, following the `maxBoundary` / `classifyAndBucketPayments`
// precedent in routes/day-close.ts. The route gathers rows and hands them over.
//
// WHY THIS SCREEN EXISTS
// The ERP has always had three different answers to "what is today":
//   · a staff drawer runs close-to-close — MAX(last overall close, their own last
//     close) → now, so a shift can start at 3:16 pm yesterday;
//   · the clinic's overall close also runs close-to-close, but stamps itself with
//     today's calendar date;
//   · the daily summary and every report run calendar midnight → midnight (IST).
// All three are correct. Reading them side by side is what made My Daily Summary
// unreadable: a cashier's closed ₹2,43,000 drawer sitting under a row of zeros
// that belonged to a different person entirely.
//
// The board therefore shows ONE frame — the handover frame, because that is how
// the clinic physically closes — and states the calendar figure separately
// instead of blending the two. When the two disagree it says why: a slip whose
// window began before today's midnight carries yesterday's cash into today's
// count, and that is the only legitimate reason the numbers differ.

export type BoardSlipRow = {
  id: number;
  userName: string;
  /** When the staff member closed. Also the instant their window stopped. */
  closedAt: Date | string | null;
  /** Start of the window this slip covers — may be yesterday. */
  coveredFromTs: Date | string | null;
  totalExpected: number;
  totalActual: number;
  /** Stored as totalActual - totalExpected. Negative = short. */
  variance: number;
  drawerStatus: string;
};

export type BoardLiveRow = {
  userName: string;
  /** Money collected since this person's last slip — cash physically with them. */
  withStaff: number;
  /**
   * Payment count in that open window, from the same totals object in both
   * branches. Deliberately payments and not bills: the per-user and shared-window
   * paths both carry a payment count, only one carries a bill count, and a
   * column that is quietly zero for half the rows is worse than no column.
   */
  withStaffPayments: number;
  /**
   * IST date label (YYYY-MM-DD) of the day their open window began. When that
   * is earlier than today, the cash they are holding is already a day old —
   * this is how yesterday's unaccepted handover shows up on today's board
   * without needing any new column: the window itself remembers.
   */
  withStaffSinceIstDate?: string | null;
};

export type BoardSlip = {
  slipNo: number;
  closureId: number;
  closedAt: string | null;
  coveredFromTs: string | null;
  collected: number;
  counted: number;
  variance: number;
  drawerStatus: string;
  /** True when this slip's window began before today's IST midnight. */
  spansYesterday: boolean;
};

export type BoardRow = {
  userName: string;
  slips: BoardSlip[];
  /** Sum of counted cash across today's slips — money the owner physically holds. */
  handedOver: number;
  /** Sum of what those slips' windows collected. */
  collectedInSlips: number;
  variance: number;
  /** Cash collected since their last slip and not yet handed over. */
  withStaff: number;
  withStaffPayments: number;
  /**
   * Set when that cash has been sitting since an earlier day — the carried
   * exception line. It stays on the board until it is handed over.
   */
  withStaffCarriedFrom: string | null;
  /**
   * awaiting_handover — they closed, and money arrived afterwards that is still theirs.
   * handed_over        — they closed and nothing has come in since.
   * still_open         — they have not closed at all today.
   */
  state: "awaiting_handover" | "handed_over" | "still_open";
  lastHandoverAt: string | null;
};

export type HandoverBoard = {
  generatedAt: string;
  closureDate: string;
  lastOverallClose: string | null;
  rows: BoardRow[];
  totals: {
    handedOver: number;
    withStaff: number;
    /** handedOver + withStaff — everything the board accounts for. */
    accountedFor: number;
    /** Calendar-day collections, the figure every report uses. Shown, never blended. */
    collectedTodayCalendar: number;
    /**
     * accountedFor minus the calendar figure: non-zero only because slips run
     * close-to-close and carry across midnight. Explained by spansYesterday rows.
     */
    carriedAcrossMidnight: number;
    slipsToday: number;
    slipsUnbalanced: number;
    awaitingHandoverStaff: number;
    /**
     * Cash that has been sitting with a staff member since an earlier day —
     * yesterday's handover that never happened. The day still closes; this
     * line does not go away until someone is paid out.
     */
    carriedFromEarlierDays: number;
    carriedStaffCount: number;
    /** True when every slip's counted matches its collected and nothing is with staff. */
    boardIsClear: boolean;
  };
};

function iso(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : d.toISOString();
}

function asDate(v: Date | string | null): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Build the board.
 *
 * `slips` must already be restricted to the IST closure date, and `live` to
 * active staff — that filtering is the route's job, because it needs the
 * database to do it. Everything here is arithmetic and ordering.
 */
export function buildHandoverBoard(args: {
  now: Date | string;
  istToday: string;
  /** Instant of IST midnight that begins `istToday`. */
  todayStartIst: Date | string;
  lastOverallClose: Date | string | null;
  collectedTodayCalendar: number;
  slips: BoardSlipRow[];
  live: BoardLiveRow[];
}): HandoverBoard {
  const todayStart = asDate(args.todayStartIst);

  const names = new Set<string>();
  const slipsByUser = new Map<string, BoardSlipRow[]>();
  for (const s of args.slips) {
    if (!s.userName) continue;
    names.add(s.userName);
    const list = slipsByUser.get(s.userName) ?? [];
    list.push(s);
    slipsByUser.set(s.userName, list);
  }
  const liveByUser = new Map<string, BoardLiveRow>();
  for (const l of args.live) {
    if (!l.userName) continue;
    names.add(l.userName);
    liveByUser.set(l.userName, l);
  }

  const rows: BoardRow[] = [];
  for (const userName of names) {
    // Slip #1 is the first handover of the day, #2 the next, and so on. A
    // cashier who closes at 6 pm and hands over again at 8:40 pm gets a second
    // slip; the first is never rewritten, which is what makes the pair auditable.
    const ordered = (slipsByUser.get(userName) ?? [])
      .slice()
      .sort((a, b) => (asDate(a.closedAt)?.getTime() ?? 0) - (asDate(b.closedAt)?.getTime() ?? 0));

    const slips: BoardSlip[] = ordered.map((s, i) => {
      const from = asDate(s.coveredFromTs);
      return {
        slipNo: i + 1,
        closureId: s.id,
        closedAt: iso(s.closedAt),
        coveredFromTs: iso(s.coveredFromTs),
        collected: s.totalExpected,
        counted: s.totalActual,
        variance: s.variance,
        drawerStatus: s.drawerStatus,
        spansYesterday: !!from && !!todayStart && from.getTime() < todayStart.getTime(),
      };
    });

    const handedOver = slips.reduce((sum, s) => sum + s.counted, 0);
    const collectedInSlips = slips.reduce((sum, s) => sum + s.collected, 0);
    const variance = slips.reduce((sum, s) => sum + s.variance, 0);
    const liveRow = liveByUser.get(userName);
    const withStaff = liveRow?.withStaff ?? 0;
    const withStaffPayments = liveRow?.withStaffPayments ?? 0;
    // ISO date labels compare correctly as text, which keeps this module free
    // of any timezone handling.
    const sinceLabel = liveRow?.withStaffSinceIstDate ?? null;
    const withStaffCarriedFrom = withStaff > 0 && !!sinceLabel && sinceLabel < args.istToday
      ? sinceLabel
      : null;

    rows.push({
      userName,
      slips,
      handedOver,
      collectedInSlips,
      variance,
      withStaff,
      withStaffPayments,
      withStaffCarriedFrom,
      state: slips.length === 0
        ? "still_open"
        : withStaff > 0 ? "awaiting_handover" : "handed_over",
      lastHandoverAt: slips.length ? slips[slips.length - 1].closedAt : null,
    });
  }

  // Oldest unpaid cash at the very top — yesterday's unaccepted handover outranks
  // anything from today. Then whoever still owes cash, largest first. Settled
  // staff fall below in name order. At 6 pm the board is a queue, not a directory.
  rows.sort((a, b) => {
    const aCarried = a.withStaffCarriedFrom ? 1 : 0;
    const bCarried = b.withStaffCarriedFrom ? 1 : 0;
    if (bCarried !== aCarried) return bCarried - aCarried;
    const aOwes = a.withStaff > 0 ? 1 : 0;
    const bOwes = b.withStaff > 0 ? 1 : 0;
    if (bOwes !== aOwes) return bOwes - aOwes;
    if (b.withStaff !== a.withStaff) return b.withStaff - a.withStaff;
    return a.userName.localeCompare(b.userName);
  });

  const handedOverTotal = rows.reduce((sum, r) => sum + r.handedOver, 0);
  const withStaffTotal = rows.reduce((sum, r) => sum + r.withStaff, 0);
  const carriedRows = rows.filter((r) => r.withStaffCarriedFrom !== null);
  const accountedFor = handedOverTotal + withStaffTotal;
  const slipsToday = rows.reduce((sum, r) => sum + r.slips.length, 0);
  const slipsUnbalanced = rows.reduce(
    (sum, r) => sum + r.slips.filter((s) => Math.abs(s.variance) > 0.009).length,
    0,
  );

  return {
    generatedAt: iso(args.now) ?? new Date(args.now).toISOString(),
    closureDate: args.istToday,
    lastOverallClose: iso(args.lastOverallClose),
    rows,
    totals: {
      handedOver: handedOverTotal,
      withStaff: withStaffTotal,
      accountedFor,
      collectedTodayCalendar: args.collectedTodayCalendar,
      carriedAcrossMidnight: accountedFor - args.collectedTodayCalendar,
      slipsToday,
      slipsUnbalanced,
      awaitingHandoverStaff: rows.filter((r) => r.withStaff > 0).length,
      carriedFromEarlierDays: carriedRows.reduce((sum, r) => sum + r.withStaff, 0),
      carriedStaffCount: carriedRows.length,
      // "Clear" means the owner can close the day: every slip's count matches
      // what the software collected, and nobody is holding cash.
      boardIsClear: slipsUnbalanced === 0 && withStaffTotal === 0,
    },
  };
}
