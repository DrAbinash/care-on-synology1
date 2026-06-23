import { pgTable, serial, text, timestamp, numeric, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const BANK_PROVIDERS = [
  "mock",
  "icici",
  "hdfc",
  "axis",
  "sbi",
  "kotak",
  "generic",
  "bharatpe",
  "phonepe",
  "cashfree",
] as const;

export const BANK_ENVIRONMENTS = ["sandbox", "production"] as const;

export const BANK_ACCOUNT_STATUS = ["active", "inactive", "suspended"] as const;

export const bankAccountsTable = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("mock"), // One of BANK_PROVIDERS
  bankName: text("bank_name").notNull(),
  accountNickname: text("account_nickname"),
  maskedAccountNumber: text("masked_account_number").notNull(),
  ifsc: text("ifsc"),
  branch: text("branch"),
  environment: text("environment").notNull().default("sandbox"), // One of BANK_ENVIRONMENTS
  status: text("status").notNull().default("active"), // One of BANK_ACCOUNT_STATUS
  // Credential reference — NOT the actual secret. The real credentials live in
  // env vars keyed by a provider-specific prefix, e.g. ICICI_API_KEY, HDFC_API_KEY.
  // This field stores the prefix or identifier the adapter uses to look them up.
  credentialKey: text("credential_key"),
  // Link to the accounting ledger account (optional)
  ledgerAccountId: integer("ledger_account_id"),
  // Extra config the provider adapter may need (webhook secret, API version, etc.)
  // Stored as JSON so each provider can define its own config shape.
  providerConfig: jsonb("provider_config"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankTransactionsTable = pgTable("bank_transactions", {
  id: serial("id").primaryKey(),
  bankAccountId: integer("bank_account_id").notNull(),
  provider: text("provider").notNull(),
  externalTransactionId: text("external_transaction_id"), // Bank's own txn ID
  transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  type: text("type").notNull(), // 'credit' | 'debit'
  balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }),
  // UTR — unique transaction reference used for reconciliation
  utr: text("utr"),
  // Reference number (cheque number, NEFT ref, etc.)
  referenceNumber: text("reference_number"),
  // Raw payload from the bank (for audit / debugging)
  rawPayload: jsonb("raw_payload"),
  // Reconciliation state
  reconciliationStatus: text("reconciliation_status").notNull().default("unreconciled"), // 'unreconciled' | 'matched' | 'manual' | 'ignored'
  // Link to a voucher if reconciled
  voucherId: integer("voucher_id"),
  // Link to a bill payment if matched
  paymentId: integer("payment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentRequestsTable = pgTable("payment_requests", {
  id: serial("id").primaryKey(),
  bankAccountId: integer("bank_account_id").notNull(),
  provider: text("provider").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  purpose: text("purpose"),
  beneficiaryName: text("beneficiary_name"),
  beneficiaryAccount: text("beneficiary_account"),
  beneficiaryIfsc: text("beneficiary_ifsc"),
  // Bank-specific external request/transaction ID
  externalRequestId: text("external_request_id"),
  externalTransactionId: text("external_transaction_id"),
  status: text("status").notNull().default("pending"), // 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  failureReason: text("failure_reason"),
  // Link to bill or voucher
  billId: integer("bill_id"),
  voucherId: integer("voucher_id"),
  performedBy: text("performed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookLogsTable = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  eventType: text("event_type"),
  payload: jsonb("payload"),
  // Raw body string for signature verification debugging
  rawBody: text("raw_body"),
  // Verification result
  signatureValid: boolean("signature_valid"),
  // Processing result
  processed: boolean("processed").notNull().default(false),
  processingError: text("processing_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankAuditLogsTable = pgTable("bank_audit_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(), // 'balance_check' | 'transaction_fetch' | 'payment_initiate' | 'payment_status' | 'webhook_received' | 'reconciliation' | 'account_create' | 'account_update'
  provider: text("provider").notNull(),
  bankAccountId: integer("bank_account_id"),
  externalId: text("external_id"), // transaction ID, payment ID, etc.
  amount: numeric("amount", { precision: 14, scale: 2 }),
  status: text("status"), // 'success' | 'error' | 'warning'
  details: jsonb("details"),
  performedBy: text("performed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Zod schemas for inserts
export const insertBankAccountSchema = createInsertSchema(bankAccountsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });

export const insertBankTransactionSchema = createInsertSchema(bankTransactionsTable)
  .omit({ id: true, createdAt: true });

export const insertPaymentRequestSchema = createInsertSchema(paymentRequestsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });

export const insertWebhookLogSchema = createInsertSchema(webhookLogsTable)
  .omit({ id: true, createdAt: true });

export const insertBankAuditLogSchema = createInsertSchema(bankAuditLogsTable)
  .omit({ id: true, createdAt: true });

// ── Reconciliation Logs (enterprise upgrade, May 2026) ────────────────────────────────
export const RECONCILIATION_STATUSES = ["pending", "auto_matched", "manual_matched", "failed", "ignored"] as const;
export const MATCH_STRATEGIES = [
  "exact_utr", "exact_invoice_ref", "exact_amount_time", "mobile_amount",
  "patient_id_amount", "manual", "none",
] as const;

export const reconciliationLogsTable = pgTable("reconciliation_logs", {
  id: serial("id").primaryKey(),
  bankTransactionId: integer("bank_transaction_id").notNull(),
  billId: integer("bill_id"),
  paymentId: integer("payment_id"),
  voucherId: integer("voucher_id"),
  // Confidence score 0-100
  confidenceScore: integer("confidence_score").notNull().default(0),
  matchStrategy: text("match_strategy").notNull().default("none"), // One of MATCH_STRATEGIES
  status: text("status").notNull().default("pending"), // One of RECONCILIATION_STATUSES
  // Reason for manual review or failure
  reviewReason: text("review_reason"),
  // Auto-close action taken
  autoClosed: boolean("auto_closed").notNull().default(false),
  autoClosedAmount: numeric("auto_closed_amount", { precision: 14, scale: 2 }),
  // Who resolved the reconciliation
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  // Match metadata
  matchMetadata: jsonb("match_metadata"), // { matchedFields, differences, algorithmVersion }
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Fraud Alerts (enterprise upgrade, May 2026) ────────────────────────────────
export const FRAUD_ALERT_TYPES = [
  "duplicate_utr",
  "invoice_edited_after_payment",
  "bill_deleted_after_collection",
  "refund_without_approval",
  "collection_mismatch",
  "shift_mismatch",
  "backdated_edit",
  "multiple_manual_overrides",
  "suspicious_amount",
  "unusual_timing",
] as const;
export const FRAUD_SEVERITY = ["critical", "high", "medium", "low"] as const;
export const FRAUD_STATUS = ["open", "investigating", "resolved", "false_positive", "escalated"] as const;

export const fraudAlertsTable = pgTable("fraud_alerts", {
  id: serial("id").primaryKey(),
  alertType: text("alert_type").notNull(), // One of FRAUD_ALERT_TYPES
  severity: text("severity").notNull().default("medium"), // One of FRAUD_SEVERITY
  status: text("status").notNull().default("open"), // One of FRAUD_STATUS
  // Related entities
  billId: integer("bill_id"),
  paymentId: integer("payment_id"),
  bankTransactionId: integer("bank_transaction_id"),
  userId: integer("user_id"),
  userName: text("user_name"),
  // Alert details
  title: text("title").notNull(),
  description: text("description").notNull(),
  affectedAmount: numeric("affected_amount", { precision: 14, scale: 2 }),
  evidence: jsonb("evidence"), // { before, after, relatedIds, timestamps }
  // Resolution
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  resolutionAction: text("resolution_action"), // 'approved', 'rejected', 'adjusted', 'escalated'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Shift Closures (enterprise upgrade, May 2026) ────────────────────────────────
export const SHIFT_STATUS = ["open", "closing", "closed", "approved", "reopened"] as const;

export const shiftClosuresTable = pgTable("shift_closures", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  userName: text("user_name").notNull(),
  shiftLabel: text("shift_label").notNull().default("Morning"), // Morning / Afternoon / Evening / Night
  // Coverage window
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  // Expected collections (from payments table)
  expectedCash: numeric("expected_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedUpi: numeric("expected_upi", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedCard: numeric("expected_card", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedCheque: numeric("expected_cheque", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedOther: numeric("expected_other", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedTotal: numeric("expected_total", { precision: 12, scale: 2 }).notNull().default("0"),
  // Actual physical count
  actualCash: numeric("actual_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  actualUpi: numeric("actual_upi", { precision: 12, scale: 2 }).notNull().default("0"),
  actualCard: numeric("actual_card", { precision: 12, scale: 2 }).notNull().default("0"),
  actualCheque: numeric("actual_cheque", { precision: 12, scale: 2 }).notNull().default("0"),
  actualOther: numeric("actual_other", { precision: 12, scale: 2 }).notNull().default("0"),
  actualTotal: numeric("actual_total", { precision: 12, scale: 2 }).notNull().default("0"),
  // Variance
  variance: numeric("variance", { precision: 12, scale: 2 }).notNull().default("0"),
  varianceNote: text("variance_note").notNull().default(""),
  // Denominations
  denominations: jsonb("denominations").$type<{
    d500: number; d200: number; d100: number;
    d50: number; d20: number; d10: number; coins: number;
  } | null>().default(null),
  denominationTotal: numeric("denomination_total", { precision: 12, scale: 2 }),
  // Bank settlement info
  bankDepositAmount: numeric("bank_deposit_amount", { precision: 12, scale: 2 }),
  bankDepositRef: text("bank_deposit_ref"),
  // Supervisor approval
  supervisorId: integer("supervisor_id"),
  supervisorName: text("supervisor_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvalNote: text("approval_note"),
  // Status
  status: text("status").notNull().default("open"), // One of SHIFT_STATUS
  // Link to user_day_closures for backward compatibility
  userDayClosureId: integer("user_day_closure_id"),
  // Notes
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Gateway Transactions (enterprise upgrade, May 2026) ────────────────────
export const GATEWAY_STATUSES = ["initiated", "pending", "success", "failed", "refunded", "partially_refunded", "cancelled"] as const;
export const GATEWAY_PROVIDERS = ["razorpay", "phonepe", "bharatpe", "cashfree", "payu", "generic_upi"] as const;

export const gatewayTransactionsTable = pgTable("gateway_transactions", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(), // One of GATEWAY_PROVIDERS
  externalTransactionId: text("external_transaction_id"), // Gateway's txn ID
  externalOrderId: text("external_order_id"), // Gateway's order ID
  // Amounts
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  gatewayFee: numeric("gateway_fee", { precision: 14, scale: 2 }),
  taxOnFee: numeric("tax_on_fee", { precision: 14, scale: 2 }),
  netSettled: numeric("net_settled", { precision: 14, scale: 2 }),
  // Settlement
  settlementUtr: text("settlement_utr"),
  settlementDate: timestamp("settlement_date", { withTimezone: true }),
  settlementStatus: text("settlement_status").notNull().default("pending"), // pending | settled | failed
  // Payment method details
  method: text("method"), // upi | card | netbanking | wallet | paylater
  methodDetail: text("method_detail"), // e.g. "HDFC UPI", "Visa ****4242"
  payerVpa: text("payer_vpa"),
  payerPhone: text("payer_phone"),
  // Links
  billId: integer("bill_id"),
  paymentId: integer("payment_id"), // Link to internal payments table
  // Status
  status: text("status").notNull().default("initiated"), // One of GATEWAY_STATUSES
  failureReason: text("failure_reason"),
  // Raw payload
  rawPayload: jsonb("raw_payload"),
  // Reconciliation
  reconciliationStatus: text("reconciliation_status").notNull().default("unreconciled"), // unreconciled | matched | manual | ignored
  bankTransactionId: integer("bank_transaction_id"), // Link to bank_transactions when settled
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Refund Requests (enterprise upgrade, May 2026) ────────────────────────────────
export const REFUND_STATUSES = ["requested", "pending_approval", "approved", "rejected", "processing", "completed", "failed"] as const;

export const refundRequestsTable = pgTable("refund_requests", {
  id: serial("id").primaryKey(),
  billId: integer("bill_id").notNull(),
  paymentId: integer("payment_id").notNull(),
  // Refund amount (can be partial)
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  reason: text("reason").notNull(),
  // Requester
  requestedBy: text("requested_by").notNull(),
  requestedById: integer("requested_by_id"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  // Approval workflow
  status: text("status").notNull().default("requested"), // One of REFUND_STATUSES
  approvedBy: text("approved_by"),
  approvedById: integer("approved_by_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvalNote: text("approval_note"),
  rejectedBy: text("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  // Gateway refund tracking
  gatewayRefundId: text("gateway_refund_id"),
  gatewayRefundStatus: text("gateway_refund_status"),
  gatewayRefundRaw: jsonb("gateway_refund_raw"),
  // Completion
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: text("completed_by"),
  // Notes
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Zod schemas for new tables ────────────────────────────────────────────────────
export const insertReconciliationLogSchema = createInsertSchema(reconciliationLogsTable)
  .omit({ id: true, createdAt: true });
export const insertFraudAlertSchema = createInsertSchema(fraudAlertsTable)
  .omit({ id: true, createdAt: true, resolvedAt: true, resolvedBy: true, resolutionNote: true, resolutionAction: true });
export const insertShiftClosureSchema = createInsertSchema(shiftClosuresTable)
  .omit({ id: true, createdAt: true, updatedAt: true, endedAt: true, approvedAt: true, supervisorId: true, supervisorName: true, approvalNote: true, userDayClosureId: true, bankDepositAmount: true, bankDepositRef: true });
export const insertGatewayTransactionSchema = createInsertSchema(gatewayTransactionsTable)
  .omit({ id: true, createdAt: true, updatedAt: true, bankTransactionId: true });
export const insertRefundRequestSchema = createInsertSchema(refundRequestsTable)
  .omit({ id: true, createdAt: true, updatedAt: true, approvedBy: true, approvedById: true, approvedAt: true, approvalNote: true, rejectedBy: true, rejectedAt: true, rejectionReason: true, gatewayRefundId: true, gatewayRefundStatus: true, gatewayRefundRaw: true, completedAt: true, completedBy: true });

// Types
export type BankAccount = typeof bankAccountsTable.$inferSelect;
export type BankTransaction = typeof bankTransactionsTable.$inferSelect;
export type PaymentRequest = typeof paymentRequestsTable.$inferSelect;
export type WebhookLog = typeof webhookLogsTable.$inferSelect;
export type BankAuditLog = typeof bankAuditLogsTable.$inferSelect;
export type ReconciliationLog = typeof reconciliationLogsTable.$inferSelect;
export type FraudAlert = typeof fraudAlertsTable.$inferSelect;
export type ShiftClosure = typeof shiftClosuresTable.$inferSelect;
export type GatewayTransaction = typeof gatewayTransactionsTable.$inferSelect;
export type RefundRequest = typeof refundRequestsTable.$inferSelect;

export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type InsertBankTransaction = z.infer<typeof insertBankTransactionSchema>;
export type InsertPaymentRequest = z.infer<typeof insertPaymentRequestSchema>;
export type InsertWebhookLog = z.infer<typeof insertWebhookLogSchema>;
export type InsertBankAuditLog = z.infer<typeof insertBankAuditLogSchema>;
export type InsertReconciliationLog = z.infer<typeof insertReconciliationLogSchema>;
export type InsertFraudAlert = z.infer<typeof insertFraudAlertSchema>;
export type InsertShiftClosure = z.infer<typeof insertShiftClosureSchema>;
export type InsertGatewayTransaction = z.infer<typeof insertGatewayTransactionSchema>;
export type InsertRefundRequest = z.infer<typeof insertRefundRequestSchema>;
