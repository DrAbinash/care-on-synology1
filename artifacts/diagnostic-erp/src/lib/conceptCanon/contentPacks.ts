/**
 * conceptCanon/contentPacks.ts — typed clinical content packs.
 *
 * Each content pack defines ONE canonical concept plus its accepted aliases
 * and the regions/modalities where the concept is clinically meaningful.
 *
 * This file is the SINGLE SOURCE of clinical concept truth. The runtime
 * CONCEPT_CANON map and resolver (see conceptCanon.ts) are GENERATED from
 * these packs at module load — there is no second synonym engine.
 *
 * Design rules (PR #662 — Clinical Composition Hardening):
 *
 *   1. Canonical concept wins over wording. "disc bulge", "disc protrusion",
 *      and "disc extrusion" all alias to `disc_contour` because they share
 *      the same clinical ownership slot (the contour of the same disc at the
 *      same level). Their specificity / severity / metadata remain
 *      distinguishable via the observation's `state` / `severity` / etc.
 *
 *   2. Bulge / protrusion / extrusion share an ownership concept BUT their
 *      own severity metadata is preserved at the observation level. The
 *      content pack does NOT flatten severity — it only resolves ownership.
 *
 *   3. Region/modality hints are advisory (used for surfacing relevant
 *      concepts in UI pickers and for guarding against cross-region alias
 *      collisions). They are NOT part of slotKey identity.
 *
 *   4. Unknown concepts MUST fail conservatively. The resolver returns the
 *      input as-is (slug-normalised) instead of silently mapping to a wrong
 *      canonical concept. See `resolveCanonicalConcept` in conceptCanon.ts.
 *
 *   5. Broad anatomy words (disc, spine, brain, …) are NEVER aliases. They
 *      are listed in BROAD_ANATOMY in observationSlot.ts and are excluded
 *      from canonical resolution.
 */

export type CanonicalConceptId = string;

export type ContentPackRegion =
  | "brain"
  | "cervical spine"
  | "dorsal spine"
  | "ls spine"
  | "whole spine"
  | "chest"
  | "abdomen"
  | "knee"
  | "shoulder"
  | "breast"
  | "pns"
  | "pelvis"
  | "orbital"
  | "*";

export type ContentPackModality = "MR" | "CT" | "US" | "XR" | "MG" | "*";

export interface ClinicalContentPack {
  /** Canonical concept identifier (snake_case). */
  concept: CanonicalConceptId;
  /** Human-readable label for UI surfaces (pickers, ownership trace). */
  label: string;
  /** One-line clinical description. */
  description: string;
  /** Accepted aliases / synonyms that resolve to this concept. */
  aliases: string[];
  /** Advisory list of regions where this concept is clinically meaningful. */
  regions: ContentPackRegion[];
  /** Advisory list of modalities where this concept is clinically meaningful. */
  modalities: ContentPackModality[];
  /**
   * When true, the concept is a system-owned baseline that auto-yields to
   * impression-worthy abnormal observations (e.g. `normal_study`).
   * Default false.
   */
  systemOwnedBaseline?: boolean;
  /**
   * When true, observations with this concept are considered
   * impression-worthy abnormal (i.e. they suppress the system normal
   * impression). When false / undefined, the concept is treated as a
   * finding-only observation that does not auto-yield the system normal.
   */
  impressionworthyAbnormal?: boolean;
}

/**
 * The canonical content packs. Editing this array is the ONLY way to add
 * or modify clinical concept aliases.
 *
 * Ordering matters for readability, not for resolution (aliases are indexed
 * into a HashMap at module load).
 */
export const CLINICAL_CONTENT_PACKS: readonly ClinicalContentPack[] = [
  // ─── System-owned baseline ──────────────────────────────────────────────
  {
    concept: "normal_study",
    label: "Normal Study",
    description:
      "System-owned baseline impression. Auto-yields when an impression-worthy abnormal observation is added; returns when the last such observation is removed.",
    aliases: ["normal study", "normal mri", "normal ct", "normal usg", "normal scan"],
    regions: ["*"],
    modalities: ["*"],
    systemOwnedBaseline: true,
    impressionworthyAbnormal: false,
  },

  // ─── Brain ─────────────────────────────────────────────────────────────
  {
    concept: "fazekas",
    label: "Fazekas White-Matter Grade",
    description: "Small-vessel ischemic white-matter disease (Fazekas grade 1/2/3).",
    aliases: ["fazekas", "fazekas grade", "white matter lesions", "svd", "small vessel disease"],
    regions: ["brain"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "ventricles",
    label: "Ventricles / Hydrocephalus",
    description: "Ventricular size — normal vs hydrocephalus.",
    aliases: ["ventricles", "ventricle", "ventricular", "hydrocephalus", "ventricular system"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "infarct",
    label: "Cerebral Infarct",
    description: "Acute or chronic cerebral infarction.",
    aliases: ["infarct", "acute infarct", "chronic infarct", "restricted diffusion", "stroke"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "hemorrhage",
    label: "Intraparenchymal Hemorrhage",
    description: "Acute intraparenchymal / basal ganglia hemorrhage.",
    aliases: ["hemorrhage", "haemorrhage", "hematoma", "ich", "intraparenchymal hemorrhage"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "subdural_hematoma",
    label: "Subdural Hematoma",
    description: "Acute or chronic subdural hematoma / effusion.",
    aliases: ["subdural hematoma", "sdh", "subdural effusion", "subdural collection"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "orbital",
    label: "Orbital Cellulitis",
    description: "Preseptal / postseptal orbital inflammatory change.",
    aliases: ["orbital", "orbit", "orbital cellulitis", "preseptal cellulitis"],
    regions: ["brain", "orbital"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "sinus",
    label: "Paranasal Sinus Disease",
    description: "Mucosal thickening / fluid / sinusitis.",
    aliases: ["sinus", "sinuses", "sinusitis", "maxillary sinusitis", "mucosal thickening"],
    regions: ["pns"],
    modalities: ["CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "pituitary",
    label: "Pituitary Lesion",
    description: "Pituitary macroadenoma / microadenoma.",
    aliases: ["pituitary", "pituitary tumor", "macroadenoma", "microadenoma"],
    regions: ["brain"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "senile_atrophy",
    label: "Senile / Involutional Changes",
    description: "Age-related cerebral volume loss.",
    aliases: ["senile", "senile atrophy", "involutional", "age-related atrophy", "cerebral atrophy"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: false,
  },

  // ─── Spine — disc / contour / signal / height ─────────────────────────
  {
    concept: "disc_contour",
    label: "Disc Contour (bulge / protrusion / extrusion)",
    description:
      "Disc contour abnormality. Bulge, protrusion, extrusion, sequestration, and annular fissure share an ownership concept (same disc, same level). Severity / morphology metadata remain distinguishable on the observation.",
    aliases: [
      "disc contour",
      "disc bulge",
      "disc-bulge",
      "disc_bulge",
      "diffuse disc bulge",
      "disc herniation",
      "disc-herniation",
      "herniation",
      "disc protrusion",
      "disc-protrusion",
      "protrusion",
      "disc extrusion",
      "extrusion",
      "disc sequestration",
      "sequestration",
      "annular fissure",
      "annular tear",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "disc_signal",
    label: "Disc Signal (desiccation)",
    description: "Loss of T2 disc signal — desiccation.",
    aliases: ["disc signal", "disc_signal", "desiccation", "disc desiccation", "loss of t2 signal"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "disc_height",
    label: "Disc Height",
    description: "Reduced disc height.",
    aliases: ["disc height", "disc_height", "reduced disc height", "loss of disc height"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: false,
  },

  // ─── Spine — canal / foramina / roots ────────────────────────────────
  {
    concept: "canal_stenosis",
    label: "Spinal Canal Stenosis",
    description: "Central canal stenosis (mild / moderate / severe).",
    aliases: ["canal stenosis", "canal_stenosis", "spinal stenosis", "central stenosis"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "foraminal_stenosis",
    label: "Neural Foraminal Stenosis",
    description: "Foraminal narrowing. Left / right / bilateral coexist.",
    aliases: [
      "foraminal stenosis",
      "foraminal_stenosis",
      "foraminal narrowing",
      "neural foraminal stenosis",
      "foramina narrowing",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "root_contact",
    label: "Nerve Root Contact / Compression",
    description: "Disc contacts or compresses an exiting / traversing nerve root.",
    aliases: [
      "root contact",
      "root_contact",
      "root compression",
      "root_compression",
      "nerve root",
      "nerve root compression",
      "nerve root contact",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "canal_ap",
    label: "AP Canal Diameter Measurement",
    description:
      "AP canal diameter numeric measurement. Measurements are NOT part of slotKey identity — they are recorded as observation metadata.",
    aliases: ["canal ap", "canal_ap", "ap canal diameter", "ap diameter"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: false,
  },

  // ─── Spine — vertebral / endplate / alignment ────────────────────────
  {
    concept: "spondylolisthesis",
    label: "Spondylolisthesis",
    description: "Anterior listhesis (grade 1 / 2 / 3).",
    aliases: ["spondylolisthesis", "listhesis", "spondylolysis", "slip"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "endplate",
    label: "Endplate Changes (Modic)",
    description: "Modic type 1 / 2 / 3 endplate changes.",
    aliases: ["endplate", "modic", "modic type 1", "modic type 2", "modic type 3", "endplate change"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "compression_fracture",
    label: "Vertebral Compression Fracture",
    description: "Acute / chronic compression fracture.",
    aliases: [
      "compression fracture",
      "compression_fracture",
      "vertebral fracture",
      "wedge fracture",
      "collapse",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR", "CT", "XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "spondylodiscitis",
    label: "Spondylodiscitis / Discitis",
    description: "Infective spondylodiscitis with endplate erosion.",
    aliases: ["spondylodiscitis", "discitis", "osteomyelitis", "infective spondylitis"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "alignment",
    label: "Alignment",
    description: "Loss of lordosis / kyphotic change / alignment alteration.",
    aliases: ["alignment", "loss of lordosis", "loss of cervical lordosis", "kyphosis"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: false,
  },

  // ─── Spine — posterior elements / paraspinal ─────────────────────────
  {
    concept: "facet_joint",
    label: "Facet Arthropathy",
    description: "Facet joint degeneration / hypertrophy.",
    aliases: ["facet joint", "facet_joint", "facet", "facet arthropathy", "facet hypertrophy"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "ligamentum_flavum",
    label: "Ligamentum Flavum Hypertrophy",
    description: "LF hypertrophy contributing to canal stenosis.",
    aliases: [
      "ligamentum flavum",
      "ligamentum_flavum",
      "ligamentum flavum hypertrophy",
      "lf hypertrophy",
      "lfh",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "osteophytes",
    label: "Marginal Osteophytes",
    description: "Degenerative marginal osteophytes.",
    aliases: ["osteophytes", "osteophyte", "marginal osteophytes", "spurs"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR", "CT", "XR"],
    impressionworthyAbnormal: false,
  },

  // ─── Spine — cord ─────────────────────────────────────────────────────
  {
    concept: "cord_signal",
    label: "Cord Signal Change (Myelopathy)",
    description: "T2 hyperintense cord signal — myelopathic change.",
    aliases: ["cord signal", "cord_signal", "myelopathy", "cord hyperintensity", "myelomalacia"],
    regions: ["cervical spine", "dorsal spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },

  // ─── MSK ──────────────────────────────────────────────────────────────
  {
    concept: "meniscus",
    label: "Meniscus Tear",
    description: "Medial / lateral meniscus tear.",
    aliases: ["meniscus", "menisci", "meniscus tear", "meniscal tear"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "rotator_cuff",
    label: "Rotator Cuff Tear",
    description: "Full / partial thickness rotator cuff tear.",
    aliases: ["rotator cuff", "rotator_cuff", "rotator cuff tear", "supraspinatus tear"],
    regions: ["shoulder"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "hip",
    label: "Hip Joint Effusion",
    description: "Hip joint effusion / synovitis.",
    aliases: ["hip", "hip effusion", "hip joint effusion"],
    regions: ["pelvis"],
    modalities: ["MR", "US"],
    impressionworthyAbnormal: true,
  },

  // ─── Abdomen / USG ────────────────────────────────────────────────────
  {
    concept: "renal",
    label: "Renal Calculus",
    description: "Renal calculus / nephrolithiasis.",
    aliases: ["renal", "kidney", "renal calculus", "nephrolithiasis", "renal stone"],
    regions: ["abdomen"],
    modalities: ["US", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cholelithiasis",
    label: "Cholelithiasis",
    description: "Gallbladder calculi.",
    aliases: ["cholelithiasis", "gallstones", "gallstone", "biliary calculus"],
    regions: ["abdomen"],
    modalities: ["US"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "fatty_liver",
    label: "Fatty Liver",
    description: "Hepatic steatosis (grade I / II / III).",
    aliases: ["fatty liver", "hepatic steatosis", "fatty infiltration", "fatty changes"],
    regions: ["abdomen"],
    modalities: ["US", "CT", "MR"],
    impressionworthyAbnormal: true,
  },

  // ─── Chest ────────────────────────────────────────────────────────────
  {
    concept: "pulmonary_nodule",
    label: "Pulmonary Nodule",
    description: "Solitary pulmonary nodule / mass.",
    aliases: ["pulmonary nodule", "lung nodule", "lung mass", "spiculated mass"],
    regions: ["chest"],
    modalities: ["CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "pneumothorax",
    label: "Pneumothorax",
    description: "Pneumothorax (simple / tension).",
    aliases: ["pneumothorax", "pneumo", "tension pneumothorax"],
    regions: ["chest"],
    modalities: ["CT", "XR"],
    impressionworthyAbnormal: true,
  },

  // ─── Breast ──────────────────────────────────────────────────────────
  {
    concept: "birads",
    label: "BI-RADS Assessment",
    description: "BI-RADS category assessment (0–6).",
    aliases: ["bi-rads", "birads", "bi-rads 1", "bi-rads 2", "bi-rads 3", "bi-rads 4", "bi-rads 5"],
    regions: ["breast"],
    modalities: ["MG", "US", "MR"],
    impressionworthyAbnormal: true,
  },

  // ─── Canvas-compatible concepts (PR #664 compatibility) ───────────────
  //
  // These 7 concepts are emitted by the Cervical/Dorsal Canvas UI (PR #664)
  // and MUST be in the concept canon so that:
  //   1. resolveCanonicalConcept() recognizes them (slot identity)
  //   2. isImpressionworthyAbnormal() returns true (system normal auto-yield)
  //
  // None of these are collapsed onto existing concepts — each is clinically
  // distinct (see PR #664 compatibility matrix).

  // 1. cord_compression — distinct from cord_signal
  //    cord_compression = mechanical compression (may or may not have signal change)
  //    cord_signal = T2 hyperintensity (myelopathic change, may exist without compression)
  {
    concept: "cord_compression",
    label: "Cord Compression",
    description: "Mechanical compression of the spinal cord at a disc level. Distinct from cord_signal (T2 signal change).",
    aliases: [
      "cord compression",
      "cord_compression",
      "spinal cord compression",
      "cord compressed",
    ],
    regions: ["cervical spine", "dorsal spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },

  // 2. pll_thickening — distinct from ligamentum_flavum
  //    PLL (posterior longitudinal ligament) and LF (ligamentum flavum) are
  //    anatomically different ligaments. They MUST NOT be collapsed.
  {
    concept: "pll_thickening",
    label: "PLL Thickening",
    description: "Thickening/hypertrophy of the posterior longitudinal ligament (PLL). Distinct from ligamentum_flavum hypertrophy.",
    aliases: [
      "pll thickening",
      "pll_thickening",
      "posterior longitudinal ligament thickening",
      "pll hypertrophy",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },

  // 3. endplate_erosion — infection-specific, distinct from endplate (Modic)
  //    endplate_erosion = infective destruction of the vertebral endplate
  //    endplate = Modic type 1/2/3 degenerative endplate changes
  {
    concept: "endplate_erosion",
    label: "Endplate Erosion (Infective)",
    description: "Infective erosion/destruction of the vertebral endplate. Distinct from degenerative Modic endplate changes.",
    aliases: [
      "endplate erosion",
      "endplate_erosion",
      "endplate destruction",
      "vertebral endplate erosion",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },

  // 4. marrow_edema — infection/fracture-related, distinct ownership slot
  //    May accompany compression fracture or spondylodiscitis.
  {
    concept: "marrow_edema",
    label: "Vertebral Marrow Edema",
    description: "Marrow edema in a vertebral body — seen in acute fracture, infection, or tumor. Distinct ownership slot.",
    aliases: [
      "marrow edema",
      "marrow_edema",
      "bone marrow edema",
      "vertebral marrow edema",
      "marrow oedema",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },

  // 5. vertebral_collapse — distinct from compression_fracture
  //    vertebral_collapse can occur from infection/tumor WITHOUT an acute
  //    compression fracture. MUST NOT collapse onto compression_fracture.
  {
    concept: "vertebral_collapse",
    label: "Vertebral Body Collapse",
    description: "Collapse of a vertebral body. May occur from infection, tumor, or chronic fracture — distinct from acute compression_fracture.",
    aliases: [
      "vertebral collapse",
      "vertebral_collapse",
      "vertebral body collapse",
      "body collapse",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },

  // 6. paravertebral_collection — paravertebral location, clinically distinct
  //    from epidural_collection (different anatomical compartment).
  {
    concept: "paravertebral_collection",
    label: "Paravertebral Collection",
    description: "Pre/paravertebral soft tissue collection (abscess/inflammation). Paravertebral location is clinically distinct from epidural.",
    aliases: [
      "paravertebral collection",
      "paravertebral_collection",
      "paravertebral abscess",
      "prevertebral collection",
      "paraspinal collection",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },

  // 7. epidural_collection — epidural location, clinically distinct
  //    from paravertebral_collection (different anatomical compartment).
  {
    concept: "epidural_collection",
    label: "Epidural Collection",
    description: "Epidural collection/abscess component. Epidural location is clinically distinct from paravertebral.",
    aliases: [
      "epidural collection",
      "epidural_collection",
      "epidural abscess",
      "epidural component",
      "epidural collection component",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
] as const;

/**
 * Set of all canonical concept ids. Useful for type-narrowing at compile time.
 */
export const CANONICAL_CONCEPTS: ReadonlySet<string> = new Set(
  CLINICAL_CONTENT_PACKS.map((p) => p.concept),
);

/**
 * Lookup a content pack by canonical concept id.
 * Returns undefined for unknown concepts (conservative failure).
 */
export function contentPackForConcept(concept: string): ClinicalContentPack | undefined {
  return CLINICAL_CONTENT_PACKS.find((p) => p.concept === concept);
}

/**
 * Returns true if a concept is impression-worthy abnormal (suppresses
 * the system normal impression). Unknown concepts default to false.
 */
export function isImpressionworthyAbnormal(concept: string | null | undefined): boolean {
  if (!concept) return false;
  const pack = contentPackForConcept(concept);
  return Boolean(pack?.impressionworthyAbnormal);
}

/**
 * Returns true if a concept is the system-owned normal baseline.
 */
export function isSystemOwnedBaseline(concept: string | null | undefined): boolean {
  if (!concept) return false;
  const pack = contentPackForConcept(concept);
  return Boolean(pack?.systemOwnedBaseline);
}
