import { useEffect, useState, useMemo } from "react";
import {
  Phone, Mail, MapPin, ChevronLeft, CalendarCheck, Clock,
  Star, Shield, Zap, Check, ChevronRight, Loader2, ArrowLeft, Sparkles,
  Stethoscope, FlaskConical, Package, User, CreditCard,
  CalendarDays, MessageCircle, QrCode, Printer, Receipt,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { SiteSettings } from "../types";

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
};
type TestItem = { id: number; code: string; name: string; category: string; price: string };
type PkgItem  = { id: number; code: string; name: string; price: string; description: string };

/* ── Formatters ── */
const fmt = (n: number) => "\u20b9" + n.toLocaleString("en-IN");

/* ── Step indicator ── */
function Stepper({ step }: { step: number }) {
  const steps = ["Your Details", "Select Tests", "Review & Pay"];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".5rem", marginBottom: "1.5rem" }}>
      {steps.map((label, i) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9999,
            background: i < step ? "hsl(var(--site-primary))" : i === step ? "hsl(var(--site-primary))" : "hsl(var(--site-muted))",
            color: i <= step ? "white" : "hsl(var(--site-muted-fg))",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: ".85rem", transition: "all .3s",
          }}>
            {i < step ? <Check size={16} /> : i + 1}
          </div>
          <span style={{ fontSize: ".82rem", fontWeight: 600, color: i <= step ? "hsl(var(--site-fg))" : "hsl(var(--site-muted-fg))" }}>{label}</span>
          {i < 2 && <ChevronRight size={14} style={{ color: "hsl(var(--site-muted-fg))", marginLeft: ".25rem" }} />}
        </div>
      ))}
    </div>
  );
}

/* ── Trust badges ── */
function TrustBadges() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem", justifyContent: "center", marginTop: "1.5rem" }}>
      {[
        { icon: Shield, label: "NABL Accredited" },
        { icon: Zap, label: "Same-day Reports" },
        { icon: Clock, label: "Mon–Sat  7AM–9PM" },
        { icon: Star, label: "4.8/5  Patient Rating" },
      ].map(({ icon: Icon, label }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: ".4rem", fontSize: ".78rem", color: "hsl(var(--site-muted-fg))" }}>
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
    document.title = "Book a Test | Care Diagnostics";
    window.scrollTo(0, 0);
  }, []);

  const [config, setConfig] = useState<BookingConfig | null>(null);
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
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tokenNo, setTokenNo] = useState<number | null>(null);

  const [pd, setPd] = useState({ name: "", phone: "", email: "", date: "", timeSlot: "", notes: "", isVip: false });
  const [selTests, setSelTests] = useState<Set<number>>(new Set());
  const [selPkgs, setSelPkgs] = useState<Set<number>>(new Set());

  const loadCatalog = () => {
    if (tests.length === 0) bookingGet<{ tests: TestItem[] }>("/api/public/booking/tests").then((d) => setTests(d.tests)).catch(() => {});
    if (pkgs.length === 0) bookingGet<{ packages: PkgItem[] }>("/api/public/booking/packages").then((d) => setPkgs(d.packages)).catch(() => {});
  };

  useEffect(() => {
    bookingGet<BookingConfig>("/api/public/booking/config")
      .then(setConfig)
      .catch(() => setConfig({ enabled: false, keyId: "", vipEnabled: false, gateway: null }));
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

  const categories = useMemo(() => ["all", ...Array.from(new Set(tests.map((t) => t.category))).sort()], [tests]);
  const filteredTests = useMemo(() => {
    let list = catFilter === "all" ? tests : tests.filter((t) => t.category === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => (t.name + " " + t.code).toLowerCase().includes(q));
    }
    return list;
  }, [tests, catFilter, search]);

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
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
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
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
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
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
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
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
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
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
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
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
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
    border: "1px solid hsl(var(--site-border))",
    borderRadius: "var(--site-radius)",
    padding: "1.5rem",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1.5px solid hsl(var(--site-border))",
    borderRadius: "var(--site-radius)",
    padding: ".75rem 1rem",
    fontSize: "0.95rem",
    background: "#fff",
    color: "hsl(var(--site-fg))",
    transition: "border-color .15s, box-shadow .15s",
  };

  const btnPrimary: React.CSSProperties = {
    background: "hsl(var(--site-primary))",
    color: "#fff",
    padding: ".75rem 1.5rem",
    borderRadius: "var(--site-radius)",
    fontWeight: 700,
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: ".4rem",
    justifyContent: "center",
    transition: "filter .18s, transform .18s",
  };

  const btnOutline: React.CSSProperties = {
    background: "transparent",
    color: "hsl(var(--site-fg))",
    padding: ".75rem 1.5rem",
    borderRadius: "var(--site-radius)",
    fontWeight: 600,
    border: "1.5px solid hsl(var(--site-border))",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: ".4rem",
    justifyContent: "center",
  };

  return (
    <div style={{ minHeight: "100vh", background: "hsl(210 40% 98%)", color: "hsl(var(--site-fg))" }}>
      {/* Sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: "hsl(var(--site-primary))", color: "white" }}>
        <div className="container-narrow" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: ".65rem 1rem" }}>
          <a href={BASE} style={{ display: "flex", alignItems: "center", gap: ".4rem", color: "white", textDecoration: "none", fontWeight: 600, fontSize: ".92rem" }}>
            <ChevronLeft size={18} /> Back to Home
          </a>
          <div style={{ fontWeight: 700, fontSize: ".95rem", display: "flex", alignItems: "center", gap: ".4rem" }}>
            <CalendarCheck size={16} /> Book a Test
          </div>
        </div>
      </div>

      {/* Hero area */}
      <div style={{ background: "linear-gradient(135deg, hsl(var(--site-primary)) 0%, hsl(200 85% 35%) 100%)", color: "white", padding: "2.5rem 1rem 2rem" }}>
        <div className="container-narrow" style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "clamp(1.6rem, 4vw, 2.4rem)", fontWeight: 800, marginBottom: ".5rem" }}>Book Your Diagnostic Test</h1>
          <p style={{ fontSize: "1rem", opacity: .9, maxWidth: 520, margin: "0 auto" }}>
            Choose from MRI, CT Scan, Ultrasound, Digital X-Ray, Pathology &amp; Health Packages at Care Diagnostics, Deoghar.
          </p>
          <TrustBadges />
        </div>
      </div>

      {/* Main content */}
      <div className="container-narrow" style={{ padding: "2rem 1rem 4rem", maxWidth: 920 }}>
        <Stepper step={step} />

        {step === 3 ? (
          <div style={{ ...cardStyle, textAlign: "center", maxWidth: 480, margin: "0 auto" }}>
            <div style={{ width: 72, height: 72, borderRadius: 9999, background: "hsl(142 76% 92%)", color: "hsl(142 71% 35%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem" }}>
              <Check size={36} />
            </div>
            <h2 style={{ fontWeight: 800, fontSize: "1.3rem", marginBottom: ".5rem" }}>
              {isOnline ? "Booking Confirmed!" : "Request Submitted!"}
            </h2>
            {isOnline && successRef && (
              <>
                <p style={{ color: "hsl(var(--site-muted-fg))", marginBottom: ".5rem" }}>Your booking reference</p>
                <div style={{ fontFamily: "monospace", fontSize: "1.4rem", fontWeight: 800, letterSpacing: 2, color: "hsl(var(--site-primary))", marginBottom: "1rem" }}>{successRef}</div>
              </>
            )}
            <p style={{ color: "hsl(var(--site-muted-fg))", fontSize: ".92rem", marginBottom: "1.5rem" }}>
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
          <div style={{ ...cardStyle, textAlign: "center", maxWidth: 480, margin: "0 auto" }}>
            <div style={{ fontSize: "3rem", marginBottom: ".5rem" }}>\u274c</div>
            <h2 style={{ fontWeight: 700, fontSize: "1.15rem", marginBottom: ".5rem" }}>Payment Not Completed</h2>
            <p style={{ color: "hsl(var(--site-muted-fg))", marginBottom: "1rem" }}>{failReason || "Your payment was not completed."}</p>
            <button style={btnPrimary} onClick={() => { setStep(2); setFailReason(""); }}>Try Again</button>
          </div>
        ) : step === 0 ? (
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            <div style={cardStyle}>
              <h2 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: ".5rem" }}>
                <User size={20} style={{ color: "hsl(var(--site-primary))" }} /> Patient Details
              </h2>
              <form onSubmit={(e) => { e.preventDefault(); loadCatalog(); setStep(1); }} className="grid gap-3">
                <div>
                  <label style={{ fontSize: ".82rem", fontWeight: 600, marginBottom: ".35rem", display: "block" }}>Full Name *</label>
                  <input style={inputStyle} placeholder="Enter your full name" required value={pd.name} onChange={(e) => setPd({ ...pd, name: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label style={{ fontSize: ".82rem", fontWeight: 600, marginBottom: ".35rem", display: "block" }}>Phone Number *</label>
                  <input style={inputStyle} placeholder="Enter your mobile number" required value={pd.phone} onChange={(e) => setPd({ ...pd, phone: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: ".82rem", fontWeight: 600, marginBottom: ".35rem", display: "block" }}>Email (optional)</label>
                  <input style={inputStyle} type="email" placeholder="For booking confirmation" value={pd.email} onChange={(e) => setPd({ ...pd, email: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".75rem" }}>
                  <div>
                    <label style={{ fontSize: ".82rem", fontWeight: 600, marginBottom: ".35rem", display: "block" }}>Preferred Date *</label>
                    <input style={{ ...inputStyle, padding: ".6rem .9rem" }} type="date" required value={pd.date} onChange={(e) => setPd({ ...pd, date: e.target.value })} min={new Date().toISOString().slice(0, 10)} />
                  </div>
                  <div>
                    <label style={{ fontSize: ".82rem", fontWeight: 600, marginBottom: ".35rem", display: "block" }}>Time Slot *</label>
                    <select style={{ ...inputStyle, padding: ".6rem .9rem" }} required value={pd.timeSlot} onChange={(e) => setPd({ ...pd, timeSlot: e.target.value })}>
                      <option value="">Select slot</option>
                      <option value="07:00 – 10:00">Morning (7–10 AM)</option>
                      <option value="10:00 – 13:00">Late Morning (10 AM–1 PM)</option>
                      <option value="13:00 – 16:00">Afternoon (1–4 PM)</option>
                      <option value="16:00 – 19:00">Evening (4–7 PM)</option>
                      <option value="19:00 – 21:00">Night (7–9 PM)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: ".82rem", fontWeight: 600, marginBottom: ".35rem", display: "block" }}>Special Instructions (optional)</label>
                  <textarea style={{ ...inputStyle, minHeight: 80 }} placeholder="Any specific requirements or health conditions we should know about?" rows={2} value={pd.notes} onChange={(e) => setPd({ ...pd, notes: e.target.value })} />
                </div>
                {config?.vipEnabled && config?.enableVipBooking !== false && (
                  <label style={{ display: "flex", alignItems: "center", gap: ".5rem", cursor: "pointer", fontSize: ".92rem", padding: ".5rem", background: "hsl(45 93% 95%)", borderRadius: "var(--site-radius)", border: "1px solid hsl(45 93% 85%)" }}>
                    <input type="checkbox" checked={pd.isVip} onChange={(e) => setPd({ ...pd, isVip: e.target.checked })} style={{ width: 18, height: 18 }} />
                    <Star size={16} style={{ color: "hsl(45 93% 45%)" }} />
                    <span style={{ fontWeight: 600 }}>VIP Queue</span>
                    <span style={{ fontSize: ".8rem", color: "hsl(var(--site-muted-fg))" }}>\u2014 priority service with minimal wait time</span>
                  </label>
                )}
                <button type="submit" style={{ ...btnPrimary, marginTop: ".5rem", fontSize: "1rem" }}>
                  Next: Choose Tests <ChevronRight size={18} />
                </button>
                {!isOnline && settings.whatsappNumber && (
                  <button type="button" onClick={handleWhatsApp} style={{ ...btnOutline, marginTop: ".5rem", borderColor: "#25d366", color: "#25d366" }}>
                    <MessageCircle size={16} /> Book via WhatsApp instead
                  </button>
                )}
              </form>
            </div>

            {/* Quick contact */}
            <div style={{ marginTop: "1.5rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div style={{ ...cardStyle, padding: "1rem", display: "flex", alignItems: "center", gap: ".75rem" }}>
                <div style={{ width: 40, height: 40, borderRadius: 9999, background: "hsl(var(--site-primary) / .1)", color: "hsl(var(--site-primary))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Phone size={18} />
                </div>
                <div>
                  <div style={{ fontSize: ".75rem", color: "hsl(var(--site-muted-fg))" }}>Call us</div>
                  <div style={{ fontWeight: 700, fontSize: ".95rem" }}>{phone}</div>
                </div>
              </div>
              <div style={{ ...cardStyle, padding: "1rem", display: "flex", alignItems: "center", gap: ".75rem" }}>
                <div style={{ width: 40, height: 40, borderRadius: 9999, background: "hsl(var(--site-primary) / .1)", color: "hsl(var(--site-primary))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <MapPin size={18} />
                </div>
                <div>
                  <div style={{ fontSize: ".75rem", color: "hsl(var(--site-muted-fg))" }}>Visit us</div>
                  <div style={{ fontWeight: 600, fontSize: ".85rem" }}>{workAddr}</div>
                </div>
              </div>
              <div style={{ ...cardStyle, padding: "1rem", display: "flex", alignItems: "center", gap: ".75rem" }}>
                <div style={{ width: 40, height: 40, borderRadius: 9999, background: "hsl(var(--site-primary) / .1)", color: "hsl(var(--site-primary))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CalendarDays size={18} />
                </div>
                <div>
                  <div style={{ fontSize: ".75rem", color: "hsl(var(--site-muted-fg))" }}>Working hours</div>
                  <div style={{ fontWeight: 600, fontSize: ".85rem" }}>Mon–Sat  7 AM – 9 PM</div>
                </div>
              </div>
            </div>
          </div>
        ) : step === 1 ? (
          <div>
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
                      background: catFilter === cat ? "hsl(var(--site-primary))" : "hsl(var(--site-muted))",
                      color: catFilter === cat ? "#fff" : "hsl(var(--site-fg))",
                      transition: "all .15s",
                    }}>
                    {cat === "all" ? "All Tests" : cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Packages */}
            {pkgs.length > 0 && (
              <div style={{ marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: ".75rem", display: "flex", alignItems: "center", gap: ".4rem" }}>
                  <Package size={18} style={{ color: "hsl(var(--site-primary))" }} /> Health Packages
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: ".75rem" }}>
                  {pkgs.map((p) => (
                    <button key={p.id} type="button" onClick={() => togglePkg(p.id)}
                      style={{
                        textAlign: "left", padding: "1rem",
                        borderRadius: "var(--site-radius)",
                        border: `2px solid ${selPkgs.has(p.id) ? "hsl(var(--site-primary))" : "hsl(var(--site-border))"}`,
                        background: selPkgs.has(p.id) ? "hsl(var(--site-primary) / .06)" : "#fff",
                        cursor: "pointer", transition: "all .15s",
                      }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: ".25rem" }}>
                        <span style={{ fontWeight: 700, fontSize: ".95rem" }}>{p.name}</span>
                        {selPkgs.has(p.id) && <Check size={18} style={{ color: "hsl(var(--site-primary))", flexShrink: 0 }} />}
                      </div>
                      {p.description && <div style={{ fontSize: ".8rem", color: "hsl(var(--site-muted-fg))", marginBottom: ".5rem" }}>{p.description}</div>}
                      <div style={{ fontWeight: 800, color: "hsl(var(--site-primary))", fontSize: "1.05rem" }}>{fmt(Number(p.price))}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Tests */}
            {filteredTests.length > 0 && (
              <div>
                <h3 style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: ".75rem", display: "flex", alignItems: "center", gap: ".4rem" }}>
                  <FlaskConical size={18} style={{ color: "hsl(var(--site-primary))" }} /> Individual Tests
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: ".5rem" }}>
                  {filteredTests.map((t) => (
                    <button key={t.id} type="button" onClick={() => toggleTest(t.id)}
                      style={{
                        textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: ".7rem 1rem", borderRadius: "var(--site-radius)",
                        border: `1.5px solid ${selTests.has(t.id) ? "hsl(var(--site-primary))" : "hsl(var(--site-border))"}`,
                        background: selTests.has(t.id) ? "hsl(var(--site-primary) / .06)" : "#fff",
                        cursor: "pointer", transition: "all .15s",
                      }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: ".92rem" }}>{t.name}</div>
                        <div style={{ fontSize: ".75rem", color: "hsl(var(--site-muted-fg))" }}>{t.code} \u00b7 {t.category}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                        <span style={{ fontWeight: 700, fontSize: ".95rem", color: "hsl(var(--site-primary))", whiteSpace: "nowrap" }}>{fmt(Number(t.price))}</span>
                        {selTests.has(t.id) && <Check size={16} style={{ color: "hsl(var(--site-primary))" }} />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filteredTests.length === 0 && search.trim() && (
              <div style={{ textAlign: "center", padding: "2rem", color: "hsl(var(--site-muted-fg))" }}>
                No tests match "{search}"
              </div>
            )}

            {/* Sticky bottom bar */}
            {(selTests.size > 0 || selPkgs.size > 0) && (
              <div style={{
                position: "sticky", bottom: "1rem",
                background: "#fff", border: "1px solid hsl(var(--site-border))",
                borderRadius: "var(--site-radius)", padding: "1rem 1.25rem",
                boxShadow: "0 8px 32px rgba(0,0,0,.1)",
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap",
              }}>
                <div>
                  <div style={{ fontSize: ".85rem", color: "hsl(var(--site-muted-fg))" }}>{selTests.size + selPkgs.size} item(s) selected</div>
                  <div style={{ fontWeight: 800, fontSize: "1.25rem", color: "hsl(var(--site-primary))" }}>{fmt(total)}</div>
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
                  <div style={{ display: "inline-block", padding: "1rem", background: "white", borderRadius: "var(--site-radius)", border: "1px solid hsl(var(--site-border))" }}>
                    <QRCodeSVG value={qrUpiUrl} size={240} level="H" />
                  </div>
                ) : config?.upiQrImageUrl ? (
                  <img src={config.upiQrImageUrl} alt="UPI QR Code" style={{ width: "100%", maxWidth: 320, borderRadius: "var(--site-radius)", border: "1px solid hsl(var(--site-border))" }} />
                ) : (
                  <div style={{ width: 240, height: 240, background: "hsl(var(--site-muted))", borderRadius: "var(--site-radius)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
                    <QrCode size={64} style={{ color: "hsl(var(--site-muted-fg))" }} />
                  </div>
                )}
                <div style={{ fontSize: ".85rem", color: "hsl(var(--site-muted-fg))", marginTop: ".75rem" }}>
                  Scan with any UPI app (PhonePe, Google Pay, Paytm, etc.) — amount is pre-filled
                </div>
                {qrUpiUrl && (
                  <div style={{ fontSize: ".75rem", color: "hsl(var(--site-muted-fg))", marginTop: ".25rem" }}>
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

              <p style={{ fontSize: ".75rem", color: "hsl(var(--site-muted-fg))", marginTop: ".75rem", textAlign: "center" }}>
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
              <p style={{ color: "hsl(var(--site-muted-fg))", marginBottom: "1rem", fontSize: ".92rem" }}>
                {confirmedBooking?.isUnconfirmedQr ? "Booking is pending payment confirmation from staff." : "Your booking is confirmed and payment received."}
              </p>

              {confirming ? (
                <div style={{ marginBottom: "1rem", color: "hsl(var(--site-muted-fg))" }}>
                  <Loader2 size={20} style={{ animation: "spin 1s linear infinite", margin: "0 auto .5rem" }} /> Loading booking details…
                </div>
              ) : (
                <div style={{ marginBottom: "1.5rem", textAlign: "left" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "1.3rem", fontWeight: 800, letterSpacing: 2, color: "hsl(var(--site-primary))", textAlign: "center", marginBottom: "1rem" }}>
                    {successRef}
                  </div>

                  {confirmedBooking && (
                    <div style={{ background: "hsl(var(--site-muted) / .4)", borderRadius: "var(--site-radius)", padding: "1rem", fontSize: ".92rem", lineHeight: 1.5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--site-muted-fg))" }}>Patient</span>
                        <span style={{ fontWeight: 600 }}>{confirmedBooking.name}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--site-muted-fg))" }}>Phone</span>
                        <span style={{ fontWeight: 600 }}>{confirmedBooking.phone}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--site-muted-fg))" }}>Date</span>
                        <span style={{ fontWeight: 600 }}>{confirmedBooking.selectedDate}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--site-muted-fg))" }}>Time</span>
                        <span style={{ fontWeight: 600 }}>{confirmedBooking.timeSlot}</span>
                      </div>
                       <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--site-muted-fg))" }}>Amount Paid</span>
                        <span style={{ fontWeight: 800, color: confirmedBooking?.isUnconfirmedQr ? "orange" : "hsl(var(--site-primary))" }}>
                          {confirmedBooking?.isUnconfirmedQr ? `Amount ${fmt(Number(confirmedBooking.totalAmount))} (To Be Confirmed)` : fmt(Number(confirmedBooking.totalAmount))}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                        <span style={{ color: "hsl(var(--site-muted-fg))" }}>Status</span>
                        <span style={{ fontWeight: 600, textTransform: "none", color: confirmedBooking?.isUnconfirmedQr ? "orange" : "inherit" }}>
                          {confirmedBooking?.isUnconfirmedQr ? "Confirmed on confirmation of Payment" : confirmedBooking.status}
                        </span>
                      </div>
                      {confirmedBooking.isVip && (
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
                          <span style={{ color: "hsl(var(--site-muted-fg))" }}>Queue</span>
                          <span style={{ fontWeight: 600, color: "hsl(45 93% 45%)" }}>⭐ VIP</span>
                        </div>
                      )}

                      {tokenNo !== null && (
                        <div style={{ background: "hsl(210 100% 96%)", border: "1.5px dashed hsl(210 100% 80%)", borderRadius: "var(--site-radius)", padding: "0.75rem", marginTop: "1rem", textAlign: "center", maxWidth: "320px", margin: "1rem auto 0" }}>
                          <span style={{ fontSize: ".75rem", color: "hsl(210 100% 30%)", fontWeight: 600, display: "block" }}>YOUR DAILY QUEUE TOKEN</span>
                          <span style={{ fontSize: "1.2rem", fontWeight: 900, color: "hsl(210 100% 25%)", display: "block", margin: ".15rem 0" }}>#{tokenNo}</span>
                          <span style={{ fontSize: ".7rem", color: "hsl(var(--site-muted-fg))" }}>Please show this token at the reception desk.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: ".75rem", justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  style={{ ...btnPrimary, textDecoration: "none" }}
                  onClick={() => {
                    let itemsHtml = "";
                    try {
                      const tIds = JSON.parse(confirmedBooking?.testIds || "[]");
                      tIds.forEach((id: any) => {
                        const item = tests.find(t => t.id === Number(id));
                        if (item) {
                          itemsHtml += `<div class="row"><span class="label">${item.name}</span><strong>${fmt(Number(item.price))}</strong></div>`;
                        }
                      });
                      const pIds = JSON.parse(confirmedBooking?.packageIds || "[]");
                      pIds.forEach((id: any) => {
                        const item = pkgs.find(p => p.id === Number(id));
                        if (item) {
                          itemsHtml += `<div class="row"><span class="label">${item.name} (Package)</span><strong>${fmt(Number(item.price))}</strong></div>`;
                        }
                      });
                    } catch(e) {}

                    const win = window.open("", "_blank", "width=600,height=750");
                    if (win) {
                      win.document.write(`
                        <html><head><title>Booking Receipt – Care Diagnostics</title>
                        <style>
                          body { font-family: system-ui, sans-serif; padding: 1.5rem; color: #111; max-width: 480px; margin: 0 auto; }
                          h1 { font-size: 1.2rem; margin-bottom: .25rem; text-align: center; }
                          .ref { font-family: monospace; font-size: 1.2rem; font-weight: 800; color: #0b4f8a; text-align: center; margin-bottom: 1rem; }
                          .row { display: flex; justify-content: space-between; padding: .35rem 0; border-bottom: 1px solid #eee; font-size: .88rem; }
                          .label { color: #555; }
                          .section-title { font-weight: 700; font-size: 0.85rem; margin-top: 1.2rem; margin-bottom: 0.4rem; color: #444; text-transform: uppercase; border-bottom: 2px solid #ccc; padding-bottom: 2px; }
                          .footer { margin-top: 1.5rem; font-size: .85rem; color: #666; text-align: center; }
                          .paid { color: #1a7c37; font-weight: 700; }
                          .token-box { background: #f0f7ff; border: 2px dashed #3b82f6; border-radius: 8px; padding: 0.75rem; margin: 1rem 0; text-align: center; }
                          .token-title { font-size: .75rem; color: #1d4ed8; font-weight: 600; }
                          .token-no { font-size: 1.2rem; font-weight: 900; color: #1e3a8a; margin: .1rem 0; }
                          .qr-box { text-align: center; margin-top: 1.5rem; }
                          .qr-img { border: 1px solid #ccc; padding: 4px; border-radius: 4px; }
                        </style></head><body>
                        <h1>Care Diagnostics – Booking Receipt</h1>
                        <div class="ref">${successRef}</div>
                        
                        ${tokenNo ? `
                        <div class="token-box">
                          <div class="token-title">DAILY QUEUE TOKEN</div>
                          <div class="token-no">#${tokenNo}</div>
                          <div style="font-size: .75rem; color: #555;">Please present this token at the clinic</div>
                        </div>
                        ` : ''}

                        <div class="section-title">Patient Information</div>
                        <div class="row"><span class="label">Patient</span><strong>${confirmedBooking?.name || "-"}</strong></div>
                        <div class="row"><span class="label">Phone</span><strong>${confirmedBooking?.phone || "-"}</strong></div>
                        <div class="row"><span class="label">Date</span><strong>${confirmedBooking?.selectedDate || "-"}</strong></div>
                        <div class="row"><span class="label">Time</span><strong>${confirmedBooking?.timeSlot || "-"}</strong></div>

                        <div class="section-title">Booked Services</div>
                        ${itemsHtml}

                        <div class="section-title">Payment Summary</div>
                        <div class="row"><span class="label">Amount Paid</span><strong class="${confirmedBooking?.isUnconfirmedQr ? '' : 'paid'}" style="${confirmedBooking?.isUnconfirmedQr ? 'color:orange;' : ''}">${confirmedBooking?.isUnconfirmedQr ? `Amount ${fmt(Number(confirmedBooking?.totalAmount || 0))} (To Be Confirmed)` : fmt(Number(confirmedBooking?.totalAmount || 0))}</strong></div>
                        <div class="row"><span class="label">Status</span><strong class="${confirmedBooking?.isUnconfirmedQr ? '' : 'paid'}" style="${confirmedBooking?.isUnconfirmedQr ? 'color:orange;' : ''}">${confirmedBooking?.isUnconfirmedQr ? "Confirmed on confirmation of Payment" : (confirmedBooking?.status || "Paid")}</strong></div>
                        
                        <div class="qr-box">
                          <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(window.location.origin + window.location.pathname + '?confirmed=1&ref=' + successRef)}" alt="Booking QR" class="qr-img" />
                          <div style="font-size: .7rem; color: #666; margin-top: .25rem;">Scan to verify booking reference</div>
                        </div>

                        <div class="footer">Thank you for choosing Care Diagnostics, Deoghar.<br/>${phone} | ${email}</div>
                        </body></html>
                      `);
                      win.document.close();
                      win.print();
                    }
                  }}
                >
                  <Receipt size={16} /> Print Receipt
                </button>
                <a href={BASE} style={{ ...btnOutline, textDecoration: "none" }}>
                  <ChevronLeft size={16} /> Back to Home
                </a>
              </div>

              <p style={{ fontSize: ".78rem", color: "hsl(var(--site-muted-fg))", marginTop: "1rem" }}>
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
                <div style={{ margin: "-1.5rem -1.5rem 1.25rem -1.5rem", borderBottom: "1px solid hsl(var(--site-border) / .6)" }}>
                  <img
                    src={
                      config?.gateway === "icici" ? config.customIciciBannerUrl :
                      config?.gateway === "phonepe" ? config.customPhonepeBannerUrl :
                      config?.gateway === "bharatpe" ? config.customBharatpeBannerUrl :
                      config.customPayuBannerUrl
                    }
                    alt={`${gatewayLabel} Banner`}
                    style={{ width: "100%", height: "auto", display: "block", objectFit: "cover" }}
                  />
                </div>
              ) : config?.enablePaymentLogos !== false ? (
                <div style={{ margin: "-1.5rem -1.5rem 1.25rem -1.5rem", borderBottom: "1px solid hsl(var(--site-border) / .6)" }}>
                  <img
                    src="/payment-methods-logo.png"
                    alt="Supported Payment Methods"
                    style={{ width: "100%", height: "auto", display: "block", objectFit: "cover" }}
                  />
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                <h2 style={{ fontWeight: 700, fontSize: "1.1rem", display: "flex", alignItems: "center", gap: ".5rem", margin: 0 }}>
                  <CreditCard size={20} style={{ color: "hsl(var(--site-primary))" }} /> Order Summary
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
                    <div style={{ fontSize: ".75rem", color: "hsl(var(--site-muted-fg))" }}>Patient</div>
                    <div style={{ fontWeight: 700 }}>{pd.name}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: ".75rem", color: "hsl(var(--site-muted-fg))" }}>Phone</div>
                    <div style={{ fontWeight: 600 }}>{pd.phone}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: ".75rem", color: "hsl(var(--site-muted-fg))" }}>Date &amp; Time</div>
                    <div style={{ fontWeight: 600 }}>{pd.date}{pd.timeSlot ? ` \u00b7 ${pd.timeSlot}` : ""}{pd.isVip ? " \u00b7 ⭐ VIP" : ""}</div>
                  </div>
                </div>
              </div>

              {/* Selected items */}
              <div style={{ marginBottom: "1rem" }}>
                {tests.filter((t) => selTests.has(t.id)).map((t) => (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: ".5rem 0", borderBottom: "1px solid hsl(var(--site-border) / .5)", fontSize: ".95rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                      <FlaskConical size={14} style={{ color: "hsl(var(--site-muted-fg))" }} />
                      {t.name}
                    </div>
                    <span style={{ fontWeight: 600 }}>{fmt(Number(t.price))}</span>
                  </div>
                ))}
                {pkgs.filter((p) => selPkgs.has(p.id)).map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: ".5rem 0", borderBottom: "1px solid hsl(var(--site-border) / .5)", fontSize: ".95rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                      <Package size={14} style={{ color: "hsl(var(--site-muted-fg))" }} />
                      {p.name} <span style={{ fontSize: ".78rem", color: "hsl(var(--site-muted-fg))" }}>(Package)</span>
                    </div>
                    <span style={{ fontWeight: 600 }}>{fmt(Number(p.price))}</span>
                  </div>
                ))}
                {pd.isVip && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: ".5rem 0", borderBottom: "1px solid hsl(var(--site-border) / .5)", fontSize: ".95rem", color: "hsl(45 93% 40%)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                      <Sparkles size={14} />
                      VIP Queue Priority Surcharge ({config?.vipPercentage || 50}%)
                    </div>
                    <span style={{ fontWeight: 600 }}>{fmt(vipCharge)}</span>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "1.2rem", borderTop: "2px solid hsl(var(--site-primary) / .3)", paddingTop: ".75rem", marginBottom: "1.25rem" }}>
                <span>Total Amount</span>
                <span style={{ color: "hsl(var(--site-primary))" }}>{fmt(total)}</span>
              </div>

              {/* Disclaimer */}
              <div style={{ fontSize: ".78rem", color: "hsl(var(--site-muted-fg))", background: "hsl(var(--site-muted) / .3)", border: "1px solid hsl(var(--site-border) / .5)", borderRadius: "var(--site-radius)", padding: ".75rem", marginBottom: "1.25rem", lineHeight: "1.4" }}>
                <div style={{ fontWeight: 600, marginBottom: ".25rem", color: "hsl(var(--site-fg))" }}>Important Disclaimers:</div>
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
                      style={{
                        ...btnPrimary,
                        flex: 1,
                        fontSize: "1rem",
                        background: config?.gateway === "icici" ? "#FF6600" : "#002F6C",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: ".5rem",
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
                            style={{ height: "36px", objectFit: "contain", background: "white", borderRadius: "6px", padding: "2px", border: "2px solid #002F6C" }} 
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
                  style={{ marginTop: ".5rem", width: "100%", background: "transparent", color: "hsl(var(--site-fg))", border: "1.5px solid hsl(var(--site-border))", borderRadius: "var(--site-radius)", padding: ".65rem 1rem", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: ".4rem" }}
                >
                  <QrCode size={18} style={{ color: "hsl(var(--site-muted-fg))" }} /> Pay via UPI QR
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
                  style={{ marginTop: ".75rem", width: "100%", background: "#25d366", color: "#fff", border: "none", borderRadius: "var(--site-radius)", padding: ".65rem 1rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: ".4rem" }}
                >
                  <MessageCircle size={16} /> Confirm via WhatsApp instead
                </button>
              )}


              <p style={{ fontSize: ".78rem", color: "hsl(var(--site-muted-fg))", marginTop: "0.5rem", textAlign: "center" }}>
                {hasRealGateway ? (
                  <>Payments are processed securely via {gatewayLabel}. By proceeding, you agree to our <a href={`${BASE}policies`} style={{ color: "hsl(var(--site-primary))", textDecoration: "underline" }}>Terms &amp; Conditions</a>.</>
                ) : (
                  <>Please scan the QR code to pay. Staff will confirm your booking after payment verification.</>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={{ background: "hsl(var(--site-fg))", color: "hsl(var(--site-bg) / .7)", padding: "2rem 1rem", fontSize: ".85rem" }}>
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
