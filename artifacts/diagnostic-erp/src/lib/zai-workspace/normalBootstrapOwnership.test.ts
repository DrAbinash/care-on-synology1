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
import { baselineManifestForFormat, materializeFormatBaseline } from "./fullReportBaseline";
import { MRI_BRAIN_CONTRAST_NORMAL_NAME } from "./baselines/mriBrainContrastNormal";
import { MRI_BRAIN_EPILEPSY_NORMAL_NAME } from "./baselines/mriBrainEpilepsyNormal";
import { MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_NAME } from "./baselines/mriLsWholeSpineScreeningNormal";
import { MRI_LS_SCREENING_NORMAL_NAME } from "./baselines/mriLsScreeningNormal";
import { MRI_WHOLE_SPINE_SCREENING_NORMAL_NAME } from "./baselines/mriWholeSpineScreeningNormal";

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

function reset(formats = library([brainRow()]), studyCtx = ctx) {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [], patchRedoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false, appliedFormatReportTitle: null, appliedFormatName: null,
    startingCanvasBaseline: null, canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: studyCtx, reportFormats: formats, selectedFormatIds: [],
    isFinalized: false, isDirty: false,
  });
  useWorkspace.getState().generateProfessionalReport(studyCtx);
}

function click(label: string, params: Record<string, string> = {}) {
  const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!tile) throw new Error(`${label} is not in the catalogue`);
  const outcome = useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(tile, "findings", params));
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

/**
 * N9 — the three examination identities the MRI coverage audit measured as opening a
 * complete normal that owns none of its sentences ("unowned picks: 3", measured on this
 * branch's base): the contrast Brain normal, the epilepsy-protocol Brain normal, and the
 * combined LS Spine + Whole Spine Screening normal.
 *
 * Same failure as the header's "MRI Brain Plain", same mechanism: the row prints prose,
 * `materializeFormatBaseline` returns zero rows, and the retirement engine — which
 * suppresses a normal by the ledger row that speaks for it — has nothing to attribute the
 * sentences to. So a click appends its abnormality beside the normal it falsifies.
 *
 * Three things are pinned, all of them transcripts of measured behaviour:
 *   1. the study auto-opens on a manifest-bearing format whose baseline materializes one
 *      row per observation (zero rows was the defect);
 *   2. the Findings it prints are the same sentences in the same order the row shipped
 *      with — ownership adds no clinical claim and drops none;
 *   3. each click retires the normals it falsifies and leaves the ones it does not.
 *
 * Two contradicted sentences the engine cannot reach are named below and asserted as
 * STILL PRINTING. That is a characterization of the residual, not a ruling that it is
 * right: closing them needs a vocabulary change to the approved Quick Select catalogue
 * (a Hippocampal sclerosis box whose concept never names "hippocampi", a Glioma recurrence
 * box whose concept never names enhancement), which is not this change's to make.
 */
describe("N9 — the three normals the audit measured as un-owned", () => {
  type TileCase = { label: string; params?: Record<string, string>; retire: string[]; keep: string[] };
  type Identity = {
    name: string;
    ctx: ReturnType<typeof buildReportingStudyContext>;
    /** The sentences this row printed at the base commit, in printed order. */
    printed: string[];
    tiles: TileCase[];
    /** Contradicted normals the current vocabulary cannot retire — pinned, named above. */
    residual: { via: string; params?: Record<string, string>; sentences: string[] }[];
  };

  const CONTRAST_PRINTED = [
    "Cerebral hemispheres show normal morphology and signal characteristics.",
    "Gray-white matter differentiation is preserved.",
    "Parenchymal signal: no focal or diffuse areas of altered signal intensity.",
    "Deep gray matter structures: basal ganglia, thalami and corpus callosum appear normal in signal and structure.",
    "Midline structures: septum pellucidum and falx cerebri are in midline.",
    "No evidence of mass effect or midline shift.",
    "Ventricular system and CSF spaces: lateral, third and fourth ventricles normal in size and configuration.",
    "Supratentorial sulci and cisterns within normal limits.",
    "Posterior fossa: brainstem and cerebellar hemispheres show normal morphology and signal intensity.",
    "Fourth ventricle midline and normal in size.",
    "Internal auditory canals and CP angles: bilateral internal acoustic meatus and cerebellopontine angles normal.",
    "No intra- or extra-axial space-occupying lesions identified.",
    "No abnormal enhancement on post-contrast study.",
    "Venous sinuses: major intracranial dural venous sinuses demonstrate normal flow voids and outline.",
    "Sellar and parasellar region: sella turcica, suprasellar and parasellar structures unremarkable.",
  ];

  const EPILEPSY_PRINTED = [
    "Cerebral hemispheres: normal morphology, signal intensity and gray-white matter differentiation.",
    "Deep gray structures: basal ganglia, thalami and corpus callosum show normal signal.",
    "Mesial temporal structures: hippocampi are symmetrical with normal signal.",
    "Mammillary bodies, fornices, amygdala and cingulate gyri are unremarkable.",
    "No evidence of scarring or atrophy in bilateral temporal lobes.",
    "Diffusion imaging (DWI): no restricted diffusion noted.",
    "Susceptibility imaging (SWI): no abnormal magnetic susceptibility.",
    "Ventricular system and midline structures: lateral and third ventricles are normal in size and shape.",
    "Supratentorial sulci and cisterns are normal.",
    "Septum pellucidum and falx cerebri are midline.",
    "No mass effect or midline shift.",
    "Posterior fossa: brainstem and cerebellar hemispheres are normal.",
    "Fourth ventricle is midline and normal in size.",
    "Vascular structures: major intracranial dural venous sinuses show normal outline and flow voids.",
    "Sellar and parasellar region: sella, suprasellar and parasellar structures are normal.",
  ];

  /** The three headed sections are how the clinic reads a screening report, so they print
   *  exactly as the row wrote them — headings included, which is why this list has lines in
   *  it that are not sentences. */
  const LS_WHOLE_SPINE_PRINTED = [
    "LUMBOSACRAL SPINE",
    "Normal lumbar lordosis is maintained.",
    "Lumbar vertebrae show normal alignment and marrow signal.",
    "No spondylolisthesis.",
    "Disc spaces are maintained; no significant disc bulge or herniation.",
    "No spinal canal stenosis.",
    "Neural foramina are patent.",
    "Conus medullaris terminates at L1 with normal appearance.",
    "Cauda equina nerve roots are normally distributed.",
    "Facet joints and ligamentum flavum are normal.",
    "Paraspinal soft tissues are unremarkable.",
    "CERVICAL SPINE SCREENING",
    "Cervical vertebrae show normal alignment and marrow signal.",
    "Disc spaces are maintained.",
    "No significant canal stenosis or cord signal change.",
    "DORSAL SPINE SCREENING",
    "Dorsal vertebral bodies and discs appear normal.",
    "No evidence of disc herniation, canal stenosis or cord signal abnormality.",
  ];

  const identities: Identity[] = [
    {
      name: MRI_BRAIN_CONTRAST_NORMAL_NAME,
      ctx: buildReportingStudyContext({
        modality: "MR", studyDescription: "MRI BRAIN WITH CONTRAST", regions: ["Brain"], source: "auto",
      }),
      printed: CONTRAST_PRINTED,
      tiles: [
        {
          label: "Fazekas 1",
          retire: ["Gray-white matter differentiation is preserved."],
          keep: [
            "No abnormal enhancement on post-contrast study.",
            "Sellar and parasellar region: sella turcica, suprasellar and parasellar structures unremarkable.",
          ],
        },
        {
          label: "Hydrocephalus",
          retire: [
            "Ventricular system and CSF spaces: lateral, third and fourth ventricles normal in size and configuration.",
            "Supratentorial sulci and cisterns within normal limits.",
            "Fourth ventricle midline and normal in size.",
          ],
          keep: [
            "Cerebral hemispheres show normal morphology and signal characteristics.",
            "Posterior fossa: brainstem and cerebellar hemispheres show normal morphology and signal intensity.",
          ],
        },
        {
          label: "Midline shift", params: { side: "right" },
          retire: [
            "Midline structures: septum pellucidum and falx cerebri are in midline.",
            "No evidence of mass effect or midline shift.",
            "Fourth ventricle midline and normal in size.",
          ],
          keep: [
            "Venous sinuses: major intracranial dural venous sinuses demonstrate normal flow voids and outline.",
            "No abnormal enhancement on post-contrast study.",
          ],
        },
        {
          label: "Acute hemorrhage", params: { side: "right" },
          retire: [
            "Deep gray matter structures: basal ganglia, thalami and corpus callosum appear normal in signal and structure.",
            "No evidence of mass effect or midline shift.",
          ],
          keep: [
            "Sellar and parasellar region: sella turcica, suprasellar and parasellar structures unremarkable.",
            "Internal auditory canals and CP angles: bilateral internal acoustic meatus and cerebellopontine angles normal.",
          ],
        },
      ],
      residual: [{ via: "Glioma recurrence", sentences: ["No abnormal enhancement on post-contrast study."] }],
    },
    {
      name: MRI_BRAIN_EPILEPSY_NORMAL_NAME,
      ctx: buildReportingStudyContext({
        modality: "MR", studyDescription: "MRI BRAIN EPILEPSY PROTOCOL", regions: ["Brain"], source: "auto",
      }),
      printed: EPILEPSY_PRINTED,
      tiles: [
        {
          label: "Fazekas 1",
          retire: ["Cerebral hemispheres: normal morphology, signal intensity and gray-white matter differentiation."],
          keep: [
            "Diffusion imaging (DWI): no restricted diffusion noted.",
            "Sellar and parasellar region: sella, suprasellar and parasellar structures are normal.",
          ],
        },
        {
          label: "Lacunar infarcts",
          retire: ["Cerebral hemispheres: normal morphology, signal intensity and gray-white matter differentiation."],
          keep: [
            "Susceptibility imaging (SWI): no abnormal magnetic susceptibility.",
            "Vascular structures: major intracranial dural venous sinuses show normal outline and flow voids.",
          ],
        },
        {
          // The box this identity exists for: a hippocampus that is sclerotic and swollen
          // falsifies the study-wide "normal morphology, signal intensity" claim, and the
          // engine takes it. The two mesial-temporal sentences are the residual named above.
          label: "Hippocampal sclerosis", params: { side: "right" },
          retire: ["Cerebral hemispheres: normal morphology, signal intensity and gray-white matter differentiation."],
          keep: ["Sellar and parasellar region: sella, suprasellar and parasellar structures are normal."],
        },
      ],
      residual: [{
        via: "Hippocampal sclerosis",
        params: { side: "right" },
        sentences: [
          "Mesial temporal structures: hippocampi are symmetrical with normal signal.",
          "No evidence of scarring or atrophy in bilateral temporal lobes.",
        ],
      }],
    },
    {
      name: MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_NAME,
      ctx: buildReportingStudyContext({
        modality: "MR", studyDescription: "MRI LS SPINE WITH WHOLE SPINE SCREENING",
        regions: ["LS Spine"], source: "auto",
      }),
      printed: LS_WHOLE_SPINE_PRINTED,
      tiles: [
        {
          label: "Grade 1 spondylolisthesis L4-L5",
          retire: ["No spondylolisthesis."],
          keep: [
            "No spinal canal stenosis.",
            "Neural foramina are patent.",
            "Conus medullaris terminates at L1 with normal appearance.",
            "Cervical vertebrae show normal alignment and marrow signal.",
            "Dorsal vertebral bodies and discs appear normal.",
          ],
        },
        {
          label: "Disc herniation L4-L5",
          retire: ["Disc spaces are maintained; no significant disc bulge or herniation."],
          keep: [
            "No spinal canal stenosis.",
            "Facet joints and ligamentum flavum are normal.",
            // The cervical screening section keeps its own disc claim: a lumbar level's
            // herniation is not the cervical discs' sentence. This is the line that would
            // move if a lumbar tile ever reached across the screening section.
            "Disc spaces are maintained.",
            "CERVICAL SPINE SCREENING",
            "DORSAL SPINE SCREENING",
          ],
        },
      ],
      residual: [],
    },
  ];

  const printedSentences = (text: string) =>
    text.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  for (const id of identities) {
    const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === id.name);
    if (!format) throw new Error(`${id.name} is not in the shipped library`);

    it(`${id.name}: the study opens on the owned baseline and it materializes rows`, () => {
      const decision = resolveNormalBootstrapFormat({ ctx: id.ctx, formats: DEFAULT_REPORT_FORMATS });
      expect(decision?.status, id.name).toBe("apply");
      if (decision?.status !== "apply") return;
      expect(decision.format.name).toBe(id.name);
      expect(decision.format.baselineManifest?.kind).toBe("care.full_report_baseline.v1");
      const rows = materializeFormatBaseline(decision.format, decision.format.bodyPart ?? id.ctx.region);
      // Zero rows was the defect: prose on the page the ledger could not account for.
      expect(rows.length, id.name).toBe(decision.format.baselineManifest!.observations.length);
      expect(rows.length, id.name).toBeGreaterThan(0);
    });

    it(`${id.name}: owning the sentences does not rewrite them`, () => {
      reset(DEFAULT_REPORT_FORMATS, id.ctx);
      expect(printedSentences(useWorkspace.getState().findingsText), id.name).toEqual(id.printed);
    });

    for (const tile of id.tiles) {
      it(`${id.name} + ${tile.label}: retires the normals it falsifies, keeps the rest`, () => {
        reset(DEFAULT_REPORT_FORMATS, id.ctx);
        click(tile.label, tile.params ?? {});
        const findings = useWorkspace.getState().findingsText;
        for (const sentence of tile.retire) {
          expect(findings, `${tile.label} must retire ${sentence}`).not.toContain(sentence);
        }
        for (const sentence of tile.keep) {
          expect(findings, `${tile.label} must not retire ${sentence}`).toContain(sentence);
        }
      });
    }

    for (const gap of id.residual) {
      it(`${id.name}: ${gap.via} leaves the normal its vocabulary cannot name — measured residual, not a ruling`, () => {
        reset(DEFAULT_REPORT_FORMATS, id.ctx);
        click(gap.via, gap.params ?? {});
        const findings = useWorkspace.getState().findingsText;
        for (const sentence of gap.sentences) {
          expect(findings, sentence).toContain(sentence);
        }
      });
    }
  }

  it("the combined row does not take the regional normal from a study that screens one spine segment", () => {
    // Widening the LS + Whole Spine normal to an owned baseline is what let it survive the
    // curated-baseline narrowing at all; before this change it was filtered out on the way
    // to a single survivor. A study that names only the lumbosacral spine must still open on
    // the LS screening normal, or the change would have traded a missing scaffold for a
    // report that documents a cervical and a dorsal segment nobody examined — or for no
    // auto-open at all, since two owned screening normals then tie for the same identity.
    const decision = resolveNormalBootstrapFormat({
      ctx: buildReportingStudyContext({
        modality: "MR", studyDescription: "MRI LS SPINE SCREENING", regions: ["LS Spine"], source: "auto",
      }),
      formats: DEFAULT_REPORT_FORMATS,
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status !== "apply") return;
    expect(decision.format.name).toBe(MRI_LS_SCREENING_NORMAL_NAME);
  });

  it("and it is an ordering, never a gate: the study keeps a normal when nothing narrower exists", () => {
    // A centre that authored one combined template looks like this to the resolver: the
    // library holds the combined row and nothing narrower. Refusing it because it documents
    // segments this study did not examine would leave the study with no complete normal at
    // all — no auto-open, and Quick Normal answering that no normal report matches — which
    // is worse than the over-documentation the rule exists to avoid.
    const combinedOnly = DEFAULT_REPORT_FORMATS.filter((f) => f.name === MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_NAME);
    expect(combinedOnly).toHaveLength(1);
    const decision = resolveNormalBootstrapFormat({
      ctx: buildReportingStudyContext({
        modality: "MR", studyDescription: "MRI LS SPINE SCREENING", regions: ["LS Spine"], source: "auto",
      }),
      formats: combinedOnly,
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status !== "apply") return;
    expect(decision.format.name).toBe(MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_NAME);

    // The same answer one step further: a POOL of candidates in which every one of them
    // documents more than the study examined. Both rows are wider than an LS-only scope, so
    // the narrowed list this rule builds is empty, and the empty list is not used.
    const widerThanTheStudy = DEFAULT_REPORT_FORMATS.filter((f) =>
      f.name === MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_NAME || f.name === MRI_WHOLE_SPINE_SCREENING_NORMAL_NAME);
    expect(widerThanTheStudy).toHaveLength(2);
    const wide = resolveNormalBootstrapFormat({
      ctx: buildReportingStudyContext({
        modality: "MR", studyDescription: "MRI LS SPINE SCREENING", regions: ["LS Spine"], source: "auto",
      }),
      formats: widerThanTheStudy,
    });
    expect(wide?.status).toBe("apply");
    if (wide?.status !== "apply") return;
    expect(wide.format.name).toBe(MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_NAME);

    // Named honestly, because a mutation battery asked: writing the guard as a gate
    // (`pool = withinStudyScope`, unconditionally) does not fail either assertion above, and
    // it does not change any answer this clinic's library can produce. Measured across the
    // 60 candidate subsets of spine normals probed against both arms, every pool that reaches
    // this line holds at least one in-scope candidate, because a row documenting segments the
    // study never examined is filtered out by the ceiling rule further up. So this is a
    // fail-safe with no live difference today, asserted as the outcome the clinic depends on
    // rather than as a distinction the code currently makes.
  });
});

