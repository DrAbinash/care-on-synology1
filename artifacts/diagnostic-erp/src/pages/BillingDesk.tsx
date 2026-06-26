import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api } from "@/lib/fetchApi";
import { incrementPendingSyncCount } from "@/hooks/useSyncStatus";
import { readStaffSession, isFeatureEnabled } from "@/lib/staffSession";
import { getAutoBillPaperSize, getBillPaperSize } from "@/lib/billPrintLayout";
import {
  buildBillPrintHtml,
  printViaIframe,
  type PrintBillData,
  type PrintClinic,
} from "@/lib/printBill";
import {
  loadBillPrintSettings,
  type BillPrintSettings,
} from "@/lib/billPrintSettings";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  User,
  UserPlus,
  FlaskConical,
  Receipt,
  Stethoscope,
  X,
  Plus,
  CheckCircle2,
  Percent,
  IndianRupee,
  CalendarDays,
  Hash,
  Package,
  Zap,
  Phone,
  RefreshCcw,
  Star,
  Printer,
  ExternalLink,
  AlertTriangle,
  Pencil,
  Check,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────
type Patient = {
  id: number;
  patientId: string;
  firstName: string;
  lastName: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  email?: string;
  bloodGroup?: string;
  address?: string;
  ageValue?: number | null;
  ageUnit?: string | null;
};

type Doctor = { id: number; name: string; specialization: string; billCount?: number };
type Test   = { id: number; name: string; code: string; price: number; category: string; isActive?: boolean; testType?: string | null; outsourcedLabId?: number | null };
// Tests embedded in a package carry their per-package discount overrides.
type PkgTest = Test & { discountPct?: number; discountAmount?: number };
type Pkg    = { id: number; packageCode: string; name: string; price: number; discountPct: number; discountAmount?: number; isActive?: boolean; tests: PkgTest[] };

type SelectedTest = { testId: number; name: string; code: string; price: number; category: string; source: "test" | "package" };
type SelectedPackage = { packageId: number; name: string; testIds: number[] };
type PaySplit = { mode: string; amount: string };
type LastBill = {
  id: number;
  billNumber: string;
  patient: Patient;
  doctorName: string | null;
  tests: SelectedTest[];
  subtotal: number;
  discount: number;
  total: number;
  payments: PaySplit[];
  tokenNo?: number | null;
  tokenDate?: string | null;
  // Per-department queue tokens issued by the bill creation flow. Populated
  // by the /api/bills POST response; rendered on the separate token printer
  // (see printToken below).
  testTokens?: Array<{ orderTestId: number; testName: string; department: string; roomNumber: string; floorLabel: string; tokenNo: number }>;
};

// ──────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────
const PAYMENT_MODES  = ["cash", "card", "upi", "cheque", "insurance", "online"];
const BLOOD_GROUPS   = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const GENDERS        = ["male", "female", "other"];

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const today = () => new Date().toLocaleDateString("en-IN", {
  weekday: "short", year: "numeric", month: "short", day: "numeric",
});

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ──────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────
type ClinicLite = { name?: string; tagline?: string; address?: string; phone?: string; logoDataUrl?: string | null; footerNote?: string } | undefined;
type PrinterCfg = { billPrinter?: string; barcodePrinter?: string; barcodeEnabled?: string; tokenPrinter?: string; tokenEnabled?: string };

function openPrintWindow(html: string) {
  const w = window.open("", "_blank", "width=420,height=600");
  if (!w) {
    alert("Pop-up blocked. Please allow pop-ups for this site to print.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Defer print so resources (images / fonts) load first
  w.onload = () => {
    w.focus();
    w.print();
    setTimeout(() => w.close(), 400);
  };
}

function buildBillVerifyUrl(billNumber: string) {
  // Points at the public api-server endpoint so the QR works in both dev
  // (where /api is proxied) and production (single-process unified serve).
  return `${window.location.origin}/api/verify/bill/${encodeURIComponent(billNumber)}`;
}

// Lightweight placeholder used as a fallback before the async QR has been
// generated. The real scannable QR is produced via the `qrcode` library in
// the BillingDesk component below and stored in state.
function qrSvgDataUrl(text: string) {
  const safe = escapeHtml(text);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" fill="#fff"/><rect x="12" y="12" width="156" height="156" rx="8" fill="none" stroke="#111" stroke-width="4"/><text x="90" y="88" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#111">VERIFY</text><text x="90" y="112" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="#444">${safe}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

async function getPrinterSettings(): Promise<PrinterCfg> {
  try {
    return await api.get<PrinterCfg>("/api/printers/settings");
  } catch {
    return {};
  }
}

function printerWindowFeatures(printerName?: string) {
  const name = (printerName || "").trim();
  return name ? `width=420,height=600,noopener,noreferrer` : "width=420,height=600,noopener,noreferrer";
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function calcAge(dateOfBirth: string, ageValue?: number | null, ageUnit?: string | null): string {
  if (ageValue != null && ageUnit) {
    if (ageUnit === "years") return ageValue > 0 ? `${ageValue} Yrs` : "";
    if (ageUnit === "months") return `${ageValue} Mo`;
    if (ageUnit === "days") return `${ageValue} D`;
  }
  if (!dateOfBirth) return "";
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return "";
  const now = new Date();
  let y = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) y--;
  return y > 0 ? `${y} Yrs` : "";
}

// NOTE: BillingDesk no longer has its own printBill() inline template.
// Save-and-print now uses the shared buildBillPrintHtml() from
// src/lib/printBill.ts (same as BillDetail re-print) so QR, copies,
// A4/A5 auto-size, B&W, cancelled tests, and all layout fixes are
// consistent across both print surfaces.

function code128SVG(value: string): string {
  // Lightweight inline barcode renderer (Code 128 B subset, digits + uppercase + symbols).
  // For production accuracy use a library; this gives a scan-friendly visual barcode.
  const PATTERNS: string[] = ["11011001100","11001101100","11001100110","10010011000","10010001100","10001001100","10011001000","10011000100","10001100100","11001001000","11001000100","11000100100","10110011100","10011011100","10011001110","10111001100","10011101100","10011100110","11001110010","11001011100","11001001110","11011100100","11001110100","11101101110","11101001100","11100101100","11100100110","11101100100","11100110100","11100110010","11011011000","11011000110","11000110110","10100011000","10001011000","10001000110","10110001000","10001101000","10001100010","11010001000","11000101000","11000100010","10110111000","10110001110","10001101110","10111011000","10111000110","10001110110","11101110110","11010001110","11000101110","11011101000","11011100010","11011101110","11101011000","11101000110","11100010110","11101101000","11101100010","11100011010","11101111010","11001000010","11110001010","10100110000","10100001100","10010110000","10010000110","10000101100","10000100110","10110010000","10110000100","10011010000","10011000010","10000110100","10000110010","11000010010","11001010000","11110111010","11000010100","10001111010","10100111100","10010111100","10010011110","10111100100","10011110100","10011110010","11110100100","11110010100","11110010010","11011011110","11011110110","11110110110","10101111000","10100011110","10001011110","10111101000","10111100010","11110101000","11110100010","10111011110","10111101110","11101011110","11110101110","11010000100","11010010000","11010011100","1100011101011"];
  // 0..127 chars: ASCII offset 32 → index 0
  const data: number[] = [];
  for (const ch of value) data.push(Math.max(0, Math.min(94, ch.charCodeAt(0) - 32)));
  let checksum = 104; // START B
  data.forEach((c, i) => { checksum += c * (i + 1); });
  checksum = checksum % 103;
  const codes = [104, ...data, checksum, 106]; // START B + data + checksum + STOP
  let bars = "";
  let x = 0;
  const W = 1.6, H = 50;
  for (const code of codes) {
    const pat = PATTERNS[code];
    for (let i = 0; i < pat.length; i++) {
      if (pat[i] === "1") bars += `<rect x="${x.toFixed(2)}" y="0" width="${W}" height="${H}" fill="#000"/>`;
      x += W;
    }
  }
  const totalW = x;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${H}" width="${totalW}" height="${H}">${bars}</svg>`;
}

async function printBarcode(b: LastBill) {
  const p = await getPrinterSettings();
  if (p.barcodeEnabled === "false") return;
  const value = b.billNumber;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Barcode ${escapeHtml(value)}</title>
    <style>
      @page { size: 70mm 30mm; margin: 2mm; }
      body { font-family: Arial, sans-serif; margin:0; padding:4px; text-align:center; }
      .wrap { display:flex; flex-direction:column; align-items:center; gap:2px; }
      .name { font-size:11px; font-weight:600; }
      .meta { font-size:9px; color:#333; }
      svg { max-width:100%; height:auto; }
    </style></head><body>
    <div class="wrap">
      <div class="name">${escapeHtml(b.patient.firstName)} ${escapeHtml(b.patient.lastName)}</div>
      ${code128SVG(value)}
      <div style="font-family:monospace;font-size:10px;letter-spacing:1px">${escapeHtml(value)}</div>
      <div class="meta">${escapeHtml(b.patient.patientId)} · ${new Date().toLocaleDateString("en-IN")}</div>
    </div>
  </body></html>`;
  const w = window.open("", "_blank", printerWindowFeatures(p.barcodePrinter));
  if (!w) return openPrintWindow(html);
  w.document.open(); w.document.write(html); w.document.close(); w.onload = () => { w.focus(); w.print(); setTimeout(() => w.close(), 400); };
}

// Render the per-department queue token slip on the configured Token Printer.
// One combined slip lists every department the patient needs to visit, with
// the token number and the room/counter for each. Falls back to the legacy
// single-token layout when only `tokenNo` is present (back-compat for bills
// generated before the per-test token rollout).
async function printToken(b: LastBill, clinic: ClinicLite) {
  const p = await getPrinterSettings();
  if (p.tokenEnabled === "false") return;
  // Group testTokens by (department, roomNumber, tokenNo) — we don't need to
  // print the same dept token twice when a bill has two pathology tests that
  // share one department-level token... wait, current generator emits one
  // token PER orderTest. Until the per-department mode lands we de-dupe by
  // department here so the slip stays compact.
  const seen = new Set<string>();
  const dedupedTokens = (b.testTokens ?? []).filter((t) => {
    const key = `${t.department}::${t.tokenNo}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Nothing to print
  if (dedupedTokens.length === 0 && b.tokenNo == null) return;

  const ageStr = calcAge(b.patient.dateOfBirth, b.patient.ageValue, b.patient.ageUnit);
  const ageGender = [ageStr, b.patient.gender].filter(Boolean).join(" / ").toUpperCase();
  const headerLines = `
    <div class="clinic">${escapeHtml(clinic?.name || "Diagnostic Centre")}</div>
    <div class="patient"><strong>${escapeHtml(b.patient.firstName)} ${escapeHtml(b.patient.lastName)}</strong>${ageGender ? ` &middot; ${escapeHtml(ageGender)}` : ""}</div>
    <div class="meta">ID: ${escapeHtml(b.patient.patientId)} &middot; Bill: ${escapeHtml(String(b.billNumber).replace(/^BILL-?/i, "").replace(/-/g, ""))}</div>
    ${b.doctorName ? `<div class="meta">Ref: Dr. ${escapeHtml(b.doctorName)}</div>` : ""}
    <div class="meta">${new Date().toLocaleString("en-IN")}</div>`;

  let body = "";
  if (dedupedTokens.length > 0) {
    // Combined per-department slip
    const rows = dedupedTokens.map((t) => `
      <tr>
        <td class="dept">${escapeHtml(t.department)}</td>
        <td class="num">#${String(t.tokenNo).padStart(3, "0")}</td>
        <td class="room">${t.roomNumber ? `Room ${escapeHtml(t.roomNumber)}${t.floorLabel ? `<br><span style="font-size:9px;color:#666;font-weight:400">${escapeHtml(t.floorLabel)}</span>` : ""}` : "—"}</td>
      </tr>`).join("");
    body = `
      <div class="title">QUEUE TOKENS</div>
      <table class="tokens"><tbody>${rows}</tbody></table>
      <div class="hint">Please proceed to the indicated room and wait for your number to be called.</div>`;
  } else if (b.tokenNo != null) {
    // Legacy single-number fallback
    body = `
      <div class="title">QUEUE TOKEN</div>
      <div class="bignum">${String(b.tokenNo).padStart(3, "0")}</div>
      <div class="hint">Please wait for your token to be called.</div>`;
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Token Slip — ${escapeHtml(b.billNumber)}</title>
    <style>
      @page { size: 80mm auto; margin: 4mm; }
      body { font-family: Arial, sans-serif; margin:0; padding:6px; text-align:center; color:#000; font-size:11px; }
      .clinic { font-size:13px; font-weight:800; border-bottom:1px dashed #000; padding-bottom:4px; margin-bottom:5px; }
      .patient { font-size:12px; margin:1px 0; }
      .meta { font-size:10px; color:#444; margin:1px 0; }
      .title { margin-top:8px; font-size:10px; letter-spacing:2px; color:#444; }
      .bignum { font-size:64px; font-weight:900; line-height:1; margin:4px 0; }
      table.tokens { width:100%; border-collapse:collapse; margin-top:6px; }
      table.tokens td { padding:4px 2px; border-bottom:1px dashed #ccc; vertical-align:middle; }
      table.tokens td.dept { text-align:left; font-weight:700; font-size:11px; text-transform:uppercase; }
      table.tokens td.num  { text-align:center; font-weight:900; font-size:18px; letter-spacing:1px; white-space:nowrap; }
      table.tokens td.room { text-align:right; font-size:10px; color:#1e40af; font-weight:700; white-space:nowrap; }
      .hint { margin-top:6px; padding-top:4px; border-top:1px dashed #000; font-size:9px; color:#555; }
    </style></head><body>
    ${headerLines}
    ${body}
  </body></html>`;
  const w = window.open("", "_blank", printerWindowFeatures(p.tokenPrinter));
  if (!w) return openPrintWindow(html);
  w.document.open(); w.document.write(html); w.document.close(); w.onload = () => { w.focus(); w.print(); setTimeout(() => w.close(), 400); };
}

// NOTE: The standalone "QR Bill" print path was removed in May 2026. The QR
// code is now embedded directly in the standard receipt template below
// (gated by the `qrOnBillEnabled` clinic setting). The `qrSvgDataUrl` and
// `buildBillVerifyUrl` helpers above are still used inline by that template.

export default function BillingDesk() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // ── Patient state ──────────────────────────────────
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [newPatient, setNewPatient] = useState({
    firstName: "", lastName: "", phone: "", gender: "male",
    ageValue: "", ageUnit: "years" as "years" | "months" | "days",
    email: "", address: "", bloodGroup: "",
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef  = useRef<HTMLDivElement>(null);
  const paymentRef = useRef<HTMLDivElement>(null);

  // ── Doctor search state ─────────────────────────────
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [doctorMode, setDoctorMode] = useState<"self" | "doctor">("doctor");
  const [doctorSearch, setDoctorSearch] = useState("");
  const [doctorSearchOpen, setDoctorSearchOpen] = useState(false);
  const doctorRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState("");

  // ── New patient form visibility ──────────────────────
  // ── Layout mode (unified / stepped) ─────────────────
  const [layoutMode, setLayoutMode] = useState<"unified" | "stepped" | "compact">(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("billingDeskLayout") : null;
    return (stored as "unified" | "stepped" | "compact") || "unified";
  });
  useEffect(() => {
    const handler = () => {
      const stored = typeof window !== "undefined" ? localStorage.getItem("billingDeskLayout") : null;
      setLayoutMode((stored as "unified" | "stepped" | "compact") || "unified");
    };
    window.addEventListener("storage", handler);
    window.addEventListener("billingDeskLayoutChanged", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("billingDeskLayoutChanged", handler);
    };
  }, []);
  const isStepped = layoutMode === "stepped";
  const isCompact = layoutMode === "compact";
  const autoAdvance = isStepped && isFeatureEnabled("billingDeskAutoAdvance");
  const showQuickTestsSetting = isFeatureEnabled("billingDeskQuickTests") !== false;
  const showPackagesSetting = isFeatureEnabled("billingDeskShowPackages") !== false;
  const [currentStep, setCurrentStep] = useState(1);
  const [stepCompleted, setStepCompleted] = useState<Set<number>>(new Set());
  const stepContentRef = useRef<HTMLDivElement>(null);

  const advanceStep = useCallback(() => {
    if (isStepped && autoAdvance && currentStep < 4) {
      window.setTimeout(() => {
        setStepCompleted((prev) => new Set([...prev, currentStep]));
        setCurrentStep((prev) => prev + 1);
        window.setTimeout(() => stepContentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }, 300);
    }
  }, [isStepped, autoAdvance, currentStep]);

  const goToStep = (step: number) => {
    if (step <= currentStep || stepCompleted.has(step - 1)) {
      setCurrentStep(step);
      window.setTimeout(() => stepContentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  };

  const stepperActive = (step: number) => step === currentStep;
  const stepperDone   = (step: number) => stepCompleted.has(step);

  // ── Test selection ─────────────────────────────────
  const [testSearch, setTestSearch]   = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedTests, setSelectedTests] = useState<SelectedTest[]>([]);
  const [selectedPackages, setSelectedPackages] = useState<SelectedPackage[]>([]);
  const [packageSearch, setPackageSearch] = useState("");
  const [pinnedTestIds, setPinnedTestIds] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("billingDesk:pinnedTests");
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });
  const [pinnedDoctorIds, setPinnedDoctorIds] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("billingDesk:pinnedDoctors");
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });

  function togglePin(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    setPinnedTestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("billingDesk:pinnedTests", JSON.stringify([...next]));
      return next;
    });
  }
  function toggleDoctorPin(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    setPinnedDoctorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("billingDesk:pinnedDoctors", JSON.stringify([...next]));
      return next;
    });
  }

  // ── Billing ────────────────────────────────────────
  const [discountType, setDiscountType]   = useState<"amount" | "pct">("amount");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [discountReason, setDiscountReason] = useState<string>("");
  const [discountNote, setDiscountNote]     = useState<string>("");
  const [payNow, setPayNow]               = useState(true);
  const [isVipActive, setIsVipActive]     = useState(false);
  const [paymentSplits, setPaymentSplits] = useState<PaySplit[]>([{ mode: "cash", amount: "" }]);
  const [lastBill, setLastBill]           = useState<LastBill | null>(null);
  // Real scannable QR (PNG data URL) generated via the qrcode library
  // whenever a new bill is saved. Falls back to the placeholder SVG until
  // the async generation finishes — the print fires ~500ms later so the
  // real QR is virtually always ready before window.print().
  const [billQrDataUrl, setBillQrDataUrl] = useState<string>("");
  useEffect(() => {
    if (!lastBill) { setBillQrDataUrl(""); return; }
    let cancelled = false;
    QRCode.toDataURL(buildBillVerifyUrl(lastBill.billNumber), {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => { if (!cancelled) setBillQrDataUrl(url); })
      .catch(() => { if (!cancelled) setBillQrDataUrl(""); });
    return () => { cancelled = true; };
  }, [lastBill]);
  const [showBillToast, setShowBillToast] = useState(false);
  const [suggLoading, setSuggLoading]     = useState(false);
  const [suggestion, setSuggestion]       = useState<{ discount: number; rule: { name: string } | null } | null>(null);

  // ── Preview bill number ─────────────────────────────
  const { data: previewBillNo } = useQuery<{ next: string; ledgerId?: number }>({
    queryKey: ["bill-preview-no", doctorId],
    queryFn: () => api.get(doctorId ? `/api/bills/preview-number?doctorId=${doctorId}` : "/api/bills/preview-number"),
    retry: false,
  });
  const dummyBillPreview = {
    billNumber: "2026050001",
    patientName: "Dummy Patient",
    tests: [
      { name: "CBC", price: 350 },
      { name: "Blood Sugar", price: 180 },
      { name: "Lipid Profile", price: 620 },
    ],
    total: 1150,
  };

  // ── Data queries ────────────────────────────────────
  const debouncedSearch = useDebounce(patientSearch, 150);

  // Recent patients — loaded once, refreshed only on mount
  const { data: recentPatients } = useQuery<{ patients: Patient[] }>({
    queryKey: ["patients-recent"],
    queryFn: () => api.get<{ patients: Patient[] }>("/api/patients?limit=8&page=1"),
    staleTime: 10 * 60_000,  // 10 min
  });

  // Live search — event-driven, short stale is fine
  const { data: searchResults } = useQuery<{ patients: Patient[] }>({
    queryKey: ["patients-search", debouncedSearch],
    queryFn: () => api.get<{ patients: Patient[] }>(`/api/patients?search=${encodeURIComponent(debouncedSearch)}&limit=10`),
    enabled: debouncedSearch.length >= 1,
    staleTime: 30_000,
  });

  // Which list to show in the dropdown
  const patientResults = debouncedSearch.length >= 1 ? searchResults : recentPatients;

  // Static data — never auto-refresh during a billing session
  const { data: allTests = [] } = useQuery<Test[]>({
    queryKey: ["tests-all-popular"],
    queryFn: () => api.get<{ tests: Test[] }>("/api/tests?limit=500&sort=popular").then((d) => d.tests ?? []),
    staleTime: Infinity,
  });

  const { data: clinic } = useQuery<{
    name: string; tagline: string; address: string; email: string; phone: string;
    website: string; gstin: string; logoDataUrl: string | null; footerNote?: string;
    formFTestIds?: string;
    formFBillingPrompt?: boolean;
    formFAddressRequired?: boolean;
    formFGuardianRequired?: boolean;
    dicomMwlTestIds?: string;
    dicomMwlTestDefaults?: string;
    quickTestIds?: string;
    billPrintCopies?: number;
    qrOnBillEnabled?: boolean;
    billShowCode?: boolean;
    billShowCategory?: boolean;
  }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
  });

  // ── Form F ─────────────────────────────────────────
  const formFTestIdSet: Set<number> = (() => {
    try { return new Set(JSON.parse(clinic?.formFTestIds ?? "[]") as number[]); }
    catch { return new Set(); }
  })();
  const needsFormF = selectedTests.some((t) => formFTestIdSet.has(t.testId));
  const [husbandName, setHusbandName] = useState("");
  const [patientAddress, setPatientAddress] = useState("");

  // ── Form F billing popup (Feature 1) ──
  const [formFPopupOpen, setFormFPopupOpen] = useState(false);
  const [formFPopupBillNumber, setFormFPopupBillNumber] = useState("");
  const [formFPopupHusband, setFormFPopupHusband] = useState("");
  const [formFPopupAddress, setFormFPopupAddress] = useState("");
  const formFPopupPendingPrintRef = useRef(false);

  // ── Print preview dialog ──
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printPreviewHtml, setPrintPreviewHtml] = useState("");

  // ── Gateway Payment Dialog ──
  const [gatewayModalOpen, setGatewayModalOpen] = useState(false);
  const [gatewayPaymentInfo, setGatewayPaymentInfo] = useState<{
    txnRef: string;
    amount: number;
    redirectUrl: string;
    tranCtx?: string;
    expiryTime?: string;
    billId: number;
  } | null>(null);
  const [gatewayPaymentStatus, setGatewayPaymentStatus] = useState<"pending" | "success" | "failed" | "expired">("pending");
  const [gatewayPaymentError, setGatewayPaymentError] = useState("");
  const [expiryMinutes, setExpiryMinutes] = useState(30);
  const [gatewayQrUrl, setGatewayQrUrl] = useState("");

  useEffect(() => {
    if (!gatewayPaymentInfo) { setGatewayQrUrl(""); return; }
    let cancelled = false;
    const qrData = gatewayPaymentInfo.tranCtx || gatewayPaymentInfo.redirectUrl;
    QRCode.toDataURL(qrData, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => { if (!cancelled) setGatewayQrUrl(url); })
      .catch(() => { if (!cancelled) setGatewayQrUrl(""); });
    return () => { cancelled = true; };
  }, [gatewayPaymentInfo]);

  useEffect(() => {
    if (!gatewayModalOpen || !gatewayPaymentInfo || gatewayPaymentStatus !== "pending") return;

    let timer: number;
    const poll = async () => {
      try {
        const res = await api.get<{ status: "pending" | "success" | "failed" | "expired", error?: string }>(
          `/api/bills/gateway-payment-status/${encodeURIComponent(gatewayPaymentInfo.txnRef)}`
        );
        if (res.status === "success") {
          setGatewayPaymentStatus("success");
          toast({ title: "Payment Successful!", description: "Gateway payment received successfully." });
          window.setTimeout(async () => {
            setGatewayModalOpen(false);
            
            // Re-fetch bill to print the updated bill with successful gateway payment
            try {
              const updatedBill = await api.get<any>(`/api/bills/${gatewayPaymentInfo.billId}`);
              const paid = updatedBill.payments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
              const billForPrint: PrintBillData = {
                billNumber: updatedBill.billNumber,
                subtotal: Number(updatedBill.subtotal),
                discount: Number(updatedBill.discount),
                taxAmount: Number(updatedBill.taxAmount),
                totalAmount: Number(updatedBill.totalAmount),
                paidAmount: paid,
                balanceAmount: Math.max(0, Number(updatedBill.totalAmount) - paid),
                createdAt: updatedBill.createdAt,
                patient: {
                  firstName: updatedBill.patient.firstName,
                  lastName: updatedBill.patient.lastName,
                  patientId: updatedBill.patient.patientId,
                  phone: updatedBill.patient.phone ?? null,
                  gender: updatedBill.patient.gender ?? null,
                  dateOfBirth: updatedBill.patient.dateOfBirth ?? null,
                },
                order: {
                  doctor: updatedBill.order?.doctor ? { name: updatedBill.order.doctor.name } : null,
                  tests: updatedBill.order?.tests?.map((t: any) => ({
                    price: t.price,
                    status: t.status || "active",
                    test: t.test ? { name: t.test.name, code: t.test.code ?? "", category: t.test.category } : { name: t.displayName || "Test", code: "", category: "" },
                  })) || [],
                },
                payments: updatedBill.payments.map((p: any) => ({
                  method: p.method,
                  amount: Number(p.amount || 0),
                })),
                tokenNo: lastBillLocalRef.current?.tokenNo ?? null,
                testTokens: lastBillLocalRef.current?.testTokens ?? null,
              };

              const settings = loadBillPrintSettings();
              const cachedClinic = queryClient.getQueryData<PrintClinic>(["clinic-settings"]) || (clinic as PrintClinic);
              const cachedPrinter = printerCfgCached ?? queryClient.getQueryData<PrinterCfg>(["printer-settings"]);
              const isBW = (cachedPrinter as { billPrinterType?: string } | undefined)?.billPrinterType === "bw";
              
              QRCode.toDataURL(buildBillVerifyUrl(updatedBill.billNumber), {
                errorCorrectionLevel: "M",
                margin: 1,
                width: 256,
                color: { dark: "#000000", light: "#ffffff" },
              })
                .catch(() => "")
                .then((qrUrl) => {
                  const paperSize = getAutoBillPaperSize(updatedBill.order?.tests?.length || 1, getBillPaperSize());
                  const html = buildBillPrintHtml({
                    bill: billForPrint,
                    clinic: cachedClinic,
                    paperSize,
                    isBW,
                    qrDataUrl: qrUrl as string,
                    format: settings.defaultFormat,
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
                  });
                  if (settings.enablePreview) {
                    setPrintPreviewHtml(html);
                    setPrintPreviewOpen(true);
                  } else if (settings.directPrintAfterSave || settings.autoOpenPrintDialog) {
                    printViaIframe(html);
                  }
                  if ((lastBillLocalRef.current?.testTokens?.length ?? 0) > 0 || lastBillLocalRef.current?.tokenNo != null) {
                    window.setTimeout(() => {
                      if (lastBillLocalRef.current) {
                        void printToken(lastBillLocalRef.current, cachedClinic as ClinicLite).catch(() => {});
                      }
                    }, 600);
                  }
                });
            } catch (e) {
              console.error("Failed to print updated bill:", e);
            }

            resetAll();
          }, 2000);
        } else if (res.status === "failed") {
          setGatewayPaymentStatus("failed");
          setGatewayPaymentError(res.error || "Payment failed");
        } else if (res.status === "expired") {
          setGatewayPaymentStatus("expired");
        } else {
          timer = window.setTimeout(poll, 3000);
        }
      } catch (err: any) {
        timer = window.setTimeout(poll, 5000);
      }
    };

    timer = window.setTimeout(poll, 3000);
    return () => clearTimeout(timer);
  }, [gatewayModalOpen, gatewayPaymentInfo, gatewayPaymentStatus]);

  const lastBillLocalRef = useRef<LastBill | null>(null);

  // ── DICOM MWL fields (triggered by configured tests) ───────────────
  const dicomMwlTestIdSet: Set<number> = (() => {
    try { return new Set(JSON.parse(clinic?.dicomMwlTestIds ?? "[]") as number[]); }
    catch { return new Set(); }
  })();
  const dicomMwlTestDefaults: Record<string, { bodyPart: string; stationAE: string }> = (() => {
    try { const d = JSON.parse(clinic?.dicomMwlTestDefaults ?? "{}"); return typeof d === "object" && d !== null ? d : {}; }
    catch { return {}; }
  })();
  const needsDicom = dicomMwlTestIdSet.size > 0 && selectedTests.some((t) => dicomMwlTestIdSet.has(t.testId));
  const [dicomStudyDesc, setDicomStudyDesc] = useState("");
  const [dicomBodyPart, setDicomBodyPart] = useState("");
  const [dicomStationAE, setDicomStationAE] = useState("");
  const [dicomReferringDoc, setDicomReferringDoc] = useState("");
  const dicomFieldsComplete = dicomStudyDesc.trim() !== "" && dicomBodyPart.trim() !== "" && dicomStationAE.trim() !== "" && dicomReferringDoc.trim() !== "";

  // Auto-fill DICOM fields from per-test defaults and bill data whenever the
  // basket or selected doctor changes. Only overwrites empty fields so manual
  // edits are preserved.
  useEffect(() => {
    if (!needsDicom) return;
    const firstDicomTest = selectedTests.find((t) => dicomMwlTestIdSet.has(t.testId));
    if (!firstDicomTest) return;
    const def = dicomMwlTestDefaults[String(firstDicomTest.testId)];
    // Study Description: auto-fill from test name
    setDicomStudyDesc((prev) => prev.trim() ? prev : firstDicomTest.name);
    // Body Part: fill from per-test default
    if (def?.bodyPart) setDicomBodyPart((prev) => prev.trim() ? prev : def.bodyPart);
    // Station AE: fill from per-test default
    if (def?.stationAE) setDicomStationAE((prev) => prev.trim() ? prev : def.stationAE);
    // Referring Doctor: fill from the doctor selected on the bill
    const selectedDoctor = doctors.find((d) => d.id === doctorId);
    if (selectedDoctor) setDicomReferringDoc((prev) => prev.trim() ? prev : selectedDoctor.name);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsDicom, selectedTests.map((t) => t.testId).join(","), doctorId]);


  // ── Quick Test Tabs (6 customizable slots) ─────────
  const quickTestIds: (number | null)[] = useMemo(() => {
    try {
      const arr = JSON.parse(clinic?.quickTestIds ?? "[null,null,null,null,null,null]");
      const out: (number | null)[] = Array.isArray(arr)
        ? arr.slice(0, 6).map((v: unknown) => (typeof v === "number" ? v : null))
        : [];
      while (out.length < 6) out.push(null);
      return out;
    } catch { return [null, null, null, null, null, null]; }
  }, [clinic?.quickTestIds]);
  const [quickPickerSlot, setQuickPickerSlot] = useState<number | null>(null);
  const [quickPickerSearch, setQuickPickerSearch] = useState("");

  // ── Quick Doctor Slots (6 slots stored in localStorage) ────────────
  const [quickDoctorIds, setQuickDoctorIds] = useState<(number | null)[]>(() => {
    try {
      const stored = localStorage.getItem("billingDesk:quickDoctors");
      const arr = stored ? JSON.parse(stored) : [null, null, null, null, null, null];
      const out: (number | null)[] = Array.isArray(arr)
        ? arr.slice(0, 6).map((v: unknown) => (typeof v === "number" ? v : null))
        : [];
      while (out.length < 6) out.push(null);
      return out;
    } catch { return [null, null, null, null, null, null]; }
  });
  const [quickDoctorPickerSlot, setQuickDoctorPickerSlot] = useState<number | null>(null);
  const [quickDoctorPickerSearch, setQuickDoctorPickerSearch] = useState("");

  const { data: doctors = [] } = useQuery<Doctor[]>({
    queryKey: ["doctors-list"],
    queryFn: () => api.get<{ doctors: Doctor[] }>("/api/doctors").then((d) => d.doctors ?? []),
    staleTime: Infinity,
  });

  const { data: discountReasons = [] } = useQuery<{ id: number; label: string; isActive: boolean }[]>({
    queryKey: ["discount-reasons"],
    queryFn: () => api.get("/api/discount-reasons"),
  });

  const { data: packages = [] } = useQuery<Pkg[]>({
    queryKey: ["packages-active"],
    queryFn: () => api.get<Pkg[]>("/api/packages"),
    staleTime: Infinity,
    select: (d) => d.filter((p) => p.isActive !== false),
  });

  // ── Duplicate-bill detection: reuse the today-collections cache ───────────
  // toLocaleDateString('en-CA') gives ISO-like format in local timezone
  const todayIsoB = new Date().toLocaleDateString("en-CA");
  const { data: todayBillsData } = useQuery<{ bills: RecentBill[] }>({
    queryKey: ["today-collections-panel", todayIsoB],
    queryFn: () => api.get<{ bills: RecentBill[] }>(`/api/bills?dateFrom=${todayIsoB}&dateTo=${todayIsoB}&excludeCancelled=true&limit=100&page=1`),
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
  const recentPatientBill = !lastBill && selectedPatient
    ? (todayBillsData?.bills ?? []).find(
        (b) =>
          b.patient?.patientId === selectedPatient.patientId &&
          b.status !== "cancelled",
      ) ?? null
    : null;

  // ── Create mutations ───────────────────────────────
  const createPatientMut = useMutation({
    mutationFn: (body: typeof newPatient) => {
      const ageVal = Number(body.ageValue);
      const unit = body.ageUnit;
      let dateOfBirth = "";
      let ageValue: number | null = null;
      let ageUnit: string | null = null;
      if (!isNaN(ageVal) && ageVal >= 0) {
        ageValue = Math.round(ageVal);
        ageUnit = unit;
        if (unit === "years") {
          dateOfBirth = `${new Date().getFullYear() - Math.round(ageVal)}-01-01`;
        } else if (unit === "months") {
          const d = new Date();
          d.setMonth(d.getMonth() - Math.round(ageVal));
          dateOfBirth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        } else {
          const d = new Date();
          d.setDate(d.getDate() - Math.round(ageVal));
          dateOfBirth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
      }
      return api.post("/api/patients", {
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        gender: body.gender,
        email: body.email || null,
        address: body.address || null,
        bloodGroup: body.bloodGroup || null,
        dateOfBirth,
        ageValue,
        ageUnit,
      });
    },
    onSuccess: (p: Patient) => {
      setSelectedPatient(p);
      setNewPatient({ firstName: "", lastName: "", phone: "", gender: "male", ageValue: "", ageUnit: "years", email: "", address: "", bloodGroup: "" });
      toast({ title: `Patient registered: ${p.patientId}` });
    },
    onError: (err: Error) => {
      const msg = err.message || "";
      if (msg.includes("409") || msg.includes("was just created") || msg.includes("duplicate")) {
        // Extract patient ID from the 409 response if possible
        const match = msg.match(/\(P-\d+\)/);
        const pid = match ? match[0] : "";
        toast({
          title: `Duplicate patient${pid ? ` ${pid}` : ""}`,
          description: "A patient with this name and phone already exists. Please search for the existing patient instead of creating a new one.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Failed to register patient", description: msg, variant: "destructive" });
      }
    },
  });

  const queryClient = useQueryClient();
  const printAfterSaveRef = useRef(false);
  // Pre-load printer settings on mount so the auto-print path after "Save &
  // Print" doesn't have to wait on a network round-trip — it just reads from
  // the React Query cache. Refreshes silently in the background every 5 min.
  const { data: printerCfgCached } = useQuery<PrinterCfg>({
    queryKey: ["printer-settings"],
    queryFn: getPrinterSettings,
    staleTime: 5 * 60_000,
  });
  const generateMut = useMutation({
    mutationFn: async () => {
      if (!selectedPatient) throw new Error("No patient selected");
      if (selectedTests.length === 0) throw new Error("No tests selected");

      // 1. Create order (with custom per-test prices to preserve package discounts)
      const order = await api.post<{ id: number; orderNumber: string }>("/api/orders", {
        patientId: selectedPatient.id,
        doctorId: doctorId ?? undefined,
        notes: notes || undefined,
        tests: selectedTests.map((t) => ({ testId: t.testId, price: t.price })),
      });

      // 2. Create bill (inline payments are processed server-side within /billing permission)
      const paymentRows = payNow
        ? paymentSplits.filter((s) => Number(s.amount) > 0).map((s) => ({ amount: Number(s.amount), method: s.mode }))
        : [];
      const bill = await api.post<{
        id: number;
        billNumber: string;
        token?: { tokenNo: number; tokenDate: string } | null;
        testTokens?: Array<{ orderTestId: number; testName: string; department: string; roomNumber: string; floorLabel: string; tokenNo: number }>;
        needsFormFData?: boolean;
        needsOnlinePayment?: boolean;
        onlineAmount?: number;
      }>("/api/bills", {
        orderId: order.id,
        discount: discountAmt,
        discountReason: discountAmt > 0 ? discountReason || null : null,
        discountReasonNote: discountAmt > 0 ? discountNote || null : null,
        payments: paymentRows,
        isVip: isVipActive,
        ...(needsDicom && dicomFieldsComplete ? {
          dicomFields: {
            studyDescription: dicomStudyDesc.trim(),
            bodyPart: dicomBodyPart.trim(),
            scheduledStationAETitle: dicomStationAE.trim(),
            referringDoctor: dicomReferringDoc.trim(),
          },
        } : {}),
      });

      return bill;
    },
    onSuccess: async (bill) => {
      if (!selectedPatient) return;
      const doctor = doctors.find((d) => d.id === doctorId);
      const lastBillLocal: LastBill = {
        id: bill.id,
        billNumber: bill.billNumber,
        patient: selectedPatient,
        doctorName: doctor?.name ?? null,
        tests: [...selectedTests],
        subtotal,
        discount: discountAmt,
        total,
        payments: paymentSplits.filter((p) => Number(p.amount) > 0),
        tokenNo: bill.token?.tokenNo ?? null,
        tokenDate: bill.token?.tokenDate ?? null,
        testTokens: bill.testTokens ?? [],
      };
      setLastBill(lastBillLocal);
      lastBillRef.current = lastBillLocal;
      lastBillLocalRef.current = lastBillLocal;
      incrementPendingSyncCount(2); // order + bill

      if (bill.needsOnlinePayment) {
        setGatewayPaymentStatus("pending");
        setGatewayPaymentError("");
        setGatewayModalOpen(true);
        setGatewayPaymentInfo(null);
        try {
          const initRes = await api.post<{
            txnRef: string;
            amount: number;
            redirectUrl: string;
            tranCtx?: string;
            expiryTime?: string;
          }>(`/api/bills/${bill.id}/initiate-gateway-payment`, {
            amount: bill.onlineAmount,
            expiryMinutes,
          });
          setGatewayPaymentInfo({
            ...initRes,
            billId: bill.id,
          });
        } catch (err: any) {
          setGatewayPaymentStatus("failed");
          setGatewayPaymentError(err.message || "Failed to initiate online payment");
        }
        return;
      }

      setShowBillToast(true);
      window.setTimeout(() => setShowBillToast(false), 5000);
      queryClient.invalidateQueries({ queryKey: ["recent-bills-today"] });
      queryClient.invalidateQueries({ queryKey: ["bill-preview-no"] });
      if (printAfterSaveRef.current) {
        printAfterSaveRef.current = false;
        const cachedClinic = queryClient.getQueryData<PrintClinic>([
          "clinic-settings",
        ]);
        const cachedPrinter =
          printerCfgCached ??
          queryClient.getQueryData<PrinterCfg>(["printer-settings"]);
        const settings = loadBillPrintSettings();
        const runPrint = (skipConfirm: boolean) => {
          if (settings.askBeforePrint && !skipConfirm) {
            if (!window.confirm("Print receipt now?")) {
              return;
            }
          }
          void QRCode.toDataURL(buildBillVerifyUrl(lastBillLocal.billNumber), {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 256,
            color: { dark: "#000000", light: "#ffffff" },
          })
            .catch(() => "")
            .then((qrUrl) => {
            const clinicForPrint = cachedClinic ?? (clinic as PrintClinic);
            const isBW = (cachedPrinter as { billPrinterType?: string } | undefined)?.billPrinterType === "bw";
            const paid = lastBillLocal.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
            const billForPrint: PrintBillData = {
              billNumber: lastBillLocal.billNumber,
              subtotal: lastBillLocal.subtotal,
              discount: lastBillLocal.discount,
              taxAmount: 0,
              totalAmount: lastBillLocal.total,
              paidAmount: paid,
              balanceAmount: Math.max(0, lastBillLocal.total - paid),
              createdAt: new Date().toISOString(),
              patient: {
                firstName: lastBillLocal.patient.firstName,
                lastName: lastBillLocal.patient.lastName,
                patientId: lastBillLocal.patient.patientId,
                phone: lastBillLocal.patient.phone ?? null,
                gender: lastBillLocal.patient.gender ?? null,
                dateOfBirth: lastBillLocal.patient.dateOfBirth ?? null,
              },
              order: {
                doctor: lastBillLocal.doctorName ? { name: lastBillLocal.doctorName } : null,
                tests: lastBillLocal.tests.map((t) => ({
                  price: t.price,
                  status: "active",
                  test: { name: t.name, code: t.code ?? "", category: t.category },
                })),
              },
              payments: lastBillLocal.payments.map((p) => ({
                method: p.mode,
                amount: Number(p.amount || 0),
              })),
              tokenNo: lastBillLocal.tokenNo ?? null,
              testTokens: lastBillLocal.testTokens ?? null,
            };
            const paperSize = getAutoBillPaperSize(lastBillLocal.tests.length, getBillPaperSize());
            const html = buildBillPrintHtml({
              bill: billForPrint,
              clinic: clinicForPrint,
              paperSize,
              isBW,
              qrDataUrl: qrUrl as string,
              format: settings.defaultFormat,
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
            });
            if (settings.enablePreview) {
              setPrintPreviewHtml(html);
              setPrintPreviewOpen(true);
            } else if (settings.directPrintAfterSave || settings.autoOpenPrintDialog) {
              printViaIframe(html);
            }
            if ((lastBillLocal.testTokens?.length ?? 0) > 0 || lastBillLocal.tokenNo != null) {
              window.setTimeout(() => {
                void printToken(lastBillLocal, clinicForPrint as ClinicLite).catch(() => { /* best-effort */ });
              }, 600);
            }
          });
        };
        runPrint(false);
      }
      if (bill.needsFormFData && clinic?.formFBillingPrompt) {
        setFormFPopupBillNumber(bill.billNumber);
        setFormFPopupHusband("");
        setFormFPopupAddress(selectedPatient?.address ?? "");
        formFPopupPendingPrintRef.current = printAfterSaveRef.current;
        setFormFPopupOpen(true);
        return;
      }

      window.setTimeout(() => {
        resetAll();
      }, 3000);
    },
    onError: (err: Error) => {
      printAfterSaveRef.current = false;
      toast({ title: err.message || "Failed to generate bill", variant: "destructive" });
    },
    onSettled: () => {
      // Release the synchronous guard so the desk is ready for a new bill.
      generatingRef.current = false;
    },
  });

  // ── Derived values ──────────────────────────────────
  const categories  = ["all", ...Array.from(new Set(allTests.map((t) => t.category))).sort()];

  const selectedTestIds = new Set(selectedTests.map((s) => s.testId));

  const filteredTests = allTests
    .filter((t) => {
      if (selectedTestIds.has(t.id)) return false;
      const q = testSearch.trim().toLowerCase();
      const matchSearch = !q || String(t.id) === q || String(t.id).includes(q) || t.name.toLowerCase().includes(q) || (t.code ?? "").toLowerCase().includes(q);
      const matchCat    = categoryFilter === "all" || t.category === categoryFilter;
      return matchSearch && matchCat && t.isActive !== false;
    })
    .sort((a, b) => {
      const ap = pinnedTestIds.has(a.id) ? 0 : 1;
      const bp = pinnedTestIds.has(b.id) ? 0 : 1;
      return ap - bp; // pinned first; popularity order (from API) preserved within each group
    });

  const filteredPackages = packages.filter((pkg) => {
    const q = packageSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      pkg.name.toLowerCase().includes(q) ||
      pkg.packageCode.toLowerCase().includes(q) ||
      pkg.tests.some((t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))
    );
  });

  const subtotal    = selectedTests.reduce((s, t) => s + t.price, 0);
  const discountAmt = discountType === "amount"
    ? Math.min(discountValue, subtotal)
    : Math.min((subtotal * discountValue) / 100, subtotal);
  const total       = Math.max(0, subtotal - discountAmt);
  const paidTotal   = payNow ? paymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0;
  const balance     = Math.max(0, total - paidTotal);

  // ── Test actions ────────────────────────────────────
  function addTest(t: Test) {
    if (selectedTests.find((s) => s.testId === t.id)) {
      toast({ title: "Test already added" });
      return;
    }
    setSelectedTests((prev) => [...prev, { testId: t.id, name: t.name, code: t.code, price: t.price, category: t.category, source: "test" }]);
    setTestSearch("");
  }

  // ── Quick Test slot save / actions ──────────────────
  const saveQuickTestsMut = useMutation({
    mutationFn: (ids: (number | null)[]) =>
      api.put("/api/clinic-settings", { quickTestIds: JSON.stringify(ids) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clinic-settings"] }),
    onError: () => toast({ title: "Failed to save quick test", variant: "destructive" }),
  });
  function assignQuickSlot(slotIdx: number, testId: number | null) {
    // Read latest cached settings to avoid clobbering concurrent updates
    const latest = queryClient.getQueryData<{ quickTestIds?: string }>(["clinic-settings"]);
    let current: (number | null)[];
    try {
      const arr = JSON.parse(latest?.quickTestIds ?? "[null,null,null,null,null,null]");
      current = Array.isArray(arr)
        ? arr.slice(0, 6).map((v: unknown) => (typeof v === "number" ? v : null))
        : [null, null, null, null, null, null];
      while (current.length < 6) current.push(null);
    } catch {
      current = [null, null, null, null, null, null];
    }
    const next = [...current];
    next[slotIdx] = testId;
    saveQuickTestsMut.mutate(next);
  }
  function handleQuickTabClick(slotIdx: number) {
    const id = quickTestIds[slotIdx];
    if (id == null) {
      setQuickPickerSlot(slotIdx);
      return;
    }
    const t = allTests.find((x) => x.id === id);
    if (t) addTest(t);
    else {
      toast({ title: "Saved test no longer exists — please reassign" });
      setQuickPickerSlot(slotIdx);
    }
  }

  function addPackage(pkg: Pkg) {
    // Package effective price = MRP - %% - flat ₹.
    const afterPct = pkg.price - (pkg.price * (pkg.discountPct ?? 0)) / 100;
    const effective = Math.max(0, afterPct - (pkg.discountAmount ?? 0));
    const count = pkg.tests.length || 1;

    // If any test inside this package carries its own discount override, honour
    // that on a per-line basis. Otherwise fall back to the historical even
    // split of the package's effective price.
    const anyOverride = pkg.tests.some(
      (t) => Number(t.discountPct ?? 0) > 0 || Number(t.discountAmount ?? 0) > 0,
    );
    const computeLinePrice = (t: PkgTest) => {
      if (anyOverride) {
        const base = Number(t.price);
        const after = base - (base * Number(t.discountPct ?? 0)) / 100 - Number(t.discountAmount ?? 0);
        return Math.max(0, after);
      }
      return effective / count;
    };

    const existingIds = new Set(selectedTests.map((s) => s.testId));
    const toAdd: SelectedTest[] = pkg.tests
      .filter((t) => !existingIds.has(t.id))
      .map((t) => ({ testId: t.id, name: t.name, code: t.code, price: computeLinePrice(t), category: t.category, source: "package" as const }));
    if (toAdd.length === 0) {
      toast({ title: "All tests in this package already added" });
      return;
    }
    setSelectedTests((prev) => [...prev, ...toAdd]);
    setSelectedPackages((prev) => [...prev, { packageId: pkg.id, name: pkg.name, testIds: toAdd.map((t) => t.testId) }]);
    toast({ title: `Package "${pkg.name}" added (${toAdd.length} tests)` });
  }

  function removeTest(testId: number) {
    setSelectedTests((prev) => prev.filter((t) => t.testId !== testId));
    setSelectedPackages((prev) => prev
      .map((pkg) => ({ ...pkg, testIds: pkg.testIds.filter((id) => id !== testId) }))
      .filter((pkg) => pkg.testIds.length > 0));
  }

  function removePackage(packageId: number) {
    setSelectedPackages((prev) => {
      const pkg = prev.find((p) => p.packageId === packageId);
      if (!pkg) return prev;
      setSelectedTests((tests) => tests.filter((t) => !pkg.testIds.includes(t.testId)));
      return prev.filter((p) => p.packageId !== packageId);
    });
  }

  // ── Discount suggestion ─────────────────────────────
  async function fetchSuggestion() {
    if (selectedTests.length === 0) return;
    setSuggLoading(true);
    try {
      const result = await api.post<{ discount: number; rule: { name: string } | null }>("/api/discounts/apply", {
        tests: selectedTests.map((t) => ({ testId: t.testId, category: t.category, price: t.price })),
        patientDob: selectedPatient?.dateOfBirth ?? null,
        doctorId: doctorId ?? null,
      });
      setSuggestion(result);
    } catch {
      setSuggestion(null);
    } finally {
      setSuggLoading(false);
    }
  }

  // Auto-fetch suggestion whenever patient or doctor changes (if tests are already selected)
  useEffect(() => {
    if (selectedTests.length > 0 && (selectedPatient || doctorId)) {
      void fetchSuggestion();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatient?.id, doctorId]);

  // ── Click outside patient search dropdown ──────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
      if (doctorRef.current && !doctorRef.current.contains(e.target as Node)) {
        setDoctorSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────
  // Refs are declared here; .current assignments happen after canGenerate is defined (below).
  const canGenerateRef = useRef(false);
  const lastBillRef    = useRef<LastBill | null>(null);
  // Synchronous in-flight guard — set BEFORE mutate(), cleared in onSettled.
  // Unlike generateMut.isPending (updated on next render), this ref is immediate
  // so double-clicks and rapid keyboard shortcuts can't slip through the gap.
  const generatingRef  = useRef(false);
  useEffect(() => {
    function kbHandler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      // Intercept scanner QR-URL input: if the currently focused text input
      // contains a bill-verification QR URL, open it instead of submitting.
      if (inInput && e.key === "Enter") {
        const el = e.target as HTMLInputElement;
        const val = el?.value ?? "";
        const m = val.match(/\/api\/verify\/bill\/([A-Za-z0-9\-]+)/);
        if (m) {
          e.preventDefault();
          e.stopPropagation();
          el.value = "";
          const verifyUrl = `${window.location.origin}/api/verify/bill/${encodeURIComponent(m[1])}`;
          window.open(verifyUrl, "_blank", "noopener,noreferrer");
          return;
        }
      }
      // Esc — blur focused input, do NOT reset bill
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement)?.blur();
        return;
      }
      // F2 — jump to patient search (works even inside inputs)
      if (e.key === "F2") {
        e.preventDefault();
        const input = searchRef.current?.querySelector("input");
        input?.focus();
        return;
      }
      // F4 — jump to payment amount input
      if (e.key === "F4") {
        e.preventDefault();
        paymentRef.current?.querySelector("input")?.focus();
        return;
      }
      if (inInput) return; // let remaining shortcuts only fire outside inputs
      // Ctrl/Cmd + P — Save & Print
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        if (canGenerateRef.current && !lastBillRef.current && !generatingRef.current) {
          generatingRef.current = true;
          printAfterSaveRef.current = true;
          generateMut.mutate();
        }
        return;
      }
      // Ctrl/Cmd + S — Save (no print)
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (canGenerateRef.current && !lastBillRef.current && !generatingRef.current) {
          generatingRef.current = true;
          generateMut.mutate();
        }
        return;
      }
    }
    document.addEventListener("keydown", kbHandler);
    return () => document.removeEventListener("keydown", kbHandler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reset ───────────────────────────────────────────
  function resetAll() {
    setSelectedPatient(null);
    setPatientSearch("");
    setNewPatient({ firstName: "", lastName: "", phone: "", gender: "male", ageValue: "", ageUnit: "years", email: "", address: "", bloodGroup: "" });
    setDoctorId(null);
    setDoctorSearch("");
    setNotes("");
    setSelectedTests([]);
    setDiscountValue(0);
    setDiscountReason("");
    setDiscountNote("");
    setPayNow(true);
    setPaymentSplits([{ mode: "cash", amount: "" }]);
    setLastBill(null);
    setSuggestion(null);
    setHusbandName("");
    setPatientAddress("");
    setIsVipActive(false);
  }

  function assignQuickDoctor(slotIdx: number, doctorId: number | null) {
    const next = [...quickDoctorIds];
    next[slotIdx] = doctorId;
    setQuickDoctorIds(next);
    localStorage.setItem("billingDesk:quickDoctors", JSON.stringify(next));
  }

  const canGenerate = !!selectedPatient && selectedTests.length > 0 && !(discountAmt > 0 && !discountReason);
  // Update shortcut refs on every render so the keydown handler stays fresh.
  canGenerateRef.current = canGenerate;
  lastBillRef.current    = lastBill;

  // ──────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-900/20">

      {/* ── TOP BAR — single ultra-compact row ── */}
      <div className="flex-shrink-0 bg-card border-b border-card-border px-2 sm:px-3 py-1 flex items-center gap-2 shadow-sm">
        <span className="hidden sm:inline text-[11px] text-muted-foreground flex-shrink-0">{today()}</span>
        <span className="text-[12px] font-bold text-foreground flex-shrink-0">Billing Desk</span>
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-1">
          <div className="w-40 sm:w-56 lg:w-72"><BillSearchBox /></div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground hover:text-foreground flex-shrink-0">
                <Receipt size={11} />
                <span className="hidden md:inline text-[11px] ml-1">Recent</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="p-0 w-[420px]">
              <RecentBillsPanel />
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="sm" onClick={resetAll} className="h-6 px-1.5 text-muted-foreground hover:text-foreground flex-shrink-0">
            <RefreshCcw size={11} />
            <span className="hidden md:inline text-[11px] ml-1">New</span>
          </Button>
        </div>
      </div>

      {/* ── STEPPER BAR (stepped wizard only) ── */}
      {isStepped && (
        <div className="flex-shrink-0 bg-card border-b border-card-border px-3 py-2">
          <div className="flex items-center gap-2 max-w-3xl mx-auto">
            {[
              { id: 1, label: "Patient", icon: User },
              { id: 2, label: "Doctor", icon: Stethoscope },
              { id: 3, label: "Tests", icon: FlaskConical },
              { id: 4, label: "Summary", icon: Receipt },
            ].map((s, idx) => (
              <div key={s.id} className="flex items-center flex-1">
                <button
                  type="button"
                  onClick={() => goToStep(s.id)}
                  className={`flex items-center gap-2 flex-1 justify-center px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${
                    stepperActive(s.id)
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : stepperDone(s.id)
                      ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400"
                      : "bg-muted/30 border-card-border text-muted-foreground"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold ${
                    stepperActive(s.id) ? "bg-primary text-white" : stepperDone(s.id) ? "bg-green-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"
                  }`}>
                    {stepperDone(s.id) ? <Check size={10} /> : s.id}
                  </div>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {idx < 3 && (
                  <div className={`w-4 h-px mx-1 ${stepperDone(s.id) ? "bg-green-400" : "bg-card-border"}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MAIN LAYOUT ── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

        {/* ══════════════════════════════════════════════
            LEFT COLUMN — Patient + Doctor + Notes
        ══════════════════════════════════════════════ */}
        <div className="w-full lg:w-[65%] lg:border-r border-card-border flex flex-col lg:overflow-hidden min-h-0">
          <div ref={stepContentRef} className="lg:flex-1 min-h-0 overflow-y-auto p-3 space-y-3">

            {/* ── STEP 1: Patient Section ── */}
            {(!isStepped || currentStep === 1) && (
            <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2 h-10 border-b border-card-border flex items-center justify-between bg-blue-800 dark:bg-blue-900 border-l-[4px] border-l-blue-950">
                <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-white">
                  <User size={14} className="text-white" /> Search Patient
                </div>
                {selectedPatient && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-900 dark:text-slate-900" onClick={() => { setSelectedPatient(null); setPatientSearch(""); }}>
                    <X size={11} className="mr-1" /> Change
                  </Button>
                )}
              </div>

              <div className="p-3 space-y-2">
                {/* Selected patient card */}
                {selectedPatient ? (
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                        {selectedPatient.firstName[0]}{selectedPatient.lastName[0]}
                      </div>
                      <div>
                        <div className="font-extrabold text-sm">{selectedPatient.firstName} {selectedPatient.lastName}</div>
                        <div className="text-xs text-slate-900 dark:text-slate-900 font-mono">{selectedPatient.patientId}</div>
                      </div>
                      <div className="ml-auto flex items-center gap-3 text-xs text-slate-900 dark:text-slate-900">
                        <span className="capitalize">{selectedPatient.gender}</span>
                        {selectedPatient.dateOfBirth && <span>{selectedPatient.dateOfBirth}</span>}
                      </div>
                    </div>
                    {selectedPatient.phone && (
                      <div className="flex items-center gap-1 text-xs text-slate-900 dark:text-slate-900 pl-10">
                        <Phone size={10} /> {selectedPatient.phone}
                        {selectedPatient.bloodGroup && <span className="ml-2 bg-red-100 text-red-600 px-1.5 rounded font-bold">{selectedPatient.bloodGroup}</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Search existing patient */
                  <div ref={searchRef}>
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-900 dark:text-slate-900" />
                      <Input
                        placeholder="Search by name, ID or phone…"
                        value={patientSearch}
                        onChange={(e) => { setPatientSearch(e.target.value); setSearchOpen(true); }}
                        onFocus={() => setSearchOpen(true)}
                        onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                        className="pl-9 text-sm"
                      />
                    </div>
                    {searchOpen && (
                      <div className="mt-1 border border-card-border rounded-lg bg-popover shadow-lg max-h-52 overflow-y-auto">
                        {patientSearch.length === 0 && (
                          <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-900 dark:text-slate-900 border-b border-border">
                            Recent Patients
                          </div>
                        )}
                        {!patientResults?.patients?.length ? (
                          <div className="px-4 py-3 text-sm text-slate-900 dark:text-slate-900 text-center">
                            {patientSearch.length >= 1 ? "No patients found" : "No patients yet"}
                          </div>
                        ) : (
                          patientResults.patients.map((p) => (
                            <button
                              key={p.id}
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { setSelectedPatient(p); setPatientSearch(""); setSearchOpen(false); }}
                            >
                              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                                {p.firstName[0]}{p.lastName[0]}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold text-slate-900 dark:text-slate-900">{p.firstName} {p.lastName}</div>
                                <div className="text-xs text-slate-900 dark:text-slate-900">{p.patientId} · {p.phone}</div>
                              </div>
                              <span className="text-xs text-slate-900 dark:text-slate-900 capitalize">{p.gender}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            )}

            {/* ── Duplicate bill warning ── */}
            {recentPatientBill && (
              <div className="mx-3 mb-1 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 text-[11px]">
                <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-extrabold text-amber-800 dark:text-amber-300">Bill already exists today</span>
                  <span className="text-amber-900 dark:text-amber-700"> — {recentPatientBill.billNumber} was created at {new Date(recentPatientBill.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. Are you sure you want to create another?</span>
                </div>
              </div>
            )}

            {/* ── DICOM MWL Fields (shown when a DICOM-configured test is selected) ── */}
            {selectedPatient && needsDicom && (
              <div className="bg-blue-50 border border-blue-300 rounded-xl overflow-hidden dark:bg-blue-950/20 dark:border-blue-800">
                <div className="px-4 py-2 border-b border-blue-200 bg-blue-100 dark:bg-blue-900/30 flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-blue-800 dark:text-blue-900 flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-blue-600" />
                    DICOM Worklist
                  </span>
                  {dicomFieldsComplete
                    ? <span className="text-[11px] text-green-700 dark:text-green-800 font-extrabold">✓ Ready</span>
                    : <span className="text-[11px] text-amber-900 font-extrabold">Fill Referring Doctor</span>}
                </div>
                <div className="p-3 grid grid-cols-2 gap-2">
                  {/* Study Description */}
                  <div className="space-y-0.5">
                    <label className="text-[10px] font-extrabold flex items-center gap-1">
                      Study Description
                      {dicomStudyDesc.trim() && <span className="text-[9px] text-blue-900 font-bold">(auto)</span>}
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={dicomStudyDesc}
                      onChange={(e) => setDicomStudyDesc(e.target.value)}
                      placeholder="e.g. Brain MRI"
                      className="w-full h-7 text-xs border border-blue-300 rounded px-2 bg-white dark:bg-background focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  {/* Body Part */}
                  <div className="space-y-0.5">
                    <label className="text-[10px] font-extrabold flex items-center gap-1">
                      Body Part
                      {dicomBodyPart.trim() && <span className="text-[9px] text-blue-900 font-bold">(auto)</span>}
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={dicomBodyPart}
                      onChange={(e) => setDicomBodyPart(e.target.value.toUpperCase())}
                      placeholder="BRAIN"
                      className="w-full h-7 text-xs font-mono border border-blue-300 rounded px-2 bg-white dark:bg-background focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  {/* Station AE */}
                  <div className="space-y-0.5">
                    <label className="text-[10px] font-extrabold flex items-center gap-1">
                      Station AE Title
                      {dicomStationAE.trim() && <span className="text-[9px] text-blue-900 font-bold">(auto)</span>}
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={dicomStationAE}
                      onChange={(e) => setDicomStationAE(e.target.value.toUpperCase())}
                      placeholder="MRI_ROOM1"
                      className="w-full h-7 text-xs font-mono border border-blue-300 rounded px-2 bg-white dark:bg-background focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  {/* Referring Doctor */}
                  <div className="space-y-0.5">
                    <label className="text-[10px] font-extrabold flex items-center gap-1 text-blue-900 dark:text-blue-900">
                      Referring Doctor
                      {dicomReferringDoc.trim() && <span className="text-[9px] text-blue-900 font-bold">(auto)</span>}
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={dicomReferringDoc}
                      onChange={(e) => setDicomReferringDoc(e.target.value)}
                      placeholder="Dr. Sharma"
                      autoFocus={needsDicom && !dicomReferringDoc}
                      className={`w-full h-7 text-xs border rounded px-2 bg-white dark:bg-background focus:outline-none transition-colors ${dicomReferringDoc.trim() ? "border-blue-300 focus:border-blue-500" : "border-amber-400 focus:border-amber-500 ring-1 ring-amber-300"}`}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Form F Extra Fields (shown when a Form-F-required test is selected) ── */}
            {selectedPatient && needsFormF && (
              <div className="bg-orange-50 border border-orange-300 rounded-xl overflow-hidden">
                <div className="px-4 py-2 border-b border-orange-200 bg-orange-100 flex items-center gap-2">
                  <AlertTriangle size={13} className="text-orange-900 flex-shrink-0" />
                  <span className="text-xs font-extrabold text-orange-800">
                    PCPNDT Form F Required — fill additional details before generating bill
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-extrabold">Husband's / Father's Name <span className="text-red-500">*</span></Label>
                    <Input
                      value={husbandName}
                      onChange={(e) => setHusbandName(e.target.value)}
                      placeholder="Required for PCPNDT compliance"
                      className="h-8 text-sm border-orange-300 focus:border-orange-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-extrabold">Full Address <span className="text-red-500">*</span></Label>
                    <Input
                      value={patientAddress}
                      onChange={(e) => setPatientAddress(e.target.value)}
                      placeholder="Patient's full residential address"
                      className="h-8 text-sm border-orange-300 focus:border-orange-500"
                    />
                  </div>
                  <p className="text-[10px] text-orange-900">
                    These fields are mandatory for USG tests under the PCPNDT Act. Form F will be pre-filled with this data.
                  </p>
                </div>
              </div>
            )}

            {/* ── Add New Patient ── */}
            {!selectedPatient && (
              <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
                <div className="w-full px-4 py-2 h-10 border-b border-card-border bg-indigo-800 dark:bg-indigo-900 border-l-[4px] border-l-indigo-950 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-white">
                  <UserPlus size={14} className="text-white" />
                  <span>Register New Patient</span>
                </div>
                <div className="p-2.5 space-y-2">
                  {/* Single compact row: Name | Phone | Age | Gender | Blood | Address */}
                  <div className="flex flex-wrap items-end gap-1.5">
                    <div className="flex-1 min-w-[140px] space-y-0.5">
                      <Label className="text-[10px] font-extrabold">Name *</Label>
                      <Input
                        value={`${newPatient.firstName} ${newPatient.lastName}`.trim()}
                        onChange={(e) => {
                          const parts = e.target.value.trim().split(/\s+/);
                          const first = parts[0] || "";
                          const last = parts.slice(1).join(" ") || "";
                          setNewPatient({ ...newPatient, firstName: first, lastName: last });
                        }}
                        placeholder="Full name"
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="w-[110px] space-y-0.5">
                      <Label className="text-[10px] font-extrabold">Phone *</Label>
                      <Input
                        value={newPatient.phone}
                        onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                        placeholder="10-digit"
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="w-[100px] space-y-0.5">
                      <Label className="text-[10px] font-extrabold">Age *</Label>
                      <div className="flex gap-1">
                        <Input
                          type="number"
                          min={0}
                          max={newPatient.ageUnit === "years" ? 120 : 365}
                          value={newPatient.ageValue}
                          onChange={(e) => setNewPatient({ ...newPatient, ageValue: e.target.value })}
                          placeholder=""
                          className="h-7 text-xs flex-1 min-w-0"
                        />
                        <Select value={newPatient.ageUnit} onValueChange={(v) => setNewPatient({ ...newPatient, ageUnit: v as "years" | "months" | "days" })}>
                          <SelectTrigger className="h-7 text-[10px] w-[52px] px-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="years">Yrs</SelectItem>
                            <SelectItem value="months">Mo</SelectItem>
                            <SelectItem value="days">Days</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="w-[72px] space-y-0.5">
                      <Label className="text-[10px] font-extrabold">Sex *</Label>
                      <Select value={newPatient.gender} onValueChange={(v) => setNewPatient({ ...newPatient, gender: v })}>
                        <SelectTrigger className="h-7 text-[10px] px-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {GENDERS.map((g) => <SelectItem key={g} value={g} className="text-xs capitalize">{g}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-[68px] space-y-0.5">
                      <Label className="text-[10px] font-extrabold">BG</Label>
                      <Select value={newPatient.bloodGroup || "none"} onValueChange={(v) => setNewPatient({ ...newPatient, bloodGroup: v === "none" ? "" : v })}>
                        <SelectTrigger className="h-7 text-[10px] px-1.5"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {BLOOD_GROUPS.map((g) => <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-[1.5] min-w-[140px] space-y-0.5">
                      <Label className="text-[10px] font-extrabold">Address</Label>
                      <Input
                        value={newPatient.address}
                        onChange={(e) => setNewPatient({ ...newPatient, address: e.target.value })}
                        placeholder="Optional"
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-8 bg-indigo-900 hover:bg-indigo-950 text-white font-extrabold text-xs"
                    disabled={!newPatient.firstName || !newPatient.lastName || !newPatient.phone || !newPatient.ageValue || createPatientMut.isPending}
                    onClick={() => createPatientMut.mutate(newPatient)}
                  >
                    {createPatientMut.isPending ? "Registering…" : <><UserPlus size={12} className="mr-1" /> Register & Select</>}
                  </Button>
                </div>
              </div>
            )}

            {/* ── Referral / Doctor — Walk-in / Self + Quick Doctor Tabs + Search ── */}
            <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2 h-10 border-b border-card-border bg-sky-800 dark:bg-sky-900 border-l-[4px] border-l-sky-950 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-white">
                <Stethoscope size={14} className="text-white" /> Referral Doctor
                <span className="ml-auto text-xs font-bold text-white/80">optional</span>
              </div>
              <div className="p-2.5" ref={doctorRef}>
                {/* Walk-in + Search row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => { setDoctorMode("self"); setDoctorId(null); setDoctorSearch(""); setDoctorSearchOpen(false); }}
                    className={`px-2 py-1 rounded-md text-[11px] border transition-colors flex-shrink-0 ${doctorMode === "self" ? "border-primary bg-primary/10 text-primary font-extrabold" : "border-card-border text-slate-900 dark:text-slate-900 hover:bg-muted/30"}`}
                  >
                    Walk-in
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDoctorMode("doctor"); if (!doctorId) setDoctorSearchOpen((v) => !v); }}
                    className={`px-2 py-1 rounded-md text-[11px] border transition-colors flex-shrink-0 ${doctorMode === "doctor" && !doctorId ? "border-primary bg-primary/10 text-primary font-extrabold" : "border-card-border text-slate-900 dark:text-slate-900 hover:bg-muted/30"}`}
                  >
                    Search…
                  </button>
                  {doctorMode === "doctor" && doctorId && (
                    <button
                      type="button"
                      onClick={() => { setDoctorId(null); setDoctorSearch(""); setDoctorMode("self"); }}
                      className="text-slate-900 dark:text-slate-900 hover:text-foreground transition-colors"
                      title="Clear doctor"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                {/* ── 6 Quick Doctor Slots — horizontal scrollable pill row ── */}
                <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                  {quickDoctorIds.map((id, i) => {
                    const doc = id != null ? doctors.find(d => d.id === id) : null;
                    const isActive = doctorMode === "doctor" && doctorId === id && id != null;
                    return (
                      <div key={i} className="relative group flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (id == null) { setQuickDoctorPickerSlot(i); setQuickDoctorPickerSearch(""); return; }
                            setDoctorMode("doctor"); setDoctorId(id); setDoctorSearch(""); setDoctorSearchOpen(false);
                          }}
                          title={doc ? doc.name : `Assign quick doctor slot ${i + 1}`}
                          className={`h-7 rounded-full border text-[10px] font-extrabold px-3 flex items-center gap-1 transition-all whitespace-nowrap shadow-sm ${
                            isActive
                              ? "border-primary bg-primary/10 text-primary shadow-md"
                              : doc
                              ? "border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-900 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-900"
                              : "border-dashed border-card-border bg-muted/20 text-slate-900 dark:text-slate-900 hover:bg-muted/40"
                          }`}
                        >
                          {doc ? (
                            <span className="truncate max-w-[90px]">{doc.name}</span>
                          ) : (
                            <><Plus size={10} /><span className="opacity-70">Dr {i + 1}</span></>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setQuickDoctorPickerSlot(i); setQuickDoctorPickerSearch(""); }}
                          className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-card border border-card-border text-slate-900 dark:text-slate-900 hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-sm"
                          title="Customize this slot"
                        >
                          <Pencil size={7} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                {/* Selected doctor info line */}
                {doctorMode === "doctor" && doctorId && (() => {
                  const doc = doctors.find(d => d.id === doctorId);
                  return doc ? (
                    <div className="mt-1.5 text-[10px] text-primary font-bold truncate">
                      {doc.name}
                    </div>
                  ) : null;
                })()}
                {/* Doctor search dropdown (only shown when mode=doctor and no doctorId selected) */}
                {doctorMode === "doctor" && !doctorId && (
                  <div className="mt-2">
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-900 dark:text-slate-900" />
                      <Input
                        placeholder="Search doctor by name or specialization…"
                        value={doctorSearch}
                        onChange={(e) => { setDoctorSearch(e.target.value); setDoctorSearchOpen(true); }}
                        onFocus={() => setDoctorSearchOpen(true)}
                        onBlur={() => setTimeout(() => setDoctorSearchOpen(false), 150)}
                        className="pl-9 text-sm"
                        autoFocus
                      />
                    </div>
                    {doctorSearchOpen && (
                      <div className="mt-1 border border-card-border rounded-lg bg-popover shadow-lg max-h-48 overflow-y-auto">
                        <button
                          className="w-full text-left px-3 py-2.5 text-sm text-slate-900 dark:text-slate-900 hover:bg-muted/50 border-b border-border italic"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setDoctorMode("self"); setDoctorId(null); setDoctorSearch(""); setDoctorSearchOpen(false); }}
                        >
                          Walk-in / Self (no referral)
                        </button>
                        {(() => {
                          const q = doctorSearch.trim().toLowerCase();
                          const filtered = doctors.filter(d =>
                            !q ||
                            String(d.id) === q ||
                            String(d.id).includes(q) ||
                            d.name.toLowerCase().includes(q) ||
                            d.specialization.toLowerCase().includes(q)
                          ).sort((a, b) => {
                            const ap = pinnedDoctorIds.has(a.id) ? 0 : 1;
                            const bp = pinnedDoctorIds.has(b.id) ? 0 : 1;
                            if (ap !== bp) return ap - bp; // pinned first
                            const ac = b.billCount ?? 0;
                            const bc = a.billCount ?? 0;
                            return ac - bc; // most-billed first within each group
                          });
                          return filtered.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-slate-900 dark:text-slate-900 text-center">No doctors found</div>
                          ) : filtered.map(d => {
                            const pinned = pinnedDoctorIds.has(d.id);
                            return (
                              <div key={d.id} className="flex items-center">
                                <button
                                  onClick={(e) => toggleDoctorPin(d.id, e)}
                                  className={`pl-2 pr-1 py-2.5 flex-shrink-0 transition-colors ${pinned ? "text-amber-700 hover:text-amber-500" : "text-slate-900 dark:text-slate-900/30 hover:text-amber-700"}`}
                                  title={pinned ? "Unpin doctor" : "Pin doctor to top"}
                                >
                                  <Star size={11} fill={pinned ? "currentColor" : "none"} />
                                </button>
                                <button
                                  className="flex-1 flex items-center gap-3 px-2 py-2.5 hover:bg-muted/50 transition-colors text-left"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => { setDoctorMode("doctor"); setDoctorId(d.id); setDoctorSearch(""); setDoctorSearchOpen(false); }}
                                >
                                  <div className="w-9 h-7 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 font-mono text-[11px] text-primary font-extrabold">
                                    #{d.id}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <div className="text-sm font-bold text-slate-900 dark:text-slate-900">Dr. {d.name}</div>
                                      {(d.billCount ?? 0) > 0 && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-extrabold">{d.billCount} bills</span>
                                      )}
                                    </div>
                                    <div className="text-xs text-slate-900 dark:text-slate-900">{d.specialization}</div>
                                  </div>
                                </button>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Test Catalog (Quick Tests + Add Tests + Individual Tests) ── */}
            <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2 h-10 border-b border-card-border bg-violet-800 dark:bg-violet-900 border-l-[4px] border-l-violet-950 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-white">
                <FlaskConical size={14} className="text-white" /> Test Catalog
                <span className="ml-auto text-xs font-bold text-white/80">Hover ✏️ to customize slots</span>
              </div>
              <div className="p-2.5 space-y-2">
                {/* ── Quick Test Tabs (6 customizable slots) ── */}
                <div className="pt-1">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-violet-900 dark:text-violet-900 mb-1">
                    <Zap size={12} className="text-violet-900 dark:text-violet-900" /> Quick Tests
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                    {quickTestIds.map((id, i) => {
                      const t = id != null ? allTests.find((x) => x.id === id) : null;
                      const added = t ? !!selectedTests.find((s) => s.testId === t.id) : false;
                      return (
                        <div key={i} className="relative group flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleQuickTabClick(i)}
                            disabled={added}
                            title={t ? `${t.name} · ${t.code} · ${inr(t.price)}` : `Slot ${i + 1} — click to assign a test`}
                            className={`min-w-[108px] max-w-[130px] rounded-md border text-[10px] leading-tight px-2 py-1.5 flex flex-col items-start justify-center transition-all overflow-hidden shadow-sm ${
                              t
                                ? added
                                  ? "border-primary/40 bg-primary/10 text-primary cursor-default"
                                  : "border-violet-300 bg-violet-50 hover:bg-violet-100 hover:shadow-md text-violet-900 dark:bg-violet-950/30 dark:border-violet-800 dark:text-violet-900"
                                : "border-dashed border-card-border bg-muted/20 text-slate-900 dark:text-slate-900 hover:bg-muted/40"
                            }`}
                          >
                            {t ? (
                              <>
                                <span className="font-extrabold w-full truncate leading-tight">{t.name}</span>
                                <span className="text-[9px] opacity-70 w-full truncate mt-0.5 capitalize">{t.category || t.code} · {inr(t.price)}</span>
                              </>
                            ) : (
                              <span className="flex items-center gap-1 opacity-60"><Plus size={10} />Slot {i + 1}</span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setQuickPickerSlot(i); setQuickPickerSearch(""); }}
                            className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-card border border-card-border text-slate-900 dark:text-slate-900 hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-sm"
                            title="Customize this slot"
                          >
                            <Pencil size={7} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Add Tests compact row (label + search + category) ── */}
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-primary flex-shrink-0">
                    <FlaskConical size={13} /> Add Tests
                  </div>
                  <div className="relative min-w-0 flex-1">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-900 dark:text-slate-900" />
                    <Input
                      placeholder="Search tests by name or code…"
                      value={testSearch}
                      onChange={(e) => setTestSearch(e.target.value)}
                      className="pl-9 h-8 text-sm w-full"
                    />
                  </div>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-8 w-32 text-xs flex-shrink-0">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">{c === "all" ? "All Categories" : c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="pt-1">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-slate-900 dark:text-slate-900">
                    <FlaskConical size={11} className="text-slate-900 dark:text-slate-900" /> Individual Tests
                  </div>
                  <div className="mt-1 border border-card-border rounded-lg overflow-hidden">
                    <div className="max-h-48 overflow-y-auto divide-y divide-card-border">
                      {filteredTests.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-slate-900 dark:text-slate-900 text-center">No tests found</div>
                      ) : (
                        filteredTests.slice(0, 50).map((t) => {
                          const added = !!selectedTests.find((s) => s.testId === t.id);
                          const pinned = pinnedTestIds.has(t.id);
                          return (
                            <div key={t.id} className={`flex items-center ${added ? "bg-primary/5" : ""}`}>
                              <button
                                onClick={(e) => togglePin(t.id, e)}
                                className={`pl-2 pr-1 py-2 flex-shrink-0 transition-colors ${pinned ? "text-amber-700 hover:text-amber-500" : "text-slate-900 dark:text-slate-900/30 hover:text-amber-700"}`}
                              >
                                <Star size={11} fill={pinned ? "currentColor" : "none"} />
                              </button>
                              <button
                                onClick={() => addTest(t)}
                                disabled={added}
                                className={`flex-1 flex items-center gap-2 pr-3 py-2 text-left text-sm transition-colors ${added ? "text-slate-900 dark:text-slate-900 cursor-default" : "hover:bg-muted/50"}`}
                              >
                                <FlaskConical size={11} className={added ? "text-primary" : "text-slate-900 dark:text-slate-900"} />
                                <span className="text-[10px] font-mono font-extrabold text-primary bg-primary/10 px-1.5 py-0.5 rounded flex-shrink-0">#{t.id}</span>
                                <span className="flex-1 font-bold text-slate-900 dark:text-slate-900 truncate">{t.name}</span>
                                {t.testType === "outsourced" && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-extrabold flex-shrink-0">OUT</span>
                                )}
                                <span className="text-xs text-slate-900 dark:text-slate-900 font-mono flex-shrink-0">{t.code}</span>
                                <span className={`text-xs font-extrabold flex-shrink-0 ${added ? "text-primary" : ""}`}>{inr(t.price)}</span>
                                {added ? <CheckCircle2 size={12} className="text-primary flex-shrink-0" /> : <Plus size={12} className="text-slate-900 dark:text-slate-900 flex-shrink-0" />}
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Add Package ── */}
            <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2 h-10 border-b border-card-border flex items-center justify-between bg-rose-800 dark:bg-rose-900 border-l-[4px] border-l-rose-950">
                <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-white">
                  <Package size={14} className="text-white" /> Add Package
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/packages")}
                  className="text-[11px] text-slate-900 dark:text-slate-900 hover:text-foreground"
                >
                  Manage
                </button>
              </div>
              <div className="p-2.5 space-y-2">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-900 dark:text-slate-900" />
                  <Input
                    placeholder="Search packages by name, code, or test…"
                    value={packageSearch}
                    onChange={(e) => setPackageSearch(e.target.value)}
                    className="pl-9 h-8 text-sm w-full"
                  />
                </div>
                {packages.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-slate-900 dark:text-slate-900 text-center border border-card-border rounded-lg">
                    No packages created yet.&nbsp;
                    <button onClick={() => navigate("/packages")} className="text-primary hover:underline">Create one</button>
                  </div>
                ) : filteredPackages.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-900 dark:text-slate-900 text-center border border-card-border rounded-lg">No packages match "{packageSearch}"</div>
                ) : (
                  <div className="flex gap-2 flex-wrap pt-0.5">
                    {filteredPackages.map((pkg) => {
                      const added = selectedPackages.some((p) => p.packageId === pkg.id);
                      const effective = Math.max(0, pkg.price - (pkg.price * (pkg.discountPct ?? 0)) / 100 - (pkg.discountAmount ?? 0));
                      return (
                        <button
                          key={pkg.id}
                          onClick={() => addPackage(pkg)}
                          disabled={added}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-colors shadow-sm ${
                            added
                              ? "border-primary/40 bg-primary/10 text-primary cursor-default"
                              : "border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-900 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-100"
                          }`}
                        >
                          <Package size={10} className="flex-shrink-0 opacity-70" />
                          <span className="font-extrabold">{pkg.name}</span>
                          <span className="opacity-60 text-[10px]">{pkg.tests.length} tests</span>
                          <span className="font-extrabold">{inr(effective)}</span>
                          {added ? <CheckCircle2 size={11} className="flex-shrink-0" /> : <Plus size={11} className="flex-shrink-0 opacity-70" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* ══════════════════════════════════════════════
            RIGHT COLUMN — Bill Summary + Payment
        ══════════════════════════════════════════════ */}
        <div className="w-full lg:w-[35%] flex flex-col lg:overflow-hidden min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto">

            <div className="space-y-3 flex flex-col min-h-0">
              {/* ── Selected Tests ── */}
              <div className="flex-1 min-h-0 overflow-y-auto border-b border-card-border">
                <div className="px-4 py-2 h-10 bg-gradient-to-r from-slate-50 via-slate-100 to-slate-100/50 dark:from-slate-800/40 dark:via-slate-700/30 dark:to-slate-900/20 border-l-[3px] border-l-slate-600 flex items-center justify-between">
                  <span className="text-sm font-bold uppercase tracking-wide text-slate-900 dark:text-slate-900">
                    Selected Tests ({selectedTests.length})
                  </span>
                  {selectedTests.length > 0 && (
                    <button className="text-xs text-destructive hover:text-destructive/80" onClick={() => setSelectedTests([])}>
                      Clear all
                    </button>
                  )}
                </div>
                {selectedTests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-slate-900 dark:text-slate-900">
                    <FlaskConical size={24} className="mb-2 opacity-30" />
                    <p className="text-xs">No tests added yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-card-border">
                    {selectedTests.map((t) => (
                      <div key={t.testId} className="flex items-center gap-2 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-slate-900 dark:text-slate-900 truncate">{t.name}</div>
                          <div className="text-xs text-slate-900 dark:text-slate-900 capitalize">{t.category}
                            {t.source === "package" && <span className="ml-1 text-orange-500">· pkg</span>}
                          </div>
                          {(t as any).testType === "outsourced" && (
                            <div className="text-[10px] text-orange-600 dark:text-orange-400 font-extrabold mt-0.5">External Lab</div>
                          )}
                        </div>
                        <span className="text-sm font-bold flex-shrink-0">{inr(t.price)}</span>
                        <button onClick={() => removeTest(t.testId)} className="text-slate-900 dark:text-slate-900 hover:text-destructive transition-colors flex-shrink-0">
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {selectedPackages.length > 0 && (
                  <div className="border-t border-card-border bg-muted/5 px-4 py-3 space-y-2">
                    <div className="text-xs font-extrabold text-slate-900 dark:text-slate-900 uppercase tracking-wide">Selected Packages</div>
                    <div className="space-y-2">
                      {selectedPackages.map((pkg) => (
                        <div key={pkg.packageId} className="flex items-center justify-between gap-2 rounded-md border border-card-border px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-bold truncate">{pkg.name}</div>
                            <div className="text-xs text-slate-900 dark:text-slate-900">{pkg.testIds.length} tests included</div>
                          </div>
                          <button onClick={() => removePackage(pkg.packageId)} className="text-slate-900 dark:text-slate-900 hover:text-destructive transition-colors flex-shrink-0">
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 border-b border-card-border bg-card lg:sticky lg:bottom-0 lg:z-10 shadow-sm">
                <div className="px-4 py-2 h-10 border-b border-card-border bg-indigo-900 dark:bg-indigo-950 border-l-[4px] border-l-indigo-950 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Receipt size={14} className="text-white flex-shrink-0" />
                    <span className="text-sm font-bold uppercase tracking-wide text-white truncate">Bill Summary</span>
                  </div>
                  {selectedTests.length > 0 && (
                    <button
                      className="flex items-center gap-1 text-[11px] font-extrabold text-slate-900 hover:text-slate-900 dark:text-slate-900 dark:hover:text-white transition-colors flex-shrink-0"
                      onClick={fetchSuggestion}
                      disabled={suggLoading}
                    >
                      <Zap size={11} className={suggLoading ? "animate-pulse text-yellow-500" : ""} />
                      {suggLoading ? "Checking…" : "Auto-discount"}
                    </button>
                  )}
                </div>
                <div className="p-2.5 space-y-1.5 max-h-[32vh] overflow-y-auto">
                  {suggestion && suggestion.discount > 0 && (
                    <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2 text-xs">
                      <Zap size={11} className="text-green-600 flex-shrink-0" />
                      <span className="text-green-700 flex-1">
                        Discount rule: <strong>{suggestion.rule?.name}</strong> — {inr(suggestion.discount)} applicable
                      </span>
                      <button className="text-green-700 font-extrabold hover:underline" onClick={() => { setDiscountType("amount"); setDiscountValue(suggestion.discount); setSuggestion(null); }}>
                        Apply
                      </button>
                      <button onClick={() => setSuggestion(null)} className="text-slate-900 dark:text-slate-900 hover:text-foreground">
                        <X size={10} />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs"><span className="text-slate-900 dark:text-slate-900">Subtotal</span><span className="font-bold">{inr(subtotal)}</span></div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-900 dark:text-slate-900 w-14 flex-shrink-0">Discount</span>
                    <div className="flex items-center border border-card-border rounded-lg overflow-hidden flex-shrink-0">
                      <button onClick={() => setDiscountType("amount")} className={`px-2 py-1 text-xs flex items-center gap-0.5 transition-colors ${discountType === "amount" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><IndianRupee size={10} /> ₹</button>
                      <button onClick={() => setDiscountType("pct")} className={`px-2 py-1 text-xs flex items-center gap-0.5 transition-colors ${discountType === "pct" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><Percent size={10} /> %</button>
                    </div>
                    <Input type="number" min={0} max={discountType === "pct" ? 100 : subtotal} step="0.01" value={discountValue || ""} onChange={(e) => setDiscountValue(Number(e.target.value))} placeholder="0" className="h-7 text-xs flex-1 min-w-0" />
                    {subtotal > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        className="h-7 px-2 text-[10px] border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-bold flex-shrink-0"
                        onClick={() => {
                          setDiscountType("pct");
                          setDiscountValue(10);
                          const standardReason = discountReasons.find(r => r.isActive && r.label.toLowerCase().includes("standard"))
                            || discountReasons.find(r => r.isActive);
                          if (standardReason) {
                            setDiscountReason(standardReason.label);
                          } else {
                            setDiscountReason("Standard Discount");
                          }
                        }}
                        title="Apply 10% discount"
                      >
                        10%
                      </Button>
                    )}
                    {discountAmt > 0 && <span className="text-xs text-orange-900 font-bold flex-shrink-0">−{inr(discountAmt)}</span>}
                  </div>
                  {discountAmt > 0 && (
                    <div className="space-y-1 pl-[62px]">
                      <select
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                        className={`w-full h-7 text-xs border rounded-md px-2 bg-background ${!discountReason ? "border-red-400 text-red-600" : "border-card-border"}`}
                      >
                        <option value="">— Select reason * —</option>
                        {discountReasons.filter(r => r.isActive).map(r => <option key={r.id} value={r.label}>{r.label}</option>)}
                      </select>
                      <Input placeholder="Custom note (optional)…" value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} className="h-7 text-xs" maxLength={200} />
                    </div>
                  )}

                  {/* VIP Checkbox */}
                  <div className="flex items-center justify-between py-2 border-t border-card-border">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isVipActive}
                        onChange={(e) => setIsVipActive(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                      <span className="text-sm font-extrabold text-slate-700 dark:text-slate-900">⭐ VIP Priority Booking</span>
                    </label>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-card-border"><span className="font-bold text-sm text-slate-700 dark:text-slate-900 uppercase tracking-wide">Total</span><span className="text-2xl font-extrabold text-primary tabular-nums">{inr(total)}</span></div>

                  {/* ── Payment Collection — amount input first, toggle + modes below ── */}
                  <div className="mt-3 space-y-2" ref={paymentRef}>
                    {/* Primary amount input — always visible, large and prominent */}
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder={total.toFixed(2)}
                      value={paymentSplits[0]?.amount ?? ""}
                      onChange={(e) => setPaymentSplits((prev) => prev.map((s, i) => i === 0 ? { ...s, amount: e.target.value } : s))}
                      className="h-12 text-xl font-bold tracking-tight"
                    />
                    {/* Additional splits */}
                    {paymentSplits.slice(1).map((split, relIdx) => {
                      const idx = relIdx + 1;
                      return (
                        <div key={idx} className="grid grid-cols-[1.1fr_1fr_18px] gap-2 items-center">
                          <Select value={split.mode} onValueChange={(v) => setPaymentSplits((prev) => prev.map((s, i) => i === idx ? { ...s, mode: v } : s))}>
                            <SelectTrigger className="h-9 text-[11px]"><SelectValue /></SelectTrigger>
                            <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m} className="capitalize">{m === "online" ? "ONLINE GATEWAY" : m.toUpperCase()}</SelectItem>)}</SelectContent>
                          </Select>
                          <Input type="number" min={0} step="0.01" placeholder="0.00" value={split.amount} onChange={(e) => setPaymentSplits((prev) => prev.map((s, i) => i === idx ? { ...s, amount: e.target.value } : s))} className="h-9 text-[11px]" />
                          <button onClick={() => setPaymentSplits((prev) => prev.filter((_, i) => i !== idx))} className="text-slate-900 dark:text-slate-900 hover:text-destructive transition-colors"><X size={13} /></button>
                        </div>
                      );
                    })}
                    {paymentSplits.length < PAYMENT_MODES.length && (
                      <button onClick={() => setPaymentSplits((prev) => [...prev, { mode: "upi", amount: "" }])} className="text-[11px] text-primary hover:underline flex items-center gap-1">+ Split payment</button>
                    )}
                    {/* Balance / paid summary */}
                    {(balance > 0 || (paidTotal > 0 && total > 0)) && (
                      <div className="text-[11px]">
                        {balance > 0 ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-extrabold text-slate-900 dark:text-slate-900">Balance due</span>
                            <span className="text-red-600 text-lg font-extrabold animate-blink-fast">{inr(balance)}</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1 text-green-600 font-extrabold text-base animate-blink-fast">
                            <CheckCircle2 size={13} /> Fully paid — {inr(paidTotal)}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Toggle + mode buttons row */}
                    <div className="pt-1 border-t border-card-border space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setPayNow(!payNow)} className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${payNow ? "bg-primary" : "bg-muted"}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${payNow ? "translate-x-4" : "translate-x-0"}`} />
                          </button>
                          <span className="text-sm font-extrabold text-slate-700 dark:text-slate-900">Collect Payment Now</span>
                        </div>
                        <span className="text-xs text-slate-900 dark:text-slate-900 font-bold">Total {inr(total)}</span>
                      </div>
                      {payNow && (
                        <div className="flex items-center gap-1.5">
                          {PAYMENT_MODES.map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setPaymentSplits((prev) => prev.map((s, i) => i === 0 ? { ...s, mode: m } : s))}
                              className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-extrabold uppercase transition-all ${
                                paymentSplits[0]?.mode === m
                                  ? "bg-primary text-white border-primary shadow-sm"
                                  : "bg-card border-card-border text-slate-900 dark:text-slate-900 hover:bg-muted/60"
                              }`}
                            >
                              <span className="text-[9px]">{m === "cash" ? "💵" : m === "upi" ? "📱" : m === "card" ? "💳" : m === "cheque" ? "📝" : "🏥"}</span>
                              <span>{m}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 bg-card p-3 space-y-2 border-b border-card-border lg:rounded-b-xl">
                {/* ── Action buttons — always visible ── */}
                <div className="space-y-2 pt-1">
                  <div className="flex gap-1.5">
                    <Button
                      onClick={() => {
                        if (generatingRef.current || !!lastBillRef.current) return;
                        generatingRef.current = true;
                        printAfterSaveRef.current = true;
                        generateMut.mutate();
                      }}
                      disabled={!selectedPatient || selectedTests.length === 0 || generateMut.isPending || !!lastBill || (discountAmt > 0 && !discountReason) || (needsFormF && !clinic?.formFBillingPrompt && ((clinic?.formFGuardianRequired !== false && !husbandName.trim()) || (clinic?.formFAddressRequired !== false && !patientAddress.trim()))) || (needsDicom && !dicomFieldsComplete)}
                      className={`flex-1 h-12 text-lg font-bold border-0 shadow-lg disabled:shadow-none ${lastBill ? "bg-green-600 text-white disabled:bg-green-600 disabled:text-white disabled:opacity-80" : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white disabled:from-muted disabled:to-muted disabled:text-slate-900 dark:text-slate-900"}`}
                      title={lastBill ? `Bill ${lastBill.billNumber} already saved — click New to start a new bill` : discountAmt > 0 && !discountReason ? "Select a discount reason before generating bill" : needsFormF && !clinic?.formFBillingPrompt && ((clinic?.formFGuardianRequired !== false && !husbandName.trim()) || (clinic?.formFAddressRequired !== false && !patientAddress.trim())) ? "Fill required Form F fields (Husband Name & Address)" : needsDicom && !dicomFieldsComplete ? "Fill all 4 DICOM Worklist fields before generating bill" : undefined}
                    >
                      {lastBill ? <><CheckCircle2 size={18} className="mr-2" />Bill Saved ✓</> : generateMut.isPending ? <><Printer size={18} className="mr-2 animate-spin" />Saving…</> : <><Printer size={18} className="mr-2" />Save &amp; Print</>}
                    </Button>
                    <div className="flex gap-1.5 flex-1">
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (!lastBill) return;
                          await printBarcode(lastBill);
                        }}
                        disabled={!lastBill}
                        className="flex-1 h-12 text-[11px] px-2"
                      >
                        Barcode
                      </Button>
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (!lastBill) return;
                          await printToken(lastBill, clinic);
                        }}
                        disabled={!lastBill || !lastBill.tokenNo}
                        className="flex-1 h-12 text-[11px] px-2"
                      >
                        Token
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* ── Quick Test slot picker dialog ── */}
      <Dialog
        open={quickPickerSlot !== null}
        onOpenChange={(o) => { if (!o) { setQuickPickerSlot(null); setQuickPickerSearch(""); } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Assign test to Quick Slot {(quickPickerSlot ?? 0) + 1}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-900 dark:text-slate-900">
              Pick a frequently used test for this slot. Click the slot tab in Billing Desk to add this test instantly.
            </p>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-900 dark:text-slate-900" />
              <Input
                autoFocus
                placeholder="Search tests by name or code…"
                value={quickPickerSearch}
                onChange={(e) => setQuickPickerSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
            <div className="border border-card-border rounded-lg max-h-72 overflow-y-auto divide-y divide-card-border">
              {(() => {
                const q = quickPickerSearch.toLowerCase().trim();
                const list = allTests
                  .filter((t) => !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))
                  .slice(0, 100);
                if (list.length === 0) {
                  return <div className="px-3 py-4 text-xs text-slate-900 dark:text-slate-900 text-center">No tests match "{quickPickerSearch}"</div>;
                }
                return list.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (quickPickerSlot != null) assignQuickSlot(quickPickerSlot, t.id);
                      setQuickPickerSlot(null);
                      setQuickPickerSearch("");
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted/50"
                  >
                    <FlaskConical size={11} className="text-slate-900 dark:text-slate-900 flex-shrink-0" />
                    <span className="text-[10px] font-mono font-extrabold text-primary bg-primary/10 px-1.5 py-0.5 rounded flex-shrink-0">#{t.id}</span>
                    <span className="flex-1 font-bold truncate">{t.name}</span>
                    <span className="text-xs text-slate-900 dark:text-slate-900 font-mono flex-shrink-0">{t.code}</span>
                    <span className="text-xs font-extrabold flex-shrink-0">{inr(t.price)}</span>
                  </button>
                ));
              })()}
            </div>
            {quickPickerSlot != null && quickTestIds[quickPickerSlot] != null && (
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => {
                    if (quickPickerSlot != null) assignQuickSlot(quickPickerSlot, null);
                    setQuickPickerSlot(null);
                    setQuickPickerSearch("");
                  }}
                  className="text-xs text-destructive hover:underline"
                >
                  Clear this slot
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Quick Doctor slot picker dialog ── */}
      <Dialog
        open={quickDoctorPickerSlot !== null}
        onOpenChange={(o) => { if (!o) { setQuickDoctorPickerSlot(null); setQuickDoctorPickerSearch(""); } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Assign Doctor to Quick Slot {(quickDoctorPickerSlot ?? 0) + 1}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-900 dark:text-slate-900">
              Pick a frequently referred doctor for this quick-select slot. Click the slot in the Referral Doctor section to select instantly.
            </p>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-900 dark:text-slate-900" />
              <Input
                autoFocus
                placeholder="Search by name or specialization…"
                value={quickDoctorPickerSearch}
                onChange={(e) => setQuickDoctorPickerSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
            <div className="border border-card-border rounded-lg max-h-72 overflow-y-auto divide-y divide-card-border">
              {(() => {
                const q = quickDoctorPickerSearch.toLowerCase().trim();
                const list = doctors
                  .filter((d) => !q || d.name.toLowerCase().includes(q) || d.specialization.toLowerCase().includes(q))
                  .slice(0, 80);
                if (list.length === 0) {
                  return <div className="px-3 py-4 text-xs text-slate-900 dark:text-slate-900 text-center">No doctors match "{quickDoctorPickerSearch}"</div>;
                }
                return list.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      if (quickDoctorPickerSlot != null) assignQuickDoctor(quickDoctorPickerSlot, d.id);
                      setQuickDoctorPickerSlot(null);
                      setQuickDoctorPickerSearch("");
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left hover:bg-muted/50"
                  >
                    <div className="w-9 h-7 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 font-mono text-[11px] text-primary font-extrabold">
                      #{d.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold">Dr. {d.name}</div>
                      <div className="text-xs text-slate-900 dark:text-slate-900">{d.specialization}</div>
                    </div>
                  </button>
                ));
              })()}
            </div>
            {quickDoctorPickerSlot != null && quickDoctorIds[quickDoctorPickerSlot] != null && (
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => {
                    if (quickDoctorPickerSlot != null) assignQuickDoctor(quickDoctorPickerSlot, null);
                    setQuickDoctorPickerSlot(null);
                    setQuickDoctorPickerSearch("");
                  }}
                  className="text-xs text-destructive hover:underline"
                >
                  Clear this slot
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Form F Billing Popup (Feature 1) ── */}
      <Dialog open={formFPopupOpen} onOpenChange={setFormFPopupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-orange-600" />
              PCPNDT Form F — Additional Details Required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-900 dark:text-slate-900">
              This bill contains a PCPNDT-required test. Please collect the following details to auto-fill Form F.
            </p>
            <div className="space-y-1">
              <Label className="text-xs font-extrabold">
                Husband's / Father's Name {clinic?.formFGuardianRequired !== false && <span className="text-red-500">*</span>}
              </Label>
              <Input
                autoFocus
                value={formFPopupHusband}
                onChange={(e) => setFormFPopupHusband(e.target.value)}
                placeholder={clinic?.formFGuardianRequired !== false ? "Required for PCPNDT compliance" : "Optional — enter if available"}
                className="h-9 text-sm border-orange-300 focus:border-orange-500"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-extrabold">
                Full Address {clinic?.formFAddressRequired !== false && <span className="text-red-500">*</span>}
              </Label>
              <Input
                value={formFPopupAddress}
                onChange={(e) => setFormFPopupAddress(e.target.value)}
                placeholder={clinic?.formFAddressRequired !== false ? "Patient's full residential address" : "Optional — enter if available"}
                className="h-9 text-sm border-orange-300 focus:border-orange-500"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="flex-1 h-9"
                disabled={
                  (clinic?.formFGuardianRequired !== false && !formFPopupHusband.trim()) ||
                  (clinic?.formFAddressRequired !== false && !formFPopupAddress.trim())
                }
                onClick={async () => {
                  try {
                    await api.patch("/api/form-f/update-patient-data", {
                      billNumber: formFPopupBillNumber,
                      husbandFatherName: formFPopupHusband.trim(),
                      address: formFPopupAddress.trim(),
                    });
                    toast({ title: "Form F data saved" });
                    setFormFPopupOpen(false);
                    if (formFPopupPendingPrintRef.current) {
                      printAfterSaveRef.current = true;
                      const cachedClinic = queryClient.getQueryData<PrintClinic>(["clinic-settings"]);
                      const cachedPrinter = printerCfgCached ?? queryClient.getQueryData<PrinterCfg>(["printer-settings"]);
                      const lb = lastBill ?? lastBillRef.current;
                      if (!lb) { window.setTimeout(() => resetAll(), 1500); return; }
                      const clinicForPrint = cachedClinic ?? (clinic as PrintClinic);
                      const isBW = (cachedPrinter as { billPrinterType?: string } | undefined)?.billPrinterType === "bw";
                      const settings = loadBillPrintSettings();
                      const paid = lb.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
                      const billForPrint: PrintBillData = {
                        billNumber: lb.billNumber, subtotal: lb.subtotal,
                        discount: lb.discount, taxAmount: 0, totalAmount: lb.total,
                        paidAmount: paid, balanceAmount: Math.max(0, lb.total - paid),
                        createdAt: new Date().toISOString(),
                        patient: { firstName: lb.patient.firstName, lastName: lb.patient.lastName, patientId: lb.patient.patientId, phone: lb.patient.phone ?? null, ageValue: lb.patient.ageValue ?? null, ageUnit: lb.patient.ageUnit ?? null },
                        order: {
                          doctor: lb.doctorName ? { name: lb.doctorName } : null,
                          tests: lb.tests.map((t) => ({ price: t.price, status: "active", test: { name: t.name, code: t.code ?? "", category: t.category } })),
                        },
                        payments: lb.payments.map((p) => ({ method: p.mode, amount: Number(p.amount || 0) })),
                        tokenNo: lb.tokenNo ?? null, testTokens: lb.testTokens ?? null,
                      };
                      void QRCode.toDataURL(buildBillVerifyUrl(lb.billNumber), {
                        errorCorrectionLevel: "M", margin: 1, width: 256,
                        color: { dark: "#000000", light: "#ffffff" },
                      }).catch(() => "").then((qrUrl) => {
                        const paperSize = getAutoBillPaperSize(lb.tests.length, getBillPaperSize());
                        const html = buildBillPrintHtml({
                          bill: billForPrint, clinic: clinicForPrint, paperSize, isBW, qrDataUrl: qrUrl as string,
                          format: settings.defaultFormat,
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
                        });
                        if (settings.enablePreview) {
                          setPrintPreviewHtml(html);
                          setPrintPreviewOpen(true);
                        } else if (settings.directPrintAfterSave || settings.autoOpenPrintDialog) {
                          printViaIframe(html);
                        }
                      });
                    }
                    window.setTimeout(() => resetAll(), 1500);
                  } catch (err) {
                    toast({ title: "Failed to save Form F data", variant: "destructive" });
                  }
                }}
              >
                Save & Continue
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9"
                onClick={() => {
                  setFormFPopupOpen(false);
                  window.setTimeout(() => resetAll(), 1500);
                }}
              >
                Skip
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Online Gateway Payment Modal ── */}
      <Dialog open={gatewayModalOpen} onOpenChange={(open) => {
        if (!open && gatewayPaymentStatus === "pending") {
          if (!window.confirm("Close payment window? The payment request will remain active on the gateway.")) return;
        }
        setGatewayModalOpen(open);
      }}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <RefreshCcw className={`h-5 w-5 text-primary ${gatewayPaymentStatus === "pending" ? "animate-spin" : ""}`} />
              <span>Online Payment Collection</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {gatewayPaymentStatus === "pending" && !gatewayPaymentInfo && (
              <div className="text-center py-8 space-y-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
                <p className="text-xs text-muted-foreground">Initiating ICICI Orange Pay Request...</p>
              </div>
            )}

            {gatewayPaymentStatus === "pending" && gatewayPaymentInfo && (
              <div className="space-y-4">
                <div className="text-center bg-muted/40 p-4 rounded-lg border">
                  <span className="text-xs text-muted-foreground block">Amount to Collect</span>
                  <span className="text-2xl font-black text-primary block">{inr(gatewayPaymentInfo.amount)}</span>
                  <span className="text-[10px] text-muted-foreground font-mono mt-1 block">Ref: {gatewayPaymentInfo.txnRef}</span>
                </div>

                <div className="flex justify-center">
                  {gatewayQrUrl ? (
                    <div className="p-2 border rounded-lg bg-white shadow-sm">
                      <img src={gatewayQrUrl} alt="UPI QR" className="h-48 w-48 object-contain mx-auto" />
                      <div className="text-center text-[9px] text-muted-foreground mt-1 font-bold">Scan to Pay via UPI</div>
                    </div>
                  ) : (
                    <div className="h-48 w-48 border border-dashed rounded-lg flex items-center justify-center text-xs text-muted-foreground mx-auto">
                      Generating QR...
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-bold flex items-center gap-1 h-8"
                      onClick={() => {
                        void navigator.clipboard.writeText(gatewayPaymentInfo.redirectUrl);
                        toast({ title: "Link copied to clipboard!" });
                      }}
                    >
                      Copy Link
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-bold flex items-center gap-1 h-8 border-green-600 text-green-600 hover:bg-green-50"
                      onClick={() => {
                        const phoneStr = selectedPatient?.phone || "";
                        const cleanPhone = phoneStr.replace(/\D/g, "");
                        const msg = `Dear ${selectedPatient?.firstName || "Patient"}, please complete your payment of ${inr(gatewayPaymentInfo.amount)} for Care Diagnostics here: ${gatewayPaymentInfo.redirectUrl}`;
                        window.open(`https://wa.me/${cleanPhone ? `91${cleanPhone}` : ""}?text=${encodeURIComponent(msg)}`, "_blank");
                      }}
                    >
                      WhatsApp
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-bold flex items-center gap-1 h-8 border-sky-600 text-sky-600 hover:bg-sky-50"
                      onClick={() => {
                        toast({ title: "SMS Request Sent", description: `Link sent to ${selectedPatient?.phone}` });
                      }}
                    >
                      SMS
                    </Button>
                  </div>
                </div>

                <div className="text-center py-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    Waiting for customer payment...
                  </span>
                </div>
              </div>
            )}

            {gatewayPaymentStatus === "success" && (
              <div className="text-center py-6 space-y-3">
                <div className="h-12 w-12 rounded-full bg-green-50 border border-green-200 text-green-600 flex items-center justify-center mx-auto">
                  <Check className="h-6 w-6 stroke-[3]" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-green-700">Payment Successful</h3>
                  <p className="text-xs text-muted-foreground">The bill has been marked as paid. Printing receipt...</p>
                </div>
              </div>
            )}

            {gatewayPaymentStatus === "failed" && (
              <div className="text-center py-6 space-y-3">
                <div className="h-12 w-12 rounded-full bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto">
                  <X className="h-6 w-6 stroke-[3]" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-red-700">Payment Failed</h3>
                  <p className="text-xs text-muted-foreground">{gatewayPaymentError || "Something went wrong."}</p>
                </div>
                <Button variant="outline" size="sm" onClick={async () => {
                  if (lastBill) {
                    setGatewayPaymentStatus("pending");
                    setGatewayPaymentInfo(null);
                    try {
                      const res = await api.post<any>(`/api/bills/${lastBill.id}/initiate-gateway-payment`, {
                        amount: lastBill.total,
                        expiryMinutes,
                      });
                      setGatewayPaymentInfo({ ...res, billId: lastBill.id });
                    } catch (err: any) {
                      setGatewayPaymentStatus("failed");
                      setGatewayPaymentError(err.message);
                    }
                  }
                }} className="text-xs font-bold">
                  Retry Initiation
                </Button>
              </div>
            )}

            {gatewayPaymentStatus === "expired" && (
              <div className="text-center py-6 space-y-3">
                <div className="h-12 w-12 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-amber-700">Link Expired</h3>
                  <p className="text-xs text-muted-foreground">The checkout session has timed out. Please initiate again.</p>
                </div>
                <Button variant="outline" size="sm" onClick={async () => {
                  if (lastBill) {
                    setGatewayPaymentStatus("pending");
                    setGatewayPaymentInfo(null);
                    try {
                      const res = await api.post<any>(`/api/bills/${lastBill.id}/initiate-gateway-payment`, {
                        amount: lastBill.total,
                        expiryMinutes,
                      });
                      setGatewayPaymentInfo({ ...res, billId: lastBill.id });
                    } catch (err: any) {
                      setGatewayPaymentStatus("failed");
                      setGatewayPaymentError(err.message);
                    }
                  }
                }} className="text-xs font-bold">
                  Re-generate Link
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Print Preview Dialog ── */}
      <Dialog open={printPreviewOpen} onOpenChange={setPrintPreviewOpen}>
        <DialogContent className="max-w-3xl h-[80vh] p-0 flex flex-col">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle className="flex items-center justify-between">
              <span>Print Preview</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPrintPreviewOpen(false)}>
                  Close
                </Button>
                <Button size="sm" onClick={() => { printViaIframe(printPreviewHtml); setPrintPreviewOpen(false); }}>
                  <Printer size={14} className="mr-1" /> Print
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-4 bg-gray-100">
            <iframe
              title="Print Preview"
              srcDoc={printPreviewHtml}
              style={{ width: "100%", height: "100%", border: "1px solid #ddd", background: "#fff" }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type BillSearchResult = {
  id: number;
  billNumber: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
  patientName: string | null;
  patientId: string | null;
  phone: string | null;
};

function BillSearchBox() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [dueOnly, setDueOnly] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const { data: results = [], isFetching } = useQuery<BillSearchResult[]>({
    queryKey: ["bill-search", q, dueOnly],
    queryFn: () => api.get(`/api/bills/search?q=${encodeURIComponent(q)}&dueOnly=${dueOnly ? 1 : 0}`),
    enabled: q.trim().length >= 2,
    staleTime: 5_000,
  });

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-900 dark:text-slate-900" />
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search bill # / patient name…"
          className="h-8 pl-7 pr-3 w-72 text-sm"
        />
      </div>
      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 top-full mt-1 w-[420px] bg-card border border-card-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-card-border flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={dueOnly}
                onChange={(e) => setDueOnly(e.target.checked)}
                className="h-3 w-3"
              />
              <span className="text-slate-900 dark:text-slate-900">Dues only</span>
            </label>
            <span className="text-[10px] text-slate-900 dark:text-slate-900">
              {isFetching ? "Searching…" : `${results.length} match${results.length === 1 ? "" : "es"}`}
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-card-border">
            {results.length === 0 && !isFetching ? (
              <div className="px-4 py-6 text-xs text-slate-900 dark:text-slate-900 text-center">No bills found</div>
            ) : (
              results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { setOpen(false); setQ(""); navigate(`/billing/${r.id}`); }}
                  className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-center gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-primary">{r.billNumber}</span>
                      {r.balanceAmount > 0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-white font-bold">DUE</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-800 font-bold">PAID</span>
                      )}
                    </div>
                    <div className="text-xs text-foreground mt-0.5 truncate">
                      {r.patientName ?? "—"}
                      <span className="text-slate-900 dark:text-slate-900"> · {r.patientId ?? ""} {r.phone ? `· ${r.phone}` : ""}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-slate-900 dark:text-slate-900">Total {inr(r.totalAmount)}</div>
                    <div className={`text-sm font-extrabold ${r.balanceAmount > 0 ? "text-orange-900" : "text-green-600"}`}>
                      Bal {inr(r.balanceAmount)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Today's Collections Panel — right column, below Save & Print
// Dues shown first for easy payment follow-up
// ──────────────────────────────────────────────────────
function TodayCollectionsPanel() {
  const [, navigate] = useLocation();
  // toLocaleDateString('en-CA') gives ISO-like format in local timezone
  const todayIso = new Date().toLocaleDateString("en-CA");
  // Server-side filter by today's date so the panel reliably shows all bills
  // from today regardless of how many earlier bills exist in the database.
  const { data, isLoading } = useQuery<{ bills: RecentBill[] }>({
    queryKey: ["today-collections-panel", todayIso],
    queryFn: () => api.get<{ bills: RecentBill[] }>(`/api/bills?dateFrom=${todayIso}&dateTo=${todayIso}&excludeCancelled=true&limit=100&page=1`),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Dues on top, within each group newest first
  const sorted = [...(data?.bills ?? [])].sort((a, b) => {
    const aDue = a.balanceAmount > 0 ? 0 : 1;
    const bDue = b.balanceAmount > 0 ? 0 : 1;
    if (aDue !== bDue) return aDue - bDue;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const dueCount = sorted.filter((b) => b.balanceAmount > 0 && b.status !== "cancelled").length;
  const totalDue = sorted.reduce((s, b) => s + (b.status === "cancelled" ? 0 : b.balanceAmount), 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-card-border bg-card/50">
      <div className="flex-shrink-0 px-4 py-2 h-10 flex items-center gap-2 text-sm font-bold uppercase tracking-wide border-b border-card-border bg-blue-900 dark:bg-blue-950 border-l-[4px] border-l-blue-950">
        <Receipt size={14} className="text-white" />
        <span className="text-white">Today's Collections</span>
        <span className="text-slate-900 dark:text-slate-900 font-bold ml-0.5">{sorted.length}</span>
        {dueCount > 0 && (
          <span className="ml-auto text-orange-900 font-extrabold tabular-nums">
            {dueCount} due · {inr(totalDue)}
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-card-border" aria-live="polite">
        {isLoading ? (
          <div className="px-3 py-4 text-xs text-slate-900 dark:text-slate-900 text-center">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="px-3 py-4 text-xs text-slate-900 dark:text-slate-900 text-center">No bills today yet</div>
        ) : (
          sorted.map((b) => {
            const due = b.balanceAmount > 0 && b.status !== "cancelled";
            const time = new Date(b.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => navigate(`/billing/${b.id}`)}
                className={`w-full text-left px-3 py-1.5 transition-colors flex items-center gap-2 ${
                  due ? "hover:bg-orange-50 dark:hover:bg-orange-950/20" : "hover:bg-muted/40"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-extrabold text-primary truncate">{b.billNumber}</span>
                    {due ? (
                      <span className="flex-shrink-0 text-[9px] px-1 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-white font-extrabold">DUE</span>
                    ) : (
                      <span className="flex-shrink-0 text-[9px] px-1 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-800 font-extrabold">PAID</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-900 dark:text-slate-900 truncate">
                    {b.patient ? `${b.patient.firstName} ${b.patient.lastName}` : "—"}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 text-[10px]">
                  <div className="text-slate-900 dark:text-slate-900">{inr(b.totalAmount)}</div>
                  {due && <div className="font-extrabold text-orange-900">Bal {inr(b.balanceAmount)}</div>}
                  <div className="text-[9px] text-slate-900 dark:text-slate-900 tabular-nums">{time}</div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Today's Recent Bills — fills the lower-left area
// ──────────────────────────────────────────────────────
type RecentBill = {
  id: number;
  billNumber: string;
  totalAmount: number;
  balanceAmount: number;
  status: string;
  createdAt: string;
  patient?: { firstName: string; lastName: string; patientId: string } | null;
};

function RecentBillsPanel() {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useQuery<{ bills: RecentBill[] }>({
    queryKey: ["recent-bills-today"],
    queryFn: () => api.get<{ bills: RecentBill[] }>("/api/bills?limit=20&page=1"),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const today = new Date().toDateString();
  const bills = (data?.bills ?? []).filter((b) => new Date(b.createdAt).toDateString() === today && b.status !== "cancelled");

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-card-border bg-muted/20 flex items-center gap-2 text-sm font-extrabold">
        <Receipt size={14} className="text-primary" />
        <span>Today's Recent Bills</span>
        <span className="ml-auto text-xs font-bold text-slate-900 dark:text-slate-900">{bills.length}</span>
      </div>
      <div className="divide-y divide-card-border max-h-[480px] overflow-y-auto" aria-live="polite">
        {isLoading ? (
          <div className="px-4 py-6 text-xs text-slate-900 dark:text-slate-900 text-center">Loading…</div>
        ) : isError ? (
          <div className="px-4 py-6 text-xs text-destructive text-center">Couldn't load recent bills. Check your connection.</div>
        ) : bills.length === 0 ? (
          <div className="px-4 py-6 text-xs text-slate-900 dark:text-slate-900 text-center">No bills generated today yet</div>
        ) : (
          bills.map((b) => {
            const due = b.balanceAmount > 0;
            const time = new Date(b.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => navigate(`/billing/${b.id}`)}
                className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-extrabold text-primary truncate">{b.billNumber}</span>
                    {due ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-white font-bold">DUE</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-800 font-bold">PAID</span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-900 dark:text-slate-900 tabular-nums">{time}</span>
                  </div>
                  <div className="text-xs text-foreground mt-0.5 truncate">
                    {b.patient ? `${b.patient.firstName} ${b.patient.lastName}` : "—"}
                    {b.patient?.patientId && <span className="text-slate-900 dark:text-slate-900"> · {b.patient.patientId}</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-slate-900 dark:text-slate-900">{inr(b.totalAmount)}</div>
                  {due && <div className="text-xs font-extrabold text-orange-900">Bal {inr(b.balanceAmount)}</div>}
                </div>
                <ExternalLink size={11} className="text-slate-900 dark:text-slate-900 flex-shrink-0" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
