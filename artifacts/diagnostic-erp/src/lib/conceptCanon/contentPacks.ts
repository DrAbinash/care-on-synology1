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

import { vesselConceptEntries } from "@/lib/mriBrainVessels";
import { screeningConceptEntries } from "@/lib/mriBrainVascularScreening";
import type { ObservationRole } from "../observationSlot";

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
    ["mra_neck_arterial", "MRA Neck Arterial", "Extracranial carotid / vertebral arterial tree statement (§11). Kept off the intracranial slot so a combined study keeps both normals (§2).", true],
    ["mrv_venous", "MR Venography", "Dural venous sinus patency on MRV.", true],
    // §10/§12 first-class non-pathologic variant slots. A separate concept, so a
    // small-but-normal vessel never overwrites the pathology recorded on it (and the
    // other way round) merely because both describe the same artery.
    ["mra_variant", "Intracranial Arterial Variant", "Fetal PCA / A1 hypoplasia / vertebral dominance / PCom asymmetry — non-pathologic variant slot.", false],
    ["mrv_variant", "Dural Sinus Developmental Variant", "Transverse sinus hypoplasia / aplasia — non-pathologic developmental variant slot.", false],
    // Vascular statement slots that are not one vessel's status: a pattern, a rupture
    // statement, a drainage claim. Each owns its own slot so it coexists with the
    // vessel rows it refers to instead of overwriting them (mra/mrv spec §8, §9, §13).
    ["aneurysm_rupture_status", "Aneurysm Rupture Status", "Radiologist-stated ruptured / unruptured status for an aneurysm (§6).", true],
    ["aneurysm_pseudoaneurysm", "Pseudoaneurysm", "Post-dissection / arterial pseudoaneurysm statement (§11).", true],
    ["mra_moyamoya_pattern", "Moyamoya-Pattern Vasculopathy", "Angiographic pattern of terminal ICA narrowing with basal collaterals — pattern only (§8).", true],
    ["mra_moyamoya_disease", "Moyamoya Disease", "Radiologist disease classification, never generated from the pattern (§8).", true],
    ["avm_venous_drainage", "AVM Venous Drainage", "Drainage pattern, temporal claims gated on a time-resolved acquisition (§9).", true],
    ["willis_configuration", "Circle of Willis Configuration", "Configuration of the circle (complete / incomplete / variant anatomy) — §16's own macro line, and §17's first MRA subsection after technique.", false],
    ["avm_associated_aneurysm", "AVM Associated Aneurysm", "Aneurysm associated with the malformation's arterial supply, stated without a §6 morphology record (§9).", true],
    ["mra_neck_dissection", "Carotid / Vertebral Dissection", "Radiologist-selected dissection interpretation for an extracranial artery (§11).", true],
    ["mrv_thrombosis", "Dural Sinus Thrombosis", "Radiologist-selected sinus thrombosis interpretation (§13).", true],
    ["mrv_deep_venous_thrombosis", "Deep Cerebral Venous Thrombosis", "Internal cerebral veins / vein of Galen thrombosis (§13).", true],
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

  // ─── MRA / MRV per-vessel observation slots (mra/mrv sub-master V3) ─────
  // GENERATED from the vessel registry (mriBrainVessels.ts), because a vessel row's
  // ledger identity IS its concept: the slot's `level` field is a spine vocabulary
  // and discards "MCA-M1". Deriving both from one registry means an artery cannot
  // exist in the tree and be missing from the concept canon.
  ...vesselConceptEntries().map((entry) => ({
    concept: entry.concept,
    label: entry.label,
    description: entry.description,
    aliases: [entry.concept, entry.concept.replace(/_/g, " ")],
    regions: ["brain"] as ContentPackRegion[],
    modalities: ["MR"] as ContentPackModality[],
    impressionworthyAbnormal: entry.impressionworthyAbnormal,
  })),

  // ─── §14 Basic intracranial MRA screening slots (mriBrainVascularScreening.ts)
  // GENERATED from the screening checklist, for the same reason the vessel slots are:
  // a screening row's identity is its concept, and an artery in the checklist must not
  // be able to go unregistered. Screening keeps its own concepts rather than writing
  // on the dedicated per-segment slots so a screening pass can never overwrite a
  // dedicated observation — or be silently promoted into one.
  ...screeningConceptEntries().map((entry) => ({
    concept: entry.concept,
    label: entry.label,
    description: entry.description,
    aliases: [entry.concept, entry.concept.replace(/_/g, " ")],
    regions: ["brain"] as ContentPackRegion[],
    modalities: ["MR"] as ContentPackModality[],
    impressionworthyAbnormal: entry.impressionworthyAbnormal,
  })),
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
    // XR: the chest sub-master's nodule/mass palette needs structured slot
    // ownership on plain films, where CT-only ownership silently degraded it.
    modalities: ["CT", "XR"],
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

  // ─── Chest radiography (X-ray Chest Clinical Sub-Master V3) ────────────
  //
  // Concepts emitted by xrayChestSubMasters.ts / xrayChestNormalAtoms.ts /
  // xrayChestDevices.ts / xrayChestLesions.ts / xrayChestMeasures.ts.
  // Registration is functional, not cosmetic: an unregistered concept falls
  // back to heuristic sentence ownership instead of structured slot identity.
  //
  // Baseline (normal) concepts carry impressionworthyAbnormal: false — they are
  // the sentences an abnormality supersedes, never a reason to withdraw the
  // system normal impression.

  // Chest baselines
  { concept: "trachea", label: "Trachea central", description: "Trachea is midline.", aliases: ["trachea is central", "trachea midline", "tracheal position"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "cardiac_silhouette", label: "Cardiac silhouette normal", description: "Heart size within normal limits for projection.", aliases: ["cardiomediastinal silhouette is within normal limits", "cardiac silhouette normal", "normal heart size"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "lung_fields", label: "Lungs clear", description: "No focal air-space opacity.", aliases: ["lung fields are clear", "lungs clear", "no focal opacity"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "lung_expansion", label: "Lungs expanded", description: "Adequate lung expansion.", aliases: ["adequately expanded", "lungs expanded", "well expanded"], regions: ["chest"], modalities: ["XR"] },
  { concept: "pulmonary_vasculature", label: "Pulmonary vasculature normal", description: "Vascular markings within normal limits.", aliases: ["pulmonary vascular markings", "vascular markings normal"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "hila", label: "Hila normal", description: "No hilar enlargement.", aliases: ["hila are not enlarged", "normal hila", "hilar contours normal"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "mediastinum", label: "Mediastinum normal", description: "No mediastinal widening.", aliases: ["mediastinum is not widened", "normal mediastinum", "mediastinal contour normal"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "costophrenic_angles", label: "Costophrenic angles clear", description: "Angles sharp and included.", aliases: ["costophrenic angles are clear", "angles are sharp", "costophrenic angle blunting"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "pleura", label: "Pleura normal", description: "No effusion or pneumothorax.", aliases: ["no pleural effusion or pneumothorax", "pleura normal"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "diaphragm", label: "Diaphragm normal", description: "Normal position and contour.", aliases: ["diaphragms are normal", "normal diaphragm"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "upper_abdomen", label: "Upper abdomen normal", description: "Visualised upper abdomen unremarkable.", aliases: ["visible upper abdomen is unremarkable", "upper abdomen normal"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "subdiaphragmatic_free_air", label: "No free gas", description: "No subdiaphragmatic free gas.", aliases: ["no subdiaphragmatic free gas", "no free air"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "osseous_structures", label: "Bones normal", description: "No acute bony abnormality.", aliases: ["no acute bony abnormality", "osseous structures normal"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "soft_tissues", label: "Soft tissues normal", description: "Visualised soft tissues unremarkable.", aliases: ["soft tissues are unremarkable", "soft tissues normal"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "lines_tubes_devices_absent", label: "No lines or tubes", description: "No support devices identified.", aliases: ["no lines, tubes or devices", "no lines or tubes", "no devices"], regions: ["chest"], modalities: ["XR", "CT"] },

  // Air-space / infection pattern
  { concept: "air_space_opacity", label: "Air-space opacity", description: "Focal air-space opacity.", aliases: ["air-space opacity", "airspace opacity", "focal opacity"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "consolidation", label: "Consolidation", description: "Lobar or segmental consolidation.", aliases: ["consolidation", "lobar consolidation", "segmental consolidation"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "air_bronchogram", label: "Air bronchograms", description: "Air bronchograms within consolidation.", aliases: ["air bronchogram", "air bronchograms"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "cavitation", label: "Cavitation", description: "Cavitary change in consolidation.", aliases: ["cavitation", "cavitary", "cavity"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "multifocal_opacity", label: "Multifocal opacity", description: "Multifocal air-space opacities.", aliases: ["multifocal opacity", "multifocal opacities"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "peribronchial_opacity", label: "Peribronchial opacities", description: "Patchy peribronchial air-space opacities.", aliases: ["peribronchial opacity", "peribronchial opacities"], regions: ["chest"], modalities: ["XR"], impressionworthyAbnormal: true },

  // TB pattern (descriptive only — never asserts active tuberculosis)
  { concept: "upper_zone_opacity", label: "Upper-zone opacity", description: "Upper-zone predominant heterogeneous opacity.", aliases: ["upper zone opacity", "upper-zone opacity"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "fibro_cavitary_change", label: "Fibro-cavitary change", description: "Fibrosis with cavitation, upper zone.", aliases: ["fibro-cavitary", "fibrocavitary"], regions: ["chest"], modalities: ["XR"], impressionworthyAbnormal: true },
  { concept: "apical_pleural_thickening", label: "Apical cap", description: "Apical pleuroparenchymal thickening.", aliases: ["apical pleuroparenchymal thickening", "apical cap"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "calcified_granuloma", label: "Calcified granuloma", description: "Healed granulomatous calcific nodule.", aliases: ["calcified granuloma", "granuloma"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "miliary_nodules", label: "Miliary nodules", description: "Innumerable tiny nodular opacities.", aliases: ["miliary", "miliary-pattern", "micronodular"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "volume_loss_hilar_elevation", label: "Volume loss with hilar elevation", description: "Hilar elevation with volume loss.", aliases: ["hilar elevation", "volume loss with hilar elevation"], regions: ["chest"], modalities: ["XR"], impressionworthyAbnormal: true },
  { concept: "mediastinal_lymphadenopathy", label: "Mediastinal lymphadenopathy", description: "Hilar / mediastinal nodal enlargement pattern.", aliases: ["lymph node enlargement", "lymphadenopathy", "nodal enlargement"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },

  // Edema / cardiac pattern
  { concept: "pulmonary_vascular_redistribution", label: "Vascular redistribution", description: "Pulmonary vascular congestion / redistribution.", aliases: ["vascular redistribution", "pulmonary venous congestion", "cephalisation", "cephalization"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "interstitial_edema", label: "Interstitial oedema", description: "Perihilar interstitial opacities with septal lines.", aliases: ["interstitial edema", "interstitial oedema", "septal lines", "kerley lines"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "air_space_edema", label: "Air-space oedema", description: "Perihilar batwing air-space opacities.", aliases: ["alveolar edema", "batwing", "air-space oedema"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "peribronchial_cuffing", label: "Peribronchial cuffing", description: "Peribronchial cuffing.", aliases: ["peribronchial cuffing", "bronchial cuffing"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },

  // Pleural disease
  { concept: "pleural_effusion", label: "Pleural effusion", description: "Pleural fluid collection.", aliases: ["pleural effusion", "effusion", "costophrenic blunting", "meniscus"], regions: ["chest"], modalities: ["XR", "CT", "US"], impressionworthyAbnormal: true },
  { concept: "loculated_effusion", label: "Loculated effusion", description: "Loculated pleural collection.", aliases: ["loculated effusion", "loculated collection"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "pleural_thickening", label: "Pleural thickening", description: "Pleural thickening.", aliases: ["pleural thickening"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "pleural_calcification", label: "Pleural calcification", description: "Pleural calcification.", aliases: ["pleural calcification", "calcified pleura"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "hydropneumothorax", label: "Hydropneumothorax", description: "Air-fluid level with pneumothorax.", aliases: ["hydropneumothorax", "air-fluid level"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "tension_pattern_signs", label: "Tension-pattern signs", description: "Mediastinal shift and diaphragmatic depression. Signs only — tension is a radiologist/clinical determination.", aliases: ["tension physiology", "mediastinal shift away", "depressed hemidiaphragm"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },

  // Collapse / COPD / ILD
  { concept: "atelectasis", label: "Atelectasis", description: "Linear or subsegmental atelectatic band.", aliases: ["atelectasis", "atelectatic band", "subsegmental atelectasis"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "lobar_collapse", label: "Lobar collapse", description: "Lobar or segmental volume loss.", aliases: ["collapse", "lobar collapse", "volume loss"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "fissural_displacement", label: "Fissural displacement", description: "Fissure displaced by volume loss.", aliases: ["fissural displacement", "fissure displacement"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "ipsilateral_shift", label: "Ipsilateral shift", description: "Hilar / mediastinal shift toward volume loss.", aliases: ["shift toward", "ipsilateral mediastinal shift"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "compensatory_hyperinflation", label: "Compensatory hyperinflation", description: "Hyperinflation adjacent to volume loss.", aliases: ["compensatory hyperinflation", "compensatory emphysema"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "hyperinflation", label: "Hyperinflation", description: "Hyperinflated lungs.", aliases: ["hyperinflated", "hyperinflation"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "flattened_diaphragms", label: "Flattened diaphragms", description: "Diaphragmatic flattening.", aliases: ["flattened diaphragms", "flat diaphragms"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "retrosternal_clear_space_increased", label: "Increased retrosternal space", description: "Lateral-view hyperinflation sign.", aliases: ["retrosternal clear space", "retrosternal space"], regions: ["chest"], modalities: ["XR"], impressionworthyAbnormal: true },
  { concept: "attenuated_vascular_markings", label: "Attenuated peripheral markings", description: "Peripheral vascular pruning.", aliases: ["attenuated vascular markings", "pruned vessels", "oligaemic"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "bullae", label: "Bullae", description: "Bullous change.", aliases: ["bulla", "bullae", "bullous change"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "chronic_bronchitic_markings", label: "Chronic bronchitic markings", description: "Increased bronchovascular markings.", aliases: ["chronic bronchitic", "bronchovascular markings"], regions: ["chest"], modalities: ["XR"], impressionworthyAbnormal: true },
  { concept: "interstitial_opacity", label: "Interstitial opacity", description: "Reticular / reticulonodular interstitial opacities.", aliases: ["reticular", "reticulonodular", "interstitial opacity", "interstitial pattern"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "interstitial_predominance", label: "Interstitial predominance", description: "Peripheral / lower-zone predominance.", aliases: ["peripheral predominance", "basal predominance", "lower zone predominance"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "reduced_lung_volumes", label: "Reduced lung volumes", description: "Low lung volumes.", aliases: ["reduced lung volumes", "low lung volumes"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "fibrosis", label: "Fibrotic change", description: "Coarse fibrotic change with volume loss.", aliases: ["fibrosis", "fibrotic change"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "honeycombing", label: "Honeycombing", description: "Honeycomb-pattern lucencies where evident.", aliases: ["honeycomb", "honeycombing"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "peribronchial_markings", label: "Peribronchial markings", description: "Perihilar / peribronchial marking prominence (common paediatric pattern).", aliases: ["peribronchial thickening", "perihilar markings"], regions: ["chest"], modalities: ["XR"], impressionworthyAbnormal: true },

  // Nodule / mass
  { concept: "pulmonary_nodules", label: "Multiple pulmonary nodules", description: "Multiple nodules of varying size.", aliases: ["multiple nodules", "pulmonary nodules"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "mass_like_opacity", label: "Mass-like opacity", description: "Rounded mass-like pulmonary opacity.", aliases: ["mass", "mass-like opacity", "pulmonary mass"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "lesion_calcification", label: "Lesion calcification", description: "Calcification visible within a lesion.", aliases: ["calcified lesion", "calcification within the lesion"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },

  // Cardiomediastinal / diaphragm
  { concept: "cardiomegaly", label: "Cardiomegaly", description: "Cardiac silhouette enlarged for projection.", aliases: ["cardiomegaly", "heart enlarged", "enlarged cardiac silhouette"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "cardiac_size_not_assessed", label: "Cardiac size not assessable", description: "AP projection prevents cardiac-size assessment.", aliases: ["cannot be assessed on the ap projection", "cardiac size not assessed"], regions: ["chest"], modalities: ["XR"] },
  { concept: "aortic_calcification", label: "Aortic calcification", description: "Aortic unfolding / atherosclerotic calcification.", aliases: ["aortic unfolding", "atherosclerotic calcification", "calcified aorta"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "mediastinal_widening", label: "Mediastinal widening", description: "Widened mediastinum.", aliases: ["mediastinal widening", "widened mediastinum"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "hilar_prominence", label: "Hilar prominence", description: "Prominent hilar contour.", aliases: ["hilar prominence", "prominent hilum"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "pulmonary_artery_prominence", label: "Pulmonary artery prominence", description: "Enlarged pulmonary arteries.", aliases: ["pulmonary artery prominence", "prominent pulmonary arteries"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "paratracheal_opacity", label: "Paratracheal opacity", description: "Paratracheal soft-tissue opacity.", aliases: ["paratracheal opacity", "right paratracheal"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "tracheal_deviation", label: "Tracheal deviation", description: "Trachea displaced from midline.", aliases: ["tracheal deviation", "deviated trachea"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "elevated_hemidiaphragm", label: "Elevated hemidiaphragm", description: "Hemidiaphragm elevated.", aliases: ["elevated hemidiaphragm", "raised diaphragm"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "eventration", label: "Eventration", description: "Diaphragmatic eventration pattern.", aliases: ["eventration"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "hiatus_hernia", label: "Hiatus hernia pattern", description: "Retrocardiac air-fluid level / hiatus hernia.", aliases: ["hiatus hernia", "retrocardiac air-fluid level"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "pneumoperitoneum", label: "Subdiaphragmatic free gas", description: "Free intraperitoneal gas beneath the diaphragm.", aliases: ["subdiaphragmatic free gas", "pneumoperitoneum", "free gas under the diaphragm", "rigler"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },

  // Trauma
  { concept: "rib_fracture", label: "Rib fracture", description: "Rib fracture where visible.", aliases: ["rib fracture", "fractured rib"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "clavicle_fracture", label: "Clavicular fracture", description: "Clavicle fracture.", aliases: ["clavicular fracture", "clavicle fracture"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "hemothorax", label: "Haemothorax pattern", description: "Pleural fluid-density collection in trauma.", aliases: ["hemothorax", "haemothorax"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "pulmonary_contusion", label: "Pulmonary contusion", description: "Non-segmental opacity at the impact site.", aliases: ["pulmonary contusion", "contusion"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "subcutaneous_emphysema", label: "Subcutaneous emphysema", description: "Gas in the chest wall soft tissues.", aliases: ["subcutaneous emphysema", "surgical emphysema"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },

  // Lines, tubes and devices
  { concept: "et_tube_position", label: "Endotracheal tube", description: "Endotracheal tube position.", aliases: ["endotracheal tube", "ET tube", "nasotracheal tube"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "enteric_tube_position", label: "Enteric tube", description: "Nasogastric / orogastric tube position.", aliases: ["enteric tube", "nasogastric tube", "NG tube", "ogastric tube", "Ryle's tube"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "cvc_position", label: "Central venous catheter", description: "Central line course and tip.", aliases: ["central venous catheter", "central line", "CVC", "internal jugular line", "subclavian line"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "picc_position", label: "PICC", description: "Peripherally inserted central catheter.", aliases: ["PICC", "peripherally inserted central catheter"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "chest_drain_position", label: "Intercostal drain", description: "Chest drain course and side-hole.", aliases: ["intercostal drain", "chest drain", "ICD tube"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "pacemaker_leads", label: "Pacemaker / leads", description: "Pacemaker generator and lead course.", aliases: ["pacemaker", "pace maker", "pacing lead", "dual chamber pacemaker"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "icd_device", label: "ICD", description: "Implantable cardioverter-defibrillator.", aliases: ["ICD", "defibrillator", "AICD"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "prosthetic_valve", label: "Prosthetic valve", description: "Prosthetic cardiac valve.", aliases: ["prosthetic valve", "valve replacement", "mechanical valve"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "sternotomy_wires", label: "Sternotomy wires", description: "Sternal wires and their integrity.", aliases: ["sternotomy wires", "sternal wires", "wire fracture"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "surgical_hardware_other", label: "Other hardware", description: "Other implanted hardware.", aliases: ["hardware", "implant", "anchor", "mesh"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "surgical_clips", label: "Surgical clips / staples", description: "Post-surgical clips or staple lines.", aliases: ["surgical clips", "staple line", "staples", "haemostatic clips"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "sternotomy_change", label: "Post-sternotomy change", description: "Expected post-sternotomy appearance.", aliases: ["post-sternotomy", "post sternotomy change"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },
  { concept: "postop_volume_loss", label: "Post-operative volume loss", description: "Volume loss after thoracic surgery.", aliases: ["post-thoracic surgery volume loss", "post-operative volume loss", "pneumonectomy"], regions: ["chest"], modalities: ["XR", "CT"], impressionworthyAbnormal: true },

  // Paediatric
  { concept: "thymic_contour", label: "Thymic contour", description: "Age-appropriate thymus. Not a mediastinal mass.", aliases: ["thymus", "thymic shadow", "thymic contour", "sail sign"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "cardiomediastinal_age_appropriate", label: "Age-appropriate silhouette", description: "Cardiomediastinal contour appropriate for age and projection.", aliases: ["appropriate for age", "age appropriate silhouette"], regions: ["chest"], modalities: ["XR"] },

  // Narrative support concepts
  { concept: "ct_recommendation", label: "CT correlation (selected)", description: "Radiologist-selected CT recommendation.", aliases: ["CT correlation", "HRCT correlation", "CT recommended"], regions: ["chest"], modalities: ["XR"] },
  { concept: "chest_normal_impression", label: "Normal chest impression", description: "Clinic wording for a normal chest radiograph.", aliases: ["no active cardiopulmonary abnormality"], regions: ["chest"], modalities: ["XR"] },
  { concept: "technique_limitation", label: "Technique limitation", description: "Limitation that materially affects interpretation.", aliases: ["technical limitation", "limited study"], regions: ["chest"], modalities: ["XR", "CT"] },
  { concept: "comparison_reference", label: "Comparison reference", description: "Dated prior-study comparison statement.", aliases: ["comparison made with", "compared with prior study", "previous study dated"], regions: ["chest"], modalities: ["XR", "CT"] },

  // Descriptive-safety reminder lines (never assert a diagnosis). Aliases are
  // fragments of the reminder prose itself so a hand-typed or voice-typed
  // disclaimer is still owned by its concept instead of becoming loose prose.
  { concept: "infection_disclaimer", label: "No microbiologic etiology", description: "Etiology cannot be assigned from radiography alone.", aliases: ["microbiologic etiology cannot be assigned from radiography", "etiology cannot be assigned from radiography alone", "no microbiologic etiology"], regions: ["chest"], modalities: ["XR"] },
  { concept: "tb_disclaimer", label: "Active TB not asserted", description: "Pattern described; active tuberculosis requires radiologist and clinical determination.", aliases: ["active tuberculosis is not asserted", "tuberculosis is not asserted by this report", "requires radiologist selection with clinical and microbiological correlation"], regions: ["chest"], modalities: ["XR"] },
  { concept: "edema_disclaimer", label: "Cardiac failure not inferred", description: "Oedema pattern without asserting cardiac failure.", aliases: ["cardiac failure is not inferred", "heart failure is not inferred", "oedema pattern without asserting cardiac failure"], regions: ["chest"], modalities: ["XR"] },
  { concept: "copd_disclaimer", label: "COPD not diagnosed", description: "Hyperinflation alone does not establish COPD.", aliases: ["chronic obstructive pulmonary disease is not diagnosed from hyperinflation alone", "copd is not diagnosed from hyperinflation alone", "hyperinflation alone does not establish copd"], regions: ["chest"], modalities: ["XR"] },
  { concept: "pneumothorax_disclaimer", label: "Tension not size-derived", description: "Tension requires signs plus clinical context.", aliases: ["tension pneumothorax is not labelled from size alone", "tension is not inferred from size", "requires radiographic signs and clinical context"], regions: ["chest"], modalities: ["XR"] },
  { concept: "trauma_disclaimer", label: "Occult injury not excluded", description: "A normal film does not exclude occult thoracic injury.", aliases: ["normal chest radiograph does not exclude occult thoracic injury", "does not exclude occult injury", "occult thoracic injury not excluded"], regions: ["chest"], modalities: ["XR"] },
  { concept: "thymic_disclaimer", label: "Thymus is not a mass", description: "Normal thymic contour is not read as a mass in this age group.", aliases: ["normal thymic contour is not interpreted as a mediastinal mass", "thymic contour is not a mass", "not interpreted as a mediastinal mass in this age group"], regions: ["chest"], modalities: ["XR"] },
  { concept: "device_disclaimer", label: "No invented tip distance", description: "Device positions recorded descriptively only.", aliases: ["device positions are recorded descriptively", "tip distances are entered only when actually measured", "no invented tip distance"], regions: ["chest"], modalities: ["XR"] },

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

  // ─── X-ray cervical spine (radiography sub-master V3) ───────────────────
  //
  // Registered from xrayCervicalSubMasters.ts, one pack per emitted concept.
  // Normal / baseline statements are separate concepts from their abnormal
  // counterparts, because impressionworthiness is a property of the CONCEPT
  // (isImpressionworthyAbnormal) — "disc spaces preserved" and "C5-C6 disc
  // space narrowing" cannot share one id.
  //
  // These are radiographic observations only. Cord signal, canal stenosis
  // grading, disc desiccation / Pfirrmann, Modic change and root attribution
  // are MRI conclusions and are deliberately absent (spec §1).

  // Baseline / normal core (spec §4, §5)
  {
    concept: "cervical_alignment",
    label: "Cervical Alignment Maintained",
    description: "Normal cervical alignment and lordosis on the lateral radiograph.",
    aliases: ["cervical_alignment", "alignment and lordosis maintained", "normal cervical alignment"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_alignment_lines",
    label: "Cervical Alignment Lines Intact",
    description: "Anterior vertebral, posterior vertebral, spinolaminar and posterior spinous lines continuous.",
    aliases: ["cervical_alignment_lines", "alignment lines smooth", "intact anterior vertebral line"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "vertebral_body_height",
    label: "Vertebral Body Heights Preserved",
    description: "No loss of cervical vertebral body height on radiography.",
    aliases: ["vertebral_body_height", "heights maintained", "preserved vertebral heights"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_disc_space",
    label: "Cervical Disc Spaces Preserved",
    description: "Cervical disc-space heights preserved at the levels visualized.",
    aliases: ["cervical_disc_space", "disc spaces preserved", "disc height maintained"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "posterior_elements",
    label: "Posterior Elements",
    description:
      "Pedicles, laminae and spinous processes — intact, fractured, deficient or marrow-replaced.",
    // Radiography and MR/CT describe the same anatomy, so this is ONE
    // canonical concept for both; the alias list is the union of the wording
    // each modality actually uses.
    aliases: [
      "posterior_elements",
      "posterior elements",
      "posterior elements intact",
      "neural arches intact",
      "pedicle",
      "pedicles",
      "pedicle destruction",
      "lamina",
      "laminae",
      "spinous process",
      "winking owl sign",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["XR", "MR", "CT"],
    // The flag describes the ABNORMAL reading of the concept (fracture,
    // pedicle destruction, posterior-element defect). The XR cervical normal
    // set emits this same concept as a baseline observation, and the
    // role-aware rule above keeps that from suppressing the system normal.
    impressionworthyAbnormal: true,
  },
  {
    concept: "facet_joint_normal",
    label: "Cervical Facets Unremarkable",
    description: "Normal cervical facet joints on radiography.",
    aliases: ["facet_joint_normal", "facets unremarkable", "normal facet joints"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "uncovertebral_joints",
    label: "Uncovertebral Joints Preserved",
    description: "Normal uncovertebral (Luschka) joints — a cervical-specific structure.",
    aliases: ["uncovertebral_joints", "uncovertebral joints preserved", "luschka joints normal"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "neural_foramina",
    label: "Neural Foramina Patent",
    description: "Cervical neural foramina patent on an adequately positioned oblique view.",
    aliases: ["neural_foramina", "foramina patent", "patent neural foramina"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "prevertebral_soft_tissue",
    label: "Prevertebral Soft Tissues Normal",
    description: "Cervical prevertebral soft tissues not widened.",
    aliases: ["prevertebral_soft_tissue", "prevertebral tissues not widened", "normal prevertebral space"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "odontoid_integrity",
    label: "Odontoid / C1-C2 Unremarkable",
    description: "Odontoid and atlanto-axial alignment unremarkable when adequately visualized.",
    aliases: ["odontoid_integrity", "c1-c2 unremarkable", "atlanto-axial alignment normal"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "no_acute_fracture",
    label: "No Acute Fracture or Listhesis",
    description: "No acute cervical fracture or listhesis identified on the views obtained.",
    aliases: ["no_acute_fracture", "no fracture identified", "no acute osseous injury"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_no_hardware",
    label: "No Cervical Instrumentation",
    description: "No anterior or posterior cervical hardware seen.",
    aliases: ["cervical_no_hardware", "no instrumentation", "no cervical hardware seen"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },

  // Alignment / lordosis (spec §6)
  {
    concept: "cervical_lordosis",
    label: "Cervical Lordosis Altered",
    description: "Straightening or reversal of the normal cervical lordosis — descriptive, not an aetiology.",
    aliases: ["cervical_lordosis", "loss of lordosis on radiograph", "straightened cervical spine", "reversed cervical lordosis"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cervical_scoliosis",
    label: "Cervical Scoliosis",
    description: "Lateral cervical curvature on the frontal projection.",
    aliases: ["cervical_scoliosis", "lateral cervical curvature", "cervical listhesis-free curve"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cervical_alignment_line_disruption",
    label: "Alignment Line Disruption",
    description: "Abnormality of the anterior vertebral, posterior vertebral, spinolaminar or posterior spinous line.",
    aliases: ["cervical_alignment_line_disruption", "alignment line abnormality", "step in the posterior vertebral line"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },

  // Degenerative (spec §7)
  {
    concept: "cervical_endplate_sclerosis",
    label: "Cervical Endplate Sclerosis",
    description: "Endplate sclerosis or irregularity at a cervical segment on radiography.",
    aliases: ["cervical_endplate_sclerosis", "endplate sclerosis", "endplate irregularity"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "vacuum_phenomenon",
    label: "Disc Vacuum Phenomenon",
    description: "Gas within a cervical disc space, visible on radiography.",
    aliases: ["vacuum_phenomenon", "intr-disc gas", "gas in the disc space"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_facet_arthropathy",
    label: "Cervical Facet Arthropathy",
    description: "Cervical facet joint degeneration and hypertrophy on plain films.",
    // The id must not normalize onto another pack's alias: "facet arthropathy",
    // "facet hypertrophy" and "facet" already belong to the shared `facet_joint`
    // concept, and ALIAS_INDEX lets the earlier declaration win.
    aliases: ["cervical_facet_arthropathy", "cervical facet hypertrophy", "degenerative cervical facets"],
    regions: ["cervical spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "uncovertebral_arthropathy",
    label: "Uncovertebral Hypertrophy",
    description: "Hypertrophy of the uncovertebral (Luschka) joints — cervical-specific degeneration.",
    aliases: ["uncovertebral_arthropathy", "uncovertebral hypertrophy", "luschka joint hypertrophy"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_spondylosis",
    label: "Cervical Spondylosis",
    description: "Multilevel cervical degenerative change: osteophytes, disc-space reduction and endplate sclerosis.",
    aliases: ["cervical_spondylosis", "cervical spondylotic changes", "degenerative cervical spine change"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },

  // Craniocervical junction (spec §8)
  {
    concept: "odontoid_fracture",
    label: "Odontoid Fracture",
    description: "Fracture through the odontoid, requiring an adequate open-mouth / lateral assessment.",
    aliases: ["odontoid_fracture", "dens fracture", "fracture of the odontoid"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "c1_fracture",
    label: "C1 Fracture",
    description: "Fracture of the C1 ring or lateral mass.",
    aliases: ["c1_fracture", "atlas fracture", "c1 lateral mass fracture"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "c1_lateral_mass_asymmetry",
    label: "C1 Lateral-Mass Asymmetry",
    description: "Asymmetric C1 lateral masses on the open-mouth view, with technical rotation considered.",
    aliases: ["c1_lateral_mass_asymmetry", "lateral mass asymmetry", "asymmetric atlanto-axial joints"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "atlanto_axial_instability",
    label: "Atlanto-Axial Interval Widening",
    description: "Widened atlanto-dental interval; significance is selected by the reporting radiologist.",
    aliases: ["atlanto_axial_instability", "widened atlanto-dental interval", "increased adi"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "craniocervical_junction_alignment",
    label: "Craniocervical Junction Aligned",
    description: "Normal basion-dental / craniocervical alignment on adequately seen views.",
    aliases: ["craniocervical_junction_alignment", "ccj aligned", "basion-dental relationship normal"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "odontoid_not_assessed",
    label: "Odontoid Not Assessed",
    description: "The odontoid is not adequately visualized, so C1-C2 injury is not excluded.",
    aliases: ["odontoid_not_assessed", "odontoid not visualized", "c1-c2 not assessed"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "atlanto_dental_interval",
    label: "Atlanto-Dental Interval Measurement",
    description: "Measured atlanto-dental interval with view and provenance; a measurement, not a diagnosis.",
    aliases: ["atlanto_dental_interval", "adi measurement", "measured atlanto-dental interval"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },

  // Trauma (spec §9)
  {
    concept: "cervical_facet_dislocation",
    label: "Cervical Facet Dislocation",
    description: "Perched or dislocated cervical facet with segmental malalignment.",
    aliases: ["cervical_facet_dislocation", "perched facet", "facet dislocation"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "burst_fracture",
    label: "Cervical Burst Fracture",
    description: "Burst-type cervical fracture with posterior cortical retropulsion.",
    aliases: ["burst_fracture", "burst-type fracture", "axial load fracture"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cervical_cortical_disruption",
    label: "Cortical Step / Disruption",
    description: "Cortical step or disruption of a cervical vertebra without a displaced fracture line.",
    aliases: ["cervical_cortical_disruption", "cortical step", "cortical disruption"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "posterior_element_fracture",
    label: "Posterior Element Fracture",
    description: "Fracture of a cervical spinous process, lamina or articular pillar.",
    aliases: ["posterior_element_fracture", "spinous process fracture", "lamina fracture"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "prevertebral_swelling",
    label: "Prevertebral Soft-Tissue Swelling",
    description: "Widened cervical prevertebral soft tissues, which may indicate occult injury or infection.",
    aliases: ["prevertebral_swelling", "prevertebral soft tissue widening", "increased prevertebral distance"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "prevertebral_calcification",
    label: "Prevertebral Calcification",
    description: "Calcification within the cervical prevertebral soft tissues.",
    aliases: ["prevertebral_calcification", "prevertebral calcific deposit", "longus colli calcification"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "prevertebral_gas",
    label: "Prevertebral Gas",
    description: "Gas within the cervical prevertebral soft tissues.",
    aliases: ["prevertebral_gas", "prevertebral air", "gas in the retropharyngeal space"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cervical_series_inadequate",
    label: "Series Inadequate to Exclude Injury",
    description: "The radiographic series cannot exclude cervical injury because required anatomy is not visualized.",
    aliases: ["cervical_series_inadequate", "series cannot exclude injury", "inadequate cervical radiographs"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cervical_c7t1_not_assessed",
    label: "C7-T1 Not Visualized",
    description: "The cervicothoracic junction is not adequately seen on the lateral projection.",
    aliases: ["cervical_c7t1_not_assessed", "c7-t1 not seen", "junction not visualized"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cervical_rotation_limitation",
    label: "Rotation Limits the Study",
    description: "Patient rotation limits assessment of alignment, lateral masses and oblique views.",
    aliases: ["cervical_rotation_limitation", "patient rotation limits assessment", "rotated cervical film"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cervical_spinal_precautions",
    label: "Spinal Precautions Advised",
    description: "Precautions and cross-sectional imaging advice after possible cervical injury.",
    aliases: ["cervical_spinal_precautions", "spinal precautions advised", "maintain cervical precautions"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },

  // Dynamic flexion / extension (spec §10)
  {
    concept: "cervical_dynamic_translation",
    label: "Dynamic Translation",
    description: "Inter-segment translation recorded in flexion and extension, with the derived change.",
    aliases: ["cervical_dynamic_translation", "translation on flexion extension", "positional translation"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_dynamic_angulation",
    label: "Dynamic Angulation Change",
    description: "Segmental angular change between flexion and extension positions.",
    aliases: ["cervical_dynamic_angulation", "angular change on flexion", "positional angulation change"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_dynamic_instability",
    label: "Dynamic Instability",
    description: "Instability on the flexion-extension study — a radiologist-selected interpretation, never inferred.",
    aliases: ["cervical_dynamic_instability", "instability on flexion extension", "dynamic cervical instability"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cervical_range_of_motion_limitation",
    label: "Range of Motion Limited",
    description: "Limited flexion / extension range reducing the dynamic assessment.",
    aliases: ["cervical_range_of_motion_limitation", "limited range of movement", "movement limited by pain"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_dynamic_not_assessed",
    label: "Dynamic Views Not Performed",
    description: "No flexion / extension views, so dynamic stability is not assessed.",
    aliases: ["cervical_dynamic_not_assessed", "no flexion extension views", "stability not assessed"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },

  // Measurements (spec §13)
  {
    concept: "cervical_listhesis_measurement",
    label: "Listhesis Translation Measurement",
    description: "Measured listhesis translation in mm or as a percentage of vertebral body width.",
    aliases: ["cervical_listhesis_measurement", "measured listhesis", "slip percentage measurement"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_angulation",
    label: "Segmental Angulation Measurement",
    description: "Measured cervical segmental angulation in degrees with level and view.",
    aliases: ["cervical_angulation", "measured segmental angulation", "angulation in degrees"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_cobb_angle",
    label: "Cervical Cobb Angle",
    description: "Cobb angle measured between named end vertebrae, with the view it was taken on.",
    aliases: ["cervical_cobb_angle", "cobb angle measurement", "cervical Cobb angle"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },

  // Congenital / developmental (spec §11)
  {
    concept: "block_vertebra",
    label: "Block Vertebra",
    description: "Failure of segmentation with anterior and posterior fusion of adjacent cervical vertebrae.",
    aliases: ["block_vertebra", "congenital fusion", "fused cervical vertebrae"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cervical_rib",
    label: "Cervical Rib",
    description: "Rib arising from a cervical vertebra, usually C7.",
    aliases: ["cervical_rib", "cervical rib from C7", "accessory cervical rib"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "transitional_vertebra",
    label: "Transitional Vertebra",
    description:
      "Vertebra with hybrid segmentation between spine regions. LSTV / Castellvi anatomy is what drives vertebral numbering, and the concept is shared by MRI, CT and radiography rather than declared once per modality.",
    aliases: [
      "transitional_vertebra",
      "transitional anatomy",
      "lumbarized vertebra",
      "lstv",
      "transitional vertebra",
      "lumbosacral transitional vertebra",
      "sacralization",
      "lumbarization",
      "castellvi",
    ],
    regions: ["cervical spine", "ls spine", "whole spine"],
    modalities: ["XR", "CT", "MR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "segmentation_anomaly",
    label: "Segmentation Anomaly",
    description: "Other congenital segmentation anomaly of the cervical spine.",
    aliases: ["segmentation_anomaly", "segmentation defect", "other segmentation anomaly"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "occipital_assimilation",
    label: "Occipital Assimilation of C1",
    description: "Partial fusion of the C1 anterior arch with the occiput.",
    aliases: ["occipital_assimilation", "assimilated atlas", "occipitalization of C1"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "cervical_spina_bifida",
    label: "Cervical Spina Bifida Occulta",
    description: "Posterior element defect at a cervical level without overt dysraphism on plain films.",
    aliases: ["cervical_spina_bifida", "spina bifida occulta cervical", "posterior arch defect"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "ossification_posterior_longitudinal",
    label: "Ossification of the Posterior Longitudinal Ligament",
    description: "Ossification along the posterior aspect of the cervical vertebral bodies.",
    aliases: ["ossification_posterior_longitudinal", "opl", "posterior longitudinal ligament ossification"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },

  // Infection / destructive and tumour patterns (spec §11)
  {
    concept: "disc_endplate_destruction",
    label: "Disc and Endplate Destruction",
    description: "Disc-space narrowing with adjacent endplate irregularity and destruction; aetiology needs correlation.",
    aliases: ["disc_endplate_destruction", "endplate destruction", "disc and endplate erosion"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "vertebral_body_destruction",
    label: "Vertebral Body Destruction",
    description: "Destructive loss of vertebral body architecture with height loss.",
    aliases: ["vertebral_body_destruction", "body destruction", "osteolytic vertebral destruction"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "focal_destructive_lesion",
    label: "Focal Destructive Osseous Lesion",
    description: "Focal destructive cervical osseous lesion; radiography does not establish the cause.",
    aliases: ["focal_destructive_lesion", "destructive osseous focus", "indeterminate osseous lesion"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "focal_lytic_lesion",
    label: "Focal Lytic Lesion",
    description: "Focal lytic cervical osseous lesion.",
    aliases: ["focal_lytic_lesion", "lytic vertebral lesion", "lucent bone lesion"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "focal_sclerotic_lesion",
    label: "Focal Sclerotic Lesion",
    description: "Focal sclerotic cervical osseous lesion.",
    aliases: ["focal_sclerotic_lesion", "sclerotic vertebral lesion", "dense bone focus"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "focal_mixed_lesion",
    label: "Mixed Lytic and Sclerotic Lesion",
    description: "Cervical osseous lesion with mixed lytic and sclerotic attenuation.",
    aliases: ["focal_mixed_lesion", "mixed lytic sclerotic lesion", "mixed density bone lesion"],
    regions: ["cervical spine", "dorsal spine", "ls spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "multiple_osseous_lesions",
    label: "Multiple Osseous Lesions",
    description: "Several focal cervical osseous lesions; aetiology requires clinical correlation.",
    aliases: ["multiple_osseous_lesions", "several bone lesions", "widespread osseous lesions"],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  // Post-operative (spec §12)
  {
    concept: "cervical_hardware",
    label: "Cervical Instrumentation",
    description: "Anterior or posterior cervical hardware: plate, screws, rods, cage or clip.",
    aliases: ["cervical_hardware", "cervical instrumentation", "ACDF plate and screws"],
    regions: ["cervical spine"],
    modalities: ["XR", "CT"],
    impressionworthyAbnormal: true,
  },
  {
    concept: "adjacent_segment_degeneration",
    label: "Adjacent-Segment Degeneration",
    description:
      "Degenerative change at the levels adjacent to a fusion construct — one concept for MRI, CT and radiography so a post-operative report cannot split by modality.",
    aliases: [
      "adjacent_segment_degeneration",
      "adjacent segment disease on imaging",
      "next-segment degeneration",
      "adjacent segment disease",
      "adjacent segment degeneration",
    ],
    regions: ["cervical spine", "dorsal spine", "ls spine", "whole spine"],
    modalities: ["XR", "MR"],
    impressionworthyAbnormal: true,
  },

  // Technique statements (spec §2)
  {
    concept: "cervical_swimmers_view",
    label: "Swimmer's Projection",
    description: "Swimmer's projection used to demonstrate the cervicothoracic junction.",
    aliases: ["cervical_swimmers_view", "swimmers view obtained", "cervicothoracic junction view"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
  },
  {
    concept: "cervical_projection_note",
    label: "Cervical Projection Note",
    description: "Additional or tailored cervical projection recorded in the technique.",
    aliases: ["cervical_projection_note", "lordotic frontal projection", "additional cervical projection"],
    regions: ["cervical spine"],
    modalities: ["XR"],
    impressionworthyAbnormal: false,
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
 * The context the impression-worthiness rule needs. Observations already
 * carry a role, so callers pass it through rather than re-deriving it.
 */
export type ImpressionworthinessContext = {
  role?: ObservationRole | null;
};

/**
 * THE AUTHORITATIVE impression-worthiness rule. One implementation; every
 * caller (ledger, store auto-yield, auto-return) delegates here.
 *
 *   - A concept MAY be registered with abnormal/impression-worthy pathology
 *     (impressionworthyAbnormal: true) and still be used to emit a normal
 *     baseline sentence. A baseline observation never suppresses the system
 *     normal impression, whatever the pack flag says.
 *   - Any other role (finding / impression / recommendation / screening, and
 *     an unrecorded role) is impression-worthy exactly when the pack says so.
 *   - Unknown concepts and empty input default to false (conservative: never
 *     suppress the system normal on unstructured text).
 *
 * Callers must NOT re-implement the baseline exclusion on top of this.
 */
export function isImpressionworthyAbnormal(
  concept: string | null | undefined,
  context?: ImpressionworthinessContext,
): boolean {
  if (!concept) return false;
  if (context?.role === "baseline") return false;
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
