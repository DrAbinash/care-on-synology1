// Generate preview HTML files for the premium A5 V3 refined print
import { buildBillPrintHtml } from "../src/lib/printBill.ts";
import fs from "fs";

const outDir = "/home/runner/workspace/artifacts/diagnostic-erp/public";

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
  receiptThankYouMessage: "Thank you for choosing Care Diagnostics.",
  receiptCollectionMessage: "Please collect your reports within 7 days.",
  receiptQrMessage: "Scan QR code to verify receipt and download reports.",
  receiptPromotionalMessage: "Advanced Diagnostic & Imaging Centre.",
  serviceFooter: "[\"MRI\",\"CT Scan\",\"Ultrasound\",\"Digital X-Ray\",\"Mammography\",\"Pathology\"]",
  showFollowUpMessage: false,
  followUpMessage: "For future investigations, please quote your Patient ID.",
  showPromotionalFooter: false,
  promotionalTitle: "",
  promotionalDescription: "",
  showPatientSince: false,
  showVerifiedBadge: false,
  showAuditInfoOnPatientCopy: false,
};

const qrDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function generateBill(n, discount = 0, paymentMethod = "cash") {
  const tests = [];
  const testNames = [
    { code: "CBC001", name: "Complete Blood Count (CBC)", category: "Pathology", price: 500 },
    { code: "USG001", name: "Whole Abdomen USG", category: "Radiology", price: 800 },
    { code: "THY001", name: "Thyroid Function Test", category: "Pathology", price: 400 },
    { code: "LFT001", name: "Liver Function Test", category: "Pathology", price: 600 },
    { code: "KFT001", name: "Kidney Function Test", category: "Pathology", price: 550 },
    { code: "BMD001", name: "Bone Mineral Density", category: "Radiology", price: 900 },
    { code: "ECG001", name: "ECG", category: "Cardiology", price: 300 },
    { code: "MRI001", name: "MRI Brain", category: "Radiology", price: 3500 },
    { code: "CT001", name: "CT Chest", category: "Radiology", price: 2800 },
    { code: "XRAY001", name: "Chest X-Ray", category: "Radiology", price: 350 },
  ];
  
  for (let i = 0; i < n; i++) {
    const t = testNames[i % testNames.length];
    tests.push({
      price: t.price,
      status: "active",
      test: { code: t.code, name: t.name, category: t.category }
    });
  }
  
  const subtotal = tests.reduce((s, t) => s + t.price, 0);
  const total = subtotal - discount;
  
  return {
    billNumber: `202605${String(n).padStart(2, '0')}01`,
    subtotal,
    discount,
    taxAmount: 0,
    totalAmount: total,
    paidAmount: total,
    balanceAmount: 0,
    status: "paid",
    createdAt: "2026-05-15T10:30:00Z",
    patient: {
      firstName: "Ramesh",
      lastName: "Kumar",
      patientId: "CD-2026-001",
      phone: "+91 98765 12345",
      gender: "Male",
      dateOfBirth: "1985-03-15"
    },
    order: {
      doctor: { name: "Dr. S. Sharma" },
      tests
    },
    payments: [{
      method: paymentMethod,
      amount: total,
      referenceNumber: paymentMethod === "upi" ? "UPI-1234567890" : null,
      createdAt: "2026-05-15T10:30:00Z"
    }],
    testTokens: null,
    tokenNo: 42
  };
}

const commonOpts = {
  clinic,
  isBW: false,
  qrDataUrl,
  showQr: true,
  showAmountInWords: false,
  showSignatureLine: true,
  showComputerGenerated: true,
  showReportMessage: true,
  showServiceFooter: true,
  showBrandingFooter: true,
  showBarcode: true,
  showWatermark: true,
  showPatientInstructions: true,
  showSystemInfo: true,
};

const previews = [
  { name: "preview_v3_1_classic_1test", opts: { bill: generateBill(1), paperSize: "A5", format: "classic" } },
  { name: "preview_v3_2_premium_1test", opts: { bill: generateBill(1), paperSize: "A5", format: "premium-a5" } },
  { name: "preview_v3_3_premium_2test_discount_upi", opts: { bill: generateBill(2, 200, "upi"), paperSize: "A5", format: "premium-a5", showAmountInWords: true } },
  { name: "preview_v3_4_premium_3test", opts: { bill: generateBill(3), paperSize: "A5", format: "premium-a5" } },
  { name: "preview_v3_5_premium_5test", opts: { bill: generateBill(5), paperSize: "A5", format: "premium-a5" } },
  { name: "preview_v3_6_premium_6test", opts: { bill: generateBill(6), paperSize: "A5", format: "premium-a5" } },
  { name: "preview_v3_7_premium_10test", opts: { bill: generateBill(10), paperSize: "A5", format: "premium-a5" } },
  { name: "preview_v3_8_premium_patient_copy", opts: { bill: generateBill(2), paperSize: "A5", format: "premium-a5", copyLabel: "Patient Copy" } },
  { name: "preview_v3_9_premium_office_copy", opts: { bill: generateBill(2), paperSize: "A5", format: "premium-a5", copyLabel: "Office Copy" } },
  { name: "preview_v3_10_premium_bw", opts: { bill: generateBill(1), paperSize: "A5", format: "premium-a5", isBW: true, showBarcode: false, showWatermark: false, showPatientInstructions: false, showSystemInfo: false } },
  { name: "preview_v3_11_premium_landscape", opts: { bill: generateBill(2), paperSize: "A5-landscape", format: "premium-a5" } },
];

for (const p of previews) {
  const html = buildBillPrintHtml({ ...commonOpts, ...p.opts });
  fs.writeFileSync(`${outDir}/${p.name}.html`, html);
  console.log(`Generated: ${p.name}.html`);
}

const comparePage = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Premium A5 V3 Final Refinement</title>
<style>
body{font-family:Arial,sans-serif;padding:20px;background:#f0f0f0}
.container{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.card{background:#fff;border:1px solid #ddd;padding:10px}
.card h2{margin:0 0 10px;font-size:16px}
iframe{width:100%;height:520px;border:1px solid #ccc}
</style>
</head>
<body>
<h1>Premium A5 V3 Final Refinement — Test Gallery</h1>
<div class="container">
<div class="card"><h2>1. Classic Format (1 Test)</h2><iframe src="preview_v3_1_classic_1test.html"></iframe></div>
<div class="card"><h2>2. Premium A5 — 1 Test (Sparse)</h2><iframe src="preview_v3_2_premium_1test.html"></iframe></div>
<div class="card"><h2>3. Premium A5 — 2 Tests, Discount, UPI</h2><iframe src="preview_v3_3_premium_2test_discount_upi.html"></iframe></div>
<div class="card"><h2>4. Premium A5 — 3 Tests (Normal)</h2><iframe src="preview_v3_4_premium_3test.html"></iframe></div>
<div class="card"><h2>5. Premium A5 — 5 Tests (Normal)</h2><iframe src="preview_v3_5_premium_5test.html"></iframe></div>
<div class="card"><h2>6. Premium A5 — 6 Tests (Compact)</h2><iframe src="preview_v3_6_premium_6test.html"></iframe></div>
<div class="card"><h2>7. Premium A5 — 10 Tests (Compact/Multi-page)</h2><iframe src="preview_v3_7_premium_10test.html"></iframe></div>
<div class="card"><h2>8. Premium A5 — Patient Copy (No Audit)</h2><iframe src="preview_v3_8_premium_patient_copy.html"></iframe></div>
<div class="card"><h2>9. Premium A5 — Office Copy (With Audit)</h2><iframe src="preview_v3_9_premium_office_copy.html"></iframe></div>
<div class="card"><h2>10. Premium A5 — B&W Minimal</h2><iframe src="preview_v3_10_premium_bw.html"></iframe></div>
<div class="card"><h2>11. Premium A5 — A5 Landscape</h2><iframe src="preview_v3_11_premium_landscape.html"></iframe></div>
</div>
</body>
</html>`;

fs.writeFileSync(`${outDir}/bill-preview-v3.html`, comparePage);
console.log("Generated: bill-preview-v3.html");
