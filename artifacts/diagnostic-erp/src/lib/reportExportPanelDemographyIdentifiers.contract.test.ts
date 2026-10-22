import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source contract: the workspace export panel's letterpad patch keeps the
 * study identifiers on screen.
 *
 * `patchLetterpadDemographyHtml` rebuilds the whole demography table from the
 * object it is handed. `ReportCanvas` used to pass only name/age/sex/referrer/
 * date — so the rebuilt table silently DROPPED the UHID/ACCESSION row that the
 * server HTML (and every durable PDF) prints. The on-screen preview then
 * stopped matching what Print produces for the same report.
 *
 * This pins the wiring, not the builder: buildLetterpadDemographyHtml already
 * has its own unit tests in reportDemography.test.ts.
 */
const canvasSrc = readFileSync(
  resolve(__dirname, "../components/radiology/workspace/ReportCanvas.tsx"),
  "utf8",
);
const panelSrc = readFileSync(
  resolve(__dirname, "../components/radiology/ReportExportPanel.tsx"),
  "utf8",
);

describe("export panel demography — identifiers reach the letterpad patch", () => {
  it("ReportCanvas passes uhid, patientId and accessionNumber to the panel", () => {
    // The panel's demography prop, with every identifier the patch prints.
    expect(canvasSrc).toMatch(
      /demography=\{\{[\s\S]*?patientName: canonicalDemography\.patientName,[\s\S]*?uhid: canonicalDemography\.uhid,[\s\S]*?patientId: canonicalDemography\.patientId,[\s\S]*?accessionNumber: canonicalDemography\.accessionNumber,[\s\S]*?\}\}/,
    );
  });

  it("the panel's preview query re-runs when an identifier changes", () => {
    // A queryKey without the identifiers would keep a stale patched table on
    // screen after the underlying study identity resolves.
    expect(panelSrc).toMatch(
      /demography\?\.\w+,\s*\n\s*demography\?\.uhid,\s*\n\s*demography\?\.patientId,\s*\n\s*demography\?\.accessionNumber,/,
    );
  });

  it("the panel prop type carries the identifiers", () => {
    expect(panelSrc).toContain("uhid?: string | null;");
    expect(panelSrc).toContain("accessionNumber?: string | null;");
  });
});
