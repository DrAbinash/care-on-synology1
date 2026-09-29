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
    concept: "ich_abc2",
    label: "ICH ABC/2 Volume",
    description: "Intracerebral haemorrhage volume by ABC/2 ellipsoid (cc).",
    aliases: ["abc/2", "abc2", "ich volume", "ich_abc2", "intracerebral haemorrhage volume"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "aspects",
    label: "ASPECTS Score",
    description: "Alberta Stroke Programme Early CT Score (0–10).",
    aliases: ["aspects", "aspects score", "alberta stroke"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "aneurysm",
    label: "Cerebral Aneurysm",
    description: "Saccular cerebral aneurysm (dome × neck).",
    aliases: ["aneurysm", "saccular aneurysm", "cerebral aneurysm", "berry aneurysm"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "midline_shift",
    label: "Midline Shift",
    description: "Midline shift in millimetres toward left/right.",
    aliases: ["midline shift", "midline_shift", "mls"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  // Phase 2 owned Brain Standard/Screening Normal — atomic concepts
  {
    concept: "brain_parenchyma",
    label: "Brain Parenchyma",
    description: "Cerebral parenchymal signal / grey-white differentiation.",
    aliases: ["brain parenchyma", "parenchyma", "grey-white", "gray-white"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "diffusion",
    label: "Diffusion Restriction",
    description: "DWI/ADC restricted diffusion (distinct from named infarct territory).",
    aliases: ["diffusion", "dwi/adc", "dwi adc", "no restricted diffusion"],
    regions: ["brain"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "extra_axial",
    label: "Extra-axial Collection",
    description: "Extra-axial collection / space abnormality.",
    aliases: ["extra axial", "extra-axial", "extraaxial", "extra-axial collection"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "midline",
    label: "Midline Shift",
    description: "Midline structures / shift.",
    aliases: ["midline", "midline shift", "no midline shift"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "basal_ganglia",
    label: "Basal Ganglia / Thalami",
    description: "Basal ganglia and thalamic signal.",
    aliases: ["basal ganglia", "thalami", "thalamus"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "vascular_flow_voids",
    label: "Intracranial Flow Voids",
    description: "Major intracranial vessel flow voids.",
    aliases: ["flow voids", "vascular flow voids", "intracranial vessels"],
    regions: ["brain"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "brainstem",
    label: "Brainstem",
    description: "Brainstem morphology and signal.",
    aliases: ["brainstem", "brain stem"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cerebellum",
    label: "Cerebellum",
    description: "Cerebellar hemispheres morphology and signal.",
    aliases: ["cerebellum", "cerebellar"],
    regions: ["brain"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "posterior_fossa",
    label: "Posterior Fossa",
    description: "Posterior fossa structures (umbrella when not brainstem/cerebellum-specific).",
    aliases: ["posterior fossa"],
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

  // ─── MRI Brain clinical sub-masters — shared structured observation concepts
  // (mriBrainSubMasters.ts). Ownership slots only; no thresholds here.
  ...([
    // Sequence-dependent shared concepts
    ["susceptibility", "GRE/SWI Susceptibility", "Abnormal susceptibility blooming (microbleeds, DAI, siderosis).", true],
    ["enhancement_normal", "Contrast Enhancement", "Abnormal enhancement assessment when contrast was administered.", false],
    ["mrs_metabolites", "MR Spectroscopy", "Structured MRS metabolite entry — descriptive only.", true],
    ["mra_arterial", "MRA Arterial", "Arterial occlusion / stenosis on MRA when adequately assessed.", true],
    ["mrv_venous", "MR Venography", "Dural venous sinus patency on MRV.", true],
    // Mass effect / hydrocephalus / herniation family
    ["mass_effect", "Mass Effect", "Mass effect / sulcal or cisternal effacement / ventricular compression.", true],
    ["cerebral_hydrocephalus", "Hydrocephalus", "Hydrocephalus — obstructive or communicating.", true],
    ["brain_herniation", "Brain Herniation", "Subfalcine / uncal / tonsillar / transtentorial herniation.", true],
    ["edema", "Cerebral Edema", "Vasogenic or cytotoxic oedema.", false],
    ["lesion_differential", "Lesion Differential", "Radiologist-selected differential considerations — never auto-diagnosis.", false],
    // Ischaemic / haemorrhagic family
    ["lacunar", "Lacunes", "Old lacunar cavities (lacunar state).", true],
    ["encephalomalacia", "Chronic Infarct", "Chronic infarct / encephalomalacia with gliosis.", true],
    ["intraventricular_hemorrhage", "Intraventricular Hemorrhage", "Intraventricular blood.", true],
    ["subarachnoid_hemorrhage", "Subarachnoid Hemorrhage", "Subarachnoid blood.", true],
    ["contusion", "Cerebral Contusion", "Haemorrhagic or non-haemorrhagic traumatic contusion.", true],
    ["epidural_hematoma", "Epidural Hematoma", "Epidural (extradural) hematoma.", true],
    ["dai", "Diffuse Axonal Injury", "DAI at grey-white junction / corpus callosum / brainstem.", true],
    ["cvst", "Cerebral Venous Sinus Thrombosis", "Suspected cerebral venous sinus thrombosis.", true],
    ["venous_infarct", "Venous Infarction", "Non-arterial venous infarction.", true],
    ["cavernoma", "Cavernous Malformation", "Cavernoma with hemosiderin rim.", true],
    ["avm", "Arteriovenous Malformation", "Nidal AVM.", true],
    ["wm_signal_pattern", "White-Matter Signal Pattern", "Descriptive subcortical/white-matter signal pattern (PRES-like, toxic, metabolic).", true],
    ["hypoxic_injury", "Hypoxic-Ischemic Injury", "Diffuse hypoxic-ischaemic pattern in adults.", true],
    // Demyelinating / inflammatory family
    ["demyelinating_lesion", "Demyelinating Lesion", "Lesion distribution of demyelinating-appearing lesions (level carries location).", true],
    ["demyelinating_morphology", "Demyelinating Morphology", "Dawson-finger / ovoid morphology descriptor.", false],
    ["demyelinating_activity", "Demyelinating Activity", "Enhancing active vs non-enhancing lesion activity.", true],
    ["demyelinating_pattern", "Demyelinating Pattern Consideration", "Radiologist-selected MS/ADEM/MOGAD/PML-style considerations — criteria NOT asserted.", true],
    // Infection family
    ["leptomeningeal", "Leptomeningeal Disease", "Leptomeningeal / dural enhancement or involvement.", true],
    ["ependymitis", "Ventriculitis / Ependymitis", "Ependymal enhancement with intraventricular debris.", true],
    ["encephalitis", "Encephalitis Pattern", "Temporal/limbic or other encephalitis signal pattern — aetiology clinical.", true],
    ["vasculitis", "CNS Vasculitis Pattern", "Multifocal narrowing with infarcts in different territories.", true],
    // Epilepsy family
    ["hippocampus_volume", "Hippocampal Volume", "Hippocampal asymmetry / volume loss (laterality-bearing).", true],
    ["hippocampus_signal", "Hippocampal Signal", "Hippocampal T2/FLAIR hyperintensity (laterality-bearing).", true],
    ["hippocampus_architecture", "Hippocampal Architecture", "Loss of internal hippocampal architecture.", false],
    ["hippocampus_pattern", "Mesial Temporal Sclerosis", "MTS pattern combining volume / signal / architecture.", true],
    ["temporal_horn", "Temporal Horn Prominence", "Ipsilateral temporal horn prominence.", false],
    ["cortical_dysplasia", "Focal Cortical Dysplasia", "Focal cortical thickening / gyral abnormality — suspected FCD.", true],
    ["cortical_dysplasia_gw", "Grey-White Blurring", "Grey-white junction blurring suspicious for FCD.", false],
    ["heterotopia", "Grey Matter Heterotopia", "Subependymal / subcortical heterotopia.", true],
    ["polymicrogyria", "Polymicrogyria", "Polymicrogyria / cortical gyration malformation.", true],
    ["epilepsy_negative", "Epilepsy Protocol Negative", "No definite structural epileptogenic focus on reviewed epilepsy protocol.", false],
    // Sella / CPA
    ["sellar", "Sellar Region", "Sellar / parasellar baseline.", false],
    ["pituitary_apoplexy", "Pituitary Apoplexy", "Pituitary hemorrhage / apoplexy.", true],
    ["pituitary_infundibulum", "Pituitary Stalk", "Infundibular deviation / thickening.", false],
    ["pituitary_floor", "Sellar Floor Change", "Sellar floor remodeling / erosion.", false],
    ["pituitary_empty", "Empty Sella", "Partially empty sella.", false],
    ["pituitary_lesion", "Pituitary Lesion", "Pituitary lesion with dimensions / extension.", true],
    ["cpa_lesion", "Cerebellopontine Angle Lesion", "CPA mass (laterality-bearing).", true],
    ["iac_extension", "Internal Auditory Canal Extension", "Intracanalicular extension.", false],
    ["cranial_nerve", "Cranial Nerve Relationship", "Cranial nerve displacement where assessable.", false],
    // Pediatric / congenital
    ["myelination", "Myelination", "Age-referenced myelination status.", true],
    ["corpus_callosum", "Corpus Callosum", "Callosal hypogenesis / dysgenesis.", true],
    ["pf_malformation", "Posterior Fossa Malformation", "Dandy-Walker / Chiari spectrum — radiologist-specified.", true],
    ["ventriculomegaly", "Ventriculomegaly", "Ventricular enlargement, pediatric usage.", true],
    ["perinatal_injury", "Perinatal Hypoxic-Ischemic Injury", "Perinatal HIE pattern.", true],
    ["germinal_matrix_hemorrhage", "Germinal Matrix Hemorrhage", "GM / periventricular hemorrhage.", true],
    ["congenital_infection", "Congenital Infection Pattern", "Calcification / migration anomaly pattern.", false],
    ["neurocutaneous", "Neurocutaneous Markers", "Phakomatosis-associated cortical / subependymal findings.", false],
    // Metabolic / toxic
    ["metabolic_pattern", "Metabolic / Toxic Pattern", "Symmetric metabolic/toxic signal pattern (level carries region).", true],
    // Post-operative / devices
    ["craniotomy", "Craniotomy Defect", "Post-craniotomy / craniectomy change.", false],
    ["postop_change", "Post-operative Change", "Expected post-operative resection cavity change.", true],
    ["postop_recurrence", "Residual / Recurrent Lesion", "Radiologist-selected residual/recurrent enhancing lesion.", true],
    ["postop_ischemia", "Post-operative Ischemia", "New restricted diffusion after intervention.", true],
    ["postop_collection", "Post-operative Collection", "Operative-site collection.", true],
    ["pneumocephalus", "Pneumocephalus", "Intracranial air.", true],
    ["shunt_catheter", "Ventricular Catheter / Shunt", "Device position.", true],
    // Extracranial / incidental
    ["mastoid", "Mastoid Air Cells", "Mastoid effusion / mucosal thickening.", false],
    ["scalp", "Scalp / Calvarium", "Scalp and calvarium findings.", false],
    ["calvarial_fracture", "Calvarial Fracture (MRI)", "Suspected fracture with stated MRI limitation.", false],
    ["craniocervical_junction", "Craniocervical Junction", "CC junction baseline.", false],
  ] as Array<[string, string, string, boolean]>).map(([concept, label, description, impressionworthyAbnormal]) => ({
    concept,
    label,
    description,
    aliases: [concept.replace(/_/g, " "), concept],
    regions: ["brain"] as ContentPackRegion[],
    modalities: ["MR"] as ContentPackModality[],
    impressionworthyAbnormal,
  })),

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
    description: "Anterior listhesis (Meyerding grade I–IV).",
    aliases: ["spondylolisthesis", "listhesis", "spondylolysis", "slip", "meyerding"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "pfirrmann",
    label: "Pfirrmann Disc Degeneration Grade",
    description: "Pfirrmann grade I–V disc degeneration on T2-weighted MRI.",
    aliases: ["pfirrmann", "pfirrmann grade", "disc degeneration grade"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "endplate",
    label: "Endplate Changes (Modic)",
    description: "Modic type 0 / I / II / III endplate changes.",
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
  // Phase 2 owned Knee Standard Normal — atomic concepts
  {
    concept: "medial_meniscus",
    label: "Medial Meniscus",
    description: "Medial meniscus integrity / tear.",
    aliases: ["medial meniscus", "medial meniscal"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "lateral_meniscus",
    label: "Lateral Meniscus",
    description: "Lateral meniscus integrity / tear.",
    aliases: ["lateral meniscus", "lateral meniscal"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "acl",
    label: "ACL",
    description: "Anterior cruciate ligament.",
    aliases: ["acl", "anterior cruciate", "anterior cruciate ligament"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "pcl",
    label: "PCL",
    description: "Posterior cruciate ligament.",
    aliases: ["pcl", "posterior cruciate", "posterior cruciate ligament"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "mcl",
    label: "MCL",
    description: "Medial collateral ligament.",
    aliases: ["mcl", "medial collateral", "medial collateral ligament"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "lcl",
    label: "LCL / Lateral Stabilizers",
    description: "Lateral collateral / posterolateral corner structures.",
    aliases: ["lcl", "lateral collateral", "lateral collateral ligament", "posterolateral corner"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "articular_cartilage",
    label: "Articular Cartilage",
    description: "Compartmental articular cartilage.",
    aliases: ["articular cartilage", "chondral", "cartilage"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "bone_marrow",
    label: "Bone Marrow",
    description: "Osseous / marrow signal of the knee.",
    aliases: ["bone marrow", "marrow edema", "osseous"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "extensor_mechanism",
    label: "Extensor Mechanism",
    description: "Quadriceps / patellar tendon extensor mechanism.",
    aliases: ["extensor mechanism", "quadriceps tendon", "patellar tendon"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "patellofemoral",
    label: "Patellofemoral",
    description: "Patellofemoral joint / tracking.",
    aliases: ["patellofemoral", "patella", "patellar"],
    regions: ["knee"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "effusion",
    label: "Joint Effusion",
    description: "Knee joint effusion / collection.",
    aliases: ["effusion", "joint effusion", "knee effusion"],
    regions: ["knee"],
    modalities: ["MR", "US"],
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
  // ─── MRI Spine sub-master V3: lumbar detail, screening, numbering ───────
  // Region hints are advisory. Aliases already claimed above keep resolving
  // to their original owner (first declaration wins), so nothing here can
  // re-route an existing spine concept.
  {
    concept: "lateral_recess_stenosis",
    label: "Lateral Recess Stenosis",
    description: "Lateral recess narrowing/stenosis. Left and right coexist.",
    aliases: ["lateral recess stenosis", "lateral recess narrowing", "subarticular recess narrowing"],
    regions: ["ls spine", "cervical spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "canal_morphology",
    label: "Canal Morphology",
    description: "CSF/thecal-sac configuration: effacement, crowding, trefoil.",
    aliases: ["canal morphology", "csf effacement", "thecal sac configuration", "trefoil configuration"],
    regions: ["ls spine", "cervical spine", "dorsal spine"],
    modalities: ["MR"],
  },
  {
    concept: "disc_migration",
    label: "Disc Fragment Migration",
    description: "Cranial/caudal migration of disc material, with distance.",
    aliases: ["disc migration", "migrated disc fragment", "sequestered fragment migration"],
    regions: ["ls spine", "cervical spine", "dorsal spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  // NOTE: facet detail intentionally does NOT get new concepts here — the
  // existing `facet_joint` pack already owns "facet arthropathy" /
  // "facet hypertrophy" aliases, and re-declaring them would silently move
  // ownership away from every existing facet row. Facet subtype is carried in
  // the observation's `state` instead.
  {
    concept: "synovial_cyst",
    label: "Synovial Cyst",
    description: "Juxtafacet synovial cyst with canal/recess effect.",
    aliases: ["synovial cyst", "juxtafacet cyst", "facet cyst"],
    regions: ["ls spine", "cervical spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "pars_defect",
    label: "Pars Interarticularis Defect",
    description: "Spondylolysis/pars defect; right, left or bilateral.",
    aliases: ["pars defect", "spondylolysis", "pars interarticularis defect", "isthmic defect"],
    regions: ["ls spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "epidural_space",
    label: "Epidural Space",
    description: "Epidural fat, mass or thecal-sac effect (non-infective).",
    aliases: ["epidural space", "epidural fat", "epidural mass"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
  },
  {
    concept: "epidural_lipomatosis",
    label: "Spinal Epidural Lipomatosis",
    description: "Prominent epidural fat contributing to canal stenosis.",
    aliases: ["epidural lipomatosis", "spinal epidural lipomatosis"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "root_traversing",
    label: "Traversing Nerve Root",
    description: "The traversing (descending) root at a lumbar level.",
    aliases: ["traversing root", "descending root", "descending nerve root"],
    regions: ["ls spine", "cervical spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "root_exiting",
    label: "Exiting Nerve Root",
    description: "The exiting root at a lumbar level, within the foramen.",
    aliases: ["exiting root", "exiting nerve root"],
    regions: ["ls spine", "cervical spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "conus_medullaris",
    label: "Conus Medullaris",
    description: "Conus level, morphology and signal.",
    aliases: ["conus medullaris", "low-lying conus", "conus level"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cauda_equina",
    label: "Cauda Equina",
    description: "Cauda equina distribution, crowding, clumping, compression.",
    aliases: ["cauda equina", "cauda equina nerve roots"],
    regions: ["ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "filum_terminale",
    label: "Filum Terminale",
    description: "Filum thickness/fatty filum/intrafilar lipoma.",
    aliases: ["filum", "filum terminale", "fatty filum", "intrafilar lipoma", "thickened filum"],
    regions: ["ls spine"],
    modalities: ["MR"],
  },
  {
    concept: "tethered_cord",
    label: "Tethered Cord",
    description: "Low conus with thickened or fatty filum.",
    aliases: ["tethered cord", "cord tethering", "low conus syndrome"],
    regions: ["ls spine", "dorsal spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "arachnoiditis",
    label: "Adhesive Arachnoiditis",
    description: "Root clumping/peripheral adherence pattern (descriptive).",
    aliases: ["arachnoiditis", "root clumping", "empty thecal sac sign"],
    regions: ["ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "craniocervical_junction",
    label: "Craniocervical Junction",
    description: "Tonsillar position and craniocervical junction screening.",
    aliases: ["craniocervical junction", "ccj", "tonsillar descent", "foramen magnum"],
    regions: ["cervical spine", "brain", "whole spine"],
    modalities: ["MR"],
  },
  {
    concept: "syrinx",
    label: "Syrinx",
    description: "Cord cavity/syrinx, when evident.",
    aliases: ["syrinx", "syringomyelia", "cord cavity"],
    regions: ["cervical spine", "dorsal spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "sacroiliac_joints",
    label: "Sacroiliac Joints",
    description: "Visualised SI joints: oedema, erosion, sclerosis, fusion.",
    aliases: ["sacroiliac joints", "si joints", "sacroiliitis"],
    regions: ["ls spine", "pelvis"],
    modalities: ["MR"],
  },
  {
    concept: "transitional_vertebra",
    label: "Lumbosacral Transitional Vertebra",
    description: "LSTV/Castellvi — drives vertebral numbering.",
    aliases: ["lstv", "transitional vertebra", "lumbosacral transitional vertebra", "sacralization", "lumbarization", "castellvi"],
    regions: ["ls spine"],
    modalities: ["MR"],
  },
  {
    concept: "bertolotti_syndrome",
    label: "Bertolotti Syndrome",
    description: "Radiologist-selected interpretation linking LSTV to symptoms.",
    aliases: ["bertolotti syndrome"],
    regions: ["ls spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "hardware_postop",
    label: "Spinal Hardware / Post-operative Change",
    description: "Instrumentation, fusion and expected post-surgical change.",
    aliases: ["pedicle screw", "interbody cage", "plif", "tlif", "hemilaminectomy", "laminectomy", "discectomy", "epidural fibrosis", "pseudomeningocele"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
  },
  {
    concept: "adjacent_segment_degeneration",
    label: "Adjacent Segment Degeneration",
    description: "Degeneration at a level adjacent to a prior fusion.",
    aliases: ["adjacent segment disease", "adjacent segment degeneration"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
  },
  {
    concept: "schmorl_node",
    label: "Schmorl Node",
    description: "Intraspongy disc herniation with or without reactive change.",
    aliases: ["schmorl node", "schmorl's node", "intraspongy disc"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
  },
  {
    concept: "listhesis_dynamic",
    label: "Dynamic Instability",
    description: "Interval translation demonstrated on dynamic imaging only.",
    aliases: ["dynamic instability", "functional spondylolisthesis", "interval translation"],
    regions: ["ls spine", "cervical spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "annular_fissure",
    label: "Annular Fissure / HIZ",
    description: "Annular tear with or without high-intensity zone.",
    aliases: ["annular fissure", "annular tear", "high intensity zone"],
    regions: ["ls spine", "cervical spine", "dorsal spine"],
    modalities: ["MR"],
  },
  {
    concept: "disc_uncapping",
    label: "Disc Uncapping / Pseudobulge",
    description: "Apparent disc bulge from listhesis rather than disc material.",
    aliases: ["disc uncapping", "uncapping of the disc", "pseudo-disc bulge"],
    regions: ["ls spine"],
    modalities: ["MR"],
  },
  {
    concept: "bone_lesion",
    label: "Focal Bone Lesion",
    description: "Focal osseous lesion, screening-level detection only.",
    aliases: ["focal osseous lesion", "focal bone lesion", "suspicious vertebral lesion"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "muscle_atrophy",
    label: "Paraspinal Muscle Atrophy",
    description: "Multifidus/erector spinae atrophy or fatty infiltration.",
    aliases: ["paraspinal atrophy", "multifidus atrophy"],
    regions: ["ls spine"],
    modalities: ["MR"],
  },
  {
    concept: "screening_limitation",
    label: "Screening Limitation",
    description: "Planar/sequence limitation of a screening region.",
    aliases: ["screening limitation", "limited planar", "limited sequence"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
  },
  {
    concept: "screening_recommendation",
    label: "Screening Recommendation",
    description: "Dedicated regional MRI suggested by the radiologist.",
    aliases: ["dedicated mri suggested", "screening recommendation"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
  },

  // ─── Spine — dorsal / thoracic specific (MRI Dorsal V3, spec §3, §6, §11, §14-§22) ──
  //
  // These concepts exist because thoracic anatomy is not cervical or lumbar
  // anatomy: rib-bearing vertebrae, costovertebral joints, the thoracolumbar
  // junction and the intradural compartment have no generic spine equivalent.
  // Nothing here aliases an existing concept — `spondylolisthesis`,
  // `ligamentum_flavum`, `pll_thickening`, `cord_compression` and
  // `vascular_flow_voids` keep their own ownership.
  {
    concept: "kyphosis",
    label: "Thoracic Kyphosis / Angulation",
    description: "Thoracic sagittal curvature: maintained, exaggerated, straightened, reversed or focally angulated.",
    aliases: [
      "thoracic kyphosis",
      "hyperkyphosis",
      "exaggerated thoracic kyphosis",
      "straight thoracic spine",
      "reversal of thoracic kyphosis",
      "kyphotic angulation",
    ],
    regions: ["dorsal spine", "whole spine"],
    modalities: ["MR"],
  },
  {
    concept: "gibbus_deformity",
    label: "Gibbus Deformity",
    description: "Focal angular kyphotic deformity, usually at a collapsed vertebra.",
    aliases: ["gibbus", "gibbus deformity", "kyphotic gibbus"],
    regions: ["dorsal spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "scoliosis",
    label: "Scoliotic Deformity",
    description: "Coronal thoracic curvature with convexity side and apex level.",
    aliases: ["scoliosis", "scoliotic deformity", "scoliotic curvature", "apex vertebral rotation"],
    regions: ["dorsal spine", "whole spine"],
    modalities: ["MR", "CT", "XR"],
  },
  {
    concept: "olf",
    label: "Ossification of the Ligamentum Flavum",
    description: "OLF — ossified ligamentum flavum producing canal narrowing. Distinct from LF hypertrophy.",
    aliases: [
      "olf",
      "ossification of the ligamentum flavum",
      "ossification of ligamentum flavum",
      "flo",
    ],
    regions: ["dorsal spine", "whole spine"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "opl_ossification",
    label: "Ossification of the Posterior Longitudinal Ligament",
    description: "OPLL — ventral ossified ligament causing canal compromise. Distinct from PLL thickening.",
    aliases: [
      "opl",
      "opll",
      "ossification of the posterior longitudinal ligament",
      "posterior longitudinal ligament ossification",
    ],
    regions: ["dorsal spine", "cervical spine", "whole spine"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "dish",
    label: "Diffuse Idiopathic Skeletal Hyperostrophy (DISH) Pattern",
    description: "Flowing/bridging anterior longitudinal ligament ossification across contiguous levels.",
    aliases: ["dish", "diffuse idiopathic skeletal hyperostrophy", "flowing ossification of the anterior longitudinal ligament"],
    regions: ["dorsal spine", "cervical spine", "whole spine"],
    modalities: ["MR", "CT", "XR"],
  },
  {
    concept: "ankylosing_pattern",
    label: "Bridging Syndesmophytes",
    description: "Anterior/lateral bridging syndesmophytes in an ankylosed spine — descriptive, not a rheumatologic diagnosis.",
    aliases: ["bamboo spine", "syndesmophytes", "bridging syndesmophytes", "ankylosed dorsal spine"],
    regions: ["dorsal spine", "whole spine"],
    modalities: ["MR", "CT", "XR"],
  },
  {
    concept: "costovertebral_joint",
    label: "Costovertebral / Costotransverse Region",
    description: "Rib-bearing joint arthropathy or osteophytes projecting into the canal or foramen.",
    aliases: [
      "costovertebral",
      "costovertebral joint",
      "costotransverse",
      "costovertebral arthropathy",
      "costovertebral osteophytes",
    ],
    regions: ["dorsal spine", "whole spine"],
    modalities: ["MR", "CT"],
  },
  {
    concept: "posterior_elements",
    label: "Posterior Elements",
    description: "Pedicles, laminae and spinous processes — intact, fractured or marrow-replaced.",
    aliases: [
      "posterior elements",
      "pedicle",
      "pedicles",
      "pedicle destruction",
      "lamina",
      "laminae",
      "spinous process",
      "winking owl sign",
    ],
    regions: ["dorsal spine", "cervical spine", "ls spine", "whole spine"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "posterior_ligamentous_complex",
    label: "Posterior Ligamentous Complex",
    description: "Interspinous/supraspinous ligament and ligamentum flavum injury pattern.",
    aliases: [
      "posterior ligamentous complex",
      "plc",
      "interspinous ligament",
      "supraspinous ligament",
      "hyperflexion sprain",
    ],
    regions: ["dorsal spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "retropulsion",
    label: "Retropulsed Bone Fragment",
    description: "Posterior cortex / fragment projecting into the spinal canal.",
    aliases: ["retropulsion", "retropulsed fragment", "retropulsed bone", "posterior wall involvement"],
    regions: ["dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cord_caliber",
    label: "Cord Caliber / Morphology",
    description: "Thoracic cord caliber, flattening, displacement, swelling or atrophy — morphology kept separate from signal and from compression.",
    aliases: [
      "cord caliber",
      "cord swelling",
      "cord atrophy",
      "cord expansion",
      "cord displacement",
      "cord flattening",
    ],
    regions: ["dorsal spine", "cervical spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "intradural_lesion",
    label: "Intradural Extramedullary Lesion",
    description: "Lesion in the intradural extramedullary compartment; histological labels stay radiologist-selected.",
    aliases: ["intradural", "intradural extramedullary", "intradural mass", "intradural lesion"],
    regions: ["dorsal spine", "cervical spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "intramedullary_lesion",
    label: "Intramedullary Lesion",
    description: "Lesion within the cord parenchyma; tumour type is never inferred from compartment alone.",
    aliases: ["intramedullary", "intramedullary mass", "intramedullary lesion"],
    regions: ["dorsal spine", "cervical spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "spinal_flow_voids",
    label: "Perimedullary Flow Voids",
    description: "Serpiginous perimedullary/dorsal subarachnoid flow voids — a vascular pattern, not a diagnosis.",
    aliases: [
      "perimedullary flow voids",
      "serpiginous flow voids",
      "spinal flow voids",
      "dural arteriovenous fistula",
      "davf",
    ],
    regions: ["dorsal spine", "ls spine", "whole spine"],
    modalities: ["MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "thoracolumbar_junction",
    label: "Thoracolumbar Junction",
    description: "T12-L1 / upper lumbar junction involvement when actually covered.",
    aliases: ["thoracolumbar junction", "tl junction", "junctional kyphosis"],
    regions: ["dorsal spine", "whole spine"],
    modalities: ["MR", "CT"],
  },
  {
    concept: "visualized_pleura",
    label: "Visualized Pleural Space",
    description: "Pleural fluid or atelectasis within a limited thoracic field of view.",
    aliases: ["pleural effusion", "pleural fluid", "bibasilar atelectasis"],
    regions: ["dorsal spine", "chest"],
    modalities: ["MR", "CT", "XR"],
  },
  {
    concept: "visualized_thoracic_aorta",
    label: "Visualized Thoracic Aorta",
    description: "Descriptive aortic calibre within a limited field of view — not a chest vascular assessment.",
    aliases: ["thoracic aorta", "descending thoracic aorta", "aortic dilatation"],
    regions: ["dorsal spine", "chest"],
    modalities: ["MR", "CT"],
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
