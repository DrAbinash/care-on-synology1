/**
 * MRI Shoulder — Standard Normal owned baseline.
 *
 * The shoulder catalogue ships one abnormal tile — "Rotator cuff tear"
 * (concept rotator_cuff, {side}-parameterized) — so the cuff carries ONE
 * observation with no laterality: the examined side is study-level context
 * (the knee baseline's "examined-knee side" rule), and a cuff-tear claim must
 * retire the cuff normal for whichever shoulder was scanned. The rest of the
 * shoulder is stated once, region-wide, the dorsal baseline's shape.
 *
 * Canon: `rotator_cuff` is a registered concept (CLINICAL_CONTENT_PACKS
 * aliases "rotator cuff", "supraspinatus tear"). The remaining concepts are
 * slug fallbacks, not yet in CLINICAL_CONTENT_PACKS — the same posture the
 * knee baseline documents.
 *
 * The Findings/Impression wording is proposed clinical content for
 * radiologist review, not a citation (the posture the cervical Quick Select
 * catalogue carries): the owner instructed these normals shipped in the final
 * corrections round of PR #1077, closing the measured bootstrap gap.
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";

export const MRI_SHOULDER_STANDARD_NORMAL_NAME = "MRI Shoulder — Normal";

const SHOULDER_GENERAL_NORMALS: BaselineManifestObservation[] = [
  {
    id: "rotator-cuff",
    field: "findings",
    concept: "rotator_cuff",
    conflictGroup: "rotator_cuff",
    anatomicalSection: "rotator cuff",
    renderedText:
      "Rotator cuff tendons — supraspinatus, infraspinatus, subscapularis and teres minor — show normal continuity, thickness and signal intensity.",
  },
  {
    id: "labrum",
    field: "findings",
    concept: "glenoid_labrum",
    conflictGroup: "glenoid_labrum",
    anatomicalSection: "glenoid labrum",
    renderedText: "Glenoid labrum is intact.",
  },
  {
    id: "biceps",
    field: "findings",
    concept: "biceps_tendon",
    conflictGroup: "biceps_tendon",
    anatomicalSection: "biceps tendon",
    renderedText: "Long head of biceps tendon is normally located with normal signal intensity.",
  },
  {
    id: "ac-joint",
    field: "findings",
    concept: "acromioclavicular_joint",
    conflictGroup: "acromioclavicular_joint",
    anatomicalSection: "acromioclavicular joint",
    renderedText: "Acromioclavicular joint is normal.",
  },
  {
    id: "gh-joint",
    field: "findings",
    concept: "glenohumeral_joint",
    conflictGroup: "glenohumeral_joint",
    anatomicalSection: "glenohumeral joint",
    renderedText: "Glenohumeral joint shows preserved joint space with no effusion.",
  },
  {
    id: "marrow",
    field: "findings",
    concept: "shoulder_bone_marrow",
    conflictGroup: "shoulder_bone_marrow",
    anatomicalSection: "shoulder bone marrow",
    renderedText: "Humeral head and scapular glenoid show normal marrow signal.",
  },
  {
    id: "acromion",
    field: "findings",
    concept: "acromion",
    conflictGroup: "acromion",
    anatomicalSection: "acromion",
    renderedText: "Acromial morphology is unremarkable.",
  },
  {
    id: "muscles",
    field: "findings",
    concept: "shoulder_muscles",
    conflictGroup: "shoulder_muscles",
    anatomicalSection: "shoulder muscles",
    renderedText: "Deltoid and periscapular muscles are unremarkable.",
  },
  {
    id: "soft-tissues",
    field: "findings",
    concept: "shoulder_soft_tissues",
    conflictGroup: "shoulder_soft_tissues",
    anatomicalSection: "shoulder soft tissues",
    renderedText: "Axillary recess and surrounding soft tissues are unremarkable.",
  },
];

export const MRI_SHOULDER_STANDARD_NORMAL_FINDINGS = SHOULDER_GENERAL_NORMALS.map((o) => o.renderedText).join("\n");

export const MRI_SHOULDER_STANDARD_NORMAL_IMPRESSION =
  "Normal MRI of the shoulder. No rotator cuff tear or labral abnormality.";

export const MRI_SHOULDER_STANDARD_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-shoulder-standard-normal-r1",
  observations: [
    ...SHOULDER_GENERAL_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_SHOULDER_STANDARD_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_SHOULDER_STANDARD_NORMAL_META = {
  name: MRI_SHOULDER_STANDARD_NORMAL_NAME,
  bodyPart: "Shoulder",
  modality: "MR" as const,
  clinicalHistory: "MRI shoulder requested. Correlate with pain, instability or injury history.",
  technique:
    "MRI shoulder on 3T. Multiplanar proton-density fat-saturated, T1W and T2W sequences were obtained.",
  recommendation: "Clinical correlation.",
  reportTitle: "MRI SHOULDER",
  findings: MRI_SHOULDER_STANDARD_NORMAL_FINDINGS,
  impression: MRI_SHOULDER_STANDARD_NORMAL_IMPRESSION,
  diagnosisTags: ["normal", "shoulder", "owned baseline"],
  manifest: MRI_SHOULDER_STANDARD_NORMAL_MANIFEST,
};
