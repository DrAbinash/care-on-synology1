import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pairedDevicesTable = pgTable("paired_devices", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull().unique(),
  deviceName: text("device_name").notNull(),
  staffId: integer("staff_id").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPairedDeviceSchema = createInsertSchema(pairedDevicesTable).omit({ id: true, createdAt: true });
export type PairedDevice = typeof pairedDevicesTable.$inferSelect;
export type InsertPairedDevice = z.infer<typeof insertPairedDeviceSchema>;
