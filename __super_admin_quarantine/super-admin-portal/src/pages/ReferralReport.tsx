import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Printer, Stethoscope, Users, FileText, IndianRupee, TrendingUp, Download, FileSpreadsheet, Percent, Clock, HelpCircle, MessageCircle, Send, Check, AlertTriangle, ChevronRight, ShieldCheck,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";
import { DoctorSearchSelect } from "@/components/DoctorSearchSelect";
import { exportCommissionPdf } from "@/lib/exportCommissionPdf";
import { exportCommissionExcel } from "@/lib/exportCommissionExcel";
import { exportCommissionWord } from "@/lib/exportCommissionWord";
import type { CommissionDoctorEntryX, CommissionTestGroupRowX } from "@/lib/exportCommissionPdf";
import { saveHtmlAsWord } from "@/lib/saveHtmlAsWord";
import { saveAs } from "file-saver";

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
  // Payment-aware eligibility (repeated on each test row of the order)
  held: boolean;
  holdReason: string | null;
  ruleType: string;
  ruleValue: number;
  ruleName: string;
  // Where the rate came from: an explicit test/category slab, the catch-all,
  // the doctor's profile default, or nothing at all.
  ruleScope: RuleScope;
  // "Why this amount?" drill-down
  commissionBase: number;   // price used as the rate base (VIP surcharge stripped)
  vipAdjusted: boolean;     // whether the VIP surcharge was removed from the base
  // Outsourced work: what the external lab is paid, and what the clinic keeps.
  isOutsourced: boolean;
  outsourceCost: number;
  margin: number;           // price − outsourceCost
  // On the margin basis, a fixed-amount slab can still ask for more than the
  // clinic kept. When that happens the payout is capped at the margin.
  cappedToMargin: boolean;
  uncappedCommission: number;
};

type RuleScope = "test" | "category" | "all" | "default" | "none";

type DiscountFmt = "fixed" | "percent";

type DoctorEntry = {
  doctor: { id: number; name: string; specialization: string | null };
  rows: PatientRow[];
  totalCommission: number;            // actual (all)
  payableCommission: number;          // eligible now
  heldCommission: number;             // on hold
  totalExpectedCommission: number;    // expected (pre-discount)
  totalDiscount: number;              // expected − actual (referral discount given up)
  totalRevenue: number;
  orderCount: number;
  testCount: number;
};

type ReportData = {
  report: DoctorEntry[];
  settings?: { vipPct: number; commissionDiscountMode: string; outsourcedBasis?: string };
  grandTotal: { doctors: number; orders: number; revenue: number; commission: number; payableCommission: number; heldCommission: number; expectedCommission: number; discount: number };
};

type ReportMode = "by-doctor" | "test-summary" | "consolidated" | "rate-bands";

type WaResult = {
  doctorId: number; doctorName: string; phone: string | null; amount: number;
  message: string; ok: boolean; skipped?: boolean; error?: string;
};

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

// ── Rate bands ────────────────────────────────────────────────────────────────
// A clinic running hundreds of tests does not want hundreds of rows: it wants to
// see "everything I pay 50% on" in one block. A band is one commission rate, and
// in-house work is banded separately from outsourced work because the two have
// completely different margins even at the same headline rate.
//
// Built once here and reused by the screen, the print sheet and the Excel / Word
// / PDF exports, so every output groups the same way.
type BandTest = {
  testId: number;
  testName: string;
  category: string;
  count: number;
  revenue: number;
  outsourceCost: number;
  /** Sum of the amounts the rate was actually applied to. */
  base: number;
  expected: number;
  commission: number;
  held: number;
  /** true when no test/category slab matched — the rate fell through. */
  fallback: boolean;
  /** How many lines had their payout capped at the margin, and by how much. */
  cappedCount: number;
  cappedSaving: number;
  rows: (PatientRow & { doctorName: string })[];
};

type RateBand = {
  key: string;
  label: string;
  kind: "inhouse" | "outsourced";
  ruleType: string;
  ruleValue: number;
  ruleNames: string[];
  tests: BandTest[];
  count: number;
  revenue: number;
  outsourceCost: number;
  base: number;
  expected: number;
  commission: number;
  held: number;
  cappedCount: number;
  cappedSaving: number;
  /** Distinct doctors and orders inside the band. */
  doctors: number;
  orders: number;
};

const isFallbackScope = (s: RuleScope | undefined) => s === "all" || s === "default" || s === "none";

const bandLabel = (ruleType: string, ruleValue: number) => {
  if (!(ruleValue > 0)) return "No Commission";
  return ruleType === "percentage" ? `${ruleValue}% Commission` : `${inr(ruleValue)} per test`;
};

function buildRateBands(report: DoctorEntry[], categories: Set<string>): RateBand[] {
  const bands = new Map<string, RateBand>();
  const bandDoctors = new Map<string, Set<number>>();
  const bandOrders = new Map<string, Set<number>>();

  for (const entry of report) {
    for (const raw of entry.rows) {
      if (categories.size > 0 && !categories.has(raw.category || "Uncategorised")) continue;
      const row = { ...raw, doctorName: entry.doctor.name };
      const kind: RateBand["kind"] = row.isOutsourced ? "outsourced" : "inhouse";
      // Round the rate before keying so 25 and 25.0 land in the same band.
      const rate = Math.round((row.ruleValue ?? 0) * 100) / 100;
      const key = `${kind}|${row.ruleType}|${rate}`;

      let band = bands.get(key);
      if (!band) {
        band = {
          key, kind,
          label: bandLabel(row.ruleType, rate),
          ruleType: row.ruleType, ruleValue: rate,
          ruleNames: [], tests: [],
          count: 0, revenue: 0, outsourceCost: 0, base: 0, expected: 0, commission: 0, held: 0,
          cappedCount: 0, cappedSaving: 0, doctors: 0, orders: 0,
        };
        bands.set(key, band);
        bandDoctors.set(key, new Set());
        bandOrders.set(key, new Set());
      }
      if (row.ruleName && !band.ruleNames.includes(row.ruleName)) band.ruleNames.push(row.ruleName);
      bandDoctors.get(key)!.add(entry.doctor.id);
      bandOrders.get(key)!.add(row.orderId);

      let test = band.tests.find(t => t.testId === row.testId);
      if (!test) {
        test = {
          testId: row.testId, testName: row.testName, category: row.category,
          count: 0, revenue: 0, outsourceCost: 0, base: 0, expected: 0, commission: 0, held: 0,
          fallback: false, cappedCount: 0, cappedSaving: 0, rows: [],
        };
        band.tests.push(test);
      }
      test.count++; test.revenue += row.price; test.outsourceCost += row.outsourceCost ?? 0;
      test.base += row.commissionBase ?? 0;
      test.expected += row.grossCommission; test.commission += row.commission;
      if (row.held) test.held += row.commission;
      if (row.cappedToMargin) {
        test.cappedCount++;
        test.cappedSaving += (row.uncappedCommission ?? 0) - (row.grossCommission ?? 0);
        band.cappedCount++;
        band.cappedSaving += (row.uncappedCommission ?? 0) - (row.grossCommission ?? 0);
      }
      if (isFallbackScope(row.ruleScope)) test.fallback = true;
      test.rows.push(row);

      band.count++; band.revenue += row.price; band.outsourceCost += row.outsourceCost ?? 0;
      band.base += row.commissionBase ?? 0;
      band.expected += row.grossCommission; band.commission += row.commission;
      if (row.held) band.held += row.commission;
    }
  }

  for (const [key, band] of bands) {
    band.doctors = bandDoctors.get(key)!.size;
    band.orders = bandOrders.get(key)!.size;
    band.tests.sort((a, b) => b.commission - a.commission || a.testName.localeCompare(b.testName));
    for (const t of band.tests) t.rows.sort((a, b) => a.date.localeCompare(b.date) || a.patientName.localeCompare(b.patientName));
  }

  // In-house bands first, then outsourced; inside each, the richest rate first,
  // percentages before fixed amounts, "No Commission" always last.
  return [...bands.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "inhouse" ? -1 : 1;
    const aZero = !(a.ruleValue > 0), bZero = !(b.ruleValue > 0);
    if (aZero !== bZero) return aZero ? 1 : -1;
    if (a.ruleType !== b.ruleType) return a.ruleType === "percentage" ? -1 : 1;
    return b.ruleValue - a.ruleValue;
  });
}

const allCategories = (report: DoctorEntry[]): string[] =>
  [...new Set(report.flatMap(e => e.rows.map(r => r.category || "Uncategorised")))].sort((a, b) => a.localeCompare(b));

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
  .test-row td { background:#f4f6f8; border-top:1px solid #bbb; }
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
  bandCategories: Set<string> = new Set(),
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
  } else if (mode === "rate-bands") {
    // One block per commission rate. Each block lists its tests (with band and
    // test totals) and, underneath each test, the patient lines that make it up.
    const bands = buildRateBands(report, bandCategories);
    body = bands.map(b => {
      const testBlocks = b.tests.map(t => {
        const patientRows = t.rows.map(r => `<tr>
          <td>${fmtDate(r.date)}</td>
          <td>${r.patientName}</td>
          <td>${r.doctorName}</td>
          ${cols.billNo ? `<td>${r.billNumber}</td>` : ""}
          ${cols.orderNo ? `<td>${r.orderNumber}</td>` : ""}
          <td class='right'>${inr(r.price)}</td>
          ${b.kind === "outsourced" ? `<td class='right'>${inr(r.outsourceCost)}</td>` : ""}
          <td class='right'>${inr(r.commission)}</td>
        </tr>`).join("");
        const span = 3 + (cols.billNo ? 1 : 0) + (cols.orderNo ? 1 : 0);
        return `<tr class='test-row'>
            <td colspan='${span}'><strong>${t.testName}</strong>${t.category ? ` <span style='color:#777'>(${t.category})</span>` : ""}${t.fallback ? " <span style='color:#b45309'>[no slab]</span>" : ""} — ${t.count} test${t.count === 1 ? "" : "s"}</td>
            <td class='right'><strong>${inr(t.revenue)}</strong></td>
            ${b.kind === "outsourced" ? `<td class='right'><strong>${inr(t.outsourceCost)}</strong></td>` : ""}
            <td class='right'><strong>${inr(t.commission)}</strong></td>
          </tr>${patientRows}`;
      }).join("");
      const span = 3 + (cols.billNo ? 1 : 0) + (cols.orderNo ? 1 : 0);
      return `<div class='doctor-header'>${b.label} — ${b.kind === "outsourced" ? "Outsourced" : "In-house"}
          <span style='font-weight:400;text-transform:none;letter-spacing:0'>
            (${b.tests.length} test type${b.tests.length === 1 ? "" : "s"} · ${b.count} test${b.count === 1 ? "" : "s"} · ${b.doctors} doctor${b.doctors === 1 ? "" : "s"})
          </span></div>
        <table>
          <thead><tr>
            <th>Date</th><th>Patient Name</th><th>Referring Doctor</th>
            ${cols.billNo ? "<th>Bill No</th>" : ""}
            ${cols.orderNo ? "<th>Order No</th>" : ""}
            <th class='right'>Bill Amt</th>
            ${b.kind === "outsourced" ? "<th class='right'>Lab Cost</th>" : ""}
            <th class='right'>Commission</th>
          </tr></thead>
          <tbody>
            ${testBlocks}
            <tr class='total-row'>
              <td colspan='${span}'><strong>BAND TOTAL — ${b.label} (${b.kind === "outsourced" ? "Outsourced" : "In-house"})</strong></td>
              <td class='right'><strong>${inr(b.revenue)}</strong></td>
              ${b.kind === "outsourced" ? `<td class='right'><strong>${inr(b.outsourceCost)}</strong></td>` : ""}
              <td class='right'><strong>${inr(b.commission)}</strong></td>
            </tr>
          </tbody>
        </table>`;
    }).join("");

    const totCount = bands.reduce((s, b) => s + b.count, 0);
    const totRevenue = bands.reduce((s, b) => s + b.revenue, 0);
    const totCommission = bands.reduce((s, b) => s + b.commission, 0);
    body += `<table style='margin-top:16px'><tbody><tr class='grand-row'>
        <td><strong>GRAND TOTAL (${bands.length} band${bands.length === 1 ? "" : "s"} · ${totCount} tests)</strong></td>
        <td class='right'><strong>${inr(totRevenue)}</strong></td>
        <td class='right'><strong>${inr(totCommission)}</strong></td>
      </tr></tbody></table>`;
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

type XCell = {
  value?: string | number | null;
  type?: typeof String | typeof Number;
  fontWeight?: "bold";
  align?: "left" | "center" | "right";
  backgroundColor?: string;
} | null;

const AMBER = "#FEF3C7";
const GREY = "#E5E7EB";

function patientRowCells(row: PatientRow, cols: ColFlags, discountFmt: DiscountFmt): XCell[] {
  return [
    { value: fmtDate(row.date), type: String },
    { value: row.patientName, type: String },
    { value: row.testName, type: String },
    ...(cols.billNo ? [{ value: row.billNumber, type: String } as XCell] : []),
    ...(cols.orderNo ? [{ value: row.orderNumber, type: String } as XCell] : []),
    ...(cols.category ? [{ value: row.category, type: String } as XCell] : []),
    ...(cols.rate ? [{ value: fmtRate(row.ruleType, row.ruleValue), align: "center" as const } as XCell] : []),
    ...(cols.billAmount ? [{ value: row.price, type: Number, align: "right" as const } as XCell] : []),
    ...(cols.discount ? [{
      value: row.billDiscount > 0 ? fmtDiscount(discountFmt, row.billDiscount, row.billSubtotal) : "—",
      align: "center" as const,
    } as XCell] : []),
    { value: row.commission, type: Number, align: "right" },
  ];
}

function patientHeaderCells(cols: ColFlags, discountFmt: DiscountFmt): XCell[] {
  return [
    { value: "Date", fontWeight: "bold", backgroundColor: GREY },
    { value: "Patient Name", fontWeight: "bold", backgroundColor: GREY },
    { value: "Test Name", fontWeight: "bold", backgroundColor: GREY },
    ...(cols.billNo ? [{ value: "Bill No", fontWeight: "bold", backgroundColor: GREY } as XCell] : []),
    ...(cols.orderNo ? [{ value: "Order No", fontWeight: "bold", backgroundColor: GREY } as XCell] : []),
    ...(cols.category ? [{ value: "Category", fontWeight: "bold", backgroundColor: GREY } as XCell] : []),
    ...(cols.rate ? [{ value: "Rate", fontWeight: "bold", backgroundColor: GREY, align: "center" as const } as XCell] : []),
    ...(cols.billAmount ? [{ value: "Bill Amt", fontWeight: "bold", backgroundColor: GREY, align: "right" as const } as XCell] : []),
    ...(cols.discount ? [{
      value: discountFmt === "percent" ? "Discount %" : "Discount",
      fontWeight: "bold",
      backgroundColor: GREY,
      align: "center" as const,
    } as XCell] : []),
    { value: "Commission", fontWeight: "bold", backgroundColor: GREY, align: "right" },
  ];
}

/** Excel export that mirrors the on-screen By Doctor / Rate Bands layouts (patient-level detail). */
async function exportViewLayoutExcel(
  mode: "by-doctor" | "rate-bands",
  report: DoctorEntry[],
  from: string,
  to: string,
  doctorLabel: string,
  cols: ColFlags,
  discountFmt: DiscountFmt,
  bandCats: Set<string>,
): Promise<void> {
  const rows: XCell[][] = [
    [{ value: "Referral & Commission Report", fontWeight: "bold" }],
    [{ value: `Period: ${from} to ${to} · Doctor: ${doctorLabel}` }],
    [{ value: `View: ${mode === "by-doctor" ? "By Doctor" : "Rate Bands"}` }],
    [null],
  ];

  if (mode === "by-doctor") {
    const header = patientHeaderCells(cols, discountFmt);
    for (const e of report) {
      rows.push([
        { value: e.doctor.name, fontWeight: "bold", backgroundColor: AMBER },
        ...Array(header.length - 1).fill(null),
      ]);
      rows.push(header);
      for (const r of e.rows) rows.push(patientRowCells(r, cols, discountFmt));
      const agg = uniqueBillDiscount(e.rows);
      const totalCells: XCell[] = [
        { value: "TOTAL", fontWeight: "bold" },
        null,
        null,
        ...(cols.billNo ? [null] : []),
        ...(cols.orderNo ? [null] : []),
        ...(cols.category ? [null] : []),
        ...(cols.rate ? [null] : []),
        ...(cols.billAmount ? [{ value: e.totalRevenue, type: Number, fontWeight: "bold", align: "right" } as XCell] : []),
        ...(cols.discount ? [{
          value: agg.discount > 0 ? fmtDiscount(discountFmt, agg.discount, agg.subtotal) : "—",
          fontWeight: "bold",
          align: "center" as const,
        } as XCell] : []),
        { value: e.totalCommission, type: Number, fontWeight: "bold", align: "right" },
      ];
      rows.push(totalCells);
      rows.push([null]);
    }
    if (report.length > 1) {
      const allRows = report.flatMap((e) => e.rows);
      const agg = uniqueBillDiscount(allRows);
      const grandComm = report.reduce((s, e) => s + e.totalCommission, 0);
      const grandRev = report.reduce((s, e) => s + e.totalRevenue, 0);
      rows.push([
        { value: "GRAND TOTAL", fontWeight: "bold", backgroundColor: AMBER },
        null,
        null,
        ...(cols.billNo ? [null] : []),
        ...(cols.orderNo ? [null] : []),
        ...(cols.category ? [null] : []),
        ...(cols.rate ? [null] : []),
        ...(cols.billAmount ? [{ value: grandRev, type: Number, fontWeight: "bold", align: "right" } as XCell] : []),
        ...(cols.discount ? [{
          value: agg.discount > 0 ? fmtDiscount(discountFmt, agg.discount, agg.subtotal) : "—",
          fontWeight: "bold",
          align: "center" as const,
        } as XCell] : []),
        { value: grandComm, type: Number, fontWeight: "bold", align: "right" },
      ]);
    }
  } else {
    const bands = buildRateBands(report, bandCats);
    for (const b of bands) {
      rows.push([
        { value: `${b.label} — ${b.kind === "outsourced" ? "Outsourced" : "In-house"}`, fontWeight: "bold", backgroundColor: AMBER },
        null, null, null,
        ...(cols.billNo ? [null] : []),
        ...(cols.orderNo ? [null] : []),
        { value: b.commission, type: Number, fontWeight: "bold", align: "right" },
      ]);
      rows.push([
        { value: "Date", fontWeight: "bold", backgroundColor: GREY },
        { value: "Patient Name", fontWeight: "bold", backgroundColor: GREY },
        { value: "Referring Doctor", fontWeight: "bold", backgroundColor: GREY },
        ...(cols.billNo ? [{ value: "Bill No", fontWeight: "bold", backgroundColor: GREY } as XCell] : []),
        ...(cols.orderNo ? [{ value: "Order No", fontWeight: "bold", backgroundColor: GREY } as XCell] : []),
        { value: "Bill Amt", fontWeight: "bold", backgroundColor: GREY, align: "right" },
        ...(b.kind === "outsourced" ? [{ value: "Lab Cost", fontWeight: "bold", backgroundColor: GREY, align: "right" as const } as XCell] : []),
        { value: "Commission", fontWeight: "bold", backgroundColor: GREY, align: "right" },
      ]);
      for (const t of b.tests) {
        rows.push([
          { value: `${t.testName}${t.category ? ` (${t.category})` : ""} — ${t.count} test(s)`, fontWeight: "bold" },
          null,
          null,
          ...(cols.billNo ? [null] : []),
          ...(cols.orderNo ? [null] : []),
          { value: t.revenue, type: Number, fontWeight: "bold", align: "right" },
          ...(b.kind === "outsourced" ? [{ value: t.outsourceCost, type: Number, fontWeight: "bold", align: "right" } as XCell] : []),
          { value: t.commission, type: Number, fontWeight: "bold", align: "right" },
        ]);
        for (const r of t.rows) {
          rows.push([
            { value: fmtDate(r.date), type: String },
            { value: r.patientName, type: String },
            { value: r.doctorName, type: String },
            ...(cols.billNo ? [{ value: r.billNumber, type: String } as XCell] : []),
            ...(cols.orderNo ? [{ value: r.orderNumber, type: String } as XCell] : []),
            { value: r.price, type: Number, align: "right" },
            ...(b.kind === "outsourced" ? [{ value: r.outsourceCost, type: Number, align: "right" } as XCell] : []),
            { value: r.commission, type: Number, align: "right" },
          ]);
        }
      }
      rows.push([null]);
    }
    const totRevenue = bands.reduce((s, b) => s + b.revenue, 0);
    const totCommission = bands.reduce((s, b) => s + b.commission, 0);
    rows.push([
      { value: `GRAND TOTAL (${bands.length} bands)`, fontWeight: "bold", backgroundColor: AMBER },
      null, null,
      ...(cols.billNo ? [null] : []),
      ...(cols.orderNo ? [null] : []),
      { value: totRevenue, type: Number, fontWeight: "bold", align: "right" },
      null,
      { value: totCommission, type: Number, fontWeight: "bold", align: "right" },
    ]);
  }

  const writeXlsxFile = (await import("write-excel-file/browser")).default as unknown as (
    sheets: Array<{ data: XCell[][]; sheet?: string; columns?: { width: number }[] }>,
  ) => { toBlob: () => Promise<Blob> };
  const colCount = Math.max(...rows.map((r) => r.length));
  const blob = await writeXlsxFile([{
    data: rows,
    sheet: mode === "by-doctor" ? "By Doctor" : "Rate Bands",
    columns: Array.from({ length: colCount }, () => ({ width: 16 })),
  }]).toBlob();
  saveAs(blob, `Referral_Commission_Report_${mode}_${from}_to_${to}.xlsx`);
}

/** PDF export mirroring By Doctor / Rate Bands on-screen layouts. */
async function exportViewLayoutPdf(
  mode: "by-doctor" | "rate-bands",
  report: DoctorEntry[],
  from: string,
  to: string,
  doctorLabel: string,
  cols: ColFlags,
  discountFmt: DiscountFmt,
  bandCats: Set<string>,
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Referral & Commission Report", pageW / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`${from} to ${to}  ·  ${doctorLabel}  ·  ${mode === "by-doctor" ? "By Doctor" : "Rate Bands"}`, pageW / 2, y, { align: "center" });
  y += 8;

  if (mode === "by-doctor") {
    const head = patientHeaderCells(cols, discountFmt).map((c) => (c?.value != null ? String(c.value) : ""));
    for (const e of report) {
      if (y > 180) { doc.addPage(); y = 14; }
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(e.doctor.name, 14, y);
      y += 4;
      const body = e.rows.map((r) =>
        patientRowCells(r, cols, discountFmt).map((c) => {
          if (c?.value == null) return "";
          if (c.type === Number && typeof c.value === "number") return c.value.toFixed(2);
          return String(c.value);
        }),
      );
      const agg = uniqueBillDiscount(e.rows);
      const totalRow = patientHeaderCells(cols, discountFmt).map((_, i, arr) => {
        const labelIdx = 0;
        const commIdx = arr.length - 1;
        const billIdx = arr.findIndex((h) => h?.value === "Bill Amt");
        const discIdx = arr.findIndex((h) => String(h?.value ?? "").startsWith("Discount"));
        if (i === labelIdx) return "TOTAL";
        if (i === commIdx) return e.totalCommission.toFixed(2);
        if (i === billIdx && billIdx >= 0) return e.totalRevenue.toFixed(2);
        if (i === discIdx && discIdx >= 0) {
          return agg.discount > 0 ? fmtDiscount(discountFmt, agg.discount, agg.subtotal) : "—";
        }
        return "";
      });
      body.push(totalRow);
      autoTable(doc, {
        startY: y,
        head: [head],
        body,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [243, 244, 246], fontStyle: "bold", fontSize: 7 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    }
  } else {
    const bands = buildRateBands(report, bandCats);
    for (const b of bands) {
      if (y > 180) { doc.addPage(); y = 14; }
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(`${b.label} — ${b.kind === "outsourced" ? "Outsourced" : "In-house"}`, 14, y);
      y += 4;
      const head = [
        "Date", "Patient", "Ref. Doctor",
        ...(cols.billNo ? ["Bill No"] : []),
        ...(cols.orderNo ? ["Order No"] : []),
        "Bill Amt",
        ...(b.kind === "outsourced" ? ["Lab Cost"] : []),
        "Commission",
      ];
      const body: string[][] = [];
      for (const t of b.tests) {
        body.push([
          `${t.testName} (${t.count})`, "", "", ...(cols.billNo ? [""] : []), ...(cols.orderNo ? [""] : []),
          t.revenue.toFixed(2),
          ...(b.kind === "outsourced" ? [t.outsourceCost.toFixed(2)] : []),
          t.commission.toFixed(2),
        ]);
        for (const r of t.rows) {
          body.push([
            fmtDate(r.date),
            r.patientName,
            r.doctorName,
            ...(cols.billNo ? [r.billNumber] : []),
            ...(cols.orderNo ? [r.orderNumber] : []),
            r.price.toFixed(2),
            ...(b.kind === "outsourced" ? [r.outsourceCost.toFixed(2)] : []),
            r.commission.toFixed(2),
          ]);
        }
      }
      autoTable(doc, {
        startY: y,
        head: [head],
        body,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [243, 244, 246], fontStyle: "bold", fontSize: 7 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    }
  }

  doc.save(`Referral_Commission_Report_${mode}_${from}_to_${to}.pdf`);
}

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
  // Rate Bands: which categories/groups to include. Empty = every category.
  const [bandCats, setBandCats] = useState<Set<string>>(new Set());

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
  const settings = data?.settings ?? { vipPct: 0, commissionDiscountMode: "none" };
  const grandTotal = data?.grandTotal ?? { doctors: 0, orders: 0, revenue: 0, commission: 0, payableCommission: 0, heldCommission: 0, expectedCommission: 0, discount: 0 };

  // ── WhatsApp: send each doctor their own commission figure ────────────────
  // Always previews first (the endpoint defaults to dryRun), so the operator
  // reads the exact text that will leave the building before anything is sent.
  const [waOpen, setWaOpen] = useState(false);
  const [waSelected, setWaSelected] = useState<Set<number>>(new Set());
  const [waDetail, setWaDetail] = useState<"amount" | "summary" | "breakdown">("summary");
  const [waBasis, setWaBasis] = useState<"payable" | "total">("payable");
  const [waBusy, setWaBusy] = useState(false);
  const [waResults, setWaResults] = useState<WaResult[] | null>(null);
  const [waSent, setWaSent] = useState(false);

  const callWhatsapp = async (dryRun: boolean) => {
    setWaBusy(true);
    try {
      const res = await fetch("/api/commission/whatsapp/send", {
        method: "POST",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorIds: [...waSelected], from, to,
          detail: waDetail, basis: waBasis, dryRun,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setWaResults(j.results as WaResult[]);
      setWaSent(!dryRun);
      if (!dryRun) {
        toast({
          title: `Sent to ${j.sent} doctor${j.sent === 1 ? "" : "s"}`,
          description: j.failed ? `${j.failed} could not be sent — see the list.` : undefined,
          variant: j.failed ? "destructive" : undefined,
        });
      }
    } catch (err) {
      toast({ title: "WhatsApp failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setWaBusy(false);
    }
  };

  const handlePrint = () => {
    const doctorLabel = doctorId
      ? doctors.find(d => d.id === doctorId)?.name ?? "—"
      : "All Doctors";
    const html = buildPrintHtml(mode, report, grandTotal, from, to, doctorLabel, cols, discountFmt, showBreakdown, bandCats);
    const win = window.open("", "_blank", "width=1000,height=750");
    if (!win) { toast({ title: "Pop-up blocked", description: "Please allow pop-ups and try again.", variant: "destructive" }); return; }
    win.document.write(html);
    win.document.close();
  };

  const toggleCol = (key: keyof ColFlags) =>
    setCols(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Adapter: per-patient rows → test-grouped for export helpers ──────────
  // In Rate Bands mode each *band* becomes a section (instead of each doctor),
  // so the Excel / Word / PDF files are organised by commission rate too. The
  // exporters carry two levels — section and test — so the patient lines under
  // each test stay on the screen and the Print sheet, which do carry a third.
  function toBandSections(report: DoctorEntry[]): CommissionDoctorEntryX[] {
    return buildRateBands(report, bandCats).map((b, i) => ({
      doctor: {
        id: -(i + 1),
        name: `${b.label} — ${b.kind === "outsourced" ? "Outsourced" : "In-house"}`,
        specialization: `${b.tests.length} test type${b.tests.length === 1 ? "" : "s"} · ${b.count} test${b.count === 1 ? "" : "s"} · ${b.doctors} doctor${b.doctors === 1 ? "" : "s"}`,
        defaultCommission: b.ruleValue,
        defaultCommissionType: b.ruleType,
      },
      orderCount: b.orders,
      testCount: b.count,
      totalRevenue: b.revenue,
      totalCommission: b.commission,
      totalExpected: b.expected,
      totalDiscount: b.expected - b.commission,
      effectiveRate: b.base > 0 ? Math.round((b.commission / b.base) * 1000) / 10 : 0,
      grouped: b.tests.map(t => ({
        testId: t.testId,
        testName: t.testName,
        category: t.category,
        count: t.count,
        revenue: t.revenue,
        commission: t.commission,
        expected: t.expected,
        ruleName: b.ruleNames[0] ?? "",
        ruleType: b.ruleType,
        ruleValue: b.ruleValue,
      })),
    }) as unknown as CommissionDoctorEntryX);
  }

  function toExportSections(report: DoctorEntry[]): CommissionDoctorEntryX[] {
    if (mode === "rate-bands") return toBandSections(report);
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
  const viewUsesPrintLayout = mode === "by-doctor" || mode === "rate-bands";

  const exportMeta = {
    title: "Referral & Commission Report",
    from,
    to,
    doctorFilter: doctorLabel,
    generatedAt: new Date().toLocaleString("en-IN"),
    grandTotal,
  };
  const exportFileBase = `Referral_Commission_Report_${from}_to_${to}`;

  const handleDownloadExcel = async () => {
    if (report.length === 0) {
      toast({ title: "No data to export", description: "Adjust the filters and try again.", variant: "destructive" });
      return;
    }
    setXlsxLoading(true);
    try {
      if (viewUsesPrintLayout) {
        await exportViewLayoutExcel(mode, report, from, to, doctorLabel, cols, discountFmt, bandCats);
      } else {
        await exportCommissionExcel(
          toExportSections(report),
          exportMeta,
          exportMode,
          cols.rate,
          showBreakdown,
        );
      }
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
      if (viewUsesPrintLayout) {
        const html = buildPrintHtml(mode, report, grandTotal, from, to, doctorLabel, cols, discountFmt, showBreakdown, bandCats);
        saveHtmlAsWord(html.replace(/<script>[\s\S]*?<\/script>/, ""), exportFileBase);
      } else {
        await exportCommissionWord(
          toExportSections(report),
          exportMeta,
          exportMode,
          cols.rate,
          showBreakdown,
        );
      }
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
      if (viewUsesPrintLayout) {
        await exportViewLayoutPdf(mode, report, from, to, doctorLabel, cols, discountFmt, bandCats);
      } else {
        await exportCommissionPdf(
          toExportSections(report),
          exportMeta,
          exportMode,
          cols.rate,
          undefined,
          showBreakdown,
        );
      }
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
                <DoctorSearchSelect
                  className="mt-1 w-72"
                  doctors={doctors}
                  value={doctorId}
                  onChange={setDoctorId}
                  allowAll
                  allLabel="All Doctors"
                  placeholder="Search doctors (e.g. abi)…"
                  wide
                />
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
              <Button
                variant="outline" size="sm" className="gap-1.5"
                disabled={report.length === 0}
                onClick={() => { setWaSelected(new Set(report.map(r => r.doctor.id))); setWaOpen(true); setWaResults(null); }}
              >
                <MessageCircle size={14} /> WhatsApp
              </Button>
            </div>
          </div>

          {/* Mode + column toggles */}
          <div className="flex flex-wrap gap-5 items-start pt-3 border-t border-border">
            <div>
              <Label className="text-xs mb-2 block">Report View</Label>
              <div className="flex gap-1.5">
                {(["by-doctor", "test-summary", "rate-bands", "consolidated"] as ReportMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      mode === m
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    {m === "by-doctor" ? "By Doctor"
                      : m === "test-summary" ? "Test Summary"
                      : m === "rate-bands" ? "Rate Bands"
                      : "Consolidated"}
                  </button>
                ))}
              </div>
            </div>

            {/* Category / group filter — only meaningful for the banded view */}
            {mode === "rate-bands" && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Label className="text-xs">Category / Group</Label>
                  {bandCats.size > 0 && (
                    <button className="text-[10px] text-primary hover:underline" onClick={() => setBandCats(new Set())}>
                      clear ({bandCats.size})
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 max-w-[420px]">
                  {allCategories(report).map(cat => {
                    const on = bandCats.has(cat);
                    return (
                      <button
                        key={cat}
                        onClick={() => {
                          const next = new Set(bandCats);
                          if (on) next.delete(cat); else next.add(cat);
                          setBandCats(next);
                        }}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                          on
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:bg-muted text-muted-foreground"
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 max-w-[420px] leading-snug">
                  Nothing selected = every category. Pick e.g. Pathology and Biochemistry to band only those.
                </p>
              </div>
            )}

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
          {(() => {
            const base = showBreakdown
              ? [
                  { label: "Total Visits",        value: String(grandTotal.orders),          icon: <Users size={16} />,       amber: false },
                  { label: "Expected Commission", value: inr(grandTotal.expectedCommission), icon: <TrendingUp size={16} />,  amber: false },
                  { label: "Discount Given",      value: inr(grandTotal.discount),           icon: <Percent size={16} />,     amber: false },
                  { label: "Payable (Actual)",    value: inr(grandTotal.payableCommission),  icon: <IndianRupee size={16} />, amber: true },
                ]
              : [
                  { label: "Doctors with Referrals", value: String(grandTotal.doctors),        icon: <Stethoscope size={16} />, amber: false },
                  { label: "Total Visits",           value: String(grandTotal.orders),         icon: <Users size={16} />,       amber: false },
                  { label: "Total Revenue",          value: inr(grandTotal.revenue),           icon: <TrendingUp size={16} />,  amber: false },
                  { label: "Commission Payable",     value: inr(grandTotal.payableCommission), icon: <IndianRupee size={16} />, amber: true },
                ];
            if (grandTotal.heldCommission > 0.005) {
              base.push({ label: "On Hold (not payable)", value: inr(grandTotal.heldCommission), icon: <Clock size={16} />, amber: false });
            }
            return base;
          })().map(c => (
            <div key={c.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className={c.amber ? "text-amber-600" : "text-muted-foreground"}>{c.icon}</span>
                <p className="text-xs text-muted-foreground">{c.label}</p>
              </div>
              <p className={`text-xl font-bold ${c.amber ? "text-amber-600" : ""}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Wiring alert — Rate 0% / Commission ₹0 usually means no slab matched */}
        {(() => {
          const noneRows = report.flatMap((d) => d.rows.filter((r) => r.ruleScope === "none"));
          if (noneRows.length === 0) return null;
          const sampleTests = [...new Set(noneRows.map((r) => r.testName))].slice(0, 6);
          return (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-3 text-sm text-amber-900 dark:text-amber-100">
              <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-600" />
              <div className="space-y-1">
                <p className="font-semibold">
                  {noneRows.length} test line{noneRows.length === 1 ? "" : "s"} have no matching commission slab (shown as Rate 0%)
                </p>
                <p className="text-xs leading-relaxed opacity-90">
                  Commission is calculated from each referring doctor&apos;s own slabs.
                  Bound test ids must match the catalogue row on the bill — duplicate
                  names (e.g. two &ldquo;CT BRAIN&rdquo; rows) used to miss; that is now fixed by
                  name-alias matching. Confirm the rule sits on <em>this</em> doctor
                  (not only one profile), and that the billed test is in the slab&apos;s
                  selected list (picker now shows #id).
                  {sampleTests.length > 0 && (
                    <> Unmatched examples: {sampleTests.join(", ")}{sampleTests.length >= 6 ? "…" : ""}.</>
                  )}
                </p>
              </div>
            </div>
          );
        })()}

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
        ) : mode === "rate-bands" ? (
          <RateBandsView
            bands={buildRateBands(report, bandCats)}
            singleDoctor={doctorId != null}
            outsourcedBasis={settings.outsourcedBasis ?? "price"}
          />
        ) : mode === "test-summary" ? (
          <TestSummaryView report={report} grandTotal={grandTotal} cols={cols} showBreakdown={showBreakdown} />
        ) : (
          <ByDoctorView report={report} grandTotal={grandTotal} cols={cols} colCount={colCount} discountFmt={discountFmt} settings={settings} />
        )}
      </div>

      {/* ── Send commission by WhatsApp ────────────────────────────────────── */}
      <Dialog open={waOpen} onOpenChange={(v) => { setWaOpen(v); if (!v) { setWaResults(null); setWaSent(false); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle size={18} className="text-emerald-500" />
              Send commission by WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs mb-1.5 block">How much detail</Label>
                <Select value={waDetail} onValueChange={(v) => { setWaDetail(v as typeof waDetail); setWaResults(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amount">Amount only</SelectItem>
                    <SelectItem value="summary">Amount + referral counts</SelectItem>
                    <SelectItem value="breakdown">Amount + per-test breakdown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Which figure</Label>
                <Select value={waBasis} onValueChange={(v) => { setWaBasis(v as typeof waBasis); setWaResults(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="payable">Payable now (excludes On Hold)</SelectItem>
                    <SelectItem value="total">All commission earned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs">Doctors ({waSelected.size} of {report.length})</Label>
                <div className="flex gap-2">
                  <button className="text-xs text-primary hover:underline"
                    onClick={() => { setWaSelected(new Set(report.map(r => r.doctor.id))); setWaResults(null); }}>Select all</button>
                  <button className="text-xs text-muted-foreground hover:underline"
                    onClick={() => { setWaSelected(new Set()); setWaResults(null); }}>Clear</button>
                </div>
              </div>
              <div className="border border-border rounded-lg max-h-44 overflow-y-auto divide-y divide-border/50">
                {report.map(e => {
                  const amt = waBasis === "payable" ? e.payableCommission : e.totalCommission;
                  const on = waSelected.has(e.doctor.id);
                  return (
                    <label key={e.doctor.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/20">
                      <Checkbox checked={on} onCheckedChange={() => {
                        const next = new Set(waSelected);
                        if (on) next.delete(e.doctor.id); else next.add(e.doctor.id);
                        setWaSelected(next); setWaResults(null);
                      }} />
                      <span className="flex-1 truncate">{e.doctor.name}</span>
                      <span className="font-mono tabular-nums text-amber-500">{inr(amt)}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {waResults && (
              <div>
                <p className="text-xs font-semibold mb-1.5">
                  {waSent ? "Send results" : "Preview — this is exactly what will be sent"}
                </p>
                <div className="border border-border rounded-lg max-h-72 overflow-y-auto divide-y divide-border/50">
                  {waResults.map(r => (
                    <div key={r.doctorId} className="px-3 py-2">
                      <div className="flex items-center gap-2 text-xs mb-1">
                        {r.ok && !r.skipped ? <Check size={13} className="text-emerald-500" />
                          : r.ok ? <MessageCircle size={13} className="text-muted-foreground" />
                          : <AlertTriangle size={13} className="text-rose-500" />}
                        <span className="font-medium">{r.doctorName}</span>
                        <span className="text-muted-foreground font-mono">{r.phone ?? "no number"}</span>
                        {r.error && <span className="text-rose-400">— {r.error}</span>}
                      </div>
                      {r.message && (
                        <pre className="text-[11px] whitespace-pre-wrap bg-muted/30 rounded p-2 leading-relaxed">{r.message}</pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-md border border-amber-900 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-400">
              These messages go to the doctors' own phone numbers and contain their commission figures.
              Preview first — nothing is sent until you press Send.
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWaOpen(false)}>Close</Button>
            <Button variant="outline" disabled={waBusy || waSelected.size === 0} onClick={() => callWhatsapp(true)}>
              {waBusy ? "Working…" : "Preview"}
            </Button>
            <Button
              disabled={waBusy || waSelected.size === 0 || !waResults || waSent}
              onClick={() => callWhatsapp(false)}
              className="gap-1.5"
            >
              <Send size={14} /> {waSent ? "Sent" : `Send to ${waSelected.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Rate Bands view ───────────────────────────────────────────────────────────
// Three levels, each collapsed by default so a clinic with hundreds of tests
// opens onto a handful of band headers instead of thousands of rows:
//   band (one commission rate, in-house and outsourced kept apart)
//     └── test type, with its own totals
//           └── the individual patient lines
function RateBandsView({
  bands, singleDoctor, outsourcedBasis,
}: {
  bands: RateBand[];
  singleDoctor: boolean;
  outsourcedBasis: string;
}) {
  const [openBands, setOpenBands] = useState<Set<string>>(new Set());
  const [openTests, setOpenTests] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    apply(next);
  };

  const totCount = bands.reduce((s, b) => s + b.count, 0);
  const totRevenue = bands.reduce((s, b) => s + b.revenue, 0);
  const totCommission = bands.reduce((s, b) => s + b.commission, 0);
  const totHeld = bands.reduce((s, b) => s + b.held, 0);
  const anyOutsourced = bands.some(b => b.kind === "outsourced");

  if (bands.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm bg-card border border-border rounded-xl">
        <FileText size={32} className="mx-auto mb-3 opacity-30" />
        No tests match the selected categories
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {bands.length} rate band{bands.length === 1 ? "" : "s"} · {totCount} test{totCount === 1 ? "" : "s"}
          {anyOutsourced && (
            <> · outsourced commission charged on <strong>{outsourcedBasis === "margin" ? "margin (price − lab cost)" : "full price"}</strong></>
          )}
        </p>
        <div className="flex gap-2">
          <button className="text-xs text-primary hover:underline"
            onClick={() => setOpenBands(new Set(bands.map(b => b.key)))}>Expand all bands</button>
          <button className="text-xs text-muted-foreground hover:underline"
            onClick={() => { setOpenBands(new Set()); setOpenTests(new Set()); }}>Collapse all</button>
        </div>
      </div>

      {bands.map(band => {
        const bandOpen = openBands.has(band.key);
        // Realised against the amount the rate was actually applied to — not
        // gross revenue. On a margin-basis outsourced band those differ a lot,
        // and revenue would make a full-rate payout look like a small one.
        const effRate = band.base > 0 ? (band.commission / band.base) * 100 : 0;
        return (
          <div key={band.key} className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Band header */}
            <button
              onClick={() => toggle(openBands, band.key, setOpenBands)}
              className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
            >
              <ChevronRight size={16} className={`shrink-0 text-muted-foreground transition-transform ${bandOpen ? "rotate-90" : ""}`} />
              <span className="font-semibold">{band.label}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                band.kind === "outsourced"
                  ? "bg-sky-950 text-sky-300 border border-sky-900"
                  : "bg-muted text-muted-foreground border border-border"
              }`}>
                {band.kind === "outsourced" ? "Outsourced" : "In-house"}
              </span>
              <span className="text-xs text-muted-foreground">
                {band.tests.length} test type{band.tests.length === 1 ? "" : "s"} · {band.count} test{band.count === 1 ? "" : "s"} · {band.doctors} doctor{band.doctors === 1 ? "" : "s"}
              </span>
              <span className="ml-auto flex items-center gap-5 text-sm">
                <span className="text-muted-foreground">
                  Revenue <span className="font-mono tabular-nums text-foreground">{inr(band.revenue)}</span>
                </span>
                {band.kind === "outsourced" && (
                  <span className="text-muted-foreground">
                    Lab cost <span className="font-mono tabular-nums text-foreground">{inr(band.outsourceCost)}</span>
                  </span>
                )}
                <span className="text-muted-foreground" title={`Commission ÷ the amount the rate was applied to (${inr(band.base)}). Below the band rate means discounts ate into it.`}>
                  Realised <span className="font-mono tabular-nums text-foreground">{effRate.toFixed(1)}%</span>
                </span>
                <span className="font-mono tabular-nums font-semibold text-amber-500">{inr(band.commission)}</span>
              </span>
            </button>

            {/* Outsourced bands: warn when commission exceeds what the clinic keeps */}
            {band.kind === "outsourced" && band.commission > band.revenue - band.outsourceCost + 0.005 && (
              <div className="mx-4 mb-3 rounded-md border border-rose-900 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300 flex items-start gap-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>
                  This band pays {inr(band.commission)} on work that only earned the clinic{" "}
                  {inr(band.revenue - band.outsourceCost)} after the external lab was paid — a shortfall of{" "}
                  <strong>{inr(band.commission - (band.revenue - band.outsourceCost))}</strong>.
                  {outsourcedBasis === "price" && " Switch the outsourced basis to Margin, or set an outsourced-only slab."}
                </span>
              </div>
            )}

            {/* The margin cap already stopped a loss here — say so, and by how much */}
            {band.cappedCount > 0 && (
              <div className="mx-4 mb-3 rounded-md border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-300 flex items-start gap-2">
                <ShieldCheck size={13} className="shrink-0 mt-0.5" />
                <span>
                  {band.cappedCount} line{band.cappedCount === 1 ? "" : "s"} in this band asked for more than the
                  clinic kept and {band.cappedCount === 1 ? "was" : "were"} capped at the margin, saving{" "}
                  <strong>{inr(band.cappedSaving)}</strong>. A fixed-amount slab ignores the test price, so it can
                  exceed a thin margin on its own.
                </span>
              </div>
            )}

            {bandOpen && (
              <div className="border-t border-border">
                {band.tests.map(test => {
                  const testKey = `${band.key}#${test.testId}`;
                  const testOpen = openTests.has(testKey);
                  return (
                    <div key={testKey} className="border-b border-border/50 last:border-b-0">
                      {/* Test row */}
                      <button
                        onClick={() => toggle(openTests, testKey, setOpenTests)}
                        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 pl-9 pr-4 py-2 text-left text-sm hover:bg-muted/20 transition-colors"
                      >
                        <ChevronRight size={13} className={`shrink-0 text-muted-foreground transition-transform ${testOpen ? "rotate-90" : ""}`} />
                        <span className="font-medium">{test.testName}</span>
                        {test.category && <span className="text-[11px] text-muted-foreground">{test.category}</span>}
                        {test.fallback && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-400 border border-amber-900">
                            no slab
                          </span>
                        )}
                        {test.cappedCount > 0 && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-900"
                            title={`${test.cappedCount} line(s) capped at the margin, saving ${inr(test.cappedSaving)}`}
                          >
                            capped ×{test.cappedCount}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">×{test.count}</span>
                        <span className="ml-auto flex items-center gap-5">
                          <span className="text-xs text-muted-foreground">
                            Revenue <span className="font-mono tabular-nums text-foreground">{inr(test.revenue)}</span>
                          </span>
                          {band.kind === "outsourced" && (
                            <span className="text-xs text-muted-foreground">
                              Lab cost <span className="font-mono tabular-nums text-foreground">{inr(test.outsourceCost)}</span>
                            </span>
                          )}
                          <span className="font-mono tabular-nums text-amber-500">{inr(test.commission)}</span>
                        </span>
                      </button>

                      {/* Patient lines */}
                      {testOpen && (
                        <div className="overflow-x-auto bg-background/40">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground border-y border-border">
                                <th className="text-left font-medium px-4 py-1.5 pl-14">Date</th>
                                <th className="text-left font-medium px-4 py-1.5">Patient</th>
                                {!singleDoctor && <th className="text-left font-medium px-4 py-1.5">Referring Doctor</th>}
                                <th className="text-left font-medium px-4 py-1.5">Bill / Order</th>
                                <th className="text-right font-medium px-4 py-1.5">Bill Amt</th>
                                {band.kind === "outsourced" && <th className="text-right font-medium px-4 py-1.5">Lab Cost</th>}
                                {band.kind === "outsourced" && <th className="text-right font-medium px-4 py-1.5">Margin</th>}
                                <th className="text-right font-medium px-4 py-1.5">Commission</th>
                              </tr>
                            </thead>
                            <tbody>
                              {test.rows.map((r, i) => (
                                <tr key={`${r.orderId}-${r.testId}-${i}`} className="border-b border-border/30 last:border-b-0">
                                  <td className="px-4 py-1.5 pl-14 whitespace-nowrap">{fmtDate(r.date)}</td>
                                  <td className="px-4 py-1.5">
                                    {r.patientName}
                                    <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">{r.patientPid}</span>
                                  </td>
                                  {!singleDoctor && <td className="px-4 py-1.5">{r.doctorName}</td>}
                                  <td className="px-4 py-1.5 font-mono text-[10px] text-muted-foreground">
                                    {r.billNumber || r.orderNumber}
                                  </td>
                                  <td className="px-4 py-1.5 text-right font-mono tabular-nums">{inr(r.price)}</td>
                                  {band.kind === "outsourced" && (
                                    <td className="px-4 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{inr(r.outsourceCost)}</td>
                                  )}
                                  {band.kind === "outsourced" && (
                                    <td className={`px-4 py-1.5 text-right font-mono tabular-nums ${r.margin < r.commission ? "text-rose-400" : ""}`}>
                                      {inr(r.margin)}
                                    </td>
                                  )}
                                  <td className="px-4 py-1.5 text-right font-mono tabular-nums text-amber-500">
                                    {inr(r.commission)}
                                    {r.cappedToMargin && (
                                      <span
                                        className="ml-1.5 text-[10px] text-emerald-400"
                                        title={`Slab asked for ${inr(r.uncappedCommission)}; capped at the ${inr(r.margin)} margin`}
                                      >
                                        (capped)
                                      </span>
                                    )}
                                    {r.held && <span className="ml-1.5 text-[10px] text-muted-foreground" title={r.holdReason ?? "On hold"}>(hold)</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Grand total across every band */}
      <div className="bg-amber-950/30 border border-amber-900 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1">
        <span className="font-semibold text-amber-400">
          GRAND TOTAL — {bands.length} band{bands.length === 1 ? "" : "s"} · {totCount} test{totCount === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-6 text-sm">
          <span className="text-muted-foreground">
            Revenue <span className="font-mono tabular-nums text-foreground">{inr(totRevenue)}</span>
          </span>
          {totHeld > 0.005 && (
            <span className="text-muted-foreground">
              On hold <span className="font-mono tabular-nums text-foreground">{inr(totHeld)}</span>
            </span>
          )}
          <span className="font-mono tabular-nums font-bold text-amber-400 text-base">{inr(totCommission)}</span>
        </span>
      </div>
    </div>
  );
}

// ── By Doctor view ────────────────────────────────────────────────────────────
function ByDoctorView({
  report, grandTotal, cols, colCount, discountFmt, settings,
}: {
  report: DoctorEntry[];
  grandTotal: ReportData["grandTotal"];
  cols: ColFlags;
  colCount: number;
  discountFmt: DiscountFmt;
  settings: { vipPct: number; commissionDiscountMode: string };
}) {
  const grandDiscount = uniqueBillDiscount(report.flatMap(e => e.rows));
  return (
    <div className="space-y-6">
      {report.map((entry, idx) => (
        <DoctorBlock key={entry.doctor.id} entry={entry} index={idx} cols={cols} colCount={colCount} discountFmt={discountFmt} settings={settings} />
      ))}

      {report.length > 1 && (
        <div className="bg-amber-900/20 border-2 border-amber-700 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
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

// "Why this amount?" drill-down — a click-to-open breakdown of exactly how a
// single test row's commission was derived: price → (VIP stripped) → base →
// × rate = expected → − referral discount = actual, plus any hold reason.
function WhyCommissionPopover({
  row, settings,
}: {
  row: PatientRow;
  settings: { vipPct: number; commissionDiscountMode: string };
}) {
  const discountGiven = Math.max(0, row.grossCommission - row.commission);
  const Line = ({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "muted" | "amber" | "rose" }) => (
    <div className="flex items-center justify-between gap-6 text-xs">
      <span className={tone === "muted" ? "text-muted-foreground" : ""}>{label}</span>
      <span className={`font-mono tabular-nums ${strong ? "font-bold" : ""} ${tone === "amber" ? "text-amber-700 dark:text-amber-500" : tone === "rose" ? "text-rose-600 dark:text-rose-400" : ""}`}>{value}</span>
    </div>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-1 inline-flex align-middle text-muted-foreground/60 hover:text-amber-600 transition-colors"
          title="Why this amount?"
          aria-label="Why this amount?"
        >
          <HelpCircle size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 text-left">
        <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <HelpCircle size={13} className="text-amber-600" /> How this commission was calculated
        </p>
        <div className="space-y-1">
          <Line label="Test price" value={inr(row.price)} tone="muted" />
          {row.vipAdjusted && (
            <>
              <Line label={`VIP surcharge removed (${settings.vipPct}%)`} value={`−${inr(row.price - row.commissionBase)}`} tone="rose" />
              <Line label="Commission base" value={inr(row.commissionBase)} />
            </>
          )}
          <div className="my-1.5 border-t border-border" />
          <Line label={`Rule: ${row.ruleName} (${fmtRate(row.ruleType, row.ruleValue)})`} value="" tone="muted" />
          {row.cappedToMargin && (
            <>
              <Line label="Slab asked for" value={inr(row.uncappedCommission)} tone="muted" />
              <Line label={`Capped at margin (kept ${inr(row.margin)})`} value={`−${inr(row.uncappedCommission - row.grossCommission)}`} tone="rose" />
            </>
          )}
          <Line label="Expected commission" value={inr(row.grossCommission)} />
          {discountGiven > 0.005 && (
            <Line
              label={settings.commissionDiscountMode === "none" ? "Referral discount given" : "Less: bill-discount deduction"}
              value={`−${inr(discountGiven)}`}
              tone="rose"
            />
          )}
          <div className="my-1.5 border-t border-border" />
          <Line label="Actual commission" value={inr(row.commission)} strong tone="amber" />
          {row.held && (
            <div className="mt-2 rounded-md bg-rose-950/30 border border-rose-900 px-2 py-1.5">
              <p className="text-[11px] text-rose-600 dark:text-rose-400 flex items-start gap-1">
                <Clock size={11} className="mt-px shrink-0" />
                <span><span className="font-semibold">On hold — not payable yet.</span> {row.holdReason ?? "Eligibility condition not met."}</span>
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DoctorBlock({
  entry, index, cols, colCount, discountFmt, settings,
}: {
  entry: DoctorEntry;
  index: number;
  cols: ColFlags;
  colCount: number;
  discountFmt: DiscountFmt;
  settings: { vipPct: number; commissionDiscountMode: string };
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
                {cols.category && <td className="px-4 py-2.5"><span className="px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded text-xs">{row.category}</span></td>}
                {cols.rate     && (
                  <td className="px-4 py-2.5 text-center tabular-nums text-xs text-muted-foreground">
                    {fmtRate(row.ruleType, row.ruleValue)}
                  </td>
                )}
                {cols.billAmount && <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{inr(row.price)}</td>}
                {cols.discount && <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">{row.billDiscount > 0 ? fmtDiscount(discountFmt, row.billDiscount, row.billSubtotal) : "—"}</td>}
                <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${row.held ? "text-muted-foreground" : "text-amber-700"}`}>
                  <span className="whitespace-nowrap">{inr(row.commission)}<WhyCommissionPopover row={row} settings={settings} /></span>
                  {row.held && (
                    <span className="block text-[10px] font-normal text-rose-500 leading-tight whitespace-nowrap">⏸ {row.holdReason ?? "On hold"}</span>
                  )}
                </td>
              </tr>
            ))}
            {/* Doctor total row */}
            <tr className="border-t-2 border-amber-700 bg-amber-900/20">
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
                <tr className="border-t-2 border-amber-700 bg-amber-900/20">
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
        <div className="bg-amber-900/20 border-2 border-amber-700 rounded-xl p-4 flex items-center justify-between">
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
          <tr className="border-t-2 border-amber-600 bg-amber-900/40">
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
