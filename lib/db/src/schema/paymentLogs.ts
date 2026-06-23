import { pgTable, serial, text, timestamp, numeric } from "drizzle-orm/pg-core";

export const paymentLogsTable = pgTable("payment_logs", {
  id: serial("id").primaryKey(),
  bookingRef: text("booking_ref").notNull(),
  patientName: text("patient_name").notNull(),
  gateway: text("gateway").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull(), // initiated | success | failed | refunded
  requestPayload: text("request_payload"),
  responsePayload: text("response_payload"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentLog = typeof paymentLogsTable.$inferSelect;
