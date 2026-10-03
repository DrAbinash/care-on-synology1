/**
 * Spine report formats must be documents, not paragraphs.
 *
 * The clinic reports spine on fixed sub-headings — Alignment, Vertebral Body,
 * Disc Level Analysis, Facets & Ligaments, Thecal Sac & Neural Structures,
 * Posterior Structures, and a canal diameter table. Those headings used to
 * exist only inside the format's `findingsItems` list; what actually loaded
 * into the editor was `defaultFindings`, and that was one run-on sentence per
 * format, which is why a spine report printed as a wall of text.
 *
 * The sync rule is tested here too because it decides whether a shipped format
 * improvement reaches an installed database at all.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "structuredReportTemplates.ts"), "utf8");

const SPINE_HEADINGS = [
  "Alignment",
  "Vertebral Body",
  "Disc Level Analysis",
  "Facets & Ligaments",
  "Thecal Sac & Neural Structures",
  "Posterior Structures",
];

/** The `defaultFindings:` value belonging to a named preset. */
function defaultFindingsOf(templateName: string): string {
  const at = src.indexOf(`"${templateName}"`);
  expect(at, `preset ${templateName}`).toBeGreaterThan(-1);
  const from = src.slice(at);
  const m = from.match(/defaultFindings:\s*`([\s\S]*?)`,/);
  expect(m, `${templateName} declares defaultFindings as a multi-line document`).not.toBeNull();
  // This repo's source files are CRLF, so a multi-line literal carries \r into
  // the string the API will store. findingsDocument.ts normalises it at parse
  // time; the assertions here do the same so they read the document, not the
  // line endings.
  return m![1].replace(/\r\n/g, "\n");
}

describe("spine presets are authored as sub-headed documents", () => {
  for (const name of ["MRI LS Spine", "MRI Cervical Spine", "MRI Dorsal Spine"]) {
    it(`${name} carries every spine sub-heading`, () => {
      const text = defaultFindingsOf(name);
      for (const heading of SPINE_HEADINGS) {
        expect(text, `${name} → ${heading}`).toContain(`${heading}:`);
      }
    });

    it(`${name} puts each heading on its own line, never inline with its body`, () => {
      // "Alignment: Normal lordosis..." would render as one labelled sentence;
      // "Alignment:" alone is what makes it a section heading.
      const text = defaultFindingsOf(name);
      for (const heading of SPINE_HEADINGS) {
        expect(new RegExp(`^${heading}:$`, "m").test(text), heading).toBe(true);
      }
    });

    it(`${name} gives every disc level its own line under Disc Level Analysis`, () => {
      const text = defaultFindingsOf(name);
      const discBlock = text.split("\n\n").find((b) => b.startsWith("Disc Level Analysis:"));
      expect(discBlock, "Disc Level Analysis block").toBeTruthy();
      const levels = discBlock!.split("\n").slice(1);
      expect(levels.length).toBeGreaterThanOrEqual(5);
      for (const line of levels) expect(line).toMatch(/^[CTL]\d/);
    });
  }

  it("lumbar and cervical carry a canal diameter table", () => {
    for (const [name, heading] of [
      ["MRI LS Spine", "Canal Diameter"],
      ["MRI Cervical Spine", "Cervical Canal Diameter"],
    ] as const) {
      const text = defaultFindingsOf(name);
      expect(new RegExp(`^${heading}:$`, "m").test(text), `${name} → ${heading}`).toBe(true);
      const rows = text.split("\n").filter((l) => l.trim().startsWith("|"));
      expect(rows[0], "table header row").toBe("| Level | AP Canal (mm) |");
      expect(rows.length, "header + one row per level").toBeGreaterThanOrEqual(6);
    }
  });

  it("never prints a canal measurement the radiologist did not take", () => {
    // A preset that ships "14" in a measurement column invites a number into a
    // signed report that nobody measured. The cell stays empty until filled.
    for (const name of ["MRI LS Spine", "MRI Cervical Spine"]) {
      const rows = defaultFindingsOf(name)
        .split("\n")
        .filter((l) => l.trim().startsWith("|"))
        .slice(1);
      for (const row of rows) expect(row).toMatch(/\|\s*—\s*\|$/);
    }
  });

  it("whole-spine screening keeps its own wording untouched", () => {
    // Only the three dedicated spine formats were re-authored; the screening
    // formats are different clinical documents and were not in scope.
    for (const name of ["MRI LS Spine with Whole Spine Screening", "MRI Cervical Spine with Whole Spine Screening"]) {
      const at = src.indexOf(`"${name}"`);
      expect(at, name).toBeGreaterThan(-1);
      expect(src.slice(at, at + 4000)).not.toContain("Disc Level Analysis:");
    }
  });
});

describe("preset sync refreshes by ownership, not by section count", () => {
  it("never overwrites a format a named person edited", () => {
    expect(src).toMatch(/function isCodeOwned\(/);
    expect(src).toMatch(/if \(!existing \|\| !isCodeOwned\(existing\.updatedBy\)\) continue;/);
  });

  it("refreshes a system-owned row whenever its content differs from code", () => {
    // The old count heuristic could not express "same sections, better wording",
    // so a shipped wording improvement never reached the clinic's database.
    expect(src).toMatch(/const differs = \(Object\.keys\(wanted\)/);
    expect(src).toMatch(/if \(!differs\) continue;/);
    expect(src).toContain("system-preset-format-refresh");
  });

  it("has retired the count heuristic entirely", () => {
    expect(src).not.toContain("countFindingsItems");
    expect(src).not.toContain("system-spine-format-upgrade");
  });

  it("treats a seeded row (createdBy system, never edited) as code-owned", () => {
    expect(src).toMatch(/return !updatedBy \|\| updatedBy === "system" \|\| updatedBy\.startsWith\("system-"\);/);
  });
});
