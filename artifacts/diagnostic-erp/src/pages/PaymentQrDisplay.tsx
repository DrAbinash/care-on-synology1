/**
 * PaymentQrDisplay.tsx — Patient-facing payment QR screen for a networked
 * customer display (Android tablet, standalone monitor, or a same-PC second
 * window — all work, see below).
 *
 * Architecture mirrors Queue Display (TV) exactly: this page is a durable,
 * URL-addressable route (/display/payment-qr/:counterKey) that independently
 * pulls its own live state from the backend over SSE
 * (GET /api/payment-display/:counterKey/stream), the same way a waiting-room
 * TV pulls its own queue data. A physical device is pointed at this URL ONCE
 * (kiosk/fullscreen browser, auto-launch on boot) and never touched again —
 * Bill Desk pushes state to it via POST /api/payment-display/:counterKey/*
 * whenever a gateway payment starts/resolves; this page never talks to
 * bills.ts or any ICICI/payment-provider logic directly.
 *
 * counterKey lets a clinic run more than one billing counter, each with its
 * own customer-facing screen (same idea as Queue Display's :roomKey).
 *
 * Unattended-device auth: same displayToken mechanism as Queue Display — add
 * ?displayToken=<token> to the URL (staff can fetch the token from
 * GET /api/display/token). A staff-session browser (e.g. Bill Desk's own
 * "Open on Second Screen" same-PC fallback) works without it too.
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import QRCode from "qrcode";
import { api } from "@/lib/fetchApi";
import { CheckCircle2, Loader2, IndianRupee, Maximize2, Minimize2 } from "lucide-react";

type PaymentQrStatus = "pending" | "success" | "failed" | "expired";

interface PaymentQrState {
  active: boolean;
  qrData?: string;
  amount?: number;
  txnRef?: string;
  patientName?: string;
  billNumber?: string;
  status?: PaymentQrStatus;
  updatedAt: number;
}

function useQueryParam(name: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

function useIsFullscreen(): boolean {
  const [isFs, setIsFs] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);
  useEffect(() => {
    const handler = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  return isFs;
}

const INACTIVE_STATE: PaymentQrState = { active: false, updatedAt: 0 };

export default function PaymentQrDisplay() {
  const params = useParams<{ counterKey?: string }>();
  const counterKey = (params.counterKey || "counter1").toLowerCase();
  const displayToken = useQueryParam("displayToken");

  const [state, setState] = useState<PaymentQrState>(INACTIVE_STATE);
  const [qrImageUrl, setQrImageUrl] = useState("");
  // True when the feed rejects us for auth reasons (e.g. this device opened the
  // URL without a valid ?displayToken and has no staff session). Without this,
  // a mis-configured screen looks identical to the normal idle state and never
  // shows a QR, with no hint as to why.
  const [authError, setAuthError] = useState(false);
  const isFullscreen = useIsFullscreen();

  // Subscribe to this counter's live feed via SSE — falls back to polling if
  // the connection ever drops (e.g. proxy hiccup, device Wi-Fi blip) instead
  // of leaving the screen stuck on stale data.
  const reconnectTimerRef = useRef<number | null>(null);
  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: number | null = null;
    let cancelled = false;

    const streamUrl = `/api/payment-display/${encodeURIComponent(counterKey)}/stream${displayToken ? `?displayToken=${encodeURIComponent(displayToken)}` : ""}`;
    const snapshotUrl = `/api/payment-display/${encodeURIComponent(counterKey)}${displayToken ? `?displayToken=${encodeURIComponent(displayToken)}` : ""}`;

    const poll = async () => {
      if (cancelled) return;
      try {
        const data = await api.get<PaymentQrState>(snapshotUrl);
        if (!cancelled) { setState(data); setAuthError(false); }
      } catch (err) {
        // Surface auth failures (bad/missing displayToken on an unattended
        // device) so the screen can show a fix instead of a blank idle state.
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled && /401|unauthor|forbidden|token/i.test(msg)) setAuthError(true);
        // otherwise transient — try again shortly
      }
      if (!cancelled) pollTimer = window.setTimeout(poll, 4000);
    };

    const connect = () => {
      if (cancelled) return;
      try {
        es = new EventSource(streamUrl);
        es.onmessage = (evt) => {
          try { setState(JSON.parse(evt.data)); } catch { /* ignore malformed frame */ }
        };
        es.onerror = () => {
          es?.close();
          es = null;
          if (cancelled) return;
          // Retry the stream after a short delay; poll in the meantime so the
          // display doesn't sit frozen while reconnecting.
          if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = window.setTimeout(connect, 5000);
          poll();
        };
      } catch {
        poll();
      }
    };

    connect();
    return () => {
      cancelled = true;
      es?.close();
      if (pollTimer) window.clearTimeout(pollTimer);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
    };
  }, [counterKey, displayToken]);

  // Generate the scannable QR client-side from whatever qrData the backend
  // is currently relaying (prefer caredeoghar.com ICICI bridge URL from
  // Bill Desk — not the raw pgpay.icicibank.com HPP, which fails domain
  // validation when phones open it without visiting caredeoghar.com first).
  useEffect(() => {
    if (!state.active || !state.qrData) { setQrImageUrl(""); return; }
    let cancelled = false;
    QRCode.toDataURL(state.qrData, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 480,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => { if (!cancelled) setQrImageUrl(url); })
      .catch(() => { if (!cancelled) setQrImageUrl(""); });
    return () => { cancelled = true; };
  }, [state.active, state.qrData]);

  if (!state.active) {
    return (
      <div style={styles.root}>
        <div style={styles.card}>
          {authError ? (
            <>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Display not authorized</p>
              <p style={{ fontSize: 15, color: "#64748b", textAlign: "center", margin: "8px 0 0", maxWidth: 420 }}>
                This screen needs its setup link. In Bill Desk, open the Online Payment
                dialog and copy the customer-display URL (it includes the display token),
                then load that link on this device.
              </p>
              <p style={{ fontSize: 12, color: "#94a3b8", margin: "10px 0 0" }}>Counter: {counterKey}</p>
            </>
          ) : (
            <p style={{ fontSize: 22, color: "#94a3b8" }}>Waiting for a payment to be started at the counter…</p>
          )}
        </div>
      </div>
    );
  }

  const status = state.status ?? "pending";

  return (
    <div style={styles.root}>
      <button
        type="button"
        onClick={() => {
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else document.documentElement.requestFullscreen().catch(() => {});
        }}
        style={styles.fsButton}
        title={isFullscreen ? "Exit fullscreen" : "Fill screen"}
      >
        {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </button>
      <div style={styles.card}>
        {status === "success" ? (
          <>
            <CheckCircle2 size={96} color="#22c55e" />
            <h1 style={styles.successTitle}>Payment Received!</h1>
            <p style={styles.sub}>Thank you{state.patientName ? `, ${state.patientName}` : ""}.</p>
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
            {state.amount != null && (
              <div style={styles.amountRow}>
                <IndianRupee size={36} />
                <span style={styles.amount}>{Number(state.amount).toLocaleString("en-IN")}</span>
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
    position: "relative",
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
  fsButton: {
    position: "absolute",
    top: 20,
    right: 20,
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 8,
    padding: 10,
    color: "#e2e8f0",
    cursor: "pointer",
    display: "flex",
  },
};
