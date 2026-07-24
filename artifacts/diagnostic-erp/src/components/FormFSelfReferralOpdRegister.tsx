import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Printer, RefreshCw, Stethoscope } from "lucide-react";

/**
 * FormFSelfReferralOpdRegister — the separate obstetrical-checkup record
 * required for SELF-REFERRED pregnant women (PCPNDT: a sonologist may scan a
 * self-referred PW only when she was examined in the sonologist's own OPD —
 * "referred by the patient/relative" is not a lawful referral).
 *
 * Renders the month's self-referral/walk-in Form F patients as a Form 25
 * (formerly 3C) daily case register replica — same six columns as the
 * accounting Form3C component — with the nature of service prefilled
 * ("General Obstetrical Checkup"), the examining doctor recorded, and the
 * professional charges complimentary. Kept beside the Rule 9(1) register in
 * the Form F module; management-only (the API is requireAdminRole-gated).
 */

interface OpdRow {
  date: string;
  serial: number;
  patientName: string;
  spouseFather: string;
  natureOfService: string;
  feesReceived: string;
  dateOfReceipt: string;
  recordId: number;
  mobile: string;
  gestationalAge: string;
  prescriptionId: number | null;
  prescriptionSignedAt: string | null;
}

interface Prescription {
  id: number;
  formFRecordId: number;
  patientName: string;
  spouseFather: string;
  age: string;
  prescriptionDate: string;
  adviceText: string;
  doctorName: string;
  doctorQualifications: string;
  doctorRegistrationNo: string;
  signatureImageDataUrl: string | null;
  contentHash: string;
  signedAt: string;
}

interface ClinicBranding {
  clinicName?: string | null;
  address?: string | null;
  registrationNo?: string | null;
  phone?: string | null;
}

interface OpdResponse {
  month: number;
  year: number;
  doctor: string;
  natureOfService: string;
  fees: string;
  rows: OpdRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function istNow(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

export default function FormFSelfReferralOpdRegister() {
  const { toast } = useToast();
  const now = istNow();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OpdResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<OpdResponse>(`/api/form-f/register/self-referral-opd?month=${month}&year=${year}&page=${page}&pageSize=50`);
      setData(res);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load the OPD register");
    } finally {
      setLoading(false);
    }
  }, [month, year, page]);

  useEffect(() => { load(); }, [load]);

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  async function printPrescription(row: OpdRow) {
    let rx: Prescription;
    let clinic: ClinicBranding = {};
    try {
      const res = await api.get<{ prescription: Prescription }>(`/api/form-f/register/self-referral-opd/prescription/${row.recordId}`);
      rx = res.prescription;
      clinic = await api.get<ClinicBranding>("/api/clinic-settings/branding").catch(() => ({}));
    } catch (e) {
      toast({ variant: "destructive", title: "Prescription unavailable", description: e instanceof Error ? e.message : "Reload the register and retry." });
      return;
    }

    const signedIst = rx.signedAt
      ? new Date(rx.signedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "";
    const adviceHtml = rx.adviceText.split("\n").map((l) => `<p class="advice">${esc(l)}</p>`).join("");

    const w = window.open("", "_blank", "width=820,height=750");
    // Blocked pop-up → the Rx button silently did nothing. Say so.
    if (!w) { toast({ variant: "destructive", title: "Print window blocked", description: "Your browser blocked the prescription window. Allow pop-ups for this site, then print again." }); return; }
    w.document.write(`
      <!DOCTYPE html><html><head>
      <title>Prescription — ${esc(rx.patientName)}</title>
      <style>
        @page { size: A5; margin: 10mm; }
        body { margin: 0; font-family: 'Times New Roman', Times, serif; font-size: 12px; color: #000; }
        .head { text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; }
        .head h1 { font-size: 16px; margin: 0; }
        .head p { margin: 1px 0; font-size: 10px; }
        .doc { margin-top: 6px; font-size: 12px; font-weight: 700; }
        .doc small { font-weight: 400; }
        .pt { margin: 10px 0 4px; border: 1px solid #999; padding: 6px 8px; font-size: 11px; }
        .rx { font-size: 20px; font-weight: 700; margin: 8px 0 2px; }
        .advice { font-size: 13px; margin: 4px 0; }
        .sig { margin-top: 34px; text-align: right; }
        .sig img { max-height: 52px; max-width: 180px; display: inline-block; }
        .sig .name { font-weight: 700; }
        .digital { margin-top: 10px; font-size: 8.5px; color: #333; border-top: 1px dashed #999; padding-top: 4px; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      </style>
      </head><body>
      <div class="head">
        ${clinic.clinicName ? `<h1>${esc(clinic.clinicName)}</h1>` : ""}
        ${clinic.address ? `<p>${esc(clinic.address)}</p>` : ""}
        ${clinic.registrationNo ? `<p>Regn. No.: ${esc(clinic.registrationNo)}</p>` : ""}
        <div class="doc">${esc(rx.doctorName)}, <small>${esc(rx.doctorQualifications)}</small>
          ${rx.doctorRegistrationNo ? `<small> · Reg. No. ${esc(rx.doctorRegistrationNo)}</small>` : ""}</div>
      </div>
      <div class="pt">
        <b>Patient:</b> ${esc(rx.patientName)}${rx.age ? ` (${esc(rx.age)} y)` : ""}
        ${rx.spouseFather ? ` &nbsp;·&nbsp; <b>Spouse/Father:</b> ${esc(rx.spouseFather)}` : ""}
        &nbsp;·&nbsp; <b>Date:</b> ${esc(rx.prescriptionDate)}
        &nbsp;·&nbsp; <b>OPD:</b> Self-referral / walk-in
      </div>
      <div class="rx">℞</div>
      ${adviceHtml}
      <div class="sig">
        ${rx.signatureImageDataUrl ? `<img src="${rx.signatureImageDataUrl}" alt="signature"/><br/>` : ""}
        <span class="name">${esc(rx.doctorName)}</span><br/>
        <span>${esc(rx.doctorQualifications)}</span>
      </div>
      <div class="digital">
        Digitally signed by ${esc(rx.doctorName)} on ${esc(signedIst)} (IST) · Auto-generated with the self-referral
        obstetrical checkup · Integrity SHA-256: ${esc(rx.contentHash.slice(0, 16))}…
      </div>
      <script>window.onload=()=>{window.print();window.close();}<\/script>
      </body></html>`);
    w.document.close();
  }

  async function printRegister() {
    // The physical register must cover the complete month — fetch every page.
    let all: OpdRow[] = [];
    let doctor = data?.doctor ?? "";
    try {
      let p = 1;
      let totalPagesToFetch = 1;
      do {
        const res = await api.get<OpdResponse>(`/api/form-f/register/self-referral-opd?month=${month}&year=${year}&page=${p}&pageSize=500`);
        all = all.concat(res.rows);
        doctor = res.doctor;
        totalPagesToFetch = res.pagination.totalPages;
        p += 1;
      } while (p <= totalPagesToFetch && p <= 20);
    } catch (e) {
      toast({ variant: "destructive", title: "Print failed", description: e instanceof Error ? e.message : "Could not load the full month" });
      return;
    }

    const bodyRows = all.map((r) => `
      <tr>
        <td>${esc(r.date)}</td>
        <td style="text-align:center">${r.serial}</td>
        <td>${esc(r.patientName)}${r.spouseFather ? `<br/><small>Spouse/Father: ${esc(r.spouseFather)}</small>` : ""}</td>
        <td>${esc(r.natureOfService)}${r.gestationalAge ? ` <small>(GA ${esc(r.gestationalAge)})</small>` : ""}</td>
        <td style="text-align:center">${esc(r.feesReceived)}</td>
        <td style="text-align:center">${esc(r.dateOfReceipt)}</td>
      </tr>`).join("");

    const w = window.open("", "_blank", "width=1000,height=750");
    // Blocked pop-up → the Print Register button silently did nothing. Say so.
    if (!w) { toast({ variant: "destructive", title: "Print window blocked", description: "Your browser blocked the print window. Allow pop-ups for this site, then print again." }); return; }
    w.document.write(`
      <!DOCTYPE html><html><head>
      <title>Self-Referral OPD Register — ${MONTH_NAMES[month - 1]} ${year}</title>
      <style>
        @page { size: A4; margin: 10mm; }
        body { margin: 0; font-family: 'Times New Roman', Times, serif; font-size: 11px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; vertical-align: top; }
        th { background: #f5f5f5; text-align: center; }
        h1 { font-size: 15px; text-align: center; margin: 4px 0 0; }
        h2 { font-size: 13px; text-align: center; margin: 2px 0; font-weight: 700; }
        p.meta { text-align: center; margin: 3px 0 8px; font-size: 10px; }
        p.note { font-size: 9px; text-align: center; margin: 2px 0 6px; }
        .sig { margin-top: 26px; font-size: 10px; display: flex; justify-content: space-between; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      </style>
      </head><body>
      <h1>FORM 25 (Formerly 3C) (Income-tax Act, 2025)</h1>
      <h2>Daily case register — Obstetrical checkup of self-referred / walk-in pregnant women</h2>
      <p class="note">[Separate obstetrical-checkup record of pregnant women examined in the clinic's OPD prior to self-referral ultrasonography — maintained alongside the Form F (Rule 9(1)) register]</p>
      <p class="meta">${MONTH_NAMES[month - 1]} ${year} — ${all.length} record(s) · Obstetrical checkup by: <b>${esc(doctor)}</b> · Professional charges: Complimentary / Free</p>
      <table>
        <thead>
          <tr>
            <th style="width:11%">Date</th>
            <th style="width:7%">Sl. No.</th>
            <th style="width:30%">Patient's name</th>
            <th style="width:26%">Nature of professional services rendered</th>
            <th style="width:14%">Fees received</th>
            <th style="width:12%">Date of receipt</th>
          </tr>
          <tr>
            <th><i>(1)</i></th><th><i>(2)</i></th><th><i>(3)</i></th><th><i>(4)</i></th><th><i>(5)</i></th><th><i>(6)</i></th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
        ${all.length > 0 ? `<tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">Total</td><td style="text-align:center;font-weight:700">₹ 0.00 (Complimentary)</td><td></td></tr></tfoot>` : ""}
      </table>
      <div class="sig">
        <div>Place: ____________________</div>
        <div>Signature of practitioner (${esc(doctor)}): ____________________</div>
      </div>
      <script>window.onload=()=>{window.print();window.close();}<\/script>
      </body></html>`);
    w.document.close();
  }

  const rows = data?.rows ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="formf-selfref-opd-register">
      <div className="flex flex-wrap items-center gap-2">
        <Stethoscope size={15} className="text-blue-600" />
        <span className="text-sm font-semibold">Self-Referral OPD Register</span>
        <select value={month} onChange={(e) => { setPage(1); setMonth(Number(e.target.value)); }} className="h-8 text-xs border rounded-md px-2 bg-white">
          {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
        </select>
        <select value={year} onChange={(e) => { setPage(1); setYear(Number(e.target.value)); }} className="h-8 text-xs border rounded-md px-2 bg-white">
          {Array.from({ length: 6 }, (_, i) => now.getUTCFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={`mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <div className="ml-auto">
          <Button size="sm" className="h-8 text-xs" onClick={printRegister} disabled={loading || rows.length === 0}>
            <Printer size={12} className="mr-1" /> Print Register
          </Button>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5">
        Separate obstetrical-checkup record of <b>self-referred / walk-in</b> Form F test patients examined in OPD by{" "}
        <b>{data?.doctor ?? "Dr. Sugandha Priyadarshini"}</b> before self-referral ultrasonography — professional charges{" "}
        <b>Complimentary / Free</b>. Doctor-referred patients go to the Monthly (Rule 9(1)) Register instead. An advice
        prescription is <b>auto-generated and digitally signed</b> for every patient listed here (Rx button prints it).
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground p-4 text-center">Loading register…</p>
      ) : error ? (
        <div className="text-xs p-4 text-center space-y-2" data-testid="formf-selfref-opd-error">
          <p className="text-destructive flex items-center justify-center gap-1"><AlertTriangle size={12} /> {error}</p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={load}>Retry</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground p-4 text-center">
          No self-referred / walk-in Form F patients in {MONTH_NAMES[month - 1]} {year}.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto border rounded-lg bg-white">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="px-2 py-1.5 text-left">Date</th>
                  <th className="px-2 py-1.5 text-left">Sl. No.</th>
                  <th className="px-2 py-1.5 text-left">Patient&apos;s name</th>
                  <th className="px-2 py-1.5 text-left">Nature of professional services</th>
                  <th className="px-2 py-1.5 text-left">Fees received</th>
                  <th className="px-2 py-1.5 text-left">Date of receipt</th>
                  <th className="px-2 py-1.5 text-left">Prescription</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.recordId} className="border-t align-top">
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.date || "—"}</td>
                    <td className="px-2 py-1.5">{r.serial}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{r.patientName || "—"}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.spouseFather ? `Spouse/Father: ${r.spouseFather}` : ""}
                        {r.mobile ? `${r.spouseFather ? " · " : ""}Ph: ${r.mobile}` : ""}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      {r.natureOfService}
                      {r.gestationalAge ? <span className="text-[10px] text-muted-foreground"> (GA {r.gestationalAge})</span> : null}
                    </td>
                    <td className="px-2 py-1.5">{r.feesReceived}</td>
                    <td className="px-2 py-1.5">{r.dateOfReceipt}</td>
                    <td className="px-2 py-1.5">
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => printPrescription(r)} data-testid={`print-rx-${r.recordId}`}>
                        <Printer size={10} className="mr-1" /> Rx
                      </Button>
                      {r.prescriptionSignedAt && (
                        <div className="text-[9px] text-emerald-700 mt-0.5">
                          Signed {new Date(r.prescriptionSignedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" })}
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
              {data?.pagination.total} self-referred patient{(data?.pagination.total ?? 0) === 1 ? "" : "s"} in {MONTH_NAMES[month - 1]} {year}
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
            Print reproduces the Form 25 (formerly 3C) daily case register for the complete month, containing only these self-referral/walk-in patients.
          </p>
        </>
      )}
    </div>
  );
}
