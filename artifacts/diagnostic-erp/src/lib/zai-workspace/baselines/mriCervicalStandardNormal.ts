/**
 * MRI Cervical Spine — Standard Normal owned baseline.
 *
 * Pattern mirrors MRI LS Spine Standard Normal: region-level general normals
 * plus per-level disc_contour / canal / foramina / root at C2-C3..C6-C7.
 *
 * Canon concepts: alignment, compression_fracture, spondylolisthesis, disc_signal,
 * disc_height, disc_contour, canal_stenosis, foraminal_stenosis, root_contact,
 * cord_signal, cord_compression, facet_joint, ligamentum_flavum.
 * Slug: paraspinal (same as LS owned baseline; not yet a content-pack entry).
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";

export const MRI_CERVICAL_STANDARD_NORMAL_NAME = "MRI Cervical Spine — Standard Normal";

const C_LEVELS = ["C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7"] as const;

const CERVICAL_GENERAL_NORMALS: BaselineManifestObservation[] = [
  {
    id: "alignment",
    field: "findings",
    concept: "alignment",
    conflictGroup: "alignment",
    anatomicalSection: "alignment",
    renderedText: "Normal cervical lordosis is maintained.",
  },
  {
    id: "vertebral-height",
    field: "findings",
    concept: "compression_fracture",
    conflictGroup: "compression_fracture",
    anatomicalSection: "vertebral bodies",
    renderedText: "Cervical vertebral bodies demonstrate normal height and marrow signal.",
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
    id: "cord-signal",
    field: "findings",
    concept: "cord_signal",
    conflictGroup: "cord_signal",
    anatomicalSection: "spinal cord",
    renderedText: "Cervical spinal cord signal intensity is normal.",
  },
  {
    id: "cord-compression",
    field: "findings",
    concept: "cord_compression",
    conflictGroup: "cord_compression",
    anatomicalSection: "spinal cord",
    renderedText: "No cord compression is seen.",
  },
  {
    id: "facet-joints",
    field: "findings",
    concept: "facet_joint",
    conflictGroup: "facet_joint",
    anatomicalSection: "facet joints",
    renderedText: "Cervical facet joints are unremarkable.",
  },
  {
    id: "ligamentum-flavum",
    field: "findings",
    concept: "ligamentum_flavum",
    conflictGroup: "ligamentum_flavum",
    anatomicalSection: "ligamentum flavum",
    renderedText: "Ligamentum flavum is not hypertrophied.",
  },
  {
    id: "paraspinal",
    field: "findings",
    concept: "paraspinal",
    conflictGroup: "paraspinal",
    anatomicalSection: "paraspinal soft tissues",
    renderedText: "Prevertebral and paraspinal soft tissues are unremarkable.",
  },
];

function levelNormals(level: (typeof C_LEVELS)[number]): BaselineManifestObservation[] {
  const key = level.toLowerCase();
  return [
    {
      id: `${key}-disc-signal`,
      field: "findings",
      concept: "disc_signal",
      conflictGroup: "disc_signal",
      anatomicalSection: level,
      level,
      renderedText: `${level}: Intervertebral disc signal is preserved.`,
    },
    {
      id: `${key}-disc-height`,
      field: "findings",
      concept: "disc_height",
      conflictGroup: "disc_height",
      anatomicalSection: level,
      level,
      renderedText: `${level}: Intervertebral disc height is maintained.`,
    },
    {
      id: `${key}-disc-contour`,
      field: "findings",
      concept: "disc_contour",
      conflictGroup: "disc_contour",
      anatomicalSection: level,
      level,
      renderedText: `${level}: No significant disc bulge or protrusion is seen.`,
    },
    {
      id: `${key}-canal`,
      field: "findings",
      concept: "canal_stenosis",
      conflictGroup: "canal_stenosis",
      anatomicalSection: level,
      level,
      renderedText: `${level}: No spinal canal or thecal sac compression is seen.`,
    },
    {
      id: `${key}-foramina`,
      field: "findings",
      concept: "foraminal_stenosis",
      conflictGroup: "foraminal_stenosis",
      anatomicalSection: level,
      level,
      renderedText: `${level}: Neural foramina are patent bilaterally.`,
    },
    {
      id: `${key}-roots`,
      field: "findings",
      concept: "root_contact",
      conflictGroup: "root_contact",
      anatomicalSection: level,
      level,
      renderedText: `${level}: No exiting or traversing nerve root compression is seen.`,
    },
  ];
}

const CERVICAL_LEVEL_NORMALS = C_LEVELS.flatMap(levelNormals);

export const MRI_CERVICAL_STANDARD_NORMAL_FINDINGS = [
  ...CERVICAL_GENERAL_NORMALS.map((o) => o.renderedText),
  ...CERVICAL_LEVEL_NORMALS.map((o) => o.renderedText),
].join("\n");

export const MRI_CERVICAL_STANDARD_NORMAL_IMPRESSION =
  "Normal MRI of the cervical spine. No significant disc, canal, foraminal or cord compressive abnormality.";

export const MRI_CERVICAL_STANDARD_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-cervical-standard-normal-r1",
  observations: [
    ...CERVICAL_GENERAL_NORMALS,
    ...CERVICAL_LEVEL_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_CERVICAL_STANDARD_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_CERVICAL_STANDARD_NORMAL_META = {
  name: MRI_CERVICAL_STANDARD_NORMAL_NAME,
  bodyPart: "Cervical Spine",
  modality: "MR" as const,
  clinicalHistory: "MRI cervical spine requested. Correlate with neck pain or radicular symptoms.",
  technique:
    "MRI cervical spine on 3T. Sagittal T1W, T2W and STIR; axial T1W and T2W images were obtained.",
  recommendation: "Clinical correlation.",
  reportTitle: "MRI CERVICAL SPINE",
  findings: MRI_CERVICAL_STANDARD_NORMAL_FINDINGS,
  impression: MRI_CERVICAL_STANDARD_NORMAL_IMPRESSION,
  diagnosisTags: ["normal", "cervical"],
  manifest: MRI_CERVICAL_STANDARD_NORMAL_MANIFEST,
};
