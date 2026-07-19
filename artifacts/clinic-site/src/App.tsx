import { useEffect, useMemo, useState } from "react";
import { Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Phone, MessageCircle, CalendarCheck } from "lucide-react";
import { api, setPreviewToken } from "./api";
import type { SiteSettings, Page, Popup } from "./types";
import { parseSections, parseSocial } from "./types";
import { applyTheme } from "./theme";
import { HeadManager } from "./head";
import { SectionRenderer } from "./sections";
import { WhatsAppFab, PopupHost } from "./widgets";
import PoliciesPage from "./pages/policies";
import AppPrivacyPage from "./pages/appPrivacy";
import BookPage from "./pages/book";
import ScanMobilePage from "./pages/scan-mobile";
import QueueDisplay from "./pages/queue-display";

const BASE = import.meta.env.BASE_URL;
const ROUTER_BASE = BASE.replace(/\/$/, "");

function getPreviewToken(): string {
  return new URLSearchParams(window.location.search).get("preview_token") ?? "";
}

// ── Structured data (LocalBusiness + MedicalBusiness) ──
function StructuredData({ settings }: { settings: SiteSettings }) {
  useEffect(() => {
    const id = "site-structured-data";
    const old = document.getElementById(id);
    if (old) old.remove();

    const phone = settings.contactPhone || "9973497200";
    const name  = settings.siteTitle || "Care Diagnostics";
    const addr  = settings.address   || "CARE DIAGNOSTICS, Subhash Chowk, Castair's Town, Near Bajla Mahila College, Deoghar\u2013814112";
    const email = settings.contactEmail || "CARE.DEOGHAR@GMAIL.COM";

    const social = parseSocial(settings.socialLinks);
    const sameAs = Object.values(social).filter((u) => typeof u === "string" && /^https?:\/\//i.test(u));

    const schema = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": ["MedicalBusiness", "DiagnosticLab"],
          "@id": window.location.origin + "/#business",
          "name": name,
          "description": settings.seoMetaDescription || `${name} offers MRI, CT Scan, Ultrasound, Digital X-Ray, Pathology, ECG and health packages in Deoghar, Jharkhand.`,
          "url": window.location.origin,
          "telephone": "+" + phone.replace(/[^0-9]/g, ""),
          "email": email,
          "priceRange": "₹₹",
          ...(sameAs.length > 0 ? { "sameAs": sameAs } : {}),
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "Subhash Chowk, Castair's Town, Near Bajla Mahila College",
            "addressLocality": "Deoghar",
            "addressRegion": "Jharkhand",
            "postalCode": "814112",
            "addressCountry": "IN",
          },
          "geo": {
            "@type": "GeoCoordinates",
            "latitude": "24.4835",
            "longitude": "86.6985",
          },
          "openingHoursSpecification": [
            {
              "@type": "OpeningHoursSpecification",
              "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
              "opens": "07:00",
              "closes": "21:00",
            },
          ],
          "medicalSpecialty": [
            "Radiology", "Pathology", "Diagnostic Imaging",
          ],
          "availableService": [
            { "@type": "MedicalTest", "name": "MRI Scan" },
            { "@type": "MedicalTest", "name": "CT Scan" },
            { "@type": "MedicalTest", "name": "Ultrasound" },
            { "@type": "MedicalTest", "name": "Digital X-Ray" },
            { "@type": "MedicalTest", "name": "Pathology & Lab Tests" },
            { "@type": "MedicalTest", "name": "ECG" },
          ],
        },
      ],
    };

    const script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(schema, null, 0);
    document.head.appendChild(script);

    return () => { document.getElementById(id)?.remove(); };
  }, [settings]);

  return null;
}

// ── Mobile sticky CTA bar ──
function MobileCTABar({ settings }: { settings: SiteSettings }) {
  const phone  = settings.contactPhone || "9973497200";
  const waNum  = (settings.whatsappNumber || phone).replace(/[^0-9]/g, "");
  const waMsg  = encodeURIComponent(settings.whatsappGreeting || "Hi, I'd like to book a diagnostic test.");
  return (
    <div className="mobile-cta-bar" role="navigation" aria-label="Quick actions">
      <a href={`tel:${phone}`} className="mobile-cta-btn call" aria-label={`Call ${phone}`}>
        <Phone size={19} />
        <span className="mobile-cta-label">Call</span>
      </a>
      {waNum && (
        <a href={`https://wa.me/${waNum}?text=${waMsg}`} target="_blank" rel="noreferrer" className="mobile-cta-btn whatsapp" aria-label="Chat on WhatsApp">
          <MessageCircle size={19} />
          <span className="mobile-cta-label">WhatsApp</span>
        </a>
      )}
      <a href={`${BASE}book`} className="mobile-cta-btn book" aria-label="Book a test">
        <CalendarCheck size={19} />
        <span className="mobile-cta-label">Book Test</span>
      </a>
    </div>
  );
}

function PageView({ slug, settings, pages, popups, isPreview }: { slug: string; settings: SiteSettings; pages: Page[]; popups: Popup[]; isPreview: boolean }) {
  const page = useMemo(() => {
    const list = isPreview ? pages : pages.filter((p) => p.status === "published");
    if (slug === "home" && !list.some((p) => p.slug === "home")) {
      return list[0] ?? null;
    }
    const exact = list.find((p) => p.slug === slug);
    if (exact) return exact;
    return null;
  }, [pages, slug, isPreview]);

  if (!page) {
    return (
      <div className="cd-state-screen">
        <div>
          <h1 className="cd-display cd-h2">Page not found</h1>
          <p className="cd-section-sub" style={{ marginTop: ".5rem" }}>The page "/{slug}" doesn't exist or isn't published.</p>
          <a href={BASE} className="cd-btn-primary" style={{ marginTop: "1.25rem" }}>&larr; Home</a>
        </div>
      </div>
    );
  }
  const sections = parseSections(page.sections).filter((s) => s.enabled);
  const hasHeader = sections.some((s) => s.type === "header");
  const hasFooter = sections.some((s) => s.type === "footer");
  const defaultHeader = { id: "__auto_header", type: "header", enabled: true, config: {} } as const;
  const defaultFooter = { id: "__auto_footer", type: "footer", enabled: true, config: {} } as const;
  return (
    <>
      <HeadManager settings={settings} page={page} />
      {!hasHeader && <SectionRenderer section={defaultHeader} settings={settings} pages={pages} basePath={BASE} />}
      <main style={{ flex: "1 1 auto" }}>
        {sections.map((s) => (
          <SectionRenderer key={s.id} section={s} settings={settings} pages={pages} basePath={BASE} />
        ))}
      </main>
      {!hasFooter && <SectionRenderer section={defaultFooter} settings={settings} pages={pages} basePath={BASE} />}
      <PopupHost popups={popups} currentSlug={page.slug} basePath={BASE} />
    </>
  );
}

function PoliciesRoute({ settings }: { settings: SiteSettings }) {
  return <PoliciesPage settings={settings} />;
}

function AppShell({ settings, pages, popups, isPreview }: { settings: SiteSettings; pages: Page[]; popups: Popup[]; isPreview: boolean }) {
  const [loc] = useLocation();
  const slug = loc === "/" || loc === "" ? "home" : loc.replace(/^\//, "").split("/")[0];
  const roomKey = loc.startsWith("/queue/") ? loc.replace(/^\/queue\//, "").split("/")[0] : null;

  // Scroll to hash anchor — fires on mount AND whenever the hash changes.
  // Redirect #appointment → /book (legacy CMS section links).
  useEffect(() => {
    let tid: ReturnType<typeof setTimeout>;

    function scrollToHash() {
      clearTimeout(tid);
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) return;
      if (hash === "appointment") {
        window.location.href = `${BASE}book`;
        return;
      }
      // Retry a few times to handle lazy-loaded sections that aren't in the
      // DOM immediately when the hashchange fires.
      let attempts = 0;
      function tryScroll() {
        const el = document.getElementById(hash);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (attempts < 8) {
          attempts++;
          tid = setTimeout(tryScroll, 150);
        }
      }
      tid = setTimeout(tryScroll, 80);
    }

    scrollToHash(); // handle hash present on initial load
    window.addEventListener("hashchange", scrollToHash);
    return () => {
      clearTimeout(tid);
      window.removeEventListener("hashchange", scrollToHash);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (slug === "book" || slug === "appointment") {
    return (
      <>
        {isPreview && <div className="preview-banner">Preview mode — showing drafts. Visitors won't see this until you publish.</div>}
        <BookPage settings={settings} />
      </>
    );
  }

  if (slug === "policies") {
    return (
      <>
        {isPreview && <div className="preview-banner">Preview mode — showing drafts. Visitors won't see this until you publish.</div>}
        <PoliciesRoute settings={settings} />
      </>
    );
  }

  if (slug === "app-privacy") {
    return <AppPrivacyPage settings={settings} />;
  }

  if (slug === "scan-mobile") {
    return (
      <ScanMobilePage settings={settings} />
    );
  }

  if (slug === "queue") {
    if (roomKey) {
      return <QueueDisplay roomKey={roomKey} />;
    }
    return (
      <div className="cd-state-screen">
        <div>
          <h1 className="cd-display cd-h2">Queue Display</h1>
          <p className="cd-section-sub" style={{ marginTop: ".5rem" }}>Select a queue display room.</p>
          <a href={BASE} className="cd-btn-primary" style={{ marginTop: "1.25rem" }}>&larr; Home</a>
        </div>
      </div>
    );
  }

  if (slug === "home") {
    return (
      <>
        {isPreview && <div className="preview-banner">Preview mode — showing drafts. Visitors won't see this until you publish.</div>}
        <StructuredData settings={settings} />
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }} className={isPreview ? "pt-8" : ""}>
          <PageView slug={slug} settings={settings} pages={pages} popups={popups} isPreview={isPreview} />
          <WhatsAppFab settings={settings} />
          <MobileCTABar settings={settings} />
        </div>
      </>
    );
  }

  return (
    <>
      {isPreview && <div className="preview-banner">Preview mode — showing drafts. Visitors won't see this until you publish.</div>}
      <StructuredData settings={settings} />
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }} className={isPreview ? "pt-8" : ""}>
        <PageView slug={slug} settings={settings} pages={pages} popups={popups} isPreview={isPreview} />
        <WhatsAppFab settings={settings} />
        <MobileCTABar settings={settings} />
      </div>
    </>
  );
}

type PreviewState = "idle" | "verifying" | "valid" | "invalid";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  },
});

function App() {
  const [data, setData] = useState<{ settings: SiteSettings; pages: Page[]; popups: Popup[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");

  const previewToken = getPreviewToken();

  useEffect(() => {
    if (!previewToken) {
      setPreviewState("idle");
      return;
    }
    setPreviewState("verifying");
    api.verifyPreview(previewToken)
      .then((r) => setPreviewState(r.valid ? "valid" : "invalid"))
      .catch(() => setPreviewState("invalid"));
  }, [previewToken]);

  useEffect(() => {
    if (previewToken && previewState === "verifying") return;

    if (previewToken && previewState === "valid") {
      setPreviewToken(previewToken);
    }

    Promise.all([api.settings(), api.pages(), api.popups().catch(() => ({ popups: [] }))])
      .then(([settings, pageRes, popupRes]) => {
        applyTheme(settings);
        setData({ settings, pages: pageRes.pages || [], popups: popupRes.popups || [] });
      })
      .catch((e: Error) => setError(e.message));
  }, [previewToken, previewState]);

  const isPreview = previewState === "valid";

  if (previewToken && previewState === "verifying") {
    return (
      <div className="cd-state-screen-full">
        <div className="cd-section-sub" style={{ margin: 0 }}>Verifying preview access&hellip;</div>
      </div>
    );
  }

  if (previewToken && previewState === "invalid") {
    return (
      <div className="cd-state-screen-full">
        <div>
          <h1 className="cd-display cd-h2">Preview link expired</h1>
          <p className="cd-section-sub" style={{ maxWidth: 420 }}>
            This preview link is invalid or has expired. Please generate a new one from the Website Builder.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cd-state-screen">
        <h1 className="cd-display cd-h2">Site unavailable</h1>
        <p className="cd-section-sub">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="cd-state-screen-full">
        <div style={{ textAlign: "center" }}>
          <div className="cd-loading-sweep" style={{ width: 160, margin: "0 auto .85rem" }} />
          <div className="cd-section-sub" style={{ fontSize: ".9rem", margin: 0 }}>Loading Care Diagnostics&hellip;</div>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={ROUTER_BASE}>
        <AppShell settings={data.settings} pages={data.pages} popups={data.popups} isPreview={isPreview} />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
