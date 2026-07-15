import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
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
function getNum(c: Record<string, unknown>, k: string, fb = 0): number {
  return typeof c[k] === "number" ? (c[k] as number) : fb;
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
  const addr    = settings.address || "Subhash Chowk, Castair's Town, Deoghar";

  const TICKER_ITEMS = [
    "Open Mon\u2013Sun \u00b7 7 AM \u2013 9 PM",
    addr,
    "NABL-accredited laboratory",
    "Same-day report delivery available",
    "200+ diagnostic tests & packages",
    "Free home sample collection",
  ];

  const navLinks = [
    { label: "Home", href: absoluteUrl("", basePath) },
    { label: "Book a Test", href: absoluteUrl("book", basePath) },
    { label: "Patient Login", href: absoluteUrl("erp/portal/patient-login", basePath) },
    { label: "Staff Login", href: absoluteUrl("erp/login", basePath) },
  ];

  return (
    <>
      {/* Info strip — scrolling ticker, replaces emoji-heavy version with a calmer, mono-set data line */}
      <div className="cd-topbar">
        <div className="cd-topbar-ticker-wrap">
          <div className="cd-topbar-ticker-inner">
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
              <span key={i} className="cd-topbar-item cd-mono">{item}</span>
            ))}
          </div>
        </div>
        <div className="cd-topbar-actions">
          <a href={`tel:${phone}`} className="cd-topbar-action"><Phone size={11} /> {phone}</a>
          {waNum && (
            <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer" className="cd-topbar-action" style={{ color: "#25d366" }}>
              <MessageCircle size={11} /> WhatsApp
            </a>
          )}
        </div>
      </div>

      <header className={`cd-header ${scrolled ? "cd-header-scrolled" : ""}`}>
        <div className="container-narrow cd-header-row">
          <Link to="/" className="cd-header-logo">
            {settings.logoUrl
              ? <img src={resolveAssetUrl(settings.logoUrl)} alt={settings.siteTitle} style={{ height: 36, maxWidth: 160, objectFit: "contain" }} />
              : <>
                  <span className="cd-header-logo-mark">
                    <Microscope size={19} />
                  </span>
                  <span className="cd-header-logo-text cd-display">
                    Care<span style={{ color: "hsl(var(--cd-teal))" }}>Diagnostics</span>
                  </span>
                </>
            }
          </Link>

          <nav className="cd-header-nav" aria-label="Main navigation">
            {navLinks.map((l) => (
              <a key={l.label} href={l.href} className="cd-header-link">{l.label}</a>
            ))}
            {navPages.map((p) => {
              if (p.slug === "home") return null;
              return (
                <Link key={p.id} to={`/${p.slug}`} className="cd-header-link">
                  {p.title}
                </Link>
              );
            })}
          </nav>

          <div className="cd-header-end">
            <a href={ctaHref} className="cd-btn-primary cd-header-cta">
              <CalendarCheck size={16} />
              {ctaLabel}
            </a>
            <button
              className="cd-nav-toggle"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <XIcon size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {open && (
          <nav className="cd-nav-mobile" aria-label="Mobile navigation">
            {navLinks.map((l) => (
              <a key={l.label} href={l.href} className="cd-header-link">{l.label}</a>
            ))}
            {navPages.map((p) => {
              if (p.slug === "home") return null;
              return (
                <Link key={p.id} to={`/${p.slug}`} className="cd-header-link">
                  {p.title}
                </Link>
              );
            })}
            <a href={ctaHref} className="cd-btn-primary" style={{ marginTop: ".5rem" }}>
              <CalendarCheck size={16} />
              {ctaLabel}
            </a>
            {waNum && (
              <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer" className="cd-header-link" style={{ color: "#25d366" }}>
                <MessageCircle size={15} style={{ display: "inline", marginRight: 4 }} /> WhatsApp Us
              </a>
            )}
          </nav>
        )}
      </header>
    </>
  );
}

// ───── HERO ─────
export function HeroSection({ section, settings, basePath }: { section: Section; settings: SiteSettings; basePath: string }) {
  const c = section.config;
  const heading    = get(c, "heading", "Precision diagnostics.\nReports you can trust.");
  const subheading = get(c, "subheading", "3T MRI, CT, Ultrasound, Digital X-Ray, Mammography and Pathology — read by specialists, delivered fast, at Care Diagnostics, Deoghar.");
  const ctaLabel   = get(c, "ctaLabel", "Book a Test");
  const ctaUrl     = get(c, "ctaUrl",   "book");
  // Admin-uploadable background photo (Website Builder → hero section →
  // Background Photo). Was previously an unused "imageUrl" config field —
  // this component never read it, so setting it silently did nothing. A
  // dark overlay is ALWAYS composited behind the photo (never a light/white
  // one) since every hero text element below is hardcoded white — this
  // guarantees the low-contrast "invisible hero text" bug that recurred on
  // /book can't happen here regardless of which photo is uploaded.
  const heroImageUrl = resolveAssetUrl(get(c, "imageUrl", ""));
  const overlayOpacity = Math.max(0, Math.min(100, getNum(c, "overlayOpacity", 55))) / 100;
  const heroPanelStyle: CSSProperties | undefined = heroImageUrl
    ? {
        backgroundImage: `linear-gradient(155deg, hsl(var(--cd-navy) / ${overlayOpacity}), hsl(213 60% 10% / ${overlayOpacity}) 60%, hsl(187 55% 12% / ${overlayOpacity})), url('${heroImageUrl}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }
    : undefined;
  const phone      = settings.contactPhone || "9973497200";
  const waNum      = (settings.whatsappNumber || phone).replace(/[^0-9]/g, "");

  const safeCta = safeUrl(ctaUrl, "book");
  const ctaHref = absoluteUrl(safeCta, basePath);

  // Animated stat counters — same logic as before, kept (it worked well)
  const STATS = [
    { target: 10000, suffix: "+", label: "Patients served" },
    { target: 200, suffix: "+", label: "Tests & packages" },
    { target: 15, suffix: " yrs", label: "Of excellence" },
    { target: 24, suffix: "h", label: "Report delivery" },
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
        setCounts((prev) => { const n = [...prev]; n[i] = v; return n; });
        if (step >= steps) clearInterval(t);
      }, stepMs);
    });
  }, []);

  // Quick test search — new, per brief's "Quick test search" requirement
  const [searchQ, setSearchQ] = useState("");
  const [, navigate] = useLocation();
  function onQuickSearch(e: { preventDefault: () => void }) {
    e.preventDefault();
    const q = searchQ.trim();
    navigate(`${basePath}book${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }

  const headingLines = heading.split("\n");

  const modalities = [
    { icon: <Brain size={20} />, label: "MRI" },
    { icon: <Scan size={20} />, label: "CT Scan" },
    { icon: <Waves size={20} />, label: "Ultrasound" },
    { icon: <Zap size={20} />, label: "X-Ray" },
    { icon: <Activity size={20} />, label: "Mammography" },
    { icon: <TestTube size={20} />, label: "Laboratory" },
  ];

  return (
    <section className="cd-hero">
      <div className="cd-hero-panel cd-scan-panel" style={heroPanelStyle}>
        <div className="cd-hero-mesh" aria-hidden="true" />
        <div className="cd-hero-inner">
          <div className="cd-hero-text anim-left">
            <span className="cd-eyebrow" style={{ color: "hsl(var(--cd-amber))" }}>
              <Microscope size={14} />
              Care Diagnostics &middot; Deoghar, Jharkhand
            </span>

            <h1 className="cd-hero-heading cd-display">
              {headingLines.map((line, i) => (
                <span key={i} style={{ display: "block", animationDelay: `${i * 0.12}s` }} className="hero-heading-line">
                  {line}
                </span>
              ))}
            </h1>

            <p className="cd-hero-sub">{subheading}</p>

            {/* Quick test search */}
            <form onSubmit={onQuickSearch} className="cd-hero-search" role="search" aria-label="Search for a test or package">
              <FileText size={17} style={{ flexShrink: 0, opacity: .6 }} aria-hidden="true" />
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search a test or package — e.g. MRI Brain, CBC, Full Body Checkup"
                aria-label="Search a test or package"
              />
              <button type="submit" className="cd-btn-primary" style={{ padding: ".65rem 1.25rem" }}>
                Search
              </button>
            </form>

            <div className="cd-hero-ctas">
              <a href={ctaHref} className="cd-btn-primary">
                <CalendarCheck size={18} />
                {ctaLabel}
              </a>
              <a href={`${basePath}book#reports`} className="cd-btn-ghost">
                <FileText size={18} />
                Download Report
              </a>
              <a href={`tel:${phone}`} className="cd-btn-ghost">
                <Phone size={18} />
                Call Now
              </a>
              {waNum && (
                <a
                  href={`https://wa.me/${waNum}?text=${encodeURIComponent("Hi, I'd like to book a diagnostic test.")}`}
                  target="_blank" rel="noreferrer"
                  className="cd-hero-wa"
                  aria-label="Chat on WhatsApp"
                >
                  <MessageCircle size={20} />
                </a>
              )}
            </div>

            {/* Modality quick-access chips */}
            <div className="cd-hero-modalities" role="list" aria-label="Our diagnostic services">
              {modalities.map((m, i) => (
                <a key={i} href={`${basePath}book`} className="cd-hero-modality-chip" role="listitem">
                  {m.icon}
                  <span>{m.label}</span>
                </a>
              ))}
            </div>
          </div>

          {/* Stat strip */}
          <div className="cd-hero-stats anim-right" aria-hidden="false">
            {STATS.map((s, i) => (
              <div key={i} className="cd-hero-stat">
                <span className="cd-hero-stat-num cd-mono">{counts[i].toLocaleString()}{s.suffix}</span>
                <span className="cd-hero-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <a href="#services" className="hero-scroll-indicator" aria-label="Scroll to services">
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
    <div className="cd-stats-strip cd-section-navy">
      <div className="container-narrow cd-stats-grid cd-stagger">
        {items.map((it, i) => (
          <div key={i} className="cd-stats-item">
            <div className="cd-stats-num cd-mono">{it.num}</div>
            <div className="cd-stats-label">{it.label}</div>
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
  const heading = get(c, "heading", "Complete diagnostic services, one roof");
  const sub     = get(c, "subheading", "From advanced imaging to routine pathology — modern equipment, specialist reporting, and a patient-friendly workflow.");
  const items   = Array.isArray(c.items) && c.items.length > 0
    ? (c.items as Array<{ title: string; desc: string; category?: string; price?: string }>)
    : DEFAULT_SERVICES;

  const [activeTab, setActiveTab] = useState("All");
  const categories = ["All", "Radiology", "Pathology", "Cardiology & Neuro", "Preventive Health Packages"];
  const filteredItems = activeTab === "All" ? items : items.filter((it) => (it.category || "Radiology") === activeTab);

  return (
    <section className="cd-section cd-section-light" id="services">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.75rem" }}>
          <span className="cd-eyebrow"><Activity size={13} /> Our Services</span>
          <h2 className="cd-display cd-h2" style={{ marginTop: ".6rem" }}>{heading}</h2>
          {sub && <p className="cd-section-sub">{sub}</p>}
        </div>

        <div className="cd-tab-row" role="tablist" aria-label="Filter services by category">
          {categories.map((cat) => (
            <button
              key={cat}
              role="tab"
              aria-selected={activeTab === cat}
              onClick={() => setActiveTab(cat)}
              className={`cd-tab-btn ${activeTab === cat ? "active" : ""}`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="cd-services-grid cd-stagger">
          {filteredItems.map((it, i) => {
            const serviceImg = getServiceImage(it.title, basePath);
            const fallbackUnsplash = "https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=600&q=80";
            return (
              <div key={i} className="cd-card cd-service-card">
                <div className="cd-service-img-wrap">
                  <img
                    src={serviceImg}
                    alt={it.title}
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).src = fallbackUnsplash; }}
                  />
                  <span className="cd-service-cat-badge">{it.category || "Radiology"}</span>
                </div>
                <div className="cd-service-body">
                  <h3 className="cd-service-title">{it.title}</h3>
                  <p className="cd-service-desc">{it.desc}</p>
                  <div className="cd-service-footer">
                    <span className="cd-mono cd-service-price">{it.price || "Contact us"}</span>
                    <a href={`${basePath}book`} className="cd-btn-primary" style={{ padding: ".5rem 1.1rem", fontSize: ".8125rem" }}>
                      Book now
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
    <section className="cd-section cd-section-light">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.75rem" }}>
          <span className="cd-eyebrow"><Award size={13} /> Why Choose Us</span>
          <h2 className="cd-display cd-h2" style={{ marginTop: ".6rem" }}>{heading}</h2>
          {sub && <p className="cd-section-sub" style={{ maxWidth: 520 }}>{sub}</p>}
        </div>
        <div className="cd-why-grid cd-stagger">
          {items.map((it, i) => (
            <div key={i} className="cd-card cd-why-card">
              <span className="cd-why-icon" aria-hidden="true">{it.icon}</span>
              <div>
                <h3 className="cd-why-title">{it.title}</h3>
                <p className="cd-why-desc">{it.desc}</p>
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
  const heading = get(c, "heading", "Technology built for confident diagnosis");
  const sub     = get(c, "subheading", "High-quality imaging and laboratory workflow, designed to support clear clinical decisions.");
  return (
    <section className="cd-section cd-section-light">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.75rem" }}>
          <span className="cd-eyebrow"><Cpu size={13} /> Our Technology</span>
          <h2 className="cd-display cd-h2" style={{ marginTop: ".6rem" }}>{heading}</h2>
          {sub && <p className="cd-section-sub" style={{ maxWidth: 560 }}>{sub}</p>}
        </div>
        <div className="cd-tech-grid cd-stagger">
          {TECH_ITEMS.map((it, i) => (
            <div key={i} className="cd-tech-card">
              <img
                src={it.img}
                alt={it.title}
                className="cd-tech-img"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=700&q=80"; }}
              />
              <div className="cd-tech-overlay">
                <span className="cd-tech-icon-badge" aria-hidden="true">{it.icon}</span>
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

type PackageCard = {
  name: string;
  includes: string[];
  featured: boolean;
  badge: string;
  testCount: number;
  price: string;
  originalPrice: string;
  discountLabel: string;
};

function normalizePkgItems(raw: unknown): PackageCard[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .map((it) => ({
      name: typeof it.name === "string" ? it.name : "",
      includes: typeof it.includes === "string"
        ? it.includes.split("\n").map((s) => s.trim()).filter(Boolean)
        : Array.isArray(it.includes) ? (it.includes as unknown[]).map(String).filter(Boolean) : [],
      featured: it.featured === true || it.featured === "yes",
      badge: typeof it.badge === "string" ? it.badge : "",
      testCount: typeof it.testCount === "number" ? it.testCount : Number(it.testCount) || 0,
      price: typeof it.price === "string" ? it.price : it.price != null ? String(it.price) : "",
      originalPrice: typeof it.originalPrice === "string" ? it.originalPrice : it.originalPrice != null ? String(it.originalPrice) : "",
      discountLabel: typeof it.discountLabel === "string" ? it.discountLabel : "",
    }))
    .filter((pkg) => pkg.name);
}

export function HealthPackagesSection({ section, basePath }: { section: Section; basePath: string }) {
  const c = section.config;
  const heading  = get(c, "heading", "Popular health packages");
  const sub      = get(c, "subheading", "Preventive packages designed for families, senior citizens and chronic-disease monitoring.");
  const bookHref = `${basePath}book`;
  const customPkgs = normalizePkgItems(c.items);
  const pkgs: PackageCard[] = customPkgs.length > 0 ? customPkgs : DEFAULT_PKGS.map((pkg) => ({
    ...pkg, testCount: 0, price: "", originalPrice: "", discountLabel: "",
  }));

  return (
    <section className="cd-section cd-section-light">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.75rem" }}>
          <span className="cd-eyebrow"><Package size={13} /> Health Packages</span>
          <h2 className="cd-display cd-h2" style={{ marginTop: ".6rem" }}>{heading}</h2>
          {sub && <p className="cd-section-sub" style={{ maxWidth: 560 }}>{sub}</p>}
        </div>
        <div className="cd-pkg-grid cd-stagger">
          {pkgs.map((pkg, i) => (
            <div key={i} className={`cd-card cd-pkg-card${pkg.featured ? " featured" : ""}`}>
              {pkg.badge && <span className="cd-pkg-badge">{pkg.badge}</span>}
              <span className="cd-pkg-icon" aria-hidden="true"><Package size={20} /></span>
              <h3 className="cd-pkg-name">{pkg.name}</h3>
              {pkg.testCount > 0 && <p className="cd-pkg-meta">Includes {pkg.testCount} tests</p>}
              {pkg.price && (
                <p className="cd-pkg-price">
                  <span className="cd-pkg-price-current">₹{pkg.price}</span>
                  {pkg.originalPrice && <span className="cd-pkg-price-original">₹{pkg.originalPrice}</span>}
                  {pkg.discountLabel && <span className="cd-pkg-discount">{pkg.discountLabel}</span>}
                </p>
              )}
              <ul className="cd-pkg-includes">
                {pkg.includes.map((item, j) => <li key={j}>{item}</li>)}
              </ul>
              <a href={bookHref} className="cd-btn-primary" style={{ justifyContent: "center", width: "100%" }}>
                Book now <ArrowRight size={15} />
              </a>
            </div>
          ))}
        </div>
        <p className="cd-section-sub" style={{ fontSize: ".875rem", marginTop: "1.75rem" }}>
          Prices available at the centre. Call <a href="tel:9973497200" style={{ color: "hsl(var(--cd-teal))", fontWeight: 600 }}>9973497200</a> or WhatsApp for current offers.
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
  const heading = get(c, "heading", "What our patients say");
  const sub     = get(c, "subheading", "Trusted by thousands of patients across Deoghar and Jharkhand.");
  const items   = Array.isArray(c.items) && c.items.length > 0
    ? (c.items as Array<{ name: string; rating: number; text: string; location?: string }>)
    : DEFAULT_REVIEWS;
  return (
    <section className="cd-section cd-section-light">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.75rem" }}>
          <span className="cd-eyebrow"><Star size={13} /> Patient Reviews</span>
          <h2 className="cd-display cd-h2" style={{ marginTop: ".6rem" }}>{heading}</h2>
          {sub && <p className="cd-section-sub" style={{ maxWidth: 480 }}>{sub}</p>}
        </div>
        <div className="cd-review-grid cd-stagger">
          {items.map((it, i) => (
            <div key={i} className="cd-card cd-review-card">
              <div className="cd-review-stars" aria-label={`${it.rating} out of 5 stars`}>
                {Array.from({ length: Math.max(0, Math.min(5, Number(it.rating) || 5)) }).map((_, j) => (
                  <Star key={j} size={15} fill="currentColor" />
                ))}
              </div>
              <p className="cd-review-text">&ldquo;{it.text}&rdquo;</p>
              <div className="cd-review-author">{it.name}</div>
              {(it.location || DEFAULT_REVIEWS[i]?.location) && (
                <div className="cd-review-location">
                  <MapPin size={12} />
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
  const heading = get(section.config, "heading", "Connect with Care Diagnostics");
  const sub     = get(section.config, "subheading", "Follow us for health tips, diagnostic awareness and service announcements.");
  const social  = parseSocial(settings.socialLinks);
  const items: Array<[string, React.ReactNode, string]> = [
    ["facebook",  <Facebook  size={20} key="f" />, "#3b5998"],
    ["instagram", <Instagram size={20} key="i" />, "#e1306c"],
    ["twitter",   <Twitter   size={20} key="t" />, "#1da1f2"],
    ["youtube",   <Youtube   size={20} key="y" />, "#ff0000"],
    ["linkedin",  <Linkedin  size={20} key="l" />, "#0077b5"],
  ];
  const active = items.filter(([k]) => social[k] && safeUrl(social[k]));
  return (
    <section className="cd-section cd-section-light">
      <div className="container-narrow text-center">
        <span className="cd-eyebrow" style={{ marginBottom: ".85rem" }}><MessageCircle size={13} /> Social Media</span>
        <h2 className="cd-display cd-h2" style={{ marginTop: ".6rem" }}>{heading}</h2>
        {sub && <p className="cd-section-sub" style={{ maxWidth: 420 }}>{sub}</p>}
        <div className="cd-connect-row">
          {active.length > 0
            ? active.map(([k, icon]) => (
                <a key={k} href={safeUrl(social[k])} target="_blank" rel="noreferrer" className="cd-connect-btn" aria-label={k}>
                  {icon}
                </a>
              ))
            : <span className="cd-section-sub" style={{ fontSize: ".9rem" }}>Follow us on social media — links coming soon.</span>}
        </div>
      </div>
    </section>
  );
}

// ───── SUBSCRIBE ─────
export function SubscribeSection({ section, settings }: { section: Section; settings: SiteSettings }) {
  const c = section.config;
  const heading     = get(c, "heading", "Health tips & updates");
  const subheading  = get(c, "subheading", "Subscribe for diagnostic health tips, package offers and appointment reminders.");
  const placeholder = get(c, "placeholder", "your@email.com");
  const submitLabel = get(c, "submitLabel", "Subscribe");
  const [done, setDone] = useState(false);
  return (
    <section className="cd-section cd-section-navy">
      <div className="container-narrow text-center" style={{ maxWidth: 560 }}>
        <span className="cd-eyebrow" style={{ color: "hsl(var(--cd-amber))", marginBottom: ".85rem" }}><Award size={13} /> Newsletter</span>
        <h2 className="cd-display cd-h2" style={{ marginTop: ".6rem", color: "white" }}>{heading}</h2>
        {subheading && <p className="cd-section-sub" style={{ color: "rgba(255,255,255,.72)" }}>{subheading}</p>}
        {done ? (
          <div className="cd-subscribe-success">
            <BadgeCheck size={20} /> Thanks for subscribing!
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setDone(true); }} className="cd-subscribe-form">
            <input type="email" required placeholder={placeholder} />
            <button type="submit" className="cd-btn-primary">{submitLabel}</button>
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
    { label: "Staff Login",      href: `${basePath}erp/login` },
  ];
  const defaultPolicyLinks = [
    { label: "Privacy Policy",       href: "/policies" },
    { label: "Terms & Conditions",   href: "/policies" },
    { label: "Refund Policy",        href: "/policies" },
    { label: "Cancellation Policy",  href: "/policies" },
  ];

  return (
    <footer className="cd-footer">
      <div className="cd-footer-grid">
        <div className="cd-footer-col">
          <div className="cd-footer-brand cd-display">
            <Microscope size={18} />
            {siteName.split(" ").map((w, i) => (
              <span key={i} style={i === 0 ? undefined : { color: "hsl(var(--cd-teal))" }}>{w}&nbsp;</span>
            ))}
          </div>
          <p className="cd-footer-about">
            {settings.about || `${siteName} is a precision diagnostic centre in Deoghar, Jharkhand, offering MRI, CT, ultrasound, pathology and comprehensive health packages with same-day reporting.`}
          </p>
          <div className="cd-footer-social">
            {socialIcons.filter(([k]) => social[k] && safeUrl(social[k])).map(([k, icon]) => (
              <a key={k} href={safeUrl(social[k])} target="_blank" rel="noreferrer" className="cd-footer-social-btn" aria-label={k}>
                {icon}
              </a>
            ))}
          </div>
        </div>

        <div className="cd-footer-col">
          <div className="cd-footer-col-title">Services</div>
          <ul className="cd-footer-links">
            {(svcLinks.length > 0 ? svcLinks.map((s) => s.label) : defaultServices).map((svc, i) => (
              <li key={i}><a href="#services"><ChevronRight size={13} /> {svc}</a></li>
            ))}
          </ul>
        </div>

        <div className="cd-footer-col">
          <div className="cd-footer-col-title">Quick Links</div>
          <ul className="cd-footer-links">
            {defaultQuickLinks.map((l, i) => (
              <li key={i}>
                <a href={l.href}>
                  <ChevronRight size={13} /> {l.label}
                </a>
              </li>
            ))}
            {extraLinks.map((l, i) => {
              const s = safeUrl(l.url, "#");
              const href = s.startsWith("/") ? `${basePath}${s.replace(/^\//, "")}` : s;
              return <li key={`e${i}`}><a href={href}><ChevronRight size={13} /> {l.label}</a></li>;
            })}
          </ul>
        </div>

        <div className="cd-footer-col">
          <div className="cd-footer-col-title">Contact Us</div>
          <div className="cd-footer-contact-row">
            <MapPin size={14} />
            <span>{addr}</span>
          </div>
          <div className="cd-footer-contact-row cd-footer-reg">
            <span>Reg: {regAddr}</span>
          </div>
          <div className="cd-footer-contact-row">
            <Phone size={14} />
            <a href={`tel:${phone}`}>{phone}</a>
          </div>
          {email && (
            <div className="cd-footer-contact-row">
              <MessageCircle size={14} />
              <a href={`mailto:${email}`}>{email}</a>
            </div>
          )}
          <div className="cd-footer-contact-row">
            <Clock size={14} />
            <span>Mon&ndash;Sat: 7:00 AM &ndash; 9:00 PM</span>
          </div>
          <div className="cd-footer-cta-row">
            <a href={`tel:${phone}`} className="cd-footer-cta-btn">
              <Phone size={13} /> Call Now
            </a>
            {waNum && (
              <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer" className="cd-footer-cta-btn cd-footer-cta-wa">
                <MessageCircle size={13} /> WhatsApp
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="cd-footer-bottom">
        <span>{customText || `\u00a9 ${year} ${siteName}. All rights reserved.`}</span>
        <div className="cd-footer-bottom-links">
          {defaultPolicyLinks.map((l, i) => (
            <a key={`p${i}`} href={`${basePath}${l.href.replace(/^\//, "")}`.replace(/\/+/g, "/")}>{l.label}</a>
          ))}
          <a href={`${basePath}erp/portal/patient-login`}>Patient Login</a>
          <a href={`${basePath}erp/login`}>Staff Login</a>
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
