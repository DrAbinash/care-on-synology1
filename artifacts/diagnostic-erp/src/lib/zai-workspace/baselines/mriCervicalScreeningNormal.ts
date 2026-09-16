/**
 * MRI Cervical Spine — Screening Normal owned baseline.
 *
 * Coarse claims only: alignment, vertebral morphology, major disc, gross canal,
 * gross cord. No per-level foraminal/root ownership.
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";
import { screeningLimitationObservation } from "./screeningLimitation";

export const MRI_CERVICAL_SCREENING_NORMAL_NAME = "MRI Cervical Spine — Screening Normal";

const CERVICAL_SCREENING_NORMALS: BaselineManifestObservation[] = [
  {
    id: "alignment",
    field: "findings",
    concept: "alignment",
    conflictGroup: "alignment",
    anatomicalSection: "alignment",
    renderedText: "Cervical alignment is within normal limits on screening sequences.",
  },
  {
    id: "vertebral-height",
    field: "findings",
    concept: "compression_fracture",
    conflictGroup: "compression_fracture",
    anatomicalSection: "vertebral bodies",
    renderedText: "Cervical vertebral bodies show normal height and marrow signal on screening images.",
  },
  {
    id: "disc-contour",
    field: "findings",
    concept: "disc_contour",
    conflictGroup: "disc_contour",
    anatomicalSection: "discs",
    renderedText: "No significant disc herniation is identified on screening sequences.",
  },
  {
    id: "canal",
    field: "findings",
    concept: "canal_stenosis",
    conflictGroup: "canal_stenosis",
    anatomicalSection: "spinal canal",
    renderedText: "No gross spinal canal stenosis is seen.",
  },
  {
    id: "cord-signal",
    field: "findings",
    concept: "cord_signal",
    conflictGroup: "cord_signal",
    anatomicalSection: "spinal cord",
    renderedText: "No gross cord signal abnormality is identified.",
  },
  {
    id: "cord-compression",
    field: "findings",
    concept: "cord_compression",
    conflictGroup: "cord_compression",
    anatomicalSection: "spinal cord",
    renderedText: "No gross cord compression is seen.",
  },
  screeningLimitationObservation(),
];

export const MRI_CERVICAL_SCREENING_NORMAL_FINDINGS = CERVICAL_SCREENING_NORMALS.map(
  (o) => o.renderedText,
).join("\n");

export const MRI_CERVICAL_SCREENING_NORMAL_IMPRESSION =
  "Normal MRI cervical spine screening. No gross disc herniation, canal stenosis or cord compression. Screening examination with limited planar and limited sequence coverage.";

export const MRI_CERVICAL_SCREENING_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-cervical-screening-normal-r1",
  observations: [
    ...CERVICAL_SCREENING_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_CERVICAL_SCREENING_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_CERVICAL_SCREENING_NORMAL_META = {
  name: MRI_CERVICAL_SCREENING_NORMAL_NAME,
  bodyPart: "Cervical Spine",
  modality: "MR" as const,
  protocolScope: "Screening",
  clinicalHistory: "MRI cervical spine screening requested. Correlate with clinical indication.",
  technique:
    "Limited planar and limited sequence MRI cervical spine screening was performed (sagittal T1W/T2W with selected axial images).",
  recommendation: "Clinical correlation. Dedicated MRI cervical spine if clinically indicated.",
  reportTitle: "MRI CERVICAL SPINE SCREENING",
};
