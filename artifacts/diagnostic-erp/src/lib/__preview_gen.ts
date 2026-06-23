
  import { buildBillPrintHtml } from "./printBill.ts";
  import { buildPremiumBillPrintHtml } from "./premiumBillPrint.ts";

  const clinic = {"name":"Care Diagnostics","tagline":"Advanced Diagnostic & Imaging Centre","address":"123 Health Street, Deoghar, Jharkhand 814112","phone":"+91 98765 43210","email":"care@diagnostics.com","website":"www.carediagnostics.com","gstin":"20ABCDE1234F1Z5","logoDataUrl":null,"footerNote":"Thank you for choosing Care Diagnostics","billPrintCopies":1,"qrOnBillEnabled":true,"billShowCode":true,"billShowCategory":true,"receiptThankYouMessage":"Thank you for choosing Care Diagnostics","receiptCollectionMessage":"Please collect your reports within 7 days","receiptQrMessage":"Scan QR code to verify receipt and download reports","receiptPromotionalMessage":"Advanced Diagnostic & Imaging Centre","serviceFooter":"[\"MRI\",\"CT Scan\",\"Ultrasound\",\"Digital X-Ray\",\"Mammography\",\"Pathology\"]","followUpMessage":"For future investigations, please quote your Patient ID","promotionalTitle":"","promotionalDescription":"","workingHoursMessage":"Mon-Sat: 8 AM - 8 PM | Sun: 9 AM - 2 PM","homeCollectionMessage":"Home Collection Available. Call us to book.","emergencyMessage":"24x7 Emergency Services Available","referralProgramMessage":"Refer a friend and get 10% off your next visit.","healthPackagesMessage":"Annual Health Checkup packages available at discounted rates.","accreditationMessage":"NABL Accredited / ISO 9001:2015 Certified","whatsAppBookingMessage":"Book appointments on WhatsApp: +91 98765 43210","customFooterMessage":""};
  const bill1 = {"billNumber":"2026050001","subtotal":500,"discount":0,"taxAmount":0,"totalAmount":500,"paidAmount":500,"balanceAmount":0,"status":"paid","createdAt":"2026-05-15T10:30:00Z","patient":{"firstName":"Ramesh","lastName":"Kumar","patientId":"CD-2026-001","phone":"+91 98765 12345","gender":"Male","dateOfBirth":"1985-03-15"},"order":{"doctor":{"name":"Dr. S. Sharma"},"tests":[{"price":500,"status":"active","test":{"code":"CBC001","name":"Complete Blood Count (CBC)","category":"Pathology"}}]},"payments":[{"method":"cash","amount":500,"referenceNumber":null,"createdAt":"2026-05-15T10:30:00Z"}],"testTokens":null,"tokenNo":42};
  const bill2 = {"billNumber":"2026050002","subtotal":1200,"discount":200,"taxAmount":0,"totalAmount":1000,"paidAmount":1000,"balanceAmount":0,"status":"paid","createdAt":"2026-05-15T14:20:00Z","patient":{"firstName":"Priya","lastName":"Singh","patientId":"CD-2026-002","phone":"+91 87654 32109","gender":"Female","dateOfBirth":"1992-07-20"},"order":{"doctor":{"name":"Dr. A. Gupta"},"tests":[{"price":800,"status":"active","test":{"code":"USG001","name":"Whole Abdomen USG","category":"Radiology"}},{"price":400,"status":"active","test":{"code":"THY001","name":"Thyroid Function Test","category":"Pathology"}}]},"payments":[{"method":"upi","amount":1000,"referenceNumber":"UPI-1234567890","createdAt":"2026-05-15T14:20:00Z"}],"testTokens":[{"department":"Radiology","roomNumber":"USG-1","tokenNo":15},{"department":"Pathology","roomNumber":"LAB-2","tokenNo":28}],"tokenNo":15};
  const qrDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  // Preview 1: Classic format, 1 test
  const html1 = buildBillPrintHtml({
    bill: bill1,
    clinic,
    paperSize: "A5",
    isBW: false,
    qrDataUrl,
    format: "classic",
    showQr: true,
    showAmountInWords: false,
    showSignatureLine: true,
    showComputerGenerated: true,
    showReportMessage: true,
    showServiceFooter: true,
    showBrandingFooter: true,
  });

  // Preview 2: Premium A5 V2 format, 1 test (all new features ON)
  const html2 = buildBillPrintHtml({
    bill: bill1,
    clinic,
    paperSize: "A5",
    isBW: false,
    qrDataUrl,
    format: "premium-a5",
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
    showWorkingHours: false,
    showHomeCollection: false,
    showEmergency: true,
    showReferralProgram: false,
    showHealthPackages: false,
    showAccreditation: false,
    showWhatsAppBooking: true,
    showCustomFooterMessage: false,
  });

  // Preview 3: Premium A5 V2 format, 2 tests, discount, UPI
  const html3 = buildBillPrintHtml({
    bill: bill2,
    clinic,
    paperSize: "A5",
    isBW: false,
    qrDataUrl,
    format: "premium-a5",
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
  });

  // Preview 4: Premium A5 V2 format, 1 test, B&W mode
  const html4 = buildBillPrintHtml({
    bill: bill1,
    clinic,
    paperSize: "A5",
    isBW: true,
    qrDataUrl,
    format: "premium-a5",
    showQr: true,
    showAmountInWords: false,
    showSignatureLine: true,
    showComputerGenerated: true,
    showReportMessage: true,
    showServiceFooter: true,
    showBrandingFooter: true,
    showBarcode: false,
    showWatermark: false,
    showPatientInstructions: false,
    showSystemInfo: false,
  });

  import fs from "fs";
  const outDir = "/home/runner/workspace/artifacts/diagnostic-erp/public";
  fs.writeFileSync(`${outDir}/preview_v2_1_premium_1test.html`, html2);
  fs.writeFileSync(`${outDir}/preview_v2_2_premium_2test.html`, html3);
  fs.writeFileSync(`${outDir}/preview_v2_3_premium_bw.html`, html4);
  fs.writeFileSync(`${outDir}/preview_v2_4_classic.html`, html1);

  // Side-by-side comparison page
  const comparePage = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Premium A5 V2 Comparison</title>
<style>body{font-family:Arial,sans-serif;padding:20px;background:#f0f0f0}
.container{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.card{background:#fff;border:1px solid #ddd;padding:10px}
.card h2{margin:0 0 10px;font-size:16px}
iframe{width:100%;height:520px;border:1px solid #ccc}</style>
</head>
<body>
<h1>Premium A5 V2 — Side-by-Side Comparison</h1>
<div class="container">
<div class="card"><h2>1 Test (Sparse Mode) — All Features ON</h2><iframe src="preview_v2_1_premium_1test.html"></iframe></div>
<div class="card"><h2>2 Tests (Normal Mode) — All Features ON</h2><iframe src="preview_v2_2_premium_2test.html"></iframe></div>
<div class="card"><h2>1 Test (Sparse Mode) — B&W, Minimal</h2><iframe src="preview_v2_3_premium_bw.html"></iframe></div>
<div class="card"><h2>Classic Format (Unchanged)</h2><iframe src="preview_v2_4_classic.html"></iframe></div>
</div>
</body>
</html>`;
  fs.writeFileSync(`${outDir}/bill-preview-v2.html`, comparePage);

  console.log("Done — 4 previews + comparison page generated");
  