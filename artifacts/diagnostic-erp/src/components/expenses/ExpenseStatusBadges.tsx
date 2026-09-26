import type { AccountingStatus, BillOcrFieldMeta, PaymentStatus } from "./expenseTypes";

const PAYMENT_BADGE: Record<string, string> = {
  PAID: "bg-green-100 text-green-800",
  PART_PAID: "bg-amber-100 text-amber-800",
  DUE: "bg-red-100 text-red-800",
  VOID: "bg-gray-200 text-gray-600 line-through",
};

const PAYMENT_LABEL: Record<string, string> = {
  PAID: "Paid",
  PART_PAID: "Part Paid",
  DUE: "Due",
  VOID: "Void",
};

const PAYMENT_TITLE: Record<string, string> = {
  PAID: "Bill has no remaining balance.",
  PART_PAID: "Part of the bill has been paid; balance remains.",
  DUE: "No payment has yet been recorded against this bill.",
  VOID: "This expense was voided.",
};

const ACCOUNTING_BADGE: Record<string, string> = {
  POSTED: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  PENDING: "bg-slate-50 text-slate-600 border border-slate-200",
  FAILED: "bg-red-50 text-red-700 border border-red-200",
  REVERSED: "bg-gray-50 text-gray-600 border border-gray-200",
  PARTIAL: "bg-amber-50 text-amber-700 border border-amber-200",
};

const ACCOUNTING_LABEL: Record<string, string> = {
  POSTED: "Posted",
  PENDING: "Pending",
  FAILED: "Failed",
  REVERSED: "Reversed",
  PARTIAL: "Partial",
};

const ACCOUNTING_TITLE: Record<string, string> = {
  POSTED: "Required accounting voucher(s) were successfully created and linked.",
  PENDING:
    "Accounting voucher(s) are not linked. This is not an approval queue — legacy migrated bills may stay Pending without new vouchers.",
  FAILED: "Accounting posting was attempted but failed. Retry only when an error is recorded.",
  REVERSED: "Linked vouchers were reversed (e.g. after void).",
  PARTIAL: "Some related payment vouchers are posted and others are not.",
};

export function PaymentStatusBadge({
  status,
  labeled,
}: {
  status?: PaymentStatus | string | null;
  /** When true, prefix with "Payment" for list/drawer clarity. */
  labeled?: boolean;
}) {
  const key = (status || "PAID").toUpperCase();
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${PAYMENT_BADGE[key] || "bg-gray-100 text-gray-700"}`}
      title={PAYMENT_TITLE[key] || undefined}
      data-testid="payment-status-badge"
    >
      {labeled ? <span className="font-medium opacity-70">Payment</span> : null}
      {PAYMENT_LABEL[key] || key}
    </span>
  );
}

export function AccountingStatusBadge({
  status,
  labeled,
}: {
  status?: AccountingStatus | string | null;
  labeled?: boolean;
}) {
  if (!status) return null;
  const key = status.toUpperCase();
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${ACCOUNTING_BADGE[key] || "bg-gray-50 text-gray-600 border"}`}
      title={ACCOUNTING_TITLE[key] || undefined}
      data-testid="accounting-status-badge"
    >
      {labeled ? <span className="opacity-70">Accounting</span> : null}
      {ACCOUNTING_LABEL[key] || key}
    </span>
  );
}

/** Distinguishes OCR extracted vs AI suggested vs missing on the review form. */
export function OcrFieldBadge({ meta }: { meta?: BillOcrFieldMeta | null }) {
  if (!meta) return null;
  const label =
    meta.source === "missing"
      ? "Missing"
      : meta.source === "ai_suggested"
        ? `AI suggested · ${meta.confidencePercent}%`
        : meta.source === "user"
          ? "Edited"
          : `OCR · ${meta.confidencePercent}%`;
  const cls =
    meta.source === "missing"
      ? "text-amber-700 bg-amber-50 border-amber-200"
      : meta.source === "ai_suggested"
        ? "text-violet-700 bg-violet-50 border-violet-200"
        : meta.source === "user"
          ? "text-slate-600 bg-slate-50 border-slate-200"
          : meta.confidencePercent >= 90
            ? "text-green-700 bg-green-50 border-green-200"
            : "text-blue-700 bg-blue-50 border-blue-200";
  return (
    <span className={`ml-1.5 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function canShowAccountingRetryUi(exp: {
  paymentStatus?: string | null;
  accountingStatus?: string | null;
  accountingError?: string | null;
}): boolean {
  if ((exp.paymentStatus || "").toUpperCase() === "VOID") return false;
  const st = (exp.accountingStatus || "").toUpperCase();
  if (st === "FAILED") return true;
  if (st === "PENDING" && (exp.accountingError || "").trim()) return true;
  return false;
}
