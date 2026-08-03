import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import { ERP_SESSION_KEY, type StaffSession } from "./lib/staffSession";
import { runErpConnectivityBootstrap, runErpConnectivitySyncInit } from "./lib/erpConnectivity";
import "./index.css";

// Apply the persisted color scheme synchronously, before the first paint —
// ColorSchemeProvider (src/lib/colorScheme.ts) re-derives and owns this
// state once React mounts, but doing it here first avoids a flash of the
// wrong theme on load (e.g. dark-mode users briefly seeing a light flash).
(function applyInitialColorScheme() {
  try {
    const stored = localStorage.getItem("care-color-scheme");
    const isDark = stored === "dark" || (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
  } catch { /* ignore — private browsing / storage disabled, default light */ }
})();

setAuthTokenGetter(() => {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(ERP_SESSION_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StaffSession;
    return parsed?.token ?? null;
  } catch {
    return null;
  }
});

// Register the service worker in production builds only.
// The SW handles:
//   • Network-first API GET requests → every page visit fetches fresh data;
//     the cache is only used as a fallback when the network request fails
//   • Cache-first serving of hashed static assets → near-instant subsequent loads
//   • Offline fallback so the ERP stays usable when the network drops briefly
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  // BASE_URL is e.g. "/erp/" in production; strip trailing slash for the path.
  const base = import.meta.env.BASE_URL.replace(/\/$/, "") || "";
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${base}/sw.js`, { scope: `${base}/` })
      .catch((err) => {
        // Non-fatal — the app works fine without the SW.
        console.warn("[SW] Registration failed:", err);
      });
  });
}

// Handle stale-chunk-after-redeploy: when the ERP is rebuilt, the browser
// may have an already-loaded page whose lazy-loaded routes still reference
// old, now-deleted hashed chunk filenames. Vite fires "vite:preloadError"
// when such a dynamic import() 404s. The fix is a one-time hard reload to
// fetch the current index.html and chunk manifest. Guarded via
// sessionStorage so a genuinely broken deploy doesn't reload-loop forever.
window.addEventListener("vite:preloadError", () => {
  const key = "erp_chunk_reload_attempted";
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }
});

function boot() {
  runErpConnectivitySyncInit();
  const rootEl = document.getElementById("root")!;
  createRoot(rootEl).render(<App />);
  // Background only — must never block paint or redirect off caredeoghar.com.
  void runErpConnectivityBootstrap();
}

boot();

// Once the app has mounted successfully, clear the reload guard so a LATER
// redeploy during this same browser session can still trigger one auto-reload
// instead of being silently suppressed by an old guard flag.
window.setTimeout(() => {
  try { sessionStorage.removeItem("erp_chunk_reload_attempted"); } catch { /* ignore */ }
}, 5000);
