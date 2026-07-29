/**
 * Referral Register — flat spreadsheet-style report matching the clinic's
 * paper/Excel layout:
 *   DATE | PATIENT'S NAME | TEST NAME | AMOUNT | REF. BY DOCTOR
 *
 * Built from the same billed-only commission API as the Referral Report so
 * unbilled duplicates never appear. Filters: date range, referring doctor,
 * test name (search + pick-list), patient search. Views: flat list or
 * doctor-wise with subtotals. Export: Excel / CSV / Print.
 */

import { useMemo, useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Printer, Download, FileSpreadsheet, Stethoscope, Users, IndianRupee, Filter, List, Layers,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";
import { saveAs } from "file-saver";

type SaDoctor = { id: number; name: string };

type ApiPatientRow = {
  date: string;
  patientName: string;
  patientPid: string;
  testId: number;
  testName: string;
  category: string;
  price: number;
  billNumber: string;
  orderNumber: string;
};

type ApiDoctorBlock = {
  doctor: { id: number; name: string; specialization?: string | null };
  rows: ApiPatientRow[];
  totalRevenue: number;
  orderCount: number;
  testCount: number;
};

type ReportData = {
  report: ApiDoctorBlock[];
  grandTotal: { doctors: number; orders: number; revenue: number };
};

type FlatRow = {
  date: string;          // YYYY-MM-DD from API
  patientName: string;
  testName: string;
  amount: number;
  doctorId: number;
  doctorName: string;
  billNumber: string;
  orderNumber: string;
  category: string;
  testId: number;
};

type ViewMode = "flat" | "by-doctor";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function firstOfMonthISO() {
  const d = new Date();
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** DD/MM/YYYY — matches the clinic spreadsheet. */
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function inr(n: number) {
  return "₹ " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReferralRegister({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const [from, setFrom] = useState(firstOfMonthISO);
  const [to, setTo] = useState(todayISO);
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [testFilter, setTestFilter] = useState<string>("all");
  const [testSearch, setTestSearch] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [view, setView] = useState<ViewMode>("flat");

  const { data: doctorsData } = useQuery({
    queryKey: ["/api/super-admin/doctors-list"],
    queryFn: async () => {
      const res = await fetch("/api/super-admin/doctors-list", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load doctors");
      return res.json() as Promise<{ doctors: SaDoctor[] }>;
    },
  });
  const doctors = doctorsData?.doctors ?? [];

  // Same billed-only endpoint as Referral Report — unbilled duplicates excluded server-side.
  const { data, isLoading, error } = useQuery<ReportData>({
    queryKey: ["/api/commission/report-by-patient", "register", from, to, doctorId],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      if (doctorId != null) params.set("doctorId", String(doctorId));
      const res = await fetch(`/api/commission/report-by-patient?${params}`, { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load register");
      return res.json();
    },
  });

  useEffect(() => {
    if (error) toast({ title: "Failed to load register", description: String(error), variant: "destructive" });
  }, [error, toast]);

  const flatRows: FlatRow[] = useMemo(() => {
    const out: FlatRow[] = [];
    for (const block of data?.report ?? []) {
      for (const r of block.rows) {
        out.push({
          date: r.date,
          patientName: r.patientName,
          testName: r.testName,
          amount: r.price,
          doctorId: block.doctor.id,
          doctorName: block.doctor.name,
          billNumber: r.billNumber,
          orderNumber: r.orderNumber,
          category: r.category,
          testId: r.testId,
        });
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || a.patientName.localeCompare(b.patientName));
    return out;
  }, [data]);

  const testOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of flatRows) map.set(r.testId, r.testName);
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [flatRows]);

  const filtered = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    const tq = testSearch.trim().toLowerCase();
    return flatRows.filter((r) => {
      if (testFilter !== "all" && String(r.testId) !== testFilter) return false;
      if (tq && !r.testName.toLowerCase().includes(tq)) return false;
      if (q && !r.patientName.toLowerCase().includes(q) && !r.billNumber.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [flatRows, testFilter, testSearch, patientSearch]);

  const totals = useMemo(() => {
    const amount = filtered.reduce((s, r) => s + r.amount, 0);
    const doctorsN = new Set(filtered.map((r) => r.doctorId)).size;
    const testsN = filtered.length;
    return { amount, doctorsN, testsN };
  }, [filtered]);

  const byDoctor = useMemo(() => {
    const map = new Map<number, { doctorName: string; rows: FlatRow[]; amount: number }>();
    for (const r of filtered) {
      let g = map.get(r.doctorId);
      if (!g) {
        g = { doctorName: r.doctorName, rows: [], amount: 0 };
        map.set(r.doctorId, g);
      }
      g.rows.push(r);
      g.amount += r.amount;
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount || a.doctorName.localeCompare(b.doctorName));
  }, [filtered]);

  const exportCsv = () => {
    const header = ["DATE", "PATIENT'S NAME", "TEST NAME", "AMOUNT", "REF. BY DOCTOR"];
    const lines = [
      header.join(","),
      ...filtered.map((r) =>
        [fmtDate(r.date), r.patientName, r.testName, r.amount.toFixed(2), r.doctorName]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    saveAs(blob, `referral-register_${from}_to_${to}.csv`);
  };

  const exportExcel = async () => {
    type Cell = {
      value?: string | number | null;
      type?: typeof String | typeof Number;
      fontWeight?: "bold";
      align?: "left" | "center" | "right";
      backgroundColor?: string;
    } | null;
    const header: Cell[] = [
      { value: "DATE", fontWeight: "bold", backgroundColor: "#E5E7EB" },
      { value: "PATIENT'S NAME", fontWeight: "bold", backgroundColor: "#E5E7EB" },
      { value: "TEST NAME", fontWeight: "bold", backgroundColor: "#E5E7EB" },
      { value: "AMOUNT", fontWeight: "bold", backgroundColor: "#E5E7EB", align: "right" },
      { value: "REF. BY DOCTOR", fontWeight: "bold", backgroundColor: "#E5E7EB" },
    ];
    const rows: Cell[][] = [
      [{ value: "Referral Register", fontWeight: "bold" }, null, null, null, null],
      [{ value: `Period: ${fmtDate(from)} to ${fmtDate(to)}` }, null, null, null, null],
      [null, null, null, null, null],
      header,
    ];
    if (view === "by-doctor") {
      for (const g of byDoctor) {
        rows.push([
          { value: g.doctorName, fontWeight: "bold", backgroundColor: "#FEF3C7" },
          null, null,
          { value: g.amount, type: Number, fontWeight: "bold", align: "right", backgroundColor: "#FEF3C7" },
          { value: `${g.rows.length} test(s)`, backgroundColor: "#FEF3C7" },
        ]);
        for (const r of g.rows) {
          rows.push([
            { value: fmtDate(r.date), type: String },
            { value: r.patientName, type: String },
            { value: r.testName, type: String },
            { value: r.amount, type: Number, align: "right" },
            { value: r.doctorName, type: String },
          ]);
        }
      }
    } else {
      for (const r of filtered) {
        rows.push([
          { value: fmtDate(r.date), type: String },
          { value: r.patientName, type: String },
          { value: r.testName, type: String },
          { value: r.amount, type: Number, align: "right" },
          { value: r.doctorName, type: String },
        ]);
      }
    }
    rows.push([null, null, null, null, null]);
    rows.push([
      { value: "TOTAL", fontWeight: "bold" },
      { value: `${totals.testsN} tests · ${totals.doctorsN} doctors`, fontWeight: "bold" },
      null,
      { value: totals.amount, type: Number, fontWeight: "bold", align: "right" },
      null,
    ]);

    const writeXlsxFile = (await import("write-excel-file/browser")).default as unknown as (
      sheets: Array<{ data: Cell[][]; sheet?: string; columns?: { width: number }[] }>,
    ) => { toBlob: () => Promise<Blob> };
    const blob = await writeXlsxFile([
      {
        data: rows,
        sheet: "Referral Register",
        columns: [{ width: 12 }, { width: 28 }, { width: 28 }, { width: 14 }, { width: 24 }],
      },
    ]).toBlob();
    saveAs(blob, `referral-register_${from}_to_${to}.xlsx`);
  };

  const printRegister = () => {
    const bodyRows =
      view === "by-doctor"
        ? byDoctor
            .map((g) => {
              const head = `<tr class="grp"><td colspan="4"><strong>${escapeHtml(g.doctorName)}</strong></td><td class="right"><strong>${inr(g.amount)}</strong></td></tr>`;
              const lines = g.rows
                .map(
                  (r) =>
                    `<tr><td>${fmtDate(r.date)}</td><td>${escapeHtml(r.patientName)}</td><td>${escapeHtml(r.testName)}</td><td class="right">${inr(r.amount)}</td><td>${escapeHtml(r.doctorName)}</td></tr>`,
                )
                .join("");
              return head + lines;
            })
            .join("")
        : filtered
            .map(
              (r) =>
                `<tr><td>${fmtDate(r.date)}</td><td>${escapeHtml(r.patientName)}</td><td>${escapeHtml(r.testName)}</td><td class="right">${inr(r.amount)}</td><td>${escapeHtml(r.doctorName)}</td></tr>`,
            )
            .join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Referral Register</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:16px}
  h1{font-size:16px;margin:0 0 4px}
  .meta{color:#555;margin-bottom:12px}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #333;padding:4px 6px;text-align:left}
  th{background:#eee;font-weight:bold;text-transform:uppercase;font-size:11px}
  td.right,th.right{text-align:right}
  tr.grp td{background:#fef3c7}
  tfoot td{font-weight:bold;background:#f3f4f6}
  @media print{body{margin:8px}}
</style></head><body>
<h1>Referral Register</h1>
<div class="meta">Period: ${fmtDate(from)} to ${fmtDate(to)}${doctorId != null ? ` · Doctor: ${escapeHtml(doctors.find((d) => d.id === doctorId)?.name ?? "")}` : ""}</div>
<table>
<thead><tr><th>Date</th><th>Patient's Name</th><th>Test Name</th><th class="right">Amount</th><th>Ref. By Doctor</th></tr></thead>
<tbody>${bodyRows || `<tr><td colspan="5">No rows</td></tr>`}</tbody>
<tfoot><tr><td colspan="3">Total — ${totals.testsN} tests · ${totals.doctorsN} doctors</td><td class="right">${inr(totals.amount)}</td><td></td></tr></tfoot>
</table>
</body></html>`;
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to print the register.", variant: "destructive" });
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={16} className="mr-1" /> Back</Button>
          <div>
            <h1 className="text-lg font-bold">Referral Register</h1>
            <p className="text-xs text-muted-foreground">
              Spreadsheet-style referral list — Date · Patient · Test · Amount · Ref. Doctor. Billed orders only.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Filter size={13} /> Filters
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Referring doctor</Label>
              <Select
                value={doctorId == null ? "all" : String(doctorId)}
                onValueChange={(v) => setDoctorId(v === "all" ? null : Number(v))}
              >
                <SelectTrigger><SelectValue placeholder="All doctors" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All doctors</SelectItem>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Test (pick list)</Label>
              <Select value={testFilter} onValueChange={setTestFilter}>
                <SelectTrigger><SelectValue placeholder="All tests" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tests</SelectItem>
                  {testOptions.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Test name contains</Label>
              <Input placeholder="e.g. MRI, USG, X-RAY" value={testSearch} onChange={(e) => setTestSearch(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Patient / bill search</Label>
              <Input placeholder="Patient name or bill no" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">View</Label>
              <div className="flex gap-2 mt-1">
                <Button type="button" size="sm" variant={view === "flat" ? "default" : "outline"} onClick={() => setView("flat")}>
                  <List size={13} className="mr-1" /> Flat list
                </Button>
                <Button type="button" size="sm" variant={view === "by-doctor" ? "default" : "outline"} onClick={() => setView("by-doctor")}>
                  <Layers size={13} className="mr-1" /> Doctor-wise
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Summary + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <Stat icon={<Users size={14} />} label="Tests" value={String(totals.testsN)} />
            <Stat icon={<Stethoscope size={14} />} label="Doctors" value={String(totals.doctorsN)} />
            <Stat icon={<IndianRupee size={14} />} label="Total amount" value={inr(totals.amount)} amber />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={printRegister} disabled={!filtered.length}>
              <Printer size={14} className="mr-1.5" /> Print
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
              <Download size={14} className="mr-1.5" /> CSV
            </Button>
            <Button size="sm" onClick={() => void exportExcel()} disabled={!filtered.length}>
              <FileSpreadsheet size={14} className="mr-1.5" /> Excel
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-10 text-center text-muted-foreground text-sm">Loading register…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">No billed referrals for these filters.</div>
          ) : view === "by-doctor" ? (
            <div className="divide-y divide-border">
              {byDoctor.map((g) => (
                <div key={g.doctorName}>
                  <div className="flex items-center justify-between px-4 py-2.5 bg-amber-500/10">
                    <p className="font-semibold text-sm">{g.doctorName}</p>
                    <p className="text-sm font-bold text-amber-700 tabular-nums">{inr(g.amount)} · {g.rows.length} tests</p>
                  </div>
                  <RegisterTable rows={g.rows} />
                </div>
              ))}
            </div>
          ) : (
            <RegisterTable rows={filtered} />
          )}
          {filtered.length > 0 && (
            <div className="flex justify-between px-4 py-3 border-t border-border bg-muted/30 text-sm font-semibold">
              <span>Total — {totals.testsN} tests · {totals.doctorsN} doctors</span>
              <span className="text-amber-700 tabular-nums">{inr(totals.amount)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, amber }: { icon: ReactNode; label: string; value: string; amber?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 min-w-[110px]">
      <div className="flex items-center gap-1.5 text-muted-foreground text-[11px] mb-0.5">{icon}{label}</div>
      <p className={`text-sm font-bold tabular-nums ${amber ? "text-amber-700" : ""}`}>{value}</p>
    </div>
  );
}

function RegisterTable({ rows }: { rows: FlatRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Date</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Patient&apos;s Name</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Test Name</th>
            <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Amount</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Ref. By Doctor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.date}-${r.orderNumber}-${r.testId}-${i}`} className={`border-b border-border/50 ${i % 2 ? "bg-muted/10" : ""}`}>
              <td className="px-4 py-2 whitespace-nowrap tabular-nums text-muted-foreground">{fmtDate(r.date)}</td>
              <td className="px-4 py-2 font-medium uppercase">{r.patientName}</td>
              <td className="px-4 py-2">{r.testName}</td>
              <td className="px-4 py-2 text-right tabular-nums font-medium">{inr(r.amount)}</td>
              <td className="px-4 py-2 uppercase text-muted-foreground">{r.doctorName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
