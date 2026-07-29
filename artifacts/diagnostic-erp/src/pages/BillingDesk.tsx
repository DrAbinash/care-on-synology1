import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import "@/styles/billingDeskModern.css"; // Modern Pro skin (presentation only)
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api, NetworkError } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import { enqueueBill, QueuedForSyncError } from "@/lib/offlineBillingQueue";
import { readStaffSession, isFeatureEnabled, isOwnerRole } from "@/lib/staffSession";
import { genUUID } from "@/lib/utils";
import { getBillPaperSize } from "@/lib/billPrintLayout";
import { getAutoBillPaperSize } from "@/lib/billPrintSettings";
import {
  buildBillPrintHtml,
  printViaIframe,
  type PrintBillData,
  type PrintClinic,
} from "@/lib/printBill";
import {
  loadBillPrintSettings,
  parseGlobalBillPrintSettings,
  printLayoutOpts,
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
import { RegisterPatientForm, type NewPatientData } from "@/components/RegisterPatientForm";
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
  ChevronUp,
  Scan,
  FileText,
  Settings2,
  ClipboardList,
  ChevronDown,
  Monitor,
  CreditCard,
  Barcode,
  Save,
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
// "cheque" was removed — this clinic no longer accepts cheque payments.
const PAYMENT_MODES  = ["cash", "card", "upi", "insurance", "online"];
const BLOOD_GROUPS   = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const GENDERS        = ["male", "female"];

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const today = () => new Date().toLocaleDateString("en-IN", {
  weekday: "short", year: "numeric", month: "short", day: "numeric",
});

// This ERP SPA is mounted under a base path in production (BASE_URL="/erp/",
// see main.tsx/App.tsx) but the API server also serves a completely separate
// public clinic-website SPA at "/". A root-relative path like
// "/display/payment-qr" therefore does NOT resolve inside this app — it gets
// swallowed by the clinic-website's catch-all route (its own generic 404
// page) instead of this app's Display/PaymentQrDisplay routes. Every
// in-app-relative URL opened in a new window/tab must go through this.
const erpPath = (path: string) =>
  `${(import.meta as { env: { BASE_URL: string } }).env.BASE_URL.replace(/\/$/, "")}${path}`;

// ── Second-monitor auto-placement ──────────────────────────────────────────
// Opens `url` positioned on the second monitor automatically, with no manual
// dragging required, using the best method the browser/connection allows:
//
//  1. Window Management API (window.getScreenDetails) — exact placement on
//     whichever screen isn't currently showing this window, with automatic
//     fullscreen. Only available in a SECURE context (https://) in Chrome/Edge
//     100+, and only after a one-time browser permission prompt. This ERP
//     currently runs on plain http:// on the LAN, so this path is unavailable
//     today — it activates automatically the moment the clinic moves to
//     HTTPS (e.g. via Tailscale HTTPS or a proper certificate), no code
//     changes needed then.
//  2. Practical fallback (works today, over plain HTTP, no permissions):
//     assumes the second monitor is extended to the right of the primary —
//     the default Windows/most-common clinic PC setup — and opens the window
//     at that offset, sized to fill a typical monitor. Not pixel-perfect on
//     unusual monitor arrangements, but lands correctly for the common case
//     with zero dragging. A "Fullscreen" button on the display page itself
//     (one click, no drag) covers the rest.
async function openOnSecondMonitor(url: string, windowName: string): Promise<void> {
  const wm = (window as unknown as { getScreenDetails?: () => Promise<{
    screens: Array<{ availLeft: number; availTop: number; availWidth: number; availHeight: number }>;
    currentScreen: { availLeft: number; availTop: number };
  }> }).getScreenDetails;

  if (wm && window.isSecureContext) {
    try {
      const details = await wm();
      const other = details.screens.find(
        (s) => s.availLeft !== details.currentScreen.availLeft || s.availTop !== details.currentScreen.availTop
      ) ?? details.screens[0];
      const win = window.open(
        url,
        windowName,
        `left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`
      );
      if (win) {
        win.addEventListener("load", () => {
          try { win.document.documentElement.requestFullscreen?.(); } catch { /* best effort */ }
        });
        return;
      }
    } catch {
      // Permission denied or API unavailable this call — fall through to heuristic.
    }
  }

  // Fallback: place just past the primary screen's right edge.
  const left = window.screen.width;
  window.open(url, windowName, `left=${left},top=0,width=1024,height=900`);
}

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
  // Only commit to the (ageValue, ageUnit) path when it will produce a real
  // string — a stored value of 0 (from a blank field on registration) must
  // fall through to dateOfBirth instead of short-circuiting to "".
  if (ageValue != null && ageValue > 0 && ageUnit) {
    if (ageUnit === "years") return `${ageValue} Yrs`;
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
    firstName: "", lastName: "", phone: "", gender: "" as "" | "male" | "female",
    ageValue: "", ageUnit: "years" as "years" | "months" | "days",
    email: "", address: "", bloodGroup: "",
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef  = useRef<HTMLDivElement>(null);
  const paymentRef = useRef<HTMLDivElement>(null);
  const testSearchRef = useRef<HTMLInputElement>(null);

  // ── Doctor search state ─────────────────────────────
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [doctorMode, setDoctorMode] = useState<"self" | "doctor">("doctor");
  const [doctorSearch, setDoctorSearch] = useState("");
  const [doctorSearchOpen, setDoctorSearchOpen] = useState(false);
  const doctorRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState("");

  // ── New patient form visibility ──────────────────────
  // ── Layout mode (unified / stepped) ─────────────────
  const [layoutMode, setLayoutMode] = useState<"unified" | "stepped" | "compact" | "classic" | "modern">(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("billingDeskLayout") : null;
    return (stored as "unified" | "stepped" | "compact" | "classic" | "modern") || "unified";
  });
  useEffect(() => {
    const handler = () => {
      const stored = typeof window !== "undefined" ? localStorage.getItem("billingDeskLayout") : null;
      setLayoutMode((stored as "unified" | "stepped" | "compact" | "classic" | "modern") || "unified");
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

  // ── Reactive feature flags ────────────────────────────────────────────────
  // These were previously plain derived values (isFeatureEnabled() called once
  // at render). The bug: when Settings wrote to localStorage via setFeatureFlag(),
  // nothing triggered a re-render — so BillingDesk never picked up the change
  // until a full page refresh.
  //
  // Fix: each flag lives in its own useState, seeded from localStorage on mount.
  // A single "featureFlagsChanged" event listener (dispatched by setFeatureFlag)
  // re-reads all flags at once when any setting changes. The "storage" event is
  // also handled for cross-tab propagation (e.g. if the user has Settings open
  // in one tab and BillingDesk open in another).
  const readFlags = () => ({
    autoAdvance:          isStepped && isFeatureEnabled("billingDeskAutoAdvance"),
    showQuickTests:       isFeatureEnabled("billingDeskQuickTests") !== false,
    showPackages:         isFeatureEnabled("billingDeskShowPackages") !== false,
    stickyBillSummary:    isFeatureEnabled("billingDeskStickyBillSummary") !== false,
    stickyPayment:        isFeatureEnabled("billingDeskStickyPayment") !== false,
    denseTestList:        isFeatureEnabled("billingDeskDenseTestList"),
    largeFont:            isFeatureEnabled("billingDeskLargeFont"),
    showOptionalFields:   isFeatureEnabled("billingDeskShowOptionalFields"),
    keyboardNav:          isFeatureEnabled("billingDeskKeyboardNav") !== false,
    autoFocusNext:        isFeatureEnabled("billingDeskAutoFocus") !== false,
  });

  const [billingFlags, setBillingFlags] = useState(readFlags);

  useEffect(() => {
    function syncFlags() { setBillingFlags(readFlags()); }
    // featureFlagsChanged: fires in the same tab when setFeatureFlag() is called
    window.addEventListener("featureFlagsChanged", syncFlags);
    // storage: fires when another tab writes to localStorage
    window.addEventListener("storage", syncFlags);
    return () => {
      window.removeEventListener("featureFlagsChanged", syncFlags);
      window.removeEventListener("storage", syncFlags);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStepped]);

  // Destructure for easy use throughout the component
  const {
    autoAdvance,
    showQuickTestsSetting,
    showPackagesSetting,
    stickyBillSummary,
    stickyPayment,
    denseTestList,
    largeFont,
    showOptionalFields,
    keyboardNav,
    autoFocusNext,
  } = {
    ...billingFlags,
    showQuickTestsSetting: billingFlags.showQuickTests,
    showPackagesSetting:   billingFlags.showPackages,
  };
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

  const prevPatientIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!selectedPatient) {
      prevPatientIdRef.current = null;
      return;
    }
    if (selectedPatient.id === prevPatientIdRef.current) return;
    prevPatientIdRef.current = selectedPatient.id;
    if (isStepped && autoAdvance && currentStep === 1) advanceStep();
    if (autoFocusNext) {
      window.setTimeout(() => testSearchRef.current?.focus(), 150);
    }
  }, [selectedPatient, isStepped, autoAdvance, currentStep, autoFocusNext, advanceStep]);

  const prevDoctorIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (doctorId == null) {
      prevDoctorIdRef.current = null;
      return;
    }
    if (doctorId === prevDoctorIdRef.current) return;
    prevDoctorIdRef.current = doctorId;
    if (isStepped && autoAdvance && currentStep === 2) advanceStep();
  }, [doctorId, isStepped, autoAdvance, currentStep, advanceStep]);

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
  // The server enforces the actual discount cap (see the maxDiscount check in
  // POST /api/bills) — this is read-only, staff-facing context so a non-admin
  // user knows their limit BEFORE typing a discount and hitting a save error,
  // instead of only finding out from the 403 after the fact.
  const myStaffSession = useMemo(() => readStaffSession(), []);
  const myIsFullAccess = isOwnerRole(myStaffSession);
  const myMaxDiscountPct = myStaffSession?.user.maxDiscount ?? 0;

  const [discountType, setDiscountType]   = useState<"amount" | "pct">("amount");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [discountReason, setDiscountReason] = useState<string>("");
  const [discountNote, setDiscountNote]     = useState<string>("");
  const [payNow, setPayNow]               = useState(true);
  const [isVipActive, setIsVipActive]     = useState(false);
  // Collapse panels once the user moves on to the next step — mirrors the
  // Register Patient form's auto-collapse-after-selection behavior. Both
  // default open; user can always re-expand by clicking the header.
  const [testsCollapsed, setTestsCollapsed]     = useState(false);
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [doctorCollapsed, setDoctorCollapsed]   = useState(false);
  const [paymentSplits, setPaymentSplits] = useState<PaySplit[]>([{ mode: "cash", amount: "" }]);
  // Primary collect amount auto-copies net total until staff edits it (partial pay).
  const paymentAmountTouched = useRef(false);
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
    billPrintSettingsJson?: string | null;
  }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
  });

  // VIP surcharge % — same clinic setting Online Booking uses (Settings →
  // Online Booking → VIP Priority Booking Premium). Kept as its own query
  // (not merged into the public /branding endpoint above) since pricing
  // configuration shouldn't be exposed on an unauthenticated route.
  const { data: vipSettings } = useQuery<{ vipPercentage?: string }>({
    queryKey: ["clinic-settings-vip"],
    queryFn: () => api.get("/api/clinic-settings"),
    staleTime: 5 * 60_000,
  });
  const vipPercentage = vipSettings?.vipPercentage ? Number(vipSettings.vipPercentage) : 50;

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
    // redirectUrl is the full ICICI hosted-payment-page URL (tranCtx already
    // embedded as a query param by the backend) — the same value Online
    // Booking (book.tsx) and Kiosk Mode (Kiosk.tsx) already navigate to
    // successfully. tranCtx alone is a bare opaque token, not a URL; a QR
    // encoding it just displays text instead of opening the gateway.
    const qrData = gatewayPaymentInfo.redirectUrl;
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

  // ── Customer-facing payment display (networked device) ────────────────────
  // A physical screen (Android tablet, standalone monitor) is set up ONCE,
  // pointed at /display/payment-qr/:counterKey in kiosk/fullscreen mode, and
  // independently pulls its own live state over SSE — same architecture as
  // Queue Display (TV). This workstation just PUSHES state to that feed; it
  // never drives the screen directly. counterKey lets more than one billing
  // counter each have its own customer-facing display.
  const [paymentCounterKey, setPaymentCounterKey] = useState<string>(
    () => localStorage.getItem("diagnosticErp:paymentDisplayCounterKey") || "counter1",
  );
  useEffect(() => {
    localStorage.setItem("diagnosticErp:paymentDisplayCounterKey", paymentCounterKey);
  }, [paymentCounterKey]);

  // Display token — a networked customer-facing device (tablet/monitor) has no
  // staff login, so /api/payment-display/:counterKey (snapshot + SSE) 401s
  // without it and the screen silently stays on "Waiting for a payment…". The
  // token authorizes that device; append it to every URL we hand to the screen.
  const { data: displayTokenData } = useQuery<{ token: string; hint: string }>({
    queryKey: ["display-access-token"],
    queryFn: () => api.get("/api/display/token"),
    staleTime: Infinity,
  });
  const paymentDisplayToken = displayTokenData?.token ?? "";
  const paymentDisplayTokenQs = paymentDisplayToken ? `?displayToken=${encodeURIComponent(paymentDisplayToken)}` : "";
  const paymentDisplayUrl = `${window.location.origin}${erpPath(`/display/payment-qr/${encodeURIComponent(paymentCounterKey)}`)}${paymentDisplayTokenQs}`;

  const pushedShowTxnRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gatewayPaymentInfo || !gatewayQrUrl) return;
    if (pushedShowTxnRef.current === gatewayPaymentInfo.txnRef) return;
    pushedShowTxnRef.current = gatewayPaymentInfo.txnRef;
    api.post(`/api/payment-display/${encodeURIComponent(paymentCounterKey)}/show`, {
      qrData: gatewayPaymentInfo.redirectUrl,
      amount: gatewayPaymentInfo.amount,
      txnRef: gatewayPaymentInfo.txnRef,
      patientName: selectedPatient ? `${selectedPatient.firstName} ${selectedPatient.lastName ?? ""}`.trim() : undefined,
      billNumber: lastBillLocalRef.current?.billNumber,
      expiryTime: gatewayPaymentInfo.expiryTime,
    }).catch(() => { /* customer display push is best-effort — never blocks billing */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayPaymentInfo, gatewayQrUrl, paymentCounterKey]);

  const pushedStatusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gatewayPaymentInfo || gatewayPaymentStatus === "pending") return;
    const key = `${gatewayPaymentInfo.txnRef}:${gatewayPaymentStatus}`;
    if (pushedStatusKeyRef.current === key) return;
    pushedStatusKeyRef.current = key;
    api.post(`/api/payment-display/${encodeURIComponent(paymentCounterKey)}/status`, {
      status: gatewayPaymentStatus,
    }).catch(() => { /* best-effort */ });
  }, [gatewayPaymentInfo, gatewayPaymentStatus, paymentCounterKey]);

  // Return the customer display to its idle screen once the dialog closes
  // (success, manual cancel, or auto-close after success) — skips the
  // spurious clear that would otherwise fire on first mount.
  const gatewayModalWasOpenRef = useRef(false);
  useEffect(() => {
    if (gatewayModalOpen) { gatewayModalWasOpenRef.current = true; return; }
    if (!gatewayModalWasOpenRef.current) return;
    api.post(`/api/payment-display/${encodeURIComponent(paymentCounterKey)}/clear`, {}).catch(() => {});
  }, [gatewayModalOpen, paymentCounterKey]);

  // Same-PC fallback: opens the customer display's durable URL in a window
  // positioned on a second monitor cable-connected to THIS workstation. For
  // a separate networked device (tablet, standalone monitor), just point its
  // browser at that same URL once — no manual re-opening needed there.
  const openGatewayQrOnSecondScreen = () => {
    // Carry the display token so the opened screen authorizes even when it is a
    // separate device with no staff session (matches Queue Display behaviour).
    void openOnSecondMonitor(erpPath(`/display/payment-qr/${encodeURIComponent(paymentCounterKey)}`) + paymentDisplayTokenQs, "paymentQrDisplay");
  };

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
                  ageValue: updatedBill.patient.ageValue ?? null,
                  ageUnit: updatedBill.patient.ageUnit ?? null,
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

              const cachedClinic = queryClient.getQueryData<PrintClinic>(["clinic-settings"]) || (clinic as PrintClinic);
              // Base the effective settings on the clinic-wide server blob so
              // this counter prints the paper size the admin configured (and
              // verified in the Settings preview) — not a stale per-browser
              // default. An A5 default job on an A4-loaded tray is what made
              // bills print rotated 90°.
              const settings = loadBillPrintSettings(parseGlobalBillPrintSettings(cachedClinic?.billPrintSettingsJson));
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
                  // Honor the paper size/orientation chosen in Settings →
                  // Billing Print (e.g. A5 landscape for a B&W printer)
                  // instead of always forcing A5 portrait — the auto
                  // A4-switch by test count still applies unless the user
                  // explicitly forced A4/half-A4.
                  const forcedPaperSize = settings.defaultPaperSize === "A4" || settings.defaultPaperSize === "half-a4" ? settings.defaultPaperSize : undefined;
                  const effectivePaperSize = getAutoBillPaperSize(updatedBill.order?.tests?.length || 1, forcedPaperSize, settings.autoA4Threshold ?? 5);
                  const paperSize = (effectivePaperSize === "A4" ? "A4" : "A5") as "A4" | "A5";
                  const orientation = paperSize === "A5" && settings.defaultPaperSize === "A5-landscape" ? "landscape" : "portrait";
                  const html = buildBillPrintHtml({
                    bill: billForPrint,
                    clinic: cachedClinic,
                    paperSize,
                    orientation,
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
                    showQueueToken: settings.showQueueTokenOnBill,
                    ...printLayoutOpts(settings),
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


  // ── Quick Test Tabs (8 customizable slots) ─────────
  const quickTestIds: (number | null)[] = useMemo(() => {
    try {
      const arr = JSON.parse(clinic?.quickTestIds ?? "[null,null,null,null,null,null,null,null]");
      const out: (number | null)[] = Array.isArray(arr)
        ? arr.slice(0, 8).map((v: unknown) => (typeof v === "number" ? v : null))
        : [];
      while (out.length < 8) out.push(null);
      return out;
    } catch { return [null, null, null, null, null, null, null, null]; }
  }, [clinic?.quickTestIds]);
  const [quickPickerSlot, setQuickPickerSlot] = useState<number | null>(null);
  const [quickPickerSearch, setQuickPickerSearch] = useState("");

  // ── Quick Doctor Slots (8 slots, per-STAFF-MEMBER layout — each user has
  // their own; server is the source of truth, localStorage is only a fast
  // first-paint cache). Was previously synced from clinic-wide
  // clinic.quickDoctorIds via PUT /api/clinic-settings, which (a) the public
  // /branding endpoint never actually returned (the "sync from server" effect
  // below was silently dead code) and (b) required the /settings.clinic admin
  // permission to write, so any non-admin staff got a 403 "Failed to save
  // quick doctor". Now backed by /api/my/quick-doctors — one row per staff
  // member, writable by that staff member alone (requireStaffAuth only). ──
  const { data: myQuickDoctors } = useQuery<{ quickDoctorIds?: string }>({
    queryKey: ["my-quick-doctors"],
    queryFn: () => api.get("/api/my/quick-doctors"),
  });
  const [quickDoctorIds, setQuickDoctorIds] = useState<(number | null)[]>(() => {
    try {
      const stored = localStorage.getItem("billingDesk:quickDoctors");
      const arr = stored ? JSON.parse(stored) : [null, null, null, null, null, null, null, null];
      const out: (number | null)[] = Array.isArray(arr)
        ? arr.slice(0, 8).map((v: unknown) => (typeof v === "number" ? v : null))
        : [];
      while (out.length < 8) out.push(null);
      return out;
    } catch { return [null, null, null, null, null, null, null, null]; }
  });
  // Sync from the server once the caller's own quick-doctor layout loads —
  // this is the actual saved configuration (assignQuickDoctorSlot below
  // writes here via PUT /api/my/quick-doctors). Without this, a browser whose
  // localStorage was ever cleared — or a different device — would show empty
  // slots even though the configuration was successfully saved earlier.
  useEffect(() => {
    if (!myQuickDoctors?.quickDoctorIds) return;
    try {
      const arr = JSON.parse(myQuickDoctors.quickDoctorIds);
      if (Array.isArray(arr)) {
        const out = arr.slice(0, 8).map((v: unknown) => (typeof v === "number" ? v : null));
        while (out.length < 8) out.push(null);
        setQuickDoctorIds(out);
        localStorage.setItem("billingDesk:quickDoctors", JSON.stringify(out));
      }
    } catch { /* keep current state on parse failure */ }
  }, [myQuickDoctors?.quickDoctorIds]);
  const [quickDoctorPickerSlot, setQuickDoctorPickerSlot] = useState<number | null>(null);
  const [quickDoctorPickerSearch, setQuickDoctorPickerSearch] = useState("");
  // (Register New Patient form is now always visible — no toggle state needed)

  // isError/refetch are surfaced in the doctor-search dropdown and the Quick
  // Doctor slot picker below — without them, a failed /api/doctors request
  // (network blip, backend down) renders as an empty list, which is visually
  // identical to "no doctors registered yet" and gives staff no way to tell
  // a real outage apart from a genuinely empty roster.
  const { data: doctors = [], isError: doctorsError, refetch: refetchDoctors } = useQuery<Doctor[]>({
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
      if (!body.gender) {
        throw new Error("Please select sex before registering the patient.");
      }
      // Only treat the age field as a real value when the user typed
      // something. Number("") is 0, which used to silently save
      // ageValue=0 + dateOfBirth="<currentYear>-01-01" — corrupting the
      // record so bill print later couldn't display any age.
      const rawAge = String(body.ageValue ?? "").trim();
      const ageVal = rawAge === "" ? NaN : Number(rawAge);
      const unit = body.ageUnit;
      let dateOfBirth = "";
      let ageValue: number | null = null;
      let ageUnit: string | null = null;
      if (!isNaN(ageVal) && ageVal > 0) {
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
      setNewPatient({ firstName: "", lastName: "", phone: "", gender: "", ageValue: "", ageUnit: "years", email: "", address: "", bloodGroup: "" });
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

  // Form F save mutation — used by the Form F dialog popup
  const formFSaveMut = useMutation({
    mutationFn: (body: { billNumber: string; husbandName: string; address: string }) =>
      api.post("/api/form-f/save", body),
    onSuccess: () => {
      setFormFPopupOpen(false);
      toast({ title: "Form F saved" });
      finishBillSaveFlowRef.current();
    },
    onError: (err: Error) => {
      toast({ title: "Form F save failed", description: err.message, variant: "destructive" });
    },
  });

  // Manual gateway status check — called by the "Check Status" button in the
  // gateway payment modal. The polling useEffect runs automatically but a manual
  // check lets the staff trigger it immediately.
  const checkGatewayStatus = async (billId: number, txnRef: string) => {
    try {
      const res = await api.get<{ status: "pending" | "success" | "failed" | "expired"; error?: string }>(
        `/api/bills/gateway-payment-status/${encodeURIComponent(txnRef)}`
      );
      if (res.status === "success") {
        setGatewayPaymentStatus("success");
        toast({ title: "Payment confirmed!" });
      } else if (res.status === "failed" || res.status === "expired") {
        setGatewayPaymentStatus(res.status);
        setGatewayPaymentError(res.error ?? "Payment not completed");
      }
    } catch (err) {
      console.error("[gateway] manual status check failed:", err);
    }
  };

  const handleGatewayChangePaymentMode = () => {
    const billId = gatewayPaymentInfo?.billId ?? lastBill?.id;
    setGatewayModalOpen(false);
    setGatewayPaymentInfo(null);
    setGatewayPaymentStatus("pending");
    setGatewayPaymentError("");
    if (billId) navigate(`/billing/${billId}`);
  };

  const queryClient = useQueryClient();
  const printAfterSaveRef = useRef(false);
  const saveAndNextRef = useRef(false);
  const finishBillSaveFlowRef = useRef<() => void>(() => {});
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

      // Generate a single UUID for this billing attempt. Both the order and bill
      // POST carry this key. If either request times out and the browser retries,
      // the server will return the already-created record instead of a duplicate.
      // The key is NOT persisted across page reloads — each new billing attempt
      // (after resetAll) generates a fresh UUID, which is the correct behaviour.
      const clientRef = genUUID();

      // Built up front (not inline in the api.post() calls below) so the exact
      // same payloads can be handed to enqueueBill() for later offline replay
      // if either request below fails with a NetworkError.
      //
      // 1. Order body (with custom per-test prices to preserve package discounts
      //    AND VIP surcharge — same approach self-registration.ts uses for Online
      //    Booking: inflate each test's price by the VIP multiplier so the bill
      //    total the backend computes naturally includes the surcharge without
      //    any backend changes).
      const vipMultiplier = isVipActive ? 1 + (vipPercentage / 100) : 1;
      const orderBody = {
        patientId: selectedPatient.id,
        doctorId: doctorId ?? undefined,
        notes: notes || undefined,
        tests: selectedTests.map((t) => ({ testId: t.testId, price: t.price * vipMultiplier })),
        clientRef,
      };

      // 2. Bill body (inline payments are processed server-side within /billing permission)
      const paymentRows = payNow
        ? paymentSplits.filter((s) => Number(s.amount) > 0).map((s) => ({ amount: Number(s.amount), method: s.mode }))
        : [];
      const billBody = {
        clientRef,
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
      };

      type BillResponse = {
        id: number;
        billNumber: string;
        token?: { tokenNo: number; tokenDate: string } | null;
        testTokens?: Array<{ orderTestId: number; testName: string; department: string; roomNumber: string; floorLabel: string; tokenNo: number }>;
        needsFormFData?: boolean;
        needsOnlinePayment?: boolean;
        onlineAmount?: number;
        _idempotent?: boolean;
      };

      // order is set as soon as its POST succeeds, so a NetworkError on the
      // *bill* POST below still queues with "stage: bill" (order already
      // exists — replay must only redo the bill, not double-create the order).
      let order: { id: number; orderNumber: string } | undefined;
      try {
        order = await api.post<{ id: number; orderNumber: string }>("/api/orders", orderBody);
        const bill = await api.post<BillResponse>("/api/bills", { ...billBody, orderId: order.id });
        return bill;
      } catch (err) {
        if (err instanceof NetworkError) {
          enqueueBill({
            clientRef,
            orderBody,
            billBody,
            ...(order ? { stage: "bill" as const, orderId: order.id, orderNumber: order.orderNumber } : {}),
          });
          throw new QueuedForSyncError();
        }
        throw err;
      }
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
        ]) || (clinic as PrintClinic);
        const cachedPrinter =
          printerCfgCached ??
          queryClient.getQueryData<PrinterCfg>(["printer-settings"]);
        // Clinic-wide server settings as the base — see the identical call in
        // the direct-print path above for why this matters (rotated A5-on-A4
        // prints when a counter falls back to built-in defaults).
        const settings = loadBillPrintSettings(parseGlobalBillPrintSettings(cachedClinic?.billPrintSettingsJson));
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
                ageValue: lastBillLocal.patient.ageValue ?? null,
                ageUnit: lastBillLocal.patient.ageUnit ?? null,
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
            const forcedPaperSize = settings.defaultPaperSize === "A4" || settings.defaultPaperSize === "half-a4" ? settings.defaultPaperSize : undefined;
            const effectivePaperSize = getAutoBillPaperSize(lastBillLocal.tests.length, forcedPaperSize, settings.autoA4Threshold ?? 5);
            const paperSize = (effectivePaperSize === "A4" ? "A4" : "A5") as "A4" | "A5";
            const orientation = paperSize === "A5" && settings.defaultPaperSize === "A5-landscape" ? "landscape" : "portrait";
            const html = buildBillPrintHtml({
              bill: billForPrint,
              clinic: clinicForPrint,
              paperSize,
              orientation,
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
              showQueueToken: settings.showQueueTokenOnBill,
              ...printLayoutOpts(settings),
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

      finishBillSaveFlowRef.current();
    },
    onError: (err: Error) => {
      printAfterSaveRef.current = false;
      saveAndNextRef.current = false;
      if (err instanceof QueuedForSyncError) {
        // Not a real failure from the user's point of view — the bill is
        // saved locally and will go out on its own. No receipt/token to show
        // yet (the real order/bill don't exist until it syncs), so reset the
        // desk immediately rather than leaving a stale draft that could be
        // resubmitted as a second, distinct queued entry.
        toast({ title: "No connection — bill saved locally", description: "It'll sync automatically once the network is back. See the sync panel in the sidebar." });
        resetAll();
        return;
      }
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
  // VIP surcharge — identical formula to self-registration.ts (used by
  // Online Booking): subtotal × (vipPercentage / 100). Computed on the raw
  // subtotal (not post-discount), same base self-registration.ts uses.
  const vipSurchargeAmt = isVipActive ? subtotal * (vipPercentage / 100) : 0;
  const total       = Math.max(0, subtotal - discountAmt) + vipSurchargeAmt;
  const paidTotal   = payNow ? paymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0;
  const balance     = Math.max(0, total - paidTotal);
  const paymentOverTotal = payNow && paidTotal > total + 0.01;

  // Default collect amount = net total (full payment is the common case).
  // Stops syncing once the cashier types a different value for partial pay.
  useEffect(() => {
    if (!payNow || paymentAmountTouched.current || total <= 0) return;
    const synced = total.toFixed(2);
    setPaymentSplits((prev) => {
      const first = prev[0] ?? { mode: "cash", amount: "" };
      if (first.amount === synced) return prev;
      return [{ ...first, amount: synced }, ...prev.slice(1)];
    });
  }, [payNow, total]);

  // ── Test actions ────────────────────────────────────
  function addTest(t: Test) {
    if (selectedTests.find((s) => s.testId === t.id)) {
      toast({ title: "Test already added" });
      return;
    }
    const wasEmpty = selectedTests.length === 0;
    setSelectedTests((prev) => [...prev, { testId: t.id, name: t.name, code: t.code, price: t.price, category: t.category, source: "test" }]);
    setTestSearch("");
    if (wasEmpty && isStepped && autoAdvance && currentStep === 3) advanceStep();
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
      const arr = JSON.parse(latest?.quickTestIds ?? "[null,null,null,null,null,null,null,null]");
      current = Array.isArray(arr)
        ? arr.slice(0, 8).map((v: unknown) => (typeof v === "number" ? v : null))
        : [null, null, null, null, null, null, null, null];
      while (current.length < 8) current.push(null);
    } catch {
      current = [null, null, null, null, null, null, null, null];
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

  // ── Quick Doctor slot save (server-synced, mirrors assignQuickSlot above).
  // Personal per-staff-member layout — /api/my/quick-doctors, not the
  // clinic-wide /api/clinic-settings — so any authenticated staff member can
  // save their own slots without needing the /settings.clinic permission. ──
  const saveQuickDoctorsMut = useMutation({
    mutationFn: (ids: (number | null)[]) =>
      api.put("/api/my/quick-doctors", { quickDoctorIds: JSON.stringify(ids) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-quick-doctors"] }),
    onError: () => toast({ title: "Failed to save quick doctor", variant: "destructive" }),
  });
  function assignQuickDoctorSlot(slotIdx: number, doctorId: number | null) {
    // BUG FIX: previously rebuilt `current` from queryClient.getQueryData
    // (the last server-confirmed snapshot). Picking two slots quickly — before
    // the first slot's PUT + cache-invalidation round-trip finished — meant
    // the second call rebuilt from a snapshot that didn't have the first
    // slot's selection yet, so the PUT for slot 2 silently overwrote slot 1
    // on the server. Fixing by basing `next` on the current in-memory
    // quickDoctorIds state instead, which already reflects every optimistic
    // update made so far in this session, avoiding the stale-read race.
    setQuickDoctorIds((current) => {
      const next = [...current];
      while (next.length < 8) next.push(null);
      next[slotIdx] = doctorId;
      localStorage.setItem("billingDesk:quickDoctors", JSON.stringify(next));
      saveQuickDoctorsMut.mutate(next);
      return next;
    });
  }

  function packageEffectivePrice(pkg: Pkg) {
    const afterPct = pkg.price - (pkg.price * (pkg.discountPct ?? 0)) / 100;
    return Math.max(0, afterPct - (pkg.discountAmount ?? 0));
  }

  function addPackage(pkg: Pkg) {
    const effective = packageEffectivePrice(pkg);
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
    const wasEmpty = selectedTests.length === 0;
    setSelectedTests((prev) => [...prev, ...toAdd]);
    setSelectedPackages((prev) => [...prev, { packageId: pkg.id, name: pkg.name, testIds: toAdd.map((t) => t.testId) }]);
    toast({ title: `Package "${pkg.name}" added (${toAdd.length} tests)` });
    if (wasEmpty && isStepped && autoAdvance && currentStep === 3) advanceStep();
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
    if (!keyboardNav) return;
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
  }, [keyboardNav]);

  // ── Reset ───────────────────────────────────────────
  function resetAll(focusPatient = false) {
    setSelectedPatient(null);
    setPatientSearch("");
    setNewPatient({ firstName: "", lastName: "", phone: "", gender: "", ageValue: "", ageUnit: "years", email: "", address: "", bloodGroup: "" });
    setDoctorId(null);
    setDoctorSearch("");
    setNotes("");
    setSelectedTests([]);
    setSelectedPackages([]);
    setDiscountValue(0);
    setDiscountReason("");
    setDiscountNote("");
    setPayNow(true);
    paymentAmountTouched.current = false;
    setPaymentSplits([{ mode: "cash", amount: "" }]);
    setLastBill(null);
    setSuggestion(null);
    setHusbandName("");
    setPatientAddress("");
    setIsVipActive(false);
    setTestsCollapsed(false);
    setSummaryCollapsed(false);
    setShowBillToast(false);
    if (isStepped) {
      setCurrentStep(1);
      setStepCompleted(new Set());
    }
    if (focusPatient) {
      window.setTimeout(() => {
        const input = searchRef.current?.querySelector("input");
        input?.focus();
      }, 100);
    }
  }

  finishBillSaveFlowRef.current = () => {
    if (saveAndNextRef.current) {
      saveAndNextRef.current = false;
      resetAll(true);
      return;
    }
    const delay = readAutoResetDelayMs();
    if (delay === null) return;
    if (delay === 0) {
      resetAll(true);
      return;
    }
    window.setTimeout(() => resetAll(true), delay);
  };

  function setPrimaryPaymentAmount(amount: number) {
    paymentAmountTouched.current = true;
    const capped = Math.min(Math.max(0, amount), total);
    setPaymentSplits((prev) => [
      { ...(prev[0] ?? { mode: "cash", amount: "" }), amount: capped > 0 ? capped.toFixed(2) : "" },
      ...prev.slice(1),
    ]);
  }

  function addSplitWithRemainder() {
    setPaymentSplits((prev) => {
      const paid = prev.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const remainder = Math.max(0, total - paid);
      return [...prev, { mode: "upi", amount: remainder > 0 ? remainder.toFixed(2) : "" }];
    });
  }

  const canGenerate = !!selectedPatient && selectedTests.length > 0 && !(discountAmt > 0 && !discountReason);
  // Update shortcut refs on every render so the keydown handler stays fresh.
  canGenerateRef.current = canGenerate;
  lastBillRef.current    = lastBill;

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER — Premium Medical Blue Design System
  // Typography-first. Clean hierarchy. Single-screen workflow.
  // All business logic above is UNTOUCHED. Only JSX/CSS is new here.
  // ──────────────────────────────────────────────────────────────────────────

  const deskClass = [
    "h-full flex flex-col overflow-hidden bg-gradient-to-br from-sky-50 via-white to-violet-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900",
    denseTestList  ? "billing-dense"     : "",
    largeFont      ? "billing-large-font": "",
    isCompact      ? "billing-compact"   : "",
  ].filter(Boolean).join(" ");

  // Bright per-section header accents — purely presentational. Each section
  // gets its own vivid gradient so the desk reads at a glance: blue = patient,
  // violet = doctor, teal = tests, amber = selection, green = money, indigo = pay.
  const SH_ACCENTS: Record<string, string> = {
    sky:     "bg-gradient-to-r from-sky-600 to-blue-600 border-sky-300",
    violet:  "bg-gradient-to-r from-violet-600 to-purple-600 border-violet-300",
    teal:    "bg-gradient-to-r from-teal-600 to-emerald-600 border-teal-300",
    cyan:    "bg-gradient-to-r from-cyan-600 to-sky-600 border-cyan-300",
    rose:    "bg-gradient-to-r from-rose-600 to-pink-600 border-rose-300",
    amber:   "bg-gradient-to-r from-amber-500 to-orange-500 border-amber-300",
    emerald: "bg-gradient-to-r from-emerald-600 to-green-600 border-emerald-300",
    indigo:  "bg-gradient-to-r from-indigo-600 to-violet-600 border-indigo-300",
  };

  // Shared section header style — bright gradient strip with per-section accent
  const SH = (label: string, icon?: React.ReactNode, accent: string = "sky") => (
    <div className={`px-3 py-1.5 flex items-center gap-2 border-l-4 ${SH_ACCENTS[accent] ?? SH_ACCENTS.sky}`}>
      {icon && <span className="text-white/90">{icon}</span>}
      <span className="text-[11px] font-bold uppercase tracking-wider text-white">{label}</span>
    </div>
  );

  // Collapsible variant — same look, but clickable with a chevron and an
  // optional right-aligned summary (e.g. Net Total) shown while collapsed.
  const SHCollapsible = (
    label: string,
    icon: React.ReactNode,
    collapsed: boolean,
    onToggle: () => void,
    rightSlot?: React.ReactNode,
    accent: string = "sky",
  ) => (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full px-3 py-1.5 flex items-center gap-2 border-l-4 text-left hover:brightness-110 transition-all ${SH_ACCENTS[accent] ?? SH_ACCENTS.sky}`}
    >
      {icon && <span className="text-white/90 flex-shrink-0">{icon}</span>}
      <span className="text-[11px] font-bold uppercase tracking-wider text-white flex-1">{label}</span>
      {collapsed && rightSlot}
      <ChevronDown size={13} className={`text-white/80 flex-shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
    </button>
  );

  const cardCls = "bg-white dark:bg-slate-800 border border-[#dde3ec] dark:border-slate-700 rounded-xl overflow-hidden shadow-md shadow-slate-200/60 dark:shadow-none";
  // Same as cardCls but WITHOUT overflow-hidden — needed for any card that contains
  // an absolutely-positioned dropdown/popover (e.g. the doctor search results),
  // since overflow-hidden on the parent silently clips those dropdowns.
  // Header corners are squared by overflow-hidden in cardCls; here the first
  // child is the header itself, so it keeps its own rounding via the card.
  const cardClsNoClip = "bg-white dark:bg-slate-800 border border-[#dde3ec] dark:border-slate-700 rounded-xl shadow-md shadow-slate-200/60 dark:shadow-none [&>*:first-child]:rounded-t-xl";

  return (
    <div className={deskClass} data-desk={layoutMode}>

      {/* ═══════════════════════════════════════════════════════
          TOP BAR — date · title · search · recent · new
      ═══════════════════════════════════════════════════════ */}
      <div className="flex-shrink-0 bg-gradient-to-r from-blue-700 via-indigo-600 to-violet-600 px-3 py-1.5 flex items-center gap-3 shadow-md">
        <span className="text-[11px] text-blue-100 flex-shrink-0 font-mono hidden sm:inline">{today()}</span>
        <span className="text-[13px] font-bold text-white flex-shrink-0 tracking-wide">Billing Desk</span>
        {previewBillNo?.next && (
          <span className="text-[10px] text-blue-100 flex-shrink-0 hidden md:inline">
            Next: <strong className="text-white">{previewBillNo.next}</strong>
          </span>
        )}
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-1.5">
          <div className="w-36 sm:w-52 lg:w-64"><BillSearchBox /></div>
          <Popover>
            <PopoverTrigger asChild>
              <button className="h-7 px-2 rounded text-[11px] font-semibold text-blue-100 hover:bg-white/15 flex items-center gap-1 transition-colors">
                <Receipt size={12} />
                <span className="hidden md:inline">Recent</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="p-0 w-[420px]">
              <RecentBillsPanel />
            </PopoverContent>
          </Popover>
          <button
            onClick={() => resetAll()}
            className="h-7 px-2 rounded text-[11px] font-semibold text-blue-100 hover:bg-white/15 flex items-center gap-1 transition-colors"
          >
            <RefreshCcw size={12} />
            <span className="hidden md:inline">New</span>
          </button>
        </div>
      </div>

      {/* Duplicate-bill warning banner */}
      {showBillToast && lastBill && (
        <div className="flex-shrink-0 bg-emerald-50 border-b border-emerald-200 px-4 py-2 flex items-center gap-2">
          <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0" />
          <span className="text-sm font-semibold text-emerald-800">
            Bill <strong>{lastBill.billNumber}</strong> saved successfully — click New to start next bill
          </span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          STEPPER (only in stepped wizard mode)
      ═══════════════════════════════════════════════════════ */}
      {isStepped && (
        <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-[#dde3ec] px-3 py-2">
          <div className="flex items-center gap-2 max-w-3xl mx-auto">
            {[
              { id: 1, label: "Patient",  icon: User },
              { id: 2, label: "Doctor",   icon: Stethoscope },
              { id: 3, label: "Tests",    icon: FlaskConical },
              { id: 4, label: "Summary",  icon: Receipt },
            ].map((s, idx) => (
              <div key={s.id} className="flex items-center flex-1">
                <button
                  type="button"
                  onClick={() => goToStep(s.id)}
                  className={`flex items-center gap-1.5 flex-1 justify-center px-2 py-1.5 rounded-md border text-[11px] font-bold transition-all ${
                    stepperActive(s.id)
                      ? "bg-gradient-to-r from-blue-600 to-violet-600 border-transparent text-white shadow-md"
                      : stepperDone(s.id)
                      ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                      : "bg-[#f4f6f9] border-[#dde3ec] text-[#64748b]"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    stepperActive(s.id) ? "bg-white/20 text-white"
                    : stepperDone(s.id)  ? "bg-emerald-500 text-white"
                    : "bg-[#dde3ec] text-[#64748b]"
                  }`}>
                    {stepperDone(s.id) ? <Check size={9} /> : s.id}
                  </div>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {idx < 3 && <div className={`w-4 h-px mx-1 ${stepperDone(s.id) ? "bg-emerald-400" : "bg-[#dde3ec]"}`} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          MAIN TWO-COLUMN LAYOUT
          Left  65%  — Patient · Doctor · Tests
          Right 35%  — Selected · Summary · Payment · Print
      ═══════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">

        {/* ▌LEFT COLUMN ▌─────────────────────────────────── */}
        <div className="w-full lg:w-[65%] lg:border-r border-[#dde3ec] flex flex-col min-h-0">
          <div ref={stepContentRef} className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">

            {/* ── PATIENT ─────────────────────────────────── */}
            {(!isStepped || currentStep === 1) && (
            <div className={cardCls}>
              {SH("Patient", <User size={11} />, "sky")}
              <div className="p-3 space-y-2">

                {/* Selected patient card */}
                {selectedPatient ? (
                  <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#2563eb] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                        {selectedPatient.firstName[0]}{selectedPatient.lastName[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-[14px] text-[#1e3a5f] leading-tight">
                          {selectedPatient.firstName} {selectedPatient.lastName}
                        </div>
                        <div className="text-[11px] text-[#2563eb] font-mono font-semibold">{selectedPatient.patientId}</div>
                      </div>
                      <div className="text-right text-[11px] text-[#475569] space-y-0.5">
                        <div className="font-semibold capitalize">{selectedPatient.gender}</div>
                        {selectedPatient.phone && <div>{selectedPatient.phone}</div>}
                        {selectedPatient.bloodGroup && (
                          <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold">{selectedPatient.bloodGroup}</span>
                        )}
                      </div>
                      <button
                        onClick={() => { setSelectedPatient(null); setPatientSearch(""); }}
                        className="text-[#94a3b8] hover:text-[#64748b] flex-shrink-0"
                        title="Change patient"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Search / register new patient */
                  <div ref={searchRef}>
                    {/* Search input */}
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                      <input
                        className="w-full h-9 pl-9 pr-3 text-sm border border-[#dde3ec] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/30 focus:border-[#2563eb]"
                        placeholder="Search by name, phone or UHID…"
                        value={patientSearch}
                        onChange={(e) => setPatientSearch(e.target.value)}
                        autoFocus={billingFlags.autoFocusNext}
                      />
                    </div>

                    {/* Search results */}
                    {debouncedSearch.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {(debouncedSearch.length >= 2 ? searchResults?.patients : recentPatients?.patients)?.slice(0, 5).map((p) => (
                          <button
                            key={p.id}
                            className="w-full text-left px-3 py-2 rounded-md border border-[#dde3ec] bg-white hover:bg-[#eff6ff] hover:border-[#bfdbfe] transition-colors flex items-center gap-3"
                            onClick={() => { setSelectedPatient(p); setPatientSearch(""); }}
                          >
                            <div className="w-7 h-7 rounded-full bg-[#e0eaff] flex items-center justify-center text-[#2563eb] font-bold text-xs flex-shrink-0">
                              {p.firstName[0]}{p.lastName[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-[#1e3a5f] truncate">{p.firstName} {p.lastName}</div>
                              <div className="text-[11px] text-[#64748b]">{p.patientId} · {p.phone}</div>
                            </div>
                          </button>
                        ))}
                        {patientSearch.length >= 2 && searchResults?.patients?.length === 0 && (
                          <div className="px-3 py-2 text-sm text-[#94a3b8] text-center">No patient found</div>
                        )}
                      </div>
                    )}

                    {/* Register New Patient — always visible below search (no toggle) */}
                  </div>
                )}

                {/* New Patient Registration form — always shown, not collapsible */}
                {!selectedPatient && (
                  <div className="pt-2 border-t border-[#e2e8f0]">
                    <div className="flex items-center gap-1.5 mb-1.5 text-[12px] font-semibold text-[#2563eb]">
                      <UserPlus size={13} />
                      Register New Patient
                    </div>
                    <RegisterPatientForm
                      newPatient={newPatient as NewPatientData}
                      onPatientChange={(data) =>
                        setNewPatient(data as typeof newPatient)
                      }
                      onSubmit={() => {
                        // Only a name is required — lastName, phone, age are optional
                        if (!newPatient.firstName.trim() && !newPatient.lastName.trim()) return;
                        createPatientMut.mutate(newPatient);
                      }}
                      isLoading={createPatientMut.isPending}
                    />
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Duplicate bill warning */}
            {recentPatientBill && !lastBill && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                <AlertTriangle size={14} className="text-amber-600 flex-shrink-0" />
                <span className="text-amber-800 text-xs flex-1">
                  Open bill <strong>{recentPatientBill.billNumber}</strong> already exists for this patient.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] border-amber-300 text-amber-800 hover:bg-amber-100 flex-shrink-0"
                  onClick={() => navigate(`/billing/${recentPatientBill.id}`)}
                >
                  Open bill
                </Button>
              </div>
            )}

            {/* DICOM MWL fields */}
            {needsDicom && selectedPatient && (
              <div className={cardCls}>
                {SH("DICOM Worklist", <Scan size={11} />, "cyan")}
                <div className="p-3 grid grid-cols-2 gap-2">
                  {[
                    { label: "Study Description", val: dicomStudyDesc, set: setDicomStudyDesc },
                    { label: "Body Part",          val: dicomBodyPart,  set: setDicomBodyPart  },
                    { label: "Station AE Title",   val: dicomStationAE, set: setDicomStationAE },
                    { label: "Referring Doctor",   val: dicomReferringDoc, set: setDicomReferringDoc },
                  ].map(({ label, val, set }) => (
                    <div key={label}>
                      <label className="text-[10px] font-semibold text-[#64748b] uppercase tracking-wide">{label}</label>
                      <Input className="mt-0.5 h-8 text-sm" value={val} onChange={(e) => set(e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Form F fields */}
            {needsFormF && !clinic?.formFBillingPrompt && (
              <div className={cardCls}>
                {SH("Form F (Required)", <FileText size={11} />, "rose")}
                <div className="p-3 space-y-2">
                  {clinic?.formFGuardianRequired !== false && (
                    <div>
                      <label className="text-[10px] font-semibold text-[#64748b] uppercase tracking-wide">
                        Husband / Guardian Name *
                      </label>
                      <Input className="mt-0.5 h-8 text-sm" value={husbandName} onChange={(e) => setHusbandName(e.target.value)} />
                    </div>
                  )}
                  {clinic?.formFAddressRequired !== false && (
                    <div>
                      <label className="text-[10px] font-semibold text-[#64748b] uppercase tracking-wide">Address *</label>
                      <Input className="mt-0.5 h-8 text-sm" value={patientAddress} onChange={(e) => setPatientAddress(e.target.value)} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── REFERRING DOCTOR ──────────────────────── */}
            {(!isStepped || currentStep === 1 || currentStep === 2) && (
            <div className={`${cardClsNoClip} mb-2.5`}>
              {SHCollapsible(
                "Referring Doctor",
                <Stethoscope size={11} />,
                doctorCollapsed,
                () => setDoctorCollapsed((c) => !c),
                <span className="text-[10px] text-white/85 font-semibold mr-1 truncate max-w-[160px]">
                  {doctorId ? doctors.find((d) => d.id === doctorId)?.name : "Walk-in"}
                </span>,
                "violet",
              )}
              {!doctorCollapsed && (
              <div className="p-3 space-y-2">
                {/* Quick doctor slots — 8 fixed-size slots, same symmetrical grid
                    pattern as Investigations quick slots below. Every box is
                    identical width; long doctor names truncate with an
                    ellipsis (full name still shown on hover via title).
                    Click a filled slot to select that doctor for this bill.
                    Click an empty (dashed) slot, or right-click any slot, to
                    assign/change which doctor lives there. */}
                <div className="grid grid-cols-4 gap-1.5">
                    {quickDoctorIds.map((docId, idx) => {
                      const doc = docId != null ? doctors.find((d) => d.id === docId) : null;
                      const isSelected = !!doc && doctorId === doc.id;
                      return (
                        <div key={idx} className="relative group">
                          <button
                            type="button"
                            onClick={() => {
                              if (doc) {
                                setDoctorId(isSelected ? null : doc.id);
                                setDoctorCollapsed(!isSelected);
                              } else {
                                setQuickDoctorPickerSlot(idx);
                              }
                            }}
                            onContextMenu={(e) => { e.preventDefault(); setQuickDoctorPickerSlot(idx); }}
                            title={doc ? doc.name : "Click to assign a doctor to this slot"}
                            className={`w-full px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-all truncate ${doc ? "pr-6" : ""} ${
                              doc
                                ? isSelected
                                  ? "bg-gradient-to-br from-violet-600 to-purple-600 text-white border-transparent shadow-md shadow-violet-300/50"
                                  : "bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100 hover:border-violet-500 shadow-sm"
                                : "bg-[#f4f6f9] border-dashed border-[#dde3ec] text-[#94a3b8] hover:border-violet-300 hover:text-violet-600"
                            }`}
                          >
                            {doc ? (
                              <>
                                {doc.name}
                                {pinnedDoctorIds.has(doc.id) && <Star size={8} className="inline ml-1 text-amber-400 fill-amber-400" />}
                              </>
                            ) : (
                              `+ Slot ${idx + 1}`
                            )}
                          </button>
                          {doc && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setQuickDoctorPickerSlot(idx); }}
                              className={`absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 transition-colors ${
                                isSelected ? "text-white/70 hover:text-white hover:bg-white/20" : "text-[#93c5fd] hover:text-[#2563eb] hover:bg-[#eff6ff]"
                              }`}
                              title="Edit this slot — assign a different doctor"
                            >
                              <Pencil size={10} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                {/* Doctor search */}
                <div ref={doctorRef} className="relative">
                  {doctorId && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#eff6ff] border border-[#bfdbfe] rounded-md text-sm mb-1.5">
                      <Stethoscope size={12} className="text-[#2563eb]" />
                      <span className="font-semibold text-[#1e3a5f] flex-1">
                        {doctors.find((d) => d.id === doctorId)?.name}
                      </span>
                      <button onClick={() => { setDoctorId(null); setDoctorSearch(""); setDoctorCollapsed(false); }} className="text-[#94a3b8] hover:text-[#64748b]"><X size={12} /></button>
                    </div>
                  )}
                  {!doctorId && (
                    <div className="relative">
                      <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                      <input
                        className="w-full h-8 pl-9 pr-3 text-sm border border-[#dde3ec] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/30 focus:border-[#2563eb]"
                        placeholder="Search doctor or leave blank for Walk-in…"
                        value={doctorSearch}
                        onChange={(e) => { setDoctorSearch(e.target.value); setDoctorSearchOpen(true); }}
                        onFocus={() => setDoctorSearchOpen(true)}
                      />
                    </div>
                  )}
                  {doctorSearchOpen && doctorSearch.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-30 mt-1 bg-white border border-[#dde3ec] rounded-lg shadow-lg max-h-64 overflow-y-auto">
                      {doctors
                        .filter((d) => d.name.toLowerCase().includes(doctorSearch.toLowerCase()))
                        .slice(0, 8)
                        .map((d) => (
                          <button
                            key={d.id}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-[#eff6ff] flex items-center gap-2"
                            onClick={() => { setDoctorId(d.id); setDoctorSearch(""); setDoctorSearchOpen(false); setDoctorCollapsed(true); }}
                          >
                            <Stethoscope size={11} className="text-[#2563eb]" />
                            {d.name}
                            {d.specialization && <span className="ml-auto text-[11px] text-[#94a3b8]">{d.specialization}</span>}
                          </button>
                        ))}
                      {doctorsError ? (
                        <div className="px-3 py-2 text-sm text-red-600 flex items-center justify-between gap-2">
                          <span>Couldn't load doctors — check your connection.</span>
                          <button type="button" onClick={() => refetchDoctors()} className="underline shrink-0">Retry</button>
                        </div>
                      ) : doctors.filter((d) => d.name.toLowerCase().includes(doctorSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-2 text-sm text-[#94a3b8]">No doctor found</div>
                      )}
                    </div>
                  )}
                </div>
                <Input
                  className="h-8 text-sm"
                  placeholder="Notes (optional)…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              )}
            </div>
            )}

            {/* ── INVESTIGATIONS ───────────────────────── */}
            {(!isStepped || currentStep === 2 || currentStep === 3) && (
            <div className={cardCls}>
              {SH("Investigations", <FlaskConical size={11} />, "teal")}
              <div className="p-3 space-y-2">

                {/* Quick Test Slots — 8 fixed-size slots in a symmetrical grid.
                    Every box is identical width; long test names truncate
                    with an ellipsis (full name still shown on hover via title). */}
                {showQuickTestsSetting && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {quickTestIds.map((slot, idx) => {
                      const test = slot != null ? allTests.find((t) => t.id === slot) : null;
                      return (
                        <div key={idx} className="relative group">
                          <button
                            type="button"
                            onClick={() => handleQuickTabClick(idx)}
                            onContextMenu={(e) => { e.preventDefault(); setQuickPickerSlot(idx); }}
                            title={test ? test.name : "Click to assign a test to this slot"}
                            className={`w-full px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-all truncate ${test ? "pr-6" : ""} ${
                              test
                                ? selectedTestIds.has(test.id)
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-700 line-through opacity-70"
                                  : "bg-teal-50 border-teal-300 text-teal-700 hover:bg-teal-100 hover:border-teal-500 shadow-sm"
                                : "bg-[#f4f6f9] border-dashed border-[#dde3ec] text-[#94a3b8] hover:border-teal-300 hover:text-teal-600"
                            }`}
                          >
                            {test ? test.name : `+ Slot ${idx + 1}`}
                          </button>
                          {test && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setQuickPickerSlot(idx); }}
                              className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-[#93c5fd] hover:text-[#2563eb] hover:bg-[#eff6ff] transition-colors"
                              title="Edit this slot — assign a different test"
                            >
                              <Pencil size={10} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Test search + category filter */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                    <input
                      ref={testSearchRef}
                      className="w-full h-8 pl-9 pr-3 text-sm border border-[#dde3ec] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/30 focus:border-[#2563eb]"
                      placeholder="Search test by name or code…"
                      value={testSearch}
                      onChange={(e) => setTestSearch(e.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 text-xs border border-[#dde3ec] rounded-md px-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/30 min-w-[90px]"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>{c === "all" ? "All Categories" : c}</option>
                    ))}
                  </select>
                </div>

                {/* Test list */}
                <div className={`max-h-[240px] overflow-y-auto rounded-md border border-[#dde3ec] divide-y divide-[#f1f5f9] ${denseTestList ? "max-h-[320px]" : ""}`}>
                  {filteredTests.length === 0 ? (
                    <div className="py-6 text-center text-[#94a3b8] text-sm">No tests found</div>
                  ) : (
                    filteredTests.slice(0, 80).map((t) => (
                      <button
                        key={t.id}
                        data-billing-catalog-row
                        type="button"
                        className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-[#eff6ff] transition-colors group"
                        onClick={() => addTest(t)}
                        onDoubleClick={() => addTest(t)}
                        disabled={selectedTestIds.has(t.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <span className={`text-[13px] font-semibold ${selectedTestIds.has(t.id) ? "text-[#94a3b8] line-through" : "text-[#1e3a5f]"}`}>
                            {t.name}
                          </span>
                          {t.code && <span className="ml-2 text-[10px] text-[#94a3b8] font-mono">{t.code}</span>}
                          {pinnedTestIds.has(t.id) && <Star size={8} className="inline ml-1 text-amber-400 fill-amber-400" />}
                          <div className="text-[10px] text-[#94a3b8]">{t.category}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className={`text-[13px] font-bold ${selectedTestIds.has(t.id) ? "text-[#94a3b8]" : "text-[#1e3a5f]"}`}>
                            {inr(t.price)}
                          </span>
                          {selectedTestIds.has(t.id) ? (
                            <div className="text-[10px] text-emerald-600 font-bold">✓ Added</div>
                          ) : (
                            <div className="text-[10px] text-[#2563eb] opacity-0 group-hover:opacity-100 transition-opacity">Click to add</div>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {/* Packages */}
                {showPackagesSetting && packages.length > 0 && (
                  <div className="pt-2 border-t border-[#e2e8f0]">
                    <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wide mb-1.5">Packages</div>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                        <input
                          className="w-full h-7 pl-8 pr-2 text-xs border border-[#dde3ec] rounded-md bg-white focus:outline-none"
                          placeholder="Search packages…"
                          value={packageSearch}
                          onChange={(e) => setPackageSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="mt-1.5 max-h-[120px] overflow-y-auto space-y-1">
                      {filteredPackages.slice(0, 10).map((pkg) => (
                        <button
                          key={pkg.id}
                          type="button"
                          className="w-full text-left px-3 py-1.5 rounded-md border border-[#dde3ec] bg-white hover:bg-[#eff6ff] hover:border-[#bfdbfe] transition-colors flex items-center gap-3"
                          onClick={() => addPackage(pkg)}
                          disabled={selectedPackages.some((sp) => sp.packageId === pkg.id)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-[#1e3a5f] truncate">{pkg.name}</div>
                            <div className="text-[10px] text-[#94a3b8]">{pkg.tests.length} tests</div>
                          </div>
                          <span className="text-sm font-bold text-[#1e3a5f] flex-shrink-0">{inr(packageEffectivePrice(pkg))}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}

          </div>{/* end left scroll */}
        </div>

        {/* ▌RIGHT COLUMN ▌────────────────────────────────── */}
        <div className="w-full lg:w-[35%] flex flex-col min-h-0 bg-gradient-to-b from-indigo-50/70 to-emerald-50/50 dark:from-slate-850 dark:to-slate-850">
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">

            {/* ── SELECTED TESTS ───────────────────────── */}
            <div className={`${cardCls} mx-2.5 mt-2.5 flex-shrink-0`}>
              {SHCollapsible(
                `Selected Tests (${selectedTests.length})`,
                <ClipboardList size={11} />,
                testsCollapsed,
                () => setTestsCollapsed((c) => !c),
                <span className="text-[10px] text-white/85 font-semibold mr-1">{inr(subtotal)}</span>,
                "amber",
              )}
              {!testsCollapsed && (selectedTests.length === 0 && selectedPackages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-[#94a3b8]">
                  <FlaskConical size={20} className="mb-1.5 opacity-30" />
                  <p className="text-xs">No investigations added yet</p>
                </div>
              ) : (
                <div>
                  <div className="divide-y divide-[#f1f5f9] max-h-[180px] overflow-y-auto">
                    {selectedTests.map((t) => (
                      <div key={t.testId} data-billing-test-row className="flex items-center gap-2 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-[#1e3a5f] truncate">{t.name}</div>
                          <div className="text-[10px] text-[#94a3b8] capitalize">{t.category}
                            {t.source === "package" && <span className="ml-1 text-amber-600 font-bold">· pkg</span>}
                          </div>
                        </div>
                        <span className="text-[13px] font-bold text-[#1e3a5f] flex-shrink-0">{inr(t.price)}</span>
                        <button
                          onClick={() => removeTest(t.testId)}
                          className="text-[#cbd5e1] hover:text-red-500 transition-colors flex-shrink-0"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {selectedPackages.length > 0 && (
                    <div className="border-t border-[#e2e8f0] bg-amber-50/50 px-3 py-2 space-y-1">
                      <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">Packages</div>
                      {selectedPackages.map((pkg) => (
                        <div key={pkg.packageId} className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-[#1e3a5f] truncate">{pkg.name}</div>
                          <button onClick={() => removePackage(pkg.packageId)} className="text-[#cbd5e1] hover:text-red-500"><X size={12} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedTests.length > 0 && (
                    <div className="border-t border-[#e2e8f0] px-3 py-1.5 flex justify-end">
                      <button className="text-[11px] text-red-400 hover:text-red-600" onClick={() => setSelectedTests([])}>
                        Clear all
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ── BILL SUMMARY + PAYMENT + SAVE (optional sticky block) ── */}
            <div className={`mx-2.5 mt-2.5 flex-shrink-0 space-y-2.5 ${(stickyBillSummary || stickyPayment) ? "lg:sticky lg:top-0 lg:z-10" : ""}`}>
            {/* ── BILL SUMMARY + DISCOUNT + VIP ────────── */}
            <div className={cardCls}>
              {SHCollapsible(
                "Bill Summary",
                <Receipt size={11} />,
                summaryCollapsed,
                () => setSummaryCollapsed((c) => !c),
                <span className="text-[10px] text-white/85 font-semibold mr-1">Net {inr(total)}</span>,
                "emerald",
              )}
              <div className="p-3 space-y-2">

                {!summaryCollapsed && (
                <>
                {/* Auto-discount suggestion */}
                {suggestion && suggestion.discount > 0 && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2 text-xs">
                    <Zap size={11} className="text-emerald-600 flex-shrink-0" />
                    <span className="text-emerald-700 flex-1">
                      <strong>{suggestion.rule?.name}</strong> — {inr(suggestion.discount)} applicable
                    </span>
                    <button
                      className="text-emerald-700 font-bold hover:underline"
                      onClick={() => {
                        setDiscountType("amount");
                        setDiscountValue(suggestion.discount);
                        if (suggestion.rule?.name) {
                          setDiscountReason(suggestion.rule.name);
                        } else {
                          const r = discountReasons.find((dr) => dr.isActive);
                          if (r) setDiscountReason(r.label);
                        }
                        setSuggestion(null);
                      }}
                    >
                      Apply
                    </button>
                    <button onClick={() => setSuggestion(null)} className="text-[#94a3b8]"><X size={10} /></button>
                  </div>
                )}

                {/* Subtotal row */}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#64748b]">Subtotal</span>
                  <span className="text-[13px] font-semibold text-[#334155]">{inr(subtotal)}</span>
                </div>

                {/* Discount row */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider">Discount</span>
                    <div className="flex items-center gap-2">
                      {discountAmt > 0 && <span className="text-[12px] text-amber-700 font-bold">−{inr(discountAmt)}</span>}
                      {selectedTests.length > 0 && (
                        <button
                          onClick={fetchSuggestion}
                          disabled={suggLoading}
                          className="text-[10px] text-[#2563eb] hover:underline flex-shrink-0 flex items-center gap-0.5"
                        >
                          <Zap size={9} className={suggLoading ? "animate-pulse" : ""} />
                          Auto
                        </button>
                      )}
                    </div>
                  </div>
                  {!myIsFullAccess && (
                    <p className="text-[10px] text-[#94a3b8]">
                      {myMaxDiscountPct > 0
                        ? `Your limit: up to ${myMaxDiscountPct}% on this bill.`
                        : "You're not authorized to apply a discount — ask an admin."}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5">
                    <div className="flex border border-[#dde3ec] rounded-md overflow-hidden flex-shrink-0">
                      <button
                        onClick={() => setDiscountType("amount")}
                        className={`px-2.5 py-1 text-[12px] font-bold transition-colors ${discountType === "amount" ? "bg-[#2563eb] text-white" : "hover:bg-[#f4f6f9] text-[#64748b]"}`}
                      >₹</button>
                      <button
                        onClick={() => setDiscountType("pct")}
                        className={`px-2.5 py-1 text-[12px] font-bold transition-colors ${discountType === "pct" ? "bg-[#2563eb] text-white" : "hover:bg-[#f4f6f9] text-[#64748b]"}`}
                      >%</button>
                    </div>
                    <Input
                      type="number" min={0}
                      max={discountType === "pct" ? 100 : subtotal}
                      step="0.01"
                      value={discountValue || ""}
                      onChange={(e) => setDiscountValue(Number(e.target.value))}
                      onFocus={() => setTestsCollapsed(true)}
                      placeholder="0"
                      className="h-8 text-sm flex-1 min-w-[70px]"
                    />
                    {subtotal > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        className="h-8 px-2.5 text-[11px] border-[#bfdbfe] text-[#2563eb] hover:bg-[#eff6ff] font-bold flex-shrink-0"
                        onClick={() => {
                          setDiscountType("pct");
                          setDiscountValue(10);
                          const r = discountReasons.find((r) => r.isActive && r.label.toLowerCase().includes("standard")) || discountReasons.find((r) => r.isActive);
                          setDiscountReason(r ? r.label : "Standard Discount");
                        }}
                      >
                        10%
                      </Button>
                    )}
                  </div>
                  {discountAmt > 0 && (
                    <div className="space-y-1">
                      <select
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                        className={`w-full h-7 text-xs border rounded-md px-2 bg-white ${!discountReason ? "border-red-400 text-red-600" : "border-[#dde3ec]"}`}
                      >
                        <option value="">— Select reason * —</option>
                        {discountReasons.filter((r) => r.isActive).map((r) => (
                          <option key={r.id} value={r.label}>{r.label}</option>
                        ))}
                      </select>
                      <Input
                        placeholder="Custom note (optional)…"
                        value={discountNote}
                        onChange={(e) => setDiscountNote(e.target.value)}
                        className="h-7 text-xs"
                        maxLength={200}
                      />
                    </div>
                  )}
                </div>

                {/* VIP toggle */}
                <div className="flex items-center gap-2 py-1.5 border-t border-[#e2e8f0]">
                  <input
                    type="checkbox"
                    id="vip-toggle"
                    checked={isVipActive}
                    onChange={(e) => setIsVipActive(e.target.checked)}
                    className="h-4 w-4 rounded border-[#94a3b8] text-[#2563eb]"
                  />
                  <label htmlFor="vip-toggle" className="text-[12px] font-semibold text-[#475569] cursor-pointer select-none">
                    ⭐ VIP Priority
                  </label>
                  {isVipActive && (
                    <span className="text-[12px] text-amber-700 font-bold ml-auto">
                      +{inr(vipSurchargeAmt)} <span className="font-medium text-amber-600">({vipPercentage}%)</span>
                    </span>
                  )}
                </div>
                </>
                )}

                {/* ── NET TOTAL — visual anchor, always visible even when collapsed ── */}
                <div className="flex items-center justify-between py-2 border-t-2 border-[#1a3a5c]">
                  <span className="text-[13px] font-bold text-[#1a3a5c] uppercase tracking-wide">Net Total</span>
                  <span className="text-[28px] font-extrabold text-[#1a3a5c] tabular-nums leading-none">{inr(total)}</span>
                </div>
              </div>
            </div>

            {/* ── PAYMENT ──────────────────────────────── */}
            <div className={cardCls}>
              {SH("Payment", <CreditCard size={11} />, "indigo")}
              <div className="p-3 space-y-2.5" ref={paymentRef}>

                {/* Collect now toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const next = !payNow;
                        setPayNow(next);
                        if (next && !paymentAmountTouched.current && total > 0) {
                          setPaymentSplits((prev) => [
                            { ...(prev[0] ?? { mode: "cash", amount: "" }), amount: total.toFixed(2) },
                            ...prev.slice(1),
                          ]);
                        }
                      }}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${payNow ? "bg-[#2563eb]" : "bg-[#cbd5e1]"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${payNow ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                    <span className="text-[12px] font-semibold text-[#334155]">Collect Payment Now</span>
                  </div>
                  <span className="text-[11px] text-[#64748b]">{inr(total)}</span>
                </div>

                {payNow && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: "Exact", amount: total },
                        ...(total >= 200 ? [{ label: "Half", amount: total / 2 }] : []),
                        ...(total >= 500 ? [{ label: "₹500", amount: 500 }] : []),
                        ...(total >= 1000 ? [{ label: "₹1000", amount: 1000 }] : []),
                      ].map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => setPrimaryPaymentAmount(chip.amount)}
                          className="px-2.5 py-1 rounded-md border border-[#bfdbfe] bg-[#eff6ff] text-[10px] font-bold text-[#2563eb] hover:bg-[#dbeafe] transition-colors"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                    {/* Primary amount input — FIRST (most-used action) */}
                    <Input
                      type="number"
                      min={0}
                      max={total}
                      step="0.01"
                      placeholder={total.toFixed(2)}
                      value={paymentSplits[0]?.amount ?? ""}
                      onChange={(e) => {
                        paymentAmountTouched.current = true;
                        const raw = e.target.value;
                        const n = Number(raw);
                        const capped = raw !== "" && !Number.isNaN(n) && n > total
                          ? total.toFixed(2)
                          : raw;
                        setPaymentSplits((prev) => prev.map((s, i) => i === 0 ? { ...s, amount: capped } : s));
                      }}
                      onFocus={() => setSummaryCollapsed(true)}
                      className="h-12 text-xl font-bold tracking-tight text-center border-[#2563eb]/40 focus:border-[#2563eb]"
                    />

                    {/* Split payments */}
                    {paymentSplits.slice(1).map((split, relIdx) => {
                      const idx = relIdx + 1;
                      return (
                        <div key={idx} className="grid grid-cols-[1.1fr_1fr_18px] gap-2 items-center">
                          <Select
                            value={split.mode}
                            onValueChange={(v) => setPaymentSplits((prev) => prev.map((s, i) => i === idx ? { ...s, mode: v } : s))}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PAYMENT_MODES.map((m) => (
                                <SelectItem key={m} value={m} className="capitalize">
                                  {m === "online" ? "Online Gateway" : m.toUpperCase()}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number" min={0} max={total} step="0.01" placeholder="0.00"
                            value={split.amount}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const n = Number(raw);
                              const capped = raw !== "" && !Number.isNaN(n) && n > total
                                ? total.toFixed(2)
                                : raw;
                              setPaymentSplits((prev) => prev.map((s, i) => i === idx ? { ...s, amount: capped } : s));
                            }}
                            className="h-8 text-xs"
                          />
                          <button
                            onClick={() => setPaymentSplits((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-[#cbd5e1] hover:text-red-500"
                          ><X size={13} /></button>
                        </div>
                      );
                    })}

                    {/* SECOND: Split payment link */}
                    {paymentSplits.length < PAYMENT_MODES.length && (
                      <button
                        onClick={addSplitWithRemainder}
                        className="text-[11px] font-semibold text-[#2563eb] hover:underline flex items-center gap-1"
                      >
                        <Plus size={11} /> Split payment
                      </button>
                    )}

                    {/* THIRD: Balance / Paid indicator */}
                    {(balance > 0 || (paidTotal > 0 && total > 0) || paymentOverTotal) && (
                      <div className="rounded-lg border px-3 py-2">
                        {paymentOverTotal ? (
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-bold text-red-700">Exceeds net total</span>
                            <span className="text-[18px] font-extrabold text-red-600 tabular-nums">{inr(paidTotal)}</span>
                          </div>
                        ) : balance > 0 ? (
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-bold text-red-700">Balance Due</span>
                            <span className="text-[18px] font-extrabold text-red-600 tabular-nums animate-blink-fast">{inr(balance)}</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-2 text-emerald-600 font-bold">
                            <CheckCircle2 size={15} />
                            <span className="text-[14px]">Fully Paid · {inr(paidTotal)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* FOURTH: Payment mode selector — compact single row, split in half.
                        Left half: CASH + UPI + ONLINE (larger — cover the vast majority
                        of collections, including QR/gateway payment shown on the
                        customer-facing second screen). Right half: CARD / INSURANCE
                        (smaller — rarely used), so the whole clinic-relevant row stays
                        one line. Same PAYMENT_MODES list, same onClick handler as every
                        other mode — selecting "online" here is what makes /api/bills
                        return needsOnlinePayment, which is what opens the existing
                        Online Payment / second-screen QR dialog below. Cheque was
                        removed — this clinic no longer accepts cheque payments. */}
                    <div className="flex gap-1.5">
                      <div className="flex-1 grid grid-cols-3 gap-1">
                        {PAYMENT_MODES.filter((m) => m === "cash" || m === "upi" || m === "online").map((m) => {
                          const icons: Record<string, string> = { cash: "💵", upi: "📱", online: "🔳" };
                          const isActive = paymentSplits[0]?.mode === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setPaymentSplits((prev) => prev.map((s, i) => i === 0 ? { ...s, mode: m } : s))}
                              className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg border text-center transition-all ${
                                isActive
                                  ? "bg-gradient-to-br from-indigo-600 to-violet-600 text-white border-transparent shadow-md shadow-indigo-300/50"
                                  : "bg-white border-[#dde3ec] text-[#475569] hover:border-indigo-300 hover:bg-indigo-50"
                              }`}
                            >
                              <span className="text-sm">{icons[m]}</span>
                              <span className="text-[9px] font-bold uppercase">{m}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex-1 grid grid-cols-2 gap-1">
                        {PAYMENT_MODES.filter((m) => m === "card" || m === "insurance").map((m) => {
                          const icons: Record<string, string> = { card: "💳", insurance: "🏥" };
                          const isActive = paymentSplits[0]?.mode === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setPaymentSplits((prev) => prev.map((s, i) => i === 0 ? { ...s, mode: m } : s))}
                              className={`flex flex-col items-center gap-0.5 px-1 py-1 rounded-md border text-center transition-all ${
                                isActive
                                  ? "bg-gradient-to-br from-indigo-600 to-violet-600 text-white border-transparent shadow-sm"
                                  : "bg-white border-[#dde3ec] text-[#94a3b8] hover:border-indigo-300 hover:bg-indigo-50"
                              }`}
                            >
                              <span className="text-[10px]">{icons[m]}</span>
                              <span className="text-[6.5px] font-bold uppercase leading-tight">{m}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── SAVE & PRINT — most prominent action ─── */}
            <div className="mb-2.5 flex-shrink-0 space-y-2">
              <Button
                onClick={() => {
                  if (generatingRef.current || !!lastBillRef.current) return;
                  generatingRef.current = true;
                  printAfterSaveRef.current = true;
                  generateMut.mutate();
                }}
                disabled={
                  !selectedPatient ||
                  selectedTests.length === 0 ||
                  generateMut.isPending ||
                  !!lastBill ||
                  (discountAmt > 0 && !discountReason) ||
                  paymentOverTotal ||
                  (needsFormF && !clinic?.formFBillingPrompt && (
                    (clinic?.formFGuardianRequired !== false && !husbandName.trim()) ||
                    (clinic?.formFAddressRequired !== false && !patientAddress.trim())
                  )) ||
                  (needsDicom && !dicomFieldsComplete)
                }
                className={`w-full h-14 text-[16px] font-extrabold tracking-wide rounded-xl shadow-lg disabled:shadow-none border-0 transition-all ${
                  lastBill
                    ? "bg-gradient-to-r from-emerald-600 to-green-600 hover:brightness-110 text-white shadow-emerald-300/50"
                    : "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:brightness-110 text-white shadow-indigo-300/50 disabled:bg-none disabled:bg-[#cbd5e1] disabled:text-[#94a3b8]"
                }`}
              >
                {lastBill ? (
                  <><CheckCircle2 size={20} className="mr-2" />Bill Saved ✓</>
                ) : generateMut.isPending ? (
                  <><Printer size={20} className="mr-2 animate-spin" />Saving…</>
                ) : (
                  <><Printer size={20} className="mr-2" />Save &amp; Print</>
                )}
              </Button>

              {!lastBill && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (generatingRef.current || !!lastBillRef.current) return;
                    generatingRef.current = true;
                    printAfterSaveRef.current = false;
                    saveAndNextRef.current = true;
                    generateMut.mutate();
                  }}
                  disabled={
                    !selectedPatient ||
                    selectedTests.length === 0 ||
                    generateMut.isPending ||
                    (discountAmt > 0 && !discountReason) ||
                    paymentOverTotal ||
                    (needsFormF && !clinic?.formFBillingPrompt && (
                      (clinic?.formFGuardianRequired !== false && !husbandName.trim()) ||
                      (clinic?.formFAddressRequired !== false && !patientAddress.trim())
                    )) ||
                    (needsDicom && !dicomFieldsComplete)
                  }
                  className="w-full h-10 text-[13px] font-bold border-[#93c5fd] text-[#2563eb] hover:bg-[#eff6ff]"
                >
                  {generateMut.isPending && saveAndNextRef.current ? (
                    <>Saving…</>
                  ) : (
                    <><ChevronRight size={16} className="mr-1" />Save &amp; Next</>
                  )}
                </Button>
              )}

              <div className="grid grid-cols-3 gap-1.5">
                <Button
                  variant="outline"
                  onClick={async () => { if (!lastBill) return; await printBarcode(lastBill); }}
                  disabled={!lastBill}
                  className="h-9 text-[11px] border-[#dde3ec] text-[#475569] hover:bg-[#eff6ff] hover:text-[#2563eb] hover:border-[#93c5fd]"
                >
                  <Barcode size={13} className="mr-1" />Barcode
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => { if (!lastBill) return; await printToken(lastBill, clinic); }}
                  disabled={!lastBill || (!lastBill.tokenNo && (lastBill.testTokens?.length ?? 0) === 0)}
                  className="h-9 text-[11px] border-[#dde3ec] text-[#475569] hover:bg-[#eff6ff] hover:text-[#2563eb] hover:border-[#93c5fd]"
                >
                  <Hash size={13} className="mr-1" />Token
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (generatingRef.current || !!lastBillRef.current) return;
                    generatingRef.current = true;
                    generateMut.mutate();
                  }}
                  disabled={
                    !selectedPatient ||
                    selectedTests.length === 0 ||
                    generateMut.isPending ||
                    !!lastBill ||
                    (discountAmt > 0 && !discountReason) ||
                    paymentOverTotal
                  }
                  className="h-9 text-[11px] border-[#dde3ec] text-[#475569] hover:bg-[#eff6ff]"
                >
                  <Save size={13} className="mr-1" />Save
                </Button>
              </div>
            </div>
            </div>{/* end sticky block */}

            <TodayCollectionsPanel />

          </div>{/* end right scroll */}
        </div>

      </div>{/* end main layout */}

      {/* ── DIALOGS AND MODALS (unchanged from original) ── */}

      {/* Quick Test slot picker */}
      <Dialog open={quickPickerSlot !== null} onOpenChange={(o) => { if (!o) { setQuickPickerSlot(null); setQuickPickerSearch(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Configure Quick Slot {(quickPickerSlot ?? 0) + 1}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              autoFocus
              placeholder="Search test…"
              value={quickPickerSearch}
              onChange={(e) => setQuickPickerSearch(e.target.value)}
              className="h-9"
            />
            <div className="max-h-60 overflow-y-auto space-y-1">
              {allTests
                .filter((t) => !quickPickerSearch || t.name.toLowerCase().includes(quickPickerSearch.toLowerCase()))
                .slice(0, 20)
                .map((t) => (
                  <button
                    key={t.id}
                    className="w-full text-left px-3 py-2 rounded border border-[#dde3ec] hover:bg-[#eff6ff] text-sm flex items-center justify-between"
                    onClick={() => {
                      if (quickPickerSlot !== null) {
                        assignQuickSlot(quickPickerSlot, t.id);
                      }
                      setQuickPickerSlot(null);
                      setQuickPickerSearch("");
                    }}
                  >
                    <span>{t.name}</span>
                    <span className="font-bold text-[#1e3a5f]">{inr(t.price)}</span>
                  </button>
                ))}
            </div>
            {quickPickerSlot !== null && quickTestIds[quickPickerSlot] != null && (
              <button
                className="text-xs text-red-500 hover:underline"
                onClick={() => {
                  if (quickPickerSlot !== null) {
                    assignQuickSlot(quickPickerSlot, null);
                  }
                  setQuickPickerSlot(null);
                }}
              >
                Clear this slot
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Doctor slot picker — same pattern as the Investigations quick-slot picker */}
      <Dialog open={quickDoctorPickerSlot !== null} onOpenChange={(o) => { if (!o) { setQuickDoctorPickerSlot(null); setQuickDoctorPickerSearch(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Configure Quick Doctor Slot {(quickDoctorPickerSlot ?? 0) + 1}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              autoFocus
              placeholder="Search doctor…"
              value={quickDoctorPickerSearch}
              onChange={(e) => setQuickDoctorPickerSearch(e.target.value)}
              className="h-9"
            />
            <div className="max-h-60 overflow-y-auto space-y-1">
              {doctors
                .filter((d) => !quickDoctorPickerSearch || d.name.toLowerCase().includes(quickDoctorPickerSearch.toLowerCase()))
                .slice(0, 20)
                .map((d) => (
                  <button
                    key={d.id}
                    className="w-full text-left px-3 py-2 rounded border border-[#dde3ec] hover:bg-[#eff6ff] text-sm flex items-center gap-2"
                    onClick={() => {
                      if (quickDoctorPickerSlot !== null) {
                        assignQuickDoctorSlot(quickDoctorPickerSlot, d.id);
                      }
                      setQuickDoctorPickerSlot(null);
                      setQuickDoctorPickerSearch("");
                    }}
                  >
                    <Stethoscope size={12} className="text-[#2563eb]" />
                    <span className="flex-1">{d.name}</span>
                    {d.specialization && <span className="text-[11px] text-[#94a3b8]">{d.specialization}</span>}
                  </button>
                ))}
              {doctorsError ? (
                <div className="px-3 py-2 text-sm text-red-600 flex items-center justify-between gap-2">
                  <span>Couldn't load doctors — check your connection.</span>
                  <button type="button" onClick={() => refetchDoctors()} className="underline shrink-0">Retry</button>
                </div>
              ) : doctors.filter((d) => !quickDoctorPickerSearch || d.name.toLowerCase().includes(quickDoctorPickerSearch.toLowerCase())).length === 0 && (
                <div className="px-3 py-2 text-sm text-[#94a3b8]">No doctor found</div>
              )}
            </div>
            {quickDoctorPickerSlot !== null && quickDoctorIds[quickDoctorPickerSlot] != null && (
              <button
                className="text-xs text-red-500 hover:underline"
                onClick={() => {
                  if (quickDoctorPickerSlot !== null) {
                    assignQuickDoctorSlot(quickDoctorPickerSlot, null);
                  }
                  setQuickDoctorPickerSlot(null);
                }}
              >
                Clear this slot
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Form F Billing Popup */}
      <Dialog open={formFPopupOpen} onOpenChange={setFormFPopupOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Form F — Required Fields</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-semibold text-[#64748b]">Husband / Guardian Name</label>
              <Input
                className="mt-1 h-9"
                value={formFPopupHusband}
                onChange={(e) => setFormFPopupHusband(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#64748b]">Address</label>
              <Input
                className="mt-1 h-9"
                value={formFPopupAddress}
                onChange={(e) => setFormFPopupAddress(e.target.value)}
                placeholder="Full address"
              />
            </div>
            <Button
              className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
              disabled={formFSaveMut.isPending}
              onClick={() => {
                if (!formFPopupBillNumber || !formFPopupHusband.trim()) return;
                formFSaveMut.mutate({
                  billNumber: formFPopupBillNumber,
                  husbandName: formFPopupHusband.trim(),
                  address: formFPopupAddress.trim(),
                });
              }}
            >
              {formFSaveMut.isPending ? "Saving…" : "Save Form F"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Online Gateway Payment Modal */}
      <Dialog open={gatewayModalOpen} onOpenChange={(o) => { if (!o) setGatewayModalOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Online Payment</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-1 text-[10px] text-[#94a3b8]">
            <div className="flex items-center justify-center gap-1.5">
              <Monitor size={11} />
              Customer display:
              <input
                value={paymentCounterKey}
                onChange={(e) => setPaymentCounterKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                className="w-20 h-5 px-1 text-[10px] border border-[#e2e8f0] rounded bg-white text-center"
                title="Which customer-facing screen shows this QR — set once per workstation, must match the URL used on that screen's tablet/monitor"
              />
              <span className="opacity-70">— set up once, point that screen at this URL:</span>
            </div>
            {/* Full URL including the display token — a networked tablet/monitor
                needs it to authorize; without it the screen never shows the QR. */}
            <div className="flex items-center gap-1.5 w-full justify-center">
              <input
                readOnly
                value={paymentDisplayUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 max-w-[320px] h-5 px-1 text-[10px] font-mono border border-[#e2e8f0] rounded bg-white text-center"
                title="Open this exact URL (it includes the display token) on the customer-facing screen"
              />
              <button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(paymentDisplayUrl).catch(() => {}); }}
                className="text-[10px] font-semibold text-[#2563eb] hover:underline"
              >
                Copy
              </button>
            </div>
            {!paymentDisplayToken && (
              <span className="text-[9px] text-amber-600">Loading display token… the URL will include it once ready.</span>
            )}
          </div>
          <div className="space-y-3 py-2 text-center">
            {gatewayPaymentStatus === "pending" && !gatewayPaymentInfo && (
              <div className="text-[#64748b] text-sm">Initialising payment gateway…</div>
            )}
            {gatewayPaymentInfo && gatewayPaymentStatus === "pending" && (
              <>
                {gatewayQrUrl ? (
                  <>
                    <img src={gatewayQrUrl} alt="Payment QR" className="w-40 h-40 mx-auto rounded-lg border" />
                    <button
                      type="button"
                      onClick={openGatewayQrOnSecondScreen}
                      className="mt-2 text-xs font-semibold text-[#2563eb] hover:underline flex items-center gap-1 mx-auto"
                    >
                      <Monitor size={13} /> Re-open on Second Screen
                    </button>
                  </>
                ) : (
                  <a
                    href={gatewayPaymentInfo.redirectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block bg-[#2563eb] text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-[#1d4ed8]"
                  >
                    Open Payment Page →
                  </a>
                )}
                <p className="text-xs text-[#94a3b8]">Amount: <strong>{inr(gatewayPaymentInfo.amount)}</strong></p>
              </>
            )}
            {gatewayPaymentStatus === "success" && (
              <div className="text-emerald-600 font-bold flex items-center justify-center gap-2">
                <CheckCircle2 size={20} /> Payment confirmed
              </div>
            )}
            {gatewayPaymentStatus === "failed" && (
              <div className="text-red-600 text-sm">{gatewayPaymentError || "Payment failed"}</div>
            )}
            {gatewayPaymentStatus === "expired" && (
              <div className="text-amber-700 text-sm">Payment link expired. Collect manually or retry online from the bill page.</div>
            )}
            <div className="flex flex-col gap-2 pt-2">
              {(gatewayPaymentStatus === "failed" || gatewayPaymentStatus === "expired" || (gatewayPaymentStatus === "pending" && gatewayPaymentInfo)) && (
                <Button
                  variant="outline"
                  className="w-full text-[#2563eb] border-[#2563eb]/40"
                  onClick={handleGatewayChangePaymentMode}
                >
                  Change payment mode — collect Cash/UPI on bill
                </Button>
              )}
              <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setGatewayModalOpen(false)}>Close</Button>
              {gatewayPaymentStatus === "pending" && (
                <Button
                  className="flex-1 bg-[#2563eb] text-white"
                  onClick={() => {
                    if (!gatewayPaymentInfo) return;
                    void checkGatewayStatus(gatewayPaymentInfo.billId, gatewayPaymentInfo.txnRef);
                  }}
                >
                  Check Status
                </Button>
              )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Print Preview Dialog */}
      <Dialog open={printPreviewOpen} onOpenChange={setPrintPreviewOpen}>
        <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer size={15} />
              Print Preview
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPrintPreviewOpen(false)}>Close</Button>
                <Button size="sm" onClick={() => { printViaIframe(printPreviewHtml); setPrintPreviewOpen(false); }}>
                  <Printer size={14} className="mr-1" /> Print
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-4 bg-gray-100 rounded-lg">
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

type CollectBillTarget = {
  id: number;
  billNumber: string;
  balanceAmount: number;
  patientName?: string | null;
};

const AUTO_RESET_DELAY_KEY = "billingDeskAutoResetDelay";

function readAutoResetDelayMs(): number | null {
  if (typeof window === "undefined") return 3000;
  const v = localStorage.getItem(AUTO_RESET_DELAY_KEY) ?? "3000";
  if (v === "manual") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : 3000;
}

function CollectPaymentDialog({
  bill,
  onClose,
  onSuccess,
}: {
  bill: CollectBillTarget | null;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [collectAmount, setCollectAmount] = useState("");
  const [collectMethod, setCollectMethod] = useState("cash");

  useEffect(() => {
    if (bill) {
      setCollectAmount(String(bill.balanceAmount));
      setCollectMethod("cash");
    }
  }, [bill]);

  const collectMut = useMutation({
    mutationFn: (body: { billId: number; amount: number; method: string }) =>
      api.post("/api/payments", body),
    onSuccess: () => {
      toast({ title: "Payment recorded" });
      queryClient.invalidateQueries({ queryKey: ["bill-search"] });
      queryClient.invalidateQueries({ queryKey: ["today-collections-panel"] });
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      queryClient.invalidateQueries({ queryKey: ["recent-bills-today"] });
      onClose();
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: "Payment failed", description: err.message, variant: "destructive" });
    },
  });

  function submitCollect(e: React.FormEvent) {
    e.preventDefault();
    if (!bill) return;
    const amount = Number(collectAmount);
    if (!amount || amount <= 0 || amount > bill.balanceAmount) return;
    collectMut.mutate({ billId: bill.id, amount, method: collectMethod });
  }

  return (
    <Dialog open={!!bill} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Collect payment</DialogTitle>
        </DialogHeader>
        {bill && (
          <form onSubmit={submitCollect} className="space-y-3">
            <div className="text-sm">
              <span className="font-mono font-bold text-primary">{bill.billNumber}</span>
              {bill.patientName && (
                <span className="text-muted-foreground"> · {bill.patientName}</span>
              )}
            </div>
            <div>
              <Label>Amount (₹)</Label>
              <Input
                type="number"
                min={0.01}
                max={bill.balanceAmount}
                step="0.01"
                value={collectAmount}
                onChange={(e) => setCollectAmount(e.target.value)}
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Balance due: {inr(bill.balanceAmount)}</p>
            </div>
            <div>
              <Label>Method</Label>
              <Select value={collectMethod} onValueChange={setCollectMethod}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["cash", "upi", "card", "online", "insurance"].map((m) => (
                    <SelectItem key={m} value={m} className="capitalize">{m.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={collectMut.isPending}>
                {collectMut.isPending ? "Saving…" : "Record payment"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BillSearchBox() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [dueOnly, setDueOnly] = useState(true);
  const [collectBill, setCollectBill] = useState<CollectBillTarget | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const { data: results = [], isFetching } = useQuery<BillSearchResult[]>({
    queryKey: ["bill-search", q, dueOnly],
    queryFn: () => api.get(`/api/bills/search?q=${encodeURIComponent(q)}&dueOnly=${dueOnly ? 1 : 0}`),
    enabled: q.trim().length >= 2,
    staleTime: 5_000,
  });

  function openCollectDialog(bill: BillSearchResult, e: React.MouseEvent) {
    e.stopPropagation();
    setCollectBill({
      id: bill.id,
      billNumber: bill.billNumber,
      balanceAmount: bill.balanceAmount,
      patientName: bill.patientName,
    });
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <>
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
                <div
                  key={r.id}
                  className="w-full px-3 py-2 hover:bg-muted/50 transition-colors flex items-center gap-2"
                >
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setQ(""); navigate(`/billing/${r.id}`); }}
                    className="flex-1 min-w-0 text-left"
                  >
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
                    <div className="text-right mt-0.5">
                      <span className="text-xs text-slate-900 dark:text-slate-900">Total {inr(r.totalAmount)} · </span>
                      <span className={`text-sm font-extrabold ${r.balanceAmount > 0 ? "text-orange-900" : "text-green-600"}`}>
                        Bal {inr(r.balanceAmount)}
                      </span>
                    </div>
                  </button>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px] px-2"
                      onClick={() => { setOpen(false); setQ(""); navigate(`/billing/${r.id}`); }}
                    >
                      Open
                    </Button>
                    {r.balanceAmount > 0 && r.status !== "cancelled" && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-[10px] px-2 bg-orange-600 hover:bg-orange-700 text-white"
                        onClick={(e) => openCollectDialog(r, e)}
                      >
                        Collect
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>

    <CollectPaymentDialog
      bill={collectBill}
      onClose={() => setCollectBill(null)}
      onSuccess={() => { setOpen(false); setQ(""); }}
    />
    </>
  );
}

// ──────────────────────────────────────────────────────
// Today's Collections Panel — right column, below Save & Print
// Dues shown first for easy payment follow-up
// ──────────────────────────────────────────────────────
function TodayCollectionsPanel() {
  const [, navigate] = useLocation();
  const [collectBill, setCollectBill] = useState<CollectBillTarget | null>(null);
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
            const patientName = b.patient ? `${b.patient.firstName} ${b.patient.lastName}` : null;
            return (
              <div
                key={b.id}
                className={`w-full px-3 py-1.5 transition-colors flex items-center gap-2 ${
                  due ? "hover:bg-orange-50 dark:hover:bg-orange-950/20" : "hover:bg-muted/40"
                }`}
              >
                <button
                  type="button"
                  onClick={() => navigate(`/billing/${b.id}`)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-extrabold text-primary truncate">{b.billNumber}</span>
                    {due ? (
                      <span className="flex-shrink-0 text-[9px] px-1 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-white font-extrabold">DUE</span>
                    ) : (
                      <span className="flex-shrink-0 text-[9px] px-1 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-800 font-extrabold">PAID</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-900 dark:text-slate-900 truncate">
                    {patientName ?? "—"}
                  </div>
                  <div className="text-right text-[10px] mt-0.5">
                    <span className="text-slate-900 dark:text-slate-900">{inr(b.totalAmount)}</span>
                    {due && <span className="font-extrabold text-orange-900 ml-1">Bal {inr(b.balanceAmount)}</span>}
                    <span className="text-[9px] text-slate-900 dark:text-slate-900 tabular-nums ml-1">{time}</span>
                  </div>
                </button>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[9px] px-1.5"
                    onClick={() => navigate(`/billing/${b.id}`)}
                  >
                    Open
                  </Button>
                  {due && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 text-[9px] px-1.5 bg-orange-600 hover:bg-orange-700 text-white"
                      onClick={() => setCollectBill({
                        id: b.id,
                        billNumber: b.billNumber,
                        balanceAmount: b.balanceAmount,
                        patientName,
                      })}
                    >
                      Collect
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <CollectPaymentDialog bill={collectBill} onClose={() => setCollectBill(null)} />
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
    ...FINANCIAL_QUERY_OPTIONS,
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
