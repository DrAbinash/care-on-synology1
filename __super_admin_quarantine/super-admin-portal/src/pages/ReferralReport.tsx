import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Printer, Stethoscope, Users, FileText, IndianRupee, TrendingUp, Download, FileSpreadsheet, Percent,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";
import { exportCommissionPdf } from "@/lib/exportCommissionPdf";
import { exportCommissionExcel } from "@/lib/exportCommissionExcel";
import { exportCommissionWord } from "@/lib/exportCommissionWord";
import type { CommissionDoctorEntryX, CommissionTestGroupRowX } from "@/lib/exportCommissionPdf";

// ── Types ─────────────────────────────────────────────────────────────────────
type SaDoctor = { id: number; name: string };

type PatientRow = {
  date: string;
  patientName: string;
  patientPid: string;
  orderId: number;
  orderNumber: string;
  billNumber: string;
  testId: number;
  testName: string;
  category: string;
  price: number;
  commission: number;        // actual — after the referral-discount deduction
  grossCommission: number;   // expected — before the discount deduction
  // Bill-level discount (repeated on each test row of the same bill)
  billDiscount: number;
  billSubtotal: number;
  ruleType: string;
  ruleValue: number;
  ruleName: string;
};

type DiscountFmt = "fixed" | "percent";

type DoctorEntry = {
  doctor: { id: number; name: string; specialization: string | null };
  rows: PatientRow[];
  totalCommission: number;            // actual
  totalExpectedCommission: number;    // expected (pre-discount)
  totalDiscount: number;              // expected − actual (referral discount given up)
  totalRevenue: number;
  orderCount: number;
  testCount: number;
};

type ReportData = {
  report: DoctorEntry[];
  grandTotal: { doctors: number; orders: number; revenue: number; commission: number; expectedCommission: number; discount: number };
};

type ReportMode = "by-doctor" | "test-summary" | "consolidated";

// ── Helpers ───────────────────────────────────────────────────────────────────
const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const fmtRate = (ruleType: string, ruleValue: number) =>
  ruleType === "percentage" ? `${ruleValue}%` : inr(ruleValue);

// Format a bill discount either as a fixed ₹ amount or as a percentage of the
// bill subtotal, depending on the selected discount display format.
const fmtDiscount = (fmt: DiscountFmt, discount: number, subtotal: number): string => {
  if (fmt === "percent") {
    const pct = subtotal > 0 ? (discount / subtotal) * 100 : 0;
    return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
  }
  return inr(discount);
};

// Discount is a bill-level figure repeated on every test row of that bill, so
// dedupe by orderId before summing for any total.
const uniqueBillDiscount = (rows: PatientRow[]): { discount: number; subtotal: number } => {
  const seen = new Set<number>();
  let discount = 0, subtotal = 0;
  for (const r of rows) {
    if (seen.has(r.orderId)) continue;
    seen.add(r.orderId);
    discount += r.billDiscount;
    subtotal += r.billSubtotal;
  }
  return { discount, subtotal };
};

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// ── Print CSS ─────────────────────────────────────────────────────────────────
const PRINT_CSS = `
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Arial,sans-serif; font-size:12px; color:#1a1a1a; padding:20px; }
  h1 { font-size:15px; font-weight:700; text-align:center; text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px; }
  .meta { font-size:10px; color:#555; text-align:center; margin-bottom:3px; }
  .doctor-header {
    font-size:13px; font-weight:700; text-align:center; text-transform:uppercase;
    letter-spacing:.04em; padding:6px 10px; border:1px solid #ccc;
    background:#f7f7f7; margin:16px 0 0;
  }
  table { width:100%; border-collapse:collapse; }
  thead tr { background:#f0f0f0; }
  th { padding:5px 8px; font-size:10px; text-transform:uppercase; color:#444;
       border:1px solid #ccc; font-weight:600; }
  th.right, td.right { text-align:right; }
  th.center, td.center { text-align:center; }
  td { padding:5px 8px; border:1px solid #ddd; font-size:11px; }
  .total-row td { font-weight:700; background:#fff8e6; border-top:2px solid #b45309; }
  .grand-row td { font-weight:700; background:#fef3c7; font-size:13px; border-top:2px solid #92400e; }
  @media print { @page { margin:12mm; size:A4 landscape; } body { padding:0; } }
`;

function buildPrintHtml(
  mode: ReportMode,
  report: DoctorEntry[],
  grandTotal: ReportData["grandTotal"],
  from: string, to: string,
  doctorLabel: string,
  cols: ColFlags,
  discountFmt: DiscountFmt,
  showBreakdown: boolean,
) {
  const negDisc = (d: number) => (d > 0.005 ? `−${inr(d)}` : "—");
  const colCount = 3
    + (cols.billNo ? 1 : 0)
    + (cols.orderNo ? 1 : 0)
    + (cols.category ? 1 : 0)
    + (cols.rate ? 1 : 0)
    + (cols.billAmount ? 1 : 0)
    + (cols.discount ? 1 : 0)
    + 1; // commission always shown

  // Numeric columns rendered at the right end, each with its own total cell.
  const trailingCells = (cols.billAmount ? 1 : 0) + (cols.discount ? 1 : 0) + 1;

  const thead = `<thead><tr>
    <th>Date</th>
    <th>Patient Name</th>
    <th>Test Name</th>
    ${cols.billNo ? "<th>Bill No</th>" : ""}
    ${cols.orderNo ? "<th>Order No</th>" : ""}
    ${cols.category ? "<th>Category</th>" : ""}
    ${cols.rate ? "<th class='center'>Rate</th>" : ""}
    ${cols.billAmount ? "<th class='right'>Bill Amt</th>" : ""}
    ${cols.discount ? `<th class='center'>Discount${discountFmt === "percent" ? " %" : ""}</th>` : ""}
    <th class='right'>Commission</th>
  </tr></thead>`;

  const rowHtml = (row: PatientRow) => `<tr>
    <td>${fmtDate(row.date)}</td>
    <td>${row.patientName}</td>
    <td>${row.testName}</td>
    ${cols.billNo ? `<td>${row.billNumber}</td>` : ""}
    ${cols.orderNo ? `<td>${row.orderNumber}</td>` : ""}
    ${cols.category ? `<td>${row.category}</td>` : ""}
    ${cols.rate ? `<td class='center'>${fmtRate(row.ruleType, row.ruleValue)}</td>` : ""}
    ${cols.billAmount ? `<td class='right'>${inr(row.price)}</td>` : ""}
    ${cols.discount ? `<td class='center'>${row.billDiscount > 0 ? fmtDiscount(discountFmt, row.billDiscount, row.billSubtotal) : "—"}</td>` : ""}
    <td class='right'>${inr(row.commission)}</td>
  </tr>`;

  const discountCell = (rows: PatientRow[]) => {
    if (!cols.discount) return "";
    const agg = uniqueBillDiscount(rows);
    return `<td class='center'><strong>${agg.discount > 0 ? fmtDiscount(discountFmt, agg.discount, agg.subtotal) : "—"}</strong></td>`;
  };

  const totalRow = (rows: PatientRow[], revenue: number, commission: number) => `
    <tr class='total-row'>
      <td colspan='${colCount - trailingCells}'><strong>TOTAL</strong></td>
      ${cols.billAmount ? `<td class='right'><strong>${inr(revenue)}</strong></td>` : ""}
      ${discountCell(rows)}
      <td class='right'><strong>${inr(commission)}</strong></td>
    </tr>`;

  let body = "";

  if (mode === "consolidated") {
    const commCells = (expected: number, discount: number, actual: number) => showBreakdown
      ? `<td class='right'>${inr(expected)}</td><td class='right'>${negDisc(discount)}</td><td class='right'>${inr(actual)}</td>`
      : `<td class='right'>${inr(actual)}</td>`;
    const rows = report.map((e, i) => `<tr>
      <td>${ALPHA[i] ?? i + 1})</td>
      <td>${e.doctor.name}</td>
      <td class='center'>${e.testCount}</td>
      <td class='center'>${e.orderCount}</td>
      ${cols.billAmount ? `<td class='right'>${inr(e.totalRevenue)}</td>` : ""}
      ${commCells(e.totalExpectedCommission, e.totalDiscount, e.totalCommission)}
    </tr>`).join("");
    body = `<table style='margin-top:12px'>
      <thead><tr>
        <th style='width:28px'>#</th>
        <th>Referral Doctor Name</th>
        <th class='center'>Tests</th>
        <th class='center'>Visits</th>
        ${cols.billAmount ? "<th class='right'>Total Billed</th>" : ""}
        ${showBreakdown ? "<th class='right'>Expected</th><th class='right'>Discount</th><th class='right'>Actual</th>" : "<th class='right'>Commission</th>"}
      </tr></thead>
      <tbody>
        ${rows}
        <tr class='grand-row'>
          <td colspan='${3 + (cols.billAmount ? 1 : 0)}'><strong>GRAND TOTAL (${grandTotal.doctors} doctors · ${grandTotal.orders} visits)</strong></td>
          ${cols.billAmount ? `<td class='right'><strong>${inr(grandTotal.revenue)}</strong></td>` : ""}
          ${showBreakdown
            ? `<td class='right'><strong>${inr(grandTotal.expectedCommission)}</strong></td><td class='right'><strong>${negDisc(grandTotal.discount)}</strong></td><td class='right'><strong>${inr(grandTotal.commission)}</strong></td>`
            : `<td class='right'><strong>${inr(grandTotal.commission)}</strong></td>`}
        </tr>
      </tbody>
    </table>`;
  } else if (mode === "test-summary") {
    // Test-grouped print per doctor, with optional Expected/Discount/Actual breakdown.
    type TS = { testName: string; count: number; expected: number; commission: number; ruleType: string; ruleValue: number };
    body = report.map(e => {
      const byTest: Record<number, TS> = {};
      for (const row of e.rows) {
        if (!byTest[row.testId]) byTest[row.testId] = { testName: row.testName, count: 0, expected: 0, commission: 0, ruleType: row.ruleType, ruleValue: row.ruleValue };
        byTest[row.testId].count++;
        byTest[row.testId].expected += row.grossCommission;
        byTest[row.testId].commission += row.commission;
      }
      const trows = Object.values(byTest).sort((a, b) => b.commission - a.commission);
      const head = showBreakdown
        ? `<tr><th>Test Name</th><th class='center'>No. of Tests</th><th class='right'>Expected</th><th class='right'>Discount</th><th class='right'>Actual</th></tr>`
        : `<tr><th>Test Name</th><th class='center'>No. of Tests</th>${cols.rate ? "<th class='center'>% / Fixed</th>" : ""}<th class='right'>Total Amount</th></tr>`;
      const bodyRows = trows.map(t => showBreakdown
        ? `<tr><td>${t.testName}</td><td class='center'>${t.count}</td><td class='right'>${inr(t.expected)}</td><td class='right'>${negDisc(t.expected - t.commission)}</td><td class='right'>${inr(t.commission)}</td></tr>`
        : `<tr><td>${t.testName}</td><td class='center'>${t.count}</td>${cols.rate ? `<td class='center'>${fmtRate(t.ruleType, t.ruleValue)}</td>` : ""}<td class='right'>${inr(t.commission)}</td></tr>`).join("");
      const totalHtml = showBreakdown
        ? `<tr class='total-row'><td colspan='2'><strong>TOTAL</strong></td><td class='right'><strong>${inr(e.totalExpectedCommission)}</strong></td><td class='right'><strong>${negDisc(e.totalDiscount)}</strong></td><td class='right'><strong>${inr(e.totalCommission)}</strong></td></tr>`
        : `<tr class='total-row'><td colspan='${cols.rate ? 3 : 2}'><strong>TOTAL</strong></td><td class='right'><strong>${inr(e.totalCommission)}</strong></td></tr>`;
      return `<div class='doctor-header'>${e.doctor.name}</div><table><thead>${head}</thead><tbody>${bodyRows}${totalHtml}</tbody></table>`;
    }).join("");
    if (report.length > 1) {
      const cspan = showBreakdown ? 2 : (cols.rate ? 3 : 2);
      body += `<table style='margin-top:16px'><tbody><tr class='grand-row'><td colspan='${cspan}'><strong>GRAND TOTAL</strong></td>${showBreakdown
        ? `<td class='right'><strong>${inr(grandTotal.expectedCommission)}</strong></td><td class='right'><strong>${negDisc(grandTotal.discount)}</strong></td><td class='right'><strong>${inr(grandTotal.commission)}</strong></td>`
        : `<td class='right'><strong>${inr(grandTotal.commission)}</strong></td>`}</tr></tbody></table>`;
    }
  } else {
    body = report.map(e => `
      <div class='doctor-header'>${e.doctor.name}</div>
      <table>
        ${thead}
        <tbody>
          ${e.rows.map(rowHtml).join("")}
          ${totalRow(e.rows, e.totalRevenue, e.totalCommission)}
        </tbody>
      </table>
    `).join("");

    if (report.length > 1) {
      const allRows = report.flatMap(e => e.rows);
      body += `<table style='margin-top:16px'>
        <tbody>
          <tr class='grand-row'>
            <td colspan='${colCount - trailingCells}'><strong>GRAND TOTAL</strong></td>
            ${cols.billAmount ? `<td class='right'><strong>${inr(grandTotal.revenue)}</strong></td>` : ""}
            ${discountCell(allRows)}
            <td class='right'><strong>${inr(grandTotal.commission)}</strong></td>
          </tr>
        </tbody>
      </table>`;
    }
  }

  return `<html><head>
    <title>Referral Report — ${from} to ${to}</title>
    <style>${PRINT_CSS}</style>
  </head><body>
    <h1>Referral &amp; Commission Report</h1>
    <p class='meta'>Period: ${from} to ${to} &nbsp;|&nbsp; Doctor: ${doctorLabel}</p>
    <p class='meta'>Generated: ${new Date().toLocaleString("en-IN")}</p>
    ${body}
    <script>window.onload=function(){window.print();}<\/script>
  </body></html>`;
}

// ── Column flags ──────────────────────────────────────────────────────────────
type ColFlags = {
  billNo: boolean;
  orderNo: boolean;
  category: boolean;
  rate: boolean;
  billAmount: boolean;
  discount: boolean;
};

const DEFAULT_COLS: ColFlags = {
  billNo: false,
  orderNo: false,
  category: false,
  rate: true,
  billAmount: false,
  discount: false,
};

// ── Main component ────────────────────────────────────────────────────────────
export default function ReferralReport({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const firstOfMonth = () => {
    const d = new Date(); d.setDate(1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [mode, setMode] = useState<ReportMode>("by-doctor");
  const [cols, setCols] = useState<ColFlags>(DEFAULT_COLS);
  const [discountFmt, setDiscountFmt] = useState<DiscountFmt>("fixed");
  // Commission-discount breakdown: show Expected / Discount / Actual columns in
  // the Test-Summary and Consolidated views (expected − discount = actual).
  const [showBreakdown, setShowBreakdown] = useState(false);

  const { data: doctorsData } = useQuery({
    queryKey: ["/api/super-admin/doctors-list"],
    queryFn: async () => {
      const res = await fetch("/api/super-admin/doctors-list", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load doctors");
      return res.json() as Promise<{ doctors: SaDoctor[] }>;
    },
  });
  const doctors: SaDoctor[] = doctorsData?.doctors ?? [];

  const { data, isLoading, error } = useQuery<ReportData>({
    queryKey: ["/api/commission/report-by-patient", from, to, doctorId],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      if (doctorId != null) params.set("doctorId", String(doctorId));
      const res = await fetch(`/api/commission/report-by-patient?${params}`, { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  useEffect(() => {
    if (error) toast({ title: "Failed to load report", description: String(error), variant: "destructive" });
  }, [error, toast]);

  const report = data?.report ?? [];
  const grandTotal = data?.grandTotal ?? { doctors: 0, orders: 0, revenue: 0, commission: 0, expectedCommission: 0, discount: 0 };

  const handlePrint = () => {
    const doctorLabel = doctorId
      ? doctors.find(d => d.id === doctorId)?.name ?? "—"
      : "All Doctors";
    const html = buildPrintHtml(mode, report, grandTotal, from, to, doctorLabel, cols, discountFmt, showBreakdown);
    const win = window.open("", "_blank", "width=1000,height=750");
    if (!win) { toast({ title: "Pop-up blocked", description: "Please allow pop-ups and try again.", variant: "destructive" }); return; }
    win.document.write(html);
    win.document.close();
  };

  const toggleCol = (key: keyof ColFlags) =>
    setCols(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Adapter: per-patient rows → test-grouped for export helpers ──────────
  function toExportSections(report: DoctorEntry[]): CommissionDoctorEntryX[] {
    return report.map((entry) => {
      const byTest: Record<number, CommissionTestGroupRowX> = {};
      for (const row of entry.rows) {
        if (!byTest[row.testId]) {
          byTest[row.testId] = {
            testId: row.testId,
            testName: row.testName,
            category: row.category,
            count: 0,
            revenue: 0,
            commission: 0,
            expected: 0,
            ruleName: row.ruleName,
            ruleType: row.ruleType,
            ruleValue: row.ruleValue,
          };
        }
        byTest[row.testId].count++;
        byTest[row.testId].revenue += row.price;
        byTest[row.testId].commission += row.commission;
        byTest[row.testId].expected = (byTest[row.testId].expected ?? 0) + row.grossCommission;
      }
      const grouped = Object.values(byTest).sort((a, b) => b.commission - a.commission);
      const effRate = entry.totalRevenue > 0
        ? Math.round((entry.totalCommission / entry.totalRevenue) * 1000) / 10
        : 0;
      return {
        doctor: {
          id: entry.doctor.id,
          name: entry.doctor.name,
          specialization: entry.doctor.specialization ?? "",
          defaultCommission: 0,
          defaultCommissionType: "percentage",
        },
        orderCount: entry.orderCount,
        testCount: entry.testCount,
        totalRevenue: entry.totalRevenue,
        totalCommission: entry.totalCommission,
        totalExpected: entry.totalExpectedCommission,
        totalDiscount: entry.totalDiscount,
        effectiveRate: effRate,
        grouped,
      } as unknown as CommissionDoctorEntryX;
    });
  }

  // ─── Export helpers ────────────────────────────────────────────────────────
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [wordLoading, setWordLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const doctorLabel = doctorId
    ? doctors.find((d) => d.id === doctorId)?.name ?? "—"
    : "All Doctors";
  const exportMode: Parameters<typeof exportCommissionPdf>[2] =
    mode === "consolidated" ? "consolidated" : "standard";

  const handleDownloadExcel = async () => {
    if (report.length === 0) {
      toast({ title: "No data to export", description: "Adjust the filters and try again.", variant: "destructive" });
      return;
    }
    setXlsxLoading(true);
    try {
      await exportCommissionExcel(
        toExportSections(report),
        {
          title: "Referral & Commission Report",
          from,
          to,
          doctorFilter: doctorLabel,
          generatedAt: new Date().toLocaleString("en-IN"),
          grandTotal,
        },
        exportMode,
        cols.rate,
        showBreakdown,
      );
    } catch (err) {
      toast({ title: "Excel export failed", description: String(err), variant: "destructive" });
    } finally {
      setXlsxLoading(false);
    }
  };

  const handleDownloadWord = async () => {
    if (report.length === 0) {
      toast({ title: "No data to export", description: "Adjust the filters and try again.", variant: "destructive" });
      return;
    }
    setWordLoading(true);
    try {
      await exportCommissionWord(
        toExportSections(report),
        {
          title: "Referral & Commission Report",
          from,
          to,
          doctorFilter: doctorLabel,
          generatedAt: new Date().toLocaleString("en-IN"),
          grandTotal,
        },
        exportMode,
        cols.rate,
        showBreakdown,
      );
    } catch (err) {
      toast({ title: "Word export failed", description: String(err), variant: "destructive" });
    } finally {
      setWordLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (report.length === 0) {
      toast({ title: "No data to export", description: "Adjust the filters and try again.", variant: "destructive" });
      return;
    }
    setPdfLoading(true);
    try {
      await exportCommissionPdf(
        toExportSections(report),
        {
          title: "Referral & Commission Report",
          from,
          to,
          doctorFilter: doctorLabel,
          generatedAt: new Date().toLocaleString("en-IN"),
          grandTotal,
        },
        exportMode,
        cols.rate,
        undefined,
        showBreakdown,
      );
    } catch (err) {
      toast({ title: "PDF export failed", description: String(err), variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  const colCount = 3
    + (cols.billNo ? 1 : 0)
    + (cols.orderNo ? 1 : 0)
    + (cols.category ? 1 : 0)
    + (cols.rate ? 1 : 0)
    + (cols.billAmount ? 1 : 0)
    + (cols.discount ? 1 : 0)
    + 1;

  return (
    <div className="min-h-screen w-full bg-background">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Header */}
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
            <ArrowLeft size={14} className="mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-bold">Referral &amp; Commission Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-patient, per-test referral commission — grouped by referring doctor, with test-summary view
          </p>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap gap-3 items-end justify-between">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 w-36" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 w-36" />
              </div>
              <div>
                <Label className="text-xs">Referral Doctor</Label>
                <Select onValueChange={v => setDoctorId(v === "all" ? null : Number(v))}>
                  <SelectTrigger className="mt-1 w-56">
                    <SelectValue placeholder="All Doctors" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Doctors</SelectItem>
                    {doctors.map(d => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5" disabled={report.length === 0}>
                <Printer size={14} /> Print
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadExcel} disabled={xlsxLoading || report.length === 0} className="gap-1.5">
                <FileSpreadsheet size={14} /> {xlsxLoading ? "Exporting…" : "Excel"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadWord} disabled={wordLoading || report.length === 0} className="gap-1.5">
                <FileText size={14} /> {wordLoading ? "Exporting…" : "Word"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={pdfLoading || report.length === 0} className="gap-1.5">
                <Download size={14} /> {pdfLoading ? "Exporting…" : "PDF"}
              </Button>
            </div>
          </div>

          {/* Mode + column toggles */}
          <div className="flex flex-wrap gap-5 items-start pt-3 border-t border-border">
            <div>
              <Label className="text-xs mb-2 block">Report View</Label>
              <div className="flex gap-1.5">
                {(["by-doctor", "test-summary", "consolidated"] as ReportMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      mode === m
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    {m === "by-doctor" ? "By Doctor" : m === "test-summary" ? "Test Summary" : "Consolidated"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Commission Breakdown</Label>
              <div className="flex items-center gap-1.5">
                <Checkbox id="breakdown" checked={showBreakdown} onCheckedChange={() => setShowBreakdown((v) => !v)} />
                <label htmlFor="breakdown" className="text-xs cursor-pointer select-none">Expected − Discount = Actual</label>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 max-w-[190px] leading-snug">
                Splits commission into expected, referral discount given, and actual (Test Summary &amp; Consolidated).
              </p>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Optional Columns</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 items-center">
                {([
                  ["billNo",     "Bill No"],
                  ["orderNo",    "Order No"],
                  ["category",   "Category"],
                  ["rate",       "Rate (% / ₹)"],
                  ["billAmount", "Bill Amount"],
                  ["discount",   "Discount"],
                ] as [keyof ColFlags, string][]).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`col-${key}`}
                      checked={cols[key]}
                      onCheckedChange={() => toggleCol(key)}
                    />
                    <label htmlFor={`col-${key}`} className="text-xs cursor-pointer select-none">{label}</label>
                  </div>
                ))}
                {/* Discount display format — only relevant when the Discount column is on */}
                {cols.discount && (
                  <div className="flex items-center gap-1 pl-2 border-l border-border">
                    {(["fixed", "percent"] as DiscountFmt[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setDiscountFmt(f)}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                          discountFmt === f
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:bg-muted text-muted-foreground"
                        }`}
                      >
                        {f === "fixed" ? "₹ Amount" : "% of Bill"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(showBreakdown
            ? [
                { label: "Total Visits",        value: String(grandTotal.orders),          icon: <Users size={16} />,       amber: false },
                { label: "Expected Commission", value: inr(grandTotal.expectedCommission), icon: <TrendingUp size={16} />,  amber: false },
                { label: "Discount Given",      value: inr(grandTotal.discount),           icon: <Percent size={16} />,     amber: false },
                { label: "Actual Commission",   value: inr(grandTotal.commission),         icon: <IndianRupee size={16} />, amber: true },
              ]
            : [
                { label: "Doctors with Referrals", value: String(grandTotal.doctors), icon: <Stethoscope size={16} />, amber: false },
                { label: "Total Visits",           value: String(grandTotal.orders),  icon: <Users size={16} />,       amber: false },
                { label: "Total Revenue",          value: inr(grandTotal.revenue),    icon: <TrendingUp size={16} />,  amber: false },
                { label: "Commission Payable",     value: inr(grandTotal.commission), icon: <IndianRupee size={16} />, amber: true },
              ]
          ).map(c => (
            <div key={c.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className={c.amber ? "text-amber-600" : "text-muted-foreground"}>{c.icon}</span>
                <p className="text-xs text-muted-foreground">{c.label}</p>
              </div>
              <p className={`text-xl font-bold ${c.amber ? "text-amber-600" : ""}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Report body */}
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : report.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm bg-card border border-border rounded-xl">
            <FileText size={32} className="mx-auto mb-3 opacity-30" />
            No referral data for the selected period / doctor
          </div>
        ) : mode === "consolidated" ? (
          <ConsolidatedView report={report} grandTotal={grandTotal} cols={cols} showBreakdown={showBreakdown} />
        ) : mode === "test-summary" ? (
          <TestSummaryView report={report} grandTotal={grandTotal} cols={cols} showBreakdown={showBreakdown} />
        ) : (
          <ByDoctorView report={report} grandTotal={grandTotal} cols={cols} colCount={colCount} discountFmt={discountFmt} />
        )}
      </div>
    </div>
  );
}

// ── By Doctor view ────────────────────────────────────────────────────────────
function ByDoctorView({
  report, grandTotal, cols, colCount, discountFmt,
}: {
  report: DoctorEntry[];
  grandTotal: ReportData["grandTotal"];
  cols: ColFlags;
  colCount: number;
  discountFmt: DiscountFmt;
}) {
  const grandDiscount = uniqueBillDiscount(report.flatMap(e => e.rows));
  return (
    <div className="space-y-6">
      {report.map((entry, idx) => (
        <DoctorBlock key={entry.doctor.id} entry={entry} index={idx} cols={cols} colCount={colCount} discountFmt={discountFmt} />
      ))}

      {report.length > 1 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-bold text-sm">Grand Total</p>
            <p className="text-xs text-muted-foreground">
              {grandTotal.doctors} doctors · {grandTotal.orders} visits
            </p>
          </div>
          <div className="flex gap-8">
            {cols.billAmount && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total Revenue</p>
                <p className="font-bold text-base">{inr(grandTotal.revenue)}</p>
              </div>
            )}
            {cols.discount && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total Discount</p>
                <p className="font-bold text-base">{grandDiscount.discount > 0 ? fmtDiscount(discountFmt, grandDiscount.discount, grandDiscount.subtotal) : "—"}</p>
              </div>
            )}
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Commission Payable</p>
              <p className="font-bold text-base text-amber-600">{inr(grandTotal.commission)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DoctorBlock({
  entry, index, cols, colCount, discountFmt,
}: {
  entry: DoctorEntry;
  index: number;
  cols: ColFlags;
  colCount: number;
  discountFmt: DiscountFmt;
}) {
  const label = ALPHA[index] ?? String(index + 1);
  const docDiscount = uniqueBillDiscount(entry.rows);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Doctor header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-muted/30">
        <span className="text-xs font-bold text-muted-foreground w-5">{label})</span>
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Stethoscope size={14} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm uppercase tracking-wide">{entry.doctor.name}</p>
          {entry.doctor.specialization && (
            <p className="text-xs text-muted-foreground">{entry.doctor.specialization}</p>
          )}
        </div>
        <div className="flex gap-6 text-right shrink-0">
          <div>
            <p className="text-xs text-muted-foreground">Visits</p>
            <p className="font-semibold text-sm">{entry.orderCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tests</p>
            <p className="font-semibold text-sm">{entry.testCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Commission</p>
            <p className="font-bold text-sm text-amber-600">{inr(entry.totalCommission)}</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground whitespace-nowrap">Date</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Patient Name</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Test Name</th>
              {cols.billNo   && <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground whitespace-nowrap">Bill No</th>}
              {cols.orderNo  && <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground whitespace-nowrap">Order No</th>}
              {cols.category && <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Category</th>}
              {cols.rate     && <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Rate</th>}
              {cols.billAmount && <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground whitespace-nowrap">Bill Amt</th>}
              {cols.discount && <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground whitespace-nowrap">Discount</th>}
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground whitespace-nowrap">Commission</th>
            </tr>
          </thead>
          <tbody>
            {entry.rows.map((row, i) => (
              <tr key={`${row.orderId}-${row.testId}`} className={`border-b border-border/60 last:border-0 ${i % 2 === 1 ? "bg-muted/10" : ""}`}>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs tabular-nums">{fmtDate(row.date)}</td>
                <td className="px-4 py-2.5 font-medium uppercase">{row.patientName}</td>
                <td className="px-4 py-2.5">{row.testName}</td>
                {cols.billNo   && <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{row.billNumber}</td>}
                {cols.orderNo  && <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{row.orderNumber}</td>}
                {cols.category && <td className="px-4 py-2.5"><span className="px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded text-xs">{row.category}</span></td>}
                {cols.rate     && (
                  <td className="px-4 py-2.5 text-center tabular-nums text-xs text-muted-foreground">
                    {fmtRate(row.ruleType, row.ruleValue)}
                  </td>
                )}
                {cols.billAmount && <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{inr(row.price)}</td>}
                {cols.discount && <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">{row.billDiscount > 0 ? fmtDiscount(discountFmt, row.billDiscount, row.billSubtotal) : "—"}</td>}
                <td className="px-4 py-2.5 text-right font-semibold text-amber-700 tabular-nums">{inr(row.commission)}</td>
              </tr>
            ))}
            {/* Doctor total row */}
            <tr className="border-t-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
              <td className="px-4 py-3 font-bold text-xs uppercase tracking-wide" colSpan={colCount - ((cols.billAmount ? 1 : 0) + (cols.discount ? 1 : 0) + 1)}>
                TOTAL
              </td>
              {cols.billAmount && (
                <td className="px-4 py-3 text-right font-bold tabular-nums">
                  {inr(entry.totalRevenue)}
                </td>
              )}
              {cols.discount && (
                <td className="px-4 py-3 text-center font-bold tabular-nums">
                  {docDiscount.discount > 0 ? fmtDiscount(discountFmt, docDiscount.discount, docDiscount.subtotal) : "—"}
                </td>
              )}
              <td className="px-4 py-3 text-right font-bold text-base text-amber-700 tabular-nums">
                {inr(entry.totalCommission)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Test Summary view (merged from Commission Report) ───────────────────────
type TestSummaryRow = {
  testId: number;
  testName: string;
  category: string;
  count: number;
  revenue: number;
  commission: number;   // actual
  expected: number;     // expected (pre-discount)
  ruleName: string;
  ruleType: string;
  ruleValue: number;
};

// Referral discount given up on commission, shown as a negative ₹ or an em dash.
const fmtNegDiscount = (d: number) => (d > 0.005 ? `−${inr(d)}` : "—");

function TestSummaryView({
  report,
  grandTotal,
  cols,
  showBreakdown,
}: {
  report: DoctorEntry[];
  grandTotal: ReportData["grandTotal"];
  cols: ColFlags;
  showBreakdown: boolean;
}) {
  return (
    <div className="space-y-6">
      {report.map((entry, idx) => {
        // Build test-level aggregation from per-patient rows
        const byTest: Record<number, TestSummaryRow> = {};
        for (const row of entry.rows) {
          if (!byTest[row.testId]) {
            byTest[row.testId] = {
              testId: row.testId,
              testName: row.testName,
              category: row.category,
              count: 0,
              revenue: 0,
              commission: 0,
              expected: 0,
              ruleName: row.ruleName,
              ruleType: row.ruleType,
              ruleValue: row.ruleValue,
            };
          }
          byTest[row.testId].count++;
          byTest[row.testId].revenue += row.price;
          byTest[row.testId].commission += row.commission;
          byTest[row.testId].expected += row.grossCommission;
        }
        const rows = Object.values(byTest).sort((a, b) => b.commission - a.commission);
        const label = ALPHA[idx] ?? String(idx + 1);
        return (
          <div key={entry.doctor.id} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-muted/30">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider w-5">{label})</span>
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Stethoscope size={14} className="text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm">{entry.doctor.name}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.doctor.specialization ?? ""} · {entry.orderCount} orders · {entry.testCount} tests
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{showBreakdown ? "Actual Commission" : "Commission"}</p>
                <p className="font-semibold text-sm text-amber-600">{inr(entry.totalCommission)}</p>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Test Name</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">No. of Tests</th>
                  {!showBreakdown && cols.rate && <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">% / Fixed</th>}
                  {showBreakdown ? (
                    <>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Expected</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Discount</th>
                      <th className="text-right px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Actual</th>
                    </>
                  ) : (
                    <th className="text-right px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Total Amount</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.testId} className={`border-b border-border last:border-0 ${i % 2 === 1 ? "bg-muted/10" : ""}`}>
                    <td className="px-5 py-2.5 font-medium">{row.testName}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums">{row.count}</td>
                    {!showBreakdown && cols.rate && (
                      <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">
                        {row.ruleType === "percentage"
                          ? <span className="inline-flex items-center gap-0.5">{row.ruleValue}<span className="text-xs">%</span></span>
                          : <span className="text-xs">{inr(row.ruleValue)}</span>
                        }
                      </td>
                    )}
                    {showBreakdown ? (
                      <>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{inr(row.expected)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-rose-600">{fmtNegDiscount(row.expected - row.commission)}</td>
                        <td className="px-5 py-2.5 text-right font-semibold text-amber-700 tabular-nums">{inr(row.commission)}</td>
                      </>
                    ) : (
                      <td className="px-5 py-2.5 text-right font-semibold text-amber-700 tabular-nums">{inr(row.commission)}</td>
                    )}
                  </tr>
                ))}
                <tr className="border-t-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
                  {showBreakdown ? (
                    <>
                      <td className="px-5 py-3 font-bold text-sm" colSpan={2}>Total →</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{inr(entry.totalExpectedCommission)}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-rose-600">{fmtNegDiscount(entry.totalDiscount)}</td>
                      <td className="px-5 py-3 text-right font-bold text-base text-amber-700 tabular-nums">{inr(entry.totalCommission)}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-5 py-3 font-bold text-sm" colSpan={cols.rate ? 3 : 2}>Total →</td>
                      <td className="px-5 py-3 text-right font-bold text-base text-amber-700 tabular-nums">{inr(entry.totalCommission)}</td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
      {report.length > 1 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 flex items-center justify-between dark:bg-amber-900/20 dark:border-amber-700">
          <div>
            <p className="font-bold text-sm">Grand Total</p>
            <p className="text-xs text-muted-foreground">{grandTotal.doctors} doctors · {grandTotal.orders} orders</p>
          </div>
          <div className="flex gap-10">
            {showBreakdown ? (
              <>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Expected</p>
                  <p className="font-bold text-base">{inr(grandTotal.expectedCommission)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Discount</p>
                  <p className="font-bold text-base text-rose-600">{fmtNegDiscount(grandTotal.discount)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Actual Commission</p>
                  <p className="font-bold text-base text-amber-600">{inr(grandTotal.commission)}</p>
                </div>
              </>
            ) : (
              <>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total Revenue</p>
                  <p className="font-bold text-base">{inr(grandTotal.revenue)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Commission Payable</p>
                  <p className="font-bold text-base text-amber-600">{inr(grandTotal.commission)}</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Consolidated view ─────────────────────────────────────────────────────────
function ConsolidatedView({
  report, grandTotal, cols, showBreakdown,
}: {
  report: DoctorEntry[];
  grandTotal: ReportData["grandTotal"];
  cols: ColFlags;
  showBreakdown: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            <th className="text-left px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground w-10">#</th>
            <th className="text-left px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Referral Doctor Name</th>
            <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Tests</th>
            <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Visits</th>
            {cols.billAmount && (
              <th className="text-right px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Total Billed</th>
            )}
            {showBreakdown ? (
              <>
                <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Expected</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Discount</th>
                <th className="text-right px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Actual</th>
              </>
            ) : (
              <th className="text-right px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Commission</th>
            )}
          </tr>
        </thead>
        <tbody>
          {report.map((entry, idx) => (
            <tr key={entry.doctor.id} className={`border-b border-border ${idx % 2 === 1 ? "bg-muted/10" : ""}`}>
              <td className="px-5 py-3 text-muted-foreground text-xs font-bold">{ALPHA[idx] ?? idx + 1})</td>
              <td className="px-5 py-3">
                <p className="font-semibold">{entry.doctor.name}</p>
                {entry.doctor.specialization && (
                  <p className="text-xs text-muted-foreground">{entry.doctor.specialization}</p>
                )}
              </td>
              <td className="px-4 py-3 text-center tabular-nums">{entry.testCount}</td>
              <td className="px-4 py-3 text-center tabular-nums">{entry.orderCount}</td>
              {cols.billAmount && (
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{inr(entry.totalRevenue)}</td>
              )}
              {showBreakdown ? (
                <>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{inr(entry.totalExpectedCommission)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-rose-600">{fmtNegDiscount(entry.totalDiscount)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-amber-700 tabular-nums">{inr(entry.totalCommission)}</td>
                </>
              ) : (
                <td className="px-5 py-3 text-right font-semibold text-amber-700 tabular-nums">{inr(entry.totalCommission)}</td>
              )}
            </tr>
          ))}
          <tr className="border-t-2 border-amber-400 dark:border-amber-600 bg-amber-100 dark:bg-amber-900/40">
            <td className="px-5 py-3 font-bold" colSpan={4}>
              Grand Total &nbsp;<span className="font-normal text-xs text-muted-foreground">({grandTotal.doctors} doctors · {grandTotal.orders} visits)</span>
            </td>
            {cols.billAmount && (
              <td className="px-5 py-3 text-right font-bold tabular-nums">{inr(grandTotal.revenue)}</td>
            )}
            {showBreakdown ? (
              <>
                <td className="px-4 py-3 text-right font-bold tabular-nums">{inr(grandTotal.expectedCommission)}</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-rose-600">{fmtNegDiscount(grandTotal.discount)}</td>
                <td className="px-5 py-3 text-right font-bold text-amber-700 tabular-nums text-base">{inr(grandTotal.commission)}</td>
              </>
            ) : (
              <td className="px-5 py-3 text-right font-bold text-amber-700 tabular-nums text-base">{inr(grandTotal.commission)}</td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
