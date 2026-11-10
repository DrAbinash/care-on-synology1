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
// The panel is mounted by the live preview column since 2026-11-01 (the owner's
// three-column decision); it was in the report accordion when this contract was written.
const columnSrc = readFileSync(
  resolve(__dirname, "../components/radiology/workspace/ReportLivePreviewColumn.tsx"),
  "utf8",
);
const panelSrc = readFileSync(
  resolve(__dirname, "../components/radiology/ReportExportPanel.tsx"),
  "utf8",
);

describe("export panel demography — identifiers reach the letterpad patch", () => {
  it("the live preview column passes uhid, patientId and accessionNumber to the panel", () => {
    // The panel's demography prop, with every identifier the patch prints.
    expect(columnSrc).toMatch(
      /demography=\{\{[\s\S]*?patientName: canonicalDemography\.patientName,[\s\S]*?uhid: canonicalDemography\.uhid,[\s\S]*?patientId: canonicalDemography\.patientId,[\s\S]*?accessionNumber: canonicalDemography\.accessionNumber,[\s\S]*?\}\}/,
    );
  });

  it("the panel's preview query re-runs when an identifier changes", () => {
    // A queryKey without the identifiers would keep a stale patched table on
    // screen after the underlying study identity resolves.
    // (few-clicks pass 2: the raw per-field entries became ONE debounced
    // demographyKey — see reportExportDebounce.contract.test.ts. The
    // identifiers still ride the key, just inside the signature; the pin
    // walks the signature's members so dropping one still fails here.)
    const keyIdx = panelSrc.indexOf("const demographyKey = demography");
    expect(keyIdx).toBeGreaterThan(0);
    const keyEnd = panelSrc.indexOf(".join(", keyIdx);
    expect(keyEnd).toBeGreaterThan(keyIdx);
    const signature = panelSrc.slice(keyIdx, keyEnd);
    for (const field of ["patientName", "age", "sex", "referringDoctor", "studyDate", "uhid", "patientId", "accessionNumber", "studyDescription", "dateOfBirth"]) {
      expect(signature).toContain(`demography.${field} ?? ""`);
    }
    expect(panelSrc).toMatch(/debouncedDemographyKey,/);
  });

  it("the panel prop type carries the identifiers", () => {
    expect(panelSrc).toContain("uhid?: string | null;");
    expect(panelSrc).toContain("accessionNumber?: string | null;");
    expect(panelSrc).toContain("studyDescription?: string | null;");
    expect(panelSrc).toContain("dateOfBirth?: string | null;");
  });

  it("the print door's letterpad patch carries the identity row (X-2)", () => {
    // The Word door passes studyDescription/dateOfBirth into its patch; the
    // print door used to omit them, so a draft whose only recent edit was the
    // STUDY/DOB correction printed the stale row on paper (demography edits
    // do not set the clinical dirty flag, so the conditional save never ran).
    const shareSrc = readFileSync(
      resolve(__dirname, "../hooks/radiology-workspace/useWorkspaceExportShare.ts"),
      "utf8",
    );
    const printIdx = shareSrc.indexOf("w.document.open();");
    expect(printIdx).toBeGreaterThan(0);
    // The patch object immediately preceding the print-window write.
    const patchStart = shareSrc.lastIndexOf("demography: {", printIdx);
    expect(patchStart).toBeGreaterThan(0);
    const patchEnd = shareSrc.indexOf("},", patchStart);
    const printPatch = shareSrc.slice(patchStart, patchEnd);
    for (const field of ["patientName", "age", "sex", "referringDoctor", "studyDate", "uhid", "patientId", "accessionNumber", "studyDescription", "dateOfBirth"]) {
      expect(printPatch).toContain(`canonicalDemography.${field}`);
    }
  });
});
