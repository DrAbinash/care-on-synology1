import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Star, Facebook, Instagram, Twitter, Youtube, Linkedin, Menu, X as XIcon,
  Phone, MessageCircle, MapPin, Clock, Brain, Activity, Waves, Zap,
  TestTube, Heart, Package, Home as HomeIcon, Cpu, UserCheck, BadgeCheck,
  CalendarCheck, Sparkles, FileText, Shield, Award, ArrowRight, ChevronRight,
  Microscope, Scan, ChevronDown, Play,
} from "lucide-react";
import type { Section, SiteSettings, Page } from "./types";
import { parseSocial } from "./types";
import { buttonClass } from "./theme";
import { resolveAssetUrl } from "./config";

const SAFE_URL_RE = /^(https?:|mailto:|tel:|\/(?!\/)|#)/i;
function safeUrl(url: string, fallback = ""): string {
  if (!url) return fallback;
  const trimmed = url.trim();
  // Legacy CMS hash links to the old appointment section → rewrite to new /book page
  if (trimmed === "#appointment") return fallback || "book";
  return SAFE_URL_RE.test(trimmed) ? trimmed : fallback;
}
function absoluteUrl(url: string, basePath: string): string {
  if (!url) return "";
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  if (url.startsWith("/")) return `${basePath}${url.replace(/^\//, "")}`;
  return `${basePath}${url}`;
}
function get(c: Record<string, unknown>, k: string, fb = ""): string {
  return typeof c[k] === "string" ? (c[k] as string) : fb;
}
function getBool(c: Record<string, unknown>, k: string, fb = true): boolean {
  return typeof c[k] === "boolean" ? (c[k] as boolean) : fb;
}

const LazyAppointmentSection = lazy(() => import("./sections/AppointmentSection"));
const LazyFaqSection         = lazy(() => import("./sections/FaqSection"));
const LazyGallerySection     = lazy(() => import("./sections/GallerySection"));
const LazyCustomHtmlSection  = lazy(() => import("./sections/CustomHtmlSection"));
const LazyContactSection     = lazy(() => import("./sections/ContactSection"));

function SectionFallback() {
  return (
    <div style={{ minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 36, height: 36, borderRadius: 9999, border: "3px solid hsl(var(--site-primary) / .2)", borderTopColor: "hsl(var(--site-primary))", animation: "spin 1s linear infinite" }} />
    </div>
  );
}

// ───── HEADER ─────
export function HeaderSection({ section, settings, pages, basePath }: { section: Section; settings: SiteSettings; pages: Page[]; basePath: string }) {
  const c = section.config;
  const ctaLabel = get(c, "ctaLabel", "Book Test");
  const ctaUrl   = get(c, "ctaUrl", "book");
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navPages = pages.filter((p) => p.showInNav && p.status === "published");
  useEffect(() => { setOpen(false); }, [loc]);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const safeCta = safeUrl(ctaUrl, "book");
  const ctaHref = absoluteUrl(safeCta, basePath);
  const phone   = settings.contactPhone || "9973497200";
  const waNum   = (settings.whatsappNumber || phone).replace(/[^0-9]/g, "");
  const addr    = settings.address || "CARE DIAGNOSTICS, Subhash Chowk, Castair's Town, Deoghar";

  const TICKER_ITEMS = [
    "🏥 Mon–Sun 7 AM – 9 PM",
    `📍 ${addr}`,
    "✅ NABL Accredited Lab",
    "📊 Same-Day Reports Available",
    "🔬 200+ Diagnostic Tests",
    "🚗 Free Home Sample Collection",
  ];

  return (
    <>
      {/* Scrolling announcement ticker */}
      <div className="site-topbar" style={{ overflow: "hidden" }}>
        <div className="topbar-ticker-wrap">
          <div className="topbar-ticker-inner">
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
              <span key={i} className="topbar-ticker-item">{item}</span>
            ))}
          </div>
        </div>
        <div className="topbar-actions">
          <a href={`tel:${phone}`} className="topbar-action-link"><Phone size={11} /> {phone}</a>
          {waNum && (
            <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer" className="topbar-action-link" style={{ color: "#25d366" }}>
              <MessageCircle size={11} /> WhatsApp
            </a>
          )}
        </div>
      </div>

      {/* Main header */}
      <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
        <div className="container-narrow site-header-row">
          {/* Logo / brand */}
          <Link to="/" className="header-logo" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.6rem" }}>
            {settings.logoUrl
              ? <img src={resolveAssetUrl(settings.logoUrl)} alt={settings.siteTitle} style={{ height: 36, maxWidth: 160, objectFit: "contain" }} />
              : <>
                  <span style={{
                    width: 38, height: 38,
                    background: "linear-gradient(135deg, hsl(var(--site-primary)), #4f46e5)",
                    borderRadius: "12px",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    color: "white", flexShrink: 0,
                    boxShadow: "0 4px 14px hsl(var(--site-primary) / 0.3)",
                  }}>
                    <Microscope size={20} />
                  </span>
                  <span style={{ fontWeight: 800, letterSpacing: "-0.03em", fontSize: "1.3rem", color: "hsl(var(--site-fg))" }}>
                    Care<span style={{ color: "hsl(var(--site-primary))" }}>Diagnostics</span>
                  </span>
                </>
            }
          </Link>

          {/* Desktop nav */}
          <div className="header-right">
            {navPages.map((p) => (
              <Link key={p.id} to={p.slug === "home" ? "/" : `/${p.slug}`} className="header-nav-link">
                {p.title}
              </Link>
            ))}
            {waNum && (
              <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer" className="header-wa-link">
                <MessageCircle size={14} /> WhatsApp
              </a>
            )}
            {ctaLabel && (
              <a href={ctaHref} className="header-cta-book" style={{ marginLeft: ".5rem" }}>
                <CalendarCheck size={14} /> {ctaLabel}
              </a>
            )}
            <a href="/erp/portal" className="header-staff-login" style={{ marginLeft: ".5rem" }}>
              Staff Login
            </a>
          </div>

          {/* Mobile toggle */}
          <button
            className="nav-toggle"
            style={{ marginLeft: "auto" }}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <XIcon size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile dropdown */}
        {open && (
          <nav className="nav-mobile">
            <Link to="/" className="header-nav-link">Home</Link>
            {navPages.map((p) => (
              <Link key={p.id} to={p.slug === "home" ? "/" : `/${p.slug}`} className="header-nav-link">
                {p.title}
              </Link>
            ))}
            {ctaLabel && (
              <a href={ctaHref} className={buttonClass(settings, "primary")} style={{ justifyContent: "center", marginTop: ".5rem" }}>
                <CalendarCheck size={15} /> {ctaLabel}
              </a>
            )}
            {waNum && (
              <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer" className="header-nav-link" style={{ color: "#25d366" }}>
                <MessageCircle size={15} style={{ display: "inline", marginRight: 4 }} /> WhatsApp Us
              </a>
            )}
            <a href="/erp/portal" className="header-nav-link" style={{ opacity: .6, marginTop: ".25rem" }}>
              Staff Login
            </a>
          </nav>
        )}
      </header>
    </>
  );
}

// ───── HERO ─────
export function HeroSection({ section, settings, basePath }: { section: Section; settings: SiteSettings; basePath: string }) {
  const c = section.config;
  const heading    = get(c, "heading", "Advanced Diagnostics.\nAccurate Reports.\nTrusted Care.");
  const subheading = get(c, "subheading", "MRI, CT, Ultrasound, Digital X-Ray, Pathology and Health Packages — delivered with precision, compassion and fast reporting at Care Diagnostics, Deoghar.");
  const ctaLabel   = get(c, "ctaLabel", "Book Test Online");
  const ctaUrl     = get(c, "ctaUrl",   "book");
  const imageUrl   = get(c, "imageUrl");
  const phone      = settings.contactPhone || "9973497200";
  const waNum      = (settings.whatsappNumber || phone).replace(/[^0-9]/g, "");

  const safeCta = safeUrl(ctaUrl, "book");
  const ctaHref = absoluteUrl(safeCta, basePath);

  // Premium high-quality Unsplash healthcare images as hero backgrounds
  const HERO_IMAGES = [
    "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=1800&q=85&auto=format",
    "https://images.unsplash.com/photo-1551190822-a9333d879b1f?w=1800&q=85&auto=format",
    "https://images.unsplash.com/photo-1538108149393-fbbd81895907?w=1800&q=85&auto=format",
  ];
  const [imgIdx, setImgIdx] = useState(0);
  const [imgFading, setImgFading] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      setImgFading(true);
      setTimeout(() => { setImgIdx(i => (i + 1) % HERO_IMAGES.length); setImgFading(false); }, 600);
    }, 6000);
    return () => clearInterval(t);
  }, []);

  const heroImg = imageUrl
    ? resolveAssetUrl(imageUrl)
    : HERO_IMAGES[imgIdx];

  // Animated stat counters
  const STATS = [
    { target: 10000, suffix: "+", label: "Patients Served" },
    { target: 200, suffix: "+", label: "Tests & Services" },
    { target: 15, suffix: "+ yrs", label: "Of Excellence" },
    { target: 24, suffix: "h", label: "Report Delivery" },
  ];
  const [counts, setCounts] = useState(STATS.map(() => 0));
  const countRef = useRef(false);
  useEffect(() => {
    if (countRef.current) return;
    countRef.current = true;
    STATS.forEach((s, i) => {
      const steps = 50;
      const stepMs = 1400 / steps;
      let step = 0;
      const t = setInterval(() => {
        step++;
        const v = Math.round(s.target * (step / steps));
        setCounts(prev => { const n = [...prev]; n[i] = v; return n; });
        if (step >= steps) clearInterval(t);
      }, stepMs);
    });
  }, []);

  const badges = [
    { icon: <Brain size={13} />, label: "3 Tesla MRI" },
    { icon: <Activity size={13} />, label: "CT Imaging" },
    { icon: <TestTube size={13} />, label: "Pathology Lab" },
    { icon: <BadgeCheck size={13} />, label: "Same-Day Reports" },
    { icon: <HomeIcon size={13} />, label: "Home Collection" },
  ];

  const headingLines = heading.split("\n");

  return (
    <section className="hero-section">
      {/* BG image with crossfade */}
      <div
        className="hero-gradient-bg"
        style={{
          background: `linear-gradient(160deg, rgba(7,21,60,.82) 0%, rgba(15,52,96,.75) 50%, rgba(0,0,0,.65) 100%), url(${heroImg}) center/cover`,
          transition: "opacity .6s",
          opacity: imgFading ? 0.4 : 1,
        }}
      />
      {/* Subtle animated mesh overlay */}
      <div className="hero-mesh-overlay" />
      <div className="hero-grid-overlay" />

      <div className="hero-content">
        <div className="hero-inner">
          {/* Left text */}
          <div className="hero-text-col anim-left">
            <div className="hero-eyebrow">
              <span className="hero-eyebrow-dot" />
              <Microscope size={13} />
              Care Diagnostics · Deoghar, Jharkhand
            </div>

            <h1 className="hero-heading">
              {headingLines.map((line, i) => (
                <span key={i} style={{ display: "block", animationDelay: `${i * 0.12}s` }} className="hero-heading-line">
                  {i === 0 ? line : <span className="hero-heading-accent">{line}</span>}
                </span>
              ))}
            </h1>

            <p className="hero-subheading">{subheading}</p>

            <div className="hero-ctas">
              <a href={ctaHref} className="hero-cta-primary">
                <CalendarCheck size={18} />
                {ctaLabel}
              </a>
              <a href={`tel:${phone}`} className="hero-cta-secondary">
                <Phone size={18} />
                Call Now
              </a>
              {waNum && (
                <a href={`https://wa.me/${waNum}?text=${encodeURIComponent("Hi, I'd like to book a diagnostic test.")}`}
                   target="_blank" rel="noreferrer" className="hero-cta-wa">
                  <MessageCircle size={18} />
                </a>
              )}
            </div>

            <div className="hero-badges">
              {badges.map((b, i) => (
                <span key={i} className="hero-badge" style={{ animationDelay: `${0.3 + i * 0.07}s` }}>
                  {b.icon} {b.label}
                </span>
              ))}
            </div>

            {/* Stat counters */}
            <div className="hero-stats-row">
              {STATS.map((s, i) => (
                <div key={i} className="hero-stat">
                  <span className="hero-stat-num">{counts[i].toLocaleString()}{s.suffix}</span>
                  <span className="hero-stat-label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right image (desktop) */}
          <div className="hero-image-col anim-right">
            <div className="hero-img-frame">
              <img
                src={heroImg}
                alt="Care Diagnostics — modern diagnostic center"
                className="hero-main-img"
                loading="eager"
                style={{ transition: "opacity .6s", opacity: imgFading ? 0.5 : 1 }}
              />
              {/* Image slide indicators */}
              <div className="hero-img-dots">
                {HERO_IMAGES.map((_, i) => (
                  <button key={i} onClick={() => setImgIdx(i)}
                    style={{ width: i === imgIdx ? 24 : 8, height: 8, borderRadius: 9999, background: i === imgIdx ? "white" : "rgba(255,255,255,.4)", border: "none", cursor: "pointer", transition: "all .3s", padding: 0 }}
                  />
                ))}
              </div>
            </div>
            <div className="hero-float-card pos-tl">
              <div className="hero-float-dot" />
              MRI · CT · USG
            </div>
            <div className="hero-float-card pos-tr">
              <BadgeCheck size={14} style={{ color: "#22c55e" }} />
              Same-Day Reports
            </div>
            <div className="hero-float-card pos-bl">
              <HomeIcon size={14} style={{ color: "hsl(var(--site-primary))" }} />
              Home Collection
            </div>
            <div className="hero-float-card pos-br">
              <CalendarCheck size={14} style={{ color: "#7c3aed" }} />
              Online Booking
            </div>
          </div>
        </div>

        {/* Mobile hero image */}
        <div style={{ maxWidth: 1120, margin: "2rem auto 0" }}>
          <img
            src={heroImg}
            alt="Care Diagnostics"
            className="hero-mobile-img"
            loading="eager"
          />
        </div>
      </div>

      {/* Scroll indicator */}
      <a href="#services" className="hero-scroll-indicator" aria-label="Scroll down">
        <ChevronDown size={22} />
      </a>
    </section>
  );
}

// ───── STATS STRIP ─────
export function StatsSection({ section }: { section: Section }) {
  const c = section.config;
  const defaultStats = [
    { num: "10,000+", label: "Patients Served" },
    { num: "15+", label: "Years of Service" },
    { num: "50+", label: "Diagnostic Tests" },
    { num: "24h", label: "Report Turnaround" },
  ];
  const items = Array.isArray(c.items) && c.items.length > 0
    ? (c.items as Array<{ num: string; label: string }>)
    : defaultStats;
  return (
    <div className="stats-strip">
      <div className="stats-grid">
        {items.map((it, i) => (
          <div key={i} className="stat-item">
            <div className="stat-num">{it.num}</div>
            <div className="stat-label">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───── SERVICES ─────
const SERVICE_ICONS: Record<string, React.ReactNode> = {
  "mri":       <Brain size={22} />,
  "ct":        <Scan size={22} />,
  "ultrasound":<Waves size={22} />,
  "xray":      <Zap size={22} />,
  "pathology": <TestTube size={22} />,
  "ecg":       <Heart size={22} />,
  "packages":  <Package size={22} />,
  "home":      <HomeIcon size={22} />,
};
function getServiceIcon(title: string): React.ReactNode {
  const t = title.toLowerCase();
  if (t.includes("mri"))       return SERVICE_ICONS.mri;
  if (t.includes("ct"))        return SERVICE_ICONS.ct;
  if (t.includes("ultrasound") || t.includes("doppler") || t.includes("usg")) return SERVICE_ICONS.ultrasound;
  if (t.includes("x-ray") || t.includes("xray") || t.includes("x ray"))  return SERVICE_ICONS.xray;
  if (t.includes("pathology") || t.includes("lab")) return SERVICE_ICONS.pathology;
  if (t.includes("ecg") || t.includes("eeg") || t.includes("cardiac"))   return SERVICE_ICONS.ecg;
  if (t.includes("package"))   return SERVICE_ICONS.packages;
  if (t.includes("home"))      return SERVICE_ICONS.home;
  return <Activity size={22} />;
}

const DEFAULT_SERVICES = [
  { title: "MRI Scan",             desc: "High-resolution MRI imaging for brain, spine, joints and whole-body screening with expert radiologist reporting.", category: "Radiology", price: "Starts from ₹6,500" },
  { title: "CT Scan",              desc: "Fast, accurate CT imaging for trauma, chest, abdomen, brain and emergency diagnostic evaluation.", category: "Radiology", price: "Starts from ₹3,000" },
  { title: "Ultrasound & Doppler", desc: "Pregnancy scans, abdomen, pelvis, thyroid, scrotal, soft tissue and vascular Doppler studies.", category: "Radiology", price: "Starts from ₹1,200" },
  { title: "Digital X-Ray",        desc: "Quick digital radiography with clear high-resolution images and rapid turnaround for all body parts.", category: "Radiology", price: "Starts from ₹400" },
  { title: "Pathology Lab",        desc: "Complete blood, urine, biochemistry, haematology and routine investigations with reliable, accurate reporting.", category: "Pathology", price: "Starts from ₹150" },
  { title: "ECG / EEG / TMT",      desc: "Cardiac and neuro-diagnostic testing supported by trained technicians and physician review.", category: "Cardiology & Neuro", price: "Starts from ₹400" },
  { title: "Health Packages",      desc: "Preventive health checkup packages for diabetes, heart, liver, kidney and complete body screening.", category: "Preventive Health Packages", price: "Starts from ₹999" },
  { title: "Home Collection",      desc: "Convenient blood and urine sample collection from your home with digital report delivery.", category: "Preventive Health Packages", price: "Free Sample Pickup" },
];

function getServiceImage(title: string, basePath: string): string {
  const t = title.toLowerCase();
  if (t.includes("mri")) return `${basePath}assets/images/ct-scan.jpg`;
  if (t.includes("ct")) return `${basePath}assets/images/ct-scan.jpg`;
  if (t.includes("ultrasound") || t.includes("usg")) return `${basePath}assets/images/ultrasound.jpg`;
  if (t.includes("pathology") || t.includes("lab")) return `${basePath}assets/images/pathology-lab.jpg`;
  if (t.includes("consult") || t.includes("doctor")) return `${basePath}assets/images/doctor-consult.jpg`;
  return `${basePath}assets/images/reception.jpg`;
}

export function ServicesSection({ section, basePath = "/" }: { section: Section; basePath?: string }) {
  const c       = section.config;
  const heading = get(c, "heading", "Complete Diagnostic Services Under One Roof");
  const sub     = get(c, "subheading", "From advanced imaging to routine pathology, Care Diagnostics provides reliable testing with modern equipment and patient-friendly workflow.");
  const items   = Array.isArray(c.items) && c.items.length > 0
    ? (c.items as Array<{ title: string; desc: string; category?: string; price?: string }>)
    : DEFAULT_SERVICES;

  const [activeTab, setActiveTab] = useState("All");

  const categories = ["All", "Radiology", "Pathology", "Cardiology & Neuro", "Preventive Health Packages"];

  const filteredItems = activeTab === "All"
    ? items
    : items.filter(it => (it.category || "Radiology") === activeTab);

  return (
    <section className="section" id="services">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.5rem" }}>
          <div className="section-eyebrow"><Activity size={13} /> Our Services</div>
          <h2 className="h-section" style={{ marginBottom: ".6rem" }}>{heading}</h2>
          {sub && <p className="subtle" style={{ maxWidth: 620, margin: "0 auto", lineHeight: 1.7 }}>{sub}</p>}
        </div>

        {/* Dynamic Category Tabs */}
        <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", justifyContent: "center", marginBottom: "2.5rem" }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              style={{
                padding: ".55rem 1.35rem",
                borderRadius: 9999,
                fontSize: ".85rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: activeTab === cat ? "linear-gradient(135deg, hsl(var(--site-primary)), hsl(var(--site-primary) / 0.85))" : "hsl(var(--site-muted))",
                color: activeTab === cat ? "white" : "hsl(var(--site-fg))",
                boxShadow: activeTab === cat ? "0 4px 14px hsl(var(--site-primary) / 0.25)" : "none",
                transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                transform: activeTab === cat ? "scale(1.03)" : "scale(1)",
              }}
              className="service-tab-btn"
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="services-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.5rem" }}>
          {filteredItems.map((it, i) => {
            const serviceImg = getServiceImage(it.title, basePath);
            const fallbackUnsplash = "https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=600&q=80";
            return (
              <div key={i} className="service-card" style={{ display: "flex", flexDirection: "column", height: "100%", padding: 0, overflow: "hidden" }}>
                <div style={{ position: "relative", height: "180px", overflow: "hidden" }}>
                  <img
                    src={serviceImg}
                    alt={it.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = fallbackUnsplash;
                    }}
                  />
                  <div style={{ position: "absolute", top: "10px", right: "10px", background: "hsl(var(--site-primary))", color: "white", padding: "0.25rem 0.65rem", borderRadius: "9999px", fontSize: "0.75rem", fontWeight: 700 }}>
                    {it.category || "Radiology"}
                  </div>
                </div>
                <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", flex: 1 }}>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem" }}>{it.title}</h3>
                  <p style={{ fontSize: "0.85rem", color: "hsl(var(--site-muted-fg))", lineHeight: "1.6", flex: 1, marginBottom: "1rem" }}>{it.desc}</p>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid hsl(var(--site-border))", paddingTop: "0.85rem", marginTop: "auto" }}>
                    <span style={{ fontWeight: 800, color: "hsl(var(--site-primary))", fontSize: "0.95rem" }}>
                      {it.price || "Contact Us"}
                    </span>
                    <a href={`${basePath}book`} className="btn-primary" style={{ padding: "0.45rem 1rem", fontSize: "0.8rem", borderRadius: "9999px" }}>
                      Book Now
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ───── WHY CHOOSE US ─────
const DEFAULT_WHY = [
  { icon: <Cpu size={18} />,         title: "Modern Equipment",      desc: "3 Tesla MRI, multi-slice CT and advanced digital imaging systems." },
  { icon: <UserCheck size={18} />,   title: "Experienced Doctors",   desc: "Senior radiologists and pathologists with decades of diagnostic expertise." },
  { icon: <Clock size={18} />,       title: "Fast Report Delivery",  desc: "Same-day pathology and within 24 hours for most imaging studies." },
  { icon: <BadgeCheck size={18} />,  title: "Transparent Pricing",   desc: "No hidden charges. Clear pricing for all tests and packages upfront." },
  { icon: <CalendarCheck size={18} />,title: "Online Booking",       desc: "Book tests online, choose your time slot and pay securely." },
  { icon: <MessageCircle size={18} />,title: "WhatsApp Assistance",  desc: "Quick query resolution and report sharing via WhatsApp." },
  { icon: <Sparkles size={18} />,    title: "Clean, Safe Environment",desc: "Patient-friendly center with strict hygiene and infection control protocols." },
  { icon: <FileText size={18} />,    title: "Digital Records",       desc: "Access your past reports anytime through our secure patient portal." },
];

export function WhyChooseUsSection({ section }: { section: Section }) {
  const c = section.config;
  const heading = get(c, "heading", "Why Patients Trust Care Diagnostics");
  const sub     = get(c, "subheading", "Built for accuracy, speed and compassionate patient care.");
  const items   = Array.isArray(c.items) && c.items.length > 0
    ? (c.items as Array<{ title: string; desc: string }>).map((it, i) => ({ ...it, icon: DEFAULT_WHY[i]?.icon ?? <Shield size={18} /> }))
    : DEFAULT_WHY;
  return (
    <section className="section muted-bg">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.5rem" }}>
          <div className="section-eyebrow"><Award size={13} /> Why Choose Us</div>
          <h2 className="h-section" style={{ marginBottom: ".6rem" }}>{heading}</h2>
          {sub && <p className="subtle" style={{ maxWidth: 520, margin: "0 auto" }}>{sub}</p>}
        </div>
        <div className="why-grid">
          {items.map((it, i) => (
            <div key={i} className="why-card">
              <div className="why-icon" aria-hidden="true">{it.icon}</div>
              <div>
                <h3>{it.title}</h3>
                <p>{it.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───── TECHNOLOGY ─────
const TECH_ITEMS = [
  {
    title: "3 Tesla MRI",
    desc: "Ultra-high-field imaging for brain, spine and MSK studies with expert radiologist reporting.",
    img: "https://images.unsplash.com/photo-1530026186672-2cd00ffc50fe?w=700&q=85&auto=format",
    icon: <Brain size={17} />,
    color: "#3b82f6",
  },
  {
    title: "Multi-Slice CT",
    desc: "Rapid, high-definition CT imaging for complex diagnostics and emergency evaluation.",
    img: "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=700&q=85&auto=format",
    icon: <Scan size={17} />,
    color: "#8b5cf6",
  },
  {
    title: "Digital X-Ray",
    desc: "Instant high-resolution radiography with minimal radiation dose and rapid turnaround.",
    img: "https://images.unsplash.com/photo-1504439468489-c8920d796a29?w=700&q=85&auto=format",
    icon: <Zap size={17} />,
    color: "#f59e0b",
  },
  {
    title: "Ultrasound & Doppler",
    desc: "Real-time imaging for obstetric, abdominal, thyroid and vascular Doppler studies.",
    img: "https://images.unsplash.com/photo-1576669801820-a9ab287ac2f7?w=700&q=85&auto=format",
    icon: <Waves size={17} />,
    color: "#10b981",
  },
  {
    title: "Automated Pathology",
    desc: "High-throughput analysers for accurate blood, urine and biochemistry lab investigations.",
    img: "https://images.unsplash.com/photo-1578496479763-c21ef1a49cf7?w=700&q=85&auto=format",
    icon: <Microscope size={17} />,
    color: "#ec4899",
  },
  {
    title: "Online Report Access",
    desc: "Secure digital delivery of reports to patients and referring doctors instantly.",
    img: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=700&q=85&auto=format",
    icon: <FileText size={17} />,
    color: "#06b6d4",
  },
];

export function TechnologySection({ section }: { section: Section }) {
  const c = section.config;
  const heading = get(c, "heading", "Advanced Technology for Accurate Diagnosis");
  const sub     = get(c, "subheading", "High-quality imaging and lab workflow designed to support confident clinical decisions.");
  return (
    <section className="section" style={{ background: "linear-gradient(180deg, hsl(var(--site-muted)) 0%, hsl(var(--site-bg)) 100%)" }}>
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.5rem" }}>
          <div className="section-eyebrow"><Cpu size={13} /> Our Technology</div>
          <h2 className="h-section" style={{ marginBottom: ".6rem" }}>{heading}</h2>
          {sub && <p className="subtle" style={{ maxWidth: 560, margin: "0 auto", lineHeight: 1.7 }}>{sub}</p>}
        </div>
        <div className="tech-grid">
          {TECH_ITEMS.map((it, i) => (
            <div key={i} className="tech-card">
              <img
                src={it.img}
                alt={it.title}
                className="tech-img"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=700&q=80"; }}
              />
              <div className="tech-icon-badge" aria-hidden="true" style={{ background: it.color }}>{it.icon}</div>
              <div className="tech-overlay">
                <h3>{it.title}</h3>
                <p>{it.desc}</p>
                <div style={{ marginTop: ".65rem" }}>
                  <span style={{ fontSize: ".75rem", background: "rgba(255,255,255,.18)", padding: ".2rem .7rem", borderRadius: 9999, fontWeight: 600 }}>
                    Learn More →
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───── HEALTH PACKAGES ─────
const DEFAULT_PKGS = [
  {
    name: "Basic Health Checkup",
    includes: ["CBC (Blood Count)", "Fasting Blood Sugar", "Liver Function (LFT)", "Kidney Function (KFT)", "Lipid Profile"],
    featured: false,
    badge: "",
  },
  {
    name: "Diabetes Care Package",
    includes: ["Fasting & PP Sugar", "HbA1c (3-month avg)", "Kidney Function (KFT)", "Urine Routine & Microscopy"],
    featured: false,
    badge: "Popular",
  },
  {
    name: "Senior Citizen Package",
    includes: ["CBC", "Blood Sugar", "Kidney Function", "Liver Function", "Lipid Profile", "ECG"],
    featured: true,
    badge: "Best Value",
  },
  {
    name: "Heart Care Package",
    includes: ["Lipid Profile", "ECG", "Fasting Blood Sugar", "Kidney Function (KFT)"],
    featured: false,
    badge: "",
  },
  {
    name: "Women's Health Package",
    includes: ["CBC", "Thyroid (T3, T4, TSH)", "Vitamin D", "Calcium", "Urine Routine"],
    featured: false,
    badge: "Recommended",
  },
  {
    name: "Full Body Screening",
    includes: ["CBC", "Liver Function", "Kidney Function", "Lipid Profile", "Thyroid Profile", "Urine Routine", "ECG"],
    featured: false,
    badge: "Comprehensive",
  },
];

export function HealthPackagesSection({ section, basePath }: { section: Section; basePath: string }) {
  const c = section.config;
  const heading  = get(c, "heading", "Popular Health Packages");
  const sub      = get(c, "subheading", "Preventive packages designed for families, senior citizens and chronic disease monitoring.");
  const bookHref = `${basePath}book`;

  return (
    <section className="section muted-bg">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.5rem" }}>
          <div className="section-eyebrow"><Package size={13} /> Health Packages</div>
          <h2 className="h-section" style={{ marginBottom: ".6rem" }}>{heading}</h2>
          {sub && <p className="subtle" style={{ maxWidth: 560, margin: "0 auto" }}>{sub}</p>}
        </div>
        <div className="pkg-grid">
          {DEFAULT_PKGS.map((pkg, i) => (
            <div key={i} className={`pkg-card${pkg.featured ? " featured" : ""}`}>
              {pkg.badge && <span className="pkg-badge">{pkg.badge}</span>}
              <div className="pkg-icon" aria-hidden="true"><Package size={22} /></div>
              <h3>{pkg.name}</h3>
              <ul className="pkg-includes">
                {pkg.includes.map((item, j) => <li key={j}>{item}</li>)}
              </ul>
              <a href={bookHref} className="btn-primary" style={{ justifyContent: "center", width: "100%", borderRadius: 9999 }}>
                Book Now <ArrowRight size={15} />
              </a>
            </div>
          ))}
        </div>
        <p className="subtle text-center" style={{ fontSize: ".85rem", marginTop: "1.5rem" }}>
          Prices available at the center. Call <a href="tel:9973497200" style={{ color: "hsl(var(--site-primary))", fontWeight: 600 }}>9973497200</a> or WhatsApp for current offers.
        </p>
      </div>
    </section>
  );
}

// ───── REVIEWS ─────
const DEFAULT_REVIEWS = [
  { name: "Priya Sharma",    rating: 5, text: "Very clean center and the staff behaviour was excellent throughout my visit. MRI report was delivered quickly — same day. Highly recommend.", location: "Deoghar" },
  { name: "Rajesh Kumar",    rating: 5, text: "Online booking was very easy and the team guided us properly on WhatsApp. No waiting time at all. Great diagnostic facility.", location: "Deoghar" },
  { name: "Anjali Devi",     rating: 5, text: "Good diagnostic facility in Deoghar with professional reporting. The radiologist reviewed my CT scan and explained it clearly.", location: "Jasidih" },
  { name: "Suresh Yadav",    rating: 5, text: "Pathology and ultrasound services were smooth and well organized. The staff was courteous and the waiting area was comfortable.", location: "Deoghar" },
  { name: "Meena Agarwal",   rating: 5, text: "Reception team was extremely helpful and my test reports came much faster than expected. Will definitely visit again for my next checkup.", location: "Dumka" },
];

export function ReviewsSection({ section }: { section: Section }) {
  const c       = section.config;
  const heading = get(c, "heading", "What Our Patients Say");
  const sub     = get(c, "subheading", "Trusted by thousands of patients across Deoghar and Jharkhand.");
  const items   = Array.isArray(c.items) && c.items.length > 0
    ? (c.items as Array<{ name: string; rating: number; text: string; location?: string }>)
    : DEFAULT_REVIEWS;
  return (
    <section className="section muted-bg">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.5rem" }}>
          <div className="section-eyebrow"><Star size={13} /> Patient Reviews</div>
          <h2 className="h-section" style={{ marginBottom: ".6rem" }}>{heading}</h2>
          {sub && <p className="subtle" style={{ maxWidth: 480, margin: "0 auto" }}>{sub}</p>}
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {items.map((it, i) => (
            <div key={i} className="review-card">
              <div className="review-quote-mark" aria-hidden="true">"</div>
              <div className="review-stars" aria-label={`${it.rating} out of 5 stars`}>
                {Array.from({ length: Math.max(0, Math.min(5, Number(it.rating) || 5)) }).map((_, j) => (
                  <Star key={j} size={16} fill="currentColor" />
                ))}
              </div>
              <p className="review-text">"{it.text}"</p>
              <div className="review-author">— {it.name}</div>
              {(it.location || DEFAULT_REVIEWS[i]?.location) && (
                <div className="review-location">
                  <MapPin size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />
                  {it.location || DEFAULT_REVIEWS[i]?.location}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───── CONNECT ─────
export function ConnectSection({ section, settings }: { section: Section; settings: SiteSettings }) {
  const heading = get(section.config, "heading", "Connect With Care Diagnostics");
  const sub     = get(section.config, "subheading", "Follow us for health tips, diagnostic awareness and service announcements.");
  const social  = parseSocial(settings.socialLinks);
  const items: Array<[string, React.ReactNode, string]> = [
    ["facebook",  <Facebook  size={22} key="f" />, "#3b5998"],
    ["instagram", <Instagram size={22} key="i" />, "#e1306c"],
    ["twitter",   <Twitter   size={22} key="t" />, "#1da1f2"],
    ["youtube",   <Youtube   size={22} key="y" />, "#ff0000"],
    ["linkedin",  <Linkedin  size={22} key="l" />, "#0077b5"],
  ];
  const active = items.filter(([k]) => social[k] && safeUrl(social[k]));
  return (
    <section className="section">
      <div className="container-narrow text-center">
        <div className="section-eyebrow" style={{ display: "inline-flex", marginBottom: ".85rem" }}><MessageCircle size={13} /> Social Media</div>
        <h2 className="h-section" style={{ marginBottom: ".6rem" }}>{heading}</h2>
        {sub && <p className="subtle" style={{ marginBottom: "1.75rem", maxWidth: 420, margin: "0 auto 1.75rem" }}>{sub}</p>}
        <div className="connect-social">
          {active.length > 0
            ? active.map(([k, icon]) => (
                <a key={k} href={safeUrl(social[k])} target="_blank" rel="noreferrer" className="connect-btn" aria-label={k}>
                  {icon}
                </a>
              ))
            : <span className="subtle" style={{ fontSize: ".9rem" }}>Follow us on social media — links coming soon.</span>}
        </div>
      </div>
    </section>
  );
}

// ───── SUBSCRIBE ─────
export function SubscribeSection({ section, settings }: { section: Section; settings: SiteSettings }) {
  const c = section.config;
  const heading     = get(c, "heading", "Get Health Tips & Updates");
  const subheading  = get(c, "subheading", "Subscribe to our newsletter for diagnostic health tips, package offers and appointment reminders.");
  const placeholder = get(c, "placeholder", "your@email.com");
  const submitLabel = get(c, "submitLabel", "Subscribe");
  const [done, setDone] = useState(false);
  return (
    <section className="section" style={{ background: "linear-gradient(135deg, hsl(var(--site-primary) / .06), hsl(var(--site-primary) / .02))" }}>
      <div className="container-narrow text-center" style={{ maxWidth: 560 }}>
        <div className="section-eyebrow" style={{ display: "inline-flex", marginBottom: ".85rem" }}><Award size={13} /> Newsletter</div>
        <h2 className="h-section">{heading}</h2>
        {subheading && <p className="subtle" style={{ marginTop: ".5rem", marginBottom: "1.5rem", lineHeight: 1.7 }}>{subheading}</p>}
        {done ? (
          <div className="card-soft" style={{ marginTop: "1rem", display: "inline-flex", alignItems: "center", gap: ".5rem", color: "#22c55e", fontWeight: 600 }}>
            <BadgeCheck size={20} /> Thanks for subscribing!
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setDone(true); }}
                style={{ display: "flex", gap: ".5rem", marginTop: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
            <input className="input-soft" type="email" required placeholder={placeholder} style={{ flex: "1 1 240px", minWidth: 0 }} />
            <button type="submit" className={buttonClass(settings, "primary")}>{submitLabel}</button>
          </form>
        )}
      </div>
    </section>
  );
}

// ───── FOOTER ─────
export function FooterSection({ section, settings, basePath }: { section: Section; settings: SiteSettings; basePath: string }) {
  const c = section.config;
  const customText = get(c, "text");
  const extraLinks = Array.isArray(c.links) ? (c.links as Array<{ label: string; url: string }>) : [];
  const year      = new Date().getFullYear();
  const siteName  = settings.siteTitle || "Care Diagnostics";
  const phone     = settings.contactPhone || "9973497200";
  const email     = settings.contactEmail || "CARE.DEOGHAR@GMAIL.COM";
  const addr      = settings.address || "CARE DIAGNOSTICS, Subhash Chowk, Castair's Town, Near Bajla Mahila College, Deoghar\u2013814112";
  const regAddr   = settings.registeredAddress || "Jayshankar Bhawan, Bilasi Town, Deoghar, Ward No. 27, Hiralal Pal Road, Deoghar, Jharkhand \u2013 814112";
  const waNum     = (settings.whatsappNumber || phone).replace(/[^0-9]/g, "");
  const social    = parseSocial(settings.socialLinks);
  const svcLinks  = Array.isArray(c.services) ? (c.services as Array<{ label: string; url: string }>) : [];

  const socialIcons: Array<[string, React.ReactNode]> = [
    ["facebook",  <Facebook  size={16} key="f" />],
    ["instagram", <Instagram size={16} key="i" />],
    ["twitter",   <Twitter   size={16} key="t" />],
    ["youtube",   <Youtube   size={16} key="y" />],
    ["linkedin",  <Linkedin  size={16} key="l" />],
  ];

  const defaultServices = [
    "MRI Scan", "CT Scan", "Ultrasound & Doppler", "Digital X-Ray",
    "Pathology Lab", "ECG / EEG", "Health Packages", "Home Collection",
  ];
  const defaultQuickLinks = [
    { label: "Book Appointment", href: `${basePath}book` },
    { label: "Health Packages",  href: `${basePath}#packages` },
    { label: "Gallery",          href: `${basePath}#gallery` },
    { label: "FAQ",              href: `${basePath}#faq` },
    { label: "Contact Us",       href: `${basePath}#contact` },
    { label: "Patient Portal",   href: `${basePath}erp/portal` },
    { label: "Staff Login",      href: `${basePath}erp/portal` },
  ];
  const defaultPolicyLinks = [
    { label: "Privacy Policy",       href: "/policies" },
    { label: "Terms & Conditions",   href: "/policies" },
    { label: "Refund Policy",        href: "/policies" },
    { label: "Cancellation Policy",  href: "/policies" },
  ];

  return (
    <footer className="premium-footer">
      <div className="footer-grid">
        {/* About */}
        <div className="footer-col">
          <div className="footer-brand">
            <Microscope size={18} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
            {siteName.split(" ").map((w, i) => i === 0 ? <span key={i}>{w} </span> : <span key={i} style={{ color: "hsl(var(--site-primary) / .8)", filter: "brightness(2)" }}>{w} </span>)}
          </div>
          <p className="footer-about">
            {settings.about || `${siteName} is a premier diagnostic center in Deoghar, Jharkhand, offering MRI, CT, Ultrasound, Pathology and comprehensive health packages with same-day reporting.`}
          </p>
          <div className="footer-social">
            {socialIcons.filter(([k]) => social[k] && safeUrl(social[k])).map(([k, icon]) => (
              <a key={k} href={safeUrl(social[k])} target="_blank" rel="noreferrer" className="footer-social-btn" aria-label={k}>
                {icon}
              </a>
            ))}
          </div>
        </div>

        {/* Services */}
        <div className="footer-col">
          <div className="footer-col-title">Services</div>
          <ul className="footer-links">
            {(svcLinks.length > 0 ? svcLinks.map((s) => s.label) : defaultServices).map((svc, i) => (
              <li key={i}><a href="#services"><ChevronRight size={13} style={{ display: "inline", verticalAlign: "middle", opacity: .5 }} /> {svc}</a></li>
            ))}
          </ul>
        </div>

        {/* Quick Links */}
        <div className="footer-col">
          <div className="footer-col-title">Quick Links</div>
          <ul className="footer-links">
            {defaultQuickLinks.map((l, i) => {
              const href = l.href.startsWith("/") ? l.href : `${basePath}${l.href.replace(/^#/, "")}`.replace(/\/+/, "/");
              return (
                <li key={i}>
                  <a href={l.href.startsWith("http") || l.href.startsWith("/erp") ? l.href : l.href}>
                    <ChevronRight size={13} style={{ display: "inline", verticalAlign: "middle", opacity: .5 }} /> {l.label}
                  </a>
                </li>
              );
            })}
            {extraLinks.map((l, i) => {
              const s = safeUrl(l.url, "#");
              const href = s.startsWith("/") ? `${basePath}${s.replace(/^\//, "")}` : s;
              return <li key={`e${i}`}><a href={href}><ChevronRight size={13} style={{ display: "inline", verticalAlign: "middle", opacity: .5 }} /> {l.label}</a></li>;
            })}
          </ul>
        </div>

        {/* Contact */}
        <div className="footer-col">
          <div className="footer-col-title">Contact Us</div>
          <div className="footer-contact-row">
            <MapPin size={14} />
            <span>{addr}</span>
          </div>
          <div className="footer-contact-row" style={{ fontSize: ".75rem", opacity: .75 }}>
            <span style={{ marginLeft: 20 }}>Reg: {regAddr}</span>
          </div>
          <div className="footer-contact-row">
            <Phone size={14} />
            <a href={`tel:${phone}`}>{phone}</a>
          </div>
          {email && (
            <div className="footer-contact-row">
              <MessageCircle size={14} />
              <a href={`mailto:${email}`}>{email}</a>
            </div>
          )}
          <div className="footer-contact-row">
            <Clock size={14} />
            <span>Mon–Sat: 7:00 AM – 9:00 PM</span>
          </div>
          <div style={{ marginTop: "1rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
            <a href={`tel:${phone}`}
               style={{ background: "hsl(var(--site-primary) / .9)", color: "white", padding: ".5rem 1rem", borderRadius: 9999, fontSize: ".82rem", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
              <Phone size={13} /> Call Now
            </a>
            {waNum && (
              <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer"
                 style={{ background: "#25d366", color: "white", padding: ".5rem 1rem", borderRadius: 9999, fontSize: ".82rem", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
                <MessageCircle size={13} /> WhatsApp
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <span>{customText || `© ${year} ${siteName}. All rights reserved.`}</span>
        <div className="footer-bottom-links">
          {defaultPolicyLinks.map((l, i) => (
            <a key={`p${i}`} href={`${basePath}${l.href.replace(/^\//, "")}`.replace(/\/+/g, "/")}>{l.label}</a>
          ))}
          <a href="/erp/portal">Staff Login</a>
        </div>
      </div>
    </footer>
  );
}

// ───── DISPATCHER ─────
export function SectionRenderer(props: { section: Section; settings: SiteSettings; pages: Page[]; basePath: string }) {
  const { section } = props;
  if (!section.enabled) return null;
  switch (section.type) {
    case "header":         return <HeaderSection {...props} />;
    case "hero":           return <HeroSection {...props} />;
    case "services":       return <ServicesSection section={section} basePath={props.basePath} />;
    case "reviews":        return <ReviewsSection section={section} />;
    case "connect":        return <ConnectSection section={section} settings={props.settings} />;
    case "subscribe":      return <SubscribeSection section={section} settings={props.settings} />;
    case "footer":         return <FooterSection {...props} />;
    case "stats":          return <StatsSection section={section} />;
    case "why_choose_us":  return <WhyChooseUsSection section={section} />;
    case "technology":     return <TechnologySection section={section} />;
    case "health_packages":return <HealthPackagesSection section={section} basePath={props.basePath} />;
    case "appointment":
      return (
        <Suspense fallback={<SectionFallback />}>
          <LazyAppointmentSection section={section} settings={props.settings} />
        </Suspense>
      );
    case "faq":
      return (
        <Suspense fallback={<SectionFallback />}>
          <LazyFaqSection section={section} />
        </Suspense>
      );
    case "gallery":
      return (
        <Suspense fallback={<SectionFallback />}>
          <LazyGallerySection section={section} basePath={props.basePath} />
        </Suspense>
      );
    case "custom_html":
      return (
        <Suspense fallback={<SectionFallback />}>
          <LazyCustomHtmlSection section={section} />
        </Suspense>
      );
    case "contact":
      return (
        <Suspense fallback={<SectionFallback />}>
          <LazyContactSection section={section} settings={props.settings} />
        </Suspense>
      );
    default: return null;
  }
}
