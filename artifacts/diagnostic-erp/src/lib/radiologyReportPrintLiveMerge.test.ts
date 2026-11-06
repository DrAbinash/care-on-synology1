import { describe, expect, it } from "vitest";
import { provenanceFromText } from "./reportFieldMerge";
import {
  buildLivePrintBodyHtml,
  finalizePrintPreviewHtml,
  formatPrintBodyHtml,
  injectProvenancePreviewChrome,
  mergeLiveBodyIntoPrintHtml,
  replacePrintBodyDiv,
} from "./radiologyReportPrintLiveMerge";

describe("radiologyReportPrintLiveMerge", () => {
  it("buildLivePrintBodyHtml includes findings, impression, and recommendation", () => {
    const body = buildLivePrintBodyHtml({
      clinicalHistory: "Headache",
      technique: "Plain CT brain",
      rawFindings: "No acute infarct.",
      findingsMap: {},
      useStructured: false,
      impression: ["Normal CT brain study."],
      recommendation: "Clinical correlation.",
      headingCase: "all_caps",
      impressionStyle: "bulleted",
    });
    expect(body).toContain("CLINICAL HISTORY");
    expect(body).toContain("Headache");
    expect(body).toContain("FINDINGS");
    expect(body).toContain("No acute infarct.");
    // The Impression heading honours the SAME heading-case setting as every
    // other section — the audited defect had it hardcoded, so the printed
    // page read "…/ FINDINGS / Impression / RECOMMENDATION" under all-caps.
    expect(body).toContain("IMPRESSION");
    expect(body).not.toContain(">Impression<");
    expect(body).toContain("Normal CT brain study.");
    expect(body).toContain("RECOMMENDATION");
  });

  it("buildLivePrintBodyHtml honours title_case for the Impression heading too", () => {
    const body = buildLivePrintBodyHtml({
      clinicalHistory: "",
      technique: "",
      rawFindings: "",
      findingsMap: {},
      useStructured: false,
      impression: ["Normal study."],
      recommendation: "",
      headingCase: "title_case",
    });
    expect(body).toContain(">Impression<");
  });

  it("a stale structured map never wins over the live findings text (print mirrors the signed body)", () => {
    // The map→text sync is one-way: a tile click, dictation or direct typing
    // updates findingsText while the map stands still. The SIGNED body
    // already refuses a stale map (structuredInSync guard); the print/preview
    // body must apply the same rule or the paper prints less than the screen.
    const body = buildLivePrintBodyHtml({
      clinicalHistory: "",
      technique: "",
      rawFindings: "Small cortical bleed in the right frontal lobe.",
      findingsMap: {
        "Brain parenchyma": { normal: true, text: "" },
      },
      useStructured: true,
      impression: ["Small cortical bleed."],
      recommendation: "",
    });
    expect(body).toContain("Small cortical bleed in the right frontal lobe.");
    expect(body).not.toContain("Brain parenchyma");
    expect(body).not.toContain("Normal.");
  });

  it("an in-sync structured map still renders per-system headings", () => {
    const findingsMap = { "Brain parenchyma": { normal: true, text: "Unremarkable parenchyma." } };
    // findingsMapToText renders "LABEL:\ntext" — the map is in sync when the
    // findings text reproduces exactly that.
    const raw = "Brain parenchyma:\nUnremarkable parenchyma.";
    const body = buildLivePrintBodyHtml({
      clinicalHistory: "",
      technique: "",
      rawFindings: raw,
      findingsMap,
      useStructured: true,
      impression: [],
      recommendation: "",
    });
    expect(body).toContain("BRAIN PARENCHYMA");
    expect(body).toContain("Unremarkable parenchyma.");
  });

  it("formatPrintBodyHtml keeps s/o slash and renders **bold**", () => {
    expect(formatPrintBodyHtml("s\u2215o hypertension")).toContain("s/o hypertension");
    expect(formatPrintBodyHtml("Disc **bulge** at L4-L5")).toBe("Disc <strong>bulge</strong> at L4-L5");
  });

  it("buildLivePrintBodyHtml honours bold markdown in findings", () => {
    const body = buildLivePrintBodyHtml({
      clinicalHistory: "",
      technique: "",
      rawFindings: "s/o **disc bulge**",
      findingsMap: {},
      useStructured: false,
      impression: [],
      recommendation: "",
    });
    expect(body).toContain("s/o <strong>disc bulge</strong>");
  });

  it("replacePrintBodyDiv handles nested section-heading divs", () => {
    const html = `<div class="report-column">
      <div class="body">
        <div class="section-heading">Findings</div>
        <p>Stale server text.</p>
        <div class="section-heading">Recommendation</div>
        <p>Old rec.</p>
      </div>
      <div class="sigs">Dr X</div>
    </div>`;
    const live = `<div class="section-heading">Findings</div><p>Live editor text.</p>`;
    const out = replacePrintBodyDiv(html, live);
    expect(out).toContain("Live editor text.");
    expect(out).not.toContain("Stale server text.");
    expect(out).toContain('<div class="sigs">Dr X</div>');
  });

  it("mergeLiveBodyIntoPrintHtml replaces full body when live text exists", () => {
    const server = `<html><body><div class="body"><p>empty</p></div></body></html>`;
    const live = `<div class="section-heading">Findings</div><p>Fresh findings.</p>`;
    const merged = mergeLiveBodyIntoPrintHtml(server, live);
    expect(merged).toContain("Fresh findings.");
    expect(merged).not.toContain("empty");
  });

  it("the fixed closing statement survives the merge, and steps aside if the live editor now says it", () => {
    // The server decided about the statement against the STORED draft body; this merge
    // swaps in what the editor holds now, so the decision has to be re-made here or
    // "Print like final" shows the sentence twice — on the screen the radiologist
    // signs off on and on the PDF he saves.
    const SENTENCE = /Please correlate with clinical findings/g;
    const server = (storedBody: string) =>
      `<html><body><div class="report-column"><div class="body">${storedBody}</div>` +
      `<div class="closing-statement">Please correlate with clinical findings.</div>` +
      `<div class="sigs">Dr X</div></div></body></html>`;

    // Nothing typed: the server's statement stays, and the live body is not what
    // carries it (it lives outside `.body`, so the signed body keeps only his words).
    const plain = server("<p>Old server findings.</p>");
    const liveAdvice = '<div class="section-heading">Findings</div><p>No acute infarct.</p>';
    const merged = mergeLiveBodyIntoPrintHtml(plain, liveAdvice);
    expect(merged).toContain("No acute infarct.");
    expect((merged.match(SENTENCE) ?? []).length).toBe(1);
    expect(merged).toContain('<div class="sigs">Dr X</div>');

    // He typed the sentence himself since the server rendered: keep his, drop the
    // server's copy.
    const liveSaysIt =
      '<div class="section-heading">RECOMMENDATION</div><p>Please correlate with clinical findings.</p>';
    const merged2 = mergeLiveBodyIntoPrintHtml(plain, liveSaysIt);
    expect((merged2.match(SENTENCE) ?? []).length).toBe(1);
    expect(merged2).toContain("<p>Please correlate with clinical findings.</p>"); // his section, not a footer echo
    expect(merged2).not.toContain('<div class="closing-statement">');

    // The body builder never writes the statement INTO the report body: an empty
    // advice section stays empty and the signed artifact carries only authored text.
    const body = buildLivePrintBodyHtml({
      clinicalHistory: "",
      technique: "Plain CT brain",
      rawFindings: "No acute infarct.",
      findingsMap: {},
      useStructured: false,
      impression: ["Normal CT brain study."],
      recommendation: "",
    });
    expect((body.match(SENTENCE) ?? []).length).toBe(0);
    expect(body).not.toMatch(/RECOMMENDATION/i);
  });

  it("injectProvenancePreviewChrome adds legend and tints findings for preview", () => {
    const html = `<style></style><div class="report-column"><div class="body">
      <div class="section-heading">Findings</div><p>Plain line.</p>
    </div></div>`;
    const out = injectProvenancePreviewChrome(html, {
      findingsText: "Plain line.",
      impressionText: "",
      findingsProvenance: provenanceFromText("Plain line.", "template-a"),
    });
    expect(out).toContain("preview-provenance-legend");
    expect(out).toContain("Format A");
    expect(out).toContain("prov-template-a");
    expect(out).toContain("@media print");
    expect(out).toMatch(
      /@media print[\s\S]*\.preview-provenance-legend[\s\S]*display:\s*none\s*!important/,
    );
  });

  it("the impression provenance chrome keeps the document's heading case", () => {
    // The live print body case-formats every heading (default all_caps). The
    // chrome injector re-rendered the Impression heading as a hardcoded
    // title-case literal, so the preview showed FINDINGS / Impression — the
    // exact mixed-case defect the body builder's own comment says was fixed.
    const html = `<style></style><div class="report-column"><div class="body">
      <div class="section-heading">IMPRESSION</div><ul><li>Stable study.</li></ul>
    </div></div>`;
    const out = injectProvenancePreviewChrome(html, {
      findingsText: "",
      impressionText: "Stable study.",
      impressionProvenance: provenanceFromText("Stable study.", "quick-findings"),
    });
    expect(out).toContain('<div class="section-heading">IMPRESSION</div>');
    expect(out).not.toContain('<div class="section-heading">Impression</div>');
  });
});

// Measured in a browser before it was written: the workspace's Word export of a
// SIGNED report fetched that report's server print HTML and then let this screen
// rewrite it. The produced .docx carried no signer at all while the same
// report's own PDF carried "Dr. Anonya Menon, Reg. No: print-e2e-REG-1001" —
// one authorized report printed as two different documents.
describe("finalizePrintPreviewHtml — an authorized artifact is not the screen's to rewrite", () => {
  const AUTHORIZED =
    `<html><body><div class="body"><div class="section-heading">Findings</div>` +
    `<p>Text the radiologist signed.</p></div><div class="sigs">Dr. Anonya Menon</div></body></html>`;
  const SCREEN = `<div class="section-heading">Findings</div><p>Text typed afterwards.</p>`;

  it("returns the server artifact byte for byte when a signing record exists", async () => {
    const out = await finalizePrintPreviewHtml(AUTHORIZED, {
      authorizedArtifact: true,
      livePrintBodyHtml: SCREEN,
      findingsText: "Text typed afterwards.",
      impressionText: "Impression typed afterwards.",
      dicomWebBase: "",
      imageRefs: [],
      demography: { patientName: "Someone Else", accessionNumber: "ACC-OTHER" },
    });
    expect(out).toBe(AUTHORIZED);
    expect(out).not.toContain("Text typed afterwards.");
    expect(out).toContain("Dr. Anonya Menon");
  });

  it("still merges the screen's unsaved text for a draft — that is what the screen is for", async () => {
    const out = await finalizePrintPreviewHtml(AUTHORIZED, {
      livePrintBodyHtml: SCREEN,
      findingsText: "Text typed afterwards.",
      impressionText: "",
      dicomWebBase: "",
      imageRefs: [],
    });
    expect(out).toContain("Text typed afterwards.");
    expect(out).not.toContain("Text the radiologist signed.");
  });
});
