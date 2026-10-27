import { describe, it, expect } from "vitest";
import {
  RADIOLOGY_CLOSING_STATEMENT,
  RADIOLOGY_CLOSING_STATEMENT_CLASS,
  containsRadiologyClosingStatement,
  radiologyClosingStatementHtml,
  radiologyClosingStatementHtmlIfAbsent,
  withoutRadiologyClosingStatement,
} from "./closingStatement";

// The owner's fixed closing statement: one wording, one "already said it?" detector,
// read by all three radiology document producers. These cases pin the wording itself
// (it is a reporting policy, so a silent edit is a clinical change) and the two
// decisions that keep a report saying it exactly once.

describe("RADIOLOGY_CLOSING_STATEMENT — the policy wording", () => {
  it("is the owner's sentence verbatim", () => {
    // Pinned literally, not against the constant: the constant is what a future
    // edit would change, and this is the line that has to refuse to move.
    expect(RADIOLOGY_CLOSING_STATEMENT).toBe("Please correlate with clinical findings.");
    expect(RADIOLOGY_CLOSING_STATEMENT).not.toContain("history");
  });

  it("prints in its own element, outside the report body", () => {
    expect(radiologyClosingStatementHtml()).toBe(
      `<div class="${RADIOLOGY_CLOSING_STATEMENT_CLASS}">${RADIOLOGY_CLOSING_STATEMENT}</div>`,
    );
    expect(radiologyClosingStatementHtml()).not.toMatch(/RECOMMENDATION/i);
  });
});

describe("containsRadiologyClosingStatement — does this content already say it?", () => {
  it("says no for content that does not carry it", () => {
    expect(containsRadiologyClosingStatement(null)).toBe(false);
    expect(containsRadiologyClosingStatement(undefined)).toBe(false);
    expect(containsRadiologyClosingStatement("")).toBe(false);
    expect(containsRadiologyClosingStatement("<p>Normal study.</p>")).toBe(false);
    // The near misses must stay misses: this is the sentence the clinic mandates,
    // not any sentence about correlation. A report that only says "clinical
    // correlation advised" has not said it and still gets the fixed statement.
    expect(containsRadiologyClosingStatement("Clinical correlation advised.")).toBe(false);
    expect(containsRadiologyClosingStatement("Please correlate with clinical history.")).toBe(false);
  });

  it("says yes however the sentence got there", () => {
    expect(containsRadiologyClosingStatement(RADIOLOGY_CLOSING_STATEMENT)).toBe(true);
    // typed by the radiologist, with a stray space or no full stop
    expect(containsRadiologyClosingStatement("please  correlate with clinical FINDINGS")).toBe(true);
    // authored by his template inside markup
    expect(containsRadiologyClosingStatement("<p>Please correlate with clinical findings.</p>")).toBe(true);
    // followed by his own further advice — still one statement, not two
    expect(
      containsRadiologyClosingStatement("Please correlate with clinical findings. Repeat MRI in six weeks."),
    ).toBe(true);
    // and through the non-breaking space the editor writes
    expect(containsRadiologyClosingStatement("Please&nbsp;correlate with clinical findings.")).toBe(true);
  });
});

describe("radiologyClosingStatementHtmlIfAbsent — the once-only decision", () => {
  it("adds the statement when the content does not carry it", () => {
    expect(radiologyClosingStatementHtmlIfAbsent("<p>Normal study.</p>")).toBe(
      radiologyClosingStatementHtml(),
    );
    expect(radiologyClosingStatementHtmlIfAbsent("")).toBe(radiologyClosingStatementHtml());
  });

  it("adds nothing when the content already says it", () => {
    expect(
      radiologyClosingStatementHtmlIfAbsent("<p>Please correlate with clinical findings.</p>"),
    ).toBe("");
  });
});

describe("withoutRadiologyClosingStatement — the live-merge correction", () => {
  const doc = `<div class="report-column"><div class="body"><p>Findings.</p></div>` +
    `<div class="${RADIOLOGY_CLOSING_STATEMENT_CLASS}">${RADIOLOGY_CLOSING_STATEMENT}</div>` +
    `<div class="sigs"><p>Dr. Rao</p></div></div>`;

  it("removes only the statement element, leaving the body and signatures intact", () => {
    const out = withoutRadiologyClosingStatement(doc);
    expect(out).not.toContain(RADIOLOGY_CLOSING_STATEMENT);
    expect(out).toContain("<p>Findings.</p>");
    expect(out).toContain('<div class="sigs"><p>Dr. Rao</p></div>');
    expect(out.match(/<div/g)?.length).toBe(doc.match(/<div/g)!.length - 1);
  });

  it("is a no-op on a document that has no statement", () => {
    const none = `<div class="body"><p>Findings.</p></div>`;
    expect(withoutRadiologyClosingStatement(none)).toBe(none);
    expect(withoutRadiologyClosingStatement("")).toBe("");
  });
});
