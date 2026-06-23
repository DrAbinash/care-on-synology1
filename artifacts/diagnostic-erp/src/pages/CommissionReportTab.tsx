/**
 * Commission Report tab for the ERP Referrals page.
 * Mirrors the Super Admin Portal's CommissionReport.tsx mode-selector UI.
 * Renders all three modes (Standard, Doctor+Test, Consolidated) and exports
 * via the shared exportWord / exportPDF / exportExcel helpers in exportReport.ts.
 */
import { useState } from "react";
import {
  useGetDetailedCommissionReport,
  useListDoctors,
  type CommissionDoctorEntry,
  type CommissionTestGroupRow,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  exportWord,
  exportPDF,
  exportExcel,
  type ExportDoctorSection,
  type ReportMeta,
  type WordExportMode,
} from "@/lib/exportReport";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FileSpreadsheet, FileText } from "lucide-react";

const ALPHA = "abcdefghijklmnopqrstuvwxyz".split("");
const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ReportMode = WordExportMode;

// ── Adapter: convert API data → ExportDoctorSection[] ──────────────────────
function toExportSections(report: CommissionDoctorEntry[]): ExportDoctorSection[] {
  return report.map((entry, idx) => ({
    label: `${ALPHA[idx] ?? String(idx + 1)})`,
    doctorName: entry.doctor.name,
    specialization: entry.doctor.specialization,
    orderCount: entry.orderCount,
    testCount: entry.testCount,
    effectiveRate: entry.effectiveRate,
    totalRevenue: entry.totalRevenue,
    totalCommission: entry.totalCommission,
    rows: (Array.isArray(entry.grouped) ? entry.grouped : []).map((r: CommissionTestGroupRow) => ({
      testName: r.testName,
      count: r.count,
      rateLabel: r.ruleType === "percentage" ? `${r.ruleValue}%` : inr(r.ruleValue),
      commission: r.commission,
    })),
  }));
}

function buildMeta(
  mode: ReportMode,
  from: string,
  to: string,
  doctorLabel: string,
  grandTotal: { doctors: number; orders: number; revenue: number; commission: number },
): ReportMeta {
  const title =
    mode === "consolidated"
      ? "Referral Commission – Consolidated Report"
      : mode === "doctor-test"
      ? "Referral Commission – Doctor + Test Detail"
      : "Referral Commission Report";
  return {
    title,
    from,
    to,
    doctorFilter: doctorLabel,
    generatedAt: new Date().toLocaleString("en-IN"),
    grandTotal,
  };
}

// ── Main component ───────────────────────────────────────────────────────────
export default function CommissionReportTab() {
  const { toast } = useToast();

  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [mode, setMode] = useState<ReportMode>("standard");
  const [showPercentFixed, setShowPercentFixed] = useState<boolean>(() => {
    const stored = sessionStorage.getItem("commission_showPercentFixed");
    return stored === null ? true : stored === "true";
  });

  const { data: doctorsData } = useListDoctors();
  const doctors = doctorsData?.doctors ?? [];

  const { data, isLoading } = useGetDetailedCommissionReport({
    from,
    to,
    groupBy: "test",
    ...(doctorId !== null ? { doctorId } : {}),
  });

  const report: CommissionDoctorEntry[] = data?.report ?? [];
  const grandTotal = data?.grandTotal ?? { doctors: 0, orders: 0, revenue: 0, commission: 0 };

  const doctorLabel =
    doctorId !== null
      ? (doctors.find((d) => d.id === doctorId)?.name ?? "—")
      : "All Doctors";

  // ── Word export ────────────────────────────────────────────────────────────
  const [wordLoading, setWordLoading] = useState(false);
  const handleWord = async () => {
    if (report.length === 0) {
      toast({ title: "No data to export", description: "Adjust the filters and try again.", variant: "destructive" });
      return;
    }
    setWordLoading(true);
    try {
      await exportWord(toExportSections(report), buildMeta(mode, from, to, doctorLabel, grandTotal), mode, showPercentFixed);
    } catch (err) {
      toast({ title: "Word export failed", description: String(err), variant: "destructive" });
    } finally {
      setWordLoading(false);
    }
  };

  // ── PDF export ────────────────────────────────────────────────────────────
  const [pdfLoading, setPdfLoading] = useState(false);
  const handlePdf = async () => {
    if (report.length === 0) {
      toast({ title: "No data to export", description: "Adjust the filters and try again.", variant: "destructive" });
      return;
    }
    setPdfLoading(true);
    try {
      await exportPDF(toExportSections(report), buildMeta(mode, from, to, doctorLabel, grandTotal), undefined, showPercentFixed);
    } catch (err) {
      toast({ title: "PDF export failed", description: String(err), variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  // ── Excel export ──────────────────────────────────────────────────────────
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const handleExcel = async () => {
    if (report.length === 0) {
      toast({ title: "No data to export", description: "Adjust the filters and try again.", variant: "destructive" });
      return;
    }
    setXlsxLoading(true);
    try {
      await exportExcel(toExportSections(report), buildMeta(mode, from, to, doctorLabel, grandTotal), showPercentFixed);
    } catch (err) {
      toast({ title: "Excel export failed", description: String(err), variant: "destructive" });
    } finally {
      setXlsxLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Filters card */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end justify-between">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-36"
              />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-36"
              />
            </div>
            <div>
              <Label className="text-xs">Referral Doctor</Label>
              <Select onValueChange={(v) => setDoctorId(v === "all" ? null : Number(v))}>
                <SelectTrigger className="mt-1 w-52">
                  <SelectValue placeholder="All Doctors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Doctors</SelectItem>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExcel}
              disabled={xlsxLoading}
              className="gap-1.5"
            >
              <FileSpreadsheet size={14} />
              {xlsxLoading ? "Exporting…" : "Excel"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleWord}
              disabled={wordLoading}
              className="gap-1.5"
            >
              <FileText size={14} />
              {wordLoading ? "Exporting…" : "Word"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePdf}
              disabled={pdfLoading}
              className="gap-1.5"
            >
              <Download size={14} />
              {pdfLoading ? "Exporting…" : "PDF"}
            </Button>
          </div>
        </div>

        {/* Mode selector + column toggle */}
        <div className="flex flex-wrap gap-4 items-center pt-1 border-t border-border">
          <div>
            <Label className="text-xs mb-1.5 block">Report Type</Label>
            <div className="flex gap-1.5">
              {(["standard", "doctor-test", "consolidated"] as ReportMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    mode === m
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {m === "standard"
                    ? "Standard"
                    : m === "doctor-test"
                    ? "Doctor + Test"
                    : "Consolidated"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Checkbox
              id="word-show-rate"
              checked={showPercentFixed}
              onCheckedChange={(checked) => {
                const val = checked === true;
                setShowPercentFixed(val);
                sessionStorage.setItem("commission_showPercentFixed", String(val));
              }}
            />
            <Label htmlFor="word-show-rate" className="text-xs cursor-pointer select-none">
              Show % / Fixed rate column
            </Label>
          </div>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Doctors with Referrals", value: String(grandTotal.doctors), amber: false },
          { label: "Total Orders", value: String(grandTotal.orders), amber: false },
          { label: "Total Revenue", value: inr(grandTotal.revenue), amber: false },
          { label: "Commission Payable", value: inr(grandTotal.commission), amber: true },
        ].map((c) => (
          <div key={c.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
            <p className={`text-xl font-bold ${c.amber ? "text-amber-600" : ""}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Report body */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-48 bg-muted rounded-xl animate-pulse" />
          ))}
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
          showRate={showPercentFixed}
        />
      )}
    </div>
  );
}

// ── Standard view ─────────────────────────────────────────────────────────────
function StandardView({
  report,
  grandTotal,
  showRate,
}: {
  report: CommissionDoctorEntry[];
  grandTotal: { doctors: number; orders: number; revenue: number; commission: number };
  showRate: boolean;
}) {
  return (
    <div className="space-y-6">
      {report.map((entry, idx) => {
        const testRows: CommissionTestGroupRow[] = Array.isArray(entry.grouped)
          ? entry.grouped
          : [];
        return (
          <div
            key={entry.doctor.id}
            className="bg-card border border-border rounded-xl overflow-hidden"
          >
            <div className="p-4 pb-0">
              <p className="font-bold text-sm">
                {ALPHA[idx]?.toUpperCase() ?? idx + 1}) {entry.doctor.name}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {entry.doctor.specialization} · {entry.orderCount} orders · {entry.testCount}{" "}
                tests · Eff. Rate: {entry.effectiveRate}%
              </p>
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-xs text-muted-foreground">
                    <th className="text-left px-4 py-2 font-medium">Test Name</th>
                    <th className="text-center px-4 py-2 font-medium">No. of Tests</th>
                    {showRate && <th className="text-center px-4 py-2 font-medium">% / Fixed</th>}
                    <th className="text-right px-4 py-2 font-medium">Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {testRows.map((row) => (
                    <tr
                      key={row.testId}
                      className="border-t border-border hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2">{row.testName}</td>
                      <td className="px-4 py-2 text-center">{row.count}</td>
                      {showRate && (
                        <td className="px-4 py-2 text-center">
                          {row.ruleType === "percentage"
                            ? `${row.ruleValue}%`
                            : inr(row.ruleValue)}
                        </td>
                      )}
                      <td className="px-4 py-2 text-right">{inr(row.commission)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 font-bold">
                    <td
                      colSpan={showRate ? 3 : 2}
                      className="px-4 py-2 text-right text-sm"
                    >
                      Total →
                    </td>
                    <td className="px-4 py-2 text-right text-amber-700 dark:text-amber-400">
                      {inr(entry.totalCommission)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {report.length > 1 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 flex items-center justify-between dark:bg-amber-900/20 dark:border-amber-700">
          <div>
            <p className="font-bold text-sm">Grand Total</p>
            <p className="text-xs text-muted-foreground">
              {grandTotal.doctors} doctors · {grandTotal.orders} orders
            </p>
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

// ── Doctor + Test view ────────────────────────────────────────────────────────
function DoctorTestView({ report }: { report: CommissionDoctorEntry[] }) {
  const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">Doctor Name</th>
              <th className="text-left px-4 py-2 font-medium">Test Name</th>
              <th className="text-center px-4 py-2 font-medium">No. of Tests</th>
              <th className="text-right px-4 py-2 font-medium">Total Amount</th>
            </tr>
          </thead>
          <tbody>
            {report.flatMap((entry) => {
              const testRows: CommissionTestGroupRow[] = Array.isArray(entry.grouped)
                ? entry.grouped
                : [];
              return [
                ...testRows.map((row) => (
                  <tr
                    key={`${entry.doctor.id}-${row.testId}`}
                    className="border-t border-border hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-2">{entry.doctor.name}</td>
                    <td className="px-4 py-2">{row.testName}</td>
                    <td className="px-4 py-2 text-center">{row.count}</td>
                    <td className="px-4 py-2 text-right">{inr(row.commission)}</td>
                  </tr>
                )),
                <tr
                  key={`subtotal-${entry.doctor.id}`}
                  className="border-t-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 font-bold"
                >
                  <td colSpan={3} className="px-4 py-2 text-sm">
                    {entry.doctor.name} – Total
                  </td>
                  <td className="px-4 py-2 text-right text-amber-700 dark:text-amber-400">
                    {inr(entry.totalCommission)}
                  </td>
                </tr>,
              ];
            })}
            <tr className="border-t-2 border-amber-400 bg-amber-100 dark:bg-amber-900/40 font-bold text-sm">
              <td colSpan={3} className="px-4 py-3">
                Grand Total
              </td>
              <td className="px-4 py-3 text-right text-amber-700 dark:text-amber-400">
                {inr(grandComm)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Consolidated view ─────────────────────────────────────────────────────────
function ConsolidatedView({ report }: { report: CommissionDoctorEntry[] }) {
  const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium w-10">#</th>
              <th className="text-left px-4 py-2 font-medium">Referral Doctor Name</th>
              <th className="text-right px-4 py-2 font-medium">Commission Amount</th>
            </tr>
          </thead>
          <tbody>
            {report.map((entry, idx) => (
              <tr
                key={entry.doctor.id}
                className="border-t border-border hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-2 text-muted-foreground">
                  {ALPHA[idx]?.toUpperCase() ?? idx + 1})
                </td>
                <td className="px-4 py-2">{entry.doctor.name}</td>
                <td className="px-4 py-2 text-right">{inr(entry.totalCommission)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-amber-400 bg-amber-100 dark:bg-amber-900/40 font-bold text-sm">
              <td colSpan={2} className="px-4 py-3">
                Grand Total
              </td>
              <td className="px-4 py-3 text-right text-amber-700 dark:text-amber-400">
                {inr(grandComm)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
