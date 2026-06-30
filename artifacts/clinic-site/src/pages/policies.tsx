import { useEffect } from "react";
import { Phone, Mail, MapPin, ChevronLeft, Shield, FileText, RotateCcw, XCircle } from "lucide-react";
import type { SiteSettings } from "../types";

const WORK_ADDR = "CARE DIAGNOSTICS, Subhash Chowk, Castair's Town, Near Bajla Mahila College, Deoghar\u2013814112";
const REG_ADDR = "Jayshankar Bhawan, Bilasi Town, Deoghar, Ward No. 27, Hiralal Pal Road, Deoghar, Jharkhand \u2013 814112";
const PHONE = "9973497200";
const EMAIL = "CARE.DEOGHAR@GMAIL.COM";

export default function PoliciesPage({ settings }: { settings: SiteSettings }) {
  const workAddr = settings.address || WORK_ADDR;
  const regAddr = settings.registeredAddress || REG_ADDR;
  const phone = settings.contactPhone || PHONE;
  const email = settings.contactEmail || EMAIL;

  useEffect(() => {
    document.title = "Policies | Care Diagnostics";
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
          <h1 className="cd-display" style={{ fontSize: "1.625rem", fontWeight: 600, marginBottom: ".5rem" }}>CARE DIAGNOSTICS</h1>
          <p className="cd-section-sub" style={{ fontSize: ".9375rem", margin: "0 0 1rem" }}>
            Privacy Policy, Terms &amp; Conditions, Refund Policy and Cancellation Policy
          </p>
          <div className="cd-policies-contact-row">
            <span><MapPin size={12} /> {workAddr}</span>
            <span><Phone size={12} /> {phone}</span>
            <span><Mail size={12} /> {email}</span>
          </div>
          <p style={{ fontSize: ".78rem", color: "hsl(var(--cd-slate) / .5)", marginTop: ".5rem" }}>
            Owned By: Dr. Sugandha Priyadarshini &nbsp;|&nbsp; Effective Date: 26/05/2026
          </p>
          <p style={{ fontSize: ".72rem", color: "hsl(var(--cd-slate) / .4)", marginTop: ".25rem" }}>
            <strong>Registered Address:</strong> {regAddr}
          </p>
        </div>

        {/* 1. PRIVACY POLICY */}
        <PolicyBlock icon={<Shield size={18} />} title="1. Privacy Policy">
          <p>CARE DIAGNOSTICS respects the privacy, dignity, and confidentiality of every patient. By booking an appointment, making payment, or using any service, the patient agrees to this Privacy Policy.</p>

          <h4>1.1 Information Collected</h4>
          <ul>
            <li><strong>Personal:</strong> Name, age, gender, address, mobile, email, patient ID, bill number.</li>
            <li><strong>Medical:</strong> Clinical history, symptoms, prescriptions, previous reports, diagnostic images, scan data, pathology values.</li>
            <li><strong>Billing:</strong> Test charges, payment mode, receipt number, transaction ID, refund records.</li>
            <li><strong>Digital:</strong> WhatsApp, SMS, email, portal usage, QR code access.</li>
          </ul>

          <h4>1.2 Purpose</h4>
          <p>Patient information is used for registration, appointments, diagnostic investigations, report preparation/sharing, billing, payment, refunds, audits, communication, and legal/statutory requirements.</p>

          <h4>1.3 Consent</h4>
          <p>By availing services, the patient consents to collection, processing, storage, and use of information for diagnostic, billing, legal, administrative, and communication purposes. For minors or unconscious patients, consent may be given by a parent, guardian, or authorized representative.</p>

          <h4>1.4 Confidentiality</h4>
          <p>Patient information is shared only with: the patient/authorized attendant, referring/treating doctor, involved hospital/clinic, authorized CARE DIAGNOSTICS staff, reporting doctors, and government/legal/regulatory authorities when required.</p>

          <h4>1.5 Report Sharing</h4>
          <p>Reports are shared via physical copy, WhatsApp, email, SMS link, online portal, or QR code. The patient/attendant is responsible for providing correct contact details. CARE DIAGNOSTICS is not responsible for delivery to incorrect numbers or emails provided by the patient.</p>

          <h4>1.6 Data Storage &amp; Security</h4>
          <p>Records are stored in physical and/or digital form with reasonable protection. However, no digital platform can be guaranteed completely secure. Patients choosing digital delivery accept inherent risks.</p>

          <h4>1.7 Retention</h4>
          <p>Records may be retained for medical, legal, accounting, administrative, insurance, and statutory purposes. Old records may be archived, transferred, or deleted as per applicable law or storage limitations.</p>

          <h4>1.8 Patient Rights</h4>
          <p>Patients may request copies of reports, correction of demographic errors, and clarification on information use. Medical findings and report impressions cannot be changed unless reviewed and approved through proper correction/addendum/amendment process.</p>

          <h4>1.9 Third-Party Services</h4>
          <p>CARE DIAGNOSTICS uses third-party software, payment gateways, cloud services, PACS/RIS/LIS/ERP systems, and messaging services. It shall not be responsible for technical failure, downtime, cyberattack, or data issues caused by third parties beyond its reasonable control.</p>

          <h4>1.10 Grievance / Contact</h4>
          <p>For concerns, contact: <strong>CARE DIAGNOSTICS</strong>, {workAddr}. Phone: {phone}. Email: {email}. Owned By: Dr. Sugandha Priyadarshini.</p>
        </PolicyBlock>

        {/* 2. TERMS & CONDITIONS */}
        <PolicyBlock icon={<FileText size={18} />} title="2. Terms & Conditions">
          <h4>2.1 Services</h4>
          <p>CARE DIAGNOSTICS provides radiology, imaging, laboratory/pathology, ultrasound, Doppler, X-ray, CT, MRI, and other diagnostic investigations as available at the center.</p>

          <h4>2.2 Appointment &amp; Registration</h4>
          <ul>
            <li>Appointment timing is approximate and may change due to emergencies or technical issues.</li>
            <li>Patients must provide correct name, age, gender, mobile, clinical history, and prescriptions.</li>
            <li>Certain tests require fasting, full bladder, creatinine report, allergy history, consent, or other preparation.</li>
          </ul>

          <h4>2.3 Payment Terms (100% Advance)</h4>
          <ul>
            <li>Full payment must be made before any test.</li>
            <li>No dues, part payment, or credit facility is available.</li>
            <li>Booking is confirmed only after full payment.</li>
            <li>Reports may be withheld if payment or formalities are incomplete.</li>
          </ul>

          <h4>2.4 Patient Responsibility</h4>
          <ul>
            <li>Provide correct patient details and clinical history.</li>
            <li>Bring valid prescription and previous reports.</li>
            <li>Inform staff about pregnancy, kidney disease, allergy, asthma, diabetes, hypertension, implants, pacemakers, or any relevant condition.</li>
            <li>Follow test preparation instructions and reach on time.</li>
          </ul>

          <h4>2.5 Diagnostic Limitations</h4>
          <p>Reports are based on clinical details, sample/image quality, and patient cooperation. Some cases may require repeat scans, contrast studies, additional samples, follow-up, specialist review, or clinical correlation. No specific diagnosis or clinical outcome is guaranteed.</p>

          <h4>2.6 Report Delivery</h4>
          <p>Delivery times are approximate and may be delayed due to emergencies, technical issues, poor cooperation, or specialist review requirements. CARE DIAGNOSTICS makes reasonable efforts to provide reports on time but is not liable for unavoidable delays.</p>

          <h4>2.7 Right to Refuse / Reschedule</h4>
          <p>CARE DIAGNOSTICS may refuse, stop, postpone, or reschedule any test if: unsafe for the patient, preparation incomplete, consent missing, patient uncooperative/violent, payment incomplete, or service unavailable.</p>

          <h4>2.8 Report Correction</h4>
          <p>Spelling, age, gender, or clerical errors should be reported immediately. Medical corrections require proper review and approval by the concerned reporting doctor.</p>

          <h4>2.9 Use of Reports</h4>
          <p>Reports are meant for the patient and treating/referring doctor. Patients should consult their doctor for final diagnosis and treatment. CARE DIAGNOSTICS is not responsible for misuse or unauthorized sharing by third parties.</p>

          <h4>2.10 Conduct</h4>
          <p>Abuse, violence, damage, unauthorized photography, or disturbance will not be tolerated and may invite legal action.</p>

          <h4>2.11 Limitation of Liability</h4>
          <p>CARE DIAGNOSTICS is not liable for indirect loss, inconvenience, delay, treatment decisions, financial loss, third-party errors, internet/payment gateway failures, or unavoidable technical/medical limitations.</p>

          <h4>2.12 Jurisdiction</h4>
          <p>Any dispute is subject to the jurisdiction of competent courts/authorities at Deoghar, Jharkhand.</p>
        </PolicyBlock>

        {/* 3. REFUND POLICY */}
        <PolicyBlock icon={<RotateCcw size={18} />} title="3. Refund Policy">
          <h4>3.1 100% Advance Payment</h4>
          <p>100% advance payment is mandatory. No dues, credit, or part payment facility is available.</p>

          <h4>3.2 Refund Eligibility</h4>
          <p>Refund may be considered only when:</p>
          <ul>
            <li>Patient cancels before the test is performed.</li>
            <li>CARE DIAGNOSTICS is unable to provide the service due to machine breakdown or unavoidable operational reason.</li>
            <li>Duplicate or excess payment is confirmed.</li>
            <li>Wrong billing entry is confirmed by CARE DIAGNOSTICS.</li>
          </ul>

          <h4>3.3 Standard Refund Deduction</h4>
          <p>For patient-initiated cancellation: <strong>30% of the booked amount shall be deducted</strong> as cancellation/administrative/slot-blocking charges. Only <strong>70%</strong> is eligible for refund.</p>
          <p><em>Example:</em> Booked amount ₹10,000 → 30% deduction (₹3,000) → Maximum refund ₹7,000.</p>

          <h4>3.4 No Refund Conditions</h4>
          <p>Refund is <strong>not applicable</strong> when:</p>
          <ul>
            <li>Test has already been performed, sample collected, or scan started/completed.</li>
            <li>Report has been generated, printed, uploaded, or shared.</li>
            <li>Patient is a no-show without prior cancellation.</li>
            <li>Patient refuses the test after arrangements have been made.</li>
            <li>Patient fails to follow preparation instructions or provides incorrect information.</li>
            <li>Poor image quality due to patient movement or non-cooperation.</li>
            <li>Cancellation due to undisclosed allergy, pregnancy, implant, or contraindication.</li>
          </ul>

          <h4>3.5 Duplicate / Excess Payment</h4>
          <p>Genuine duplicate or excess payments may be refunded after verification. The 30% deduction may not apply if the excess is clearly due to duplication or billing error.</p>

          <h4>3.6 Processing Time</h4>
          <p>Approved refunds are processed within <strong>7 to 15 working days</strong>, depending on payment mode and bank processing time. Refund is made to the original payment account.</p>

          <h4>3.7 Documents Required</h4>
          <ul>
            <li>Original receipt/bill.</li>
            <li>Patient ID or booking ID.</li>
            <li>Payment proof or transaction ID.</li>
            <li>Valid ID proof, if required.</li>
            <li>Bank account / UPI details.</li>
            <li>Written refund or cancellation request.</li>
          </ul>

          <h4>3.8 Final Decision</h4>
          <p>All refund requests are subject to verification and approval by CARE DIAGNOSTICS management. The decision is final, subject to applicable law.</p>
        </PolicyBlock>

        {/* 4. CANCELLATION POLICY */}
        <PolicyBlock icon={<XCircle size={18} />} title="4. Cancellation Policy">
          <h4>4.1 Cancellation by Patient</h4>
          <p>A patient may request cancellation before the test is performed. Request may be made at reception or through official contact number, WhatsApp, email, or approved booking channel.</p>
          <p>For all patient-initiated cancellations: <strong>30% deduction applies</strong>. Balance 70% may be refunded after verification.</p>

          <h4>4.2 Cancellation After Slot Blocking</h4>
          <p>Once a slot, machine time, staff time, or consumable arrangement is blocked, cancellation attracts the standard 30% deduction.</p>

          <h4>4.3 No-Show Policy</h4>
          <p>If the patient does not report at the scheduled time and does not cancel in advance, the booking is treated as a <strong>No-Show</strong>. Refund may be denied. If approved in special circumstances, the 30% deduction applies.</p>

          <h4>4.4 Rescheduling</h4>
          <p>Rescheduling is allowed subject to availability. One rescheduling request may be allowed without deduction if made before the scheduled time and before the test process starts. Repeated or late rescheduling may be treated as cancellation with 30% deduction.</p>

          <h4>4.5 Cancellation by CARE DIAGNOSTICS</h4>
          <p>CARE DIAGNOSTICS may cancel due to machine breakdown, power failure, emergency priority, doctor unavailability, technical issues, safety concerns, natural calamity, or consumable non-availability. In genuine center-side cancellations, deduction may be waived and refund processed after management approval.</p>

          <h4>4.6 Cancellation Due to Patient Safety</h4>
          <p>If a test is cancelled because it is unsafe (allergy, pregnancy risk, implant issue, renal impairment, lack of consent), refund eligibility is decided by management considering expenses already incurred.</p>

          <h4>4.7 No Part Payment / No Dues</h4>
          <p>Full payment is mandatory before booking. Reports may not be released without full payment. Cancellation/refund is calculated on the amount actually paid.</p>
        </PolicyBlock>

        {/* 5. PATIENT DECLARATION */}
        <PolicyBlock icon={<Shield size={18} />} title="5. Patient / Attendant Declaration">
          <p>I/we confirm that I/we have read, understood, and agreed to the Privacy Policy, Terms &amp; Conditions, Refund Policy, and Cancellation Policy of CARE DIAGNOSTICS.</p>
          <p>I/we understand and agree that:</p>
          <ul>
            <li>100% advance payment is mandatory.</li>
            <li>No dues or part payment facility is available.</li>
            <li>Patient-initiated cancellation involves 30% deduction.</li>
            <li>Only 70% may be refundable after verification and approval.</li>
            <li>No refund once test/scan/report process has started or report shared.</li>
            <li>Patient data may be collected, processed, stored, and shared for diagnostic, billing, legal, and operational purposes.</li>
            <li>Diagnostic reports must be clinically correlated by the treating/referring doctor.</li>
          </ul>
          <p style={{ marginTop: "1.5rem", fontSize: ".85rem", color: "hsl(var(--site-muted-fg))" }}>
            Effective Date: 26/05/2026
          </p>
        </PolicyBlock>

        {/* Footer contact */}
        <div className="cd-policies-footer">
          <p style={{ fontWeight: 600, marginBottom: ".5rem", color: "hsl(var(--cd-slate))" }}>CARE DIAGNOSTICS</p>
          <p style={{ fontSize: ".875rem", color: "hsl(var(--cd-slate) / .65)", marginBottom: ".3rem" }}>{workAddr}</p>
          <p style={{ fontSize: ".75rem", color: "hsl(var(--cd-slate) / .45)" }}>
            <strong>Registered Address:</strong> {regAddr}
          </p>
          <p style={{ fontSize: ".875rem", color: "hsl(var(--cd-slate) / .65)" }}>
            Phone: {phone} &nbsp;|&nbsp; Email: {email} &nbsp;|&nbsp; Owned By: Dr. Sugandha Priyadarshini
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
