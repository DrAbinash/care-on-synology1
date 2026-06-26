import { useEffect, useState, useMemo, useRef } from "react";
import { SelfRegistrationForm } from "../../../diagnostic-erp/src/components/SelfRegistrationForm";
import type { Section, SiteSettings } from "../types";
import { buttonClass } from "../theme";
import { Loader2 } from "lucide-react";

function get(c: Record<string, unknown>, k: string, fb = ""): string {
  return typeof c[k] === "string" ? (c[k] as string) : fb;
}

type BookingConfig = { enabled: boolean; keyId: string; vipEnabled: boolean; gateway: "payu" | "razorpay" | "phonepe" | "bharatpe" | "icici" | "hdfc" | null; payuMerchantKey?: string; phonepeMerchantId?: string; bharatpeMerchantId?: string; iciciMerchantId?: string; kioskUpiVpa?: string; kioskUpiName?: string; upiQrEnabled?: boolean; upiVpa?: string; upiQrImageUrl?: string };
type TestItem = { id: number; code: string; name: string; category: string; price: string };
type PkgItem  = { id: number; code: string; name: string; price: string; description: string };

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

/** Submit a hidden form to PayU — redirect-based payment */
function submitPayuForm(payuUrl: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = payuUrl;
  form.style.display = "none";
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export default function AppointmentSection({ section, settings }: { section: Section; settings: SiteSettings }) {
  const c = section.config;
  const heading = get(c, "heading", "Book an Appointment");
  const subheading = get(c, "subheading");
  const bookingPhone = (settings.whatsappNumber || "").replace(/[^0-9]/g, "");

  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [tests, setTests] = useState<TestItem[]>([]);
  const [pkgs, setPkgs] = useState<PkgItem[]>([]);
  const [step, setStep] = useState<"form" | "select" | "pay" | "qr" | "done" | "failed">("form");
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [successRef, setSuccessRef] = useState("");
  const [failReason, setFailReason] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const urlChecked = useRef(false);

  const [pd, setPd] = useState({ name: "", phone: "", email: "", date: "", timeSlot: "", notes: "", isVip: false, ageValue: "", ageUnit: "years", gender: "" });
  const [errFields, setErrFields] = useState<string[]>([]);
  const [selTests, setSelTests] = useState<Set<number>>(new Set());
  const [selPkgs, setSelPkgs] = useState<Set<number>>(new Set());
  const [qrBookingRef, setQrBookingRef] = useState("");
  const [qrAmount, setQrAmount] = useState(0);
  const [qrUpiUrl, setQrUpiUrl] = useState("");
  const [qrUpiVpa, setQrUpiVpa] = useState("");
  const [qrUpiName, setQrUpiName] = useState("");
  const [qrChecking, setQrChecking] = useState(false);

  const qrBookingUrl = useMemo(() => {
    const phone = (settings.whatsappNumber || "").replace(/[^0-9]/g, "");
    if (!phone) return "";
    return `https://wa.me/${phone}?text=${encodeURIComponent("Hi, I want to book an appointment.")}`;
  }, [settings.whatsappNumber]);

  // Check URL params for PayU redirect-back result
  useEffect(() => {
    if (urlChecked.current) return;
    urlChecked.current = true;
    const params = new URLSearchParams(window.location.search);
    const bookingStatus = params.get("booking");
    if (bookingStatus === "success" || bookingStatus === "link_success" || bookingStatus === "phonepe_done" || bookingStatus === "bharatpe_done" || bookingStatus === "icici_done" || bookingStatus === "hdfc_done") {
      setSuccessRef(params.get("ref") ?? "");
      setStep("done");
    } else if (bookingStatus === "failed") {
      setFailReason(params.get("reason") ?? "Payment was not completed.");
      setStep("failed");
    }
    // Clean up URL params without reloading
    if (bookingStatus) {
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
    }
  }, []);

  useEffect(() => {
    bookingGet<BookingConfig>("/api/public/booking/config")
      .then(setConfig)
      .catch(() => setConfig({ enabled: false, keyId: "", vipEnabled: false, gateway: null }));
  }, []);

  const loadCatalog = () => {
    if (tests.length === 0) bookingGet<{ tests: TestItem[] }>("/api/public/booking/tests").then((d) => setTests(d.tests)).catch(() => {});
    if (pkgs.length === 0) bookingGet<{ packages: PkgItem[] }>("/api/public/booking/packages").then((d) => setPkgs(d.packages)).catch(() => {});
  };

  const total = useMemo(() => {
    const t = tests.filter((t) => selTests.has(t.id)).reduce((s, t) => s + Number(t.price), 0);
    const p = pkgs.filter((p) => selPkgs.has(p.id)).reduce((s, p) => s + Number(p.price), 0);
    return t + p;
  }, [tests, pkgs, selTests, selPkgs]);

  const categories = useMemo(() => ["all", ...Array.from(new Set(tests.map((t) => t.category))).sort()], [tests]);
  const filteredTests = useMemo(() => catFilter === "all" ? tests : tests.filter((t) => t.category === catFilter), [tests, catFilter]);

  const toggleTest = (id: number) => setSelTests((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePkg  = (id: number) => setSelPkgs((s) => { const n = new Set(s);  n.has(id) ? n.delete(id) : n.add(id); return n; });

  function handleWhatsApp(e: React.FormEvent) {
    e.preventDefault();
    if (settings.whatsappNumber) {
      const msg = `Hi, I'd like to book an appointment.\nName: ${pd.name}\nPhone: ${pd.phone}\nPreferred date: ${pd.date}\nNote: ${pd.notes}`;
      const num = settings.whatsappNumber.replace(/[^0-9]/g, "");
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank");
    }
    setStep("done");
  }

  function openWhatsAppBooking() {
    if (!bookingPhone) return;
    const msg = `Hi, I want to book a test.\nName: \nPhone: \nPreferred date: \nTests needed: `;
    window.open(`https://wa.me/${bookingPhone}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  async function handlePayU() {
    setError(""); setPaying(true);
    try {
      const res = await bookingPost<{ payuUrl: string; fields: Record<string, string> }>("/api/public/booking/payu-initiate", {
        name: pd.name, phone: pd.phone, email: pd.email, selectedDate: pd.date, timeSlot: pd.timeSlot,
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
      });
      // Redirect to PayU — page will come back via surl/furl
      submitPayuForm(res.payuUrl, res.fields);
      // Don't reset paying — the page will redirect away
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
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
      });
      // Redirect to PhonePe checkout — page will come back via redirectUrl
      window.location.href = res.redirectUrl;
      // Don't reset paying — the page will redirect away
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
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
      });
      // Redirect to BharatPe checkout — page will come back via redirectUrl
      window.location.href = res.redirectUrl;
      // Don't reset paying — the page will redirect away
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || "Something went wrong.";
      setError(msg); setPaying(false);
    }
  }

  async function handleICICI() {
    setError(""); setPaying(true);
    try {
      const res = await bookingPost<{ bookingRef: string; redirectUrl: string; tranCtx: string }>("/api/public/booking/icici-initiate", {
        name: pd.name, phone: pd.phone, email: pd.email, selectedDate: pd.date, timeSlot: pd.timeSlot,
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
      });
      setSuccessRef(res.bookingRef);
      window.location.href = res.redirectUrl;
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || "Something went wrong.";
      setError(msg); setPaying(false);
    }
  }

  async function handleQrPay() {
    setError(""); setPaying(true);
    try {
      const res = await bookingPost<{ bookingRef: string; amount: number; upiVpa: string; upiName: string; upiUrl: string; upiQrImageUrl: string; clinicName: string }>("/api/public/booking/qr-initiate", {
        name: pd.name, phone: pd.phone, email: pd.email, selectedDate: pd.date, timeSlot: pd.timeSlot,
        testIds: Array.from(selTests), packageIds: Array.from(selPkgs),
        totalAmount: total, notes: pd.notes, isVip: pd.isVip,
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
      });
      setQrBookingRef(res.bookingRef);
      setQrAmount(res.amount);
      setQrUpiUrl(res.upiUrl);
      setQrUpiVpa(res.upiVpa);
      setQrUpiName(res.upiName);
      setStep("qr");
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
      const res = await bookingGet<{ status: string; bookingRef: string }>(`/api/public/booking/qr-status?ref=${encodeURIComponent(qrBookingRef)}`);
      if (res.status === "paid" || res.status === "confirmed") {
        setSuccessRef(res.bookingRef);
        setStep("done");
      } else {
        setError("Payment not yet received. Please complete the payment and try again.");
      }
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || "Something went wrong.";
      setError(msg);
    } finally {
      setQrChecking(false);
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
        ageValue: pd.ageValue ? Number(pd.ageValue) : null, ageUnit: pd.ageUnit, gender: pd.gender,
      });

      const RZP = (window as unknown as { Razorpay: new (opts: Record<string, unknown>) => { open(): void } }).Razorpay;
      const rzp = new RZP({
        key: res.keyId,
        amount: res.amountPaise,
        currency: "INR",
        order_id: res.razorpayOrderId,
        name: settings.siteTitle || "Care Diagnostics",
        description: `Test booking — ${res.bookingRef}`,
        prefill: { name: pd.name, contact: pd.phone, email: pd.email },
        theme: { color: "#6366f1" },
        handler: async (payment: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await bookingPost<{ success: boolean; bookingRef: string }>("/api/public/booking/verify-payment", {
              razorpayOrderId: payment.razorpay_order_id,
              razorpayPaymentId: payment.razorpay_payment_id,
              razorpaySignature: payment.razorpay_signature,
            });
            setSuccessRef(res.bookingRef);
            setStep("done");
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

  function validateForm(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setErrFields([]);

    if (!pd.name.trim()) {
      setError("Please enter your name.");
      setErrFields(["name"]);
      const el = document.getElementById("pd-name");
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    const cleanPhone = pd.phone.replace(/\D/g, "");
    if (!pd.phone.trim() || cleanPhone.length !== 10) {
      setError("Please enter a valid mobile number.");
      setErrFields(["phone"]);
      const el = document.getElementById("pd-phone");
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    if (!pd.gender) {
      setError("Please select gender.");
      setErrFields(["gender"]);
      const el = document.getElementById("pd-gender");
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    if (!pd.ageValue || Number(pd.ageValue) < 0) {
      setError("Please enter age.");
      setErrFields(["ageValue"]);
      const el = document.getElementById("pd-ageValue");
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    loadCatalog();
    setStep("select");
  }

  const gatewayLabel =
    config?.gateway === "icici" ? "Orange Pay" :
    config?.gateway === "hdfc" ? "HDFC Bank" :
    config?.gateway === "bharatpe" ? "BharatPe" :
    config?.gateway === "phonepe" ? "PhonePe" :
    config?.gateway === "payu" ? "PayU" :
    config?.gateway === "razorpay" ? "Razorpay" : "QR / UPI";

  if (!config || !config.enabled) {
    return (
      <section id="appointment" className="section">
        <div className="container-narrow" style={{ maxWidth: 640 }}>
          <h2 className="h-section text-center" style={{ marginBottom: ".5rem" }}>{heading}</h2>
          {subheading && <p className="subtle text-center" style={{ marginBottom: "2rem" }}>{subheading}</p>}
          {step === "done" ? (
            <div className="card-soft text-center"><strong>Thanks!</strong> Your request has been sent. We'll confirm shortly.</div>
          ) : (
            <form onSubmit={handleWhatsApp} className="grid gap-3">
              <input className="input-soft" placeholder="Your name" required value={pd.name} onChange={(e) => setPd({ ...pd, name: e.target.value.toUpperCase() })} />
              <input className="input-soft" placeholder="Phone number" required value={pd.phone} onChange={(e) => setPd({ ...pd, phone: e.target.value })} />
              <input className="input-soft" type="date" value={pd.date} onChange={(e) => setPd({ ...pd, date: e.target.value })} />
              <textarea className="input-soft" placeholder="What test or service?" rows={3} value={pd.notes} onChange={(e) => setPd({ ...pd, notes: e.target.value })} />
              <button type="submit" className={buttonClass(settings, "primary")} style={{ justifyContent: "center" }}>Request Appointment</button>
            </form>
          )}
        </div>
      </section>
    );
  }

  return (
    <section id="appointment" className="section">
      <div className="container-narrow" style={{ maxWidth: 720 }}>
        <h2 className="h-section text-center" style={{ marginBottom: ".5rem" }}>{heading}</h2>
        {subheading && <p className="subtle text-center" style={{ marginBottom: "2rem" }}>{subheading}</p>}

        {step === "failed" ? (
          <div className="card-soft text-center" style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ fontSize: "3rem", marginBottom: ".5rem" }}>❌</div>
            <h3 style={{ fontWeight: 700, fontSize: "1.15rem", marginBottom: ".5rem" }}>Payment Not Completed</h3>
            <p className="subtle" style={{ marginBottom: "1rem" }}>{failReason || "Your payment was not completed."}</p>
            <button type="button" className={buttonClass(settings, "primary")} onClick={() => { setStep("pay"); setFailReason(""); }} style={{ justifyContent: "center" }}>Try Again</button>
          </div>
        ) : step === "qr" ? (
          <div className="card-soft" style={{ maxWidth: 480, margin: "0 auto" }}>
            <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>Pay with UPI QR</h3>
            <div style={{ textAlign: "center", marginBottom: "1rem" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: ".5rem" }}>₹{qrAmount.toLocaleString("en-IN")}</div>
              <div className="subtle" style={{ fontSize: ".85rem", marginBottom: ".75rem" }}>Scan with any UPI app (GPay, PhonePe, Paytm) to complete payment</div>
              {qrUpiUrl ? (
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrUpiUrl)}`} alt="UPI QR" style={{ width: 220, height: 220, margin: "0 auto", display: "block", background: "#fff", padding: 8, borderRadius: 12 }} />
              ) : (
                <div style={{ width: 220, height: 220, margin: "0 auto", background: "hsl(var(--site-muted))", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}><Loader2 size={32} style={{ animation: "spin 1s linear infinite" }} /></div>
              )}
              <div style={{ marginTop: ".75rem", fontSize: ".85rem", fontWeight: 600 }}>{qrUpiVpa || qrUpiName}</div>
            </div>
            <div style={{ display: "flex", gap: ".75rem", marginBottom: ".75rem" }}>
              <button type="button" className={buttonClass(settings, "outline")} onClick={() => setStep("pay")} style={{ flex: 1 }}>← Back</button>
              <button type="button" className={buttonClass(settings, "primary")} onClick={checkQrPayment} disabled={qrChecking} style={{ flex: 1 }}>
                {qrChecking ? "Checking..." : "I've Paid"}
              </button>
            </div>
            <p className="subtle" style={{ fontSize: ".75rem", textAlign: "center" }}>
              Booking ref: <span style={{ fontFamily: "monospace" }}>{qrBookingRef}</span>
            </p>
          </div>
        ) : step === "done" ? (
          <div className="card-soft text-center" style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ fontSize: "3rem", marginBottom: ".5rem" }}>✅</div>
            <h3 style={{ fontWeight: 700, fontSize: "1.15rem", marginBottom: ".5rem" }}>Payment Successful!</h3>
            <p className="subtle" style={{ marginBottom: "1rem" }}>Your booking reference is</p>
            <div style={{ fontFamily: "monospace", fontSize: "1.3rem", fontWeight: 800, letterSpacing: 2, color: "hsl(var(--site-primary))", marginBottom: ".5rem" }}>{successRef}</div>
            <div className="subtle" style={{ fontSize: ".9rem", marginBottom: "1rem" }}>Date: {pd.date}{pd.timeSlot && <> · Slot: {pd.timeSlot}</>}</div>
            <p className="subtle" style={{ fontSize: ".9rem" }}>Please save this reference. Our staff will confirm your appointment shortly. You may receive a call or WhatsApp message.</p>
          </div>
        ) : step === "form" ? (
          <SelfRegistrationForm
            mode="online"
            initialValues={{
              firstName: pd.name,
              lastName: "",
              phone: pd.phone,
              gender: pd.gender as any,
              ageValue: pd.ageValue,
              ageUnit: pd.ageUnit as any,
              email: pd.email,
              date: pd.date,
              timeSlot: pd.timeSlot,
              notes: pd.notes,
              isVip: pd.isVip,
            }}
            vipEnabled={!!config?.vipEnabled}
            submitButtonClass={buttonClass(settings, "primary")}
            onSubmit={(data: any) => {
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
              });
              loadCatalog();
              setStep("select");
            }}
          />
        ) : step === "select" ? (
          <div className="grid gap-4">
            {categories.length > 2 && (
              <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                {categories.map((cat) => (
                  <button key={cat} onClick={() => setCatFilter(cat)}
                    style={{ padding: ".3rem .8rem", borderRadius: 9999, fontSize: ".85rem", fontWeight: 600, background: catFilter === cat ? "hsl(var(--site-primary))" : "hsl(var(--site-muted))", color: catFilter === cat ? "hsl(var(--site-primary-fg))" : "inherit", border: "none", cursor: "pointer" }}>
                    {cat === "all" ? "All" : cat}
                  </button>
                ))}
              </div>
            )}
            {pkgs.length > 0 && (
              <div>
                <h3 style={{ fontWeight: 700, marginBottom: ".75rem" }}>Health Packages</h3>
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                  {pkgs.map((p) => (
                    <button key={p.id} type="button" onClick={() => togglePkg(p.id)}
                      style={{ textAlign: "left", padding: ".75rem 1rem", borderRadius: "var(--site-radius)", border: `2px solid ${selPkgs.has(p.id) ? "hsl(var(--site-primary))" : "hsl(var(--site-muted))"}`, background: selPkgs.has(p.id) ? "hsl(var(--site-primary) / .07)" : "hsl(var(--site-muted) / .4)", cursor: "pointer", transition: "border-color .15s" }}>
                      <div style={{ fontWeight: 700, fontSize: ".95rem" }}>{p.name}</div>
                      {p.description && <div style={{ fontSize: ".8rem", opacity: .7, marginTop: ".25rem" }}>{p.description}</div>}
                      <div style={{ fontWeight: 700, color: "hsl(var(--site-primary))", marginTop: ".4rem" }}>₹{Number(p.price).toLocaleString("en-IN")}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {filteredTests.length > 0 && (
              <div>
                <h3 style={{ fontWeight: 700, marginBottom: ".75rem" }}>Individual Tests</h3>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
                  {filteredTests.map((t) => (
                    <button key={t.id} type="button" onClick={() => toggleTest(t.id)}
                      style={{ textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", padding: ".6rem .9rem", borderRadius: "var(--site-radius)", border: `1.5px solid ${selTests.has(t.id) ? "hsl(var(--site-primary))" : "hsl(var(--site-muted))"}`, background: selTests.has(t.id) ? "hsl(var(--site-primary) / .07)" : "hsl(var(--site-muted) / .3)", cursor: "pointer" }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: ".9rem" }}>{t.name}</span>
                        <span style={{ fontSize: ".75rem", opacity: .6, marginLeft: ".5rem" }}>{t.code}</span>
                      </div>
                      <span style={{ fontWeight: 700, fontSize: ".9rem", color: "hsl(var(--site-primary))", whiteSpace: "nowrap" }}>₹{Number(t.price).toLocaleString("en-IN")}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(selTests.size > 0 || selPkgs.size > 0) && (
              <div className="card-soft" style={{ position: "sticky", bottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", background: "hsl(var(--site-bg))" }}>
                <div>
                  <span className="subtle">{selTests.size + selPkgs.size} item(s) selected</span>
                  <span style={{ fontWeight: 800, fontSize: "1.15rem", marginLeft: "1rem", color: "hsl(var(--site-primary))" }}>₹{total.toLocaleString("en-IN")}</span>
                </div>
                <button type="button" className={buttonClass(settings, "primary")} onClick={() => setStep("pay")} style={{ justifyContent: "center" }}>Review &amp; Pay →</button>
              </div>
            )}
          </div>
        ) : (
          <div className="card-soft" style={{ maxWidth: 520, margin: "0 auto" }}>
            <h3 style={{ fontWeight: 700, marginBottom: "1rem" }}>Order Summary</h3>
            <div style={{ marginBottom: "1rem" }}>
              <div className="subtle" style={{ marginBottom: ".4rem", fontSize: ".85rem" }}>Patient Details</div>
              <div style={{ fontWeight: 600 }}>{pd.name} · {pd.phone}</div>
              <div className="subtle" style={{ fontSize: ".9rem" }}>Appointment: {pd.date}{pd.isVip ? " · ⭐ VIP" : ""}</div>
            </div>
            <div style={{ borderTop: "1px solid hsl(var(--site-muted))", paddingTop: ".75rem", marginBottom: ".75rem" }}>
              {tests.filter((t) => selTests.has(t.id)).map((t) => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: ".3rem 0", fontSize: ".9rem" }}>
                  <span>{t.name}</span><span style={{ fontWeight: 600 }}>₹{Number(t.price).toLocaleString("en-IN")}</span>
                </div>
              ))}
              {pkgs.filter((p) => selPkgs.has(p.id)).map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: ".3rem 0", fontSize: ".9rem" }}>
                  <span>{p.name} (Package)</span><span style={{ fontWeight: 600 }}>₹{Number(p.price).toLocaleString("en-IN")}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "1.1rem", borderTop: "2px solid hsl(var(--site-primary) / .3)", paddingTop: ".75rem", marginBottom: "1.25rem" }}>
              <span>Total</span><span style={{ color: "hsl(var(--site-primary))" }}>₹{total.toLocaleString("en-IN")}</span>
            </div>
            {error && <div style={{ color: "red", fontSize: ".85rem", marginBottom: ".75rem", padding: ".5rem .75rem", background: "hsl(0 85% 95%)", borderRadius: "var(--site-radius)" }}>{error}</div>}
            <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setStep("select")} style={{ background: "hsl(var(--site-muted))", color: "inherit", border: "none", borderRadius: "var(--site-radius)", padding: ".6rem 1.1rem", cursor: "pointer", fontWeight: 600 }}>← Back</button>
              {config?.gateway === "icici" || config?.gateway === "hdfc" ? (
                <button
                  type="button"
                  onClick={handlePay}
                  disabled={paying}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: ".5rem",
                    flex: 1,
                    background: config?.gateway === "icici" ? "#FF6600" : "#002F6C",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--site-radius)",
                    padding: ".6rem 1.1rem",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: "1rem"
                  }}
                >
                  {paying ? (
                    <>
                      <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Redirecting to Payment Gateway…
                    </>
                  ) : (
                    <>
                      <img
                        src={config?.gateway === "icici" ? "/icici-bank-logo.jpeg" : "/hdfc-bank-logo.jpeg"}
                        alt={config?.gateway === "icici" ? "ICICI Bank" : "HDFC Bank"}
                        style={{
                          height: "36px",
                          objectFit: "contain",
                          background: "white",
                          borderRadius: "6px",
                          padding: "2px",
                          border: "2px solid #002F6C"
                        }}
                      />
                      <span>Pay ₹{total.toLocaleString("en-IN")} by {config?.gateway === "icici" ? "ICICI Bank" : "HDFC Bank"}</span>
                    </>
                  )}
                </button>
              ) : (
                <button type="button" className={buttonClass(settings, "primary")} onClick={handlePay} disabled={paying} style={{ flex: 1, justifyContent: "center" }}>
                  {paying
                    ? (config?.gateway === "payu" ? "Redirecting to PayU…" :
                       config?.gateway === "bharatpe" ? "Redirecting to BharatPe…" :
                       config?.gateway === "phonepe" ? "Redirecting to PhonePe…" : "Processing…")
                    : `Pay ₹${total.toLocaleString("en-IN")} via ${gatewayLabel}`}
                </button>
              )}
            </div>
            {bookingPhone && (
              <button
                type="button"
                onClick={openWhatsAppBooking}
                style={{ marginTop: ".75rem", width: "100%", background: "#25d366", color: "#fff", border: "none", borderRadius: "var(--site-radius)", padding: ".65rem 1rem", fontWeight: 700, cursor: "pointer" }}
              >
                Book on WhatsApp instead
              </button>
            )}
            {qrBookingUrl && (
              <div style={{ marginTop: "1rem", padding: "1rem", borderRadius: "var(--site-radius)", border: "1px dashed hsl(var(--site-muted))", background: "hsl(var(--site-muted) / .25)", textAlign: "center" }}>
                <div style={{ fontWeight: 700, marginBottom: ".35rem" }}>WhatsApp booking QR</div>
                <p className="subtle" style={{ fontSize: ".85rem", marginBottom: ".75rem" }}>Scan to book via WhatsApp.</p>
                <img
                  alt="WhatsApp booking QR"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrBookingUrl)}`}
                  style={{ width: 180, height: 180, margin: "0 auto", display: "block", background: "#fff", padding: 8, borderRadius: 12 }}
                />
              </div>
            )}
            <p className="subtle" style={{ fontSize: ".78rem", marginTop: "1rem", textAlign: "center" }}>
              Payments are processed securely via {gatewayLabel}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
