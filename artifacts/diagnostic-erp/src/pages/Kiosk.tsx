import { useState, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import { SelfRegistrationForm } from "../components/SelfRegistrationForm";
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
  welcomeMessage: string;
  paymentGateway: string;
  razorpayEnabled: boolean;
  payuEnabled: boolean;
  iciciEnabled: boolean;
  activeGateway?: string;
  vipQueueEnabled?: boolean;
};

type PaymentMode = "upi" | "icici";

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
  { value: "other", label: "Other" },
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
  const [step, setStep] = useState<Step>(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — patient details
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | "">("");
  const [ageValue, setAgeValue] = useState("");
  const [ageUnit, setAgeUnit] = useState<"years" | "months" | "days">("years");
  const [errFields, setErrFields] = useState<string[]>([]);
  const [isVip, setIsVip] = useState(false);

  // Step 2 — test selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("");

  // Step 4 — payment
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("upi");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [utr, setUtr] = useState("");
  const [utrError, setUtrError] = useState("");
  const [iciciSessionRef, setIciciSessionRef] = useState("");
  const [iciciPaying, setIciciPaying] = useState(false);

  // Step 5 — result
  const [result, setResult] = useState<ConfirmResult | null>(null);

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
        const td = await testsRes.json() as { tests: TestItem[] };
        setConfig(cfg);
        setTests(td.tests ?? []);
        const cats = [...new Set((td.tests ?? []).map(t => t.category || "General"))];
        if (cats.length > 0) setActiveCategory(cats[0]!);
        if (cfg.paymentGateway === "icici" && cfg.iciciEnabled) {
          setPaymentMode("icici");
        } else if (cfg.paymentGateway === "upi" && cfg.upiVpa) {
          setPaymentMode("upi");
        }
      } catch {
        setError("Failed to load kiosk data. Please ask staff for assistance.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Handle ICICI callback on mount (after redirect back)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const failed = params.get("failed");
    const ref = params.get("ref");
    const gateway = params.get("gateway");
    if ((gateway === "icici" || gateway === "hdfc") && ref) {
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

  const resetAll = useCallback(() => {
    setStep(0);
    setFirstName(""); setLastName(""); setPhone(""); setGender(""); setAgeValue(""); setAgeUnit("years");
    setSelectedIds(new Set()); setUtr(""); setUtrError(""); setResult(null); setQrDataUrl("");
    setIciciSessionRef(""); setIciciPaying(false); setError(""); setErrFields([]);
    setIsVip(false);
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
        const e = await res.json().catch(() => ({ error: "Payment initiation failed." })) as { error?: string };
        setError(e.error ?? "Payment initiation failed. Please try again.");
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
          gateway: "icici",
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

  // ── Print ─────────────────────────────────────────────────────────────────
  function handlePrint() {
    window.print();
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

  // ── Printable receipt (always rendered, hidden via CSS except on print) ───
  const printReceipt = result && (
    <div className="kiosk-print-only">
      <div className="kiosk-receipt">
        <h2 style={{ textAlign: "center", margin: "0 0 4px" }}>{config?.clinicName}</h2>
        <p style={{ textAlign: "center", margin: "0 0 12px", fontSize: "12px" }}>{config?.address}</p>
        <hr />
        <p><strong>Patient:</strong> {result.patientName} ({result.patientCode})</p>
        <p><strong>Bill No:</strong> {result.billNumber}</p>
        <p><strong>Date:</strong> {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
        {result.tokenNo && <p><strong>Queue Token:</strong> {result.tokenNo}</p>}
        <hr />
        <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "4px 0" }}>Test</th>
              <th style={{ textAlign: "right", padding: "4px 0" }}>Dept</th>
              <th style={{ textAlign: "right", padding: "4px 0" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {selectedTests.map(t => (
              <tr key={t.id}>
                <td style={{ padding: "2px 0" }}>{t.name}</td>
                <td style={{ textAlign: "right", padding: "2px 0" }}>{t.department}</td>
                <td style={{ textAlign: "right", padding: "2px 0" }}>{fmt(t.price)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ fontWeight: "bold", paddingTop: "8px" }}>Total Paid</td>
              <td style={{ textAlign: "right", fontWeight: "bold", paddingTop: "8px" }}>{fmt(result.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
        <hr />
        {result.testTokens.length > 0 && (
          <>
            <p style={{ fontWeight: "bold", margin: "8px 0 4px" }}>Your Department Tokens:</p>
            {result.testTokens.map((tt, i) => (
              <p key={i} style={{ margin: "2px 0" }}>
                <strong>{tt.department}:</strong> Token #{tt.tokenNo} — {tt.testName}
              </p>
            ))}
          </>
        )}
        <p style={{ textAlign: "center", marginTop: "16px", fontSize: "12px" }}>Thank you for choosing {config?.clinicName}.</p>
        <p style={{ textAlign: "center", fontSize: "11px", color: "#666" }}>Payment via UPI — Please keep this receipt for reference.</p>
      </div>
    </div>
  );

  // ── Step 0: Welcome ───────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div className="kiosk-root kiosk-no-print">
        {printReceipt}
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
      <div className="kiosk-root kiosk-no-print">
        {printReceipt}
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
    const catTests = grouped[activeCategory] ?? [];
    return (
      <div className="kiosk-root kiosk-no-print">
        {printReceipt}
        <div className="kiosk-page">
          <div className="kiosk-header">
            <button className="kiosk-back-btn" onClick={() => { setError(""); setStep(1); }}>← Back</button>
            <h2 className="kiosk-page-title">Select Tests</h2>
            <div className="kiosk-step-badge">Step 2 of 4</div>
          </div>
          {/* Category tabs */}
          <div className="kiosk-cat-tabs">
            {categories.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                className={`kiosk-cat-tab${activeCategory === cat ? " kiosk-cat-tab-active" : ""}`}>
                {cat}
              </button>
            ))}
          </div>
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
            {catTests.length === 0 && <p className="kiosk-muted">No tests in this category.</p>}
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
      <div className="kiosk-root kiosk-no-print">
        {printReceipt}
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
    const hasIcici = config?.iciciEnabled ?? false;
    const showModeToggle = hasUpi && hasIcici;
    return (
      <div className="kiosk-root kiosk-no-print">
        {printReceipt}
        <div className="kiosk-page">
          <div className="kiosk-header">
            <button className="kiosk-back-btn" onClick={() => { setUtr(""); setUtrError(""); setStep(3); }}>← Back</button>
            <h2 className="kiosk-page-title">Make Payment</h2>
            <div className="kiosk-step-badge">Step 4 of 4</div>
          </div>
          <div className="kiosk-payment">
            <div className="kiosk-amount-display">
              <span className="kiosk-pay-label">Amount to Pay</span>
              <span className="kiosk-pay-amount">{fmt(subtotal)}</span>
            </div>

            {/* Gateway mode toggle when both available */}
            {showModeToggle && (
              <div className="kiosk-mode-toggle">
                <button className={`kiosk-mode-btn${paymentMode === "upi" ? " kiosk-mode-active" : ""}`}
                  onClick={() => setPaymentMode("upi")}>UPI QR</button>
                <button className={`kiosk-mode-btn${paymentMode === "icici" ? " kiosk-mode-active" : ""}`}
                  onClick={() => setPaymentMode("icici")}>ICICI Card</button>
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

            {/* ICICI / HDFC Card mode */}
            {paymentMode === "icici" && (
              <div className="kiosk-icici-block">
                <div className="kiosk-center" style={{ padding: "24px" }}>
                  <img
                    src={config?.activeGateway === "hdfc" ? "/hdfc-bank-logo.jpeg" : "/icici-bank-logo.jpeg"}
                    alt={config?.activeGateway === "hdfc" ? "HDFC Bank" : "ICICI Bank"}
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
                  <p className="kiosk-muted">Pay securely using {config?.activeGateway === "hdfc" ? "HDFC Bank SmartGateway" : "ICICI Orange Pay"}.</p>
                  <p className="kiosk-muted">Supports Debit Card, Credit Card, UPI, Net Banking.</p>
                </div>
                {error && <p className="kiosk-error-msg">{error}</p>}
                <div className="kiosk-action-row">
                  <button className="kiosk-btn-primary kiosk-btn-lg" onClick={initiateIciciPayment} disabled={submitting || iciciPaying}>
                    {submitting || iciciPaying ? "Redirecting to Payment…" : `Pay Now with ${config?.activeGateway === "hdfc" ? "HDFC Bank" : "ICICI Bank"}`}
                  </button>
                </div>
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
      <div className="kiosk-root kiosk-no-print">
        {printReceipt}
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
