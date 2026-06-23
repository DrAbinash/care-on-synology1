import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const printerSettingsTable = pgTable("printer_settings", {
  id: serial("id").primaryKey(),
  billPrinter: text("bill_printer").notNull().default(""),
  billPrinterType: text("bill_printer_type").notNull().default("color"),
  barcodePrinter: text("barcode_printer").notNull().default(""),
  barcodeEnabled: text("barcode_enabled").notNull().default("true"),
  tokenPrinter: text("token_printer").notNull().default(""),
  tokenPrinterType: text("token_printer_type").notNull().default("color"),
  tokenEnabled: text("token_enabled").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PrinterSettings = typeof printerSettingsTable.$inferSelect;