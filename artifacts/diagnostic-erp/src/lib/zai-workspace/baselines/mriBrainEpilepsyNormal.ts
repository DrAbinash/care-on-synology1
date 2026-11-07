/**
 * MRI Brain — Epilepsy Protocol (Normal) owned baseline.
 *
 * Shipped without a `baselineManifest`, so an MRI Brain Epilepsy Protocol study
 * opened on a normal that owned none of its own sentences: clicking the
 * Hippocampal sclerosis Quick Select box printed the lesion beside
 * "Mesial temporal structures: hippocampi are symmetrical with normal signal." —
 * a report that says the hippocampus is both normal and sclerotic.
 *
 * Same contract as `mriBrainContrastNormal.ts`: the sentences are the ones this row
 * already printed, joined into FINDINGS, and the manifest fails closed if a sentence
 * stops being part of what prints. The epilepsy paragraph's two mesial-temporal
 * claims are split along the axis the canon already draws — signal/architecture in
 * one slot, volume/atrophy in another — because the Hippocampal sclerosis box
 * asserts both and a single merged slot would retire whichever half it does not name.
 *
 * Canon concepts used: brain_parenchyma, basal_ganglia, hippocampus_signal,
 * hippocampus_volume, diffusion, hemorrhage, ventricles, midline, posterior_fossa,
 * vascular_flow_voids, sellar.
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";

export const MRI_BRAIN_EPILEPSY_NORMAL_NAME = "MRI Brain — Epilepsy Protocol (Normal)";

const EPILEPSY_NORMALS: BaselineManifestObservation[] = [
  {
    id: "cerebral-hemispheres",
    field: "findings",
    concept: "brain_parenchyma",
    conflictGroup: "brain_parenchyma",
    anatomicalSection: "brain parenchyma",
    renderedText:
      "Cerebral hemispheres: normal morphology, signal intensity and gray-white matter differentiation.",
  },
  {
    id: "deep-gray-matter",
    field: "findings",
    concept: "basal_ganglia",
    conflictGroup: "basal_ganglia",
    anatomicalSection: "basal ganglia",
    renderedText: "Deep gray structures: basal ganglia, thalami and corpus callosum show normal signal.",
  },
  {
    id: "hippocampal-signal",
    field: "findings",
    concept: "hippocampus_signal",
    conflictGroup: "hippocampus_signal",
    anatomicalSection: "mesial temporal structures",
    renderedText:
      "Mesial temporal structures: hippocampi are symmetrical with normal signal. Mammillary bodies, fornices, amygdala and cingulate gyri are unremarkable.",
  },
  {
    id: "hippocampal-volume",
    field: "findings",
    concept: "hippocampus_volume",
    conflictGroup: "hippocampus_volume",
    anatomicalSection: "mesial temporal structures",
    renderedText: "No evidence of scarring or atrophy in bilateral temporal lobes.",
  },
  {
    id: "diffusion",
    field: "findings",
    concept: "diffusion",
    conflictGroup: "diffusion",
    anatomicalSection: "diffusion",
    renderedText: "Diffusion imaging (DWI): no restricted diffusion noted.",
  },
  {
    id: "susceptibility",
    field: "findings",
    concept: "hemorrhage",
    conflictGroup: "hemorrhage",
    anatomicalSection: "parenchyma",
    renderedText: "Susceptibility imaging (SWI): no abnormal magnetic susceptibility.",
  },
  {
    id: "ventricles",
    field: "findings",
    concept: "ventricles",
    conflictGroup: "ventricles",
    anatomicalSection: "ventricles",
    renderedText:
      "Ventricular system and midline structures: lateral and third ventricles are normal in size and shape. Supratentorial sulci and cisterns are normal.",
  },
  {
    id: "midline",
    field: "findings",
    concept: "midline",
    conflictGroup: "midline",
    anatomicalSection: "midline",
    renderedText: "Septum pellucidum and falx cerebri are midline. No mass effect or midline shift.",
  },
  {
    id: "posterior-fossa",
    field: "findings",
    concept: "posterior_fossa",
    conflictGroup: "posterior_fossa",
    anatomicalSection: "posterior fossa",
    renderedText:
      "Posterior fossa: brainstem and cerebellar hemispheres are normal. Fourth ventricle is midline and normal in size.",
  },
  {
    id: "venous-sinuses",
    field: "findings",
    concept: "vascular_flow_voids",
    conflictGroup: "vascular_flow_voids",
    anatomicalSection: "intracranial vessels",
    renderedText: "Vascular structures: major intracranial dural venous sinuses show normal outline and flow voids.",
  },
  {
    id: "sellar",
    field: "findings",
    concept: "sellar",
    conflictGroup: "sellar",
    anatomicalSection: "sellar region",
    renderedText: "Sellar and parasellar region: sella, suprasellar and parasellar structures are normal.",
  },
];

export const MRI_BRAIN_EPILEPSY_NORMAL_FINDINGS = EPILEPSY_NORMALS.map((o) => o.renderedText).join(" ");

export const MRI_BRAIN_EPILEPSY_NORMAL_IMPRESSION =
  "Normal MRI brain with epilepsy protocol. No structural abnormality identified.";

export const MRI_BRAIN_EPILEPSY_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-brain-epilepsy-normal-r1",
  observations: [
    ...EPILEPSY_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_BRAIN_EPILEPSY_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_BRAIN_EPILEPSY_NORMAL_META = {
  name: MRI_BRAIN_EPILEPSY_NORMAL_NAME,
  bodyPart: "Brain",
  modality: "MR" as const,
  protocolScope: "Epilepsy",
  clinicalHistory: "Epilepsy protocol MRI brain. Correlate with seizure semiology.",
  technique:
    "MRI brain with epilepsy protocol. Special oblique coronal T1 inversion recovery (IR) and FLAIR oblique sequences obtained.",
  recommendation: "Clinico-radiological correlation and follow-up EEG if clinically indicated.",
  reportTitle: "MRI BRAIN WITH EPILEPSY PROTOCOL",
  findings: MRI_BRAIN_EPILEPSY_NORMAL_FINDINGS,
  impression: MRI_BRAIN_EPILEPSY_NORMAL_IMPRESSION,
  diagnosisTags: ["normal", "epilepsy", "owned baseline"],
  manifest: MRI_BRAIN_EPILEPSY_NORMAL_MANIFEST,
};
