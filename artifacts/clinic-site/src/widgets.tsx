import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import type { SiteSettings, Popup } from "./types";

// WhatsApp floating button
export function WhatsAppFab({ settings }: { settings: SiteSettings }) {
  if (!settings.whatsappEnabled || !settings.whatsappNumber) return null;
  const num = settings.whatsappNumber.replace(/[^0-9]/g, "");
  const msg = encodeURIComponent(settings.whatsappGreeting || "Hi, I'd like to know more.");
  return (
    <a className="cd-wa-fab" href={`https://wa.me/${num}?text=${msg}`} target="_blank" rel="noreferrer" aria-label="WhatsApp">
      <MessageCircle size={26} />
    </a>
  );
}

// Popup engine
function shouldShow(p: Popup, currentSlug: string): boolean {
  if (!p.enabled) return false;
  const list = (p.showOnPages || "").trim();
  if (list === "" || list === "all") return true;
  return list.split(",").map((s) => s.trim()).filter(Boolean).includes(currentSlug);
}

function dismissedKey(id: number) { return `popup_dismissed_${id}`; }

export function PopupHost({ popups, currentSlug, basePath }: { popups: Popup[]; currentSlug: string; basePath: string }) {
  const [active, setActive] = useState<Popup | null>(null);

  useEffect(() => {
    setActive(null);
    const candidates = popups.filter((p) => shouldShow(p, currentSlug) && !sessionStorage.getItem(dismissedKey(p.id)));
    if (candidates.length === 0) return;
    const p = candidates[0];

    const trigger = (p.triggerType || "delay").toLowerCase();
    const value = Math.max(0, Number(p.triggerValue) || 0);
    let cleanup: () => void = () => {};

    if (trigger === "delay" || trigger === "time_delay" || trigger === "load" || trigger === "manual") {
      const t = setTimeout(() => setActive(p), value * 1000);
      cleanup = () => clearTimeout(t);
    } else if (trigger === "scroll") {
      const onScroll = () => {
        const pct = (window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100;
        if (pct >= value) { setActive(p); window.removeEventListener("scroll", onScroll); }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      cleanup = () => window.removeEventListener("scroll", onScroll);
    } else if (trigger === "exit" || trigger === "exit_intent") {
      const onLeave = (e: MouseEvent) => { if (e.clientY <= 0) { setActive(p); document.removeEventListener("mouseout", onLeave); } };
      document.addEventListener("mouseout", onLeave);
      cleanup = () => document.removeEventListener("mouseout", onLeave);
    } else {
      const t = setTimeout(() => setActive(p), Math.max(0, value) * 1000);
      cleanup = () => clearTimeout(t);
    }
    return cleanup;
  }, [popups, currentSlug]);

  if (!active) return null;
  function close() {
    if (active) sessionStorage.setItem(dismissedKey(active.id), "1");
    setActive(null);
  }
  const SAFE_URL_RE = /^(https?:|mailto:|tel:|\/(?!\/))/i;
  const rawCtaUrl = active.ctaUrl ?? "";
  const safeCtaUrl = SAFE_URL_RE.test(rawCtaUrl.trim()) ? rawCtaUrl.trim() : "";
  const ctaUrl = safeCtaUrl.startsWith("/") ? `${basePath}${safeCtaUrl.replace(/^\//, "")}` : safeCtaUrl;
  return (
    <div className="cd-popup-backdrop" onClick={close}>
      <div className="cd-popup-card" onClick={(e) => e.stopPropagation()}>
        <button className="cd-popup-close" onClick={close} aria-label="Close"><X size={16} /></button>
        {active.title && <h3 className="cd-display" style={{ fontWeight: 600, fontSize: "1.25rem", marginBottom: ".5rem", paddingRight: 32, color: "hsl(var(--cd-slate))" }}>{active.title}</h3>}
        {active.body && <p className="cd-section-sub" style={{ margin: "0 0 1.25rem" }}>{active.body}</p>}
        {active.ctaLabel && safeCtaUrl && (
          <a href={ctaUrl} className="cd-btn-primary" onClick={() => sessionStorage.setItem(dismissedKey(active.id), "1")}>
            {active.ctaLabel}
          </a>
        )}
      </div>
    </div>
  );
}
