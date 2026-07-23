import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer, RefreshCcw, AlertTriangle, CheckCircle2, FileText, FileType } from "lucide-react";
import {
  exportStatementsPDF, exportStatementsWord,
  type StmtSheet, type StmtRow, type StmtColumn,
} from "@/lib/statementExport";

/**
 * FinancialStatements — Schedule III (Revised) style, print- and export-ready
 * Balance Sheet + Statement of Profit and Loss + Trial Balance, built to
 * mirror the auditor-prepared statements the clinic files.
 *
 * • Two comparative columns (current period vs. the same period one year
 *   earlier), a "Note No." column, "In ₹", grand totals and a proprietor
 *   signature block — the anatomy of a filed statement.
 * • ONE row model per statement feeds both the on-screen view and the PDF /
 *   Word exporters, so what you see is exactly what prints/exports.
 * • Each statement is a separate sheet: on print it page-breaks, and PDF / Word
 *   put each report on its own page.
 * • Figures are the ledger's own balances (from the accounting API); nothing is
 *   fabricated. Standard lines with no matching ledger render as "-".
 */

// ── Types (mirror the accounting report endpoints) ────────────────────────────

interface BSLine { name: string; group: string; amount: number; naturalSide?: "asset" | "liability"; abnormal?: boolean }
interface BalanceSheetResp {
  assets: BSLine[]; liabilities: BSLine[];
  totalAssets: number; totalLiabilities: number; netProfit: number; balanced: boolean;
}
interface PLLine { name: string; group: string; amount: number }
interface ProfitLossResp {
  income: PLLine[]; expenses: PLLine[];
  totalIncome: number; totalExpenses: number; netProfit: number;
}
interface TBRow { id: number; name: string; tallyGroup: string; balanceDr: number; balanceCr: number }
interface TrialBalanceResp { rows: TBRow[]; totalDr: number; totalCr: number; balanced: boolean }
interface Branding { name?: string; tagline?: string; address?: string; registeredAddress?: string; gstin?: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const IND = "    "; // 4 non-breaking spaces — indent that survives HTML, PDF and Word

function shiftYearsISO(iso: string, years: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}
function fmtDMY(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}
/** Indian-style money — blank/zero renders as "-" to match filed statements. */
function money(n: number | undefined): string {
  if (!n || Math.abs(n) < 0.005) return "-";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Schedule III line-item classification ─────────────────────────────────────

type Matcher = (line: BSLine) => boolean;
const grp = (...keys: string[]): Matcher => (l) => keys.some((k) => (l.group || "").toLowerCase().includes(k.toLowerCase()));
const nameHas = (...keys: string[]): Matcher => (l) => keys.some((k) => (l.name || "").toLowerCase().includes(k.toLowerCase()));
const either = (...ms: Matcher[]): Matcher => (l) => ms.some((m) => m(l));

interface StdLine { key: string; label: string; match: Matcher }
interface Section { key: string; label: string; lines: StdLine[] }

const EQUITY_LIAB_SECTIONS: Section[] = [
  { key: "owners-fund", label: "Owners' Fund", lines: [
    { key: "capital", label: "Owners Capital Account", match: grp("Capital Account") },
    { key: "reserves", label: "Reserves and surplus", match: either(grp("Reserves"), nameHas("Net Profit", "Reserve", "Surplus")) },
  ] },
  { key: "non-current-liab", label: "Non-current liabilities", lines: [
    { key: "ltb", label: "Long-term borrowings", match: grp("Loans (Liability)", "Unsecured Loans", "Term Loan", "Secured Loan") },
    { key: "dtl", label: "Deferred tax liabilities (Net)", match: nameHas("Deferred Tax") },
    { key: "oltl", label: "Other Long term liabilities", match: nameHas("Long Term Liab") },
    { key: "ltp", label: "Long-term provisions", match: nameHas("Long Term Provision") },
  ] },
  { key: "current-liab", label: "Current liabilities", lines: [
    { key: "stb", label: "Short-term borrowings", match: either(grp("Bank OD"), nameHas("Overdraft", "Short Term Borrow")) },
    { key: "payables", label: "Trade payables", match: grp("Sundry Creditors", "Trade Payable") },
    { key: "ocl", label: "Other current liabilities", match: either(grp("Current Liabilities", "Duties & Taxes"), nameHas("Payable", "GST", "TDS", "Tax")) },
    { key: "stp", label: "Short-term provisions", match: nameHas("Provision") },
  ] },
];

const ASSET_SECTIONS: Section[] = [
  { key: "non-current-assets", label: "Non-current assets", lines: [
    { key: "ppe", label: "Property, Plant and Equipment", match: either(grp("Fixed Assets"), nameHas("Equipment", "Machinery", "Furniture", "Building", "Vehicle")) },
    { key: "intangible", label: "Intangible assets", match: nameHas("Intangible", "Goodwill", "Software") },
    { key: "nc-inv", label: "Non-current investments", match: grp("Investments") },
    { key: "ltla", label: "Long-term loans and advances", match: grp("Loans & Advances (Asset)") },
    { key: "onca", label: "Other non-current assets", match: nameHas("Non Current Asset") },
  ] },
  { key: "current-assets", label: "Current assets", lines: [
    { key: "cur-inv", label: "Current investments", match: nameHas("Current Investment") },
    { key: "inventory", label: "Inventories", match: either(grp("Stock", "Inventory"), nameHas("Inventor", "Stock")) },
    { key: "receivables", label: "Trade receivables", match: grp("Sundry Debtors", "Trade Receivable") },
    { key: "cash", label: "Cash and cash equivalents", match: grp("Cash-in-Hand", "Bank Accounts") },
    { key: "stla", label: "Short-term loans and advances", match: nameHas("Advance", "Loan") },
    { key: "oca", label: "Other current assets", match: () => true },
  ] },
];

function classifyLines(lines: BSLine[], sections: Section[], fallbackKey: string): Map<string, { total: number; ledgers: BSLine[] }> {
  const bucket = new Map<string, { total: number; ledgers: BSLine[] }>();
  const add = (key: string, line: BSLine) => {
    const cur = bucket.get(key) ?? { total: 0, ledgers: [] };
    cur.total += line.amount; cur.ledgers.push(line); bucket.set(key, cur);
  };
  for (const line of lines) {
    let placed = false;
    for (const sec of sections) {
      for (const std of sec.lines) { if (std.match(line)) { add(std.key, line); placed = true; break; } }
      if (placed) break;
    }
    if (!placed) add(fallbackKey, line);
  }
  return bucket;
}

// ── Row-model builders (shared by screen + export) ────────────────────────────

const AMOUNT_COLS_BS: StmtColumn[] = [
  { header: "Particulars", align: "left", widthPct: 50 },
  { header: "Note No.", align: "center", widthPct: 10 },
  { header: "", align: "right", widthPct: 20 },
  { header: "", align: "right", widthPct: 20 },
];

function buildBalanceSheetRows(
  liabCur: Map<string, { total: number; ledgers: BSLine[] }>,
  liabPrev: Map<string, { total: number; ledgers: BSLine[] }>,
  assetCur: Map<string, { total: number; ledgers: BSLine[] }>,
  assetPrev: Map<string, { total: number; ledgers: BSLine[] }>,
  notes: Map<string, string>,
  bs?: BalanceSheetResp, bsPrev?: BalanceSheetResp,
): StmtRow[] {
  const rows: StmtRow[] = [];
  const side = (sections: Section[], cur: Map<string, { total: number; ledgers: BSLine[] }>, prev: Map<string, { total: number; ledgers: BSLine[] }>, banner: string) => {
    rows.push({ cells: [{ text: banner, colspan: 4 }], bold: true, shaded: true });
    for (const sec of sections) {
      rows.push({ cells: [{ text: sec.label }, { text: "" }, { text: "", align: "right" }, { text: "", align: "right" }], bold: true });
      for (const std of sec.lines) {
        const c = cur.get(std.key), p = prev.get(std.key);
        rows.push({ cells: [
          { text: IND + std.label, small: c && c.ledgers.length ? c.ledgers.map((l) => l.name).join(", ") : undefined },
          { text: notes.get(std.key) ?? "", align: "center" },
          { text: money(c?.total), align: "right" },
          { text: money(p?.total), align: "right" },
        ] });
      }
      const stc = sec.lines.reduce((s, l) => s + (cur.get(l.key)?.total ?? 0), 0);
      const stp = sec.lines.reduce((s, l) => s + (prev.get(l.key)?.total ?? 0), 0);
      rows.push({ cells: [{ text: "" }, { text: "" }, { text: money(stc), align: "right" }, { text: money(stp), align: "right" }], bold: true, topBorder: true });
    }
  };
  side(EQUITY_LIAB_SECTIONS, liabCur, liabPrev, "EQUITY AND LIABILITIES");
  rows.push({ cells: [{ text: "TOTAL", colspan: 2, align: "right" }, { text: money(bs?.totalLiabilities), align: "right" }, { text: money(bsPrev?.totalLiabilities), align: "right" }], bold: true, strongBorder: true });
  side(ASSET_SECTIONS, assetCur, assetPrev, "ASSETS");
  rows.push({ cells: [{ text: "TOTAL", colspan: 2, align: "right" }, { text: money(bs?.totalAssets), align: "right" }, { text: money(bsPrev?.totalAssets), align: "right" }], bold: true, strongBorder: true });
  return rows;
}

// Expense partition — each expense lands in EXACTLY ONE bucket, so the five
// expense lines always sum to the server's `totalExpenses`. Employee /
// depreciation / finance are named line items in Schedule III regardless of the
// ledger's Direct/Indirect group, so they take priority over the group-based
// "Direct Expenses" bucket; anything left over is "Other expenses". (Overlapping
// independent filters would double-count e.g. a "Wages" account grouped under
// Direct Expenses.)
type ExpBucket = "emp" | "dep" | "fin" | "dir" | "oth";
function expenseBucket(e: PLLine): ExpBucket {
  if (/salar|wage|staff|employee|bonus|pf|esi/i.test(e.name)) return "emp";
  if (/deprec|amortis|amortiz/i.test(e.name)) return "dep";
  if (/interest|finance|bank charge|loan charge/i.test(e.name)) return "fin";
  if ((e.group || "").includes("Direct")) return "dir";
  return "oth";
}

function buildProfitLossRows(cur?: ProfitLossResp, prev?: ProfitLossResp): StmtRow[] {
  const revOps = (pl?: ProfitLossResp) => (pl?.income ?? []).filter((i) => (i.group || "").includes("Direct")).reduce((s, i) => s + i.amount, 0);
  const othInc = (pl?: ProfitLossResp) => (pl?.income ?? []).filter((i) => !(i.group || "").includes("Direct")).reduce((s, i) => s + i.amount, 0);
  const expBy = (pl: ProfitLossResp | undefined, bucket: ExpBucket) => (pl?.expenses ?? []).filter((e) => expenseBucket(e) === bucket).reduce((s, e) => s + e.amount, 0);

  const r = (label: string, note: string, c?: number, p?: number, o?: { bold?: boolean; top?: boolean; strong?: boolean }): StmtRow => ({
    cells: [{ text: label }, { text: note, align: "center" }, { text: money(c), align: "right" }, { text: money(p), align: "right" }],
    bold: o?.bold, topBorder: o?.top, strongBorder: o?.strong,
  });
  const pbtC = cur?.netProfit ?? 0, pbtP = prev?.netProfit ?? 0;
  return [
    r("Revenue from operations", "3.1", revOps(cur), revOps(prev)),
    r("Other income", "3.2", othInc(cur), othInc(prev)),
    r("Total Revenue", "", cur?.totalIncome, prev?.totalIncome, { bold: true, top: true }),
    { cells: [{ text: "Expenses", colspan: 4 }], bold: true },
    r("Direct Expenses", "3.3", expBy(cur, "dir"), expBy(prev, "dir")),
    r("Employee benefits expense", "3.4", expBy(cur, "emp"), expBy(prev, "emp")),
    r("Depreciation and amortization expense", "3.5", expBy(cur, "dep"), expBy(prev, "dep")),
    r("Finance costs", "3.6", expBy(cur, "fin"), expBy(prev, "fin")),
    r("Other expenses", "3.7", expBy(cur, "oth"), expBy(prev, "oth")),
    r("Total expenses", "", cur?.totalExpenses, prev?.totalExpenses, { bold: true, top: true }),
    r("Profit before exceptional and extraordinary items and tax", "", pbtC, pbtP, { top: true }),
    r("Exceptional items", "", undefined, undefined),
    r("Profit before extraordinary items and tax", "", pbtC, pbtP),
    r("Extraordinary Items", "", undefined, undefined),
    r("Profit before tax", "", pbtC, pbtP, { bold: true }),
    r("Tax expense", "", undefined, undefined),
    r("Profit/(loss) for the period", "", pbtC, pbtP, { bold: true, top: true, strong: true }),
  ];
}

function buildTrialBalanceRows(tb?: TrialBalanceResp): StmtRow[] {
  const rows: StmtRow[] = (tb?.rows ?? []).map((row) => ({
    cells: [
      { text: row.name },
      { text: row.tallyGroup, small: undefined },
      { text: money(row.balanceDr), align: "right" },
      { text: money(row.balanceCr), align: "right" },
    ],
  }));
  if (rows.length === 0) rows.push({ cells: [{ text: "No ledger movement in this period.", colspan: 4, align: "center" }] });
  rows.push({ cells: [{ text: "TOTAL", colspan: 2, align: "right" }, { text: money(tb?.totalDr), align: "right" }, { text: money(tb?.totalCr), align: "right" }], bold: true, strongBorder: true });
  return rows;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FinancialStatements() {
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [fyStart, setFyStart] = useState(`${fy}-04-01`);
  const [asOf, setAsOf] = useState(`${fy + 1}-03-31`);
  const [place, setPlace] = useState("");

  const prevAsOf = shiftYearsISO(asOf, 1);
  const prevFyStart = shiftYearsISO(fyStart, 1);
  const prevFyEnd = shiftYearsISO(asOf, 1);

  const branding = useQuery<Branding>({
    queryKey: ["/api/clinic-settings/branding"],
    queryFn: () => api.get<Branding>("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });
  const bsCur = useQuery<BalanceSheetResp>({ queryKey: ["balance-sheet", asOf], queryFn: () => api.get(`/api/accounting/balance-sheet?asOf=${asOf}`), ...FINANCIAL_QUERY_OPTIONS });
  const bsPrev = useQuery<BalanceSheetResp>({ queryKey: ["balance-sheet", prevAsOf], queryFn: () => api.get(`/api/accounting/balance-sheet?asOf=${prevAsOf}`), ...FINANCIAL_QUERY_OPTIONS });
  const plCur = useQuery<ProfitLossResp>({ queryKey: ["profit-loss", fyStart, asOf], queryFn: () => api.get(`/api/accounting/profit-loss?from=${fyStart}&to=${asOf}`), ...FINANCIAL_QUERY_OPTIONS });
  const plPrev = useQuery<ProfitLossResp>({ queryKey: ["profit-loss", prevFyStart, prevFyEnd], queryFn: () => api.get(`/api/accounting/profit-loss?from=${prevFyStart}&to=${prevFyEnd}`), ...FINANCIAL_QUERY_OPTIONS });
  const tbCur = useQuery<TrialBalanceResp>({ queryKey: ["trial-balance", fyStart, asOf], queryFn: () => api.get(`/api/accounting/trial-balance?from=${fyStart}&to=${asOf}`), ...FINANCIAL_QUERY_OPTIONS });

  const refetchAll = () => { bsCur.refetch(); bsPrev.refetch(); plCur.refetch(); plPrev.refetch(); tbCur.refetch(); };
  const anyFetching = bsCur.isFetching || bsPrev.isFetching || plCur.isFetching || plPrev.isFetching || tbCur.isFetching;

  const clinicName = branding.data?.name || "M/S Care Diagnostics";
  const clinicAddr = branding.data?.registeredAddress || branding.data?.address || "";
  const propLine = branding.data?.tagline || "";
  const headerLines = [clinicName, propLine, clinicAddr, branding.data?.gstin ? `GSTIN: ${branding.data.gstin}` : ""].filter(Boolean) as string[];

  const liabCur = useMemo(() => classifyLines(bsCur.data?.liabilities ?? [], EQUITY_LIAB_SECTIONS, "ocl"), [bsCur.data]);
  const liabPrev = useMemo(() => classifyLines(bsPrev.data?.liabilities ?? [], EQUITY_LIAB_SECTIONS, "ocl"), [bsPrev.data]);
  const assetCur = useMemo(() => classifyLines(bsCur.data?.assets ?? [], ASSET_SECTIONS, "oca"), [bsCur.data]);
  const assetPrev = useMemo(() => classifyLines(bsPrev.data?.assets ?? [], ASSET_SECTIONS, "oca"), [bsPrev.data]);

  const bsNotes = useMemo(() => {
    const m = new Map<string, string>(); let n = 0;
    for (const sec of EQUITY_LIAB_SECTIONS) for (const std of sec.lines) if (liabCur.get(std.key)) m.set(std.key, `2.${++n}`);
    for (const sec of ASSET_SECTIONS) for (const std of sec.lines) if (assetCur.get(std.key)) m.set(std.key, `2.${++n}`);
    return m;
  }, [liabCur, assetCur]);

  // Signature block — proprietor only (no auditor / chartered-accountant name).
  const sigFooter = { footerLeft: [`Place: ${place || "____________"}`, `Date: ${fmtDMY(asOf)}`], footerRight: [`For ${clinicName}`, "", "", "(Proprietor)"] };

  // The three sheets — one shared model for screen + PDF + Word.
  const sheets: StmtSheet[] = useMemo(() => [
    {
      title: `BALANCE SHEET AS AT ${fmtDMY(asOf)}`,
      headerLines, noteLine: "In ₹",
      columns: [AMOUNT_COLS_BS[0], AMOUNT_COLS_BS[1], { ...AMOUNT_COLS_BS[2], header: fmtDMY(asOf) }, { ...AMOUNT_COLS_BS[3], header: fmtDMY(prevAsOf) }],
      rows: buildBalanceSheetRows(liabCur, liabPrev, assetCur, assetPrev, bsNotes, bsCur.data, bsPrev.data),
      ...sigFooter,
    },
    {
      title: `STATEMENT OF PROFIT AND LOSS FOR THE YEAR ENDED ${fmtDMY(asOf)}`,
      headerLines, noteLine: "In ₹",
      columns: [{ header: "Particulars", align: "left", widthPct: 50 }, { header: "Note No.", align: "center", widthPct: 10 }, { header: `Year Ended ${fmtDMY(asOf)}`, align: "right", widthPct: 20 }, { header: `Year Ended ${fmtDMY(prevAsOf)}`, align: "right", widthPct: 20 }],
      rows: buildProfitLossRows(plCur.data, plPrev.data),
      ...sigFooter,
    },
    {
      title: `TRIAL BALANCE AS AT ${fmtDMY(asOf)}`,
      headerLines, noteLine: "In ₹",
      columns: [{ header: "Particulars", align: "left", widthPct: 40 }, { header: "Group", align: "left", widthPct: 26 }, { header: "Debit (₹)", align: "right", widthPct: 17 }, { header: "Credit (₹)", align: "right", widthPct: 17 }],
      rows: buildTrialBalanceRows(tbCur.data),
    },
  ], [asOf, prevAsOf, headerLines, liabCur, liabPrev, assetCur, assetPrev, bsNotes, bsCur.data, bsPrev.data, plCur.data, plPrev.data, tbCur.data, place]);

  const fileBase = `Financial_Statements_${asOf}`;
  const handlePrint = () => window.print();
  const handlePdf = () => exportStatementsPDF({ fileBaseName: fileBase, sheets });
  const handleWord = () => exportStatementsWord({ fileBaseName: fileBase, sheets });

  return (
    <div className="space-y-4">
      {/* ── Toolbar (hidden on print) ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 print:hidden bg-card border border-card-border rounded-xl p-4">
        <div><Label className="text-xs">Financial Year Start</Label><Input type="date" value={fyStart} onChange={(e) => setFyStart(e.target.value)} className="mt-1 w-40" /></div>
        <div><Label className="text-xs">As at / Year Ended</Label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="mt-1 w-40" /></div>
        <div><Label className="text-xs">Place</Label><Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Deoghar" className="mt-1 w-32" /></div>
        <Button variant="outline" onClick={refetchAll} disabled={anyFetching}><RefreshCcw className={`w-4 h-4 mr-2 ${anyFetching ? "animate-spin" : ""}`} /> Refresh</Button>
        <Button variant="outline" onClick={handlePrint}><Printer className="w-4 h-4 mr-2" /> Print</Button>
        <Button variant="outline" onClick={handlePdf}><FileText className="w-4 h-4 mr-2" /> PDF</Button>
        <Button variant="outline" onClick={handleWord}><FileType className="w-4 h-4 mr-2" /> Word</Button>
        {bsCur.data && (
          <div className={`ml-auto flex items-center gap-1.5 text-sm font-medium ${bsCur.data.balanced ? "text-green-600" : "text-red-500"}`}>
            {bsCur.data.balanced ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {bsCur.data.balanced ? "Balance Sheet tallies" : "Out of balance — check opening balances"}
          </div>
        )}
      </div>

      {/* ── Printable statements — each on its own sheet ──────────────────── */}
      <div id="fin-stmt-print" className="bg-white text-black mx-auto" style={{ width: "100%", maxWidth: 900, fontFamily: "'Times New Roman', Times, serif", boxSizing: "border-box" }}>
        {sheets.map((sheet, i) => (
          <div key={sheet.title} className="stmt-sheet" style={{ padding: "6mm", pageBreakBefore: i > 0 ? "always" : "auto" }}>
            <div style={{ textAlign: "center", marginBottom: 10 }}>
              {sheet.headerLines.map((ln, j) => (
                <div key={j} style={{ fontSize: j === 0 ? 17 : j === 1 ? 12 : 11, fontWeight: j <= 1 ? 700 : 400, textTransform: j === 0 ? "uppercase" : "none", letterSpacing: j === 0 ? 0.5 : 0 }}>{ln}</div>
              ))}
            </div>
            <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, textTransform: "uppercase", margin: "6px 0" }}>{sheet.title}</div>
            <StmtTableView sheet={sheet} />
            {(sheet.footerLeft?.length || sheet.footerRight?.length) ? (
              <div style={{ marginTop: 24, fontSize: 11, display: "flex", justifyContent: "space-between", gap: 24 }}>
                <div>{(sheet.footerLeft ?? []).map((ln, k) => <div key={k}>{ln || " "}</div>)}</div>
                <div style={{ textAlign: "right" }}>{(sheet.footerRight ?? []).map((ln, k) => <div key={k} style={{ fontWeight: k === 0 ? 700 : 400 }}>{ln || " "}</div>)}</div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Print isolation — show only the statement sheets on print */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #fin-stmt-print, #fin-stmt-print * { visibility: visible !important; }
          #fin-stmt-print { position: absolute; left: 0; top: 0; width: 100%; max-width: 100%; box-sizing: border-box; }
          /* Inter-sheet separation is handled by each sheet's inline
             page-break-before (sheets 2+). A page-break-after on the last sheet
             would emit a trailing blank page, so we deliberately don't set one. */
          @page { size: A4; margin: 8mm; }
        }
      `}</style>
    </div>
  );
}

// ── On-screen table (renders the same StmtSheet model as the exporters) ───────

function StmtTableView({ sheet }: { sheet: StmtSheet }) {
  const nCols = sheet.columns.length;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginBottom: 4 }}>
      <colgroup>{sheet.columns.map((c, i) => <col key={i} style={{ width: `${c.widthPct}%` }} />)}</colgroup>
      <thead>
        <tr>{sheet.columns.map((c, i) => <th key={i} style={{ ...cellBase, fontWeight: 700, textAlign: c.align ?? "left", background: "#f5f5f5" }}>{c.header}</th>)}</tr>
        {sheet.noteLine && (
          <tr>
            <th style={{ ...cellBase, ...inrRow }} colSpan={nCols - 2}></th>
            <th style={{ ...cellBase, ...inrRow, textAlign: "right" }} colSpan={2}>{sheet.noteLine}</th>
          </tr>
        )}
      </thead>
      <tbody>
        {sheet.rows.map((r, ri) => (
          <tr key={ri}>
            {r.cells.map((c, ci) => (
              <td
                key={ci}
                colSpan={c.colspan ?? 1}
                style={{
                  ...cellBase,
                  textAlign: c.align ?? "left",
                  fontWeight: r.bold ? 700 : 400,
                  background: r.shaded ? "#f0f0f0" : undefined,
                  borderTop: r.strongBorder ? "2px solid #000" : r.topBorder ? "1px solid #000" : "1px solid #000",
                  borderBottom: r.strongBorder ? "2px solid #000" : "1px solid #000",
                  fontVariantNumeric: c.align === "right" ? "tabular-nums" : undefined,
                }}
              >
                {c.text}
                {c.small && <span style={{ fontSize: 9, color: "#555" }}> {" "}({c.small})</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const cellBase: React.CSSProperties = { border: "1px solid #000", padding: "3px 6px", verticalAlign: "top" };
const inrRow: React.CSSProperties = { background: "#fff", fontWeight: 400, fontStyle: "italic", padding: "1px 6px" };
