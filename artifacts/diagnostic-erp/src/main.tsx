import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import { ERP_SESSION_KEY, type StaffSession } from "./lib/staffSession";
import "./index.css";

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
//   • Stale-while-revalidate caching of API GET responses → faster data loads
//     after the first visit / after a page refresh
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

createRoot(document.getElementById("root")!).render(<App />);

// Once the app has mounted successfully, clear the reload guard so a LATER
// redeploy during this same browser session can still trigger one auto-reload
// instead of being silently suppressed by an old guard flag.
window.setTimeout(() => {
  try { sessionStorage.removeItem("erp_chunk_reload_attempted"); } catch { /* ignore */ }
}, 5000);
