/**
 * MRI Dorso-Lumbar Spine — Standard Normal owned baseline.
 *
 * The audit measured the one MRI spine examination that opened no normal at all:
 * a study booked "MRI Dorso-Lumbar Spine" resolves to region `Dorso-Lumbar Spine`
 * (`lib/reportingStudyContext.ts:91`, whose `bodyPart` falls to the LS template
 * family and never to a dorsal one), and `resolveNormalBootstrapFormat` answered
 * `no-match | no complete-normal format for this region in the library` — while
 * its Quick Select strip already offered 52 boxes. A radiologist starting that
 * study typed the normal himself, sentence by sentence, and every one of those
 * sentences was then unowned: a click added the lesion beside the normal it
 * falsified, because no ledger row existed that the click could retire.
 *
 * What this file adds is ownership, not content. Its seven statements are
 * exactly the seven the shipped Dorso-Lumbar contract already recognises as
 * normal — the value set of `DL_NORMAL_BY_CONCEPT`
 * (`mriDorsoLumbarSubMasters.ts:281-309`), which `mriDorsalSubMasters` peers are
 * held to by `mriDorsoLumbarSubMasters.test.ts:317-320` ("only lists normal
 * statements that exist in the library"). Each is transcribed from
 * `mriDorsoLumbarLibrary`, which is itself a literal transcription of
 * `docs/clinical-libraries/mri-dorsolumbar-clinical-content-library.md` under a
 * disk-reading test, so no sentence here is new prose.
 *
 * Why seven and not the dorsal eleven plus the lumbar forty: the library says so
 * itself (`mriDorsoLumbarLibrary.ts:11-16`) — a dorso-lumbar report is one
 * examination crossing the thoracolumbar junction, not a dorsal report pasted
 * above a lumbar one, so its normal wording says "within the imaged coverage"
 * instead of naming a fixed T1-S1 range twice. Taking the two segment normals
 * side by side would have printed two alignment lines, two marrow lines and two
 * canal lines in one report. `dorsoLumbarStandardNormal.test.ts` measures the
 * absence of that duplication, and measures that all seven appear, so a future
 * edit cannot quietly drop the conus or the cord sentence.
 *
 * Every concept the shipped contract maps lands on a row rendered here, so no
 * Dorso-Lumbar tile or preset can claim a normal sentence this baseline never
 * prints — the failure class `dorsalStandardNormalOwnership.test.ts` was written
 * for. That correspondence is asserted, not assumed.
 *
 * The two lines that are not library transcriptions are the impression and the
 * technique. The impression sums up the seven statements above and claims nothing
 * beyond them, keeping the library's own "within the imaged coverage" qualifier.
 * The technique is the shipped LS Spine acquisition sentence
 * (`report-formats-library.ts:197`) with the examination renamed to the one this
 * row is booked as — the sequences are the same ones both segments are acquired
 * with. Both are the owner's to approve or replace.
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import {
  DL_ALIGN,
  DL_BONE,
  DL_CANAL,
  DL_JUNCTION,
} from "@/lib/mriDorsoLumbarLibrary";
import type { BaselineManifest, BaselineManifestObservation } from "../types";

export const MRI_DORSO_LUMBAR_STANDARD_NORMAL_NAME =
  "MRI Dorso-Lumbar Spine — Standard Normal";

/**
 * `anatomicalSection` follows the shipped preset atoms, which name the whole
 * examined span rather than one segment
 * (`mriDorsoLumbarSubMasters.ts:411-450`), so the baseline and the palette's own
 * normal tiles describe the same anatomy.
 */
const DORSO_LUMBAR_STANDARD_NORMALS: BaselineManifestObservation[] = [
  {
    id: "alignment",
    field: "findings",
    concept: "alignment",
    conflictGroup: "alignment",
    anatomicalSection: "dorso-lumbar spine",
    renderedText: DL_ALIGN.normal,
  },
  {
    id: "curves",
    // Not `concept: "kyphosis"`: slot identity is region + canonical concept + level
    // + laterality (`observationSlot.ts:361-366`), and the canon folds "kyphosis"
    // onto the `alignment` family (`conceptCanon/contentPacks.ts:637-641`), so a
    // kyphosis-named row and the alignment row collapse into one ownership slot and
    // `validateBaselineManifest` fails the whole baseline closed — which would leave
    // this study with no owned normal at all, the defect this row exists to close.
    // The two statements are separate claims and stay separate rows: a junction
    // kyphosis tile retires the curve sentence and keeps "alignment is maintained",
    // a listhesis tile retires the alignment sentence and keeps the curves.
    field: "findings",
    concept: "sagittal_curvature",
    conflictGroup: "kyphosis",
    anatomicalSection: "dorso-lumbar spine",
    renderedText: DL_ALIGN.curvesPreserved,
  },
  {
    id: "vertebral-bodies",
    field: "findings",
    concept: "bone_lesion",
    conflictGroup: "marrow_screen",
    anatomicalSection: "dorso-lumbar spine",
    renderedText: DL_BONE.normal,
  },
  {
    id: "no-fracture",
    field: "findings",
    concept: "compression_fracture",
    conflictGroup: "compression_fracture",
    anatomicalSection: "dorso-lumbar spine",
    renderedText: DL_BONE.noFracture,
  },
  {
    id: "canal",
    field: "findings",
    concept: "canal_stenosis",
    conflictGroup: "canal_stenosis",
    anatomicalSection: "spinal canal",
    renderedText: DL_CANAL.noCanalCompromise,
  },
  {
    id: "cord",
    field: "findings",
    concept: "cord_caliber",
    conflictGroup: "cord_caliber",
    anatomicalSection: "spinal cord",
    renderedText: DL_CANAL.cordNormal,
  },
  {
    id: "conus",
    field: "findings",
    concept: "conus_medullaris",
    conflictGroup: "conus_medullaris",
    anatomicalSection: "conus medullaris",
    renderedText: DL_JUNCTION.conusNormal,
  },
];

export const MRI_DORSO_LUMBAR_STANDARD_NORMAL_FINDINGS =
  DORSO_LUMBAR_STANDARD_NORMALS.map((o) => o.renderedText).join("\n");

export const MRI_DORSO_LUMBAR_STANDARD_NORMAL_IMPRESSION =
  "Normal MRI of the dorso-lumbar spine. Alignment, vertebral bodies, thoracic cord and conus are normal within the imaged coverage.";

export const MRI_DORSO_LUMBAR_STANDARD_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-dorso-lumbar-standard-normal-r1",
  observations: [
    ...DORSO_LUMBAR_STANDARD_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_DORSO_LUMBAR_STANDARD_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_DORSO_LUMBAR_STANDARD_NORMAL_META = {
  name: MRI_DORSO_LUMBAR_STANDARD_NORMAL_NAME,
  bodyPart: "Dorso-Lumbar Spine",
  modality: "MR" as const,
  clinicalHistory: "",
  technique:
    "MRI dorso-lumbar spine on 3T. Sagittal T1W, T2W and STIR; axial T1W and T2W images were obtained.",
  recommendation: "Clinical correlation. Follow-up as clinically indicated.",
  reportTitle: "MRI DORSO-LUMBAR SPINE",
  findings: MRI_DORSO_LUMBAR_STANDARD_NORMAL_FINDINGS,
  impression: MRI_DORSO_LUMBAR_STANDARD_NORMAL_IMPRESSION,
  diagnosisTags: ["normal", "standard", "owned baseline"],
  manifest: MRI_DORSO_LUMBAR_STANDARD_NORMAL_MANIFEST,
};
