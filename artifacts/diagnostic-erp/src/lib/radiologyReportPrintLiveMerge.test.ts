import { describe, expect, it } from "vitest";
import { provenanceFromText } from "./reportFieldMerge";
import {
  buildLivePrintBodyHtml,
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
    expect(body).toContain("Impression");
    expect(body).toContain("Normal CT brain study.");
    expect(body).toContain("RECOMMENDATION");
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
  });
});
