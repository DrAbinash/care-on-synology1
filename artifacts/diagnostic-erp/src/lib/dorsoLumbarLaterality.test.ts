/**
 * dorsoLumbarLaterality.test.ts — the dorso-lumbar var row may not take
 * free-text laterality (audit F-12).
 *
 * Unlike the lumbar and dorsal panels which use a select, the dorso-lumbar
 * var row took free text for 'side', cast to DorsoLumbarSide. Typed values
 * such as 'L', 'rt' or 'Left side' failed the enum check in sidePhrase, so
 * the printed phrase kept the literal 'right/left' wording while the ledger
 * recorded the typed string — ambiguous laterality in a printed report is a
 * patient-safety issue.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const panel = readFileSync(
  resolve(PKG_DIR, "src/components/radiology/reporting-canvas/MriDorsoLumbarSubMasterPanel.tsx"),
  "utf8",
).replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const model = readFileSync(
  resolve(PKG_DIR, "src/lib/mriDorsoLumbarSubMasters.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("F-12: the dorso-lumbar side is a controlled select, not free text", () => {
  it("the var row renders a select with exactly the enum options", () => {
    // Lazy [\s\S]*? spans the attribute list — the onChange arrow (=>) contains
    // a '>' that a negated [^>]* class cannot cross.
    expect(panel).toMatch(
      /<select className=\{MINI\}[\s\S]*?value=\{side\}[\s\S]*?data-testid="dorsolumbar-var-side"/,
    );
    for (const opt of ["left", "right", "bilateral"]) {
      expect(panel).toContain(`<option value="${opt}">${opt}</option>`);
    }
  });

  it("no free-text input remains bound to the side state", () => {
    expect(panel).not.toMatch(/<input[^>]*value=\{side\}/);
  });

  it("the model still sequence-guards the side before phrasing", () => {
    // sidePhrase replaces 'right/left' only for a true enum value; anything
    // else leaves the library wording untouched instead of guessing.
    expect(model).toMatch(
      /const chosen = side === "left" \|\| side === "right"\s*\?\s*side\s*:\s*side === "bilateral"\s*\?\s*"right and left"\s*:\s*"";/,
    );
  });
});
