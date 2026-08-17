import { describe, expect, it } from "vitest";
import {
  adaptToV2,
  allNormalFindingsMap,
  findingsMapsEqual,
  v1AllNormalFindingsMap,
} from "./adapter";
import { previewCopiedLevelUpgrade } from "./upgrade";

const MRI_BRAIN_V1 = {
  technique: "MRI Brain was performed on a high-field scanner using standard brain protocol including T1W sagittal, T2W axial, FLAIR axial, DWI with ADC mapping, and T2* / SWI sequences.",
  findingsItems: [
    { label: "Brain Parenchyma", normal: "Normal in size, signal and morphology. No focal signal abnormality." },
    { label: "White Matter", normal: "No abnormal T2/FLAIR hyperintense signal change. No periventricular or subcortical white matter lesions." },
    { label: "Ventricles & CSF Spaces", normal: "Ventricles are normal in size and configuration. Sylvian fissures and sulci are appropriate for age. No hydrocephalus." },
    { label: "Basal Ganglia & Thalami", normal: "Normal in size, signal and morphology bilaterally." },
    { label: "Brainstem", normal: "Normal in size and signal. No focal lesion." },
    { label: "Cerebellum", normal: "Normal in size and signal. No tonsillar herniation." },
    { label: "Extra-Axial Spaces", normal: "No extra-axial collection. No subdural or epidural collection." },
    { label: "Diffusion (DWI/ADC)", normal: "No restricted diffusion to suggest acute infarct." },
    { label: "Vascular Structures", normal: "Flow voids are seen in major intracranial arteries." },
    { label: "Skull & Calvarium", normal: "Intact. No osseous lesion." },
  ],
};

const MRI_LS_SPINE_V1 = {
  technique: "MRI Lumbo-sacral Spine: T1W and T2W sagittal, T2W axial at disc levels.",
  findingsItems: [
    { label: "Alignment & Curvature", normal: "Normal lumbar lordosis maintained. No scoliosis or listhesis." },
    { label: "L1-L2", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent. No spinal canal stenosis." },
    { label: "L2-L3", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent. No spinal canal stenosis." },
    { label: "L3-L4", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent. No spinal canal stenosis." },
    { label: "L4-L5", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent. No spinal canal stenosis." },
    { label: "L5-S1", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent. No spinal canal stenosis." },
    { label: "Vertebral Bodies", normal: "Normal height, signal and morphology throughout. No marrow infiltration or compression fracture." },
    { label: "Facet Joints", normal: "Facet joints are unremarkable at the imaged levels. No significant arthropathy." },
    { label: "Ligamentum Flavum", normal: "No significant ligamentum flavum hypertrophy." },
    { label: "Spinal Canal", normal: "Spinal canal of adequate dimensions at all levels. No significant central stenosis." },
    { label: "Cord / Cauda Equina", normal: "Cord terminates at L1-L2 level. Normal signal. Cauda equina nerve roots appear normal." },
    { label: "Paraspinal Soft Tissues", normal: "Paraspinal soft tissues are unremarkable. No collection or mass." },
  ],
};

describe("v1 → v2 adapter (gate: existing presets keep findingsMap)", () => {
  it("MRI Brain Plain findingsItems survive adapt with identical all-normal findingsMap", () => {
    const expected = v1AllNormalFindingsMap(MRI_BRAIN_V1);
    const adapted = allNormalFindingsMap(adaptToV2(MRI_BRAIN_V1));
    expect(findingsMapsEqual(expected, adapted)).toBe(true);
    expect(Object.keys(adapted)).toEqual(MRI_BRAIN_V1.findingsItems.map((i) => i.label));
  });

  it("MRI LS Spine copied levels survive adapt with identical all-normal findingsMap", () => {
    const expected = v1AllNormalFindingsMap(MRI_LS_SPINE_V1);
    const adapted = allNormalFindingsMap(adaptToV2(MRI_LS_SPINE_V1));
    expect(findingsMapsEqual(expected, adapted)).toBe(true);
    expect(Object.keys(adapted)[1]).toBe("L1-L2");
    expect(Object.keys(adapted)[5]).toBe("L5-S1");
  });

  it("v2 documents pass through unchanged", () => {
    const v2 = adaptToV2(MRI_BRAIN_V1);
    expect(adaptToV2(v2)).toEqual(v2);
  });

  it("opt-in LS Spine repeating-group upgrade is byte-identical for all-normal", () => {
    const preview = previewCopiedLevelUpgrade(MRI_LS_SPINE_V1);
    expect(preview.eligible).toBe(true);
    expect(preview.allNormalIdentical).toBe(true);
    expect(preview.copiedCount).toBe(5);
    expect(preview.itemLabels).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]);
    expect(findingsMapsEqual(
      v1AllNormalFindingsMap(MRI_LS_SPINE_V1),
      allNormalFindingsMap(preview.proposed!),
    )).toBe(true);
  });
});
