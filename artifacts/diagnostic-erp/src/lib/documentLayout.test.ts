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

  test("bill number renders under date/time in the patient meta block", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("BILL NO:");
    expect(html).toContain("2026001");
    // Bill No. must appear after the patient date line, not in the header under INVOICE
    const invoiceIdx = html.indexOf(">INVOICE<");
    const billNoIdx = html.indexOf("BILL NO:");
    const dateIdx = html.indexOf("01 AUG 2026");
    expect(invoiceIdx).toBeGreaterThanOrEqual(0);
    expect(dateIdx).toBeGreaterThan(invoiceIdx);
    expect(billNoIdx).toBeGreaterThan(dateIdx);
  });

  test("enterprise audit token is present on the bill", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("title=\"Audit token\"");
    // Token format: BILLNO-TIMESTAMP-TOTAL-OP-HASH
    expect(html).toMatch(/2026001-\d+-4900\.00-\d+-[0-9A-F]{8}/);
  });

  test("financial block and footer have page-break-inside:avoid", () => {
    const html = buildBillPrintHtml(baseOpts());
    expect(html).toContain("page-break-inside: avoid");
    expect(html).toContain("financial-block");
    expect(html).toContain("receipt-footer");
  });

  test("balance due uses alert styling when unpaid", () => {
    const unpaid = buildBillPrintHtml(baseOpts({
      bill: sampleBill(1, { balanceAmount: 500, paidAmount: 4400 }),
    }));
    expect(unpaid).toContain("#fef2f2"); // alert bg
    expect(unpaid).toContain("#b91c1c"); // alert text
    const paid = buildBillPrintHtml(baseOpts({
      bill: sampleBill(1, { balanceAmount: 0, paidAmount: 4900 }),
    }));
    expect(paid).toContain("#f0fdf4"); // settled bg
    expect(paid).toContain("#15803d"); // settled text
  });

  test("currency amounts always show two decimal places", () => {
    const html = buildBillPrintHtml(baseOpts({
      bill: sampleBill(1, { subtotal: 1500, totalAmount: 1500, paidAmount: 1500 }),
    }));
    expect(html).toContain("1,500.00");
  });

  test("muted metadata labels use uppercase PH / EMAIL / BILL NO", () => {
    const html = buildBillPrintHtml(baseOpts({ headerLayout: "right" }));
    expect(html).toContain("PH:");
    expect(html).toContain("EMAIL:");
    expect(html).toContain("BILL NO:");
    expect(html).toContain("color:#64748b"); // muted label color
  });

  test("header layout 'right' puts address under invoice title; 'left' keeps it under clinic name", () => {
    const right = buildBillPrintHtml(baseOpts({ headerLayout: "right" }));
    const left = buildBillPrintHtml(baseOpts({ headerLayout: "left" }));
    expect(right).toContain("Main Road, Deoghar");
    expect(left).toContain("Main Road, Deoghar");
    // Address on right: after INVOICE title, before patient Bill No.
    const rightInvoiceIdx = right.indexOf(">INVOICE<");
    const rightAddrIdx = right.indexOf("Main Road, Deoghar");
    const rightBillIdx = right.indexOf("BILL NO:");
    expect(rightAddrIdx).toBeGreaterThan(rightInvoiceIdx);
    expect(rightBillIdx).toBeGreaterThan(rightAddrIdx);
    // Address on left: under clinic name, before patient Bill No.
    const leftBillIdx = left.indexOf("BILL NO:");
    const leftAddrIdx = left.indexOf("Main Road, Deoghar");
    expect(leftAddrIdx).toBeLessThan(leftBillIdx);
  });

  test("referring doctor matches patient name weight and size", () => {
    const html = buildBillPrintHtml(baseOpts());
    // Doctor value uses font-weight 800 (same as patient name)
    expect(html).toMatch(/REF:[\s\S]*?font-weight:800[\s\S]*?DR\.\s*SHARMA/);
  });

  test("patient meta right stack is date, bill no, then phone/id", () => {
    const html = buildBillPrintHtml(baseOpts());
    const dateIdx = html.indexOf("01 AUG 2026");
    const billIdx = html.indexOf("BILL NO:");
    const phIdx = html.indexOf(">PH<");
    const idIdx = html.indexOf(">ID<");
    expect(dateIdx).toBeGreaterThanOrEqual(0);
    expect(billIdx).toBeGreaterThan(dateIdx);
    expect(phIdx).toBeGreaterThan(billIdx);
    expect(idIdx).toBeGreaterThan(phIdx);
  });

  test("page padding is equal on left and right", () => {
    const html = buildBillPrintHtml(baseOpts({ printMarginMm: 10 }));
    expect(html).toContain("padding-left: 10mm");
    expect(html).toContain("padding-right: 10mm");
    expect(html).toContain("overflow: hidden");
  });

  test("date renders exactly once on the bill", () => {
    const html = buildBillPrintHtml(baseOpts());
    const matches = html.match(/01 AUG 2026/g) ?? [];
    expect(matches.length).toBe(1);
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
    expect(html).toContain("care-doc-page");
    expect(html).toContain("totals-grid");
  });

  test("retired format ids all render with the unified template", () => {
    for (const _legacy of ["classic", "modern-landscape", "premium-a5", "designer-a", "designer-b", "designer-c"] as const) {
      const html = buildBillPrintHtml({
        ...baseOpts(),
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
