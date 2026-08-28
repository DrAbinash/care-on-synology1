import { describe, expect, test } from "vitest";
import { buildBillPrintHtml, buildBillAuditToken, buildBillAuditHash, buildBillVerifyUrl, type PrintBillData, type PrintClinic } from "./printBill";
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
    billFormat: "hope-a5" as const,
    paperSize: "A5" as const,
    orientation: "portrait" as const,
    pageCssSize: "148mm 210mm",
    isBW: false,
    qrDataUrl: "data:image/png;base64,qr",
    showQr: true,
    showSignatureLine: true,
    ...overrides,
  };
}

describe("document layout engine — page specifications", () => {
  test.each([
    ["A5-landscape", "A5 landscape", 210, 148],
    ["A5-portrait", "A5 portrait", 148, 210],
    ["half-a4", "A5 landscape", 210, 148],
    ["A4", "A4 portrait", 210, 297],
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

  test("internal safe padding defaults use page width without wasting side space", () => {
    expect(resolvePageLayout("A5-landscape").safePaddingMm).toBe(4);
    expect(resolvePageLayout("half-a4").safePaddingMm).toBe(4);
    expect(resolvePageLayout("A4").safePaddingMm).toBe(4);
    expect(resolvePageLayout("A5-portrait").safePaddingMm).toBe(8);
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
  test("two physical copies render two pages with patient/office labels", () => {
    const html = buildBillPrintHtml(baseOpts({
      clinic: {
        ...sampleClinic,
        billPrintSettingsJson: JSON.stringify({ defaultCopyType: "both" }),
      },
    }));
    expect((html.match(/class="care-doc-page receipt"/g) ?? []).length).toBe(2);
    expect(html).toContain("Patient Copy");
    expect(html).toContain("Office Copy");
    const multiCss = documentLayoutCssForPaper("A5-portrait", null, false, true);
    expect(multiCss).toContain("max-height: none");
    expect(multiCss).toContain("overflow: visible");
  });

  test("legacy bill_print_copies=2 still yields two pages when JSON has no copy type", () => {
    const html = buildBillPrintHtml(baseOpts({
      clinic: { ...sampleClinic, billPrintCopies: 2 },
    }));
    expect((html.match(/class="care-doc-page receipt"/g) ?? []).length).toBe(2);
  });

  test("uses named A5 portrait @page so Chrome selects A5, not A4 landscape", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("@page { size: A5 portrait; margin: 0; }");
    expect(html).not.toMatch(/@page \{ size: 210mm 297mm/);
    expect(html).not.toMatch(/@page \{ size: A4/);
    expect(html).toContain('class="care-doc-page receipt"');
    expect(html).toContain("height: 210mm");
    expect(html).toContain("width: 148mm");
  });

  test("bill number renders in HOPE meta grid with Receipt title", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("Bill No.");
    expect(html).toContain("2026001");
    expect(html).toContain(">Receipt<");
    const titleIdx = html.indexOf(">Receipt<");
    const billNoIdx = html.indexOf("Bill No.");
    const dateIdx = html.indexOf("Date &amp; Time");
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(dateIdx).toBeGreaterThan(titleIdx);
    expect(billNoIdx).toBeGreaterThan(titleIdx);
  });

  test("HOPE meta labels are present (not modern INVOICE header)", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("UHID");
    expect(html).toContain("Patient");
    expect(html).toContain("Gender / Age");
    expect(html).toContain("Mobile");
    expect(html).toContain("Ref. By");
    expect(html).not.toContain(">INVOICE<");
  });

  test("enterprise audit token is present on the bill", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain('title="Audit token"');
    expect(html).toMatch(/2026001-\d+-4900\.00-\d+-[0-9A-F]{8}/);
  });

  test("financial block and footer have page-break-inside:avoid", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("page-break-inside: avoid");
    expect(html).toContain("financial-block");
    expect(html).toContain("receipt-footer");
  });

  test("balance row uses alert styling when unpaid", () => {
    const unpaid = buildBillPrintHtml(baseOpts({
      bill: sampleBill(1, { balanceAmount: 500, paidAmount: 4400 }),
    }));
    expect(unpaid).toContain("#fef2f2");
    expect(unpaid).toContain("#b91c1c");
    const paid = buildBillPrintHtml(baseOpts({
      bill: sampleBill(1, { balanceAmount: 0, paidAmount: 4900 }),
    }));
    expect(paid).toContain("#f0fdf4");
    expect(paid).toContain("#15803d");
  });

  test("currency amounts always show two decimal places", () => {
    const html = buildBillPrintHtml(baseOpts({
      bill: sampleBill(1, { subtotal: 1500, totalAmount: 1500, paidAmount: 1500 }),
    }));
    expect(html).toContain("1,500.00");
  });

  test("CARE totals map to HOPE labels (Grand Total / Net / Paid / Balance)", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("Grand Total:");
    expect(html).toContain("Bill Discount:");
    expect(html).toContain("Net Amount:");
    expect(html).toContain("Paid:");
    expect(html).toContain("Balance:");
    expect(html).toContain("5,000.00");
    expect(html).toContain("100.00");
    expect(html).toContain("4,900.00");
  });

  test("clinic address appears in centered HOPE header", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("Main Road, Deoghar");
    expect(html).toContain("Care Diagnostics");
    expect(html).toContain("care@example.com");
  });

  test("referring doctor appears under Ref. By", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toMatch(/Ref\. By[\s\S]*?Dr\.\s*Sharma/i);
  });

  test("page padding is equal on left and right", () => {
    const html = buildBillPrintHtml(baseOpts({ printMarginMm: 10 }));
    expect(html).toContain("padding-left: 10mm");
    expect(html).toContain("padding-right: 10mm");
    expect(html).toContain("overflow: hidden");
  });

  test("date renders exactly once on the bill", () => {
    const html = buildBillPrintHtml(baseOpts());
    const matches = html.match(/01 Aug 2026/gi) ?? [];
    expect(matches.length).toBe(1);
  });

  test.each([1, 5, 10])("%i-test bill renders correctly", (count) => {
    const html = buildBillPrintHtml(baseOpts({ bill: sampleBill(count) }));
    expect(html).toContain("Magnetic Resonance");
    expect(html).toContain("care-doc-page");
    expect(html).toContain("Service");
    expect(html).toContain("Amount (Rs.)");
  });

  test("QR enabled and disabled", () => {
    const on = buildBillPrintHtml(baseOpts({ showQr: true, qrDataUrl: "data:x" }));
    const off = buildBillPrintHtml(baseOpts({ showQr: false, qrDataUrl: "" }));
    expect(on).toContain("Scan to verify");
    expect(off).not.toContain("Scan to verify");
  });

  test("signature line renders", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("Authorised Signatory");
    expect(html).toContain("Prepared By:");
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
    expect(on).toContain("QUEUE TOKEN");
    expect(off).not.toContain("QUEUE TOKEN");
    expect(off).not.toContain("Token #");
  });

  test("same room shows one token (deduped by department+room)", () => {
    const html = buildBillPrintHtml(baseOpts({
      showQueueToken: true,
      bill: sampleBill(3, {
        testTokens: [
          { department: "Pathology", roomNumber: "7", tokenNo: 5 },
          { department: "Pathology", roomNumber: "7", tokenNo: 5 },
          { department: "Radiology", roomNumber: "2", tokenNo: 3 },
        ],
      }),
    }));
    const pathologyMatches = html.match(/<strong>Pathology<\/strong>/g) ?? [];
    const radiologyMatches = html.match(/<strong>Radiology<\/strong>/g) ?? [];
    expect(pathologyMatches.length).toBe(1);
    expect(radiologyMatches.length).toBe(1);
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

  test("classic format uses engine and HOPE totals table", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("@page { size: A5 portrait; margin: 0; }");
    expect(html).toContain("care-doc-page");
    expect(html).toContain("totals-grid");
    expect(html).toContain("hope-bill");
  });

  test("retired format ids all render with the unified HOPE template", () => {
    for (const _legacy of ["classic", "modern-landscape", "premium-a5", "designer-a", "designer-b", "designer-c"] as const) {
      const html = buildBillPrintHtml({
        ...baseOpts(),
        paperSize: "A5",
        orientation: "portrait",
        pageCssSize: "148mm 210mm",
      });
      expect(html).toMatch(/@page\s*\{[^}]*margin:\s*0/);
      expect(html).toContain("care-doc-page");
      expect(html).toContain("148mm");
      expect(html).toContain(">Receipt<");
    }
  });

  test("A5 portrait page box does not exceed 148mm x 210mm", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("width: 148mm");
    expect(html).toContain("height: 210mm");
    expect(html).toContain("padding-left: 8mm");
    expect(html).toContain("padding-right: 8mm");
  });

  test("half-sheet landscape bills still fill content box when opted in", () => {
    const html = buildBillPrintHtml(baseOpts({
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(html).toContain("receipt-shell");
    expect(html).toContain("min-height: 100%");
    expect(html).toContain("margin-top: auto !important");
  });

  test("tall A4 / booking-slip can opt into compact footer gap", () => {
    const html = buildBillPrintHtml(baseOpts({
      bill: sampleBill(1),
      paperSize: "A4",
      orientation: "portrait",
      pageCssSize: "A4 portrait",
      compactFooterGap: true,
    }));
    expect(html).toContain("receipt-shell");
    expect(html).not.toContain("min-height: 100%");
    expect(html).toContain("margin-top: 8px !important");
  });

  test("long A5 portrait bills also anchor footer at content bottom", () => {
    const html = buildBillPrintHtml(baseOpts({ bill: sampleBill(10), compactFooterGap: false }));
    expect(html).toContain("receipt-shell");
    expect(html).toContain("min-height: 100%");
  });

  test("TAT annotates service name when showTat is on (no HOPE TAT column)", () => {
    const html = buildBillPrintHtml(
      baseOpts({
        showTat: true,
        clinic: { ...sampleClinic, billShowCategory: false },
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
    expect(html).toContain("CBC (4 hrs)");
    expect(html).not.toContain(">TAT<");
  });

  test("A5 landscape page box still supported for legacy half-sheet callers", () => {
    const html = buildBillPrintHtml({
      ...baseOpts(),
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    });
    expect(html).toContain("width: 210mm");
    expect(html).toContain("height: 148mm");
  });

  test("A4 page box does not exceed 210mm x 297mm", () => {
    const html = buildBillPrintHtml({
      ...baseOpts(),
      paperSize: "A4",
      pageCssSize: "A4 portrait",
    });
    expect(html).toContain("width: 210mm");
    expect(html).toContain("height: 297mm");
    expect(html).toContain("padding-left: 4mm");
    expect(html).toContain("padding-right: 4mm");
  });

  test("no Electron print APIs in generated HTML", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).not.toContain("webContents.print");
    expect(html).not.toContain("printToPDF");
  });
});


describe("document layout engine — CARE Invoice (classic)", () => {
  test("classic format renders INVOICE layout on 210×148", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "classic",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(html).toContain(">INVOICE<");
    expect(html).toContain("Authorised Signature");
    expect(html).toContain("BILL NO:");
    expect(html).toContain("@page { size: A5 landscape; margin: 0; }");
    expect(html).not.toMatch(/@page \{ size: 210mm 148mm/);
    expect(html).not.toMatch(/@page \{ size: A4/);
    expect(html).not.toContain("hope-bill");
    expect(html).not.toContain(">Receipt<");
  });

  test("classic + named A5 landscape @page so Chrome selects A5, not A4 landscape", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "classic",
      orientation: "landscape",
      pageCssSize: "A5 landscape",
    }));
    expect(html).toContain("@page { size: A5 landscape; margin: 0; }");
    expect(html).not.toMatch(/@page \{ size: 210mm 148mm/);
    expect(html).not.toMatch(/@page \{ size: A4/);
    expect(html).toContain("width: 210mm");
    expect(html).toContain("height: 148mm");
    expect(html).toContain(">INVOICE<");
  });

  test("format from clinic settings selects classic without billFormat opt", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: undefined,
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
      clinic: {
        ...sampleClinic,
        billPrintSettingsJson: JSON.stringify({ defaultFormat: "classic" }),
      },
    }));
    expect(html).toContain(">INVOICE<");
  });

  test("hope-a5 and classic share CARE totals fields", () => {
    const hope = buildBillPrintHtml(baseOpts({ billFormat: "hope-a5" }));
    const classic = buildBillPrintHtml(baseOpts({
      billFormat: "classic",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(hope).toContain("4,900.00");
    expect(classic).toContain("4,900.00");
    expect(hope).toMatch(/2026001-\d+-4900\.00-\d+-[0-9A-F]{8}/);
    expect(classic).toMatch(/2026001-\d+-4900\.00-\d+-[0-9A-F]{8}/);
  });
});

describe("document layout engine — CARE Invoice A5 Portrait (classic-portrait)", () => {
  test("classic-portrait renders same INVOICE layout on 148×210", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "classic-portrait",
      orientation: "portrait",
      pageCssSize: "A5 portrait",
    }));
    expect(html).toContain(">INVOICE<");
    expect(html).toContain("Authorised Signature");
    expect(html).toContain("BILL NO:");
    expect(html).toContain("@page { size: A5 portrait; margin: 0; }");
    expect(html).toContain("width: 148mm");
    expect(html).toContain("height: 210mm");
    expect(html).not.toMatch(/@page \{ size: A5 landscape/);
    expect(html).not.toMatch(/@page \{ size: A4/);
    expect(html).not.toContain("hope-bill");
    expect(html).not.toContain(">Receipt<");
  });

  test("classic-portrait and classic share CARE Invoice markup, opposite paper", () => {
    const landscape = buildBillPrintHtml(baseOpts({
      billFormat: "classic",
      orientation: "landscape",
      pageCssSize: "A5 landscape",
    }));
    const portrait = buildBillPrintHtml(baseOpts({
      billFormat: "classic-portrait",
      orientation: "portrait",
      pageCssSize: "A5 portrait",
    }));
    expect(landscape).toContain(">INVOICE<");
    expect(portrait).toContain(">INVOICE<");
    expect(landscape).toContain("@page { size: A5 landscape; margin: 0; }");
    expect(portrait).toContain("@page { size: A5 portrait; margin: 0; }");
    expect(landscape).toContain("width: 210mm");
    expect(landscape).toContain("height: 148mm");
    expect(portrait).toContain("width: 148mm");
    expect(portrait).toContain("height: 210mm");
    expect(portrait).toContain("4,900.00");
    expect(landscape).toContain("4,900.00");
  });

  test("format from clinic settings selects classic-portrait without billFormat opt", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: undefined,
      orientation: "portrait",
      pageCssSize: "A5 portrait",
      clinic: {
        ...sampleClinic,
        billPrintSettingsJson: JSON.stringify({ defaultFormat: "classic-portrait" }),
      },
    }));
    expect(html).toContain(">INVOICE<");
    expect(html).toContain("@page { size: A5 portrait; margin: 0; }");
  });
});

describe("document layout engine — A5 Landscape (a5-landscape)", () => {
  test("a5-landscape format renders compact layout on 210×148", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "a5-landscape",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(html).toContain("a5-landscape-bill");
    expect(html).toContain(">RECEIPT<");
    expect(html).toContain("Authorised Signatory");
    expect(html).toContain("@page { size: A5 landscape; margin: 0; }");
    expect(html).not.toMatch(/@page \{ size: 210mm 148mm/);
    expect(html).not.toMatch(/@page \{ size: A4/);
    expect(html).not.toContain("hope-bill");
    expect(html).not.toContain(">INVOICE<");
  });

  test("buildBillPrintHtml routes a5-landscape to the landscape renderer", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "a5-landscape",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(html).toContain("a5-landscape-bill");
    expect(html).not.toContain("hope-bill");
  });

  test("a5-landscape HTML does not use CSS transform rotate", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "a5-landscape",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(html).not.toMatch(/transform:\s*rotate/i);
  });

  test("a5-landscape shares financial and audit fields with classic", () => {
    const landscape = buildBillPrintHtml(baseOpts({
      billFormat: "a5-landscape",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(landscape).toContain("4,900.00");
    expect(landscape).toMatch(/2026001-\d+-4900\.00-\d+-[0-9A-F]{8}/);
    expect(landscape).toContain("Scan to verify");
  });
});

describe("document layout engine — CARE Sage (care-sage)", () => {
  test("care-sage renders the status-edge receipt on 210×148", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "care-sage",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(html).toContain("care-sage-bill");
    expect(html).toContain("sage-edge");
    expect(html).toContain(">RECEIPT<");
    expect(html).toContain("Authorised Signatory");
    expect(html).toContain("@page { size: A5 landscape; margin: 0; }");
    expect(html).not.toMatch(/@page \{ size: 210mm 148mm/);
    expect(html).not.toMatch(/@page \{ size: A4/);
    expect(html).not.toContain("a5-landscape-bill");
    expect(html).not.toContain("hope-bill");
    expect(html).not.toContain(">INVOICE<");
  });

  test("settled bill prints in peaceful green with a PAID check", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "care-sage",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(html).toContain("#15803d");
    expect(html).toContain("#f0fdf4");
    expect(html).toContain("Paid ✓");
    expect(html).not.toContain("#b91c1c");
  });

  test("balance-due bill prints in red without the PAID check", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "care-sage",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
      bill: sampleBill(1, { paidAmount: 1000, balanceAmount: 3900 }),
    }));
    expect(html).toContain("#b91c1c");
    expect(html).toContain("#fef2f2");
    expect(html).not.toContain("Paid ✓");
  });

  test("B&W mode keeps the layout readable with neutral ink", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "care-sage",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
      isBW: true,
    }));
    expect(html).not.toContain("#15803d");
    expect(html).not.toContain("#b91c1c");
    expect(html).toContain("#64748b"); // neutral grey status edge
    expect(html).toContain("Paid");
  });

  test("care-sage shares financial and audit fields with the other templates", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "care-sage",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(html).toContain("4,900.00");
    expect(html).toMatch(/2026001-\d+-4900\.00-\d+-[0-9A-F]{8}/);
    expect(html).toContain("Scan to verify");
  });

  test("care-sage HTML does not use CSS transform rotate", () => {
    const html = buildBillPrintHtml(baseOpts({
      billFormat: "care-sage",
      orientation: "landscape",
      pageCssSize: "210mm 148mm",
    }));
    expect(html).not.toMatch(/transform:\s*rotate/i);
  });
});

describe("print delivery module", () => {
  test("exports popup helpers without Electron APIs or hidden iframe print path", async () => {
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
    expect(src).not.toContain("__care_print_iframe__");
    expect(src).toContain("writeAndPrint(null, html)");
  });
});

describe("buildBillAuditToken", () => {
  test("is deterministic for the same inputs", () => {
    const a = buildBillAuditToken({
      billNumber: "BILL-2026-001",
      createdAt: "2026-08-01T10:30:00.000Z",
      totalAmount: 4900,
      operatorId: 7,
    });
    const b = buildBillAuditToken({
      billNumber: "BILL-2026-001",
      createdAt: "2026-08-01T10:30:00.000Z",
      totalAmount: 4900,
      operatorId: 7,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^2026001-\d+-4900\.00-7-[0-9A-F]{8}$/);
  });

  test("changes when amount or operator changes", () => {
    const base = {
      billNumber: "20260810042",
      createdAt: "2026-08-01T10:30:00.000Z",
      totalAmount: 1500,
      operatorId: 1,
    };
    const a = buildBillAuditToken(base);
    const b = buildBillAuditToken({ ...base, totalAmount: 1501 });
    const c = buildBillAuditToken({ ...base, operatorId: 2 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  test("buildBillAuditHash is the trailing FNV-1a hex of the audit token", () => {
    const opts = {
      billNumber: "BILL-2026-001",
      createdAt: "2026-08-01T10:30:00.000Z",
      totalAmount: 4900,
      operatorId: "Reception Desk",
    };
    const token = buildBillAuditToken(opts);
    const hash = buildBillAuditHash(opts);
    expect(hash).toMatch(/^[0-9A-F]{8}$/);
    expect(token.endsWith(`-${hash}`)).toBe(true);
  });

  test("buildBillVerifyUrl appends ?hash= FNV-1a query param", () => {
    const url = buildBillVerifyUrl({
      billNumber: "BILL-2026-001",
      createdAt: "2026-08-01T10:30:00.000Z",
      totalAmount: 4900,
      operatorId: "Abinash",
      origin: "https://caredeoghar.com",
    });
    expect(url).toMatch(/^https:\/\/caredeoghar\.com\/api\/verify\/bill\/BILL-2026-001\?hash=[0-9A-F]{8}$/);
    const hash = new URL(url).searchParams.get("hash");
    expect(hash).toBe(buildBillAuditHash({
      billNumber: "BILL-2026-001",
      createdAt: "2026-08-01T10:30:00.000Z",
      totalAmount: 4900,
      operatorId: "Abinash",
    }));
  });
});
