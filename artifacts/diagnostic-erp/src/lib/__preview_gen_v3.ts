import { buildBillPrintHtml } from "./printBill.ts";
import { buildPremiumBillPrintHtml } from "./premiumBillPrint.ts";
import fs from "fs";

const clinic = {
  name: "Care Diagnostics",
  tagline: "Advanced Diagnostic & Imaging Centre",
  address: "123 Health Street, Deoghar, Jharkhand 814112",
  phone: "+91 98765 43210",
  email: "care@diagnostics.com",
  website: "www.carediagnostics.com",
  gstin: "20ABCDE1234F1Z5",
  logoDataUrl: null,
  footerNote: "Thank you for choosing Care Diagnostics",
  billPrintCopies: 1,
  qrOnBillEnabled: true,
  billShowCode: true,
  billShowCategory: true,
  receiptThankYouMessage: "Thank you for choosing Care Diagnostics",
  receiptCollectionMessage: "Please collect your reports within 7 days",
  receiptQrMessage: "Scan QR code to verify receipt and download reports",
  receiptPromotionalMessage: "Advanced Diagnostic & Imaging Centre",
  serviceFooter: "[\"MRI\",\"CT Scan\",\"Ultrasound\",\"Digital X-Ray\",\"Mammography\",\"Pathology\"]",
  followUpMessage: "For future investigations, please quote your Patient ID.",
  promotionalTitle: "",
  promotionalDescription: "",
  workingHoursMessage: "Mon-Sat: 8 AM - 8 PM | Sun: 9 AM - 2 PM",
  homeCollectionMessage: "Home Collection Available. Call us to book.",
  emergencyMessage: "24x7 Emergency Services Available",
  referralProgramMessage: "Refer a friend and get 10% off your next visit.",
  healthPackagesMessage: "Annual Health Checkup packages available at discounted rates.",
  accreditationMessage: "NABL Accredited / ISO 9001:2015 Certified",
  whatsAppBookingMessage: "Book appointments on WhatsApp: +91 98765 43210",
  customFooterMessage: "",
  showAuditInfoOnPatientCopy: false,
};

const testCatalog = [
  { code: "CBC001", name: "Complete Blood Count (CBC)", category: "Pathology", price: 500 },
  { code: "USG001", name: "Whole Abdomen USG", category: "Radiology", price: 800 },
  { code: "THY001", name: "Thyroid Function Test", category: "Pathology", price: 400 },
  { code: "LIP001", name: "Lipid Profile", category: "Pathology", price: 600 },
  { code: "KFT001", name: "Kidney Function Test", category: "Pathology", price: 550 },
  { code: "LFT001", name: "Liver Function Test", category: "Pathology", price: 650 },
  { code: "XRC001", name: "Chest X-Ray", category: "Radiology", price: 300 },
  { code: "ECG001", name: "ECG (12-Lead)", category: "Cardiology", price: 250 },
  { code: "MRI001", name: "MRI Brain (Plain)", category: "Radiology", price: 4500 },
  { code: "CT001", name: "CT Scan Brain (Plain)", category: "Radiology", price: 3500 },
];

function makeBill(count: number, billNo: number, paid: boolean) {
  const tests = testCatalog.slice(0, count).map((t, i) => ({
    price: t.price,
    status: "active",
    test: { code: t.code, name: t.name, category: t.category },
  }));
  const subtotal = tests.reduce((s, t) => s + t.price, 0);
  const discount = count >= 5 ? Math.round(subtotal * 0.1) : 0;
  const total = subtotal - discount;
  return {
    billNumber: `202605${String(billNo).padStart(4, "0")}`,
    subtotal,
    discount,
    taxAmount: 0,
    totalAmount: total,
    paidAmount: paid ? total : Math.round(total * 0.6),
    balanceAmount: paid ? 0 : total - Math.round(total * 0.6),
    status: paid ? "paid" : "pending",
    createdAt: "2026-05-15T10:30:00Z",
    patient: {
      firstName: "Ramesh",
      lastName: "Kumar",
      patientId: `CD-2026-${String(billNo).padStart(3, "0")}`,
      phone: "+91 98765 12345",
      gender: "Male",
      dateOfBirth: "1985-03-15",
    },
    order: {
      doctor: { name: "Dr. S. Sharma" },
      tests,
    },
    payments: paid
      ? [{ method: "cash", amount: total, referenceNumber: null, createdAt: "2026-05-15T10:30:00Z" }]
      : [
          { method: "cash", amount: Math.round(total * 0.4), referenceNumber: null, createdAt: "2026-05-15T10:30:00Z" },
          { method: "upi", amount: Math.round(total * 0.2), referenceNumber: "UPI-1234567890", createdAt: "2026-05-15T10:30:00Z" },
        ],
    testTokens: null,
    tokenNo: 42,
  };
}

const qrDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const outDir = "/home/runner/workspace/artifacts/diagnostic-erp/public";

// Generate test previews for different counts
const counts = [1, 2, 3, 5, 6, 10];
const copies = [
  { label: "Patient Copy", copyLabel: "PATIENT COPY", showAudit: false },
  { label: "Office Copy", copyLabel: "OFFICE COPY", showAudit: true },
  { label: "Duplicate Copy", copyLabel: "DUPLICATE COPY", showAudit: true },
];
const paperSizes = [
  { label: "A5-Portrait", size: "A5-portrait" as const, width: "148mm" },
  { label: "A5-Landscape", size: "A5-landscape" as const, width: "210mm" },
];

const generated: string[] = [];

for (const count of counts) {
  for (const copy of copies) {
    for (const paper of paperSizes) {
      const bill = makeBill(count, count + 1, true);
      const html = buildPremiumBillPrintHtml({
        bill: bill as any,
        clinic: clinic as any,
        paperSize: paper.size,
        isBW: false,
        qrDataUrl,
        copyLabel: copy.copyLabel,
        showQr: true,
        showAmountInWords: true,
        showSignatureLine: true,
        showComputerGenerated: true,
        showReportMessage: true,
        showServiceFooter: true,
        showBrandingFooter: true,
        showBarcode: true,
        showWatermark: true,
        showPatientInstructions: true,
        showSystemInfo: true,
        showReceiptThankYou: true,
        showReceiptCollection: true,
        showReceiptQrMessage: true,
        showReceiptPromotional: true,
        showVerifiedBadge: true,
        showFollowUpMessage: true,
        showPatientSince: true,
        showPromotionalFooter: true,
        showWorkingHours: true,
        showHomeCollection: true,
        showEmergency: true,
        showReferralProgram: true,
        showHealthPackages: true,
        showAccreditation: true,
        showWhatsAppBooking: true,
        showCustomFooterMessage: true,
      });
      const filename = `preview_v3_${count}test_${copy.label.toLowerCase().replace(/\s+/g, "_")}_${paper.label.toLowerCase().replace(/\s+/g, "_")}.html`;
      fs.writeFileSync(`${outDir}/${filename}`, html);
      generated.push(filename);
    }
  }
}

// Index page
const indexHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>V3 Premium A5 Bill Preview</title>
<style>
body{font-family:Arial,sans-serif;padding:20px;background:#f0f0f0}
.container{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:16px}
.card{background:#fff;border:1px solid #ddd;padding:10px;border-radius:4px}
.card h2{margin:0 0 8px;font-size:14px;color:#333}
.card .meta{font-size:11px;color:#666;margin-bottom:6px}
iframe{width:100%;height:480px;border:1px solid #ccc;border-radius:2px}
</style>
</head>
<body>
<h1>V3 Premium A5 Bill Print Preview</h1>
<div class="container">
${generated.map(f => {
  const parts = f.replace("preview_v3_", "").replace(".html", "").split("_");
  const count = parts[0];
  const copy = parts[1];
  const paper = parts[2];
  return `<div class="card">
    <h2>${count} — ${copy} — ${paper}</h2>
    <div class="meta">${f}</div>
    <iframe src="${f}"></iframe>
  </div>`;
}).join("\n")}
</div>
</body>
</html>`;

fs.writeFileSync(`${outDir}/bill-preview-v3.html`, indexHtml);
console.log("Generated", generated.length, "previews");
console.log(generated.join("\n"));
