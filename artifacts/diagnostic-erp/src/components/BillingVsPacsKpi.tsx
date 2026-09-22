import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Link2, Loader2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";

export type BillingVsPacsModalityRow = {
  key: string;
  billed: number;
  pacs: number;
  linkedPacs: number;
  unlinkedPacs: number;
  billedNotInPacs: number;
  gap: number;
  matched: boolean;
  alert: boolean;
};

export type BillingVsPacsSummary = {
  from: string;
  to: string;
  mode?: "bill" | "mwl";
  modalities: BillingVsPacsModalityRow[];
  totals: {
    billed: number;
    pacs: number;
    linkedPacs: number;
    unlinkedPacs: number;
    billedNotInPacs: number;
    mismatchCount: number;
  };
};

type VerifyResult = {
  attempted: number;
  linked: number;
  alreadyLinked: number;
  failed: number;
  summary: BillingVsPacsSummary;
};

type Props = {
  from: string;
  to: string;
  hideHeader?: boolean;
};

function modalityFootnote(row: BillingVsPacsModalityRow): string | null {
  const parts: string[] = [];
  if (row.unlinkedPacs > 0) {
    parts.push(`${row.unlinkedPacs} PACS not linked to bill`);
  }
  if (row.billedNotInPacs > 0) {
    parts.push(`${row.billedNotInPacs} billed, no PACS link`);
  }
  if (parts.length === 0 && row.gap > 0) {
    parts.push(`+${row.gap} more in PACS than billed`);
  }
  if (parts.length === 0 && row.gap < 0 && row.billedNotInPacs === 0) {
    parts.push(`${Math.abs(row.gap)} billed count ahead of PACS`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export default function BillingVsPacsKpi({ from, to, hideHeader = false }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<BillingVsPacsSummary>({
    queryKey: ["billing-vs-pacs", from, to],
    queryFn: () => api.get(`/api/dashboard/my-daily-summary/billing-vs-pacs?from=${from}&to=${to}`),
    ...FINANCIAL_QUERY_OPTIONS,
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      api.post<VerifyResult>("/api/dashboard/my-daily-summary/billing-vs-pacs/verify", { from, to }),
    onSuccess: (result) => {
      qc.setQueryData(["billing-vs-pacs", from, to], result.summary);
      toast({
        title: "Billed vs PACS verified",
        description:
          result.attempted === 0
            ? "All PACS rows in this range were already linked."
            : `Linked ${result.linked} of ${result.attempted} unlinked PACS rows`
              + (result.failed > 0 ? ` · ${result.failed} still need Match Center` : ""),
      });
    },
    onError: (err: Error) => {
      toast({ title: "Verify failed", description: err.message, variant: "destructive" });
    },
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
  const linked = data.totals.linkedPacs ?? (data.totals.pacs - data.totals.unlinkedPacs);
  const billedNotInPacs = data.totals.billedNotInPacs ?? 0;

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
            {dateLabel} · clinic-wide · verifies each PACS study is linked to a bill
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            disabled={verifyMutation.isPending}
            onClick={() => verifyMutation.mutate()}
            data-testid="billing-vs-pacs-verify"
          >
            {verifyMutation.isPending ? (
              <Loader2 size={12} className="mr-1 animate-spin" />
            ) : (
              <Link2 size={12} className="mr-1" />
            )}
            Verify links
          </Button>
          <Link
            href="/radiology/my-collection?filter=unbilled"
            className="text-[11px] font-semibold text-primary hover:underline whitespace-nowrap"
          >
            Match Center →
          </Link>
        </div>
      </div>
      )}
      {hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {dateLabel} · verifies each PACS study is linked to a bill (not the same as “unbilled”)
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px] shrink-0"
            disabled={verifyMutation.isPending}
            onClick={() => verifyMutation.mutate()}
            data-testid="billing-vs-pacs-verify"
          >
            {verifyMutation.isPending ? (
              <Loader2 size={12} className="mr-1 animate-spin" />
            ) : (
              <Link2 size={12} className="mr-1" />
            )}
            Verify links
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        {data.modalities.map((row) => {
          const mismatch = !row.matched;
          const needsLink = (row.unlinkedPacs ?? 0) > 0 || (row.billedNotInPacs ?? 0) > 0;
          const note = modalityFootnote(row);
          return (
            <div
              key={row.key}
              className={`rounded-lg border p-3 text-center transition-colors ${
                needsLink
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
                  <AlertTriangle size={12} className={`shrink-0 ${needsLink ? "text-orange-600" : "text-amber-600"}`} />
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
              {(row.linkedPacs ?? 0) > 0 && (
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                  {row.linkedPacs} linked
                </p>
              )}
              {note && (
                <p className={`text-[10px] font-semibold mt-1 ${needsLink ? "text-orange-700 dark:text-orange-400" : "text-amber-700 dark:text-amber-400"}`}>
                  {note}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-gray-500 dark:text-gray-400">
        Totals: {data.totals.billed} billed · {data.totals.pacs} in PACS · {linked} linked
        {data.totals.unlinkedPacs > 0 && (
          <span className="text-orange-700 dark:text-orange-400 font-semibold">
            {" "}· {data.totals.unlinkedPacs} PACS not linked to a bill
          </span>
        )}
        {billedNotInPacs > 0 && (
          <span className="text-amber-700 dark:text-amber-400 font-semibold">
            {" "}· {billedNotInPacs} billed with no PACS link
          </span>
        )}
      </p>
    </div>
  );
}
