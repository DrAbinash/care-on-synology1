import { describe, expect, test } from "vitest";
import { buildBillPrintHtml, type PrintBillData, type PrintClinic } from "./printBill";
import { buildModernLandscapeBillPrintHtml } from "./modernLandscapeBillPrint";
import {
  PAGE_SPECS,
  documentLayoutCssForPaper,
  resolvePageLayout,
} from "./documentLayout";

const sampleClinic: PrintClinic = {
  name: "Care Diagnostics",
  tagline: "Diagnostic & Pathology",
  address: "Main Road, Deoghar",
  phone: "9999999999",
  email: "care@example.com",
  logoDataUrl: "data:image/png;base64,abc",
  qrOnBillEnabled: true,
};

function sampleBill(testCount: number, extras: Partial<PrintBillData> = {}): PrintBillData {
  const tests = Array.from({ length: testCount }, (_, i) => ({
    price: 500 + i * 100,
    status: "active" as const,
    test: {
      code: `T${i + 1}`,
      name: i === 0 ? "Magnetic Resonance Imaging Whole Body Screening With Contrast" : `Test ${i + 1}`,
      category: "Radiology",
    },
  }));
  return {
    billNumber: "BILL-2026-001",
    subtotal: 5000,
    discount: 100,
    totalAmount: 4900,
    paidAmount: 4900,
    balanceAmount: 0,
    status: "paid",
    createdAt: "2026-08-01T10:30:00.000Z",
    patient: {
      firstName: "Ramesh",
      lastName: "Kumar",
      patientId: "P-1001",
      phone: "9876543210",
      gender: "M",
      ageValue: 45,
      ageUnit: "years",
    },
    order: { doctor: { name: "Dr. Sharma" }, tests },
    payments: [{ method: "upi", amount: 4900, referenceNumber: "UPI123" }],
    tokenNo: 7,
    testTokens: [{ department: "MRI", roomNumber: "2", tokenNo: 7 }],
    ...extras,
  };
}

function baseOpts(overrides: Record<string, unknown> = {}) {
  return {
    bill: sampleBill(1),
    clinic: sampleClinic,
    paperSize: "A5" as const,
    orientation: "landscape" as const,
    pageCssSize: "A5 landscape",
    isBW: false,
    qrDataUrl: "data:image/png;base64,qr",
    format: "modern-landscape" as const,
    showQr: true,
    showSignatureLine: true,
    ...overrides,
  };
}

describe("document layout engine — page specifications", () => {
  test.each([
    ["A5-landscape", "210mm 148mm", 210, 148],
    ["A5-portrait", "148mm 210mm", 148, 210],
    ["half-a4", "210mm 148mm", 210, 148],
    ["A4", "210mm 297mm", 210, 297],
  ] as const)("paper %s has exact mm dimensions", (paper, css, w, h) => {
    expect(PAGE_SPECS[paper].pageSizeCss).toBe(css);
    expect(PAGE_SPECS[paper].widthMm).toBe(w);
    expect(PAGE_SPECS[paper].heightMm).toBe(h);
  });

  test("@page margin is zero for all paper modes", () => {
    for (const paper of Object.keys(PAGE_SPECS) as Array<keyof typeof PAGE_SPECS>) {
      const css = documentLayoutCssForPaper(paper);
      expect(css).toMatch(/@page\s*\{[^}]*margin:\s*0/);
    }
  });

  test("internal safe padding defaults: 8mm A5 family, 6mm A4", () => {
    expect(resolvePageLayout("A5-landscape").safePaddingMm).toBe(8);
    expect(resolvePageLayout("A4").safePaddingMm).toBe(6);
  });

  test("generated CSS has no scale, zoom, or max-width centering", () => {
    const css = documentLayoutCssForPaper("A5-landscape");
    expect(css).not.toMatch(/transform:\s*scale/);
    expect(css).not.toMatch(/zoom:/);
    expect(css).not.toContain("margin-left: auto");
    expect(css).not.toContain("margin-right: auto");
  });

  test("compact slip on A4 enables centred slip only for patient booking mode", () => {
    const css = documentLayoutCssForPaper("A4", 6, true);
    expect(css).toContain(".care-doc-page--slip");
    expect(css).toContain("margin-left: auto");
    const normal = documentLayoutCssForPaper("A4", 6, false);
    expect(normal).not.toContain("margin-left: auto");
  });
});

describe("document layout engine — bill renderers", () => {
  test("modern landscape uses shared @page dimensions", () => {
    const html = buildModernLandscapeBillPrintHtml(baseOpts());
    expect(html).toContain("@page { size: 210mm 148mm; margin: 0; }");
    expect(html).toContain('class="care-doc-page receipt"');
    expect(html).not.toMatch(/min-height:\s*\d+mm/);
    expect(html).not.toContain("height: 100%");
  });

  test("bill number renders on the same line as Bill No.", () => {
    const html = buildModernLandscapeBillPrintHtml(baseOpts());
    expect(html).toContain("Bill No. <span");
    expect(html).toContain("2026001");
    expect(html).not.toMatch(/Bill No\.<\/div>\s*<div[^>]*>2026001/);
  });

  test.each([1, 5, 10])("%i-test bill renders without flex page spacer", (count) => {
    const html = buildModernLandscapeBillPrintHtml(
      baseOpts({ bill: sampleBill(count) }),
    );
    expect(html).not.toContain('style="flex:1"');
    expect(html).toContain("Magnetic Resonance");
  });

  test("QR enabled and disabled", () => {
    const on = buildModernLandscapeBillPrintHtml(baseOpts({ showQr: true, qrDataUrl: "data:x" }));
    const off = buildModernLandscapeBillPrintHtml(baseOpts({ showQr: false, qrDataUrl: "" }));
    expect(on).toContain("Scan to verify");
    expect(off).not.toContain("Scan to verify");
  });

  test("signature toggle", () => {
    const on = buildModernLandscapeBillPrintHtml(baseOpts({ showSignatureLine: true }));
    const off = buildModernLandscapeBillPrintHtml(baseOpts({ showSignatureLine: false }));
    expect(on).toContain("Authorised Signature");
    expect(off).not.toContain("border-bottom:1px solid #94a3b8");
  });

  test("reprint marker", () => {
    const html = buildModernLandscapeBillPrintHtml(
      baseOpts({ reprintBy: "Admin", reprintReason: "Lost copy" }),
    );
    expect(html).toContain("REPRINT");
    expect(html).toContain("Lost copy");
  });

  test("queue token on and off", () => {
    const on = buildModernLandscapeBillPrintHtml(baseOpts({ showQueueToken: true }));
    const off = buildModernLandscapeBillPrintHtml(baseOpts({ showQueueToken: false }));
    expect(on).toContain("QUEUE TOKEN");
    expect(off).not.toContain("QUEUE TOKEN");
  });

  test("large amounts and long names", () => {
    const html = buildModernLandscapeBillPrintHtml(
      baseOpts({
        bill: sampleBill(1, {
          totalAmount: 9999999.99,
          paidAmount: 9999999.99,
          balanceAmount: 0,
        }),
      }),
    );
    expect(html).toContain("99,99,999.99");
    expect(html).toContain("Magnetic Resonance");
  });

  test("classic format uses engine and percentage columns", () => {
    const html = buildBillPrintHtml({
      ...baseOpts({ format: "classic", orientation: "landscape" }),
    });
    expect(html).toContain("@page { size: 210mm 148mm; margin: 0; }");
    expect(html).toContain('width:18%');
    expect(html).not.toContain("90px");
  });

  test("retired premium/designer format ids remap to modern landscape", () => {
    for (const format of ["premium-a5", "designer-a", "designer-b", "designer-c"] as const) {
      const html = buildBillPrintHtml({
        ...baseOpts({ format: format as any }),
        paperSize: "A5",
        orientation: "landscape",
        pageCssSize: "A5 landscape",
      });
      expect(html).toMatch(/@page\s*\{[^}]*margin:\s*0/);
      expect(html).toContain("care-doc-page");
      // Modern landscape marker (shared page shell + modern header structure)
      expect(html).toContain("210mm");
    }
  });

  test("A5 landscape page box does not exceed 210mm x 148mm", () => {
    const html = buildModernLandscapeBillPrintHtml(baseOpts());
    expect(html).toContain("width: 210mm");
    expect(html).toContain("height: 148mm");
  });

  test("modern landscape does not stretch the middle row to full page height", () => {
    // height:100% / calc(100%) on the table+totals flex row left a blank
    // band on short bills; content must hug and leave the footer tight.
    const html = buildModernLandscapeBillPrintHtml(baseOpts());
    expect(html).not.toMatch(/padding-top:\d+px;height:\s*calc\(100%/);
    expect(html).not.toMatch(/padding-top:\d+px;height:\s*100%/);
    expect(html).toContain("padding-top:4px;align-items:flex-start");
  });

  test("TAT column appears when showTat is on", () => {
    const html = buildModernLandscapeBillPrintHtml(
      baseOpts({
        showTat: true,
        bill: sampleBill(1, {
          order: {
            doctor: { name: "Dr. Test" },
            tests: [
              {
                price: 500,
                status: "active",
                test: { code: "CBC", name: "CBC", category: "Pathology", duration: "4 hrs" },
              },
            ],
          },
        }),
      }),
    );
    expect(html).toContain(">TAT<");
    expect(html).toContain("4 hrs");
  });

  test("A5 portrait page box does not exceed 148mm x 210mm", () => {
    const html = buildBillPrintHtml({
      ...baseOpts({ format: "classic" }),
      orientation: "portrait",
      pageCssSize: "A5 portrait",
    });
    expect(html).toContain("width: 148mm");
    expect(html).toContain("height: 210mm");
  });

  test("A4 page box does not exceed 210mm x 297mm", () => {
    const html = buildBillPrintHtml({
      ...baseOpts({ format: "classic" }),
      paperSize: "A4",
      pageCssSize: "A4 portrait",
    });
    expect(html).toContain("width: 210mm");
    expect(html).toContain("height: 297mm");
  });

  test("no Electron print APIs in generated HTML", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).not.toContain("webContents.print");
    expect(html).not.toContain("printToPDF");
  });
});

describe("print delivery module", () => {
  test("exports iframe and popup helpers without Electron APIs", async () => {
    const mod = await import("./documentLayout/printDelivery");
    expect(typeof mod.printViaIframe).toBe("function");
    expect(typeof mod.writeAndPrint).toBe("function");
    expect(typeof mod.openBlankPrintWindow).toBe("function");
    const src = await import("fs/promises").then((fs) =>
      fs.readFile(
        new URL("./documentLayout/printDelivery.ts", import.meta.url),
        "utf8",
      ),
    );
    expect(src).not.toContain("webContents");
    expect(src).not.toContain("printToPDF");
  });
});
