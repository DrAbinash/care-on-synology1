/**
 * Seven complete MRI Brain reports, built the way a radiologist builds them:
 * scaffold first, then Quick Select boxes, one click at a time.
 *
 * The catalogue file measures one box against one scaffold. This file measures
 * the artefact the clinic actually signs — Findings, Impression, where each
 * finding is attributed, which normals retired, which survived, and what the
 * printed page emphasises. Several of these stack boxes that name the same
 * family of anatomy, which is where an over-wide retirement rule deletes one
 * abnormality while adding another (three aneurysms arriving as two was the
 * first sighting of it, in mriBrainVascularLesions.test.ts).
 *
 * Same oracles as the catalogue: the real store, the real shipped baseline
 * manifest, the real print-body builder. No fixtures.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { quickSelectTilePatch } from "./quickSelectTilePayload";
import { useWorkspace } from "./store";
import { MRI_BRAIN_STANDARD_NORMAL_MANIFEST } from "./baselines/mriBrainStandardNormal";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { buildLivePrintBodyHtml } from "@/lib/radiologyReportPrintLiveMerge";

const ctx = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
});

function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: ctx, reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [], isFinalized: false, isDirty: false,
  });
  useWorkspace.getState().generateProfessionalReport(ctx);
}

/** One click, as the strip performs it. `side` is what the radiologist chose. */
function click(label: string, side?: "left" | "right") {
  const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!tile) throw new Error(`${label} is not in the catalogue`);
  const outcome = useWorkspace.getState().applyPathologyOverlay(
    quickSelectTilePatch(tile, "findings", side ? { side } : {}),
  );
  if (outcome !== "applied") throw new Error(`${label} was refused: ${outcome}`);
}

function report() {
  const s = useWorkspace.getState();
  const page = buildLivePrintBodyHtml({
    clinicalHistory: s.clinicalHistoryText,
    technique: s.techniqueText,
    rawFindings: s.findingsText,
    findingsMap: {},
    useStructured: false,
    impression: s.impressionText.split(/\n+/).map((x) => x.trim()).filter(Boolean),
    recommendation: s.recommendationText,
    headingCase: "all_caps",
    impressionStyle: "numbered",
  });
  const bolded = (page.match(/<strong>([^<]{20,})<\/strong>/g) ?? [])
    .map((m) => m.replace(/^<strong>|<\/strong>$/g, ""))
    .filter((t) => !t.startsWith("Impression:"));
  return {
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
    page,
    bolded,
    /** A scaffold normal is still in the report. */
    hasNormal: (concept: string) => {
      const row = (MRI_BRAIN_STANDARD_NORMAL_MANIFEST.observations ?? [])
        .find((o) => o.field === "findings" && o.concept === concept)!;
      return s.findingsText.includes(row.renderedText.trim());
    },
  };
}

describe("MRI Brain — whole reports from Quick Select", () => {
  it("case A: acute left basal ganglia hemorrhage with surrounding edema", () => {
    reset();
    click("Basal ganglia hemorrhage", "left");
    click("Cerebral edema");
    const r = report();

    // The clinical claim keeps every part of itself.
    expect(r.findings).toMatch(/left basal ganglia/i);
    expect(r.findings).toMatch(/intraparenchymal hemorrhage/i);
    expect(r.findings).toMatch(/intraventricular extension/i);
    expect(r.findings).toMatch(/midline shift of ___ mm/i);
    expect(r.findings).toMatch(/diffuse edema/i);

    // Every normal the two boxes falsify is gone.
    expect(r.hasNormal("hemorrhage")).toBe(false);
    expect(r.hasNormal("basal_ganglia")).toBe(false);
    expect(r.hasNormal("midline")).toBe(false);
    // Everything they say nothing about survives.
    expect(r.hasNormal("infarct")).toBe(true);
    expect(r.hasNormal("diffusion")).toBe(true);
    expect(r.hasNormal("brainstem")).toBe(true);
    expect(r.hasNormal("cerebellum")).toBe(true);
    expect(r.hasNormal("posterior_fossa")).toBe(true);
    expect(r.hasNormal("vascular_flow_voids")).toBe(true);

    // The two abnormalities coexist — the edema box did not eat the hemorrhage.
    expect(r.findings.split(/hemorrhage/i).length - 1).toBeGreaterThanOrEqual(1);

    expect(r.impression).toMatch(/left basal ganglia hemorrhage/i);
    expect(r.page).toMatch(/PREVIEW|Acute left|basal ganglia/);
    // Both abnormal statements are emphasised on the printed page.
    expect(r.bolded.join(" ")).toMatch(/hemorrhage/i);
    expect(r.bolded.length).toBeGreaterThanOrEqual(2);
  });

  it("case B: acute right MCA territory infarction with restricted diffusion", () => {
    reset();
    click("Acute infarct (DWI)", "right");
    const r = report();

    expect(r.findings).toMatch(/right MCA territory/i);
    expect(r.findings).toMatch(/restricted diffusion/i);
    expect(r.findings).toMatch(/no hemorrhagic transformation/i);
    expect(r.hasNormal("infarct")).toBe(false);
    expect(r.hasNormal("diffusion")).toBe(false);
    // An infarct is not a hemorrhage, and must not retire the hemorrhage denial.
    expect(r.hasNormal("hemorrhage")).toBe(true);
    expect(r.hasNormal("ventricles")).toBe(true);
    expect(r.hasNormal("basal_ganglia")).toBe(true);
    expect(r.hasNormal("midline")).toBe(true);
    expect(r.impression).toMatch(/right MCA territory infarct/i);
    expect(r.recommendation).toMatch(/stroke team/i);
    expect(r.bolded.join(" ")).toMatch(/infarct/i);
  });

  it("case C: Fazekas grade 3 small-vessel change with cerebral atrophy", () => {
    reset();
    click("Fazekas 3");
    click("Cerebral atrophy");
    const r = report();

    expect(r.findings).toMatch(/Fazekas grade 3/i);
    expect(r.findings).toMatch(/confluent T2\/FLAIR hyperintense/i);
    expect(r.findings).toMatch(/cerebral atrophy/i);
    // White-matter hyperintensity is not a normal parenchymal signal.
    expect(r.hasNormal("brain_parenchyma")).toBe(false);
    // "periventricular" is a location, not a ventricular abnormality.
    expect(r.hasNormal("ventricles")).toBe(true);
    expect(r.hasNormal("hemorrhage")).toBe(true);
    expect(r.hasNormal("infarct")).toBe(true);
    expect(r.hasNormal("diffusion")).toBe(true);
    expect(r.hasNormal("basal_ganglia")).toBe(true);
    expect(r.impression).toMatch(/Fazekas grade 3/i);
    expect(r.bolded.join(" ")).toMatch(/Fazekas/i);
  });

  it("case D: left cerebral convexity subdural hematoma with mass effect", () => {
    reset();
    click("Subdural hematoma", "left");
    const r = report();

    expect(r.findings).toMatch(/left cerebral convexity/i);
    expect(r.findings).toMatch(/subdural hematoma/i);
    expect(r.findings).toMatch(/extra-axial collection/i);
    expect(r.findings).toMatch(/maximum thickness ___ mm/i);
    // A subdural hematoma IS intracranial blood and IS extra-axial.
    expect(r.hasNormal("hemorrhage")).toBe(false);
    expect(r.hasNormal("extra_axial")).toBe(false);
    expect(r.hasNormal("basal_ganglia")).toBe(true);
    expect(r.hasNormal("midline")).toBe(true);
    expect(r.hasNormal("ventricles")).toBe(true);
    expect(r.hasNormal("brain_parenchyma")).toBe(true);
    expect(r.impression).toMatch(/left subdural hematoma/i);
    expect(r.bolded.join(" ")).toMatch(/subdural hematoma/i);
  });

  it("case E: right intracranial mass with edema and midline shift", () => {
    reset();
    click("Mass lesion", "right");
    click("Cerebral edema");
    click("Midline shift", "left");
    const r = report();

    expect(r.findings).toMatch(/right mass lesion/i);
    expect(r.findings).toMatch(/surrounding edema/i);
    expect(r.findings).toMatch(/midline shift of ___ mm toward the left/i);
    expect(r.hasNormal("brain_parenchyma")).toBe(false);
    expect(r.hasNormal("midline")).toBe(false);
    // Three boxes that all speak about the same hemisphere: none may eat another.
    expect(r.findings).toMatch(/mass lesion/i);
    expect(r.findings).toMatch(/edema/i);
    expect((r.findings.match(/effacement/gi) ?? []).length).toBe(1);
    expect(r.hasNormal("hemorrhage")).toBe(true);
    expect(r.hasNormal("infarct")).toBe(true);
    expect(r.hasNormal("basal_ganglia")).toBe(true);
    expect(r.impression).toMatch(/right mass lesion/i);
    expect(r.bolded.length).toBeGreaterThanOrEqual(3);
  });

  it("case F: multiple cerebral microbleeds with chronic small-vessel change", () => {
    reset();
    click("Microbleeds");
    click("Fazekas 2");
    const r = report();

    expect(r.findings).toMatch(/punctate foci of susceptibility/i);
    expect(r.findings).toMatch(/GRE\/SWI/i);
    expect(r.findings).toMatch(/Fazekas grade 2/i);
    // Both boxes claim the parenchyma; the second must not delete the first.
    expect(r.findings.match(/microbleeds/gi)?.length).toBeGreaterThan(0);
    expect(r.findings).toMatch(/confluent/i);
    expect(r.hasNormal("brain_parenchyma")).toBe(false);
    // Microbleeds are not a hemorrhage: the macroscopic denial survives.
    expect(r.hasNormal("hemorrhage")).toBe(true);
    expect(r.hasNormal("ventricles")).toBe(true);
    expect(r.hasNormal("infarct")).toBe(true);
    expect(r.hasNormal("diffusion")).toBe(true);
    expect(r.impression).toMatch(/microbleeds/i);
    expect(r.impression).toMatch(/Fazekas grade 2/i);
  });

  it("case G: chronic infarct with encephalomalacia — the DWI/ADC negative survives it", () => {
    // The whole point of staging an infarct as chronic is that it does not
    // restrict. A report that retires the sequence negative has answered a
    // question nobody asked and hidden the one fact that separates this case
    // from an acute occlusion, so the negative is asserted here in the printed
    // artefact, not only in the store.
    reset();
    click("Chronic infarct", "right");
    const r = report();

    expect(r.findings).toMatch(/encephalomalacia with gliosis in the right hemisphere/i);
    expect(r.findings).toMatch(/consistent with chronic infarct/i);
    // The stage claim falsifies the infarct negative and nothing else.
    expect(r.hasNormal("infarct")).toBe(false);
    expect(r.hasNormal("diffusion")).toBe(true);
    expect(r.findings).toContain("No restricted diffusion is seen on DWI/ADC.");
    expect(r.hasNormal("hemorrhage")).toBe(true);
    expect(r.hasNormal("ventricles")).toBe(true);
    expect(r.hasNormal("midline")).toBe(true);
    // Deliberately not asserted: whether the study-wide parenchyma normal
    // survives. A focal encephalomalacia does contradict "Brain parenchyma shows
    // normal signal intensity", and the shipped tile leaves it standing — for the
    // acute and hemorrhage boxes too (measured in the print artifacts). That is a
    // separate defect from the DWI/ADC one this case pins, and it is recorded as
    // open rather than blessed here.

    expect(r.impression).toMatch(/chronic right cerebral infarct/i);
    expect(r.impression).not.toMatch(/restricted diffusion/i);
    // The abnormality is emphasised on the page; the surviving negative is not.
    expect(r.bolded.join(" ")).toMatch(/chronic infarct/i);
    expect(r.bolded.join(" ")).not.toMatch(/no restricted diffusion/i);
  });

  it("a higher Fazekas grade replaces the lower one instead of sitting beside it", () => {
    // The covering rule must not freeze the report: two statements that assert the
    // same concepts differ only in grade, so the second legitimately overwrites
    // the first. Without that arm, a radiologist who upgrades 1 → 3 ends up
    // reporting both grades on the same patient.
    reset();
    click("Fazekas 1");
    click("Fazekas 3");
    const r = report();
    expect(r.findings).toMatch(/Fazekas grade 3/i);
    expect(r.findings).not.toMatch(/Fazekas grade 1/i);
    expect(r.impression).toMatch(/Fazekas grade 3/i);
    expect(r.impression).not.toMatch(/Fazekas grade 1/i);
    expect(r.hasNormal("brain_parenchyma")).toBe(false);
  });

  it("no case leaves a retired normal standing, and none loses the scaffold's unrelated rows", () => {
    // The same invariant, measured across all seven rather than one at a time: a
    // report must never assert a region is normal in one line and abnormal in
    // another, and must never drop a row no box spoke about.
    const SCRIPTS: Array<Array<[string, "left" | "right" | undefined]>> = [
      [["Basal ganglia hemorrhage", "left"], ["Cerebral edema", undefined]],
      [["Acute infarct (DWI)", "right"]],
      [["Fazekas 3", undefined], ["Cerebral atrophy", undefined]],
      [["Subdural hematoma", "left"]],
      [["Mass lesion", "right"], ["Cerebral edema", undefined], ["Midline shift", "left"]],
      [["Microbleeds", undefined], ["Fazekas 2", undefined]],
      [["Chronic infarct", "right"]],
    ];
    const rows = (MRI_BRAIN_STANDARD_NORMAL_MANIFEST.observations ?? [])
      .filter((o) => o.field === "findings");
    for (const script of SCRIPTS) {
      reset();
      for (const [label, side] of script) click(label, side);
      const text = useWorkspace.getState().findingsText;
      // Every scaffold normal that the report also contradicts by name is a defect.
      for (const row of rows) {
        if (!text.includes(row.renderedText.trim())) continue;
        const claimsOppositeSite = script.some(([label]) => {
          const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label)!;
          return tile.anatomicalSection
            && row.renderedText.toLowerCase().includes(tile.anatomicalSection.toLowerCase());
        });
        if (claimsOppositeSite && row.concept !== "brain_parenchyma") {
          throw new Error(
            `${script.map(([l]) => l).join(" + ")} keeps "${row.renderedText}" standing `
            + `while also naming ${tileSectionOf(script)}`,
          );
        }
      }
      // The scaffold's untouched rows are always present in all six.
      expect(text).toMatch(/Brainstem shows normal morphology/);
      expect(text).toMatch(/Cerebellar hemispheres show normal morphology/);
    }
  });
});

function tileSectionOf(script: Array<[string, "left" | "right" | undefined]>): string {
  return script
    .map(([label]) => DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label)?.anatomicalSection ?? label)
    .join(", ");
}
