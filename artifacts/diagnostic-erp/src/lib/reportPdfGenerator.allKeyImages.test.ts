/**
 * The workspace's "Download PDF" had to show every image the radiologist attached.
 * It did not: the page-1 side rail stopped at whatever fitted beside the text and
 * the remainder was never drawn anywhere, so a 14-image study exported 5 or 6
 * tiles with no notice (measured in real Chromium on the integrated tree, PR #942).
 *
 * These tests read the produced PDF's own operators — image placements (`w 0 0 h
 * x y cm` + `/In Do`), text runs (`Td` + `Tj`) and page objects — so the contract
 * is checked against the artefact the clinic signs, not against the code that made
 * it. Counts, order, caption binding, capitalisation, aspect ratio, pagination and
 * the failure notice are all read back out of the file.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRINT_SETTINGS,
  generateReportPDF,
  type ReportData,
  type ReportKeyImage,
} from "./reportPdfGenerator";

const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z";
/** 6 x 4 — the only way to prove the rail keeps the source's shape, because every
 *  frozen key image in the clinic is square and would pass either way. */
const PNG_3_2 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAIAAAAiZtkUAAAAEUlEQVR4nGOQq7iDhhjIFQIAFOcisXU6GlUAAAAASUVORK5CYII=";
/** 4 x 6 */
const PNG_2_3 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAGCAIAAABrW6giAAAAEElEQVR4nGO4UyEHRwyUcgBbOSKxloCk8wAAAABJRU5ErkJggg==";

const PT_PER_MM = 72 / 25.4;
const SQUARE_MM = 32;
const SQUARE_PT = SQUARE_MM * PT_PER_MM;

function pdfBytes(keyImages: ReportData["keyImages"], extra: Partial<ReportData> = {}): string {
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
      recommendation: "Correlate clinically.",
      reportTitle: "MRI LUMBAR SPINE",
      keyImages,
      ...extra,
    },
    { ...DEFAULT_PRINT_SETTINGS, show: { ...DEFAULT_PRINT_SETTINGS.show, keyImages: true } },
    null,
    { save: false },
  );
  return Buffer.from(doc.output("arraybuffer")).toString("latin1");
}

/** Every image placement jsPDF wrote, in document order — which is draw order. */
function placed(pdf: string) {
  return [...pdf.matchAll(/([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm\s*\/I\d+ Do/g)].map((m) => ({
    w: +m[1],
    h: +m[2],
    x: +m[3],
    y: +m[4],
  }));
}

/** The 32 mm key-image ports only. The letterhead wordmark is an image too, and
 *  is drawn at its own height, so sizing the filter keeps it out of the count. */
const tiles = (pdf: string) =>
  placed(pdf).filter((p) => Math.abs(p.w - SQUARE_PT) < 1.5 && Math.abs(p.h - SQUARE_PT) < 1.5);

const drawnText = (pdf: string) =>
  [...pdf.matchAll(/\(((?:[^()]|\([^)]*\))*)\)\s*Tj/g)].map((m) => m[1]);

const textRuns = (pdf: string) =>
  [...pdf.matchAll(/BT\s*[\s\S]*?([\d.-]+) ([\d.-]+) Td\s*\(((?:[^()]|\([^)]*\))*)\) Tj/g)]
    .map((m) => ({ x: +m[1], y: +m[2], s: m[3] }));

const pageCount = (pdf: string) => (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;

/**
 * The caption jsPDF wrote under this port. A caption's first line sits about
 * 5.3 pt under its own port (capLineH 6.25 pt × 0.85), while the next port down
 * is ~100 pt away and ITS caption is ~105 pt away — so the window is deliberately
 * tight: widening it would let an uncaptioned tile borrow the label of the tile
 * below it and the "no band for an uncaptioned image" test would prove nothing.
 */
function captionUnder(tile: { x: number; y: number }, runs: { x: number; y: number; s: string }[]) {
  const below = runs
    .filter((r) => Math.abs(r.x - tile.x) < 3 && tile.y - r.y > 0 && tile.y - r.y < 9)
    .sort((a, b) => b.y - a.y);
  return below[0]?.s ?? null;
}

const img = (caption = ""): ReportKeyImage => ({ src: JPEG, caption });
const series = (n: number, make: (i: number) => ReportKeyImage) => Array.from({ length: n }, (_, i) => make(i));

const INVENTED_LABEL = /^(?:key image\b(?!s)|untitled|image \d+|n\/a|placeholder)/i;

describe("Download PDF carries every attached key image", () => {
  for (const n of [0, 1, 4, 6, 7, 14, 20]) {
    it(`draws all ${n} attached image(s), in the order the radiologist set`, () => {
      const keyImages = series(n, (i) => img(`CAP-${String(i).padStart(2, "0")}`));
      const pdf = pdfBytes(keyImages);
      const t = tiles(pdf);
      expect(t, `${t.length} ports drawn for ${n} stored images`).toHaveLength(n);

      const runs = textRuns(pdf);
      const readBack = t.map((tile) => captionUnder(tile, runs));
      expect(readBack).toEqual(keyImages.map((k) => k.caption));
    });
  }

  it("paginates automatically rather than running off the page", () => {
    const pdf = pdfBytes(series(20, (i) => img(`TILE ${i}`)));
    expect(pageCount(pdf)).toBeGreaterThan(1);
    // Nothing may sit inside the footer reserve or above the letterhead chrome.
    for (const t of tiles(pdf)) {
      expect(t.y).toBeLessThan(297 * PT_PER_MM);
      expect(t.y - SQUARE_PT).toBeGreaterThan(0);
    }
  });

  it("never lets two ports or a port and the caption above it overlap", () => {
    const t = tiles(pdfBytes(series(14, (i) => img(`T${i}`))));
    expect(t.length).toBe(14);
    for (const a of t) {
      for (const b of t) {
        if (a === b) continue;
        const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(Math.min(xOverlap, yOverlap), JSON.stringify({ a, b })).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it("keeps the image's own aspect ratio inside the square port", () => {
    // Diffed against the same report with no image at all, so the letterhead
    // wordmark — also drawn with addImage, at its own size — cannot be mistaken
    // for the key image under test.
    const none = placed(pdfBytes([]));
    const one = (src: string) => {
      const after = placed(pdfBytes([{ src, caption: "" }]));
      const key = after.filter((p) => !none.some((q) => q.x === p.x && q.y === p.y && q.w === p.w && q.h === p.h));
      expect(key, `${src.slice(0, 30)}… drew ${key.length} placement(s)`).toHaveLength(1);
      return key[0];
    };
    const wide = one(PNG_3_2); // 6 x 4
    expect(wide.w / wide.h).toBeCloseTo(6 / 4, 2);
    expect(wide.w).toBeLessThanOrEqual(SQUARE_PT + 0.5);
    expect(wide.h).toBeLessThanOrEqual(SQUARE_PT + 0.5);
    const tall = one(PNG_2_3); // 4 x 6
    expect(tall.h / tall.w).toBeCloseTo(6 / 4, 2);
  });

  it("prints the caption exactly as entered, in the radiologist's own case", () => {
    const mixed = "Left basal ganglia T2 hyperintensity";
    const pdf = pdfBytes([img(mixed), img("T2 AXIAL C4-L5 LESION")]);
    const text = drawnText(pdf);
    expect(text).toContain(mixed);
    expect(text.some((s) => s.toUpperCase() === mixed && s !== mixed)).toBe(false);
  });

  it("draws no band and no words for an image nobody captioned", () => {
    const pdf = pdfBytes([img("REAL CAPTION"), img(""), img("   "), img("")]);
    const t = tiles(pdf);
    expect(t).toHaveLength(4);
    const runs = textRuns(pdf);
    const bands = t.map((tile) => captionUnder(tile, runs));
    expect(bands.filter((b) => b !== null)).toEqual(["REAL CAPTION"]);
    expect(drawnText(pdf).filter((s) => INVENTED_LABEL.test(s))).toEqual([]);
  });

  it("names an attachment whose pixels could not be read instead of dropping it", () => {
    const failed: ReportKeyImage = {
      src: "",
      caption: "",
      attachmentId: 707,
      sopInstanceUid: "1.2.826.0.1.3680043.9.5500.3.1.101",
    };
    const pdf = pdfBytes([img("FIRST"), failed, img("THIRD")]);
    // Counted as a tile: 3 attachments in, 3 cells on the page — the radiologist
    // can see the gap rather than trusting a number they cannot check.
    expect(tiles(pdf)).toHaveLength(3);
    const text = drawnText(pdf).join(" | ");
    expect(/could not be read|unreadable|not available on disk/i.test(text)).toBe(true);
    expect(text).toContain("1.2.826.0.1.3680043.9.5500.3.1.101");
    expect(text).toContain("707");
    // Identified by its position in the rail as well as by its stored keys, so the
    // radiologist can find the attachment in the panel and re-select it.
    expect(/#2\b/.test(text)).toBe(true);
    // The warning must not become the image's caption.
    const runs = textRuns(pdf);
    const bands = tiles(pdf).map((tile) => captionUnder(tile, runs));
    expect(bands.filter((b) => b !== null && !/could not be read|unreadable/i.test(b)))
      .toEqual(["FIRST", "THIRD"]);
  });

  it("still fits the page-1 rail exactly as it did when everything fitted", () => {
    // The continuation must not move the rail: a short study keeps the layout the
    // clinic already signs, so the first five ports are the same five as before.
    const before = tiles(pdfBytes(series(5, (i) => img(`R${i}`))));
    const after = tiles(pdfBytes(series(12, (i) => img(`R${i}`))));
    expect(after.slice(0, before.length).map((t) => [Math.round(t.x), Math.round(t.y)])).toEqual(
      before.map((t) => [Math.round(t.x), Math.round(t.y)]),
    );
  });
});
