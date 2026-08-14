import { pgTable, text, serial, timestamp, integer, numeric, jsonb, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { billsTable } from "./bills";
import { patientsTable } from "./patients";

/**
 * CARE-side Emergency Billing reconciliation.
 * DS225+ stores the live emergency DB separately; these tables only record
 * imports into canonical CARE billing (idempotent on emergency_transaction_uuid).
 */
export const emergencyReconciliationBatchesTable = pgTable("emergency_reconciliation_batches", {
  id: serial("id").primaryKey(),
  batchUuid: text("batch_uuid").notNull().unique(),
  emergencySessionUuid: text("emergency_session_uuid"),
  sourceNas: text("source_nas"),
  importMethod: text("import_method").notNull(), // NAS_API | CSV | JSON
  suppliedCount: integer("supplied_count").notNull().default(0),
  importedCount: integer("imported_count").notNull().default(0),
  alreadyImportedCount: integer("already_imported_count").notNull().default(0),
  conflictCount: integer("conflict_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  skippedReviewCount: integer("skipped_review_count").notNull().default(0),
  resultJson: jsonb("result_json"),
  importedBy: text("imported_by").notNull(),
  importedByUserId: integer("imported_by_user_id"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emergencyImportedTransactionsTable = pgTable("emergency_imported_transactions", {
  id: serial("id").primaryKey(),
  emergencyTransactionUuid: text("emergency_transaction_uuid").notNull().unique(),
  originalEmgBillNumber: text("original_emg_bill_number").notNull(),
  emergencySessionUuid: text("emergency_session_uuid"),
  careBillId: integer("care_bill_id").references(() => billsTable.id),
  carePatientId: integer("care_patient_id").references(() => patientsTable.id),
  matchClass: text("match_class"),
  importMethod: text("import_method").notNull(),
  batchId: integer("batch_id").references(() => emergencyReconciliationBatchesTable.id),
  originalCreatedAt: timestamp("original_created_at", { withTimezone: true }),
  originalStaff: text("original_staff"),
  importedBy: text("imported_by").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  payloadJson: jsonb("payload_json"),
}, (t) => ({
  uuidUq: uniqueIndex("emergency_imported_txn_uuid_uq").on(t.emergencyTransactionUuid),
}));

export const emergencyNasConfigTable = pgTable("emergency_nas_config", {
  id: serial("id").primaryKey(),
  baseUrl: text("base_url"),
  fetchToken: text("fetch_token"),
  fetchTokenSet: boolean("fetch_token_set").notNull().default(false),
  lastFetchAt: timestamp("last_fetch_at", { withTimezone: true }),
  lastMasterPushAt: timestamp("last_master_push_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  updatedBy: text("updated_by"),
});

export type EmergencyReconciliationBatch = typeof emergencyReconciliationBatchesTable.$inferSelect;
export type EmergencyImportedTransaction = typeof emergencyImportedTransactionsTable.$inferSelect;
