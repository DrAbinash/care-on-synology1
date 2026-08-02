/**
 * Minimal splash while the app checks public vs LAN connectivity.
 * Staff see this instead of a broken page when caredeoghar.com is down.
 */
export function ConnectivityBootstrapSplash() {
  return (
    <div
      id="erp-connectivity-splash"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        background: "#0f172a",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
        zIndex: 99999,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          border: "3px solid rgba(148,163,184,0.3)",
          borderTopColor: "#38bdf8",
          borderRadius: "50%",
          animation: "erp-spin 0.8s linear infinite",
        }}
      />
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Connecting to Care ERP…</p>
      <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", maxWidth: 320, textAlign: "center" }}>
        If the internet is down, we will switch to your local NAS automatically.
      </p>
      <style>{`@keyframes erp-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function removeConnectivityBootstrapSplash(): void {
  document.getElementById("erp-connectivity-splash")?.remove();
}
