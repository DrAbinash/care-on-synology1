/**
 * MRI LS Spine — Screening Normal owned baseline.
 *
 * Coarse claims: alignment, vertebral morphology, major disc, gross canal.
 * Conus included as a region-level slug (matches LS detailed pattern; not in content packs).
 * No per-level foraminal/root ownership. No detailed cord claims (LS is cauda/conus territory).
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";
import { screeningLimitationObservation } from "./screeningLimitation";

export const MRI_LS_SCREENING_NORMAL_NAME = "MRI LS Spine — Screening Normal";

const LS_SCREENING_NORMALS: BaselineManifestObservation[] = [
  {
    id: "alignment",
    field: "findings",
    concept: "alignment",
    conflictGroup: "alignment",
    anatomicalSection: "alignment",
    renderedText: "Lumbar alignment is within normal limits on screening sequences.",
  },
  {
    id: "vertebral-height",
    field: "findings",
    concept: "compression_fracture",
    conflictGroup: "compression_fracture",
    anatomicalSection: "vertebral bodies",
    renderedText: "Lumbar vertebral bodies show normal height and marrow signal on screening images.",
  },
  {
    id: "spondylolisthesis",
    field: "findings",
    concept: "spondylolisthesis",
    conflictGroup: "spondylolisthesis",
    anatomicalSection: "alignment",
    renderedText: "No spondylolisthesis is seen.",
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
    id: "conus",
    field: "findings",
    concept: "conus",
    conflictGroup: "conus",
    anatomicalSection: "conus",
    renderedText: "Conus medullaris appears normal on screening images.",
  },
  screeningLimitationObservation(),
];

export const MRI_LS_SCREENING_NORMAL_FINDINGS = LS_SCREENING_NORMALS.map((o) => o.renderedText).join("\n");

export const MRI_LS_SCREENING_NORMAL_IMPRESSION =
  "Normal MRI lumbosacral spine screening. No gross disc herniation or canal stenosis. Screening examination with limited planar and limited sequence coverage.";

export const MRI_LS_SCREENING_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-ls-screening-normal-r1",
  observations: [
    ...LS_SCREENING_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_LS_SCREENING_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_LS_SCREENING_NORMAL_META = {
  name: MRI_LS_SCREENING_NORMAL_NAME,
  bodyPart: "LS Spine",
  modality: "MR" as const,
  protocolScope: "Screening",
  clinicalHistory: "MRI lumbosacral spine screening requested. Correlate with clinical indication.",
  technique:
    "Limited planar and limited sequence MRI lumbosacral spine screening was performed (sagittal T1W, T2W and STIR).",
  recommendation: "Clinical correlation. Dedicated MRI LS spine if clinically indicated.",
  reportTitle: "MRI LUMBOSACRAL SPINE SCREENING",
  findings: MRI_LS_SCREENING_NORMAL_FINDINGS,
  impression: MRI_LS_SCREENING_NORMAL_IMPRESSION,
  diagnosisTags: ["screening", "normal", "ls spine"],
  manifest: MRI_LS_SCREENING_NORMAL_MANIFEST,
};
