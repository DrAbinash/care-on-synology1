import { pgTable, serial, integer, text, timestamp, date, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const tokensTable = pgTable(
  "tokens",
  {
    id: serial("id").primaryKey(),
    ledgerId: integer("ledger_id"),
    billId: integer("bill_id"),
    patientId: integer("patient_id"),
    tokenNo: integer("token_no").notNull(),
    tokenDate: date("token_date").notNull(),
    status: text("status").notNull().default("waiting"),
    // VIP / family / referred-friend flag — surfaces them at the top of the
    // queue UI and the public display.
    priority: integer("priority").notNull().default(0),
    // Source of the token: walkin (default), online (paid via website), vip
    source: text("source").notNull().default("walkin"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Safety net so concurrent inserts can never share the same daily number.
    // COALESCE(ledger_id, 1) folds NULL legacy rows into book #1.
    tokenDailyUq: uniqueIndex("tokens_ledger_date_no_uq").on(
      sql`COALESCE(${t.ledgerId}, 1)`,
      t.tokenDate,
      t.tokenNo,
    ),
  }),
);

export type Token = typeof tokensTable.$inferSelect;
