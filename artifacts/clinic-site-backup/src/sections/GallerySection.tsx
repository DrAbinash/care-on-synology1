import { useEffect, useState } from "react";
import { X, ZoomIn, Image } from "lucide-react";
import type { Section, Photo } from "../types";
import { api } from "../api";
import { resolveAssetUrl } from "../config";

function get(c: Record<string, unknown>, k: string, fb = ""): string {
  return typeof c[k] === "string" ? (c[k] as string) : fb;
}

const PLACEHOLDER_ITEMS = [
  { label: "Clinic Building",    img: "assets/images/building-exterior.jpg", fallback: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=600&q=80" },
  { label: "Patient Reception",  img: "assets/images/reception.jpg", fallback: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=600&q=80" },
  { label: "CT Scan Room",       img: "assets/images/ct-scan.jpg", fallback: "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=600&q=80" },
  { label: "Pathology Lab",      img: "assets/images/pathology-lab.jpg", fallback: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=600&q=80" },
  { label: "Ultrasound Unit",    img: "assets/images/ultrasound.jpg", fallback: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=600&q=80" },
  { label: "Doctor Consultation",img: "assets/images/doctor-consult.jpg", fallback: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&q=80" },
];

export default function GallerySection({ section, basePath = "/" }: { section: Section; basePath?: string }) {
  const c        = section.config;
  const heading  = get(c, "heading", "Inside Care Diagnostics");
  const sub      = get(c, "subheading", "Modern diagnostic spaces, advanced equipment and patient-friendly facilities.");
  const category = get(c, "category", "general");

  const [photos, setPhotos]         = useState<Photo[]>([]);
  const [loaded, setLoaded]         = useState(false);
  const [lightbox, setLightbox]     = useState<{ src: string; alt: string } | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");

  useEffect(() => {
    api.photos(category)
      .then((d) => setPhotos(d.photos || []))
      .catch(() => setPhotos([]))
      .finally(() => setLoaded(true));
  }, [category]);

  const categories = photos.length > 0
    ? ["all", ...Array.from(new Set(photos.map((p) => p.category))).filter(Boolean).sort()]
    : [];
  const displayed = photos.length > 0
    ? (activeCategory === "all" ? photos : photos.filter((p) => p.category === activeCategory))
    : null;

  function openLightbox(src: string, alt: string) {
    setLightbox({ src, alt });
  }
  function closeLightbox() {
    setLightbox(null);
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeLightbox(); }
    if (lightbox) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  return (
    <>
      <section className="section muted-bg">
        <div className="container-narrow">
          <div className="text-center" style={{ marginBottom: "2.5rem" }}>
            <div className="section-eyebrow" style={{ display: "inline-flex" }}><Image size={13} /> Gallery</div>
            <h2 className="h-section" style={{ marginBottom: ".5rem" }}>{heading}</h2>
            {sub && <p className="subtle">{sub}</p>}
          </div>

          {/* Category filter tabs */}
          {categories.length > 2 && (
            <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", justifyContent: "center", marginBottom: "1.5rem" }}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    padding: ".3rem .9rem",
                    borderRadius: 9999,
                    fontSize: ".82rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    background: activeCategory === cat ? "hsl(var(--site-primary))" : "hsl(var(--site-bg))",
                    color: activeCategory === cat ? "white" : "hsl(var(--site-muted-fg))",
                    boxShadow: activeCategory === cat ? "0 2px 8px hsl(var(--site-primary) / .3)" : "none",
                    transition: "all .15s",
                  }}
                >
                  {cat === "all" ? "All" : cat}
                </button>
              ))}
            </div>
          )}

          {/* Gallery grid */}
          {!loaded ? (
            <div className="gallery-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ aspectRatio: "1", borderRadius: "var(--site-radius)", background: "hsl(var(--site-muted))", animation: "shimmer 1.5s infinite", backgroundImage: "linear-gradient(90deg, hsl(var(--site-muted)) 0%, hsl(var(--site-bg)) 50%, hsl(var(--site-muted)) 100%)", backgroundSize: "200% 100%" }} />
              ))}
            </div>
          ) : displayed && displayed.length > 0 ? (
            <div className="gallery-grid">
              {displayed.map((p) => (
                <div key={p.id} className="gallery-item" onClick={() => openLightbox(resolveAssetUrl(p.url), p.alt)}>
                  <img src={resolveAssetUrl(p.url)} alt={p.alt} loading="lazy" />
                  <div className="gallery-overlay">
                    <ZoomIn size={28} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="gallery-grid">
              {PLACEHOLDER_ITEMS.map((it, i) => {
                const imgPath = `${basePath}${it.img}`.replace(/\/+/g, "/");
                return (
                  <div key={i} className="gallery-item" onClick={() => openLightbox(imgPath, it.label)}>
                    <img
                      src={imgPath}
                      alt={it.label}
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = it.fallback;
                      }}
                    />
                    <div className="gallery-overlay">
                      <ZoomIn size={28} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {photos.length === 0 && loaded && (
            <p className="subtle text-center" style={{ fontSize: ".82rem", marginTop: "1.25rem" }}>
              Actual facility photos will appear here once uploaded via the Photo Library.
            </p>
          )}
        </div>
      </section>

      {/* Lightbox */}
      {lightbox && (
        <div className="lightbox-backdrop" onClick={closeLightbox}>
          <button className="lightbox-close" onClick={closeLightbox} aria-label="Close lightbox">
            <X size={18} />
          </button>
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
