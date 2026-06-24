/**
 * Commission report Excel export for the Super Admin Portal.
 * Handles all three report modes: standard, doctor-test, and consolidated.
 * Produces a two-sheet .xlsx: "Summary" + "Detailed Report".
 */

import { saveAs } from "file-saver";
import type { CommissionDoctorEntry, CommissionTestGroupRow } from "@workspace/api-client-react";
import type { CommissionPdfMeta, CommissionReportMode } from "@/lib/exportCommissionPdf";

type RCell = {
  value?: string | number | null;
  type?: typeof String | typeof Number;
  fontWeight?: "bold";
  color?: string;
  backgroundColor?: string;
  align?: "left" | "center" | "right";
  span?: number;
} | null;

const HEADER_BG = "#F3F4F6";
const AMBER_BG  = "#FEF3C7";
const ALPHA = ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z"];

function headerRows(meta: CommissionPdfMeta, spanCount: number): RCell[][] {
  const span = spanCount;
  return [
    [{ value: meta.title, fontWeight: "bold", span }],
    [{ value: `Date Range: ${meta.from} to ${meta.to}`, span }],
    [{ value: `Doctor: ${meta.doctorFilter}`, span }],
    [{ value: `Generated: ${meta.generatedAt}`, span }],
    [null],
  ];
}

function summaryStatsRows(meta: CommissionPdfMeta): RCell[][] {
  const g = meta.grandTotal;
  return [
    [
      { value: "Doctors with Referrals", fontWeight: "bold", backgroundColor: AMBER_BG },
      { value: "Total Orders",           fontWeight: "bold", backgroundColor: AMBER_BG },
      { value: "Total Revenue",          fontWeight: "bold", backgroundColor: AMBER_BG },
      { value: "Commission Payable",     fontWeight: "bold", backgroundColor: AMBER_BG },
    ],
    [
      { value: g.doctors,    align: "center" },
      { value: g.orders,     align: "center" },
      { value: g.revenue,    align: "right"  },
      { value: g.commission, fontWeight: "bold", color: "#B45309", align: "right" },
    ],
    [null],
  ];
}

// ── Standard mode ─────────────────────────────────────────────────────────────
function buildStandardSheets(
  report: CommissionDoctorEntry[],
  meta: CommissionPdfMeta,
  showPercentFixed: boolean,
): { summaryData: RCell[][]; detailData: RCell[][] } {
  const summaryData: RCell[][] = [
    ...headerRows(meta, 7),
    ...summaryStatsRows(meta),
    [
      { value: "Doctor",           fontWeight: "bold", backgroundColor: HEADER_BG },
      { value: "Specialization",   fontWeight: "bold", backgroundColor: HEADER_BG },
      { value: "Orders",           fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
      { value: "Tests",            fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
      { value: "Total Revenue",    fontWeight: "bold", backgroundColor: HEADER_BG, align: "right"  },
      { value: "Total Commission", fontWeight: "bold", backgroundColor: HEADER_BG, align: "right"  },
      { value: "Eff. Rate %",      fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
    ],
  ];

  for (const s of report) {
    summaryData.push([
      { value: s.doctor.name,          type: String },
      { value: s.doctor.specialization ?? "", type: String },
      { value: s.orderCount,           align: "center" },
      { value: s.testCount,            align: "center" },
      { value: s.totalRevenue ?? 0,    align: "right"  },
      { value: s.totalCommission,      align: "right"  },
      { value: Number(s.effectiveRate), align: "center" },
    ]);
  }

  const detailData: RCell[][] = [
    ...headerRows(meta, showPercentFixed ? 4 : 3),
  ];

  for (const [idx, s] of report.entries()) {
    const label = `${ALPHA[idx]?.toUpperCase() ?? String(idx + 1)})`;
    const rows: CommissionTestGroupRow[] = Array.isArray(s.grouped) ? s.grouped : [];

    detailData.push([
      { value: `${label} ${s.doctor.name}`, fontWeight: "bold" },
      { value: s.doctor.specialization ?? "", type: String },
      { value: `${s.orderCount} orders`, type: String },
      ...(showPercentFixed ? [{ value: `Eff. Rate: ${s.effectiveRate}%`, type: String } as RCell] : []),
    ]);

    if (showPercentFixed) {
      detailData.push([
        { value: "Test Name",          fontWeight: "bold", backgroundColor: HEADER_BG },
        { value: "No of Tests",        fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
        { value: "% / Fixed",          fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
        { value: "Total Amount (Rs.)", fontWeight: "bold", backgroundColor: HEADER_BG, align: "right"  },
      ]);
    } else {
      detailData.push([
        { value: "Test Name",          fontWeight: "bold", backgroundColor: HEADER_BG },
        { value: "No of Tests",        fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
        { value: "Total Amount (Rs.)", fontWeight: "bold", backgroundColor: HEADER_BG, align: "right"  },
      ]);
    }

    for (const r of rows) {
      const rateLabel = r.ruleType === "percentage" ? `${r.ruleValue}%` : `Rs.${r.ruleValue}`;
      if (showPercentFixed) {
        detailData.push([
          { value: r.testName, type: String },
          { value: r.count,    align: "center" },
          { value: rateLabel,  type: String, align: "center" },
          { value: r.commission, align: "right" },
        ]);
      } else {
        detailData.push([
          { value: r.testName, type: String },
          { value: r.count,    align: "center" },
          { value: r.commission, align: "right" },
        ]);
      }
    }

    detailData.push([
      ...(showPercentFixed
        ? [null as RCell, null as RCell,
           { value: "Total \u2192", fontWeight: "bold", backgroundColor: AMBER_BG, align: "right" } as RCell,
           { value: s.totalCommission, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" } as RCell]
        : [null as RCell,
           { value: "Total \u2192", fontWeight: "bold", backgroundColor: AMBER_BG, align: "right" } as RCell,
           { value: s.totalCommission, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" } as RCell]),
    ]);
    detailData.push([null]);
  }

  if (report.length > 1) {
    const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
    detailData.push([
      { value: "Grand Total", fontWeight: "bold", backgroundColor: AMBER_BG },
      ...(showPercentFixed
        ? [null as RCell, null as RCell,
           { value: grandComm, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" } as RCell]
        : [null as RCell,
           { value: grandComm, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" } as RCell]),
    ]);
  }

  return { summaryData, detailData };
}

// ── Doctor-Test mode ──────────────────────────────────────────────────────────
function buildDoctorTestSheets(
  report: CommissionDoctorEntry[],
  meta: CommissionPdfMeta,
): { summaryData: RCell[][]; detailData: RCell[][] } {
  const summaryData: RCell[][] = [
    ...headerRows(meta, 4),
    ...summaryStatsRows(meta),
    [
      { value: "Doctor Name",    fontWeight: "bold", backgroundColor: HEADER_BG },
      { value: "No. of Tests",   fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
      { value: "Total Commission", fontWeight: "bold", backgroundColor: HEADER_BG, align: "right" },
    ],
  ];

  for (const e of report) {
    summaryData.push([
      { value: e.doctor.name, type: String },
      { value: e.testCount,   align: "center" },
      { value: e.totalCommission, align: "right", fontWeight: "bold" },
    ]);
  }

  const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
  summaryData.push([
    { value: "Grand Total", fontWeight: "bold", backgroundColor: AMBER_BG },
    null,
    { value: grandComm, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" },
  ]);

  const detailData: RCell[][] = [
    ...headerRows(meta, 4),
    [
      { value: "Doctor Name",    fontWeight: "bold", backgroundColor: HEADER_BG },
      { value: "Test Name",      fontWeight: "bold", backgroundColor: HEADER_BG },
      { value: "No. of Tests",   fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
      { value: "Total Amount (Rs.)", fontWeight: "bold", backgroundColor: HEADER_BG, align: "right" },
    ],
  ];

  for (const e of report) {
    const rows: CommissionTestGroupRow[] = Array.isArray(e.grouped) ? e.grouped : [];
    for (const r of rows) {
      detailData.push([
        { value: e.doctor.name, type: String },
        { value: r.testName, type: String },
        { value: r.count, align: "center" },
        { value: r.commission, align: "right" },
      ]);
    }
    detailData.push([
      { value: `${e.doctor.name} – Total`, fontWeight: "bold", backgroundColor: AMBER_BG },
      null,
      null,
      { value: e.totalCommission, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" },
    ]);
  }

  detailData.push([
    { value: "Grand Total", fontWeight: "bold", backgroundColor: AMBER_BG },
    null,
    null,
    { value: grandComm, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" },
  ]);

  return { summaryData, detailData };
}

// ── Consolidated mode ─────────────────────────────────────────────────────────
function buildConsolidatedSheets(
  report: CommissionDoctorEntry[],
  meta: CommissionPdfMeta,
): { summaryData: RCell[][]; detailData: RCell[][] } {
  const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);

  // Summary sheet: one row per doctor with high-level totals
  const summaryData: RCell[][] = [
    ...headerRows(meta, 4),
    ...summaryStatsRows(meta),
    [
      { value: "#",                    fontWeight: "bold", backgroundColor: HEADER_BG },
      { value: "Referral Doctor Name", fontWeight: "bold", backgroundColor: HEADER_BG },
      { value: "Specialization",       fontWeight: "bold", backgroundColor: HEADER_BG },
      { value: "Commission Amount",    fontWeight: "bold", backgroundColor: HEADER_BG, align: "right" },
    ],
    ...report.map((e, i) => [
      { value: `${ALPHA[i]?.toUpperCase() ?? String(i + 1)})`, type: String } as RCell,
      { value: e.doctor.name, type: String } as RCell,
      { value: e.doctor.specialization ?? "", type: String } as RCell,
      { value: e.totalCommission, align: "right" } as RCell,
    ]),
    [
      { value: "Grand Total", fontWeight: "bold", backgroundColor: AMBER_BG, span: 3 },
      { value: grandComm, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" },
    ],
  ];

  // Detailed Report sheet: per-doctor test-level breakdown
  const detailData: RCell[][] = [
    ...headerRows(meta, 4),
    [
      { value: "Doctor Name",           fontWeight: "bold", backgroundColor: HEADER_BG },
      { value: "Test Name",             fontWeight: "bold", backgroundColor: HEADER_BG },
      { value: "No. of Tests",          fontWeight: "bold", backgroundColor: HEADER_BG, align: "center" },
      { value: "Total Amount (Rs.)",    fontWeight: "bold", backgroundColor: HEADER_BG, align: "right" },
    ],
  ];

  for (const e of report) {
    const rows: CommissionTestGroupRow[] = Array.isArray(e.grouped) ? e.grouped : [];
    for (const r of rows) {
      detailData.push([
        { value: e.doctor.name, type: String },
        { value: r.testName, type: String },
        { value: r.count, align: "center" },
        { value: r.commission, align: "right" },
      ]);
    }
    detailData.push([
      { value: `${e.doctor.name} – Total`, fontWeight: "bold", backgroundColor: AMBER_BG, span: 3 },
      { value: e.totalCommission, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" },
    ]);
  }

  detailData.push([
    { value: "Grand Total", fontWeight: "bold", backgroundColor: AMBER_BG, span: 3 },
    { value: grandComm, fontWeight: "bold", backgroundColor: AMBER_BG, color: "#B45309", align: "right" },
  ]);

  return { summaryData, detailData };
}

// ── Public export ─────────────────────────────────────────────────────────────
export async function exportCommissionExcel(
  report: CommissionDoctorEntry[],
  meta: CommissionPdfMeta,
  mode: CommissionReportMode,
  showPercentFixed: boolean,
): Promise<void> {
  const writeXlsxFile = (await import("write-excel-file/browser")).default as unknown as (
    sheets: Array<{ data: RCell[][]; sheet?: string; columns?: { width: number }[] }>
  ) => { toBlob: () => Promise<Blob> };

  let summaryData: RCell[][];
  let detailData: RCell[][];

  if (mode === "consolidated") {
    ({ summaryData, detailData } = buildConsolidatedSheets(report, meta));
  } else if (mode === "doctor-test") {
    ({ summaryData, detailData } = buildDoctorTestSheets(report, meta));
  } else {
    ({ summaryData, detailData } = buildStandardSheets(report, meta, showPercentFixed));
  }

  const sheets =
    mode === "consolidated"
    ? [
        { data: summaryData, sheet: "Summary",         columns: [{ width: 6 }, { width: 28 }, { width: 20 }, { width: 20 }] },
        { data: detailData,  sheet: "Detailed Report", columns: [{ width: 28 }, { width: 28 }, { width: 14 }, { width: 20 }] },
      ]
    : mode === "doctor-test"
    ? [
        { data: summaryData, sheet: "Summary",         columns: [{ width: 28 }, { width: 14 }, { width: 18 }] },
        { data: detailData,  sheet: "Detailed Report", columns: [{ width: 28 }, { width: 28 }, { width: 14 }, { width: 20 }] },
      ]
    : [
        { data: summaryData, sheet: "Summary",         columns: [{ width: 28 }, { width: 20 }, { width: 10 }, { width: 10 }, { width: 16 }, { width: 18 }, { width: 12 }] },
        { data: detailData,  sheet: "Detailed Report", columns: showPercentFixed
            ? [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 18 }]
            : [{ width: 30 }, { width: 14 }, { width: 18 }] },
      ];

  const blob = await writeXlsxFile(sheets).toBlob();
  const safeName = meta.title.replace(/\s+/g, "_");
  saveAs(blob, `${safeName}_${meta.from}_to_${meta.to}.xlsx`);
}
