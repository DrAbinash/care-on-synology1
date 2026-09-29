import { describe, expect, it } from "vitest";

import {
  IMPRESSION_PRIORITY,
  impressionPriorityPreview,
  isImpressionWorthyLine,
  orderImpressionLines,
  rankImpressionLine,
} from "./impressionPriority";

describe("impression prioritization (spec §37)", () => {
  it("ranks acute and urgent findings first", () => {
    const ordered = orderImpressionLines([
      "Mild disc desiccation at L4-L5.",
      "Grade 1 isthmic spondylolisthesis at L5-S1.",
      "Acute cauda equina syndrome with severe canal compression.",
      "Severe central canal stenosis at L4-L5.",
    ]);
    expect(ordered[0]).toContain("cauda equina syndrome");
    expect(ordered[ordered.length - 1]).toContain("Mild disc desiccation");
  });

  it("follows the spec order: canal, root, foraminal, extrusion, listhesis, fracture, infection, mass, postop, screening", () => {
    const lines = [
      "Screening of the cervical spine shows cord compression.",
      "Post-operative epidural abscess.",
      "Metastatic marrow infiltrative disease.",
      "Spondylodiscitis at L4-L5.",
      "Compression fracture of L1.",
      "Grade 1 anterolisthesis L4 on L5.",
      "Disc extrusion at L5-S1.",
      "Moderate foraminal stenosis bilaterally.",
      "Severe central canal stenosis at L4-L5.",
    ];
    const ordered = orderImpressionLines(lines);
    expect(ordered[0]).toContain("Severe central canal stenosis");
    expect(ordered[1]).toContain("Moderate foraminal stenosis");
    expect(ordered[2]).toContain("Disc extrusion");
    expect(ordered[3]).toContain("anterolisthesis");
    expect(ordered[4]).toContain("Compression fracture");
    expect(ordered[5]).toContain("Spondylodiscitis");
    expect(ordered[6]).toContain("Metastatic");
    expect(ordered[7]).toContain("epidural abscess");
    expect(ordered[8]).toContain("Screening");
  });

  it("puts definite nerve root compression above foraminal stenosis", () => {
    const ordered = orderImpressionLines([
      "Moderate left foraminal stenosis.",
      "Compression of the descending right S1 nerve root.",
    ]);
    expect(ordered[0]).toContain("S1 nerve root");
  });

  it("keeps minor degeneration from dominating but never drops a line", () => {
    const lines = [
      "Mild facet joint arthropathy at L4-L5.",
      "Disc desiccation at L5-S1.",
      "Severe central canal stenosis at L4-L5 with cauda equina crowding.",
    ];
    const ordered = orderImpressionLines(lines);
    expect(ordered).toHaveLength(3);
    expect(ordered[0]).toContain("Severe central canal stenosis");
    expect(isImpressionWorthyLine("Mild facet joint arthropathy at L4-L5.")).toBe(false);
    expect(isImpressionWorthyLine("Severe central canal stenosis at L4-L5.")).toBe(true);
  });

  it("is stable for equal ranks so wording order is not shuffled arbitrarily", () => {
    const ordered = orderImpressionLines([
      "First mild disc bulge at L3-L4.",
      "Second mild disc bulge at L4-L5.",
      "Third mild disc bulge at L5-S1.",
    ]);
    expect(ordered).toEqual([
      "First mild disc bulge at L3-L4.",
      "Second mild disc bulge at L4-L5.",
      "Third mild disc bulge at L5-S1.",
    ]);
  });

  it("stops reordering once the radiologist has frozen the order (spec §37)", () => {
    const lines = [
      "Mild disc desiccation at L4-L5.",
      "Acute cauda equina syndrome with severe canal compression.",
    ];
    expect(orderImpressionLines(lines, { frozen: true })).toEqual(lines);
    expect(orderImpressionLines(lines)[0]).toContain("cauda equina");
  });

  it("exposes a preview so the UI can show what would move", () => {
    const preview = impressionPriorityPreview([
      "Disc desiccation at L4-L5.",
      "Acute cauda equina syndrome.",
    ]);
    expect(preview).toHaveLength(2);
    expect(preview[1]!.moves).toBe(true);
    expect(preview[1]!.label).toContain("acute");
    expect(rankImpressionLine("Some unclassified sentence.").rank).toBeLessThan(999);
    expect(IMPRESSION_PRIORITY.length).toBeGreaterThanOrEqual(13);
  });

  it("trims and drops empty lines", () => {
    expect(orderImpressionLines(["  ", "Severe canal stenosis.", ""])).toEqual(["Severe canal stenosis."]);
  });

  it("ranks thoracic cord, ossification and deformity lines (dorsal spec §31)", () => {
    const lines = [
      "Preserved thoracic kyphosis with a focal gibbus at T9-T10.",
      "Multilevel disc desiccation in the mid thoracic spine.",
      "Severe T10-T11 central canal stenosis secondary to Ossification of the Ligamentum Flavum (OLF).",
      "T8-T9 thoracic spinal cord compression with intrinsic cord signal abnormality.",
    ];
    const ordered = orderImpressionLines(lines);
    expect(ordered[0]).toContain("cord compression");
    expect(ordered[1]).toContain("OLF");
    expect(ordered[ordered.length - 1]).toContain("desiccation");
    expect(rankImpressionLine("Severe T10-T11 canal stenosis from OLF.").label).toContain("OLF");
    expect(rankImpressionLine("Focal gibbus deformity at T12.").label).toContain("deformity");
  });
});
