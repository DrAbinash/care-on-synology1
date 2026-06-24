import { useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Download, FileSpreadsheet, FileText, Printer, Stethoscope } from "lucide-react";
import {
  loadReportOrientation,
  persistReportOrientation,
  type PaperOrientation,
} from "@/lib/paperSize";
import {
  useGetDetailedCommissionReport,
  type CommissionTestGroupRow,
  type CommissionDoctorEntry,
} from "@workspace/api-client-react";
import { saAuthHeaders } from "@/lib/saApi";
import { exportCommissionPdf } from "@/lib/exportCommissionPdf";
import { exportCommissionExcel } from "@/lib/exportCommissionExcel";
import { exportCommissionWord } from "@/lib/exportCommissionWord";

type SaDoctor = { id: number; name: string };
const SA_DOCTORS_KEY = ["/api/super-admin/doctors-list"] as const;

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ALPHA = ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z"];

type ReportMode = "standard" | "doctor-test" | "consolidated";

function buildPrintCss(orientation: PaperOrientation): string {
  return `
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Arial,sans-serif; font-size:13px; color:#1a1a1a; padding:24px; }
  h1 { font-size:17px; font-weight:700; text-align:center; text-transform:uppercase; letter-spacing:.08em; margin-bottom:6px; }
  .meta { font-size:11px; color:#555; text-align:center; margin-bottom:4px; }
  .doctor-label { font-size:14px; font-weight:700; margin:20px 0 6px; }
  .doctor-sub { font-size:12px; color:#555; margin-bottom:8px; }
  table { width:100%; border-collapse:collapse; margin-bottom:8px; }
  thead tr { background:#f0f0f0; }
  th { padding:7px 10px; text-align:left; font-size:11px; text-transform:uppercase; color:#555; border:1px solid #ddd; }
  th.right, td.right { text-align:right; }
  th.center, td.center { text-align:center; }
  td { padding:7px 10px; border:1px solid #e5e7eb; }
  .total-row td { font-weight:700; background:#fffbeb; border-top:2px solid #d97706; }
  .grand-row td { font-weight:700; background:#fef3c7; font-size:14px; }
  @media print { @page { margin:15mm; size: ${orientation}; } body { padding:0; } }
  `;
}

export default function CommissionReport({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [reportDoctorId, setReportDoctorId] = useState<number | null>(null);
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  });
  const [to, setTo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });

  const [mode, setMode] = useState<ReportMode>("standard");
  const [showPercentFixed, setShowPercentFixed] = useState(true);
  const [orientation, setOrientation] = useState<PaperOrientation>(() => loadReportOrientation());

  const handleOrientationChange = (o: PaperOrientation) => {
    persistReportOrientation(o);
    setOrientation(o);
    handlePrint(o);
  };

  const { data: doctorsData } = useQuery({
    queryKey: SA_DOCTORS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/super-admin/doctors-list", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load doctors");
      return res.json() as Promise<{ doctors: SaDoctor[] }>;
    },
  });
  const doctors: SaDoctor[] = doctorsData?.doctors ?? [];

  const { data, isLoading, error: reportError } = useGetDetailedCommissionReport({
    from,
    to,
    groupBy: "test",
    ...(reportDoctorId !== null ? { doctorId: reportDoctorId } : {}),
  });

  useEffect(() => {
    if (reportError) {
      toast({ title: "Failed to load report", description: String(reportError), variant: "destructive" });
    }
  }, [reportError, toast]);

  const report = data?.report ?? [];
  const grandTotal = data?.grandTotal ?? { doctors: 0, orders: 0, revenue: 0, commission: 0 };

  // ─── Excel Download ────────────────────────────────────────────────────────
  const [xlsxLoading, setXlsxLoading] = useState(false);

  const handleDownloadExcel = async () => {
    if (report.length === 0) {
      toast({ title: "No data to export", description: "Adjust the filters and try again.", variant: "destructive" });
      return;
    }
    setXlsxLoading(true);
    try {
      const doctorLabel = reportDoctorId
        ? doctors.find(d => d.id === reportDoctorId)?.name ?? "—"
        : "All Doctors";
      const title =
        mode === "consolidated"
          ? "Referral Commission – Consolidated Report"
          : mode === "doctor-test"
          ? "Referral Commission – Doctor + Test Detail"
          : "Referral Commission Report";
      await exportCommissionExcel(
        report,
        {
          title,
          from,
          to,
          doctorFilter: doctorLabel,
          generatedAt: new Date().toLocaleString("en-IN"),
          grandTotal,
        },
        mode,
        showPercentFixed,
      );
    } catch (err) {
      toast({ title: "Excel export failed", description: String(err), variant: "destructive" });
    } finally {
      setXlsxLoading(false);
    }
  };

  // ─── Word Download ─────────────────────────────────────────────────────────
  const [wordLoading, setWordLoading] = useState(false);

  const handleDownloadWord = async () => {
    if (report.length === 0) {
      toast({ title: "No data to export", description: "Adjust the filters and try again.", variant: "destructive" });
      return;
    }
    setWordLoading(true);
    try {
      const doctorLabel = reportDoctorId
        ? doctors.find(d => d.id === reportDoctorId)?.name ?? "—"
        : "All Doctors";
      const title =
        mode === "consolidated"
          ? "Referral Commission – Consolidated Report"
          : mode === "doctor-test"
          ? "Referral Commission – Doctor + Test Detail"
          : "Referral Commission Report";
      await exportCommissionWord(
        report,
        {
          title,
          from,
          to,
          doctorFilter: doctorLabel,
          generatedAt: new Date().toLocaleString("en-IN"),
          grandTotal,
        },
        mode,
        showPercentFixed,
      );
    } catch (err) {
      toast({ title: "Word export failed", description: String(err), variant: "destructive" });
    } finally {
      setWordLoading(false);
    }
  };

  // ─── PDF Download ──────────────────────────────────────────────────────────
  const [pdfLoading, setPdfLoading] = useState(false);

  const handleDownloadPdf = async () => {
    if (report.length === 0) {
      toast({ title: "No data to export", description: "Adjust the filters and try again.", variant: "destructive" });
      return;
    }
    setPdfLoading(true);
    try {
      const doctorLabel = reportDoctorId
        ? doctors.find(d => d.id === reportDoctorId)?.name ?? "—"
        : "All Doctors";
      const title =
        mode === "consolidated"
          ? "Referral Commission – Consolidated Report"
          : mode === "doctor-test"
          ? "Referral Commission – Doctor + Test Detail"
          : "Referral Commission Report";
      await exportCommissionPdf(
        report,
        {
          title,
          from,
          to,
          doctorFilter: doctorLabel,
          generatedAt: new Date().toLocaleString("en-IN"),
          grandTotal,
        },
        mode,
        showPercentFixed,
        orientation,
      );
    } catch (err) {
      toast({ title: "PDF export failed", description: String(err), variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  // ─── Print ────────────────────────────────────────────────────────────────
  const handlePrint = (orientationOverride?: PaperOrientation) => {
    const effectiveOrientation = orientationOverride ?? orientation;
    const doctorLabel = reportDoctorId
      ? doctors.find(d => d.id === reportDoctorId)?.name ?? "—"
      : "All Doctors";

    const metaBlock = `
      <h1>${
        mode === "consolidated"
          ? "Referral Commission – Consolidated Report"
          : mode === "doctor-test"
          ? "Referral Commission – Doctor + Test Detail"
          : "Referral Commission Report"
      }</h1>
      <p class="meta">Period: ${from} to ${to} &nbsp;|&nbsp; Doctor: ${doctorLabel}</p>
      <p class="meta">Generated: ${new Date().toLocaleString("en-IN")}</p>
    `;

    let bodyHtml = "";

    if (mode === "consolidated") {
      const rows = report.map((e, i) => `
        <tr>
          <td>${ALPHA[i]?.toUpperCase() ?? i+1})</td>
          <td>${e.doctor.name}</td>
          <td class="right">${inr(e.totalCommission)}</td>
        </tr>
      `).join("");
      const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
      bodyHtml = `
        <table style="margin-top:18px">
          <thead><tr>
            <th style="width:32px">#</th>
            <th>Referral Doctor Name</th>
            <th class="right">Commission Amount</th>
          </tr></thead>
          <tbody>
            ${rows}
            <tr class="grand-row">
              <td colspan="2">Grand Total</td>
              <td class="right">${inr(grandComm)}</td>
            </tr>
          </tbody>
        </table>
      `;
    } else if (mode === "doctor-test") {
      bodyHtml = report.map((e, idx) => {
        const rows = (Array.isArray(e.grouped) ? e.grouped : [] as CommissionTestGroupRow[]).map((row: CommissionTestGroupRow) => `
          <tr>
            <td>${e.doctor.name}</td>
            <td>${row.testName}</td>
            <td class="center">${row.count}</td>
            <td class="right">${inr(row.commission)}</td>
          </tr>
        `).join("");
        const totalRows = rows
          ? `<tr class="total-row">
               <td colspan="3"><strong>${e.doctor.name} – Total</strong></td>
               <td class="right">${inr(e.totalCommission)}</td>
             </tr>`
          : "";
        return `<div style="margin-top:${idx===0?18:0}px">${rows}${totalRows}</div>`;
      }).join("");

      // Wrap all rows in a single table
      const allRows = report.flatMap((e) => {
        const rows = (Array.isArray(e.grouped) ? e.grouped : [] as CommissionTestGroupRow[]).map((row: CommissionTestGroupRow) => `
          <tr>
            <td>${e.doctor.name}</td>
            <td>${row.testName}</td>
            <td class="center">${row.count}</td>
            <td class="right">${inr(row.commission)}</td>
          </tr>
        `);
        rows.push(`<tr class="total-row">
          <td colspan="3"><strong>${e.doctor.name} – Total</strong></td>
          <td class="right">${inr(e.totalCommission)}</td>
        </tr>`);
        return rows;
      }).join("");
      const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);

      bodyHtml = `
        <table style="margin-top:18px">
          <thead><tr>
            <th>Doctor Name</th>
            <th>Test Name</th>
            <th class="center">No. of Tests</th>
            <th class="right">Total Amount</th>
          </tr></thead>
          <tbody>
            ${allRows}
            <tr class="grand-row">
              <td colspan="3">Grand Total</td>
              <td class="right">${inr(grandComm)}</td>
            </tr>
          </tbody>
        </table>
      `;
    } else {
      // Standard report
      bodyHtml = report.map((e, idx) => {
        const rows = (Array.isArray(e.grouped) ? e.grouped : [] as CommissionTestGroupRow[]).map((row: CommissionTestGroupRow) => `
          <tr>
            <td>${row.testName}</td>
            <td class="center">${row.count}</td>
            ${showPercentFixed ? `<td class="center">${row.ruleType === "percentage" ? `${row.ruleValue}%` : inr(row.ruleValue)}</td>` : ""}
            <td class="right">${inr(row.commission)}</td>
          </tr>
        `).join("");
        return `
          <div class="doctor-label">${ALPHA[idx]?.toUpperCase() ?? idx+1}) ${e.doctor.name}</div>
          <div class="doctor-sub">${e.doctor.specialization} · ${e.orderCount} orders · ${e.testCount} tests · Effective Rate: ${e.effectiveRate}%</div>
          <table>
            <thead><tr>
              <th>Test Name</th>
              <th class="center">No. of Tests</th>
              ${showPercentFixed ? `<th class="center">% / Fixed</th>` : ""}
              <th class="right">Total Amount</th>
            </tr></thead>
            <tbody>
              ${rows}
              <tr class="total-row">
                <td colspan="${showPercentFixed ? 3 : 2}">Total →</td>
                <td class="right">${inr(e.totalCommission)}</td>
              </tr>
            </tbody>
          </table>
        `;
      }).join("");

      if (report.length > 1) {
        const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
        bodyHtml += `
          <table class="grand-row" style="margin-top:16px">
            <tbody><tr class="grand-row">
              <td colspan="${showPercentFixed ? 3 : 2}">Grand Total (${grandTotal.doctors} doctors · ${grandTotal.orders} orders)</td>
              <td class="right">${inr(grandComm)}</td>
            </tr></tbody>
          </table>
        `;
      }
    }

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(`
      <html><head>
        <title>Commission Report — ${from} to ${to}</title>
        <style>${buildPrintCss(effectiveOrientation)}</style>
      </head><body>
        ${metaBlock}
        ${bodyHtml}
        <script>window.onload=function(){window.print();}<\/script>
      </body></html>
    `);
    win.document.close();
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full bg-background">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
            <ArrowLeft size={14} className="mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-bold">Commission Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-doctor referral commission breakdown by test
          </p>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
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
                <Select onValueChange={v => setReportDoctorId(v === "all" ? null : Number(v))}>
                  <SelectTrigger className="mt-1 w-52">
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
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-border overflow-hidden text-xs">
                {(["portrait", "landscape"] as PaperOrientation[]).map(o => (
                  <button
                    key={o}
                    onClick={() => handleOrientationChange(o)}
                    className={`px-2.5 py-1.5 font-medium transition-colors capitalize ${
                      orientation === o
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                    title={`Print in ${o}`}
                  >
                    {o === "portrait" ? "↕ Portrait" : "↔ Landscape"}
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => handlePrint()} className="gap-1.5">
                <Printer size={14} /> Print
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadExcel} disabled={xlsxLoading} className="gap-1.5">
                <FileSpreadsheet size={14} /> {xlsxLoading ? "Exporting…" : "Export Excel"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadWord} disabled={wordLoading} className="gap-1.5">
                <FileText size={14} /> {wordLoading ? "Exporting…" : "Download Word"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={pdfLoading} className="gap-1.5">
                <Download size={14} /> {pdfLoading ? "Exporting…" : "Download PDF"}
              </Button>
            </div>
          </div>

          {/* Report type + column selector */}
          <div className="flex flex-wrap gap-4 items-center pt-1 border-t border-border">
            <div>
              <Label className="text-xs mb-1.5 block">Report Type</Label>
              <div className="flex gap-1.5">
                {(["standard", "doctor-test", "consolidated"] as ReportMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      mode === m
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    {m === "standard" ? "Standard" : m === "doctor-test" ? "Doctor + Test" : "Consolidated"}
                  </button>
                ))}
              </div>
            </div>

            {mode === "standard" && (
              <div>
                <Label className="text-xs mb-1.5 block">Print Columns</Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="col-pct"
                    checked={showPercentFixed}
                    onCheckedChange={v => setShowPercentFixed(!!v)}
                  />
                  <label htmlFor="col-pct" className="text-xs cursor-pointer select-none">
                    Show % / Fixed column
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Doctors with Referrals", value: String(grandTotal.doctors), amber: false },
            { label: "Total Orders",           value: String(grandTotal.orders),  amber: false },
            { label: "Total Revenue",          value: inr(grandTotal.revenue),    amber: false },
            { label: "Commission Payable",     value: inr(grandTotal.commission), amber: true  },
          ].map(c => (
            <div key={c.label} className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
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
            No referral data for the selected period / doctor
          </div>
        ) : mode === "consolidated" ? (
          <ConsolidatedView report={report} />
        ) : mode === "doctor-test" ? (
          <DoctorTestView report={report} />
        ) : (
          <StandardView
            report={report}
            grandTotal={grandTotal}
            showPercentFixed={showPercentFixed}
          />
        )}
      </div>
    </div>
  );
}

// ─── Standard view ────────────────────────────────────────────────────────────
function StandardView({
  report,
  grandTotal,
  showPercentFixed,
}: {
  report: CommissionDoctorEntry[];
  grandTotal: { doctors: number; orders: number; revenue: number; commission: number };
  showPercentFixed: boolean;
}) {
  return (
    <div className="space-y-6">
      {report.map((entry, idx) => (
        <CommissionTable
          key={entry.doctor.id}
          entry={entry}
          index={idx}
          showPercentFixed={showPercentFixed}
        />
      ))}
      {report.length > 1 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 flex items-center justify-between dark:bg-amber-900/20 dark:border-amber-700">
          <div>
            <p className="font-bold text-sm">Grand Total</p>
            <p className="text-xs text-muted-foreground">{grandTotal.doctors} doctors · {grandTotal.orders} orders</p>
          </div>
          <div className="flex gap-10">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Revenue</p>
              <p className="font-bold text-base">{inr(grandTotal.revenue)}</p>
            </div>
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

function CommissionTable({
  entry,
  index,
  showPercentFixed,
}: {
  entry: CommissionDoctorEntry;
  index: number;
  showPercentFixed: boolean;
}) {
  const label = ALPHA[index] ?? String(index + 1);
  const rows: CommissionTestGroupRow[] = Array.isArray(entry.grouped) ? entry.grouped : [];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-muted/30">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider w-5">{label})</span>
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Stethoscope size={14} className="text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm">{entry.doctor.name}</p>
          <p className="text-xs text-muted-foreground">
            {entry.doctor.specialization} · {entry.orderCount} orders · {entry.testCount} tests
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Effective Rate</p>
          <p className="font-semibold text-sm">{entry.effectiveRate}%</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-6 text-sm text-muted-foreground text-center">No test data for this period</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Test Name</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">No of Tests</th>
              {showPercentFixed && (
                <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">% / Fixed</th>
              )}
              <th className="text-right px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Total Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.testId}
                className={`border-b border-border last:border-0 ${i % 2 === 1 ? "bg-muted/10" : ""}`}
              >
                <td className="px-5 py-2.5 font-medium">{row.testName}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{row.count}</td>
                {showPercentFixed && (
                  <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">
                    {row.ruleType === "percentage"
                      ? <span className="inline-flex items-center gap-0.5">{row.ruleValue}<span className="text-xs">%</span></span>
                      : <span className="text-xs">{inr(row.ruleValue)}</span>
                    }
                  </td>
                )}
                <td className="px-5 py-2.5 text-right font-semibold text-amber-700 tabular-nums">
                  {inr(row.commission)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
              <td className="px-5 py-3 font-bold text-sm" colSpan={showPercentFixed ? 3 : 2}>
                Total →
              </td>
              <td className="px-5 py-3 text-right font-bold text-base text-amber-700 tabular-nums">
                {inr(entry.totalCommission)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Doctor + Test view ───────────────────────────────────────────────────────
function DoctorTestView({ report }: { report: CommissionDoctorEntry[] }) {
  const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            <th className="text-left px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Doctor Name</th>
            <th className="text-left px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Test Name</th>
            <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">No. of Tests</th>
            <th className="text-right px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Total Amount</th>
          </tr>
        </thead>
        <tbody>
          {report.map((entry) => {
            const rows: CommissionTestGroupRow[] = Array.isArray(entry.grouped) ? entry.grouped : [];
            return (
              <>
                {rows.map((row, i) => (
                  <tr
                    key={`${entry.doctor.id}-${row.testId}`}
                    className={`border-b border-border ${i % 2 === 1 ? "bg-muted/10" : ""}`}
                  >
                    <td className="px-5 py-2.5 font-medium">{i === 0 ? entry.doctor.name : ""}</td>
                    <td className="px-5 py-2.5">{row.testName}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums">{row.count}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-amber-700 tabular-nums">{inr(row.commission)}</td>
                  </tr>
                ))}
                <tr className="border-t border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                  <td className="px-5 py-2 font-bold text-xs text-amber-800 dark:text-amber-400" colSpan={3}>
                    {entry.doctor.name} – Total
                  </td>
                  <td className="px-5 py-2 text-right font-bold text-amber-700 tabular-nums">
                    {inr(entry.totalCommission)}
                  </td>
                </tr>
              </>
            );
          })}
          <tr className="border-t-2 border-amber-400 bg-amber-100 dark:bg-amber-900/40 dark:border-amber-600">
            <td className="px-5 py-3 font-bold" colSpan={3}>Grand Total</td>
            <td className="px-5 py-3 text-right font-bold text-amber-700 tabular-nums text-base">{inr(grandComm)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Consolidated view ────────────────────────────────────────────────────────
function ConsolidatedView({ report }: { report: CommissionDoctorEntry[] }) {
  const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            <th className="text-left px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground w-10">#</th>
            <th className="text-left px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Referral Doctor Name</th>
            <th className="text-right px-5 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Commission Amount</th>
          </tr>
        </thead>
        <tbody>
          {report.map((entry, idx) => (
            <tr
              key={entry.doctor.id}
              className={`border-b border-border ${idx % 2 === 1 ? "bg-muted/10" : ""}`}
            >
              <td className="px-5 py-3 text-muted-foreground text-xs font-bold">{ALPHA[idx]?.toUpperCase() ?? idx+1})</td>
              <td className="px-5 py-3 font-medium">{entry.doctor.name}</td>
              <td className="px-5 py-3 text-right font-semibold text-amber-700 tabular-nums">
                {inr(entry.totalCommission)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-amber-400 bg-amber-100 dark:bg-amber-900/40 dark:border-amber-600">
            <td className="px-5 py-3 font-bold" colSpan={2}>Grand Total</td>
            <td className="px-5 py-3 text-right font-bold text-amber-700 tabular-nums text-base">{inr(grandComm)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
