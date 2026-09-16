/**
 * MRI Brain — Screening Normal owned baseline.
 *
 * Coarser atomic claims only. Canon: ventricles, infarct, hemorrhage.
 * Slugs: brain_parenchyma, midline. screening_limitation is protected.
 *
 * Deliberately unowned: none beyond observation sentences.
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";
import {
  SCREENING_LIMITATION_TEXT,
  screeningLimitationObservation,
} from "./screeningLimitation";

export const MRI_BRAIN_SCREENING_NORMAL_NAME = "MRI Brain — Screening Normal";

const BRAIN_SCREENING_NORMALS: BaselineManifestObservation[] = [
  {
    id: "brain-parenchyma",
    field: "findings",
    concept: "brain_parenchyma",
    conflictGroup: "brain_parenchyma",
    anatomicalSection: "brain parenchyma",
    renderedText: "Brain parenchyma shows no gross signal abnormality on screening sequences.",
  },
  {
    id: "infarct",
    field: "findings",
    concept: "infarct",
    conflictGroup: "infarct",
    anatomicalSection: "parenchyma",
    renderedText: "No gross acute infarct is identified.",
  },
  {
    id: "hemorrhage",
    field: "findings",
    concept: "hemorrhage",
    conflictGroup: "hemorrhage",
    anatomicalSection: "parenchyma",
    renderedText: "No gross intracranial hemorrhage is identified.",
  },
  {
    id: "ventricles",
    field: "findings",
    concept: "ventricles",
    conflictGroup: "ventricles",
    anatomicalSection: "ventricles",
    renderedText: "Ventricular system appears within normal limits on screening images.",
  },
  {
    id: "midline",
    field: "findings",
    concept: "midline",
    conflictGroup: "midline",
    anatomicalSection: "midline",
    renderedText: "No midline shift is seen.",
  },
  screeningLimitationObservation(),
];

export const MRI_BRAIN_SCREENING_NORMAL_FINDINGS = BRAIN_SCREENING_NORMALS.map((o) => o.renderedText).join(
  "\n",
);

export const MRI_BRAIN_SCREENING_NORMAL_IMPRESSION =
  "Normal MRI brain screening. No gross intracranial abnormality. Screening examination with limited planar and limited sequence coverage.";

export const MRI_BRAIN_SCREENING_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-brain-screening-normal-r1",
  observations: [
    ...BRAIN_SCREENING_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_BRAIN_SCREENING_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_BRAIN_SCREENING_NORMAL_META = {
  name: MRI_BRAIN_SCREENING_NORMAL_NAME,
  bodyPart: "Brain",
  modality: "MR" as const,
  protocolScope: "Screening",
  clinicalHistory: "MRI brain screening requested. Correlate with clinical indication.",
  technique:
    "Limited planar and limited sequence MRI brain screening was performed. Dedicated multiplanar complete brain protocol was not obtained.",
  recommendation: "Clinical correlation. Dedicated MRI brain if clinically indicated.",
  reportTitle: "MRI BRAIN SCREENING",
};

/** Re-export for catalog consumers that need the phrase constant nearby. */
export { SCREENING_LIMITATION_TEXT };
