/**
 * What the report counter is allowed to show.
 *
 * `/api/resolve-barcode/patient/:id/reports` stopped selecting `body` and
 * `impression` in PR-2, and the request test proves the wire response carries no
 * clinical text. That is only half of it: the counter card had its own impression
 * paragraph underneath the title, so a clerk read the diagnosis sentence on
 * screen. The field going undefined made that paragraph stop rendering
 * silently — the right outcome arrived at by the wrong route, and one revert of
 * the endpoint would undo it.
 *
 * So this pins the consumer. It is a source contract because the alternative is
 * a browser session, and the assertion that matters — "no clinical text is read
 * into this page's JSX" — is a property of the code, not of one render.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.resolve(__dirname, "ReportDelivery.tsx"), "utf8");

describe("Report Delivery counter data scope", () => {
  it("has no slice of the type that carries report content", () => {
    const typeBlock = /type PatientReport = \{([\s\S]*?)\n\};/.exec(src);
    expect(typeBlock, "PatientReport type not found — anchor stale, not the code safe").toBeTruthy();
    const fields = [...typeBlock![1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]!);
    expect(fields.length).toBeGreaterThan(5);
    expect(fields).not.toContain("body");
    expect(fields).not.toContain("impression");
    // Identity fields the counter genuinely needs must survive the narrowing, or
    // the clerk cannot tell which report a patient is collecting.
    for (const needed of ["reportNumber", "testName", "signedByName", "physicalState"]) {
      expect(fields, `${needed} is what identifies the report at the counter`).toContain(needed);
    }
  });

  it("never renders a report's clinical text into the page", () => {
    const jsx = src.slice(src.indexOf("return ("));
    expect(jsx).not.toMatch(/\{r\.impression\b/);
    expect(jsx).not.toMatch(/\{r\.body\b/);
    // A future field read must be argued for, not added quietly.
    expect(jsx).not.toMatch(/\{r\.(structuredJson|parameters|criticalNote)\b/);
  });

  it("states the empty-list reason in the rule the server actually applies", () => {
    // "verified or completed" described statuses the release rule never used; a
    // clerk told that would wait for a countersignature that is not coming.
    expect(src).not.toMatch(/verified or completed before delivery/i);
    expect(src).toMatch(/once it is signed/i);
  });
});
