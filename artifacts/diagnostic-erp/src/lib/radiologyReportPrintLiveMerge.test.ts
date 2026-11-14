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

/**
 * Item 12 of the 13 Nov review: the printed impression must carry the points the
 * radiologist wrote, in their order, with ONE marker each. The impression
 * textarea is free text, so the author's own markers and blank lines arrive in
 * the value; the print body is the document (the page, the Word file converted
 * from it, and the body stored on the signed report all come from here), so what
 * this function puts in `<li>` is what the patient receives.
 */
function impressionLis(html: string): string[] {
  const section = html.slice(html.search(/<div class="section-heading">IMPRESSION<\/div>/i));
  return [...section.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);
}

function bodyFor(impression: string, style: "bulleted" | "numbered" | "plain"): string {
  return buildLivePrintBodyHtml({
    clinicalHistory: "",
    technique: "",
    rawFindings: "",
    findingsMap: {},
    useStructured: false,
    impression: impression.split("\n").filter(Boolean),
    recommendation: "",
    impressionStyle: style,
    headingCase: "all_caps",
  });
}

describe("the impression the print body publishes keeps every point and adds one marker", () => {
  it.each(["-", "•", "*"])("strips the author's %s marker so the list adds only its own", (marker) => {
    const body = bodyFor(`${marker} Hepatic steatosis.\n${marker} Trace free fluid.`, "numbered");
    expect(impressionLis(body)).toEqual(["Hepatic steatosis.", "Trace free fluid."]);
  });

  it("keeps a measurement that merely looks like a marker", () => {
    // `\d+[.)]` must be followed by whitespace, or "2.5 cm" loses its "2.".
    const body = bodyFor("2.5 cm Hepatic steatosis.\n3 x Trace free fluid.", "numbered");
    expect(impressionLis(body)).toEqual(["2.5 cm Hepatic steatosis.", "3 x Trace free fluid."]);
  });

  it("prints no empty numbered row for a blank line typed between two points", () => {
    // The workspace splits the textarea on "\\n" and keeps a whitespace-only
    // line; filtering for emptiness BEFORE normalizing left "" in the list, so
    // the page carried `<li></li>` — a "2." beside nothing, with the real second
    // point renumbered to "3." — and the plain style spelled it out as "; ;".
    const numbered = bodyFor("Hepatic steatosis.\n   \nTrace free fluid.", "numbered");
    expect(impressionLis(numbered)).toEqual(["Hepatic steatosis.", "Trace free fluid."]);
    expect(numbered).not.toContain("<li></li>");
    expect(numbered).not.toContain("<li> </li>");

    const plain = bodyFor("Hepatic steatosis.\n   \nTrace free fluid.", "plain");
    expect(plain).not.toContain("; ;");
    expect(plain).toContain("Hepatic steatosis.; Trace free fluid.");
  });

  it("keeps a line that is ONLY a marker, because that is content not formatting", () => {
    // normalizeImpressionBullet falls back to the untouched text when stripping
    // would leave nothing — a dash standing alone is still what was written.
    const body = bodyFor("Hepatic steatosis.\n-", "numbered");
    expect(impressionLis(body)).toEqual(["Hepatic steatosis.", "-"]);
  });
});

// Item 10. The canal AP diameter table is the part of a spine report the
// referring surgeon reads, and it is the one part the live-body merge could not
// know about: it is drawn server-side from the saved measurement record folded
// with `spinal_measurements`, while the body this screen composes is made of texts.
// Replacing `<div class="body">` therefore dropped it — measured before the fix on
// the real builder's markup: `mergedHasTitle=false`, `mergedHasNumber=false`,
// while the typed sentence in the same body survived.
describe("the printed canal AP diameter table survives the live-body merge", () => {
  /** `spinalCanalApTable.ts`'s `renderCanalApTable()` output, copied from a print
   *  page fetched off the rig (same shape as the Word parity suite pins). */
  const CANAL_TABLE = `<div class="section-heading">CERVICAL CANAL AP DIAMETER AT C2-C3 TO C7-T1 LEVELS</div>
<table style="border-collapse:collapse;margin:0 0 8px;width:auto;">
  <thead><tr><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">LEVEL</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C2-C3</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C3-C4</th><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">C5-C6</th></tr></thead>
  <tbody><tr><td style="border:1px solid #000;padding:2px 6px;font-size:11px;">AP (mm)</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">11.4</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">10.8</td><td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">9.6</td></tr></tbody>
</table>`;

  const serverPage = (bodyInner: string) =>
    `<html><body><div class="report-column"><div class="body">${bodyInner}</div>` +
    `<div class="sigs">Dr X</div></div></body></html>`;

  const serverWithTable = serverPage(
    `<div class="section-heading">FINDINGS</div><p>Loss of disc height and signal at C5-C6.</p>\n` +
    `${CANAL_TABLE}\n` +
    `<div class="section-heading">IMPRESSION</div><ul><li>Right C6 nerve root compression.</li></ul>`,
  );

  const liveBody = (findings: string) =>
    buildLivePrintBodyHtml({
      clinicalHistory: "Neck pain with right upper limb radiculopathy.",
      technique: "MRI cervical spine on 3T.",
      rawFindings: findings,
      findingsMap: {},
      useStructured: false,
      impression: ["Right C6 nerve root compression."],
      recommendation: "",
      headingCase: "all_caps",
      impressionStyle: "bulleted",
    });

  it("prints the table, with its numbers, between Findings and Impression", async () => {
    const out = await finalizePrintPreviewHtml(serverWithTable, {
      livePrintBodyHtml: liveBody("Loss of disc height at C5-C6, with a new sentence typed after the save."),
      findingsText: "Loss of disc height at C5-C6, with a new sentence typed after the save.",
      impressionText: "Right C6 nerve root compression.",
      dicomWebBase: "",
      imageRefs: [],
      includeProvenanceChrome: false,
    });
    expect(out).toContain("CERVICAL CANAL AP DIAMETER AT C2-C3 TO C7-T1 LEVELS");
    for (const mm of ["11.4", "10.8", "9.6"]) expect(out).toContain(mm);
    // Carried, not duplicated, and still in the place the server put it.
    expect(out.match(/<table/g)).toHaveLength(1);
    expect(out.indexOf("CERVICAL CANAL AP DIAMETER")).toBeGreaterThan(out.indexOf("FINDINGS"));
    expect(out.indexOf("CERVICAL CANAL AP DIAMETER")).toBeLessThan(out.indexOf("IMPRESSION"));
    // The prose is still the live editor's — the carry adds a table, it does not
    // roll back the radiologist's newest sentence.
    expect(out).toContain("a new sentence typed after the save.");
  });

  it("control: a study nobody measured gains no table and loses nothing", async () => {
    const serverNoTable = serverPage(
      `<div class="section-heading">FINDINGS</div><p>Normal study.</p>\n` +
      `<div class="section-heading">IMPRESSION</div><ul><li>Normal study.</li></ul>`,
    );
    const out = await finalizePrintPreviewHtml(serverNoTable, {
      livePrintBodyHtml: liveBody("Normal study."),
      findingsText: "Normal study.",
      impressionText: "Normal study.",
      dicomWebBase: "",
      imageRefs: [],
      includeProvenanceChrome: false,
    });
    expect(out).not.toContain("CANAL AP DIAMETER");
    expect(out).not.toContain("<table");
    expect(out).toContain("Normal study.");
  });

  it("the grid the radiologist typed into Findings wins, and is not printed twice", () => {
    // He inserted the AI tab's lumbar grid into his own text. The drawn cervical
    // table cannot reproduce it, so the shared guard refuses the splice: two grids
    // naming one study with two sets of numbers is the defect the measurement work
    // exists to kill, and his words are not this merge's to overwrite.
    const typedGrid =
      "Canal Diameter:\n| LEVEL | L1-L2 | L2-L3 |\n| AP (mm) | 8.5 | 9.1 |\n" +
      "Loss of disc height at C5-C6.";
    const merged = mergeLiveBodyIntoPrintHtml(serverWithTable, liveBody(typedGrid));
    expect(merged).toContain("8.5");
    expect(merged).not.toContain("11.4");
    expect(merged.match(/AP \(mm\)/g)).toHaveLength(1);
  });

  it("the clinic's all-dash template scaffold steps aside for the measured table", () => {
    // structuredReportTemplates.ts's LS-Spine normal ships this grid of dashes. It
    // reports nothing, so it is a placeholder for the numbers — the page must not
    // carry an empty grid beside the real one.
    const scaffold =
      "Canal Diameter:\n| LEVEL | C5-C6 | C6-C7 |\n| AP (mm) | — | — |\n" +
      "Loss of disc height at C5-C6.";
    const merged = mergeLiveBodyIntoPrintHtml(serverWithTable, liveBody(scaffold));
    expect(merged).toContain("CERVICAL CANAL AP DIAMETER AT C2-C3 TO C7-T1 LEVELS");
    expect(merged).toContain("11.4");
    expect(merged.match(/AP \(mm\)/g)).toHaveLength(1);
    // The scaffold's own unmeasured columns are gone; the real table's are not.
    expect(merged).not.toContain("C6-C7");
  });
});
