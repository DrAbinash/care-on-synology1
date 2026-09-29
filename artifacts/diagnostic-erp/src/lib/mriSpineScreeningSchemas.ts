/**
 * mriSpineScreeningSchemas.ts — the three limited spine screening clinical
 * schemas as pure data (spec §22, §24-§27; flags per §29-§32).
 *
 * Three clinically distinct palettes, one schema-driven engine
 * (`mriSpineScreening.ts`). Section order is the report order; option ids are
 * the contract the engine and tests key off, so they are load-bearing.
 *
 * Prose rule: `prose` is only ever a sentence copied verbatim from the owned
 * screening baselines (`zai-workspace/baselines/mri*ScreeningNormal.ts`) or the
 * screening entries of `zai-workspace/report-formats-library.ts`, with an
 * explicit level string optionally replaced by `{level}`. No clinical wording is
 * written here: where CARE ships no sentence, `prose` is omitted and the engine
 * renders "<Section>: <label>" from the radiologist's own selection.
 *
 * Screening stays coarse by design (spec §24-§26): no lateral-recess grading, no
 * facet analysis, no per-level AP measurement, no exiting/traversing root engine.
 */

import {
  CERVICAL_SCREENING_LEVELS,
  THORACIC_SCREENING_LEVELS,
  type RegionScreeningSchema,
  type SpineScreeningRegion,
} from "./mriSpineScreeningSchema";
import { MRI_CERVICAL_SCREENING_NORMAL_MANIFEST } from "./zai-workspace/baselines/mriCervicalScreeningNormal";
import { MRI_DORSAL_SCREENING_NORMAL_MANIFEST } from "./zai-workspace/baselines/mriDorsalScreeningNormal";
import { MRI_LS_SCREENING_NORMAL_MANIFEST } from "./zai-workspace/baselines/mriLsScreeningNormal";

/**
 * `normalPreset.lines` are the shipped sentences themselves, never retyped here.
 * The limitation line is skipped on purpose — spec §29 makes it an emitter-level
 * rule generated once per report, not a per-region screening sentence.
 */
function shippedNormalLines(manifest: {
  observations: Array<{ field: string; concept: string; renderedText: string }>;
}): string[] {
  return manifest.observations
    .filter((o) => o.field === "findings" && o.concept !== "screening_limitation")
    .map((o) => o.renderedText);
}

const CERVICAL_NORMAL_LINES = shippedNormalLines(MRI_CERVICAL_SCREENING_NORMAL_MANIFEST);
const DORSAL_NORMAL_LINES = shippedNormalLines(MRI_DORSAL_SCREENING_NORMAL_MANIFEST);
const LS_NORMAL_LINES = shippedNormalLines(MRI_LS_SCREENING_NORMAL_MANIFEST);

// Shared by all three schemas: LS levels come from the LumbarNumberingResolver at
// runtime (levelChoices "lumbar-resolver"), so `lumbar` stays empty here.
const SCREENING_LEVEL_OPTIONS = {
  cervical: CERVICAL_SCREENING_LEVELS,
  thoracic: THORACIC_SCREENING_LEVELS,
  lumbar: [],
};

// Spec §35: screening is a plain examination, so no screening option carries
// `requires` — nothing here may be stated only because contrast was given.

export const SCREENING_SCHEMAS: Record<SpineScreeningRegion, RegionScreeningSchema> = {
  // ── §24 MRI Cervical Spine Screening ─────────────────────────────────
  cervical: {
    region: "cervical",
    label: "Cervical Spine Screening",
    heading: "CERVICAL SPINE SCREENING",
    recommendation: "Dedicated MRI cervical spine suggested.",
    levelOptions: SCREENING_LEVEL_OPTIONS,
    sections: [
      {
        key: "alignment",
        label: "Alignment",
        options: [
          {
            id: "normal",
            label: "Normal cervical lordosis",
            concept: "alignment",
            normal: true,
            // source: zai-workspace/baselines/mriCervicalScreeningNormal.ts
            prose: "Cervical alignment is within normal limits on screening sequences.",
          },
          {
            id: "loss_of_lordosis",
            label: "Loss/straightening of lordosis",
            concept: "alignment",
            // source: zai-workspace/report-formats-library.ts — "MRI LS Spine + Whole Spine Screening"
            prose: "Loss of normal cervical lordosis.",
          },
          { id: "reversal", label: "Reversal of lordosis", concept: "alignment" },
          { id: "gross_listhesis", label: "Gross listhesis", concept: "spondylolisthesis" },
          { id: "other", label: "Other gross alignment abnormality", concept: "alignment" },
        ],
      },
      {
        key: "bodies_marrow",
        label: "Vertebral Bodies / Marrow",
        options: [
          {
            id: "heights_maintained",
            label: "Heights maintained",
            concept: "compression_fracture",
            normal: true,
            // source: zai-workspace/baselines/mriCervicalScreeningNormal.ts
            prose: "Cervical vertebral bodies show normal height and marrow signal on screening images.",
          },
          { id: "compression_deformity", label: "Compression deformity", concept: "compression_fracture", significant: true },
          { id: "focal_marrow", label: "Focal marrow signal abnormality", concept: "bone_lesion", significant: true },
          { id: "multilevel_endplate_change", label: "Multilevel degenerative endplate change", concept: "endplate" },
          { id: "other_osseous", label: "Other significant osseous abnormality", concept: "bone_lesion" },
        ],
      },
      {
        key: "discs",
        label: "Discs",
        options: [
          {
            id: "none",
            label: "No significant disc abnormality",
            concept: "disc_contour",
            normal: true,
            // source: zai-workspace/baselines/mriCervicalScreeningNormal.ts
            prose: "No significant disc herniation is identified on screening sequences.",
          },
          { id: "desiccation", label: "Disc desiccation", concept: "disc_signal" },
          { id: "height_loss", label: "Reduced disc height", concept: "disc_height", levelChoices: "cervical" },
          {
            id: "mild_bulge",
            label: "Mild disc bulge",
            concept: "disc_contour",
            levelChoices: "cervical",
            // source: zai-workspace/report-formats-library.ts — "MRI Whole Spine Screening — Cervical + Dorsal"
            // ("Mild disc bulge at C4-C5, C5-C6 and C6-C7.")
            prose: "Mild disc bulge at {level}.",
          },
          {
            id: "significant_bulge",
            label: "Significant disc bulge",
            concept: "disc_contour",
            levelChoices: "cervical",
            levelRequired: true,
            // source: zai-workspace/report-formats-library.ts — "MRI LS Spine + Whole Spine Screening"
            // ("C4-C5 and C5-C6: diffuse disc bulge with anterior thecal sac compression.")
            prose: "{level}: diffuse disc bulge with anterior thecal sac compression.",
          },
          { id: "focal_protrusion", label: "Focal protrusion", concept: "disc_contour", levelChoices: "cervical", levelRequired: true },
          { id: "multilevel_dd", label: "Multilevel degenerative disc disease", concept: "disc_contour", levelChoices: "cervical" },
        ],
      },
      {
        key: "canal",
        label: "Central Canal",
        options: [
          {
            id: "no_stenosis",
            label: "No gross canal stenosis",
            concept: "canal_stenosis",
            normal: true,
            // source: zai-workspace/baselines/mriCervicalScreeningNormal.ts
            prose: "No gross spinal canal stenosis is seen.",
          },
          { id: "mild", label: "Mild narrowing", concept: "canal_stenosis" },
          { id: "moderate", label: "Moderate/significant stenosis", concept: "canal_stenosis" },
          { id: "severe", label: "Severe stenosis", concept: "canal_stenosis", significant: true },
        ],
      },
      {
        key: "cord",
        label: "Spinal Cord",
        options: [
          {
            id: "normal",
            label: "Normal gross morphology/signal",
            concept: "cord_signal",
            normal: true,
            // source: zai-workspace/baselines/mriCervicalScreeningNormal.ts
            prose: "No gross cord signal abnormality is identified.",
          },
          { id: "indentation", label: "Cord indentation", concept: "cord_compression" },
          { id: "compression", label: "Cord compression", concept: "cord_compression", significant: true },
          { id: "focal_signal", label: "Focal T2/STIR signal abnormality", concept: "cord_signal", significant: true },
          { id: "diffuse_signal", label: "Diffuse signal abnormality", concept: "cord_signal", significant: true },
          { id: "suspected_myelopathy", label: "Suspected myelopathy", concept: "cord_signal", significant: true },
          { id: "syrinx", label: "Syrinx (if evident)", concept: "syrinx", significant: true },
        ],
      },
      {
        key: "ccj",
        label: "Craniocervical Junction",
        options: [
          { id: "unremarkable", label: "Grossly unremarkable", concept: "craniocervical_junction", normal: true },
          { id: "tonsillar_descent", label: "Tonsillar descent / suspected Chiari", concept: "craniocervical_junction", significant: true },
          { id: "other", label: "Other significant abnormality", concept: "craniocervical_junction" },
        ],
      },
    ],
    normalPreset: {
      id: "screen-normal-cervical",
      label: "Normal Cervical Spine Screening",
      selections: {
        alignment: "normal",
        bodies_marrow: "heights_maintained",
        discs: "none",
        canal: "no_stenosis",
        cord: "normal",
        // No shipped CCJ sentence (§27), but the section still has its normal choice.
        ccj: "unremarkable",
      },
      lines: CERVICAL_NORMAL_LINES,
    },
  },

  // ── §25 MRI Dorsal / Thoracic Spine Screening ────────────────────────
  dorsal: {
    region: "dorsal",
    label: "Dorsal Spine Screening",
    heading: "DORSAL SPINE SCREENING",
    recommendation: "Dedicated MRI dorsal spine suggested.",
    levelOptions: SCREENING_LEVEL_OPTIONS,
    sections: [
      {
        key: "alignment",
        label: "Alignment",
        options: [
          {
            id: "normal",
            label: "Normal alignment",
            concept: "alignment",
            normal: true,
            // source: zai-workspace/baselines/mriDorsalScreeningNormal.ts
            prose: "Dorsal alignment is within normal limits on screening sequences.",
          },
          { id: "altered_kyphosis", label: "Altered kyphosis", concept: "alignment" },
          { id: "scoliosis", label: "Scoliosis", concept: "alignment" },
          { id: "gross_deformity", label: "Gross deformity", concept: "alignment" },
        ],
      },
      {
        key: "bodies_marrow",
        label: "Vertebral Bodies / Marrow",
        options: [
          {
            id: "heights_maintained",
            label: "Heights maintained",
            concept: "compression_fracture",
            normal: true,
            // source: zai-workspace/baselines/mriDorsalScreeningNormal.ts
            prose: "Dorsal vertebral bodies show normal height and marrow signal on screening images.",
          },
          { id: "compression_deformity", label: "Compression deformity", concept: "compression_fracture", significant: true },
          { id: "focal_marrow", label: "Focal marrow abnormality", concept: "bone_lesion", significant: true },
          { id: "multifocal_marrow", label: "Multifocal marrow abnormality", concept: "bone_lesion", significant: true },
          { id: "degenerative_endplate", label: "Degenerative endplate change", concept: "endplate" },
          { id: "other_osseous", label: "Other significant osseous abnormality", concept: "bone_lesion" },
        ],
      },
      {
        key: "discs",
        label: "Discs",
        options: [
          {
            id: "none",
            label: "No significant disc abnormality",
            concept: "disc_contour",
            normal: true,
            // source: zai-workspace/baselines/mriDorsalScreeningNormal.ts
            prose: "No significant disc herniation is identified on screening sequences.",
          },
          { id: "degeneration", label: "Disc degeneration", concept: "disc_signal", levelChoices: "thoracic" },
          { id: "bulge", label: "Disc bulge", concept: "disc_contour", levelChoices: "thoracic" },
          { id: "focal_protrusion", label: "Focal protrusion", concept: "disc_contour", levelChoices: "thoracic" },
          { id: "significant_disc", label: "Significant disc disease", concept: "disc_contour", levelChoices: "thoracic" },
        ],
      },
      {
        key: "canal",
        label: "Spinal Canal",
        options: [
          {
            id: "no_stenosis",
            label: "No gross stenosis",
            concept: "canal_stenosis",
            normal: true,
            // source: zai-workspace/baselines/mriDorsalScreeningNormal.ts
            prose: "No gross spinal canal stenosis is seen.",
          },
          { id: "mild", label: "Mild narrowing", concept: "canal_stenosis" },
          { id: "significant", label: "Significant stenosis", concept: "canal_stenosis" },
          { id: "severe", label: "Severe stenosis", concept: "canal_stenosis", significant: true },
        ],
      },
      {
        key: "cord",
        label: "Spinal Cord",
        options: [
          {
            id: "normal",
            label: "Normal gross morphology/signal",
            concept: "cord_signal",
            normal: true,
            // source: zai-workspace/baselines/mriDorsalScreeningNormal.ts
            prose: "No gross cord signal abnormality is identified.",
          },
          { id: "indentation", label: "Cord indentation", concept: "cord_compression" },
          { id: "compression", label: "Cord compression", concept: "cord_compression", significant: true },
          { id: "focal_signal", label: "Focal T2/STIR hyperintensity", concept: "cord_signal", significant: true },
          { id: "diffuse_signal", label: "Diffuse signal abnormality", concept: "cord_signal", significant: true },
          { id: "suspected_myelopathy", label: "Suspected myelopathy", concept: "cord_signal", significant: true },
          { id: "syrinx", label: "Syrinx", concept: "syrinx", significant: true },
        ],
      },
      {
        key: "other",
        label: "Other Important Screening Findings",
        // No normal option here (§25): the preset asserts nothing about the
        // paraspinal/epidural territory rather than inventing a negative claim.
        options: [
          { id: "epidural_abnormality", label: "Gross epidural abnormality", concept: "epidural_collection", significant: true },
          { id: "paravertebral_abnormality", label: "Significant paravertebral abnormality", concept: "paravertebral_collection", significant: true },
          { id: "obvious_focal_lesion", label: "Obvious focal lesion", concept: "bone_lesion", significant: true },
        ],
      },
    ],
    normalPreset: {
      id: "screen-normal-dorsal",
      label: "Normal Dorsal Spine Screening",
      selections: {
        alignment: "normal",
        bodies_marrow: "heights_maintained",
        discs: "none",
        canal: "no_stenosis",
        cord: "normal",
      },
      lines: DORSAL_NORMAL_LINES,
    },
  },

  // ── §26 MRI LS / Lumbosacral Spine Screening ─────────────────────────
  ls: {
    region: "ls",
    label: "LS Spine Screening",
    heading: "LUMBOSACRAL SPINE SCREENING",
    recommendation: "Dedicated MRI LS spine suggested.",
    levelOptions: SCREENING_LEVEL_OPTIONS,
    sections: [
      {
        key: "alignment",
        label: "Alignment",
        options: [
          {
            id: "normal_lordosis",
            label: "Normal lumbar lordosis",
            concept: "alignment",
            normal: true,
            // source: zai-workspace/baselines/mriLsScreeningNormal.ts
            prose: "Lumbar alignment is within normal limits on screening sequences.",
          },
          {
            id: "loss_of_lordosis",
            label: "Loss/straightening of lordosis",
            concept: "alignment",
            // source: zai-workspace/report-formats-library.ts — "MRI LS Spine + Whole Spine Screening"
            prose: "Loss of normal lumbar lordosis.",
          },
          { id: "gross_scoliosis", label: "Gross scoliosis", concept: "alignment" },
          { id: "gross_listhesis", label: "Gross listhesis", concept: "spondylolisthesis" },
        ],
      },
      {
        key: "bodies_marrow",
        label: "Vertebral Bodies / Marrow",
        options: [
          {
            id: "heights_maintained",
            label: "Heights maintained",
            concept: "compression_fracture",
            normal: true,
            // source: zai-workspace/baselines/mriLsScreeningNormal.ts
            prose: "Lumbar vertebral bodies show normal height and marrow signal on screening images.",
          },
          { id: "compression_deformity", label: "Compression deformity", concept: "compression_fracture", significant: true },
          { id: "focal_marrow", label: "Focal marrow abnormality", concept: "bone_lesion", significant: true },
          { id: "degenerative_endplate", label: "Degenerative endplate changes", concept: "endplate" },
          { id: "other_osseous", label: "Other significant osseous abnormality", concept: "bone_lesion" },
        ],
      },
      {
        key: "discs",
        label: "Discs",
        options: [
          {
            id: "none",
            label: "No significant disc abnormality",
            concept: "disc_contour",
            normal: true,
            // source: zai-workspace/baselines/mriLsScreeningNormal.ts
            prose: "No significant disc herniation is identified on screening sequences.",
          },
          {
            id: "desiccation",
            label: "Disc desiccation",
            concept: "disc_signal",
            levelChoices: "lumbar-resolver",
            // source: zai-workspace/report-formats-library.ts — "MRI LS Spine + Whole Spine Screening"
            // ("Disc desiccation at L4-L5 and L5-S1.")
            prose: "Disc desiccation at {level}.",
          },
          { id: "height_loss", label: "Reduced disc height", concept: "disc_height", levelChoices: "lumbar-resolver" },
          { id: "diffuse_bulge", label: "Diffuse bulge", concept: "disc_contour", levelChoices: "lumbar-resolver" },
          { id: "focal_protrusion_extrusion", label: "Focal protrusion/extrusion", concept: "disc_contour", levelChoices: "lumbar-resolver" },
          { id: "multilevel_dd", label: "Multilevel degenerative disc disease", concept: "disc_contour", levelChoices: "lumbar-resolver" },
        ],
      },
      {
        key: "canal",
        label: "Spinal Canal",
        options: [
          {
            id: "no_stenosis",
            label: "No gross stenosis",
            concept: "canal_stenosis",
            normal: true,
            // source: zai-workspace/baselines/mriLsScreeningNormal.ts
            prose: "No gross spinal canal stenosis is seen.",
          },
          { id: "mild", label: "Mild narrowing", concept: "canal_stenosis" },
          { id: "moderate", label: "Moderate/significant stenosis", concept: "canal_stenosis" },
          { id: "severe", label: "Severe stenosis", concept: "canal_stenosis", significant: true },
        ],
      },
      {
        key: "conus_cauda",
        label: "Conus / Cauda Equina",
        options: [
          {
            id: "grossly_normal",
            label: "Grossly normal",
            concept: "conus_medullaris",
            normal: true,
            // source: zai-workspace/baselines/mriLsScreeningNormal.ts
            prose: "Conus medullaris appears normal on screening images.",
          },
          { id: "low_lying_conus", label: "Low-lying conus", concept: "conus_medullaris", significant: true },
          { id: "conus_signal", label: "Conus signal abnormality", concept: "conus_medullaris", significant: true },
          { id: "cauda_crowding_compression", label: "Gross cauda equina crowding/compression", concept: "cauda_equina", significant: true },
          { id: "other", label: "Other significant abnormality", concept: "cauda_equina" },
        ],
      },
      {
        key: "foraminal_root",
        label: "Foraminal / Root Effect",
        // Broad screening-level wording only, and every choice is axial-dependent:
        // limited sagittal-only screening may not produce these conclusions (§26/§32).
        options: [
          { id: "no_stenosis", label: "No gross foraminal stenosis", concept: "foraminal_stenosis", normal: true, axialDependent: true },
          { id: "significant_stenosis", label: "Significant foraminal stenosis", concept: "foraminal_stenosis", axialDependent: true },
          { id: "suspected_neural_compression", label: "Suspected neural compression", concept: "root_contact", axialDependent: true, significant: true },
        ],
      },
    ],
    normalPreset: {
      id: "screen-normal-ls",
      label: "Normal LS Spine Screening",
      selections: {
        alignment: "normal_lordosis",
        bodies_marrow: "heights_maintained",
        discs: "none",
        canal: "no_stenosis",
        conus_cauda: "grossly_normal",
        // foraminal_root is axial-dependent (§32), so the normal preset never
        // asserts it; the shipped LS baseline carries no sentence for it either.
      },
      lines: LS_NORMAL_LINES,
    },
  },
};

function sectionLabelsOf(schema: RegionScreeningSchema): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const section of schema.sections) labels[section.key] = section.label;
  return labels;
}

/** Derived from the schemas so panel headings can never drift from the data. */
export const SPINE_SCREENING_SECTION_LABELS: Record<SpineScreeningRegion, Record<string, string>> = {
  cervical: sectionLabelsOf(SCREENING_SCHEMAS.cervical),
  dorsal: sectionLabelsOf(SCREENING_SCHEMAS.dorsal),
  ls: sectionLabelsOf(SCREENING_SCHEMAS.ls),
};
