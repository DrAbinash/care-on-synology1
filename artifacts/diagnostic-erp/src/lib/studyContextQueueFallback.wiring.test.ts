/**
 * Study context must survive the reading-queue filter (Radiology Highway
 * Audit, Section 2/3 finding, 2026-10-21).
 *
 * The queue row (`workflow.currentRow`) answers to the reading-queue FILTER —
 * modality preset, date window, search — and is NULL whenever the open study
 * falls outside it: a CT/US/XR study under the default MR filter, any deep
 * link (Report button, reopened draft), a filter change mid-report. The whole
 * workspace CONTEXT layer — study-region resolution, Quick Select tiles,
 * protocols, normal formats — used to be wired to that row alone, so it died
 * with it: Patient B (CT Brain) opened with no region, no tiles and no
 * normal formats, and Patient C (US Abdomen) likewise.
 *
 * The fix follows the UHID precedent already pinned in
 * pacsWorklistList.request.test.ts: the by-id worklist detail read (the same
 * authority the lock and the signed status use) carries identity-shaped
 * fields so they survive the filter. This file pins that the contract holds
 * at every layer — server select, server route, workspace wiring, setup
 * hook — so the context layer can never again be re-wired to the queue row
 * alone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const readAbs = (p: string) => readFileSync(p, "utf8");
// The api-server package sits beside diagnostic-erp under artifacts/.
const API = join(SRC, "..", "..", "api-server", "src");

const CLINICAL_UI = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";
const STUDY_SETUP = "hooks/useReportingStudySetup.ts";
const REPORT_CANVAS = "components/radiology/workspace/ReportCanvas.tsx";
const DETAIL_FIELDS = join(API, "lib", "pacsWorklistDetailFields.ts");
const RADIOLOGY_ROUTE = join(API, "routes", "radiology.ts");

describe("server — the by-id detail read carries the study context", () => {
  it("the detail select exposes modality, studyDescription AND the billed test name", () => {
    const src = readAbs(DETAIL_FIELDS);
    expect(src).toContain("modality: radiologyWorklistTable.modality");
    expect(src).toContain("studyDescription: radiologyWorklistTable.studyDescription");
    // The billed catalogue test joined through the linked study — without
    // these the billed> DICOM hint precedence dies with the queue row.
    expect(src).toContain("testId: radiologyStudiesTable.testId");
    expect(src).toContain("testName: testsTable.name");
    expect(src).toContain("billedTestName: testsTable.name");
  });

  it("GET /pacs-worklist/:id actually joins the billed study and its catalogue test", () => {
    const src = readAbs(RADIOLOGY_ROUTE);
    const route = src.slice(src.indexOf('radiologyRouter.get("/pacs-worklist/:id"'));
    expect(route.slice(0, 2000)).toContain("PACS_WORKLIST_DETAIL_SELECT");
    expect(route.slice(0, 2000)).toContain(
      "eq(radiologyWorklistTable.studyId, radiologyStudiesTable.id)",
    );
    expect(route.slice(0, 2000)).toContain(
      "eq(radiologyStudiesTable.testId, testsTable.id)",
    );
  });
});

describe("workspace — the context layer falls back to the by-id read, queue row first", () => {
  it("modality and studyDescription fall back to the detail read when the queue row is null", () => {
    const src = read(CLINICAL_UI);
    // Queue row WINS when present (filter precedence unchanged)…
    expect(src).toContain(
      "modality: workflow.currentRow?.modality ?? worklistDetailQ.data?.modality ?? null",
    );
    expect(src).toContain(
      "studyDescription: workflow.currentRow?.studyDescription ?? worklistDetailQ.data?.studyDescription ?? null",
    );
  });

  it("the billed-test hint falls back to the detail read too — no dead casts", () => {
    const src = read(CLINICAL_UI);
    expect(src).toContain("|| worklistDetailQ.data?.testName");
    expect(src).toContain("|| worklistDetailQ.data?.billedTestName");
    // The old interim shape read the fields through a cast because the
    // endpoint did not carry them. With the server join they are typed; the
    // cast must stay gone.
    expect(src).not.toContain(
      "worklistDetailQ.data as { testName?: string | null; billedTestName?: string | null }",
    );
  });

  it("useReportingStudySetup exposes modality + studyDescription to canvas-level controls", () => {
    const src = read(STUDY_SETUP);
    // Canvas controls (format list, abnormal strip, modality gates) used to
    // re-read the queue row — null outside the filter. They must be able to
    // read the surviving context off the setup hook instead, so the two
    // identity-shaped fields sit at the top of its return value.
    expect(src).toContain("    modality,\n    studyDescription,\n    studyHint,");
  });
});

describe("canvas — the demography and referring-doctor panels render for any OPEN study", () => {
  it("the demography card gates on the open study, not the filtered queue row", () => {
    const src = read(REPORT_CANVAS);
    // Patient B finding: the accordion HEADER resolved (Bharti Devi · 66 Yrs/F
    // · P-00002) while the panel body said "No study selected." — the body was
    // gated on workflow.currentRow, null outside the reading-queue filter,
    // even though canonicalDemography is detail-first and already correct.
    expect(src).toContain("{studyId != null ? (\n                        <ReportDemographyCard");
    expect(src).toContain("{studyId != null ? (\n                        <div className=\"space-y-1\" data-testid=\"ref-dr-block\">");
  });

  it("no study-context UI remains gated on the queue row alone", () => {
    const src = read(REPORT_CANVAS);
    // The queue row is a NAVIGATION cursor (Prev/Next, position), never an
    // identity gate. Both panels above used to be; nothing else in the canvas
    // may re-grow that pattern.
    expect(src).not.toContain("{workflow.currentRow ? (\n                        <ReportDemographyCard");
    expect(src).not.toContain("{workflow.currentRow ? (\n                        <div className=\"space-y-1\" data-testid=\"ref-dr-block\">");
  });
});

describe("drafts — a saved draft hydrates for a study outside the reading-queue filter", () => {
  const DRAFT_HOOK = "hooks/radiology-workspace/useDraftPersistence.ts";

  it("the hydrate patient gate falls back to the by-id read when the queue row is null", () => {
    const src = read(DRAFT_HOOK);
    // Without this fallback the gate waited for a queue-row patient that never
    // arrives for an out-of-filter study; the draft never hydrated and the
    // next save overwrote it with the still-empty editor — silent draft loss.
    expect(src).toContain(
      "const rowPatientId = workflow.currentRow?.patientId ?? detailPatientId ?? null;",
    );
  });

  it("the save envelope keeps patient identity outside the queue filter too", () => {
    const src = read(DRAFT_HOOK);
    expect(src).toContain(
      "const capturedPatientId = workflow.currentRow?.patientId ?? detailPatientId ?? null;",
    );
  });

  it("the caller feeds the gate the by-id detail read's patientId", () => {
    const src = read(CLINICAL_UI);
    expect(src).toContain("detailPatientId: worklistDetailQ.data?.patientId ?? null,");
  });

  it("the cross-patient refusal itself still exists and still waits", () => {
    const src = read(DRAFT_HOOK);
    expect(src).toContain("if (existingDraft.patientId != null && rowPatientId == null) return;");
    expect(src).toContain("canHydrateDraftForPatient(existingDraft.patientId, rowPatientId)");
  });
});
