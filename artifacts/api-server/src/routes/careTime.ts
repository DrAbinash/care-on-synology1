import { Router, type IRouter } from "express";
import { requireStaffAuth } from "../middleware/requireStaffAuth";
import { careTimeResponse } from "../lib/careTimeContract";

/**
 * Stage 1A — the server-authoritative CARE business date.
 *
 * One question, one answer: *what CARE business date should a brand-new, blank
 * form default to?* That answer comes from trusted CARE server time, never from
 * a browser or workstation clock (management rule D-1). The ERP previously
 * derived it with `new Date().toISOString().slice(0, 10)` on the client — a
 * browser clock read through a UTC lens, which names the previous clinic day
 * between 00:00 and 05:29:59 IST (Stage 0 report §13).
 *
 * Deliberately NOT here:
 *  - No input is accepted: no `?date=`, no body, no header influences the
 *    answer. A client cannot ask CARE to confirm a date it invented.
 *  - No backdating policy. This is a *default*, not a permission; Stage 2/3 own
 *    validation and authorization, and D-2's window is still deferred.
 *  - The handler reads no database. A clinic calendar day does not need one and
 *    this is called from the app shell on every login, so it stays cheap;
 *    session validation in `requireStaffAuth` is TTL-cached exactly as it is for
 *    every other authenticated route. The Postgres-side clock is a separate,
 *    later instrument (`time_received` vs `time_processed`, Stage 1B) and
 *    `source` says so rather than implying Postgres answered.
 *  - Nothing is written, flagged or compared against history. Forward-only.
 *  - No infrastructure disclosure: no host name, no NTP source, no DB settings.
 *
 * `requireStaffAuth` is applied inside the router, matching `featureFlags.ts`,
 * so the mount point in `routes/index.ts` stays a single line.
 */
const router: IRouter = Router();

router.use(requireStaffAuth);

router.get("/now", (_req, res) => {
  res.json(careTimeResponse(new Date()));
});

export default router;
