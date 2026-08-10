import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { api } from "@/lib/fetchApi";
import { ShieldCheck, AlertCircle, Loader2 } from "lucide-react";

function formatCurrency(n: number | string) {
  const v = Number(n || 0);
  return `\u20b9${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: string) {
  const cls =
    status === "paid" ? "bg-green-100 text-green-700" :
    status === "partial" ? "bg-amber-100 text-amber-700" :
    status === "cancelled" ? "bg-red-100 text-red-700" :
    "bg-slate-100 text-slate-700";
  return `<span class="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase ${cls}">${status}</span>`;
}

export default function VerifyReceipt() {
  const [match, params] = useRoute("/verify-receipt/:billId");
  const billId = params?.billId ?? "";
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!billId) { setLoading(false); return; }
    const hash = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("hash")
      : null;
    const qs = hash ? `?hash=${encodeURIComponent(hash)}` : "";
    api.get(`/api/verify/bill/${encodeURIComponent(billId)}${qs}`)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message || "Failed to verify receipt"); setLoading(false); });
  }, [billId]);

  if (!match) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-500">
          <AlertCircle size={48} className="mx-auto mb-4 text-gray-400" />
          <h1 className="text-xl font-semibold mb-2">Invalid Link</h1>
          <p className="text-sm">This verification link is malformed.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-500">
          <Loader2 size={48} className="mx-auto mb-4 animate-spin text-blue-500" />
          <h1 className="text-xl font-semibold mb-2">Verifying Receipt...</h1>
          <p className="text-sm">Please wait while we fetch the bill details.</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center text-red-600 max-w-md">
          <AlertCircle size={48} className="mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Receipt Not Found</h1>
          <p className="text-sm">{error || "This bill could not be verified. It may have been deleted or the link is invalid."}</p>
        </div>
      </div>
    );
  }

  const b = data;
  const isPaid = b.status === "paid";
  const isCancelled = b.status === "cancelled";
  const balance = Number(b.balanceAmount ?? 0);
  const refund = Number(b.refundAmount ?? 0);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="bg-blue-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <ShieldCheck size={32} />
            <div>
              <h1 className="text-lg font-bold">Receipt Verified</h1>
              <p className="text-xs text-blue-100">Official verification from Care Diagnostics</p>
            </div>
          </div>
        </div>

        {/* Bill Summary */}
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase">Bill Number</span>
            <span className="text-sm font-bold font-mono">{b.billNumber}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase">Status</span>
            <span dangerouslySetInnerHTML={{ __html: statusBadge(b.status) }} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase">Date</span>
            <span className="text-sm">{formatDate(b.createdAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase">Patient</span>
            <span className="text-sm font-medium">{b.patientName || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase">Phone</span>
            <span className="text-sm font-mono">{b.patientPhone || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase">UHID</span>
            <span className="text-sm font-mono">{b.patientId || "—"}</span>
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span>{formatCurrency(b.subtotal)}</span>
            </div>
            {Number(b.discount ?? 0) > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Discount</span>
                <span className="text-green-600">- {formatCurrency(b.discount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm font-bold">
              <span>Total</span>
              <span>{formatCurrency(b.totalAmount)}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-green-600">
              <span>Paid</span>
              <span>- {formatCurrency(b.paidAmount)}</span>
            </div>
            {!isCancelled && balance > 0 && (
              <div className="flex items-center justify-between text-sm font-bold text-red-600">
                <span>Balance Due</span>
                <span>{formatCurrency(balance)}</span>
              </div>
            )}
            {refund > 0 && (
              <div className="flex items-center justify-between text-sm font-bold text-orange-600">
                <span>Refund</span>
                <span>{formatCurrency(refund)}</span>
              </div>
            )}
          </div>

          {/* Tests */}
          {b.tests && b.tests.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Tests</h3>
              <div className="space-y-1">
                {b.tests.map((t: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                    <span className="text-gray-700">{t.name}</span>
                    <span className="font-mono">{formatCurrency(t.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payments */}
          {b.payments && b.payments.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Payments</h3>
              <div className="space-y-1">
                {b.payments.map((p: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                    <span className="text-gray-700 capitalize">{p.method}</span>
                    <span className="font-mono">{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-gray-100 pt-4 text-center text-xs text-gray-400">
            <p>This is an official digital verification from Care Diagnostics.</p>
            <p className="mt-1">If you have any concerns, please contact the clinic directly.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
