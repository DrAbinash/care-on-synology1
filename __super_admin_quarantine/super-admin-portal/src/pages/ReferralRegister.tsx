/**
 * Referral Register — spreadsheet-style report:
 *   DATE | PATIENT'S NAME | TEST NAME | AMOUNT | REF. BY DOCTOR
 *
 * Enhancements:
 *  - Category / modality filter (USG, MRI, CT, X-Ray, Other)
 *  - Month presets (This month / Last month / Custom)
 *  - Flat · Doctor-wise · Compare months views
 *  - WhatsApp / Email send for one (or more) doctors' register
 *  - Billed, non-cancelled orders only (server-side)
 */

import { useMemo, useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Printer, Download, FileSpreadsheet, Stethoscope, Users, IndianRupee,
  Filter, List, Layers, GitCompare, MessageCircle, Send, Check,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";
import { classifyModality, type ReferralModality } from "@/lib/referralModality";
import { saveAs } from "file-saver";

type SaDoctor = { id: number; name: string; phone?: string | null; email?: string | null };

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
  date: string;
  patientName: string;
  testName: string;
  amount: number;
  doctorId: number;
  doctorName: string;
  billNumber: string;
  orderNumber: string;
  category: string;
  modality: ReferralModality;
  testId: number;
};

type ViewMode = "flat" | "by-doctor" | "compare";
type MonthPreset = "this-month" | "last-month" | "custom";

const MODALITIES: ReferralModality[] = ["USG", "MRI", "CT", "X-Ray", "Other"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthRange(offsetMonths: number): { from: string; to: string } {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return { from, to };
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function inr(n: number) {
  return "₹ " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function flattenReport(data: ReportData | undefined): FlatRow[] {
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
        modality: classifyModality(r.category, r.testName),
        testId: r.testId,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.patientName.localeCompare(b.patientName));
  return out;
}

function applyClientFilters(
  rows: FlatRow[],
  opts: { testFilter: string; testSearch: string; patientSearch: string; modality: string },
): FlatRow[] {
  const q = opts.patientSearch.trim().toLowerCase();
  const tq = opts.testSearch.trim().toLowerCase();
  return rows.filter((r) => {
    if (opts.modality !== "all" && r.modality !== opts.modality) return false;
    if (opts.testFilter !== "all" && String(r.testId) !== opts.testFilter) return false;
    if (tq && !r.testName.toLowerCase().includes(tq) && !r.category.toLowerCase().includes(tq)) return false;
    if (q && !r.patientName.toLowerCase().includes(q) && !r.billNumber.toLowerCase().includes(q)) return false;
    return true;
  });
}

type SendResult = {
  doctorId: number;
  doctorName: string;
  phone: string | null;
  email: string | null;
  amount: number;
  testCount: number;
  message: string;
  whatsapp?: { ok: boolean; skipped?: boolean; error?: string };
  emailResult?: { ok: boolean; skipped?: boolean; error?: string };
};

export default function ReferralRegister({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const thisMonth = monthRange(0);
  const [preset, setPreset] = useState<MonthPreset>("this-month");
  const [from, setFrom] = useState(thisMonth.from);
  const [to, setTo] = useState(todayISO());
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [testFilter, setTestFilter] = useState<string>("all");
  const [testSearch, setTestSearch] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [modality, setModality] = useState<string>("all");
  const [view, setView] = useState<ViewMode>("flat");

  // Compare-months: previous calendar month vs current period's month
  const compareA = monthRange(-1);
  const compareB = monthRange(0);

  const applyPreset = (p: MonthPreset) => {
    setPreset(p);
    if (p === "this-month") {
      const r = monthRange(0);
      setFrom(r.from);
      setTo(todayISO());
    } else if (p === "last-month") {
      const r = monthRange(-1);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const { data: doctorsData } = useQuery({
    queryKey: ["/api/super-admin/doctors-list"],
    queryFn: async () => {
      const res = await fetch("/api/super-admin/doctors-list", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load doctors");
      return res.json() as Promise<{ doctors: SaDoctor[] }>;
    },
  });
  const doctors = doctorsData?.doctors ?? [];

  const { data, isLoading, error } = useQuery<ReportData>({
    queryKey: ["/api/commission/report-by-patient", "register", from, to, doctorId],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      if (doctorId != null) params.set("doctorId", String(doctorId));
      const res = await fetch(`/api/commission/report-by-patient?${params}`, { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load register");
      return res.json();
    },
    enabled: view !== "compare",
  });

  const { data: dataA, isLoading: loadingA } = useQuery<ReportData>({
    queryKey: ["/api/commission/report-by-patient", "register-cmp-a", compareA.from, compareA.to, doctorId],
    queryFn: async () => {
      const params = new URLSearchParams({ from: compareA.from, to: compareA.to });
      if (doctorId != null) params.set("doctorId", String(doctorId));
      const res = await fetch(`/api/commission/report-by-patient?${params}`, { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load last month");
      return res.json();
    },
    enabled: view === "compare",
  });

  const { data: dataB, isLoading: loadingB } = useQuery<ReportData>({
    queryKey: ["/api/commission/report-by-patient", "register-cmp-b", compareB.from, compareB.to, doctorId],
    queryFn: async () => {
      const params = new URLSearchParams({ from: compareB.from, to: compareB.to });
      if (doctorId != null) params.set("doctorId", String(doctorId));
      const res = await fetch(`/api/commission/report-by-patient?${params}`, { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load this month");
      return res.json();
    },
    enabled: view === "compare",
  });

  useEffect(() => {
    if (error) toast({ title: "Failed to load register", description: String(error), variant: "destructive" });
  }, [error, toast]);

  const filterOpts = { testFilter, testSearch, patientSearch, modality };

  const flatRows = useMemo(() => flattenReport(data), [data]);
  const filtered = useMemo(() => applyClientFilters(flatRows, filterOpts), [flatRows, testFilter, testSearch, patientSearch, modality]);

  const rowsA = useMemo(() => applyClientFilters(flattenReport(dataA), filterOpts), [dataA, testFilter, testSearch, patientSearch, modality]);
  const rowsB = useMemo(() => applyClientFilters(flattenReport(dataB), filterOpts), [dataB, testFilter, testSearch, patientSearch, modality]);

  const testOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of flatRows.length ? flatRows : [...rowsA, ...rowsB]) map.set(r.testId, r.testName);
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [flatRows, rowsA, rowsB]);

  const modalityCounts = useMemo(() => {
    const src = view === "compare" ? [...rowsA, ...rowsB] : flatRows;
    const c: Record<string, number> = { all: src.length };
    for (const m of MODALITIES) c[m] = 0;
    for (const r of src) c[r.modality] = (c[r.modality] ?? 0) + 1;
    return c;
  }, [flatRows, rowsA, rowsB, view]);

  const totals = useMemo(() => {
    const amount = filtered.reduce((s, r) => s + r.amount, 0);
    return { amount, doctorsN: new Set(filtered.map((r) => r.doctorId)).size, testsN: filtered.length };
  }, [filtered]);

  const byDoctor = useMemo(() => {
    const map = new Map<number, { doctorId: number; doctorName: string; rows: FlatRow[]; amount: number }>();
    for (const r of filtered) {
      let g = map.get(r.doctorId);
      if (!g) {
        g = { doctorId: r.doctorId, doctorName: r.doctorName, rows: [], amount: 0 };
        map.set(r.doctorId, g);
      }
      g.rows.push(r);
      g.amount += r.amount;
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount || a.doctorName.localeCompare(b.doctorName));
  }, [filtered]);

  const compareRows = useMemo(() => {
    type Agg = { doctorId: number; doctorName: string; testsA: number; amountA: number; testsB: number; amountB: number };
    const map = new Map<number, Agg>();
    const bump = (rows: FlatRow[], which: "A" | "B") => {
      for (const r of rows) {
        let g = map.get(r.doctorId);
        if (!g) {
          g = { doctorId: r.doctorId, doctorName: r.doctorName, testsA: 0, amountA: 0, testsB: 0, amountB: 0 };
          map.set(r.doctorId, g);
        }
        if (which === "A") { g.testsA += 1; g.amountA += r.amount; }
        else { g.testsB += 1; g.amountB += r.amount; }
      }
    };
    bump(rowsA, "A");
    bump(rowsB, "B");
    return [...map.values()].sort((a, b) => (b.amountB + b.amountA) - (a.amountB + a.amountA));
  }, [rowsA, rowsB]);

  // ── WhatsApp / Email send ──────────────────────────────────────────────────
  const [sendOpen, setSendOpen] = useState(false);
  const [sendSelected, setSendSelected] = useState<Set<number>>(new Set());
  const [sendDetail, setSendDetail] = useState<"summary" | "breakdown">("summary");
  const [sendChannel, setSendChannel] = useState<"whatsapp" | "email" | "both">("whatsapp");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null);
  const [sendConfirmed, setSendConfirmed] = useState(false);

  const openSend = () => {
    const ids = doctorId != null
      ? new Set([doctorId])
      : new Set(byDoctor.map((d) => d.doctorId));
    setSendSelected(ids);
    setSendResults(null);
    setSendConfirmed(false);
    setSendOpen(true);
  };

  const callSend = async (dryRun: boolean) => {
    setSendBusy(true);
    try {
      const res = await fetch("/api/commission/whatsapp/send-register", {
        method: "POST",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorIds: [...sendSelected],
          from, to,
          detail: sendDetail,
          channel: sendChannel,
          dryRun,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setSendResults(j.results as SendResult[]);
      setSendConfirmed(!dryRun);
      if (!dryRun) {
        toast({
          title: "Sent",
          description: `WhatsApp: ${j.sentWhatsapp ?? 0} · Email: ${j.sentEmail ?? 0}`,
        });
      }
    } catch (e) {
      toast({ title: "Send failed", description: String(e), variant: "destructive" });
    } finally {
      setSendBusy(false);
    }
  };

  const exportCsv = () => {
    const header = ["DATE", "PATIENT'S NAME", "TEST NAME", "AMOUNT", "REF. BY DOCTOR", "CATEGORY"];
    const lines = [
      header.join(","),
      ...filtered.map((r) =>
        [fmtDate(r.date), r.patientName, r.testName, r.amount.toFixed(2), r.doctorName, r.modality]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    saveAs(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }), `referral-register_${from}_to_${to}.csv`);
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
    } else if (view === "compare") {
      rows.length = 0;
      rows.push([{ value: "Referral Register — Month comparison", fontWeight: "bold" }, null, null, null, null, null, null]);
      rows.push([
        { value: `Last month ${fmtDate(compareA.from)}–${fmtDate(compareA.to)} vs This month ${fmtDate(compareB.from)}–${fmtDate(compareB.to)}` },
        null, null, null, null, null, null,
      ]);
      rows.push([null, null, null, null, null, null, null]);
      rows.push([
        { value: "REF. BY DOCTOR", fontWeight: "bold", backgroundColor: "#E5E7EB" },
        { value: "TESTS (LAST)", fontWeight: "bold", backgroundColor: "#E5E7EB", align: "right" },
        { value: "AMOUNT (LAST)", fontWeight: "bold", backgroundColor: "#E5E7EB", align: "right" },
        { value: "TESTS (THIS)", fontWeight: "bold", backgroundColor: "#E5E7EB", align: "right" },
        { value: "AMOUNT (THIS)", fontWeight: "bold", backgroundColor: "#E5E7EB", align: "right" },
        { value: "Δ TESTS", fontWeight: "bold", backgroundColor: "#E5E7EB", align: "right" },
        { value: "Δ AMOUNT", fontWeight: "bold", backgroundColor: "#E5E7EB", align: "right" },
      ]);
      for (const r of compareRows) {
        rows.push([
          { value: r.doctorName, type: String },
          { value: r.testsA, type: Number, align: "right" },
          { value: r.amountA, type: Number, align: "right" },
          { value: r.testsB, type: Number, align: "right" },
          { value: r.amountB, type: Number, align: "right" },
          { value: r.testsB - r.testsA, type: Number, align: "right" },
          { value: r.amountB - r.amountA, type: Number, align: "right" },
        ]);
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
    if (view !== "compare") {
      rows.push([null, null, null, null, null]);
      rows.push([
        { value: "TOTAL", fontWeight: "bold" },
        { value: `${totals.testsN} tests · ${totals.doctorsN} doctors`, fontWeight: "bold" },
        null,
        { value: totals.amount, type: Number, fontWeight: "bold", align: "right" },
        null,
      ]);
    }

    const writeXlsxFile = (await import("write-excel-file/browser")).default as unknown as (
      sheets: Array<{ data: Cell[][]; sheet?: string; columns?: { width: number }[] }>,
    ) => { toBlob: () => Promise<Blob> };
    const cols = view === "compare"
      ? [{ width: 24 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 12 }]
      : [{ width: 12 }, { width: 28 }, { width: 28 }, { width: 14 }, { width: 24 }];
    const blob = await writeXlsxFile([{ data: rows, sheet: "Referral Register", columns: cols }]).toBlob();
    saveAs(blob, `referral-register_${from}_to_${to}.xlsx`);
  };

  const printRegister = () => {
    let bodyRows = "";
    if (view === "compare") {
      bodyRows = compareRows.map((r) => {
        const dTests = r.testsB - r.testsA;
        const dAmt = r.amountB - r.amountA;
        return `<tr>
          <td>${escapeHtml(r.doctorName)}</td>
          <td class="right">${r.testsA}</td><td class="right">${inr(r.amountA)}</td>
          <td class="right">${r.testsB}</td><td class="right">${inr(r.amountB)}</td>
          <td class="right">${dTests >= 0 ? "+" : ""}${dTests}</td>
          <td class="right">${dAmt >= 0 ? "+" : ""}${inr(dAmt)}</td>
        </tr>`;
      }).join("");
    } else if (view === "by-doctor") {
      bodyRows = byDoctor.map((g) => {
        const head = `<tr class="grp"><td colspan="4"><strong>${escapeHtml(g.doctorName)}</strong></td><td class="right"><strong>${inr(g.amount)}</strong></td></tr>`;
        const lines = g.rows.map((r) =>
          `<tr><td>${fmtDate(r.date)}</td><td>${escapeHtml(r.patientName)}</td><td>${escapeHtml(r.testName)}</td><td class="right">${inr(r.amount)}</td><td>${escapeHtml(r.doctorName)}</td></tr>`,
        ).join("");
        return head + lines;
      }).join("");
    } else {
      bodyRows = filtered.map((r) =>
        `<tr><td>${fmtDate(r.date)}</td><td>${escapeHtml(r.patientName)}</td><td>${escapeHtml(r.testName)}</td><td class="right">${inr(r.amount)}</td><td>${escapeHtml(r.doctorName)}</td></tr>`,
      ).join("");
    }

    const headCols = view === "compare"
      ? `<tr><th>Ref. By Doctor</th><th class="right">Tests (Last)</th><th class="right">Amount (Last)</th><th class="right">Tests (This)</th><th class="right">Amount (This)</th><th class="right">Δ Tests</th><th class="right">Δ Amount</th></tr>`
      : `<tr><th>Date</th><th>Patient's Name</th><th>Test Name</th><th class="right">Amount</th><th>Ref. By Doctor</th></tr>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Referral Register</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:16px}
  h1{font-size:16px;margin:0 0 4px}.meta{color:#555;margin-bottom:12px}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #333;padding:4px 6px;text-align:left}
  th{background:#eee;font-weight:bold;text-transform:uppercase;font-size:11px}
  td.right,th.right{text-align:right} tr.grp td{background:#fef3c7}
  tfoot td{font-weight:bold;background:#f3f4f6}@media print{body{margin:8px}}
</style></head><body>
<h1>Referral Register${view === "compare" ? " — Month comparison" : ""}</h1>
<div class="meta">${view === "compare"
  ? `Last month ${fmtDate(compareA.from)}–${fmtDate(compareA.to)} vs This month ${fmtDate(compareB.from)}–${fmtDate(compareB.to)}`
  : `Period: ${fmtDate(from)} to ${fmtDate(to)}`}${doctorId != null ? ` · Doctor: ${escapeHtml(doctors.find((d) => d.id === doctorId)?.name ?? "")}` : ""}${modality !== "all" ? ` · ${modality}` : ""}</div>
<table><thead>${headCols}</thead>
<tbody>${bodyRows || `<tr><td colspan="7">No rows</td></tr>`}</tbody>
${view !== "compare" ? `<tfoot><tr><td colspan="3">Total — ${totals.testsN} tests · ${totals.doctorsN} doctors</td><td class="right">${inr(totals.amount)}</td><td></td></tr></tfoot>` : ""}
</table></body></html>`;
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to print.", variant: "destructive" });
      return;
    }
    w.document.open(); w.document.write(html); w.document.close(); w.focus(); w.print();
  };

  const busy = view === "compare" ? (loadingA || loadingB) : isLoading;
  const hasRows = view === "compare" ? compareRows.length > 0 : filtered.length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={16} className="mr-1" /> Back</Button>
          <div>
            <h1 className="text-lg font-bold">Referral Register</h1>
            <p className="text-xs text-muted-foreground">
              DATE · PATIENT · TEST · AMOUNT · REF. DOCTOR — billed orders only (unbilled duplicates excluded).
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Filter size={13} /> Filters
          </div>

          {/* Month presets */}
          <div className="flex flex-wrap gap-2">
            {([
              ["this-month", "This month"],
              ["last-month", "Last month"],
              ["custom", "Custom dates"],
            ] as const).map(([id, label]) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={preset === id ? "default" : "outline"}
                onClick={() => applyPreset(id)}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={from}
                disabled={view === "compare"}
                onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }}
              />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={to}
                disabled={view === "compare"}
                onChange={(e) => { setPreset("custom"); setTo(e.target.value); }}
              />
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
              <Label className="text-xs">Category / modality</Label>
              <Select value={modality} onValueChange={setModality}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({modalityCounts.all ?? 0})</SelectItem>
                  {MODALITIES.map((m) => (
                    <SelectItem key={m} value={m}>{m} ({modalityCounts[m] ?? 0})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
            <div>
              <Label className="text-xs">Test name contains</Label>
              <Input placeholder="e.g. MRI, USG, X-RAY" value={testSearch} onChange={(e) => setTestSearch(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Patient / bill search</Label>
              <Input placeholder="Patient name or bill no" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">View</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              <Button type="button" size="sm" variant={view === "flat" ? "default" : "outline"} onClick={() => setView("flat")}>
                <List size={13} className="mr-1" /> Flat list
              </Button>
              <Button type="button" size="sm" variant={view === "by-doctor" ? "default" : "outline"} onClick={() => setView("by-doctor")}>
                <Layers size={13} className="mr-1" /> Doctor-wise
              </Button>
              <Button type="button" size="sm" variant={view === "compare" ? "default" : "outline"} onClick={() => setView("compare")}>
                <GitCompare size={13} className="mr-1" /> Compare months
              </Button>
            </div>
            {view === "compare" && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Compares <strong>last month</strong> ({fmtDate(compareA.from)}–{fmtDate(compareA.to)}) vs{" "}
                <strong>this month</strong> ({fmtDate(compareB.from)}–{fmtDate(compareB.to)}) per referring doctor.
                Doctor / category / test filters still apply.
              </p>
            )}
          </div>
        </div>

        {/* Summary + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            {view === "compare" ? (
              <>
                <Stat icon={<Users size={14} />} label="Doctors" value={String(compareRows.length)} />
                <Stat icon={<IndianRupee size={14} />} label="Last month" value={inr(rowsA.reduce((s, r) => s + r.amount, 0))} />
                <Stat icon={<IndianRupee size={14} />} label="This month" value={inr(rowsB.reduce((s, r) => s + r.amount, 0))} amber />
              </>
            ) : (
              <>
                <Stat icon={<Users size={14} />} label="Tests" value={String(totals.testsN)} />
                <Stat icon={<Stethoscope size={14} />} label="Doctors" value={String(totals.doctorsN)} />
                <Stat icon={<IndianRupee size={14} />} label="Total amount" value={inr(totals.amount)} amber />
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {view !== "compare" && (
              <Button variant="outline" size="sm" onClick={openSend} disabled={!hasRows}>
                <MessageCircle size={14} className="mr-1.5" /> WhatsApp / Email
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={printRegister} disabled={!hasRows}>
              <Printer size={14} className="mr-1.5" /> Print
            </Button>
            {view !== "compare" && (
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!hasRows}>
                <Download size={14} className="mr-1.5" /> CSV
              </Button>
            )}
            <Button size="sm" onClick={() => void exportExcel()} disabled={!hasRows}>
              <FileSpreadsheet size={14} className="mr-1.5" /> Excel
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {busy ? (
            <div className="p-10 text-center text-muted-foreground text-sm">Loading register…</div>
          ) : !hasRows ? (
            <div className="p-10 text-center text-muted-foreground text-sm">No billed referrals for these filters.</div>
          ) : view === "compare" ? (
            <CompareTable rows={compareRows} />
          ) : view === "by-doctor" ? (
            <div className="divide-y divide-border">
              {byDoctor.map((g) => (
                <div key={g.doctorId}>
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
          {view !== "compare" && filtered.length > 0 && (
            <div className="flex justify-between px-4 py-3 border-t border-border bg-muted/30 text-sm font-semibold">
              <span>Total — {totals.testsN} tests · {totals.doctorsN} doctors</span>
              <span className="text-amber-700 tabular-nums">{inr(totals.amount)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Send dialog */}
      <Dialog open={sendOpen} onOpenChange={(v) => { setSendOpen(v); if (!v) { setSendResults(null); setSendConfirmed(false); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle size={18} className="text-emerald-500" />
              Send referral register
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Sends each selected doctor their billed referral list for {fmtDate(from)} – {fmtDate(to)}.
            Preview first — nothing leaves until you confirm.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Channel</Label>
              <Select value={sendChannel} onValueChange={(v) => setSendChannel(v as typeof sendChannel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="both">WhatsApp + Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Detail</Label>
              <Select value={sendDetail} onValueChange={(v) => setSendDetail(v as typeof sendDetail)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="summary">Summary (counts + total)</SelectItem>
                  <SelectItem value="breakdown">Breakdown (up to 40 lines)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="border border-border rounded-lg max-h-48 overflow-y-auto divide-y divide-border">
            {byDoctor.map((d) => {
              const on = sendSelected.has(d.doctorId);
              return (
                <label key={d.doctorId} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      setSendSelected((prev) => {
                        const n = new Set(prev);
                        if (n.has(d.doctorId)) n.delete(d.doctorId); else n.add(d.doctorId);
                        return n;
                      });
                    }}
                  />
                  <span className="flex-1 font-medium">{d.doctorName}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{d.rows.length} tests · {inr(d.amount)}</span>
                </label>
              );
            })}
          </div>
          {sendResults && (
            <div className="space-y-2 text-xs">
              {sendResults.map((r) => (
                <div key={r.doctorId} className="border border-border rounded-lg p-3 space-y-1">
                  <div className="flex justify-between font-medium text-sm">
                    <span>{r.doctorName}</span>
                    <span className="tabular-nums text-amber-700">{inr(r.amount)}</span>
                  </div>
                  {r.message && (
                    <pre className="whitespace-pre-wrap bg-muted/40 rounded p-2 text-[11px] max-h-32 overflow-y-auto">{r.message}</pre>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {r.whatsapp && (
                      <span className={r.whatsapp.ok ? "text-emerald-600" : "text-rose-600"}>
                        WhatsApp: {r.whatsapp.ok ? (r.whatsapp.skipped ? "preview OK" : "sent") : (r.whatsapp.error ?? "failed")}
                      </span>
                    )}
                    {r.emailResult && (
                      <span className={r.emailResult.ok ? "text-emerald-600" : "text-rose-600"}>
                        Email: {r.emailResult.ok ? (r.emailResult.skipped ? "preview OK" : "sent") : (r.emailResult.error ?? "failed")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => void callSend(true)} disabled={sendBusy || sendSelected.size === 0}>
              Preview
            </Button>
            <Button
              onClick={() => void callSend(false)}
              disabled={sendBusy || !sendResults || sendConfirmed || sendSelected.size === 0}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {sendConfirmed ? <><Check size={14} className="mr-1" /> Sent</> : <><Send size={14} className="mr-1" /> Confirm &amp; send</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function CompareTable({
  rows,
}: {
  rows: { doctorId: number; doctorName: string; testsA: number; amountA: number; testsB: number; amountB: number }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Ref. By Doctor</th>
            <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Tests (Last)</th>
            <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Amount (Last)</th>
            <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Tests (This)</th>
            <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Amount (This)</th>
            <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Δ Tests</th>
            <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase text-muted-foreground">Δ Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const dT = r.testsB - r.testsA;
            const dA = r.amountB - r.amountA;
            return (
              <tr key={r.doctorId} className={`border-b border-border/50 ${i % 2 ? "bg-muted/10" : ""}`}>
                <td className="px-4 py-2 font-medium uppercase">{r.doctorName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.testsA}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(r.amountA)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{r.testsB}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-amber-700">{inr(r.amountB)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${dT > 0 ? "text-emerald-600" : dT < 0 ? "text-rose-600" : ""}`}>
                  {dT > 0 ? "+" : ""}{dT}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${dA > 0 ? "text-emerald-600" : dA < 0 ? "text-rose-600" : ""}`}>
                  {dA > 0 ? "+" : ""}{inr(dA)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
