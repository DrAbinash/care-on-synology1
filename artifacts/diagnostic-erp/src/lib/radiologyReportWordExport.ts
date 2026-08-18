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
 */

export interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  isBreak?: boolean;
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
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

/**
 * Splits one buildPreviewHtml() document into an ordered list of blocks.
 * Matches recognized block tags in document order; the outer <div> wrapper
 * and every style="…" attribute are ignored by construction — only the tag
 * NAMES below are matched, nothing else is interpreted as markup.
 */
export function parseReportHtmlToBlocks(html: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const blockRe =
    /<div[^>]*class="[^"]*study-title-bar[^"]*"[^>]*>([\s\S]*?)<\/div>|<div[^>]*class="[^"]*section-heading[^"]*"[^>]*>([\s\S]*?)<\/div>|<h2[^>]*>([\s\S]*?)<\/h2>|<h3[^>]*><u>([\s\S]*?)<\/u><\/h3>|<hr[^>]*\/?>|<ul[^>]*>([\s\S]*?)<\/ul>|<ol[^>]*>([\s\S]*?)<\/ol>|<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const [full, titleBar, sectionH, h2, h3, ul, ol, p] = m;
    if (titleBar !== undefined) { blocks.push({ type: "heading1", text: decodeEntities(stripTags(titleBar)) }); continue; }
    if (sectionH !== undefined) { blocks.push({ type: "heading2", text: decodeEntities(stripTags(sectionH)) }); continue; }
    if (h2 !== undefined) { blocks.push({ type: "heading1", text: decodeEntities(stripTags(h2)) }); continue; }
    if (h3 !== undefined) { blocks.push({ type: "heading2", text: decodeEntities(stripTags(h3)) }); continue; }
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

const DEMOGRAPHY_LINE_RE = /^(NAME:|AGE\/SEX:|REFD\.?\s*BY:|REF\.?\s*BY:|DATE:)/i;

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
};

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
  let saveAs: typeof import("file-saver").saveAs;
  try {
    ({
      Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
      Header, Footer, Table, TableRow, TableCell, WidthType, ImageRun,
    } = await import("docx"));
    ({ saveAs } = await import("file-saver"));
  } catch {
    throw new Error(
      "Could not load the Word export module (page is stale or the ERP tunnel returned an error page). Reload this page and try again.",
    );
  }

  const { CARE_LETTERHEAD_LOGO_DATA_URL } = await import("./careLetterheadLogo");
  const blocks = parseReportHtmlToBlocks(html).filter((b) => !paragraphLooksLikeDemography(b));
  const children: InstanceType<typeof Paragraph>[] = [];

  const runsFor = (segments: InlineSegment[]) =>
    segments.map((s) =>
      s.isBreak
        ? new TextRun({ text: "", break: 1 })
        : new TextRun({ text: s.text, bold: s.bold, italics: s.italic }),
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
        spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: block.text, bold: true, size: 22, underline: {} })],
      }));
    } else if (block.type === "divider") {
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } },
        spacing: { after: 80 },
        children: [],
      }));
    } else if (block.type === "paragraph") {
      children.push(new Paragraph({ spacing: { after: 100 }, children: runsFor(block.segments) }));
    } else if (block.type === "list") {
      block.items.forEach((item, i) => {
        const runs = block.ordered
          ? [new TextRun({ text: `${i + 1}. ` }), ...runsFor(item)]
          : runsFor(item);
        children.push(new Paragraph({
          bullet: block.ordered ? undefined : { level: 0 },
          spacing: { after: 40 },
          children: runs,
        }));
      });
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
                    transformation: { width: 244, height: 83 },
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
                    text: "Near Bajla Mahila College, St. Francis School Road, Castair's Town, DEOGHAR-814 112",
                    size: 14,
                    font: "Helvetica",
                  })],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 0 },
                  children: [new TextRun({ text: "(JHARKHAND)", size: 14, font: "Helvetica" })],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 0 },
                  children: [new TextRun({ text: "Phone: 75490 99099, 99734 97200", size: 14, font: "Helvetica" })],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { after: 80 },
                  children: [new TextRun({ text: "Email: care.deoghar@gmail.com", size: 14, font: "Helvetica" })],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: noBorder,
              width: { size: 5400, type: WidthType.DXA },
              children: [new Paragraph({ children: [
                new TextRun({ text: "NAME: ", bold: true, size: 20 }),
                new TextRun({ text: name, size: 20 }),
              ] })],
            }),
            new TableCell({
              borders: noBorder,
              width: { size: 3960, type: WidthType.DXA },
              children: [new Paragraph({ children: [
                new TextRun({ text: "AGE/SEX: ", bold: true, size: 20 }),
                new TextRun({ text: ageSex, size: 20 }),
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
                new TextRun({ text: "REFD. BY: ", bold: true, size: 20 }),
                new TextRun({ text: refBy, size: 20 }),
              ] })],
            }),
            new TableCell({
              borders: noBorder,
              width: { size: 3960, type: WidthType.DXA },
              children: [new Paragraph({ children: [
                new TextRun({ text: "DATE: ", bold: true, size: 20 }),
                new TextRun({ text: dateStr, size: 20 }),
              ] })],
            }),
          ],
        }),
      ],
    }),
  ];

  const doc = new Document({
    sections: [{
      properties: {},
      headers: { default: new Header({ children: headerChildren }) },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({
                text: "MULTI SLICE CT SCAN | 3D/4D ULTRA SOUND | COLOUR DOPPLER | MAMMOGRAPHY | ECHO | DIGITAL X-RAY | ECG/EEG",
                size: 12,
                bold: true,
                color: "0F2D6E",
              })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 60 },
              children: [new TextRun({
                text: "PATHOLAB | OPG | TMT | NCV/EMG | ELASTOGRAPHY/FIBROSCAN | UPPER GI ENDOSCOPY | HSG | BARIUM STUDY | TVS",
                size: 12,
                bold: true,
                color: "0F2D6E",
              })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({
                text: "Radiological diagnosis is not always conclusive & often vary with clinical course of the disease or response to treatment. This report is not for medico-legal purpose.",
                size: 12,
                italics: true,
              })],
            }),
          ],
        }),
      },
      children,
    }],
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${fileBaseName}.docx`);
}
