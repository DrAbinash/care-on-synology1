/**
 * The workspace's "Download PDF" is jsPDF output, drawn by drawSideRailKeyImages.
 * Its sibling print surface (reportPresentation.ts) already had a caption rule
 * that hid it; this rail had never carried a caption at all, because the export
 * path flattened each stored image to a bare data URL and dropped the label.
 *
 * Assertions read the produced PDF's own text operators (`( … ) Tj`) rather than
 * shelling out to pdftotext, so the contract is checked on any machine that runs
 * the suite. Matching the operator also keeps an embedded JPEG's binary from
 * producing a false positive.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_SETTINGS, generateReportPDF, type ReportData } from "./reportPdfGenerator";

const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z";

function pdfBytes(keyImages: ReportData["keyImages"]): string {
  const doc = generateReportPDF(
    {
      patientName: "Sunita Sharma",
      age: "42 Y",
      sex: "F",
      studyDate: "20261012",
      referringDoctor: "Dr A Rao",
      modality: "MRI",
      bodyPart: "LS SPINE",
      clinicalHistory: "Low backache with left leg pain.",
      technique: "Multiplanar multisequence MRI of the lumbosacral spine.",
      findings: "L4-L5: Broad-based posterior disc extrusion compressing the traversing left L5 root.",
      impression: "L4-L5 disc extrusion with left L5 root compression.",
      recommendation: "",
      reportTitle: "MRI LUMBAR SPINE",
      keyImages,
    },
    { ...DEFAULT_PRINT_SETTINGS, show: { ...DEFAULT_PRINT_SETTINGS.show, keyImages: true } },
    null,
    { save: false },
  );
  return Buffer.from(doc.output("arraybuffer")).toString("latin1");
}

/** The strings jsPDF actually wrote, in draw order. */
const drawnText = (pdf: string) =>
  [...pdf.matchAll(/\(((?:[^()]|\([^)]*\))*)\)\s*Tj/g)].map((m) => m[1]);

/**
 * A label CARE would be inventing for a tile the radiologist left unnamed.
 * Deliberately does not match the rail's own "KEY IMAGES" heading — the word
 * boundary plus the negative look-ahead is what separates the two.
 */
const INVENTED_LABEL = /^(?:key image\b(?!s)|untitled|image \d+|n\/a|placeholder)/i;

const img = (caption?: string) => ({ src: JPEG, ...(caption === undefined ? {} : { caption }) });

const PT_PER_MM = 72 / 25.4;
/**
 * The rail's drawn geometry, read back out of the PDF's own operators. jsPDF
 * places each image with `w 0 0 h x y cm` + `/In Do`, so the tile's bottom edge
 * and column are known without trusting the code that drew them.
 */
function pdfGeometry(pdf: string) {
  const tiles = [...pdf.matchAll(/([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm\s*\/I\d+ Do/g)]
    .map((m) => ({ x: +m[3], y: +m[4], w: +m[1], h: +m[2] }))
    .filter((t) => Math.abs(t.w - 32 * PT_PER_MM) < 1 && Math.abs(t.h - 32 * PT_PER_MM) < 1)
    .sort((a, b) => b.y - a.y); // top of the page first (PDF origin is bottom-left)
  const text = [...pdf.matchAll(/BT\s*[\s\S]*?([\d.-]+) ([\d.-]+) Td\s*\(((?:[^()]|\([^)]*\))*)\) Tj/g)]
    .map((m) => ({ x: +m[1], y: +m[2], s: m[3] }));
  return { tiles, text };
}

describe("Download PDF's key-image rail captions", () => {
  it("draws the caption the radiologist entered, under its own image", () => {
    const text = drawnText(pdfBytes([img("T2 AXIAL C4-L5")]));
    expect(text).toContain("T2 AXIAL C4-L5");
  });

  it("puts each caption BELOW its own image, not over the pixels", () => {
    const { tiles, text } = pdfGeometry(pdfBytes([img("T2 SAG ITSELF"), img("FLAIR AX ITSELF")]));
    expect(tiles).toHaveLength(2);
    for (const [i, tile] of tiles.entries()) {
      const label = text.find((t) => t.s.startsWith(i === 0 ? "T2 SAG" : "FLAIR AX"));
      expect(label, `caption ${i} was never drawn`).toBeTruthy();
      // Below the port means a SMALLER pdf y (origin is bottom-left), in the same
      // column. A caption printed over the image — or beside it — fails this.
      expect(label!.y).toBeLessThan(tile.y);
      expect(Math.abs(label!.x - tile.x)).toBeLessThan(3);
    }
  });

  it("an uncaptioned rail reserves no space where a caption would have been", () => {
    const spacing = (keyImages: ReportData["keyImages"]) => {
      const { tiles } = pdfGeometry(pdfBytes(keyImages));
      expect(tiles).toHaveLength(2);
      return tiles[0].y - tiles[1].y;
    };
    const bare = spacing([img(""), img("")]);
    const captioned = spacing([img("T2 SAG"), img("FLAIR AX")]);
    // One port plus the inter-tile gap and nothing else: 32mm + 1.4mm.
    expect(Math.abs(bare - (32 + 1.4) * PT_PER_MM)).toBeLessThan(2);
    // A captioned rail is taller by the line it drew — not by an empty band.
    expect(captioned - bare).toBeGreaterThan(3);
  });

  it("an uncaptioned rail still fits the same number of images", () => {
    // Caption height is measured per tile, so a rail that charged the caption
    // band to every tile — even an uncaptioned one — would start dropping
    // images the radiologist attached. The count is read from the page, not
    // from the code that decided it.
    const five = [1, 2, 3, 4, 5].map(() => img(""));
    const { tiles } = pdfGeometry(pdfBytes(five));
    expect(tiles).toHaveLength(5);
    const captioned = pdfGeometry(pdfBytes([1, 2, 3, 4, 5].map((n) => img(`TILE ${n}`))));
    expect(captioned.tiles).toHaveLength(5);
    expect(drawnText(pdfBytes([1, 2, 3, 4, 5].map((n) => img(`TILE ${n}`)))))
      .toEqual(expect.arrayContaining(["TILE 1", "TILE 5"]));
  });

  it("invents nothing when there is no caption — no label, no placeholder", () => {
    for (const absent of [[img()], [img("")], [img("   \t ")], [img(undefined)]]) {
      const text = drawnText(pdfBytes(absent));
      const labelish = text.filter((s) => INVENTED_LABEL.test(s));
      expect(labelish, JSON.stringify(absent[0])).toEqual([]);
    }
  });

  it("keeps each caption bound to its own image, in rail order", () => {
    const text = drawnText(pdfBytes([img("FIRST TILE CAPTION"), img("SECOND TILE CAPTION")]));
    expect(text.indexOf("FIRST TILE CAPTION")).toBeLessThan(text.indexOf("SECOND TILE CAPTION"));
  });

  it("wraps a long caption instead of letting it run across the report body", () => {
    const long =
      "Broad-based posterior disc extrusion with severe thecal sac compression and bilateral facet hypertrophy at L4-L5 with traversing root impingement";
    const text = drawnText(pdfBytes([img(long)]));
    const pieces = text.filter((s) => long.startsWith(s.trim()) && s.trim().length > 0);
    // Split across at least two drawn lines, and every word still lands on the page.
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(long.split(/\s+/).every((w) => text.join(" ").includes(w))).toBe(true);
  });

  it("still accepts the bare data-URL shape the other pages pass", () => {
    const text = drawnText(pdfBytes([JPEG]));
    expect(text.filter((s) => INVENTED_LABEL.test(s))).toEqual([]);
    expect(text).toContain("MRI LUMBAR SPINE");
  });
});
