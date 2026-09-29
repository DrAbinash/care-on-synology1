/**
 * mriBrainSubMasters.ts — MRI Brain clinical sub-masters.
 *
 * Progressive-disclosure palettes over ONE shared brain observation model.
 * They are NOT separate editors: every tile compiles to ledger atoms
 * (mriBrainAtoms) applied through the existing applyMacroBundle /
 * removeMacroBundle / clinical-undo machinery. Activating or deactivating a
 * sub-master only filters the palette UI — it never erases observations.
 *
 * Rules encoded here:
 *  - sequence-required tiles (`requires`) are gated by mriBrainSequences;
 *  - abnormal atoms reuse baseline normal concepts / baselineReplaces
 *    sentences so normals reconcile instead of contradicting;
 *  - differential / criteria wording stays radiologist-selected — no tile
 *    asserts a histopathological or criteria-based diagnosis automatically;
 *  - clinical thresholds live in the tested measures module, not here.
 */

import type { PendingPathologyPatch } from "@/lib/zai-workspace/store";
import {
  brainAtomsToPatches,
  brainBundleId,
  type BrainAtomSpec,
} from "@/lib/mriBrainAtoms";
import { BRAIN_NORMAL_SENTENCES, buildBrainNormalAtoms } from "@/lib/mriBrainNormalAtoms";
import {
  buildBrainLesionAtoms,
  type BrainLesionInput,
} from "@/lib/mriBrainLesion";
import {
  buildFazekasAtoms,
  buildHerniationAtoms,
  buildPituitaryAtoms,
} from "@/lib/mriBrainMeasures";
import type { BrainSequenceKey, BrainSequenceContext } from "@/lib/mriBrainSequences";
import { BRAIN_SEQUENCE_LABELS } from "@/lib/mriBrainSequences";

export type BrainTile = {
  id: string;
  label: string;
  group: string;
  /** Hidden behind "More / advanced" inside the palette. */
  advanced?: boolean;
  /** Sequences that must be performed for this tile to be usable. */
  requires?: BrainSequenceKey[];
  /** Never offered on pediatric studies (adult involution wording). */
  adultOnly?: boolean;
  atoms: BrainAtomSpec[];
};

export type BrainSubMaster = {
  id: BrainSubMasterId;
  label: string;
  hint: string;
  tiles: BrainTile[];
};

export const BRAIN_SUBMASTER_IDS = [
  "routine",
  "vascular",
  "trauma",
  "tumor",
  "infection",
  "demyelinating",
  "epilepsy",
  "sella",
  "cpa",
  "pediatric",
  "metabolic",
  "postop",
  "advanced",
] as const;

export type BrainSubMasterId = (typeof BRAIN_SUBMASTER_IDS)[number];

const N = BRAIN_NORMAL_SENTENCES;

const a = (
  concept: string,
  findings: string,
  extra?: Partial<BrainAtomSpec>,
): BrainAtomSpec => ({
  concept,
  conflictGroup: extra?.conflictGroup ?? concept,
  anatomicalSection: extra?.anatomicalSection ?? "brain",
  findings,
  ...extra,
});

// ─── 1. ROUTINE / NORMAL ──────────────────────────────────────────────────

const ROUTINE: BrainSubMaster = {
  id: "routine",
  label: "Routine / Normal",
  hint: "Protocol-aware normal baseline and common incidental edits.",
  tiles: [
    {
      id: "rt-atrophy",
      label: "Age-related volume loss",
      group: "Common deviations",
      adultOnly: true,
      atoms: [
        a("senile_atrophy",
          "Mild age-related cerebral volume loss with prominence of the cortical sulci and ventricular system.",
          { impression: "Age-related involutional changes.", baselineReplaces: N.ventricles, conflictGroup: "ventricles" }),
      ],
    },
    {
      id: "rt-sinusitis",
      label: "Incidental sinusitis",
      group: "Incidental / extracranial",
      atoms: [a("sinus", "Mucosal thickening in the [sinus] paranasal sinuses — incidental finding.", { anatomicalSection: "paranasal sinuses", baselineReplaces: N.sinuses })],
    },
    {
      id: "rt-mastoid",
      label: "Mastoid effusion",
      group: "Incidental / extracranial",
      atoms: [a("mastoid", "Mastoid air cells show T2 hyperintense secretion / mucosal thickening — incidental.", { anatomicalSection: "mastoids", baselineReplaces: N.mastoids })],
    },
    {
      id: "rt-scalp",
      label: "Scalp lesion",
      group: "Incidental / extracranial",
      atoms: [a("scalp", "A superficial scalp lesion is noted at [location] — incidental.", { anatomicalSection: "scalp and calvarium", baselineReplaces: N.scalp })],
    },
  ],
};

// ─── 2. VASCULAR / STROKE ────────────────────────────────────────────────

const VASCULAR: BrainSubMaster = {
  id: "vascular",
  label: "Vascular / Stroke",
  hint: "Ischemia, chronic SVD, haemorrhage, venous and other vascular patterns.",
  tiles: [
    {
      id: "va-acute-territorial",
      label: "Acute territorial infarct",
      group: "Acute ischaemia",
      requires: ["dwi", "adc"],
      atoms: [
        a("infarct",
          "Focal area of restricted diffusion with corresponding T2/FLAIR hyperintensity in the [location], in the [territory] artery territory, consistent with an acute territorial infarct.",
          { impression: "Acute territorial infarct in the [territory] distribution.", baselineReplaces: N.infarct }),
      ],
    },
    {
      id: "va-acute-lacunar",
      label: "Acute lacunar infarct",
      group: "Acute ischaemia",
      requires: ["dwi", "adc"],
      atoms: [
        a("infarct",
          "Small focal restricted diffusion in the [deep location], consistent with an acute lacunar infarct.",
          { impression: "Acute lacunar infarct.", baselineReplaces: N.infarct }),
      ],
    },
    {
      id: "va-watershed",
      label: "Watershed infarcts",
      group: "Acute ischaemia",
      requires: ["dwi", "adc"],
      advanced: true,
      atoms: [
        a("infarct",
          "Linear restricted diffusion in the border-zone territories bilaterally, consistent with watershed ischaemia.",
          { impression: "Border-zone (watershed) ischaemia.", baselineReplaces: N.infarct }),
      ],
    },
    {
      id: "va-hemorrhagic-transformation",
      label: "Haemorrhagic transformation",
      group: "Acute ischaemia",
      atoms: [a("hemorrhage", "Haemorrhagic transformation of the infarct.", { baselineReplaces: N.hemorrhage, severity: "critical" })],
    },
    {
      id: "va-svd",
      label: "Chronic small-vessel change",
      group: "Chronic ischaemic disease",
      atoms: [a("fazekas", "Periventricular and deep white-matter T2/FLAIR hyperintensities in keeping with chronic small-vessel ischaemic change. Fazekas grading to be set in the grading control.", { impression: "Chronic small-vessel ischaemic change." })],
    },
    {
      id: "va-lacunes",
      label: "Lacunes",
      group: "Chronic ischaemic disease",
      atoms: [a("lacunar", "Multiple small basal ganglia and thalamic lacunar cavities.", { impression: "Lacunar state." })],
    },
    {
      id: "va-encephalomalacia",
      label: "Chronic infarct / encephalomalacia",
      group: "Chronic ischaemic disease",
      atoms: [a("encephalomalacia", "Area of encephalomalacia with gliosis in the [location], consistent with a chronic infarct.", { impression: "Chronic infarct with encephalomalacia.", conflictGroup: "infarct", baselineReplaces: N.infarct })],
    },
    {
      id: "va-iph",
      label: "Intraparenchymal haematoma",
      group: "Haemorrhage",
      atoms: [a("hemorrhage", "Acute intraparenchymal haemorrhage in the [location], with surrounding oedema. Use the ICH measure for ABC/2 volume.", { impression: "Acute intraparenchymal haemorrhage.", baselineReplaces: N.hemorrhage, severity: "critical" })],
    },
    {
      id: "va-ivh",
      label: "Intraventricular haemorrhage",
      group: "Haemorrhage",
      atoms: [a("intraventricular_hemorrhage", "Intraventricular haemorrhage with a fluid level.", { impression: "Intraventricular haemorrhage.", conflictGroup: "hemorrhage", baselineReplaces: N.ventricles, severity: "critical" })],
    },
    {
      id: "va-sah",
      label: "Subarachnoid haemorrhage",
      group: "Haemorrhage",
      atoms: [a("subarachnoid_hemorrhage", "Abnormal susceptibility signal / hyperintensity within the subarachnoid spaces, consistent with subarachnoid haemorrhage.", { impression: "Subarachnoid haemorrhage.", conflictGroup: "hemorrhage", baselineReplaces: N.hemorrhage, severity: "critical" })],
    },
    {
      id: "va-microbleeds",
      label: "Cerebral microbleeds",
      group: "Haemorrhage",
      requires: ["swiGre"],
      atoms: [a("susceptibility", "Multiple cerebral microbleeds with blooming on GRE/SWI.", { impression: "Cerebral microbleeds.", baselineReplaces: N.susceptibility })],
    },
    {
      id: "va-siderosis",
      label: "Superficial siderosis",
      group: "Haemorrhage",
      requires: ["swiGre"],
      advanced: true,
      atoms: [a("susceptibility", "Superficial siderosis along the [location] with blooming on GRE/SWI.", { baselineReplaces: N.susceptibility })],
    },
    {
      id: "va-cvst",
      label: "Suspected CVST",
      group: "Venous",
      atoms: [a("cvst", "Loss of flow void / non-visualisation of the [sinus], suspicious for cerebral venous sinus thrombosis. Correlate with MRV where performed.", { impression: "Suspicious cerebral venous sinus thrombosis — please correlate clinically.", severity: "critical" })],
    },
    {
      id: "va-venous-infarct",
      label: "Venous infarction",
      group: "Venous",
      atoms: [a("venous_infarct", "Non-arterial territory oedema with haemorrhagic component adjacent to the thrombosed sinus, consistent with venous infarction.", { impression: "Venous infarction.", conflictGroup: "infarct", baselineReplaces: N.infarct, severity: "critical" })],
    },
    {
      id: "va-mrv-nonvisual",
      label: "MRV: sinus non-visualisation",
      group: "Venous",
      requires: ["mrv"],
      atoms: [a("mrv_venous", "Non-visualisation of the [sinus] on MRV.", { anatomicalSection: "intracranial vessels", baselineReplaces: N.mrv })],
    },
    {
      id: "va-pres",
      label: "PRES pattern",
      group: "Other vascular",
      advanced: true,
      atoms: [a("wm_signal_pattern", "Bilateral subcortical T2/FLAIR hyperintensities in the parieto-occipital regions, a pattern seen in PRES — please correlate clinically.", { impression: "Posterior-predominant subcortical oedema — clinical correlation." })],
    },
    {
      id: "va-cavernoma",
      label: "Cavernoma",
      group: "Other vascular",
      requires: ["swiGre"],
      atoms: [a("cavernoma", "Well-defined mixed-signal lesion with a hemosiderin rim blooming on GRE/SWI, in keeping with a cavernous malformation.", { impression: "Imaging features favor cavernous malformation.", baselineReplaces: N.susceptibility })],
    },
    {
      id: "va-avm",
      label: "Vascular malformation (AVM)",
      group: "Other vascular",
      advanced: true,
      atoms: [a("avm", "Tangle of flow voids with draining veins, consistent with an arteriovenous malformation.", { impression: "Imaging features consistent with AVM." })],
    },
    {
      id: "va-flow-void-loss",
      label: "Abnormal / lost flow void",
      group: "Other vascular",
      atoms: [a("vascular_flow_voids", "Loss of the normal flow void of the [vessel].", { anatomicalSection: "intracranial vessels", baselineReplaces: N.vascularFlowVoids })],
    },
    {
      id: "va-mra-occlusion",
      label: "MRA: occlusion / stenosis",
      group: "Other vascular",
      requires: ["mra"],
      atoms: [a("mra_arterial", "Signal cut-off / significant stenosis of the [artery] on MRA, where adequately assessed.", { anatomicalSection: "intracranial vessels", baselineReplaces: N.mra, impression: "MRA: [artery] occlusion/stenosis." })],
    },
  ],
};

// ─── 3. TRAUMA ───────────────────────────────────────────────────────────

const TRAUMA: BrainSubMaster = {
  id: "trauma",
  label: "Trauma",
  hint: "Extra-axial and intra-axial traumatic collections, DAI and mass effect.",
  tiles: [
    {
      id: "tr-edh",
      label: "Epidural haematoma",
      group: "Extra-axial",
      atoms: [a("epidural_hematoma", "Biconvex extra-axial collection in the [location] region, consistent with an epidural haematoma.", { impression: "Epidural haematoma.", conflictGroup: "extra_axial", baselineReplaces: N.extraAxial, severity: "critical" })],
    },
    {
      id: "tr-sdh-acute",
      label: "Acute subdural haematoma",
      group: "Extra-axial",
      atoms: [a("subdural_hematoma", "Crescentic extra-axial collection over the [side] hemisphere, acute-appearing, consistent with a subdural haematoma. Set midline shift in the measures strip.", { impression: "Acute subdural haematoma.", conflictGroup: "extra_axial", baselineReplaces: N.extraAxial, severity: "critical" })],
    },
    {
      id: "tr-sdh-chronic",
      label: "Chronic subdural haematoma / hygroma",
      group: "Extra-axial",
      atoms: [a("subdural_hematoma", "Neocranic/isointense crescentic collection consistent with a chronic subdural haematoma / hygroma.", { impression: "Chronic subdural collection.", conflictGroup: "extra_axial", baselineReplaces: N.extraAxial })],
    },
    {
      id: "tr-tsah",
      label: "Traumatic SAH",
      group: "Extra-axial",
      atoms: [a("subarachnoid_hemorrhage", "Small foci of subarachnoid blood in the [location].", { conflictGroup: "hemorrhage", baselineReplaces: N.hemorrhage })],
    },
    {
      id: "tr-contusion-hem",
      label: "Haemorrhagic contusion",
      group: "Intra-axial",
      atoms: [a("contusion", "Haemorrhagic contusions in the [frontal/temporal] lobes with surrounding oedema.", { impression: "Haemorrhagic cerebral contusions.", conflictGroup: "hemorrhage", baselineReplaces: N.hemorrhage })],
    },
    {
      id: "tr-contusion",
      label: "Non-haemorrhagic contusion",
      group: "Intra-axial",
      atoms: [a("contusion", "Non-haemorrhagic contusions with T2/FLAIR hyperintensity in the [location].", { impression: "Cerebral contusions." })],
    },
    {
      id: "tr-dai-gwj",
      label: "DAI — grey-white junction",
      group: "Diffuse axonal injury",
      atoms: [a("dai", "Small foci of T2/FLAIR hyperintensity and blooming at the grey-white matter junction, in keeping with diffuse axonal injury.", { impression: "Diffuse axonal injury." })],
    },
    {
      id: "tr-dai-cc",
      label: "DAI — corpus callosum",
      group: "Diffuse axonal injury",
      atoms: [a("dai_callosal", "Focal blooming in the corpus callosum (splenium), part of the DAI spectrum.", { conflictGroup: "dai" })],
    },
    {
      id: "tr-dai-bs",
      label: "DAI — brainstem",
      group: "Diffuse axonal injury",
      atoms: [a("dai_brainstem", "Focal blooming in the dorsolateral brainstem, consistent with DAI.", { conflictGroup: "dai", baselineReplaces: N.brainstem })],
    },
    {
      id: "tr-dai-swi",
      label: "DAI — SWI microhaemorrhages",
      group: "Diffuse axonal injury",
      requires: ["swiGre"],
      atoms: [a("susceptibility", "Multiple punctate susceptibility-blooming foci at typical DAI sites on GRE/SWI.", { baselineReplaces: N.susceptibility })],
    },
    {
      id: "tr-diffuse-edema",
      label: "Diffuse cerebral oedema",
      group: "Mass effect",
      atoms: [a("mass_effect", "Diffuse cerebral oedema with effacement of cortical sulci and basal cisterns.", { impression: "Diffuse cerebral oedema.", baselineReplaces: N.midline, severity: "critical" })],
    },
    {
      id: "tr-ivh",
      label: "Intraventricular haemorrhage",
      group: "Other",
      atoms: [a("intraventricular_hemorrhage", "Traumatic intraventricular haemorrhage.", { conflictGroup: "hemorrhage", baselineReplaces: N.ventricles, severity: "critical" })],
    },
    {
      id: "tr-scalp",
      label: "Scalp / subgaleal haematoma",
      group: "Other",
      atoms: [a("scalp", "Subgaleal / scalp haematoma at [location].", { anatomicalSection: "scalp and calvarium", baselineReplaces: N.scalp })],
    },
    {
      id: "tr-fracture",
      label: "Calvarial fracture (MRI limitation)",
      group: "Other",
      atoms: [a("calvarial_fracture", "Cortical disruption suggestive of a calvarial fracture. MRI has limited accuracy for fracture detection — dedicated bone CT is the reference.", { anatomicalSection: "scalp and calvarium", baselineReplaces: N.scalp })],
    },
  ],
};

// ─── 4. TUMOR / MASS ─────────────────────────────────────────────────────

const TUMOR: BrainSubMaster = {
  id: "tumor",
  label: "Tumor / Mass",
  hint: "Compartment first, then the shared lesion characterization panel.",
  tiles: [
    {
      id: "tu-intraaxial",
      label: "Intra-axial lesion",
      group: "Compartment",
      atoms: [a("brain_parenchyma", "An intra-axial parenchymal lesion is present — complete the shared lesion characterization.", { anatomicalSection: "brain parenchyma", baselineReplaces: N.parenchyma })],
    },
    {
      id: "tu-extraaxial",
      label: "Extra-axial lesion",
      group: "Compartment",
      atoms: [a("extra_axial", "An extra-axial lesion is present — complete the shared lesion characterization.", { baselineReplaces: N.extraAxial })],
    },
    {
      id: "tu-intraventricular",
      label: "Intraventricular lesion",
      group: "Compartment",
      atoms: [a("ventricles", "An intraventricular lesion is present — complete the shared lesion characterization.", { baselineReplaces: N.ventricles })],
    },
    {
      id: "tu-leptomeningeal",
      label: "Leptomeningeal / dural involvement",
      group: "Extensions",
      requires: ["contrast"],
      atoms: [a("leptomeningeal", "Leptomeningeal / dural enhancement extending from the lesion.", { impression: "Leptomeningeal/dural involvement.", conflictGroup: "extra_axial" })],
    },
    {
      id: "tu-mets",
      label: "Multiple metastases",
      group: "Extensions",
      atoms: [a("brain_parenchyma", "Multiple parenchymal lesions at the grey-white junction with disproportionate vasogenic oedema — metastatic disease to be considered.", { impression: "Multiple intracranial lesions — metastatic disease considered.", baselineReplaces: N.parenchyma }),
             a("edema", "Vasogenic oedema disproportionate to lesion size.", { conflictGroup: "edema" })],
    },
  ],
};

// Lesion panel differentials offered in Tumor palette (radiologist-selected).
export const TUMOR_DIFFERENTIALS = [
  "high-grade glioma",
  "low-grade glioma",
  "metastasis",
  "meningioma",
  "lymphoma",
  "other appropriate differential",
] as const;

// ─── 5. INFECTION ────────────────────────────────────────────────────────

const INFECTION: BrainSubMaster = {
  id: "infection",
  label: "Infection",
  hint: "Abscess, cerebritis, meningitis, ventriculitis, encephalitis, granulomas.",
  tiles: [
    {
      id: "in-ring-lesion",
      label: "Ring-enhancing lesion",
      group: "Focal infection",
      requires: ["contrast"],
      atoms: [a("brain_parenchyma", "Ring-enhancing focal lesion in the [location] with central non-enhancing content and surrounding vasogenic oedema.", { impression: "Ring-enhancing intracranial lesion — infective/granulomatous considered.", baselineReplaces: N.parenchyma })],
    },
    {
      id: "in-abscess",
      label: "Brain abscess (central DWI restriction)",
      group: "Focal infection",
      requires: ["dwi", "adc", "contrast"],
      atoms: [
        // DWI/ADC observation first: its slot owns the sequence normal sentence,
        // and the parenchyma sentence below must not be absorbed by it.
        a("diffusion", "DWI/ADC: central hyperintensity with low ADC signal within the lesion.", { baselineReplaces: N.diffusion }),
        a("brain_parenchyma", "Cystic lesion with a smooth ring-enhancing wall and central restricted diffusion, in keeping with an abscess.", { impression: "Brain abscess.", baselineReplaces: N.parenchyma, severity: "critical" }),
      ],
    },
    {
      id: "in-cerebritis",
      label: "Cerebritis",
      group: "Focal infection",
      atoms: [a("brain_parenchyma", "Ill-defined T2/FLAIR hyperintense region with patchy enhancement and oedema, in the cerebritis stage of infection.", { impression: "Cerebral infection (cerebritis stage).", baselineReplaces: N.parenchyma })],
    },
    {
      id: "in-meningitis",
      label: "Meningitis / leptomeningeal enhancement",
      group: "Membranes & ventricles",
      requires: ["contrast"],
      atoms: [a("leptomeningeal", "Diffuse leptomeningeal enhancement, most prominent over the [location] basal cisterns, consistent with meningitis.", { impression: "Leptomeningeal enhancement — meningitis.", baselineReplaces: N.enhancement, conflictGroup: "extra_axial" })],
    },
    {
      id: "in-ventriculitis",
      label: "Ventriculitis",
      group: "Membranes & ventricles",
      atoms: [a("ependymitis", "Ependymal enhancement with intraventricular debris, consistent with ventriculitis.", { impression: "Ventriculitis.", conflictGroup: "ventricles", baselineReplaces: N.ventricles })],
    },
    {
      id: "in-encephalitis",
      label: "Encephalitis (temporal/limbic pattern)",
      group: "Parenchymal infection",
      atoms: [a("encephalitis", "T2/FLAIR hyperintensity in the [medial temporal] region without significant diffusion restriction, an encephalitis pattern — aetiology is a clinical correlation.", { impression: "Limbic/temporal encephalitis pattern." })],
    },
    {
      id: "in-granuloma",
      label: "Granulomatous lesions",
      group: "Parenchymal infection",
      atoms: [a("brain_parenchyma", "Multiple small ring-enhancing / nodular lesions with eccentric nodular enhancement pattern — granulomatous disease considered.", { impression: "Multiple small enhancing lesions — granulomatous infective aetiologies considered.", baselineReplaces: N.parenchyma })],
    },
  ],
};

export const INFECTION_DIFFERENTIALS = [
  "pyogenic abscess",
  "tuberculoma",
  "neurocysticercosis",
  "fungal infection",
] as const;

// ─── 6. DEMYELINATING / INFLAMMATORY ─────────────────────────────────────

const DEMYELINATING: BrainSubMaster = {
  id: "demyelinating",
  label: "Demyelinating / Inflammatory",
  hint: "Structured distribution; formal diagnostic criteria stay clinical.",
  tiles: [
    {
      id: "dm-periventricular",
      label: "Periventricular lesions",
      group: "Distribution",
      atoms: [a("demyelinating_lesion", "Periventricular T2/FLAIR hyperintense lesions.", { level: "periventricular", conflictGroup: "demyelinating" })],
    },
    {
      id: "dm-juxtacortical",
      label: "Juxtacortical / cortical lesions",
      group: "Distribution",
      atoms: [a("demyelinating_lesion", "Juxtacortical T2/FLAIR hyperintense lesions.", { level: "juxtacortical", conflictGroup: "demyelinating" })],
    },
    {
      id: "dm-infratentorial",
      label: "Infratentorial lesions",
      group: "Distribution",
      atoms: [a("demyelinating_lesion", "Infratentorial T2/FLAIR hyperintense lesions in the middle cerebellar peduncles / pontine region.", { level: "infratentorial", conflictGroup: "demyelinating" })],
    },
    {
      id: "dm-callosal",
      label: "Corpus callosum lesions",
      group: "Distribution",
      atoms: [a("demyelinating_lesion", "Callosal and callososeptal interface lesions.", { level: "corpus callosum", conflictGroup: "demyelinating" })],
    },
    {
      id: "dm-dawson",
      label: "Dawson-finger morphology",
      group: "Morphology",
      atoms: [a("demyelinating_morphology", "Ovoid lesions oriented perpendicular to the ventricles (Dawson-finger pattern).", { conflictGroup: "demyelinating" })],
    },
    {
      id: "dm-active",
      label: "Enhancing active lesions",
      group: "Morphology",
      requires: ["contrast"],
      atoms: [a("demyelinating_activity", "Gadolinium-enhancing lesions indicating active blood-brain barrier breakdown; non-enhancing lesions are chronic-appearing.", { impression: "Active enhancing demyelinating-appearing lesions.", conflictGroup: "demyelinating", baselineReplaces: N.enhancement })],
    },
    {
      id: "dm-tumefactive",
      label: "Tumefactive lesion",
      group: "Morphology",
      advanced: true,
      atoms: [a("demyelinating_lesion", "Large (>2 cm) tumefactive demyelinating-appearing lesion with incomplete ring enhancement and minimal mass effect.", { level: "tumefactive", conflictGroup: "demyelinating", impression: "Tumefactive demyelinating-appearing lesion." })],
    },
    {
      id: "dm-ms-pattern",
      label: "MS-pattern consideration",
      group: "Radiologist considerations",
      atoms: [a("demyelinating_pattern", "Dissemination in space and time to be assessed clinically; imaging pattern raises the possibility of multiple sclerosis. Formal criteria are NOT asserted by this report.", { impression: "Demyelinating pattern — MS to be considered with formal criteria applied clinically." })],
    },
    {
      id: "dm-adem",
      label: "ADEM consideration",
      group: "Radiologist considerations",
      advanced: true,
      atoms: [a("demyelinating_pattern", "Large, poorly demarcated, multifocal lesions with a monophasic presentation pattern — ADEM to be considered clinically.", { impression: "ADEM-like demyelinating pattern to be correlated clinically." })],
    },
    {
      id: "dm-mogad",
      label: "MOGAD consideration",
      group: "Radiologist considerations",
      advanced: true,
      atoms: [a("demyelinating_pattern", "Fluffy/unilateral cortical-subcortical or brainstem lesion pattern where MOGAD is a serology-dependent consideration.", { conflictGroup: "demyelinating" })],
    },
    {
      id: "dm-pml",
      label: "PML consideration",
      group: "Radiologist considerations",
      advanced: true,
      atoms: [a("demyelinating_pattern", "Asymmetric subcortical white-matter lesions without enhancement or mass effect — PML to be considered in the appropriate immune context.", { conflictGroup: "demyelinating" })],
    },
  ],
};

// ─── 7. EPILEPSY ─────────────────────────────────────────────────────────

const mtsAtoms = (side: "right" | "left"): BrainAtomSpec[] => [
  a("hippocampus_volume", `Volume loss of the ${side} hippocampus.`, { laterality: side, anatomicalSection: "hippocampi", supportsLaterality: true }),
  a("hippocampus_signal", `T2/FLAIR hyperintensity of the ${side} hippocampus.`, { laterality: side, anatomicalSection: "hippocampi", supportsLaterality: true }),
  a("hippocampus_architecture", `Loss of internal architecture of the ${side} hippocampus.`, { laterality: side, anatomicalSection: "hippocampi", supportsLaterality: true }),
  a("hippocampus_pattern", `Features of mesial temporal sclerosis, ${side} side.`, { impression: `Mesial temporal sclerosis on the ${side}.`, laterality: side, conflictGroup: "hippocampus_volume", supportsLaterality: true }),
];

const EPILEPSY: BrainSubMaster = {
  id: "epilepsy",
  label: "Epilepsy",
  hint: "Epilepsy-protocol structured review: hippocampi → cortex → development → lesions.",
  tiles: [
    {
      id: "ep-hip-right-volume",
      label: "Right hippocampal volume loss",
      group: "Hippocampi",
      atoms: [a("hippocampus_volume", "Volume loss of the right hippocampus.", { laterality: "right", anatomicalSection: "hippocampi", supportsLaterality: true })],
    },
    {
      id: "ep-hip-right-signal",
      label: "Right hippocampal T2/FLAIR hyperintensity",
      group: "Hippocampi",
      atoms: [a("hippocampus_signal", "T2/FLAIR hyperintensity of the right hippocampus.", { laterality: "right", anatomicalSection: "hippocampi", supportsLaterality: true })],
    },
    {
      id: "ep-hip-right-arch",
      label: "Right hippocampus — loss of internal architecture",
      group: "Hippocampi",
      atoms: [a("hippocampus_architecture", "Loss of the normal internal architecture of the right hippocampus.", { laterality: "right", anatomicalSection: "hippocampi", supportsLaterality: true })],
    },
    {
      id: "ep-hip-left-volume",
      label: "Left hippocampal volume loss",
      group: "Hippocampi",
      atoms: [a("hippocampus_volume", "Volume loss of the left hippocampus.", { laterality: "left", anatomicalSection: "hippocampi", supportsLaterality: true })],
    },
    {
      id: "ep-hip-left-signal",
      label: "Left hippocampal T2/FLAIR hyperintensity",
      group: "Hippocampi",
      atoms: [a("hippocampus_signal", "T2/FLAIR hyperintensity of the left hippocampus.", { laterality: "left", anatomicalSection: "hippocampi", supportsLaterality: true })],
    },
    {
      id: "ep-hip-left-arch",
      label: "Left hippocampus — loss of internal architecture",
      group: "Hippocampi",
      atoms: [a("hippocampus_architecture", "Loss of the normal internal architecture of the left hippocampus.", { laterality: "left", anatomicalSection: "hippocampi", supportsLaterality: true })],
    },
    {
      id: "ep-temporal-horn",
      label: "Temporal horn prominence",
      group: "Hippocampi",
      atoms: [a("temporal_horn", "Prominence of the [side] temporal horn.", { anatomicalSection: "hippocampi", supportsLaterality: true })],
    },
    {
      id: "ep-mts-right",
      label: "Mesial temporal sclerosis — right",
      group: "Mesial temporal sclerosis",
      atoms: mtsAtoms("right"),
    },
    {
      id: "ep-mts-left",
      label: "Mesial temporal sclerosis — left",
      group: "Mesial temporal sclerosis",
      atoms: mtsAtoms("left"),
    },
    {
      id: "ep-mts-bilateral",
      label: "Mesial temporal sclerosis — bilateral",
      group: "Mesial temporal sclerosis",
      atoms: [
        a("hippocampus_pattern", "Bilateral hippocampal volume loss with T2/FLAIR hyperintensity and loss of internal architecture — bilateral mesial temporal sclerosis.", { impression: "Bilateral mesial temporal sclerosis.", conflictGroup: "hippocampus_volume" }),
      ],
    },
    {
      id: "ep-cortex-thickening",
      label: "Focal cortical thickening",
      group: "Cortex",
      atoms: [a("cortical_dysplasia", "Focal cortical thickening / gyral abnormality in the [location] — possible focal cortical dysplasia.", { impression: "Focal cortical abnormality — FCD considered.", conflictGroup: "cortical" })],
    },
    {
      id: "ep-gw-blurring",
      label: "Grey-white junction blurring",
      group: "Cortex",
      atoms: [a("cortical_dysplasia_gw", "Blurring of the grey-white matter junction in the [location], suspicious for focal cortical dysplasia.", { conflictGroup: "cortical" })],
    },
    {
      id: "ep-heterotopia",
      label: "Grey matter heterotopia",
      group: "Migration / development",
      atoms: [a("heterotopia", "Subependymal isointense grey-matter nodules (heterotopia).", { impression: "Grey matter heterotopia.", conflictGroup: "malformation" })],
    },
    {
      id: "ep-polymicrogyria",
      label: "Polymicrogyria / other malformation",
      group: "Migration / development",
      atoms: [a("polymicrogyria", "Cortical gyration abnormality consistent with polymicrogyria / another cortical malformation.", { conflictGroup: "malformation", impression: "Cortical malformation." })],
    },
    {
      id: "ep-lesion-enceph",
      label: "Encephalomalacia / gliosis as epileptogenic substrate",
      group: "Structural lesions",
      atoms: [a("encephalomalacia", "Area of encephalomalacia / gliosis in the [location] — a potential epileptogenic substrate.", { conflictGroup: "structural_epileptogenic", impression: "Encephalomalacia/gliosis — potential epileptogenic substrate." })],
    },
    {
      id: "ep-negative",
      label: "No definite structural epileptogenic focus",
      group: "Protocol review",
      requires: ["t2", "flair"],
      atoms: [a("epilepsy_negative", "No definite structural epileptogenic focus identified on the epilepsy-protocol sequences reviewed (coronal thin-slab T2/FLAIR through the hippocampi).", { impression: "" })],
    },
  ],
};

export const EPILEPSY_HIPPOCAMPUS_CONCEPTS = [
  "hippocampus_volume",
  "hippocampus_signal",
  "hippocampus_architecture",
] as const;

// ─── 8. PITUITARY / SELLA ────────────────────────────────────────────────

const SELLA: BrainSubMaster = {
  id: "sella",
  label: "Pituitary / Sella",
  hint: "Sella dedicated inputs; labels stay radiologist-controlled.",
  tiles: [
    {
      id: "se-micro",
      label: "Suspected microadenoma",
      group: "Lesions",
      requires: ["contrast"],
      atoms: [a("pituitary", "Small focal hypoenhancing lesion within the pituitary gland (<10 mm) — microadenoma considered.", { impression: "Pituitary microadenoma considered.", anatomicalSection: "sellar region", baselineReplaces: N.sellar })],
    },
    {
      id: "se-infundibulum",
      label: "Infundibular deviation / thickening",
      group: "Sellar architecture",
      atoms: [a("pituitary_infundibulum", "Deviation/thickening of the pituitary stalk.", { anatomicalSection: "sellar region", conflictGroup: "pituitary" })],
    },
    {
      id: "se-floor",
      label: "Sellar floor remodeling",
      group: "Sellar architecture",
      atoms: [a("pituitary_floor", "Remodeling/erosion of the sellar floor.", { anatomicalSection: "sellar region", conflictGroup: "pituitary" })],
    },
    {
      id: "se-apoplexy",
      label: "Haemorrhage / apoplexy",
      group: "Lesions",
      atoms: [a("pituitary_apoplexy", "Pituitary lesion with T1 hyperintense blood products, consistent with haemorrhage/apoplexy.", { impression: "Pituitary apoplexy.", anatomicalSection: "sellar region", conflictGroup: "pituitary", baselineReplaces: N.sellar, severity: "critical" })],
    },
    {
      id: "se-empty",
      label: "Empty sella",
      group: "Sellar architecture",
      advanced: true,
      atoms: [a("pituitary_empty", "Partially empty sella with a flattened adenohypophysis.", { anatomicalSection: "sellar region", conflictGroup: "pituitary", baselineReplaces: N.sellar })],
    },
  ],
};

// ─── 9. CPA / IAC / CRANIAL NERVE ────────────────────────────────────────

const CPA: BrainSubMaster = {
  id: "cpa",
  label: "CPA / IAC / Cranial Nerve",
  hint: "CPA/IAC lesions keep posterior-fossa normal reconciliation.",
  tiles: [
    {
      id: "cpa-right",
      label: "Right CPA lesion",
      group: "Lesions",
      atoms: [a("cpa_lesion", "Right cerebellopontine angle lesion — complete the shared lesion characterization for size and signal.", { laterality: "right", anatomicalSection: "posterior fossa", baselineReplaces: N.posteriorFossa, supportsLaterality: true })],
    },
    {
      id: "cpa-left",
      label: "Left CPA lesion",
      group: "Lesions",
      atoms: [a("cpa_lesion", "Left cerebellopontine angle lesion — complete the shared lesion characterization for size and signal.", { laterality: "left", anatomicalSection: "posterior fossa", baselineReplaces: N.posteriorFossa, supportsLaterality: true })],
    },
    {
      id: "cpa-iac",
      label: "IAC involvement",
      group: "Extensions",
      atoms: [a("iac_extension", "Intracanalicular extension through the internal auditory canal with an icicle sign.", { anatomicalSection: "posterior fossa", conflictGroup: "cpa_lesion" })],
    },
    {
      id: "cpa-compression",
      label: "Brainstem / fourth ventricle compression",
      group: "Extensions",
      atoms: [a("mass_effect", "Compression of the ipsilateral brainstem and the fourth ventricle.", { conflictGroup: "mass_effect", baselineReplaces: N.midline })],
    },
    {
      id: "cpa-hydro",
      label: "Obstructive hydrocephalus",
      group: "Extensions",
      atoms: [a("cerebral_hydrocephalus", "Upstream obstructive hydrocephalus.", { impression: "Obstructive hydrocephalus.", conflictGroup: "ventricles", baselineReplaces: N.ventricles, severity: "critical" })],
    },
    {
      id: "cpa-nerve",
      label: "Cranial nerve relationship",
      group: "Extensions",
      advanced: true,
      atoms: [a("cranial_nerve", "The lesion is splayed around / displacing cranial nerve VII-VIII complex where assessable.", { anatomicalSection: "posterior fossa", conflictGroup: "cpa_lesion" })],
    },
  ],
};

export const CPA_DIFFERENTIALS = [
  "vestibular schwannoma",
  "meningioma",
  "epidermoid",
  "other CPA lesion",
] as const;

// ─── 10. PEDIATRIC / CONGENITAL ──────────────────────────────────────────

const PEDIATRIC: BrainSubMaster = {
  id: "pediatric",
  label: "Pediatric / Congenital",
  hint: "Age-referenced statements; never adult normal wording.",
  tiles: [
    {
      id: "pd-myelination-normal",
      label: "Age-appropriate myelination",
      group: "Myelination",
      atoms: [a("myelination", "Myelination is appropriate for the stated age.", { conflictGroup: "myelination" })],
    },
    {
      id: "pd-myelination-delayed",
      label: "Delayed myelination",
      group: "Myelination",
      atoms: [a("myelination", "Hypomyelination / delayed myelination for the stated age.", { impression: "Delayed myelination for age.", conflictGroup: "myelination" })],
    },
    {
      id: "pd-callosal",
      label: "Corpus callosal abnormality",
      group: "Malformations",
      atoms: [a("corpus_callosum", "Corpus callosum abnormality (hypogenesis/dysgenesis) — specify.", { impression: "Callosal abnormality.", conflictGroup: "malformation" })],
    },
    {
      id: "pd-pf",
      label: "Posterior fossa malformation",
      group: "Malformations",
      atoms: [a("pf_malformation", "Posterior fossa malformation — Dandy-Walker / Chiari spectrum to be specified by the radiologist.", { impression: "Posterior fossa malformation.", conflictGroup: "posterior_fossa", baselineReplaces: N.posteriorFossa })],
    },
    {
      id: "pd-ventriculomegaly",
      label: "Ventriculomegaly",
      group: "Ventricles",
      atoms: [a("ventriculomegaly", "Ventriculomegaly — please correlate head circumference / clinical status.", { impression: "Ventriculomegaly.", conflictGroup: "ventricles", baselineReplaces: N.ventricles })],
    },
    {
      id: "pd-hie",
      label: "Perinatal hypoxic-ischaemic injury",
      group: "Perinatal",
      atoms: [a("perinatal_injury", "Pattern of perinatal hypoxic-ischaemic injury involving the [predominant region] — staging by the radiologist.", { impression: "Perinatal hypoxic-ischaemic pattern.", conflictGroup: "infarct", baselineReplaces: N.infarct })],
    },
    {
      id: "pd-gmh",
      label: "Germinal matrix / PV hemorrhage",
      group: "Perinatal",
      atoms: [a("germinal_matrix_hemorrhage", "Germinal matrix / periventricular haemorrhage — grade per radiologist.", { impression: "Germinal matrix/periventricular haemorrhage.", conflictGroup: "hemorrhage", baselineReplaces: N.hemorrhage })],
    },
    {
      id: "pd-congenital-infection",
      label: "Congenital infection pattern",
      group: "Perinatal",
      advanced: true,
      atoms: [a("congenital_infection", "Calcifications, migrational anomaly and white-matter change pattern where a congenital infection is a serology-dependent consideration.", { conflictGroup: "malformation" })],
    },
  ],
};

// ─── 11. METABOLIC / TOXIC ───────────────────────────────────────────────

const METABOLIC: BrainSubMaster = {
  id: "metabolic",
  label: "Metabolic / Toxic",
  hint: "Descriptive symmetric-pattern entries; aetiology is radiologist-selected.",
  tiles: [
    {
      id: "mb-bg",
      label: "Bilateral basal ganglia signal change",
      group: "Symmetric patterns",
      atoms: [a("metabolic_pattern", "Bilateral symmetric T2/FLAIR signal abnormality in the basal ganglia.", { level: "basal ganglia", conflictGroup: "metabolic", baselineReplaces: N.basalGanglia })],
    },
    {
      id: "mb-thalami",
      label: "Bilateral thalamic involvement",
      group: "Symmetric patterns",
      atoms: [a("metabolic_pattern", "Bilateral symmetric thalamic signal abnormality.", { level: "thalami", conflictGroup: "metabolic", baselineReplaces: N.basalGanglia })],
    },
    {
      id: "mb-wm",
      label: "Diffuse white-matter change",
      group: "Symmetric patterns",
      atoms: [a("metabolic_pattern", "Diffuse cerebral white-matter signal abnormality.", { level: "white matter", conflictGroup: "metabolic" })],
    },
    {
      id: "mb-cc",
      label: "Corpus callosum signal change",
      group: "Symmetric patterns",
      atoms: [a("metabolic_pattern", "Lesion of the corpus callosum with restricted diffusion, a pattern seen in toxic/metabolic injury.", { level: "corpus callosum", conflictGroup: "metabolic" })],
    },
    {
      id: "mb-bs-cb",
      label: "Brainstem / cerebellar pattern",
      group: "Symmetric patterns",
      atoms: [a("metabolic_pattern", "Symmetric brainstem and/or cerebellar signal abnormality.", { level: "brainstem/cerebellum", conflictGroup: "metabolic", baselineReplaces: N.brainstem })],
    },
    {
      id: "mb-cortical-necrosis",
      label: "Cortical laminar necrosis",
      group: "Symmetric patterns",
      advanced: true,
      requires: ["swiGre"],
      atoms: [a("metabolic_pattern", "Cortical T1 hyperintensity / laminar necrosis pattern.", { level: "cortex", conflictGroup: "metabolic" })],
    },
  ],
};

// ─── 12. POST-OPERATIVE / INTERVENTIONAL ─────────────────────────────────

const POSTOP: BrainSubMaster = {
  id: "postop",
  label: "Post-op / Interventional",
  hint: "Treatment-related change stays descriptive; enhancement ≠ automatic recurrence.",
  tiles: [
    {
      id: "po-craniotomy",
      label: "Craniotomy / craniectomy",
      group: "Post-operative anatomy",
      atoms: [a("craniotomy", "Post-craniotomy / craniectomy change at [location].", { anatomicalSection: "scalp and calvarium", baselineReplaces: N.scalp })],
    },
    {
      id: "po-cavity",
      label: "Resection cavity — expected change",
      group: "Post-operative anatomy",
      atoms: [a("postop_change", "Resection cavity with expected post-operative blood products and peripheral enhancement; this appearance alone is NOT recurrence.", { impression: "Expected post-operative change." })],
    },
    {
      id: "po-residual",
      label: "Residual / recurrent enhancing lesion",
      group: "Treatment response",
      requires: ["contrast"],
      atoms: [a("postop_recurrence", "Focal nodular enhancing tissue at the [margin], suspicious for residual/recurrent lesion — radiologist-selected assessment.", { impression: "Suspicious residual/recurrent enhancing lesion.", conflictGroup: "postop_change" })],
    },
    {
      id: "po-ischemia",
      label: "Post-op ischaemia",
      group: "Treatment response",
      requires: ["dwi", "adc"],
      atoms: [a("postop_ischemia", "New restricted diffusion at the resection margin / in the [location], representing post-operative ischaemia.", { impression: "Post-operative ischaemia.", conflictGroup: "infarct", baselineReplaces: N.infarct })],
    },
    {
      id: "po-collection",
      label: "Post-op collection / empyema",
      group: "Complications",
      atoms: [a("postop_collection", "Extra-axial collection at the operative site — infection to be excluded clinically where imaging is suspicious.", { impression: "Post-operative collection.", conflictGroup: "extra_axial", baselineReplaces: N.extraAxial })],
    },
    {
      id: "po-pneumo",
      label: "Pneumocephalus",
      group: "Complications",
      atoms: [a("pneumocephalus", "Intracranial air — pneumocephalus.", { impression: "Pneumocephalus.", conflictGroup: "extra_axial", baselineReplaces: N.extraAxial })],
    },
    {
      id: "po-shunt",
      label: "Ventricular catheter / shunt",
      group: "Devices",
      atoms: [a("shunt_catheter", "Ventricular catheter / shunt tip in situ in the [location] — position described without complication.", { impression: "Shunt/catheter in situ.", conflictGroup: "ventricles", baselineReplaces: N.ventricles })],
    },
  ],
};

// ─── 13. MORE / ADVANCED ─────────────────────────────────────────────────

const ADVANCED: BrainSubMaster = {
  id: "advanced",
  label: "More / Advanced",
  hint: "Rare patterns kept out of the common workflows.",
  tiles: [
    {
      id: "ad-vasculitis",
      label: "CNS vasculitis pattern",
      group: "Rare inflammatory",
      atoms: [a("vasculitis", "Multifocal segmental arterial narrowing with small infarcts in different territories — CNS vasculitis to be considered clinically.", { impression: "Vasculitis-pattern changes." })],
    },
    {
      id: "ad-sarcoid",
      label: "Neurosarcoidosis pattern",
      group: "Rare inflammatory",
      requires: ["contrast"],
      atoms: [a("leptomeningeal", "Basal meningeal and cranial-nerve enhancement pattern where granulomatous disease is a consideration.", { conflictGroup: "extra_axial", baselineReplaces: N.enhancement })],
    },
    {
      id: "ad-cns-lymph",
      label: "PCNSL-pattern lesion",
      group: "Rare neoplastic",
      atoms: [a("brain_parenchyma", "Homogeneously enhancing periventric lesion with restricted diffusion — lymphoma considered.", { impression: "Homogeneously enhancing periventricular lesion — lymphoma considered.", baselineReplaces: N.parenchyma })],
    },
    {
      id: "ad-neurocutaneous",
      label: "Neurocutaneous markers",
      group: "Rare syndromic",
      atoms: [a("neurocutaneous", "Subependymal nodules / cortical tubers where a phakomatosis is a clinical correlation.", { conflictGroup: "malformation" })],
    },
    {
      id: "ad-hie-adult",
      label: "Adult hypoxic-ischaemic injury",
      group: "Rare hypoxic",
      requires: ["dwi", "adc"],
      atoms: [a("hypoxic_injury", "Diffuse cortical and deep grey-matter restricted diffusion consistent with hypoxic-ischaemic injury.", { impression: "Hypoxic-ischaemic injury.", conflictGroup: "infarct", baselineReplaces: N.infarct })],
    },
  ],
};

export const MRI_BRAIN_SUB_MASTERS: readonly BrainSubMaster[] = [
  ROUTINE,
  VASCULAR,
  TRAUMA,
  TUMOR,
  INFECTION,
  DEMYELINATING,
  EPILEPSY,
  SELLA,
  CPA,
  PEDIATRIC,
  METABOLIC,
  POSTOP,
  ADVANCED,
];

export function brainSubMasterById(id: string): BrainSubMaster | undefined {
  return MRI_BRAIN_SUB_MASTERS.find((s) => s.id === id);
}

// ─── Tile availability & compilation ─────────────────────────────────────

export function tileAvailable(
  tile: BrainTile,
  seq: BrainSequenceContext,
): { ok: boolean; missing: string[] } {
  const missing = (tile.requires ?? [])
    .filter((k) => !seq.performed[k])
    .map((k) => BRAIN_SEQUENCE_LABELS[k]);
  if (tile.adultOnly && seq.performed.pediatric) {
    return { ok: false, missing: [] };
  }
  return { ok: missing.length === 0, missing };
}

export function buildTilePatch(tile: BrainTile, region = "Brain"): {
  bundleId: string;
  observations: PendingPathologyPatch[];
} {
  const bundleId = brainBundleId("tile", tile.id);
  return { bundleId, observations: brainAtomsToPatches(region, bundleId, tile.atoms) };
}

// ─── 20. Starting presets / macros ───────────────────────────────────────
// Presets populate EDITABLE structured observations through the existing
// bundle machinery — never static final reports, never auto-finalize.

export type BrainPresetContext = {
  region?: string;
  seq: BrainSequenceContext;
  laterality?: "right" | "left";
};

export type BrainPreset = {
  id: string;
  label: string;
  subMasterId: BrainSubMasterId;
  build: (ctx: BrainPresetContext) => { bundleId: string; observations: PendingPathologyPatch[] };
};

const tileAtoms = (subMasterId: BrainSubMasterId, tileId: string): BrainTile | undefined =>
  brainSubMasterById(subMasterId)?.tiles.find((t) => t.id === tileId);

const presetFromTiles =
  (presetId: string, tileRefs: Array<[BrainSubMasterId, string]>) =>
  (ctx: BrainPresetContext): { bundleId: string; observations: PendingPathologyPatch[] } => {
    const region = ctx.region ?? "Brain";
    const bundleId = brainBundleId("preset", presetId);
    const atoms: BrainAtomSpec[] = [];
    tileRefs.forEach(([sm, tile]) => {
      const t = tileAtoms(sm, tile);
      if (t) atoms.push(...t.atoms);
    });
    return { bundleId, observations: brainAtomsToPatches(region, bundleId, atoms) };
  };

export const MRI_BRAIN_PRESETS: readonly BrainPreset[] = [
  {
    id: "normal-mri-brain",
    label: "Completely Normal MRI Brain (protocol-aware)",
    subMasterId: "routine",
    build: (ctx) => buildBrainNormalAtoms({ region: ctx.region ?? "Brain", seq: ctx.seq }),
  },
  {
    id: "acute-territorial-infarct",
    label: "Acute Territorial Ischemic Infarct",
    subMasterId: "vascular",
    build: presetFromTiles("acute-territorial-infarct", [["vascular", "va-acute-territorial"]]),
  },
  {
    id: "chronic-svd-atrophy",
    label: "Chronic Small-Vessel Disease + Atrophy",
    subMasterId: "vascular",
    build: (ctx) => {
      const region = ctx.region ?? "Brain";
      const bundleId = brainBundleId("preset", "chronic-svd-atrophy");
      const fz = buildFazekasAtoms({
        region,
        bundleId,
        periventricular: 2,
        deep: 2,
      });
      const atoms: BrainAtomSpec[] = [
        a("senile_atrophy", "Mild age-related cerebral volume loss with prominence of the cortical sulci and ventricular system.", { impression: "Age-related involutional change.", conflictGroup: "ventricles", baselineReplaces: N.ventricles }),
      ];
      const text = brainAtomsToPatches(region, bundleId, atoms);
      return { bundleId, observations: [...fz.observations, ...text] };
    },
  },
  {
    id: "tbi-sdh",
    label: "Acute TBI with Subdural Haematoma",
    subMasterId: "trauma",
    build: presetFromTiles("tbi-sdh", [["trauma", "tr-sdh-acute"], ["trauma", "tr-contusion-hem"]]),
  },
  {
    id: "meningioma",
    label: "Intracranial Meningioma",
    subMasterId: "tumor",
    build: (ctx) => {
      const region = ctx.region ?? "Brain";
      const seq = ctx.seq;
      const bundleId = brainBundleId("preset", "meningioma");
      const lesion: BrainLesionInput = {
        number: "solitary",
        compartment: "extra-axial",
        location: "the [parasagittal/sphenoid wing] region",
        laterality: ctx.laterality ?? "",
        morphology: ["solid", "well-defined"],
        enhancement: seq.performed.contrast ? "homogeneous" : "",
        signal: { t2: "isointense to cortex", flair: "mildly hyperintense" },
        differentials: seq.performed.contrast ? ["meningioma"] : [],
      };
      const built = buildBrainLesionAtoms(lesion, { region, seq, bundleId });
      const duralTail = brainAtomsToPatches(region, bundleId, [
        a("dural_tail", "Dural tail sign adjacent to the lesion, supporting a meningioma pattern where contrast has been administered.", { conflictGroup: "extra_axial" }),
      ]);
      return {
        bundleId,
        observations: seq.performed.contrast
          ? [...built.observations, ...duralTail]
          : built.observations,
      };
    },
  },
  {
    id: "ms-pattern",
    label: "Multiple Sclerosis Pattern",
    subMasterId: "demyelinating",
    build: presetFromTiles("ms-pattern", [
      ["demyelinating", "dm-periventricular"],
      ["demyelinating", "dm-juxtacortical"],
      ["demyelinating", "dm-infratentorial"],
      ["demyelinating", "dm-dawson"],
      ["demyelinating", "dm-ms-pattern"],
    ]),
  },
  {
    id: "epilepsy-protocol",
    label: "MRI Brain — Epilepsy Protocol Review",
    subMasterId: "epilepsy",
    build: (ctx) => {
      const region = ctx.region ?? "Brain";
      const bundleId = brainBundleId("preset", "epilepsy-protocol");
      const atoms: BrainAtomSpec[] = [
        a("hippocampus_volume", "Hippocampi are symmetric in volume.", { laterality: "right", anatomicalSection: "hippocampi", supportsLaterality: true, conflictGroup: "hippocampus_volume" }),
        a("hippocampus_signal", "Normal hippocampal signal on T2/FLAIR.", { laterality: "right", anatomicalSection: "hippocampi", supportsLaterality: true, conflictGroup: "hippocampus_signal" }),
        a("hippocampus_volume", "Hippocampi are symmetric in volume.", { laterality: "left", anatomicalSection: "hippocampi", supportsLaterality: true, conflictGroup: "hippocampus_volume" }),
        a("hippocampus_signal", "Normal hippocampal signal on T2/FLAIR.", { laterality: "left", anatomicalSection: "hippocampi", supportsLaterality: true, conflictGroup: "hippocampus_signal" }),
        a("epilepsy_negative", "No definite structural epileptogenic focus identified on the epilepsy-protocol sequences reviewed (coronal thin-slab T2/FLAIR through the hippocampi).", { conflictGroup: "epilepsy_negative" }),
      ];
      return { bundleId, observations: brainAtomsToPatches(region, bundleId, atoms) };
    },
  },
  {
    id: "mts",
    label: "Mesial Temporal Sclerosis (select side)",
    subMasterId: "epilepsy",
    build: (ctx) => {
      const region = ctx.region ?? "Brain";
      const side = ctx.laterality ?? "left";
      const bundleId = brainBundleId("preset", `mts-${side}`);
      const tile = tileAtoms("epilepsy", `ep-mts-${side}`);
      return { bundleId, observations: brainAtomsToPatches(region, bundleId, tile?.atoms ?? []) };
    },
  },
  {
    id: "pituitary-macroadenoma",
    label: "Pituitary Macroadenoma with Chiasmal Compression",
    subMasterId: "sella",
    build: (ctx) => {
      const region = ctx.region ?? "Brain";
      const bundleId = brainBundleId("preset", "pituitary-macroadenoma");
      const pit = buildPituitaryAtoms({
        region,
        bundleId,
        pituitary: {
          ap: 2.1,
          tr: 1.8,
          cc: 2.4,
          unit: "cm",
          suprasellarExtension: "chiasm compression",
        },
      });
      const extra = brainAtomsToPatches(region, bundleId, [
        a("pituitary_lesion", "Pituitary macroadenoma with suprasellar extension — chiasm compression as above; cavernous sinus relation per Knosp grading control.", { impression: "Pituitary macroadenoma with optic chiasm compression.", anatomicalSection: "sellar region", conflictGroup: "pituitary", baselineReplaces: N.sellar }),
      ]);
      return { bundleId, observations: [...pit.observations, ...extra] };
    },
  },
  {
    id: "pyogenic-abscess",
    label: "Pyogenic Brain Abscess",
    subMasterId: "infection",
    build: (ctx) => {
      const region = ctx.region ?? "Brain";
      const bundleId = brainBundleId("preset", "pyogenic-abscess");
      const tile = tileAtoms("infection", "in-abscess");
      const atoms = [...(tile?.atoms ?? [])];
      atoms.push(
        a("lesion_differential", "Central restricted diffusion favors a pyogenic abscess; other entities remain radiologist-determined.", { conflictGroup: "lesion_differential", anatomicalSection: "brain parenchyma" }),
      );
      return { bundleId, observations: brainAtomsToPatches(region, bundleId, atoms) };
    },
  },
  {
    id: "ring-enhancing-infective",
    label: "Ring-Enhancing Infective / Granulomatous Lesion",
    subMasterId: "infection",
    build: (ctx) => {
      const region = ctx.region ?? "Brain";
      const bundleId = brainBundleId("preset", "ring-enhancing-infective");
      const tile = tileAtoms("infection", "in-ring-lesion");
      const atoms = [...(tile?.atoms ?? [])];
      if (ctx.seq.performed.contrast) {
        atoms.push(
          a("lesion_differential", "Differential considerations selected by the radiologist: tuberculoma / neurocysticercosis / pyogenic abscess / other.", { conflictGroup: "lesion_differential", anatomicalSection: "brain parenchyma" }),
        );
      }
      return { bundleId, observations: brainAtomsToPatches(region, bundleId, atoms) };
    },
  },
];

export function brainPresetById(id: string): BrainPreset | undefined {
  return MRI_BRAIN_PRESETS.find((p) => p.id === id);
}

export {
  buildFazekasAtoms,
  buildHerniationAtoms,
  buildPituitaryAtoms,
};
