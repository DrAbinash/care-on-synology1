/**
 * The one place the ERP turns a stored `drawer_status` into words.
 *
 * The server used to write only "balanced" or "mismatch", and every screen that
 * showed the status either printed the raw column or treated "not balanced" as
 * "mismatch". Both are wrong now that a close can record that nobody counted the
 * cash: a drawer closed without a count has variance zero, so the old rendering
 * labelled it a Mismatch of ₹0.00 — or a Balance, depending on the screen.
 *
 * Anything the server may write in future falls back to a humanised version of
 * the value rather than to "Open", which is what the per-screen config-object
 * lookups did (`CONFIG[status] ?? CONFIG.open`) and read as an unfinished drawer.
 */

export const DRAWER_STATUS_NOT_VERIFIED = "not_physically_verified";

const LABELS: Record<string, string> = {
  open: "Open",
  balanced: "Balanced",
  mismatch: "Mismatch",
  approved: "Approved",
  closed: "Closed",
  reopened: "Reopened",
  [DRAWER_STATUS_NOT_VERIFIED]: "Not Physically Verified",
};

export function drawerStatusLabel(status: string | null | undefined): string {
  if (!status) return "Open";
  const known = LABELS[status];
  if (known) return known;
  return status
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * What a NULL `coveredFromTs` actually means, said out loud.
 *
 * A staff member with no previous close and no previous clinic-wide close gets no
 * carry-forward boundary, so their first window reaches back to their earliest
 * record — which is real money, but is not "today". Every screen rendered that as
 * an em dash, indistinguishable from "still loading", so the first close of a new
 * cashier looked like an empty day while reconciling their whole history.
 */
export const FIRST_CLOSE_WINDOW_TEXT = "First close — no earlier boundary; covers every record to date";

export function windowFromCell(
  coveredFromTs: string | null | undefined,
  format: (iso: string) => string,
): string {
  if (!coveredFromTs) return FIRST_CLOSE_WINDOW_TEXT;
  return format(coveredFromTs);
}

/**
 * What this close will RECORD, shown before the cashier signs off.
 *
 * Mirrors `staffDrawerStatus` in `artifacts/api-server/src/routes/day-close.ts`.
 * The two are pinned by the same 12-row truth table in each package's test, so a
 * server rule change that the screen has not learned fails a test rather than
 * quietly printing "Balanced" over an unchecked box.
 */
export function predictedCloseLabel(args: {
  variance: number;
  physicallyCounted: boolean;
  denominationsEntered: boolean;
}): string {
  return drawerStatusLabel(
    args.variance !== 0
      ? "mismatch"
      : args.physicallyCounted || args.denominationsEntered
        ? "balanced"
        : DRAWER_STATUS_NOT_VERIFIED,
  );
}
