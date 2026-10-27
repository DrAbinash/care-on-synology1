/**
 * PRIORITY 1 wiring — the workspace's "Download PDF" must carry the same
 * documented-region sentence as the printed page, and neither surface may
 * invent its own version of it.
 *
 * Revised after the acceptance run measured the shipped behaviour: the printed
 * page said "Documented reporting region: Cervical Spine … Booked examination:
 * MRI WHOLE SPINE." while the downloaded PDF of the SAME study said nothing at
 * all. This file used to prove the wiring with a source grep that asserted the
 * note is asked for with `input.studyName` — the very string drawn as the
 * heading. That grep was green and the feature was broken, because a study name
 * resolved through `resolvePrintedReportTitle(appliedFormatReportTitle, booked)`
 * is the clinic's FORMAT title whenever the format supplies one, and a cervical
 * format title on a study booked whole-spine leaves the shared rule nothing to
 * explain. A test that pins an expression instead of a behaviour is not a gate.
 *
 * So the contract is now driven at the seam: call the real export entry point,
 * capture the model it hands the renderer, and read the sentence off it. The
 * renderer itself stays proven in `reportPdfGenerator.reportingScope.test.ts`.
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";

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

const { exportRadiologyReportToPdf } = await import("./radiologyReportPdfExport.ts");

/** The one record shape ADR-004 stores, as the live draft holds it (accession SYN-M1-ACC-0001). */
const CERVICAL_FROM_WHOLE_SPINE = [{
  kind: "care.region_transition.v1",
  fromRegion: "Whole Spine",
  toRegion: "Cervical Spine",
  decidedBy: "abinashsingh@gmail.com",
  at: "2026-10-13T09:40:00.000Z",
}];

/** Calls the real exporter and returns the model object it handed the renderer. */
async function modelFor(overrides: Record<string, unknown>) {
  generateReportPDF.mockClear();
  await exportRadiologyReportToPdf({
    patientName: "SYNTHETIC SPINECASE",
    age: "41 Y",
    sex: "M",
    studyDate: "20261013",
    referringDoctor: "Dr Referring",
    accessionNumber: "SYN-M1-ACC-0001",
    uhid: "SYN-M1-UHID-0001",
    modality: "MRI",
    bodyPart: "MRI Whole Spine Screening",
    clinicalHistory: "",
    technique: "",
    useStructured: false,
    findingsMap: {},
    rawFindings: "Cervical spine: alignment within normal limits.",
    impression: ["Normal MRI cervical spine."],
    recommendation: "",
    headingCase: "title_case",
    dicomWebBase: "",
    imageRefs: [],
    frozenKeyImages: [],
    clinic: null,
    ...overrides,
  } as never);
  expect(generateReportPDF).toHaveBeenCalledTimes(1);
  return generateReportPDF.mock.calls[0][0] as Record<string, string | undefined>;
}

describe("the downloaded PDF keeps booked examination and documented region apart", () => {
  it("R1 a format-titled PDF of a re-regioned study still names the booked examination", async () => {
    const model = await modelFor({
      // What the workspace passes today: the heading follows the clinic's format.
      studyName: "MRI Cervical Spine Screening",
      bookedStudyName: "MRI Whole Spine",
      regionTransitions: CERVICAL_FROM_WHOLE_SPINE,
    });
    // Heading precedence is untouched — the format's title is still what prints.
    expect(model.reportTitle).toBe("MRI Cervical Spine Screening");
    const note = model.reportingScopeNote ?? "";
    expect(note).toContain("Documented reporting region: Cervical Spine");
    expect(note).toContain("Booked examination: MRI Whole Spine");
  });

  it("R2 a study nobody re-regioned gets no note, whichever title it wears", async () => {
    const model = await modelFor({
      studyName: "MRI Cervical Spine Screening",
      bookedStudyName: "MRI Cervical Spine",
      regionTransitions: [],
    });
    expect(model.reportingScopeNote).toBeUndefined();
  });

  it("R3 a caller that supplies no booked name keeps the previous behaviour", async () => {
    // The Word/USG callers and every existing test path must not change shape.
    const model = await modelFor({
      studyName: "MRI Whole Spine",
      regionTransitions: CERVICAL_FROM_WHOLE_SPINE,
    });
    expect(model.reportingScopeNote ?? "").toContain("Booked examination: MRI Whole Spine");
  });

  it("R4 a booked name identical to the documented region explains nothing and is omitted", async () => {
    const model = await modelFor({
      studyName: "MRI Cervical Spine Screening",
      bookedStudyName: "MRI Cervical Spine Screening",
      regionTransitions: CERVICAL_FROM_WHOLE_SPINE,
    });
    expect(model.reportingScopeNote).toBeUndefined();
  });

  it("R5 the reporting workspace hands the exporter the booked examination, not the heading", async () => {
    const hook = readFileSync(
      new URL("../hooks/radiology-workspace/useWorkspaceExportShare.ts", import.meta.url), "utf8",
    ).replace(/\r\n/g, "\n");
    const start = hook.indexOf("await exportRadiologyReportToPdf({");
    expect(start).toBeGreaterThanOrEqual(0);
    const call = hook.slice(start, hook.indexOf("\n    });", start));
    expect(call).toContain("bookedStudyName:");
    expect(call).toContain("regionTransitions: useWorkspace.getState().regionTransitions");
  });

  it("R6 the booked name is the billed catalogue examination, never the composite study title", () => {
    // R1-R4 prove the exporter uses whatever booked name it is given. This proves
    // where the workspace gets it. `studySetup.testName` is a composite that falls
    // back to the selected TEMPLATE's name; a template named for the region being
    // reported makes booked == documented, and the shared rule then answers "nothing
    // to explain" — the sentence vanishes with no error anywhere. That is the same
    // failure this PR fixed, one level up, so the source of the string is owned.
    const clinicalUi = readFileSync(
      new URL("../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx", import.meta.url), "utf8",
    ).replace(/\r\n/g, "\n");
    const marker = "const bookedStudyNameForExport =";
    const start = clinicalUi.indexOf(marker);
    expect(start, "bookedStudyNameForExport is no longer derived in the workspace").toBeGreaterThanOrEqual(0);
    const derivation = clinicalUi.slice(start + marker.length, clinicalUi.indexOf("\n", clinicalUi.indexOf("null;", start)));
    expect(derivation).toContain("currentRow?.testName");
    expect(derivation).toContain("currentRow?.billedTestName");
    expect(derivation).toContain("currentRow?.studyDescription");
    expect(derivation).not.toContain("studySetup.testName");
    expect(derivation).not.toContain("studyNameForExport");
  });
});

describe("one implementation of the region sentence and the region vocabulary", () => {
  const SENTENCE = "Documented reporting region";

  function sourcesUnder(dir: URL): Array<{ path: string; text: string }> {
    const out: Array<{ path: string; text: string }> = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) { out.push(...sourcesUnder(child)); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      out.push({ path: child.pathname.replace(/\\/g, "/"), text: readFileSync(child, "utf8") });
    }
    return out;
  }

  const repoRoot = new URL("../../../../", import.meta.url);
  const scanned = [
    ...sourcesUnder(new URL("artifacts/diagnostic-erp/src/", repoRoot)),
    ...sourcesUnder(new URL("artifacts/api-server/src/", repoRoot)),
    ...sourcesUnder(new URL("lib/report-quality/src/", repoRoot)),
  ];

  // A scan that scanned nothing proves nothing.
  it("W0 the sweep covers the shipped source of both surfaces and the shared package", () => {
    expect(scanned.length).toBeGreaterThan(600);
    expect(scanned.some((f) => f.path.includes("reportPdfGenerator.ts"))).toBe(true);
    expect(scanned.some((f) => f.path.includes("reportPresentation.ts"))).toBe(true);
  });

  it("W3 the sentence exists in exactly one shipped file, and it is the shared rule", () => {
    const writers = scanned.filter((file) => file.text.includes(SENTENCE)).map((file) => file.path);
    expect(writers).toEqual([expect.stringContaining("report-quality/src/reportingScope.ts")]);
  });

  it("W4 the workspace re-exports the region vocabulary instead of keeping a second copy", () => {
    const context = readFileSync(new URL("../lib/reportingStudyContext.ts", import.meta.url), "utf8");
    expect(context).toContain('} from "@workspace/report-quality";');
    expect(context).not.toContain("export function canonicalContentRegion(");
    expect(context).not.toContain("export function spineSegmentFromRegion(");
    const transition = readFileSync(new URL("./regionTransition.ts", import.meta.url), "utf8");
    expect(transition).not.toContain("export function coverageOfRegion(");
  });
});
