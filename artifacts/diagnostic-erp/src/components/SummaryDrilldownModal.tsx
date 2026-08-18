import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Inbox } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DrilldownType =
  | "totalBills"
  | "duesCollected"
  | "cancellations"
  | "outstandingDues"
  | "collectibleAmount"
  | "netDigitalCollection"
  | "totalExpenses"
  | "expectedPhysicalCash"
  | "totalReceived"
  | "discountsGiven"
  | "cancellationCount"
  | "averageBillValue"
  | "refundsWithoutCancellation";

type DrilldownResponse = {
  type: DrilldownType;
  label: string;
  columns: string[];
  rows: (string | number | null)[][];
  from: string;
  to: string;
  staffName: string;
};

// Friendly card titles shown as the modal heading — matches exactly what's
// printed on each KPI card on the page, per the "modal title should match
// clicked card" requirement.
export const DRILLDOWN_TITLES: Record<DrilldownType, string> = {
  totalBills: "Total Bills Generated",
  duesCollected: "Dues Collected",
  cancellations: "Cancellations (₹)",
  outstandingDues: "Outstanding / Dues",
  collectibleAmount: "Collectible Amount",
  netDigitalCollection: "Net Digital Collection",
  totalExpenses: "Total Expenses",
  expectedPhysicalCash: "Expected Physical Cash",
  totalReceived: "Total Received",
  discountsGiven: "Discounts Given",
  cancellationCount: "Cancellation Count",
  averageBillValue: "Average Bill Value",
  refundsWithoutCancellation: "Refunds",
};

// Columns known to hold a currency amount — right-aligned + ₹-formatted for
// readability. Matched by exact column header text returned from the API.
const AMOUNT_COLUMNS = new Set([
  "Amount", "Bill Amount", "Discount", "Balance Due", "Amount Collected",
  "Remaining Balance", "Discount", "Component", "Value",
]);

function fmtCell(value: string | number | null, column: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    // Heuristic: numeric cell in a currency-ish column → ₹ format.
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
      signDisplay: value < 0 ? "always" : "auto",
    }).format(value);
  }
  // Date-looking ISO strings → readable local format
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    try {
      return new Date(value).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { /* fall through */ }
  }
  return value;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SummaryDrilldownModal({
  type,
  from,
  to,
  staffName,
  onClose,
}: {
  type: DrilldownType | null;
  from: string;
  to: string;
  staffName: string | null; // null = All Staff (super-admin aggregate)
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery<DrilldownResponse>({
    queryKey: ["my-daily-summary-drilldown", type, from, to, staffName],
    queryFn: () =>
      api.get<DrilldownResponse>(
        `/api/dashboard/my-daily-summary/drilldown?type=${type}&from=${from}&to=${to}` +
          (staffName ? `&staffName=${encodeURIComponent(staffName)}` : "")
      ),
    enabled: !!type,
  });

  return (
    <Dialog open={!!type} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] min-h-0 flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <DialogTitle className="text-base font-bold">
            {type ? DRILLDOWN_TITLES[type] : ""}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {from === to ? from : `${from} → ${to}`} · {staffName ?? "All Staff"}
          </p>
        </DialogHeader>

        <div className="overflow-auto flex-1 min-h-[200px]">
          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 size={22} className="animate-spin" />
              <p className="text-sm">Loading details…</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-destructive">
              <Inbox size={22} />
              <p className="text-sm">Could not load details. Please try again.</p>
            </div>
          )}

          {!isLoading && !isError && data && data.rows.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Inbox size={22} className="opacity-40" />
              <p className="text-sm">No records for this period.</p>
            </div>
          )}

          {!isLoading && !isError && data && data.rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm">
                <tr>
                  {data.columns.map((col) => (
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
                {data.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`px-4 py-2 ${
                          AMOUNT_COLUMNS.has(data.columns[j]) ? "text-right font-mono tabular-nums font-semibold" : "text-left"
                        }`}
                      >
                        {fmtCell(cell, data.columns[j])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {data && data.rows.length > 0 && (
          <div className="px-5 py-2.5 border-t border-border shrink-0 text-xs text-muted-foreground">
            {data.rows.length} record{data.rows.length !== 1 ? "s" : ""}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
