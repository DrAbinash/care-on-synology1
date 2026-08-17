/**
 * MRI Lumbosacral Spine — CARE Standard, as configuration (not engine).
 * Cervical / knee / brain formats are the same document type with different data.
 */

import type { FormatField, FormatSection, StructuredFormatDoc } from "./types";
import { optionBundleById } from "./optionBundles";

const LEVELS = [
  { id: "l1-2", label: "L1-L2" },
  { id: "l2-3", label: "L2-L3" },
  { id: "l3-4", label: "L3-L4" },
  { id: "l4-5", label: "L4-L5" },
  { id: "l5-s1", label: "L5-S1" },
] as const;

const LEVEL_NORMAL =
  "Normal disc height and signal. No disc herniation. Neural foramina patent. No spinal canal stenosis.";

function bundleField(
  id: string,
  label: string,
  bundleId: string,
  extra: Partial<FormatField> = {},
): FormatField {
  const bundle = optionBundleById(bundleId)!;
  return {
    id,
    label,
    type: extra.type ?? "single_select",
    mutexGroup: extra.mutexGroup ?? bundle.mutexGroup,
    token: extra.token,
    combineMode: extra.combineMode,
    unit: extra.unit,
    options: extra.options ?? bundle.options,
    required: extra.required,
  };
}

function section(partial: Omit<FormatSection, "headingVisible" | "required" | "collapsedByDefault" | "defaultText"> & Partial<FormatSection>): FormatSection {
  return {
    headingVisible: true,
    required: false,
    collapsedByDefault: false,
    defaultText: partial.normalText ?? "",
    ...partial,
  };
}

export const MRI_LS_SPINE_CARE_STANDARD: StructuredFormatDoc = {
  schemaVersion: 2,
  technique: "MRI Lumbo-sacral Spine: T1W and T2W sagittal, T2W axial at disc levels.",
  tokens: ["level", "side", "severity", "measurement", "unit", "root", "grade", "effect"],
  mutexGroups: [
    { id: "normal-abnormal", mode: "normal-clears-abnormal" },
    { id: "disc-morphology", mode: "exclusive" },
    { id: "alignment-shape", mode: "exclusive" },
    { id: "laterality", mode: "exclusive" },
    { id: "canal-stenosis", mode: "exclusive" },
    { id: "severity", mode: "exclusive" },
  ],
  repeatingGroupDefs: [
    {
      id: "lumbar-disc-level",
      label: "Lumbar disc level",
      itemToken: "level",
      items: LEVELS.map((l) => ({ id: l.id, label: l.label })),
    },
  ],
  sections: [
    section({
      id: "alignment",
      label: "Alignment & Curvature",
      contributesTo: ["findings"],
      normalText: "Normal lumbar lordosis maintained. No scoliosis or listhesis.",
      fields: [
        {
          id: "alignment-status",
          label: "Alignment",
          type: "single_select",
          mutexGroup: "alignment-shape",
          options: [
            {
              id: "normal-lordosis",
              label: "Normal lordosis",
              value: "normal-lordosis",
              severity: "normal",
              canonicalKey: "lumbar.lordosis.normal",
              mutexGroup: "alignment-shape",
              impressionWeight: 0,
            },
            {
              id: "loss-of-lordosis",
              label: "Loss of lordosis",
              value: "loss-of-lordosis",
              severity: "mild",
              canonicalKey: "lumbar.loss_of_lordosis",
              outputSentence: "Loss of lumbar lordosis is seen.",
              impressionSentence: "Loss of lumbar lordosis.",
              impressionWeight: 0.45,
              mutexGroup: "alignment-shape",
            },
            {
              id: "scoliosis",
              label: "Scoliosis",
              value: "scoliosis",
              severity: "mild",
              canonicalKey: "lumbar.scoliosis",
              outputSentence: "Scoliosis of the lumbar spine is seen.",
              impressionSentence: "Lumbar scoliosis.",
              impressionWeight: 0.5,
              mutexGroup: "alignment-shape",
            },
            {
              id: "listhesis",
              label: "Listhesis",
              value: "listhesis",
              severity: "moderate",
              canonicalKey: "lumbar.listhesis",
              outputSentence: "Listhesis is seen.",
              impressionSentence: "Lumbar listhesis.",
              impressionWeight: 0.7,
              mutexGroup: "alignment-shape",
            },
          ],
        },
      ],
    }),
    section({
      id: "vertebra",
      label: "Vertebral Bodies",
      contributesTo: ["findings"],
      normalText: "Normal height, signal and morphology throughout. No marrow infiltration or compression fracture.",
      fields: [
        bundleField("vertebra-status", "Vertebra", "normal-abnormal", { type: "normal_abnormal" }),
        {
          id: "vertebra-finding",
          label: "Finding",
          type: "multi_select",
          combineMode: "separate_sentences",
          mutexGroup: "normal-abnormal",
          options: [
            {
              id: "compression",
              label: "Compression",
              value: "compression",
              severity: "moderate",
              canonicalKey: "vertebra.compression",
              outputSentence: "Vertebral body compression is seen.",
              impressionSentence: "Vertebral compression.",
              impressionWeight: 0.8,
            },
            {
              id: "modic",
              label: "Modic changes",
              value: "modic",
              severity: "mild",
              canonicalKey: "vertebra.modic",
              outputSentence: "Modic endplate changes are seen.",
              impressionSentence: "Modic changes.",
              impressionWeight: 0.4,
            },
            {
              id: "hemangioma",
              label: "Hemangioma",
              value: "hemangioma",
              severity: "mild",
              canonicalKey: "vertebra.hemangioma",
              outputSentence: "A vertebral hemangioma is seen.",
              impressionSentence: "Vertebral hemangioma.",
              impressionWeight: 0.3,
            },
            {
              id: "schmorl",
              label: "Schmorl node",
              value: "schmorl",
              severity: "mild",
              canonicalKey: "vertebra.schmorl",
              outputSentence: "Schmorl nodes are seen.",
              impressionSentence: "Schmorl nodes.",
              impressionWeight: 0.25,
            },
          ],
        },
      ],
    }),
    section({
      id: "discs",
      label: "Intervertebral discs",
      contributesTo: ["findings", "impression"],
      normalText: LEVEL_NORMAL,
      repeat: { groupId: "lumbar-disc-level" },
      fields: [
        bundleField("disc-normal", "Status", "normal-abnormal", { type: "normal_abnormal" }),
        bundleField("disc-morphology", "Disc morphology", "disc-morphology", { type: "single_select" }),
        {
          id: "desiccation",
          label: "Disc desiccation",
          type: "toggle",
          options: [
            {
              id: "yes",
              label: "Disc desiccation",
              value: "yes",
              severity: "mild",
              canonicalKey: "disc.desiccation",
              outputSentence: "Disc desiccation is seen at {level}.",
              impressionWeight: 0,
            },
          ],
        },
        {
          id: "height-reduction",
          label: "Disc height reduction",
          type: "toggle",
          options: [
            {
              id: "yes",
              label: "Disc height reduction",
              value: "yes",
              severity: "mild",
              canonicalKey: "disc.height_reduction",
              outputSentence: "Disc space reduction is seen at {level}.",
              impressionWeight: 0,
            },
          ],
        },
        bundleField("severity", "Severity", "severity", { type: "single_select", token: "severity" }),
        bundleField("laterality", "Side", "laterality", { type: "laterality", token: "side" }),
        bundleField("canal-stenosis", "Canal stenosis", "canal-stenosis", { type: "single_select" }),
        {
          id: "canal-diameter",
          label: "AP canal diameter",
          type: "measurement",
          unit: "mm",
          token: "measurement",
          options: [
            {
              id: "mm",
              label: "mm",
              value: "mm",
              outputSentence: "AP canal diameter at {level} measures {measurement} mm.",
              impressionWeight: 0,
            },
          ],
        },
        {
          id: "foraminal",
          label: "Foraminal narrowing",
          type: "toggle",
          options: [
            {
              id: "yes",
              label: "Foraminal narrowing",
              value: "yes",
              severity: "moderate",
              canonicalKey: "foramina.narrowing",
              outputSentence: "Neural foraminal narrowing is seen at {level}[ ({side})].",
              impressionSentence: "{level} neural foraminal narrowing.",
              impressionWeight: 0.65,
            },
          ],
        },
        {
          id: "exiting-root",
          label: "Exiting nerve root",
          type: "toggle",
          token: "root",
          options: [
            {
              id: "yes",
              label: "Exiting root impingement",
              value: "yes",
              severity: "moderate",
              canonicalKey: "root.exiting",
              outputSentence: "Exiting nerve root impingement is seen at {level}[ ({side})].",
              impressionSentence: "{level} exiting nerve root impingement.",
              impressionWeight: 0.85,
            },
          ],
        },
        {
          id: "traversing-root",
          label: "Traversing nerve root",
          type: "toggle",
          options: [
            {
              id: "yes",
              label: "Traversing root impingement",
              value: "yes",
              severity: "moderate",
              canonicalKey: "root.traversing",
              outputSentence: "Traversing nerve root impingement is seen at {level}[ ({side})].",
              impressionSentence: "{level} traversing nerve root impingement.",
              impressionWeight: 0.85,
            },
          ],
        },
      ],
    }),
    section({
      id: "posterior",
      label: "Posterior elements",
      contributesTo: ["findings"],
      normalText: "Posterior elements are intact.",
      fields: [
        {
          id: "facet",
          label: "Facet arthropathy",
          type: "toggle",
          options: [
            {
              id: "yes",
              label: "Facet arthropathy",
              value: "yes",
              severity: "mild",
              canonicalKey: "facet.arthropathy",
              outputSentence: "Facet joint arthropathy is seen.",
              impressionSentence: "Facet arthropathy.",
              impressionWeight: 0.35,
            },
          ],
        },
        {
          id: "lf",
          label: "Ligamentum flavum hypertrophy",
          type: "toggle",
          options: [
            {
              id: "yes",
              label: "Ligamentum flavum hypertrophy",
              value: "yes",
              severity: "mild",
              canonicalKey: "lf.hypertrophy",
              outputSentence: "Ligamentum flavum hypertrophy is seen.",
              impressionSentence: "Ligamentum flavum hypertrophy.",
              impressionWeight: 0.35,
            },
          ],
        },
      ],
    }),
    section({
      id: "facets",
      label: "Facet Joints",
      contributesTo: ["findings"],
      normalText: "Facet joints are unremarkable at the imaged levels. No significant arthropathy.",
      fields: [],
    }),
    section({
      id: "lf-section",
      label: "Ligamentum Flavum",
      contributesTo: ["findings"],
      normalText: "No significant ligamentum flavum hypertrophy.",
      fields: [],
    }),
    section({
      id: "canal",
      label: "Spinal Canal",
      contributesTo: ["findings"],
      normalText: "Spinal canal of adequate dimensions at all levels. No significant central stenosis.",
      fields: [],
    }),
    section({
      id: "conus",
      label: "Cord / Cauda Equina",
      contributesTo: ["findings"],
      normalText: "Cord terminates at L1-L2 level. Normal signal. Cauda equina nerve roots appear normal.",
      fields: [
        bundleField("conus-status", "Conus", "normal-abnormal", { type: "normal_abnormal" }),
      ],
    }),
    section({
      id: "paraspinal",
      label: "Paraspinal Soft Tissues",
      contributesTo: ["findings"],
      normalText: "Paraspinal soft tissues are unremarkable. No collection or mass.",
      fields: [],
    }),
  ],
};

export const MRI_LS_SPINE_CARE_STANDARD_META = {
  templateName: "MRI Lumbosacral Spine – CARE Standard",
  modality: "MRI",
  bodyPart: "SPINE_LS",
  studyType: "PLAIN",
  defaultFindings:
    "Lumbar lordosis is preserved. Vertebral body heights and marrow signal are maintained throughout. Disc heights and signal intensity are preserved at all levels. No disc herniation, bulge or extrusion. Facet joints and ligamentum flavum are unremarkable. Neural foramina are patent bilaterally at all levels. Spinal canal of adequate dimensions. Cauda equina nerve roots appear normal. Paraspinal soft tissues are unremarkable.",
  defaultImpression:
    "Normal MRI Lumbo-sacral Spine. No disc herniation, nerve root compression or spinal canal stenosis.",
};
