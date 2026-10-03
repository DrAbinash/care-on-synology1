import { describe, expect, it } from "vitest";
import {
  findingsBlocksToPlainText,
  findingsDocumentHasStructure,
  parseFindingsDocument,
  sectionsToFindingsText,
  tableToFindingsText,
} from "./findingsDocument";

const SPINE = [
  "Alignment:",
  "Normal lumbar lordosis maintained. No scoliosis or listhesis.",
  "",
  "Disc Level Analysis:",
  "| Level | Disc | Canal AP (mm) |",
  "| L1-L2 | Normal | 14 |",
  "| L2-L3 | Normal | 13 |",
  "",
  "L4-L5: Broad-based disc bulge, no root compression.",
].join("\n");

describe("parseFindingsDocument", () => {
  it("turns a bare Label: line into a heading block", () => {
    const blocks = parseFindingsDocument(SPINE);
    expect(blocks[0]).toEqual({ kind: "heading", text: "Alignment" });
    expect(blocks[1]).toMatchObject({
      kind: "para",
      text: "Normal lumbar lordosis maintained. No scoliosis or listhesis.",
    });
  });

  it("collects consecutive pipe rows into one table with header and data rows", () => {
    const table = parseFindingsDocument(SPINE).find((b) => b.kind === "table");
    expect(table).toMatchObject({
      header: ["Level", "Disc", "Canal AP (mm)"],
      rows: [["L1-L2", "Normal", "14"], ["L2-L3", "Normal", "13"]],
    });
  });

  it("skips a markdown separator row when present", () => {
    const blocks = parseFindingsDocument("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(blocks[0]).toMatchObject({ kind: "table", rows: [["1", "2"]] });
  });

  it("keeps 'Label: body' on one line as a paragraph, not a heading", () => {
    // Existing presets and radiologist-typed reports use this shape, and the
    // letter-pad PDF already bolds the label. Nothing may regress them into a
    // heading followed by an orphaned sentence.
    const last = parseFindingsDocument(SPINE).at(-1);
    expect(last).toMatchObject({
      kind: "para",
      text: "L4-L5: Broad-based disc bulge, no root compression.",
    });
  });

  it("treats a markdown heading marker as a heading", () => {
    expect(parseFindingsDocument("## Vertebral Body\nNormal heights.")[0])
      .toEqual({ kind: "heading", text: "Vertebral Body" });
  });

  it("leaves plain free text as paragraphs — today's behaviour, unchanged", () => {
    const free = "Lumbar lordosis is preserved. Vertebral body heights are maintained.";
    expect(parseFindingsDocument(free)).toEqual([{ kind: "para", text: free }]);
    expect(findingsDocumentHasStructure(free)).toBe(false);
    expect(findingsDocumentHasStructure(SPINE)).toBe(true);
  });

  it("groups multi-line bodies into one paragraph and breaks on blank lines", () => {
    const blocks = parseFindingsDocument("Facets & Ligaments:\nFacet arthropathy at L3-L4.\nLigamentum flavum normal.\n\nSpinal Canal:\nMild central stenosis.");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "para", "heading", "para"]);
    expect(blocks[1].kind === "para" && blocks[1].text)
      .toBe("Facet arthropathy at L3-L4.\nLigamentum flavum normal.");
  });

  it("parses nothing out of an empty or whitespace-only report", () => {
    expect(parseFindingsDocument("")).toEqual([]);
    expect(parseFindingsDocument("   \n\n  ")).toEqual([]);
    expect(parseFindingsDocument(null)).toEqual([]);
  });

  it("survives CRLF line endings, which is what this repo's files use", () => {
    const crlf = "Alignment:\r\nNormal lordosis.\r\n\r\nCanal Diameter:\r\n| L1-L2 | 14 |";
    expect(parseFindingsDocument(crlf).map((b) => b.kind))
      .toEqual(["heading", "para", "heading", "table"]);
  });
});

describe("findingsBlocksToPlainText", () => {
  it("upper-cases headings and pads table columns so they line up", () => {
    const text = findingsBlocksToPlainText(parseFindingsDocument(SPINE));
    expect(text).toContain("ALIGNMENT\n");
    expect(text).toContain("DISC LEVEL ANALYSIS\n");
    // jsPDF's default font is proportional, so the plain-text grid has to be
    // padded by the renderer — the canal column must start at the same offset
    // on the header row and on every data row.
    const grid = text.split("\n").filter((l) => l.startsWith("Level") || l.startsWith("L1-L2") || l.startsWith("L2-L3"));
    expect(grid).toEqual([
      "Level  Disc    Canal AP (mm)",
      "L1-L2  Normal  14",
      "L2-L3  Normal  13",
    ]);
    expect(text).toContain("L4-L5: Broad-based disc bulge");
  });

  it("honours title_case headings when the presentation asks for it", () => {
    expect(findingsBlocksToPlainText(parseFindingsDocument(SPINE), "title_case"))
      .toContain("Alignment\n");
  });
});

describe("authors", () => {
  it("sectionsToFindingsText writes the heading convention the parser reads", () => {
    const text = sectionsToFindingsText([
      { heading: "Alignment", body: "Normal lordosis." },
      { heading: "Vertebral Body", body: "Normal heights." },
    ]);
    expect(text).toBe("Alignment:\nNormal lordosis.\n\nVertebral Body:\nNormal heights.");
    expect(parseFindingsDocument(text).map((b) => b.kind))
      .toEqual(["heading", "para", "heading", "para"]);
  });

  it("drops empty sections instead of emitting a bare heading", () => {
    expect(sectionsToFindingsText([
      { heading: "Alignment", body: "Normal." },
      { heading: "Facets", body: "   " },
    ])).toBe("Alignment:\nNormal.");
  });

  it("round-trips a table through author and parser", () => {
    const text = tableToFindingsText(["Level", "Canal AP (mm)"], [["L1-L2", "14"], ["L2-L3", "13"]]);
    const table = parseFindingsDocument(text)[0];
    expect(table).toMatchObject({ header: ["Level", "Canal AP (mm)"], rows: [["L1-L2", "14"], ["L2-L3", "13"]] });
  });
});
