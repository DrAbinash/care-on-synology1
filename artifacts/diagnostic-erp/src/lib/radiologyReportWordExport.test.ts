import { describe, expect, test } from "vitest";
import {
  parseInlineHtml,
  parseReportHtmlToBlocks,
  safeFileNamePart,
} from "./radiologyReportWordExport";
import {
  buildPreviewHtml,
  type BuildPreviewHtmlOpts,
} from "./radiologyReportPreviewHtml";

// Word export must handle every shape buildPreviewHtml() can produce.
const BASE_OPTS: BuildPreviewHtmlOpts = {
  patientName: "Ramesh Kumar",
  age: "45",
  sex: "M",
  accessionNumber: "ACC-20260726-CT-001",
  referringDoctor: "Dr. Sharma",
  studyDate: "26-Jul-2026",
  studyName: "CT Brain Plain",
  technique: "Axial CT sections of the brain were obtained.",
  clinicalHistory: "Headache x 3 days",
  findingsMap: {},
  rawFindings: "",
  useStructured: false,
  impression: [],
  recommendation: "",
  imageRefs: [],
};

describe("parseInlineHtml — real segments from real escHtml() output", () => {
  test("plain text with no markup", () => {
    expect(parseInlineHtml("Normal study.")).toEqual([{ text: "Normal study.", bold: undefined, italic: undefined }]);
  });

  test("bold wraps the whole segment (findings-map label:value line)", () => {
    const segs = parseInlineHtml("<strong>Lung fields:</strong> clear");
    expect(segs[0]).toMatchObject({ text: "Lung fields:", bold: true });
    expect(segs[1]).toMatchObject({ text: " clear", bold: undefined });
  });

  test("<br/> becomes an isBreak segment, splitting multi-line findings", () => {
    const segs = parseInlineHtml("Line one<br/>Line two<br/>Line three");
    expect(segs.map((s) => s.isBreak ? "<BR>" : s.text)).toEqual(["Line one", "<BR>", "Line two", "<BR>", "Line three"]);
  });

  test("em WITH attributes is recognized — buildPreviewHtml's actual empty-findings placeholder", () => {
    // buildPreviewHtml's real literal output for "no findings entered" is
    // `<em style='color:#aaa;'>…</em>` — an ATTRIBUTED <em>, not a bare one.
    // A bare-tag-only pattern leaves the whole opening tag as literal text,
    // so a draft exported before findings are filled in — the single most
    // common moment to export — would show a raw `<em style=...>` tag to
    // the reader instead of italic text. This is the regression guard for
    // that bug (caught by this test during development, then fixed).
    const segs = parseInlineHtml("<em style='color:#aaa;'>No findings entered.</em>");
    expect(segs).toEqual([{ text: "No findings entered.", bold: undefined, italic: true }]);
  });

  test("bare em (the impression placeholder's actual shape) is also recognized", () => {
    const segs = parseInlineHtml("<em>Draft impression — not verified.</em>");
    expect(segs).toEqual([{ text: "Draft impression — not verified.", bold: undefined, italic: true }]);
  });

  test("HTML entities from escHtml() are decoded back to real characters", () => {
    const segs = parseInlineHtml("Ref &amp; Sons &lt;attn&gt; &quot;Dr&quot; &nbsp;A&nbsp;B");
    expect(segs[0].text).toBe('Ref & Sons <attn> "Dr"  A B');
  });
});

describe("parseReportHtmlToBlocks — against a faithful mirror of buildPreviewHtml()", () => {
  test("raw (non-structured) findings with a plain impression", () => {
    const html = buildPreviewHtml({
      ...BASE_OPTS,
      rawFindings: "No acute intracranial hemorrhage.\nVentricles normal.",
      impression: ["No acute abnormality"],
      impressionStyle: "plain",
      recommendation: "Clinical correlation advised.",
    });
    const blocks = parseReportHtmlToBlocks(html);

    // Document order: the NAME/AGE/SEX/ACC and REF-BY/DATE header lines are
    // two plain <p> paragraphs BEFORE the <h2> study-name heading — the
    // patient header is not itself a heading block.
    const studyHeading = blocks.find((b) => b.type === "heading1");
    expect(studyHeading).toMatchObject({ type: "heading1", text: "CT Brain Plain" });
    const headings = blocks.filter((b) => b.type === "heading2").map((b) => (b as { text: string }).text);
    expect(headings).toEqual(["TECHNIQUE", "CLINICAL HISTORY", "FINDINGS / OBSERVATION", "IMPRESSION", "RECOMMENDATION"]);

    const findingsPara = blocks.find(
      (b) => b.type === "paragraph" && (b as { segments: { text: string }[] }).segments.some((s) => s.text.includes("Ventricles normal")),
    );
    expect(findingsPara, "the raw multi-line findings text must survive intact").toBeTruthy();
    // The \n between the two sentences became <br/> in buildPreviewHtml — must
    // round-trip as an isBreak segment, not vanish or merge the lines.
    const segs = (findingsPara as { segments: { isBreak?: boolean }[] }).segments;
    expect(segs.some((s) => s.isBreak)).toBe(true);

    const impressionPara = blocks.find(
      (b) => b.type === "paragraph" && (b as { segments: { text: string }[] }).segments.some((s) => s.text.includes("No acute abnormality")),
    );
    expect(impressionPara).toBeTruthy();
  });

  test("structured findings (findingsMap) render each region as its own paragraph, abnormal bolded", () => {
    const html = buildPreviewHtml({
      ...BASE_OPTS,
      useStructured: true,
      findingsMap: {
        "Lung Fields": { normal: true, text: "" },
        "Cardiac Silhouette": { normal: false, text: "Mildly enlarged." },
      },
      impression: ["Mild cardiomegaly"],
      impressionStyle: "bulleted",
    });
    const blocks = parseReportHtmlToBlocks(html);

    // Region labels go through fmtHeading(label, "all_caps") (the default
    // headingCase) before rendering, so the printed text is "LUNG FIELDS",
    // not "Lung Fields".
    const paragraphs = blocks.filter((b) => b.type === "paragraph") as Array<{ type: "paragraph"; segments: { text: string; bold?: boolean }[] }>;
    const lungPara = paragraphs.find((p) => p.segments.some((s) => s.text.includes("LUNG FIELDS")));
    expect(lungPara, "normal region must still print its own line").toBeTruthy();
    expect(lungPara!.segments.some((s) => s.text.includes("Normal."))).toBe(true);

    const cardiacPara = paragraphs.find((p) => p.segments.some((s) => s.text.includes("Mildly enlarged")));
    expect(cardiacPara, "abnormal region text must survive").toBeTruthy();
    expect(cardiacPara!.segments.some((s) => s.bold), "abnormal finding text is bolded in the source HTML").toBe(true);

    const impressionList = blocks.find((b) => b.type === "list") as { type: "list"; ordered: boolean; items: { text: string }[][] } | undefined;
    expect(impressionList, "bulleted impression must parse as a list block").toBeTruthy();
    expect(impressionList!.ordered).toBe(false);
    expect(impressionList!.items[0].map((s) => s.text).join("")).toContain("Mild cardiomegaly");
  });

  test("numbered impression style parses as an ordered list", () => {
    const html = buildPreviewHtml({
      ...BASE_OPTS,
      impression: ["Finding A", "Finding B"],
      impressionStyle: "numbered",
    });
    const blocks = parseReportHtmlToBlocks(html);
    const list = blocks.find((b) => b.type === "list") as { type: "list"; ordered: boolean; items: unknown[][] } | undefined;
    expect(list).toBeTruthy();
    expect(list!.ordered).toBe(true);
    expect(list!.items).toHaveLength(2);
  });

  test("key images render as a list block, ordered by displayOrder, KEY images marked", () => {
    const html = buildPreviewHtml({
      ...BASE_OPTS,
      imageRefs: [
        { displayOrder: 1, description: "Sagittal T2", isKeyImage: false },
        { displayOrder: 0, description: "Axial mid-ventricle", isKeyImage: true },
      ],
    });
    const blocks = parseReportHtmlToBlocks(html);
    const imagesHeading = blocks.find((b) => b.type === "heading2" && (b as { text: string }).text.includes("KEY IMAGES"));
    expect(imagesHeading).toBeTruthy();
    const list = blocks.find((b) => b.type === "list") as { type: "list"; items: { text: string }[][] } | undefined;
    expect(list).toBeTruthy();
    // Sorted by displayOrder, so the isKeyImage:true item (displayOrder 0)
    // comes first and is marked "(KEY)", even though it was passed second.
    const itemTexts = list!.items.map((item) => item.map((s) => s.text).join(""));
    expect(itemTexts[0]).toContain("Image 1 (KEY): Axial mid-ventricle");
    expect(itemTexts[1]).toContain("Image 2: Sagittal T2");
  });

  test("section-heading and study-title-bar from the print renderer are parsed", () => {
    const html = `<div class="study-title-bar">MRI CERVICAL SPINE</div>
      <div class="section-heading">Technique</div><p>T1W and T2W sagittal.</p>
      <div class="section-heading">Findings</div><p>Cervical lordosis maintained.</p>`;
    const blocks = parseReportHtmlToBlocks(html);
    expect(blocks.find((b) => b.type === "heading1")).toMatchObject({ text: "MRI CERVICAL SPINE" });
    expect(blocks.filter((b) => b.type === "heading2").map((b) => (b as { text: string }).text))
      .toEqual(["Technique", "Findings"]);
  });

  test("section dividers (<hr>) between header/body/footer are preserved", () => {
    const html = buildPreviewHtml(BASE_OPTS);
    const blocks = parseReportHtmlToBlocks(html);
    // Three: after the patient-header block, after clinical history (before
    // Findings), and near the footer before the disclaimer line.
    const dividerCount = blocks.filter((b) => b.type === "divider").length;
    expect(dividerCount, "buildPreviewHtml emits exactly three <hr> separators").toBe(3);
  });

  test("an empty draft still produces a complete, non-crashing document with real placeholder text (not raw tags)", () => {
    const html = buildPreviewHtml(BASE_OPTS);
    const blocks = parseReportHtmlToBlocks(html);
    expect(blocks.length).toBeGreaterThan(5);

    const paragraphs = blocks.filter((b) => b.type === "paragraph") as Array<{ type: "paragraph"; segments: { text: string; italic?: boolean }[] }>;
    const findingsPlaceholder = paragraphs.find((p) => p.segments.some((s) => s.text.includes("No findings entered")));
    const impressionPlaceholder = paragraphs.find((p) => p.segments.some((s) => s.text.includes("Draft impression")));

    expect(findingsPlaceholder, "empty-findings placeholder must appear as real text").toBeTruthy();
    expect(impressionPlaceholder, "empty-impression placeholder must appear as real text").toBeTruthy();
    // The regression this guards: neither placeholder's text may contain a
    // literal, unparsed HTML tag — that would mean the attributed <em> leaked
    // through as visible text in the exported document.
    for (const p of [findingsPlaceholder!, impressionPlaceholder!]) {
      for (const seg of p.segments) expect(seg.text).not.toMatch(/[<>]/);
    }
    expect(findingsPlaceholder!.segments.some((s) => s.italic)).toBe(true);
    expect(impressionPlaceholder!.segments.some((s) => s.italic)).toBe(true);
  });
});

describe("safeFileNamePart", () => {
  test("strips characters that are unsafe in a filename", () => {
    expect(safeFileNamePart("Ramesh Kumar / CT Brain: 2026-07-26")).toBe("Ramesh_Kumar_CT_Brain_2026-07-26");
  });

  test("never returns an empty string", () => {
    expect(safeFileNamePart("///???")).toBe("report");
  });

  test("caps length so a pathological name cannot break a downstream file write", () => {
    const long = "a".repeat(500);
    expect(safeFileNamePart(long).length).toBeLessThanOrEqual(80);
  });
});

describe("Word export letterpad + body fonts (clinic sample contract)", () => {
  test("body TextRuns use 12pt (size 24) and workspace always requests physical letterpad", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const wordSrc = readFileSync(resolve(__dirname, "./radiologyReportWordExport.ts"), "utf8");
    const workspaceSrc = readFileSync(
      resolve(__dirname, "../pages/RadiologyReportingWorkspace.tsx"),
      "utf8",
    );
    // Body paragraphs / list items must set half-points explicitly (Word default
    // ~11pt looked tiny next to the clinic CT Brain .doc sample).
    expect(wordSrc).toMatch(/runsFor\(block\.segments,\s*24\)/);
    expect(wordSrc).toMatch(/convertMillimetersToTwip\(42\)/);
    // Header ON/OFF must not strip the pre-printed letter-pad top margin on Word.
    expect(workspaceSrc).toMatch(/physicalLetterpad:\s*true/);
  });
});
