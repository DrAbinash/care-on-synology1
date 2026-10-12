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
import zlib from "node:zlib";
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
/** Bytes that carry a PNG data-URL prefix but are not a PNG: the attachment the
 *  object store handed back is corrupt, which is a different fault from an
 *  attachment that is simply absent. */
const CORRUPT = "data:image/png;base64,NOTACTUALPIXELSAAAA";

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

/** The 32 mm key-image PORTS, as rectangles on the page. A port's picture never
 *  exceeds 32 mm on either edge, while the letterhead wordmark is 183 pt wide, so
 *  the widest side separates the two — and it still finds a 4:3 DICOM render,
 *  which sits inside its port at 32 × 24 mm and is NOT square. Reporting the
 *  placement instead of the port was the mistake a square test fixture let
 *  through: the caption belongs to the port, and so does the space it reserves.
 *
 *  jsPDF centres the picture inside the port, so the port is the placement grown
 *  back to 32 mm on both axes. */
const tiles = (pdf: string) =>
  placed(pdf)
    .filter((p) => Math.abs(Math.max(p.w, p.h) - SQUARE_PT) < 1.5)
    .map((p) => ({
      x: p.x - (SQUARE_PT - p.w) / 2,
      y: p.y - (SQUARE_PT - p.h) / 2,
      w: SQUARE_PT,
      h: SQUARE_PT,
      pictureW: p.w,
      pictureH: p.h,
    }));

/** A solid-colour PNG of exactly the pixel size asked for, so a study image can
 *  be tested in the shape the clinic's renders actually have. */
function pngPixels(width: number, height: number): string {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0; // filter byte
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const crc = (b: Buffer) => {
    let c = ~0;
    for (const byte of b) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body), 0);
    return Buffer.concat([len, body, c]);
  };
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
/** 240 x 180 — the aspect ratio every frozen Orthanc render in the clinic has. */
const RENDER_4_3 = pngPixels(240, 180);

const drawnText = (pdf: string) =>
  [...pdf.matchAll(/\(((?:[^()]|\([^)]*\))*)\)\s*Tj/g)].map((m) => m[1]);

/**
 * Every string jsPDF drew, at the point it drew it. A text object sets the matrix
 * once, then walks the wrapped lines with `T*` under the leading it declared with
 * `TL`, so a two-line caption is two runs — reading only the first made the second
 * half of a label look as though it had never been printed.
 */
function textRuns(pdf: string) {
  const runs: { x: number; y: number; s: string }[] = [];
  for (const block of pdf.matchAll(/BT([\s\S]*?)ET/g)) {
    let x = 0;
    let y = 0;
    let leading = 0;
    for (const tok of block[1].matchAll(
      /(-?[\d.]+) (-?[\d.]+) (Td|Tm)|(-?[\d.]+) TL|T\*|\(((?:\\.|[^\\()])*)\)\s*Tj/g,
    )) {
      if (tok[3] === "Td") {
        x += +tok[1];
        y += +tok[2];
      } else if (tok[3] === "Tm") {
        x = +tok[1];
        y = +tok[2];
      } else if (tok[4] !== undefined) {
        leading = +tok[4];
      } else if (tok[0] === "T*") {
        y -= leading;
      } else {
        runs.push({ x, y, s: tok[5] });
      }
    }
  }
  return runs;
}

const pageCount = (pdf: string) => (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;

/**
 * Per-page ports and text. jsPDF writes one content stream per page, and a port
 * on page 3 sits at the same coordinates as a caption on page 1 — geometry
 * compared across pages reports collisions that appear on no single sheet, and
 * hides the ones that do.
 */
function pagesOf(pdf: string) {
  return [...pdf.matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
    .map((m) => m[1])
    .filter((s) => /\/I\d+ Do|\/F\d+ [\d.]+ Tf/.test(s))
    .map((s) => ({ ports: tiles(s), text: textRuns(s) }));
}

/**
 * Per-page ports and text. jsPDF writes one content stream per page, and a port
 * on page 2 sits at the same coordinates as the body text on page 1 — comparing
 * across pages would report a collision that appears on no single sheet.
 */
function pages(pdf: string) {
  return [...pdf.matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
    .map((m) => m[1])
    .filter((s) => /\/I\d+ Do/.test(s) || /BT/.test(s))
    .map((s) => ({ tiles: tiles(s), runs: textRuns(s) }));
}

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

/**
 * Text whose baseline lands inside a port's rectangle. PDF user space has its
 * origin at the bottom-left, so the placement `w 0 0 h x y cm` covers
 * [y, y + h] and a caption sits just under y. Only a failed cell's own label is
 * allowed inside — a caption that has drifted in is printed over the image.
 */
function insidePort(
  r: { x: number; y: number },
  p: { x: number; y: number; w: number; h: number },
) {
  return r.x >= p.x - 0.01 && r.x <= p.x + p.w + 0.01 && r.y >= p.y - 0.01 && r.y <= p.y + p.h + 0.01;
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
    const per = pagesOf(pdfBytes(series(14, (i) => img(`T${i}`))));
    expect(per.reduce((a, p) => a + p.ports.length, 0)).toBe(14);
    for (const { ports: t } of per) {
      for (const a of t) {
        for (const b of t) {
          if (a === b) continue;
          const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          expect(Math.min(xOverlap, yOverlap), JSON.stringify({ a, b })).toBeLessThanOrEqual(0.01);
        }
      }
    }
  });

  it("keeps every caption clear of the port below it", () => {
    // Wrapping is measured with the same call that draws, so a caption has to
    // occupy the height it was measured for. Words landing inside the next
    // image's port is unreadable, and only a long caption reveals it.
    const long = (i: number) =>
      `Broad-based posterior disc extrusion at L${4 + (i % 2)}-L${5 + (i % 2)} compressing the traversing root ${i}`;
    const pdf = pdfBytes(series(14, (i) => img(long(i))));
    const per = pagesOf(pdf);
    // Non-vacuous split: every page's stream must carry both its ports and its
    // text, or "clear of the port below it" is only comparing one page to itself.
    expect(per).toHaveLength(pageCount(pdf));
    expect(per.reduce((a, p) => a + p.ports.length, 0)).toBe(14);
    for (const { ports, text } of per) {
      const onImage = text.filter((r) => ports.some((p) => insidePort(r, p)));
      expect(onImage.map((r) => r.s), "text drawn on top of an image").toEqual([]);
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
    const t = tiles(pdf);
    const runs = textRuns(pdf);
    expect(t).toHaveLength(3);
    const text = drawnText(pdf).join(" | ");
    expect(/could not be read|unreadable|not available on disk/i.test(text)).toBe(true);
    expect(text).toContain("1.2.826.0.1.3680043.9.5500.3.1.101");
    expect(text).toContain("707");
    // Identified by its position in the rail as well as by its stored keys, so the
    // radiologist can find the attachment in the panel and re-select it.
    expect(/#2\b/.test(text)).toBe(true);
    // The cell itself has to carry that identification, not only the line at the
    // top of the page: a blank port with a short word in it reads like a caption
    // the software invented, which is exactly what the brief forbids.
    const failedTile = t[1];
    const inCell = runs
      .filter((r) => insidePort(r, failedTile))
      .map((r) => r.s)
      .join(" ");
    expect(inCell).toContain("KEY IMAGE #2 COULD NOT BE READ");
    // The failed cell gets no band beneath it either — its caption is empty, and
    // nothing may be written there in the radiologist's name.
    expect(captionUnder(failedTile, runs)).toBe(null);
    // The warning must not become the image's caption.
    const bands = t.map((tile) => captionUnder(tile, runs));
    expect(bands.filter((b) => b !== null && !/could not be read|unreadable/i.test(b)))
      .toEqual(["FIRST", "THIRD"]);
  });

  it("keeps the caption of an attachment whose stored bytes are corrupt", () => {
    // A corrupt file is a different fault from a missing one: the row exists, the
    // radiologist wrote a sentence for it, and that sentence must survive the
    // failed read rather than being replaced by the warning.
    const pdf = pdfBytes([
      { src: CORRUPT, caption: "Left basal ganglia T2 hyperintensity", attachmentId: 901, sopInstanceUid: "1.2.826.0.1.3680043.9.777" },
      img("OK"),
    ]);
    expect(tiles(pdf)).toHaveLength(2);
    const text = drawnText(pdf).join(" | ");
    expect(text).toContain("INTEGRITY: 1 of 2");
    expect(text).toContain("901");
    expect(text).toContain("1.2.826.0.1.3680043.9.777");
    expect(text).toContain("Left basal ganglia T2 hyperintensity");
    // The line may not claim no caption exists when the page prints one.
    expect(text).not.toContain("No caption has been written");
  });

  it("never overprints two strings inside one image cell", () => {
    // Every failed cell gets exactly one label. Two runs at the same coordinate
    // inside a port is a smear the radiologist cannot read.
    const pdf = pdfBytes([
      { src: CORRUPT, caption: "C1", attachmentId: 901, sopInstanceUid: "1.2.3.4" },
      { src: "", caption: "", attachmentId: 902, sopInstanceUid: null },
      img("C3"),
      img("C4"),
    ]);
    const per = pagesOf(pdf);
    expect(per.reduce((a, p) => a + p.ports.length, 0)).toBe(4);
    for (const { ports: t, text: runs } of per) {
      for (const tile of t) {
        const inside = runs.filter((r) => insidePort(r, tile));
        const at = new Set<string>();
        for (const r of inside) {
          const key = `${Math.round(r.x)},${Math.round(r.y)}`;
          expect(at.has(key), `overprint at ${key} in ${JSON.stringify(inside.map((q) => q.s))}`).toBe(false);
          at.add(key);
        }
      }
    }
  });

  it("counts every port when the study image is not square", () => {
    // A frozen Orthanc render is 240x180, so the picture inside a 32 mm port is
    // 32 x 24 mm — the port is square, the image is not. Counting only square
    // placements reported 0 ports for a real 14-image study while every image
    // was on the page. The association is re-checked here in the shape the
    // clinic actually exports.
    const keyImages = series(14, (i) => ({ src: RENDER_4_3, caption: `CAP-${String(i).padStart(2, "0")}` }));
    const pdf = pdfBytes(keyImages);
    const t = tiles(pdf);
    expect(t, `${t.length} ports for 14 stored images`).toHaveLength(14);
    const runs = textRuns(pdf);
    expect(t.map((tile) => captionUnder(tile, runs))).toEqual(keyImages.map((k) => k.caption));
    for (const p of t) {
      expect(Math.max(p.pictureW, p.pictureH)).toBeLessThanOrEqual(SQUARE_PT + 0.5);
      expect(Math.min(p.pictureW, p.pictureH)).toBeLessThan(SQUARE_PT - 1);
    }
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
