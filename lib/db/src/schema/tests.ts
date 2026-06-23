import { pgTable, text, serial, timestamp, numeric, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const testsTable = pgTable("diagnostic_tests", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  duration: text("duration").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  // Department this test belongs to — drives per-test queue routing.
  // Free text so users can add their own (Pathology, X-Ray, USG, MRI, CT,
  // ECG, Endoscopy, Mammography, Cardiology, etc.).
  department: text("department").notNull().default("Pathology"),
  // Room/counter where this test is performed (e.g. "Room 4").
  roomNumber: text("room_number").notNull().default(""),
  // Whether the test is performed in-house or sent to an outsourced lab.
  // 'inhouse' (default) | 'outsourced'
  testType: text("test_type").notNull().default("inhouse"),
  // FK to outsourced_labs.id — only set when testType = 'outsourced'
  outsourcedLabId: integer("outsourced_lab_id"),
  // Override cost to outsourced lab for this specific test (null = use lab default rate).
  outsourceCost: numeric("outsource_cost", { precision: 10, scale: 2 }),
  // FK to rooms master — null if not assigned
  roomId: integer("room_id"),
  // FK to modalities master — null if not assigned
  modalityId: integer("modality_id"),
  // Denormalized floor label for token printing (populated from rooms.floor)
  floorLabel: text("floor_label").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTestSchema = createInsertSchema(testsTable).omit({ id: true, createdAt: true });
export type InsertTest = z.infer<typeof insertTestSchema>;
export type DiagnosticTest = typeof testsTable.$inferSelect;
