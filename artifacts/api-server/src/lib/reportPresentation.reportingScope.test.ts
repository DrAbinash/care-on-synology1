/**
 * PRIORITY 1 (report title vs effective region) — the printed page.
 *
 * The heading is the billed identity and stays the billed identity. What the
 * page lacked is the other half of the truth: after an ADR-004 region transition
 * the body documents one segment while the heading still names the whole booked
 * examination, and nothing on the paper told the reader that was a decision
 * rather than an unfinished report.
 *
 * The sentence itself is computed once, in `@workspace/report-quality`
 * (`lib/report-quality/src/reportingScope.ts`), by whichever surface is
 * rendering; these tests pin where the print renderer puts it and that a report
 * with no recorded transition renders exactly the bytes it rendered before.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { reportedScopeNote } from "@workspace/report-quality";

import {
  PRESENTATION_TEMPLATES,
  renderReportDocument,
  resolvePresentationTemplate,
  type ReportDocumentModel,
} from "./reportPresentation";

const BOOKED_TITLE = "MRI WHOLE SPINE";
const NOTE = "Documented reporting region: Cervical Spine (recorded by abinashsingh@gmail.com on 13 Oct 2026). Booked examination: MRI WHOLE SPINE.";

function baseModel(overrides: Partial<ReportDocumentModel> = {}): ReportDocumentModel {
  return {
    reportNumber: "DRAFT-59",
    studyTitle: BOOKED_TITLE,
    typeLabel: "RADIOLOGY",
    statusLabel: "DRAFT",
    clinic: { name: "Care Diagnostics", tagline: "Precision Imaging", address: "Deoghar", phone: "06432-1234" },
    patientRows: [
      { label: "Patient", value: "SYNTHETIC SPINECASE" },
      { label: "Accession No.", value: "SYN-M1-ACC-0001" },
    ],
    bodyHtml: "<p>FINDINGS: Cervical spine: Normal alignment.</p>",
    stamp: { kind: "draft", label: "DRAFT (not signed)" },
    signatures: [{ name: "Dr. Sugandha Priyadarshini", qualification: "MD", label: "Signed:", whenLabel: "" }],
    footerNote: "",
    generatedAtLabel: "13/10/2026, 3:00 pm",
    ...overrides,
  };
}

/** The note, exactly as the rule produces it, is what the renderer must place. */
function noteFromRecordedTransition(): string {
  const note = reportedScopeNote({
    bookedTitle: BOOKED_TITLE,
    records: [{
      fromRegion: "Whole Spine",
      toRegion: "Cervical Spine",
      decidedBy: "abinashsingh@gmail.com",
      at: "2026-10-13T09:40:00.000Z",
    }],
  });
  expect(note).toBe(NOTE);
  return note!;
}

describe("printed report — the documented reporting region under the booked heading", () => {
  it("P1 renders the note directly under the study title bar", () => {
    const html = renderReportDocument(
      baseModel({ reportingScopeNote: noteFromRecordedTransition() }),
      resolvePresentationTemplate("care-classic"),
    );
    const title = html.indexOf('<div class="study-title-bar">');
    const note = html.indexOf('<div class="reporting-scope-note">');
    const content = html.indexOf('class="content-area');
    expect(title).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(title);
    expect(content).toBeGreaterThan(note);
    expect(html).toContain(NOTE);
    // The heading itself is untouched: the note is additive, never a rename.
    expect(html).toContain('<div class="study-title-bar">MRI WHOLE SPINE</div>');
  });

  it("P2 escapes the note: it carries names the radiologist typed, not markup", () => {
    const html = renderReportDocument(
      baseModel({
        reportingScopeNote:
          'Documented reporting region: <script>alert(1)</script> & "Cervical Spine".',
      }),
      resolvePresentationTemplate("care-premium"),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("P3 a report with no recorded transition renders byte-identically", () => {
    const without = renderReportDocument(baseModel(), resolvePresentationTemplate("care-classic"));
    const explicitUndefined = renderReportDocument(
      baseModel({ reportingScopeNote: undefined }),
      resolvePresentationTemplate("care-classic"),
    );
    expect(without).toBe(explicitUndefined);
    expect(without).not.toContain('<div class="reporting-scope-note">');
    expect(without).not.toContain("Documented reporting region");
    // And the rule that decides it says nothing at all when history is empty,
    // so the route has no note to hand the renderer for those studies.
    expect(reportedScopeNote({ bookedTitle: BOOKED_TITLE, records: [] })).toBeNull();
  });

  it("P4 every presentation template prints it, not just the default", () => {
    for (const template of PRESENTATION_TEMPLATES) {
      const html = renderReportDocument(
        baseModel({ reportingScopeNote: NOTE }),
        resolvePresentationTemplate(template.id),
      );
      expect(html, template.id).toContain('<div class="reporting-scope-note">');
      expect(html, template.id).toContain(NOTE);
    }
  });

  it("P5 it prints: nothing hides the note on paper", () => {
    const html = renderReportDocument(
      baseModel({ reportingScopeNote: NOTE }),
      resolvePresentationTemplate("care-premium"),
    );
    const rule = html.match(/\.reporting-scope-note\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).not.toMatch(/display\s*:\s*none/);
  });
});

/**
 * The renderer is only half of it: the route that serves the page must ask the
 * shared rule for the note, or the clinic prints the old page forever. These
 * read the route source for that wiring — bounded on the handler and the model
 * literal, so a rename or a moved line fails loudly instead of silently
 * shrinking a slice to nothing.
 */
describe("the draft print route asks the shared rule", () => {
  const route = readFileSync(
    new URL("../routes/radiology-report-generator.ts", import.meta.url),
    "utf8",
  );

  function window(text: string, startMarker: string, endMarker: string, label: string): string {
    const start = text.indexOf(startMarker);
    expect(start, `${label}: start marker missing`).toBeGreaterThanOrEqual(0);
    const end = text.indexOf(endMarker, start + startMarker.length);
    expect(end, `${label}: end marker missing after the start`).toBeGreaterThan(start);
    return text.slice(start, end);
  }

  it("R1 derives the note from the stored transition record, and never from report prose", () => {
    const handler = window(
      route,
      'get("/drafts/:id/print-preview"',
      "const formattedStudyDate = formatReportDate(",
      "print-preview handler",
    );
    expect(handler).toContain("extractCareRegionTransitions(draft.structuredJson)");
    expect(handler).toContain("reportedScopeNote({");
    // The heading it is compared against is the same string the page prints.
    expect(handler).toContain("bookedTitle: studyTitle");
    for (const prose of ["draft.findings", "draft.impression", "draft.technique"]) {
      expect(handler, `the scope note must not read ${prose}`).not.toContain(prose);
    }
  });

  it("R2 the note reaches the document model beside the booked study title", () => {
    const model = window(
      route,
      "const model: ReportDocumentModel = {",
      "draftWatermark:",
      "draft print model",
    );
    expect(model).toContain("studyTitle,");
    expect(model).toContain("reportingScopeNote,");
  });

  it("R3 this route does not write its own version of the sentence", () => {
    expect(route).not.toContain("Documented reporting region");
  });
});
