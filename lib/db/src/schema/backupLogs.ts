import { pgTable, text, serial, timestamp, integer, bigint, boolean } from "drizzle-orm/pg-core";

export const backupLogsTable = pgTable("backup_logs", {
  id: serial("id").primaryKey(),
  backupType: text("backup_type").notNull().default("manual"),
  status: text("status").notNull().default("success"),
  format: text("format").notNull().default("json"),
  rowCount: integer("row_count"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  errorMessage: text("error_message"),
  performedBy: text("performed_by"),
  notes: text("notes"),
  encrypted: boolean("encrypted").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BackupLog = typeof backupLogsTable.$inferSelect;
