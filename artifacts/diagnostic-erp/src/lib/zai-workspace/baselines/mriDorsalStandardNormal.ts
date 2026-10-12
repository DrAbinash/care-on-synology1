/**
 * MRI Dorsal Spine — Standard Normal owned baseline.
 *
 * Dorsal was the only MRI region without a Standard Normal manifest (Brain, Cervical,
 * Knee and LS Spine each have one), so Generate on a billed "MRI DORSAL SPINE" study
 * selected the manifest-less "MRI Dorsal Spine — Normal" and wrote fourteen normal
 * sentences that no ledger row owned — `{"status":"generated","baselineConcepts":0}`.
 * A compression fracture then appended beside "normal height" and "No fractures", and
 * nothing in the ownership chain could retire either line.
 *
 * The sentences here are the dorsal library's OWN normal lines (`mriDorsalLibrary`), not
 * new prose: `DORSAL_NORMAL_SENTENCE_BY_CONCEPT` already maps each dorsal abnormality
 * concept onto exactly these strings, so an atom documented through the shipped contract
 * claims the sentence it contradicts and the report loses it. Authoring any other wording
 * would have left the baseline and the contract describing different sentences — which is
 * the failure this file exists to close.
 *
 * One claim-set per row, matching the cervical/LS pattern: `DX_BONE.normal` (heights and
 * marrow) and `DX_BONE.noFocalLesion` ("No acute compression fracture, focal
 * lytic/sclerotic lesion…") are separate rows because a focal lesion and a fracture are
 * different abnormalities; the second names "compression fracture" in its own words, so a
 * fracture retires both.
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import {
  DX_ALIGN,
  DX_BONE,
  DX_CANAL,
  DX_DISC,
  DX_POSTERIOR,
  DX_SOFT,
} from "@/lib/mriDorsalLibrary";
import type { BaselineManifest, BaselineManifestObservation } from "../types";

export const MRI_DORSAL_STANDARD_NORMAL_NAME = "MRI Dorsal Spine — Standard Normal";

const DORSAL_STANDARD_NORMALS: BaselineManifestObservation[] = [
  {
    id: "alignment",
    field: "findings",
    concept: "alignment",
    conflictGroup: "alignment",
    anatomicalSection: "alignment",
    renderedText: DX_ALIGN.normal,
  },
  {
    id: "vertebral-bodies",
    field: "findings",
    concept: "compression_fracture",
    conflictGroup: "compression_fracture",
    anatomicalSection: "vertebral bodies",
    renderedText: DX_BONE.normal,
  },
  {
    id: "no-focal-lesion",
    field: "findings",
    concept: "bone_lesion",
    conflictGroup: "bone_lesion",
    anatomicalSection: "vertebral bodies",
    renderedText: DX_BONE.noFocalLesion,
  },
  {
    id: "disc-signal-height",
    field: "findings",
    concept: "disc_signal",
    conflictGroup: "disc_signal",
    anatomicalSection: "discs",
    renderedText: DX_DISC.normal,
  },
  {
    id: "disc-herniation",
    field: "findings",
    concept: "disc_contour",
    conflictGroup: "disc_contour",
    anatomicalSection: "discs",
    renderedText: DX_DISC.noHerniation,
  },
  {
    id: "canal",
    field: "findings",
    concept: "canal_stenosis",
    conflictGroup: "canal_stenosis",
    anatomicalSection: "spinal canal",
    renderedText: DX_CANAL.normal,
  },
  {
    id: "cord",
    field: "findings",
    concept: "cord_caliber",
    conflictGroup: "cord_caliber",
    anatomicalSection: "spinal cord",
    renderedText: DX_CANAL.cordNormal,
  },
  {
    id: "foramina",
    field: "findings",
    concept: "foraminal_stenosis",
    conflictGroup: "foraminal_stenosis",
    anatomicalSection: "neural foramina",
    renderedText: DX_POSTERIOR.normal,
  },
  {
    id: "posterior-elements",
    field: "findings",
    concept: "posterior_elements",
    conflictGroup: "posterior_elements",
    anatomicalSection: "posterior elements",
    renderedText: DX_POSTERIOR.posteriorElementsIntact,
  },
  {
    id: "paraspinal",
    field: "findings",
    concept: "paraspinal",
    conflictGroup: "paraspinal",
    anatomicalSection: "paraspinal soft tissues",
    renderedText: DX_SOFT.normal,
  },
];

export const MRI_DORSAL_STANDARD_NORMAL_FINDINGS = DORSAL_STANDARD_NORMALS.map(
  (o) => o.renderedText,
).join("\n");

/** The dorsal normal impression, unchanged from the shipped template. */
export const MRI_DORSAL_STANDARD_NORMAL_IMPRESSION =
  "Normal MRI of the dorsal (thoracic) spine. No disc herniation, canal stenosis, or neural foraminal narrowing.";

export const MRI_DORSAL_STANDARD_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-dorsal-standard-normal-r1",
  observations: [
    ...DORSAL_STANDARD_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_DORSAL_STANDARD_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_DORSAL_STANDARD_NORMAL_META = {
  name: MRI_DORSAL_STANDARD_NORMAL_NAME,
  bodyPart: "Dorsal Spine",
  modality: "MR" as const,
  clinicalHistory: "",
  technique: "MRI dorsal spine on 3T. Sagittal T1W, T2W; axial T1W, T2W. 3 mm.",
  recommendation: "Clinical correlation. Follow-up as clinically indicated.",
  reportTitle: "MRI DORSAL SPINE",
  findings: MRI_DORSAL_STANDARD_NORMAL_FINDINGS,
  impression: MRI_DORSAL_STANDARD_NORMAL_IMPRESSION,
  diagnosisTags: ["normal", "standard", "owned baseline"],
  manifest: MRI_DORSAL_STANDARD_NORMAL_MANIFEST,
};
