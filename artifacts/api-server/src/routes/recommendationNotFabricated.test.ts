/**
 * Two policies, and they are not in conflict — they are what keeps each other true.
 *
 * (1) Owner reporting policy, 27 October 2026: "Please correlate with clinical
 *     findings." closes every radiology report, exactly once, in print, in PDF and on
 *     the signed document, whether or not the Recommendations field was filled. That
 *     is a fixed statement of the DOCUMENT and is proven in
 *     `lib/reportPresentation.closingStatement.test.ts` (every server surface),
 *     `patient-reports.d6.test.ts` (the frozen artifact) and the two ERP suites for the
 *     Preview/Word document and the live print merge.
 *
 * (2) The Recommendations SECTION still reports only what the radiologist entered.
 *     The print / PDF builder used to render `input.recommendation ?? "Please
 *     correlate with clinical findings."`, so an empty section printed that sentence
 *     UNDER THE HEADING — attributed to the signer and delivered to the referrer as his
 *     advice. The same literal was written into drafts by the template-apply effect in
 *     the ERP, where it survived to be signed. Both are refused here, and the sentence
 *     instead arrives as the document's own statement, visibly not his.
 *
 * So: mandated once, never attributed. Cases 1-3 execute (2); case 4 pins the renderer,
 * because `buildReportHtml` itself is module-private and reachable only through a
 * database-backed route: without the pin, a re-added default would pass every test
 * above. The matching ERP-side pin — the template-apply effect that wrote the same
 * literal into drafts, where it then printed as authored text — is
 * `diagnostic-erp/src/lib/startReportDelegation.contract.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { recommendationSectionText } from "./radiology-report-generator";

const read = (...parts: string[]) =>
  readFileSync(resolve(__dirname, ...parts), "utf8").replace(/\r\n/g, "\n");

const RENDERER = read("./radiology-report-generator.ts");

/** The sentence, matched across source line breaks: a wrapped comment must not be able
 *  to hide a real injection, and a comment elsewhere in the file must not fail it. */
const SENTENCE_IN_SOURCE = /please\s+correlate\s+with\s+clinical\s+findings/i;

describe("recommendationSectionText — an unentered recommendation renders nothing", () => {
  it("1. absent, null and blank all omit the section", () => {
    expect(recommendationSectionText(undefined)).toBeNull();
    expect(recommendationSectionText(null)).toBeNull();
    expect(recommendationSectionText("")).toBeNull();
    expect(recommendationSectionText("   \n\t ")).toBeNull();
  });

  it("2. an authored recommendation is preserved verbatim", () => {
    const authored = "MRI Brain with contrast is recommended if clinically indicated.";
    expect(recommendationSectionText(authored)).toBe(authored);
  });

  it("3. surrounding whitespace is trimmed but the wording is untouched", () => {
    expect(recommendationSectionText("  Review in six weeks.  ")).toBe("Review in six weeks.");
  });
});

describe("the Recommendation section is never fabricated", () => {
  it("4. the print renderer omits the section instead of supplying one", () => {
    // The renderer must still ASK the helper, not merely omit the literal: a
    // `showRec`-only gate prints an empty Recommendation heading.
    const fn = RENDERER.slice(
      RENDERER.indexOf("const renderRecommendation = () =>"),
      RENDERER.indexOf("const renderComparison = () =>"),
    );
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).toContain("recommendationSectionText(input.recommendation)");
    expect(fn).toContain("if (showRec && text)");
    // And the mandated sentence must not be handed back as though it were his advice.
    expect(fn).not.toMatch(SENTENCE_IN_SOURCE);
  });
});
