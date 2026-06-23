import { pgTable, serial, text, integer, boolean, timestamp, uniqueIndex, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { patientsTable } from "./patients";
import { orderTestsTable } from "./orders";

// Physical specimens collected from a patient. One order may have multiple
// samples (e.g. one EDTA tube for CBC + one SST tube for biochemistry).
// Barcode format: SMP-YYMMDD-NNNN, unique within the registry.
export const samplesTable = pgTable("samples", {
  id: serial("id").primaryKey(),
  barcode: text("barcode").notNull().unique(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),

  // What was collected and in what container.
  sampleType: text("sample_type").notNull().default("Blood"),
  containerType: text("container_type").notNull().default("Plain"),
  volume: text("volume").notNull().default(""),

  // Lifecycle state machine. See SAMPLE_STATUSES in routes/samples.ts.
  status: text("status").notNull().default("collected"),

  // Collection metadata.
  collectedByName: text("collected_by_name").notNull().default(""),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  collectionSite: text("collection_site").notNull().default("Center"),  // Center / Home / Camp / External

  // Lab transitions.
  receivedAt: timestamp("received_at", { withTimezone: true }),
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  reportedAt: timestamp("reported_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),

  // Outsourced (referred to external lab).
  isOutsourced: boolean("is_outsourced").notNull().default(false),
  outsourceLab: text("outsource_lab"),
  outsourceSentAt: timestamp("outsource_sent_at", { withTimezone: true }),
  outsourceExpectedAt: text("outsource_expected_at"),  // YYYY-MM-DD
  outsourceReceivedAt: timestamp("outsource_received_at", { withTimezone: true }),
  outsourceTrackingId: text("outsource_tracking_id"),

  // ── Cost tracking ────────────────────────────────────────────────────────
  // Computed cost to lab (either from lab default rate or test override).
  outsourceCostAmount: numeric("outsource_cost_amount", { precision: 10, scale: 2 }),
  // Manual override entered by staff (null = use computed value).
  outsourceCostOverride: numeric("outsource_cost_override", { precision: 10, scale: 2 }),
  // Total amount billed to patient for outsourced tests in this sample.
  outsourcePatientBill: numeric("outsource_patient_bill", { precision: 10, scale: 2 }),
  // Margin = outsourcePatientBill - effectiveCost.
  outsourceMargin: numeric("outsource_margin", { precision: 10, scale: 2 }),

  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Junction table: which order_tests are run from a given sample. One sample
// usually serves multiple tests (e.g. one EDTA tube → CBC + ESR + HbA1c).
// (sampleId, orderTestId) is unique to prevent the same test from being
// double-assigned.
export const sampleTestAssignmentsTable = pgTable("sample_test_assignments", {
  id: serial("id").primaryKey(),
  sampleId: integer("sample_id").notNull().references(() => samplesTable.id, { onDelete: "cascade" }),
  orderTestId: integer("order_test_id").notNull().references(() => orderTestsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sampleTestUnique: uniqueIndex("sample_test_unique_idx").on(t.sampleId, t.orderTestId),
}));

export const insertSampleSchema = createInsertSchema(samplesTable).omit({
  id: true, barcode: true, createdAt: true, updatedAt: true,
  receivedAt: true, processingStartedAt: true, completedAt: true,
  reportedAt: true, rejectedAt: true, outsourceSentAt: true, outsourceReceivedAt: true,
});
export type InsertSample = z.infer<typeof insertSampleSchema>;
export type Sample = typeof samplesTable.$inferSelect;
export type SampleTestAssignment = typeof sampleTestAssignmentsTable.$inferSelect;
