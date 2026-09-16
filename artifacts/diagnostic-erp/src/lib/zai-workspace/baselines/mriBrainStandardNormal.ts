/**
 * MRI Brain — Standard Normal owned baseline.
 *
 * Canon concepts used: ventricles, infarct, hemorrhage.
 * Slug fallbacks (not yet in CLINICAL_CONTENT_PACKS): brain_parenchyma, diffusion,
 * extra_axial, midline, basal_ganglia, vascular_flow_voids, brainstem, cerebellum,
 * posterior_fossa.
 *
 * Deliberately unowned: none in findings/impression beyond observation sentences
 * (no decorative headers).
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";

export const MRI_BRAIN_STANDARD_NORMAL_NAME = "MRI Brain — Standard Normal";

const BRAIN_GENERAL_NORMALS: BaselineManifestObservation[] = [
  {
    id: "brain-parenchyma",
    field: "findings",
    concept: "brain_parenchyma",
    conflictGroup: "brain_parenchyma",
    anatomicalSection: "brain parenchyma",
    renderedText: "Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.",
  },
  {
    id: "infarct",
    field: "findings",
    concept: "infarct",
    conflictGroup: "infarct",
    anatomicalSection: "parenchyma",
    renderedText: "No acute infarct is seen.",
  },
  {
    id: "hemorrhage",
    field: "findings",
    concept: "hemorrhage",
    conflictGroup: "hemorrhage",
    anatomicalSection: "parenchyma",
    renderedText: "No intracranial hemorrhage is seen.",
  },
  {
    id: "diffusion",
    field: "findings",
    concept: "diffusion",
    conflictGroup: "diffusion",
    anatomicalSection: "diffusion",
    renderedText: "No restricted diffusion is seen on DWI/ADC.",
  },
  {
    id: "ventricles",
    field: "findings",
    concept: "ventricles",
    conflictGroup: "ventricles",
    anatomicalSection: "ventricles",
    renderedText: "Ventricular system and cisternal spaces are normal in size and configuration.",
  },
  {
    id: "extra-axial",
    field: "findings",
    concept: "extra_axial",
    conflictGroup: "extra_axial",
    anatomicalSection: "extra-axial spaces",
    renderedText: "No extra-axial collection is identified.",
  },
  {
    id: "midline",
    field: "findings",
    concept: "midline",
    conflictGroup: "midline",
    anatomicalSection: "midline",
    renderedText: "No midline shift is seen.",
  },
  {
    id: "basal-ganglia",
    field: "findings",
    concept: "basal_ganglia",
    conflictGroup: "basal_ganglia",
    anatomicalSection: "basal ganglia",
    renderedText: "Basal ganglia and thalami are normal in signal intensity.",
  },
  {
    id: "vascular-flow-voids",
    field: "findings",
    concept: "vascular_flow_voids",
    conflictGroup: "vascular_flow_voids",
    anatomicalSection: "intracranial vessels",
    renderedText: "Flow voids in major intracranial vessels are preserved.",
  },
  {
    id: "brainstem",
    field: "findings",
    concept: "brainstem",
    conflictGroup: "brainstem",
    anatomicalSection: "brainstem",
    renderedText: "Brainstem shows normal morphology and signal intensity.",
  },
  {
    id: "cerebellum",
    field: "findings",
    concept: "cerebellum",
    conflictGroup: "cerebellum",
    anatomicalSection: "cerebellum",
    renderedText: "Cerebellar hemispheres show normal morphology and signal intensity.",
  },
  {
    id: "posterior-fossa",
    field: "findings",
    concept: "posterior_fossa",
    conflictGroup: "posterior_fossa",
    anatomicalSection: "posterior fossa",
    renderedText: "Posterior fossa structures are unremarkable.",
  },
];

export const MRI_BRAIN_STANDARD_NORMAL_FINDINGS = BRAIN_GENERAL_NORMALS.map((o) => o.renderedText).join("\n");

export const MRI_BRAIN_STANDARD_NORMAL_IMPRESSION =
  "Normal MRI of the brain. No acute intracranial abnormality.";

export const MRI_BRAIN_STANDARD_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-brain-standard-normal-r1",
  observations: [
    ...BRAIN_GENERAL_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_BRAIN_STANDARD_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_BRAIN_STANDARD_NORMAL_META = {
  name: MRI_BRAIN_STANDARD_NORMAL_NAME,
  bodyPart: "Brain",
  modality: "MR" as const,
  clinicalHistory: "MRI brain requested. Correlate with presenting symptoms.",
  technique:
    "MRI brain on 3T. Multiplanar T1W, T2W, FLAIR, DWI, ADC and GRE/SWI sequences were obtained.",
  recommendation: "Clinical correlation.",
  reportTitle: "MRI BRAIN PLAIN",
};
