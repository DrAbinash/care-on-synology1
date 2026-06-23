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

createRoot(document.getElementById("root")!).render(<App />);
