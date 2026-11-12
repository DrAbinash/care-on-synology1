import { formatExportAmount, type ExportConfig } from "@/components/SummaryExport";

/** One row of the Bills list, as returned by `GET /api/bills`. */
export type BillsRegisterRow = {
  billNumber: string;
  status: string;
  createdAt: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  refundAmount?: number;
  discount?: number;
  createdByName?: string | null;
  patient?: { firstName: string; lastName: string; patientId: string } | null;
  order?: {
    orderNumber: string;
    doctor?: { name: string } | null;
    testNames?: string[];
  } | null;
};

/** Clinic-wide figures from the same response. The server computes these over the
 *  FULL filtered set, while `rows` is only what came back in the page — the two
 *  disagree whenever the fetch is truncated, and a money document must say so. */
export type BillsRegisterTotals = {
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  refundAmount: number;
  /** Rows matching the filter, from the server's own COUNT(*). */
  matchedRows: number;
};

export type BillsRegisterFilters = {
  rangeLabel: string;
  status?: string;
  createdBy?: string;
  referralDoctor?: string;
  test?: string;
  search?: string;
};

const dash = (v: string | number | null | undefined) => (v === "" || v == null ? "—" : v);

/** `──`-prefixed labels render as divider rows inside a section (see SummaryExport). */
const DIVIDER = "────────────────────────────";

export function buildBillsRegisterExport(
  rows: BillsRegisterRow[],
  totals: BillsRegisterTotals,
  filters: BillsRegisterFilters,
): ExportConfig {
  const truncated = totals.matchedRows > rows.length;

  const refunds = rows.reduce((s, b) => s + Number(b.refundAmount ?? 0), 0);
  const discounts = rows.reduce((s, b) => s + Number(b.discount ?? 0), 0);
  const cancelled = rows.filter((b) => b.status === "cancelled");
  const cancelledValue = cancelled.reduce((s, b) => s + Number(b.totalAmount), 0);

  const scopeMetrics: [string, string][] = [
    ["Billing period", filters.rangeLabel],
    ["Status filter", filters.status || "All statuses"],
  ];
  if (filters.createdBy) scopeMetrics.push(["Billed by", filters.createdBy]);
  if (filters.referralDoctor) scopeMetrics.push(["Referral filter", filters.referralDoctor]);
  if (filters.test) scopeMetrics.push(["Test filter", filters.test]);
  if (filters.search) scopeMetrics.push(["Search", `“${filters.search}”`]);
  scopeMetrics.push(["Bills in this document", rows.length.toLocaleString("en-IN")]);
  if (truncated) {
    scopeMetrics.push(
      [DIVIDER, ""],
      ["INCOMPLETE", `fetch capped at ${rows.length.toLocaleString("en-IN")} of ${totals.matchedRows.toLocaleString("en-IN")} matching bills — narrow the date range`],
    );
  }

  const group = (n: number) => n.toLocaleString("en-IN");
  return {
    title: "Bill Collection Register",
    subtitle: truncated
      ? `${filters.rangeLabel} • PARTIAL — ${group(rows.length)} of ${group(totals.matchedRows)} bills`
      : `${filters.rangeLabel} • ${group(rows.length)} bill${rows.length === 1 ? "" : "s"}`,
    sections: [
      {
        title: "Collections",
        metrics: [
          ["Total Billed", formatExportAmount(totals.totalAmount)],
          ["Collected", formatExportAmount(totals.paidAmount)],
          ["Balance Outstanding", formatExportAmount(totals.balanceAmount)],
          [DIVIDER, ""],
          ["Refunds Against Bills", formatExportAmount(refunds)],
          ["Discounts Given", formatExportAmount(discounts)],
          ["Cancelled Bills (value, not collectible)", formatExportAmount(cancelledValue)],
        ],
      },
      {
        title: "Document scope",
        metrics: scopeMetrics,
      },
    ],
    tables: [
      {
        title: "Bill Register",
        headers: [
          "Bill No", "Date", "Patient", "UHID", "Order", "Referral Doctor",
          "Tests", "Billed By", "Status", "Billed", "Paid", "Balance",
        ],
        rows: rows.map((b) => {
          const patient = b.patient ? `${b.patient.firstName} ${b.patient.lastName}`.trim() : "";
          return [
            b.billNumber,
            new Date(b.createdAt).toLocaleDateString("en-IN"),
            dash(patient),
            dash(b.patient?.patientId),
            dash(b.order?.orderNumber),
            dash(b.order?.doctor?.name),
            dash((b.order?.testNames ?? []).join(", ")),
            dash(b.createdByName),
            b.status,
            formatExportAmount(Number(b.totalAmount)),
            formatExportAmount(Number(b.paidAmount)),
            formatExportAmount(Number(b.balanceAmount)),
          ];
        }),
      },
    ],
  };
}
