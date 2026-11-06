/**
 * The approved normal a structured report template wrote must be recorded as this
 * report's reference normal — and must not be mistaken for a canvas the report
 * engine built.
 *
 * Both halves broke the same live study. On `63b373b8` a study that opened on a
 * template carried NO reference at all: only the Care-report-format door and an
 * automatic pass ever stamped `startingCanvasBaseline`, so a Quick Select box whose
 * wording ends with a sentence the template also carries claimed that sentence as
 * its own, and deselecting the box deleted it (`tmp/evidence/verify-f2usg.json`:
 * 766 characters down to 749, the liver's "No focal lesion." gone). Stamping the
 * reference is therefore necessary. It is also the exact thing MODE A reads to
 * decide whether it may rebuild a report nobody asked it to rebuild, so the stamp
 * has to say who wrote it — an unpressed pass that rewrites a template-opened report
 * with a different clinic format is a worse defect than the one being fixed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { MRI_LS_SPINE_STANDARD_NORMAL_NAME } from "./fullReportBaseline";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { useWorkspace } from "./store";

const CTX = buildReportingStudyContext({
  modality: "US", studyDescription: "USG Whole Abdomen", regions: ["Whole Abdomen"], source: "auto",
});

const NORMAL = [
  "Liver:",
  "Normal size. Homogeneous echotexture. No focal lesion.",
  "",
  "Free Fluid:",
  "No free fluid in abdomen or pelvis.",
].join("\n");

const ENGINE_CANVAS = {
  formatName: MRI_LS_SPINE_STANDARD_NORMAL_NAME,
  formatRevision: null,
  findings: "Findings written by the engine.",
  impression: "",
  appliedAt: "2026-10-28T00:00:00.000Z",
};

function reset() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionDependencyReasons: [], impressionBasis: null,
    impressionOrderFrozen: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, pendingFormatIds: [], pendingFormatOverwrite: null,
    pendingFormatRegion: null, startingCanvasBaseline: null, appliedFormatName: null,
    appliedFormatReportTitle: null, instantReportHold: null,
    reportingContext: CTX,
    reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [], isFinalized: false,
  });
}

beforeEach(reset);

describe("the approved normal a structured template wrote", () => {
  it("is recorded, and says which door wrote it", () => {
    useWorkspace.setState({ findingsText: NORMAL });
    expect(useWorkspace.getState().stampTemplateApprovedNormal({
      name: "USG Abdomen", findings: NORMAL, impression: "Normal ultrasound of the abdomen.",
    })).toBe(true);
    const canvas = useWorkspace.getState().startingCanvasBaseline!;
    expect(canvas.findings).toBe(NORMAL);
    expect(canvas.impression).toBe("Normal ultrasound of the abdomen.");
    expect(canvas.source).toBe("template");
    // The template is not an applied Care report format, and the banner that names
    // one is the radiologist's evidence of what the report was built from.
    expect(useWorkspace.getState().appliedFormatName).toBeNull();
  });

  it("refuses a blank normal rather than inventing one", () => {
    expect(useWorkspace.getState().stampTemplateApprovedNormal({
      name: "USG Abdomen", findings: "   ", impression: "Normal ultrasound of the abdomen.",
    })).toBe(false);
    expect(useWorkspace.getState().startingCanvasBaseline).toBeNull();
  });

  it("never overwrites the canvas the engine owns", () => {
    useWorkspace.setState({ startingCanvasBaseline: { ...ENGINE_CANVAS } });
    expect(useWorkspace.getState().stampTemplateApprovedNormal({
      name: "USG Abdomen", findings: NORMAL, impression: "",
    })).toBe(false);
    expect(useWorkspace.getState().startingCanvasBaseline!.findings)
      .toBe(ENGINE_CANVAS.findings);
  });

  it("follows a region change to the examination now being reported", () => {
    useWorkspace.getState().stampTemplateApprovedNormal({ name: "USG Abdomen", findings: NORMAL, impression: "" });
    const next = ["Liver:", "Normal size.", "", "Spleen:", "Normal size (< 12 cm)."].join("\n");
    expect(useWorkspace.getState().stampTemplateApprovedNormal({ name: "USG Abdomen", findings: next, impression: "" }))
      .toBe(true);
    expect(useWorkspace.getState().startingCanvasBaseline!.findings).toBe(next);
  });
});

describe("MODE A reads the stamp for what it is", () => {
  /** A line on the page that belongs to no ledger row and to no format scaffold. */
  const foreignPage = () => useWorkspace.setState({
    findingsText: `${NORMAL}\nPatient arrived in severe pain, settled after analgesia.`,
  });

  it("does not let an unpressed pass rebuild a report a template opened", () => {
    useWorkspace.getState().stampTemplateApprovedNormal({ name: "USG Abdomen", findings: NORMAL, impression: "" });
    foreignPage();
    const before = useWorkspace.getState().findingsText;
    const decision = useWorkspace.getState().composeInstantReport(CTX, false);
    // The CODE, not the action: the generator refuses for a reason of its own, so an
    // `action === "hold"` assertion passes whether or not the authorship gate held.
    expect(decision, "the template wrote this page; the engine did not")
      .toMatchObject({ action: "hold", code: "starts-from-dictation" });
    expect(useWorkspace.getState().findingsText).toBe(before);
  });

  it("still composes over the same foreign line when the engine owns the canvas", () => {
    // The control for the test above: the two canvases differ only in who stamped
    // them, so the hold cannot be about the text on the page.
    useWorkspace.setState({ startingCanvasBaseline: { ...ENGINE_CANVAS } });
    foreignPage();
    const decision = useWorkspace.getState().composeInstantReport(CTX, false);
    expect(decision.action === "hold" && decision.code).not.toBe("starts-from-dictation");
  });
});
