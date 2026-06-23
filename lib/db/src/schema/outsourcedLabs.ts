import { pgTable, text, serial, timestamp, boolean, numeric, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { doctorsTable } from "./doctors";
import { patientsTable } from "./patients";
import { billsTable } from "./bills";

export const outsourceStatusEnum = pgEnum("outsource_status", [
  "ordered",
  "sample_collected",
  "sample_packed",
  "sent_to_lab",
  "received_by_lab",
  "report_received",
  "report_uploaded",
  "report_delivered",
  "cancelled"
]);

export const outsourcedLabsTable = pgTable("outsourced_labs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  gstin: text("gstin"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),

  // ── Default cost / rate configuration ────────────────────────────────────────
  // How cost is calculated when this lab processes a test:
  // 'percent_of_patient_bill'  → costPercent applies (e.g. 40 = 40% of patient price).
  // 'fixed_per_test'           → costFixed applies (e.g. 150 = Rs 150 flat per test).
  // 'custom_per_test'          → each test has its own outsourceCost override in tests table.
  costType: text("cost_type").notNull().default("percent_of_patient_bill"),
  // Percentage of patient bill to pay lab (0-100). Only used when costType='percent_of_patient_bill'.
  costPercent: numeric("cost_percent", { precision: 5, scale: 2 }).notNull().default("50"),
  // Fixed amount per test (in Rs). Only used when costType='fixed_per_test'.
  costFixed: numeric("cost_fixed", { precision: 10, scale: 2 }).notNull().default("0"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOutsourcedLabSchema = createInsertSchema(outsourcedLabsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOutsourcedLab = z.infer<typeof insertOutsourcedLabSchema>;
export type OutsourcedLab = typeof outsourcedLabsTable.$inferSelect;

// 1. Outsource Test Rate Card Master
export const outsourceRateCardsTable = pgTable("outsource_rate_cards", {
  id: serial("id").primaryKey(),
  labId: integer("lab_id").notNull().references(() => outsourcedLabsTable.id),
  labTestCode: text("lab_test_code").notNull(),
  testName: text("test_name").notNull(),
  department: text("department"),
  mrp: numeric("mrp", { precision: 10, scale: 2 }).notNull(),
  partnerCost: numeric("partner_cost", { precision: 10, scale: 2 }).notNull(),
  commissionPercent: numeric("commission_percent", { precision: 5, scale: 2 }).notNull().default("0.00"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutsourceRateCardSchema = createInsertSchema(outsourceRateCardsTable).omit({ id: true, createdAt: true });
export type OutsourceRateCard = typeof outsourceRateCardsTable.$inferSelect;

// 2. Outsource Test Price Groups
export const outsourcePriceGroupsTable = pgTable("outsource_price_groups", {
  id: serial("id").primaryKey(),
  rateCardId: integer("rate_card_id").notNull().references(() => outsourceRateCardsTable.id),
  priceGroup: text("price_group").notNull().default("general"), // 'general' | 'corporate' | 'camp' | 'staff' | 'doctor_special' | 'charity'
  strategyType: text("strategy_type").notNull().default("outsource_mrp"), // 'fixed' | 'outsource_mrp' | 'discount_mrp' | 'markup_cost'
  strategyValue: numeric("strategy_value", { precision: 10, scale: 2 }).notNull().default("0.00"),
  finalSellingPrice: numeric("final_selling_price", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutsourcePriceGroupSchema = createInsertSchema(outsourcePriceGroupsTable).omit({ id: true, createdAt: true });
export type OutsourcePriceGroup = typeof outsourcePriceGroupsTable.$inferSelect;

// 3. Sample Dispatch Batch
export const outsourceDispatchBatchesTable = pgTable("outsource_dispatch_batches", {
  id: serial("id").primaryKey(),
  batchNumber: text("batch_number").notNull().unique(),
  labId: integer("lab_id").notNull().references(() => outsourcedLabsTable.id),
  courierName: text("courier_name"),
  trackingDetails: text("tracking_details"),
  staffHandoverId: integer("staff_handover_id"),
  remarks: text("remarks"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutsourceDispatchBatchSchema = createInsertSchema(outsourceDispatchBatchesTable).omit({ id: true, createdAt: true });
export type OutsourceDispatchBatch = typeof outsourceDispatchBatchesTable.$inferSelect;

// 4. Outsource Orders
export const outsourceOrdersTable = pgTable("outsource_orders", {
  id: serial("id").primaryKey(),
  billId: integer("bill_id").notNull().references(() => billsTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  rateCardId: integer("rate_card_id").notNull().references(() => outsourceRateCardsTable.id),
  dispatchBatchId: integer("dispatch_batch_id").references(() => outsourceDispatchBatchesTable.id),
  status: outsourceStatusEnum("status").notNull().default("ordered"),
  barcode: text("barcode"),
  sampleType: text("sample_type"),
  expectedReportTime: timestamp("expected_report_time", { withTimezone: true }),
  actualReportReceivedTime: timestamp("actual_report_received_time", { withTimezone: true }),
  patientCharge: numeric("patient_charge", { precision: 10, scale: 2 }).notNull(),
  outsourceCost: numeric("outsource_cost", { precision: 10, scale: 2 }).notNull(),
  doctorCommission: numeric("doctor_commission", { precision: 10, scale: 2 }).notNull().default("0.00"),
  netHospitalProfit: numeric("net_hospital_profit", { precision: 10, scale: 2 }).notNull(),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutsourceOrderSchema = createInsertSchema(outsourceOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type OutsourceOrder = typeof outsourceOrdersTable.$inferSelect;

// 5. Outsource Reports
export const outsourceReportsTable = pgTable("outsource_reports", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => outsourceOrdersTable.id),
  filePath: text("file_path").notNull(),
  uploadedBy: integer("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutsourceReportSchema = createInsertSchema(outsourceReportsTable).omit({ id: true, createdAt: true });
export type OutsourceReport = typeof outsourceReportsTable.$inferSelect;

// 6. Outsource Vendor Ledger
export const outsourceVendorLedgerTable = pgTable("outsource_vendor_ledger", {
  id: serial("id").primaryKey(),
  labId: integer("lab_id").notNull().references(() => outsourcedLabsTable.id),
  transactionType: text("transaction_type").notNull(),
  referenceId: text("reference_id"),
  debitAmount: numeric("debit_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  creditAmount: numeric("credit_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  tdsDeducted: numeric("tds_deducted", { precision: 10, scale: 2 }).notNull().default("0.00"),
  runningBalance: numeric("running_balance", { precision: 12, scale: 2 }).notNull(),
  remarks: text("remarks"),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutsourceVendorLedgerSchema = createInsertSchema(outsourceVendorLedgerTable).omit({ id: true, createdAt: true });
export type OutsourceVendorLedger = typeof outsourceVendorLedgerTable.$inferSelect;

// 7. Outsource Vendor Invoices
export const outsourceVendorInvoicesTable = pgTable("outsource_vendor_invoices", {
  id: serial("id").primaryKey(),
  labId: integer("lab_id").notNull().references(() => outsourcedLabsTable.id),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: timestamp("invoice_date", { withTimezone: true }).notNull(),
  grossAmount: numeric("gross_amount", { precision: 12, scale: 2 }).notNull(),
  tdsAmount: numeric("tds_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  netPayable: numeric("net_payable", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("unreconciled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutsourceVendorInvoiceSchema = createInsertSchema(outsourceVendorInvoicesTable).omit({ id: true, createdAt: true });
export type OutsourceVendorInvoice = typeof outsourceVendorInvoicesTable.$inferSelect;

// 8. Outsource Vendor Invoice Items
export const outsourceVendorInvoiceItemsTable = pgTable("outsource_vendor_invoice_items", {
  id: serial("id").primaryKey(),
  vendorInvoiceId: integer("vendor_invoice_id").notNull().references(() => outsourceVendorInvoicesTable.id),
  labNo: text("lab_no"),
  patientName: text("patient_name").notNull(),
  labTestCode: text("lab_test_code").notNull(),
  testName: text("test_name").notNull(),
  grossPrice: numeric("gross_price", { precision: 10, scale: 2 }).notNull(),
  labCost: numeric("lab_cost", { precision: 10, scale: 2 }).notNull(),
  netPrice: numeric("net_price", { precision: 10, scale: 2 }).notNull(),
  tds: numeric("tds", { precision: 10, scale: 2 }).notNull().default("0.00"),
  netPayable: numeric("net_payable", { precision: 10, scale: 2 }).notNull(),
  reconciliationStatus: text("reconciliation_status").notNull().default("pending"),
  linkedOrderId: integer("linked_order_id").references(() => outsourceOrdersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutsourceVendorInvoiceItemSchema = createInsertSchema(outsourceVendorInvoiceItemsTable).omit({ id: true, createdAt: true });
export type OutsourceVendorInvoiceItem = typeof outsourceVendorInvoiceItemsTable.$inferSelect;

// 9. Outsource Payments
export const outsourcePaymentsTable = pgTable("outsource_payments", {
  id: serial("id").primaryKey(),
  labId: integer("lab_id").notNull().references(() => outsourcedLabsTable.id),
  paymentDate: timestamp("payment_date", { withTimezone: true }).notNull().defaultNow(),
  amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).notNull(),
  tdsDeducted: numeric("tds_deducted", { precision: 10, scale: 2 }).notNull().default("0.00"),
  paymentMode: text("payment_mode").notNull(),
  utrChequeNumber: text("utr_cheque_number"),
  attachmentUrl: text("attachment_url"),
  remarks: text("remarks"),
  approvedBy: integer("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutsourcePaymentSchema = createInsertSchema(outsourcePaymentsTable).omit({ id: true, createdAt: true });
export type OutsourcePayment = typeof outsourcePaymentsTable.$inferSelect;

// 10. Doctor Commission Rules
export const doctorCommissionRulesTable = pgTable("doctor_commission_rules", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => doctorsTable.id),
  rateCardId: integer("rate_card_id").references(() => outsourceRateCardsTable.id),
  testCategory: text("test_category"),
  ruleType: text("rule_type").notNull().default("profit_share_percent"),
  ruleValue: numeric("rule_value", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDoctorCommissionRuleSchema = createInsertSchema(doctorCommissionRulesTable).omit({ id: true, createdAt: true });
export type DoctorCommissionRule = typeof doctorCommissionRulesTable.$inferSelect;

// 11. Outsource Audit Logs
export const outsourceAuditLogsTable = pgTable("outsource_audit_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  performedBy: integer("performed_by"),
  targetTable: text("target_table"),
  targetId: integer("target_id"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  remarks: text("remarks"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutsourceAuditLogSchema = createInsertSchema(outsourceAuditLogsTable).omit({ id: true, timestamp: true });
export type OutsourceAuditLog = typeof outsourceAuditLogsTable.$inferSelect;
