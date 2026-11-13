/**
 * deskBillAnnouncements.ts — the ledger's witness of what a billing desk
 * PRINTED but has not yet DELIVERED.
 *
 * Why this table exists: when POST /api/billing/save refuses (LAN drop, NAS
 * reboot, the 5xx window of a deploy) the desk queues the bill in that
 * browser's localStorage and prints a PROVISIONAL receipt anyway
 * (artifacts/diagnostic-erp/src/lib/offlineBillingQueue.ts). Before this table
 * a queue that never replayed left NO server-side trace — no order row, no bill
 * row — so the cash sat in a drawer while the bills register, Reconciliation and
 * Day Close all correctly reported nothing. The only detector was someone
 * physically counting.
 *
 * How it closes that gap: the desk announces its outstanding queue to the server
 * on every sync tick, BEFORE it attempts the replay. So the first moment the API
 * answers again, the clinic has a record of what each PC is holding — even if
 * that browser profile is then cleared, the PC is reimaged, or one poisoned
 * entry stalls the queue behind it.
 *
 * Delivery is DERIVED, never claimed. There is no "synced" flag for the client
 * to set: a row stops being outstanding when a non-cancelled bill carries the
 * same client_ref (see lib/deskBillAnnouncements.ts). The bill itself is the
 * receipt, so a client that lies, dies, or forgets cannot close its own witness.
 *
 * Alerting data, not accounting data. `total_amount` is what the desk says the
 * bill was and is used only to size an alarm — it never enters the ledger, Day
 * Close, or any financial report. No PHI: ids and amounts only.
 */

import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const deskBillAnnouncementsTable = pgTable(
  "desk_bill_announcements",
  {
    id: serial("id").primaryKey(),

    /** The same UUID the desk puts on /api/billing/save — the join key to bills.client_ref. */
    clientRef: text("client_ref").notNull(),

    /** pending = the desk still owes this. withdrawn = discarded at the desk, so stop alarming. */
    state: text("state").notNull().default("pending"),

    /** The OFF-… number printed on the paper receipt, for matching it by hand. */
    provisionalBillNumber: text("provisional_bill_number"),

    patientId: integer("patient_id"),
    testCount: integer("test_count").notNull().default(0),

    /** Alarm sizing only — never posted to the ledger. */
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),

    /**
     * window.location.hostname of the desk PC. The ERP has no per-browser
     * identity concept, and this is the same surrogate the radiology study
     * locks use (radiology_study_locks.workstation) — enough to say "this is
     * the front-desk machine, not the report PC".
     */
    workstation: text("workstation"),

    announcedBy: text("announced_by"),
    announcedById: integer("announced_by_id"),

    /** Why the replay is still failing, as reported by the desk's last attempt. */
    lastError: text("last_error"),

    /** What the alarm measures: the bill has been undelivered since this instant. */
    firstAnnouncedAt: timestamp("first_announced_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Rewritten on every announcement, so it is the desk's latest statement that
     * it still holds the bill — deliberately NOT used for age: a stuck queue
     * re-announces every 5 seconds, which would keep resetting the clock.
     */
    lastAnnouncedAt: timestamp("last_announced_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => ({
    /** One witness per submission; the desk re-announces the same bill every tick. */
    clientRefUq: uniqueIndex("desk_bill_announcements_client_ref_uq").on(t.clientRef),
    stateIdx: index("desk_bill_announcements_state_idx").on(t.state, t.firstAnnouncedAt),
  }),
);

export type DeskBillAnnouncement = typeof deskBillAnnouncementsTable.$inferSelect;
export type InsertDeskBillAnnouncement = typeof deskBillAnnouncementsTable.$inferInsert;
