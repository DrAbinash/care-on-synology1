/**
 * Source contract for the print/export backlog fixes — the flagged-not-fixed
 * items from PRs #1155/#1156 that this PR closes:
 *
 *   1. Word export printed ZERO images (docx builder had no image vocabulary).
 *   2. Cross-store key-image ordering/dedupe (frozen vs picker refs disagreed
 *      door to door; the server renderer re-sorted two colliding 0-based
 *      displayOrder sequences).
 *   3. The 300 ms-debounced print mirror leaked: the structured map bypassed
 *      the debounce (instant churn + mixed-staleness in-sync flapping), and the
 *      click paths (print-like-final, Word, PDF) merged/exported the lagging
 *      memo instead of the moment's live text.
 *
 * The browser-only assembly (docx ImageRun, window.open printing, download
 * flows) is pinned as source needles — the same convention as
 * composerChainAudit.contract.test.ts. Pure logic is pinned by real unit tests
 * in radiologyReportWordExport.keyImages.test.ts and
 * radiologyReportPdfExport.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(here, rel), "utf8");

const wordExport = read("./radiologyReportWordExport.ts");
const pdfExport = read("./radiologyReportPdfExport.ts");
const pdfGenerator = read("./reportPdfGenerator.ts");
const imageRefs = read("./reportImageRefs.ts");
const exportShare = read("../hooks/radiology-workspace/useWorkspaceExportShare.ts");
const clinicalUi = read("../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const panel = read("../components/radiology/ReportExportPanel.tsx");
const canvas = read("../components/radiology/workspace/ReportCanvas.tsx");
const debouncedHook = read("../hooks/useDebouncedValue.ts");
const liveMerge = read("./radiologyReportPrintLiveMerge.ts");

describe("Word export carries the key images (was: zero images)", () => {
  it("the letterhead opts accept explicit keyImages", () => {
    expect(wordExport).toContain("keyImages?: WordKeyImageInput[]");
  });

  it("readable images become docx ImageRuns with a real type, bytes and size", () => {
    expect(wordExport).toContain("new ImageRun({");
    expect(wordExport).toContain("type: img.mime");
    expect(wordExport).toContain("data: dataUrlToBytes(img.src)");
    expect(wordExport).toContain("transformation: {");
  });

  it("an unreadable image says so in words — never a silent gap", () => {
    expect(wordExport).toContain("IMAGE COULD NOT BE READ");
  });

  it("the section is headed like every other section", () => {
    expect(wordExport).toContain('text: "KEY IMAGES"');
  });

  it("the client fallback's text-only stand-in list is dropped when real images are supplied", () => {
    expect(wordExport).toContain("dropKeyImagesTextBlocks(");
  });

  it("handleExportWord collects images with the SAME merge the PDF door uses", () => {
    expect(exportShare).toContain("keyImagesForExport(");
    // The frozen-pixel fetch is ONE shared helper, not a PDF-only inline block.
    expect(exportShare).toContain("const fetchFrozenKeyImageDataUrls = useCallback");
    const pdfDoor = exportShare.slice(
      exportShare.indexOf("const handleExportPdf"),
      exportShare.indexOf("const runPrintLikeFinal"),
    );
    expect(pdfDoor).toContain("fetchFrozenKeyImageDataUrls()");
    const wordDoor = exportShare.slice(
      exportShare.indexOf("const handleExportWord"),
      exportShare.indexOf("const handleExportPdf"),
    );
    expect(wordDoor).toContain("fetchFrozenKeyImageDataUrls()");
    expect(wordDoor).toContain("keyImagesForExport(");
  });

  it("a signed study's Word export carries the artifact's own frozen pictures only — no live substitution", () => {
    const wordDoor = exportShare.slice(
      exportShare.indexOf("const handleExportWord"),
      exportShare.indexOf("const handleExportPdf"),
    );
    expect(wordDoor).toContain("let authorized = false");
    expect(wordDoor).toMatch(/const keyImages = authorized[\s\S]*?frozenDataUrls[\s\S]*?:[\s\S]*?keyImagesForExport\(/);
  });
});

describe("cross-store ordering and dedupe — one rule, every door", () => {
  it("ReportKeyImage carries the frame — one picture is SOP + frame", () => {
    expect(pdfGenerator).toContain("frameNumber?: number | null");
  });

  it("the client mirrors the server's identity key", () => {
    expect(imageRefs).toContain("export function reportImageIdentityKey");
  });

  it("keyImagesForExport dedupes with the identity key, not SOP alone", () => {
    expect(pdfExport).toContain("reportImageIdentityKey");
  });

  it("hydrate accepts frozen identities and keeps the server's merge", () => {
    expect(pdfExport).toContain("frozenIdentities");
  });

  it("finalizePrintPreviewHtml forwards the identities to the hydrate", () => {
    expect(liveMerge).toContain("frozenKeyImageIdentities");
    expect(liveMerge).toMatch(/hydratePrintPreviewKeyImages\([\s\S]*?frozenIdentities: opts\.frozenKeyImageIdentities/);
  });

  it("both export doors pass the frozen identities into the print merge", () => {
    const occurrences = exportShare.split("frozenKeyImageIdentities").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("the preview panel derives printable identities from its frozen rows", () => {
    expect(panel).toContain("frozenKeyImageIdentities: frozenKeyImages");
    expect(panel).toContain(".filter((img) => img.includeInReport)");
    expect(canvas).toContain("frozenKeyImages={frozenKeyImages}");
  });
});

describe("the print mirror — debounced inputs, live clicks", () => {
  it("a keyed debounce hook exists (identity switch flushes immediately)", () => {
    expect(debouncedHook).toContain("export function useKeyedDebouncedValue");
  });

  it("the structured map enters the same 300 ms pipeline as the texts", () => {
    expect(clinicalUi).toContain("useKeyedDebouncedValue(findingsMap");
    expect(clinicalUi).toContain("useKeyedDebouncedValue(useStructured");
  });

  it("click paths rebuild the body from the live moment, not the lagging memo", () => {
    expect(exportShare).toContain("const livePrintBodyHtmlAtClick = useCallback");
    const clicks = exportShare.split("livePrintBodyHtmlAtClick()").length - 1;
    expect(clicks).toBeGreaterThanOrEqual(2);
    // The memo itself stays for the preview — only the clicks read live.
    expect(exportShare).toContain("const livePrintBodyHtml = useMemo");
  });

  it("the PDF door reads the live texts at click time too", () => {
    const pdfDoor = exportShare.slice(
      exportShare.indexOf("const handleExportPdf"),
      exportShare.indexOf("const runPrintLikeFinal"),
    );
    expect(pdfDoor).toContain("readWorkspaceClinicalTexts()");
  });
});
