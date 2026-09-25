/**
 * Public read-only share pages for WhatsApp Delivery v2.
 * /share/bill/:token and /share/report/:token — noindex, no edits, no payments.
 */
import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { AlertCircle, Loader2, FileText, Receipt } from "lucide-react";

function formatCurrency(n: number | string) {
  const v = Number(n || 0);
  return `\u20b9${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function useShareMeta() {
  useEffect(() => {
    const prev = document.title;
    let robots = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    let created = false;
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.appendChild(robots);
      created = true;
    }
    const prevContent = robots.content;
    robots.content = "noindex, nofollow";
    return () => {
      document.title = prev;
      if (robots) {
        if (created) robots.remove();
        else robots.content = prevContent;
      }
    };
  }, []);
}

function ExpiredView({ message }: { message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center max-w-sm">
        <AlertCircle size={48} className="mx-auto mb-4 text-slate-400" />
        <h1 className="text-xl font-semibold mb-2 text-slate-800">Link expired</h1>
        <p className="text-sm text-slate-500">
          {message || "This share link has expired or is invalid."}
        </p>
      </div>
    </div>
  );
}

export function ShareBillPage() {
  useShareMeta();
  const [, params] = useRoute("/share/bill/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setExpired(true);
      return;
    }
    fetch(`/api/share/bill/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) {
          setExpired(true);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d?.ok) {
          setData(d);
          document.title = `${d.clinicName || "Care"} — Bill`;
        } else if (d) {
          setExpired(true);
        }
      })
      .catch(() => setExpired(true))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (expired || !data?.bill) return <ExpiredView />;

  const bill = data.bill;
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 text-teal-700 mb-4">
          <Receipt size={20} />
          <span className="text-xs font-semibold uppercase tracking-wide">{data.clinicName}</span>
        </div>
        <h1 className="text-lg font-bold text-slate-900">Bill {bill.billNumber}</h1>
        <p className="text-sm text-slate-500 mt-1">{bill.patientName} · {bill.patientId}</p>
        <p className="text-xs text-slate-400 mt-1">Link expires {formatDate(data.expiresAt)}</p>

        <div className="mt-4 inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-slate-100 text-slate-700">
          {bill.status}
        </div>

        <table className="w-full mt-5 text-sm">
          <tbody>
            {(bill.items || []).map((it: any, i: number) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-2 pr-2">{it.name}</td>
                <td className="py-2 text-right font-medium">{formatCurrency(it.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-800">
              <td className="py-3 font-bold">Total</td>
              <td className="py-3 text-right font-bold">{formatCurrency(bill.totalAmount)}</td>
            </tr>
            <tr>
              <td className="py-1 text-slate-500">Paid</td>
              <td className="py-1 text-right">{formatCurrency(bill.paidAmount)}</td>
            </tr>
            <tr>
              <td className="py-1 text-slate-500">Balance</td>
              <td className="py-1 text-right">{formatCurrency(bill.balanceAmount)}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-6 text-[11px] text-slate-400 text-center">
          Read-only view. Payments and edits are not available on this link.
        </p>
      </div>
    </div>
  );
}

export function ShareReportPage() {
  useShareMeta();
  const [, params] = useRoute("/share/report/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setExpired(true);
      return;
    }
    fetch(`/api/share/report/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) {
          setExpired(true);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d?.ok) {
          setData(d);
          document.title = `${d.clinicName || "Care"} — Report`;
        } else if (d) {
          setExpired(true);
        }
      })
      .catch(() => setExpired(true))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (expired || !data?.report) return <ExpiredView />;

  const report = data.report;
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 text-teal-700 mb-4">
          <FileText size={20} />
          <span className="text-xs font-semibold uppercase tracking-wide">{data.clinicName}</span>
        </div>
        <h1 className="text-lg font-bold text-slate-900">{report.title || "Report"}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {report.patientName}
          {report.reportNumber ? ` · ${report.reportNumber}` : ""}
        </p>
        <p className="text-xs text-slate-400 mt-1">Link expires {formatDate(data.expiresAt)}</p>
        <div className="mt-4 inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-slate-100 text-slate-700">
          {report.status}
        </div>
        {report.pdfPath && (
          <a
            href={report.pdfPath}
            className="mt-6 block w-full text-center rounded-lg bg-teal-700 text-white py-2.5 text-sm font-semibold hover:bg-teal-800"
          >
            View PDF
          </a>
        )}
        <p className="mt-6 text-[11px] text-slate-400 text-center">
          Read-only view. Clinical findings are not shown in this summary.
        </p>
      </div>
    </div>
  );
}

export default ShareBillPage;
