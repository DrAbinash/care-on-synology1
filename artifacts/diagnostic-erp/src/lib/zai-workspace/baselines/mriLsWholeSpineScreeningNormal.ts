/**
 * MRI LS Spine + Whole Spine Screening — Normal owned baseline.
 *
 * A dedicated LS examination with limited screening of the cervical and dorsal
 * spine. The row shipped with no `baselineManifest`, so opening it created no
 * Quick Select scaffold at all: a lumbar click on this study printed its lesion
 * beside "No spinal canal stenosis." and "Disc spaces are maintained; no
 * significant disc bulge or herniation."
 *
 * FINDINGS is the exact paragraph this row already printed, section headings
 * included — the observations quote sentences out of it rather than replacing it,
 * because a screening report's three headed sections are how the clinic reads it.
 * Each observation carries its own `region`, which is what keeps one `alignment`
 * slot per section instead of three claims competing for one key (the same device
 * `mriWholeSpineScreeningNormal.ts` uses).
 *
 * Two sentences assert more than one concept (the cervical and dorsal canal-plus-cord
 * lines). Each carries the concept its section's tiles actually contradict —
 * `canal_stenosis` — rather than being split into two slots, which would rewrite the
 * printed sentence. The lumbar disc sentence is not owned at all, for the reason written
 * where its row would have been.
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";

export const MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_NAME =
  "MRI LS Spine + Whole Spine Screening — Normal";

const LS_SENTENCES = {
  lordosis: "Normal lumbar lordosis is maintained.",
  vertebrae: "Lumbar vertebrae show normal alignment and marrow signal.",
  listhesis: "No spondylolisthesis.",
  discs: "Disc spaces are maintained; no significant disc bulge or herniation.",
  canal: "No spinal canal stenosis.",
  foramina: "Neural foramina are patent.",
  conus: "Conus medullaris terminates at L1 with normal appearance.",
  cauda: "Cauda equina nerve roots are normally distributed.",
  facets: "Facet joints and ligamentum flavum are normal.",
  softTissues: "Paraspinal soft tissues are unremarkable.",
} as const;

const CERVICAL_SENTENCES = {
  vertebrae: "Cervical vertebrae show normal alignment and marrow signal.",
  discs: "Disc spaces are maintained.",
  canal: "No significant canal stenosis or cord signal change.",
} as const;

const DORSAL_SENTENCES = {
  bodies: "Dorsal vertebral bodies and discs appear normal.",
  canal: "No evidence of disc herniation, canal stenosis or cord signal abnormality.",
} as const;

export const MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_FINDINGS = [
  "LUMBOSACRAL SPINE",
  Object.values(LS_SENTENCES).join(" "),
  "",
  "CERVICAL SPINE SCREENING",
  Object.values(CERVICAL_SENTENCES).join(" "),
  "",
  "DORSAL SPINE SCREENING",
  Object.values(DORSAL_SENTENCES).join(" "),
].join("\n");

export const MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_IMPRESSION =
  "Normal MRI lumbosacral spine. Normal screening of the cervical and dorsal spine. No canal stenosis or significant disc herniation.";

function lsObservation(
  id: string,
  concept: string,
  section: string,
  renderedText: string,
): BaselineManifestObservation {
  return {
    id,
    field: "findings",
    concept,
    conflictGroup: concept,
    anatomicalSection: section,
    region: "LS Spine",
    level: "lumbar",
    renderedText,
  };
}

function screenedObservation(
  id: string,
  concept: string,
  section: string,
  region: string,
  level: string,
  renderedText: string,
): BaselineManifestObservation {
  return {
    id,
    field: "findings",
    concept,
    conflictGroup: concept,
    anatomicalSection: section,
    region,
    level,
    renderedText,
  };
}

const OBSERVATIONS: BaselineManifestObservation[] = [
  lsObservation("ls-lordosis", "alignment", "lumbar alignment", LS_SENTENCES.lordosis),
  lsObservation("ls-vertebrae", "bone_marrow", "lumbar vertebrae", LS_SENTENCES.vertebrae),
  lsObservation("ls-listhesis", "spondylolisthesis", "lumbar alignment", LS_SENTENCES.listhesis),
  // "Disc spaces are maintained; no significant disc bulge or herniation." is deliberately
  // NOT a row. CARE's abnormality oracle tests each cue against the words just before it,
  // and four words sit between "no" and "bulge", so the clause survives its own negation and
  // the sentence reads as ASSERTING a disc bulge. `generateProfessionalReport.test.ts` fails
  // the corpus on that, and it is right to: a baseline row that reads as a finding is a
  // normal the retirement engine will not suppress. The sentence still prints, still gets
  // retired by the "Disc herniation L4-L5" box, and is simply not restorable from a scaffold
  // row — which is exactly how it behaved before this baseline existed. Widening the denial
  // window is a predicate-oracle change, not this one's to make.
  lsObservation("ls-canal", "canal_stenosis", "lumbar canal", LS_SENTENCES.canal),
  lsObservation("ls-foramina", "foraminal_stenosis", "lumbar foramina", LS_SENTENCES.foramina),
  lsObservation("ls-conus", "conus_medullaris", "conus medullaris", LS_SENTENCES.conus),
  lsObservation("ls-cauda", "cauda_equina", "cauda equina", LS_SENTENCES.cauda),
  lsObservation("ls-facets", "facet_joint", "facet joints", LS_SENTENCES.facets),
  lsObservation("ls-soft-tissues", "paraspinal", "paraspinal soft tissues", LS_SENTENCES.softTissues),
  screenedObservation(
    "cervical-vertebrae",
    "alignment",
    "cervical alignment",
    "Cervical Spine",
    "cervical",
    CERVICAL_SENTENCES.vertebrae,
  ),
  screenedObservation(
    "cervical-discs",
    "disc_contour",
    "cervical discs",
    "Cervical Spine",
    "cervical",
    CERVICAL_SENTENCES.discs,
  ),
  screenedObservation(
    "cervical-canal",
    "canal_stenosis",
    "cervical canal",
    "Cervical Spine",
    "cervical",
    CERVICAL_SENTENCES.canal,
  ),
  screenedObservation(
    "dorsal-bodies",
    "disc_contour",
    "dorsal discs",
    "Dorsal Spine",
    "dorsal",
    DORSAL_SENTENCES.bodies,
  ),
  screenedObservation(
    "dorsal-canal",
    "canal_stenosis",
    "dorsal canal",
    "Dorsal Spine",
    "dorsal",
    DORSAL_SENTENCES.canal,
  ),
];

export const MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-ls-whole-spine-screening-normal-r1",
  observations: [
    ...OBSERVATIONS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_META = {
  name: MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_NAME,
  bodyPart: "LS Spine",
  modality: "MR" as const,
  protocolScope: "Screening",
  clinicalHistory: "MRI lumbar spine with whole-spine screening requested.",
  technique:
    "Multiplanar, multisequence MRI of the lumbar spine was performed. Limited planar and limited sequence screening of the whole spine was obtained. No intravenous contrast was administered.",
  recommendation: "Clinical correlation. Detailed MRI of cervical/dorsal spine if clinically indicated.",
  reportTitle: "MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING",
  findings: MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_FINDINGS,
  impression: MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_IMPRESSION,
  diagnosisTags: ["screening", "whole spine", "normal", "owned baseline"],
  manifest: MRI_LS_WHOLE_SPINE_SCREENING_NORMAL_MANIFEST,
};
