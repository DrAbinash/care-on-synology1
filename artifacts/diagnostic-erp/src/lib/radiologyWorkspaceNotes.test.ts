import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("Radiology Reporting Workspace handwritten notes", () => {
  const workspace = read("pages/RadiologyReportingWorkspace.tsx");
  const strip = read("components/radiology/zai-workspace/worklist-strip.tsx");
  const picker = read("components/radiology/ReportImagePicker.tsx");
  const viewer = read("components/EmbeddedWadoViewer.tsx");
  const panel = read("components/radiology/ReportImagePanel.tsx");
  const quick = read("components/radiology/QuickFindingsPanel.tsx");
  const refDoc = read("components/ReferringDoctorQuickSelect.tsx");
  const doctorsPage = read("pages/Doctors.tsx");

  it("Report images collapse OHIF and hide the selected list (right rail)", () => {
    expect(picker).toContain("onExpandChange");
    expect(picker).toContain("hideSelectedList");
    expect(workspace).toContain("onExpandChange={setReportImagesOpen}");
    expect(workspace).toContain("hideSelectedList");
    expect(workspace).toContain("reportImagesOpen");
    expect(workspace).toContain('data-testid="selected-images-rail"');
  });

  it("reading queue defaults to MRI + Today & Yesterday and Next uses CARE order", () => {
    expect(strip).toContain('data-testid="reading-queue-modality"');
    expect(strip).toContain('data-testid="reading-queue-date"');
    expect(strip).toContain('data-testid="reading-queue-next"');
    expect(workspace).toContain('modalityFilter: queueModality');
    expect(workspace).toContain("onNextStudy={goNextStudy}");
    expect(workspace).toContain('"today-yesterday"');
  });

  it("DICOM viewer shows patient name", () => {
    expect(viewer).toContain("patientName");
    expect(viewer).toContain('data-testid="viewer-patient-name"');
    expect(workspace).toContain("patientName={canonicalDemography.patientName");
  });

  it("referring doctor quick select exposes add box and pencil editor with catalog degrees", () => {
    expect(refDoc).toContain('data-testid="ref-doctor-add-box"');
    expect(refDoc).toContain('data-testid="ref-doctor-edit-degrees"');
    expect(refDoc).toContain('placeholder="Add doctor…');
    expect(refDoc).toContain("formatDoctorWithDegree");
    expect(workspace).toContain("formatDoctorWithDegree");
    expect(doctorsPage).toContain('register("degree")');
    expect(doctorsPage).toContain('regEdit("degree")');
  });

  it("History section saves server chips via + Add Title pencil editor", () => {
    const historyStrip = read("components/radiology/ClinicalHistoryChipStrip.tsx");
    expect(historyStrip).toContain('data-testid="history-add-title"');
    expect(historyStrip).toContain("/api/radiology/quick-select/clinical-history");
    expect(historyStrip).toContain('queryKey: ["radiology-quick-select"]');
    expect(workspace).toContain("ClinicalHistoryChipStrip");
    expect(workspace).toContain('onEditSection={focusReportField}');
  });

  it("protocol has + Add Title like History chips", () => {
    expect(workspace).toContain('data-testid="protocol-add-title"');
    expect(workspace).toContain('data-testid="protocol-title-input"');
  });

  it("Quick Add has + and a body-region fallback", () => {
    expect(quick).toContain('data-testid="quick-add-plus"');
    expect(quick).toContain('data-testid="quick-add-region"');
  });

  it("selected images layout is configurable stack/grid", () => {
    expect(panel).toContain('data-testid="selected-images-layout-toggle"');
    expect(panel).toContain("care_report_images_layout");
  });

  it("exposes Edit Framing on every selected report image", () => {
    expect(panel).toContain("panel-edit-framing-");
    expect(panel).toContain("ImageFramingEditor");
    expect(panel).toContain("Edit Framing");
    expect(panel).toContain("framingImgStyle");
    const editor = read("components/radiology/ImageFramingEditor.tsx");
    expect(editor).toContain('data-testid="framing-fit"');
    expect(editor).toContain('data-testid="framing-fill"');
    expect(editor).toContain('data-testid="framing-reset"');
    expect(editor).toContain('data-testid="framing-apply"');
    expect(editor).toContain("width: 238");
  });
});
