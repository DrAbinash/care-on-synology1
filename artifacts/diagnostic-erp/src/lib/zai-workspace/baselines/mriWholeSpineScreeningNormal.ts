/**
 * MRI Whole Spine — Screening Normal.
 * REGION-AWARE ownership via level buckets: cervical | dorsal | lumbar.
 * Mandatory screening limitation appears once.
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";
import { screeningLimitationObservation, SCREENING_LIMITATION_TEXT } from "./screeningLimitation";

export const MRI_WHOLE_SPINE_SCREENING_NORMAL_NAME = "MRI Whole Spine — Screening Normal";

function regionalNormals(
  level: "cervical" | "dorsal" | "lumbar",
  label: string,
): BaselineManifestObservation[] {
  const base: BaselineManifestObservation[] = [
    {
      id: `${level}-alignment`,
      field: "findings",
      concept: "alignment",
      conflictGroup: "alignment",
      anatomicalSection: label,
      level,
      renderedText: `${label}: Alignment is within normal limits on screening sequences.`,
    },
    {
      id: `${level}-vertebral`,
      field: "findings",
      concept: "compression_fracture",
      conflictGroup: "compression_fracture",
      anatomicalSection: label,
      level,
      renderedText: `${label}: Vertebral bodies show normal height and marrow signal on screening images.`,
    },
    {
      id: `${level}-disc`,
      field: "findings",
      concept: "disc_contour",
      conflictGroup: "disc_contour",
      anatomicalSection: label,
      level,
      renderedText: `${label}: No significant disc herniation is identified on screening sequences.`,
    },
    {
      id: `${level}-canal`,
      field: "findings",
      concept: "canal_stenosis",
      conflictGroup: "canal_stenosis",
      anatomicalSection: label,
      level,
      renderedText: `${label}: No gross spinal canal compromise is seen.`,
    },
  ];
  if (level === "lumbar") {
    base.push({
      id: `${level}-conus`,
      field: "findings",
      concept: "conus",
      conflictGroup: "conus",
      anatomicalSection: label,
      level,
      renderedText: `${label}: Conus medullaris appears normal on screening images.`,
    });
  } else {
    base.push({
      id: `${level}-cord`,
      field: "findings",
      concept: "cord_signal",
      conflictGroup: "cord_signal",
      anatomicalSection: label,
      level,
      renderedText: `${label}: Cord morphology and signal are within normal limits on screening sequences.`,
    });
  }
  return base;
}

const OBS: BaselineManifestObservation[] = [
  screeningLimitationObservation(),
  ...regionalNormals("cervical", "Cervical spine"),
  ...regionalNormals("dorsal", "Dorsal spine"),
  ...regionalNormals("lumbar", "Lumbar spine"),
];

export const MRI_WHOLE_SPINE_SCREENING_NORMAL_FINDINGS = OBS.map((o) => o.renderedText).join("\n");

export const MRI_WHOLE_SPINE_SCREENING_NORMAL_IMPRESSION =
  "Normal whole-spine screening MRI. No gross disc, canal or cord compressive abnormality on limited sequences.";

export const MRI_WHOLE_SPINE_SCREENING_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-whole-spine-screening-normal-r1",
  observations: [
    ...OBS,
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
  modality: "MR" as const,
  bodyPart: "Whole Spine",
  protocolScope: "Screening",
  clinicalHistory: "Whole-spine MRI screening requested. Correlate with clinical findings.",
  technique:
    "Limited whole-spine screening with sagittal T1W, T2W and STIR of the cervical, dorsal and lumbar regions (limited planar and limited sequence).",
  findings: MRI_WHOLE_SPINE_SCREENING_NORMAL_FINDINGS,
  impression: MRI_WHOLE_SPINE_SCREENING_NORMAL_IMPRESSION,
  recommendation: "Clinical correlation. Dedicated regional MRI if clinically indicated.",
  reportTitle: "MRI WHOLE SPINE SCREENING",
  diagnosisTags: ["screening", "normal", "whole spine"],
  manifest: MRI_WHOLE_SPINE_SCREENING_NORMAL_MANIFEST,
};

// Ensure limitation text is exported for tests
export { SCREENING_LIMITATION_TEXT };
