import { describe, expect, test } from "vitest";
import {
  parseInlineHtml,
  parseReportHtmlToBlocks,
  safeFileNamePart,
} from "./radiologyReportWordExport";

// The clinic composes final reports in Word, not this app. This converter's
// entire job is turning the SAME HTML the workspace's own Preview pane
// already renders (buildPreviewHtml() → previewHtml,
// RadiologyReportingWorkspace.tsx:405) into a .docx a radiologist can keep
// working from — so it must genuinely handle every shape that function can
// produce, not a hand-picked simplification.
//
// buildPreviewHtml cannot be imported directly here: it lives inside a
// ~5900-line page component whose import graph is full of "@/…"-aliased
// component imports, and the root vitest.config.ts (which every
// artifacts/*/src/**/*.test.ts file runs under, including this one) has no
// alias resolution configured — only artifacts/diagnostic-erp's own Vite
// build does. Pulling the real function in would mean either mocking dozens
// of unrelated UI components or reconfiguring alias resolution repo-wide for
// one test file, neither of which belongs in this PR.
//
// Instead, mirrorBuildPreviewHtml() below is a byte-for-byte port of that
// function's real template literals, transcribed directly from
// RadiologyReportingWorkspace.tsx:405-497 while writing this file — same
// style attributes, same placeholder strings, same conditional structure.
// If buildPreviewHtml's HTML shape ever changes, this mirror (and these
// tests) must be updated to match, same as any fixture. Where it matters —
// the exact placeholder markup that caused a real bug below — the fixture
// quotes the source literally rather than approximating it.

function escHtmlMirror(v: string): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtHeadingMirror(text: string, headingCase: "all_caps" | "title_case"): string {
  if (headingCase === "all_caps") return text.toUpperCase();
  return text.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

interface MirrorOpts {
  patientName: string;
  age: string;
  sex: string;
  accessionNumber: string;
  referringDoctor: string;
  studyDate: string;
  studyName: string;
  technique: string;
  clinicalHistory: string;
  findingsMap: Record<string, { normal: boolean; text: string }>;
  rawFindings: string;
  useStructured: boolean;
  impression: string[];
  recommendation: string;
  imageRefs: { seriesNumber: string; imageNumber: string; description: string }[];
  headingCase?: "all_caps" | "title_case";
  sectionSpacing?: "spaced" | "compact";
  impressionStyle?: "bulleted" | "numbered" | "plain";
}

/** Faithful port of RadiologyReportingWorkspace.tsx:405 buildPreviewHtml(). */
function mirrorBuildPreviewHtml(opts: MirrorOpts): string {
  const hc = opts.headingCase ?? "all_caps";
  const ss = opts.sectionSpacing ?? "spaced";
  const sp = ss === "compact" ? "2px" : "10px";
  const sp2 = ss === "compact" ? "4px" : "12px";

  const headerHtml = `<p style="margin:0 0 2px;"><strong>NAME: ${escHtmlMirror(opts.patientName)} &nbsp;&nbsp; AGE/SEX: ${escHtmlMirror(opts.age ?? "")}/${escHtmlMirror(opts.sex ?? "")} &nbsp;&nbsp; ACC: ${escHtmlMirror(opts.accessionNumber)}</strong></p>
  <p style="margin:0 0 2px;"><strong>REF. BY: ${escHtmlMirror(opts.referringDoctor)} &nbsp;&nbsp; DATE: ${escHtmlMirror(opts.studyDate)}</strong></p>`;

  let findingsHtml = "";
  if (opts.useStructured) {
    findingsHtml = Object.entries(opts.findingsMap)
      .map(([label, item]) => {
        const raw = item.text.trim();
        const sentence = raw || (item.normal ? "Normal." : "—");
        const body = escHtmlMirror(sentence).replaceAll("\n", "<br/>");
        const bodyHtml = item.normal ? body : `<strong>${body}</strong>`;
        return `<p style="margin:${sp} 0;break-after:avoid-page;page-break-after:avoid;"><strong>${escHtmlMirror(fmtHeadingMirror(label, hc))}:</strong> ${bodyHtml}</p>`;
      })
      .join("\n");
  } else {
    findingsHtml = `<p style="margin:0 0 ${sp};">${escHtmlMirror(opts.rawFindings).replaceAll("\n", "<br/>") || "<em style='color:#aaa;'>No findings entered.</em>"}</p>`;
  }

  const impressionBullets = opts.impression.filter(Boolean);
  let impressionHtml = "";
  if (impressionBullets.length > 0) {
    const ist = opts.impressionStyle ?? "bulleted";
    if (ist === "numbered") {
      impressionHtml = `<ol style="margin:4px 0 0 22px;padding:0;">${impressionBullets.map((b) => `<li>${escHtmlMirror(b)}</li>`).join("")}</ol>`;
    } else if (ist === "plain") {
      impressionHtml = `<p style="margin:4px 0;">${impressionBullets.map((b) => escHtmlMirror(b)).join("; ")}</p>`;
    } else {
      impressionHtml = `<ul style="margin:4px 0 0 18px;padding:0;">${impressionBullets.map((b) => `<li>${escHtmlMirror(b)}</li>`).join("")}</ul>`;
    }
  } else {
    impressionHtml = `<p style="margin:4px 0;color:#aaa;"><em>Draft impression — not verified.</em></p>`;
  }

  const hStyle = (margin: string) => `margin:${margin};break-after:avoid-page;page-break-after:avoid;`;

  const imagesHtml = opts.imageRefs.length > 0
    ? `<h3 style="${hStyle(`${sp2} 0 ${sp}`)}"><u>${fmtHeadingMirror("Key Images", hc)}</u></h3>
    <ul style="margin:4px 0 0 18px;padding:0;">${opts.imageRefs.map((img) => `<li>Series ${escHtmlMirror(img.seriesNumber)} Image ${escHtmlMirror(img.imageNumber)}: ${escHtmlMirror(img.description)}</li>`).join("")}</ul>`
    : "";

  return `<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.45;color:#111;max-width:720px;margin:0 auto;">
    ${headerHtml}
    <hr style="border:none;border-top:2px solid #000;margin:6px 0;" />
    <h2 style="text-align:center;text-decoration:underline;font-size:15px;margin:8px 0;break-after:avoid-page;page-break-after:avoid;"><strong>${escHtmlMirror(opts.studyName)}</strong></h2>
    <h3 style="${hStyle(`${sp} 0 ${sp}`)}"><u>${fmtHeadingMirror("Technique", hc)}</u></h3>
    <p style="margin:0 0 ${sp};">${escHtmlMirror(opts.technique)}</p>
    ${opts.clinicalHistory ? `<h3 style="${hStyle(`${sp} 0 ${sp}`)}"><u>${fmtHeadingMirror("Clinical History", hc)}</u></h3><p style="margin:0 0 ${sp};">${escHtmlMirror(opts.clinicalHistory)}</p>` : ""}
    <hr style="border:none;border-top:2px solid #000;margin:6px 0;" />
    <h3 style="${hStyle(`${sp} 0 ${sp}`)}"><u>${fmtHeadingMirror("Findings / Observation", hc)}</u></h3>
    ${findingsHtml}
    ${imagesHtml}
    <h3 style="${hStyle(`${sp2} 0 ${sp}`)}"><u>${fmtHeadingMirror("Impression", hc)}</u></h3>
    ${impressionHtml}
    <h3 style="${hStyle(`${sp2} 0 ${sp}`)}"><u>${fmtHeadingMirror("Recommendation", hc)}</u></h3>
    <p style="margin:0 0 ${sp};">${escHtmlMirror(opts.recommendation || "Please correlate with clinical findings.")}</p>
    <hr style="border:none;border-top:1px solid #999;margin:${sp2} 0 4px;" />
    <p style="font-size:11px;color:#666;font-style:italic;margin:0;">Please correlate with clinical history and findings. Report issued by authorized radiologist only.</p>
  </div>`.trim();
}

const BASE_OPTS: MirrorOpts = {
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
    const html = mirrorBuildPreviewHtml({
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
    const html = mirrorBuildPreviewHtml({
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
    const html = mirrorBuildPreviewHtml({
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

  test("key images render as a list block with series/image numbers intact", () => {
    const html = mirrorBuildPreviewHtml({
      ...BASE_OPTS,
      imageRefs: [{ seriesNumber: "3", imageNumber: "12", description: "Axial mid-ventricle" }],
    });
    const blocks = parseReportHtmlToBlocks(html);
    const imagesHeading = blocks.find((b) => b.type === "heading2" && (b as { text: string }).text.includes("KEY IMAGES"));
    expect(imagesHeading).toBeTruthy();
    const list = blocks.find(
      (b) => b.type === "list" && (b as { items: { text: string }[][] }).items.some((item) => item.some((s) => s.text.includes("Axial mid-ventricle"))),
    );
    expect(list).toBeTruthy();
  });

  test("section dividers (<hr>) between header/body/footer are preserved", () => {
    const html = mirrorBuildPreviewHtml(BASE_OPTS);
    const blocks = parseReportHtmlToBlocks(html);
    // Three: after the patient-header block, after clinical history (before
    // Findings), and near the footer before the disclaimer line.
    const dividerCount = blocks.filter((b) => b.type === "divider").length;
    expect(dividerCount, "buildPreviewHtml emits exactly three <hr> separators").toBe(3);
  });

  test("an empty draft still produces a complete, non-crashing document with real placeholder text (not raw tags)", () => {
    const html = mirrorBuildPreviewHtml(BASE_OPTS);
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
