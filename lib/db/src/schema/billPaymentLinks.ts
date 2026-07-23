import { pgTable, serial, text, integer, numeric, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Online payment links for bills — additive, feature-flagged
 * (ff_online_payment_links, Shadow Mode). NON-MUTATING to the Financial Freeze:
 * this table only records the link we generated; the actual money movement runs
 * entirely through the EXISTING sanctioned path. We mint a gateway order via the
 * (unmodified) PaymentEngine with a `BILLPAY-<billId>-<token>` reference, so when
 * the patient pays, the EXISTING gateway webhook settles the bill and posts the
 * voucher — this feature never writes to bills / payments / vouchers itself.
 *
 * "Paid" status is DERIVED at read time from payment_logs + the bill balance
 * (both read-only); it is never written here by a money-movement callback.
 */
export const billPaymentLinksTable = pgTable(
  "bill_payment_links",
  {
    id: serial("id").primaryKey(),
    billId: integer("bill_id").notNull(),
    token: text("token").notNull(),                 // our link id (hex, no dashes)
    txnRef: text("txn_ref").notNull(),              // BILLPAY-<billId>-<token> sent to the gateway
    gateway: text("gateway"),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    redirectUrl: text("redirect_url"),              // hosted-checkout URL the patient opens
    // Local lifecycle only: created | sent | expired | cancelled. Payment
    // success is derived from payment_logs / bill balance, never written here.
    status: text("status").notNull().default("created"),
    channel: text("channel").notNull().default("whatsapp"),
    sentTo: text("sent_to"),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    tokenUq: uniqueIndex("bill_payment_links_token_uq").on(t.token),
    byBill: index("bill_payment_links_bill_idx").on(t.billId),
    byStatus: index("bill_payment_links_status_idx").on(t.status),
  }),
);

export type BillPaymentLink = typeof billPaymentLinksTable.$inferSelect;
