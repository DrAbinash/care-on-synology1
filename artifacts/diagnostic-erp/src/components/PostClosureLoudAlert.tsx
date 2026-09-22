import { AlertTriangle, IndianRupee, Wallet } from "lucide-react";
import { Link } from "wouter";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const fmtIst = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      })
    : "—";

const fmtTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      })
    : "—";

export type PostClosureLoudData = {
  closedAt: string | null;
  bills: Array<{
    id: number;
    billNumber: string;
    totalAmount: number;
    paidAmount: number;
    status: string;
    createdAt: string;
    sameDayAfterClose?: boolean;
  }>;
  payments: Array<{
    id: number;
    billId: number;
    amount: number;
    method: string;
    createdAt: string;
    sameDayAfterClose?: boolean;
  }>;
  billTotal: number;
  paymentTotal: number;
  sameDayBillCount?: number;
  sameDayBillTotal?: number;
  sameDayPaymentCount?: number;
  sameDayPaymentTotal?: number;
};

/** Loud, always-expanded alert for billing that continued after drawer close. */
export function PostClosureLoudAlert({
  data,
  scopeLabel = "your drawer",
}: {
  data: PostClosureLoudData;
  scopeLabel?: string;
}) {
  if (!data.closedAt || (data.bills.length === 0 && data.payments.length === 0)) return null;

  const sameDayBillCount =
    data.sameDayBillCount ?? data.bills.filter((b) => b.sameDayAfterClose).length;
  const sameDayBillTotal =
    data.sameDayBillTotal ??
    data.bills.filter((b) => b.sameDayAfterClose).reduce((s, b) => s + b.totalAmount, 0);
  const sameDayPaymentCount =
    data.sameDayPaymentCount ?? data.payments.filter((p) => p.sameDayAfterClose).length;
  const sameDayPaymentTotal =
    data.sameDayPaymentTotal ??
    data.payments.filter((p) => p.sameDayAfterClose).reduce((s, p) => s + p.amount, 0);
  const hasSameDay = sameDayBillCount > 0 || sameDayPaymentCount > 0;

  return (
    <div
      className="rounded-xl overflow-hidden border-4 border-orange-500 dark:border-orange-400 shadow-lg ring-4 ring-orange-200/80 dark:ring-orange-900/50"
      role="alert"
      data-testid="post-closure-loud-alert"
    >
      <div className="px-4 py-3.5 bg-gradient-to-r from-orange-600 to-amber-500 text-white">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-white/20 flex-shrink-0">
            <AlertTriangle size={20} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base sm:text-lg font-black tracking-tight uppercase">
              Billing continued after close
            </p>
            <p className="text-sm font-semibold text-orange-50 mt-0.5">
              {scopeLabel} closed at {fmtIst(data.closedAt)} — fresh bills/payments below belong to the{" "}
              <span className="underline decoration-2 underline-offset-2">next reconciliation window</span>
              , not the closed drawer.
            </p>
            {hasSameDay && (
              <p
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white text-orange-800 text-xs font-black uppercase tracking-wide"
                data-testid="same-day-after-close-badge"
              >
                Same-day after close · {sameDayBillCount} bill
                {sameDayBillCount !== 1 ? "s" : ""} ({inr(sameDayBillTotal)})
                {sameDayPaymentCount > 0 &&
                  ` · ${sameDayPaymentCount} payment${sameDayPaymentCount !== 1 ? "s" : ""} (${inr(sameDayPaymentTotal)})`}
              </p>
            )}
          </div>
          <div className="hidden sm:flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-2xl font-black tabular-nums">{data.bills.length}</span>
            <span className="text-[10px] font-bold uppercase opacity-90">new bills</span>
            <span className="text-lg font-black tabular-nums">{inr(data.billTotal)}</span>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4 bg-orange-50 dark:bg-orange-950/40">
        {data.bills.length > 0 && (
          <div>
            <p className="text-xs font-black text-orange-900 dark:text-orange-200 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <IndianRupee size={12} /> Bills after close
            </p>
            <div className="overflow-x-auto rounded-lg border-2 border-orange-300 dark:border-orange-700">
              <table className="w-full text-xs">
                <thead className="bg-orange-200/70 dark:bg-orange-900/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold text-orange-950 dark:text-orange-100">Bill #</th>
                    <th className="px-3 py-2 text-right font-bold text-orange-950 dark:text-orange-100">Amount</th>
                    <th className="px-3 py-2 text-right font-bold text-orange-950 dark:text-orange-100">Paid</th>
                    <th className="px-3 py-2 text-left font-bold text-orange-950 dark:text-orange-100">When</th>
                    <th className="px-3 py-2 text-left font-bold text-orange-950 dark:text-orange-100">Mark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-orange-200 dark:divide-orange-800 bg-white/70 dark:bg-black/20">
                  {data.bills.map((b) => (
                    <tr
                      key={b.id}
                      className={
                        b.sameDayAfterClose
                          ? "bg-orange-100/80 dark:bg-orange-900/30"
                          : "hover:bg-orange-50 dark:hover:bg-orange-950/20"
                      }
                    >
                      <td className="px-3 py-2 font-bold">
                        <Link href={`/billing/${b.id}`} className="text-primary hover:underline">
                          {b.billNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{inr(b.totalAmount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-green-700 dark:text-green-400">
                        {inr(b.paidAmount)}
                      </td>
                      <td className="px-3 py-2 text-orange-800 dark:text-orange-300">{fmtTime(b.createdAt)}</td>
                      <td className="px-3 py-2">
                        {b.sameDayAfterClose ? (
                          <SameDayAfterCloseBadge />
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase">
                            Next-day addition
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data.payments.length > 0 && (
          <div>
            <p className="text-xs font-black text-orange-900 dark:text-orange-200 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Wallet size={12} /> Payments after close
            </p>
            <div className="overflow-x-auto rounded-lg border-2 border-orange-300 dark:border-orange-700">
              <table className="w-full text-xs">
                <thead className="bg-orange-200/70 dark:bg-orange-900/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold text-orange-950 dark:text-orange-100">Bill</th>
                    <th className="px-3 py-2 text-right font-bold text-orange-950 dark:text-orange-100">Amount</th>
                    <th className="px-3 py-2 text-left font-bold text-orange-950 dark:text-orange-100">Method</th>
                    <th className="px-3 py-2 text-left font-bold text-orange-950 dark:text-orange-100">Mark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-orange-200 dark:divide-orange-800 bg-white/70 dark:bg-black/20">
                  {data.payments.map((p) => (
                    <tr
                      key={p.id}
                      className={p.sameDayAfterClose ? "bg-orange-100/80 dark:bg-orange-900/30" : undefined}
                    >
                      <td className="px-3 py-2 font-bold">
                        <Link href={`/billing/${p.billId}`} className="text-primary hover:underline">
                          Bill #{p.billId}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-green-700 dark:text-green-400">
                        {inr(p.amount)}
                      </td>
                      <td className="px-3 py-2 capitalize">{p.method}</td>
                      <td className="px-3 py-2">
                        {p.sameDayAfterClose ? <SameDayAfterCloseBadge /> : (
                          <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase">
                            Next-day addition
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-xs font-semibold text-orange-900 dark:text-orange-200 bg-orange-200/60 dark:bg-orange-900/40 rounded-lg px-3 py-2">
          These amounts are <strong>not</strong> in the closed drawer. They will appear as{" "}
          <strong>next-window / next-day additions</strong> with a same-day-after-close mark when the prior
          close was earlier today.
        </p>
      </div>
    </div>
  );
}

/** Compact badge for open-window / next-day bill rows. */
export function SameDayAfterCloseBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide bg-orange-600 text-white shadow-sm ${className}`}
      title="Billed on the same IST calendar day after the previous drawer/day close — counts in this next window"
      data-testid="same-day-after-close-row-badge"
    >
      <AlertTriangle size={10} /> Same-day after prior close
    </span>
  );
}

/** Compact admin strip when one or more staff have post-closure activity. */
export function StaffPostClosureOverviewBanner({
  rows,
}: {
  rows: Array<{
    userName: string;
    postClosure: {
      billCount: number;
      billTotal: number;
      paymentCount: number;
      paymentTotal: number;
      sameDayBillCount: number;
      sameDayBillTotal: number;
    };
  }>;
}) {
  if (rows.length === 0) return null;
  const totalBills = rows.reduce((s, r) => s + r.postClosure.billCount, 0);
  const totalAmt = rows.reduce((s, r) => s + r.postClosure.billTotal, 0);
  const sameDayBills = rows.reduce((s, r) => s + r.postClosure.sameDayBillCount, 0);

  return (
    <div
      className="rounded-xl border-4 border-orange-500 bg-orange-50 dark:bg-orange-950/30 overflow-hidden shadow-md"
      role="alert"
      data-testid="staff-post-closure-overview"
    >
      <div className="px-4 py-3 bg-orange-600 text-white flex flex-wrap items-center gap-3">
        <AlertTriangle size={18} className="flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-black uppercase text-sm tracking-wide">Staff billed after their drawer close</p>
          <p className="text-xs text-orange-100 font-medium">
            {rows.length} staff · {totalBills} bill{totalBills !== 1 ? "s" : ""} ({inr(totalAmt)}) after close
            {sameDayBills > 0 ? ` · ${sameDayBills} same-day after close` : ""} — next window, not closed drawer
          </p>
        </div>
      </div>
      <ul className="divide-y divide-orange-200 dark:divide-orange-800">
        {rows.map((r) => (
          <li key={r.userName} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-bold text-orange-950 dark:text-orange-100">{r.userName}</span>
            <span className="tabular-nums font-semibold text-orange-900 dark:text-orange-200">
              {r.postClosure.billCount} bill{r.postClosure.billCount !== 1 ? "s" : ""} · {inr(r.postClosure.billTotal)}
              {r.postClosure.sameDayBillCount > 0 && (
                <span className="ml-2">
                  <SameDayAfterCloseBadge />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
