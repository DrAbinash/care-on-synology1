import { useState, useEffect, useMemo } from "react";
import QRCode from "qrcode";
import { Link, useLocation } from "wouter";
import { useGetBill, useCreatePayment, getGetBillQueryKey, getListBillsQueryKey, useListTests } from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Pencil, History, Clock, ShieldAlert, Trash2, AlertTriangle, Printer, Ban, Undo2, XCircle, AlertCircle, Search, X, CheckSquare, Square, RotateCcw, Stethoscope } from "lucide-react";
import { useForm } from "react-hook-form";
import { useSuperAdmin, getSuperAdminToken } from "@/hooks/useSuperAdmin";
import { getStoredUsbKey, onUsbKeyChange } from "@/lib/usbKey";
import { readStaffSession, hasSubPermission } from "@/lib/staffSession";
import { useToast } from "@/hooks/use-toast";
import { getAutoBillPaperSize, getBillPaperSize, getBillPrintLayout, getLayoutStyles, setBillPaperSize } from "@/lib/billPrintLayout";
import {
  buildBillPrintHtml,
  openBlankPrintWindow,
  writeAndPrint,
  printViaIframe,
  type PrintBillData,
  type PrintClinic,
} from "@/lib/printBill";
import {
  loadBillPrintSettings,
  parseGlobalBillPrintSettings,
  printLayoutOpts,
  applyManualBillPaperOverride,
  resolveBillPrintPageOpts,
  type BillPrintSettings,
} from "@/lib/billPrintSettings";

type PaymentForm = {
  amount: number;
  method: "cash" | "card" | "upi" | "insurance" | "cheque";
  referenceNumber?: string;
  notes?: string;
};

type EditForm = {
  discount: number;
  status: string;
  editedBy: string;
  reason: string;
};

type SuperEditForm = {
  subtotal: number;
  discount: number;
  taxAmount: number;
  reason: string;
};

type DeleteForm = {
  reason: string;
  confirmText: string;
};

type CancelForm = {
  performedBy: string;
  reason: string;
};

type RefundForm = {
  performedBy: string;
  reason: string;
  amount: number;
  method: "cash" | "card" | "upi" | "insurance" | "cheque";
};

type CancelRefundForm = {
  performedBy: string;
  reason: string;
  refundAmount: number;
  refundMethod: "cash" | "card" | "upi" | "insurance" | "cheque";
};

type ChangeDoctorForm = {
  newDoctorId: number | 0;
  reason: string;
  performedBy: string;
};

type BillSearchResult = {
  id: number;
  billNumber: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
  createdAt: string;
  patientName: string;
  patientId: string;
  phone: string;
  doctorName?: string | null;
};

type Doctor = { id: number; name: string; specialization: string };

type BillAudit = {
  id: number;
  billId: number;
  editedBy: string;
  reason: string;
  changeType: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

const PAYMENT_METHODS = ["cash", "card", "upi", "insurance", "cheque"];
const BILL_STATUSES = ["pending", "partial", "paid", "cancelled"];

// ─── Print helpers ────────────────────────────────────────────────────────
// We render the receipt into a freshly-opened popup window using a fully-
// formed HTML string. This avoids the previous in-page hidden-DOM approach,
// which was racy: the browser sometimes printed before React had mounted
// the receipt subtree (blank page) or printed only the header on reprint
// because the receipt body had been removed during an earlier cleanup.
//
// Doing all the work in a self-contained HTML string also means the same
// template is used for fresh prints (?print=1) and reprints, and we don't
// depend on the `clinic` query already being warm in the cache.

// (Implementation moved to src/lib/printBill.ts and imported above.)

export default function BillDetail({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: bill, isLoading } = useGetBill(id, {
    query: {
      // Re-fetch the bill every 15 s so payments/refunds/cancellations made by
      // another tab or staff member appear automatically without a manual refresh.
      queryKey: getGetBillQueryKey(id),
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    },
  });
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [superEditOpen, setSuperEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [changeDoctorOpen, setChangeDoctorOpen] = useState(false);
  const [cdDoctorSearch, setCdDoctorSearch] = useState("");
  const [cdDoctorSearchOpen, setCdDoctorSearchOpen] = useState(false);
  const [cdNote, setCdNote] = useState("");
  const [refundTab, setRefundTab] = useState<"cancel" | "refund" | "cancel-refund">("cancel");
  // ── Bill search (same as Billing page) ──────────────────────────────────
  const [billSearchQuery, setBillSearchQuery] = useState("");
  const [billDebouncedSearch, setBillDebouncedSearch] = useState("");
  const [billSearchOpen, setBillSearchOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBillDebouncedSearch(billSearchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [billSearchQuery]);
  const isBillSearching = billDebouncedSearch.length >= 2;
  const { data: billSearchResults, isFetching: billSearchFetching } = useQuery<BillSearchResult[]>({
    queryKey: ["bills-search", billDebouncedSearch],
    queryFn: () => api.get(`/api/bills/search?q=${encodeURIComponent(billDebouncedSearch)}`),
    enabled: isBillSearching,
    staleTime: 10_000,
  });
  const [reprintBy, setReprintBy] = useState<string>(() => readStaffSession()?.user.name || localStorage.getItem("diagnosticErp:lastReprintBy") || "");
  const [reprintReason, setReprintReason] = useState<string>("");
  const [reprintNote, setReprintNote] = useState<string>("");
  // Admin-configurable preset list (Settings → Reprint Reasons), same pattern
  // as Billing Desk's discount-reason dropdown — replaces free-text-only
  // input that let staff type anything (e.g. "rr").
  const { data: reprintReasons = [] } = useQuery<{ id: number; label: string; isActive: boolean }[]>({
    queryKey: ["reprint-reasons"],
    queryFn: () => api.get("/api/reprint-reasons"),
  });
  const [paperSize, setPaperSize] = useState<"A4" | "A5">(() => getBillPaperSize());
  const [paperMode, setPaperMode] = useState<"auto" | "manual">("auto");
  const [paymentFilter, setPaymentFilter] = useState("");
  const billPrintLayout = getBillPrintLayout();
  const ls = getLayoutStyles(billPrintLayout);
  const queryClient = useQueryClient();
  const superAdmin = useSuperAdmin();
  const [usbKeyPresent, setUsbKeyPresent] = useState(() => getStoredUsbKey() !== null);
  const showSuperAdminActions = superAdmin.isActive && usbKeyPresent;

  useEffect(() => {
    return onUsbKeyChange(() => setUsbKeyPresent(getStoredUsbKey() !== null));
  }, []);

  useEffect(() => {
    if (paperMode === "manual") setBillPaperSize(paperSize);
  }, [paperMode, paperSize]);
  const autoPaperSize = getAutoBillPaperSize((bill?.order?.tests?.length ?? 0), paperMode === "manual" ? paperSize : undefined);
  const effectivePaperSize = paperMode === "manual" ? paperSize : autoPaperSize;

  // Clinic settings for the printed receipt header
  const { data: clinic } = useQuery<{
    name: string; tagline: string; address: string; email: string; phone: string;
    website: string; gstin: string; logoDataUrl: string | null; footerNote?: string;
    showTatOnBill?: boolean;
    billPrintCopies?: number;
    qrOnBillEnabled?: boolean;
    billShowCode?: boolean;
    billShowCategory?: boolean;
    billPrintSettingsJson?: string | null;
  }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });

  const { data: printerSettings } = useQuery<{ billPrinterType?: string }>({
    queryKey: ["printer-settings"],
    queryFn: () => api.get("/api/printers/settings"),
    staleTime: 5 * 60_000,
  });
  const { data: doctorsResp } = useQuery<{ doctors: Doctor[]; total: number }>({
    queryKey: ["doctors"],
    queryFn: () => api.get("/api/doctors"),
    staleTime: 5 * 60_000,
  });
  const isBW = printerSettings?.billPrinterType === "bw";
  const isCancelled = bill?.status === "cancelled";

  // Inline QR for the printed receipt — shares the same encoding as
  // BillingDesk so the verify URL stays consistent across surfaces.
  const buildBillVerifyUrl = (billNumber: string) =>
    // Public api-server route — works in dev (proxied /api) and production
    // (unified serve). See artifacts/api-server/src/routes/verify.ts.
    `${window.location.origin}/api/verify/bill/${encodeURIComponent(billNumber)}`;

  // Real scannable QR (PNG data URL) generated via the qrcode library
  // when the bill loads. Empty string until generation completes; the
  // <img> below skips rendering until the data URL is ready.
  const [billQrDataUrl, setBillQrDataUrl] = useState<string>("");
  useEffect(() => {
    if (!bill?.billNumber) { setBillQrDataUrl(""); return; }
    let cancelled = false;
    QRCode.toDataURL(buildBillVerifyUrl(bill.billNumber), {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => { if (!cancelled) setBillQrDataUrl(url); })
      .catch(() => { if (!cancelled) setBillQrDataUrl(""); });
    return () => { cancelled = true; };
  }, [bill?.billNumber]);

  // Note: the previous in-page hidden-DOM print pipeline has been replaced
  // with a popup-window template (buildBillPrintHtml). The reprint flow now
  // calls openBlankPrintWindow + writeAndPrint from submitReprint() so we don't
  // depend on React state propagating before window.print() fires.

  const reprintLog = useMutation({
    mutationFn: (body: { reprintedBy: string; reason: string }) =>
      api.post(`/api/bills/${id}/reprint-log`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bill-audits", id] });
    },
  });

  // Build the receipt HTML for the loaded bill. Caller picks the delivery
  // method: an already-opened popup window (writeAndPrint) for click-driven
  // flows, or a same-tab hidden iframe (printViaIframe) for the ?print=1
  // case where the tab itself was opened by a target="_blank" link.
  const buildHtmlForCurrent = (opts: { reprintBy?: string; reprintReason?: string } = {}): string | null => {
    if (!bill) return null;
    // Clinic-wide server settings as the base (same as the BillingDesk print
    // paths) so a reprint honors the admin-configured format/layout too.
    const settings = loadBillPrintSettings(parseGlobalBillPrintSettings(clinic?.billPrintSettingsJson));
    const testCount = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") !== "cancelled").length;
    const settingsForPrint = {
      ...settings,
      ...applyManualBillPaperOverride(settings, paperMode === "manual" ? paperSize : null),
    };
    const pageOpts = resolveBillPrintPageOpts(settingsForPrint, testCount);
    return buildBillPrintHtml({
      bill: bill as PrintBillData,
      clinic: clinic as PrintClinic,
      paperSize: pageOpts.paperSize,
      orientation: pageOpts.orientation,
      pageCssSize: pageOpts.pageCssSize,
      compactFooterGap: pageOpts.compactFooterGap,
      isBW,
      qrDataUrl: billQrDataUrl,
      reprintBy: opts.reprintBy,
      reprintReason: opts.reprintReason,
      format: settingsForPrint.defaultFormat,
      showQr: settings.showQrCode,
      showAmountInWords: settings.showAmountInWords,
      showSignatureLine: settings.showSignatureLine,
      showComputerGenerated: settings.showComputerGenerated,
      showReportMessage: settings.showReportMessage,
      showServiceFooter: settings.showServiceFooter,
      showBrandingFooter: settings.showBrandingFooter,
      showBarcode: settings.showBarcode,
      showWatermark: settings.showWatermark,
      showPatientInstructions: settings.showPatientInstructions,
      showSystemInfo: settings.showSystemInfo,
      showQueueToken: settings.showQueueTokenOnBill,
      ...printLayoutOpts(settingsForPrint),
    });
  };

  const resolvedReprintPaper = useMemo(() => {
    if (!bill) return "";
    const settings = loadBillPrintSettings(parseGlobalBillPrintSettings(clinic?.billPrintSettingsJson));
    const testCount = (bill.order?.tests ?? []).filter((t) => (t.status ?? "active") !== "cancelled").length;
    const settingsForPrint = {
      ...settings,
      ...applyManualBillPaperOverride(settings, paperMode === "manual" ? paperSize : null),
    };
    const pageOpts = resolveBillPrintPageOpts(settingsForPrint, testCount);
    return pageOpts.pageCssSize;
  }, [bill, clinic?.billPrintSettingsJson, paperMode, paperSize]);

  // Re-print: open the popup SYNCHRONOUSLY in the click handler so the
  // browser doesn't strip user-activation by the time the reprint-log POST
  // resolves. The window shows a "Preparing receipt…" placeholder until
  // we write the final HTML.
  const submitReprint = async () => {
    const by = reprintBy.trim();
    const preset = reprintReason.trim();
    if (!by || !preset) return;
    const note = reprintNote.trim();
    const why = note ? `${preset} — ${note}` : preset;
    const win = openBlankPrintWindow();
    localStorage.setItem("diagnosticErp:lastReprintBy", by);
    try {
      await reprintLog.mutateAsync({ reprintedBy: by, reason: why });
    } catch (e) {
      // Logging failure should not block printing — user already authorised reprint.
      console.error("Reprint log failed:", e);
    }
    setReprintOpen(false);
    setReprintReason("");
    setReprintNote("");
    const html = buildHtmlForCurrent({ reprintBy: by, reprintReason: why });
    if (html) writeAndPrint(win, html);
  };

  // Auto-print on first load when navigated with ?print=1 (e.g. opened in a
  // new tab from the Billing list "Print" link). The tab itself was opened
  // by a user click, so we can print directly into a hidden iframe in the
  // same tab — no popup blocker risk and no dependency on `clinic` being
  // loaded (the template falls back to defaults).
  const autoPrintedRef = useState({ done: false })[0];
  useEffect(() => {
    if (!bill) return;
    if (autoPrintedRef.done) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("print") !== "1") return;
    autoPrintedRef.done = true;
    // Tiny delay so QR data URL has a chance to settle (it loads async).
    const timer = setTimeout(() => {
      const html = buildHtmlForCurrent();
      if (html) printViaIframe(html);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill, clinic, billQrDataUrl, paperMode, paperSize, isBW]);

  const { data: audits = [], refetch: refetchAudits } = useQuery<BillAudit[]>({
    queryKey: ["bill-audits", id],
    queryFn: () => api.get(`/api/bills/${id}/audits`),
    enabled: auditOpen,
  });

  const { data: reprintHistory = [] } = useQuery<BillAudit[]>({
    queryKey: ["bill-reprint-history", id],
    queryFn: () => api.get(`/api/bills/${id}/audits`),
    select: (data: BillAudit[]) => data.filter((a) => a.changeType === "reprint"),
  });

  const createPayment = useCreatePayment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBillQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
        setOpen(false);
        reset();
      },
    },
  });

  const updateBill = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.put(`/api/bills/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetBillQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
      refetchAudits();
      setEditOpen(false);
      resetEdit();
    },
  });

  const superEditBill = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/api/bills/${id}/super-edit`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetBillQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
      refetchAudits();
      setSuperEditOpen(false);
      resetSuperEdit();
    },
  });

  const deleteBill = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.delete(`/api/bills/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
      navigate("/billing");
    },
  });

  const cancelBill = useMutation({
    mutationFn: (body: CancelForm) =>
      api.post<{ closedPeriodWarning?: { billCreatedBeforeClose: boolean; lastClosureAt: string | null } | null }>(
        `/api/bills/${id}/cancel`,
        body,
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: getGetBillQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
      refetchAudits();
      setRefundOpen(false);
      resetCancel();
      // Same informational notice as refundBill above — only fires when
      // this cancellation triggered an auto-refund on a bill from an
      // already-closed period. Never blocks, no approval required.
      if (data?.closedPeriodWarning?.billCreatedBeforeClose) {
        toast({
          title: "Cancellation recorded — original bill was from a closed period",
          description: "This bill was created before the most recent day-close. The auto-refund is not blocked and needs no approval — it's automatically included in the current open reconciliation.",
        });
      }
    },
  });

  const refundBill = useMutation({
    mutationFn: (body: RefundForm) =>
      api.post<{ closedPeriodWarning?: { billCreatedBeforeClose: boolean; lastClosureAt: string | null } | null }>(
        `/api/bills/${id}/refund`,
        body,
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: getGetBillQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
      refetchAudits();
      setRefundOpen(false);
      resetRefund();
      // Informational only — the refund already succeeded and correctly
      // belongs to the current open reconciliation window regardless of
      // this flag. No approval is required and nothing is blocked; this
      // just lets staff know the original bill was from an already-closed,
      // signed-off period. See DAILY_FINANCIAL_RECONCILIATION_SPECIFICATION.md §22.5.
      if (data?.closedPeriodWarning?.billCreatedBeforeClose) {
        toast({
          title: "Refund recorded — original bill was from a closed period",
          description: "This bill was created before the most recent day-close. The refund is not blocked and needs no approval — it's automatically included in the current open reconciliation.",
        });
      }
    },
  });

  const { register, handleSubmit, reset, setValue, watch } = useForm<PaymentForm>({ defaultValues: { method: "cash" } });
  const { register: regEdit, handleSubmit: handleEdit, reset: resetEdit, setValue: setEditVal, watch: watchEdit } = useForm<EditForm>({
    defaultValues: { discount: 0, status: "pending", editedBy: "", reason: "" },
  });
  const { register: regSuperEdit, handleSubmit: handleSuperEdit, reset: resetSuperEdit, watch: watchSuperEdit } = useForm<SuperEditForm>({
    defaultValues: { subtotal: 0, discount: 0, taxAmount: 0, reason: "" },
  });
  const { register: regDelete, handleSubmit: handleDelete, reset: resetDelete, watch: watchDelete } = useForm<DeleteForm>({
    defaultValues: { reason: "", confirmText: "" },
  });
  // Default the actor name to the signed-in staff user (from the portal session) when present.
  const defaultActor = readStaffSession()?.user.name ?? "";
  const { register: regCancel, handleSubmit: handleCancel, reset: resetCancel, formState: cancelState } = useForm<CancelForm>({
    defaultValues: { performedBy: defaultActor, reason: "" },
  });
  const { register: regRefund, handleSubmit: handleRefund, reset: resetRefund, watch: watchRefund, setValue: setRefundVal, formState: refundState } = useForm<RefundForm>({
    defaultValues: { performedBy: defaultActor, reason: "", amount: 0, method: "cash" },
  });
  const { register: regCR, handleSubmit: handleCR, reset: resetCR, watch: watchCR, setValue: setCRVal, formState: crState } = useForm<CancelRefundForm>({
    defaultValues: { performedBy: defaultActor, reason: "", refundAmount: 0, refundMethod: "cash" },
  });
  const { register: regCD, handleSubmit: handleCD, reset: resetCD, watch: watchCD, setValue: setCDVal, formState: cdState } = useForm<ChangeDoctorForm>({
    defaultValues: { newDoctorId: 0, reason: "", performedBy: defaultActor },
  });

  const onSubmit = (data: PaymentForm) => {
    createPayment.mutate({ data: { billId: id, amount: Number(data.amount), method: data.method, referenceNumber: data.referenceNumber || undefined, notes: data.notes || undefined } });
  };

  const onEditSubmit = handleEdit((d) => {
    updateBill.mutate({
      discount: Number(d.discount),
      status: d.status,
      editedBy: d.editedBy,
      reason: d.reason,
    });
  });

  const onSuperEditSubmit = handleSuperEdit((d) => {
    const token = getSuperAdminToken();
    superEditBill.mutate({
      subtotal: Number(d.subtotal),
      discount: Number(d.discount),
      taxAmount: Number(d.taxAmount),
      token,
      reason: d.reason,
    });
  });

  const onDeleteSubmit = handleDelete((d) => {
    if (d.confirmText !== bill?.billNumber) return;
    const token = getSuperAdminToken();
    deleteBill.mutate({ token, reason: d.reason });
  });

  const onCancelSubmit = handleCancel((d) => {
    cancelBill.mutate({ performedBy: d.performedBy.trim(), reason: d.reason.trim() });
  });

  const onCancelRefundSubmit = handleCR(async (d) => {
    await refundBill.mutateAsync({
      performedBy: d.performedBy.trim(),
      reason: d.reason.trim(),
      amount: Number(d.refundAmount),
      method: d.refundMethod,
    });
    cancelBill.mutate({ performedBy: d.performedBy.trim(), reason: d.reason.trim() });
  });

  const onRefundSubmit = handleRefund((d) => {
    refundBill.mutate({
      performedBy: d.performedBy.trim(),
      reason: d.reason.trim(),
      amount: Number(d.amount),
      method: d.method,
    });
  });

  const changeDoctor = useMutation({
    mutationFn: (body: ChangeDoctorForm) =>
      api.post(`/api/bills/${id}/change-doctor`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetBillQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
      refetchAudits();
      setChangeDoctorOpen(false);
      resetCD();
    },
  });

  const onChangeDoctorSubmit = handleCD((d) => {
    const preset = d.reason.trim();
    const note = cdNote.trim();
    changeDoctor.mutate({
      newDoctorId: d.newDoctorId === 0 ? 0 : Number(d.newDoctorId),
      reason: note ? `${preset} — ${note}` : preset,
      performedBy: d.performedBy.trim(),
    });
  });

  const openRefund = () => {
    if (!bill) return;
    const hasPaid = Number(bill.paidAmount) > 0;
    // Default: "Refund & Cancel" when money was paid (one-step), plain cancel otherwise.
    setRefundTab(hasPaid ? "cancel-refund" : "cancel");
    resetCancel({ performedBy: defaultActor, reason: "" });
    resetRefund({
      performedBy: defaultActor,
      reason: "",
      amount: Number(bill.paidAmount) > 0 ? Number(bill.paidAmount) : 0,
      method: "cash",
    });
    resetCR({
      performedBy: defaultActor,
      reason: "",
      refundAmount: Number(bill.paidAmount) > 0 ? Number(bill.paidAmount) : 0,
      refundMethod: "cash",
    });
    setRefundOpen(true);
  };

  const openEdit = () => {
    if (!bill) return;
    resetEdit({ discount: bill.discount, status: bill.status, editedBy: "", reason: "" });
    setEditOpen(true);
  };

  const openSuperEdit = () => {
    if (!bill) return;
    resetSuperEdit({
      subtotal: Number(bill.subtotal),
      discount: Number(bill.discount),
      taxAmount: Number(bill.taxAmount),
      reason: "",
    });
    setSuperEditOpen(true);
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

  const calcAge = (dob?: string | null, ageValue?: number | null, ageUnit?: string | null) => {
    // Only commit to the (ageValue, ageUnit) path when it will produce a real
    // string — a stored value of 0 (from a blank field on registration) must
    // fall through to dateOfBirth instead of short-circuiting to null.
    if (ageValue != null && ageValue > 0 && ageUnit) {
      if (ageUnit === "years") return `${ageValue} Yrs`;
      if (ageUnit === "months") return `${ageValue} Mo`;
      if (ageUnit === "days") return `${ageValue} D`;
    }
    if (!dob) return null;
    const years = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
    return years > 0 ? `${years} Yrs` : null;
  };
  const ageDisplay = bill?.patient ? calcAge(bill.patient.dateOfBirth, bill.patient.ageValue, bill.patient.ageUnit) : null;

  if (isLoading) return <div className="p-6 animate-pulse"><div className="h-8 bg-muted rounded w-64" /></div>;
  if (!bill) return <div className="p-6 text-muted-foreground">Bill not found.</div>;

  const session = readStaffSession();
  const canEdit = bill.status !== "paid" && bill.status !== "cancelled" && (!session || hasSubPermission(session, "/billing", "edit"));
  const canReprint = !session || hasSubPermission(session, "/billing", "reprint");
  const canRefund = !session || hasSubPermission(session, "/billing", "refund");
  const superSub = watchSuperEdit("subtotal");
  const superDisc = watchSuperEdit("discount");
  const superTax = watchSuperEdit("taxAmount");
  const projectedTotal = (Number(superSub) || 0) - (Number(superDisc) || 0) + (Number(superTax) || 0);
  const confirmVal = watchDelete("confirmText");

  return (
    <div className="pb-8">
      <div className="px-6 pt-4">
        <Link href="/billing" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft size={14} /> Back to Billing
        </Link>
      </div>

      <PageHeader
        title={bill.billNumber}
        subtitle={`Generated ${new Date(bill.createdAt).toLocaleString()}`}
        actions={
          <div className="flex gap-2 flex-wrap items-center">
            {/* ── Compact bill search (same API as Billing page) ────────────── */}
            <div className="relative w-56 sm:w-64">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={billSearchQuery}
                onChange={(e) => { setBillSearchQuery(e.target.value); setBillSearchOpen(true); }}
                onFocus={() => setBillSearchOpen(true)}
                placeholder="Search bills…"
                className="pl-8 pr-8 h-8 text-sm"
              />
              {billSearchQuery && (
                <button
                  type="button"
                  onClick={() => { setBillSearchQuery(""); setBillSearchOpen(false); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X size={13} />
                </button>
              )}
              {/* Search results dropdown */}
              {billSearchOpen && isBillSearching && (
                <div className="absolute z-50 mt-1 w-full border border-card-border rounded-lg bg-popover shadow-lg max-h-72 overflow-y-auto">
                  {billSearchFetching ? (
                    <div className="px-4 py-3 text-sm text-muted-foreground animate-pulse">Searching…</div>
                  ) : !billSearchResults?.length ? (
                    <div className="px-4 py-3 text-sm text-muted-foreground">No bills found</div>
                  ) : (
                    billSearchResults.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b last:border-0 border-border/50 flex items-center gap-2"
                        onClick={() => {
                          navigate(`/billing/${b.id}`);
                          setBillSearchQuery("");
                          setBillSearchOpen(false);
                        }}
                      >
                        <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 font-mono text-[10px] text-primary font-extrabold">#{b.id}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold truncate">{b.billNumber}</div>
                          <div className="text-xs text-muted-foreground truncate">{b.patientName} · {formatCurrency(b.totalAmount)} · <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${b.status === "paid" ? "bg-green-100 text-green-700" : b.status === "cancelled" ? "bg-red-100 text-red-700" : b.status === "partial" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>{b.status}</span></div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 border border-border rounded-md px-1 py-0.5 text-xs">
              <span className="text-muted-foreground px-1">Paper:</span>
              <button
                type="button"
                onClick={() => { setPaperMode("manual"); setPaperSize("A4"); }}
                className={`px-2 py-0.5 rounded ${paperSize === "A4" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >A4</button>
              <button
                type="button"
                onClick={() => { setPaperMode("manual"); setPaperSize("A5"); }}
                className={`px-2 py-0.5 rounded ${paperSize === "A5" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >A5</button>
            </div>
            {canReprint && (
              <Button size="sm" variant="outline" onClick={() => { setReprintReason(""); setReprintNote(""); setReprintOpen(true); }}>
                <Printer size={14} className="mr-1" /> Re-print
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => { setAuditOpen(true); }}>
              <History size={14} className="mr-1" /> History
            </Button>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={openEdit}>
                <Pencil size={14} className="mr-1" /> Edit Bill
              </Button>
            )}
            {bill.status !== "cancelled" && canRefund && (
              <Button size="sm" variant="outline" onClick={openRefund} className="border-orange-300 text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 dark:hover:bg-orange-950">
                <Undo2 size={14} className="mr-1" /> Refund / Cancel
              </Button>
            )}
            {bill.status !== "paid" && bill.status !== "cancelled" && (
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus size={14} className="mr-1" /> Add Payment
              </Button>
            )}
          </div>
        }
      />

      <div className="px-6 space-y-5">
      {/* Cancellation banner — only when bill is cancelled */}
      {bill.status === "cancelled" && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl p-4 flex items-start gap-3">
          <Ban size={20} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-red-700 dark:text-red-300">This bill has been cancelled</p>
            {(bill as { cancellationReason?: string | null }).cancellationReason && (
              <p className="text-red-700/90 dark:text-red-300/90 mt-1">
                <span className="font-medium">Reason:</span> {(bill as { cancellationReason?: string | null }).cancellationReason}
              </p>
            )}
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
              {(bill as { cancelledByName?: string | null }).cancelledByName ? `By ${(bill as { cancelledByName?: string | null }).cancelledByName}` : "By staff"}
              {(bill as { cancelledAt?: string | null }).cancelledAt ? ` on ${new Date((bill as { cancelledAt?: string | null }).cancelledAt as string).toLocaleString()}` : ""}
            </p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Patient info */}
          <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Patient</h3>
            {bill.patient && (
              <div>
                <Link href={`/patients/${bill.patient.id}`} className="font-semibold text-primary hover:underline">{bill.patient.firstName} {bill.patient.lastName}</Link>
                <p className="text-xs text-muted-foreground mt-0.5">{bill.patient.patientId}</p>
                <p className="text-xs text-muted-foreground">{bill.patient.phone}</p>
                <p className="text-xs text-muted-foreground">{ageDisplay ? `${ageDisplay} / ${bill.patient.gender}` : bill.patient.gender}</p>
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-border/50">
              <p className="text-xs text-muted-foreground">Status</p>
              <div className="mt-1"><StatusBadge status={bill.status} /></div>
            </div>
            {bill.dueDate && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground">Due Date</p>
                <p className="text-sm font-medium">{bill.dueDate}</p>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Referring Doctor</p>
                <p className="text-sm font-medium">{bill.order?.doctor?.name ?? <span className="text-muted-foreground">—</span>}</p>
              </div>
              <Button size="sm" variant="ghost" className="text-xs h-7 px-2 text-teal-600 hover:text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/30" onClick={() => { setCdDoctorSearch(""); setCdDoctorSearchOpen(false); setCdNote(""); setChangeDoctorOpen(true); }}>
                <Stethoscope size={12} className="mr-1" /> Change
              </Button>
            </div>
          </div>

          {/* Financials */}
          <div className="md:col-span-2 bg-card border border-card-border rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Bill Summary</h3>
            <div className="space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(bill.subtotal)}</span>
              </div>
              {bill.discount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="text-green-600">- {formatCurrency(bill.discount)}</span>
                </div>
              )}
              {bill.taxAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{formatCurrency(bill.taxAmount)}</span>
                </div>
              )}
              {Number((bill as { originalTotal?: number | string }).originalTotal ?? 0) > 0 && Number((bill as { originalTotal?: number | string }).originalTotal ?? 0) !== bill.totalAmount && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Original Bill</span>
                  <span>{formatCurrency(Number((bill as { originalTotal?: number | string }).originalTotal ?? 0))}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold border-t border-border pt-2">
                <span>Total</span>
                <span>{formatCurrency(bill.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                <span>Paid</span>
                <span>- {formatCurrency(bill.paidAmount)}</span>
              </div>
              {Number((bill as { refundAmount?: number | string }).refundAmount ?? 0) > 0 && (
                <div className="flex justify-between text-sm text-orange-600 dark:text-orange-400">
                  <span>Refunded</span>
                  <span>{formatCurrency(Number((bill as { refundAmount?: number | string }).refundAmount ?? 0))}</span>
                </div>
              )}
              {!isCancelled && (
                <div className={`flex justify-between text-base font-bold border-t border-border pt-2 ${bill.balanceAmount > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                  <span>Balance Due</span>
                  <span>{formatCurrency(bill.balanceAmount)}</span>
                </div>
              )}
              {/* Refund Due — patient overpaid after a test was cancelled */}
              {!isCancelled && bill.paidAmount > bill.totalAmount && (
                <div className="mt-2 rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/20 p-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-orange-700 dark:text-orange-400">
                      <AlertCircle size={14} /> Refund Due to Patient
                    </span>
                    <span className="text-sm font-bold text-orange-700 dark:text-orange-400">
                      {formatCurrency(bill.paidAmount - bill.totalAmount)}
                    </span>
                  </div>
                  <p className="text-xs text-orange-600 dark:text-orange-500">
                    A test was cancelled after payment. Refund the overpaid amount to the patient.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/30"
                    onClick={() => {
                      resetRefund({
                        performedBy: defaultActor,
                        reason: "Test cancellation refund",
                        amount: bill.paidAmount - bill.totalAmount,
                        method: "cash",
                      });
                      setRefundTab("refund");
                      setRefundOpen(true);
                    }}
                  >
                    Process Refund — {formatCurrency(bill.paidAmount - bill.totalAmount)}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tests */}
        {bill.order?.tests && bill.order.tests.length > 0 && (
          <TestsTable
            bill={bill as Parameters<typeof TestsTable>[0]["bill"]}
            billId={id}
            onUpdated={() => {
              queryClient.invalidateQueries({ queryKey: getGetBillQueryKey(id) });
              queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
            }}
          />
        )}

        {/* Payments */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Payment History</h2>
            <div className="relative w-56">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                placeholder="Filter payments…"
                className="w-full pl-7 pr-6 h-8 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {paymentFilter && (
                <button
                  onClick={() => setPaymentFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
            {!bill.payments?.length ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No payments recorded yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Method</th>
                    <th className="px-4 py-3 font-medium">Reference</th>
                    <th className="px-4 py-3 font-medium">Recorded By</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(paymentFilter.trim()
                    ? bill.payments.filter((p) =>
                        `${p.method} ${p.referenceNumber ?? ""} ${p.recordedByName ?? ""}`.toLowerCase().includes(paymentFilter.trim().toLowerCase())
                      )
                    : bill.payments
                  ).map((p) => (
                    <tr key={p.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(p.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 capitalize">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded text-xs font-medium">{p.method}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{p.referenceNumber ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{p.recordedByName ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-green-600 dark:text-green-400">{formatCurrency(Number(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {showSuperAdminActions && (
        <div className="border border-rose-200 dark:border-rose-900/50 rounded-xl p-4 bg-rose-50/50 dark:bg-rose-950/20">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert size={15} className="text-rose-600 dark:text-rose-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">Super Admin Actions</span>
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {superAdmin.userName}
              </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Authenticated as <span className="font-semibold">{superAdmin.userName}</span>. These actions are irreversible and fully audited.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30" onClick={openSuperEdit}>
              <Pencil size={13} className="mr-1.5" /> Super Edit Amounts
            </Button>
            <Button size="sm" variant="outline" className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30" onClick={() => { resetDelete(); setDeleteOpen(true); }}>
              <Trash2 size={13} className="mr-1.5" /> Delete Bill
            </Button>
          </div>
        </div>
        )}

        {reprintHistory.length > 0 && (
          <div className="border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 bg-amber-50/40 dark:bg-amber-950/20">
            <div className="flex items-center gap-2 mb-3">
              <Printer size={14} className="text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Reprint History</span>
              <span className="ml-auto text-xs text-muted-foreground">{reprintHistory.length} reprint{reprintHistory.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-1.5">
              {reprintHistory.map((r, i) => (
                <div key={r.id ?? i} className="flex items-start gap-3 text-xs text-muted-foreground">
                  <span className="font-mono shrink-0">{new Date(r.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-foreground font-medium shrink-0">{r.editedBy || "—"}</span>
                  <span className="truncate">{r.reason ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Receipt printing has moved out of the main DOM and into a popup
          window populated with a self-contained HTML string. See
          buildBillPrintHtml + openBillPrintWindow at the top of this file
          and the printCurrentBill() helper inside the component. The old
          in-page hidden-DOM block was deleted because it was the source of
          the "blank page" / "header-only reprint" bugs (the receipt body
          had been removed in a prior cleanup, and the visibility-toggle
          approach also raced React render and image-load timing). */}

      {/* Re-print Dialog */}
      <Dialog open={reprintOpen} onOpenChange={setReprintOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer size={16} /> Re-print Bill — {bill.billNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
              Re-prints are logged in the bill audit trail and a notification email is sent to admin & super-admin recipients.
            </div>
            <div>
              <Label>Your Name *</Label>
              <Input
                value={reprintBy}
                onChange={(e) => setReprintBy(e.target.value)}
                className="mt-1"
                placeholder="e.g., Anita (Reception)"
              />
            </div>
            <div>
              <Label>Reason for Re-print *</Label>
              <select
                value={reprintReason}
                onChange={(e) => setReprintReason(e.target.value)}
                className={`mt-1 w-full h-9 text-sm border rounded-md px-2 bg-white dark:bg-background ${!reprintReason ? "border-red-400 text-red-600" : "border-input"}`}
              >
                <option value="">— Select reason * —</option>
                {reprintReasons.filter((r) => r.isActive).map((r) => (
                  <option key={r.id} value={r.label}>{r.label}</option>
                ))}
              </select>
              <Input
                placeholder="Custom note (optional)…"
                value={reprintNote}
                onChange={(e) => setReprintNote(e.target.value)}
                className="mt-1.5"
                maxLength={200}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Manage this preset list in Settings → Reprint Reasons.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
            Paper: <strong>{resolvedReprintPaper || (paperMode === "manual" ? paperSize : `AUTO (${effectivePaperSize})`)}</strong>
            {paperMode === "manual" ? " (manual)" : " (clinic setting)"} · Change above the Re-print button.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setReprintOpen(false)}>Cancel</Button>
              <Button
                type="button"
                onClick={submitReprint}
                disabled={!reprintBy.trim() || !reprintReason.trim() || reprintLog.isPending}
              >
                {reprintLog.isPending ? "Logging…" : "Log & Print"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add payment dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label>Amount (₹) *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={String(bill.balanceAmount)}
                {...register("amount", { required: true, valueAsNumber: true })}
                className="mt-1"
                placeholder={`Max: ${formatCurrency(bill.balanceAmount)}`}
              />
            </div>
            <div>
              <Label>Payment Method *</Label>
              <Select value={watch("method")} onValueChange={(v) => setValue("method", v as PaymentForm["method"])}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m} className="capitalize">{m.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference Number</Label>
              <Input {...register("referenceNumber")} className="mt-1" placeholder="UPI/Card/Cheque reference" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input {...register("notes")} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createPayment.isPending}>
                {createPayment.isPending ? "Saving..." : "Record Payment"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Bill Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Bill — {bill.billNumber}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onEditSubmit} className="space-y-4">
            <div>
              <Label>Discount (₹)</Label>
              <Input
                type="number"
                min="0"
                max={bill.subtotal}
                step="0.01"
                {...regEdit("discount", { valueAsNumber: true })}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Current: {formatCurrency(bill.discount)}</p>
            </div>
            <div>
              <Label>Bill Status</Label>
              <Select defaultValue={bill.status} onValueChange={(v) => setEditVal("status", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILL_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="border-t border-border pt-4 space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Edit Reason (Required for audit)</p>
              <div>
                <Label>Edited By *</Label>
                <Input {...regEdit("editedBy", { required: true })} className="mt-1" placeholder="Your name or ID" />
              </div>
              <div>
                <Label>Reason for Edit *</Label>
                <Input {...regEdit("reason", { required: true })} className="mt-1" placeholder="e.g., Applied loyalty discount, Status correction" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={updateBill.isPending}>
                {updateBill.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Super Edit Dialog */}
      <Dialog open={superEditOpen} onOpenChange={setSuperEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert size={16} className="text-amber-600" />
              Super Edit — {bill.billNumber}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSuperEditSubmit} className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
              Editing amounts will recalculate the total and balance. All changes are permanently logged.
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Subtotal (₹)</Label>
                <Input type="number" step="0.01" min="0" {...regSuperEdit("subtotal", { valueAsNumber: true })} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-0.5">Was: {formatCurrency(bill.subtotal)}</p>
              </div>
              <div>
                <Label>Discount (₹)</Label>
                <Input type="number" step="0.01" min="0" {...regSuperEdit("discount", { valueAsNumber: true })} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-0.5">Was: {formatCurrency(bill.discount)}</p>
              </div>
              <div>
                <Label>Tax (₹)</Label>
                <Input type="number" step="0.01" min="0" {...regSuperEdit("taxAmount", { valueAsNumber: true })} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-0.5">Was: {formatCurrency(bill.taxAmount)}</p>
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg px-4 py-2 text-sm flex justify-between items-center">
              <span className="text-muted-foreground">New Total</span>
              <span className="font-bold text-base">{formatCurrency(projectedTotal)}</span>
            </div>
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Authorized as <strong>{superAdmin.userName}</strong> via session token
              </div>
              <div>
                <Label>Reason *</Label>
                <Input {...regSuperEdit("reason", { required: true })} className="mt-1" placeholder="e.g., Billing correction — test price error" />
              </div>
            </div>
            {superEditBill.isError && (
              <p className="text-xs text-red-600">{(superEditBill.error as Error)?.message ?? "Authorization failed. Token may have expired."}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setSuperEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={superEditBill.isPending} className="bg-amber-600 hover:bg-amber-700 text-white">
                {superEditBill.isPending ? "Saving…" : "Apply Super Edit"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Bill Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle size={16} /> Delete Bill — {bill.billNumber}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onDeleteSubmit} className="space-y-4">
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-xs text-red-700 dark:text-red-400 space-y-1">
              <p className="font-semibold">This action cannot be undone.</p>
              <p>Deleting this bill will:</p>
              <ul className="list-disc list-inside space-y-0.5 pl-1">
                <li>Permanently remove all payment records</li>
                <li>Reset the linked order status to "pending"</li>
                <li>Renumber subsequent bills in {bill.billNumber.slice(0, 12)}</li>
              </ul>
            </div>
            <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Authorized as <strong>{superAdmin.userName}</strong> via session token
            </div>
            <div>
              <Label>Reason for Deletion *</Label>
              <Input {...regDelete("reason", { required: true })} className="mt-1" placeholder="e.g., Duplicate bill — created in error" />
            </div>
            <div>
              <Label>Type <span className="font-mono font-bold text-red-600">{bill.billNumber}</span> to confirm</Label>
              <Input
                {...regDelete("confirmText", { required: true })}
                className="mt-1 font-mono"
                placeholder={bill.billNumber}
              />
            </div>
            {deleteBill.isError && (
              <p className="text-xs text-red-600">{(deleteBill.error as Error)?.message ?? "Authorization failed. Token may have expired."}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={deleteBill.isPending || confirmVal !== bill.billNumber}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteBill.isPending ? "Deleting…" : "Permanently Delete"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Audit History Dialog */}
      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History size={16} /> Audit Log — {bill.billNumber}
            </DialogTitle>
          </DialogHeader>
          {audits.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <Clock size={32} className="mx-auto mb-2 opacity-30" />
              No audit entries recorded for this bill
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {audits.map(a => (
                <div key={a.id} className="border border-card-border rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
                      a.changeType === "cancelled" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                      a.changeType === "reprint" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                      a.changeType === "refund" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" :
                      a.changeType === "deleted" ? "bg-red-100 text-red-700" :
                      a.changeType === "discount" ? "bg-blue-100 text-blue-700" :
                      a.changeType === "subtotal" || a.changeType === "taxAmount" || a.changeType === "totalAmount" ? "bg-amber-100 text-amber-700" :
                      "bg-orange-100 text-orange-700"
                    }`}>
                      {a.changeType}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="font-medium">{a.editedBy}</p>
                  <p className="text-muted-foreground text-xs">{a.reason}</p>
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className="text-red-500">Before: {a.oldValue ?? "—"}</span>
                    <span className="text-green-600">After: {a.newValue ?? "—"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel / Refund Dialog with three tabs */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 size={16} className="text-orange-600" /> Refund or Cancel Bill
            </DialogTitle>
          </DialogHeader>

          {/* Tab switcher */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            {Number(bill.paidAmount) > 0 && (
              <button
                type="button"
                onClick={() => setRefundTab("cancel-refund")}
                className={`flex-1 text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
                  refundTab === "cancel-refund" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Undo2 size={13} className="inline mr-1" />
                Refund &amp; Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => setRefundTab("refund")}
              disabled={Number(bill.paidAmount) <= 0}
              className={`flex-1 text-sm font-medium px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                refundTab === "refund" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
              title={Number(bill.paidAmount) <= 0 ? "No payments to refund yet" : ""}
            >
              Refund Only
            </button>
            <button
              type="button"
              onClick={() => setRefundTab("cancel")}
              className={`flex-1 text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
                refundTab === "cancel" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Ban size={13} className="inline mr-1" />
              Cancel Only
            </button>
          </div>

          {refundTab === "cancel-refund" ? (
            <form onSubmit={onCancelRefundSubmit} className="space-y-3 mt-2">
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-300 space-y-1">
                <p className="font-semibold">This will issue a refund AND cancel the bill in one step.</p>
                <p>The refund is recorded first, then the bill is marked as cancelled.</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Paid so far</span><span className="font-semibold text-foreground">{formatCurrency(bill.paidAmount)}</span></div>
                {Number((bill as { refundAmount?: number | string }).refundAmount ?? 0) > 0 && (
                  <div className="flex justify-between mt-1"><span>Already refunded</span><span className="font-semibold text-orange-600">{formatCurrency(Number((bill as { refundAmount?: number | string }).refundAmount ?? 0))}</span></div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Refund Amount (₹) <span className="text-red-500">*</span></Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={bill.paidAmount}
                    {...regCR("refundAmount", { required: true, valueAsNumber: true, min: 0.01, max: bill.paidAmount })}
                    className="mt-1"
                  />
                  {crState.errors.refundAmount && (
                    <p className="text-xs text-red-500 mt-1">Required</p>
                  )}
                </div>
                <div>
                  <Label>Refund Via</Label>
                  <Select value={watchCR("refundMethod")} onValueChange={(v) => setCRVal("refundMethod", v as CancelRefundForm["refundMethod"])}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Reason <span className="text-red-500">*</span></Label>
                <textarea
                  rows={3}
                  placeholder="e.g. Test cancelled by patient, sample rejected, duplicate bill…"
                  {...regCR("reason", { required: true, minLength: 3 })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                {crState.errors.reason && (
                  <p className="text-xs text-red-500 mt-1">Please provide a reason (at least 3 characters)</p>
                )}
              </div>
              <div>
                <Label>Performed By <span className="text-red-500">*</span></Label>
                <Input {...regCR("performedBy", { required: true })} className="mt-1" placeholder="Your name" />
              </div>
              {(refundBill.error || cancelBill.error) && (
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5 text-sm text-red-700 dark:text-red-300">
                  {((refundBill.error ?? cancelBill.error) as Error)?.message}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setRefundOpen(false)}>Close</Button>
                <Button
                  type="submit"
                  disabled={refundBill.isPending || cancelBill.isPending}
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
                  {refundBill.isPending ? "Refunding…" : cancelBill.isPending ? "Cancelling…" : "Refund & Cancel"}
                </Button>
              </div>
            </form>
          ) : refundTab === "refund" ? (
            <form onSubmit={onRefundSubmit} className="space-y-3 mt-2">
              <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Paid so far</span><span className="font-semibold text-foreground">{formatCurrency(bill.paidAmount)}</span></div>
                {Number((bill as { refundAmount?: number | string }).refundAmount ?? 0) > 0 && (
                  <div className="flex justify-between mt-1"><span>Already refunded</span><span className="font-semibold text-orange-600">{formatCurrency(Number((bill as { refundAmount?: number | string }).refundAmount ?? 0))}</span></div>
                )}
              </div>
              <div>
                <Label>Refund Amount (₹) <span className="text-red-500">*</span></Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={bill.paidAmount}
                  {...regRefund("amount", { required: true, valueAsNumber: true, min: 0.01, max: bill.paidAmount })}
                  className="mt-1"
                />
                {refundState.errors.amount && (
                  <p className="text-xs text-red-500 mt-1">Enter an amount between ₹0.01 and {formatCurrency(bill.paidAmount)}</p>
                )}
              </div>
              <div>
                <Label>Refund Method</Label>
                <Select value={watchRefund("method")} onValueChange={(v) => setRefundVal("method", v as RefundForm["method"])}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Refund Reason <span className="text-red-500">*</span></Label>
                <textarea
                  rows={3}
                  placeholder="e.g. Test cancelled by patient, duplicate payment, sample rejected…"
                  {...regRefund("reason", { required: true, minLength: 3 })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                {refundState.errors.reason && (
                  <p className="text-xs text-red-500 mt-1">Please provide a clear reason (at least 3 characters)</p>
                )}
              </div>
              <div>
                <Label>Refunded By <span className="text-red-500">*</span></Label>
                <Input value={reprintBy} readOnly tabIndex={-1} className="mt-1 bg-muted/50" />
              </div>
              {refundBill.error && (
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5 text-sm text-red-700 dark:text-red-300">
                  {(refundBill.error as Error).message}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setRefundOpen(false)}>Close</Button>
                <Button type="submit" disabled={refundBill.isPending} className="bg-orange-600 hover:bg-orange-700 text-white">
                  {refundBill.isPending ? "Processing…" : "Issue Refund"}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={onCancelSubmit} className="space-y-3 mt-2">
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3 flex gap-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>
                  Cancelling marks this bill as void. Existing payments stay recorded — use "Refund &amp; Cancel" above if money needs to be returned.
                </span>
              </div>
              <div>
                <Label>Cancellation Reason <span className="text-red-500">*</span></Label>
                <textarea
                  rows={3}
                  placeholder="e.g. Wrong patient, duplicate bill, tests not performed…"
                  {...regCancel("reason", { required: true, minLength: 3 })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                {cancelState.errors.reason && (
                  <p className="text-xs text-red-500 mt-1">Please provide a clear reason (at least 3 characters)</p>
                )}
              </div>
              <div>
                <Label>Cancelled By <span className="text-red-500">*</span></Label>
                <Input value={reprintBy} readOnly tabIndex={-1} className="mt-1 bg-muted/50" />
              </div>
              {cancelBill.error && (
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5 text-sm text-red-700 dark:text-red-300">
                  {(cancelBill.error as Error).message}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setRefundOpen(false)}>Close</Button>
                <Button type="submit" disabled={cancelBill.isPending} className="bg-red-600 hover:bg-red-700 text-white">
                  {cancelBill.isPending ? "Cancelling…" : "Cancel Bill"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Change Referring Doctor dialog */}
      <Dialog open={changeDoctorOpen} onOpenChange={(o) => { if (!o) setChangeDoctorOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-teal-700">
              <Stethoscope size={16} /> Change Referring Doctor
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onChangeDoctorSubmit} className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Current Doctor</p>
              <p className="text-sm font-medium">{bill.order?.doctor?.name ?? "—"}</p>
            </div>
            <div>
              <Label>New Doctor <span className="text-red-500">*</span></Label>
              <div className="relative mt-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search doctor by name or specialization…"
                  value={cdDoctorSearch}
                  onChange={(e) => { setCdDoctorSearch(e.target.value); setCdDoctorSearchOpen(true); }}
                  onFocus={() => setCdDoctorSearchOpen(true)}
                  onBlur={() => setTimeout(() => setCdDoctorSearchOpen(false), 150)}
                  className="pl-9"
                />
                {cdDoctorSearchOpen && (
                  <div className="mt-1 border border-card-border rounded-lg bg-popover shadow-lg max-h-56 overflow-y-auto absolute z-50 w-full">
                    {(() => {
                      const q = cdDoctorSearch.trim().toLowerCase();
                      const filtered = (doctorsResp?.doctors ?? []).filter(d =>
                        !q ||
                        d.name.toLowerCase().includes(q) ||
                        (d.specialization || "").toLowerCase().includes(q)
                      );
                      return (
                        <>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2.5 hover:bg-muted/50 italic border-b border-border flex items-center gap-2"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { setCDVal("newDoctorId", 0); setCdDoctorSearch("Walk-in / Self"); setCdDoctorSearchOpen(false); }}
                          >
                            <div className="w-7 h-7 rounded bg-amber-100 flex items-center justify-center flex-shrink-0">
                              <Stethoscope size={12} className="text-amber-700" />
                            </div>
                            <div className="text-sm font-bold text-amber-700">Walk-in / Self (no referral)</div>
                          </button>
                          {filtered.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-center text-muted-foreground">No doctors found</div>
                          ) : filtered.map(d => (
                            <button
                              key={d.id}
                              type="button"
                              className="w-full text-left px-3 py-2.5 hover:bg-muted/50 flex items-center gap-2"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { setCDVal("newDoctorId", d.id); setCdDoctorSearch(d.name); setCdDoctorSearchOpen(false); }}
                            >
                              <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 font-mono text-[11px] text-primary font-extrabold">#{d.id}</div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold">Dr. {d.name}</div>
                                <div className="text-xs text-muted-foreground">{d.specialization || "N/A"}</div>
                              </div>
                            </button>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
              {cdState.errors.newDoctorId && <p className="text-xs text-red-500 mt-1">Please select a doctor.</p>}
            </div>
            <div>
              <Label>Reason <span className="text-red-500">*</span></Label>
              <select
                {...regCD("reason", { required: true })}
                className={`mt-1 w-full h-9 text-sm border rounded-md px-2 bg-white dark:bg-background ${!watchCD("reason") ? "border-red-400 text-red-600" : "border-input"}`}
              >
                <option value="">— Select reason * —</option>
                {reprintReasons.filter((r) => r.isActive).map((r) => (
                  <option key={r.id} value={r.label}>{r.label}</option>
                ))}
              </select>
              <Input
                placeholder="Custom note (optional)…"
                value={cdNote}
                onChange={(e) => setCdNote(e.target.value)}
                className="mt-1.5"
                maxLength={200}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Manage this preset list in Settings → Edit/Modify/Reprint Reasons.
              </p>
            </div>
            <div>
              <Label>Changed By <span className="text-red-500">*</span></Label>
              <Input
                {...regCD("performedBy", { required: true })}
                className="mt-1"
                placeholder="Staff name"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setChangeDoctorOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={
                  (watchCD("newDoctorId") === undefined || watchCD("newDoctorId") === null) ||
                  !watchCD("reason")?.trim() ||
                  !watchCD("performedBy")?.trim() ||
                  changeDoctor.isPending
                }
              >
                {changeDoctor.isPending ? "Saving…" : "Save Change"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}

// ─── TestsTable (multi-select cancel + refund) ─────────────────────────────

type OrderTest = {
  id: number;
  testId: number;
  price: number;
  displayName?: string | null;
  status?: string | null;
  cancelledAt?: string | null;
  cancelledByName?: string | null;
  cancellationReason?: string | null;
  test?: { code?: string; name?: string; category?: string } | null;
};

type BillForTestsTable = {
  status?: string;
  paidAmount?: number | string;
  order?: { id?: number; tests?: OrderTest[] } | null;
};

function TestsTable({
  bill,
  billId,
  onUpdated,
}: {
  bill: BillForTestsTable;
  billId: number;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const tests = bill.order?.tests ?? [];
  const activeTests = tests.filter((t) => (t.status ?? "active") === "active");
  const isBillCancelled = bill.status === "cancelled";

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [crDialogOpen, setCrDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [crBy, setCrBy] = useState<string>(() => readStaffSession()?.user.name || "");
  const [crMethod, setCrMethod] = useState("cash");

  const selected = activeTests.filter((t) => selectedIds.has(t.id));
  const selectedValue = selected.reduce((s, t) => s + Number(t.price), 0);

  const toggleId = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const cancelRefundTests = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      if (selected.length === 0) throw new Error("No tests selected");
      return api.post(`/api/bills/${billId}/cancel-refund-tests`, {
        orderTestIds: selected.map((t) => t.id),
        reason,
        performedBy: crBy,
        refundMethod: crMethod,
      });
    },
    onSuccess: () => {
      toast({ title: "Tests cancelled", description: `${selected.length} test(s) removed. Bill recalculated.` });
      setCrDialogOpen(false);
      setReason("");
      setSelectedIds(new Set());
      onUpdated();
    },
    onError: (e) => {
      toast({ title: "Failed to cancel tests", description: e.message, variant: "destructive" });
    },
  });

  // Single-test cancel kept for backward compat (per-row XCircle)
  const [singleCancelId, setSingleCancelId] = useState<number | null>(null);
  const [singleReason, setSingleReason] = useState("");
  const [singleBy, setSingleBy] = useState<string>(() => readStaffSession()?.user.name || "");
  // Swap-test dialog state
  const [swapTestOpen, setSwapTestOpen] = useState(false);
  const [swapTestOrderTestId, setSwapTestOrderTestId] = useState<number | null>(null);
  const [swapTestId, setSwapTestId] = useState<string>("");
  const [swapTestReason, setSwapTestReason] = useState("");
  const [swapTestBy, setSwapTestBy] = useState<string>(() => readStaffSession()?.user.name || "");

  const { data: testsData } = useListTests({});

  const cancelSingle = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      if (!singleCancelId) throw new Error("No test selected");
      return api.post(`/api/bills/${billId}/cancel-test`, {
        orderTestId: singleCancelId,
        reason: singleReason,
        performedBy: singleBy,
      });
    },
    onSuccess: () => {
      toast({ title: "Test cancelled", description: "The test has been removed from this bill." });
      setSingleCancelId(null);
      setSingleReason("");
      onUpdated();
    },
    onError: (e) => {
      toast({ title: "Failed to cancel test", description: e.message, variant: "destructive" });
    },
  });

  const swapTest = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      if (!swapTestOrderTestId || !swapTestId) throw new Error("No test selected");
      return api.post(`/api/bills/${billId}/swap-test`, {
        orderTestId: swapTestOrderTestId,
        newTestId: Number(swapTestId),
        reason: swapTestReason,
        performedBy: swapTestBy,
      });
    },
    onSuccess: () => {
      toast({ title: "Test swapped", description: "The test has been replaced and totals recalculated." });
      setSwapTestOpen(false);
      setSwapTestOrderTestId(null);
      setSwapTestId("");
      setSwapTestReason("");
      onUpdated();
    },
    onError: (e) => {
      toast({ title: "Failed to swap test", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Tests Billed</h2>
        {selectedIds.size > 0 && (
          <div className="text-xs text-muted-foreground">
            {selectedIds.size} selected
          </div>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
              {!isBillCancelled && activeTests.length > 1 && (
                <th className="px-3 py-3 w-8" />
              )}
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Test</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium text-right">Price</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium w-10" />
            </tr>
          </thead>
          <tbody>
            {tests.map((ot) => {
              const isCancelled = (ot.status ?? "active") === "cancelled";
              const isSelected = selectedIds.has(ot.id);
              return (
                <tr
                  key={ot.id}
                  className={`border-b border-border/50 last:border-0 ${isCancelled ? "opacity-50" : ""} ${isSelected ? "bg-blue-50/40 dark:bg-blue-950/10" : ""}`}
                >
                  {!isBillCancelled && activeTests.length > 1 && (
                    <td className="px-3 py-3">
                      {!isCancelled && (
                        <button
                          onClick={() => toggleId(ot.id)}
                          className="text-muted-foreground hover:text-primary"
                          title={isSelected ? "Deselect" : "Select"}
                        >
                          {isSelected ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}
                        </button>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 font-mono text-xs font-bold text-primary">{ot.test?.code}</td>
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-1 group">
                      <span>{ot.displayName ?? ot.test?.name ?? "—"}</span>
                      {!isBillCancelled && !isCancelled && (
                        <button
                          title="Swap test"
                          onClick={() => {
                            setSwapTestOrderTestId(ot.id);
                            setSwapTestId("");
                            setSwapTestReason("");
                            setSwapTestOpen(true);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </div>
                    {isCancelled && ot.cancelledByName && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Cancelled by {ot.cancelledByName}
                        {ot.cancellationReason ? ` — ${ot.cancellationReason}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{ot.test?.category}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${isCancelled ? "line-through text-muted-foreground" : ""}`}>
                    ₹{Number(ot.price).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    {isCancelled ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                        Cancelled
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!isCancelled && !isBillCancelled && activeTests.length > 1 && (
                      <button
                        title="Cancel this test"
                        onClick={() => { setSingleCancelId(ot.id); setSingleReason(""); }}
                        className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600"
                      >
                        <XCircle size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Floating action bar for multi-select */}
      {selectedIds.size > 0 && !isBillCancelled && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border shadow-lg rounded-lg px-4 py-3">
          <span className="text-sm font-medium">
            {selectedIds.size} test{selectedIds.size > 1 ? "s" : ""} selected
          </span>
          <span className="text-xs text-muted-foreground">
            Refund ~₹{selectedValue.toFixed(2)}
          </span>
          <div className="w-px h-5 bg-border" />
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5"
            onClick={() => {
              setCrDialogOpen(true);
              setReason("");
            }}
          >
            <RotateCcw size={14} />
            Cancel & Refund
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            <X size={14} className="mr-1" /> Clear
          </Button>
        </div>
      )}

      {/* Multi-test cancel+refund dialog */}
      <Dialog open={crDialogOpen} onOpenChange={setCrDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancel Selected Tests</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Selected tests</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {selected.map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-sm">
                    <span>{t.test?.name}</span>
                    <span className="font-mono font-semibold">₹{Number(t.price).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-sm border-t border-border pt-2 mt-1">
                <span className="text-muted-foreground">Total value to remove</span>
                <span className="font-semibold">₹{selectedValue.toFixed(2)}</span>
              </div>
            </div>

            {selected.length >= activeTests.length && (
              <div className="flex gap-2 items-start rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>Cannot cancel all tests. Use "Cancel Bill" to void the entire bill instead.</span>
              </div>
            )}

            <div>
              <Label>Reason <span className="text-red-500">*</span></Label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Patient refused, sample inadequate, test no longer required…"
                className="mt-1 w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>

            <div>
              <Label>Performed By</Label>
              <Input className="mt-1" value={crBy} onChange={(e) => setCrBy(e.target.value)} />
            </div>

            <div>
              <Label>Refund Method</Label>
              <Select value={crMethod} onValueChange={setCrMethod}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setCrDialogOpen(false)}>Close</Button>
              <Button
                disabled={!reason.trim() || !crBy.trim() || cancelRefundTests.isPending || selected.length >= activeTests.length}
                onClick={() => cancelRefundTests.mutate()}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {cancelRefundTests.isPending ? "Processing…" : "Cancel & Refund"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Single-test cancel dialog (backward compat) */}
      <Dialog open={singleCancelId !== null} onOpenChange={(o) => { if (!o) setSingleCancelId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Test</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <p className="text-sm text-muted-foreground">
              Cancelling this test will remove it from the bill and recalculate the total. The bill stays open for remaining tests.
            </p>
            {activeTests.length <= 1 && (
              <div className="flex gap-2 items-start rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>This is the last active test. Use "Cancel Bill" instead to void the entire bill.</span>
              </div>
            )}
            <div>
              <Label>Reason <span className="text-red-500">*</span></Label>
              <textarea
                rows={2}
                value={singleReason}
                onChange={(e) => setSingleReason(e.target.value)}
                placeholder="e.g. Test not performed, patient refused…"
                className="mt-1 w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
            <div>
              <Label>Cancelled By</Label>
              <Input className="mt-1" value={singleBy} onChange={(e) => setSingleBy(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setSingleCancelId(null)}>Close</Button>
              <Button
                disabled={!singleReason.trim() || !singleBy.trim() || cancelSingle.isPending}
                onClick={() => cancelSingle.mutate()}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {cancelSingle.isPending ? "Cancelling…" : "Cancel Test"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Swap Test dialog */}
      <Dialog open={swapTestOpen} onOpenChange={(o) => { if (!o) setSwapTestOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Swap Test</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <p className="text-sm text-muted-foreground">
              Replace the current test with a different one from the catalog. The bill total, commission, and balance will be recalculated automatically.
            </p>
            <div>
              <Label>New Test <span className="text-red-500">*</span></Label>
              <Select value={swapTestId} onValueChange={setSwapTestId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a test from catalog" />
                </SelectTrigger>
                <SelectContent>
                  {(testsData?.tests ?? []).filter((t: { isActive?: boolean }) => t.isActive !== false).map((t: { id: number; name: string; code?: string | null; price?: number | string | null }) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name} {t.code ? `(${t.code})` : ""} — ₹{Number(t.price ?? 0).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason <span className="text-red-500">*</span></Label>
              <Input
                className="mt-1"
                value={swapTestReason}
                onChange={(e) => setSwapTestReason(e.target.value)}
                placeholder="e.g. Wrong test selected, doctor requested change"
              />
            </div>
            <div>
              <Label>Performed By</Label>
              <Input className="mt-1" value={swapTestBy} onChange={(e) => setSwapTestBy(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setSwapTestOpen(false)}>Close</Button>
              <Button
                disabled={!swapTestId || !swapTestReason.trim() || !swapTestBy.trim() || swapTest.isPending}
                onClick={() => swapTest.mutate()}
              >
                {swapTest.isPending ? "Swapping…" : "Swap Test"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
