import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Inbox, Loader2, ScanLine } from "lucide-react";

export type RateKind = "single" | "multiple" | "none";

export type ModalityBillingRow = {
  key: string;
  label: string;
  testCount: number;
  billCount: number;
  grossBilling: number;
  rateKind?: RateKind;
  unitRate?: number | null;
  avgRate?: number | null;
  distinctRateCount?: number;
};

export type ModalityBillingSummary = {
  from: string;
  to: string;
  modalities: ModalityBillingRow[];
  totals: {
    testCount: number;
    billCount: number;
    grossBilling: number;
  };
};

type ModalityBillsResponse = {
  modality: string;
  label: string;
  from: string;
  to: string;
  columns: string[];
  rows: (string | number | null)[][];
};

const AMOUNT_COLUMNS = new Set([
  "Modality Amount",
  "Pathology Amount",
  "Bill Amount",
  "Amount",
]);

function fmtCell(value: string | number | null, column: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (AMOUNT_COLUMNS.has(column)) {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }).format(value);
    }
    return String(value);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    try {
      return new Date(value).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      /* fall through */
    }
  }
  return value;
}

function fmtInr(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  }).format(n);
}

function fmtDateLabel(from: string, to: string): string {
  if (from === to) {
    const [y, m, d] = from.split("-");
    if (y && m && d) return `${d}-${m}-${y}`;
    return from;
  }
  return `${from} → ${to}`;
}

function countNoun(row: ModalityBillingRow): string {
  return row.key === "Pathology" ? "tests" : "cases";
}

function rateDisplay(row: ModalityBillingRow): { primary: string; hint?: string } {
  if (row.testCount <= 0 || row.rateKind === "none") {
    return { primary: "—" };
  }
  if (row.rateKind === "single" && row.unitRate != null) {
    return {
      primary: fmtInr(row.unitRate),
      hint: `${row.testCount} × ${fmtInr(row.unitRate)}`,
    };
  }
  if (row.avgRate != null) {
    return {
      primary: `Avg ${fmtInr(row.avgRate)}`,
      hint: row.distinctRateCount && row.distinctRateCount > 1
        ? "Multiple rates"
        : undefined,
    };
  }
  // Legacy payloads without rate metadata — do not invent a rate
  return { primary: "Multiple rates", hint: "See drill-down" };
}

type Props = {
  from: string;
  to: string;
  hideHeader?: boolean;
};

export default function ModalityBillingKpi({ from, to, hideHeader = false }: Props) {
  const [selected, setSelected] = useState<ModalityBillingRow | null>(null);

  const { data, isLoading, isError } = useQuery<ModalityBillingSummary>({
    queryKey: ["modality-billing", from, to],
    queryFn: () =>
      api.get(`/api/dashboard/my-daily-summary/modality-billing?from=${from}&to=${to}`),
    ...FINANCIAL_QUERY_OPTIONS,
  });

  const billsQ = useQuery<ModalityBillsResponse>({
    queryKey: ["modality-bills", from, to, selected?.key],
    queryFn: () =>
      api.get(
        `/api/dashboard/my-daily-summary/modality-bills?from=${from}&to=${to}&modality=${encodeURIComponent(selected!.key)}`,
      ),
    enabled: !!selected,
    ...FINANCIAL_QUERY_OPTIONS,
  });

  if (isLoading) {
    return (
      <div className={hideHeader ? "p-4" : "bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-4 shadow-sm"}>
        <div className="h-28 bg-gray-100 dark:bg-muted/30 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (isError || !data) return null;

  const dateLabel = fmtDateLabel(from, to);
  const subtitle = `${dateLabel} · clinic-wide · modality/service-wise billing · tap a row to open bills`;

  return (
    <>
      <div
        className={hideHeader
          ? "p-4 space-y-3"
          : "bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-4 shadow-sm space-y-3"}
        data-testid="modality-billing-kpi"
      >
        {!hideHeader && (
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
              <ScanLine size={14} className="text-sky-600" />
              Imaging &amp; Pathology Billed
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
          </div>
        )}
        {hideHeader && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{subtitle}</p>
        )}

        {/* Desktop / tablet table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm" data-testid="modality-billing-table">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-card-border">
                <th className="text-left font-semibold py-2 pr-3">Modality / Service</th>
                <th className="text-right font-semibold py-2 px-3">Cases / Tests</th>
                <th className="text-right font-semibold py-2 px-3">Rate / Avg</th>
                <th className="text-right font-semibold py-2 pl-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.modalities.map((row) => {
                const rate = rateDisplay(row);
                return (
                  <tr key={row.key} className="border-b border-gray-50 dark:border-card-border/60 last:border-0">
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        className="font-bold text-gray-900 dark:text-foreground hover:text-sky-700 dark:hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
                        data-testid={`modality-billing-${row.key}`}
                      >
                        {row.label}
                      </button>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {row.billCount} bill{row.billCount === 1 ? "" : "s"}
                      </p>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800 dark:text-foreground">
                      <span className="font-semibold">{row.testCount}</span>
                      <span className="text-[10px] text-gray-400 ml-1">{countNoun(row)}</span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="tabular-nums font-medium text-gray-800 dark:text-foreground">{rate.primary}</div>
                      {rate.hint && (
                        <div className="text-[10px] text-gray-400 mt-0.5">{rate.hint}</div>
                      )}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums font-bold text-gray-900 dark:text-foreground">
                      {row.grossBilling > 0 ? fmtInr(row.grossBilling) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-sky-50/80 dark:bg-sky-950/30 border-t-2 border-sky-200 dark:border-sky-800">
                <td className="py-2.5 pr-3 font-extrabold text-sky-900 dark:text-sky-100 uppercase text-xs tracking-wide">
                  Total
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums font-extrabold text-sky-900 dark:text-sky-100">
                  {data.totals.testCount}
                  <span className="text-[10px] font-semibold text-sky-700/80 dark:text-sky-300/80 ml-1">
                    tests/cases
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right text-[10px] text-sky-700/70 dark:text-sky-300/70">
                  {data.totals.billCount} bill{data.totals.billCount === 1 ? "" : "s"}
                </td>
                <td
                  className="py-2.5 pl-3 text-right tabular-nums font-extrabold text-sky-900 dark:text-sky-100"
                  data-testid="modality-billing-grand-total"
                >
                  {fmtInr(data.totals.grossBilling)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile compact rows */}
        <div className="sm:hidden space-y-2" data-testid="modality-billing-mobile">
          {data.modalities.map((row) => {
            const rate = rateDisplay(row);
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => setSelected(row)}
                className="w-full rounded-lg border border-gray-100 dark:border-card-border bg-gray-50/80 dark:bg-muted/20 p-3 text-left transition-colors hover:border-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                data-testid={`modality-billing-${row.key}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-800 dark:text-foreground">
                      {row.label}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {row.testCount} {countNoun(row)} · {rate.primary}
                    </p>
                  </div>
                  <p className="text-sm font-extrabold tabular-nums text-gray-900 dark:text-foreground shrink-0">
                    {row.grossBilling > 0 ? fmtInr(row.grossBilling) : "—"}
                  </p>
                </div>
              </button>
            );
          })}
          <div className="rounded-lg border-2 border-sky-200 dark:border-sky-800 bg-sky-50/80 dark:bg-sky-950/30 px-3 py-2.5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-sky-800 dark:text-sky-200">
                Grand total
              </p>
              <p className="text-[11px] text-sky-700/80 dark:text-sky-300/80">
                {data.totals.testCount} tests/cases · {data.totals.billCount} bills
              </p>
            </div>
            <p className="text-base font-extrabold tabular-nums text-sky-900 dark:text-sky-100">
              {fmtInr(data.totals.grossBilling)}
            </p>
          </div>
        </div>
      </div>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
            <DialogTitle className="text-base font-bold">
              {selected ? `${selected.label} bills` : ""}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {dateLabel} · {selected?.testCount ?? 0} {selected ? countNoun(selected) : "cases"} on{" "}
              {selected?.billCount ?? 0} bills
              {selected && selected.grossBilling > 0
                ? ` · billed ${fmtInr(selected.grossBilling)}`
                : ""}
            </p>
          </DialogHeader>

          <div className="overflow-auto flex-1 min-h-[200px]">
            {billsQ.isLoading && (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 size={22} className="animate-spin" />
                <p className="text-sm">Loading bills…</p>
              </div>
            )}

            {billsQ.isError && (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-destructive">
                <Inbox size={22} />
                <p className="text-sm">Could not load bills. Please try again.</p>
              </div>
            )}

            {!billsQ.isLoading && !billsQ.isError && billsQ.data && billsQ.data.rows.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <Inbox size={22} className="opacity-40" />
                <p className="text-sm">No {selected?.label} bills for this period.</p>
              </div>
            )}

            {!billsQ.isLoading && !billsQ.isError && billsQ.data && billsQ.data.rows.length > 0 && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm">
                  <tr>
                    {billsQ.data.columns.map((col) => (
                      <th
                        key={col}
                        className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground border-b border-border ${
                          AMOUNT_COLUMNS.has(col) ? "text-right" : "text-left"
                        }`}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {billsQ.data.rows.map((row, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          className={`px-4 py-2 ${
                            AMOUNT_COLUMNS.has(billsQ.data!.columns[j])
                              ? "text-right font-mono tabular-nums font-semibold"
                              : "text-left"
                          }`}
                        >
                          {fmtCell(cell, billsQ.data!.columns[j])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {billsQ.data && billsQ.data.rows.length > 0 && (
            <div className="px-5 py-2.5 border-t border-border shrink-0 text-xs text-muted-foreground flex justify-between gap-3">
              <span>
                {billsQ.data.rows.length} bill{billsQ.data.rows.length !== 1 ? "s" : ""}
              </span>
              {selected && selected.grossBilling > 0 && (
                <span className="font-semibold tabular-nums text-foreground">
                  Service total {fmtInr(selected.grossBilling)}
                </span>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
