/**
 * The radiology golden reporting corpus.
 *
 * Ten examinations, each with a normal and an abnormal case, every case stating
 * what was supplied, what the report may claim, what it must never claim, and how
 * it can be broken on purpose. See ./contract.ts for the rules a new case has to
 * follow.
 */
import type { DefectClass, ExamKey, GoldenCase } from "./contract";
import { CT_ABDOMEN_CASES } from "./ctAbdomenContrast";
import { CT_BRAIN_CASES } from "./ctBrainPlain";
import { DOPPLER_LOWER_LIMB_CASES } from "./dopplerLowerLimb";
import { MAMMOGRAPHY_CASES } from "./mammographyScreening";
import { MRI_BRAIN_CASES } from "./mriBrain";
import { MRI_CERVICAL_CASES } from "./mriCervicalSpine";
import { MRI_LUMBAR_CASES } from "./mriLumbarSpine";
import { MRI_WHOLE_SPINE_CASES } from "./mriWholeSpineScreening";
import { MRCP_CASES } from "./mrcp";
import { USG_ABDOMEN_CASES } from "./usgAbdomen";

export const GOLDEN_CASES: GoldenCase[] = [
  ...MRI_BRAIN_CASES,
  ...MRI_CERVICAL_CASES,
  ...MRI_LUMBAR_CASES,
  ...MRI_WHOLE_SPINE_CASES,
  ...MRCP_CASES,
  ...CT_BRAIN_CASES,
  ...CT_ABDOMEN_CASES,
  ...USG_ABDOMEN_CASES,
  ...DOPPLER_LOWER_LIMB_CASES,
  ...MAMMOGRAPHY_CASES,
];

export const CORPUS_EXAMS: ExamKey[] = [
  "mri-brain",
  "mri-cervical-spine",
  "mri-lumbar-spine",
  "mri-whole-spine-screening",
  "mrcp",
  "ct-brain-plain",
  "ct-abdomen-contrast",
  "usg-abdomen",
  "doppler-lower-limb-venous",
  "mammography-screening",
];

/** Every defect class, for the coverage census in the test. */
export const ALL_DEFECT_CLASSES: DefectClass[] = [
  "laterality",
  "level",
  "measurement",
  "findingsImpressionContradiction",
  "duplicateConclusion",
  "unsupportedContrast",
  "unsupportedScreeningClaim",
  "anatomicalMismatch",
  "inventedDiagnosis",
  "unsupportedNormalFinding",
];

export const allDefects = (): { goldenCase: GoldenCase; defect: GoldenCase["defects"][number] }[] =>
  GOLDEN_CASES.flatMap((goldenCase) => goldenCase.defects.map((defect) => ({ goldenCase, defect })));
