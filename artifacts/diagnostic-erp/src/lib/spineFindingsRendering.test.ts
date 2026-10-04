/**
 * A spine report is authored as sub-headed sections; it must PRINT as
 * sub-headed sections.
 *
 * Before this, every non-structured path emitted ONE `<p>` for the whole
 * findings field, so a radiologist's "Alignment / Vertebral Body / Disc Level
 * Analysis / Facets & Ligaments / Thecal Sac & Neural Structures / Posterior
 * Structures / Canal Diameter" document arrived at the printer as a single
 * run-on block — which is the complaint that made the workspace unusable for
 * spine reporting.
 *
 * These are HTML-shape assertions on the real builders, not source greps: the
 * artefact under test is the markup that reaches the print stylesheet.
 */
import { describe, expect, it } from "vitest";
import { buildSignedReportBodyHtml } from "./radiologyReportPrintLiveMerge";
import { renderFindingsDocumentHtml } from "./radiologyReportPreviewHtml";

/** The exact heading set the clinic reports spine on, with a canal table. */
const SPINE = [
  "Alignment:",
  "Normal lumbar lordosis maintained. No scoliosis or listhesis.",
  "",
  "Vertebral Body:",
  "Normal height, signal and morphology throughout.",
  "",
  "Disc Level Analysis:",
  "L1-L2: Normal disc height and signal. No disc herniation. Neural foramen patent.",
  "L2-L3: Normal disc height and signal. No disc herniation. Neural foramen patent.",
  "",
  "Facets & Ligaments:",
  "Facet joints unremarkable. No ligamentum flavum hypertrophy.",
  "",
  "Thecal Sac & Neural Structures:",
  "Thecal sac of adequate calibre. Cauda equina nerve roots appear normal.",
  "",
  "Posterior Structures:",
  "Posterior elements and paraspinal soft tissues unremarkable.",
  "",
  "Canal Diameter:",
  "| Level | AP Canal (mm) |",
  "| L1-L2 | 14 |",
  "| L2-L3 | 13 |",
].join("\n");

function signed(findingsText: string, extra: Record<string, unknown> = {}): string {
  return buildSignedReportBodyHtml({
    clinicalHistory: "Headache with radiating left leg pain.",
    technique: "MRI Lumbo-sacral Spine: T1W and T2W sagittal, T2W axial at disc levels.",
    findingsText,
    impressionText: "Normal MRI Lumbo-sacral Spine.",
    recommendationText: "",
    useStructured: false,
    ...extra,
  } as Parameters<typeof buildSignedReportBodyHtml>[0]);
}

describe("the signed body renders spine sub-headings", () => {
  it("emits one section heading per authored sub-heading", () => {
    const html = signed(SPINE);
    for (const heading of ["ALIGNMENT", "VERTEBRAL BODY", "DISC LEVEL ANALYSIS",
      "FACETS &amp; LIGAMENTS", "THECAL SAC &amp; NEURAL STRUCTURES", "POSTERIOR STRUCTURES",
      "CANAL DIAMETER"]) {
      expect(html, heading).toContain(`<div class="section-heading">${heading}</div>`);
    }
  });

  it("keeps Findings as the parent section instead of dropping the heading", () => {
    expect(signed(SPINE)).toContain(`<div class="section-heading">FINDINGS</div>`);
  });

  it("renders the canal measurement as a table, not as pipe-delimited prose", () => {
    const html = signed(SPINE);
    expect(html).toContain('<table class="findings-table"');
    expect(html).toContain("<th");
    // Table cells are data, not report headings — they keep the wording the
    // radiologist chose instead of being upper-cased with the section titles.
    expect(html).toContain("AP Canal (mm)");
    const rows = (html.match(/<tr>/g) ?? []).length;
    expect(rows).toBe(3); // header + L1-L2 + L2-L3
    expect(html).not.toContain("<p>| Level |");
  });

  it("puts each disc level on its own line under the section", () => {
    const html = signed(SPINE);
    expect(html).toContain(
      "L1-L2: Normal disc height and signal. No disc herniation. Neural foramen patent.<br/>"
      + "L2-L3: Normal disc height and signal. No disc herniation. Neural foramen patent.",
    );
  });

  it("does not regress free text typed without any markers", () => {
    const free = "Lumbar lordosis preserved. Disc heights maintained at all levels.";
    const html = signed(free);
    expect(html).toContain(`<div class="section-heading">FINDINGS</div>`);
    expect(html).toContain(`<p style="margin:0 0 12px;">${free}</p>`);
    expect(html).not.toContain("findings-table");
  });

  it("honours title_case headings when that presentation is chosen", () => {
    const html = signed(SPINE, { headingCase: "title_case" });
    expect(html).toContain(`<div class="section-heading">Alignment</div>`);
    expect(html).not.toContain(`<div class="section-heading">ALIGNMENT</div>`);
  });
});

describe("renderFindingsDocumentHtml on the screen preview", () => {
  it("uses caller-supplied heading markup so the preview stays styled", () => {
    const html = renderFindingsDocumentHtml("Alignment:\nNormal lordosis.", {
      headingCase: "all_caps",
      renderHeading: (label) => `<p class="preview-h">${label}</p>`,
    });
    expect(html).toContain('<p class="preview-h">ALIGNMENT</p>');
    expect(html).not.toContain("section-heading");
  });

  it("routes paragraph bodies through the caller's renderer, keeping provenance tinting", () => {
    const html = renderFindingsDocumentHtml("Alignment:\nNormal lordosis.", {
      renderBody: (t) => `<span class="prov">${t}</span>`,
    });
    expect(html).toContain('<span class="prov">Normal lordosis.</span>');
  });
});

/** One click on the "Disc herniation L4-L5" box, in the section it belongs to. */
const MIXED_SPINE = SPINE.replace(
  "L2-L3: Normal disc height and signal. No disc herniation. Neural foramen patent.",
  "L2-L3: Normal disc height and signal. No disc herniation. Neural foramen patent.\n"
  + "L4-L5: Broad-based disc bulge indenting the thecal sac.",
);

describe("abnormal lines are bold in the printed document", () => {
  const ABNORMAL_LINE = "L4-L5: Broad-based disc bulge indenting the thecal sac.";

  it("bolds the abnormal level and leaves its normal neighbours in plain type", () => {
    const html = renderFindingsDocumentHtml(MIXED_SPINE, { renderBody: (t) => t });
    expect(html).toContain(`<strong>${ABNORMAL_LINE}</strong>`);
    expect(html).not.toContain("<strong>L1-L2: Normal disc height");
    expect(html).not.toContain("<strong>Normal lumbar lordosis");
  });

  it("reaches the signed print body through the same rule as the preview", () => {
    const html = signed(MIXED_SPINE);
    expect(html).toContain(`<strong>${ABNORMAL_LINE}</strong>`);
    // The canal table is data, not prose: no row is bolded on a measurement.
    expect(html).not.toMatch(/<td[^>]*><strong>/);
  });

  it("adds nothing to a report that is entirely normal", () => {
    const html = signed(SPINE);
    expect(html).not.toContain("<strong>L1-L2:");
    expect(html).not.toMatch(/<p[^>]*><strong>[A-Z][a-z]/);
  });

  it("stays switchable for a caller that wants the text exactly as authored", () => {
    const html = renderFindingsDocumentHtml(MIXED_SPINE, {
      renderBody: (t) => t,
      emphasizeAbnormal: false,
    });
    expect(html).not.toContain("<strong>");
    expect(html).toContain(ABNORMAL_LINE);
  });
});
