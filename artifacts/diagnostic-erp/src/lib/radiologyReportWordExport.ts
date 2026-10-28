/**
 * radiologyReportWordExport.ts — export the in-app radiology draft to .docx.
 *
 * The clinic does not generate radiology reports from this app — reports are
 * composed in Word and exported to PDF/DOCX outside it. Verified: every
 * finalize in RadiologyReportingWorkspace runs the "LEGACY path" (its own UI
 * says so — no ff_radiology_* structured-report flag is ever enabled in any
 * seed). (GET /api/patient-reports/:id/pdf used to send Content-Type:
 * text/html instead of a real PDF — fixed since; it now renders via headless
 * Chromium the same way this file exports to Word.)
 *
 * This does not try to make the in-app builder trustworthy as a FINAL output.
 * It converts the same HTML the workspace already renders in its own Preview
 * pane (buildPreviewHtml() → previewHtml, RadiologyReportingWorkspace.tsx)
 * into a downloadable Word document, so a radiologist can start from what
 * they already typed in the structured UI instead of retyping patient/study/
 * findings/impression from scratch — then finish and sign in Word as they
 * already do today. It is a starting point, not a signed artifact; nothing
 * here touches patient_reports or any signature/delivery flow.
 *
 * buildPreviewHtml's output is a KNOWN, closed vocabulary — this app
 * generates every byte of it, no user-supplied markup ever reaches here:
 * <h2>, <h3><u>…</u></h3>, <p>, <hr>, <ul>/<ol><li>, and inline
 * <strong>/<em>/<br/>. This is a purpose-built converter for exactly that
 * shape, not a general HTML-to-docx tool — it will not attempt to handle
 * arbitrary HTML from anywhere else in the app.
 *
 * parseReportHtmlToBlocks() is the exception: it is also the reader used by
 * storedReportBody.ts to recover sections from a SIGNED patient_reports.body,
 * which five different writers produce in five different shapes. It therefore
 * accepts bare <h1>/<h3>/<h4>/<h5>/<h6> as well. Anything it does not
 * recognise is ignored rather than guessed at.
 */

export interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  isBreak?: boolean;
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&nbsp;": " ",
  "&apos;": "'", "&#39;": "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|nbsp|apos|#39);/g, (m) => ENTITY_MAP[m] ?? m);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/**
 * Tokenizes one block's inner HTML into an ordered list of inline segments,
 * honoring <strong>, <em> and <br/>. buildPreviewHtml never nests these more
 * than one level deep (never <strong><em>…</em></strong>) — this does not
 * attempt to support deeper nesting than that.
 *
 * Opening tags allow attributes (`[^>]*`) — buildPreviewHtml's own empty-
 * findings placeholder is `<em style='color:#aaa;'>No findings entered.</em>`,
 * an attributed <em>. A bare-tag-only pattern would leave that whole opening
 * tag as literal, uninterpreted TEXT — every draft exported before findings
 * are filled in (the single most common moment to export) would show a raw
 * `<em style='color:#aaa;'>` tag to the reader instead of italic text.
 */
export function parseInlineHtml(html: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const parts = html.split(/(<br\s*\/?>|<strong[^>]*>|<\/strong>|<em[^>]*>|<\/em>)/i);
  let bold = false;
  let italic = false;
  for (const part of parts) {
    if (part === "") continue;
    if (/^<br\s*\/?>$/i.test(part)) { segments.push({ text: "", isBreak: true }); continue; }
    if (/^<strong[^>]*>$/i.test(part)) { bold = true; continue; }
    if (/^<\/strong>$/i.test(part)) { bold = false; continue; }
    if (/^<em[^>]*>$/i.test(part)) { italic = true; continue; }
    if (/^<\/em>$/i.test(part)) { italic = false; continue; }
    const text = decodeEntities(part);
    if (text.length === 0) continue;
    segments.push({ text, bold: bold || undefined, italic: italic || undefined });
  }
  return segments;
}

export type ReportBlock =
  | { type: "heading1"; text: string }
  | { type: "heading2"; text: string }
  | { type: "divider" }
  | { type: "paragraph"; segments: InlineSegment[] }
  | { type: "list"; ordered: boolean; items: InlineSegment[][] };

/** One key image for the Word rail: pixels as a data URL, plus the
 *  radiologist's own caption. An empty `src` is a picture whose pixels could
 *  not be read — it still takes its place, in words, exactly as the PDF rail
 *  and the print renderer treat it. */
export interface WordKeyImageInput {
  src: string;
  caption?: string | null;
}

/** What the docx builder can actually draw: a typed ImageRun, or an honest
 *  placeholder. Anything that is not a decodable png/jpeg data URL (remote
 *  URLs, unknown mimes, empty pixels) is an unreadable — the builder never
 *  guesses a type for bytes it cannot vouch for. */
export type WordKeyImageSpec =
  | { kind: "image"; src: string; mime: "jpg" | "png"; caption: string }
  | { kind: "unreadable"; caption: string };

export function parseWordKeyImages(keyImages: WordKeyImageInput[]): WordKeyImageSpec[] {
  return keyImages.map((k) => {
    const caption = (k.caption ?? "").trim();
    const src = (k.src ?? "").trim();
    const m = /^data:image\/(jpeg|png);base64,/i.exec(src);
    if (m) {
      return { kind: "image", src, mime: m[1].toLowerCase() === "png" ? "png" : "jpg", caption };
    }
    return { kind: "unreadable", caption };
  });
}

/**
 * Removes the client preview's text-only KEY IMAGES stand-in (the heading and
 * the list immediately after it) — the explicit keyImages param supplies the
 * real pictures, and a textual "Image 1 (KEY): …" list beside the images
 * themselves is a second, poorer copy of the same section. Blocks around the
 * stand-in are untouched, and a KEY IMAGES heading with no list still drops
 * (the heading alone says nothing the images do not).
 */
export function dropKeyImagesTextBlocks(blocks: ReportBlock[]): ReportBlock[] {
  const out: ReportBlock[] = [];
  let skippingList = false;
  for (const b of blocks) {
    if (b.type === "heading2" && b.text.trim().toUpperCase() === "KEY IMAGES") {
      skippingList = true;
      continue;
    }
    if (skippingList && b.type === "list") {
      skippingList = false;
      continue;
    }
    skippingList = false;
    out.push(b);
  }
  return out;
}

/**
 * Splits preview/print HTML into an ordered list of blocks. Matches recognized
 * tags and the server renderer's exact signature class tokens in document order.
 * Signature fields are text only, including the server's unsigned marker;
 * no configured signer identity is supplied by this converter.
 *
 * The generic <h1>/<h3>…<h6> alternative sits AFTER the <h3><u> one so
 * buildPreviewHtml's underlined headings keep parsing as heading2 exactly as
 * before. It exists because stored patient_reports bodies come from five
 * different writers, and three of them (command centre, USG companion,
 * reporting studio) use bare <h3>/<h4> headings that this parser used to skip
 * — dropping those sections from Word export and from anything else that reads
 * a signed body back.
 */
export function parseReportHtmlToBlocks(html: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const blockRe =
    /<div[^>]*class="[^"]*study-title-bar[^"]*"[^>]*>([\s\S]*?)<\/div>|<div[^>]*class="[^"]*section-heading[^"]*"[^>]*>([\s\S]*?)<\/div>|<h2[^>]*>([\s\S]*?)<\/h2>|<h3[^>]*><u>([\s\S]*?)<\/u><\/h3>|<h([13456])[^>]*>([\s\S]*?)<\/h[13456]>|<hr[^>]*\/?>|<ul[^>]*>([\s\S]*?)<\/ul>|<ol[^>]*>([\s\S]*?)<\/ol>|<p[^>]*>([\s\S]*?)<\/p>|<div\b[^>]*\sclass=(?<sigQuote>["'])(?:[^"']*\s)?(?:signame|sigmeta|sigwhen|signot)(?:\s[^"']*)?\k<sigQuote>[^>]*>(?<signature>[\s\S]*?)<\/div>|<div\b[^>]*\bclass=(?<csQuote>["'])[^"']*\bclosing-statement\b[^"']*\k<csQuote>[^>]*>(?<closing>[\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const [full, titleBar, sectionH, h2, h3, hLevel, hGeneric, ul, ol, p] = m;
    if (m.groups?.signature !== undefined) {
      const text = decodeEntities(stripTags(m.groups.signature.replace(/<br\s*\/?>/gi, "\n"))).trim();
      if (text) blocks.push({ type: "paragraph", segments: [{ text }] });
      continue;
    }
    if (m.groups?.closing !== undefined) {
      const text = decodeEntities(stripTags(m.groups.closing)).trim();
      if (text) blocks.push({ type: "paragraph", segments: [{ text, italic: true }] });
      continue;
    }
    if (titleBar !== undefined) { blocks.push({ type: "heading1", text: decodeEntities(stripTags(titleBar)) }); continue; }
    if (sectionH !== undefined) { blocks.push({ type: "heading2", text: decodeEntities(stripTags(sectionH)) }); continue; }
    if (h2 !== undefined) { blocks.push({ type: "heading1", text: decodeEntities(stripTags(h2)) }); continue; }
    if (h3 !== undefined) { blocks.push({ type: "heading2", text: decodeEntities(stripTags(h3)) }); continue; }
    if (hGeneric !== undefined) {
      blocks.push({
        type: hLevel === "1" ? "heading1" : "heading2",
        text: decodeEntities(stripTags(hGeneric)),
      });
      continue;
    }
    if (ul !== undefined || ol !== undefined) {
      const listInner = ul ?? ol;
      const items = [...listInner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => parseInlineHtml(li[1]));
      blocks.push({ type: "list", ordered: ol !== undefined, items });
      continue;
    }
    if (p !== undefined) { blocks.push({ type: "paragraph", segments: parseInlineHtml(p) }); continue; }
    if (full.toLowerCase().startsWith("<hr")) { blocks.push({ type: "divider" }); continue; }
  }
  return blocks;
}

const DEMOGRAPHY_LINE_RE = /^(NAME:|AGE\/SEX:|REFD\.?\s*BY:|REF\.?\s*BY:|DATE:|UHID[:\s]|ACCESSION[:\s]|ACC[:\s])/i;

function paragraphLooksLikeDemography(block: ReportBlock): boolean {
  if (block.type !== "paragraph") return false;
  const text = block.segments.map((s) => s.text).join("").trim();
  return DEMOGRAPHY_LINE_RE.test(text);
}

export type WordLetterheadOpts = {
  patientName?: string;
  age?: string;
  sex?: string;
  referringDoctor?: string;
  studyDate?: string;
  /**
   * The two identifiers that make the sheet traceable: the hospital's own UHID
   * and the PACS accession number. A Word copy of a report that names neither
   * cannot be tied back to the examination it describes — which is what the
   * printed page and the PDF both carry (`reportPdfGenerator.ts:1102`).
   */
  uhid?: string;
  accessionNumber?: string;
  chrome?: import("./careLetterpadChrome").CareLetterpadChrome;
  /**
   * When true: omit the embedded CARE letterhead and leave the ~42 mm top margin so
   * the radiologist can print on the pre-printed physical letter-pad. Demography
   * still appears, in the body instead of the page header. The workspace now passes
   * `!showLetterpadHeader` — the same switch the PDF door reads — rather than
   * hard-coding it, so a Word copy carries the hospital letterhead whenever the
   * clinic's own Header setting is on.
   */
  physicalLetterpad?: boolean;
  /**
   * The report's key images — the SAME merged picture set the PDF door draws
   * (frozen pixels keep their slots, uncovered refs fetched live; a signed
   * study carries its frozen artifact pictures only). The HTML layer cannot
   * carry them: the server-layout rail is a <figure> shape this parser
   * deliberately does not interpret, and the client fallback renders a
   * text-only stand-in list. Without this param the Word document carries no
   * images at all — which was the defect.
   */
  keyImages?: WordKeyImageInput[];
};

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The largest box a key image may occupy in the Word body, in CSS px
 *  (the docx transformation is in px at 96 dpi — content width is ~6.5 in). */
const WORD_IMAGE_MAX_PX = 320;

function fitImageBox(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (!naturalWidth || !naturalHeight) {
    return { width: WORD_IMAGE_MAX_PX, height: Math.round(WORD_IMAGE_MAX_PX * 0.75) };
  }
  const scale = Math.min(1, WORD_IMAGE_MAX_PX / Math.max(naturalWidth, naturalHeight));
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

/** Read a data URL's intrinsic size (browser only) — the aspect ratio must
 *  come from the pixels themselves, not a guessed constant. */
function probeImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const el = new Image();
    el.onload = () => resolve({ width: el.naturalWidth || 0, height: el.naturalHeight || 0 });
    el.onerror = () => resolve({ width: 0, height: 0 });
    el.src = src;
  });
}

function formatWordAgeSex(age?: string, sex?: string): string {
  const a = (age || "").trim();
  const s = (sex || "").trim().toUpperCase();
  if (a && s) return `${a} / ${s}`;
  return a || s;
}

/** A safe, short filename component — same intent as uploads.ts's sanitiser
 *  on the server side, kept local since this runs in the browser. */
export function safeFileNamePart(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return clean.length > 0 ? clean.slice(0, 80) : "report";
}

/**
 * Builds a downloadable .docx from preview/print HTML, with the CARE letter-pad
 * header and NAME/AGE/SEX demography (same chrome as the PDF).
 */
export async function exportRadiologyReportToWord(
  html: string,
  fileBaseName: string,
  letterhead?: WordLetterheadOpts,
): Promise<void> {
  let Document: typeof import("docx").Document;
  let Packer: typeof import("docx").Packer;
  let Paragraph: typeof import("docx").Paragraph;
  let TextRun: typeof import("docx").TextRun;
  let AlignmentType: typeof import("docx").AlignmentType;
  let BorderStyle: typeof import("docx").BorderStyle;
  let Header: typeof import("docx").Header;
  let Footer: typeof import("docx").Footer;
  let Table: typeof import("docx").Table;
  let TableRow: typeof import("docx").TableRow;
  let TableCell: typeof import("docx").TableCell;
  let WidthType: typeof import("docx").WidthType;
  let ImageRun: typeof import("docx").ImageRun;
  let convertMillimetersToTwip: typeof import("docx").convertMillimetersToTwip;
  let saveAs: typeof import("file-saver").saveAs;
  try {
    ({
      Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
      Header, Footer, Table, TableRow, TableCell, WidthType, ImageRun,
      convertMillimetersToTwip,
    } = await import("docx"));
    ({ saveAs } = await import("file-saver"));
  } catch {
    throw new Error(
      "Could not load the Word export module (page is stale or the ERP tunnel returned an error page). Reload this page and try again.",
    );
  }

  const { CARE_LETTERHEAD_LOGO_DATA_URL, CARE_LETTERHEAD_LOGO_SIZE } = await import("./careLetterheadLogo");
  const { resolveCareLetterpadChrome, parseMeasurementMm, parseMeasurementPt } = await import("./careLetterpadChrome");
  const chrome = resolveCareLetterpadChrome(letterhead?.chrome);
  const logoMm = parseMeasurementMm(chrome.logoHeight) ?? 22;
  const logoHeightPx = Math.round(logoMm * 96 / 25.4);
  const logoWidthPx = Math.round(logoHeightPx * (CARE_LETTERHEAD_LOGO_SIZE.width / CARE_LETTERHEAD_LOGO_SIZE.height));
  const addrHalfPt = Math.round((parseMeasurementPt(chrome.addressFontSize) ?? 7.2) * 2);
  const keyImageSpecs = parseWordKeyImages(letterhead?.keyImages ?? []);
  const parsedBlocks = parseReportHtmlToBlocks(html).filter((b) => !paragraphLooksLikeDemography(b));
  // Real images replace the fallback preview's text-only stand-in list.
  const blocks = keyImageSpecs.length > 0 ? dropKeyImagesTextBlocks(parsedBlocks) : parsedBlocks;
  const children: InstanceType<typeof Paragraph>[] = [];

  const runsFor = (segments: InlineSegment[], size = 24) =>
    segments.map((s) =>
      s.isBreak
        ? new TextRun({ text: "", break: 1 })
        : new TextRun({ text: s.text, bold: s.bold, italics: s.italic, size }),
    );

  for (const block of blocks) {
    if (block.type === "heading1") {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 120 },
        children: [new TextRun({ text: block.text, bold: true, size: 28, underline: {} })],
      }));
    } else if (block.type === "heading2") {
      children.push(new Paragraph({
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: block.text, bold: true, size: 26, underline: {} })],
      }));
    } else if (block.type === "divider") {
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } },
        spacing: { after: 80 },
        children: [],
      }));
    } else if (block.type === "paragraph") {
      children.push(new Paragraph({ spacing: { after: 120 }, children: runsFor(block.segments, 24) }));
    } else if (block.type === "list") {
      block.items.forEach((item, i) => {
        const runs = block.ordered
          ? [new TextRun({ text: `${i + 1}. `, size: 24 }), ...runsFor(item, 24)]
          : runsFor(item, 24);
        children.push(new Paragraph({
          bullet: block.ordered ? undefined : { level: 0 },
          spacing: { after: 60 },
          children: runs,
        }));
      });
    }
  }

  // ── The key-image rail ──
  // The PDF door draws these from the same merged set; the Word document used
  // to drop them entirely (the parser has no <figure> vocabulary and the
  // client fallback prints a text-only stand-in). One heading, then one
  // centered picture per entry — pixels where they arrived, words where they
  // did not, and the radiologist's caption under its own picture.
  if (keyImageSpecs.length > 0) {
    children.push(new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: "KEY IMAGES", bold: true, size: 26, underline: {} })],
    }));
    for (const img of keyImageSpecs) {
      if (img.kind === "image") {
        const natural = await probeImageSize(img.src);
        const box = fitImageBox(natural.width, natural.height);
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: img.caption ? 20 : 120 },
          children: [new ImageRun({
            type: img.mime,
            data: dataUrlToBytes(img.src),
            transformation: { width: box.width, height: box.height },
          })],
        }));
      } else {
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: img.caption ? 20 : 120 },
          children: [new TextRun({ text: "IMAGE COULD NOT BE READ", bold: true, size: 20, color: "B91C1C" })],
        }));
      }
      if (img.caption) {
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: img.caption, italics: true, size: 20 })],
        }));
      }
    }
  }

  const noBorder = {
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  };
  const name = (letterhead?.patientName || "").trim().toUpperCase();
  const ageSex = formatWordAgeSex(letterhead?.age, letterhead?.sex).toUpperCase();
  const refBy = (letterhead?.referringDoctor || "").trim().toUpperCase();
  const dateStr = (letterhead?.studyDate || "").trim();
  const uhid = (letterhead?.uhid || "").trim();
  const accession = (letterhead?.accessionNumber || "").trim();
  const physicalLetterpad = letterhead?.physicalLetterpad !== false;
  // Clinic Word workflow: leave ~42mm for pre-printed letter-pad and use
  // readable body type (12pt). Embedded CARE chrome is only for digital Header ON.

  const identityCell = (label: string, value: string, width: number) => new TableCell({
    borders: noBorder,
    width: { size: width, type: WidthType.DXA },
    children: [new Paragraph({
      // An identifier the record does not have prints as nothing, never as a bare
      // label: the print path already refuses "UHID:" over an empty value.
      children: value
        ? [
          new TextRun({ text: `${label} `, bold: true, size: 22 }),
          new TextRun({ text: value.toUpperCase(), size: 22 }),
        ]
        : [],
    })],
  });

  const demographyTable = new Table({
    width: { size: 9360, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: noBorder,
            width: { size: 5400, type: WidthType.DXA },
            children: [new Paragraph({ children: [
              new TextRun({ text: "NAME: ", bold: true, size: 22 }),
              new TextRun({ text: name, size: 22 }),
            ] })],
          }),
          new TableCell({
            borders: noBorder,
            width: { size: 3960, type: WidthType.DXA },
            children: [new Paragraph({ children: [
              new TextRun({ text: "AGE/SEX: ", bold: true, size: 22 }),
              new TextRun({ text: ageSex, size: 22 }),
            ] })],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            borders: noBorder,
            width: { size: 5400, type: WidthType.DXA },
            children: [new Paragraph({ children: [
              new TextRun({ text: "REFD. BY: ", bold: true, size: 22 }),
              new TextRun({ text: refBy, size: 22 }),
            ] })],
          }),
          new TableCell({
            borders: noBorder,
            width: { size: 3960, type: WidthType.DXA },
            children: [new Paragraph({ children: [
              new TextRun({ text: "DATE: ", bold: true, size: 22 }),
              new TextRun({ text: dateStr, size: 22 }),
            ] })],
          }),
        ],
      }),
      // UHID left, ACCESSION right — the same row the PDF draws
      // (`reportPdfGenerator.ts:1102-1120`). A label with nothing after it is
      // printed as nothing: the print path already refuses "UHID:" over an empty
      // value, and a referrer reading one would think the record has none.
      new TableRow({
        children: [
          identityCell("UHID:", uhid, 5400),
          identityCell("ACCESSION:", accession, 3960),
        ],
      }),
    ],
  });

  const headerChildren: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: noBorder,
              width: { size: 4800, type: WidthType.DXA },
              children: [new Paragraph({
                spacing: { after: 0 },
                children: [
                  new ImageRun({
                    type: "png",
                    data: dataUrlToBytes(CARE_LETTERHEAD_LOGO_DATA_URL),
                    transformation: { width: logoWidthPx, height: logoHeightPx },
                  }),
                ],
              })],
            }),
            new TableCell({
              borders: noBorder,
              width: { size: 4560, type: WidthType.DXA },
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 0 },
                  children: [new TextRun({
                    text: chrome.addressLine1,
                    size: addrHalfPt,
                    font: "Helvetica",
                  })],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 0 },
                  children: [new TextRun({ text: chrome.addressLine2, size: addrHalfPt, font: "Helvetica" })],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 0 },
                  children: [new TextRun({ text: `Phone: ${chrome.phones}`, size: addrHalfPt, font: "Helvetica" })],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 0 },
                  children: [new TextRun({ text: `Email: ${chrome.email}`, size: addrHalfPt, font: "Helvetica" })],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 80 },
                  children: [new TextRun({ text: chrome.website, size: addrHalfPt, font: "Helvetica" })],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    demographyTable,
  ];

  const bodyChildren: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = physicalLetterpad
    ? [
        new Paragraph({ spacing: { after: 120 }, children: [] }),
        demographyTable,
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } },
          spacing: { after: 160 },
          children: [],
        }),
        ...children,
      ]
    : [...children];

  const doc = new Document({
    sections: [{
      properties: physicalLetterpad
        ? {
            page: {
              margin: {
                top: convertMillimetersToTwip(42),
                right: convertMillimetersToTwip(18),
                bottom: convertMillimetersToTwip(18),
                left: convertMillimetersToTwip(18),
              },
            },
          }
        : {},
      ...(physicalLetterpad
        ? {}
        : { headers: { default: new Header({ children: headerChildren }) }}),
      ...(physicalLetterpad
        ? {}
        : {
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({
                      text: chrome.servicesRow1,
                      size: 12,
                      bold: true,
                      color: "0F2D6E",
                    })],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 60 },
                    children: [new TextRun({
                      text: chrome.servicesRow2,
                      size: 12,
                      bold: true,
                      color: "0F2D6E",
                    })],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({
                      text: chrome.disclaimer,
                      size: 12,
                      italics: true,
                    })],
                  }),
                ],
              }),
            },
          }),
      children: bodyChildren,
    }],
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${fileBaseName}.docx`);
}
