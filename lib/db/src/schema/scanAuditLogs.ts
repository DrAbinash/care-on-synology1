import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scanAuditLogsTable = pgTable("scan_audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  username: text("username"),
  method: text("method").notNull(), // qr | paired_phone | scan_bridge | manual | counter_scanner
  deviceId: text("device_id"),
  linkedPatientId: integer("linked_patient_id"),
  linkedFormFId: integer("linked_form_f_id"),
  status: text("status").notNull(), // success | failed | pending
  details: text("details"),
  // Report-delivery scans. A scan is an ATTEMPT, not a custody event: receiving
  // and handover are recorded only in report_custody_events, by an explicit
  // confirmation. These three columns are nullable and additive so every
  // existing scanner surface (Form F ID scan, paired phone, scan bridge) keeps
  // writing exactly what it writes today.
  scannedCode: text("scanned_code"),
  linkedReportId: integer("linked_report_id"),
  page: text("page"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScanAuditLogSchema = createInsertSchema(scanAuditLogsTable).omit({ id: true, createdAt: true });
export type ScanAuditLog = typeof scanAuditLogsTable.$inferSelect;
export type InsertScanAuditLog = z.infer<typeof insertScanAuditLogSchema>;
