/**
 * The findings document model.
 *
 * Findings are stored and edited as ONE string (`findingsText`) because every
 * downstream surface — the quality engine, the contradiction detectors, the AI
 * gates, provenance tinting, the undo ledger — reads that string. This module
 * does not replace that model; it gives the string a structure that every
 * renderer agrees on, so a report authored as sub-headed sections comes out of
 * the printer as sub-headed sections instead of one run-on paragraph.
 *
 * The convention is deliberately explicit, because this is a medico-legal
 * document and silent guessing about what is a heading is not acceptable:
 *
 *   Alignment:                     ← a line that is exactly "Label:" is a heading
 *   Normal lumbar lordosis...
 *
 *   Disc Level Analysis:
 *   | Level | Disc | Canal AP (mm) |    ← lines starting with "|" are a table
 *   | L1-L2 | Normal | 14 |
 *   | L2-L3 | Normal | 13 |
 *
 *   L4-L5: Broad-based disc bulge.   ← "Label: body" on ONE line stays a
 *                                        paragraph (the letter-pad PDF already
 *                                        bolds those labels), so nothing that
 *                                        reads correctly today reads worse.
 *
 * Free text with no markers parses as paragraphs, which is exactly today's
 * behaviour — adopting this costs nothing for a radiologist who just types.
 */

export type FindingsBlock =
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] };

/** `## Label`, `##Label`, or a line that is exactly `Label:` with nothing after it. */
const HEADING_MD = /^#{1,3}\s*(.+?)\s*#*\s*$/;
const HEADING_COLON = /^([^:\n]{1,60}):$/;
const TABLE_SEP = /^[\s|:-]+$/;

function isHeadingLine(line: string): { text: string } | null {
  const md = line.match(HEADING_MD);
  if (md?.[1]?.trim()) return { text: md[1].trim() };
  const colon = line.trim().match(HEADING_COLON);
  if (colon?.[1]?.trim()) return { text: colon[1].trim() };
  return null;
}

/** Split one `|a|b|c|` row into trimmed cells, dropping the empty edge cells. */
function tableCells(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return body.split("|").map((c) => c.trim());
}

export function parseFindingsDocument(text: string | null | undefined): FindingsBlock[] {
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return [];

  const lines = raw.split("\n");
  const blocks: FindingsBlock[] = [];
  let para: string[] = [];

  const flushPara = () => {
    const body = para.join("\n").trim();
    if (body) blocks.push({ kind: "para", text: body });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); continue; }

    const heading = isHeadingLine(line);
    if (heading) { flushPara(); blocks.push({ kind: "heading", text: heading.text }); continue; }

    if (line.trim().startsWith("|")) {
      flushPara();
      const header = tableCells(line);
      let j = i + 1;
      if (j < lines.length && TABLE_SEP.test(lines[j]) && lines[j].includes("|")) j++;
      const rows: string[][] = [];
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        const cells = tableCells(lines[j]);
        if (!TABLE_SEP.test(lines[j])) rows.push(cells);
        j++;
      }
      blocks.push({ kind: "table", header, rows });
      i = j - 1;
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

/** True when the text carries any heading or table marker (so a renderer knows
 *  it is a structured document rather than one freeform paragraph). */
export function findingsDocumentHasStructure(text: string | null | undefined): boolean {
  return parseFindingsDocument(text).some((b) => b.kind !== "para");
}

/** Collapse a findings document back to readable plain text — the shape the
 *  plain-text PDF body and any non-HTML surface needs. */
export function findingsBlocksToPlainText(
  blocks: FindingsBlock[],
  headingCase: "all_caps" | "title_case" = "all_caps",
): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "heading") { out.push(casesHeading(b.text, headingCase)); continue; }
    if (b.kind === "para") { out.push(b.text); continue; }
    out.push(renderTableAsAlignedText(b.header, b.rows));
  }
  return out.join("\n\n");
}

export function casesHeading(
  label: string,
  headingCase: "all_caps" | "title_case" = "all_caps",
): string {
  if (headingCase === "title_case") {
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return label.toUpperCase();
}

/** Fixed-width columns, because jsPDF's default font is not monospace and this
 *  is only used where a real grid is not available. */
export function renderTableAsAlignedText(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ").trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

/**
 * Author findings text from labelled sections — the shape a report format or a
 * spine canvas writes. Bodies are trimmed and collapsed so one section never
 * emits three blank lines, which would read as a document break.
 */
export function sectionsToFindingsText(
  sections: Array<{ heading: string; body: string }>,
): string {
  return sections
    .filter((s) => s.heading.trim() && s.body.trim())
    .map((s) => `${s.heading.trim()}:\n${s.body.trim()}`)
    .join("\n\n");
}

/** A table block written as findings text, from a header row and data rows. */
export function tableToFindingsText(header: string[], rows: string[][]): string {
  const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [row(header), ...rows.map(row)].join("\n");
}
