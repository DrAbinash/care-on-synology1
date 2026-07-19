import { useState, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import { SelfRegistrationForm } from "../components/SelfRegistrationForm";
import { buildBillPrintHtml, printViaIframe, type PrintBillData, type PrintClinic } from "@/lib/printBill";
import "./Kiosk.css";

type KioskConfig = {
  enabled: boolean;
  clinicName: string;
  tagline: string;
  logoDataUrl: string | null;
  address: string;
  phone: string;
  upiVpa: string;
  upiName: string;
  upiQrImageUrl?: string;
  upiQrEnabled?: boolean;
  welcomeMessage: string;
  paymentGateway: string;
  razorpayEnabled: boolean;
  payuEnabled: boolean;
  iciciEnabled: boolean;
  activeGateway?: string;
  vipQueueEnabled?: boolean;
  enableCardPayment?: boolean;
  enableQrPayment?: boolean;
  enablePaymentLogos?: boolean;
  customIciciBannerUrl?: string;
  customPhonepeBannerUrl?: string;
  customBharatpeBannerUrl?: string;
  customPayuBannerUrl?: string;
  printClinic?: PrintClinic;
};

// "upi" = QR/UTR fallback (always available); "gateway" = whichever real
// payment gateway is configured (ICICI/HDFC/PayU/PhonePe/BharatPe) — same
// dispatch shape as the online booking page's handlePay().
type PaymentMode = "upi" | "gateway";

type TestItem = {
  id: number;
  code: string;
  name: string;
  category: string;
  price: number;
  department: string;
  duration: string;
};

type ConfirmResult = {
  billNumber: string;
  billId: number;
  totalAmount: number;
  patientCode: string;
  patientName: string;
  isNewPatient: boolean;
  tokenNo: number | null;
  tokenDate: string | null;
  testTokens: Array<{ orderTestId: number; testName: string; department: string; roomNumber: string; tokenNo: number }>;
};

type Step = 0 | 1 | 2 | 3 | 4 | 5;

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function groupByCategory(tests: TestItem[]): Record<string, TestItem[]> {
  const out: Record<string, TestItem[]> = {};
  for (const t of tests) {
    const cat = t.category || "General";
    if (!out[cat]) out[cat] = [];
    out[cat].push(t);
  }
  return out;
}

export default function Kiosk() {
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [tests, setTests] = useState<TestItem[]>([]);
  const [quickTestIds, setQuickTestIds] = useState<number[]>([]);
  const [step, setStep] = useState<Step>(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — patient details
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [ageValue, setAgeValue] = useState("");
  const [ageUnit, setAgeUnit] = useState<"years" | "months" | "days">("years");
  const [errFields, setErrFields] = useState<string[]>([]);
  const [isVip, setIsVip] = useState(false);

  // Step 2 — test selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [testSearch, setTestSearch] = useState("");

  // Step 4 — payment
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("upi");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [utr, setUtr] = useState("");
  const [utrError, setUtrError] = useState("");
  const [iciciSessionRef, setIciciSessionRef] = useState("");
  const [iciciPaying, setIciciPaying] = useState(false);

  // Step 5 — result
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [receiptQrDataUrl, setReceiptQrDataUrl] = useState<string>("");

  // Load config + tests on mount; also check URL for ICICI callback
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [cfgRes, testsRes] = await Promise.all([
          fetch("/api/kiosk/config"),
          fetch("/api/kiosk/tests"),
        ]);
        const cfg = await cfgRes.json() as KioskConfig;
        const td = await testsRes.json() as { tests: TestItem[]; quickTestIds?: number[] };
        setConfig(cfg);
        setTests(td.tests ?? []);
        setQuickTestIds(td.quickTestIds ?? []);
        const cats = [...new Set((td.tests ?? []).map(t => t.category || "General"))];
        if (cats.length > 0) setActiveCategory(cats[0]!);
        // Same default as the online booking page: prefer the configured
        // gateway when one is actually usable, otherwise fall back to UPI QR.
        setPaymentMode(cfg.activeGateway && cfg.iciciEnabled ? "gateway" : "upi");
      } catch {
        setError("Failed to load kiosk data. Please ask staff for assistance.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Handle gateway callback on mount (after redirect back from ICICI, HDFC,
  // PayU, PhonePe, or BharatPe — the return URL always carries ?gateway=<id>
  // set by the server to whichever gateway was actually used).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const failed = params.get("failed");
    const ref = params.get("ref");
    const gateway = params.get("gateway");
    if (gateway && ref) {
      if (success) {
        setIciciSessionRef(ref);
        completeIciciRegistration(ref);
      } else if (failed) {
        setError("Payment was not completed. Please try again.");
        setIciciPaying(false);
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const selectedTests = tests.filter(t => selectedIds.has(t.id));
  const subtotal = selectedTests.reduce((s, t) => s + t.price, 0);
  const grouped = groupByCategory(tests);
  const categories = Object.keys(grouped).sort();
  const quickTests = quickTestIds.map(id => tests.find(t => t.id === id)).filter((t): t is TestItem => !!t);
  const searchResults = testSearch.trim()
    ? tests.filter(t => t.name.toLowerCase().includes(testSearch.trim().toLowerCase()))
    : null;

  // Generate UPI QR code when entering payment step (UPI mode)
  useEffect(() => {
    if (step !== 4 || !config?.upiVpa || paymentMode !== "upi") return;
    const ref = `KIOSK${Date.now()}`;
    const patName = encodeURIComponent((firstName + " " + lastName).trim().slice(0, 40));
    const upiLink = `upi://pay?pa=${encodeURIComponent(config.upiVpa)}&pn=${patName}&am=${subtotal.toFixed(2)}&tn=${ref}&cu=INR`;
    QRCode.toDataURL(upiLink, { width: 280, margin: 2, color: { dark: "#1a1a2e", light: "#ffffff" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [step, config, paymentMode, firstName, lastName, subtotal]);

  // Generate the same verify-QR the Billing Desk puts on every printed
  // receipt (scans to /api/verify/bill/<billNumber>) once registration succeeds.
  useEffect(() => {
    if (!result?.billNumber) { setReceiptQrDataUrl(""); return; }
    const verifyUrl = `${window.location.origin}/api/verify/bill/${encodeURIComponent(result.billNumber)}`;
    QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: "M", margin: 1, width: 256, color: { dark: "#000000", light: "#ffffff" } })
      .then(setReceiptQrDataUrl)
      .catch(() => setReceiptQrDataUrl(""));
  }, [result?.billNumber]);

  const resetAll = useCallback(() => {
    setStep(0);
    setFirstName(""); setLastName(""); setPhone(""); setGender(""); setAgeValue(""); setAgeUnit("years");
    setSelectedIds(new Set()); setUtr(""); setUtrError(""); setResult(null); setQrDataUrl("");
    setIciciSessionRef(""); setIciciPaying(false); setError(""); setErrFields([]);
    setIsVip(false); setTestSearch("");
  }, []);

  // ── Validation ────────────────────────────────────────────────────────────
  function validateStep1() {
    setError("");
    setErrFields([]);

    if (!firstName.trim()) {
      setError("Please enter first name.");
      setErrFields(["firstName"]);
      const el = document.getElementById("kiosk-firstName");
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return false;
    }
    const cleanPhone = phone.replace(/\D/g, "");
    if (!phone.trim() || cleanPhone.length !== 10) {
      setError("Please enter a valid mobile number.");
      setErrFields(["phone"]);
      const el = document.getElementById("kiosk-phone");
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return false;
    }
    if (!gender) {
      setError("Please select gender.");
      setErrFields(["gender"]);
      const el = document.getElementById("kiosk-gender");
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return false;
    }
    if (!ageValue || Number(ageValue) < 0) {
      setError("Please enter age.");
      setErrFields(["ageValue"]);
      const el = document.getElementById("kiosk-ageValue");
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return false;
    }
    setError("");
    return true;
  }
  function validateStep2() {
    if (selectedIds.size === 0) { setError("Please select at least one test."); return false; }
    setError(""); return true;
  }
  function validateUtr() {
    const v = utr.trim();
    if (!v) { setUtrError("Please enter the UPI transaction ID after paying."); return false; }
    if (v.length < 6) { setUtrError("Transaction ID seems too short. Please check and re-enter."); return false; }
    setUtrError(""); return true;
  }

  // ── ICICI payment flow ───────────────────────────────────────────────────
  async function initiateIciciPayment() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/kiosk/icici-initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          testIds: [...selectedIds],
          totalAmount: subtotal,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Payment initiation failed." })) as { error?: string; details?: string };
        const shown = e.details ? `${e.error ?? "Payment initiation failed."} (${e.details})` : (e.error ?? "Payment initiation failed. Please try again.");
        setError(shown);
        return;
      }
      const data = await res.json() as { sessionRef: string; redirectUrl: string };
      setIciciSessionRef(data.sessionRef);
      setIciciPaying(true);
      window.location.href = data.redirectUrl;
    } catch {
      setError("Network error. Please check connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function completeIciciRegistration(ref: string) {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/kiosk/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          gender,
          ageValue: Number(ageValue),
          ageUnit,
          paymentLinkId: ref,
          isVip,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Registration failed. Please see staff." })) as { error?: string };
        setError(e.error ?? "Registration failed. Please see staff.");
        setIciciPaying(false);
        return;
      }
      const data = await res.json() as ConfirmResult;
      setResult(data);
      setStep(5);
      setIciciPaying(false);
    } catch {
      setError("Network error. Please check connection and try again.");
      setIciciPaying(false);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Submit registration (UPI fallback) ────────────────────────────────────
  async function handleConfirm() {
    if (!validateUtr()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/kiosk/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          gender,
          ageValue: Number(ageValue),
          ageUnit,
          testIds: [...selectedIds],
          utrReference: utr.trim(),
          clientTotal: subtotal,
          isVip,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Registration failed. Please see staff." })) as { error?: string };
        setError(e.error ?? "Registration failed. Please see staff.");
        return;
      }
      const data = await res.json() as ConfirmResult;
      setResult(data);
      setStep(5);
    } catch {
      setError("Network error. Please check connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Print — shares the exact Billing Desk receipt template (buildBillPrintHtml)
  // instead of a bespoke kiosk layout, so a kiosk registration prints the same
  // invoice a walk-in patient gets at the counter. ─────────────────────────────
  function handlePrint() {
    if (!result) return;
    const paymentMethod = paymentMode === "upi" ? "upi" : (config?.activeGateway || "gateway");
    const paymentReference = paymentMode === "upi" ? utr : iciciSessionRef;
    const bill: PrintBillData = {
      billNumber: result.billNumber,
      subtotal: result.totalAmount,
      discount: 0,
      totalAmount: result.totalAmount,
      paidAmount: result.totalAmount,
      balanceAmount: 0,
      status: "paid",
      createdAt: new Date().toISOString(),
      patient: {
        firstName,
        lastName,
        patientId: result.patientCode,
        phone,
        gender,
        ageValue: ageValue ? Number(ageValue) : null,
        ageUnit,
      },
      order: {
        tests: selectedTests.map(t => ({
          price: t.price,
          test: { code: t.code, name: t.name, category: t.category },
        })),
      },
      payments: [{ method: paymentMethod, amount: result.totalAmount, referenceNumber: paymentReference || null }],
      testTokens: result.testTokens,
      tokenNo: result.tokenNo,
    };
    const clinic: PrintClinic = config?.printClinic ?? { name: config?.clinicName, tagline: config?.tagline, address: config?.address, phone: config?.phone, logoDataUrl: config?.logoDataUrl };
    // Kiosk self-registration receipts always show the queue token box —
    // that's the entire point of a kiosk print (unlike billing-counter
    // receipts, where it's an opt-in setting; see showQueueTokenOnBill).
    const html = buildBillPrintHtml({ bill, clinic, paperSize: "A5", isBW: false, qrDataUrl: receiptQrDataUrl, format: "classic", compactFooterGap: true, showQueueToken: true });
    printViaIframe(html);
  }

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="kiosk-root">
        <div className="kiosk-center">
          <div className="kiosk-spinner" />
          <p className="kiosk-muted">Loading kiosk…</p>
        </div>
      </div>
    );
  }

  if (error && step === 0) {
    return (
      <div className="kiosk-root">
        <div className="kiosk-center">
          <p className="kiosk-error-msg">{error}</p>
          <button className="kiosk-btn-primary" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (config && !config.enabled) {
    return (
      <div className="kiosk-root">
        <div className="kiosk-center">
          {config.logoDataUrl && <img src={config.logoDataUrl} alt="logo" className="kiosk-logo" />}
          <h1 className="kiosk-clinic-name">{config.clinicName}</h1>
          <p className="kiosk-tagline">Self-registration is currently unavailable.</p>
          <p className="kiosk-muted">Please proceed to the registration counter.</p>
        </div>
      </div>
    );
  }

  // ── Step 0: Welcome ───────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div className="kiosk-root">
        <div className="kiosk-center">
          {config?.logoDataUrl && <img src={config.logoDataUrl} alt="logo" className="kiosk-logo" />}
          <h1 className="kiosk-clinic-name">{config?.clinicName}</h1>
          {config?.tagline && <p className="kiosk-tagline">{config.tagline}</p>}
          {config?.welcomeMessage && <p className="kiosk-welcome-msg">{config.welcomeMessage}</p>}
          <button className="kiosk-btn-primary kiosk-btn-xl" onClick={() => setStep(1)}>
            Start Self-Registration
          </button>
          {config?.address && <p className="kiosk-footer-info">{config.address}</p>}
          {config?.phone && <p className="kiosk-footer-info">📞 {config.phone}</p>}
        </div>
      </div>
    );
  }

  // ── Step 1: Patient Details ───────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="kiosk-root">
        <div className="kiosk-page">
          <div className="kiosk-header">
            <button className="kiosk-back-btn" onClick={() => { setError(""); setErrFields([]); setStep(0); }}>← Back</button>
            <h2 className="kiosk-page-title">Your Details</h2>
            <div className="kiosk-step-badge">Step 1 of 4</div>
          </div>
          <SelfRegistrationForm
            mode="kiosk"
            vipEnabled={config?.vipQueueEnabled}
            initialValues={{
              firstName,
              lastName,
              phone,
              gender,
              ageValue,
              ageUnit,
              isVip,
            }}
            onSubmit={(data) => {
              setFirstName(data.firstName);
              setLastName(data.lastName);
              setPhone(data.phone);
              setGender(data.gender);
              setAgeValue(String(data.ageValue));
              setAgeUnit(data.ageUnit);
              setIsVip(!!data.isVip);
              setStep(2);
            }}
          />
        </div>
      </div>
    );
  }

  // ── Step 2: Test Selection ────────────────────────────────────────────────
  if (step === 2) {
    const catTests = searchResults ?? (grouped[activeCategory] ?? []);
    return (
      <div className="kiosk-root">
        <div className="kiosk-page">
          <div className="kiosk-header">
            <button className="kiosk-back-btn" onClick={() => { setError(""); setStep(1); }}>← Back</button>
            <h2 className="kiosk-page-title">Select Tests</h2>
            <div className="kiosk-step-badge">Step 2 of 4</div>
          </div>

          {/* Search box — case-insensitive substring match over test names */}
          <div className="kiosk-search-row">
            <input
              className="kiosk-input kiosk-search-input"
              placeholder="🔍 Search tests by name…"
              value={testSearch}
              onChange={e => setTestSearch(e.target.value)}
            />
            {testSearch && (
              <button type="button" className="kiosk-search-clear" onClick={() => setTestSearch("")}>✕</button>
            )}
          </div>

          {/* Quick-select — frequently-done tests, configured once from the
              Billing Desk's quick-test slots (clinic settings) so both
              surfaces stay in sync. Bigger & brighter than category tabs
              since these are the fastest path through the kiosk. */}
          {!testSearch && quickTests.length > 0 && (
            <div className="kiosk-quick-tests">
              {quickTests.map(test => {
                const sel = selectedIds.has(test.id);
                return (
                  <button key={test.id} className={`kiosk-quick-test-tile${sel ? " kiosk-quick-test-selected" : ""}`}
                    onClick={() => {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(test.id)) next.delete(test.id); else next.add(test.id);
                        return next;
                      });
                    }}>
                    <span className="kiosk-quick-test-name">{test.name}</span>
                    <span className="kiosk-quick-test-price">{fmt(test.price)}</span>
                    {sel && <span className="kiosk-test-check">✓</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Category tabs — hidden while searching */}
          {!testSearch && (
            <div className="kiosk-cat-tabs">
              {categories.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  className={`kiosk-cat-tab${activeCategory === cat ? " kiosk-cat-tab-active" : ""}`}>
                  {cat}
                </button>
              ))}
            </div>
          )}
          {/* Tests grid */}
          <div className="kiosk-tests-grid">
            {catTests.map(test => {
              const sel = selectedIds.has(test.id);
              return (
                <button key={test.id} className={`kiosk-test-tile${sel ? " kiosk-test-tile-selected" : ""}`}
                  onClick={() => {
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (next.has(test.id)) next.delete(test.id); else next.add(test.id);
                      return next;
                    });
                  }}>
                  <span className="kiosk-test-name">{test.name}</span>
                  <span className="kiosk-test-price">{fmt(test.price)}</span>
                  {sel && <span className="kiosk-test-check">✓</span>}
                </button>
              );
            })}
            {catTests.length === 0 && <p className="kiosk-muted">{testSearch ? "No tests match your search." : "No tests in this category."}</p>}
          </div>
          {/* Footer bar */}
          <div className="kiosk-footer-bar">
            <div className="kiosk-footer-info-block">
              <span className="kiosk-selected-count">{selectedIds.size} test{selectedIds.size !== 1 ? "s" : ""} selected</span>
              <span className="kiosk-subtotal">{fmt(subtotal)}</span>
            </div>
            {error && <p className="kiosk-error-msg">{error}</p>}
            <button className="kiosk-btn-primary" disabled={selectedIds.size === 0}
              onClick={() => { if (validateStep2()) setStep(3); }}>
              Review Order →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 3: Order Summary ─────────────────────────────────────────────────
  if (step === 3) {
    return (
      <div className="kiosk-root">
        <div className="kiosk-page">
          <div className="kiosk-header">
            <button className="kiosk-back-btn" onClick={() => setStep(2)}>← Back</button>
            <h2 className="kiosk-page-title">Order Summary</h2>
            <div className="kiosk-step-badge">Step 3 of 4</div>
          </div>
          <div className="kiosk-summary">
            <div className="kiosk-patient-summary">
              <p><strong>Name:</strong> {firstName} {lastName}</p>
              <p><strong>Mobile:</strong> {phone}</p>
              <p><strong>Gender:</strong> {gender.charAt(0).toUpperCase() + gender.slice(1)}</p>
            </div>
            <div className="kiosk-summary-card">
              <h3 className="kiosk-summary-heading">Selected Tests</h3>
              <div className="kiosk-summary-tests">
                {selectedTests.map(t => (
                  <div key={t.id} className="kiosk-summary-test-row">
                    <div>
                      <span className="kiosk-summary-test-name">{t.name}</span>
                      <span className="kiosk-summary-test-dept"> · {t.department}</span>
                    </div>
                    <span className="kiosk-summary-test-price">{fmt(t.price)}</span>
                  </div>
                ))}
              </div>
              <div className="kiosk-summary-total-row">
                <span>Total Amount</span>
                <span className="kiosk-summary-total">{fmt(subtotal)}</span>
              </div>
            </div>
            <div className="kiosk-action-row">
              <button className="kiosk-btn-primary kiosk-btn-lg" onClick={() => setStep(4)}>
                Proceed to Payment →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 4: Payment ───────────────────────────────────────────────────────
  if (step === 4) {
    const hasUpi = !!config?.upiVpa;
    const hasGateway = config?.iciciEnabled ?? false; // resolved "a real gateway is usable" flag from /api/kiosk/config
    // Same gateway → label/logo/color mapping as the online booking page,
    // so the kiosk and caredeoghar.com/book present identical branding for
    // whichever gateway staff have configured in clinic settings.
    const gw = config?.activeGateway;
    const gatewayLabel =
      gw === "icici" ? "ICICI Orange Pay" :
      gw === "hdfc" ? "HDFC Bank" :
      gw === "bharatpe" ? "BharatPe" :
      gw === "phonepe" ? "PhonePe" :
      gw === "payu" ? "PayU" :
      gw === "razorpay" ? "Razorpay" : "Gateway";
    const gatewayLogo =
      gw === "hdfc" ? "/hdfc-bank-logo.jpeg" :
      gw === "icici" ? "/icici-bank-logo.jpeg" : null;
    const gatewayBanner =
      gw === "icici" ? config?.customIciciBannerUrl :
      gw === "phonepe" ? config?.customPhonepeBannerUrl :
      gw === "bharatpe" ? config?.customBharatpeBannerUrl :
      gw === "payu" ? config?.customPayuBannerUrl : "";
    const isCardStyleGateway = gw === "icici" || gw === "hdfc";
    return (
      <div className="kiosk-root">
        <div className="kiosk-page">
          <div className="kiosk-header">
            <button className="kiosk-back-btn" onClick={() => { setUtr(""); setUtrError(""); setStep(3); }}>← Back</button>
            <h2 className="kiosk-page-title">Make Payment</h2>
            <div className="kiosk-step-badge">Step 4 of 4</div>
          </div>
          <div className="kiosk-payment">
            {config?.enablePaymentLogos !== false && (
              gatewayBanner ? (
                <img src={gatewayBanner} alt={`${gatewayLabel} Banner`} className="kiosk-payment-banner" />
              ) : (
                <img src="/payment-methods-logo.png" alt="Supported Payment Methods" className="kiosk-payment-banner" />
              )
            )}
            <div className="kiosk-amount-display">
              <span className="kiosk-pay-label">Amount to Pay</span>
              <span className="kiosk-pay-amount">{fmt(subtotal)}</span>
            </div>

            {/* Gateway mode toggle when both a real gateway AND UPI fallback are available */}
            {hasUpi && hasGateway && (
              <div className="kiosk-mode-toggle">
                <button className={`kiosk-mode-btn${paymentMode === "gateway" ? " kiosk-mode-active" : ""}`}
                  onClick={() => setPaymentMode("gateway")}>{gatewayLabel}</button>
                <button className={`kiosk-mode-btn${paymentMode === "upi" ? " kiosk-mode-active" : ""}`}
                  onClick={() => setPaymentMode("upi")}>UPI QR</button>
              </div>
            )}

            {/* UPI QR mode */}
            {paymentMode === "upi" && (
              <>
                {hasUpi ? (
                  <div className="kiosk-qr-block">
                    {qrDataUrl ? (
                      <>
                        <img src={qrDataUrl} alt="UPI QR Code" className="kiosk-qr-img" />
                        <p className="kiosk-qr-instructions">
                          Scan with <strong>Google Pay, PhonePe, Paytm</strong> or any UPI app to pay {fmt(subtotal)}.
                        </p>
                        <p className="kiosk-qr-vpa">UPI ID: <strong>{config.upiVpa}</strong></p>
                      </>
                    ) : (
                      <div className="kiosk-center" style={{ padding: "24px" }}>
                        <div className="kiosk-spinner" />
                        <p className="kiosk-muted">Generating QR…</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="kiosk-no-upi-notice">
                    <p>Please pay <strong>{fmt(subtotal)}</strong> at the counter and get your UTR / reference number.</p>
                  </div>
                )}
                <div className="kiosk-utr-section">
                  <label className="kiosk-label">
                    {hasUpi ? "Enter UPI Transaction ID (shown in your payment app after paying)" : "Enter Receipt / Reference Number *"}
                  </label>
                  <input className="kiosk-input kiosk-input-lg" placeholder={hasUpi ? "e.g. 412345678901" : "Reference number"}
                    value={utr} onChange={e => { setUtr(e.target.value); setUtrError(""); }} />
                  {utrError && <p className="kiosk-error-msg">{utrError}</p>}
                  {error && <p className="kiosk-error-msg">{error}</p>}
                </div>
                <div className="kiosk-action-row">
                  <button className="kiosk-btn-primary kiosk-btn-lg" onClick={handleConfirm} disabled={submitting}>
                    {submitting ? "Registering…" : "Confirm & Complete Registration"}
                  </button>
                </div>
              </>
            )}

            {/* Real gateway mode — ICICI / HDFC / PayU / PhonePe / BharatPe */}
            {paymentMode === "gateway" && (
              <div className="kiosk-icici-block">
                <div className="kiosk-center" style={{ padding: "24px" }}>
                  {gatewayLogo && (
                    <img
                      src={gatewayLogo}
                      alt={gatewayLabel}
                      style={{
                        height: "45px",
                        objectFit: "contain",
                        background: "white",
                        borderRadius: "6px",
                        padding: "4px",
                        border: "2px solid #002F6C",
                        marginBottom: "1rem"
                      }}
                    />
                  )}
                  <p className="kiosk-muted">Pay securely using {gatewayLabel}.</p>
                  <p className="kiosk-muted">Supports Debit Card, Credit Card, UPI, Net Banking.</p>
                </div>
                {error && <p className="kiosk-error-msg">{error}</p>}
                <div className="kiosk-action-row">
                  <button
                    className="kiosk-btn-primary kiosk-btn-lg"
                    style={isCardStyleGateway ? { background: gw === "icici" ? "#FF6600" : "#002F6C" } : undefined}
                    onClick={initiateIciciPayment}
                    disabled={submitting || iciciPaying}
                  >
                    {submitting || iciciPaying ? "Redirecting to Payment…" : `Pay Now with ${gatewayLabel}`}
                  </button>
                </div>
                {/* QR fallback always reachable alongside the gateway, same as the online booking page */}
                {hasUpi && (
                  <button type="button" className="kiosk-back-btn" style={{ marginTop: "0.75rem" }} onClick={() => setPaymentMode("upi")}>
                    Pay via UPI QR instead
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Step 5: Confirmation ──────────────────────────────────────────────────
  if (step === 5 && result) {
    return (
      <div className="kiosk-root">
        <div className="kiosk-page kiosk-confirm-page">
          <div className="kiosk-success-icon">✓</div>
          <h2 className="kiosk-success-title">Registration Complete!</h2>
          <p className="kiosk-success-subtitle">Welcome, <strong>{result.patientName}</strong>!</p>

          <div className="kiosk-result-cards">
            <div className="kiosk-result-card kiosk-result-card-blue">
              <span className="kiosk-result-card-label">Patient Code</span>
              <span className="kiosk-result-card-value">{result.patientCode}</span>
            </div>
            <div className="kiosk-result-card kiosk-result-card-green">
              <span className="kiosk-result-card-label">Bill Number</span>
              <span className="kiosk-result-card-value">{result.billNumber}</span>
            </div>
            {result.tokenNo && (
              <div className="kiosk-result-card kiosk-result-card-orange">
                <span className="kiosk-result-card-label">Queue Token</span>
                <span className="kiosk-result-card-value kiosk-token-no">#{result.tokenNo}</span>
              </div>
            )}
          </div>

          {result.testTokens.length > 0 && (
            <div className="kiosk-dept-tokens">
              <h3 className="kiosk-dept-tokens-title">Your Department Tokens</h3>
              <div className="kiosk-dept-token-grid">
                {result.testTokens.map((tt, i) => (
                  <div key={i} className="kiosk-dept-token-tile">
                    <span className="kiosk-dept-token-dept">{tt.department}</span>
                    <span className="kiosk-dept-token-no">#{tt.tokenNo}</span>
                    <span className="kiosk-dept-token-test">{tt.testName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="kiosk-paid-summary">
            <span>Amount Paid</span>
            <span className="kiosk-paid-amount">{fmt(result.totalAmount)}</span>
          </div>

          <p className="kiosk-instruction">Please wait for your token to be called. Thank you!</p>

          <div className="kiosk-action-row kiosk-confirm-actions">
            <button className="kiosk-btn-outline kiosk-btn-lg" onClick={handlePrint}>🖨 Print Receipt</button>
            <button className="kiosk-btn-primary kiosk-btn-lg" onClick={resetAll}>Done / New Registration</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
