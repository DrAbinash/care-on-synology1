import { useState } from "react";
import { Phone, Mail, MapPin, Clock, MessageCircle } from "lucide-react";
import type { Section, SiteSettings } from "../types";
import { buttonClass } from "../theme";

function get(c: Record<string, unknown>, k: string, fb = ""): string {
  return typeof c[k] === "string" ? (c[k] as string) : fb;
}
function getBool(c: Record<string, unknown>, k: string, fb = true): boolean {
  return typeof c[k] === "boolean" ? (c[k] as boolean) : fb;
}

const DEFAULT_MAP = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3644.5!2d86.6985!3d24.4835!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x39f3fe27a7e26c25%3A0x1234!2sDeoghar%2C%20Jharkhand!5e0!3m2!1sen!2sin!4v1620000000000!5m2!1sen!2sin";

export default function ContactSection({ section, settings }: { section: Section; settings: SiteSettings }) {
  const c        = section.config;
  const heading  = get(c, "heading",    "Visit Care Diagnostics");
  const sub      = get(c, "subheading", "CARE DIAGNOSTICS, Subhash Chowk, Castair's Town, Near Bajla Mahila College, Deoghar\u2013814112. Call or WhatsApp us for appointments and report queries.");
  const mapEmbed = get(c, "mapEmbed",   DEFAULT_MAP);
  const showForm = getBool(c, "showForm", true);

  const phone  = settings.contactPhone || "9973497200";
  const email  = settings.contactEmail || "CARE.DEOGHAR@GMAIL.COM";
  const addr   = settings.address      || "CARE DIAGNOSTICS, Subhash Chowk, Castair's Town, Near Bajla Mahila College, Deoghar\u2013814112";
  const waNum  = (settings.whatsappNumber || phone).replace(/[^0-9]/g, "");

  return (
    <section className="section" id="contact">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.5rem" }}>
          <div className="section-eyebrow" style={{ display: "inline-flex" }}><MapPin size={13} /> Find Us</div>
          <h2 className="h-section" style={{ marginBottom: ".5rem" }}>{heading}</h2>
          {sub && <p className="subtle" style={{ maxWidth: 560, margin: "0 auto" }}>{sub}</p>}
        </div>

        <div className="contact-grid">
          {/* Info card */}
          <div className="contact-info-card">
            <div className="contact-info-row">
              <div className="contact-icon" aria-hidden="true"><MapPin size={18} /></div>
              <div>
                <div className="contact-info-label">Address</div>
                <div className="contact-info-value">{addr}</div>
              </div>
            </div>

            <div className="contact-info-row">
              <div className="contact-icon" aria-hidden="true"><Phone size={18} /></div>
              <div>
                <div className="contact-info-label">Phone</div>
                <div className="contact-info-value">
                  <a href={`tel:${phone}`}>{phone}</a>
                </div>
              </div>
            </div>

            {email && (
              <div className="contact-info-row">
                <div className="contact-icon" aria-hidden="true"><Mail size={18} /></div>
                <div>
                  <div className="contact-info-label">Email</div>
                  <div className="contact-info-value">
                    <a href={`mailto:${email}`}>{email}</a>
                  </div>
                </div>
              </div>
            )}

            <div className="contact-info-row">
              <div className="contact-icon" aria-hidden="true"><Clock size={18} /></div>
              <div>
                <div className="contact-info-label">Opening Hours</div>
                <div className="contact-info-value" style={{ fontSize: ".9rem" }}>
                  Mon – Sat: 7:00 AM – 9:00 PM<br />
                  <span style={{ color: "hsl(var(--site-muted-fg))", fontSize: ".82rem" }}>Sundays: by appointment only</span>
                </div>
              </div>
            </div>

            <div className="contact-action-btns">
              <a href={`tel:${phone}`} className="contact-action-btn call" aria-label="Call now">
                <Phone size={16} /> Call Now
              </a>
              {waNum && (
                <a href={`https://wa.me/${waNum}?text=${encodeURIComponent("Hi, I'd like to enquire about diagnostic services.")}`}
                   target="_blank" rel="noreferrer"
                   className="contact-action-btn whatsapp" aria-label="Chat on WhatsApp">
                  <MessageCircle size={16} /> WhatsApp
                </a>
              )}
            </div>
          </div>

          {/* Map or contact form */}
          {mapEmbed ? (
            <div className="contact-map-wrap">
              <iframe
                src={mapEmbed}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Care Diagnostics location map"
              />
            </div>
          ) : showForm ? (
            <ContactForm settings={settings} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ContactForm({ settings }: { settings: SiteSettings }) {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", contact: "", message: "" });

  if (submitted) {
    return (
      <div className="contact-info-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: ".75rem" }}>
        <div style={{ width: 56, height: 56, background: "hsl(var(--site-primary) / .1)", borderRadius: 9999, display: "flex", alignItems: "center", justifyContent: "center", color: "hsl(var(--site-primary))" }}>
          <MessageCircle size={26} />
        </div>
        <strong style={{ fontSize: "1.05rem" }}>Message sent!</strong>
        <p className="subtle" style={{ fontSize: ".9rem" }}>We'll get back to you shortly via phone or WhatsApp.</p>
      </div>
    );
  }

  return (
    <form
      className="contact-info-card"
      style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
      onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
    >
      <h3 style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: ".25rem" }}>Send a Message</h3>
      <div>
        <label style={{ fontSize: ".8rem", fontWeight: 600, color: "hsl(var(--site-muted-fg))", display: "block", marginBottom: ".35rem" }}>Your Name</label>
        <input
          className="input-soft"
          required
          placeholder="Full name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          aria-label="Your name"
        />
      </div>
      <div>
        <label style={{ fontSize: ".8rem", fontWeight: 600, color: "hsl(var(--site-muted-fg))", display: "block", marginBottom: ".35rem" }}>Phone or Email</label>
        <input
          className="input-soft"
          required
          placeholder="Phone number or email"
          value={form.contact}
          onChange={(e) => setForm({ ...form, contact: e.target.value })}
          aria-label="Phone or email"
        />
      </div>
      <div>
        <label style={{ fontSize: ".8rem", fontWeight: 600, color: "hsl(var(--site-muted-fg))", display: "block", marginBottom: ".35rem" }}>How Can We Help?</label>
        <textarea
          className="input-soft"
          placeholder="Ask about tests, reports, packages, booking…"
          rows={4}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          aria-label="Message"
          style={{ resize: "vertical" }}
        />
      </div>
      <button type="submit" className={buttonClass(settings, "primary")} style={{ justifyContent: "center" }}>
        Send Message
      </button>
    </form>
  );
}
