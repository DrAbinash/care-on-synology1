import { describe, expect, test } from "vitest";
import { buildBillPrintHtml, buildClassicBillPrintHtml, type PrintBillData, type PrintClinic } from "./printBill";
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

describe("document layout engine — bill renderers (unified Classic)", () => {
  test("uses shared @page dimensions for A5 landscape", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("@page { size: 210mm 148mm; margin: 0; }");
    expect(html).toContain('class="care-doc-page receipt"');
  });

  test("bill number renders on the same line as Bill No.", () => {
    const html = buildBillPrintHtml(baseOpts());
    // Classic layout: BILL NO. and number are inline
    expect(html).toContain("BILL NO. <span");
    expect(html).toContain("2026001");
  });

  test.each([1, 5, 10])("%i-test bill renders correctly", (count) => {
    const html = buildBillPrintHtml(baseOpts({ bill: sampleBill(count) }));
    expect(html).toContain("Magnetic Resonance");
    expect(html).toContain("care-doc-page");
  });

  test("QR enabled and disabled", () => {
    const on = buildBillPrintHtml(baseOpts({ showQr: true, qrDataUrl: "data:x" }));
    const off = buildBillPrintHtml(baseOpts({ showQr: false, qrDataUrl: "" }));
    expect(on).toContain("Scan to verify");
    expect(off).not.toContain("Scan to verify");
  });

  test("signature line renders", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("Authorised Signature");
  });

  test("reprint marker", () => {
    const html = buildBillPrintHtml(
      baseOpts({ reprintBy: "Admin", reprintReason: "Lost copy" }),
    );
    expect(html).toContain("REPRINT");
    expect(html).toContain("Lost copy");
  });

  test("queue token box toggles with showQueueToken", () => {
    const on = buildBillPrintHtml(baseOpts({ showQueueToken: true }));
    const off = buildBillPrintHtml(baseOpts({ showQueueToken: false }));
    // Big QUEUE TOKEN box only shows when showQueueToken is true
    expect(on).toContain("QUEUE TOKEN");
    expect(off).not.toContain("QUEUE TOKEN");
    // Per-test department tokens also hidden when showQueueToken is false
    expect(off).not.toContain("Token #");
  });

  test("same room shows one token (deduped by department+room)", () => {
    const html = buildBillPrintHtml(baseOpts({
      showQueueToken: true,
      bill: sampleBill(3, {
        testTokens: [
          { department: "Pathology", roomNumber: "7", tokenNo: 5 },
          { department: "Pathology", roomNumber: "7", tokenNo: 5 }, // Same room, same token
          { department: "Radiology", roomNumber: "2", tokenNo: 3 },
        ],
      }),
    }));
    // Count occurrences of each token line
    const pathologyMatches = html.match(/<strong>Pathology<\/strong>/g) ?? [];
    const radiologyMatches = html.match(/<strong>Radiology<\/strong>/g) ?? [];
    expect(pathologyMatches.length).toBe(1); // One token for Pathology Room 7
    expect(radiologyMatches.length).toBe(1); // One token for Radiology Room 2
  });

  test("large amounts and long names", () => {
    const html = buildBillPrintHtml(
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
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("@page { size: 210mm 148mm; margin: 0; }");
    expect(html).toContain('width:18%');
    expect(html).not.toContain("90px");
  });

  test("retired format ids all map to unified template", () => {
    for (const format of ["classic", "modern-landscape", "premium-a5", "designer-a", "designer-b", "designer-c"] as const) {
      const html = buildBillPrintHtml({
        ...baseOpts({ format: format as any }),
        paperSize: "A5",
        orientation: "landscape",
        pageCssSize: "A5 landscape",
      });
      expect(html).toMatch(/@page\s*\{[^}]*margin:\s*0/);
      expect(html).toContain("care-doc-page");
      expect(html).toContain("210mm");
    }
  });

  test("A5 landscape page box does not exceed 210mm x 148mm", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("width: 210mm");
    expect(html).toContain("height: 148mm");
  });

  test("TAT column appears when showTat is on", () => {
    const html = buildBillPrintHtml(
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
      ...baseOpts(),
      orientation: "portrait",
      pageCssSize: "A5 portrait",
    });
    expect(html).toContain("width: 148mm");
    expect(html).toContain("height: 210mm");
  });

  test("A4 page box does not exceed 210mm x 297mm", () => {
    const html = buildBillPrintHtml({
      ...baseOpts(),
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
