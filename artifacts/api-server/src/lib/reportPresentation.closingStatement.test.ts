import { describe, it, expect } from "vitest";
import {
  renderReportDocument,
  resolvePresentationTemplate,
  type ReportDocumentModel,
} from "./reportPresentation";
import {
  RADIOLOGY_CLOSING_STATEMENT,
  RADIOLOGY_CLOSING_STATEMENT_CLASS,
} from "@workspace/report-quality";

// The owner's fixed closing statement, proven at the ONE renderer every server
// surface shares (draft preview, browser print, staff PDF, the public/WhatsApp PDF,
// email share, PACS archive). Policy 2026-10-27: it must appear exactly once on a
// radiology report — in a draft and in a signed one, whether or not the
// Recommendations field was filled — and must never appear on a pathology report.
//
// Counting occurrences of the sentence is the whole test. "It is there" is not the
// requirement; "exactly once" is, and a second copy is the failure mode this policy
// could itself introduce (the radiologist may have typed it, or his template).

const SENTENCE_RE = /Please correlate with clinical findings/gi;

function countStatement(html: string): number {
  return (html.match(SENTENCE_RE) ?? []).length;
}

function baseModel(overrides: Partial<ReportDocumentModel> = {}): ReportDocumentModel {
  return {
    reportNumber: "RPT-20261027-001",
    studyTitle: "MRI BRAIN (PLAIN)",
    typeLabel: "RADIOLOGY",
    statusLabel: "VERIFIED",
    clinic: { name: "Care Diagnostics", tagline: "Precision Imaging", address: "Deoghar", phone: "06432-1234" },
    patientRows: [
      { label: "Patient", value: "Test Patient" },
      { label: "Age / Sex", value: "42y / F" },
    ],
    bodyHtml: "<div class=\"section-heading\">FINDINGS</div><p>Normal study.</p>",
    stamp: { kind: "verified", label: "VERIFIED on 27/10/2026" },
    signatures: [{ name: "Dr. Asha Rao", qualification: "MD (Radiodiagnosis)", label: "Signed:", whenLabel: " 27/10/2026" }],
    generatedAtLabel: "27/10/2026, 3:00 pm",
    ...overrides,
  };
}

describe("the fixed closing statement — present exactly once", () => {
  it("closes a radiology report whose Recommendations field is empty", () => {
    // An empty advice section: no heading over nothing, but the mandated line prints.
    const html = renderReportDocument(
      baseModel({ bodyHtml: "<div class=\"section-heading\">FINDINGS</div><p>Normal study.</p>" }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).not.toMatch(/<div class="section-heading">RECOMMENDATION/i);
    expect(countStatement(html)).toBe(1);
  });

  it("closes a report that carries the radiologist's own recommendation, and keeps his words", () => {
    const authored = "Repeat MRI in six weeks with contrast.";
    const html = renderReportDocument(
      baseModel({ bodyHtml: `<div class="section-heading">RECOMMENDATION</div><p>${authored}</p>` }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(html).toContain(authored); // preserved, not replaced, not demoted
    expect(countStatement(html)).toBe(1);
  });

  it("says it once when the radiologist typed that very sentence himself", () => {
    const html = renderReportDocument(
      baseModel({
        bodyHtml: `<div class="section-heading">RECOMMENDATION</div><p>${RADIOLOGY_CLOSING_STATEMENT}</p>`,
      }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(countStatement(html)).toBe(1);
    // His section, his words: the fixed element is not added on top of it.
    expect(html).not.toContain(`<div class="${RADIOLOGY_CLOSING_STATEMENT_CLASS}">`);
  });

  it("prints on a draft and on a signed report alike", () => {
    const draft = renderReportDocument(
      baseModel({ statusLabel: "DRAFT", draftWatermark: true, stamp: { kind: "draft", label: "DRAFT (not signed)" } }),
      resolvePresentationTemplate("care-classic"),
    );
    const signed = renderReportDocument(baseModel(), resolvePresentationTemplate("care-classic"));
    expect(draft).toContain("DRAFT — NOT SIGNED"); // still recognisably a draft
    expect(countStatement(draft)).toBe(1);
    expect(countStatement(signed)).toBe(1);
  });

  it("prints once on both presentation template families", () => {
    for (const id of ["care-classic", "care-premium"]) {
      const html = renderReportDocument(baseModel(), resolvePresentationTemplate(id));
      expect(countStatement(html), id).toBe(1);
    }
  });

  it("is emitted for a plain-text body too, so no body shape escapes the policy", () => {
    const html = renderReportDocument(
      baseModel({ bodyHtml: undefined, bodyText: "FINDINGS:\nNormal study." }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(countStatement(html)).toBe(1);
  });

  it("says it once when the footer the clinic wrote already says it", () => {
    // The owner can set clinic_settings.footerNote. It is printed by the plain footer,
    // so a clinic that has written the policy sentence there must not be answered a
    // second time underneath it.
    const clinicLetterhead = {
      ...resolvePresentationTemplate("care-classic"),
      letterhead: { kind: "clinic" as const },
    };
    const html = renderReportDocument(
      baseModel({ footerNote: RADIOLOGY_CLOSING_STATEMENT }),
      clinicLetterhead,
    );
    expect(html).toContain(`<div class="ftr">${RADIOLOGY_CLOSING_STATEMENT} •`); // the note is really printed
    expect(countStatement(html)).toBe(1);
    expect(html).not.toContain(`<div class="${RADIOLOGY_CLOSING_STATEMENT_CLASS}">`);
  });

  it("still says it once when a footer note is set but that template does not print it", () => {
    // Under the CARE letter-pad the footer note is not rendered at all. Suppressing the
    // statement because of a note nobody sees would delete the mandated sentence —
    // which is the bug this case holds shut.
    const html = renderReportDocument(
      baseModel({ footerNote: RADIOLOGY_CLOSING_STATEMENT }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(countStatement(html)).toBe(1);
    expect(html).toContain(`<div class="${RADIOLOGY_CLOSING_STATEMENT_CLASS}">`);
  });
});

describe("the fixed closing statement — where it sits", () => {
  it("is outside .body, so the clinical content handed to the renderer is untouched", () => {
    const body = '<div class="section-heading">FINDINGS</div><p>Normal study.</p>';
    const html = renderReportDocument(baseModel({ bodyHtml: body }), resolvePresentationTemplate("care-classic"));
    // The exact body the caller supplied is still the exact body inside .body — the
    // statement is a sibling, never an edit. This is what keeps the stored signed
    // artifact and its content hash covering only what the radiologist approved.
    expect(html).toContain(`<div class="body">${body}</div>`);
    const statementAt = html.indexOf(`<div class="${RADIOLOGY_CLOSING_STATEMENT_CLASS}">`);
    const bodyAt = html.indexOf(`<div class="body">${body}</div>`);
    expect(statementAt).toBeGreaterThan(bodyAt);
  });
});

describe("the fixed closing statement — radiology only", () => {
  it("does not appear on a pathology report (its own footer contract stands)", () => {
    const html = renderReportDocument(
      baseModel({ typeLabel: "PATHOLOGY", studyTitle: "HISTOPATHOLOGY — GASTRIC BIOPSY", bodyText: "Gastric mucosa with chronic inflammation." }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(countStatement(html)).toBe(0);
    expect(html).not.toContain(`<div class="${RADIOLOGY_CLOSING_STATEMENT_CLASS}">`);
  });

  it("does not appear on any other report type either", () => {
    for (const typeLabel of ["LABORATORY", "PATHOLOGY", ""]) {
      const html = renderReportDocument(
        baseModel({ typeLabel, bodyText: "Some non-radiology content." }),
        resolvePresentationTemplate("care-classic"),
      );
      expect(countStatement(html), typeLabel).toBe(0);
    }
  });
});
