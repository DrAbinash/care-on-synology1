/**
 * MRI Pelvis — Standard Normal owned baseline.
 *
 * The pelvis catalogue ships one abnormal tile — "Hip effusion" (concept hip,
 * {side}-parameterized) — so the hip joints carry per-side observations, the
 * same posture the knee baseline documents for the medial/lateral meniscus
 * split: CARE laterality slots only apply to concepts that declare them
 * (a "{side}" token or a `side` property), so a paired structure uses DISTINCT
 * CONCEPTS (hip_left / hip_right), not laterality, to tell its two rows apart
 * in the ownership slot key. A left-sided hip claim must retire the left normal
 * and leave the right one on the page — the tile's concept `hip` still reaches
 * both sentences through the text ("Left hip joint …" names the hip concept
 * and says its side). The rest of the pelvis is stated once, region-wide, the
 * dorsal baseline's shape.
 *
 * Canon: `hip` is a registered concept (CLINICAL_CONTENT_PACKS aliases "hip",
 * "hip effusion", "hip joint effusion"). hip_left, hip_right and the remaining
 * concepts are slug fallbacks, not yet in CLINICAL_CONTENT_PACKS — the same
 * posture the knee baseline documents for medial_meniscus et al.
 *
 * The Findings/Impression wording is proposed clinical content for
 * radiologist review, not a citation (the posture the cervical Quick Select
 * catalogue carries): the owner instructed these normals shipped in the final
 * corrections round of PR #1077, closing the measured bootstrap gap.
 *
 * Deliberately unowned: examined-pelvis reproductive organs (study-level
 * clinical context, not a sentence a tile can contradict).
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";

export const MRI_PELVIS_STANDARD_NORMAL_NAME = "MRI Pelvis — Normal";

const PELVIS_GENERAL_NORMALS: BaselineManifestObservation[] = [
  {
    id: "hip-left",
    field: "findings",
    concept: "hip_left",
    conflictGroup: "hip_left",
    laterality: "left",
    anatomicalSection: "hip joint",
    renderedText:
      "Left hip joint is normally aligned with preserved articular cartilage and no joint effusion.",
  },
  {
    id: "hip-right",
    field: "findings",
    concept: "hip_right",
    conflictGroup: "hip_right",
    laterality: "right",
    anatomicalSection: "hip joint",
    renderedText:
      "Right hip joint is normally aligned with preserved articular cartilage and no joint effusion.",
  },
  {
    id: "pelvic-bones",
    field: "findings",
    concept: "pelvic_bones",
    conflictGroup: "pelvic_bones",
    anatomicalSection: "pelvic bones",
    renderedText: "Pelvic bones show normal marrow signal with no focal osseous lesion.",
  },
  {
    id: "sacroiliac",
    field: "findings",
    concept: "sacroiliac_joints",
    conflictGroup: "sacroiliac_joints",
    anatomicalSection: "sacroiliac joints",
    renderedText: "Sacroiliac joints are normal.",
  },
  {
    id: "symphysis",
    field: "findings",
    concept: "pubic_symphysis",
    conflictGroup: "pubic_symphysis",
    anatomicalSection: "pubic symphysis",
    renderedText: "Pubic symphysis is unremarkable.",
  },
  {
    id: "viscera",
    field: "findings",
    concept: "pelvic_viscera",
    conflictGroup: "pelvic_viscera",
    anatomicalSection: "pelvic viscera",
    renderedText: "Visualized pelvic viscera are unremarkable.",
  },
  {
    id: "soft-tissues",
    field: "findings",
    concept: "pelvic_soft_tissues",
    conflictGroup: "pelvic_soft_tissues",
    anatomicalSection: "pelvic soft tissues",
    renderedText: "Pelvic soft tissues show normal signal intensity.",
  },
  {
    id: "muscles",
    field: "findings",
    concept: "pelvic_muscles",
    conflictGroup: "pelvic_muscles",
    anatomicalSection: "pelvic muscles",
    renderedText: "Visualized pelvic and hip girdle muscles are unremarkable.",
  },
  {
    id: "lymph-nodes",
    field: "findings",
    concept: "pelvic_lymph_nodes",
    conflictGroup: "pelvic_lymph_nodes",
    anatomicalSection: "pelvic lymph nodes",
    renderedText: "No lymphadenopathy is seen.",
  },
];

export const MRI_PELVIS_STANDARD_NORMAL_FINDINGS = PELVIS_GENERAL_NORMALS.map((o) => o.renderedText).join("\n");

export const MRI_PELVIS_STANDARD_NORMAL_IMPRESSION =
  "Normal MRI of the pelvis. No joint effusion or focal bone lesion.";

export const MRI_PELVIS_STANDARD_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-pelvis-standard-normal-r1",
  observations: [
    ...PELVIS_GENERAL_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_PELVIS_STANDARD_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_PELVIS_STANDARD_NORMAL_META = {
  name: MRI_PELVIS_STANDARD_NORMAL_NAME,
  bodyPart: "Pelvis",
  modality: "MR" as const,
  clinicalHistory: "MRI pelvis requested. Correlate with presenting symptoms.",
  technique:
    "MRI pelvis on 3T. Multiplanar T1W, T2W and STIR sequences were obtained.",
  recommendation: "Clinical correlation.",
  reportTitle: "MRI PELVIS",
  findings: MRI_PELVIS_STANDARD_NORMAL_FINDINGS,
  impression: MRI_PELVIS_STANDARD_NORMAL_IMPRESSION,
  diagnosisTags: ["normal", "pelvis", "owned baseline"],
  manifest: MRI_PELVIS_STANDARD_NORMAL_MANIFEST,
};
