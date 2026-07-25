import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { doctorsTable } from "./doctors";

export const commissionRulesTable = pgTable("commission_rules", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("percentage"), // 'percentage' | 'fixed'
  value: numeric("value", { precision: 10, scale: 2 }).notNull(),
  scope: text("scope").notNull().default("all"), // 'all' | 'category' | 'test'
  categories: text("categories"), // JSON array of category strings
  testIds: text("test_ids"), // JSON array of test IDs
  // Which kind of test line this slab may apply to. Outsourced work has a very
  // different margin (the clinic pays an external lab), so a clinic can set a
  // separate slab for it instead of one rate across both.
  //   'all'        — applies to any line (default; preserves existing rules)
  //   'inhouse'    — only tests performed in-house
  //   'outsourced' — only tests sent to an external lab
  appliesTo: text("applies_to").notNull().default("all"),
  isExclusive: boolean("is_exclusive").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommissionRuleSchema = createInsertSchema(commissionRulesTable).omit({ id: true, createdAt: true });
export type CommissionRule = typeof commissionRulesTable.$inferSelect;
export type InsertCommissionRule = z.infer<typeof insertCommissionRuleSchema>;

// ── Commission eligibility / hold audit trail ─────────────────────────────────
// One row per status transition of an order's referral commission under the
// clinic's commission_eligibility_policy: "on_hold" ⇄ "eligible". Written by the
// reconcile cron (and never mutated) so there is a complete, append-only history
// of when each commission was held and released, and why.
export const commissionStatusEventsTable = pgTable("commission_status_events", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  doctorId: integer("doctor_id").notNull(),
  billId: integer("bill_id"),
  commissionAmount: numeric("commission_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  oldStatus: text("old_status"),                 // null on the first observation
  newStatus: text("new_status").notNull(),        // 'on_hold' | 'eligible'
  policy: text("policy").notNull(),               // policy in force at the transition
  reason: text("reason"),                          // e.g. "Outstanding dues ₹700"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommissionStatusEvent = typeof commissionStatusEventsTable.$inferSelect;
