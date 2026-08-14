import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Landmark, RefreshCw, Plus, Trash2, ArrowUpRight, ArrowDownLeft,
  CreditCard, Activity, CheckCircle, Unlink, Link2, Globe,
  Wallet, Send, Clock, AlertCircle, ShieldAlert, Ban, FileCheck,
  XCircle, RotateCcw, ScrollText, Banknote, Eye, Fingerprint, Calendar,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import BankStatementImportPanel from "@/components/BankStatementImportPanel";

const PROVIDERS = [
  { value: "mock", label: "Mock / Test" },
  { value: "icici", label: "ICICI Bank" },
  { value: "hdfc", label: "HDFC Bank" },
  { value: "axis", label: "Axis Bank" },
  { value: "sbi", label: "SBI" },
  { value: "kotak", label: "Kotak Mahindra" },
  { value: "bharatpe", label: "BharatPe" },
  { value: "phonepe", label: "PhonePe" },
  { value: "cashfree", label: "Cashfree" },
  { value: "generic", label: "Generic / Other" },
];

const ENV_OPTIONS = [
  { value: "sandbox", label: "Sandbox" },
  { value: "production", label: "Production" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suspended", label: "Suspended" },
];

// ── Types ────────────────────────────────────────────────────────────────────

interface BankAccount {
  id: number;
  provider: string;
  bankName: string;
  accountNickname: string | null;
  maskedAccountNumber: string;
  ifsc: string | null;
  branch: string | null;
  environment: string;
  status: string;
}

interface BankTxn {
  id: number;
  provider: string;
  transactionDate: string;
  description: string | null;
  amount: string;
  type: string;
  utr: string | null;
  reconciliationStatus: string;
}

interface PaymentRequest {
  id: number;
  provider: string;
  amount: string;
  currency: string;
  purpose: string | null;
  beneficiaryName: string | null;
  status: string;
  failureReason: string | null;
  createdAt: string;
}

interface WebhookLog {
  id: number;
  provider: string;
  eventType: string | null;
  signatureValid: boolean | null;
  processed: boolean;
  createdAt: string;
}

interface BankingSummary {
  totalAccounts: number;
  unreconciledTransactions: number;
  pendingPayments: number;
  webhooks24h: number;
}

// Enterprise types
interface ReconciliationLog {
  id: number;
  bankTransactionId: number | null;
  billId: number | null;
  paymentId: number | null;
  voucherId: number | null;
  matchStrategy: string;
  confidenceScore: number;
  autoClosed: boolean;
  performedBy: string;
  createdAt: string;
}

interface FraudAlert {
  id: number;
  alertType: string;
  severity: string;
  status: string;
  billId: number | null;
  paymentId: number | null;
  description: string;
  resolutionNote: string | null;
  resolutionAction: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface GatewayTransaction {
  id: number;
  provider: string;
  gatewayOrderId: string;
  amount: string;
  currency: string;
  status: string;
  settlementStatus: string;
  utr: string | null;
  gatewayFee: string | null;
  netSettled: string | null;
  settlementUtr: string | null;
  settlementDate: string | null;
  bankTransactionId: number | null;
  createdAt: string;
}

interface RefundRequest {
  id: number;
  billId: number;
  paymentId: number;
  amount: string;
  reason: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

interface ShiftClosure {
  id: number;
  userName: string;
  startedAt: string;
  endedAt: string | null;
  supervisorName: string | null;
  denominations: Record<string, number> | null;
  actualTotal: string;
  expectedTotal: string;
  variance: string;
  status: string;
  notes: string;
}

// Day Close integration types
interface DcMethodTotals {
  cash: number; upi: number; card: number; cheque: number; other: number;
  total: number; count: number;
}
interface DcMyPreview {
  userName: string;
  coveredFromTs: string | null;
  coveredToTs: string;
  expected: DcMethodTotals;
  billsCount: number;
  paymentsCount: number;
  totalBilled: number;
  totalDue: number;
}
interface DcMyClose {
  id: number;
  closureDate: string;
  closedAt: string;
  coveredFromTs: string | null;
  expectedCash: string; expectedUpi: string; expectedCard: string; expectedCheque: string; expectedOther: string;
  totalExpected: string; totalActual: string; variance: string;
  billsCount: number; paymentsCount: number;
  drawerStatus: string;
  notes: string;
}
interface DcOwnerPreview {
  coveredFromTs: string | null;
  coveredToTs: string;
  expected: DcMethodTotals;
  byStaff: (DcMethodTotals & { userId: number | null; userName: string })[];
  billsCount: number; paymentsCount: number;
}
interface DcOwnerClosure {
  id: number;
  closureDate: string;
  closedAt: string;
  closedByName: string;
  coveredFromTs: string | null;
  coveredToTs: string;
  expectedCash: string; expectedUpi: string; expectedCard: string; expectedCheque: string; expectedOther: string;
  actualCash: string; actualUpi: string; actualCard: string; actualCheque: string; actualOther: string;
  totalExpected: string; totalActual: string; variance: string;
  billsCount: number; paymentsCount: number;
  status: "closed" | "reopened";
  reopenedAt: string | null; reopenedByName: string; reopenReason: string;
}
interface DcBankSummary {
  accountId: number; provider: string; bankName: string; nickname: string | null;
  balance: number | null; credits: number; debits: number; net: number;
  transactionCount: number; error?: string;
}

// ── Severity / Status helpers ────────────────────────────────────────────────

const severityColor = (s: string) => {
  switch (s) {
    case "critical": return "bg-red-100 text-red-800";
    case "high": return "bg-orange-100 text-orange-800";
    case "medium": return "bg-yellow-100 text-yellow-800";
    case "low": return "bg-blue-100 text-blue-800";
    default: return "bg-gray-100 text-gray-800";
  }
};

const fraudStatusColor = (s: string) => {
  switch (s) {
    case "resolved": return "bg-green-100 text-green-800";
    case "investigating": return "bg-yellow-100 text-yellow-800";
    case "false_positive": return "bg-blue-100 text-blue-800";
    case "escalated": return "bg-purple-100 text-purple-800";
    default: return "bg-red-100 text-red-800";
  }
};

const refundStatusColor = (s: string) => {
  switch (s) {
    case "approved": return "bg-green-100 text-green-800";
    case "processed": return "bg-blue-100 text-blue-800";
    case "rejected": return "bg-red-100 text-red-800";
    default: return "bg-yellow-100 text-yellow-800";
  }
};

const gatewayStatusColor = (s: string) => {
  switch (s) {
    case "captured": return "bg-green-100 text-green-800";
    case "settled": return "bg-blue-100 text-blue-800";
    case "failed": return "bg-red-100 text-red-800";
    default: return "bg-yellow-100 text-yellow-800";
  }
};

// ── Component ────────────────────────────────────────────────────────────────

export default function Banking() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("accounts");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [viewTxOpen, setViewTxOpen] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState<number | null>(null);
  const [matchUtr, setMatchUtr] = useState("");
  const [matchVoucherId, setMatchVoucherId] = useState("");
  const [matchPaymentId, setMatchPaymentId] = useState("");
  const [matchLoading, setMatchLoading] = useState(false);

  // Day Close integration state
  const [dcDate, setDcDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [dcView, setDcView] = useState<"my" | "owner">("my");

  // Balance refresh state
  const [refreshAllLoading, setRefreshAllLoading] = useState(false);

  // Enterprise state
  const [batchThreshold, setBatchThreshold] = useState(80);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    processed: number; matched: number; autoClosed: number; failed: number;
  } | null>(null);
  const [fraudFilter, setFraudFilter] = useState<{ status?: string; severity?: string }>({});
  const [gatewaySettlementFilter, setGatewaySettlementFilter] = useState<string>("all");
  const [reconciliationSchedule, setReconciliationSchedule] = useState({ enabled: true, threshold: 80, frequencyMinutes: 5 });
  const [exportFormat, setExportFormat] = useState<string>("excel");
  const [exportLoading, setExportLoading] = useState(false);
  const [resolveAlertId, setResolveAlertId] = useState<number | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveAction, setResolveAction] = useState<string>("approved");
  const [refundForm, setRefundForm] = useState({ billId: "", paymentId: "", amount: "", reason: "" });
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    shiftLabel: "Morning",
    d500: 0, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, coins: 0,
    supervisorName: "", notes: "",
  });

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    bankAccountId: "", amount: "", currency: "INR",
    purpose: "", beneficiaryName: "", beneficiaryAccount: "", beneficiaryIfsc: "",
    billId: "", voucherId: "",
  });

  const [form, setForm] = useState({
    provider: "mock",
    bankName: "",
    accountNickname: "",
    maskedAccountNumber: "",
    ifsc: "",
    branch: "",
    environment: "sandbox" as const,
    status: "active" as const,
    credentialKey: "",
  });

  // ── Queries ────────────────────────────────────────────────────────────────

  const accountsQuery = useQuery<BankAccount[]>({
    queryKey: ["banking", "accounts"],
    queryFn: () => api.get("/api/banking/accounts"),
  });

  const ledgerAccountsQuery = useQuery<{ id: number; name: string; type: string }[]>({
    queryKey: ["accounts"],
    queryFn: () => api.get("/api/accounting/accounts"),
  });

  const summaryQuery = useQuery<BankingSummary>({
    queryKey: ["banking", "summary"],
    queryFn: () => api.get("/api/banking/summary"),
  });

  const transactionsQuery = useQuery<BankTxn[]>({
    queryKey: ["banking", "transactions", { accountId: selectedAccount }],
    queryFn: () => api.get(`/api/banking/transactions?accountId=${selectedAccount}&limit=100`),
    enabled: viewTxOpen && selectedAccount !== null,
  });

  const unreconciledQuery = useQuery<BankTxn[]>({
    queryKey: ["banking", "unreconciled"],
    queryFn: () => api.get("/api/banking/reconciliation/unreconciled?limit=100"),
  });

  const paymentsQuery = useQuery<PaymentRequest[]>({
    queryKey: ["banking", "payments"],
    queryFn: () => api.get("/api/banking/payments?limit=100"),
  });

  const webhooksQuery = useQuery<WebhookLog[]>({
    queryKey: ["banking", "webhooks"],
    queryFn: () => api.get("/api/banking/webhook-logs?limit=50"),
  });

  const reconciliationLogsQuery = useQuery<ReconciliationLog[]>({
    queryKey: ["banking", "reconciliation-logs"],
    queryFn: () => api.get("/api/banking/reconciliation/logs?limit=100"),
    enabled: tab === "reconciliation",
  });

  const fraudAlertsQuery = useQuery<FraudAlert[]>({
    queryKey: ["banking", "fraud-alerts", fraudFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (fraudFilter.status) params.set("status", fraudFilter.status);
      if (fraudFilter.severity) params.set("severity", fraudFilter.severity);
      return api.get(`/api/banking/fraud/alerts?limit=100&${params.toString()}`);
    },
    enabled: tab === "fraud",
  });

  const gatewayQuery = useQuery<GatewayTransaction[]>({
    queryKey: ["banking", "gateways"],
    queryFn: () => api.get("/api/banking/gateway-transactions?limit=100"),
    enabled: tab === "gateways",
  });

  const refundsQuery = useQuery<RefundRequest[]>({
    queryKey: ["banking", "refunds"],
    queryFn: () => api.get("/api/banking/refunds?limit=100"),
    enabled: tab === "refunds",
  });

  const shiftsQuery = useQuery<ShiftClosure[]>({
    queryKey: ["banking", "shifts"],
    queryFn: () => api.get("/api/banking/shift-closures?limit=100"),
    enabled: tab === "shifts",
  });

  // Day Close integration queries
  const dcMyPreviewQ = useQuery<DcMyPreview>({
    queryKey: ["banking", "day-close", "my-preview", dcDate],
    queryFn: () => api.get("/api/day-close/my-preview"),
    enabled: tab === "day-close" && dcView === "my",
  });
  const dcMyListQ = useQuery<DcMyClose[]>({
    queryKey: ["banking", "day-close", "my-list"],
    queryFn: () => api.get("/api/day-close/my-list"),
    enabled: tab === "day-close" && dcView === "my",
  });
  const dcOwnerPreviewQ = useQuery<DcOwnerPreview>({
    queryKey: ["banking", "day-close", "preview", dcDate],
    queryFn: () => api.get("/api/day-close/preview"),
    enabled: tab === "day-close" && dcView === "owner",
  });
  const dcOwnerListQ = useQuery<DcOwnerClosure[]>({
    queryKey: ["banking", "day-close", "list", dcDate],
    queryFn: () => api.get("/api/day-close"),
    enabled: tab === "day-close" && dcView === "owner",
  });
  const dcBankQ = useQuery<{ date: string; summary: DcBankSummary[] }>({
    queryKey: ["banking", "day-close-banking", dcDate],
    queryFn: () => api.get(`/api/banking/day-close/${dcDate}`),
    enabled: tab === "day-close",
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createAccount = useMutation({
    mutationFn: (body: unknown) => api.post("/api/banking/accounts", body),
    onSuccess: () => {
      toast({ title: "Bank account added", variant: "default" });
      setAddOpen(false);
      setForm({
        provider: "mock", bankName: "", accountNickname: "", maskedAccountNumber: "",
        ifsc: "", branch: "", environment: "sandbox", status: "active", credentialKey: "",
      });
      qc.invalidateQueries({ queryKey: ["banking"] });
    },
    onError: (e: Error) => toast({ title: "Failed to add account", description: e.message, variant: "destructive" }),
  });

  const deleteAccount = useMutation({
    mutationFn: (id: number) => api.delete(`/api/banking/accounts/${id}`),
    onSuccess: () => {
      toast({ title: "Account removed", variant: "default" });
      qc.invalidateQueries({ queryKey: ["banking"] });
    },
    onError: (e: Error) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  const resolveAlert = useMutation({
    mutationFn: (body: { id: number; status: string; resolutionNote: string; resolutionAction: string }) =>
      api.patch(`/api/banking/fraud/alerts/${body.id}`, {
        status: body.status,
        resolutionNote: body.resolutionNote || undefined,
        resolutionAction: body.resolutionAction,
      }),
    onSuccess: () => {
      toast({ title: "Alert resolved" });
      setResolveAlertId(null);
      setResolveNote("");
      setResolveAction("approved");
      qc.invalidateQueries({ queryKey: ["banking", "fraud-alerts"] });
    },
    onError: (e: Error) => toast({ title: "Failed to resolve", description: e.message, variant: "destructive" }),
  });

  const createRefund = useMutation({
    mutationFn: (body: { billId: number; paymentId: number; amount: number; reason: string }) =>
      api.post("/api/banking/refunds", body),
    onSuccess: () => {
      toast({ title: "Refund requested" });
      setRefundDialogOpen(false);
      setRefundForm({ billId: "", paymentId: "", amount: "", reason: "" });
      qc.invalidateQueries({ queryKey: ["banking", "refunds"] });
    },
    onError: (e: Error) => toast({ title: "Request failed", description: e.message, variant: "destructive" }),
  });

  const approveRefund = useMutation({
    mutationFn: (id: number) => api.patch(`/api/banking/refunds/${id}/approve`, {}),
    onSuccess: () => {
      toast({ title: "Refund approved" });
      qc.invalidateQueries({ queryKey: ["banking", "refunds"] });
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const rejectRefund = useMutation({
    mutationFn: (vars: { id: number; reason: string }) => api.patch(`/api/banking/refunds/${vars.id}/reject`, { reason: vars.reason }),
    onSuccess: () => {
      toast({ title: "Refund rejected" });
      qc.invalidateQueries({ queryKey: ["banking", "refunds"] });
    },
    onError: (e: Error) => toast({ title: "Rejection failed", description: e.message, variant: "destructive" }),
  });

  const createShift = useMutation({
    mutationFn: (body: unknown) => api.post("/api/banking/shift-closures", body),
    onSuccess: () => {
      toast({ title: "Shift closure recorded" });
      setShiftDialogOpen(false);
      setShiftForm({ shiftLabel: "Morning", d500: 0, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, coins: 0, supervisorName: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["banking", "shifts"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const createPayment = useMutation({
    mutationFn: (body: unknown) => api.post("/api/banking/payments", body),
    onSuccess: () => {
      toast({ title: "Payment initiated" });
      setPaymentDialogOpen(false);
      setPaymentForm({ bankAccountId: "", amount: "", currency: "INR", purpose: "", beneficiaryName: "", beneficiaryAccount: "", beneficiaryIfsc: "", billId: "", voucherId: "" });
      qc.invalidateQueries({ queryKey: ["banking", "payments"] });
    },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function fetchBalance(accountId: number) {
    setBalanceLoading(accountId);
    try {
      const data = await api.get<{ account: BankAccount; balance: { available: number; currency: string } }>(`/api/banking/accounts/${accountId}/balance`);
      toast({ title: "Balance", description: `${data.account.bankName}: ${data.balance.available.toLocaleString("en-IN")} ${data.balance.currency}` });
    } catch (e: any) {
      toast({ title: "Balance fetch failed", description: e?.message || "Provider error", variant: "destructive" });
    } finally {
      setBalanceLoading(null);
    }
  }

  async function importTxns(accountId: number) {
    try {
      const data = await api.post<{ imported: number }>(`/api/banking/accounts/${accountId}/transactions/import`, {});
      toast({ title: "Import complete", description: `${data.imported} transactions imported` });
      qc.invalidateQueries({ queryKey: ["banking", "transactions"] });
    } catch (e: any) {
      toast({ title: "Import failed", description: e?.message || "Error", variant: "destructive" });
    }
  }

  async function reconcileUtr() {
    if (!matchUtr.trim()) return;
    setMatchLoading(true);
    try {
      const body: Record<string, unknown> = { utr: matchUtr.trim() };
      if (matchVoucherId.trim()) body.voucherId = Number(matchVoucherId.trim());
      if (matchPaymentId.trim()) body.paymentId = Number(matchPaymentId.trim());
      await api.post("/api/banking/reconciliation/match", body);
      toast({ title: "Reconciled", description: `UTR ${matchUtr} matched successfully` });
      setMatchUtr(""); setMatchVoucherId(""); setMatchPaymentId("");
      qc.invalidateQueries({ queryKey: ["banking"] });
    } catch (e: any) {
      toast({ title: "Reconciliation failed", description: e?.message || "No transaction found", variant: "destructive" });
    } finally {
      setMatchLoading(false);
    }
  }

  async function runBatchReconcile() {
    setBatchLoading(true);
    try {
      const result = await api.post<{
        processed: number; matched: number; autoClosed: number; failed: number;
      }>("/api/banking/reconciliation/batch", { autoCloseThreshold: batchThreshold });
      setBatchResult(result);
      toast({ title: "Batch reconcile complete", description: `${result.matched} matched, ${result.autoClosed} auto-closed` });
      qc.invalidateQueries({ queryKey: ["banking"] });
    } catch (e: any) {
      toast({ title: "Batch reconcile failed", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setBatchLoading(false);
    }
  }

  async function runFraudCheck() {
    try {
      const result = await api.post<{ totalAlerts: number; byRule: Record<string, number> }>("/api/banking/fraud/run-check", {});
      toast({ title: `Fraud check complete`, description: `${result.totalAlerts} alerts raised` });
      qc.invalidateQueries({ queryKey: ["banking", "fraud-alerts"] });
    } catch (e: any) {
      toast({ title: "Fraud check failed", description: e?.message || "Error", variant: "destructive" });
    }
  }

  const accounts = accountsQuery.data ?? [];
  const summary = summaryQuery.data ?? { totalAccounts: 0, unreconciledTransactions: 0, pendingPayments: 0, webhooks24h: 0 };
  const transactions = transactionsQuery.data ?? [];

  // ── Denomination helpers ───────────────────────────────────────────────────
  const shiftTotal =
    shiftForm.d500 * 500 + shiftForm.d200 * 200 + shiftForm.d100 * 100 +
    shiftForm.d50 * 50 + shiftForm.d20 * 20 + shiftForm.d10 * 10 +
    shiftForm.coins;

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Landmark className="w-6 h-6 text-primary" />
          Banking
        </h1>
        <div className="flex gap-2">
          {/* Recovered discoverability: bank statement AI import already
              exists and works under Accounting → Scan & Import — this links
              to it rather than rebuilding a second import UI here. */}
          <Button variant="outline" size="sm" onClick={() => setTab("statement")} className="gap-1.5">
            <ScanLine className="w-4 h-4" /> Import Statement (JPEG / OCR)
          </Button>
          <Button variant="outline" onClick={async () => {
            setRefreshAllLoading(true);
            try {
              const result = await api.post<{ refreshed: number; results: { accountId: number; balance: number | null; error?: string }[] }>("/api/banking/accounts/refresh-all", {});
              const errors = result.results.filter(r => r.error).length;
              toast({ title: `Refreshed ${result.refreshed} accounts`, description: errors > 0 ? `${errors} failed — see Accounts tab` : "All balances updated" });
              qc.invalidateQueries({ queryKey: ["banking", "accounts"] });
            } catch (e: any) {
              toast({ title: "Refresh failed", description: e?.message || "Error", variant: "destructive" });
            } finally {
              setRefreshAllLoading(false);
            }
          }} disabled={refreshAllLoading}>
            {refreshAllLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Refresh All
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Account
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.totalAccounts || accounts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unreconciled</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.unreconciledTransactions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary.pendingPayments}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Settlements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {(() => {
                const pending = (gatewayQuery.data ?? []).filter(g => g.settlementStatus === "pending").length;
                return pending;
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="statement">Statement OCR</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="fraud">Fraud</TabsTrigger>
          <TabsTrigger value="refunds">Refunds</TabsTrigger>
          <TabsTrigger value="gateways">Gateways</TabsTrigger>
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="day-close">Day Close</TabsTrigger>
        </TabsList>

        <TabsContent value="statement">
          <BankStatementImportPanel
            accounts={ledgerAccountsQuery.data ?? []}
            onImported={() => {
              qc.invalidateQueries({ queryKey: ["vouchers"] });
              qc.invalidateQueries({ queryKey: ["ledger"] });
              qc.invalidateQueries({ queryKey: ["banking"] });
            }}
          />
        </TabsContent>

        {/* ── Accounts ─────────────────────────────────────────────────────── */}
        <TabsContent value="accounts">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bank</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Environment</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.bankName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase">{a.provider}</Badge>
                      </TableCell>
                      <TableCell>
                        {a.accountNickname || a.maskedAccountNumber}
                        {a.ifsc && <div className="text-xs text-muted-foreground">IFSC: {a.ifsc}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn(
                          a.status === "active" && "bg-green-100 text-green-800",
                          a.status === "inactive" && "bg-gray-100 text-gray-800",
                          a.status === "suspended" && "bg-red-100 text-red-800",
                        )}>{a.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{a.environment}</Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => fetchBalance(a.id)} disabled={balanceLoading === a.id}>
                          <Wallet className="w-3 h-3 mr-1" />
                          {balanceLoading === a.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Balance"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setSelectedAccount(a.id); setViewTxOpen(true); }}>
                          <Activity className="w-3 h-3 mr-1" /> Txns
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => importTxns(a.id)}>
                          <ArrowDownLeft className="w-3 h-3 mr-1" /> Import
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteAccount.mutate(a.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {accounts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No bank accounts configured. Add your first account to get started.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Transactions ──────────────────────────────────────────────────── */}
        <TabsContent value="transactions">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <Select value={exportFormat} onValueChange={(v) => setExportFormat(v)}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="excel">Excel</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={async () => {
                  setExportLoading(true);
                  try {
                    const resp = await api.get<{ exportUrl?: string; data?: { headers: string[]; rows: Record<string, unknown>[] } }>(`/api/banking/export?format=${exportFormat}&accountId=${selectedAccount || ""}`);
                    if (resp.exportUrl) { window.open(resp.exportUrl, "_blank"); }
                    else if (resp.data && exportFormat === "csv") {
                      const csv = [resp.data.headers.join(","), ...resp.data.rows.map((r: any) => resp.data!.headers.map((h: string) => `"${String(r[h] ?? "").replace(/"/g, "")}"`).join(","))].join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `bank-statement-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
                    }
                    toast({ title: "Export ready" });
                  } catch (e: any) {
                    toast({ title: "Export failed", description: e?.message || "Error", variant: "destructive" });
                  } finally { setExportLoading(false); }
                }} disabled={exportLoading || transactions.length === 0}>
                  {exportLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <ScrollText className="w-4 h-4 mr-2" />}
                  Export
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">{transactions.length} transaction{transactions.length !== 1 ? "s" : ""} shown</span>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>UTR</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{new Date(t.transactionDate).toLocaleDateString("en-IN")}</TableCell>
                        <TableCell className="max-w-xs truncate">{t.description || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={t.type === "credit" ? "default" : "secondary"}>
                            {t.type === "credit" ? <ArrowDownLeft className="w-3 h-3 mr-1" /> : <ArrowUpRight className="w-3 h-3 mr-1" />}
                            {t.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">{parseFloat(t.amount).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="font-mono text-xs">{t.utr || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(
                            t.reconciliationStatus === "matched" && "bg-green-50 text-green-700",
                            t.reconciliationStatus === "unreconciled" && "bg-yellow-50 text-yellow-700",
                          )}>
                            {t.reconciliationStatus === "matched" ? <CheckCircle className="w-3 h-3 mr-1" /> : <Unlink className="w-3 h-3 mr-1" />}
                            {t.reconciliationStatus}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {transactions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No transactions. Select an account and import transactions from the provider.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        {/* ── Payments ───────────────────────────────────────────────────────── */}
        <TabsContent value="payments">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setPaymentDialogOpen(true)}><Send className="w-4 h-4 mr-2" /> Initiate Payout</Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Beneficiary</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(paymentsQuery.data ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.createdAt).toLocaleDateString("en-IN")}</TableCell>
                      <TableCell className="font-medium">{p.beneficiaryName || "—"}</TableCell>
                      <TableCell className="font-mono">{parseFloat(p.amount).toLocaleString("en-IN")} {p.currency}</TableCell>
                      <TableCell className="max-w-xs truncate">{p.purpose || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(
                          p.status === "completed" && "bg-green-50 text-green-700",
                          p.status === "pending" && "bg-yellow-50 text-yellow-700",
                          p.status === "failed" && "bg-red-50 text-red-700",
                        )}>
                          {p.status === "completed" ? <CheckCircle className="w-3 h-3 mr-1" />
                            : p.status === "pending" ? <Clock className="w-3 h-3 mr-1" />
                            : <AlertCircle className="w-3 h-3 mr-1" />}
                          {p.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(paymentsQuery.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No payment requests. Click Initiate Payout to start a transfer.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          </div>
        </TabsContent>

        {/* ── Reconciliation (Enterprise) ──────────────────────────────────── */}
        <TabsContent value="reconciliation">
          <div className="space-y-4">
            {/* Batch Reconcile */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><RefreshCw className="w-5 h-5" /> Batch Reconcile</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <Label>Auto-Close Confidence Threshold: {batchThreshold}%</Label>
                    <Slider value={[batchThreshold]} onValueChange={(v) => setBatchThreshold(v[0])} min={0} max={100} step={5} className="mt-2" />
                    <p className="text-xs text-muted-foreground mt-1">Dues with confidence above this will be auto-closed.</p>
                  </div>
                  <Button onClick={runBatchReconcile} disabled={batchLoading} className="shrink-0">
                    {batchLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                    {batchLoading ? "Running..." : "Run Batch Reconcile"}
                  </Button>
                </div>
                {batchResult && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold">{batchResult.processed}</div>
                      <div className="text-xs text-muted-foreground">Processed</div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-green-700">{batchResult.matched}</div>
                      <div className="text-xs text-green-700">Matched</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-700">{batchResult.autoClosed}</div>
                      <div className="text-xs text-blue-700">Auto-Closed</div>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-red-700">{batchResult.failed}</div>
                      <div className="text-xs text-red-700">Failed</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Manual UTR match */}
            <Card>
              <CardHeader><CardTitle>Match by UTR</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label>UTR / Reference</Label>
                    <Input value={matchUtr} onChange={(e) => setMatchUtr(e.target.value)} placeholder="e.g. 123456789012" />
                  </div>
                  <div>
                    <Label>Voucher ID (optional)</Label>
                    <Input value={matchVoucherId} onChange={(e) => setMatchVoucherId(e.target.value)} placeholder="Number" />
                  </div>
                  <div>
                    <Label>Payment ID (optional)</Label>
                    <Input value={matchPaymentId} onChange={(e) => setMatchPaymentId(e.target.value)} placeholder="Number" />
                  </div>
                </div>
                <Button onClick={reconcileUtr} disabled={matchLoading || !matchUtr.trim()}>
                  <Link2 className="w-4 h-4 mr-2" />
                  {matchLoading ? "Matching..." : "Match & Reconcile"}
                </Button>
              </CardContent>
            </Card>

            {/* Unreconciled list */}
            <Card>
              <CardHeader><CardTitle>Unreconciled Transactions</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>UTR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(unreconciledQuery.data ?? []).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{new Date(t.transactionDate).toLocaleDateString("en-IN")}</TableCell>
                        <TableCell className="max-w-xs truncate">{t.description || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={t.type === "credit" ? "default" : "secondary"}>
                            {t.type === "credit" ? <ArrowDownLeft className="w-3 h-3 mr-1" /> : <ArrowUpRight className="w-3 h-3 mr-1" />}
                            {t.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">{parseFloat(t.amount).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="font-mono text-xs">{t.utr || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {(unreconciledQuery.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          All transactions are reconciled. Great!
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Automated Reconciliation Scheduler */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5" /> Auto-Reconciliation Scheduler</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex items-center gap-2">
                    <input id="auto-recon" type="checkbox" checked={reconciliationSchedule.enabled} onChange={(e) => setReconciliationSchedule(s => ({ ...s, enabled: e.target.checked }))} className="h-4 w-4" />
                    <Label htmlFor="auto-recon" className="cursor-pointer">Enabled</Label>
                  </div>
                  <div>
                    <Label>Frequency</Label>
                    <Select value={String(reconciliationSchedule.frequencyMinutes)} onValueChange={(v) => setReconciliationSchedule(s => ({ ...s, frequencyMinutes: Number(v) }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">Every 5 minutes</SelectItem>
                        <SelectItem value="15">Every 15 minutes</SelectItem>
                        <SelectItem value="30">Every 30 minutes</SelectItem>
                        <SelectItem value="60">Every hour</SelectItem>
                        <SelectItem value="360">Every 6 hours</SelectItem>
                        <SelectItem value="720">Every 12 hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Threshold: {reconciliationSchedule.threshold}%</Label>
                    <Slider value={[reconciliationSchedule.threshold]} onValueChange={(v) => setReconciliationSchedule(s => ({ ...s, threshold: v[0] }))} min={0} max={100} step={5} className="mt-2" />
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Server runs auto-sync every 5 min (configured in cron). This UI is for visibility and future scheduling.</span>
                  <Button size="sm" variant="outline" onClick={async () => {
                    setBatchLoading(true);
                    try {
                      await api.post("/api/internal-cron/banking-auto-sync", {});
                      toast({ title: "Auto-sync triggered" });
                      qc.invalidateQueries({ queryKey: ["banking", "transactions"] });
                      qc.invalidateQueries({ queryKey: ["banking", "reconciliation-logs"] });
                    } catch (e: any) {
                      toast({ title: "Trigger failed", description: e?.message || "Error", variant: "destructive" });
                    } finally {
                      setBatchLoading(false);
                    }
                  }} disabled={batchLoading}>
                    {batchLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Trigger Now
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Reconciliation Logs */}
            <Card>
              <CardHeader><CardTitle>Reconciliation Logs</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Strategy</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Auto-Closed</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(reconciliationLogsQuery.data ?? []).map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(l.createdAt).toLocaleString("en-IN")}</TableCell>
                        <TableCell><Badge variant="outline">{l.matchStrategy}</Badge></TableCell>
                        <TableCell>
                          <span className={cn(
                            "font-mono text-sm font-bold",
                            l.confidenceScore >= 80 ? "text-green-700" : l.confidenceScore >= 50 ? "text-yellow-700" : "text-red-700",
                          )}>
                            {l.confidenceScore}%
                          </span>
                        </TableCell>
                        <TableCell>
                          {l.autoClosed ? <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" /> Yes</Badge>
                            : <Badge variant="secondary">No</Badge>}
                        </TableCell>
                        <TableCell className="text-xs">{l.performedBy}</TableCell>
                      </TableRow>
                    ))}
                    {(reconciliationLogsQuery.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No reconciliation logs yet. Run batch reconcile to generate entries.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Fraud Detection ────────────────────────────────────────────────── */}
        <TabsContent value="fraud">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button onClick={runFraudCheck}><ShieldAlert className="w-4 h-4 mr-2" /> Run Fraud Check</Button>
              <div className="flex gap-2">
                <Select value={fraudFilter.status || "all"} onValueChange={(v) => setFraudFilter(f => ({ ...f, status: v === "all" ? undefined : v }))}>
                  <SelectTrigger className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="investigating">Investigating</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="false_positive">False Positive</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={fraudFilter.severity || "all"} onValueChange={(v) => setFraudFilter(f => ({ ...f, severity: v === "all" ? undefined : v }))}>
                  <SelectTrigger className="w-32"><SelectValue placeholder="Severity" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Bill/Payment</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(fraudAlertsQuery.data ?? []).map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(a.createdAt).toLocaleString("en-IN")}</TableCell>
                        <TableCell><Badge variant="outline" className="uppercase">{a.alertType.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell><Badge className={severityColor(a.severity)}>{a.severity}</Badge></TableCell>
                        <TableCell><Badge className={fraudStatusColor(a.status)}>{a.status}</Badge></TableCell>
                        <TableCell className="max-w-xs truncate">{a.description}</TableCell>
                        <TableCell className="text-xs">
                          {a.billId && <span className="block">Bill #{a.billId}</span>}
                          {a.paymentId && <span className="block">Pay #{a.paymentId}</span>}
                          {!a.billId && !a.paymentId && "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {a.status === "open" && (
                            <Button size="sm" variant="outline" onClick={() => setResolveAlertId(a.id)}>
                              <FileCheck className="w-3 h-3 mr-1" /> Resolve
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(fraudAlertsQuery.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No fraud alerts. Run a fraud check to scan for anomalies.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Refunds ────────────────────────────────────────────────────────── */}
        <TabsContent value="refunds">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setRefundDialogOpen(true)}><Plus className="w-4 h-4 mr-2" /> Request Refund</Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Bill</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Requested By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(refundsQuery.data ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(r.requestedAt).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="font-mono">#{r.billId}</TableCell>
                        <TableCell className="font-mono">₹{parseFloat(r.amount).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="max-w-xs truncate">{r.reason}</TableCell>
                        <TableCell><Badge className={refundStatusColor(r.status)}>{r.status}</Badge></TableCell>
                        <TableCell className="text-xs">{r.requestedBy}</TableCell>
                        <TableCell className="text-right space-x-1">
                          {r.status === "requested" && (
                            <>
                              <Button size="sm" variant="outline" className="text-green-700" onClick={() => approveRefund.mutate(r.id)}>
                                <CheckCircle className="w-3 h-3 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" className="text-red-700" onClick={() => {
                                const reason = window.prompt("Rejection reason:");
                                if (reason) rejectRefund.mutate({ id: r.id, reason });
                              }}>
                                <Ban className="w-3 h-3 mr-1" /> Reject
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(refundsQuery.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No refund requests. Create one to get started.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Gateways ───────────────────────────────────────────────────────── */}
        <TabsContent value="gateways">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Select value={gatewaySettlementFilter} onValueChange={(v) => setGatewaySettlementFilter(v)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="settled">Settled</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              {(() => {
                const data = gatewayQuery.data ?? [];
                const pending = data.filter(g => g.settlementStatus === "pending").length;
                const settled = data.filter(g => g.settlementStatus === "settled").length;
                const pendingAmt = data.filter(g => g.settlementStatus === "pending").reduce((s, g) => s + parseFloat(g.amount), 0);
                return (
                  <div className="flex gap-2 text-sm">
                    <div className="bg-yellow-50 rounded-lg px-3 py-1 border border-yellow-200"><span className="text-xs text-yellow-700">Pending</span> <b className="text-yellow-800">{pending}</b> <span className="text-xs text-yellow-600">(₹{pendingAmt.toLocaleString("en-IN")})</span></div>
                    <div className="bg-green-50 rounded-lg px-3 py-1 border border-green-200"><span className="text-xs text-green-700">Settled</span> <b className="text-green-800">{settled}</b></div>
                  </div>
                );
              })()}
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Fee</TableHead>
                      <TableHead>Net</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Settlement</TableHead>
                      <TableHead>UTR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(gatewayQuery.data ?? []).filter(g => gatewaySettlementFilter === "all" || g.settlementStatus === gatewaySettlementFilter).map((g) => (
                      <TableRow key={g.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(g.createdAt).toLocaleString("en-IN")}</TableCell>
                        <TableCell><Badge variant="outline" className="uppercase">{g.provider}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{g.gatewayOrderId}</TableCell>
                        <TableCell className="font-mono">{parseFloat(g.amount).toLocaleString("en-IN")} {g.currency}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{g.gatewayFee != null ? `₹${parseFloat(g.gatewayFee).toLocaleString("en-IN")}` : "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{g.netSettled != null ? `₹${parseFloat(g.netSettled).toLocaleString("en-IN")}` : "—"}</TableCell>
                        <TableCell><Badge className={gatewayStatusColor(g.status)}>{g.status}</Badge></TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Badge variant={g.settlementStatus === "settled" ? "default" : g.settlementStatus === "pending" ? "secondary" : "outline"}>
                              {g.settlementStatus}
                            </Badge>
                            {g.settlementDate && <span className="text-[10px] text-muted-foreground">{new Date(g.settlementDate).toLocaleDateString("en-IN")}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{g.utr || g.settlementUtr || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {(gatewayQuery.data ?? []).filter(g => gatewaySettlementFilter === "all" || g.settlementStatus === gatewaySettlementFilter).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                          {gatewaySettlementFilter === "all" ? "No gateway transactions yet." : `No ${gatewaySettlementFilter} settlements.`}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
{/* ── Shifts ─────────────────────────────────────────────────────────── */}
        <TabsContent value="shifts">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setShiftDialogOpen(true)}><Banknote className="w-4 h-4 mr-2" /> Close Shift</Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead>Opened</TableHead>
                      <TableHead>Closed</TableHead>
                      <TableHead>Physical Total</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead>Difference</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Supervisor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(shiftsQuery.data ?? []).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.userName}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(s.startedAt).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{s.endedAt ? new Date(s.endedAt).toLocaleString("en-IN") : "—"}</TableCell>
                        <TableCell className="font-mono">₹{parseFloat(s.actualTotal).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="font-mono">₹{parseFloat(s.expectedTotal).toLocaleString("en-IN")}</TableCell>
                        <TableCell className={cn("font-mono", parseFloat(s.variance) !== 0 ? "text-red-700 font-bold" : "text-green-700")}>
                          ₹{parseFloat(s.variance).toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell><Badge variant={s.status === "closed" ? "default" : s.status === "adjusted" ? "secondary" : "outline"}>{s.status}</Badge></TableCell>
                        <TableCell className="text-xs">{s.supervisorName || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {(shiftsQuery.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No shift closures recorded. Record one to track cash handovers.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Webhooks ───────────────────────────────────────────────────────── */}
        <TabsContent value="webhooks">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Signature</TableHead>
                    <TableHead>Processed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(webhooksQuery.data ?? []).map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(w.createdAt).toLocaleString("en-IN")}</TableCell>
                      <TableCell><Badge variant="outline">{w.provider}</Badge></TableCell>
                      <TableCell className="text-xs">{w.eventType || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={w.signatureValid === true ? "default" : w.signatureValid === false ? "destructive" : "outline"}>
                          {w.signatureValid === true ? <CheckCircle className="w-3 h-3 mr-1" /> : w.signatureValid === false ? <AlertCircle className="w-3 h-3 mr-1" /> : null}
                          {w.signatureValid === true ? "Valid" : w.signatureValid === false ? "Invalid" : "Unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={w.processed ? "default" : "secondary"}>{w.processed ? "Yes" : "No"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(webhooksQuery.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No webhook logs yet. Webhooks appear when bank providers send notifications.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Day Close */}
        <TabsContent value="day-close">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <Input type="date" value={dcDate} onChange={(e) => setDcDate(e.target.value)} className="w-40" />
              </div>
              <div className="flex bg-muted rounded-lg p-1">
                <Button size="sm" variant={dcView === "my" ? "default" : "ghost"} onClick={() => setDcView("my")}>My Close</Button>
                <Button size="sm" variant={dcView === "owner" ? "default" : "ghost"} onClick={() => setDcView("owner")}>Owner View</Button>
              </div>
            </div>
            {dcView === "my" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> My Day -- Close Preview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {dcMyPreviewQ.isLoading && <p className="text-sm text-muted-foreground">Loading preview...</p>}
                    {dcMyPreviewQ.isError && <p className="text-sm text-red-600">Could not load preview.</p>}
                    {dcMyPreviewQ.data && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Cash</div><div className="font-semibold">₹{dcMyPreviewQ.data.expected.cash.toLocaleString("en-IN")}</div></div>
                          <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">UPI</div><div className="font-semibold">₹{dcMyPreviewQ.data.expected.upi.toLocaleString("en-IN")}</div></div>
                          <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Card</div><div className="font-semibold">₹{dcMyPreviewQ.data.expected.card.toLocaleString("en-IN")}</div></div>
                          <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Total</div><div className="font-bold text-lg">₹{dcMyPreviewQ.data.expected.total.toLocaleString("en-IN")}</div></div>
                        </div>
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span>Bills: {dcMyPreviewQ.data.billsCount}</span>
                          <span>Payments: {dcMyPreviewQ.data.paymentsCount}</span>
                          <span>Total Billed: ₹{dcMyPreviewQ.data.totalBilled.toLocaleString("en-IN")}</span>
                          <span>Total Due: ₹{dcMyPreviewQ.data.totalDue.toLocaleString("en-IN")}</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">My Closure History</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Date</TableHead><TableHead>Expected</TableHead><TableHead>Actual</TableHead><TableHead>Variance</TableHead><TableHead>Drawer</TableHead><TableHead>Bills</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {(dcMyListQ.data ?? []).map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>{new Date(c.closureDate).toLocaleDateString("en-IN")}</TableCell>
                            <TableCell>₹{parseFloat(c.totalExpected).toLocaleString("en-IN")}</TableCell>
                            <TableCell>₹{parseFloat(c.totalActual).toLocaleString("en-IN")}</TableCell>
                            <TableCell><Badge variant={parseFloat(c.variance) === 0 ? "default" : parseFloat(c.variance) < 0 ? "destructive" : "secondary"}>₹{parseFloat(c.variance).toLocaleString("en-IN")}</Badge></TableCell>
                            <TableCell><Badge variant="outline">{c.drawerStatus}</Badge></TableCell>
                            <TableCell>{c.billsCount}</TableCell>
                          </TableRow>
                        ))}
                        {(dcMyListQ.data ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No closures recorded yet.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
            {dcView === "owner" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" /> Owner Day-Close Preview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {dcOwnerPreviewQ.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
                    {dcOwnerPreviewQ.isError && <p className="text-sm text-red-600">Could not load preview.</p>}
                    {dcOwnerPreviewQ.data && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Cash</div><div className="font-semibold">₹{dcOwnerPreviewQ.data.expected.cash.toLocaleString("en-IN")}</div></div>
                          <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">UPI</div><div className="font-semibold">₹{dcOwnerPreviewQ.data.expected.upi.toLocaleString("en-IN")}</div></div>
                          <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Card</div><div className="font-semibold">₹{dcOwnerPreviewQ.data.expected.card.toLocaleString("en-IN")}</div></div>
                          <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Total</div><div className="font-bold text-lg">₹{dcOwnerPreviewQ.data.expected.total.toLocaleString("en-IN")}</div></div>
                        </div>
                        <div className="text-xs text-muted-foreground">Bills: {dcOwnerPreviewQ.data.billsCount} · Payments: {dcOwnerPreviewQ.data.paymentsCount}</div>
                        {dcOwnerPreviewQ.data.byStaff.length > 0 && (
                          <Table>
                            <TableHeader><TableRow><TableHead>Staff</TableHead><TableHead>Count</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
                            <TableBody>
                              {dcOwnerPreviewQ.data.byStaff.map((s) => (
                                <TableRow key={s.userId ?? s.userName}><TableCell>{s.userName}</TableCell><TableCell>{s.count}</TableCell><TableCell>₹{s.total.toLocaleString("en-IN")}</TableCell></TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Past Closures</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Date</TableHead><TableHead>Closed By</TableHead><TableHead>Expected</TableHead><TableHead>Actual</TableHead><TableHead>Variance</TableHead><TableHead>Status</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {(dcOwnerListQ.data ?? []).map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>{new Date(c.closureDate).toLocaleDateString("en-IN")}</TableCell>
                            <TableCell>{c.closedByName}</TableCell>
                            <TableCell>₹{parseFloat(c.totalExpected).toLocaleString("en-IN")}</TableCell>
                            <TableCell>₹{parseFloat(c.totalActual).toLocaleString("en-IN")}</TableCell>
                            <TableCell><Badge variant={parseFloat(c.variance) === 0 ? "default" : parseFloat(c.variance) < 0 ? "destructive" : "secondary"}>₹{parseFloat(c.variance).toLocaleString("en-IN")}</Badge></TableCell>
                            <TableCell><Badge variant={c.status === "closed" ? "default" : "secondary"}>{c.status}</Badge></TableCell>
                          </TableRow>
                        ))}
                        {(dcOwnerListQ.data ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No closures recorded yet.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" /> Bank Summary for {dcDate}</CardTitle>
              </CardHeader>
              <CardContent>
                {dcBankQ.isLoading && <p className="text-sm text-muted-foreground">Loading bank data...</p>}
                {dcBankQ.isError && <p className="text-sm text-red-600">Could not load bank summary.</p>}
                {dcBankQ.data && (
                  <div className="space-y-3">
                    {dcBankQ.data.summary.length === 0 && <p className="text-sm text-muted-foreground">No active bank accounts configured.</p>}
                    {dcBankQ.data.summary.map((s) => (
                      <div key={s.accountId} className="flex items-center justify-between text-sm border-b last:border-b-0 py-2">
                        <div>
                          <div className="font-medium">{s.bankName} {s.nickname ? `(${s.nickname})` : ""}</div>
                          <div className="text-xs text-muted-foreground">{s.provider.toUpperCase()} · {s.transactionCount} txns</div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono">Bal: {s.balance != null ? `₹${s.balance.toLocaleString("en-IN")}` : "N/A"}</div>
                          <div className="text-xs text-green-600">Cr: ₹{s.credits.toLocaleString("en-IN")}</div>
                          <div className="text-xs text-red-600">Dr: ₹{s.debits.toLocaleString("en-IN")}</div>
                          <div className="text-xs font-medium">Net: ₹{s.net.toLocaleString("en-IN")}</div>
                          {s.error && <div className="text-xs text-red-500">{s.error}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ════════════════════════════════════════════════════════════════════════
          DIALOGS
         ════════════════════════════════════════════════════════════════════════ */}

      {/* Add Account Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Bank Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Provider</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Bank Name</Label>
              <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="e.g. HDFC Bank" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Account Number</Label>
                <Input value={form.maskedAccountNumber} onChange={(e) => setForm({ ...form, maskedAccountNumber: e.target.value })} placeholder="XXX1234" />
              </div>
              <div>
                <Label>Nickname (optional)</Label>
                <Input value={form.accountNickname} onChange={(e) => setForm({ ...form, accountNickname: e.target.value })} placeholder="e.g. Main Current" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>IFSC (optional)</Label>
                <Input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value })} />
              </div>
              <div>
                <Label>Branch (optional)</Label>
                <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Environment</Label>
                <Select value={form.environment} onValueChange={(v: any) => setForm({ ...form, environment: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENV_OPTIONS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v: any) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Credential Key (env prefix)</Label>
              <Input value={form.credentialKey} onChange={(e) => setForm({ ...form, credentialKey: e.target.value })} placeholder="e.g. HDFC, ICICI" />
              <p className="text-xs text-muted-foreground mt-1">
                The provider reads credentials from env vars like <code>{form.credentialKey || "PROVIDER"}_API_KEY</code>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => createAccount.mutate(form)} disabled={!form.bankName || !form.maskedAccountNumber}>
              Save Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Transactions Dialog */}
      <Dialog open={viewTxOpen} onOpenChange={setViewTxOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Transactions</DialogTitle>
          </DialogHeader>
          {transactions.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No transactions found for this account.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>UTR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{new Date(t.transactionDate).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell className="max-w-xs truncate">{t.description || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={t.type === "credit" ? "default" : "secondary"}>
                        {t.type === "credit" ? <ArrowDownLeft className="w-3 h-3 mr-1" /> : <ArrowUpRight className="w-3 h-3 mr-1" />}
                        {t.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">{parseFloat(t.amount).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="font-mono text-xs">{t.utr || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      {/* Resolve Fraud Alert Dialog */}
      <Dialog open={resolveAlertId !== null} onOpenChange={(open) => !open && setResolveAlertId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve Fraud Alert #{resolveAlertId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Resolution Action</Label>
              <Select value={resolveAction} onValueChange={setResolveAction}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="adjusted">Adjusted</SelectItem>
                  <SelectItem value="escalated">Escalated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Resolution Note</Label>
              <Input value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="Explain the resolution..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveAlertId(null)}>Cancel</Button>
            <Button onClick={() => {
              if (resolveAlertId) resolveAlert.mutate({ id: resolveAlertId, status: "resolved", resolutionNote: resolveNote, resolutionAction: resolveAction });
            }}>
              <FileCheck className="w-4 h-4 mr-2" /> Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Refund Dialog */}
      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Refund</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Bill ID</Label>
                <Input type="number" value={refundForm.billId} onChange={(e) => setRefundForm(f => ({ ...f, billId: e.target.value }))} placeholder="123" />
              </div>
              <div>
                <Label>Payment ID</Label>
                <Input type="number" value={refundForm.paymentId} onChange={(e) => setRefundForm(f => ({ ...f, paymentId: e.target.value }))} placeholder="456" />
              </div>
            </div>
            <div>
              <Label>Amount (₹)</Label>
              <Input type="number" value={refundForm.amount} onChange={(e) => setRefundForm(f => ({ ...f, amount: e.target.value }))} placeholder="500.00" />
            </div>
            <div>
              <Label>Reason</Label>
              <Input value={refundForm.reason} onChange={(e) => setRefundForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Duplicate payment" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              createRefund.mutate({
                billId: Number(refundForm.billId),
                paymentId: Number(refundForm.paymentId),
                amount: parseFloat(refundForm.amount),
                reason: refundForm.reason,
              });
            }} disabled={!refundForm.billId || !refundForm.paymentId || !refundForm.amount || !refundForm.reason}>
              <Send className="w-4 h-4 mr-2" /> Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Shift Dialog */}
      <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Close Shift — Cash Denomination</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <DenominationInput label="₹500" value={shiftForm.d500} onChange={(v) => setShiftForm(f => ({ ...f, d500: v }))} />
              <DenominationInput label="₹200" value={shiftForm.d200} onChange={(v) => setShiftForm(f => ({ ...f, d200: v }))} />
              <DenominationInput label="₹100" value={shiftForm.d100} onChange={(v) => setShiftForm(f => ({ ...f, d100: v }))} />
              <DenominationInput label="₹50" value={shiftForm.d50} onChange={(v) => setShiftForm(f => ({ ...f, d50: v }))} />
              <DenominationInput label="₹20" value={shiftForm.d20} onChange={(v) => setShiftForm(f => ({ ...f, d20: v }))} />
              <DenominationInput label="₹10" value={shiftForm.d10} onChange={(v) => setShiftForm(f => ({ ...f, d10: v }))} />
              <DenominationInput label="Coins" value={shiftForm.coins} onChange={(v) => setShiftForm(f => ({ ...f, coins: v }))} />
            </div>
            <div className="bg-muted rounded-lg p-4 flex items-center justify-between">
              <span className="font-medium">Total Physical Cash</span>
              <span className="text-xl font-bold font-mono">₹{shiftTotal.toLocaleString("en-IN")}</span>
            </div>
            <div>
              <Label>Supervisor Name (optional)</Label>
              <Input value={shiftForm.supervisorName} onChange={(e) => setShiftForm(f => ({ ...f, supervisorName: e.target.value }))} placeholder="Verifier name" />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={shiftForm.notes} onChange={(e) => setShiftForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any remarks..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => createShift.mutate({
              shiftLabel: shiftForm.shiftLabel,
              denominations: { d500: shiftForm.d500, d200: shiftForm.d200, d100: shiftForm.d100, d50: shiftForm.d50, d20: shiftForm.d20, d10: shiftForm.d10, coins: shiftForm.coins },
              supervisorName: shiftForm.supervisorName || null,
              notes: shiftForm.notes || null,
            })}>
              <CheckCircle className="w-4 h-4 mr-2" /> Record Closure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Initiate Payout Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Initiate Payout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Bank Account</Label>
              <Select value={paymentForm.bankAccountId} onValueChange={(v) => setPaymentForm(f => ({ ...f, bankAccountId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {(accountsQuery.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.bankName} {a.accountNickname ? `(${a.accountNickname})` : ""} [{a.provider}]</SelectItem>
                  ))}
                  {(accountsQuery.data ?? []).length === 0 && (
                    <SelectItem value="" disabled>No active accounts</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount (₹)</Label>
                <Input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm(f => ({ ...f, amount: e.target.value }))} placeholder="5000" />
              </div>
              <div>
                <Label>Currency</Label>
                <Input value={paymentForm.currency} onChange={(e) => setPaymentForm(f => ({ ...f, currency: e.target.value }))} placeholder="INR" />
              </div>
            </div>
            <div>
              <Label>Purpose</Label>
              <Input value={paymentForm.purpose} onChange={(e) => setPaymentForm(f => ({ ...f, purpose: e.target.value }))} placeholder="Vendor payment / Salary / Refund" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Beneficiary Name</Label>
                <Input value={paymentForm.beneficiaryName} onChange={(e) => setPaymentForm(f => ({ ...f, beneficiaryName: e.target.value }))} placeholder="Receiver name" />
              </div>
              <div>
                <Label>Beneficiary Account</Label>
                <Input value={paymentForm.beneficiaryAccount} onChange={(e) => setPaymentForm(f => ({ ...f, beneficiaryAccount: e.target.value }))} placeholder="Account number" />
              </div>
            </div>
            <div>
              <Label>Beneficiary IFSC</Label>
              <Input value={paymentForm.beneficiaryIfsc} onChange={(e) => setPaymentForm(f => ({ ...f, beneficiaryIfsc: e.target.value }))} placeholder="HDFC0001234" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Link Bill ID (optional)</Label>
                <Input type="number" value={paymentForm.billId} onChange={(e) => setPaymentForm(f => ({ ...f, billId: e.target.value }))} placeholder="123" />
              </div>
              <div>
                <Label>Link Voucher ID (optional)</Label>
                <Input type="number" value={paymentForm.voucherId} onChange={(e) => setPaymentForm(f => ({ ...f, voucherId: e.target.value }))} placeholder="456" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              const body: Record<string, unknown> = {
                bankAccountId: Number(paymentForm.bankAccountId),
                amount: parseFloat(paymentForm.amount),
                currency: paymentForm.currency || "INR",
                purpose: paymentForm.purpose || undefined,
                beneficiaryName: paymentForm.beneficiaryName || undefined,
                beneficiaryAccount: paymentForm.beneficiaryAccount || undefined,
                beneficiaryIfsc: paymentForm.beneficiaryIfsc || undefined,
              };
              if (paymentForm.billId.trim()) body.billId = Number(paymentForm.billId.trim());
              if (paymentForm.voucherId.trim()) body.voucherId = Number(paymentForm.voucherId.trim());
              createPayment.mutate(body);
            }} disabled={!paymentForm.bankAccountId || !paymentForm.amount || createPayment.isPending}>
              <Send className="w-4 h-4 mr-2" /> {createPayment.isPending ? "Sending..." : "Send Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Small sub-component for denomination input ───────────────────────────────

function DenominationInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <Label className="w-14 shrink-0">{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="text-right"
      />
    </div>
  );
}
