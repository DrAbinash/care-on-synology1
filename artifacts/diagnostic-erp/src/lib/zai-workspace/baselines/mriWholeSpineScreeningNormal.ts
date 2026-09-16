/**
 * MRI Whole Spine — Screening Normal owned baseline.
 *
 * REGION-AWARE: uses level buckets cervical | dorsal | lumbar so identical
 * atomic concepts do not collide under region "Whole Spine".
 *
 * Coarse claims per region: alignment, vertebral morphology, major disc,
 * gross canal, gross cord (C/D) or conus (lumbar). No foraminal/root detail.
 *
 * Deliberately unowned: section headers ("CERVICAL SPINE SCREENING", etc.).
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";
import { screeningLimitationObservation } from "./screeningLimitation";

export const MRI_WHOLE_SPINE_SCREENING_NORMAL_NAME = "MRI Whole Spine — Screening Normal";

type SpineRegionBucket = "cervical" | "dorsal" | "lumbar";

function regionalNormals(
  bucket: SpineRegionBucket,
  label: string,
): BaselineManifestObservation[] {
  const prefix = bucket;
  const base: BaselineManifestObservation[] = [
    {
      id: `${prefix}-alignment`,
      field: "findings",
      concept: "alignment",
      conflictGroup: "alignment",
      anatomicalSection: label,
      level: bucket,
      renderedText: `${label}: Alignment is within normal limits on screening sequences.`,
    },
    {
      id: `${prefix}-vertebral-height`,
      field: "findings",
      concept: "compression_fracture",
      conflictGroup: "compression_fracture",
      anatomicalSection: label,
      level: bucket,
      renderedText: `${label}: Vertebral bodies show normal height and marrow signal on screening images.`,
    },
    {
      id: `${prefix}-disc-contour`,
      field: "findings",
      concept: "disc_contour",
      conflictGroup: "disc_contour",
      anatomicalSection: label,
      level: bucket,
      renderedText: `${label}: No significant disc herniation is identified on screening sequences.`,
    },
    {
      id: `${prefix}-canal`,
      field: "findings",
      concept: "canal_stenosis",
      conflictGroup: "canal_stenosis",
      anatomicalSection: label,
      level: bucket,
      renderedText: `${label}: No gross spinal canal stenosis is seen.`,
    },
  ];

  if (bucket === "lumbar") {
    base.push({
      id: `${prefix}-conus`,
      field: "findings",
      concept: "conus",
      conflictGroup: "conus",
      anatomicalSection: label,
      level: bucket,
      renderedText: `${label}: Conus medullaris appears normal on screening images.`,
    });
  } else {
    base.push(
      {
        id: `${prefix}-cord-signal`,
        field: "findings",
        concept: "cord_signal",
        conflictGroup: "cord_signal",
        anatomicalSection: label,
        level: bucket,
        renderedText: `${label}: No gross cord signal abnormality is identified.`,
      },
      {
        id: `${prefix}-cord-compression`,
        field: "findings",
        concept: "cord_compression",
        conflictGroup: "cord_compression",
        anatomicalSection: label,
        level: bucket,
        renderedText: `${label}: No gross cord compression is seen.`,
      },
    );
  }

  return base;
}

const CERVICAL = regionalNormals("cervical", "Cervical Spine");
const DORSAL = regionalNormals("dorsal", "Dorsal Spine");
const LUMBAR = regionalNormals("lumbar", "LS Spine");

const WHOLE_SPINE_OBS: BaselineManifestObservation[] = [
  ...CERVICAL,
  ...DORSAL,
  ...LUMBAR,
  screeningLimitationObservation(),
];

/** Section headers are deliberately unowned scaffolding around owned sentences. */
export const MRI_WHOLE_SPINE_SCREENING_NORMAL_FINDINGS = [
  "CERVICAL SPINE SCREENING",
  ...CERVICAL.map((o) => o.renderedText),
  "",
  "DORSAL SPINE SCREENING",
  ...DORSAL.map((o) => o.renderedText),
  "",
  "LS SPINE SCREENING",
  ...LUMBAR.map((o) => o.renderedText),
  "",
  screeningLimitationObservation().renderedText,
].join("\n");

export const MRI_WHOLE_SPINE_SCREENING_NORMAL_IMPRESSION =
  "Normal whole spine MRI screening. No gross disc herniation, canal stenosis or cord compression across cervical, dorsal and lumbar segments. Screening examination with limited planar and limited sequence coverage.";

export const MRI_WHOLE_SPINE_SCREENING_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-whole-spine-screening-normal-r1",
  observations: [
    ...WHOLE_SPINE_OBS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_WHOLE_SPINE_SCREENING_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_WHOLE_SPINE_SCREENING_NORMAL_META = {
  name: MRI_WHOLE_SPINE_SCREENING_NORMAL_NAME,
  bodyPart: "Whole Spine",
  modality: "MR" as const,
  protocolScope: "Screening",
  clinicalHistory: "Whole spine MRI screening requested. Correlate with clinical indication.",
  technique:
    "Limited planar and limited sequence whole spine MRI screening was performed with sagittal T1W, T2W and STIR of the cervical, dorsal and lumbar spine.",
  recommendation: "Clinical correlation. Dedicated regional MRI if clinically indicated.",
  reportTitle: "MRI WHOLE SPINE SCREENING",
};
