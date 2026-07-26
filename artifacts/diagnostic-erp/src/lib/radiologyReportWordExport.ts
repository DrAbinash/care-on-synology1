/**
 * radiologyReportWordExport.ts — export the in-app radiology draft to .docx.
 *
 * The clinic does not generate radiology reports from this app — reports are
 * composed in Word and exported to PDF/DOCX outside it. Verified: every
 * finalize in RadiologyReportingWorkspace runs the "LEGACY path" (its own UI
 * says so — no ff_radiology_* structured-report flag is ever enabled in any
 * seed), and GET /api/patient-reports/:id/pdf sends Content-Type: text/html,
 * not a real PDF.
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
    /<h2[^>]*>([\s\S]*?)<\/h2>|<h3[^>]*><u>([\s\S]*?)<\/u><\/h3>|<hr[^>]*\/?>|<ul[^>]*>([\s\S]*?)<\/ul>|<ol[^>]*>([\s\S]*?)<\/ol>|<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const [full, h2, h3, ul, ol, p] = m;
    if (h2 !== undefined) { blocks.push({ type: "heading1", text: decodeEntities(stripTags(h2)) }); continue; }
    if (h3 !== undefined) { blocks.push({ type: "heading2", text: decodeEntities(stripTags(h3)) }); continue; }
    if (ul !== undefined || ol !== undefined) {
      const listInner = ul ?? ol;
      const items = [...listInner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => parseInlineHtml(li[1]));
      blocks.push({ type: "list", ordered: ol !== undefined, items });
      continue;
    }
    if (p !== undefined) { blocks.push({ type: "paragraph", segments: parseInlineHtml(p) }); continue; }
    // Only remaining alternative that can match here is <hr>.
    if (full.toLowerCase().startsWith("<hr")) { blocks.push({ type: "divider" }); continue; }
  }
  return blocks;
}

/** A safe, short filename component — same intent as uploads.ts's sanitiser
 *  on the server side, kept local since this runs in the browser. */
export function safeFileNamePart(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return clean.length > 0 ? clean.slice(0, 80) : "report";
}

/**
 * Builds a downloadable .docx from the same HTML buildPreviewHtml() produces.
 * Dynamic import matches the existing pattern (statementExport.ts,
 * inventoryExports.ts) — docx/file-saver are not bundled into the main chunk.
 */
export async function exportRadiologyReportToWord(html: string, fileBaseName: string): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } = await import("docx");
  const { saveAs } = await import("file-saver");

  const blocks = parseReportHtmlToBlocks(html);
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

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${fileBaseName}.docx`);
}
