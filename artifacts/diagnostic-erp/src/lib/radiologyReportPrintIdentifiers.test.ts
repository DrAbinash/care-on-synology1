/**
 * A printed report has to say which study it describes.
 *
 * The CARE letter-pad header drew four cells — NAME, AGE/SEX, REFD. BY, DATE —
 * while the record it is built from also carries the UHID and the accession
 * number. Both PDF paths therefore described a patient without naming the
 * examination, and the sheet could not be traced back to PACS. These tests read
 * the identifiers out of the artefacts each path produces, and pin the two call
 * sites that feed them, because the workspace assembles both payloads by hand.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { finalizePrintPreviewHtml } from "./radiologyReportPrintLiveMerge";

const SERVER_LETTERPAD_HTML = `<html><body>
  <div class="hdr-inner letterpad-bill"></div>
  <div class="patient-section letterpad-demo-wrap"><table class="letterpad-demo">
    <tr><td class="ld-left"><strong>NAME:</strong> <strong>OLD NAME</strong></td>
    <td class="ld-right"><strong>AGE/SEX:</strong> F</td></tr>
    <tr><td class="ld-left"><strong>REFD. BY:</strong> OLD REFERRER</td>
    <td class="ld-right"><strong>DATE:</strong> 01/01/1970</td></tr>
  </table><div class="letterpad-demo-rule"></div></div>
  <div class="content-area"><div class="report-column"><p>Body</p></div></div>
  <div class="sigs"></div>
</body></html>`;

const demography = {
  patientName: "Premchand Mandal",
  age: "4 Yrs",
  sex: "M",
  referringDoctor: "Dr Tushar Jyoti",
  studyDate: "18/08/2026",
  uhid: "UH-2026-000457",
  patientId: "",
  accessionNumber: "ACC-8891",
};

describe("Print path keeps the study identifiers", () => {
  it("the client's canonical demography replaces the server block with identifiers intact", async () => {
    // The workspace does not print the server's letter-pad block — it patches this
    // one over it. Adding the identifiers to the server alone would print them on
    // the durable PDF and lose them on Print.
    const out = await finalizePrintPreviewHtml(SERVER_LETTERPAD_HTML, {
      livePrintBodyHtml: `<div class="report-column"><p>Live body</p></div>`,
      findingsText: "Normal.",
      impressionText: "Normal.",
      dicomWebBase: null,
      imageRefs: [],
      includeProvenanceChrome: false,
      demography,
    });
    expect(out).toContain("UHID:");
    expect(out).toContain("UH-2026-000457");
    expect(out).toContain("ACCESSION:");
    expect(out).toContain("ACC-8891");
    // Replaced, not appended — and the four cells the clinic reads are the
    // client's own values, not the server's stale ones.
    expect(out.match(/UHID:/g)).toHaveLength(1);
    expect(out).toContain("PREMCHAND MANDAL");
    expect(out).not.toContain("OLD NAME");
    expect(out).toContain("18/08/2026");
    expect(out).not.toContain("01/01/1970");
  });

  it("no identifier label survives when the record has none", async () => {
    const out = await finalizePrintPreviewHtml(SERVER_LETTERPAD_HTML, {
      livePrintBodyHtml: `<div class="report-column"><p>Body</p></div>`,
      findingsText: "Normal.",
      impressionText: "Normal.",
      dicomWebBase: null,
      imageRefs: [],
      includeProvenanceChrome: false,
      demography: { ...demography, uhid: "", patientId: "", accessionNumber: "" },
    });
    expect(out).not.toContain("UHID:");
    expect(out).not.toContain("ACCESSION:");
    expect(out).toContain("PREMCHAND MANDAL");
  });
});

/**
 * The workspace hand-assembles both payloads, so a field dropped at the call site
 * disappears from the PDF no matter what the renderers do. Bounded on the call's
 * own braces, not on a line count or a character budget.
 */
function objectArgument(source: string, callMarker: string): string {
  const at = source.indexOf(callMarker);
  expect(at, `no ${callMarker} in this file`).toBeGreaterThan(-1);
  const start = source.indexOf("{", at);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after ${callMarker}`);
}

describe("the reporting workspace passes the identifiers it has", () => {
  const src = readFileSync(
    new URL("../hooks/radiology-workspace/useWorkspaceExportShare.ts", import.meta.url),
    "utf8",
  );

  it("Download PDF gets uhid and accessionNumber from the canonical record", () => {
    const call = objectArgument(src, "exportRadiologyReportToPdf(");
    expect(call).toContain("uhid: canonicalDemography.uhid");
    expect(call).toContain("accessionNumber: canonicalDemography.accessionNumber");
  });

  it("every print/Word demography payload carries both identifiers", () => {
    const blocks: string[] = [];
    for (let i = src.indexOf("demography: {"); i !== -1; i = src.indexOf("demography: {", i + 1)) {
      const start = i + "demography: ".length;
      let depth = 0;
      for (let j = start; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) {
          blocks.push(src.slice(start, j + 1));
          break;
        }
      }
    }
    // Two call sites exist today (browser Print and Word export); a third that
    // forgot the identifiers would land here rather than print silently blank.
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) {
      expect(b).toContain("uhid: canonicalDemography.uhid");
      expect(b).toContain("accessionNumber: canonicalDemography.accessionNumber");
    }
  });
});
