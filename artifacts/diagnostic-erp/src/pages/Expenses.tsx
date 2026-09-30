import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListExpenses,
  useGetExpensesSummary,
  getListExpensesQueryKey,
  getGetExpensesSummaryQueryKey,
  type ExpenseSummaryRow,
  type ListExpensesParams,
} from "@workspace/api-client-react";
import PageHeader from "@/components/PageHeader";
import DocumentScanCapture from "@/components/DocumentScanCapture";
import BillReceiptScannerPanel from "@/components/BillReceiptScannerPanel";
import ExpenseDetailDrawer from "@/components/expenses/ExpenseDetailDrawer";
import ExpenseAttachmentsPanel, { type PendingExpenseAttachment } from "@/components/expenses/ExpenseAttachmentsPanel";
import PayeeCombobox, { type PayeeUsualDto } from "@/components/expenses/PayeeCombobox";
import { useClinicDateIst } from "@/hooks/useCareTime";
import { AccountingStatusBadge, OcrFieldBadge, PaymentStatusBadge } from "@/components/expenses/ExpenseStatusBadges";
import {
  billOf,
  dueOf,
  isCashMode,
  paidOf,
  vendorLabel,
  type AccountOption,
  type BillOcrFieldMeta,
  type DepartmentOption,
  type DuplicateWarnings,
  type EntryPayKind,
  type ExpenseCategoryRow,
  type ExpenseV2,
  type VendorOption,
} from "@/components/expenses/expenseTypes";
import { readStaffSession } from "@/lib/staffSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Wallet,
  Plus,
  Search,
  TrendingDown,
  IndianRupee,
  PieChart,
  X,
  ScanLine,
  FileImage,
  Loader2,
  Eye,
  Ban,
  ClipboardList,
  AlertTriangle,
  Paperclip,
} from "lucide-react";
import { api } from "@/lib/fetchApi";
import { mapExpenseCategory, mapExpensePaymentModeOptional } from "@/lib/expenseScanMapping";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const FALLBACK_CATEGORIES = [
  "rent",
  "salaries",
  "utilities",
  "supplies",
  "maintenance",
  "equipment",
  "marketing",
  "travel",
  "miscellaneous",
];

const WORK_TYPES = [
  "Electrical",
  "Plumbing",
  "Civil / Masonry",
  "Tiles",
  "Carpentry",
  "Painting",
  "AC / Refrigeration",
  "Equipment Repair",
  "General Maintenance",
  "Other",
] as const;

const PAYMENT_MODES = ["cash", "bank-transfer", "cheque", "upi", "card"];

function isOpsMaintenanceCategory(category: string, categoryLabel?: string): boolean {
  const c = `${category} ${categoryLabel || ""}`.toLowerCase();
  return (
    c.includes("maintenance") ||
    c.includes("operations") ||
    c.includes("repair")
  );
}

type ScanBillResult = {
  vendor: string;
  date: string;
  amount: number;
  gstAmount: number;
  category: string;
  description: string;
  paymentMode: string;
  confidence: string;
  confidencePercent?: number;
  isBlurred?: boolean;
  invoiceNumber?: string;
  fields?: Partial<Record<string, BillOcrFieldMeta>>;
  ocrProvider?: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  rent: "bg-blue-100 text-blue-700",
  salaries: "bg-indigo-100 text-indigo-700",
  utilities: "bg-yellow-100 text-yellow-700",
  supplies: "bg-green-100 text-green-700",
  maintenance: "bg-orange-100 text-orange-700",
  equipment: "bg-cyan-100 text-cyan-700",
  marketing: "bg-rose-100 text-rose-700",
  travel: "bg-teal-100 text-teal-700",
  miscellaneous: "bg-gray-100 text-gray-700",
};

type LabourBasis = "" | "per_day" | "per_job" | "contract";

type ExpenseForm = {
  payKind: EntryPayKind;
  category: string;
  categoryId: string;
  subcategoryId: string;
  description: string;
  billAmount: string;
  taxAmount: string;
  amountPaid: string;
  expenseDate: string;
  paymentDate: string;
  paymentMode: string;
  vendorId: string;
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  departmentId: string;
  paidFromAccountId: string;
  referenceNumber: string;
  approvedBy: string;
  notes: string;
  workType: string;
  labourBasis: LabourBasis;
  days: string;
  ratePerDay: string;
  labourAmount: string;
  materialAmount: string;
};

function emptyExpenseForm(clinicDateIst: string | null): ExpenseForm {
  const name = readStaffSession()?.user?.name?.trim() || "";
  // CARE business date from the server (Stage 1A), NOT the workstation clock.
  // `new Date().toISOString().slice(0, 10)` used to sit here: it read the
  // browser's clock through a UTC lens, so any expense opened between 00:00 and
  // 05:29:59 IST defaulted to *yesterday*. `null` means the authority has not
  // answered yet — leave the field blank rather than invent a clinic day.
  // This is a default, not a limit: the operator can still enter any date
  // (Stage 2/3 govern whether that requires a reason — D-2 is not decided).
  const today = clinicDateIst ?? "";
  return {
    payKind: "PAID",
    category: "miscellaneous",
    categoryId: "",
    subcategoryId: "",
    description: "",
    billAmount: "",
    taxAmount: "",
    amountPaid: "",
    expenseDate: today,
    paymentDate: today,
    paymentMode: "cash",
    vendorId: "",
    vendorName: "",
    invoiceNumber: "",
    invoiceDate: "",
    departmentId: "",
    paidFromAccountId: "",
    referenceNumber: "",
    approvedBy: name,
    notes: "",
    workType: "",
    labourBasis: "",
    days: "",
    ratePerDay: "",
    labourAmount: "",
    materialAmount: "",
  };
}

function buildExpenseMetaJson(form: ExpenseForm): string | null {
  const meta: Record<string, unknown> = {};
  if (form.workType.trim()) meta.workType = form.workType.trim();
  if (form.labourBasis) meta.labourBasis = form.labourBasis;
  if (form.days.trim()) {
    const days = Number(form.days);
    if (Number.isFinite(days)) meta.days = days;
  }
  if (form.ratePerDay.trim()) {
    const rate = Number(form.ratePerDay);
    if (Number.isFinite(rate)) meta.ratePerDay = rate;
  }
  if (form.labourAmount.trim()) {
    const labour = Number(form.labourAmount);
    if (Number.isFinite(labour)) meta.labourAmount = labour;
  }
  if (form.materialAmount.trim()) {
    const material = Number(form.materialAmount);
    if (Number.isFinite(material)) meta.materialAmount = material;
  }
  return Object.keys(meta).length ? JSON.stringify(meta) : null;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatDuplicateToast(dupes: DuplicateWarnings): string {
  const parts = [...(dupes.strong || []), ...(dupes.soft || [])]
    .slice(0, 4)
    .map((d) => [d.expenseId, d.reason].filter(Boolean).join(" — "))
    .filter(Boolean);
  return parts.length ? parts.join("; ") : "Possible duplicate expense detected.";
}

type TabKey = "list" | "payables" | "summary" | "scanner";

export default function Expenses() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [accountingStatusFilter, setAccountingStatusFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [invoiceFilter, setInvoiceFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const clinicDateIst = useClinicDateIst();
  const [form, setForm] = useState(() => emptyExpenseForm(clinicDateIst));
  useEffect(() => {
    if (typeof window === "undefined") return;
    // A dialog opened in the first moments after login, before /api/time/now
    // answered, gets the CARE business date as soon as it arrives — and only if
    // both date fields are still empty, so a typed or scanned date is never
    // overwritten.
    if (!showForm || !clinicDateIst) return;
    setForm((f) => (f.expenseDate || f.paymentDate ? f : { ...f, expenseDate: clinicDateIst, paymentDate: clinicDateIst }));
  }, [clinicDateIst, showForm]);

  const [receiptImage, setReceiptImage] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<PendingExpenseAttachment | null>(null);
  const [ocrMeta, setOcrMeta] = useState<{
    confidence?: string;
    confidencePercent?: number;
    isBlurred?: boolean;
    fields?: Partial<Record<string, BillOcrFieldMeta>>;
    ocrProvider?: string;
  } | null>(null);
  const [ocrConfirmed, setOcrConfirmed] = useState(false);
  const [fieldMeta, setFieldMeta] = useState<Partial<Record<string, BillOcrFieldMeta>>>({});
  const [savingCreate, setSavingCreate] = useState(false);
  const [viewReceipt, setViewReceipt] = useState<{ loading: boolean; url: string | null; expenseId: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("list");
  const [detailExp, setDetailExp] = useState<ExpenseV2 | null>(null);
  const [payQuickExp, setPayQuickExp] = useState<ExpenseV2 | null>(null);
  const [quickVendorOpen, setQuickVendorOpen] = useState(false);
  const [quickVendorName, setQuickVendorName] = useState("");
  const [quickVendorSaving, setQuickVendorSaving] = useState(false);
  const [payeeSuggestionsApplied, setPayeeSuggestionsApplied] = useState(false);
  const usualApplySeq = useRef(0);
  const labourSuggestedBill = (() => {
    const labour = Number(form.labourAmount) || 0;
    const material = Number(form.materialAmount) || 0;
    const suggested = round2(labour + material);
    return suggested > 0 ? suggested : null;
  })();

  const listParams: ListExpensesParams & { paymentStatus?: string } = {
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    paymentMode: paymentFilter !== "all" ? paymentFilter : undefined,
    from: from || undefined,
    to: to || undefined,
    search: search || undefined,
    paymentStatus: paymentStatusFilter !== "all" ? paymentStatusFilter : undefined,
  };

  const summaryParams = {
    from: from || undefined,
    to: to || undefined,
  };

  const { data: expensesRaw = [], isLoading } = useListExpenses(listParams as ListExpensesParams);
  const expenses = useMemo(() => {
    let rows = expensesRaw as unknown as ExpenseV2[];
    if (vendorFilter !== "all") {
      const vid = Number(vendorFilter);
      rows = rows.filter((e) => e.vendorId === vid);
    }
    if (invoiceFilter.trim()) {
      const q = invoiceFilter.trim().toLowerCase();
      rows = rows.filter((e) => (e.invoiceNumber || "").toLowerCase().includes(q));
    }
    if (accountingStatusFilter !== "all") {
      rows = rows.filter((e) => (e.accountingStatus || "PENDING") === accountingStatusFilter);
    }
    return rows;
  }, [expensesRaw, vendorFilter, invoiceFilter, accountingStatusFilter]);

  const { data: summary = [] } = useGetExpensesSummary(summaryParams);

  const { data: categoryRows = [] } = useQuery<ExpenseCategoryRow[]>({
    queryKey: ["expense-categories"],
    queryFn: () => api.get("/api/expenses/categories"),
    staleTime: 60_000,
  });

  const { data: vendors = [], refetch: refetchVendors } = useQuery<VendorOption[]>({
    queryKey: ["vendors-for-expenses"],
    queryFn: () => api.get("/api/vendors"),
    staleTime: 60_000,
  });

  const { data: accounts = [] } = useQuery<AccountOption[]>({
    queryKey: ["accounting-accounts-for-expenses"],
    queryFn: () => api.get("/api/accounting/accounts"),
    staleTime: 60_000,
  });

  const { data: departmentsResult } = useQuery<{ rows: DepartmentOption[]; forbidden: boolean }>({
    queryKey: ["departments-for-expenses"],
    queryFn: async () => {
      try {
        const rows = await api.get<DepartmentOption[]>("/api/departments");
        return { rows: Array.isArray(rows) ? rows : [], forbidden: false };
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 403) return { rows: [], forbidden: true };
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const departments = departmentsResult?.rows ?? [];
  const departmentsHidden = departmentsResult?.forbidden ?? false;

  type PayablesResponse = {
    items: ExpenseV2[];
    summary: {
      bills: number;
      booked: number;
      paid: number;
      outstanding: number;
      cashPaid: number;
      digitalPaid: number;
    };
  };
  const { data: payablesResp, isLoading: payablesLoading, refetch: refetchPayables } = useQuery<PayablesResponse>({
    queryKey: ["expense-payables", from, to],
    queryFn: () => {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const qs = q.toString();
      return api.get(`/api/expenses/payables${qs ? `?${qs}` : ""}`);
    },
    enabled: activeTab === "payables",
  });
  const payables = payablesResp?.items ?? [];

  const topCategories = useMemo(() => {
    const tops = categoryRows.filter((c) => !c.parentId);
    return tops.length ? tops : [];
  }, [categoryRows]);

  const subcategories = useMemo(() => {
    if (!form.categoryId) return [];
    return categoryRows.filter((c) => c.parentId === Number(form.categoryId));
  }, [categoryRows, form.categoryId]);

  const categoryOptions = useMemo(() => {
    if (topCategories.length) {
      return topCategories.map((c) => ({
        value: c.legacyKey || c.name.toLowerCase(),
        label: c.name,
        id: String(c.id),
      }));
    }
    return FALLBACK_CATEGORIES.map((c) => ({ value: c, label: c, id: "" }));
  }, [topCategories]);

  const paidFromAccounts = accounts.filter((a) => a.isActive !== false && (a.type === "cash" || a.type === "bank"));

  const billNum = Number(form.billAmount) || 0;
  const paidNum = form.payKind === "DUE" ? 0 : form.payKind === "PAID" ? billNum : Number(form.amountPaid) || 0;
  const balancePreview = Math.max(0, round2(billNum - paidNum));

  function invalidateExpenses() {
    qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetExpensesSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: ["expense-payables"] });
  }

  async function openReceipt(exp: ExpenseV2) {
    setViewReceipt({ loading: true, url: null, expenseId: exp.expenseId });
    try {
      const full = await api.get<{ receiptImageUrl?: string | null }>(`/api/expenses/${exp.id}`);
      setViewReceipt({ loading: false, url: full.receiptImageUrl ?? null, expenseId: exp.expenseId });
    } catch {
      setViewReceipt({ loading: false, url: null, expenseId: exp.expenseId });
    }
  }

  function applyPayKind(kind: EntryPayKind) {
    setForm((f) => {
      const bill = f.billAmount;
      if (kind === "PAID") return { ...f, payKind: kind, amountPaid: bill };
      if (kind === "DUE") return { ...f, payKind: kind, amountPaid: "0" };
      return { ...f, payKind: kind, amountPaid: f.amountPaid === bill || f.amountPaid === "0" ? "" : f.amountPaid };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (savingCreate) return;
    const billAmount = Number(form.billAmount);
    if (!Number.isFinite(billAmount) || billAmount <= 0) {
      toast({ title: "Enter a valid bill amount", description: "Bill must be greater than ₹0.", variant: "destructive" });
      return;
    }

    let initialPaymentAmount = 0;
    if (form.payKind === "PAID") {
      initialPaymentAmount = billAmount;
    } else if (form.payKind === "PART_PAID") {
      initialPaymentAmount = Number(form.amountPaid);
      if (!Number.isFinite(initialPaymentAmount) || initialPaymentAmount <= 0) {
        toast({ title: "Enter amount paid", description: "Part-paid bills need a payment greater than ₹0.", variant: "destructive" });
        return;
      }
      if (initialPaymentAmount >= billAmount) {
        toast({ title: "Amount paid must be less than bill", description: "Use Paid if settling in full, or Due if nothing paid.", variant: "destructive" });
        return;
      }
    }

    const needsPaymentFields = form.payKind !== "DUE";
    if (needsPaymentFields && !form.paymentMode) {
      toast({ title: "Select payment mode", variant: "destructive" });
      return;
    }

    if (ocrMeta && !ocrConfirmed) {
      toast({
        title: "Confirm OCR review",
        description: "Verify scanned fields and tick the confirmation before saving.",
        variant: "destructive",
      });
      return;
    }

    const vendorName = form.vendorName.trim();
    const payload: Record<string, unknown> = {
      category: form.category,
      description: form.description,
      amount: billAmount,
      billAmount,
      taxAmount: form.taxAmount ? Number(form.taxAmount) : null,
      initialPaymentAmount,
      expenseDate: form.expenseDate,
      paymentMode: form.paymentMode || "cash",
      paidTo: vendorName || null,
      vendorNameSnapshot: vendorName || null,
      vendorId: form.vendorId ? Number(form.vendorId) : null,
      invoiceNumber: form.invoiceNumber.trim() || null,
      invoiceDate: form.invoiceDate || null,
      departmentId: form.departmentId ? Number(form.departmentId) : null,
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      subcategoryId: form.subcategoryId ? Number(form.subcategoryId) : null,
      approvedBy: form.approvedBy || null,
      notes: form.notes || null,
      receiptImageUrl: receiptImage || null,
      ocrMetaJson: ocrMeta
        ? JSON.stringify({ ...ocrMeta, fields: fieldMeta, confirmedAt: new Date().toISOString() })
        : null,
    };

    if (needsPaymentFields) {
      payload.paymentDate = form.paymentDate || form.expenseDate;
      payload.paidFromAccountId = form.paidFromAccountId ? Number(form.paidFromAccountId) : null;
      payload.referenceNumber = form.referenceNumber.trim() || null;
    }

    const metaJson = buildExpenseMetaJson(form);
    if (metaJson) payload.metaJson = metaJson;

    setSavingCreate(true);
    try {
      const created = await api.post<ExpenseV2 & { duplicateWarnings?: DuplicateWarnings }>("/api/expenses", payload);
      invalidateExpenses();
      setShowForm(false);
      setForm(emptyExpenseForm(clinicDateIst));
      setPayeeSuggestionsApplied(false);
      setReceiptImage("");
      setPendingAttachment(null);
      setOcrMeta(null);
      setOcrConfirmed(false);
      setFieldMeta({});
      qc.invalidateQueries({ queryKey: ["expense-payees-recent"] });
      toast({
        title: "Supplier bill recorded",
        description: `Bill ${inr(billAmount)} · Paid ${inr(initialPaymentAmount)} · Due ${inr(Math.max(0, billAmount - initialPaymentAmount))}`,
      });
      if (created.duplicateWarnings) {
        toast({
          title: "Possible duplicate",
          description: formatDuplicateToast(created.duplicateWarnings),
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Failed to record expense",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingCreate(false);
    }
  }

  const totalBill = expenses.reduce((s, e) => s + billOf(e), 0);
  const totalPaid = expenses.reduce((s, e) => s + paidOf(e), 0);
  const totalDue = expenses.reduce((s, e) => s + dueOf(e), 0);
  const grandTotal = summary.reduce((s: number, r: ExpenseSummaryRow) => s + r.total, 0);

  // Cash/digital cards must come from expense_payments aggregation (backend),
  // not header paymentMode × totalPaid (wrong for mixed cash+UPI bills).
  const payablesStats = useMemo(() => {
    const s = payablesResp?.summary;
    if (s) {
      return {
        bills: s.bills,
        paid: s.paid,
        outstanding: s.outstanding,
        booked: s.booked,
        cashExpenses: s.cashPaid,
        digitalExpenses: s.digitalPaid,
      };
    }
    return { bills: 0, paid: 0, outstanding: 0, booked: 0, cashExpenses: 0, digitalExpenses: 0 };
  }, [payablesResp]);

  const hasFilters =
    categoryFilter !== "all" ||
    paymentFilter !== "all" ||
    paymentStatusFilter !== "all" ||
    accountingStatusFilter !== "all" ||
    vendorFilter !== "all" ||
    !!invoiceFilter ||
    from ||
    to ||
    search;

  const showDepartments = !departmentsHidden && departments.length > 0;

  async function createQuickVendor() {
    if (quickVendorSaving) return;
    const name = quickVendorName.trim();
    if (!name) {
      toast({ title: "Vendor name required", variant: "destructive" });
      return;
    }
    setQuickVendorSaving(true);
    try {
      const code = `V-${name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase() || "NEW"}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
      const created = await api.post<VendorOption>("/api/vendors", { code, name, isActive: true });
      await refetchVendors();
      setForm((f) => ({ ...f, vendorId: String(created.id), vendorName: created.name }));
      setQuickVendorOpen(false);
      setQuickVendorName("");
      toast({ title: "Vendor added" });
    } catch (err) {
      toast({
        title: "Could not add vendor",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setQuickVendorSaving(false);
    }
  }

  function markFieldUser(key: string) {
    setFieldMeta((prev) => ({
      ...prev,
      [key]: { value: null, confidencePercent: 100, source: "user" },
    }));
  }

  function applyUsualPayeeDetails(details: PayeeUsualDto | null) {
    if (!details) return;
    setForm((f) => {
      const next = { ...f };
      // Convenience only — never overwrite operator-entered values; never copy money/invoice.
      const canSuggestCategory =
        !next.categoryId &&
        (!next.category?.trim() || next.category === "miscellaneous");
      if (canSuggestCategory && details.suggestedCategory) {
        const match = categoryOptions.find(
          (c) =>
            c.label.toLowerCase() === details.suggestedCategory!.toLowerCase() ||
            c.value.toLowerCase() === details.suggestedCategory!.toLowerCase(),
        );
        if (match) {
          next.category = match.value;
          next.categoryId = match.id;
        } else {
          next.category = details.suggestedCategory.toLowerCase();
        }
      }
      if (next.categoryId && !next.subcategoryId) {
        const repairs = categoryRows.find(
          (c) =>
            c.parentId === Number(next.categoryId) &&
            c.name.toLowerCase().includes("repairs"),
        );
        if (repairs) next.subcategoryId = String(repairs.id);
      }
      if ((!next.paymentMode || next.paymentMode === "cash") && details.suggestedPaymentMode) {
        next.paymentMode = details.suggestedPaymentMode;
      }
      const meta = details.meta;
      if (meta) {
        if (!next.workType && meta.workType) next.workType = meta.workType;
        if (!next.labourBasis && meta.labourBasis) next.labourBasis = meta.labourBasis;
        if (!next.days && meta.days != null) next.days = String(meta.days);
        if (!next.ratePerDay && meta.ratePerDay != null) next.ratePerDay = String(meta.ratePerDay);
        if (!next.labourAmount && meta.labourAmount != null) next.labourAmount = String(meta.labourAmount);
        if (!next.materialAmount && meta.materialAmount != null) next.materialAmount = String(meta.materialAmount);
      }
      return next;
    });
    setPayeeSuggestionsApplied(true);
  }

  function viewPayeeHistory(opts: { vendorId: string; payeeName: string }) {
    setShowForm(false);
    setActiveTab("list");
    if (opts.vendorId) {
      setVendorFilter(opts.vendorId);
      setSearch("");
    } else {
      setVendorFilter("all");
      setSearch(opts.payeeName);
    }
  }

  function updateLabourFields(patch: Partial<Pick<ExpenseForm, "labourBasis" | "days" | "ratePerDay" | "labourAmount" | "materialAmount">>) {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (next.labourBasis === "per_day") {
        const days = Number(next.days);
        const rate = Number(next.ratePerDay);
        if (Number.isFinite(days) && Number.isFinite(rate) && days >= 0 && rate >= 0) {
          next.labourAmount = String(round2(days * rate));
        }
      }
      // Labour/material are metadata only — never silently rewrite Bill Amount.
      return next;
    });
  }

  function applyLabourSuggestedBill() {
    if (labourSuggestedBill == null) return;
    const billAmount = String(labourSuggestedBill);
    setForm((f) => ({
      ...f,
      billAmount,
      amountPaid: f.payKind === "PAID" ? billAmount : f.payKind === "DUE" ? "0" : f.amountPaid,
    }));
    markFieldUser("amount");
  }

  const showWorkMeta = isOpsMaintenanceCategory(
    form.category,
    categoryOptions.find((c) => c.value === form.category)?.label,
  );

  return (
    <div className="w-full max-w-full min-w-0">
      <PageHeader
        title="Expense Entry — Bills & Payables"
        subtitle="Bill value ≠ money paid. Track supplier bills, payments, and outstanding dues separately."
        actions={
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              setShowForm(true);
              setForm(emptyExpenseForm(clinicDateIst));
              setPayeeSuggestionsApplied(false);
              setReceiptImage("");
              setPendingAttachment(null);
              setOcrMeta(null);
              setOcrConfirmed(false);
              setFieldMeta({});
            }}
          >
            <Plus size={15} className="mr-1.5" /> New Expense / Supplier Bill
          </Button>
        }
      />

      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        <div className="flex items-center gap-1 border-b border-card-border overflow-x-auto">
          {(
            [
              { key: "list" as const, label: "All Expenses", icon: Wallet },
              { key: "payables" as const, label: "Outstanding / Payables", icon: ClipboardList },
              { key: "summary" as const, label: "Summary", icon: PieChart },
              { key: "scanner" as const, label: "Scanner", icon: ScanLine },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {activeTab !== "scanner" && (
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <div className="relative col-span-2 sm:col-span-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search payee, description, invoice…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-xs w-full sm:w-64"
                data-testid="expense-list-search"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-full sm:w-36 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c.value + c.id} value={c.value} className="capitalize">
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={paymentStatusFilter} onValueChange={setPaymentStatusFilter}>
              <SelectTrigger className="h-8 w-full sm:w-40 text-xs">
                <SelectValue placeholder="Payment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Payment: all</SelectItem>
                <SelectItem value="PAID">Payment: Paid</SelectItem>
                <SelectItem value="PART_PAID">Payment: Part paid</SelectItem>
                <SelectItem value="DUE">Payment: Due</SelectItem>
              </SelectContent>
            </Select>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger className="h-8 w-full sm:w-36 text-xs">
                <SelectValue placeholder="Payment mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modes</SelectItem>
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m} className="capitalize">
                    {m.replace("-", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={accountingStatusFilter} onValueChange={setAccountingStatusFilter}>
              <SelectTrigger className="h-8 w-full sm:w-44 text-xs">
                <SelectValue placeholder="Accounting" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Accounting: all</SelectItem>
                <SelectItem value="POSTED">Accounting: Posted</SelectItem>
                <SelectItem value="PENDING">Accounting: Pending (not linked)</SelectItem>
                <SelectItem value="FAILED">Accounting: Failed</SelectItem>
                <SelectItem value="PARTIAL">Accounting: Partial</SelectItem>
                <SelectItem value="REVERSED">Accounting: Reversed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger className="h-8 w-full sm:w-40 text-xs">
                <SelectValue placeholder="Vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All vendors</SelectItem>
                {vendors
                  .filter((v) => v.isActive !== false)
                  .map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Invoice no…"
              value={invoiceFilter}
              onChange={(e) => setInvoiceFilter(e.target.value)}
              className="h-8 text-xs w-full sm:w-32"
            />
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground sm:sr-only">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-xs w-full sm:w-36" aria-label="From date" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground sm:sr-only">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-xs w-full sm:w-36" aria-label="To date" />
            </div>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={() => {
                  setSearch("");
                  setCategoryFilter("all");
                  setPaymentFilter("all");
                  setPaymentStatusFilter("all");
                  setAccountingStatusFilter("all");
                  setVendorFilter("all");
                  setInvoiceFilter("");
                  setFrom("");
                  setTo("");
                }}
              >
                <X size={12} className="mr-1" /> Clear
              </Button>
            )}
          </div>
        )}

        {activeTab === "list" && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                {expenses.length} record{expenses.length !== 1 ? "s" : ""}
              </span>
              <span>
                Bill: <strong className="text-foreground">{inr(totalBill)}</strong>
              </span>
              <span>
                Paid: <strong className="text-green-700">{inr(totalPaid)}</strong>
              </span>
              <span>
                Due: <strong className="text-red-700">{inr(totalDue)}</strong>
              </span>
            </div>

            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
              ) : expenses.length === 0 ? (
                <div className="p-12 text-center">
                  <TrendingDown size={36} className="mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground text-sm">No expenses recorded</p>
                  <Button className="mt-4" size="sm" onClick={() => setShowForm(true)}>
                    <Plus size={13} className="mr-1" /> Add First Expense
                  </Button>
                </div>
              ) : (
                <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
                  <table className="w-full text-sm min-w-[880px]">
                    <thead className="border-b border-card-border bg-muted/30">
                      <tr>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground">ID</th>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground">Date</th>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground">Vendor / Paid To</th>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground">Category</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground">Bill</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground">Paid</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground">Due</th>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground">Payment / Accounting</th>
                        <th className="px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map((exp) => {
                        const catColor = CATEGORY_COLORS[exp.category] || "bg-gray-100 text-gray-700";
                        const status = (exp.paymentStatus || "").toUpperCase();
                        const canPay = status === "DUE" || status === "PART_PAID";
                        return (
                          <tr key={exp.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                            <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{exp.expenseId}</td>
                            <td className="px-3 py-3 text-xs whitespace-nowrap">
                              {new Date(exp.expenseDate + "T00:00:00").toLocaleDateString("en-IN")}
                            </td>
                            <td className="px-3 py-3">
                              <div className="font-medium text-sm">{vendorLabel(exp)}</div>
                              <div className="text-xs text-muted-foreground truncate max-w-[180px]">{exp.description}</div>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${catColor}`}>
                                {exp.category}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right font-semibold tabular-nums">{inr(billOf(exp))}</td>
                            <td className="px-3 py-3 text-right text-green-700 tabular-nums">{inr(paidOf(exp))}</td>
                            <td className="px-3 py-3 text-right text-red-700 tabular-nums">{inr(dueOf(exp))}</td>
                            <td className="px-3 py-3">
                              <div className="flex flex-col gap-1 items-start">
                                <PaymentStatusBadge status={exp.paymentStatus} labeled />
                                <AccountingStatusBadge status={exp.accountingStatus} labeled />
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-0.5 justify-end">
                                {((exp.attachmentCount ?? 0) > 0 || exp.hasAttachments || exp.hasReceipt) && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-indigo-600"
                                    title={exp.attachmentCount ? `${exp.attachmentCount} attachment${exp.attachmentCount === 1 ? "" : "s"}` : "View receipt"}
                                    onClick={() => openReceipt(exp)}
                                  >
                                    <FileImage size={12} />
                                  </Button>
                                )}
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="View" onClick={() => setDetailExp(exp)}>
                                  <Eye size={12} />
                                </Button>
                                {canPay && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-amber-700"
                                    title="Record payment"
                                    onClick={() => {
                                      setDetailExp(exp);
                                      setPayQuickExp(exp);
                                    }}
                                  >
                                    <Wallet size={12} />
                                  </Button>
                                )}
                                {status !== "VOID" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive"
                                    title="Void"
                                    onClick={() => setDetailExp(exp)}
                                  >
                                    <Ban size={12} />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t border-card-border bg-muted/30">
                      <tr>
                        <td colSpan={4} className="px-3 py-3 text-sm font-semibold text-right">
                          Total
                        </td>
                        <td className="px-3 py-3 text-right font-bold">{inr(totalBill)}</td>
                        <td className="px-3 py-3 text-right font-bold text-green-700">{inr(totalPaid)}</td>
                        <td className="px-3 py-3 text-right font-bold text-red-700">{inr(totalDue)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "payables" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="bg-card border border-card-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground">Bills booked</p>
                <p className="text-xl font-bold mt-1">{payablesStats.bills}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{inr(payablesStats.booked)}</p>
              </div>
              <div className="bg-card border border-card-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground">Total paid</p>
                <p className="text-xl font-bold mt-1 text-green-700">{inr(payablesStats.paid)}</p>
              </div>
              <div className="bg-card border border-card-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="text-xl font-bold mt-1 text-red-700">{inr(payablesStats.outstanding)}</p>
              </div>
              <div className="bg-card border border-card-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground">Cash expenses</p>
                <p className="text-xl font-bold mt-1 text-emerald-700">{inr(payablesStats.cashExpenses)}</p>
              </div>
              <div className="bg-card border border-card-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground">Digital expenses</p>
                <p className="text-xl font-bold mt-1 text-blue-700">{inr(payablesStats.digitalExpenses)}</p>
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              {payablesLoading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading payables…</div>
              ) : payables.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground text-sm">No outstanding bills</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead className="border-b border-card-border bg-muted/30">
                      <tr>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground">ID</th>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground">Date</th>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground">Vendor</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground">Bill</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground">Paid</th>
                        <th className="text-right px-3 py-3 font-medium text-muted-foreground">Due</th>
                        <th className="text-left px-3 py-3 font-medium text-muted-foreground">Payment</th>
                        <th className="px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {payables.map((exp) => (
                        <tr key={exp.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-3 font-mono text-xs">{exp.expenseId}</td>
                          <td className="px-3 py-3 text-xs">{new Date(exp.expenseDate + "T00:00:00").toLocaleDateString("en-IN")}</td>
                          <td className="px-3 py-3 font-medium">{vendorLabel(exp)}</td>
                          <td className="px-3 py-3 text-right">{inr(billOf(exp))}</td>
                          <td className="px-3 py-3 text-right text-green-700">{inr(paidOf(exp))}</td>
                          <td className="px-3 py-3 text-right text-red-700 font-semibold">{inr(dueOf(exp))}</td>
                          <td className="px-3 py-3">
                            <PaymentStatusBadge status={exp.paymentStatus} labeled />
                          </td>
                          <td className="px-3 py-3 text-right">
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                setDetailExp(exp);
                                setPayQuickExp(exp);
                              }}
                            >
                              Record Payment
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "summary" && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Grand total (bill): <strong className="text-foreground">{inr(grandTotal)}</strong>
            </div>
            {summary.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No data in selected range</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {summary.map((row: ExpenseSummaryRow) => {
                  const pct = grandTotal ? (row.total / grandTotal) * 100 : 0;
                  const catColor = CATEGORY_COLORS[row.category] || "bg-gray-100 text-gray-700";
                  return (
                    <div key={row.category} className="bg-card border border-card-border rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${catColor}`}>{row.category}</span>
                        <span className="text-xs text-muted-foreground">{row.count} entries</span>
                      </div>
                      <div className="text-xl font-bold">{inr(row.total)}</div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Share of total</span>
                          <span>{pct.toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "scanner" && (
          <div className="space-y-4 max-w-full min-w-0">
            <div className="bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-950/30 dark:to-blue-950/30 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <ScanLine size={18} className="text-slate-700" /> AI-Powered Bill / Receipt Scanner
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Scan physical bills with your phone camera or upload an image to auto-capture expense details. Review fields before saving.
              </p>
            </div>
            <BillReceiptScannerPanel />
          </div>
        )}
      </div>

      <Dialog
        open={showForm}
        onOpenChange={(o) => {
          if (!o) {
            setShowForm(false);
            setOcrMeta(null);
            setOcrConfirmed(false);
            setFieldMeta({});
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Expense / Supplier Bill</DialogTitle>
            <DialogDescription>
              Bill value ≠ money paid. A ₹50,000 bill with ₹20,000 paid shows Bill ₹50,000 / Paid ₹20,000 / Due ₹30,000.
            </DialogDescription>
          </DialogHeader>

          <div className="pb-1 space-y-2">
              <DocumentScanCapture<ScanBillResult>
                endpoint="/api/expenses/scan-bill"
                triggerLabel="Scan Bill / Upload"
                editorTitle="Bill / Receipt"
                helperText="Photograph or upload the bill — review OCR confidence before saving."
                tesseractFallback={async (b64, mime) => {
                  const { recognizeDocumentText } = await import("@/lib/tesseractDocumentOcr");
                  const { parseExpenseBillText } = await import("@/lib/expenseBillTextParser");
                  const text = await recognizeDocumentText(b64, mime);
                  const parsed = parseExpenseBillText(text);
                  if (!parsed.amount && !parsed.vendor) return null;
                  return { ...parsed, ocrProvider: "tesseract" };
                }}
                onImage={(b64, mime) => setReceiptImage(`data:${mime};base64,${b64}`)}
                onResult={(result) => {
                  const pct = result.confidencePercent ?? 0;
                  const fields = result.fields || {};
                  setFieldMeta(fields);
                  setOcrConfirmed(false);
                  setOcrMeta({
                    confidence: result.confidence,
                    confidencePercent: result.confidencePercent,
                    isBlurred: result.isBlurred,
                    fields,
                    ocrProvider: result.ocrProvider,
                  });
                  setForm((prev) => {
                    const bill = result.amount ? String(result.amount) : prev.billAmount;
                    const mappedMode = mapExpensePaymentModeOptional(result.paymentMode);
                    return {
                      ...prev,
                      category: prev.category === "miscellaneous" ? mapExpenseCategory(result.category) : prev.category,
                      description: prev.description || result.description || prev.description,
                      billAmount: bill,
                      amountPaid: prev.payKind === "PAID" ? bill : prev.payKind === "DUE" ? "0" : prev.amountPaid,
                      taxAmount: result.gstAmount > 0 ? String(result.gstAmount) : prev.taxAmount,
                      expenseDate: result.date || prev.expenseDate,
                      paymentMode: mappedMode || prev.paymentMode,
                      vendorName: prev.vendorName || result.vendor || prev.vendorName,
                      invoiceNumber: prev.invoiceNumber || result.invoiceNumber || prev.invoiceNumber,
                      notes: prev.notes || (result.gstAmount > 0 ? `GST: ₹${result.gstAmount}` : prev.notes),
                    };
                  });
                  toast({
                    title: pct < 80 || result.isBlurred ? "Bill scanned — please verify" : "Bill scanned — review fields",
                    description: [
                      pct ? `${pct}% confidence` : result.confidence,
                      result.isBlurred ? "image looks blurry" : null,
                      "Confirm OCR fields before saving.",
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    variant: pct < 80 || result.isBlurred ? "destructive" : "default",
                  });
                }}
              />
              {ocrMeta && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">OCR review required</p>
                      <p>
                        {[
                          ocrMeta.confidencePercent != null ? `${ocrMeta.confidencePercent}% confidence` : ocrMeta.confidence,
                          ocrMeta.ocrProvider ? `source ${ocrMeta.ocrProvider}` : null,
                          ocrMeta.isBlurred ? "blurry image" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        . Field badges mark OCR extracted, AI suggested, or missing values.
                      </p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none pl-5">
                    <input
                      type="checkbox"
                      checked={ocrConfirmed}
                      onChange={(e) => setOcrConfirmed(e.target.checked)}
                      className="rounded border-input"
                    />
                    <span className="font-medium">I have verified the scanned fields against the bill</span>
                  </label>
                </div>
              )}
              <ExpenseAttachmentsPanel
                pending={pendingAttachment}
                showAiHint
                onPendingChange={(pending) => {
                  setPendingAttachment(pending);
                  if (pending) {
                    setReceiptImage(`data:${pending.mimeType};base64,${pending.base64Data}`);
                  } else if (!ocrMeta) {
                    setReceiptImage("");
                  }
                }}
              />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label>Payment status *</Label>
                <RadioGroup
                  value={form.payKind}
                  onValueChange={(v) => applyPayKind(v as EntryPayKind)}
                  className="grid grid-cols-3 gap-2"
                >
                  {(
                    [
                      { value: "PAID", label: "Paid", hint: "Settled in full" },
                      { value: "PART_PAID", label: "Part Paid", hint: "Partial now" },
                      { value: "DUE", label: "Due", hint: "Pay later" },
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                        form.payKind === opt.value ? "border-primary bg-primary/5" : "border-card-border"
                      }`}
                    >
                      <RadioGroupItem value={opt.value} className="mt-0.5" />
                      <span>
                        <span className="block text-sm font-medium">{opt.label}</span>
                        <span className="block text-[10px] text-muted-foreground">{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="inline-flex items-center">Category *<OcrFieldBadge meta={fieldMeta.category} /></Label>
                <Select
                  value={form.category}
                    onValueChange={(v) => {
                      const match = categoryOptions.find((c) => c.value === v);
                      const parentId = match?.id ? Number(match.id) : null;
                      const repairs = parentId
                        ? categoryRows.find(
                            (c) =>
                              c.parentId === parentId &&
                              c.name.toLowerCase().includes("repairs"),
                          )
                        : undefined;
                      setForm({
                        ...form,
                        category: v,
                        categoryId: match?.id || "",
                        subcategoryId: repairs ? String(repairs.id) : "",
                      });
                      markFieldUser("category");
                    }}
                  >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c.value + c.id} value={c.value} className="capitalize">
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {subcategories.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Subcategory</Label>
                  <Select
                    value={form.subcategoryId || "none"}
                    onValueChange={(v) => setForm({ ...form, subcategoryId: v === "none" ? "" : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {subcategories.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="inline-flex items-center">Expense date *<OcrFieldBadge meta={fieldMeta.date} /></Label>
                <Input
                  type="date"
                  value={form.expenseDate}
                  onChange={(e) => {
                    setForm({ ...form, expenseDate: e.target.value });
                    markFieldUser("date");
                  }}
                  required
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="inline-flex items-center">Description *<OcrFieldBadge meta={fieldMeta.description} /></Label>
                <Input
                  value={form.description}
                  onChange={(e) => {
                    setForm({ ...form, description: e.target.value });
                    markFieldUser("description");
                  }}
                  placeholder="What was this expense for?"
                  required
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label className="inline-flex items-center">
                  Vendor / Paid to
                  <OcrFieldBadge meta={fieldMeta.vendor} />
                </Label>
                <PayeeCombobox
                  value={form.vendorName}
                  vendorId={form.vendorId}
                  onChange={({ vendorName, vendorId }) => {
                    setForm((f) => ({ ...f, vendorName, vendorId }));
                    markFieldUser("vendor");
                    setPayeeSuggestionsApplied(false);
                  }}
                  onSelectSuggestion={async (s) => {
                    const seq = ++usualApplySeq.current;
                    try {
                      const params = new URLSearchParams();
                      if (s.vendorId != null) params.set("vendorId", String(s.vendorId));
                      if (s.name) params.set("name", s.name);
                      const details = await api.get<PayeeUsualDto>(`/api/expenses/payees/usual?${params}`);
                      if (seq !== usualApplySeq.current) return;
                      applyUsualPayeeDetails(details);
                    } catch {
                      /* helper still shows via combobox; suggestions are optional */
                    }
                  }}
                  onAddToVendorMaster={(name) => {
                    setQuickVendorName(name);
                    setQuickVendorOpen(true);
                  }}
                  onViewHistory={viewPayeeHistory}
                />
                {payeeSuggestionsApplied ? (
                  <p className="text-[10px] text-emerald-800">
                    Suggested category / work / payment mode from previous expenses — review and edit freely.
                    Bill amounts are never copied automatically.
                  </p>
                ) : null}
              </div>

              {showWorkMeta ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Work type</Label>
                    <Select
                      value={form.workType || "none"}
                      onValueChange={(v) => setForm({ ...form, workType: v === "none" ? "" : v })}
                    >
                      <SelectTrigger data-testid="expense-work-type">
                        <SelectValue placeholder="Optional" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {WORK_TYPES.map((w) => (
                          <SelectItem key={w} value={w}>
                            {w}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Labour basis</Label>
                    <Select
                      value={form.labourBasis || "none"}
                      onValueChange={(v) =>
                        updateLabourFields({
                          labourBasis: v === "none" ? "" : (v as LabourBasis),
                        })
                      }
                    >
                      <SelectTrigger data-testid="expense-labour-basis">
                        <SelectValue placeholder="Optional" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        <SelectItem value="per_day">Per Day</SelectItem>
                        <SelectItem value="per_job">Per Job</SelectItem>
                        <SelectItem value="contract">Contract</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.labourBasis === "per_day" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label>Days</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          value={form.days}
                          onChange={(e) => updateLabourFields({ days: e.target.value })}
                          data-testid="expense-labour-days"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Rate / day (₹)</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.ratePerDay}
                          onChange={(e) => updateLabourFields({ ratePerDay: e.target.value })}
                          data-testid="expense-labour-rate"
                        />
                      </div>
                    </>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label>Labour amount (₹)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.labourAmount}
                      onChange={(e) => updateLabourFields({ labourAmount: e.target.value })}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Material amount (₹)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.materialAmount}
                      onChange={(e) => updateLabourFields({ materialAmount: e.target.value })}
                      placeholder="Optional — not inventory"
                    />
                  </div>
                  {labourSuggestedBill != null ? (
                    <div className="col-span-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span>
                        Suggested bill from labour
                        {form.materialAmount ? " + material" : ""}:{" "}
                        <strong className="text-foreground">{inr(labourSuggestedBill)}</strong>
                        {form.labourBasis === "per_day" && form.days && form.ratePerDay
                          ? ` (${form.days} × ₹${form.ratePerDay}`
                          : ""}
                        {form.labourBasis === "per_day" && form.days && form.ratePerDay && form.materialAmount
                          ? ` + ₹${form.materialAmount})`
                          : form.labourBasis === "per_day" && form.days && form.ratePerDay
                            ? ")"
                            : ""}
                        . Does not change Bill Amount unless you apply it.
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px]"
                        data-testid="expense-apply-labour-bill"
                        onClick={applyLabourSuggestedBill}
                      >
                        Use as bill amount
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}

              <div className="space-y-1.5">
                <Label className="inline-flex items-center">Invoice number<OcrFieldBadge meta={fieldMeta.invoiceNumber} /></Label>
                <Input
                  value={form.invoiceNumber}
                  onChange={(e) => {
                    setForm({ ...form, invoiceNumber: e.target.value });
                    markFieldUser("invoiceNumber");
                  }}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Invoice date</Label>
                <Input
                  type="date"
                  value={form.invoiceDate}
                  onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
                />
              </div>

              {showDepartments && (
                <div className="space-y-1.5 col-span-2">
                  <Label>Department / area</Label>
                  <Select
                    value={form.departmentId || "none"}
                    onValueChange={(v) => setForm({ ...form, departmentId: v === "none" ? "" : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Optional cost centre / location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Optional attribution to an existing department (MRI, CT, Lab, etc.). Reuses the department master — not a second location list.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="inline-flex items-center">Bill amount (₹) *<OcrFieldBadge meta={fieldMeta.amount} /></Label>
                <div className="relative">
                  <IndianRupee size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.billAmount}
                    onChange={(e) => {
                      const billAmount = e.target.value;
                      setForm((f) => ({
                        ...f,
                        billAmount,
                        amountPaid: f.payKind === "PAID" ? billAmount : f.payKind === "DUE" ? "0" : f.amountPaid,
                      }));
                      markFieldUser("amount");
                    }}
                    className="pl-8"
                    placeholder="0"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="inline-flex items-center">Tax / GST (₹)<OcrFieldBadge meta={fieldMeta.gstAmount} /></Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.taxAmount}
                  onChange={(e) => {
                    setForm({ ...form, taxAmount: e.target.value });
                    markFieldUser("gstAmount");
                  }}
                  placeholder="0"
                />
              </div>

              {form.payKind !== "DUE" && (
                <div className="space-y-1.5">
                  <Label>Amount paid (₹) {form.payKind === "PART_PAID" ? "*" : ""}</Label>
                  <div className="relative">
                    <IndianRupee size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.amountPaid}
                      onChange={(e) => setForm({ ...form, amountPaid: e.target.value })}
                      className="pl-8"
                      disabled={form.payKind === "PAID"}
                      required={form.payKind === "PART_PAID"}
                    />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                  <Label>Balance due</Label>
                  <Input value={inr(balancePreview)} readOnly className="bg-muted/40 font-semibold text-red-700" />
                </div>

              {form.payKind !== "DUE" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="inline-flex items-center">Payment mode *<OcrFieldBadge meta={fieldMeta.paymentMode} /></Label>
                    <Select
                      value={form.paymentMode}
                      onValueChange={(v) => {
                        setForm({ ...form, paymentMode: v });
                        markFieldUser("paymentMode");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_MODES.map((m) => (
                          <SelectItem key={m} value={m} className="capitalize">
                            {m.replace("-", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Payment date</Label>
                    <Input
                      type="date"
                      value={form.paymentDate}
                      onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Paid from account</Label>
                    <Select
                      value={form.paidFromAccountId || "none"}
                      onValueChange={(v) => setForm({ ...form, paidFromAccountId: v === "none" ? "" : v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Optional" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {paidFromAccounts.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {a.name} ({a.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Reference number
                      {isCashMode(form.paymentMode) ? (
                        <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
                      ) : (
                        <span className="ml-1 font-normal text-muted-foreground">(UTR / cheque / UPI ref)</span>
                      )}
                    </Label>
                    <Input
                      value={form.referenceNumber}
                      onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })}
                      placeholder={
                        isCashMode(form.paymentMode)
                          ? "Optional for cash"
                          : form.paymentMode === "cheque"
                            ? "Cheque number"
                            : "UTR / reference"
                      }
                    />
                  </div>
                </>
              )}


              <div className="space-y-1.5">
                <Label>Approved By</Label>
                <Input
                  value={form.approvedBy}
                  onChange={(e) => setForm({ ...form, approvedBy: e.target.value })}
                  placeholder="Defaults to you (cash drawer owner)"
                  title="Cash expenses reduce this person's drawer on My Daily Summary"
                />
                <p className="text-[10px] text-muted-foreground">
                  Cash outflows hit this name&apos;s My Daily Summary / day-close drawer.
                </p>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Notes</Label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Any additional notes"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setOcrMeta(null);
                  setOcrConfirmed(false);
                  setFieldMeta({});
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingCreate}>
                {savingCreate ? "Saving…" : "Save Bill"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={quickVendorOpen} onOpenChange={setQuickVendorOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Quick-add vendor</DialogTitle>
            <DialogDescription>Creates a supplier in the existing vendors master (no second supplier list).</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={quickVendorName} onChange={(e) => setQuickVendorName(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickVendorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createQuickVendor} disabled={quickVendorSaving}>
              {quickVendorSaving ? "Saving…" : "Add vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExpenseDetailDrawer
        expense={detailExp}
        open={!!detailExp}
        initialShowPay={!!payQuickExp && detailExp?.id === payQuickExp.id}
        onOpenChange={(o) => {
          if (!o) {
            setDetailExp(null);
            setPayQuickExp(null);
          }
        }}
        accounts={accounts}
        departments={departments}
        onChanged={() => {
          invalidateExpenses();
          refetchPayables();
        }}
        onViewReceipt={openReceipt}
      />

      <Dialog open={!!viewReceipt} onOpenChange={(o) => { if (!o) setViewReceipt(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Scanned Bill — {viewReceipt?.expenseId}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center min-h-[200px] max-h-[75vh] overflow-auto bg-muted/30 rounded-lg">
            {viewReceipt?.loading ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground py-10">
                <Loader2 size={16} className="animate-spin" /> Loading image…
              </span>
            ) : viewReceipt?.url ? (
              <img src={viewReceipt.url} alt="Scanned bill" className="max-w-full max-h-[72vh] object-contain" />
            ) : (
              <span className="text-sm text-muted-foreground py-10">No image stored for this expense.</span>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
