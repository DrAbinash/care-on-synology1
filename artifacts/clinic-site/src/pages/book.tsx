import { useEffect, useState, useMemo, useRef } from "react";
import {
  Phone, Mail, MapPin, ChevronLeft, CalendarCheck, Clock,
  Star, Shield, Zap, Check, ChevronRight, Loader2, ArrowLeft, Sparkles,
  Stethoscope, FlaskConical, Package, User, CreditCard,
  CalendarDays, MessageCircle, QrCode, Printer, Receipt,
} from "lucide-react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import type { SiteSettings } from "../types";
import { resolveAssetUrl } from "../config";
import { SelfRegistrationForm } from "../../../diagnostic-erp/src/components/SelfRegistrationForm";
import { buildBillPrintHtml, openBlankPrintWindow, writeAndPrint, type PrintBillData, type PrintClinic } from "../../../diagnostic-erp/src/lib/printBill";

const BASE = import.meta.env.BASE_URL;
const WORK_ADDR = "CARE DIAGNOSTICS, Subhash Chowk, Castair's Town, Near Bajla Mahila College, Deoghar–814112";
const PHONE = "9973497200";
const EMAIL = "CARE.DEOGHAR@GMAIL.COM";

/* ── API helpers ── */
async function bookingGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; throw new Error(e.error || res.statusText); }
  return res.json() as Promise<T>;
}

async function bookingPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: string; details?: string };
    const errMsg = e.error || res.statusText || ("HTTP " + res.status);
    const detailMsg = e.details ? ` (${e.details})` : "";
    throw new Error(errMsg + detailMsg);
  }
  return res.json() as Promise<T>;
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as unknown as Record<string, unknown>).Razorpay) { resolve(true); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

function submitPayuForm(payuUrl: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = payuUrl;
  form.style.display = "none";
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden"; input.name = k; input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

// Which gateway actually completed this booking + its reference — used to
// label the "Payment Details" line on the printed receipt.
function derivePayment(b: Record<string, any>): { method: string; reference: string } {
  if (b.razorpayPaymentId || b.razorpayOrderId) return { method: "razorpay", reference: b.razorpayPaymentId || b.razorpayOrderId || "" };
  if (b.payuPaymentId || b.payuTxnId) return { method: "payu", reference: b.payuPaymentId || b.payuTxnId || "" };
  if (b.phonepeProviderRefId || b.phonepeTransactionId) return { method: "phonepe", reference: b.phonepeProviderRefId || b.phonepeTransactionId || "" };
  if (b.bharatpeProviderRefId || b.bharatpeTransactionId) return { method: "bharatpe", reference: b.bharatpeProviderRefId || b.bharatpeTransactionId || "" };
  if (b.iciciProviderRefId || b.iciciTransactionId) return { method: "icici", reference: b.iciciProviderRefId || b.iciciTransactionId || "" };
  return { method: "upi", reference: "" };
}

/* ── Types ── */
type BookingConfig = {
  enabled: boolean;
  keyId: string;
  vipEnabled: boolean;
  gateway: "payu" | "razorpay" | "phonepe" | "bharatpe" | "icici" | "hdfc" | null;
  payuMerchantKey?: string;
  phonepeMerchantId?: string;
  bharatpeMerchantId?: string;
  iciciMerchantId?: string;
  kioskUpiVpa?: string;
  kioskUpiName?: string;
  upiQrEnabled?: boolean;
  upiVpa?: string;
  upiQrImageUrl?: string;
  vipPercentage?: number;
  vipAdvantages?: string;
  vipDisclaimer?: string;
  disclaimerRefundPercentage?: number;
  enableCardPayment?: boolean;
  enableQrPayment?: boolean;
  enableVipBooking?: boolean;
  enablePaymentLogos?: boolean;
  enablePaymentTimer?: boolean;
  customIciciBannerUrl?: string;
  customPhonepeBannerUrl?: string;
  customBharatpeBannerUrl?: string;
  customPayuBannerUrl?: string;
  quickTestIds?: (number | null)[];
  quickTestCategoryImages?: string;
  quickTestOverlayOpacity?: number;
  allowedTestIds?: number[];
  allowedPackageIds?: number[];
  // Hope partner page selection, curated in Care's Settings (empty = not set).
  hopeAllowedTestIds?: number[];
  hopeAllowedPackageIds?: number[];
  bookingTimeSlots?: { value: string; label: string; maxBookings?: number | null; modality?: string; remaining?: number | null; available?: boolean }[];
};
type DoctorOption = { id: number; name: string; specialization?: string | null };
type TestItem = { id: number; code: string; name: string; category: string; price: string };
type PkgItem  = { id: number; code: string; name: string; price: string; description: string };

/* ── Formatters ── */
const fmt = (n: number) => "\u20b9" + n.toLocaleString("en-IN");

/* ── Step indicator ── */
function Stepper({ step }: { step: number }) {
  const steps = ["Your Details", "Select Tests", "Review & Pay"];
  return (
    <div className="cd-stepper">
      {steps.map((label, i) => (
        <div key={label} className="cd-stepper-item">
          <div className={`cd-stepper-dot ${i < step ? "done" : i === step ? "active" : ""}`}>
            {i < step ? <Check size={16} /> : i + 1}
          </div>
          <span className={`cd-stepper-label ${i <= step ? "active" : ""}`}>{label}</span>
          {i < 2 && <ChevronRight size={14} className="cd-stepper-chevron" />}
        </div>
      ))}
    </div>
  );
}

/* ── Trust badges ── */
function TrustBadges() {
  return (
    <div className="cd-trust-badges">
      {[
        { icon: Shield, label: "NABL Accredited" },
        { icon: Zap, label: "Same-day Reports" },
        { icon: Clock, label: "Mon\u2013Sat 7AM\u20139PM" },
        { icon: Star, label: "4.8/5 Patient Rating" },
      ].map(({ icon: Icon, label }) => (
        <div key={label} className="cd-trust-badge">
          <Icon size={14} /> {label}
        </div>
      ))}
    </div>
  );
}

/* ── Main booking page ── */
export default function BookPage({ settings }: { settings: SiteSettings }) {
  const workAddr = settings.address || WORK_ADDR;
  const phone = settings.contactPhone || PHONE;
  const email = settings.contactEmail || EMAIL;

  useEffect(() => {
    const src = new URLSearchParams(window.location.search).get("source");
    document.title = (src || "").toLowerCase() === "hope"
      ? "Book Hope Tests | Care Diagnostics"
      : "Book a Test | Care Diagnostics";
    window.scrollTo(0, 0);
  }, []);

  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [liveSlots, setLiveSlots] = useState<BookingConfig["bookingTimeSlots"]>(undefined);
  const [tests, setTests] = useState<TestItem[]>([]);
  const [pkgs, setPkgs] = useState<PkgItem[]>([]);
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(0); // 0=details,1=select,2=review,3=done,4=failed,5=qr-payment,6=confirmed
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [successRef, setSuccessRef] = useState("");
  const [failReason, setFailReason] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [qrBookingRef, setQrBookingRef] = useState("");
  const [qrAmount, setQrAmount] = useState(0);
  const [qrUpiUrl, setQrUpiUrl] = useState("");
  const [qrUpiVpa, setQrUpiVpa] = useState("");
  const [qrUpiName, setQrUpiName] = useState("");
  const [qrChecking, setQrChecking] = useState(false);

  const [confirmedBooking, setConfirmedBooking] = useState<{
    name: string; phone: string; email: string; selectedDate: string; timeSlot: string;
    totalAmount: string; notes: string; testIds: string; packageIds: string;
    bookingRef: string; status: string; isVip: boolean;
    isUnconfirmedQr?: boolean;
    billId?: number | null; gender?: string | null; ageValue?: number | null; ageUnit?: string | null;
    paymentMethod?: string; paymentReference?: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tokenNo, setTokenNo] = useState<number | null>(null);
  // Hidden canvas used only to generate a real, scannable QR image for the
  // printable receipt popup (document.write() can't render React components,
  // so we render this once, then read its data-URL when printing).
  const receiptQrRef = useRef<HTMLCanvasElement>(null);

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mode = useMemo(() => (params.get("mode") || "online") as "online" | "kiosk" | "qr", [params]);
  // Partner deep-link (e.g. Hope: /book?source=hope&packageCode=HOPE). Drives
  // light co-branding; the booking + payment flow is otherwise unchanged.
  const isHope = useMemo(() => (params.get("source") || "").toLowerCase() === "hope", [params]);

  const [pd, setPd] = useState(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const urlSource = params.get("source");
    const urlToken = params.get("token");
    let initialNotes = "";
    if (urlSource || urlToken) {
      const parts = [];
      if (urlSource) parts.push(`Source: ${urlSource}`);
      if (urlToken) parts.push(`Token: ${urlToken}`);
      initialNotes = parts.join(", ");
    }

    return {
      name: "",
      phone: "",
      email: "",
      // Default visit date to today so the unlabeled native date input is never
      // mistaken for a required DOB field left blank (age alone is the demographic).
      date: todayStr,
      timeSlot: mode === "qr" ? "07:00 – 10:00" : "",
      notes: initialNotes,
      isVip: false,
      ageValue: "",
      ageUnit: "years" as "years" | "months" | "days",
      gender: "" as "male" | "female" | "",
      referringDoctorId: null as number | null,
      referringDoctorName: "",
      slotModality: "",
    };
  });
  const [selTests, setSelTests] = useState<Set<number>>(new Set());
  const [quickTab, setQuickTab] = useState("All");
  const [selPkgs, setSelPkgs] = useState<Set<number>>(new Set());

  // Prefill tests/packages in QR mode or if available
  useEffect(() => {
    const testParam = params.get("tests") || params.get("testIds") || params.get("test") || params.get("testId");
    if (testParam) {
      const ids = testParam.split(",").map(Number).filter(Boolean);
      setSelTests(new Set(ids));
    }
    const pkgParam = params.get("packages") || params.get("packageIds") || params.get("package") || params.get("packageId");
    if (pkgParam) {
      const ids = pkgParam.split(",").map(Number).filter(Boolean);
      setSelPkgs(new Set(ids));
    }
    if (params.get("vip") === "true" || params.get("vip") === "1") {
      setPd(prev => ({ ...prev, isVip: true }));
    }
  }, [mode, params]);

  const loadCatalog = () => {
    if (tests.length === 0) bookingGet<{ tests: TestItem[] }>("/api/public/booking/tests").then((d) => setTests(d.tests)).catch(() => {});
    if (pkgs.length === 0) bookingGet<{ packages: PkgItem[] }>("/api/public/booking/packages").then((d) => setPkgs(d.packages)).catch(() => {});
  };

  useEffect(() => {
    bookingGet<BookingConfig>("/api/public/booking/config")
      .then((c) => {
        setConfig(c);
        setLiveSlots(c.bookingTimeSlots);
      })
      .catch(() => setConfig({ enabled: false, keyId: "", vipEnabled: false, gateway: null }));
  }, []);

  // Partner deep-links can pre-select a package/test set by STABLE code (robust
  // across environments), e.g. /book?source=hope&packageCode=HOPE. Numeric
  // ?package=/?tests= are handled in the prefill effect above; here we resolve
  // codes once the catalog has loaded.
  useEffect(() => {
    const pkgCodeParam = params.get("packageCode") || params.get("packageCodes");
    if (pkgCodeParam && pkgs.length) {
      const codes = pkgCodeParam.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
      const ids = pkgs.filter((p) => codes.includes((p.code || "").toLowerCase())).map((p) => p.id);
      if (ids.length) setSelPkgs((s) => { const n = new Set(s); ids.forEach((id) => n.add(id)); return n; });
    }
    const testCodeParam = params.get("testCode") || params.get("testCodes");
    if (testCodeParam && tests.length) {
      const codes = testCodeParam.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
      const ids = tests.filter((t) => codes.includes((t.code || "").toLowerCase())).map((t) => t.id);
      if (ids.length) setSelTests((s) => { const n = new Set(s); ids.forEach((id) => n.add(id)); return n; });
    }
  }, [tests, pkgs, params]);

  // Load the catalog eagerly when a deep-link pre-selects tests/packages, so the
  // selection is already resolved by the time the user reaches "Select Tests".
  useEffect(() => {
    if (params.get("packageCode") || params.get("packageCodes") || params.get("testCode") || params.get("testCodes") ||
        params.get("package") || params.get("packageId") || params.get("packages") || params.get("packageIds") ||
        params.get("test") || params.get("testId") || params.get("tests") || params.get("testIds")) {
      loadCatalog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Referring-doctor list for the booking form's "Referring Doctor" picker.
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  useEffect(() => {
    bookingGet<{ doctors: DoctorOption[] }>("/api/public/booking/doctors")
      .then((d) => setDoctors(d.doctors || []))
      .catch(() => setDoctors([]));
  }, []);

  // Clinic fields for the printed receipt (GSTIN, footer messages, etc.) —
  // same clinic_settings row Billing Desk prints from, via a dedicated
  // public endpoint since /api/bills is staff-authenticated.
  const [clinicPrint, setClinicPrint] = useState<PrintClinic | null>(null);
  useEffect(() => {
    bookingGet<PrintClinic>("/api/public/booking/clinic-print-info")
      .then(setClinicPrint)
      .catch(() => setClinicPrint(null));
  }, []);

  // Detect payment confirmation / failure from query params (ICICI, PhonePe, BharatPe)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const confirmed = params.get("confirmed");
    const failed = params.get("failed");
    const ref = params.get("ref") || "";
    const gateway = params.get("gateway") || "";
    const reason = params.get("reason") || "";

    if (confirmed === "1" && ref) {
      setConfirming(true);
      setSuccessRef(ref);
      loadCatalog();
      bookingGet<{ booking: Record<string, any>; tokenNo: number | null }>(`/api/public/booking/by-ref?ref=${encodeURIComponent(ref)}`)
        .then((res) => {
          const b = res.booking;
          const hasGateway = b.razorpayPaymentId || b.razorpayOrderId || b.payuTxnId || b.payuPaymentId || b.phonepeTransactionId || b.bharatpeProviderRefId || b.iciciTransactionId;
          const payment = derivePayment(b);
          setConfirmedBooking({
            name: b.name || "",
            phone: b.phone || "",
            email: b.email || "",
            selectedDate: b.selectedDate || "",
            timeSlot: b.timeSlot || "",
            totalAmount: b.totalAmount || "0",
            notes: b.notes || "",
            testIds: b.testIds || "[]",
            packageIds: b.packageIds || "[]",
            bookingRef: b.bookingRef || ref,
            status: b.status || "",
            isVip: b.isVip === true || b.isVip === "true",
            isUnconfirmedQr: !hasGateway,
            billId: b.billId ?? null,
            gender: b.gender ?? null,
            ageValue: b.ageValue ?? null,
            ageUnit: b.ageUnit ?? null,
            paymentMethod: payment.method,
            paymentReference: payment.reference,
          });
          setTokenNo(res.tokenNo);
          setStep(6);
          setConfirming(false);
          // Clean URL so refresh doesn't re-trigger
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch(() => {
          // Still show basic confirmation with ref only
          setStep(6);
          setConfirming(false);
          window.history.replaceState({}, "", window.location.pathname);
        });
    } else if (failed === "1") {
      setFailReason(reason || "Payment not completed.");
      setStep(4);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const baseTotal = useMemo(() => {
    const t = tests.filter((t) => selTests.has(t.id)).reduce((s, t) => s + Number(t.price), 0);
    const p = pkgs.filter((p) => selPkgs.has(p.id)).reduce((s, p) => s + Number(p.price), 0);
    return t + p;
  }, [tests, pkgs, selTests, selPkgs]);

  const vipCharge = useMemo(() => {
    if (!pd.isVip) return 0;
    const pct = config?.vipPercentage || 50;
    return Number((baseTotal * (pct / 100)).toFixed(2));
  }, [baseTotal, pd.isVip, config?.vipPercentage]);

  const total = useMemo(() => {
    return baseTotal + vipCharge;
  }, [baseTotal, vipCharge]);

  // Partner deep-links (e.g. Hope: /book?source=hope&testCode=…&packageCode=HOPE)
  // curate WHICH catalogue items are offered, not just which arrive pre-ticked:
  // when the URL carries codes we show only those. The items are still Care's
  // own catalogue rows — Care ids, Care prices — so the booking bills in Care
  // exactly as a walk-in would. Codes are a display filter, not a security
  // boundary; the server-side onlineBookingAllowed* whitelist still governs
  // what the catalogue endpoints will hand out at all.
  const codeFilter = useMemo(() => {
    const parse = (v: string | null) =>
      (v || "").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
    const testCodes = parse(params.get("testCode") || params.get("testCodes"));
    const pkgCodes = parse(params.get("packageCode") || params.get("packageCodes"));
    return testCodes.length || pkgCodes.length ? { testCodes, pkgCodes } : null;
  }, [params]);

  // Hope's own selection, curated by Care admins in Settings → Online Booking.
  // This is the normal way to control Hope's page: Care staff tick the tests
  // there and nothing about the link has to change. URL codes still win when
  // present, so a one-off campaign link can still narrow things further.
  const hopeIdFilter = useMemo(() => {
    if (!isHope) return null;
    const t = config?.hopeAllowedTestIds ?? [];
    const p = config?.hopeAllowedPackageIds ?? [];
    return t.length || p.length ? { testIds: new Set(t), pkgIds: new Set(p) } : null;
  }, [isHope, config?.hopeAllowedTestIds, config?.hopeAllowedPackageIds]);

  const curatedTests = useMemo(() => {
    if (codeFilter) return tests.filter((t) => codeFilter.testCodes.includes((t.code || "").toLowerCase()));
    if (hopeIdFilter) return tests.filter((t) => hopeIdFilter.testIds.has(t.id));
    return tests;
  }, [tests, codeFilter, hopeIdFilter]);
  const curatedPkgs = useMemo(() => {
    if (codeFilter) return pkgs.filter((p) => codeFilter.pkgCodes.includes((p.code || "").toLowerCase()));
    if (hopeIdFilter) return pkgs.filter((p) => hopeIdFilter.pkgIds.has(p.id));
    return pkgs;
  }, [pkgs, codeFilter, hopeIdFilter]);

  // Fail open: if the curation matches nothing here — a mistyped code, or every
  // selected item since removed from Care's online-booking whitelist — fall back
  // to the full catalogue rather than stranding the patient on an empty page.
  const curationMissed =
    (!!codeFilter || !!hopeIdFilter) && (tests.length > 0 || pkgs.length > 0) &&
    curatedTests.length === 0 && curatedPkgs.length === 0;
  const shownTests = curationMissed ? tests : curatedTests;
  const shownPkgs = curationMissed ? pkgs : curatedPkgs;

  const categories = useMemo(() => ["all", ...Array.from(new Set(shownTests.map((t) => t.category))).sort()], [shownTests]);
  const filteredTests = useMemo(() => {
    let list = catFilter === "all" ? shownTests : shownTests.filter((t) => t.category === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => (t.name + " " + t.code).toLowerCase().includes(q));
    }
    return list;
  }, [shownTests, catFilter, search]);

  const toggleTest = (id: number) => setSelTests((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePkg  = (id: number) => setSelPkgs((s) => { const n = new Set(s);  n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleWhatsApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (settings.whatsappNumber) {
      const msg = `Hi, I'd like to book an appointment.\nName: ${pd.name}\nPhone: ${pd.phone}\nPreferred date: ${pd.date}\nNote: ${pd.notes}`;
      const num = settings.whatsappNumber.replace(/[^0-9]/g, "");
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank");
    }
    setStep(3);
  };

  async function handlePayU() {
    setError(""); setPaying(true);
    try {
      const res = await bookingPost<{ payuUrl: string; fields: Record<string, string> }>("/api/public/booking/payu-initiate", {
        name: pd.name, phone: pd.phone, email: pd.email, selectedDate: pd.date, timeSlot: pd.timeSlot,
        slotModality: pd.slotModality || "",
        source: mode === "kiosk" ? "kiosk" : "website",
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
        referringDoctorId: pd.referringDoctorId, referringDoctorName: pd.referringDoctorName,
      });
      submitPayuForm(res.payuUrl, res.fields);
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || "Something went wrong.";
      setError(msg); setPaying(false);
    }
  }

  async function handlePhonePe() {
    setError(""); setPaying(true);
    try {
      const res = await bookingPost<{ bookingRef: string; redirectUrl: string }>("/api/public/booking/phonepe-initiate", {
        name: pd.name, phone: pd.phone, email: pd.email, selectedDate: pd.date, timeSlot: pd.timeSlot,
        slotModality: pd.slotModality || "",
        source: mode === "kiosk" ? "kiosk" : "website",
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
        referringDoctorId: pd.referringDoctorId, referringDoctorName: pd.referringDoctorName,
      });
      window.location.href = res.redirectUrl;
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || "Something went wrong.";
      setError(msg); setPaying(false);
    }
  }

  async function handleBharatPe() {
    setError(""); setPaying(true);
    try {
      const res = await bookingPost<{ bookingRef: string; redirectUrl: string }>("/api/public/booking/bharatpe-initiate", {
        name: pd.name, phone: pd.phone, email: pd.email, selectedDate: pd.date, timeSlot: pd.timeSlot,
        slotModality: pd.slotModality || "",
        source: mode === "kiosk" ? "kiosk" : "website",
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
        referringDoctorId: pd.referringDoctorId, referringDoctorName: pd.referringDoctorName,
      });
      window.location.href = res.redirectUrl;
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || "Something went wrong.";
      setError(msg); setPaying(false);
    }
  }

  async function handleRazorpay() {
    setError(""); setPaying(true);
    try {
      const loaded = await loadRazorpay();
      if (!loaded) { setError("Could not load payment gateway. Please try again."); setPaying(false); return; }

      const res = await bookingPost<{ bookingRef: string; razorpayOrderId: string; amountPaise: number; keyId: string }>("/api/public/booking/create-order", {
        name: pd.name, phone: pd.phone, email: pd.email, selectedDate: pd.date, timeSlot: pd.timeSlot,
        slotModality: pd.slotModality || "",
        source: mode === "kiosk" ? "kiosk" : "website",
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
        referringDoctorId: pd.referringDoctorId, referringDoctorName: pd.referringDoctorName,
      });

      const RZP = (window as unknown as { Razorpay: new (opts: Record<string, unknown>) => { open(): void } }).Razorpay;
      const rzp = new RZP({
        key: res.keyId,
        amount: res.amountPaise,
        currency: "INR",
        order_id: res.razorpayOrderId,
        name: settings.siteTitle || "Care Diagnostics",
        description: `Test booking \u2014 ${res.bookingRef}`,
        prefill: { name: pd.name, contact: pd.phone, email: pd.email },
        theme: { color: "#0ea5e9" },
        handler: async (payment: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await bookingPost<{ success: boolean; bookingRef: string }>("/api/public/booking/verify-payment", {
              razorpayOrderId: payment.razorpay_order_id,
              razorpayPaymentId: payment.razorpay_payment_id,
              razorpaySignature: payment.razorpay_signature,
            });
            setSuccessRef(res.bookingRef);
            setStep(3);
          } catch {
            setError("Payment verification failed. Please contact us with your payment ID: " + payment.razorpay_payment_id);
          }
          setPaying(false);
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.open();
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || "Something went wrong.";
      setError(msg); setPaying(false);
    }
  }

  async function handlePay() {
    if (selTests.size === 0 && selPkgs.size === 0) { setError("Please select at least one test or package."); return; }
    if (config?.gateway === "icici" || config?.gateway === "hdfc") return handleICICI();
    if (config?.gateway === "bharatpe") return handleBharatPe();
    if (config?.gateway === "phonepe") return handlePhonePe();
    if (config?.gateway === "payu") return handlePayU();
    if (config?.gateway === "razorpay") return handleRazorpay();
    // No gateway configured — fall back to QR/UPI payment
    return handleQrPay();
  }

  async function handleICICI() {
    setError(""); setPaying(true);
    try {
      const res = await bookingPost<{ bookingRef: string; redirectUrl: string; tranCtx: string }>("/api/public/booking/icici-initiate", {
        name: pd.name, phone: pd.phone, email: pd.email, selectedDate: pd.date, timeSlot: pd.timeSlot,
        slotModality: pd.slotModality || "",
        source: mode === "kiosk" ? "kiosk" : "website",
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
        referringDoctorId: pd.referringDoctorId, referringDoctorName: pd.referringDoctorName,
      });
      setSuccessRef(res.bookingRef);
      window.location.href = res.redirectUrl;
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || "Something went wrong.";
      setError(msg); setPaying(false);
    }
  }

  async function handleQrPay() {
    if (selTests.size === 0 && selPkgs.size === 0) { setError("Please select at least one test or package."); return; }
    setError(""); setPaying(true);
    try {
      const res = await bookingPost<{ bookingRef: string; amount: number; upiVpa: string; upiName: string; upiUrl: string; upiQrImageUrl: string; clinicName: string }>("/api/public/booking/qr-initiate", {
        name: pd.name, phone: pd.phone, email: pd.email, selectedDate: pd.date, timeSlot: pd.timeSlot,
        slotModality: pd.slotModality || "",
        source: mode === "kiosk" ? "kiosk" : "website",
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
        referringDoctorId: pd.referringDoctorId, referringDoctorName: pd.referringDoctorName,
      });
      setQrBookingRef(res.bookingRef);
      setQrAmount(res.amount);
      setQrUpiUrl(res.upiUrl);
      setQrUpiVpa(res.upiVpa);
      setQrUpiName(res.upiName);
      setStep(5);
      setPaying(false);
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || "Something went wrong.";
      setError(msg); setPaying(false);
    }
  }

  async function checkQrPayment() {
    if (!qrBookingRef) return;
    setQrChecking(true);
    try {
      const res = await bookingPost<{ success: boolean; status: string; alreadyPaid?: boolean }>("/api/public/booking/qr-confirm", { bookingRef: qrBookingRef });
      if (res.success) {
        setSuccessRef(qrBookingRef);
        bookingGet<{ booking: Record<string, any>; tokenNo: number | null }>(`/api/public/booking/by-ref?ref=${encodeURIComponent(qrBookingRef)}`)
          .then((detailRes) => {
            const b = detailRes.booking;
            const hasGateway = b.razorpayPaymentId || b.razorpayOrderId || b.payuTxnId || b.payuPaymentId || b.phonepeTransactionId || b.bharatpeProviderRefId || b.iciciTransactionId;
            const payment = derivePayment(b);
            setConfirmedBooking({
              name: b.name || "",
              phone: b.phone || "",
              email: b.email || "",
              selectedDate: b.selectedDate || "",
              timeSlot: b.timeSlot || "",
              totalAmount: b.totalAmount || "0",
              notes: b.notes || "",
              testIds: b.testIds || "[]",
              packageIds: b.packageIds || "[]",
              bookingRef: b.bookingRef || qrBookingRef,
              status: b.status || "",
              isVip: b.isVip === true || b.isVip === "true",
              isUnconfirmedQr: !hasGateway,
              billId: b.billId ?? null,
              gender: b.gender ?? null,
              ageValue: b.ageValue ?? null,
              ageUnit: b.ageUnit ?? null,
              paymentMethod: hasGateway ? payment.method : "upi",
              paymentReference: hasGateway ? payment.reference : "",
            });
            setTokenNo(detailRes.tokenNo);
            setStep(6);
          })
          .catch(() => {
            setStep(3);
          });
      } else {
        setError("Payment not yet confirmed. Please complete the UPI payment and try again.");
      }
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || "Could not verify payment. Please try again.";
      setError(msg);
    } finally {
      setQrChecking(false);
    }
  }

  const gatewayLabel =
    config?.gateway === "icici" ? "Orange Pay" :
    config?.gateway === "hdfc" ? "HDFC Bank" :
    config?.gateway === "bharatpe" ? "BharatPe" :
    config?.gateway === "phonepe" ? "PhonePe" :
    config?.gateway === "payu" ? "PayU" :
    config?.gateway === "razorpay" ? "Razorpay" : "QR / UPI";

  const isOnline = config?.enabled ?? false;
  const hasRealGateway = Boolean(config?.gateway);

  /* ── Layout helpers ── */
  const cardStyle: React.CSSProperties = {
    background: "#fff",
    border: "1px solid hsl(var(--cd-hairline))",
    borderRadius: "var(--site-radius)",
    padding: "1.5rem",
    boxShadow: "var(--site-shadow-sm)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1.5px solid hsl(var(--cd-hairline))",
    borderRadius: "calc(var(--site-radius) * 0.5)",
    padding: ".75rem 1rem",
    fontSize: "0.9375rem",
    fontFamily: "var(--site-font)",
    background: "hsl(var(--cd-scan-white))",
    color: "hsl(var(--cd-slate))",
    transition: "border-color .15s, box-shadow .15s",
  };

  const btnPrimary: React.CSSProperties = {
    background: "hsl(var(--cd-amber))",
    color: "hsl(var(--cd-navy))",
    padding: ".8rem 1.6rem",
    borderRadius: "calc(var(--site-radius) * 0.6)",
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: ".5rem",
    justifyContent: "center",
    transition: "filter .18s, transform .18s",
  };

  const btnOutline: React.CSSProperties = {
    background: "transparent",
    color: "hsl(var(--cd-slate))",
    padding: ".8rem 1.6rem",
    borderRadius: "calc(var(--site-radius) * 0.6)",
    fontWeight: 600,
    border: "1.5px solid hsl(var(--cd-hairline))",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: ".5rem",
    justifyContent: "center",
  };

  const isKioskMode = mode === "kiosk";

  const fallbackGridBg = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="%2394a3b8" stroke-width="1"/></pattern><radialGradient id="pulse1" cx="20%" cy="30%"><stop offset="0%" style="stop-color:%230369a1;stop-opacity:0.45"/><stop offset="100%" style="stop-color:%230369a1;stop-opacity:0"/></radialGradient><radialGradient id="pulse2" cx="80%" cy="70%"><stop offset="0%" style="stop-color:%2306b6d4;stop-opacity:0.38"/><stop offset="100%" style="stop-color:%2306b6d4;stop-opacity:0"/></radialGradient></defs><rect width="1200" height="800" fill="white"/><rect width="1200" height="800" fill="url(%23grid)"/><circle cx="240" cy="240" r="260" fill="url(%23pulse1)"/><circle cx="1000" cy="600" r="320" fill="url(%23pulse2)"/><circle cx="100" cy="700" r="200" fill="url(%23pulse1)" opacity="0.7"/><circle cx="1100" cy="150" r="230" fill="url(%23pulse2)" opacity="0.6"/></svg>')`;

  return (
    <div style={{
      minHeight: "100vh",
      background: "hsl(var(--cd-scan-white))",
      color: "hsl(var(--cd-slate))"
    }}>
      {!isKioskMode && (
        <div className="cd-book-topbar">
          <div className="container-narrow cd-book-topbar-row">
            <a href={BASE} className="cd-book-back-link">
              <ChevronLeft size={18} /> Back to Home
            </a>
            <div className="cd-book-topbar-title">
              {settings.logoUrl && (
                <img
                  src={resolveAssetUrl(settings.logoUrl)}
                  alt="Clinic Logo"
                  style={{ height: 32, width: "auto", marginRight: ".5rem", objectFit: "contain" }}
                />
              )}
              <CalendarCheck size={16} /> Book a Test
            </div>
          </div>
        </div>
      )}

      {!isKioskMode && (() => {
        // Admin-controlled overlay intensity/text color (Settings → Website
        // Builder → Booking Page Background). Both values are derived from
        // the SAME setting so the overlay and the text always stay in sync —
        // previously the overlay opacity was hardcoded in this inline style
        // while the text color was hardcoded separately in index.css, which
        // is why past fixes to one didn't fix the other.
        const overlayPct = Math.max(0, Math.min(100, settings.bookHeroOverlayOpacity ?? 55));
        const overlayAlpha = overlayPct / 100;
        const textColor = settings.bookHeroTextColor === "dark" ? "hsl(var(--cd-slate))" : "#fff";
        const bookHeroImageUrl = resolveAssetUrl(settings.bookHeroImageUrl);
        return (
        <div className="cd-book-hero cd-scan-panel" style={{
          backgroundImage: bookHeroImageUrl
            ? `linear-gradient(135deg, rgba(255,255,255,${overlayAlpha}) 0%, rgba(255,255,255,${Math.max(0, overlayAlpha - 0.05)}) 100%), url('${bookHeroImageUrl}')`
            : `linear-gradient(135deg, rgba(255,255,255,${overlayAlpha}) 0%, rgba(255,255,255,${Math.max(0, overlayAlpha - 0.05)}) 100%), ${fallbackGridBg}`,
          backgroundSize: "cover",
          backgroundAttachment: "fixed",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          color: textColor,
        }}>
          <div className="container-narrow" style={{ textAlign: "center", position: "relative", zIndex: 2 }}>
            {settings.logoUrl && (
              <img
                src={resolveAssetUrl(settings.logoUrl)}
                alt="Clinic Logo"
                style={{ height: 60, width: "auto", marginBottom: "1rem", objectFit: "contain" }}
              />
            )}
            {isHope && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: ".4rem", padding: ".3rem .8rem", borderRadius: 9999, background: "rgba(255,255,255,.9)", color: "hsl(var(--cd-navy))", fontWeight: 700, fontSize: ".8rem", marginBottom: ".75rem" }}>
                <Stethoscope size={14} /> Hope NeuroTrauma &amp; MultiSpeciality Hospital
              </div>
            )}
            <h1 className="cd-display cd-book-hero-title" style={{ color: textColor }}>
              {isHope ? "Book Hope's dedicated tests" : "Book your diagnostic test"}
            </h1>
            <p className="cd-book-hero-sub" style={{ color: textColor }}>
              {isHope
                ? "Hope's selected investigations — booked and paid securely through Care Diagnostics, Deoghar."
                : "MRI, CT Scan, Ultrasound, Digital X-Ray, Pathology & Health Packages at Care Diagnostics, Deoghar."}
            </p>
            <TrustBadges />
          </div>
        </div>
        );
      })()}

      {/* Main content */}
      <div className="container-narrow" style={{ padding: "2.5rem 1rem 4.5rem", maxWidth: 920 }}>
        <Stepper step={step} />

        {step === 3 ? (
          <div style={{ ...cardStyle, textAlign: "center", maxWidth: 480, margin: "0 auto" }} className="cd-book-status-card">
            <span className="cd-appt-status-icon cd-appt-status-success" style={{ width: 72, height: 72 }} aria-hidden="true"><Check size={36} /></span>
            <h2 className="cd-display cd-book-status-title">
              {isOnline ? "Booking Confirmed!" : "Request Submitted!"}
            </h2>
            {isOnline && successRef && (
              <>
                <p className="cd-section-sub" style={{ margin: "0 0 .5rem" }}>Your booking reference</p>
                <div className="cd-mono cd-appt-ref" style={{ fontSize: "1.5rem" }}>{successRef}</div>
              </>
            )}
            <p className="cd-section-sub" style={{ fontSize: ".9375rem", margin: "0 0 1.5rem" }}>
              Our staff will confirm your appointment shortly. You may receive a call or WhatsApp message.
            </p>
            <div style={{ display: "flex", gap: ".75rem", justifyContent: "center", flexWrap: "wrap" }}>
              <a href={BASE} style={{ ...btnPrimary, textDecoration: "none" }}>Back to Home</a>
              <a href={`tel:${phone}`} style={{ ...btnOutline, textDecoration: "none" }}>
                <Phone size={16} /> Call Us
              </a>
            </div>
          </div>
        ) : step === 4 ? (
          <div style={{ ...cardStyle, textAlign: "center", maxWidth: 480, margin: "0 auto" }} className="cd-book-status-card">
            <span className="cd-appt-status-icon cd-appt-status-fail" style={{ width: 72, height: 72 }} aria-hidden="true">&times;</span>
            <h2 className="cd-display cd-book-status-title" style={{ fontSize: "1.375rem" }}>Payment Not Completed</h2>
            <p className="cd-section-sub" style={{ fontSize: ".9375rem" }}>{failReason || "Your payment was not completed."}</p>
            <button style={btnPrimary} onClick={() => { setStep(2); setFailReason(""); }}>Try Again</button>
          </div>
        ) : step === 0 ? (
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            <div style={cardStyle}>
              <h2 className="cd-appt-subheading" style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: "1.0625rem" }}>
                <User size={20} style={{ color: "hsl(var(--cd-teal))" }} /> Patient Details
              </h2>
              <SelfRegistrationForm
                mode={mode}
                timeSlots={liveSlots || config?.bookingTimeSlots}
                onDateChange={(d) => {
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
                  bookingGet<{ slots: NonNullable<BookingConfig["bookingTimeSlots"]> }>(`/api/public/booking/slots?date=${encodeURIComponent(d)}`)
                    .then((r) => setLiveSlots(r.slots))
                    .catch(() => {});
                }}
                doctors={doctors}
                initialValues={{
                  firstName: pd.name,
                  lastName: "",
                  phone: pd.phone,
                  gender: pd.gender,
                  ageValue: pd.ageValue,
                  ageUnit: pd.ageUnit,
                  email: pd.email,
                  date: pd.date,
                  timeSlot: pd.timeSlot,
                  notes: pd.notes,
                  isVip: pd.isVip,
                  referringDoctorId: pd.referringDoctorId,
                  referringDoctorName: pd.referringDoctorName,
                }}
                vipEnabled={config?.enableVipBooking !== false}
                submitButtonClass="cd-btn-primary"
                onSubmit={(data) => {
                  setPd({
                    name: (data.firstName + " " + data.lastName).trim(),
                    phone: data.phone,
                    email: data.email || "",
                    date: data.date || "",
                    timeSlot: data.timeSlot || "",
                    notes: data.notes || "",
                    isVip: !!data.isVip,
                    ageValue: String(data.ageValue),
                    ageUnit: data.ageUnit,
                    gender: data.gender,
                    referringDoctorId: data.referringDoctorId ?? null,
                    referringDoctorName: data.referringDoctorName || "",
                    slotModality: data.slotModality || "",
                  });
                  loadCatalog();
                  setStep(1);

              {/* VIP Queue Advantages */}
              {config?.vipAdvantages && (
                <div style={{ marginTop: "1rem", padding: "1rem", background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)", border: "2px solid #fcd34d", borderRadius: "var(--site-radius)", display: "flex", alignItems: "flex-start", gap: ".75rem" }}>
                  <Sparkles size={20} style={{ color: "#b45309", flexShrink: 0, marginTop: ".1rem" }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: ".95rem", color: "#b45309", marginBottom: ".35rem" }}>VIP Queue Advantages</div>
                    <div style={{ fontSize: ".85rem", color: "#92400e", lineHeight: "1.4", whiteSpace: "pre-wrap" }}>{config.vipAdvantages}</div>
                  </div>
                </div>
              )}

                }}
              />
            </div>

            {/* Quick contact */}
            {!isKioskMode && (
              <div style={{ marginTop: "1.5rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                <div style={{ ...cardStyle, padding: "1rem", display: "flex", alignItems: "center", gap: ".75rem" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 9999, background: "hsl(var(--cd-teal) / .1)", color: "hsl(var(--cd-teal))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Phone size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: ".75rem", color: "hsl(var(--cd-slate) / .55)" }}>Call us</div>
                    <div style={{ fontWeight: 700, fontSize: ".95rem" }}>{phone}</div>
                  </div>
                </div>
                <div style={{ ...cardStyle, padding: "1rem", display: "flex", alignItems: "center", gap: ".75rem" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 9999, background: "hsl(var(--cd-teal) / .1)", color: "hsl(var(--cd-teal))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <MapPin size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: ".75rem", color: "hsl(var(--cd-slate) / .55)" }}>Visit us</div>
                    <div style={{ fontWeight: 600, fontSize: ".85rem" }}>{workAddr}</div>
                  </div>
                </div>
                <div style={{ ...cardStyle, padding: "1rem", display: "flex", alignItems: "center", gap: ".75rem" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 9999, background: "hsl(var(--cd-teal) / .1)", color: "hsl(var(--cd-teal))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <CalendarDays size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: ".75rem", color: "hsl(var(--cd-slate) / .55)" }}>Working hours</div>
                    <div style={{ fontWeight: 600, fontSize: ".85rem" }}>Mon–Sat  7 AM – 9 PM</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : step === 1 ? (
          <div>
            {/* Quick Select Tests — sourced from the same clinic_settings.quick_test_ids
                Billing Desk and the kiosk use for their quick-test slots. Sized to match
                the previous "Our Services" photo tiles (200px min-width, 180px tall).
                Tiles fall back to a solid category-color gradient; admins can optionally
                set a background photo per category (Settings → Booking Page → Quick
                Select Test Tiles) with an adjustable white-wash overlay for readability. */}
            {(() => {
              const quickTests = (config?.quickTestIds ?? [])
                .map((id) => (id ? shownTests.find((t) => t.id === id) : null))
                .filter((t): t is TestItem => !!t);
              if (quickTests.length === 0) return null;

              const getCategoryColor = (category?: string) => {
                if (!category) return "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)";
                switch (category.toLowerCase()) {
                  case "biochemistry": return "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)"; // Amber
                  case "cardiology": return "linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)"; // Red
                  case "radiology": return "linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)"; // Blue
                  case "pathology": return "linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)"; // Purple
                  case "hematology": return "linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)"; // Pink
                  case "endocrinology": return "linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)"; // Green
                  case "serology": return "linear-gradient(135deg, #f5e6ff 0%, #ede9fe 100%)"; // Indigo
                  default: return "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)"; // Light green
                }
              };

              let categoryImages: Record<string, string> = {};
              try { categoryImages = JSON.parse(config?.quickTestCategoryImages || "{}"); } catch { /* ignore */ }
              const tileOverlayAlpha = Math.max(0, Math.min(100, config?.quickTestOverlayOpacity ?? 35)) / 100;
              const getCategoryImage = (category?: string): string => {
                const key = category ? category.toLowerCase() : "default";
                const raw = categoryImages[key] || categoryImages.default || "";
                return resolveAssetUrl(raw);
              };

              const quickCategories = Array.from(
                new Set(quickTests.map((t) => t.category || "Other"))
              ).sort();
              const quickTabs = ["All", ...quickCategories];
              const visibleQuickTests = quickTab === "All"
                ? quickTests
                : quickTests.filter((t) => (t.category || "Other") === quickTab);

              return (
                <div style={{ marginBottom: "1.5rem" }}>
                  <h3 style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.75rem", color: "hsl(var(--cd-slate))", display: "flex", alignItems: "center", gap: ".4rem" }}>
                    ⚡ Quick Select Tests
                  </h3>
                  {quickTabs.length > 2 && (
                    <div className="cd-tab-row" style={{ justifyContent: "flex-start", marginBottom: "1rem" }}>
                      {quickTabs.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          role="tab"
                          aria-selected={quickTab === cat}
                          onClick={() => setQuickTab(cat)}
                          className={`cd-tab-btn ${quickTab === cat ? "active" : ""}`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.75rem" }}>
                    {visibleQuickTests.map((test) => {
                      const sel = selTests.has(test.id);
                      const categoryColor = getCategoryColor(test.category);
                      const categoryImage = getCategoryImage(test.category);
                      const washColor = sel ? "hsl(var(--cd-teal))" : "255,255,255";
                      const background = categoryImage
                        ? sel
                          ? `linear-gradient(to top, rgba(0,0,0,.65), rgba(0,0,0,.15)), linear-gradient(135deg, hsl(var(--cd-teal) / .55), hsl(var(--cd-teal) / .4)), url('${categoryImage}')`
                          : `linear-gradient(to top, rgba(0,0,0,.6), rgba(0,0,0,.1)), linear-gradient(135deg, rgba(${washColor},${tileOverlayAlpha}), rgba(${washColor},${tileOverlayAlpha})), url('${categoryImage}')`
                        : sel
                          ? "linear-gradient(135deg, hsl(var(--cd-teal) / .25), hsl(var(--cd-teal) / .15))"
                          : categoryColor;
                      const onImage = !!categoryImage;
                      return (
                        <button
                          key={test.id}
                          type="button"
                          onClick={() => toggleTest(test.id)}
                          title={`${test.name} (${test.category})`}
                          style={{
                            position: "relative",
                            height: "180px",
                            padding: "0.75rem",
                            borderRadius: "var(--site-radius)",
                            border: sel ? "3px solid hsl(var(--cd-teal))" : "2px solid rgba(0,0,0,.1)",
                            background,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            cursor: "pointer",
                            transition: "all .2s cubic-bezier(0.4, 0, 0.2, 1)",
                            textAlign: "center",
                            color: onImage ? "#ffffff" : sel ? "hsl(var(--cd-teal))" : "#1f2937",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: onImage ? "flex-end" : "center",
                            boxShadow: sel
                              ? "0 10px 25px -5px hsl(var(--cd-teal) / .2), inset 0 1px 0 rgba(255,255,255,0.5)"
                              : "0 2px 8px rgba(0,0,0,.08)",
                            transform: sel ? "scale(1.03)" : "scale(1)",
                          }}
                        >
                          <div style={{
                            fontSize: "1.15rem",
                            fontWeight: 900,
                            letterSpacing: "0.3px",
                            lineHeight: 1.25,
                            textShadow: onImage ? "0 1px 3px rgba(0,0,0,.85), 0 0 12px rgba(0,0,0,.5)" : "none",
                          }}>
                            {test.name}
                          </div>
                          <div style={{
                            fontSize: "0.75rem",
                            color: onImage ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.5)",
                            marginTop: "0.4rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            textShadow: onImage ? "0 1px 2px rgba(0,0,0,.7)" : "none",
                          }}>
                            {test.category}
                          </div>
                          {sel && (
                            <div style={{
                              position: "absolute",
                              top: "0.5rem",
                              right: "0.5rem",
                              width: "28px",
                              height: "28px",
                              borderRadius: "50%",
                              background: "hsl(var(--cd-teal))",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "0 2px 8px hsl(var(--cd-teal) / .3)",
                            }}>
                              <Check size={16} style={{ color: "#fff", fontWeight: "bold" }} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Search & filter bar */}
            <div style={{ ...cardStyle, marginBottom: "1rem", padding: "1rem", display: "flex", gap: ".75rem", flexWrap: "wrap", alignItems: "center" }}>
              <input
                style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                placeholder="Search tests by name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
                {categories.map((cat) => (
                  <button key={cat} onClick={() => setCatFilter(cat)}
                    style={{
                      padding: ".35rem .9rem", borderRadius: 9999, fontSize: ".82rem", fontWeight: 600,
                      border: "none", cursor: "pointer",
                      background: catFilter === cat ? "hsl(var(--cd-teal))" : "hsl(var(--cd-scan-white))",
                      color: catFilter === cat ? "#fff" : "hsl(var(--cd-slate))",
                      transition: "all .15s",
                    }}>
                    {cat === "all" ? "All Tests" : cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Packages */}
            {shownPkgs.length > 0 && (
              <div style={{ marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: ".75rem", display: "flex", alignItems: "center", gap: ".4rem" }}>
                  <Package size={18} style={{ color: "hsl(var(--cd-teal))" }} /> Health Packages
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: ".75rem" }}>
                  {shownPkgs.map((p) => (
                    <button key={p.id} type="button" onClick={() => togglePkg(p.id)}
                      style={{
                        textAlign: "left", padding: "1rem",
                        borderRadius: "var(--site-radius)",
                        border: `2px solid ${selPkgs.has(p.id) ? "hsl(var(--cd-teal))" : "hsl(var(--cd-hairline))"}`,
                        background: selPkgs.has(p.id) ? "hsl(var(--cd-teal) / .06)" : "#fff",
                        cursor: "pointer", transition: "all .15s",
                      }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: ".25rem" }}>
                        <span style={{ fontWeight: 700, fontSize: ".95rem" }}>{p.name}</span>
                        {selPkgs.has(p.id) && <Check size={18} style={{ color: "hsl(var(--cd-teal))", flexShrink: 0 }} />}
                      </div>
                      {p.description && <div style={{ fontSize: ".8rem", color: "hsl(var(--cd-slate) / .55)", marginBottom: ".5rem" }}>{p.description}</div>}
                      <div style={{ fontWeight: 800, color: "hsl(var(--cd-teal))", fontSize: "1.05rem" }}>{fmt(Number(p.price))}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Tests */}
            {filteredTests.length > 0 && (
              <div>
                <h3 style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: ".75rem", display: "flex", alignItems: "center", gap: ".4rem" }}>
                  <FlaskConical size={18} style={{ color: "hsl(var(--cd-teal))" }} /> Individual Tests
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: ".5rem" }}>
                  {filteredTests.map((t) => (
                    <button key={t.id} type="button" onClick={() => toggleTest(t.id)}
                      style={{
                        textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: ".7rem 1rem", borderRadius: "var(--site-radius)",
                        border: `1.5px solid ${selTests.has(t.id) ? "hsl(var(--cd-teal))" : "hsl(var(--cd-hairline))"}`,
                        background: selTests.has(t.id) ? "hsl(var(--cd-teal) / .06)" : "#fff",
                        cursor: "pointer", transition: "all .15s",
                      }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: ".92rem" }}>{t.name}</div>
                        <div style={{ fontSize: ".75rem", color: "hsl(var(--cd-slate) / .55)" }}>{t.code} · {t.category}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                        <span style={{ fontWeight: 700, fontSize: ".95rem", color: "hsl(var(--cd-teal))", whiteSpace: "nowrap" }}>{fmt(Number(t.price))}</span>
                        {selTests.has(t.id) && <Check size={16} style={{ color: "hsl(var(--cd-teal))" }} />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filteredTests.length === 0 && search.trim() && (
              <div style={{ textAlign: "center", padding: "2rem", color: "hsl(var(--cd-slate) / .55)" }}>
                No tests match "{search}"
              </div>
            )}

            {/* Sticky bottom bar */}
            {(selTests.size > 0 || selPkgs.size > 0) && (
              <div style={{
                position: "sticky", bottom: "1rem",
                background: "#fff", border: "1px solid hsl(var(--cd-hairline))",
                borderRadius: "var(--site-radius)", padding: "1rem 1.25rem",
                boxShadow: "0 8px 32px rgba(0,0,0,.1)",
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap",
              }}>
                <div>
                  <div style={{ fontSize: ".85rem", color: "hsl(var(--cd-slate) / .55)" }}>{selTests.size + selPkgs.size} item(s) selected</div>
                  <div style={{ fontWeight: 800, fontSize: "1.25rem", color: "hsl(var(--cd-teal))" }}>{fmt(total)}</div>
                </div>
                <div style={{ display: "flex", gap: ".5rem" }}>
                  <button style={btnOutline} onClick={() => setStep(0)}><ArrowLeft size={16} /> Back</button>
                  <button style={btnPrimary} onClick={() => setStep(2)}>Review &amp; Pay <ChevronRight size={18} /></button>
                </div>
              </div>
            )}
          </div>
        ) : step === 5 ? (
          /* QR Payment */
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={cardStyle}>
              <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
                {qrUpiUrl ? (
                  <div style={{ display: "inline-block", padding: "1rem", background: "white", borderRadius: "var(--site-radius)", border: "1px solid hsl(var(--cd-hairline))" }}>
                    <QRCodeSVG value={qrUpiUrl} size={240} level="H" />
                  </div>
                ) : config?.upiQrImageUrl ? (
                  <img src={config.upiQrImageUrl} alt="UPI QR Code" style={{ width: "100%", maxWidth: 320, borderRadius: "var(--site-radius)", border: "1px solid hsl(var(--cd-hairline))" }} />
                ) : (
                  <div style={{ width: 240, height: 240, background: "hsl(var(--cd-scan-white))", borderRadius: "var(--site-radius)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
                    <QrCode size={64} style={{ color: "hsl(var(--cd-slate) / .55)" }} />
                  </div>
                )}
                <div style={{ fontSize: ".85rem", color: "hsl(var(--cd-slate) / .55)", marginTop: ".75rem" }}>
                  Scan with any UPI app (PhonePe, Google Pay, Paytm, etc.) — amount is pre-filled
                </div>
                {qrUpiUrl && (
                  <div style={{ fontSize: ".75rem", color: "hsl(var(--cd-slate) / .55)", marginTop: ".25rem" }}>
                    Dynamic QR for <strong>{fmt(qrAmount)}</strong>
                  </div>
                )}
              </div>

              <div style={{ background: "hsl(var(--site-muted) / .5)", borderRadius: "var(--site-radius)", padding: "1rem", marginBottom: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".5rem" }}>
                  <span style={{ fontSize: ".85rem" }}>Amount</span>
                  <span style={{ fontWeight: 800, fontSize: "1.1rem" }}>{fmt(qrAmount)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".5rem" }}>
                  <span style={{ fontSize: ".85rem" }}>Booking Ref</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{qrBookingRef}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".5rem" }}>
                  <span style={{ fontSize: ".85rem" }}>Pay to</span>
                  <span style={{ fontWeight: 600 }}>{qrUpiName || config?.kioskUpiName || "Care Diagnostics"}</span>
                </div>
                {qrUpiVpa && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: ".85rem" }}>UPI ID</span>
                    <span style={{ fontFamily: "monospace", fontSize: ".85rem" }}>{qrUpiVpa}</span>
                  </div>
                )}
              </div>

              {error && (
                <div style={{ color: "hsl(0 72% 40%)", fontSize: ".85rem", marginBottom: ".75rem", padding: ".75rem", background: "hsl(0 85% 96%)", borderRadius: "var(--site-radius)", border: "1px solid hsl(0 72% 90%)" }}>
                  {error}
                </div>
              )}

              <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap" }}>
                <button style={btnOutline} onClick={() => setStep(2)}><ArrowLeft size={16} /> Back</button>
                <button style={{ ...btnPrimary, flex: 1 }} onClick={checkQrPayment} disabled={qrChecking}>
                  {qrChecking ? (
                    <><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Checking...</>
                  ) : (
                    <>I have paid</>
                  )}
                </button>
              </div>

              <p style={{ fontSize: ".75rem", color: "hsl(var(--cd-slate) / .55)", marginTop: ".75rem", textAlign: "center" }}>
                After making the payment, click "I have paid". Staff will verify and confirm your booking.
              </p>
            </div>
          </div>
        ) : step === 6 ? (
          /* Payment Confirmed — ICICI / gateway confirmation */
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            <div style={{ ...cardStyle, textAlign: "center" }}>
              <div style={{ width: 72, height: 72, borderRadius: 9999, background: "hsl(142 76% 92%)", color: "hsl(142 71% 35%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem" }}>
                <Check size={36} />
              </div>
              <h2 style={{ fontWeight: 800, fontSize: "1.3rem", marginBottom: ".5rem" }}>
                {confirmedBooking?.isUnconfirmedQr ? "Booking Received" : "Payment Successful"}
              </h2>
              <p style={{ color: "hsl(var(--cd-slate) / .55)", marginBottom: "1rem", fontSize: ".92rem" }}>
                {confirmedBooking?.isUnconfirmedQr ? "Booking is pending payment confirmation from staff." : "Your booking is confirmed and payment received."}
              </p>

              {confirming ? (
                <div style={{ marginBottom: "1rem", color: "hsl(var(--cd-slate) / .55)" }}>
                  <Loader2 size={20} style={{ animation: "spin 1s linear infinite", margin: "0 auto .5rem" }} /> Loading booking details…
                </div>
              ) : (
                <div style={{ marginBottom: "1.5rem", textAlign: "left" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "1.3rem", fontWeight: 800, letterSpacing: 2, color: "hsl(var(--cd-teal))", textAlign: "center", marginBottom: "1rem" }}>
                    {successRef}
                  </div>

                  {confirmedBooking && (
                    <div style={{ background: "hsl(var(--site-muted) / .4)", borderRadius: "var(--site-radius)", padding: "1rem", fontSize: ".92rem", lineHeight: 1.5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--cd-slate) / .55)" }}>Patient</span>
                        <span style={{ fontWeight: 600 }}>{confirmedBooking.name}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--cd-slate) / .55)" }}>Phone</span>
                        <span style={{ fontWeight: 600 }}>{confirmedBooking.phone}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--cd-slate) / .55)" }}>Date</span>
                        <span style={{ fontWeight: 600 }}>{confirmedBooking.selectedDate}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--cd-slate) / .55)" }}>Time</span>
                        <span style={{ fontWeight: 600 }}>{confirmedBooking.timeSlot}</span>
                      </div>
                       <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--cd-slate) / .55)" }}>Amount Paid</span>
                        <span style={{ fontWeight: 800, color: confirmedBooking?.isUnconfirmedQr ? "orange" : "hsl(var(--cd-teal))" }}>
                          {confirmedBooking?.isUnconfirmedQr ? `Amount ${fmt(Number(confirmedBooking.totalAmount))} (To Be Confirmed)` : fmt(Number(confirmedBooking.totalAmount))}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--cd-slate) / .55)" }}>Status</span>
                        <span style={{ fontWeight: 600, textTransform: "none", color: confirmedBooking?.isUnconfirmedQr ? "orange" : "inherit" }}>
                          {confirmedBooking?.isUnconfirmedQr ? "Confirmed on confirmation of Payment" : confirmedBooking.status}
                        </span>
                      </div>
                      {confirmedBooking.isVip && (
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                          <span style={{ color: "hsl(var(--cd-slate) / .55)" }}>Queue</span>
                          <span className="cd-book-vip-badge"><Sparkles size={12} /> VIP Priority</span>
                        </div>
                      )}

                      {tokenNo !== null && (
                        <div style={{ background: "hsl(210 100% 96%)", border: "1.5px dashed hsl(210 100% 80%)", borderRadius: "var(--site-radius)", padding: "0.75rem", marginTop: "1rem", textAlign: "center", maxWidth: "320px", margin: "1rem auto 0" }}>
                          <span style={{ fontSize: ".75rem", color: "hsl(210 100% 30%)", fontWeight: 600, display: "block" }}>YOUR DAILY QUEUE TOKEN</span>
                          <span style={{ fontSize: "1.2rem", fontWeight: 900, color: "hsl(210 100% 25%)", display: "block", margin: ".15rem 0" }}>#{tokenNo}</span>
                          <span style={{ fontSize: ".7rem", color: "hsl(var(--cd-slate) / .55)" }}>Please show this token at the reception desk.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Hidden — renders a real, scannable QR for the printable receipt.
                  Never shown to the patient; only its canvas data-URL is read
                  when "Print Receipt" is clicked. */}
              {successRef && (
                <div style={{ position: "absolute", left: -9999, top: -9999 }} aria-hidden="true">
                  <QRCodeCanvas ref={receiptQrRef} value={successRef} size={160} level="M" includeMargin={false} />
                </div>
              )}

              <div style={{ display: "flex", gap: ".75rem", justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  style={{ ...btnPrimary, textDecoration: "none" }}
                  onClick={() => {
                    if (!confirmedBooking) return;
                    const win = openBlankPrintWindow();
                    const tIds: number[] = JSON.parse(confirmedBooking.testIds || "[]");
                    const pIds: number[] = JSON.parse(confirmedBooking.packageIds || "[]");
                    const orderTests = [
                      ...tIds.map((id) => tests.find((t) => t.id === Number(id))).filter(Boolean)
                        .map((t) => ({ price: Number(t!.price), test: { code: t!.code, name: t!.name, category: t!.category } })),
                      ...pIds.map((id) => pkgs.find((p) => p.id === Number(id))).filter(Boolean)
                        .map((p) => ({ price: Number(p!.price), displayName: p!.name, test: { code: p!.code, name: p!.name, category: "Package" } })),
                    ];
                    // Real, scannable QR — read the hidden canvas's data-URL (falls back to no QR if not ready)
                    const qrDataUrl = receiptQrRef.current?.toDataURL("image/png") || "";
                    const bill: PrintBillData = {
                      billNumber: confirmedBooking.bookingRef,
                      subtotal: confirmedBooking.totalAmount,
                      discount: 0,
                      totalAmount: confirmedBooking.totalAmount,
                      paidAmount: confirmedBooking.isUnconfirmedQr ? 0 : confirmedBooking.totalAmount,
                      balanceAmount: confirmedBooking.isUnconfirmedQr ? confirmedBooking.totalAmount : 0,
                      status: confirmedBooking.isUnconfirmedQr ? "pending" : "paid",
                      createdAt: new Date().toISOString(),
                      patient: {
                        firstName: confirmedBooking.name,
                        lastName: "",
                        patientId: "",
                        phone: confirmedBooking.phone,
                        gender: confirmedBooking.gender,
                        ageValue: confirmedBooking.ageValue,
                        ageUnit: confirmedBooking.ageUnit,
                      },
                      order: { tests: orderTests },
                      payments: confirmedBooking.isUnconfirmedQr ? [] : [{
                        method: confirmedBooking.paymentMethod || "upi",
                        amount: confirmedBooking.totalAmount,
                        referenceNumber: confirmedBooking.paymentReference || null,
                      }],
                      tokenNo,
                    };
                    const clinic: PrintClinic = clinicPrint ?? { name: settings.siteTitle, address: settings.address, logoDataUrl: settings.logoUrl };
                    // Patient-facing receipt: a compact A5 slip, but printed on
                    // a physical A4 sheet (compactOnA4) — that's what almost
                    // every patient's home/office printer is loaded with. The
                    // slip stays A5-sized and centred at the top of the A4 page
                    // (tidy and cuttable) rather than being stretched to fill
                    // A4. (The clinic's own counter copy stays A5 via the
                    // Billing Desk's own paper-size setting — a separate path.)
                    const html = buildBillPrintHtml({ bill, clinic, paperSize: "A5", isBW: false, qrDataUrl, compactFooterGap: true, compactOnA4: true });
                    writeAndPrint(win, html);
                  }}
                >
                  <Receipt size={16} /> Print Receipt
                </button>
                <a href={BASE} style={{ ...btnOutline, textDecoration: "none" }}>
                  <ChevronLeft size={16} /> Back to Home
                </a>
              </div>

              <p style={{ fontSize: ".78rem", color: "hsl(var(--cd-slate) / .55)", marginTop: "1rem" }}>
                Please save this booking reference. You may receive a confirmation call or WhatsApp message.
              </p>
            </div>
          </div>
        ) : (
          /* Review & Pay */
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <div style={cardStyle}>
              {/* Supported payment methods logos or custom banners at the top, spanning horizontal width */}
              {((config?.gateway === "icici" && config?.customIciciBannerUrl) ||
                (config?.gateway === "phonepe" && config?.customPhonepeBannerUrl) ||
                (config?.gateway === "bharatpe" && config?.customBharatpeBannerUrl) ||
                (config?.gateway === "payu" && config?.customPayuBannerUrl)) ? (
                <div style={{ margin: "-1.5rem -1.5rem 1.25rem -1.5rem", borderBottom: "1px solid hsl(var(--cd-hairline))" }}>
                  <img
                    src={resolveAssetUrl(
                      config?.gateway === "icici" ? config.customIciciBannerUrl :
                      config?.gateway === "phonepe" ? config.customPhonepeBannerUrl :
                      config?.gateway === "bharatpe" ? config.customBharatpeBannerUrl :
                      config.customPayuBannerUrl,
                    )}
                    alt={`${gatewayLabel} Banner`}
                    style={{ width: "100%", height: "auto", display: "block", objectFit: "cover" }}
                  />
                </div>
              ) : config?.enablePaymentLogos !== false ? (
                <div style={{ margin: "-1.5rem -1.5rem 1.25rem -1.5rem", borderBottom: "1px solid hsl(var(--cd-hairline))" }}>
                  <img
                    src="/payment-methods-logo.png"
                    alt="Supported Payment Methods"
                    style={{ width: "100%", height: "auto", display: "block", objectFit: "cover" }}
                  />
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                <h2 className="cd-appt-subheading" style={{ display: "flex", alignItems: "center", gap: ".5rem", margin: 0, fontSize: "1.0625rem" }}>
                  <CreditCard size={20} style={{ color: "hsl(var(--cd-teal))" }} /> Order Summary
                </h2>
                {config?.gateway === "icici" && (
                  <img src="/icici-orange-pay.jpeg" alt="ICICI Orange Pay" style={{ maxHeight: "32px", objectFit: "contain" }} />
                )}
                {config?.gateway === "hdfc" && (
                  <img src="/hdfc-smart-gateway.jpeg" alt="HDFC SmartGateway" style={{ maxHeight: "32px", objectFit: "contain" }} />
                )}
              </div>

              {/* Patient details */}
              <div style={{ background: "hsl(var(--site-muted) / .5)", borderRadius: "var(--site-radius)", padding: "1rem", marginBottom: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: ".5rem" }}>
                  <div>
                    <div style={{ fontSize: ".75rem", color: "hsl(var(--cd-slate) / .55)" }}>Patient</div>
                    <div style={{ fontWeight: 700 }}>{pd.name}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: ".75rem", color: "hsl(var(--cd-slate) / .55)" }}>Phone</div>
                    <div style={{ fontWeight: 600 }}>{pd.phone}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: ".75rem", color: "hsl(var(--cd-slate) / .55)" }}>Date &amp; Time</div>
                    <div style={{ fontWeight: 600 }}>{pd.date}{pd.timeSlot ? ` \u00b7 ${pd.timeSlot}` : ""}{pd.isVip && <span className="cd-book-vip-badge" style={{ marginLeft: ".4rem" }}><Sparkles size={12} /> VIP</span>}</div>
                  </div>
                </div>
              </div>

              {/* Selected items */}
              <div style={{ marginBottom: "1rem" }}>
                {tests.filter((t) => selTests.has(t.id)).map((t) => (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: ".5rem 0", borderBottom: "1px solid hsl(var(--site-border) / .5)", fontSize: ".95rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                      <FlaskConical size={14} style={{ color: "hsl(var(--cd-slate) / .55)" }} />
                      {t.name}
                    </div>
                    <span style={{ fontWeight: 600 }}>{fmt(Number(t.price))}</span>
                  </div>
                ))}
                {pkgs.filter((p) => selPkgs.has(p.id)).map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: ".5rem 0", borderBottom: "1px solid hsl(var(--site-border) / .5)", fontSize: ".95rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                      <Package size={14} style={{ color: "hsl(var(--cd-slate) / .55)" }} />
                      {p.name} <span style={{ fontSize: ".78rem", color: "hsl(var(--cd-slate) / .55)" }}>(Package)</span>
                    </div>
                    <span style={{ fontWeight: 600 }}>{fmt(Number(p.price))}</span>
                  </div>
                ))}
                {pd.isVip && (
                  <div className="cd-book-vip-row">
                    <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                      <Sparkles size={14} />
                      VIP Queue Priority Surcharge ({config?.vipPercentage || 50}%)
                    </div>
                    <span className="cd-mono" style={{ fontWeight: 600 }}>{fmt(vipCharge)}</span>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "1.2rem", borderTop: "2px solid hsl(var(--site-primary) / .3)", paddingTop: ".75rem", marginBottom: "1.25rem" }}>
                <span>Total Amount</span>
                <span style={{ color: "hsl(var(--cd-teal))" }}>{fmt(total)}</span>
              </div>

              {/* Disclaimer */}
              <div style={{ fontSize: ".78rem", color: "hsl(var(--cd-slate) / .55)", background: "hsl(var(--site-muted) / .3)", border: "1px solid hsl(var(--site-border) / .5)", borderRadius: "var(--site-radius)", padding: ".75rem", marginBottom: "1.25rem", lineHeight: "1.4" }}>
                <div style={{ fontWeight: 600, marginBottom: ".25rem", color: "hsl(var(--cd-slate))" }}>Important Disclaimers:</div>
                <ul style={{ paddingLeft: "1.1rem", margin: 0, listStyleType: "disc" }}>
                  {pd.isVip && (
                    <li>VIP Queue priority charges are higher than normal rates.</li>
                  )}
                  <li>Cancellation of online bookings will entail a deduction of {100 - (config?.disclaimerRefundPercentage ?? 90)}% administrative fee as per clinic policy.</li>
                </ul>
              </div>

              {error && (
                <div style={{ color: "hsl(0 72% 40%)", fontSize: ".85rem", marginBottom: ".75rem", padding: ".75rem", background: "hsl(0 85% 96%)", borderRadius: "var(--site-radius)", border: "1px solid hsl(0 72% 90%)" }}>
                  {error}
                </div>
              )}

              <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap" }}>
                <button style={btnOutline} onClick={() => setStep(1)}><ArrowLeft size={16} /> Back to Tests</button>
                {hasRealGateway ? (
                  config?.gateway === "icici" || config?.gateway === "hdfc" ? (
                    <button
                      className="cd-appt-gateway-btn"
                      style={{
                        flex: 1,
                        fontSize: "1rem",
                        background: config?.gateway === "icici" ? "#FF6600" : "#002F6C",
                      }}
                      onClick={handlePay}
                      disabled={paying}
                    >
                      {paying ? (
                        <>
                          <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Processing...
                        </>
                      ) : (
                        <>
                          <img
                            src={config?.gateway === "icici" ? "/icici-bank-logo.jpeg" : "/hdfc-bank-logo.jpeg"}
                            alt={config?.gateway === "icici" ? "ICICI Bank" : "HDFC Bank"}
                            className="cd-appt-gateway-logo"
                          />
                          <span>Pay {fmt(total)} by {config?.gateway === "icici" ? "ICICI Bank" : "HDFC Bank"}</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <button style={{ ...btnPrimary, flex: 1, fontSize: "1rem" }} onClick={handlePay} disabled={paying}>
                      {paying ? (
                        <>
                          <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Processing...
                        </>
                      ) : (
                        <>Pay {fmt(total)} via {gatewayLabel}</>
                      )}
                    </button>
                  )
                ) : (
                  <button style={{ ...btnPrimary, flex: 1, fontSize: "1rem" }} onClick={handleQrPay} disabled={paying}>
                    {paying ? (
                      <>
                        <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Processing...
                      </>
                    ) : (
                      <>Pay {fmt(total)}</>
                    )}
                  </button>
                )}
              </div>

              {/* QR Pay option — always shown alongside gateway payment for demo flexibility */}
              {hasRealGateway && (
                <button
                  type="button"
                  onClick={handleQrPay}
                  disabled={paying}
                  className="cd-appt-back-btn"
                  style={{ marginTop: ".5rem", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: ".4rem" }}
                >
                  <QrCode size={18} style={{ color: "hsl(var(--cd-slate) / .55)" }} /> Pay via UPI QR
                </button>
              )}

              {settings.whatsappNumber && (
                <button
                  type="button"
                  onClick={() => {
                    const num = settings.whatsappNumber!.replace(/[^0-9]/g, "");
                    const msg = `Hi, I want to book a test.\nName: ${pd.name}\nPhone: ${pd.phone}\nTests: ${Array.from(selTests).map(id => tests.find(t => t.id === id)?.name).filter(Boolean).join(", ")}\nPackages: ${Array.from(selPkgs).map(id => pkgs.find(p => p.id === id)?.name).filter(Boolean).join(", ")}`;
                    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank");
                  }}
                  className="cd-appt-wa-btn"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".4rem" }}
                >
                  <MessageCircle size={16} /> Confirm via WhatsApp instead
                </button>
              )}


              <p style={{ fontSize: ".78rem", color: "hsl(var(--cd-slate) / .55)", marginTop: "0.5rem", textAlign: "center" }}>
                {hasRealGateway ? (
                  <>Payments are processed securely via {gatewayLabel}. By proceeding, you agree to our <a href={`${BASE}policies`} style={{ color: "hsl(var(--cd-teal))", textDecoration: "underline" }}>Terms &amp; Conditions</a>.</>
                ) : (
                  <>Please scan the QR code to pay. Staff will confirm your booking after payment verification.</>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={{ background: "hsl(var(--cd-slate))", color: "hsl(var(--site-bg) / .7)", padding: "2rem 1rem", fontSize: ".85rem" }}>
        <div className="container-narrow" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "1.5rem", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, color: "#fff", marginBottom: ".25rem" }}>Care Diagnostics</div>
            <div style={{ fontSize: ".8rem" }}>{workAddr}</div>
          </div>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: ".35rem" }}><Phone size={14} /> {phone}</span>
            <span style={{ display: "flex", alignItems: "center", gap: ".35rem" }}><Mail size={14} /> {email}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
