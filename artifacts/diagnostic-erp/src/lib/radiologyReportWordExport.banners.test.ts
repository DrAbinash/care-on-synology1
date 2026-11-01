/**
 * P1 — the two shapes the Word converter used to drop without a trace.
 *
 * A signed MRI cervical spine report prints a critical-value banner, a documented
 * reporting region narrower than the booked examination, and a spinal canal AP
 * table whose millimetre figures are what the referral decision rests on. The PDF
 * carried all three (it renders the same HTML in a browser); the Word copy carried
 * none, because `parseReportHtmlToBlocks` had no branch for `<div class="critical">`,
 * `<div class="reporting-scope-note">` or `<table>` — an unmatched element is
 * ignored rather than guessed at, which is the right rule for markup this converter
 * has not been told about, and the wrong rule for measurements.
 *
 * Fixtures here are the server renderer's own bytes, not inventions: the canal table
 * is the markup `spinalCanalApTable.ts` `renderCanalApTable()` produces (copied from
 * a real print page fetched off the rig), and the banners are the literals in
 * `reportPresentation.ts:697`/`:1290`, `patient-reports.ts:3686-3696` and
 * `frozenKeyImages.ts:559`.
 */
import { describe, expect, test } from "vitest";
import { parseReportHtmlToBlocks, type ReportBlock } from "./radiologyReportWordExport";

/** All the text a block list carries, in document order, one space between blocks. */
function blockText(blocks: ReportBlock[]): string {
  return blocks.map((b) => {
    if (b.type === "paragraph" || b.type === "callout") return b.segments.map((s) => s.text).join("");
    if (b.type === "heading1" || b.type === "heading2") return b.text;
    if (b.type === "list") return b.items.map((i) => i.map((s) => s.text).join("")).join(" ");
    if (b.type === "table") return b.rows.map((r) => r.cells.map((c) => c.map((s) => s.text).join("")).join(" ")).join(" ");
    return "";
  }).join(" ").replace(/\s+/g, " ").trim();
}

const callouts = (blocks: ReportBlock[]) => blocks.filter((b) => b.type === "callout");
const tables = (blocks: ReportBlock[]) => blocks.filter((b) => b.type === "table");

const CANAL_TABLE = `<div class="section-heading">CERVICAL CANAL AP DIAMETER AT C2-C3 TO C7-T1 LEVELS</div>
<table style="border-collapse:collapse;margin:0 0 8px;width:auto;">
  <thead><tr><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">LEVEL</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C2-C3</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C3-C4</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C4-C5</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C5-C6</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C6-C7</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C7-T1</th></tr></thead>
  <tbody><tr><td style="border:1px solid #000;padding:2px 6px;font-size:11px;">AP (mm)</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">—</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">11.4</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">10.8</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">9.6</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">10.1</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">—</td></tr></tbody>
</table>`;

describe("banner boxes reach the block list", () => {
  test.each([
    ["critical", "critical", "⚠ CRITICAL VALUE — IMMEDIATE ATTENTION REQUIRED: Borderline cervical canal stenosis at C5-C6"],
    ["version-warning", "warning", "Report integrity: 2 unavailable on disk. Live PACS pixels were not substituted."],
    ["superseded-banner", "critical", "SUPERSEDED — A NEWER SIGNED AMENDMENT EXISTS"],
    ["amended-banner", "warning", "AMENDED REPORT — Version 2 of 2"],
    ["reporting-scope-note", "note", "Documented reporting region: Cervical Spine. Booked examination: MRI WHOLE SPINE."],
  ] as const)("%s → tone %s", (cls, tone, sentence) => {
    const blocks = parseReportHtmlToBlocks(
      `<div class="${cls}">${sentence}</div><div class="section-heading">FINDINGS</div><p>Alignment normal.</p>`,
    );
    const found = callouts(blocks);
    expect(found, `${cls} must produce a box`).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "callout", tone });
    expect(blockText(blocks)).toContain(sentence);
    // The banner keeps its place: it precedes the section it warns about.
    expect(blocks.indexOf(found[0]!)).toBeLessThan(blocks.findIndex((b) => b.type === "heading2"));
  });

  test("a banner's own markup is interpreted, not printed as tags", () => {
    // The amendment banner carries a `<br/>` before "Amended on …", and the
    // renderer escapes the reason text, so entities have to come back as text.
    const blocks = parseReportHtmlToBlocks(
      `<div class="superseded-banner">SUPERSEDED — A NEWER SIGNED AMENDMENT EXISTS<br/>Amended by Dr &quot;A&quot; &amp; Co</div>`,
    );
    const [callout] = callouts(blocks) as Array<Extract<ReportBlock, { type: "callout" }>>;
    expect(callout.segments.map((s) => (s.isBreak ? "<BR>" : s.text))).toEqual([
      "SUPERSEDED — A NEWER SIGNED AMENDMENT EXISTS", "<BR>", "Amended by Dr \"A\" & Co",
    ]);
  });

  test("an empty banner adds nothing", () => {
    expect(callouts(parseReportHtmlToBlocks(`<div class="critical">   </div>`))).toHaveLength(0);
  });

  test("lookalike classes are not mistaken for a warning box", () => {
    const blocks = parseReportHtmlToBlocks(
      `<div class="criticality">Not a critical value</div>` +
      `<div class="x-version-warning">Not an integrity warning</div>` +
      `<div class="scope-note">Not a reporting scope note</div>` +
      `<div class="stamp draft">DRAFT (not signed)</div>`,
    );
    expect(callouts(blocks)).toHaveLength(0);
    expect(blockText(blocks)).toBe("");
  });

  test("every banner class the converter knows is exercised above", () => {
    // The parser's branch and this suite both list the five classes; a sixth
    // renderer banner (a new safeguard box) must be added in both places, and
    // silently un-boxed content is exactly the defect this file exists to stop.
    const known = ["critical", "superseded-banner", "version-warning", "amended-banner", "reporting-scope-note"];
    for (const cls of known) {
      expect(callouts(parseReportHtmlToBlocks(`<div class="${cls}">Text</div>`)), cls).toHaveLength(1);
    }
  });
});

describe("measurement tables reach the block list", () => {
  test("the canal AP table survives with its levels and values, in order", () => {
    const blocks = parseReportHtmlToBlocks(
      `<div class="section-heading">FINDINGS</div><p>Normal cervical lordosis.</p>${CANAL_TABLE}` +
      `<div class="section-heading">IMPRESSION</div><p>Borderline canal stenosis at C5-C6.</p>`,
    );
    const found = tables(blocks) as Array<Extract<ReportBlock, { type: "table" }>>;
    expect(found).toHaveLength(1);
    const rows = found[0]!.rows;
    expect(rows.map((r) => r.header)).toEqual([true, false]);
    expect(rows[0]!.cells.map((c) => c.map((s) => s.text).join(""))).toEqual([
      "LEVEL", "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
    ]);
    // The measured figures, and the em dash for a level with no measurement —
    // a missing level must not silently borrow its neighbour's number.
    expect(rows[1]!.cells.map((c) => c.map((s) => s.text).join(""))).toEqual([
      "AP (mm)", "—", "11.4", "10.8", "9.6", "10.1", "—",
    ]);
    // The table sits where it printed: after the findings prose, before Impression.
    const headingIndex = blocks.map((b) => (b.type === "heading2" ? b.text : "")).lastIndexOf("IMPRESSION");
    expect(blocks.indexOf(found[0]!)).toBeLessThan(headingIndex);
  });

  test("a lab parameter table keeps its cells, its bold result and its flag", () => {
    const blocks = parseReportHtmlToBlocks(
      `<table class="params"><thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference Range</th></tr></thead>` +
      `<tbody><tr class="abnormal"><td>HbA1c</td><td><strong>8.4</strong> <span class="flag flag-high">HIGH</span></td><td>%</td><td>4.0-5.6</td></tr></tbody></table>`,
    );
    const [table] = tables(blocks) as Array<Extract<ReportBlock, { type: "table" }>>;
    expect(table.rows).toHaveLength(2);
    const valueRow = table.rows[1]!;
    expect(valueRow.cells.map((c) => c.map((s) => s.text).join(""))).toEqual(["HbA1c", "8.4 HIGH", "%", "4.0-5.6"]);
    expect(valueRow.cells[1]!.some((s) => s.bold && s.text === "8.4"), "the bold result stays bold").toBe(true);
    expect(valueRow.header).toBe(false);
  });

  test("the letter-pad sheet wrapper is walked through, not turned into a table", () => {
    // The clinical table NESTED inside the wrapper resolves to its own close tag;
    // a non-greedy `</table>` match would end at the wrapper's first cell and
    // swallow the report that follows it.
    const html = `<table class="letterpad-sheet"><thead><tr><td>` +
      `<div class="body"><div class="section-heading">FINDINGS</div><p>Disc desiccation at C5-C6.</p>${CANAL_TABLE}</div>` +
      `</td></tr></thead><tfoot><tr><td><div class="signame">Dr Asha Rao</div></td></tr></tfoot></table>`;
    const blocks = parseReportHtmlToBlocks(html);
    const found = tables(blocks) as Array<Extract<ReportBlock, { type: "table" }>>;
    expect(found, "exactly the canal table, not the wrapper").toHaveLength(1);
    expect(found[0]!.rows).toHaveLength(2);
    expect(blockText(blocks)).toContain("Disc desiccation at C5-C6.");
    expect(blockText(blocks)).toContain("9.6");
    expect(blockText(blocks)).toContain("Dr Asha Rao");
  });

  test("the identity grids the letter-pad draws stay out of the clinical blocks", () => {
    // Word renders its own header for these, so parsing them as content would
    // print the demography twice on one sheet.
    const blocks = parseReportHtmlToBlocks(
      `<table class="patient-table"><tbody><tr><td>NAME: SYNWORD CASE01</td><td>UHID: SYNP0701</td></tr></tbody></table>` +
      `<table class="letterpad-demo"><tr><td>AGE/SEX: 41 / M</td></tr></table>` +
      `<div class="section-heading">FINDINGS</div><p>Normal.</p>`,
    );
    expect(tables(blocks)).toHaveLength(0);
    expect(blockText(blocks)).toBe("FINDINGS Normal.");
  });

  test("a table with no rows contributes nothing", () => {
    expect(tables(parseReportHtmlToBlocks(`<table></table>`))).toHaveLength(0);
  });
});
