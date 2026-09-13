/** Expense Entry V2 shared types — BILL VALUE ≠ MONEY PAID. */

export type PaymentStatus = "PAID" | "PART_PAID" | "DUE" | "VOID";
export type AccountingStatus = "POSTED" | "PENDING" | "FAILED" | "REVERSED" | "PARTIAL";
export type EntryPayKind = "PAID" | "PART_PAID" | "DUE";

export type ExpenseV2 = {
  id: number;
  expenseId: string;
  category: string;
  description: string;
  amount: number;
  expenseDate: string;
  paymentMode: string;
  paidTo?: string | null;
  approvedBy?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
  billAmount?: number;
  taxAmount?: number | null;
  totalPaid?: number;
  balanceDue?: number;
  paymentStatus?: PaymentStatus | string;
  accountingStatus?: AccountingStatus | string;
  vendorId?: number | null;
  vendorNameSnapshot?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  departmentId?: number | null;
  categoryId?: number | null;
  subcategoryId?: number | null;
  hasReceipt?: boolean;
  attachmentCount?: number;
  hasAttachments?: boolean;
  receiptImageUrl?: string | null;
  voucherId?: number | null;
  accrualVoucherId?: number | null;
};

export type ExpenseCategoryRow = {
  id: number;
  name: string;
  parentId?: number | null;
  legacyKey?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type ExpensePaymentRow = {
  id: number;
  paymentPublicId: string;
  paymentDate: string;
  amount: number;
  paymentMode: string;
  paidFromAccountId?: number | null;
  referenceNumber?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  accountingStatus?: string;
  voucherId?: number | null;
  reversedAt?: string | null;
};

export type OcrFieldSource = "ocr" | "ai_suggested" | "missing" | "user";

export type BillOcrFieldMeta = {
  value: string | number | null;
  confidencePercent: number;
  source: OcrFieldSource;
};

export type VendorOption = { id: number; name: string; code?: string; isActive?: boolean };

export type AccountOption = {
  id: number;
  name: string;
  type: string;
  isActive?: boolean;
};

export type DepartmentOption = { id: number; name: string };

export type DuplicateWarnings = {
  strong?: Array<{ expenseId?: string; reason?: string }>;
  soft?: Array<{ expenseId?: string; reason?: string }>;
};

export function billOf(e: ExpenseV2): number {
  return Number(e.billAmount ?? e.amount ?? 0);
}

export function paidOf(e: ExpenseV2): number {
  if (e.totalPaid != null) return Number(e.totalPaid);
  const status = (e.paymentStatus || "").toUpperCase();
  if (status === "DUE" || status === "VOID") return 0;
  if (status === "PAID" || !status) return billOf(e);
  return 0;
}

export function dueOf(e: ExpenseV2): number {
  if (e.balanceDue != null) return Number(e.balanceDue);
  return Math.max(0, billOf(e) - paidOf(e));
}

export function vendorLabel(e: ExpenseV2): string {
  return (e.vendorNameSnapshot || e.paidTo || "—").trim() || "—";
}

export function isCashMode(mode: string | null | undefined): boolean {
  const m = (mode ?? "").trim().toLowerCase();
  return !m || m === "cash";
}
