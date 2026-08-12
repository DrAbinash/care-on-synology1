import { describe, expect, it } from "vitest";
import {
  buildProvisionalBillPrintHtml,
  formatProvisionalBillNumber,
  snapshotToPrintBillData,
  type ProvisionalBillPrintSnapshot,
} from "./provisionalBillReceipt";

const snapshot: ProvisionalBillPrintSnapshot = {
  clientRef: "11111111-2222-3333-4444-555555555555",
  provisionalBillNumber: formatProvisionalBillNumber("11111111-2222-3333-4444-555555555555"),
  patient: {
    firstName: "Test",
    lastName: "Patient",
    patientId: "P-1",
    phone: "9999999999",
    gender: "M",
    ageValue: 30,
    ageUnit: "years",
  },
  doctorName: "Dr. Test",
  tests: [{ name: "CBC", code: "CBC", price: 500, category: "Pathology" }],
  subtotal: 500,
  discount: 0,
  total: 500,
  payments: [{ mode: "cash", amount: 500 }],
};

describe("snapshotToPrintBillData online exclusion", () => {
  it("does not treat unconfirmed online as paid", () => {
    const data = snapshotToPrintBillData({
      ...snapshot,
      payments: [
        { mode: "cash", amount: 100 },
        { mode: "online", amount: 400 },
      ],
      total: 500,
    });
    expect(data.paidAmount).toBe(100);
    expect(data.balanceAmount).toBe(400);
  });
});

describe("buildProvisionalBillPrintHtml", () => {
  it("marks receipt provisional and disables QR", () => {
    const html = buildProvisionalBillPrintHtml(
      snapshot,
      { name: "Care Diagnostics", qrOnBillEnabled: true },
      {
        defaultFormat: "classic",
        defaultPaperSize: "A5-landscape",
        autoA4Threshold: 5,
        showQrCode: true,
        showSignatureLine: true,
        showComputerGenerated: true,
        showReportMessage: true,
        showServiceFooter: true,
        showBrandingFooter: true,
        showBarcode: false,
        showWatermark: false,
        showPatientInstructions: false,
        showSystemInfo: false,
        showQueueTokenOnBill: false,
        printMarginMm: null,
        printLogoHeightPx: null,
        printTitleFontPx: null,
        printPatientNameFontPx: null,
        printBodyFontPx: null,
        printHeaderFontPx: null,
        printTableFontPx: null,
        printTotalFontPx: null,
        printFooterFontPx: null,
        printTinyFontPx: null,
        defaultCopyType: "patient",
        defaultPrintAction: "save-print",
        enablePreview: false,
        directPrintAfterSave: true,
        autoOpenPrintDialog: true,
        askBeforePrint: false,
        autoDownloadPdf: false,
        fastBillingMode: true,
        adminLock: false,
        showAmountInWords: false,
      },
      false,
    );
    expect(html).toContain("Provisional Receipt");
    expect(html).toContain(snapshot.provisionalBillNumber);
    expect(html).not.toContain("Scan to verify");
  });
});
