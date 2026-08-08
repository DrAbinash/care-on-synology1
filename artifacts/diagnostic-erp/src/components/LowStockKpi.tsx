import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import { AlertTriangle, CheckCircle2, Package } from "lucide-react";

type LowStockSummary = {
  lowCount: number;
  outCount: number;
  criticalCount: number;
  items: Array<{
    id: number;
    name: string;
    unit: string;
    currentStock: number;
    minStock: number;
    isOut: boolean;
  }>;
};

export default function LowStockKpi() {
  const { data, isLoading, isError } = useQuery<LowStockSummary>({
    queryKey: ["daily-summary-low-stock"],
    queryFn: () => api.get("/api/dashboard/my-daily-summary/low-stock"),
    ...FINANCIAL_QUERY_OPTIONS,
  });

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-4 shadow-sm">
        <div className="h-16 bg-gray-100 dark:bg-muted/30 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (isError || !data) return null;

  const hasAlert = data.criticalCount > 0;

  return (
    <div
      className={`bg-white dark:bg-card border rounded-xl p-4 shadow-sm space-y-3 ${
        hasAlert
          ? "border-amber-300 dark:border-amber-700 ring-1 ring-amber-200/60 dark:ring-amber-900/40"
          : "border-gray-200 dark:border-card-border"
      }`}
      data-testid="low-stock-kpi"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
            <Package size={14} className="text-amber-600" />
            Inventory: Low Stock Alert
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            Live clinic-wide · items at or below minimum level
          </p>
        </div>
        <Link href="/inventory" className="text-[11px] font-semibold text-primary hover:underline whitespace-nowrap">
          Open Inventory →
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className={`rounded-lg border px-4 py-2 min-w-[100px] text-center ${
          hasAlert ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20"
        }`}>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Need attention</p>
          <p className={`text-2xl font-extrabold tabular-nums ${hasAlert ? "text-amber-700 dark:text-amber-400" : "text-emerald-700"}`}>
            {data.criticalCount}
          </p>
        </div>
        {data.outCount > 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 px-4 py-2 min-w-[100px] text-center">
            <p className="text-[10px] uppercase tracking-wide text-red-600">Out of stock</p>
            <p className="text-2xl font-extrabold tabular-nums text-red-700 dark:text-red-400">{data.outCount}</p>
          </div>
        )}
        {data.lowCount > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 dark:bg-amber-950/10 px-4 py-2 min-w-[100px] text-center">
            <p className="text-[10px] uppercase tracking-wide text-amber-700">Low stock</p>
            <p className="text-2xl font-extrabold tabular-nums text-amber-700 dark:text-amber-400">{data.lowCount}</p>
          </div>
        )}
        {!hasAlert && (
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm font-medium px-2">
            <CheckCircle2 size={16} /> All items above minimum
          </div>
        )}
      </div>

      {hasAlert && (
        <div className="flex flex-wrap gap-2">
          {data.items.slice(0, 8).map((item) => (
            <span
              key={item.id}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold border ${
                item.isOut
                  ? "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
                  : "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
              }`}
            >
              <AlertTriangle size={10} />
              {item.name}: {item.currentStock} {item.unit}
              {item.isOut ? " (OUT)" : ` / min ${item.minStock}`}
            </span>
          ))}
          {data.criticalCount > 8 && (
            <span className="text-[10px] text-gray-500 self-center">+{data.criticalCount - 8} more</span>
          )}
        </div>
      )}
    </div>
  );
}
