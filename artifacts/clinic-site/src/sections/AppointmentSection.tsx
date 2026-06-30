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
      <section id="appointment" className="cd-section cd-section-light">
        <div className="container-narrow" style={{ maxWidth: 640 }}>
          <h2 className="cd-display cd-h2 text-center">{heading}</h2>
          {subheading && <p className="cd-section-sub text-center">{subheading}</p>}
          {step === "done" ? (
            <div className="cd-card cd-appt-notice text-center"><strong>Thanks!</strong> Your request has been sent. We'll confirm shortly.</div>
          ) : (
            <form onSubmit={handleWhatsApp} className="cd-appt-quickform">
              <input className="cd-appt-input" placeholder="Your name" required value={pd.name} onChange={(e) => setPd({ ...pd, name: e.target.value.toUpperCase() })} />
              <input className="cd-appt-input" placeholder="Phone number" required value={pd.phone} onChange={(e) => setPd({ ...pd, phone: e.target.value })} />
              <input className="cd-appt-input" type="date" value={pd.date} onChange={(e) => setPd({ ...pd, date: e.target.value })} />
              <textarea className="cd-appt-input" placeholder="What test or service?" rows={3} value={pd.notes} onChange={(e) => setPd({ ...pd, notes: e.target.value })} />
              <button type="submit" className="cd-btn-primary" style={{ justifyContent: "center" }}>Request Appointment</button>
            </form>
          )}
        </div>
      </section>
    );
  }

  return (
    <section id="appointment" className="cd-section cd-section-light">
      <div className="container-narrow" style={{ maxWidth: 720 }}>
        <h2 className="cd-display cd-h2 text-center">{heading}</h2>
        {subheading && <p className="cd-section-sub text-center">{subheading}</p>}

        {step === "failed" ? (
          <div className="cd-card cd-appt-status-card text-center" style={{ maxWidth: 480, margin: "0 auto" }}>
            <span className="cd-appt-status-icon cd-appt-status-fail" aria-hidden="true">&times;</span>
            <h3 className="cd-appt-status-title">Payment Not Completed</h3>
            <p className="cd-section-sub" style={{ fontSize: ".9375rem" }}>{failReason || "Your payment was not completed."}</p>
            <button type="button" className="cd-btn-primary" onClick={() => { setStep("pay"); setFailReason(""); }} style={{ justifyContent: "center", marginTop: ".5rem" }}>Try Again</button>
          </div>
        ) : step === "qr" ? (
          <div className="cd-card cd-appt-status-card" style={{ maxWidth: 480, margin: "0 auto" }}>
            <h3 className="cd-appt-status-title" style={{ textAlign: "left" }}>Pay with UPI QR</h3>
            <div style={{ textAlign: "center", marginBottom: "1rem" }}>
              <div className="cd-mono" style={{ fontSize: "1.1875rem", fontWeight: 600, marginBottom: ".5rem" }}>&#8377;{qrAmount.toLocaleString("en-IN")}</div>
              <div className="cd-section-sub" style={{ fontSize: ".875rem", margin: "0 0 .75rem" }}>Scan with any UPI app (GPay, PhonePe, Paytm) to complete payment</div>
              {qrUpiUrl ? (
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrUpiUrl)}`} alt="UPI QR" className="cd-appt-qr-img" />
              ) : (
                <div className="cd-appt-qr-placeholder"><Loader2 size={32} style={{ animation: "spin 1s linear infinite" }} /></div>
              )}
              <div style={{ marginTop: ".75rem", fontSize: ".875rem", fontWeight: 600 }}>{qrUpiVpa || qrUpiName}</div>
            </div>
            <div style={{ display: "flex", gap: ".75rem", marginBottom: ".75rem" }}>
              <button type="button" className="cd-btn-ghost" style={{ color: "hsl(var(--cd-slate))", borderColor: "hsl(var(--cd-hairline))", flex: 1 }} onClick={() => setStep("pay")}>&larr; Back</button>
              <button type="button" className="cd-btn-primary" onClick={checkQrPayment} disabled={qrChecking} style={{ flex: 1 }}>
                {qrChecking ? "Checking..." : "I've Paid"}
              </button>
            </div>
            <p className="cd-section-sub" style={{ fontSize: ".75rem", textAlign: "center", margin: 0 }}>
              Booking ref: <span className="cd-mono">{qrBookingRef}</span>
            </p>
          </div>
        ) : step === "done" ? (
          <div className="cd-card cd-appt-status-card text-center" style={{ maxWidth: 480, margin: "0 auto" }}>
            <span className="cd-appt-status-icon cd-appt-status-success" aria-hidden="true">&#10003;</span>
            <h3 className="cd-appt-status-title">Payment Successful!</h3>
            <p className="cd-section-sub" style={{ fontSize: ".9375rem", marginBottom: ".25rem" }}>Your booking reference is</p>
            <div className="cd-mono cd-appt-ref">{successRef}</div>
            <div className="cd-section-sub" style={{ fontSize: ".9rem", margin: "0 0 1rem" }}>Date: {pd.date}{pd.timeSlot && <> &middot; Slot: {pd.timeSlot}</>}</div>
            <p className="cd-section-sub" style={{ fontSize: ".9rem", margin: 0 }}>Please save this reference. Our staff will confirm your appointment shortly. You may receive a call or WhatsApp message.</p>
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
          <div className="cd-appt-select">
            {categories.length > 2 && (
              <div className="cd-tab-row" style={{ justifyContent: "flex-start", marginBottom: 0 }}>
                {categories.map((cat) => (
                  <button key={cat} onClick={() => setCatFilter(cat)} className={`cd-tab-btn ${catFilter === cat ? "active" : ""}`}>
                    {cat === "all" ? "All" : cat}
                  </button>
                ))}
              </div>
            )}
            {pkgs.length > 0 && (
              <div>
                <h3 className="cd-appt-subheading">Health Packages</h3>
                <div className="cd-appt-pkg-grid">
                  {pkgs.map((p) => (
                    <button key={p.id} type="button" onClick={() => togglePkg(p.id)} className={`cd-appt-pick-card ${selPkgs.has(p.id) ? "selected" : ""}`}>
                      <div className="cd-appt-pick-name">{p.name}</div>
                      {p.description && <div className="cd-appt-pick-desc">{p.description}</div>}
                      <div className="cd-mono cd-appt-pick-price">&#8377;{Number(p.price).toLocaleString("en-IN")}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {filteredTests.length > 0 && (
              <div>
                <h3 className="cd-appt-subheading">Individual Tests</h3>
                <div className="cd-appt-test-grid">
                  {filteredTests.map((t) => (
                    <button key={t.id} type="button" onClick={() => toggleTest(t.id)} className={`cd-appt-test-row ${selTests.has(t.id) ? "selected" : ""}`}>
                      <div>
                        <span className="cd-appt-test-name">{t.name}</span>
                        <span className="cd-appt-test-code">{t.code}</span>
                      </div>
                      <span className="cd-mono cd-appt-test-price">&#8377;{Number(t.price).toLocaleString("en-IN")}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(selTests.size > 0 || selPkgs.size > 0) && (
              <div className="cd-card cd-appt-sticky-bar">
                <div>
                  <span className="cd-section-sub" style={{ margin: 0, fontSize: ".875rem" }}>{selTests.size + selPkgs.size} item(s) selected</span>
                  <span className="cd-mono cd-appt-sticky-total">&#8377;{total.toLocaleString("en-IN")}</span>
                </div>
                <button type="button" className="cd-btn-primary" onClick={() => setStep("pay")} style={{ justifyContent: "center" }}>Review &amp; Pay &rarr;</button>
              </div>
            )}
          </div>
        ) : (
          <div className="cd-card" style={{ padding: "1.75rem", maxWidth: 520, margin: "0 auto" }}>
            <h3 className="cd-appt-subheading" style={{ marginBottom: "1rem" }}>Order Summary</h3>
            <div style={{ marginBottom: "1rem" }}>
              <div className="cd-contact-label">Patient Details</div>
              <div style={{ fontWeight: 600, color: "hsl(var(--cd-slate))" }}>{pd.name} &middot; {pd.phone}</div>
              <div className="cd-section-sub" style={{ fontSize: ".9rem", margin: 0 }}>Appointment: {pd.date}{pd.isVip ? " \u00b7 VIP" : ""}</div>
            </div>
            <div className="cd-appt-summary-list">
              {tests.filter((t) => selTests.has(t.id)).map((t) => (
                <div key={t.id} className="cd-appt-summary-row">
                  <span>{t.name}</span><span className="cd-mono" style={{ fontWeight: 600 }}>&#8377;{Number(t.price).toLocaleString("en-IN")}</span>
                </div>
              ))}
              {pkgs.filter((p) => selPkgs.has(p.id)).map((p) => (
                <div key={p.id} className="cd-appt-summary-row">
                  <span>{p.name} (Package)</span><span className="cd-mono" style={{ fontWeight: 600 }}>&#8377;{Number(p.price).toLocaleString("en-IN")}</span>
                </div>
              ))}
            </div>
            <div className="cd-appt-summary-total">
              <span>Total</span><span className="cd-mono" style={{ color: "hsl(var(--cd-teal))" }}>&#8377;{total.toLocaleString("en-IN")}</span>
            </div>
            {error && <div className="cd-appt-error">{error}</div>}
            <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setStep("select")} className="cd-appt-back-btn">&larr; Back</button>
              {config?.gateway === "icici" || config?.gateway === "hdfc" ? (
                <button
                  type="button"
                  onClick={handlePay}
                  disabled={paying}
                  className="cd-appt-gateway-btn"
                  style={{ background: config?.gateway === "icici" ? "#FF6600" : "#002F6C" }}
                >
                  {paying ? (
                    <>
                      <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Redirecting to Payment Gateway&hellip;
                    </>
                  ) : (
                    <>
                      <img
                        src={config?.gateway === "icici" ? "/icici-bank-logo.jpeg" : "/hdfc-bank-logo.jpeg"}
                        alt={config?.gateway === "icici" ? "ICICI Bank" : "HDFC Bank"}
                        className="cd-appt-gateway-logo"
                      />
                      <span>Pay &#8377;{total.toLocaleString("en-IN")} by {config?.gateway === "icici" ? "ICICI Bank" : "HDFC Bank"}</span>
                    </>
                  )}
                </button>
              ) : (
                <button type="button" className="cd-btn-primary" onClick={handlePay} disabled={paying} style={{ flex: 1, justifyContent: "center" }}>
                  {paying
                    ? (config?.gateway === "payu" ? "Redirecting to PayU\u2026" :
                       config?.gateway === "bharatpe" ? "Redirecting to BharatPe\u2026" :
                       config?.gateway === "phonepe" ? "Redirecting to PhonePe\u2026" : "Processing\u2026")
                    : `Pay \u20b9${total.toLocaleString("en-IN")} via ${gatewayLabel}`}
                </button>
              )}
            </div>
            {bookingPhone && (
              <button
                type="button"
                onClick={openWhatsAppBooking}
                className="cd-appt-wa-btn"
              >
                Book on WhatsApp instead
              </button>
            )}
            {qrBookingUrl && (
              <div className="cd-appt-qr-prompt">
                <div style={{ fontWeight: 600, marginBottom: ".35rem", color: "hsl(var(--cd-slate))" }}>WhatsApp booking QR</div>
                <p className="cd-section-sub" style={{ fontSize: ".875rem", margin: "0 0 .75rem" }}>Scan to book via WhatsApp.</p>
                <img
                  alt="WhatsApp booking QR"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrBookingUrl)}`}
                  className="cd-appt-qr-small"
                />
              </div>
            )}
            <p className="cd-section-sub" style={{ fontSize: ".78rem", marginTop: "1rem", textAlign: "center" }}>
              Payments are processed securely via {gatewayLabel}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
