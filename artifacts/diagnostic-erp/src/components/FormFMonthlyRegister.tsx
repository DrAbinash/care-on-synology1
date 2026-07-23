import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Download, Printer, RefreshCw, BookOpen } from "lucide-react";

/**
 * FormFMonthlyRegister — the statutory month-wise PCPNDT Form F register for
 * the Appropriate Authority (management-only; the API is requireAdminRole-
 * gated and this tab is rendered only for owner roles).
 *
 * Lists EVERY Form F record of the selected IST month — incomplete records
 * are shown and graded (server-side, same engine as the finalize gates),
 * never silently omitted. The linked-tests column shows the record's
 * Form-F-designated billed tests (clinic settings designation — any
 * modality, not fetal/echo-only). CSV export is generated and AUDITED
 * server-side; printing uses the existing Form F window-print pattern.
 */

interface RegisterRow {
  serial: number;
  recordId: number;
  createdAtIst: string;
  formDate: string;
  patientName: string;
  age: string;
  husbandFatherName: string;
  address: string;
  mobile: string;
  referredBy: string;
  doctorName: string;
  procedure: string;
  linkedTests: string[];
  gestationalAge: string;
  ultrasoundResult: string;
  abnormality: string;
  consentDate: string;
  procedureDate: string;
  resultConveyed: string;
  idCardVerified: boolean;
  completionStatus: "complete" | "incomplete";
  missingFields: string[];
  billNumber: string;
}

interface RegisterResponse {
  month: number;
  year: number;
  rows: RegisterRow[];
  incompleteCount: number;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PAGE_SIZE = 50;

function istNow(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

export default function FormFMonthlyRegister() {
  const { toast } = useToast();
  const now = istNow();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RegisterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<RegisterResponse>(`/api/form-f/register?month=${month}&year=${year}&page=${page}&pageSize=${PAGE_SIZE}`);
      setData(res);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load the register");
    } finally {
      setLoading(false);
    }
  }, [month, year, page]);

  useEffect(() => { load(); }, [load]);

  async function downloadCsv() {
    setExporting(true);
    try {
      // Server-generated CSV — the export itself is written to the audit chain.
      const csv = await api.get<string>(`/api/form-f/register/export?month=${month}&year=${year}`);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `form-f-register-${year}-${String(month).padStart(2, "0")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Register exported", description: "The export has been recorded in the audit log." });
    } catch (e) {
      toast({ variant: "destructive", title: "Export failed", description: e instanceof Error ? e.message : "Error" });
    } finally {
      setExporting(false);
    }
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  async function printRegister() {
    // A statutory register print must cover the COMPLETE month, not the
    // visible page — fetch every page, then compose the print document
    // (same window-print pattern as the existing per-record Form F print).
    let all: RegisterRow[] = [];
    try {
      let p = 1;
      let totalPagesToFetch = 1;
      do {
        const res = await api.get<RegisterResponse>(`/api/form-f/register?month=${month}&year=${year}&page=${p}&pageSize=500`);
        all = all.concat(res.rows);
        totalPagesToFetch = res.pagination.totalPages;
        p += 1;
      } while (p <= totalPagesToFetch && p <= 20);
    } catch (e) {
      toast({ variant: "destructive", title: "Print failed", description: e instanceof Error ? e.message : "Could not load the full month" });
      return;
    }

    const bodyRows = all.map((r) => `
      <tr>
        <td>${r.serial}</td>
        <td>${esc(r.formDate || r.createdAtIst.slice(0, 10))}</td>
        <td>${esc(r.patientName)}<br/><small>${esc([r.age && `${r.age}y`, r.mobile].filter(Boolean).join(" · "))}</small></td>
        <td>${esc(r.husbandFatherName)}</td>
        <td>${esc(r.address)}</td>
        <td>${esc(r.referredBy || r.doctorName)}</td>
        <td>${esc(r.linkedTests.length ? r.linkedTests.join(", ") : r.procedure)}</td>
        <td>${esc(r.gestationalAge)}</td>
        <td>${esc(r.ultrasoundResult)}${r.abnormality ? `<br/><small>${esc(r.abnormality)}</small>` : ""}</td>
        <td>${esc(r.consentDate || r.procedureDate)}</td>
        <td>${esc(r.billNumber)}</td>
        <td>${r.completionStatus === "complete" ? "Complete" : `Incomplete:<br/><small>${esc(r.missingFields.join("; "))}</small>`}</td>
      </tr>`).join("");

    const w = window.open("", "_blank", "width=1100,height=750");
    if (!w) return;
    w.document.write(`
      <!DOCTYPE html><html><head>
      <title>PCPNDT Form F Register — ${MONTH_NAMES[month - 1]} ${year}</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { margin: 0; font-family: Arial, sans-serif; font-size: 10px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #444; padding: 3px 4px; text-align: left; vertical-align: top; }
        th { background: #eee; }
        h1 { font-size: 14px; text-align: center; margin: 4px 0; }
        p.meta { text-align: center; margin: 2px 0 8px; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      </style>
      </head><body>
      <h1>PCPNDT Form F Register</h1>
      <p class="meta">${MONTH_NAMES[month - 1]} ${year} — ${all.length} record(s), generated ${esc(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}</p>
      <table>
        <thead><tr>
          <th>Sl</th><th>Date</th><th>Patient</th><th>Husband/Father</th><th>Address</th><th>Referred By</th>
          <th>Form F Tests</th><th>GA</th><th>Result</th><th>Consent/Proc. Date</th><th>Bill</th><th>Status</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <script>window.onload=()=>{window.print();window.close();}<\/script>
      </body></html>`);
    w.document.close();
  }

  const rows = data?.rows ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="formf-monthly-register">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen size={15} className="text-blue-600" />
        <span className="text-sm font-semibold">Monthly PCPNDT Register</span>
        <select value={month} onChange={(e) => { setPage(1); setMonth(Number(e.target.value)); }} className="h-8 text-xs border rounded-md px-2 bg-white">
          {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
        </select>
        <select value={year} onChange={(e) => { setPage(1); setYear(Number(e.target.value)); }} className="h-8 text-xs border rounded-md px-2 bg-white">
          {Array.from({ length: 6 }, (_, i) => now.getUTCFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={`mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={downloadCsv} disabled={exporting || loading}>
            <Download size={12} className="mr-1" /> {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={printRegister} disabled={loading || rows.length === 0}>
            <Printer size={12} className="mr-1" /> Print Register
          </Button>
        </div>
      </div>

      {data && data.incompleteCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          <AlertTriangle size={12} />
          {data.incompleteCount} record{data.incompleteCount > 1 ? "s" : ""} in this month{" "}
          {data.incompleteCount > 1 ? "are" : "is"} incomplete — shown below with the missing fields, never omitted from the register.
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground p-4 text-center">Loading register…</p>
      ) : error ? (
        <div className="text-xs p-4 text-center space-y-2" data-testid="formf-register-error">
          <p className="text-destructive flex items-center justify-center gap-1"><AlertTriangle size={12} /> {error}</p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={load}>Retry</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground p-4 text-center">
          No Form F records in {MONTH_NAMES[month - 1]} {year}.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto border rounded-lg bg-white">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="px-2 py-1.5 text-left">Sl</th>
                  <th className="px-2 py-1.5 text-left">Date</th>
                  <th className="px-2 py-1.5 text-left">Patient</th>
                  <th className="px-2 py-1.5 text-left">Husband/Father</th>
                  <th className="px-2 py-1.5 text-left">Referred By</th>
                  <th className="px-2 py-1.5 text-left">Form F Tests</th>
                  <th className="px-2 py-1.5 text-left">GA</th>
                  <th className="px-2 py-1.5 text-left">Result</th>
                  <th className="px-2 py-1.5 text-left">Bill</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.recordId} className="border-t align-top">
                    <td className="px-2 py-1.5">{r.serial}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.formDate || r.createdAtIst.slice(0, 10)}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{r.patientName || "—"}</div>
                      <div className="text-[10px] text-muted-foreground">{[r.age && `${r.age}y`, r.mobile].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-2 py-1.5">{r.husbandFatherName || "—"}</td>
                    <td className="px-2 py-1.5">{r.referredBy || "—"}</td>
                    <td className="px-2 py-1.5">{r.linkedTests.length ? r.linkedTests.join(", ") : (r.procedure || "—")}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.gestationalAge || "—"}</td>
                    <td className="px-2 py-1.5">
                      {r.ultrasoundResult || "—"}
                      {r.abnormality ? <div className="text-[10px] text-rose-700">{r.abnormality}</div> : null}
                    </td>
                    <td className="px-2 py-1.5">{r.billNumber || "—"}</td>
                    <td className="px-2 py-1.5">
                      {r.completionStatus === "complete" ? (
                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">Complete</Badge>
                      ) : (
                        <div>
                          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]">Incomplete</Badge>
                          <ul className="mt-0.5 text-[10px] text-amber-700 list-disc pl-3">
                            {r.missingFields.map((f) => <li key={f}>{f}</li>)}
                          </ul>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {data?.pagination.total} record{(data?.pagination.total ?? 0) === 1 ? "" : "s"} in {MONTH_NAMES[month - 1]} {year}
            </span>
            {totalPages > 1 && (
              <span className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                Page {page} / {totalPages}
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Print and Export CSV both cover the complete statutory month regardless of pagination (the CSV export is audit-logged).
          </p>
        </>
      )}
    </div>
  );
}
