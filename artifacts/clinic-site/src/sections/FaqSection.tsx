import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Section, Faq } from "../types";
import { api } from "../api";

function get(c: Record<string, unknown>, k: string, fb = ""): string {
  return typeof c[k] === "string" ? (c[k] as string) : fb;
}

const DEFAULT_FAQS: Faq[] = [
  { id: 1, question: "Do I need an appointment for MRI or CT scan?", answer: "Yes, we recommend booking in advance to ensure your preferred time slot. You can book online through our website or call/WhatsApp us at 9973497200. Walk-ins are also accommodated based on availability.", orderIndex: 0, enabled: true },
  { id: 2, question: "Can I book tests online and pay digitally?", answer: "Yes! You can book tests and health packages online through our Book Test section. We support secure online payment via Orange Pay (cards, UPI, net banking) and PayU. You can also pay at the center in cash or card.", orderIndex: 1, enabled: true },
  { id: 3, question: "Do you offer home sample collection?", answer: "Yes, we offer convenient home blood and urine sample collection for most pathology tests in and around Deoghar. Please call or WhatsApp us at 9973497200 to schedule a home collection visit.", orderIndex: 2, enabled: true },
  { id: 4, question: "How will I receive my diagnostic report?", answer: "Reports are available digitally via our patient portal and can also be shared directly on WhatsApp or email. Hard copies are provided at the center. Most pathology results are ready same day, and imaging reports within 24 hours.", orderIndex: 3, enabled: true },
  { id: 5, question: "What are your opening hours?", answer: "We are open Monday to Saturday from 7:00 AM to 9:00 PM. Emergency imaging requests can be discussed by calling us directly at 9973497200.", orderIndex: 4, enabled: true },
  { id: 6, question: "Do you offer health packages for families?", answer: "Yes, we offer a range of preventive health packages — Basic Health Checkup, Diabetes Care, Senior Citizen, Heart Care, Women's Health and Full Body Screening packages. Visit our Health Packages section or call us for current pricing.", orderIndex: 5, enabled: true },
  { id: 7, question: "How do I access my old reports?", answer: "You can access all your past reports through our patient portal at /erp/portal. Log in with your registered mobile number and PIN. Reports can be downloaded or shared directly from the portal.", orderIndex: 6, enabled: true },
  { id: 8, question: "Can I contact you on WhatsApp for queries?", answer: "Absolutely. WhatsApp us at 9973497200 for queries, to share prescriptions, get report clarifications or book appointments. Our team typically responds within a few minutes during working hours.", orderIndex: 7, enabled: true },
];

export default function FaqSection({ section }: { section: Section }) {
  const c = section.config;
  const heading = get(c, "heading", "Frequently Asked Questions");
  const sub     = get(c, "subheading", "Everything you need to know before your visit.");
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [open, setOpen]  = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.faqs()
      .then((d) => {
        const enabled = (d.faqs || []).filter((f) => f.enabled);
        setFaqs(enabled.length > 0 ? enabled : DEFAULT_FAQS);
      })
      .catch(() => setFaqs(DEFAULT_FAQS))
      .finally(() => setLoaded(true));
  }, []);

  const toggle = (id: number) => setOpen((prev) => (prev === id ? null : id));

  return (
    <section className="section">
      <div className="container-narrow" style={{ maxWidth: 780 }}>
        <div className="text-center" style={{ marginBottom: "2.5rem" }}>
          <div className="section-eyebrow" style={{ display: "inline-flex" }}>FAQ</div>
          <h2 className="h-section" style={{ marginBottom: ".5rem" }}>{heading}</h2>
          {sub && <p className="subtle">{sub}</p>}
        </div>

        {!loaded ? (
          <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ height: 56, background: "hsl(var(--site-muted))", borderRadius: "var(--site-radius)", animation: "shimmer 1.5s infinite", backgroundSize: "200% 100%", backgroundImage: "linear-gradient(90deg, hsl(var(--site-muted)) 0%, hsl(var(--site-bg)) 50%, hsl(var(--site-muted)) 100%)" }} />
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: ".65rem" }}>
            {faqs.map((f) => (
              <div key={f.id} className={`faq-item${open === f.id ? " open" : ""}`}>
                <button
                  className="faq-trigger"
                  onClick={() => toggle(f.id)}
                  aria-expanded={open === f.id}
                >
                  <span>{f.question}</span>
                  <ChevronDown size={18} className="faq-chevron" aria-hidden="true" />
                </button>
                {open === f.id && (
                  <div className="faq-body">{f.answer}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
