import { createRequire } from "node:module";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  exportRadiologyReportToWord,
  parseInlineHtml,
  parseReportHtmlToBlocks,
  safeFileNamePart,
} from "./radiologyReportWordExport";
import {
  renderReportDocument, resolvePresentationTemplate, type ReportDocumentModel,
} from "../../../api-server/src/lib/reportPresentation";
import { saveAs } from "file-saver";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
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
    // Phase 3: Word export lives in useWorkspaceExportShare.
    const workspaceSrc = [
      readFileSync(resolve(__dirname, "../pages/RadiologyReportingWorkspace.tsx"), "utf8"),
      readFileSync(
        resolve(__dirname, "../hooks/radiology-workspace/useWorkspaceExportShare.ts"),
        "utf8",
      ),
    ].join("\n");
    // Body paragraphs / list items must set half-points explicitly (Word default
    // ~11pt looked tiny next to the clinic CT Brain .doc sample).
    expect(wordSrc).toMatch(/runsFor\(block\.segments,\s*24\)/);
    expect(wordSrc).toMatch(/convertMillimetersToTwip\(42\)/);
    // Header ON/OFF must not strip the pre-printed letter-pad top margin on Word.
    expect(workspaceSrc).toMatch(/physicalLetterpad:\s*true/);
  });
});

describe("real Word archive preserves the server's signature and image evidence", () => {
  // Reuse docx's installed ZIP reader without adding a test-only dependency.
  const require = createRequire(import.meta.url);
  const JSZip = createRequire(require.resolve("docx"))("jszip");
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=";
  const keyImages = [{ src: PNG, caption: "Axial key image" }];
  const model: ReportDocumentModel = {
    reportNumber: "SYNTHETIC-WORD", studyTitle: "CT BRAIN", typeLabel: "RADIOLOGY",
    statusLabel: "SIGNED", clinic: { name: "Synthetic clinic" }, patientRows: [],
    bodyHtml: "<h3>FINDINGS</h3><p>No acute hemorrhage. Ventricles normal.</p>",
    keyImages: keyImages.map((image) => ({ ...image, displayOrder: 0 })),
    signatures: [{
      name: "Dr. O'Neil & Rao", qualification: 'MD (Radiology) & DNB "Gold"',
      role: "Consultant radiologist", registrationNo: "REG-123/XY",
      label: "Signed: ", whenLabel: "21 Oct 2026, 14:35 IST",
    }],
    stamp: { kind: "verified", label: "SIGNED" }, generatedAtLabel: "",
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(saveAs).mockClear();
  });

  async function documentXml(html: string): Promise<string> {
    // Only the browser image probe and download are mocked, not docx/Packer.
    vi.stubGlobal("Image", class {
      naturalWidth = 1;
      naturalHeight = 1;
      onload: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    await exportRadiologyReportToWord(html, "synthetic-report", { physicalLetterpad: true, keyImages });
    expect(saveAs).toHaveBeenCalledTimes(1);
    const [blob, filename] = vi.mocked(saveAs).mock.calls[0];
    expect(filename).toBe("synthetic-report.docx");
    expect(blob).toBeInstanceOf(Blob);
    const archive = await JSZip.loadAsync(await (blob as Blob).arrayBuffer());
    const xml = await archive.file("word/document.xml").async("string");
    expect(xml).toContain("No acute hemorrhage. Ventricles normal.");
    expect(xml).toContain("Axial key image");
    expect(xml.match(/<w:drawing>/g)).toHaveLength(1);
    expect(xml).toContain("<a:blip r:embed=");
    expect(Object.keys(archive.files).some((name) => name.startsWith("word/media/") && name.endsWith(".png"))).toBe(true);
    return xml;
  }

  test("premium server HTML exports its signer, qualification, registration and timestamp", async () => {
    const html = renderReportDocument(model, resolvePresentationTemplate("care-premium"));
    expect(html).toContain('class="signame"');
    expect(html).toContain('class="sigmeta sigwhen"');
    const xml = await documentXml(html);
    expect(xml).toContain("Dr. O&apos;Neil &amp; Rao");
    expect(xml).toContain("MD (Radiology) &amp; DNB &quot;Gold&quot;");
    expect(xml).toContain("Consultant radiologist");
    expect(xml).toContain("Reg. No: REG-123/XY");
    expect(xml).toContain("Signed: 21 Oct 2026, 14:35 IST");
    expect(xml.match(/21 Oct 2026, 14:35 IST/g)).toHaveLength(1);
    expect(xml).not.toContain("NOT SIGNED");
    expect(xml).not.toMatch(/&lt;\/?(?:div|span|strong)\b/);
  });

  test.each(["care-premium", "care-classic"])("%s unsigned renderer marker survives without any signer", async (templateId) => {
    // Deliberately leave signatures populated: the server withholds them.
    const html = renderReportDocument({ ...model, signerUnsigned: true }, resolvePresentationTemplate(templateId));
    expect(html).toContain('class="signot">NOT SIGNED');
    const xml = await documentXml(html);
    expect(xml).toContain("NOT SIGNED");
    expect(xml).not.toContain("O&apos;Neil");
    expect(xml).not.toContain("REG-123/XY");
    expect(xml).not.toContain("21 Oct 2026");
    expect(xml).not.toContain("Sugandha"); // no configured letterpad signer
  });

  test("exact signature class tokens accept surrounding classes, strip markup, and reject lookalikes", async () => {
    const html = renderReportDocument({ ...model, signatures: [] }, {
      ...resolvePresentationTemplate("care-premium"), signatureCfg: { show: false, showImage: false },
    }) + `
      <div class="before signame after"><span>Server-only name</span></div>
      <div class='sigmeta extra'><strong>Server qualification</strong></div>
      <div class="extra sigwhen">Server timestamp</div>
      <div class="signame-extra">Not a signer</div>
      <div class="x-sigmeta">Not metadata</div>
      <div class="sigwhenish">Not a timestamp</div>
      <div class="signotice">Not unsigned</div>`;
    const xml = await documentXml(html);
    expect(xml).toContain("Server-only name");
    expect(xml).toContain("Server qualification");
    expect(xml).toContain("Server timestamp");
    expect(xml).not.toMatch(/Not a signer|Not metadata|Not a timestamp|Not unsigned/);
    expect(xml).not.toMatch(/&lt;\/?(?:div|span|strong)\b/);
    expect(xml).not.toContain("Sugandha");
  });
});

describe("the owner's fixed closing statement reaches the .docx", () => {
  // A referrer is sent this file, so the Word copy must agree with the printed one:
  // the mandated sentence present, and present exactly once. This converter is
  // deliberately neutral — the shared `documentXml()` above also asserts one specific
  // document's clinical content, which is not what these cases are about.
  async function wordXml(html: string): Promise<string> {
    vi.mocked(saveAs).mockClear();
    vi.stubGlobal("Image", class {
      naturalWidth = 1;
      naturalHeight = 1;
      onload: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    await exportRadiologyReportToWord(html, "closing-statement-check", {
      physicalLetterpad: true,
      keyImages: [],
    });
    expect(saveAs).toHaveBeenCalledTimes(1);
    const [blob, filename] = vi.mocked(saveAs).mock.calls[0];
    expect(filename).toBe("closing-statement-check.docx");
    // jszip is not a dependency of the ERP package — it ships inside docx's own
    // tree, which is how the suite above reaches it.
    const JSZip = createRequire(require.resolve("docx"))("jszip");
    const archive = await JSZip.loadAsync(await (blob as Blob).arrayBuffer());
    return archive.file("word/document.xml").async("string");
  }

  const count = (xml: string) =>
    (xml.match(/Please correlate with clinical findings\./g) ?? []).length;

  test("prints once on a report whose Recommendations field is empty", async () => {
    const xml = await wordXml(buildPreviewHtml({
      ...BASE_OPTS,
      rawFindings: "No acute infarct.",
      impression: ["Normal study."],
      recommendation: "",
    }));
    expect(count(xml)).toBe(1);
    expect(xml).toContain("Report issued by authorized radiologist only.");
  });

  test("prints once alongside the radiologist's own advice, which is preserved", async () => {
    const xml = await wordXml(buildPreviewHtml({
      ...BASE_OPTS,
      rawFindings: "No acute infarct.",
      impression: ["Normal study."],
      recommendation: "Repeat MRI in six weeks with contrast.",
    }));
    expect(xml).toContain("Repeat MRI in six weeks with contrast.");
    expect(count(xml)).toBe(1);
  });

  test("is not doubled when his own advice already is that sentence", async () => {
    const xml = await wordXml(buildPreviewHtml({
      ...BASE_OPTS,
      rawFindings: "No acute infarct.",
      impression: ["Normal study."],
      recommendation: "Please correlate with clinical findings.",
    }));
    expect(count(xml)).toBe(1);
  });

  // The three cases above feed the client preview, whose statement is a `<p>`. That is
  // not the document the workspace exports: `useWorkspaceExportShare.ts` fetches the
  // SERVER print HTML and hands it straight to this converter, and the server's
  // statement is a `<div class="closing-statement">`. A `<div>` matched no alternative
  // in `blockRe`, so the sentence was dropped from every exported report while all the
  // tests above stayed green. These cases are the door as it is actually wired.
  function serverPrintHtml(bodyHtml: string): string {
    return renderReportDocument(
      {
        reportNumber: "RPT-20261027-GATE-1",
        studyTitle: "MRI LUMBOSACRAL SPINE (PLAIN)",
        typeLabel: "RADIOLOGY",
        statusLabel: "VERIFIED",
        clinic: { name: "Care Diagnostics", tagline: "Precision Imaging", address: "Deoghar", phone: "06432-1234" },
        patientRows: [{ label: "Patient", value: "Synthetic^Patient" }, { label: "Age / Sex", value: "51y / F" }],
        bodyHtml,
        footerNote: "Report issued by authorized radiologist only.",
        stamp: { kind: "verified", label: "VERIFIED on 27/10/2026" },
        signatures: [{ name: "Dr Asha Rao", qualification: "MD (Radiodiagnosis)", label: "Signed:", whenLabel: " 27/10/2026" }],
        generatedAtLabel: "27/10/2026, 3:04 pm",
      },
      resolvePresentationTemplate("care-premium"),
    );
  }

  const signedBody =
    '<div class="section-heading">FINDINGS</div><p>L4-L5 disc desiccation with a posterior central disc bulge;' +
    " canal AP diameter at L4-L5 is 7.1 mm. Left L5 exiting nerve root impingement is present.</p>" +
    '<div class="section-heading">IMPRESSION</div><p>L4-L5 disc bulge with left L5 radiculopathy.</p>';

  test("survives the SERVER document the workspace actually exports, once", async () => {
    const html = serverPrintHtml(signedBody);
    expect((html.match(/Please correlate with clinical findings/g) ?? []).length, "one in the HTML")
      .toBe(1);
    expect(/<div[^>]*closing-statement/i.test(html), "server shape is a div").toBe(true);
    const xml = await wordXml(html);
    expect(count(xml), "the mandated sentence reaches the .docx").toBe(1);
    expect(xml).toContain("7.1 mm");
    expect(xml).toContain("Left L5");
  });

  test("the converter never invents a second copy on a document that carries none", async () => {
    const xml = await wordXml(serverPrintHtml(signedBody).replace(
      /<div\b[^>]*closing-statement[^>]*>[\s\S]*?<\/div>/i, "",
    ));
    expect(count(xml)).toBe(0);
  });
});
