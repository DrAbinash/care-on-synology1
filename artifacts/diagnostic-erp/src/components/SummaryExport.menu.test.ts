import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "SummaryExport.tsx"), "utf8");

function occurrences(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

/** The menu the clinic used to show: four formats, listed twice, eight items in total. */
const OLD_MENU = `
  onClick={() => doPrint(config, "full")}
  onClick={() => downloadWord(config, "full")}
  onClick={() => downloadExcel(config, "full")}
  onClick={() => doPrint(config, "simple")}
  onClick={() => downloadWord(config, "simple")}
  onClick={() => downloadExcel(config, "simple")}
`;

describe("one list of formats, not two", () => {
  it("the scanner the ratchet uses can see the old duplication", () => {
    expect(occurrences(OLD_MENU, "doPrint(config, ")).toBe(2);
    expect(occurrences(OLD_MENU, "downloadWord(config, ")).toBe(2);
    expect(occurrences(OLD_MENU, "downloadExcel(config, ")).toBe(2);
  });

  it("each format is wired exactly once", () => {
    for (const call of ["doPrint(config, ", "downloadWord(config, ", "downloadExcel(config, "]) {
      expect(occurrences(source, call)).toBe(1);
    }
    expect(occurrences(source, "sendSummaryEmail(config!, addr, emailEndpoint, ")).toBe(1);
  });

  it("no menu item is offered twice with a Simple prefix", () => {
    for (const label of ["Simple Print", "Simple Excel", "Simple Word"]) {
      expect(source).not.toContain(label);
    }
    // The only "Simple PDF" left is the primary button's own label, which reports the single
    // choice that was made — it is not a second menu entry.
    expect(occurrences(source, "Simple PDF")).toBe(1);
    expect(source).toContain('view === "simple" && !compact ? "Simple PDF" : "PDF"');
  });

  it("chooses the content once, in a radio group, and every handler reads it", () => {
    expect(source).toContain("What to export");
    expect(source).toContain('setScope(v as ExportMode)');
    expect(source).toContain('onClick={() => doPrint(config, view)}');
    expect(source).toContain('onClick={() => downloadWord(config, view)}');
    expect(source).toContain('onClick={() => downloadExcel(config, view)}');
    expect(source).toContain("sendSummaryEmail(config!, addr, emailEndpoint, view)");
  });

  it("never offers the simple ledger on a page that has none", () => {
    expect(source).toContain("const view: ExportMode = hasSimple ? scope : \"full\";");
    expect(source).toContain("{hasSimple ? (");
  });

  it("keeps Email a single item that follows the same choice", () => {
    expect(occurrences(source, "<Mail size={13} /> Email")).toBe(1);
    expect(source).toContain("Simple ledger (one page)");
  });

  it("still offers the page orientation it always did", () => {
    expect(source).toContain('value="landscape"');
    expect(source).toContain('value="portrait"');
    expect(source).toContain("persistSummaryPdfOrientation(o)");
  });
});
