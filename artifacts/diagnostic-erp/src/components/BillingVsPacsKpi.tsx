import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import { AlertTriangle, CheckCircle2, ScanSearch } from "lucide-react";

export type BillingVsPacsModalityRow = {
  key: string;
  billed: number;
  pacs: number;
  gap: number;
  unlinkedPacs: number;
  matched: boolean;
  alert: boolean;
};

export type BillingVsPacsSummary = {
  from: string;
  to: string;
  modalities: BillingVsPacsModalityRow[];
  totals: {
    billed: number;
    pacs: number;
    unlinkedPacs: number;
    mismatchCount: number;
  };
};

type Props = {
  from: string;
  to: string;
  hideHeader?: boolean;
};

export default function BillingVsPacsKpi({ from, to, hideHeader = false }: Props) {
  const { data, isLoading, isError } = useQuery<BillingVsPacsSummary>({
    queryKey: ["billing-vs-pacs", from, to],
    queryFn: () => api.get(`/api/dashboard/my-daily-summary/billing-vs-pacs?from=${from}&to=${to}`),
    ...FINANCIAL_QUERY_OPTIONS,
  });

  if (isLoading) {
    return (
      <div className={hideHeader ? "p-4" : "bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-4 shadow-sm"}>
        <div className="h-20 bg-gray-100 dark:bg-muted/30 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (isError || !data) return null;

  const dateLabel = from === to ? from : `${from} → ${to}`;
  const hasAlerts = data.totals.mismatchCount > 0;

  return (
    <div
      className={`${hideHeader ? "p-4 space-y-3" : "bg-white dark:bg-card border rounded-xl p-4 shadow-sm space-y-3"} ${
        hideHeader
          ? ""
          : hasAlerts
            ? "border-amber-300 dark:border-amber-700 ring-1 ring-amber-200/60 dark:ring-amber-900/40"
            : "border-gray-200 dark:border-card-border"
      }`}
      data-testid="billing-vs-pacs-kpi"
    >
      {!hideHeader && (
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
            <ScanSearch size={14} className="text-violet-600" />
            Imaging: Billed vs PACS
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            {dateLabel} · clinic-wide · catches scans without billing
          </p>
        </div>
        <Link
          href="/radiology/my-collection?filter=unbilled"
          className="text-[11px] font-semibold text-primary hover:underline whitespace-nowrap"
        >
          Review in Match Center →
        </Link>
      </div>
      )}
      {hideHeader && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {dateLabel} · clinic-wide · catches scans without billing
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        {data.modalities.map((row) => {
          const mismatch = !row.matched;
          const scanWithoutBill = row.gap > 0 || row.unlinkedPacs > 0;
          return (
            <div
              key={row.key}
              className={`rounded-lg border p-3 text-center transition-colors ${
                scanWithoutBill
                  ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-600"
                  : mismatch
                    ? "border-amber-300 bg-amber-50/80 dark:bg-amber-950/20 dark:border-amber-700"
                    : "border-gray-100 dark:border-card-border bg-gray-50/80 dark:bg-muted/20"
              }`}
              data-testid={`billing-vs-pacs-${row.key}`}
              data-matched={row.matched ? "true" : "false"}
            >
              <div className="flex items-center justify-center gap-1 mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-300">
                  {row.key}
                </span>
                {row.matched ? (
                  <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle size={12} className={`shrink-0 ${scanWithoutBill ? "text-orange-600" : "text-amber-600"}`} />
                )}
              </div>
              <p className="text-lg font-extrabold tabular-nums leading-none text-gray-900 dark:text-foreground">
                <span className={mismatch && row.billed < row.pacs ? "text-orange-700 dark:text-orange-400" : ""}>
                  {row.billed}
                </span>
                <span className="text-gray-400 font-normal mx-0.5">/</span>
                <span className={mismatch && row.pacs > row.billed ? "text-orange-700 dark:text-orange-400" : ""}>
                  {row.pacs}
                </span>
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">billed / PACS</p>
              {scanWithoutBill && (
                <p className="text-[10px] font-semibold text-orange-700 dark:text-orange-400 mt-1">
                  {row.unlinkedPacs > 0
                    ? `${row.unlinkedPacs} unlinked`
                    : row.gap > 0
                      ? `+${row.gap} in PACS`
                      : "mismatch"}
                </p>
              )}
              {!scanWithoutBill && mismatch && row.gap < 0 && (
                <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400 mt-1">
                  {Math.abs(row.gap)} billed, not in PACS
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-gray-500 dark:text-gray-400">
        Totals: {data.totals.billed} billed · {data.totals.pacs} in PACS
        {data.totals.unlinkedPacs > 0 && (
          <span className="text-orange-700 dark:text-orange-400 font-semibold">
            {" "}· {data.totals.unlinkedPacs} unlinked scan{data.totals.unlinkedPacs === 1 ? "" : "s"}
          </span>
        )}
      </p>
    </div>
  );
}
