/**
 * Source contracts for the composer-chain audit round — pins that keep the
 * audited fixes wired the way they were shipped:
 *
 *   DEMOGRAPHY  the patient master is fetched for the OPEN study even when the
 *              reading-queue filter hides its row (deep link); a blank DICOM
 *              sex no longer blocks the master's gender.
 *   TEST LINK   every billed-name read consults the by-id detail row after the
 *              queue row (bootstrap, Start Report, instant report, Quick
 *              Normal, format control, abnormal strip, booked-name export).
 *   NAME OF TEST  finalize never stores the bare word "Report" while a detail
 *              description, a billed name or the on-screen title exists.
 *   PRINT       the command palette hides Print for a signed study, and the
 *              print-like-final URL carries the per-report typography.
 *
 * Behaviour-level contracts for the pure halves (billedNameFromWorklistRow,
 * alignRecommendationToObservations, buildLivePrintBodyHtml, buildFindingsText)
 * live in their own test files next to each module.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const CLINICAL_UI = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";
const FINALIZE = "hooks/radiology-workspace/useStudyFinalize.ts";
const EXPORT_SHARE = "hooks/radiology-workspace/useWorkspaceExportShare.ts";
const OVERLAYS = "components/radiology/workspace/WorkspaceOverlays.tsx";
const CANVAS = "components/radiology/workspace/ReportCanvas.tsx";
const LINK_DIALOG = "components/radiology/LinkStudyDialog.tsx";
const ALIGNER = "lib/impressionRecommendationWiring.ts";

describe("composer audit — DEMOGRAPHY: the master is fetched for the open study", () => {
  const src = read(CLINICAL_UI);

  it("1. patient-master query keys on the detail row's patientId first, queue row second", () => {
    // The by-id detail read survives the reading-queue filter; the queue row
    // does not. Keying the master fetch on the queue row alone made a
    // deep-linked study print the stale DICOM age tag the master outranks.
    const at = src.indexOf("const masterPatientId");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 900);
    expect(block).toContain("worklistDetailQ.data?.patientId ?? workflow.currentRow?.patientId");
    expect(block).not.toContain("workflow.currentRow!.patientId");
  });

  it("2. the demography sex chain is blank-safe — an empty DICOM sex falls through to the master", () => {
    const at = src.indexOf("const canonicalDemography = useMemo");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 2200);
    // The server stores "" for a blank DICOM PatientSex; a ?? chain would
    // stop there and never reach the patient master's gender.
    expect(block).toContain("[detail?.sex, row?.sex, master?.gender]");
    expect(block).toContain("find(Boolean)");
    expect(block).not.toContain("sex: detail?.sex ?? row?.sex ?? master?.gender");
  });
});

describe("composer audit — TEST LINK: billed name consults the by-id detail row", () => {
  const src = read(CLINICAL_UI);
  const canvas = read(CANVAS);

  it("3. all three hook call sites pass the detail row to the billed-name reader", () => {
    const withDetail = src.match(/billedNameFromWorklistRow\(workflow\.currentRow, worklistDetailQ\.data\)/g) ?? [];
    expect(withDetail.length).toBe(3);
    // And no queue-row-only read is left in the hook.
    expect(src).not.toContain("billedNameFromWorklistRow(workflow.currentRow)");
  });

  it("4. ReportCanvas passes the detail row at Quick Normal and the format control", () => {
    const withDetail = canvas.match(/billedNameFromWorklistRow\(workflow\.currentRow, worklistDetailQ\.data\)/g) ?? [];
    expect(withDetail.length).toBeGreaterThanOrEqual(2);
    expect(canvas).not.toContain("billedNameFromWorklistRow(workflow.currentRow)");
    // The abnormal-format strip's billedTestName/studyDescription props also
    // survive a hidden queue row.
    const stripAt = canvas.indexOf("<MriAbnormalFormatStrip");
    const strip = canvas.slice(stripAt, stripAt + 950);
    expect(strip).toContain("worklistDetailQ.data?.testName");
    expect(strip).toContain("worklistDetailQ.data?.studyDescription");
  });

  it("5. bookedStudyNameForExport falls back to the detail row (scope note survives deep links)", () => {
    const at = src.indexOf("const bookedStudyNameForExport");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 700);
    expect(block).toContain("worklistDetailQ.data?.testName");
    expect(block).toContain("worklistDetailQ.data?.studyDescription");
  });
});

describe("composer audit — NAME OF TEST: finalize title never degrades to 'Report' while a name exists", () => {
  const finalize = read(FINALIZE);
  const src = read(CLINICAL_UI);

  it("6. useStudyFinalize accepts a titleFallback and uses it before the bare word", () => {
    expect(finalize).toContain("titleFallback");
    const at = finalize.indexOf("const primaryStudyTitle");
    expect(at).toBeGreaterThan(-1);
    const block = finalize.slice(at, at + 500);
    expect(block).toContain("workflow.currentRow?.studyDescription");
    expect(block).toContain("opts.titleFallback");
    expect(block.indexOf("opts.titleFallback")).toBeLessThan(block.indexOf('"Report"'));
  });

  it("7. the caller feeds the fallback from the detail row, then the applied format's title", () => {
    const at = src.indexOf("titleFallback:");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 500);
    expect(block).toContain("worklistDetailQ.data?.studyDescription");
    expect(block).toContain("appliedFormatReportTitle");
  });
});

describe("composer audit — PRINT: the palette respects the signed artifact; typography reaches the URL", () => {
  const overlays = read(OVERLAYS);
  const share = read(EXPORT_SHARE);

  it("8. the command palette offers Print only while no signed report exists", () => {
    const at = overlays.indexOf("onPrintReport=");
    expect(at).toBeGreaterThan(-1);
    const block = overlays.slice(at, at + 200);
    expect(block).toContain("linkedReportId");
    // A signed study must re-print the signed artifact, not merge live editor
    // text over the draft print route — the same rule the top bar and the
    // export panel already enforce.
    expect(block).toMatch(/linkedReportId\s*\?\s*undefined\s*:/);
  });

  it("9. the print-like-final URL carries the per-report typography adjustment", () => {
    const at = share.indexOf("autoPrint=true");
    expect(at).toBeGreaterThan(-1);
    const block = share.slice(at - 300, at + 300);
    expect(block).toContain("printFormatQuery(printFormatRef.current)");
  });
});

describe("composer audit — TEST LINK: the same-patient link guard works without a queue row", () => {
  const overlays = read(OVERLAYS);
  const dialog = read(LINK_DIALOG);

  it("10. the link dialog's currentPatientId falls back to the detail row", () => {
    const at = overlays.indexOf("currentPatientId=");
    expect(at).toBeGreaterThan(-1);
    const block = overlays.slice(at, at + 200);
    expect(block).toContain("worklistDetailQ.data?.patientId");
  });

  it("11. the dialog says out loud when the patient cannot be verified", () => {
    expect(dialog).toContain('data-testid="link-study-patient-unknown"');
  });
});

describe("composer audit — RECOMMENDATION: a deleted advice sentence stays deleted", () => {
  it("12. the aligner refuses protected patches exactly like the impression side does", () => {
    const src = read(ALIGNER);
    expect(src).toContain("protected?: boolean");
    expect(src).toContain("if (patch.stale || patch.protected) continue;");
  });
});
