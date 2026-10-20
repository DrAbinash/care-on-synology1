/**
 * One signed report, one document — the browser PDF door cannot pair a
 * signature it fetched with clinical text it was handed.
 *
 * The review found the asymmetry: `handleExportPdf` reads the authorization from
 * the server at export time (`loadSignerOfRecord`) while every other field of the
 * document — findings, impression, measurements, technique — comes from the live
 * workspace. Nothing compared the two. A draft is supposed to print what is on the
 * screen; a REPORT THAT WAS SIGNED is not, because the words under that name are
 * only authorized as the record holds them. Any drift (an edit whose save was
 * refused, a row signed from Report Hub while this workspace still shows the old
 * text, a measurement store that moved on) produced a valid signature over
 * unauthorized content — and disagreed with Report Hub's own Download PDF, which
 * has always fetched the frozen artifact from `GET /api/patient-reports/:id/pdf`.
 *
 * Driven at the seam, the way `reportedScopeWiring.test.ts` does it: call the real
 * exporter, watch what reaches the renderer. A source grep here would be green
 * while the door still drew the document.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const generateReportPDF = vi.fn(() => ({ output: () => new Uint8Array() }));
const loadPrintSettings = vi.fn(() => ({
  header: { enabled: true },
  footer: { enabled: true },
  show: { measurements: false, keyImages: false },
}));
vi.mock("./reportPdfGenerator", () => ({
  get generateReportPDF() { return generateReportPDF; },
  get loadPrintSettings() { return loadPrintSettings; },
}));

const { exportRadiologyReportToPdf, SignedReportArtifactRequired } =
  await import("./radiologyReportPdfExport.ts");

/** The workspace's own export handler, read as text: a React hook has no seam. */
function source(...segments: string[]): string {
  return readFileSync(fileURLToPath(new URL(`../${segments.join("/")}`, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");
}

const BASE = {
  patientName: "SYNTHETIC PATIENT",
  age: "41 Y",
  sex: "M",
  studyDate: "20261020",
  referringDoctor: "Dr Referring",
  accessionNumber: "SYN-SI-ACC-0001",
  uhid: "SYN-SI-UHID-0001",
  modality: "MRI",
  bodyPart: "MRI BRAIN",
  clinicalHistory: "",
  technique: "",
  useStructured: false,
  findingsMap: {},
  rawFindings: "No acute intracranial abnormality.",
  impression: ["Normal MRI brain."],
  recommendation: "",
  studyName: "MRI BRAIN",
  dicomWebBase: null,
  imageRefs: [],
  clinic: null,
};

/** What the record says, exactly as `recordedSignerForReport()` hands it over. */
const RECORD = {
  name: "Dr. Ananya Menon",
  qualification: "MD (Radiodiagnosis)",
  registrationNo: "REC-4402",
  imageDataUrl: null,
};

describe("the browser PDF door refuses to authorize content it did not sign", () => {
  it("E1 a signed report never reaches the renderer, even when the page text differs", async () => {
    generateReportPDF.mockClear();
    const err = await exportRadiologyReportToPdf({
      ...BASE,
      // Text this browser is holding, which is NOT what was signed.
      rawFindings: "MODIFIED ON SCREEN AFTER SIGNING — large right frontal lesion.",
      impression: ["GLIOSIS, NOT AUTHORIZED BY ANYONE"],
      signerOfRecord: RECORD,
      unsigned: false,
      authorizedReportId: 412,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SignedReportArtifactRequired);
    expect((err as Error).message).toContain("/api/patient-reports/412/pdf");
    expect(generateReportPDF).not.toHaveBeenCalled();
  });

  it("E2 the refusal comes before any image fetch, so nothing leaks for a document that will not be drawn", async () => {
    generateReportPDF.mockClear();
    const fetched: string[] = [];
    vi.stubGlobal("fetch", (url: RequestInfo) => {
      fetched.push(String(url));
      return Promise.reject(new Error("should never be asked"));
    });
    const err = await exportRadiologyReportToPdf({
      ...BASE,
      dicomWebBase: "http://dicom.invalid/dicomweb",
      imageRefs: [{ studyInstanceUID: "1.2.3", seriesInstanceUID: "1.2.3.4", sopInstanceUID: "1.2.3.4.5", caption: "", id: 7 }],
      signerOfRecord: RECORD,
      authorizedReportId: 412,
    }).catch((e) => e);
    vi.unstubAllGlobals();

    expect(err).toBeInstanceOf(SignedReportArtifactRequired);
    expect(fetched).toEqual([]);
  });

  it("E3 an unsigned radiology document still prints what is on the screen", async () => {
    // The draft workflow is the point of this door: the radiologist is exporting
    // work in progress, and there is no authorization to contradict it.
    generateReportPDF.mockClear();
    await exportRadiologyReportToPdf({ ...BASE, signerOfRecord: null, unsigned: true });
    expect(generateReportPDF).toHaveBeenCalledTimes(1);
    const model = generateReportPDF.mock.calls[0]![0] as Record<string, unknown>;
    expect(model.unsigned).toBe(true);
    expect(model.signerOfRecord).toBeNull();
  });

  it("E4 a page with no report behind it keeps the signer this station configured", async () => {
    // USG / Echo / Fetal and the legacy generator call the door with neither
    // field. They are not signed reports and must not be redirected anywhere.
    generateReportPDF.mockClear();
    await exportRadiologyReportToPdf({ ...BASE });
    expect(generateReportPDF).toHaveBeenCalledTimes(1);
    const model = generateReportPDF.mock.calls[0]![0] as Record<string, unknown>;
    expect(model.signerOfRecord).toBeNull();
    expect(model.unsigned).toBe(false);
  });
});

describe("the workspace Download PDF takes a signed report from the record", () => {
  const hook = source("hooks/radiology-workspace/useWorkspaceExportShare.ts");
  const body = hook.slice(hook.indexOf("const handleExportPdf"));

  it("E5 the authorization is read before anything is drawn", () => {
    // Ordering is the guarantee: if the record were read after the document was
    // built, the branch below could never see it. Each position is asserted to
    // exist first, because an absent call reads as "earlier" to a bare `<`.
    const read = body.indexOf("loadSignerOfRecord(");
    const drawn = body.indexOf("exportRadiologyReportToPdf(");
    const measured = body.indexOf("spinal-measurements");
    expect(read).toBeGreaterThanOrEqual(0);
    expect(drawn).toBeGreaterThan(read);
    expect(measured).toBeGreaterThan(read);
  });

  it("E6 a report with a record downloads the server artifact and returns", () => {
    expect(body).toContain("if (signerOfRecord && authorizedReportId != null) {");
    expect(body).toContain("`/api/patient-reports/${authorizedReportId}/pdf`");
    // …and it returns from that branch: no client rendering happens for a report
    // that has an authorization, so there is no path from live text to signed name.
    const branch = body.slice(body.indexOf("if (signerOfRecord && authorizedReportId != null) {"));
    const returned = branch.indexOf("return;");
    expect(returned).toBeGreaterThanOrEqual(0);
    expect(branch.slice(0, returned)).toContain("api.downloadFile(");
    expect(branch.slice(0, returned)).not.toContain("exportRadiologyReportToPdf(");
  });

  it("E7 the door is still told which record it is being asked to sign", () => {
    // The backstop needs the id to name the artifact in its message; without it
    // a future caller could hand over a signature and get a silent refusal.
    const call = body.slice(body.indexOf("exportRadiologyReportToPdf("));
    expect(call).toContain("authorizedReportId,");
  });
});
