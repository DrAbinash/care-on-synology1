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
      <section className="cd-section cd-section-light">
        <div className="container-narrow">
          <div className="text-center" style={{ marginBottom: "2.75rem" }}>
            <span className="cd-eyebrow"><Image size={13} /> Gallery</span>
            <h2 className="cd-display cd-h2" style={{ marginTop: ".6rem" }}>{heading}</h2>
            {sub && <p className="cd-section-sub">{sub}</p>}
          </div>

          {categories.length > 2 && (
            <div className="cd-tab-row" style={{ marginBottom: "1.75rem" }}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`cd-tab-btn ${activeCategory === cat ? "active" : ""}`}
                >
                  {cat === "all" ? "All" : cat}
                </button>
              ))}
            </div>
          )}

          {!loaded ? (
            <div className="cd-gallery-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="cd-loading-sweep" style={{ aspectRatio: "1", borderRadius: "var(--site-radius)", height: "auto" }} />
              ))}
            </div>
          ) : displayed && displayed.length > 0 ? (
            <div className="cd-gallery-grid">
              {displayed.map((p) => (
                <button key={p.id} className="cd-gallery-item" onClick={() => openLightbox(resolveAssetUrl(p.url), p.alt)} aria-label={`View ${p.alt}`}>
                  <img src={resolveAssetUrl(p.url)} alt={p.alt} loading="lazy" />
                  <span className="cd-gallery-overlay"><ZoomIn size={26} /></span>
                </button>
              ))}
            </div>
          ) : (
            <div className="cd-gallery-grid">
              {PLACEHOLDER_ITEMS.map((it, i) => {
                const imgPath = `${basePath}${it.img}`.replace(/\/+/g, "/");
                return (
                  <button key={i} className="cd-gallery-item" onClick={() => openLightbox(imgPath, it.label)} aria-label={`View ${it.label}`}>
                    <img
                      src={imgPath}
                      alt={it.label}
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).src = it.fallback; }}
                    />
                    <span className="cd-gallery-overlay"><ZoomIn size={26} /></span>
                  </button>
                );
              })}
            </div>
          )}

          {photos.length === 0 && loaded && (
            <p className="cd-section-sub" style={{ fontSize: ".8125rem", marginTop: "1.5rem" }}>
              Actual facility photos will appear here once uploaded via the Photo Library.
            </p>
          )}
        </div>
      </section>

      {lightbox && (
        <div className="cd-lightbox-backdrop" onClick={closeLightbox} role="dialog" aria-modal="true" aria-label={lightbox.alt}>
          <button className="cd-lightbox-close" onClick={closeLightbox} aria-label="Close">
            <X size={18} />
          </button>
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            className="cd-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
