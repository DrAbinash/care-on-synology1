/**
 * Release-blocking clinical contract: the normal baseline CARE picks automatically must own its
 * anatomy, or the report prints normals that the radiologist's own selected abnormality falsifies.
 *
 * Measured in the real browser (three runs, `tmp/mribrain/result-v3.json`): an MRI Brain study
 * auto-opens on the clinic's "MRI Brain Plain" Templates row — eight prose sentences with no
 * baselineManifest — so selecting the Fazekas 1 tile left BOTH of these printed underneath the
 * lesion sentence:
 *   "No focal intraparenchymal signal abnormality."
 *   "No periventricular white matter signal change."
 * and the Impression read "Mild chronic small vessel ischemic disease (Fazekas grade 1). No
 * significant abnormality detected." Applying the curated "MRI Brain — Standard Normal" instead
 * retired exactly one normal and produced a clean one-line Impression.
 *
 * Root cause is two lines of `resolveNormalBootstrapFormat`: any Templates row outranks the
 * curated copy, and the curated-baseline narrowing that follows knows only about formats that
 * carry a manifest — so an un-owned row wins by existing.
 *
 * N1..N8 are the contract. The two things this change must NOT do are also pinned: silently
 * deleting the clinic's own wording (N3/N4) and taking Quick Normal away from examinations that
 * never had a curated baseline (N5).
 */
import { describe, expect, it } from "vitest";
import { mergeStructuredNormalFormats, structuredTemplateToNormalFormat, type StructuredNormalRow } from "./structuredNormalFormats";
import { resolveNormalBootstrapFormat } from "./normalBootstrap";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { MRI_BRAIN_STANDARD_NORMAL_MANIFEST, MRI_BRAIN_STANDARD_NORMAL_NAME } from "./baselines/mriBrainStandardNormal";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { quickSelectTilePatch } from "./quickSelectTileFixture";
import { useWorkspace } from "./store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { baselineManifestForFormat } from "./fullReportBaseline";

const ctx = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
});

/** The live clinic row, copied from what this box's API actually serves. */
const LEGACY_BRAIN_FINDINGS = [
  "Brain parenchyma is normal in size, signal and morphology.",
  "No focal intraparenchymal signal abnormality.",
  "Ventricles are normal in caliber.",
  "No periventricular white matter signal change.",
  "No restricted diffusion.",
  "Posterior fossa structures are normal.",
  "Extra-axial spaces are normal.",
  "No midline shift.",
].join(" ");

function brainRow(over: Partial<StructuredNormalRow> = {}): StructuredNormalRow {
  return {
    id: 1,
    templateName: "MRI Brain Plain",
    modality: "MRI",
    bodyPart: "BRAIN",
    studyType: "PLAIN",
    sectionsJson: JSON.stringify({
      technique: "MRI brain on 3T. Multiplanar T1W, T2W, FLAIR, DWI, ADC and GRE/SWI sequences were obtained.",
      recommendation: "Clinical correlation.",
      findingsItems: [],
    }),
    defaultFindings: LEGACY_BRAIN_FINDINGS,
    defaultImpression: "Normal MRI Brain study. No significant intracranial abnormality detected.",
    isActive: true,
    isDefault: true,
    ...over,
  };
}

const library = (rows: StructuredNormalRow[]) => mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, rows);

/**
 * The shipped per-tile retirement contract (`brainQuickSelectCatalogue.test.ts`), for the five
 * interactions this brief names. Atrophy retires nothing on its own: a brain can atrophy with
 * normal signal, so a volume claim falsifies no signal normal — the table carries that as an
 * empty `mustRetire` rather than a guess, because this file's subject is which BASELINE gets
 * auto-applied, not what the approved catalogue says a tile contradicts.
 */
const TILES: Record<string, { mustRetire: string[]; mustKeep: string[] }> = {
  "Fazekas 1": { mustRetire: ["brain_parenchyma"], mustKeep: ["ventricles", "diffusion", "hemorrhage", "midline", "basal_ganglia"] },
  "Cerebral atrophy": { mustRetire: [], mustKeep: ["brain_parenchyma", "ventricles", "hemorrhage", "midline", "diffusion"] },
  "Subarachnoid hemorrhage": { mustRetire: ["hemorrhage"], mustKeep: ["brain_parenchyma", "ventricles", "diffusion", "midline"] },
  Hydrocephalus: { mustRetire: ["ventricles"], mustKeep: ["brain_parenchyma", "hemorrhage", "midline", "diffusion"] },
  "Lacunar infarcts": { mustRetire: ["brain_parenchyma"], mustKeep: ["ventricles", "hemorrhage", "midline"] },
};

function reset(formats = library([brainRow()])) {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [], patchRedoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false, appliedFormatReportTitle: null, appliedFormatName: null,
    startingCanvasBaseline: null, canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: ctx, reportFormats: formats, selectedFormatIds: [],
    isFinalized: false, isDirty: false,
  });
  useWorkspace.getState().generateProfessionalReport(ctx);
}

function click(label: string) {
  const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!tile) throw new Error(`${label} is not in the catalogue`);
  const outcome = useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(tile, "findings"));
  if (outcome !== "applied") throw new Error(`${label} was refused: ${outcome}`);
}

const normalRow = (concept: string) => {
  const entry = MRI_BRAIN_STANDARD_NORMAL_MANIFEST.observations.find((o) => o.field === "findings" && o.concept === concept);
  if (!entry) throw new Error(`${concept} is not an owned MRI Brain normal`);
  return entry.renderedText.trim();
};

describe("N1 — automatic initialization requires anatomical ownership", () => {
  it("an un-owned Templates row cannot outrank the curated normal for the same exam", () => {
    const decision = resolveNormalBootstrapFormat({ ctx, formats: library([brainRow()]) });
    expect(decision?.status).toBe("apply");
    if (decision?.status !== "apply") return;
    expect(decision.format.baselineManifest?.kind).toBe("care.full_report_baseline.v1");
    expect(decision.format.name).toBe(MRI_BRAIN_STANDARD_NORMAL_NAME);
  });

  it("the same exam resolves identically whichever order the library arrives in", () => {
    const rows = [brainRow(), brainRow({ id: 2, templateName: "MRI Brain Plain Copy" })];
    const formats = library(rows);
    const forward = resolveNormalBootstrapFormat({ ctx, formats });
    const backward = resolveNormalBootstrapFormat({ ctx, formats: [...formats].reverse() });
    const name = (d: typeof forward) => (d?.status === "apply" ? d.format.name : d?.status);
    expect(name(forward)).toBe(MRI_BRAIN_STANDARD_NORMAL_NAME);
    expect(name(backward)).toBe(name(forward));
  });

  it("a Templates row that carries the curated baseline's name keeps its own wording", () => {
    const owned = brainRow({
      templateName: MRI_BRAIN_STANDARD_NORMAL_NAME,
      defaultFindings: MRI_BRAIN_STANDARD_NORMAL_MANIFEST.observations
        .filter((o) => o.field === "findings")
        .map((o) => o.renderedText)
        .join("\n"),
      defaultImpression: MRI_BRAIN_STANDARD_NORMAL_MANIFEST.observations
        .find((o) => o.field === "impression")!
        .renderedText,
    });
    const format = structuredTemplateToNormalFormat(owned, "2026-10-16T00:00:00.000Z")!;
    expect(baselineManifestForFormat(format)?.revision).toBe("mri-brain-standard-normal-r1");
    const decision = resolveNormalBootstrapFormat({ ctx, formats: library([owned]) });
    expect(decision?.status).toBe("apply");
    if (decision?.status !== "apply") return;
    expect(decision.format.structuredTemplateId).toBe(1);
  });

  it("a Templates row whose wording no longer matches the baseline it claims does not own it", () => {
    // Same curated name, edited sentences: ownership must not travel with the label alone,
    // or an edited row would claim suppression it cannot deliver.
    const edited = brainRow({
      templateName: MRI_BRAIN_STANDARD_NORMAL_NAME,
      defaultFindings: "Brain parenchyma is normal. The ventricles are normal.",
    });
    const format = structuredTemplateToNormalFormat(edited, "2026-10-16T00:00:00.000Z")!;
    expect(format.baselineManifest).toBeUndefined();
    const decision = resolveNormalBootstrapFormat({ ctx, formats: library([edited]) });
    expect(decision?.status).toBe("apply");
    if (decision?.status !== "apply") return;
    expect(decision.format.structuredTemplateId ?? null).toBeNull();
  });
});

describe("N2 — the clinic's templates are preserved, not rewritten", () => {
  it("the un-owned row stays in the library with its wording intact", () => {
    const rows = [brainRow()];
    const formats = library(rows);
    const row = formats.find((f) => f.structuredTemplateId === 1);
    expect(row?.findings).toBe(LEGACY_BRAIN_FINDINGS);
    expect(row?.impression).toBe("Normal MRI Brain study. No significant intracranial abnormality detected.");
    expect(formats).toHaveLength(DEFAULT_REPORT_FORMATS.length + 1);
  });

  it("explicit selection of that row still prints exactly what the clinic wrote", () => {
    reset(library([brainRow()]));
    useWorkspace.getState().applyFormatById("structured:1");
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("No periventricular white matter signal change.");
    expect(s.findingsText).not.toContain("Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.");
  });

  it("an examination with no curated baseline at all keeps the normal it has", () => {
    const chestCtx = buildReportingStudyContext({
      modality: "XR", studyDescription: "X-Ray Chest", regions: ["Chest"], source: "auto",
    });
    const row: StructuredNormalRow = {
      id: 9, templateName: "Chest PA", modality: "X-RAY", bodyPart: "CHEST", studyType: "PLAIN",
      sectionsJson: JSON.stringify({ technique: "PA erect film.", recommendation: "", findingsItems: [] }),
      defaultFindings: "Lungs are clear. No consolidation. Heart size is normal.",
      defaultImpression: "Normal chest radiograph.",
      isActive: true, isDefault: true,
    };
    const formats = mergeStructuredNormalFormats(DEFAULT_REPORT_FORMATS, [row]);
    const decision = resolveNormalBootstrapFormat({ ctx: chestCtx, formats });
    expect(formats.filter((f) => f.structuredTemplateId == null && f.bodyPart === "Chest").some((f) => f.baselineManifest))
      .toBe(false); // no curated baseline exists for this exam, so nothing is being displaced
    expect(decision?.status).toBe("apply");
    if (decision?.status !== "apply") return;
    expect(decision.format.findings).toContain("Heart size is normal.");
  });
});

describe("N3 — the printed consequence, on the report the radiologist actually builds", () => {
  for (const [label, expectation] of Object.entries(TILES)) {
    it(`${label}: its abnormality never shares the page with the normal it falsifies`, () => {
      reset();
      click(label);
      const s = useWorkspace.getState();
      const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label)!;
      expect(s.findingsText).toContain(tile.sentence.split(" — ")[0].slice(0, 40));
      for (const concept of expectation.mustRetire) {
        expect(s.findingsText, `${label} must retire ${concept}`).not.toContain(normalRow(concept));
      }
      for (const concept of expectation.mustKeep) {
        expect(s.findingsText, `${label} must not retire ${concept}`).toContain(normalRow(concept));
      }
    });
  }

  it("an abnormal finding never shares the Impression with a normal conclusion", () => {
    reset();
    click("Fazekas 1");
    click("Hydrocephalus");
    const impression = useWorkspace.getState().impressionText;
    expect(impression).toMatch(/Fazekas grade 1/i);
    expect(impression).toMatch(/hydrocephalus/i);
    expect(impression).not.toMatch(/no significant abnormality|no acute intracranial abnormality|normal (?:mri|study|for age)/i);
  });

  it("the contradiction this test file exists for cannot be reproduced on the auto-selected baseline", () => {
    reset();
    click("Fazekas 1");
    const findings = useWorkspace.getState().findingsText;
    expect(findings).not.toContain("No periventricular white matter signal change.");
    expect(findings).not.toContain("No focal intraparenchymal signal abnormality.");
  });
});
