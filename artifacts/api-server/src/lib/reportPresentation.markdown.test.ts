import { describe, it, expect } from "vitest";
import { renderReportDocument, resolvePresentationTemplate, type ReportDocumentModel } from "./reportPresentation";

// MODE A presentation contract: the report must reach paper with NO markdown
// artifacts. The in-app PDF already folds `**bold**` into bold runs
// (`reportPdfGenerator.parseInlineMarkdown`); this measures whether the shared
// print renderer does the same, or prints the asterisks.
const base = (overrides: Partial<ReportDocumentModel> = {}): ReportDocumentModel => ({
  reportNumber: "RPT-20261018-001",
  studyTitle: "MRI BRAIN (PLAIN)",
  typeLabel: "RADIOLOGY",
  statusLabel: "DRAFT",
  clinic: { name: "Care Diagnostics", tagline: "t", address: "Deoghar", phone: "1" },
  patientRows: [{ label: "Patient", value: "Synthetic Case" }],
  bodyHtml: "<p>FINDINGS: Normal study.</p>",
  stamp: { kind: "draft", label: "" },
  signatures: [],
  footerNote: "",
  generatedAtLabel: "18/10/2026",
  ...overrides,
});

describe("markdown emphasis must not reach the printed page", () => {
  it("an Impression written with **emphasis** prints it bold, with no asterisks", () => {
    const html = renderReportDocument(
      base({ impression: "**Left MCA infarct — acute.** Clinical correlation." }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).toContain("Left MCA infarct");
    expect(html).not.toContain("**");
    expect(html).toContain("<strong>Impression: <strong>Left MCA infarct — acute.</strong> Clinical correlation.</strong>");
  });

  it("a plain-text Findings body with **emphasis** prints no asterisks", () => {
    const html = renderReportDocument(
      base({ bodyHtml: undefined, bodyText: "There is **mass effect** at the convexity." }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).toContain("mass effect");
    expect(html).not.toContain("**");
    expect(html).toContain("<div class=\"body\">There is <strong>mass effect</strong> at the convexity.</div>");
  });

  it("__emphasis__ folds the same way, because the PDF reads both", () => {
    const html = renderReportDocument(
      base({ bodyHtml: undefined, bodyText: "Moderate __hydrocephalus__ with transependymal flow." }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).toContain("<strong>hydrocephalus</strong>");
    expect(html).not.toContain("__");
  });

  it("emphasis is folded AFTER escaping, so markup cannot ride in on it", () => {
    const html = renderReportDocument(
      base({ impression: "**<script>alert(1)</script>**" }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    // The emphasis the author meant still lands, wrapped around the escaped text.
    expect(html).toContain("<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>");
  });

  it("a single asterisk is left alone, exactly as the PDF leaves it", () => {
    // The pair `*and*` is what a greedy `\*+…\*+` would silently embolden. Only the
    // two-character runs the PDF recognises are emphasis; a report's own asterisks
    // are its text.
    const html = renderReportDocument(
      base({ bodyHtml: undefined, bodyText: "Left *and* right hemicranium, 2 * 3 mm." }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).toContain("Left *and* right hemicranium, 2 * 3 mm.");
    expect(html).not.toContain("<strong>and</strong>");
  });

  it("a pathology impression keeps its label-only bold and still sheds the asterisks", () => {
    const html = renderReportDocument(
      base({ typeLabel: "PATHOLOGY", impression: "Adeno**carcinoma** in the submitted block." }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).toContain("<strong>Impression:</strong> Adeno<strong>carcinoma</strong>");
    expect(html).not.toContain("**");
  });
});
