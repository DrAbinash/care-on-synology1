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

export type ModalityBillingRow = {
  key: string;
  label: string;
  testCount: number;
  billCount: number;
  grossBilling: number;
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

const AMOUNT_COLUMNS = new Set(["Modality Amount", "Bill Amount", "Amount"]);

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

function fmtInr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
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
        <div className="h-24 bg-gray-100 dark:bg-muted/30 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (isError || !data) return null;

  const dateLabel = from === to ? from : `${from} → ${to}`;

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
            Imaging billed
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            {dateLabel} · clinic-wide · tap a modality to open bills
          </p>
        </div>
        )}
        {hideHeader && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {dateLabel} · clinic-wide · tap a modality to open bills
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {data.modalities.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => setSelected(row)}
              className="rounded-lg border border-gray-100 dark:border-card-border bg-gray-50/80 dark:bg-muted/20 p-3 text-left transition-colors hover:border-sky-400 hover:bg-sky-50/70 dark:hover:bg-sky-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              data-testid={`modality-billing-${row.key}`}
            >
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-300">
                {row.label}
              </p>
              <p className="text-2xl font-extrabold tabular-nums leading-none mt-1.5 text-gray-900 dark:text-foreground">
                {row.testCount}
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                {row.billCount} bill{row.billCount === 1 ? "" : "s"}
                {row.grossBilling > 0 ? ` · ${fmtInr(row.grossBilling)}` : ""}
              </p>
            </button>
          ))}
        </div>

        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          Totals: {data.totals.testCount} studies · {data.totals.billCount} bills
          {data.totals.grossBilling > 0 ? ` · ${fmtInr(data.totals.grossBilling)}` : ""}
        </p>
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
              {dateLabel} · {selected?.testCount ?? 0} studies on {selected?.billCount ?? 0} bills
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
            <div className="px-5 py-2.5 border-t border-border shrink-0 text-xs text-muted-foreground">
              {billsQ.data.rows.length} bill{billsQ.data.rows.length !== 1 ? "s" : ""}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
