import { pgTable, serial, integer, text, timestamp, date, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Per-test queue tokens. One row per ordered test on a bill — so a single
// patient bill that contains USG + X-Ray + MRI ends up with three rows here,
// each with its own token number sequenced within (ledger, date, department).
//
// Lifecycle: waiting → serving → done   (skipped is terminal, parallel branch)
//
// The unique index on (COALESCE(ledger,1), date, department, token_no)
// guarantees concurrent inserts can never collide on the same number.
export const testTokensTable = pgTable(
  "test_tokens",
  {
    id: serial("id").primaryKey(),
    ledgerId: integer("ledger_id"),
    billId: integer("bill_id"),
    orderId: integer("order_id"),
    orderTestId: integer("order_test_id"),
    testId: integer("test_id"),
    patientId: integer("patient_id"),
    department: text("department").notNull().default("Pathology"),
    roomNumber: text("room_number").notNull().default(""),
    tokenNo: integer("token_no").notNull(),
    tokenDate: date("token_date").notNull(),
    status: text("status").notNull().default("waiting"),
    priority: integer("priority").notNull().default(0),
    // Source of the token: walkin (default), online (paid via website), vip
    source: text("source").notNull().default("walkin"),
    calledAt: timestamp("called_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    deptDailyUq: uniqueIndex("test_tokens_dept_date_no_uq").on(
      sql`COALESCE(${t.ledgerId}, 1)`,
      t.tokenDate,
      t.department,
      t.tokenNo,
    ),
    orderTestUq: uniqueIndex("test_tokens_order_test_uq").on(t.orderTestId),
  }),
);

export type TestToken = typeof testTokensTable.$inferSelect;
