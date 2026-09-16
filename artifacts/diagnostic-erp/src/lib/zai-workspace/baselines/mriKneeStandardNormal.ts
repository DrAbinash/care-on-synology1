/**
 * MRI Knee — Standard Normal owned baseline.
 *
 * Canon: meniscus.
 * Slug fallbacks (not yet in CLINICAL_CONTENT_PACKS): acl, pcl, mcl, lcl,
 * articular_cartilage, bone_marrow, extensor_mechanism, patellofemoral, effusion.
 *
 * Deliberately unowned: laterality of the examined knee (study-level laterality
 * is outside this baseline; observations are ipsilateral-region normals).
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";

export const MRI_KNEE_STANDARD_NORMAL_NAME = "MRI Knee — Standard Normal";

const KNEE_GENERAL_NORMALS: BaselineManifestObservation[] = [
  {
    id: "meniscus",
    field: "findings",
    concept: "meniscus",
    conflictGroup: "meniscus",
    anatomicalSection: "menisci",
    renderedText: "Medial and lateral menisci are intact without tear.",
  },
  {
    id: "acl",
    field: "findings",
    concept: "acl",
    conflictGroup: "acl",
    anatomicalSection: "ACL",
    renderedText: "Anterior cruciate ligament is intact with normal signal and course.",
  },
  {
    id: "pcl",
    field: "findings",
    concept: "pcl",
    conflictGroup: "pcl",
    anatomicalSection: "PCL",
    renderedText: "Posterior cruciate ligament is intact.",
  },
  {
    id: "mcl",
    field: "findings",
    concept: "mcl",
    conflictGroup: "mcl",
    anatomicalSection: "MCL",
    renderedText: "Medial collateral ligament is intact.",
  },
  {
    id: "lcl",
    field: "findings",
    concept: "lcl",
    conflictGroup: "lcl",
    anatomicalSection: "LCL",
    renderedText: "Lateral collateral ligament complex is intact.",
  },
  {
    id: "articular-cartilage",
    field: "findings",
    concept: "articular_cartilage",
    conflictGroup: "articular_cartilage",
    anatomicalSection: "articular cartilage",
    renderedText: "Articular cartilage of the femorotibial compartments appears preserved.",
  },
  {
    id: "patellofemoral",
    field: "findings",
    concept: "patellofemoral",
    conflictGroup: "patellofemoral",
    anatomicalSection: "patellofemoral",
    renderedText: "Patellofemoral compartment articular surfaces appear preserved.",
  },
  {
    id: "extensor-mechanism",
    field: "findings",
    concept: "extensor_mechanism",
    conflictGroup: "extensor_mechanism",
    anatomicalSection: "extensor mechanism",
    renderedText: "Extensor mechanism including quadriceps and patellar tendons is intact.",
  },
  {
    id: "bone-marrow",
    field: "findings",
    concept: "bone_marrow",
    conflictGroup: "bone_marrow",
    anatomicalSection: "bone marrow",
    renderedText: "No significant bone marrow edema is seen in the visualized osseous structures.",
  },
  {
    id: "effusion",
    field: "findings",
    concept: "effusion",
    conflictGroup: "effusion",
    anatomicalSection: "joint effusion",
    renderedText: "No significant joint effusion is seen.",
  },
];

export const MRI_KNEE_STANDARD_NORMAL_FINDINGS = KNEE_GENERAL_NORMALS.map((o) => o.renderedText).join("\n");

export const MRI_KNEE_STANDARD_NORMAL_IMPRESSION =
  "Normal MRI of the knee. No meniscal tear, ligament injury or significant articular cartilage abnormality.";

export const MRI_KNEE_STANDARD_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-knee-standard-normal-r1",
  observations: [
    ...KNEE_GENERAL_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_KNEE_STANDARD_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_KNEE_STANDARD_NORMAL_META = {
  name: MRI_KNEE_STANDARD_NORMAL_NAME,
  bodyPart: "Knee",
  modality: "MR" as const,
  clinicalHistory: "MRI knee requested. Correlate with pain, instability or injury history.",
  technique:
    "MRI knee on 3T. Multiplanar proton-density fat-saturated, T1W and T2W sequences were obtained.",
  recommendation: "Clinical correlation.",
  reportTitle: "MRI KNEE",
  findings: MRI_KNEE_STANDARD_NORMAL_FINDINGS,
  impression: MRI_KNEE_STANDARD_NORMAL_IMPRESSION,
  diagnosisTags: ["normal", "knee"],
  manifest: MRI_KNEE_STANDARD_NORMAL_MANIFEST,
};
