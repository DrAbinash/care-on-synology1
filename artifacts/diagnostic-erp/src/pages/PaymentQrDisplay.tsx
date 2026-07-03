/**
 * PaymentQrDisplay.tsx — Patient-facing payment QR screen for a second monitor
 *
 * Opened by staff from Billing Desk's "Open on Second Screen" button (in the
 * Online Payment dialog) as a separate browser window/tab that can be dragged
 * onto a second monitor facing the patient. Shows a large, scannable QR code
 * for whichever online payment gateway is active (ICICI Orange Pay, BharatPe,
 * etc. — gateway-agnostic, same as the existing in-app payment dialog),
 * and automatically switches to a "Payment Received" screen once the payment
 * completes, using the same status-polling endpoint Billing Desk already uses.
 *
 * Reads its data from the URL (?qrData=...&amount=...&txnRef=...&billId=...)
 * instead of shared app state, since it runs in a separate browser window/tab
 * that cannot access the opener's React state directly. The QR image itself
 * is regenerated client-side from qrData (the same tranCtx/redirectUrl string
 * Billing Desk already has) rather than passed as a data-URL, keeping the URL
 * short.
 *
 * No new backend endpoint required — reuses:
 *   GET /api/bills/gateway-payment-status/:txnRef  (already used by BillingDesk.tsx)
 */
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/fetchApi";
import { CheckCircle2, Loader2, IndianRupee } from "lucide-react";

function useQueryParam(name: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

export default function PaymentQrDisplay() {
  const qrData = useQueryParam("qrData");
  const amount = useQueryParam("amount");
  const txnRef = useQueryParam("txnRef");
  const patientName = useQueryParam("patientName");

  const [qrImageUrl, setQrImageUrl] = useState("");
  const [status, setStatus] = useState<"pending" | "success" | "failed" | "expired" | "error">("pending");

  // Generate the scannable QR client-side (same qrcode library + settings
  // Billing Desk already uses) so the URL only needs to carry the short
  // qrData string, not a full data-URL image.
  useEffect(() => {
    if (!qrData) return;
    let cancelled = false;
    QRCode.toDataURL(qrData, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 480,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => { if (!cancelled) setQrImageUrl(url); })
      .catch(() => { if (!cancelled) setQrImageUrl(""); });
    return () => { cancelled = true; };
  }, [qrData]);

  // Poll the exact same status endpoint Billing Desk's in-app dialog uses.
  useEffect(() => {
    if (!txnRef || status !== "pending") return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        const res = await api.get<{ status: "pending" | "success" | "failed" | "expired"; error?: string }>(
          `/api/bills/gateway-payment-status/${encodeURIComponent(txnRef)}`
        );
        if (cancelled) return;
        if (res.status === "success") setStatus("success");
        else if (res.status === "failed") setStatus("failed");
        else if (res.status === "expired") setStatus("expired");
        else timer = window.setTimeout(poll, 3000);
      } catch {
        if (!cancelled) timer = window.setTimeout(poll, 5000);
      }
    };
    timer = window.setTimeout(poll, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [txnRef, status]);

  if (!qrData || !txnRef) {
    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <p style={{ fontSize: 22, color: "#94a3b8" }}>Waiting for a payment to be started at the counter…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        {status === "success" ? (
          <>
            <CheckCircle2 size={96} color="#22c55e" />
            <h1 style={styles.successTitle}>Payment Received!</h1>
            <p style={styles.sub}>Thank you{patientName ? `, ${patientName}` : ""}.</p>
          </>
        ) : status === "failed" ? (
          <>
            <div style={{ fontSize: 72 }}>✕</div>
            <h1 style={{ ...styles.successTitle, color: "#ef4444" }}>Payment Failed</h1>
            <p style={styles.sub}>Please ask the counter staff to try again.</p>
          </>
        ) : status === "expired" ? (
          <>
            <div style={{ fontSize: 72 }}>⏱</div>
            <h1 style={{ ...styles.successTitle, color: "#f59e0b" }}>QR Expired</h1>
            <p style={styles.sub}>Please ask the counter staff to generate a new QR.</p>
          </>
        ) : (
          <>
            <h1 style={styles.title}>Scan to Pay</h1>
            {amount && (
              <div style={styles.amountRow}>
                <IndianRupee size={36} />
                <span style={styles.amount}>{Number(amount).toLocaleString("en-IN")}</span>
              </div>
            )}
            {qrImageUrl ? (
              <img src={qrImageUrl} alt="Payment QR" style={styles.qrImg} />
            ) : (
              <div style={{ width: 480, height: 480, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Loader2 size={48} className="animate-spin" color="#64748b" />
              </div>
            )}
            <p style={styles.sub}>Scan with any UPI app, or use your Debit/Credit Card, or Net Banking</p>
            <div style={styles.waitingRow}>
              <Loader2 size={18} className="animate-spin" />
              <span>Waiting for payment…</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg,#0f172a,#1e293b)",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
  },
  card: {
    background: "#ffffff",
    borderRadius: 24,
    padding: "48px 64px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    maxWidth: 640,
  },
  title: { fontSize: 32, fontWeight: 800, color: "#0f172a", margin: 0 },
  successTitle: { fontSize: 32, fontWeight: 800, color: "#16a34a", margin: "12px 0 0" },
  sub: { fontSize: 16, color: "#64748b", margin: 0, textAlign: "center" },
  amountRow: { display: "flex", alignItems: "center", gap: 4, color: "#0f172a" },
  amount: { fontSize: 44, fontWeight: 900, letterSpacing: "-0.02em" },
  qrImg: { width: 320, height: 320, borderRadius: 12, border: "1px solid #e2e8f0", margin: "8px 0" },
  waitingRow: { display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 14, marginTop: 8 },
};
