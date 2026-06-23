import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scanSessionsTable = pgTable("scan_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token").notNull().unique(),
  status: text("status").notNull().default("pending"), // pending | uploading | completed | expired
  staffId: integer("staff_id"),
  pairedDeviceId: text("paired_device_id"),
  frontImageUrl: text("front_image_url"),
  backImageUrl: text("back_image_url"),
  ocrResult: text("ocr_result"), // JSON string
  qrData: text("qr_data"), // JSON string (for Aadhaar QR decrypted data)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertScanSessionSchema = createInsertSchema(scanSessionsTable).omit({ id: true, createdAt: true });
export type ScanSession = typeof scanSessionsTable.$inferSelect;
export type InsertScanSession = z.infer<typeof insertScanSessionSchema>;
