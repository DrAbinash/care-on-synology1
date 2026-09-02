/**
 * Clinical Anatomy Context — universal cross-region catalog of clinical
 * anatomical sections and their associated observation concepts.
 *
 * Derived from the DrAbinash/mri-reports reference library (curated from
 * the doctor's own clinic report formats) and cross-referenced against
 * CARE's existing observationSlot.ts / quick-select-tiles / findingsMacros.
 *
 * Architecture (§10):
 *   ReportingStudyContext (region)
 *     → ClinicalAnatomyContext (region → anatomical sections → concepts)
 *       → CanonicalObservation (region + concept + level + laterality)
 *
 * This module is a READ-ONLY reference catalog. It does NOT replace
 * ReportingStudyContext, does NOT replace the observation ledger, and does
 * NOT introduce a new clinical state model. It is consumed by:
 *   - the Finding Composer (to suggest concepts for a selected region)
 *   - the Quick Select library (to validate concept/region pairings)
 *   - the AI persona router (future — to provide anatomy-grounded context)
 *
 * PR: overnight structural integration batch.
 */

export type ClinicalConceptEntry = {
  /** Canonical concept identifier (matches CanonicalObservation.concept). */
  concept: string;
  /** Human-readable label for UI display. */
  label: string;
  /** Clinical category: normal | abnormal | critical. */
  category: "normal" | "abnormal" | "critical";
  /** Whether this concept is level-specific (spine) or region-wide (brain). */
  levelSpecific: boolean;
  /** Whether laterality applies. */
  lateralityApplicable: boolean;
  /** Whether severity is a meaningful axis. */
  severityApplicable: boolean;
  /** Default conflictGroup (matches CARE's observationSlot conflictGroup). */
  conflictGroup: string;
  /** Source provenance — developer-only metadata. Never exposed in reports. */
  referenceSource?: "mri-reports" | "care-catalog" | "clinic-format" | "both";
};

export type ClinicalAnatomySection = {
  /** Section name (e.g. "White Matter", "Intervertebral Disc"). */
  name: string;
  /** Concepts that belong to this anatomical section. */
  concepts: ClinicalConceptEntry[];
};

export type ClinicalRegionAnatomy = {
  /** Region name (matches ReportingStudyContext.region). */
  region: string;
  /** Anatomical sections within this region. */
  sections: ClinicalAnatomySection[];
};

// ─── Brain anatomy ────────────────────────────────────────────────────────
// Section ordering follows the doctor's actual clinic report formats
// (docs/mri-report-formats/mri brain normal 3T, FAZEKAS GRADE 1, etc.).
// The clinic consistently uses: Cerebral Hemispheres → Parenchymal Signal →
// Ventricular System → Midline → Deep Gray Matter → Posterior Fossa →
// Sellar & Parasellar → Orbit & Sinuses → (Mesial Temporal for epilepsy) →
// Extra-axial.

export const BRAIN_ANATOMY: ClinicalRegionAnatomy = {
  region: "Brain",
  sections: [
    {
      name: "Cerebral Hemispheres",
      concepts: [
        {
          concept: "parenchyma",
          label: "Brain Parenchyma",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "parenchyma",
          referenceSource: "clinic-format",
        },
        {
          concept: "atrophy",
          label: "Cerebral Atrophy",
          category: "abnormal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: true,
          conflictGroup: "atrophy",
          referenceSource: "both",
        },
      ],
    },
    {
      name: "Parenchymal Signal",
      concepts: [
        {
          concept: "fazekas",
          label: "Fazekas Grade",
          category: "abnormal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: true,
          conflictGroup: "fazekas",
          referenceSource: "both",
        },
        {
          concept: "wmh",
          label: "White Matter Hyperintensities",
          category: "abnormal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: true,
          conflictGroup: "fazekas",
          referenceSource: "both",
        },
        {
          concept: "svd",
          label: "Small Vessel Ischemic Changes",
          category: "abnormal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "fazekas",
          referenceSource: "clinic-format",
        },
        {
          concept: "infarct",
          label: "Infarct",
          category: "critical",
          levelSpecific: false,
          lateralityApplicable: true,
          severityApplicable: false,
          conflictGroup: "infarct",
          referenceSource: "both",
        },
        {
          concept: "hemorrhage",
          label: "Hemorrhage",
          category: "critical",
          levelSpecific: false,
          lateralityApplicable: true,
          severityApplicable: false,
          conflictGroup: "hemorrhage",
          referenceSource: "both",
        },
        {
          concept: "dwi",
          label: "Diffusion Imaging (DWI/ADC)",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "dwi",
          referenceSource: "clinic-format",
        },
        {
          concept: "swi",
          label: "Susceptibility Imaging (SWI/GRE)",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "swi",
          referenceSource: "clinic-format",
        },
      ],
    },
    {
      name: "Ventricular System & CSF Spaces",
      concepts: [
        {
          concept: "ventricles",
          label: "Ventricles",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "ventricular",
          referenceSource: "both",
        },
        {
          concept: "hydrocephalus",
          label: "Hydrocephalus",
          category: "abnormal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "hydrocephalus",
          referenceSource: "both",
        },
      ],
    },
    {
      name: "Midline Structures",
      concepts: [
        {
          concept: "midline",
          label: "Midline Structures",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "midline",
          referenceSource: "clinic-format",
        },
      ],
    },
    {
      name: "Deep Gray Matter Structures",
      concepts: [
        {
          concept: "basal_ganglia",
          label: "Basal Ganglia & Thalami",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "basal_ganglia",
          referenceSource: "clinic-format",
        },
        {
          concept: "corpus_callosum",
          label: "Corpus Callosum",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "corpus_callosum",
          referenceSource: "clinic-format",
        },
      ],
    },
    {
      name: "Posterior Fossa",
      concepts: [
        {
          concept: "posterior_fossa",
          label: "Brainstem & Cerebellum",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "posterior_fossa",
          referenceSource: "clinic-format",
        },
        {
          concept: "cord",
          label: "Brainstem (Cord Signal)",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "cord",
          referenceSource: "clinic-format",
        },
      ],
    },
    {
      name: "Sellar & Parasellar Regions",
      concepts: [
        {
          concept: "sella",
          label: "Sella & Pituitary",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "sella",
          referenceSource: "clinic-format",
        },
        {
          concept: "empty_sella",
          label: "Empty Sella",
          category: "abnormal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "empty_sella",
          referenceSource: "clinic-format",
        },
      ],
    },
    {
      name: "Orbit & Paranasal Sinuses",
      concepts: [
        {
          concept: "sinus",
          label: "Paranasal Sinuses",
          category: "abnormal",
          levelSpecific: false,
          lateralityApplicable: true,
          severityApplicable: false,
          conflictGroup: "sinus",
          referenceSource: "both",
        },
        {
          concept: "orbital",
          label: "Orbits",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: true,
          severityApplicable: false,
          conflictGroup: "orbital",
          referenceSource: "both",
        },
      ],
    },
    {
      name: "Mesial Temporal Structures",
      concepts: [
        {
          concept: "hippocampus",
          label: "Hippocampus",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: true,
          severityApplicable: false,
          conflictGroup: "hippocampus",
          referenceSource: "clinic-format",
        },
      ],
    },
    {
      name: "Extra-axial",
      concepts: [
        {
          concept: "mass",
          label: "Mass Lesion",
          category: "critical",
          levelSpecific: false,
          lateralityApplicable: true,
          severityApplicable: false,
          conflictGroup: "mass",
          referenceSource: "both",
        },
        {
          concept: "dural_tail",
          label: "Dural Tail",
          category: "abnormal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "dural_tail",
          referenceSource: "clinic-format",
        },
      ],
    },
  ],
};

// ─── LS Spine anatomy ────────────────────────────────────────────────────
// Section ordering follows the doctor's actual clinic report formats
// (docs/mri-report-formats/ls spine with wss AI.docx, LS SPINE FINDING SEVERE.docx).
// The clinic uses: Alignment → Vertebral Bodies → Intervertebral Discs →
// Spinal Canal → Neural Foramina → Facet Joints → Ligamentum Flavum →
// Conus & Cauda Equina → Paraspinal Structures.

export const LS_SPINE_ANATOMY: ClinicalRegionAnatomy = {
  region: "LS Spine",
  sections: [
    {
      name: "Alignment",
      concepts: [
        {
          concept: "alignment",
          label: "Alignment",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "alignment",
          referenceSource: "clinic-format",
        },
        {
          concept: "spondylolisthesis",
          label: "Spondylolisthesis",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: true,
          conflictGroup: "spondylolisthesis",
          referenceSource: "both",
        },
      ],
    },
    {
      name: "Vertebral Bodies",
      concepts: [
        {
          concept: "vertebrae",
          label: "Vertebrae",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "vertebrae",
          referenceSource: "clinic-format",
        },
        {
          concept: "endplate",
          label: "Endplate (Modic) Changes",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: true,
          conflictGroup: "endplate",
          referenceSource: "both",
        },
        {
          concept: "fracture",
          label: "Compression Fracture",
          category: "critical",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: true,
          conflictGroup: "compression fracture",
          referenceSource: "both",
        },
        {
          concept: "hemangioma",
          label: "Vertebral Hemangioma",
          category: "normal",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "hemangioma",
          referenceSource: "clinic-format",
        },
        {
          concept: "schmorl",
          label: "Schmorl Node",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "schmorl",
          referenceSource: "clinic-format",
        },
        {
          concept: "marrow",
          label: "Bone Marrow",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "marrow",
          referenceSource: "clinic-format",
        },
        {
          concept: "lesion",
          label: "Bone Marrow Lesion",
          category: "critical",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "lesion",
          referenceSource: "clinic-format",
        },
      ],
    },
    {
      name: "Intervertebral Discs",
      concepts: [
        {
          concept: "disc_contour",
          label: "Disc Contour (Bulge/Protrusion/Extrusion)",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: true,
          severityApplicable: true,
          conflictGroup: "disc_contour",
          referenceSource: "both",
        },
        {
          concept: "disc_signal",
          label: "Disc Signal (Desiccation)",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "disc_signal",
          referenceSource: "both",
        },
        {
          concept: "disc_height",
          label: "Disc Height",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "disc_height",
          referenceSource: "both",
        },
      ],
    },
    {
      name: "Spinal Canal",
      concepts: [
        {
          concept: "canal_stenosis",
          label: "Canal Stenosis",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: true,
          conflictGroup: "canal_stenosis",
          referenceSource: "both",
        },
        {
          concept: "canal_ap",
          label: "Canal AP Diameter",
          category: "normal",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "canal_ap",
          referenceSource: "both",
        },
      ],
    },
    {
      name: "Neural Foramina",
      concepts: [
        {
          concept: "foraminal_stenosis",
          label: "Foraminal Stenosis",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: true,
          severityApplicable: true,
          conflictGroup: "foraminal_stenosis",
          referenceSource: "both",
        },
      ],
    },
    {
      name: "Facet Joints",
      concepts: [
        {
          concept: "facet_joint",
          label: "Facet Arthropathy",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: true,
          severityApplicable: true,
          conflictGroup: "facet_joint",
          referenceSource: "both",
        },
      ],
    },
    {
      name: "Ligamentum Flavum",
      concepts: [
        {
          concept: "ligamentum_flavum",
          label: "Ligamentum Flavum Hypertrophy",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: true,
          severityApplicable: false,
          conflictGroup: "ligamentum_flavum",
          referenceSource: "both",
        },
      ],
    },
    {
      name: "Conus & Cauda Equina",
      concepts: [
        {
          concept: "conus",
          label: "Conus Medullaris",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "conus",
          referenceSource: "clinic-format",
        },
        {
          concept: "cord",
          label: "Spinal Cord",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "cord",
          referenceSource: "clinic-format",
        },
      ],
    },
    {
      name: "Paraspinal Structures",
      concepts: [
        {
          concept: "paraspinal",
          label: "Paraspinal Soft Tissues",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "paraspinal",
          referenceSource: "clinic-format",
        },
      ],
    },
  ],
};

// ─── Cervical Spine anatomy (mirrors LS Spine structure) ────────────────

export const CERVICAL_SPINE_ANATOMY: ClinicalRegionAnatomy = {
  region: "Cervical Spine",
  sections: LS_SPINE_ANATOMY.sections.map((s) => ({ ...s })),
};

// ─── Dorsal Spine anatomy (mirrors LS Spine structure) ──────────────────

export const DORSAL_SPINE_ANATOMY: ClinicalRegionAnatomy = {
  region: "Dorsal Spine",
  sections: LS_SPINE_ANATOMY.sections.map((s) => ({ ...s })),
};

// ─── Whole Spine Screening anatomy (subset — limited-planar) ─────────────

export const WHOLE_SPINE_SCREENING_ANATOMY: ClinicalRegionAnatomy = {
  region: "Whole Spine Screening",
  sections: [
    {
      name: "Alignment",
      concepts: [
        {
          concept: "alignment",
          label: "Alignment",
          category: "normal",
          levelSpecific: false,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "alignment",
          referenceSource: "mri-reports",
        },
      ],
    },
    {
      name: "Intervertebral Discs",
      concepts: [
        {
          concept: "disc_contour",
          label: "Disc Bulge (Screening)",
          category: "abnormal",
          levelSpecific: true,
          lateralityApplicable: false,
          severityApplicable: false,
          conflictGroup: "disc_contour",
          referenceSource: "mri-reports",
        },
      ],
    },
  ],
};

// ─── Catalog registry ─────────────────────────────────────────────────────

export const CLINICAL_ANATOMY_CATALOG: ClinicalRegionAnatomy[] = [
  BRAIN_ANATOMY,
  LS_SPINE_ANATOMY,
  CERVICAL_SPINE_ANATOMY,
  DORSAL_SPINE_ANATOMY,
  WHOLE_SPINE_SCREENING_ANATOMY,
];

/**
 * Look up the clinical anatomy context for a given region.
 * Returns null for unmapped regions (unknown family — §S test 13 path).
 */
export function getClinicalAnatomyForRegion(
  region: string | null | undefined,
): ClinicalRegionAnatomy | null {
  if (!region) return null;
  const lower = region.toLowerCase();
  return (
    CLINICAL_ANATOMY_CATALOG.find((a) => a.region.toLowerCase() === lower) ?? null
  );
}

/**
 * Look up all concepts for a given region + anatomical section.
 * Returns an empty array if the region or section is not found.
 */
export function getConceptsForSection(
  region: string | null | undefined,
  sectionName: string | null | undefined,
): ClinicalConceptEntry[] {
  const anatomy = getClinicalAnatomyForRegion(region);
  if (!anatomy || !sectionName) return [];
  const lower = sectionName.toLowerCase();
  return (
    anatomy.sections.find((s) => s.name.toLowerCase() === lower)?.concepts ?? []
  );
}

/**
 * Look up a specific concept entry within a region.
 * Returns null if the concept is not registered for that region.
 */
export function getConceptEntry(
  region: string | null | undefined,
  concept: string | null | undefined,
): ClinicalConceptEntry | null {
  const anatomy = getClinicalAnatomyForRegion(region);
  if (!anatomy || !concept) return null;
  const lower = concept.toLowerCase();
  for (const section of anatomy.sections) {
    const entry = section.concepts.find((c) => c.concept.toLowerCase() === lower);
    if (entry) return entry;
  }
  return null;
}

/**
 * Check whether two concepts are clinically distinct (belong to different
 * conflict groups). This is the key invariant for concept coexistence:
 * disc_contour + disc_signal + facet_joint + ligamentum_flavum are all
 * DISTINCT and may coexist at the same level.
 */
export function areConceptsClinicallyDistinct(
  region: string | null | undefined,
  conceptA: string | null | undefined,
  conceptB: string | null | undefined,
): boolean {
  const a = getConceptEntry(region, conceptA);
  const b = getConceptEntry(region, conceptB);
  if (!a || !b) return true; // Unknown concepts are treated as distinct.
  return a.conflictGroup !== b.conflictGroup;
}
