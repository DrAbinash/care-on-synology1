/**
 * /api/desk-bills — what the billing desks printed but have not delivered.
 *
 * POST /announcements   a desk reports the bills sitting in its local offline
 *                       queue. Called on the sync tick BEFORE the replay is
 *                       attempted, so the clinic gains a record of what was
 *                       printed even if that browser never replays (profile
 *                       cleared, PC reimaged, one poisoned entry stalling the
 *                       queue behind it).
 * GET  /outstanding     announcements with no matching non-cancelled bill — the
 *                       reading behind the Daily Summary "Desk Bills" light.
 *
 * Two rules the feature depends on:
 *
 * 1. THE WRITE LEG IS TELEMETRY. Every failure answers HTTP 200 {ok:false}. This
 *    runs on the same tick that then replays real bills, so a 500 here must never
 *    become a reason for the desk's sync loop to stop — and for some of these
 *    bills the announcement is the only witness they will ever have. (Same
 *    discipline as careUsgCompanion.ts's POST /runs: "Telemetry must never break
 *    the workflow".)
 * 2. DELIVERY IS NOT CLAIMED. Nothing marks a bill synced. Outstanding is derived
 *    by joining client_ref to bills — lib/deskBillAnnouncements.ts — so a client
 *    cannot close its own witness.
 *
 * Auth: staff session holding the /billing permission (the desk does; admin and
 * super_admin always pass) — mounted in routes/index.ts. Amounts recorded here
 * size an alarm and are never posted to the ledger.
 */
import { Router } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import {
  DEFAULT_ANNOUNCE_GRACE_MINUTES,
  coerceAnnouncement,
  summarizeDeskBillWitnesses,
  type DeskAnnouncementInput,
} from "../lib/deskBillAnnouncements";

export const deskBillAnnouncementsRouter = Router();

/**
 * Bound on one manifest. A desk holding more bills than this has a far bigger
 * problem than this table can name, and the cap keeps one request from writing
 * an unbounded batch.
 */
const MAX_ITEMS_PER_ANNOUNCEMENT = 200;

const queryRows = async (text: string, params?: unknown[]): Promise<Array<Record<string, unknown>>> => {
  const r = await pool.query(text, params as unknown[] | undefined);
  return r.rows as Array<Record<string, unknown>>;
};

/**
 * $-placeholders, not the drizzle `sql` template: this statement is one
 * parameterized string so nothing client-supplied is ever concatenated into SQL
 * text. `first_announced_at` is absent from the SET list on purpose — a
 * re-announcement must not reset the age the alarm measures.
 */
const UPSERT_SQL = `
  INSERT INTO desk_bill_announcements
    (client_ref, state, provisional_bill_number, patient_id, test_count, total_amount,
     workstation, announced_by, announced_by_id, last_error,
     first_announced_at, last_announced_at, withdrawn_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11)
  ON CONFLICT (client_ref) DO UPDATE SET
    state                 = EXCLUDED.state,
    provisional_bill_number = EXCLUDED.provisional_bill_number,
    patient_id            = EXCLUDED.patient_id,
    test_count            = EXCLUDED.test_count,
    total_amount          = EXCLUDED.total_amount,
    workstation           = EXCLUDED.workstation,
    announced_by          = EXCLUDED.announced_by,
    announced_by_id       = EXCLUDED.announced_by_id,
    last_error            = EXCLUDED.last_error,
    last_announced_at     = EXCLUDED.last_announced_at,
    withdrawn_at          = EXCLUDED.withdrawn_at
`;

async function upsertAnnouncement(
  v: DeskAnnouncementInput,
  staff: { subjectName: string | null; subjectId: number | null },
): Promise<void> {
  await pool.query(UPSERT_SQL, [
    v.clientRef,
    v.state,
    v.provisionalBillNumber,
    v.patientId,
    v.testCount,
    v.totalAmount,
    v.workstation,
    staff.subjectName,
    staff.subjectId,
    v.lastError,
    v.state === "withdrawn" ? new Date() : null,
  ]);
}

deskBillAnnouncementsRouter.post("/announcements", async (req: StaffAuthRequest, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS_PER_ANNOUNCEMENT) : [];

  // A manifest with nothing in it is the normal case, not a bad request: the desk
  // holds nothing to declare.
  if (list.length === 0) {
    res.json({ ok: true, accepted: 0 });
    return;
  }

  const workstationHost = typeof body.workstation === "string" ? body.workstation.slice(0, 120) : null;
  const staff = {
    subjectName: req.staffSession?.subjectName ?? null,
    subjectId: req.staffSession?.subjectId ?? null,
  };

  let accepted = 0;
  let failed = 0;
  for (const raw of list) {
    const v = coerceAnnouncement(raw);
    if (!v) continue;
    try {
      await upsertAnnouncement({ ...v, workstation: v.workstation ?? workstationHost }, staff);
      accepted++;
    } catch (err) {
      failed++;
      // One unusable row must not cost the rest of the manifest its witness.
      logger.warn({ err, clientRef: v.clientRef }, "desk bill announcement row failed");
    }
  }

  res.json({ ok: true, accepted, failed });
});

deskBillAnnouncementsRouter.get("/outstanding", async (req: StaffAuthRequest, res) => {
  const grace = req.query.graceMinutes;
  const graceMinutes =
    typeof grace === "string" && /^\d{1,4}$/.test(grace)
      ? Math.min(1440, Number(grace))
      : DEFAULT_ANNOUNCE_GRACE_MINUTES;
  try {
    const summary = await summarizeDeskBillWitnesses(queryRows, { graceMinutes });
    if (!summary.tablePresent) {
      res.json({
        available: false,
        reason: "desk_bill_announcements is not present in this database",
        graceMinutes,
        announcedTotal: 0,
        outstandingCount: 0,
        outstandingAmount: 0,
        oldestMinutes: null,
        rows: [],
      });
      return;
    }
    res.json({ available: true, graceMinutes, ...summary });
  } catch (err) {
    logger.error({ err }, "desk bill outstanding summary failed");
    res.status(500).json({ error: "Could not read the desk bill witness table" });
  }
});

export default deskBillAnnouncementsRouter;
