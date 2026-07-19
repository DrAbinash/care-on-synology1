import { useEffect } from "react";
import { Phone, Mail, MapPin, ChevronLeft, Shield, Smartphone, Lock, Trash2, Users } from "lucide-react";
import type { SiteSettings } from "../types";

/**
 * Mobile-app privacy policy — the stable public URL supplied to the Google
 * Play Store ("Privacy policy" link) and referenced by the Data Safety form.
 *
 * Kept as its own route (/app-privacy) separate from the CMS-editable
 * /policies page so the URL the Play Console points at never changes when the
 * general website policies are edited. Speaks directly to what the Care
 * Diagnostics Booking app collects and does.
 */

const WORK_ADDR = "CARE DIAGNOSTICS, Subhash Chowk, Castair's Town, Near Bajla Mahila College, Deoghar–814112";
const PHONE = "9973497200";
const EMAIL = "CARE.DEOGHAR@GMAIL.COM";
const EFFECTIVE = "26/05/2026";

export default function AppPrivacyPage({ settings }: { settings: SiteSettings }) {
  const workAddr = settings.address || WORK_ADDR;
  const phone = settings.contactPhone || PHONE;
  const email = settings.contactEmail || EMAIL;

  useEffect(() => {
    document.title = "App Privacy Policy | Care Diagnostics";
    window.scrollTo(0, 0);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "hsl(var(--cd-scan-white))", color: "hsl(var(--cd-slate))" }}>
      <div className="cd-book-topbar">
        <div className="container-narrow" style={{ display: "flex", alignItems: "center", gap: ".75rem", padding: ".75rem 1rem" }}>
          <a href="/" className="cd-book-back-link">
            <ChevronLeft size={18} /> Back to Home
          </a>
        </div>
      </div>

      <div className="container-narrow" style={{ padding: "2.5rem 1rem 4rem", maxWidth: 840 }}>
        <div className="cd-policies-header">
          <h1 className="cd-display" style={{ fontSize: "1.625rem", fontWeight: 600, marginBottom: ".5rem" }}>
            Care Diagnostics Booking — App Privacy Policy
          </h1>
          <p className="cd-section-sub" style={{ fontSize: ".9375rem", margin: "0 0 1rem" }}>
            How the Care Diagnostics Booking mobile app (Android &amp; iOS) collects, uses, and protects your information.
          </p>
          <div className="cd-policies-contact-row">
            <span><MapPin size={12} /> {workAddr}</span>
            <span><Phone size={12} /> {phone}</span>
            <span><Mail size={12} /> {email}</span>
          </div>
          <p style={{ fontSize: ".78rem", color: "hsl(var(--cd-slate) / .5)", marginTop: ".5rem" }}>
            Effective Date: {EFFECTIVE}
          </p>
        </div>

        <PolicyBlock icon={<Smartphone size={18} />} title="1. Information the app collects">
          <p>The app collects only what it needs to let you book tests and view your own records:</p>
          <ul>
            <li><strong>Mobile number</strong> — used to sign you in (via a one-time code) and to find your bookings and reports.</li>
            <li><strong>Name</strong> — shown on your bookings and reports.</li>
            <li><strong>Booking details you enter</strong> — the tests/packages you select, preferred date and time slot, and any notes.</li>
            <li><strong>Payment</strong> — payments are processed by your chosen, licensed payment gateway (e.g. ICICI Orange Pay, Razorpay, PayU, PhonePe). The app does <strong>not</strong> store your card, UPI PIN, or bank credentials; those are handled directly by the gateway.</li>
          </ul>
          <p>The app does <strong>not</strong> contain third-party advertising, and does not include third-party analytics or tracking SDKs.</p>
        </PolicyBlock>

        <PolicyBlock icon={<Users size={18} />} title="2. How your information is used">
          <ul>
            <li>To create and manage your test bookings.</li>
            <li>To confirm it is you before showing your bookings and lab reports (one-time-password login).</li>
            <li>To show you your verified lab reports and let you open the report PDF.</li>
            <li>To contact you about your booking or report where necessary.</li>
          </ul>
          <p>Your health information (lab reports) is shown only to you, after you verify control of your registered mobile number.</p>
        </PolicyBlock>

        <PolicyBlock icon={<Lock size={18} />} title="3. Login, WhatsApp &amp; security">
          <ul>
            <li>Login uses a <strong>one-time code sent to your mobile number over WhatsApp</strong>. The code is time-limited and is never shown or sent back to the app.</li>
            <li>A successful login creates a secure session on our servers; the session expires after 7 days and can be ended any time by logging out.</li>
            <li>All communication between the app and our servers uses encrypted connections (HTTPS).</li>
            <li>Report files are opened through short-lived, access-checked links.</li>
          </ul>
        </PolicyBlock>

        <PolicyBlock icon={<Shield size={18} />} title="4. Sharing">
          <p>We do <strong>not</strong> sell your personal or health information, and we do <strong>not</strong> share it with third parties for advertising. Information is shared only with:</p>
          <ul>
            <li>You (and anyone you authorise);</li>
            <li>Care Diagnostics staff and reporting doctors involved in your care;</li>
            <li>The payment gateway you choose, to process your payment;</li>
            <li>WhatsApp (Meta), solely to deliver your login code;</li>
            <li>Government, legal, or regulatory authorities where required by law.</li>
          </ul>
        </PolicyBlock>

        <PolicyBlock icon={<Trash2 size={18} />} title="5. Data retention &amp; deletion">
          <p>Diagnostic and billing records are retained as required by medical record-keeping and statutory rules. You may request deletion of your app account/login data, or ask what data we hold about you, by contacting us:</p>
          <ul>
            <li>Phone: {phone}</li>
            <li>Email: {email}</li>
          </ul>
          <p>We will action verified requests within a reasonable period, subject to records we are legally required to retain.</p>
        </PolicyBlock>

        <PolicyBlock icon={<Users size={18} />} title="6. Children">
          <p>The app is intended for use by adults booking on their own behalf or on behalf of family members in their care. Where a booking or report concerns a minor, it is made by a parent, guardian, or authorised representative.</p>
        </PolicyBlock>

        <div className="cd-policies-footer">
          <p style={{ fontWeight: 600, marginBottom: ".5rem", color: "hsl(var(--cd-slate))" }}>CARE DIAGNOSTICS</p>
          <p style={{ fontSize: ".875rem", color: "hsl(var(--cd-slate) / .65)", marginBottom: ".3rem" }}>{workAddr}</p>
          <p style={{ fontSize: ".875rem", color: "hsl(var(--cd-slate) / .65)" }}>
            Phone: {phone} &nbsp;|&nbsp; Email: {email}
          </p>
          <p style={{ fontSize: ".8rem", color: "hsl(var(--cd-slate) / .5)", marginTop: ".5rem" }}>
            For our full website Privacy Policy, Terms, Refund and Cancellation policies, see{" "}
            <a href="/policies" style={{ color: "hsl(var(--cd-teal))" }}>/policies</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

function PolicyBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="cd-card cd-policy-block">
      <h2 className="cd-policy-block-title">
        {icon} {title}
      </h2>
      <div className="cd-policy-block-body">
        {children}
      </div>
    </div>
  );
}
