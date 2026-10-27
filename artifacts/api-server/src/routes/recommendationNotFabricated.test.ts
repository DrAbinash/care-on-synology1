/**
 * A signed report must not carry a recommendation the radiologist never entered.
 *
 * The print / PDF builder used to render `input.recommendation ?? "Please
 * correlate with clinical findings."`, so a report with an empty Recommendation
 * still printed that sentence under the heading — attributed to the signer and
 * delivered to the referrer. The same literal was written into drafts by the
 * template-apply effect in the ERP, where it survived to be signed.
 *
 * Cases 1-3 execute the rule. Case 4 pins the renderer, because `buildReportHtml`
 * itself is module-private and reachable only through a database-backed route:
 * without the pin, a re-added default would pass every test above. The matching
 * ERP-side pin — the template-apply effect that wrote the same literal into
 * drafts, where it then printed as authored text — is
 * `diagnostic-erp/src/lib/startReportDelegation.contract.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { recommendationSectionText } from "./radiology-report-generator";

const read = (...parts: string[]) =>
  readFileSync(resolve(__dirname, ...parts), "utf8").replace(/\r\n/g, "\n");

const RENDERER = read("./radiology-report-generator.ts");

const FABRICATED = "Please correlate with clinical findings.";

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

describe("the fabricated default cannot come back", () => {
  it("4. the print renderer omits the section instead of supplying one", () => {
    expect(RENDERER).not.toContain(FABRICATED);

    // The renderer must still ASK the helper, not merely omit the literal: a
    // `showRec`-only gate prints an empty Recommendation heading.
    const fn = RENDERER.slice(
      RENDERER.indexOf("const renderRecommendation = () =>"),
      RENDERER.indexOf("const renderComparison = () =>"),
    );
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).toContain("recommendationSectionText(input.recommendation)");
    expect(fn).toContain("if (showRec && text)");
  });
});
