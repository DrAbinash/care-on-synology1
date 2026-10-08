import { describe, expect, it } from "vitest";
import {
  bodyHTML,
  buildHTML,
  buildWordDocument,
  classifyLedgerRow,
  ledgerRowRule,
  ledgerRowSign,
  type ExportConfig,
} from "@/components/SummaryExport";

/**
 * A config that exercises every row kind the reconciliation screens actually produce, so a
 * renderer that only handles the easy rows cannot pass.
 */
const config: ExportConfig = {
  title: "Daily Financial Reconciliation",
  subtitle: "Today - All Staff",
  clinicName: "Care Diagnostics",
  logoDataUrl: null,
  sections: [
    {
      title: "Billing",
      metrics: [
        ["Total Bills Generated (after discount)", "Rs.1,20,000"],
        ["── Today ──", ""],
        ["", ""],
        ["Walk-in bills", "Rs.90,000"],
        ["Discount info", "Rs.4,000"],
      ],
    },
    {
      title: "Deductions",
      metrics: [
        ["Cancelled / refunded bills", "-Rs.5,000"],
        ["Outstanding (old dues collected)", "Rs.2,000"],
        ["Total Deductions", "Rs.7,000"],
      ],
    },
    {
      title: "Cash Reconciliation",
      layout: "full",
      metrics: [
        ["Expected Physical Cash", "Rs.1,13,000"],
        ["Variance", "Balanced (0)"],
      ],
    },
    {
      title: "Collections",
      metrics: [["Digital Collection", "Rs.40,000"], ["Net Cash", "Rs.73,000"]],
    },
    {
      title: "Staff",
      metrics: [["Staff on duty", "6"]],
    },
  ],
  tables: [
    {
      title: "Payments collected by me",
      headers: ["Bill #", "Patient", "Method", "Amount"],
      rows: [
        ["VB-0042", "Asha R", "Cash", "Rs.1,500"],
        ["VB-0043", "Bilu S", "UPI", "Rs.2,200"],
        ["Total", "", "", "Rs.3,700"],
      ],
    },
  ],
};

describe("ledger row meaning is decided once", () => {
  it("classifies the labels the clinic's screens really send", () => {
    expect(classifyLedgerRow("Total Bills Generated (after discount)", "Rs.1,20,000")).toBe("total");
    expect(classifyLedgerRow("Cancelled / refunded bills", "-Rs.5,000")).toBe("deduct");
    expect(classifyLedgerRow("Outstanding (old dues collected)", "Rs.2,000")).toBe("deduct");
    expect(classifyLedgerRow("Discount info", "Rs.4,000")).toBe("info");
    expect(classifyLedgerRow("Digital Collection", "Rs.40,000")).toBe("deduct");
    expect(classifyLedgerRow("Net Cash", "Rs.73,000")).toBe("total");
    expect(classifyLedgerRow("Variance", "Balanced (0)")).toBe("balanced");
    expect(classifyLedgerRow("Variance", "Short by 40")).toBe("mismatch");
    expect(classifyLedgerRow("Expected Physical Cash", "Rs.1,13,000")).toBe("final");
    expect(classifyLedgerRow("── Today ──", "")).toBe("divider");
    expect(classifyLedgerRow("", "")).toBe("blank");
    expect(classifyLedgerRow("Staff on duty", "6")).toBe("plain");
  });

  it("only the two answer kinds carry a heavy rule", () => {
    expect(ledgerRowRule("final")).toBe("final");
    expect(ledgerRowRule("total")).toBe("total");
    for (const kind of ["plain", "deduct", "info", "balanced", "mismatch", "divider", "blank"] as const) {
      expect(ledgerRowRule(kind)).toBe("none");
    }
    expect(ledgerRowSign("deduct")).toBe("-");
    expect(ledgerRowSign("total")).toBe("=");
    expect(ledgerRowSign("final")).toBe("=");
    expect(ledgerRowSign("info")).toBe("i");
    expect(ledgerRowSign("plain")).toBe("");
  });
});

describe("Word and print no longer disagree about the layout", () => {
  // Word ignores all four of these. Every one of them was in the old output, and the grid
  // in particular is what turned two-up boxes into a stack with a paragraph gap between.
  const invisibleToWord = ["display:grid", "linear-gradient", "border-radius", "overflow:hidden", "overflow-x:auto"];

  for (const [name, html] of [["Print/Email", buildHTML(config)], ["Word", buildWordDocument(config)]] as const) {
    it(`${name} carries no CSS Word drops`, () => {
      for (const css of invisibleToWord) {
        expect(html).not.toContain(css);
      }
      expect(html).not.toMatch(/margin-bottom:\s*\d/);
    });

    it(`${name} lays the half-width boxes out two per table row`, () => {
      expect(html).toContain('valign="top"');
      expect(html.match(/width="50%"/g)?.length).toBe(4);
      // Billing+Deductions pair, then Collections+Staff pair. Cash Reconciliation spans both.
      expect(html).toContain('colspan="2" valign="top"');
      expect(html).toContain("CASH RECONCILIATION");
    });

    it(`${name} separates the formula from its answer with a heavier rule`, () => {
      const answerRow = html.slice(html.indexOf("Expected Physical Cash") - 700, html.indexOf("Expected Physical Cash"));
      expect(answerRow).toContain("1.75pt solid #0f172a");
      expect(answerRow).toContain("background:#0f172a");
      const totalRow = html.slice(html.indexOf("Total Deductions") - 500, html.indexOf("Total Deductions"));
      expect(totalRow).toContain("1pt solid #334155");
    });

    it(`${name} does not paint the answer row red by accident`, () => {
      // Both the old HTML and the old PDF asked `balanced ? green : red` for the answer row,
      // and `balanced` can only ever be true for Variance — so the answer row was permanently
      // pink, which reads as an alarm on a day that reconciles.
      const answerRow = html.slice(html.indexOf("Expected Physical Cash") - 700, html.indexOf("Expected Physical Cash"));
      expect(answerRow).not.toContain("#fee2e2");
    });
  }

  it("the gaps between tables are the ones the renderer set", () => {
    const body = bodyHTML(config);
    const heights = [...body.matchAll(/height:([0-9.]+)pt;line-height:\1pt/g)].map((m) => Number(m[1]));
    expect(heights.length).toBeGreaterThan(0);
    // Nothing wider than 7pt: a Word paragraph gap is ~12pt, and the old .doc was full of
    // gaps nobody had set.
    expect(Math.max(...heights)).toBeLessThanOrEqual(7);
    // The deliberate rhythm between top-level blocks is 5-6pt.
    expect(heights.filter((h) => h === 5 || h === 6).length).toBeGreaterThan(0);
    // No block-level margin: that is the gap Word invents, and it is why the old .doc had
    // blank space between tables that nobody had asked for.
    expect(body).not.toMatch(/<table[^>]*margin-(top|bottom):/);
  });
});

describe("the Word file is a Word document", () => {
  it("carries the Word page setup and print-view prolog", () => {
    const doc = buildWordDocument(config);
    expect(doc).toContain("WordSection1");
    expect(doc).toContain("size:595.3pt 841.9pt");
    expect(doc).toContain("<w:View>Print</w:View>");
    expect(doc).toContain("<!--[if gte mso 9]>");
    expect(doc).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"');
  });

  it("keeps the browser shell free of Word-only markup", () => {
    const web = buildHTML(config);
    expect(web).not.toContain("WordSection1");
    expect(web).toContain("@media print");
  });

  it("repeats a table header across pages instead of relying on a scroll box", () => {
    const doc = buildWordDocument(config);
    expect(doc).toContain("<thead>");
    expect(doc).toContain("PAYMENTS COLLECTED BY ME");
  });
});

describe("the one-page ledger renders through the same tables", () => {
  it("puts the one-page ledger in a fixed-width table, not a max-width div", () => {
    const doc = buildWordDocument(config, "simple");
    // The old simple body was `<div style="max-width:520px;margin:0 auto">`, which Word
    // renders as a full-width block and centres not at all.
    expect(doc).toContain('width="460"');
    expect(doc).toContain("width:460px");
    // A bare `width:460` is an invalid declaration, so a browser would have ignored it and
    // only Word's attribute reading would have honoured the card width.
    expect(doc).not.toContain("width:460;");
    expect(doc).not.toContain("max-width:520px");
    expect(doc).not.toContain("border-radius");
    expect(doc).toContain("WordSection1");
  });

  it("puts the formula under the ledger so a printed page explains itself", () => {
    const html = bodyHTML(config, "simple");
    expect(html).toContain("Bills + Old Dues");
    expect(html).toContain("Cash in counter");
  });
});
