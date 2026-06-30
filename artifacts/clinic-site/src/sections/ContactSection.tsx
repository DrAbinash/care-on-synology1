import { useState } from "react";
import { Phone, Mail, MapPin, Clock, MessageCircle } from "lucide-react";
import type { Section, SiteSettings } from "../types";

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
    <section className="cd-section cd-section-light" id="contact">
      <div className="container-narrow">
        <div className="text-center" style={{ marginBottom: "2.75rem" }}>
          <span className="cd-eyebrow"><MapPin size={13} /> Find Us</span>
          <h2 className="cd-display cd-h2" style={{ marginTop: ".6rem" }}>{heading}</h2>
          {sub && <p className="cd-section-sub" style={{ maxWidth: 560 }}>{sub}</p>}
        </div>

        <div className="cd-contact-grid">
          <div className="cd-card cd-contact-info-card">
            <div className="cd-contact-row">
              <span className="cd-contact-icon" aria-hidden="true"><MapPin size={18} /></span>
              <div>
                <div className="cd-contact-label">Address</div>
                <div className="cd-contact-value">{addr}</div>
              </div>
            </div>

            <div className="cd-contact-row">
              <span className="cd-contact-icon" aria-hidden="true"><Phone size={18} /></span>
              <div>
                <div className="cd-contact-label">Phone</div>
                <div className="cd-contact-value"><a href={`tel:${phone}`}>{phone}</a></div>
              </div>
            </div>

            {email && (
              <div className="cd-contact-row">
                <span className="cd-contact-icon" aria-hidden="true"><Mail size={18} /></span>
                <div>
                  <div className="cd-contact-label">Email</div>
                  <div className="cd-contact-value"><a href={`mailto:${email}`}>{email}</a></div>
                </div>
              </div>
            )}

            <div className="cd-contact-row">
              <span className="cd-contact-icon" aria-hidden="true"><Clock size={18} /></span>
              <div>
                <div className="cd-contact-label">Opening Hours</div>
                <div className="cd-contact-value" style={{ fontSize: ".9rem" }}>
                  Mon&ndash;Sat: 7:00 AM&ndash;9:00 PM<br />
                  <span style={{ color: "hsl(var(--cd-slate) / .55)", fontSize: ".8125rem" }}>Sundays: by appointment only</span>
                </div>
              </div>
            </div>

            <div className="cd-contact-actions">
              <a href={`tel:${phone}`} className="cd-btn-primary" aria-label="Call now">
                <Phone size={16} /> Call Now
              </a>
              {waNum && (
                <a href={`https://wa.me/${waNum}?text=${encodeURIComponent("Hi, I'd like to enquire about diagnostic services.")}`}
                   target="_blank" rel="noreferrer"
                   className="cd-contact-wa-btn" aria-label="Chat on WhatsApp">
                  <MessageCircle size={16} /> WhatsApp
                </a>
              )}
            </div>
          </div>

          {mapEmbed ? (
            <div className="cd-contact-map-wrap cd-card">
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

function ContactForm({ settings: _settings }: { settings: SiteSettings }) {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", contact: "", message: "" });

  if (submitted) {
    return (
      <div className="cd-card cd-contact-info-card cd-contact-success">
        <span className="cd-contact-success-icon"><MessageCircle size={26} /></span>
        <strong style={{ fontSize: "1.0625rem" }}>Message sent!</strong>
        <p className="cd-section-sub" style={{ fontSize: ".9rem", margin: 0 }}>We'll get back to you shortly via phone or WhatsApp.</p>
      </div>
    );
  }

  return (
    <form
      className="cd-card cd-contact-info-card cd-contact-form"
      onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
    >
      <h3 className="cd-display" style={{ fontWeight: 600, fontSize: "1.125rem", marginBottom: ".25rem" }}>Send a message</h3>
      <div>
        <label htmlFor="cd-contact-name">Your Name</label>
        <input
          id="cd-contact-name"
          required
          placeholder="Full name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="cd-contact-contact">Phone or Email</label>
        <input
          id="cd-contact-contact"
          required
          placeholder="Phone number or email"
          value={form.contact}
          onChange={(e) => setForm({ ...form, contact: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="cd-contact-message">How can we help?</label>
        <textarea
          id="cd-contact-message"
          placeholder="Ask about tests, reports, packages, booking..."
          rows={4}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
        />
      </div>
      <button type="submit" className="cd-btn-primary" style={{ justifyContent: "center" }}>
        Send Message
      </button>
    </form>
  );
}
