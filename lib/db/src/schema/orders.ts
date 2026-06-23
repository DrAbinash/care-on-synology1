import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";
import { doctorsTable } from "./doctors";
import { testsTable } from "./tests";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  doctorId: integer("doctor_id").references(() => doctorsTable.id),
  status: text("status").notNull().default("pending"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  ledgerId: integer("ledger_id"),
  collectedAt: timestamp("collected_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const orderTestsTable = pgTable("order_tests", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  testId: integer("test_id").notNull().references(() => testsTable.id),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  result: text("result"),
  resultStatus: text("result_status"),
  // Partial cancellation support — individual tests can be cancelled from a bill
  status: text("status").notNull().default("active"), // 'active' | 'cancelled'
  cancelledByName: text("cancelled_by_name"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  // Cost to outsourced lab for this test (for margin analysis).
  outsourceCost: numeric("outsource_cost", { precision: 10, scale: 2 }),
  // Editable display name override — shown on bill instead of master test name.
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, orderNumber: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
export type OrderTest = typeof orderTestsTable.$inferSelect;
