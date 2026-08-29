import { useState, Fragment, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import {
  Plus, Download, Landmark, FileText, Trash2,
  TrendingUp, TrendingDown, ArrowRightLeft, BarChart3,
  BookOpen, Scale, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle,
  RefreshCw, Pencil, History, Building2, ArrowUpDown, Search, Clock,
  CreditCard, Filter, Camera, Upload, ScanLine, Banknote, X, Check,
} from "lucide-react";
import Form3C from "@/components/accounting/Form3C";
import FinancialStatements from "@/components/accounting/FinancialStatements";
import BillReceiptScannerPanel from "@/components/BillReceiptScannerPanel";
import BankStatementImportPanel from "@/components/BankStatementImportPanel";

// ── Types ────────────────────────────────────────────────────────────────────

type Account = {
  id: number; name: string; type: string; code?: string;
  bankName?: string; accountNumber?: string; ifscCode?: string; isActive: boolean;
  tallyGroup?: string; openingBalance?: number; openingBalanceType?: string;
  gstApplicable?: boolean; gstNumber?: string; pan?: string;
};
type Voucher = {
  id: number; voucherNumber: string; type: string; date: string;
  creditAccountId: string; debitAccountId: string; amount: number;
  particular: string; remark?: string; performedBy?: string; reference?: string;
  narration?: string; billId?: number | null; createdAt: string;
  // Patient linkage (resolved server-side via bill → patient join)
  billNumber?: string | null;
  patientName?: string | null;
  patientUhid?: string | null;
  patientPhone?: string | null;
};
type VoucherAudit = {
  id: number; voucherId: number; voucherNumber: string;
  editedBy: string; reason: string; changeType: string;
  oldValue: string | null; newValue: string | null; createdAt: string;
};
type LedgerEntry = {
  account: Account; dr: number; cr: number; balance: number;
  entries: { date: string; particular: string; dr: number; cr: number; balance: number; voucherNumber: string }[];
};
type TrialBalance = {
  rows: { id: number; name: string; type: string; tallyGroup: string; parent: string; dr: number; cr: number; balance: number; balanceDr: number; balanceCr: number }[];
  totalDr: number; totalCr: number; balanced: boolean;
};
type ProfitLoss = {
  income: { name: string; group: string; amount: number }[];
  expenses: { name: string; group: string; amount: number }[];
  totalIncome: number; totalExpenses: number; netProfit: number;
};
type BalanceSheet = {
  assets: { name: string; group: string; amount: number }[];
  liabilities: { name: string; group: string; amount: number }[];
  totalAssets: number; totalLiabilities: number;
  netProfit?: number; balanced?: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES = ["cash", "bank", "income", "expense", "liability", "asset"];
const TALLY_GROUPS = [
  "Cash-in-Hand", "Bank Accounts", "Bank OD Accounts",
  "Current Assets", "Fixed Assets", "Investments", "Loans & Advances (Asset)", "Misc. Expenses (Asset)", "Sundry Debtors",
  "Current Liabilities", "Duties & Taxes", "Sundry Creditors", "Loans (Liability)", "Unsecured Loans",
  "Capital Account", "Reserves & Surplus",
  "Direct Income", "Indirect Income",
  "Direct Expenses", "Indirect Expenses",
];
const VOUCHER_TYPES = [
  { value: "payment", label: "Payment Voucher", icon: TrendingDown, desc: "Cash/bank payment to party" },
  { value: "receipt", label: "Receipt Voucher", icon: TrendingUp, desc: "Cash/bank received from party" },
  { value: "contra", label: "Contra Voucher", icon: ArrowRightLeft, desc: "Cash/bank to cash/bank transfer" },
  { value: "journal", label: "Journal Entry", icon: FileText, desc: "General ledger adjustment" },
  { value: "sales", label: "Sales Voucher", icon: TrendingUp, desc: "Sales invoice entry" },
  { value: "purchase", label: "Purchase Voucher", icon: TrendingDown, desc: "Purchase invoice entry" },
];

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const vBadgeStyle: Record<string, string> = {
  payment: "bg-red-100 text-red-700",
  receipt: "bg-green-100 text-green-700",
  contra: "bg-blue-100 text-blue-700",
  bank_transfer: "bg-blue-100 text-blue-700",
  journal: "bg-purple-100 text-purple-700",
  sales: "bg-emerald-100 text-emerald-700",
  purchase: "bg-orange-100 text-orange-700",
};
const vBadgeLabel: Record<string, string> = {
  payment: "Payment", receipt: "Receipt", contra: "Contra",
  bank_transfer: "Contra", journal: "Journal", sales: "Sales", purchase: "Purchase",
};

const auditBadgeStyle: Record<string, string> = {
  amount:       "bg-amber-100 text-amber-700",
  date:         "bg-blue-100 text-blue-700",
  particular:   "bg-purple-100 text-purple-700",
  reference:    "bg-indigo-100 text-indigo-700",
  narration:    "bg-cyan-100 text-cyan-700",
  performedBy:  "bg-gray-100 text-gray-600",
  remark:       "bg-gray-100 text-gray-600",
  creditAccount:"bg-orange-100 text-orange-700",
  debitAccount: "bg-orange-100 text-orange-700",
};

function VoucherBadge({ type }: { type: string }) {
  return <Badge className={`${vBadgeStyle[type] || "bg-gray-100 text-gray-700"} text-xs`}>{vBadgeLabel[type] || type}</Badge>;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Accounting() {
  const qc = useQueryClient();
  const { toast } = useToast();
  // Deep-link support (e.g. Banking page links here to open Scan & Import
  // directly). Falls back to the default tab if no/invalid ?tab= param.
  const [accountingTab, setAccountingTab] = useState<string>(() => {
    if (typeof window === "undefined") return "vouchers";
    return new URLSearchParams(window.location.search).get("tab") || "vouchers";
  });
  const [accOpen, setAccOpen] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherType, setVoucherType] = useState("payment");
  const [expandedLedger, setExpandedLedger] = useState<Set<number>>(new Set());
  const [expandedVoucherAudits, setExpandedVoucherAudits] = useState<Set<number>>(new Set());
  const [editVoucherOpen, setEditVoucherOpen] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null);
  const [voucherAuditMap, setVoucherAuditMap] = useState<Record<number, VoucherAudit[]>>({});

  // Voucher filters
  const [filters, setFilters] = useState({ type: "all", from: "", to: "", q: "", billId: "" });

  // Ledger filters
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState("all");
  const [ledgerSortBy, setLedgerSortBy] = useState<"name" | "balance" | "dr" | "cr">("name");
  const [ledgerSortDir, setLedgerSortDir] = useState<"asc" | "desc">("asc");

  // Voucher audit system report filters
  const [auditFilters, setAuditFilters] = useState({ from: "", to: "", editedBy: "", voucherNumber: "" });

  // Report date range — default to the current Indian financial year (Apr 1 – Mar 31)
  const defaultFrom = (() => {
    const now = new Date();
    const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${fy}-04-01`;
  })();
  const defaultTo = new Date().toISOString().slice(0, 10);
  const [rptFrom, setRptFrom] = useState(defaultFrom);
  const [rptTo, setRptTo] = useState(defaultTo);

  const [exportDates, setExportDates] = useState({ from: "", to: "" });

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: accounts = [], isLoading: accLoading } = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => api.get("/api/accounting/accounts"),
    ...FINANCIAL_QUERY_OPTIONS,
  });
  const { data: vouchers = [], isLoading: vLoading } = useQuery<Voucher[]>({
    queryKey: ["vouchers", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.type !== "all") params.set("type", filters.type);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.q) params.set("q", filters.q);
      if (filters.billId) params.set("billId", filters.billId);
      return api.get(`/api/accounting/vouchers?${params}`);
    },
    ...FINANCIAL_QUERY_OPTIONS,
  });
  const { data: ledger = [] } = useQuery<LedgerEntry[]>({
    queryKey: ["ledger"],
    queryFn: () => api.get("/api/accounting/ledger"),
    ...FINANCIAL_QUERY_OPTIONS,
  });
  // Reports use the shared FINANCIAL_QUERY_OPTIONS like the rest of this page:
  // staleTime 0 forces a fresh fetch the moment the page/tab is opened (so the
  // first view is never a stale cached sheet), plus a 15s live refresh and
  // refetch-on-focus. Previously these three inherited the global 5-min
  // staleTime, so opening Balance Sheet/P&L/Trial Balance could show numbers
  // minutes out of date until a manual "Refresh".
  const { data: trialBalance, refetch: refetchTB, isFetching: tbFetching } = useQuery<TrialBalance>({
    queryKey: ["trial-balance", rptFrom, rptTo],
    queryFn: () => api.get(`/api/accounting/trial-balance?from=${rptFrom}&to=${rptTo}`),
    ...FINANCIAL_QUERY_OPTIONS,
  });
  const { data: profitLoss, refetch: refetchPL, isFetching: plFetching } = useQuery<ProfitLoss>({
    queryKey: ["profit-loss", rptFrom, rptTo],
    queryFn: () => api.get(`/api/accounting/profit-loss?from=${rptFrom}&to=${rptTo}`),
    ...FINANCIAL_QUERY_OPTIONS,
  });
  const { data: balanceSheet, refetch: refetchBS, isFetching: bsFetching } = useQuery<BalanceSheet>({
    queryKey: ["balance-sheet", rptTo],
    queryFn: () => api.get(`/api/accounting/balance-sheet?asOf=${rptTo}`),
    ...FINANCIAL_QUERY_OPTIONS,
  });
  const { data: voucherAudits = [], isFetching: auditFetching, refetch: refetchAudits } = useQuery<VoucherAudit[]>({
    queryKey: ["voucher-audits", auditFilters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (auditFilters.from) params.set("from", auditFilters.from);
      if (auditFilters.to) params.set("to", auditFilters.to);
      if (auditFilters.editedBy) params.set("editedBy", auditFilters.editedBy);
      if (auditFilters.voucherNumber) params.set("voucherNumber", auditFilters.voucherNumber);
      return api.get(`/api/accounting/voucher-audits?${params}`);
    },
  });

  // ── One-time account seeding (F2: no longer auto-syncs billing) ──────────────
  //
  // Payments are now vouchered at capture time, so the page must NOT silently
  // run the sync-billing backfill on every load — that auto-run is exactly
  // what re-vouchered already-vouchered desk payments (doubling revenue).
  // Seeding the default chart of accounts when empty is still safe and needed;
  // the backfill is an explicit, previewed admin action (the button below).

  const setupDone = useRef(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (accLoading || setupDone.current) return;
    setupDone.current = true;
    if (accounts.length === 0) {
      setSyncing(true);
      api.post("/api/accounting/setup-defaults", {})
        .then(() => qc.invalidateQueries({ queryKey: ["accounts"] }))
        .finally(() => setSyncing(false));
    }
  }, [accLoading, accounts.length]);

  const invalidateBooks = () => {
    qc.invalidateQueries({ queryKey: ["vouchers"] });
    qc.invalidateQueries({ queryKey: ["ledger"] });
    qc.invalidateQueries({ queryKey: ["trial-balance"] });
    qc.invalidateQueries({ queryKey: ["profit-loss"] });
    qc.invalidateQueries({ queryKey: ["balance-sheet"] });
  };

  // Explicit backfill: dry-run first (reports what WOULD be created, writes
  // nothing), confirm, then commit. Never runs automatically.
  const syncBilling = useMutation({
    mutationFn: async () => {
      const preview = await api.post<{ wouldCreate: number }>("/api/accounting/sync-billing", { dryRun: true });
      if (preview.wouldCreate === 0) {
        toast({ title: "Already up to date", description: "Every payment is vouchered — nothing to sync." });
        return { committed: 0 };
      }
      if (!window.confirm(`${preview.wouldCreate} payment(s) are not yet vouchered. Create their receipt vouchers now?`)) {
        return { committed: 0 };
      }
      const result = await api.post<{ created: number }>("/api/accounting/sync-billing", {});
      toast({ title: "Sync complete", description: `${result.created} voucher(s) created.` });
      return { committed: result.created };
    },
    onSuccess: () => invalidateBooks(),
    onError: (err) => toast({ title: "Sync failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" }),
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const showMutationError = (action: string) => (err: unknown) => {
    const msg = err instanceof Error ? err.message : `Failed to ${action}`;
    toast({ title: `Failed to ${action}`, description: msg, variant: "destructive" });
  };

  const createAccount = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/accounting/accounts", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      setAccOpen(false);
      resetAcc();
      toast({ title: "Account added" });
    },
    onError: showMutationError("add account"),
  });
  const createVoucher = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/accounting/vouchers", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vouchers"] }); qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["trial-balance"] }); qc.invalidateQueries({ queryKey: ["profit-loss"] });
      qc.invalidateQueries({ queryKey: ["balance-sheet"] });
      setVoucherOpen(false); resetV();
      toast({ title: "Voucher created" });
    },
    onError: showMutationError("create voucher"),
  });
  const editVoucher = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => api.patch(`/api/accounting/vouchers/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vouchers"] }); qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["voucher-audits"] });
      setEditVoucherOpen(false); setEditingVoucher(null); resetEV();
      toast({ title: "Voucher updated" });
    },
    onError: showMutationError("update voucher"),
  });
  const deleteVoucher = useMutation({
    mutationFn: (id: number) => api.delete(`/api/accounting/vouchers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["trial-balance"] });
      qc.invalidateQueries({ queryKey: ["profit-loss"] });
      qc.invalidateQueries({ queryKey: ["balance-sheet"] });
      toast({ title: "Voucher deleted" });
    },
    onError: showMutationError("delete voucher"),
  });

  // ── Forms ────────────────────────────────────────────────────────────────────

  const { register: regAcc, handleSubmit: subAcc, reset: resetAcc, setValue: setAccVal, watch: watchAcc } = useForm<Record<string, string>>();
  const { register: regV, handleSubmit: subV, reset: resetV, setValue: setVVal } = useForm<Record<string, string>>();
  const { register: regEV, handleSubmit: subEV, reset: resetEV } = useForm<Record<string, string>>();
  const accType = watchAcc("type");

  const activeAccounts = accounts.filter(a => a.isActive);
  const bankAccounts = accounts.filter(a => a.type === "bank");
  const accountName = (id: string) => accounts.find(a => a.id.toString() === id)?.name || id;

  const totalDr = ledger.reduce((s, l) => s + l.dr, 0);
  const totalCr = ledger.reduce((s, l) => s + l.cr, 0);

  // ── Ledger filtering + sorting ────────────────────────────────────────────────

  const filteredLedger = ledger
    .filter(l => l.dr + l.cr > 0)
    .filter(l => {
      if (ledgerTypeFilter !== "all" && l.account.type !== ledgerTypeFilter) return false;
      if (ledgerSearch && !l.account.name.toLowerCase().includes(ledgerSearch.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      let diff = 0;
      if (ledgerSortBy === "name") diff = a.account.name.localeCompare(b.account.name);
      else if (ledgerSortBy === "balance") diff = a.balance - b.balance;
      else if (ledgerSortBy === "dr") diff = a.dr - b.dr;
      else if (ledgerSortBy === "cr") diff = a.cr - b.cr;
      return ledgerSortDir === "asc" ? diff : -diff;
    });

  const toggleLedgerSort = (col: typeof ledgerSortBy) => {
    if (ledgerSortBy === col) setLedgerSortDir(d => d === "asc" ? "desc" : "asc");
    else { setLedgerSortBy(col); setLedgerSortDir("asc"); }
  };
  const SortIcon = ({ col }: { col: typeof ledgerSortBy }) => (
    <ArrowUpDown size={10} className={`inline ml-1 ${ledgerSortBy === col ? "text-primary" : "text-muted-foreground/50"}`} />
  );

  // ── Voucher audit expansion ───────────────────────────────────────────────────

  const toggleVoucherAudit = async (voucher: Voucher) => {
    const next = new Set(expandedVoucherAudits);
    if (next.has(voucher.id)) {
      next.delete(voucher.id);
    } else {
      next.add(voucher.id);
      if (!voucherAuditMap[voucher.id]) {
        const data = await api.get(`/api/accounting/vouchers/${voucher.id}/audits`) as VoucherAudit[];
        setVoucherAuditMap(prev => ({ ...prev, [voucher.id]: data }));
      }
    }
    setExpandedVoucherAudits(next);
  };

  const openEditVoucher = (v: Voucher) => {
    setEditingVoucher(v);
    resetEV({
      date: v.date,
      amount: String(v.amount),
      particular: v.particular,
      remark: v.remark || "",
      performedBy: v.performedBy || "",
      reference: v.reference || "",
      narration: v.narration || "",
      editedBy: "",
      reason: "",
    });
    setEditVoucherOpen(true);
  };

  // ── Tally Export ─────────────────────────────────────────────────────────────

  const downloadTallyMasters = () => {
    const a = document.createElement("a");
    a.href = `/api/accounting/export/tally`;
    a.download = `tally-masters.xml`;
    a.click();
  };
  const downloadTallyVouchers = () => {
    const params = new URLSearchParams();
    if (exportDates.from) params.set("from", exportDates.from);
    if (exportDates.to) params.set("to", exportDates.to);
    const a = document.createElement("a");
    a.href = `/api/accounting/export/tally-vouchers?${params}`;
    a.download = `tally-vouchers${exportDates.from ? `-${exportDates.from}` : ""}${exportDates.to ? `-to-${exportDates.to}` : ""}.xml`;
    a.click();
  };
  const downloadTallyErp9Masters = () => {
    const a = document.createElement("a");
    a.href = `/api/accounting/export/tally-erp9`;
    a.download = `tally-erp9-masters.xml`;
    a.click();
  };
  const downloadTallyErp9Vouchers = () => {
    const params = new URLSearchParams();
    if (exportDates.from) params.set("from", exportDates.from);
    if (exportDates.to) params.set("to", exportDates.to);
    const a = document.createElement("a");
    a.href = `/api/accounting/export/tally-erp9-vouchers?${params}`;
    a.download = `tally-erp9-vouchers${exportDates.from ? `-${exportDates.from}` : ""}${exportDates.to ? `-to-${exportDates.to}` : ""}.xml`;
    a.click();
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="pb-8 min-w-0 max-w-full">
      <PageHeader
        title="Accounting"
        subtitle="Double-entry bookkeeping · Tally-compatible"
        actions={
          <div className="flex items-center gap-2">
            {syncing && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <RefreshCw size={12} className="animate-spin" /> Setting up accounting…
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={syncBilling.isPending || syncing}
              onClick={() => syncBilling.mutate()}
            >
              <RefreshCw size={13} className={`mr-1 ${syncBilling.isPending ? "animate-spin" : ""}`} />
              Sync from Billing…
            </Button>
          </div>
        }
      />

      <div className="px-6">
        <Tabs value={accountingTab} onValueChange={setAccountingTab}>
          <TabsList className="mb-4 flex-wrap gap-1 h-auto">
            <TabsTrigger value="vouchers">Vouchers</TabsTrigger>
            <TabsTrigger value="accounts">Chart of Accounts</TabsTrigger>
            <TabsTrigger value="bank-details">Bank Details</TabsTrigger>
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="trial-balance">Trial Balance</TabsTrigger>
            <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
            <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
            <TabsTrigger value="statements" data-testid="tab-statements">Financial Statements</TabsTrigger>
            <TabsTrigger value="voucher-edits">Voucher Edits</TabsTrigger>
            <TabsTrigger value="export">Tally Export</TabsTrigger>
            <TabsTrigger value="form-3c" data-testid="tab-form-3c">Form 3C</TabsTrigger>
            <TabsTrigger value="scan-import" className="flex items-center gap-1"><ScanLine size={13} /> Scan &amp; Import</TabsTrigger>
          </TabsList>

          {/* ── Vouchers Tab ── */}
          <TabsContent value="vouchers" className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap gap-2">
                <Select onValueChange={v => setFilters(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="w-36"><SelectValue placeholder="All Types" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {VOUCHER_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} className="w-36" />
                <Input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} className="w-36" />
                <Input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} className="w-44" placeholder="Search particular…" />
                <div className="flex items-center gap-1">
                  <Filter size={13} className="text-muted-foreground" />
                  <Input
                    value={filters.billId}
                    onChange={e => setFilters(f => ({ ...f, billId: e.target.value }))}
                    className="w-32"
                    placeholder="Bill ID…"
                    type="number"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {VOUCHER_TYPES.map(t => (
                  <Button key={t.value} size="sm" variant="outline" onClick={() => { setVoucherType(t.value); resetV({ type: t.value, date: new Date().toISOString().split("T")[0] }); setVoucherOpen(true); }}>
                    <t.icon size={13} className="mr-1" /> {t.label.split(" ")[0]}
                  </Button>
                ))}
              </div>
            </div>

            {filters.billId && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-700">
                <Filter size={13} />
                Filtering by Bill ID: <strong>{filters.billId}</strong>
                <button className="ml-auto text-blue-500 hover:text-blue-700" onClick={() => setFilters(f => ({ ...f, billId: "" }))}>✕ Clear</button>
              </div>
            )}

            {vLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-xl animate-pulse" />)}</div>
            ) : vouchers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No vouchers found</div>
            ) : (
              <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-card-border">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Voucher #</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Patient</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Particular</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Debit</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Credit</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Amount</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {vouchers.map((v) => {
                      const auditExpanded = expandedVoucherAudits.has(v.id);
                      const auditsForV = voucherAuditMap[v.id] || [];
                      return (
                        <Fragment key={v.id}>
                          <tr className="border-b border-card-border last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-3 font-mono text-xs">
                              <div className="flex items-center gap-1">
                                {v.voucherNumber}
                                {v.billNumber
                                  ? <a href={`/erp/billing/${v.billId}`} target="_blank" rel="noreferrer" className="text-[10px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded hover:bg-blue-200 transition-colors" title="Open bill">{v.billNumber}</a>
                                  : v.billId
                                    ? <span className="text-[10px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded">Bill#{v.billId}</span>
                                    : null
                                }
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{v.date}</td>
                            <td className="px-4 py-3"><VoucherBadge type={v.type} /></td>
                            <td className="px-4 py-3">
                              {v.patientName ? (
                                <div>
                                  <div className="font-medium text-xs leading-tight">{v.patientName}</div>
                                  {v.patientUhid && <div className="text-[10px] text-muted-foreground">{v.patientUhid}</div>}
                                </div>
                              ) : <span className="text-muted-foreground text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3 max-w-[160px] truncate">{v.particular}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{accountName(v.debitAccountId)}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{accountName(v.creditAccountId)}</td>
                            <td className="px-4 py-3 text-right font-semibold">{inr(v.amount)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 justify-end">
                                <Button size="sm" variant="ghost" className="h-7" onClick={() => toggleVoucherAudit(v)}>
                                  <History size={13} className={auditExpanded ? "text-primary" : ""} />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7" onClick={() => openEditVoucher(v)}>
                                  <Pencil size={13} />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={() => deleteVoucher.mutate(v.id)}>
                                  <Trash2 size={13} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {auditExpanded && (
                            <tr className="bg-muted/10">
                              <td colSpan={8} className="px-4 py-3">
                                <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                                  <History size={11} /> Edit History — {v.voucherNumber}
                                </div>
                                {auditsForV.length === 0 ? (
                                  <p className="text-xs text-muted-foreground italic">No edits recorded for this voucher.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {auditsForV.map(a => (
                                      <div key={a.id} className="bg-card border border-card-border rounded-lg p-3 text-xs">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className={`font-bold uppercase px-1.5 py-0.5 rounded text-[10px] ${auditBadgeStyle[a.changeType] || "bg-gray-100 text-gray-600"}`}>{a.changeType}</span>
                                          <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
                                        </div>
                                        <p className="font-medium">{a.editedBy}</p>
                                        <p className="text-muted-foreground">{a.reason}</p>
                                        <div className="flex gap-4 mt-1">
                                          <span className="text-red-500">Before: {a.oldValue ?? "—"}</span>
                                          <span className="text-green-600">After: {a.newValue ?? "—"}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t border-card-border bg-muted/30">
                    <tr>
                      <td colSpan={7} className="px-4 py-3 text-sm font-semibold text-right">Total</td>
                      <td className="px-4 py-3 text-right font-bold">{inr(vouchers.reduce((s, v) => s + v.amount, 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Chart of Accounts Tab ── */}
          <TabsContent value="accounts" className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setAccOpen(true); resetAcc(); }}>
                <Plus size={14} className="mr-1" /> Add Account
              </Button>
            </div>

            {accLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{[...Array(6)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}</div>
            ) : accounts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No accounts. Add your first account to get started.</div>
            ) : (
              <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-card-border">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Account</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Type / Tally Group</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Code</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Opening Balance</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map(acc => (
                      <tr key={acc.id} className={`border-b border-card-border last:border-0 ${!acc.isActive ? "opacity-60" : "hover:bg-muted/20"}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <Landmark size={13} className="text-primary" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{acc.name}</p>
                              {acc.bankName && <p className="text-xs text-muted-foreground">{acc.bankName} {acc.accountNumber ? `· ${acc.accountNumber}` : ""}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs capitalize text-muted-foreground">{acc.type}</span>
                          {acc.tallyGroup && <p className="text-xs text-primary/70 mt-0.5">{acc.tallyGroup}</p>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{acc.code || "—"}</td>
                        <td className="px-4 py-3 text-right text-sm">
                          {(acc.openingBalance || 0) > 0
                            ? <span className={acc.openingBalanceType === "Dr" ? "text-green-600" : "text-red-500"}>{inr(acc.openingBalance || 0)} {acc.openingBalanceType}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={acc.isActive ? "bg-green-100 text-green-700 text-xs" : "bg-gray-100 text-gray-500 text-xs"}>
                            {acc.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Bank Details Tab ── */}
          <TabsContent value="bank-details" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Bank accounts with full details — IFSC, account numbers, and balances</p>
              <Button size="sm" onClick={() => { setAccOpen(true); resetAcc({ type: "bank" }); setAccVal("type", "bank"); setAccVal("tallyGroup", "Bank Accounts"); }}>
                <Plus size={14} className="mr-1" /> Add Bank Account
              </Button>
            </div>

            {bankAccounts.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Building2 size={36} className="mx-auto mb-3 opacity-30" />
                <p>No bank accounts configured yet.</p>
                <p className="text-xs mt-1">Add a bank account from the Chart of Accounts or the button above.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {bankAccounts.map(acc => {
                  const ledgerEntry = ledger.find(l => l.account.id === acc.id);
                  const balance = ledgerEntry ? ledgerEntry.balance : (acc.openingBalance || 0);
                  return (
                    <div key={acc.id} className="bg-card border border-card-border rounded-xl p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <Building2 size={18} className="text-blue-600" />
                          </div>
                          <div>
                            <p className="font-semibold">{acc.name}</p>
                            <p className="text-xs text-muted-foreground">{acc.bankName || "—"}</p>
                          </div>
                        </div>
                        <Badge className={acc.isActive ? "bg-green-100 text-green-700 text-xs" : "bg-gray-100 text-gray-500 text-xs"}>
                          {acc.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Account Number</p>
                          <p className="font-mono font-medium">{acc.accountNumber || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">IFSC Code</p>
                          <p className="font-mono font-medium">{acc.ifscCode || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Code / Alias</p>
                          <p className="font-mono text-xs">{acc.code || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Tally Group</p>
                          <p className="text-xs">{acc.tallyGroup || "Bank Accounts"}</p>
                        </div>
                        {acc.gstNumber && (
                          <div className="col-span-2">
                            <p className="text-xs text-muted-foreground">GST Number</p>
                            <p className="font-mono text-xs">{acc.gstNumber}</p>
                          </div>
                        )}
                      </div>
                      <div className="mt-4 pt-3 border-t border-card-border flex justify-between items-center">
                        <div>
                          <p className="text-xs text-muted-foreground">Opening Balance</p>
                          <p className="text-sm font-medium">
                            {(acc.openingBalance || 0) > 0 ? `${inr(acc.openingBalance || 0)} ${acc.openingBalanceType}` : "—"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Current Balance</p>
                          <p className={`text-base font-bold ${balance >= 0 ? "text-green-600" : "text-red-500"}`}>
                            {inr(Math.abs(balance))} {balance >= 0 ? "Dr" : "Cr"}
                          </p>
                        </div>
                      </div>
                      {ledgerEntry && ledgerEntry.entries.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-card-border">
                          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Recent Transactions</p>
                          <div className="space-y-1">
                            {ledgerEntry.entries.slice(-3).reverse().map((e, i) => (
                              <div key={i} className="flex justify-between text-xs">
                                <span className="text-muted-foreground">{e.date} · {e.particular}</span>
                                <span className={e.dr > 0 ? "text-green-600 font-medium" : "text-red-500 font-medium"}>
                                  {e.dr > 0 ? `+${inr(e.dr)}` : `-${inr(e.cr)}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bank summary totals */}
            {bankAccounts.length > 0 && (
              <div className="bg-muted/30 border border-card-border rounded-xl p-4">
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-3">Bank Balance Summary</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b border-card-border">
                        <th className="text-left pb-2">Bank Account</th>
                        <th className="text-left pb-2">Bank Name</th>
                        <th className="text-right pb-2">Dr (Debit)</th>
                        <th className="text-right pb-2">Cr (Credit)</th>
                        <th className="text-right pb-2">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankAccounts.map(acc => {
                        const le = ledger.find(l => l.account.id === acc.id);
                        return (
                          <tr key={acc.id} className="border-b border-card-border/50 last:border-0">
                            <td className="py-2 font-medium">{acc.name}</td>
                            <td className="py-2 text-muted-foreground">{acc.bankName || "—"}</td>
                            <td className="py-2 text-right text-green-600">{le ? inr(le.dr) : "—"}</td>
                            <td className="py-2 text-right text-red-500">{le ? inr(le.cr) : "—"}</td>
                            <td className={`py-2 text-right font-semibold ${(le?.balance ?? 0) >= 0 ? "text-green-600" : "text-red-500"}`}>
                              {le ? `${inr(Math.abs(le.balance))} ${le.balance >= 0 ? "Dr" : "Cr"}` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-card-border">
                      <tr>
                        <td colSpan={2} className="py-2 font-bold text-sm">Total</td>
                        <td className="py-2 text-right font-bold text-green-600">{inr(bankAccounts.reduce((s, a) => s + (ledger.find(l => l.account.id === a.id)?.dr || 0), 0))}</td>
                        <td className="py-2 text-right font-bold text-red-500">{inr(bankAccounts.reduce((s, a) => s + (ledger.find(l => l.account.id === a.id)?.cr || 0), 0))}</td>
                        <td className="py-2 text-right font-bold">{inr(Math.abs(bankAccounts.reduce((s, a) => s + (ledger.find(l => l.account.id === a.id)?.balance || 0), 0)))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Ledger Tab ── */}
          <TabsContent value="ledger" className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-card border border-card-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground">Total Debits</p>
                <p className="text-lg font-bold">{inr(totalDr)}</p>
              </div>
              <div className="bg-card border border-card-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground">Total Credits</p>
                <p className="text-lg font-bold">{inr(totalCr)}</p>
              </div>
              <div className="bg-card border border-card-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground">Net Balance</p>
                <p className={`text-lg font-bold ${totalDr - totalCr >= 0 ? "text-green-600" : "text-red-500"}`}>{inr(Math.abs(totalDr - totalCr))} {totalDr - totalCr >= 0 ? "Dr" : "Cr"}</p>
              </div>
            </div>

            {/* Filters + sorting */}
            <div className="flex flex-wrap gap-2 items-center bg-card border border-card-border rounded-xl p-3">
              <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
                <Search size={13} className="text-muted-foreground" />
                <Input value={ledgerSearch} onChange={e => setLedgerSearch(e.target.value)} placeholder="Search accounts…" className="h-8 text-sm" />
              </div>
              <Select value={ledgerTypeFilter} onValueChange={setLedgerTypeFilter}>
                <SelectTrigger className="w-32 h-8 text-sm"><SelectValue placeholder="All types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowUpDown size={12} /> Sort:
              </div>
              {(["name", "dr", "cr", "balance"] as const).map(col => (
                <button
                  key={col}
                  onClick={() => toggleLedgerSort(col)}
                  className={`text-xs px-2 py-1 rounded border ${ledgerSortBy === col ? "border-primary text-primary bg-primary/5" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {col === "name" ? "Name" : col === "dr" ? "Debit" : col === "cr" ? "Credit" : "Balance"}
                  <SortIcon col={col} />
                </button>
              ))}
              <span className="text-xs text-muted-foreground">{filteredLedger.length} account{filteredLedger.length !== 1 ? "s" : ""}</span>
            </div>

            {filteredLedger.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No ledger entries match the current filters</div>
            ) : (
              <div className="space-y-2">
                {filteredLedger.map((l) => {
                  const expanded = expandedLedger.has(l.account.id);
                  return (
                    <div key={l.account.id} className="bg-card border border-card-border rounded-xl overflow-hidden">
                      <div
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/20"
                        onClick={() => setExpandedLedger(prev => {
                          const next = new Set(prev);
                          expanded ? next.delete(l.account.id) : next.add(l.account.id);
                          return next;
                        })}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm">{l.account.name}</p>
                            <Badge className={`text-[10px] capitalize ${l.account.type === "bank" ? "bg-blue-100 text-blue-700" : l.account.type === "cash" ? "bg-green-100 text-green-700" : l.account.type === "income" ? "bg-emerald-100 text-emerald-700" : l.account.type === "expense" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                              {l.account.type}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{l.account.tallyGroup || l.account.type} · {l.entries.length - (l.entries[0]?.voucherNumber === "OB" ? 1 : 0)} transactions</p>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Dr</p>
                            <p className="font-medium">{inr(l.dr)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Cr</p>
                            <p className="font-medium">{inr(l.cr)}</p>
                          </div>
                          <div className="text-right min-w-[90px]">
                            <p className="text-xs text-muted-foreground">Balance</p>
                            <p className={`font-bold ${l.balance >= 0 ? "text-green-600" : "text-red-500"}`}>
                              {inr(Math.abs(l.balance))} {l.balance >= 0 ? "Dr" : "Cr"}
                            </p>
                          </div>
                          {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                        </div>
                      </div>
                      {expanded && l.entries.length > 0 && (
                        <div className="border-t border-card-border">
                          <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="text-left px-4 py-2 text-muted-foreground">Date</th>
                                <th className="text-left px-4 py-2 text-muted-foreground">Voucher</th>
                                <th className="text-left px-4 py-2 text-muted-foreground">Particular</th>
                                <th className="text-right px-4 py-2 text-muted-foreground">Dr</th>
                                <th className="text-right px-4 py-2 text-muted-foreground">Cr</th>
                                <th className="text-right px-4 py-2 text-muted-foreground">Balance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {l.entries.map((e, i) => (
                                <tr key={i} className="border-t border-card-border">
                                  <td className="px-4 py-2 text-muted-foreground">{e.date}</td>
                                  <td className="px-4 py-2 font-mono">{e.voucherNumber}</td>
                                  <td className="px-4 py-2">{e.particular}</td>
                                  <td className="px-4 py-2 text-right text-green-600">{e.dr ? inr(e.dr) : "—"}</td>
                                  <td className="px-4 py-2 text-right text-red-500">{e.cr ? inr(e.cr) : "—"}</td>
                                  <td className={`px-4 py-2 text-right font-medium ${e.balance >= 0 ? "text-green-600" : "text-red-500"}`}>
                                    {inr(Math.abs(e.balance))} {e.balance >= 0 ? "Dr" : "Cr"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Trial Balance Tab ── */}
          <TabsContent value="trial-balance" className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end bg-card border border-card-border rounded-xl p-4">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={rptFrom} onChange={e => setRptFrom(e.target.value)} className="mt-1 w-36" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={rptTo} onChange={e => setRptTo(e.target.value)} className="mt-1 w-36" />
              </div>
              <Button size="sm" variant="outline" onClick={() => refetchTB()} disabled={tbFetching}>
                <RefreshCw size={13} className={`mr-1 ${tbFetching ? "animate-spin" : ""}`} /> Refresh
              </Button>
              {trialBalance && (
                <div className={`flex items-center gap-2 ml-2 text-sm font-medium ${trialBalance.balanced ? "text-green-600" : "text-red-500"}`}>
                  {trialBalance.balanced ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  {trialBalance.balanced ? "Balanced" : "Out of Balance"}
                </div>
              )}
            </div>

            {trialBalance && (
              <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-card-border">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Account</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Group</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Debit (Dr)</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Credit (Cr)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialBalance.rows.map(r => (
                      <tr key={r.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium">{r.name}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{r.tallyGroup}</td>
                        <td className="px-4 py-3 text-right font-mono">{r.balanceDr > 0 ? inr(r.balanceDr) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{r.balanceCr > 0 ? inr(r.balanceCr) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-card-border bg-muted/50">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 font-bold text-sm">Total</td>
                      <td className="px-4 py-3 text-right font-bold">{inr(trialBalance.totalDr)}</td>
                      <td className="px-4 py-3 text-right font-bold">{inr(trialBalance.totalCr)}</td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── P&L Tab ── */}
          <TabsContent value="pnl" className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end bg-card border border-card-border rounded-xl p-4">
              <div><Label className="text-xs">From</Label><Input type="date" value={rptFrom} onChange={e => setRptFrom(e.target.value)} className="mt-1 w-36" /></div>
              <div><Label className="text-xs">To</Label><Input type="date" value={rptTo} onChange={e => setRptTo(e.target.value)} className="mt-1 w-36" /></div>
              <Button size="sm" variant="outline" onClick={() => refetchPL()} disabled={plFetching}><RefreshCw size={13} className={`mr-1 ${plFetching ? "animate-spin" : ""}`} /> Refresh</Button>
            </div>
            {profitLoss && (
              <>
                <div className={`rounded-xl p-5 border-2 ${profitLoss.netProfit >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{profitLoss.netProfit >= 0 ? "Net Profit" : "Net Loss"}</p>
                  <p className={`text-3xl font-bold mt-1 ${profitLoss.netProfit >= 0 ? "text-green-700" : "text-red-600"}`}>{inr(Math.abs(profitLoss.netProfit))}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                    <div className="bg-green-50 border-b border-card-border px-4 py-3 flex justify-between">
                      <p className="font-semibold text-green-800 text-sm">Income</p>
                      <p className="font-bold text-green-700">{inr(profitLoss.totalIncome)}</p>
                    </div>
                    {profitLoss.income.length === 0 ? <div className="p-6 text-center text-muted-foreground text-sm">No income entries</div> : (
                      <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
                      <table className="w-full text-sm"><tbody>{profitLoss.income.map((r, i) => (<tr key={i} className="border-b border-card-border last:border-0 hover:bg-muted/20"><td className="px-4 py-2.5 font-medium">{r.name}</td><td className="px-4 py-2.5 text-xs text-muted-foreground">{r.group}</td><td className="px-4 py-2.5 text-right text-green-700 font-semibold">{inr(r.amount)}</td></tr>))}</tbody></table>
                    )}
                  </div>
                  <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                    <div className="bg-red-50 border-b border-card-border px-4 py-3 flex justify-between">
                      <p className="font-semibold text-red-800 text-sm">Expenses</p>
                      <p className="font-bold text-red-700">{inr(profitLoss.totalExpenses)}</p>
                    </div>
                    {profitLoss.expenses.length === 0 ? <div className="p-6 text-center text-muted-foreground text-sm">No expense entries</div> : (
                      <table className="w-full text-sm"><tbody>{profitLoss.expenses.map((r, i) => (<tr key={i} className="border-b border-card-border last:border-0 hover:bg-muted/20"><td className="px-4 py-2.5 font-medium">{r.name}</td><td className="px-4 py-2.5 text-xs text-muted-foreground">{r.group}</td><td className="px-4 py-2.5 text-right text-red-600 font-semibold">{inr(r.amount)}</td></tr>))}</tbody></table>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* ── Balance Sheet Tab ── */}
          <TabsContent value="balance-sheet" className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end bg-card border border-card-border rounded-xl p-4">
              <div><Label className="text-xs">As of Date</Label><Input type="date" value={rptTo} onChange={e => setRptTo(e.target.value)} className="mt-1 w-36" /></div>
              <Button size="sm" variant="outline" onClick={() => refetchBS()} disabled={bsFetching}><RefreshCw size={13} className={`mr-1 ${bsFetching ? "animate-spin" : ""}`} /> Refresh</Button>
            </div>
            {balanceSheet && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4"><p className="text-xs text-muted-foreground">Total Assets</p><p className="text-2xl font-bold text-blue-700">{inr(balanceSheet.totalAssets)}</p></div>
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-4"><p className="text-xs text-muted-foreground">Total Liabilities &amp; Capital</p><p className="text-2xl font-bold text-purple-700">{inr(balanceSheet.totalLiabilities)}</p></div>
                  <div className={`border rounded-xl p-4 col-span-2 md:col-span-1 ${balanceSheet.balanced ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
                    <p className="text-xs text-muted-foreground">Balance Check</p>
                    <p className={`text-lg font-bold mt-1 ${balanceSheet.balanced ? "text-green-700" : "text-amber-700"}`}>
                      {balanceSheet.balanced ? "✓ Balanced" : "⚠ Difference: " + inr(Math.abs(balanceSheet.totalAssets - balanceSheet.totalLiabilities))}
                    </p>
                    {balanceSheet.netProfit !== undefined && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Net {balanceSheet.netProfit >= 0 ? "Profit" : "Loss"}: <span className={balanceSheet.netProfit >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>{inr(Math.abs(balanceSheet.netProfit))}</span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                    <div className="bg-blue-50 border-b border-card-border px-4 py-3 flex justify-between"><p className="font-semibold text-blue-800 text-sm">Assets</p><p className="font-bold text-blue-700">{inr(balanceSheet.totalAssets)}</p></div>
                    {balanceSheet.assets.length === 0 ? <div className="p-6 text-center text-muted-foreground text-sm">No asset accounts</div> : (
                      <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
                      <table className="w-full text-sm"><tbody>{balanceSheet.assets.map((r, i) => (<tr key={i} className="border-b border-card-border last:border-0 hover:bg-muted/20"><td className="px-4 py-2.5 font-medium">{r.name}</td><td className="px-4 py-2.5 text-xs text-muted-foreground">{r.group}</td><td className="px-4 py-2.5 text-right font-semibold">{inr(r.amount)}</td></tr>))}</tbody></table>
                    )}
                  </div>
                  <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                    <div className="bg-purple-50 border-b border-card-border px-4 py-3 flex justify-between"><p className="font-semibold text-purple-800 text-sm">Liabilities &amp; Capital</p><p className="font-bold text-purple-700">{inr(balanceSheet.totalLiabilities)}</p></div>
                    {balanceSheet.liabilities.length === 0 ? <div className="p-6 text-center text-muted-foreground text-sm">No liability accounts</div> : (
                      <table className="w-full text-sm"><tbody>{balanceSheet.liabilities.map((r, i) => (<tr key={i} className="border-b border-card-border last:border-0 hover:bg-muted/20"><td className="px-4 py-2.5 font-medium">{r.name}</td><td className="px-4 py-2.5 text-xs text-muted-foreground">{r.group}</td><td className="px-4 py-2.5 text-right font-semibold">{inr(r.amount)}</td></tr>))}</tbody></table>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* ── Financial Statements (Schedule III, printable) Tab ── */}
          <TabsContent value="statements">
            <FinancialStatements />
          </TabsContent>

          {/* ── Voucher Edits Report Tab ── */}
          <TabsContent value="voucher-edits" className="space-y-4">
            <div className="bg-card border border-card-border rounded-xl p-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-3 flex items-center gap-1"><History size={13} /> System Audit Report — All Voucher Edits</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">From Date</Label>
                  <Input type="date" value={auditFilters.from} onChange={e => setAuditFilters(f => ({ ...f, from: e.target.value }))} className="mt-1 h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">To Date</Label>
                  <Input type="date" value={auditFilters.to} onChange={e => setAuditFilters(f => ({ ...f, to: e.target.value }))} className="mt-1 h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Edited By</Label>
                  <Input value={auditFilters.editedBy} onChange={e => setAuditFilters(f => ({ ...f, editedBy: e.target.value }))} className="mt-1 h-8 text-sm" placeholder="Name…" />
                </div>
                <div>
                  <Label className="text-xs">Voucher Number</Label>
                  <Input value={auditFilters.voucherNumber} onChange={e => setAuditFilters(f => ({ ...f, voucherNumber: e.target.value }))} className="mt-1 h-8 text-sm" placeholder="e.g. PV-202604…" />
                </div>
              </div>
              <div className="flex justify-between items-center mt-3">
                <span className="text-xs text-muted-foreground">{voucherAudits.length} record{voucherAudits.length !== 1 ? "s" : ""}</span>
                <Button size="sm" variant="outline" onClick={() => refetchAudits()} disabled={auditFetching}>
                  <RefreshCw size={12} className={`mr-1 ${auditFetching ? "animate-spin" : ""}`} /> Refresh
                </Button>
              </div>
            </div>

            {voucherAudits.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Clock size={36} className="mx-auto mb-3 opacity-30" />
                <p>No voucher edit records found.</p>
                <p className="text-xs mt-1">Edit a voucher to see the audit trail here.</p>
              </div>
            ) : (
              <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-card-border">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Timestamp</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Voucher</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Field Changed</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Edited By</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Reason</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Before</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {voucherAudits.map(a => (
                      <tr key={a.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3 font-mono text-xs font-medium">{a.voucherNumber}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${auditBadgeStyle[a.changeType] || "bg-gray-100 text-gray-600"}`}>{a.changeType}</span>
                        </td>
                        <td className="px-4 py-3 font-medium">{a.editedBy}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[180px] truncate">{a.reason}</td>
                        <td className="px-4 py-3 text-red-500 text-xs font-mono max-w-[120px] truncate">{a.oldValue ?? "—"}</td>
                        <td className="px-4 py-3 text-green-600 text-xs font-mono max-w-[120px] truncate">{a.newValue ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Tally Export Tab ── */}
          <TabsContent value="export" className="space-y-6">
            <div className="bg-card border border-card-border rounded-xl p-6 max-w-xl">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Download size={22} className="text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-base">Export to Tally</h3>
                  <p className="text-sm text-muted-foreground mt-1">Download XML files compatible with both TallyPrime and Tally.ERP 9. Always import Masters first, then Vouchers.</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 max-w-sm">
                    <div><Label className="text-[10px]">From Date</Label><Input type="date" value={exportDates.from} onChange={e => setExportDates(d => ({ ...d, from: e.target.value }))} className="mt-0.5 h-7 text-xs" /></div>
                    <div><Label className="text-[10px]">To Date</Label><Input type="date" value={exportDates.to} onChange={e => setExportDates(d => ({ ...d, to: e.target.value }))} className="mt-0.5 h-7 text-xs" /></div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {/* TallyPrime */}
                    <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                      <p className="text-sm font-semibold text-blue-900">TallyPrime (Recommended)</p>
                      <div className="mt-2 flex items-start gap-2">
                        <Button size="sm" variant="outline" onClick={downloadTallyMasters}><Download size={14} className="mr-1.5" /> Masters XML</Button>
                        <Button size="sm" variant="outline" onClick={downloadTallyVouchers}><Download size={14} className="mr-1.5" /> Vouchers XML</Button>
                      </div>
                    </div>
                    {/* Tally.ERP 9 */}
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                      <p className="text-sm font-semibold text-slate-700">Tally.ERP 9 (Legacy)</p>
                      <div className="mt-2 flex items-start gap-2">
                        <Button size="sm" variant="outline" onClick={downloadTallyErp9Masters}><Download size={14} className="mr-1.5" /> Masters XML</Button>
                        <Button size="sm" variant="outline" onClick={downloadTallyErp9Vouchers}><Download size={14} className="mr-1.5" /> Vouchers XML</Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 max-w-xl text-sm text-amber-800">
              <p className="font-semibold mb-2">How to Import — TallyPrime</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Open your company in TallyPrime</li>
                <li>Press <strong>Alt + O</strong> → <strong>Import</strong> → <strong>Data</strong></li>
                <li>Choose the <strong>Masters XML</strong> file first → ledgers are created</li>
                <li>Then choose the <strong>Vouchers XML</strong> file → transactions are imported</li>
                <li>Go to <strong>Gateway → Reports → Trial Balance</strong> to verify totals match</li>
              </ol>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 max-w-xl text-sm text-slate-700">
              <p className="font-semibold mb-2">How to Import — Tally.ERP 9</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Open your company in Tally.ERP 9</li>
                <li>Go to <strong>Gateway of Tally → Import of Data → Vouchers / Masters</strong></li>
                <li>For <strong>Masters</strong>: set File Path to the Masters XML → press Enter to import</li>
                <li>For <strong>Vouchers</strong>: set File Path to the Vouchers XML → press Enter to import</li>
                <li>If any ledger is missing, ERP 9 will prompt — press <strong>Y</strong> to create it on-the-fly</li>
                <li>Verify in <strong>Display → Trial Balance</strong></li>
              </ol>
            </div>
          </TabsContent>

          {/* ── Form 25 (Formerly 3C) Tab ── */}
          <TabsContent value="form-3c" className="space-y-4">
            <Form3C />
          </TabsContent>

          {/* ── Scan & Import Tab ── */}
          <TabsContent value="scan-import">
            <ScanImportTab accounts={accounts} onImported={() => {
              qc.invalidateQueries({ queryKey: ["vouchers"] });
              qc.invalidateQueries({ queryKey: ["ledger"] });
              qc.invalidateQueries({ queryKey: ["trial-balance"] });
              qc.invalidateQueries({ queryKey: ["profit-loss"] });
              qc.invalidateQueries({ queryKey: ["balance-sheet"] });
            }} />
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Add Account Dialog ── */}
      <Dialog open={accOpen} onOpenChange={setAccOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Ledger Account</DialogTitle></DialogHeader>
          <form onSubmit={subAcc((d) => createAccount.mutate({ ...d, openingBalance: Number(d.openingBalance || 0), gstApplicable: !!d.gstApplicable }))} className="space-y-4">
            <div><Label>Account Name *</Label><Input {...regAcc("name", { required: true })} className="mt-1" placeholder="e.g., SBI Current Account" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type *</Label>
                <Select onValueChange={(v) => setAccVal("type", v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Code / Alias</Label><Input {...regAcc("code")} className="mt-1" placeholder="e.g. 1001" /></div>
            </div>
            <div>
              <Label>Tally Group</Label>
              <Select onValueChange={(v) => setAccVal("tallyGroup", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select Tally group (optional)" /></SelectTrigger>
                <SelectContent>{TALLY_GROUPS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Opening Balance (₹)</Label><Input type="number" step="0.01" {...regAcc("openingBalance")} className="mt-1" placeholder="0" /></div>
              <div>
                <Label>Opening Balance Type</Label>
                <Select onValueChange={(v) => setAccVal("openingBalanceType", v)} defaultValue="Dr">
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Dr">Debit (Dr)</SelectItem><SelectItem value="Cr">Credit (Cr)</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            {accType === "bank" && (
              <>
                <div><Label>Bank Name</Label><Input {...regAcc("bankName")} className="mt-1" placeholder="e.g. State Bank of India" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Account No.</Label><Input {...regAcc("accountNumber")} className="mt-1" /></div>
                  <div><Label>IFSC</Label><Input {...regAcc("ifscCode")} className="mt-1" placeholder="SBIN0001234" /></div>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>GST Number</Label><Input {...regAcc("gstNumber")} className="mt-1" placeholder="27AAACR5055K1ZX" /></div>
              <div><Label>PAN</Label><Input {...regAcc("pan")} className="mt-1" placeholder="AAACR5055K" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAccOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createAccount.isPending}>{createAccount.isPending ? "Saving…" : "Add Account"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Create Voucher Dialog ── */}
      <Dialog open={voucherOpen} onOpenChange={setVoucherOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{VOUCHER_TYPES.find(t => t.value === voucherType)?.label || "New Voucher"}</DialogTitle>
          </DialogHeader>
          {VOUCHER_TYPES.find(t => t.value === voucherType) && (
            <p className="text-xs text-muted-foreground -mt-2">{VOUCHER_TYPES.find(t => t.value === voucherType)?.desc}</p>
          )}
          <form onSubmit={subV((d) => createVoucher.mutate({ ...d, type: voucherType, amount: Number(d.amount), billId: d.billId ? Number(d.billId) : undefined }))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date *</Label><Input type="date" {...regV("date", { required: true })} className="mt-1" defaultValue={new Date().toISOString().split("T")[0]} /></div>
              <div><Label>Amount (₹) *</Label><Input type="number" step="0.01" {...regV("amount", { required: true })} className="mt-1" /></div>
            </div>
            <div>
              <Label>{voucherType === "contra" || voucherType === "bank_transfer" ? "From Account (Credit)" : "Credit Account"} *</Label>
              <Select onValueChange={(v) => setVVal("creditAccountId", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select account…" /></SelectTrigger>
                <SelectContent>
                  {(voucherType === "contra" || voucherType === "bank_transfer" ? activeAccounts.filter(a => a.type === "cash" || a.type === "bank") : activeAccounts)
                    .map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{voucherType === "contra" || voucherType === "bank_transfer" ? "To Account (Debit)" : "Debit Account"} *</Label>
              <Select onValueChange={(v) => setVVal("debitAccountId", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select account…" /></SelectTrigger>
                <SelectContent>
                  {(voucherType === "contra" || voucherType === "bank_transfer" ? activeAccounts.filter(a => a.type === "bank") : activeAccounts)
                    .map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Particular *</Label><Input {...regV("particular", { required: true })} className="mt-1" placeholder="e.g., Lab supplies purchase" /></div>
            <div><Label>Narration</Label><Input {...regV("narration")} className="mt-1" placeholder="Additional notes" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Performed By</Label><Input {...regV("performedBy")} className="mt-1" /></div>
              <div><Label>Reference No.</Label><Input {...regV("reference")} className="mt-1" placeholder="Bill#, Cheque#…" /></div>
            </div>
            <div><Label>Link Bill ID (optional)</Label><Input type="number" {...regV("billId")} className="mt-1" placeholder="e.g. 42" /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setVoucherOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createVoucher.isPending}>{createVoucher.isPending ? "Saving…" : "Create Voucher"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Voucher Dialog ── */}
      <Dialog open={editVoucherOpen} onOpenChange={setEditVoucherOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil size={15} /> Edit Voucher — {editingVoucher?.voucherNumber}</DialogTitle>
          </DialogHeader>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
            All changes are permanently logged in the audit trail for this voucher.
          </div>
          <form onSubmit={subEV((d) => {
            if (!editingVoucher) return;
            editVoucher.mutate({
              id: editingVoucher.id,
              body: {
                date: d.date,
                amount: Number(d.amount),
                particular: d.particular,
                remark: d.remark,
                performedBy: d.performedBy,
                reference: d.reference,
                narration: d.narration,
                editedBy: d.editedBy,
                reason: d.reason,
              },
            });
          })} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" {...regEV("date")} className="mt-1" /></div>
              <div><Label>Amount (₹)</Label><Input type="number" step="0.01" {...regEV("amount")} className="mt-1" /></div>
            </div>
            <div><Label>Particular</Label><Input {...regEV("particular")} className="mt-1" /></div>
            <div><Label>Narration</Label><Input {...regEV("narration")} className="mt-1" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Performed By</Label><Input {...regEV("performedBy")} className="mt-1" /></div>
              <div><Label>Reference No.</Label><Input {...regEV("reference")} className="mt-1" /></div>
            </div>
            <div><Label>Remark</Label><Input {...regEV("remark")} className="mt-1" /></div>
            <div className="border-t border-border pt-3 space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Audit Information (Required)</p>
              <div><Label>Your Name *</Label><Input {...regEV("editedBy", { required: true })} className="mt-1" placeholder="Who is making this edit?" /></div>
              <div><Label>Reason for Edit *</Label><Input {...regEV("reason", { required: true })} className="mt-1" placeholder="e.g., Corrected wrong amount entry" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditVoucherOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={editVoucher.isPending}>{editVoucher.isPending ? "Saving…" : "Save Changes"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan & Import Tab — Bill OCR + Bank Statement Importer
// ─────────────────────────────────────────────────────────────────────────────

function ScanImportTab({ accounts, onImported }: { accounts: Account[]; onImported: () => void }) {
  const [subTab, setSubTab] = useState<"bill" | "bank">("bill");
  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/30 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5">
        <h2 className="font-bold text-lg flex items-center gap-2"><ScanLine size={18} className="text-indigo-600" /> AI-Powered Scan &amp; Import</h2>
        <p className="text-sm text-muted-foreground mt-1">Scan physical bills with your phone camera to auto-capture expenses, or import bank statements into your ledger automatically.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setSubTab("bill")} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${subTab === "bill" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-card-border hover:bg-accent"}`}>
          <Camera size={15} /> Bill / Receipt Scanner
        </button>
        <button onClick={() => setSubTab("bank")} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${subTab === "bank" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-card-border hover:bg-accent"}`}>
          <Banknote size={15} /> Bank Statement Import
        </button>
      </div>
      {subTab === "bill" ? <BillReceiptScannerPanel /> : <BankStatementImportPanel accounts={accounts} onImported={onImported} />}
    </div>
  );
}
