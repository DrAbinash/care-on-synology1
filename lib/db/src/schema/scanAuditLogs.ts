import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scanAuditLogsTable = pgTable("scan_audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  username: text("username"),
  method: text("method").notNull(), // qr | paired_phone | scan_bridge | manual
  deviceId: text("device_id"),
  linkedPatientId: integer("linked_patient_id"),
  linkedFormFId: integer("linked_form_f_id"),
  status: text("status").notNull(), // success | failed | pending
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScanAuditLogSchema = createInsertSchema(scanAuditLogsTable).omit({ id: true, createdAt: true });
export type ScanAuditLog = typeof scanAuditLogsTable.$inferSelect;
export type InsertScanAuditLog = z.infer<typeof insertScanAuditLogSchema>;
