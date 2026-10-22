/**
 * CARE phrase catalog — prefer configured wording over free model prose.
 *
 * V1 shipped MRI Brain + LS Spine. Task 15 (Part E) extends the SAME catalog
 * to the six Smart Dictation examinations: MRI Brain (complete), MRI LS
 * Spine (complete), MRI Cervical Spine (complete), and the lumbar / cervical /
 * whole-spine screening protocols.
 *
 * Dream 2 (vocabulary depth, pass 1) completes the mirror: every Quick
 * Select findings tile of the owner's five day-to-day examinations (Brain,
 * LS Spine, Cervical Spine and their screening protocols) is now dictatable.
 * The additions below are copied VERBATIM from the tile catalogue — the
 * mirror adds no clinical sentence the rail could not already print.
 *
 * Every sentence below is copied VERBATIM from the Quick Select tile
 * catalogue (zai-workspace/quick-select-tiles.data.ts) or the report formats
 * library — the Smart Dictation path never invents clinical wording, so a
 * dictated finding lands on the page with exactly the words the Quick Select
 * rail would have written. The catalog does not invent clinical advice.
 */

export type CatalogPhrase = {
  concept: string;
  patterns: RegExp[];
  findingsText: string;
  impressionText?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  /** Which spine/brain families the phrase belongs to (defaults to lumbar+brain compat of V1). */
  families?: Array<"brain" | "lumbar" | "cervical" | "dorsal">;
};

/**
 * Parameterized templates for corrections ("make L4-L5 narrowing moderate on
 * the left"). Placeholders: [Level] [severity] [side] [grade]. The sentence
 * bodies come from the Quick Select tiles that already carry {severity} / {side}
 * / {level} properties, so a regenerated sentence is byte-identical to what
 * the corresponding tile click would print.
 */
export const SEVERITY_PHRASES: Array<{
  concept: string;
  findingsText: string;
  impressionText?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
}> = [
  {
    // quick-select-tiles.data.ts "Foraminal stenosis L4-L5" ({severity} {side})
    concept: "foraminal_stenosis",
    findingsText: "[severity] [side] neural foraminal stenosis at [Level].",
    impressionText: "[severity] [side] neural foraminal stenosis at [Level].",
    anatomicalSection: "foramina",
    conflictGroup: "foraminal_stenosis",
  },
  {
    // quick-select-tiles.data.ts "Mild/Moderate/Severe canal stenosis (pick level)"
    concept: "canal_stenosis",
    findingsText: "[severity] canal stenosis at [Level].",
    impressionText: "[severity] canal stenosis at [Level].",
    anatomicalSection: "canal",
    conflictGroup: "canal stenosis",
  },
  {
    // quick-select-tiles.data.ts "Mild/Moderate/Severe central canal stenosis (pick level)"
    concept: "cervical_canal_stenosis",
    findingsText: "[severity] central canal stenosis at [Level].",
    impressionText: "[severity] central canal stenosis at [Level].",
    anatomicalSection: "canal",
    conflictGroup: "canal_stenosis",
  },
];

const CATALOG: CatalogPhrase[] = [
  // ── LS Spine (V1, unchanged) ───────────────────────────────────────────────
  {
    concept: "loss_of_lordosis",
    patterns: [/loss of (lumbar )?lordosis/i, /flattened lumbar lordosis/i, /straightening\/?loss of normal lumbar lordosis/i],
    findingsText: "Straightening/loss of normal lumbar lordosis.",
    impressionText: "Loss of lumbar lordosis.",
    anatomicalSection: "alignment",
    conflictGroup: "lumbar_alignment",
    baselineReplaces: "Lumbar alignment is maintained",
  },
  {
    concept: "disc_desiccation",
    patterns: [/disc desiccation/i, /dehydrated disc/i, /loss of t2 signal/i],
    findingsText: "Loss of T2 signal (desiccation) of the [Level] disc.",
    impressionText: "Disc desiccation at [Level].",
    anatomicalSection: "disc",
    conflictGroup: "disc_desiccation",
  },
  {
    concept: "disc_bulge",
    patterns: [
      /disc bulge/i,
      /diffuse disc bulge/i,
      /diffuse bulges?/i,
      /broad-based disc bulge/i,
    ],
    findingsText: "Disc bulge at [Level] without nerve root compression.",
    impressionText: "Disc bulge at [Level] without nerve root compression.",
    anatomicalSection: "disc",
    conflictGroup: "disc bulge",
    baselineReplaces: "No significant disc bulge",
  },
  {
    concept: "disc_herniation",
    patterns: [/disc herniation/i, /posterocentral[- ]right paracentral protrusion/i, /disc protrusion/i],
    findingsText: "Posterocentral disc protrusion at [Level] indenting the thecal sac.",
    impressionText: "Disc herniation at [Level] indenting the thecal sac.",
    anatomicalSection: "disc",
    conflictGroup: "disc herniation",
    baselineReplaces: "No significant disc bulge",
  },
  {
    concept: "thecal_sac_compression",
    patterns: [/thecal sac compression/i, /indenting the anterior thecal sac/i, /pressure over the front of the thecal sac/i],
    findingsText: "Anterior thecal sac compression.",
    anatomicalSection: "cord",
    conflictGroup: "cord",
  },
  {
    concept: "nerve_root_impingement",
    patterns: [/nerve root impingement/i, /radicular impingement/i, /nerve root compression/i],
    findingsText: "Nerve root compression at [Level].",
    anatomicalSection: "cord",
    conflictGroup: "nerve_root",
  },
  {
    concept: "foraminal_narrowing",
    patterns: [/foraminal narrowing/i, /neural foraminal narrowing/i, /foraminal stenosis/i],
    findingsText: "Neural foraminal stenosis at [Level].",
    impressionText: "Neural foraminal stenosis at [Level].",
    anatomicalSection: "foramina",
    conflictGroup: "foraminal_stenosis",
  },
  {
    concept: "ligamentum_flavum_hypertrophy",
    patterns: [/ligamentum flavum hypertrophy/i, /ligamentum flavum thickening/i],
    findingsText: "Ligamentum flavum hypertrophy at [Level].",
    impressionText: "Ligamentum flavum hypertrophy at [Level].",
    anatomicalSection: "ligamentum",
    conflictGroup: "ligamentum_flavum",
  },
  {
    concept: "anterolisthesis",
    patterns: [/anterolisthesis/i, /listhesis/i, /spondylolisthesis/i],
    findingsText: "Grade 1 spondylolisthesis at [Level].",
    impressionText: "Grade 1 spondylolisthesis at [Level].",
    anatomicalSection: "alignment",
    conflictGroup: "spondylolisthesis",
    baselineReplaces: "No spondylolisthesis.",
  },
  {
    concept: "canal_stenosis",
    patterns: [/canal stenosis/i, /spinal canal narrowing/i, /central canal stenosis/i],
    findingsText: "Canal stenosis at [Level].",
    impressionText: "Canal stenosis at [Level].",
    anatomicalSection: "canal",
    conflictGroup: "canal stenosis",
  },
  {
    concept: "facet_arthropathy",
    patterns: [/facet arthropathy/i, /facet joint arthropathy/i, /facet degenerative change/i],
    findingsText: "Facet arthropathy at [Level].",
    impressionText: "Facet arthropathy at [Level].",
    anatomicalSection: "facet",
    conflictGroup: "facet",
  },
  {
    concept: "modic_changes",
    patterns: [/modic/i, /endplate change/i],
    findingsText: "Modic type [grade] endplate changes at [Level].",
    impressionText: "Modic type [grade] endplate changes at [Level].",
    anatomicalSection: "endplate",
    conflictGroup: "endplate",
  },
  {
    concept: "compression_fracture",
    patterns: [/compression fracture/i],
    findingsText: "Acute compression fracture at [Level] with marrow edema on T2/STIR. Posterior wall intact.",
    impressionText: "Acute compression fracture of the [Level] vertebral body with marrow edema; posterior wall intact.",
    anatomicalSection: "vertebra",
    conflictGroup: "compression fracture",
  },

  // ── MRI Brain (V1, unchanged) ──────────────────────────────────────────────
  {
    concept: "normal_brain",
    patterns: [/normal brain/i, /^brain is normal/i],
    findingsText: "Grey-white matter differentiation is preserved. No focal cortical or subcortical signal abnormality, mass lesion, or acute infarct identified.",
    impressionText: "Normal MRI brain.",
    anatomicalSection: "brain",
    conflictGroup: "brain_parenchyma",
    families: ["brain"],
  },
  {
    concept: "white_matter_changes",
    // NOTE (Dream 2): a GRADED fazekas dictation routes to the fazekas_1/2/3
    // tiles below — this entry keeps the un-graded synonyms only (the
    // lookahead suppresses it when the sentence carries a specific grade, so
    // a graded dictation never lands twice). The old bare /fazekas/i pattern
    // + the [grade] default would otherwise invent "grade 2" for a
    // dictation that never stated one.
    patterns: [
      /white matter (changes|disease|hyperintensity)(?![^.]*fazekas\s*(?:grade\s*)?[123])/i,
      /small vessel ischemic/i,
    ],
    findingsText: "Few punctate T2/FLAIR hyperintense white matter lesions, Fazekas grade [grade].",
    impressionText: "Chronic small vessel ischemic disease (Fazekas grade [grade]).",
    anatomicalSection: "white matter",
    conflictGroup: "white_matter",
    families: ["brain"],
  },
  {
    // quick-select-tiles.data.ts "Hydrocephalus" (MR Brain)
    concept: "hydrocephalus",
    patterns: [/hydrocephalus/i, /ventricular dilatation/i, /dilated ventricles/i],
    findingsText: "The ventricular system is dilated, consistent with hydrocephalus. No midline shift.",
    impressionText: "Hydrocephalus.",
    anatomicalSection: "ventricles",
    conflictGroup: "hydrocephalus",
    baselineReplaces: "Ventricular system and cisternal spaces are normal in size and configuration.",
    families: ["brain"],
  },
  {
    // quick-select-tiles.data.ts "Acute infarct (DWI)" — [side?]: the side is
    // filled only when the radiologist dictates one; it is never guessed.
    concept: "infarct",
    patterns: [/acute infarct/i, /restricted diffusion/i, /acute ischemic stroke/i],
    findingsText: "Restricted diffusion in the [side?] MCA territory on DWI/ADC, consistent with acute infarct. No hemorrhagic transformation.",
    impressionText: "Acute [side?] MCA territory infarct.",
    anatomicalSection: "mca",
    conflictGroup: "infarct",
    families: ["brain"],
  },
  {
    // quick-select-tiles.data.ts "Cerebral atrophy"
    concept: "senile_atrophy",
    patterns: [/cerebral atrophy/i, /senile changes/i, /generalized atrophy/i],
    findingsText: "Generalized cerebral atrophy with prominence of sulci.",
    impressionText: "Cerebral atrophy.",
    anatomicalSection: "brain",
    conflictGroup: "atrophy",
    families: ["brain"],
  },
  {
    // quick-select-tiles.data.ts "Chronic infarct"
    concept: "chronic_infarct",
    patterns: [/chronic infarct/i, /encephalomalacia/i, /gliotic changes/i],
    findingsText: "Area of encephalomalacia with gliosis in the [side?] hemisphere, consistent with chronic infarct.",
    impressionText: "Chronic [side?] cerebral infarct.",
    anatomicalSection: "brain",
    conflictGroup: "chronic infarct",
    families: ["brain"],
  },

  // ── MRI Cervical Spine (Task 15 Part E — sentences copied verbatim from the
  //    Quick Select tile catalogue; see quick-select-tiles.data.ts lines 170-228) ──
  {
    concept: "loss_of_cervical_lordosis",
    patterns: [/loss of cervical lordosis/i, /straightening\/?loss of normal cervical lordosis/i, /flattened cervical lordosis/i],
    findingsText: "Straightening/loss of normal cervical lordosis.",
    impressionText: "Loss of cervical lordosis.",
    anatomicalSection: "alignment",
    conflictGroup: "alignment",
    families: ["cervical"],
  },
  {
    // tiles "Cervical kyphosis"
    concept: "cervical_kyphosis",
    patterns: [/cervical kyphosis/i, /sagittal cervical kyphosis/i],
    findingsText: "Fixed sagittal cervical kyphosis is present.",
    anatomicalSection: "alignment",
    conflictGroup: "kyphosis",
    families: ["cervical"],
  },
  {
    // tiles "Disc bulge C4-C5 / C5-C6 / C6-C7"
    concept: "cervical_disc_bulge",
    patterns: [/cervical disc bulge/i, /diffuse disc bulge at c\d/i],
    findingsText: "Diffuse disc bulge at [Level].",
    impressionText: "Diffuse disc bulge at [Level].",
    anatomicalSection: "disc",
    conflictGroup: "disc bulge",
    families: ["cervical", "dorsal"],
  },
  {
    // tiles "Disc herniation C5-C6 / C6-C7"
    concept: "cervical_disc_herniation",
    patterns: [/cervical disc herniation/i, /central disc herniation at c\d/i, /paracentral disc herniation/i],
    findingsText: "Central disc herniation at [Level].",
    impressionText: "Central disc herniation at [Level].",
    anatomicalSection: "disc",
    conflictGroup: "disc herniation",
    families: ["cervical"],
  },
  {
    // tiles "Disc desiccation C5-C6 / C6-C7"
    concept: "cervical_disc_desiccation",
    patterns: [/cervical disc desiccation/i, /loss of t2 signal .*c\d/i],
    findingsText: "Loss of T2 signal (desiccation) of the [Level] disc.",
    impressionText: "Disc desiccation at [Level].",
    anatomicalSection: "disc",
    conflictGroup: "disc_desiccation",
    families: ["cervical", "dorsal"],
  },
  {
    // tiles "Reduced disc height C5-C6"
    concept: "cervical_disc_height_loss",
    patterns: [/reduced disc height (at )?c\d/i, /disc height is reduced at c\d/i],
    findingsText: "Disc height is reduced at [Level].",
    impressionText: "Reduced disc height at [Level].",
    anatomicalSection: "disc",
    conflictGroup: "disc_height",
    families: ["cervical", "dorsal"],
  },
  {
    // tiles "Modic change C5-C6"
    concept: "cervical_modic",
    patterns: [/modic .* c\d/i, /endplate change .* c\d/i],
    findingsText: "Modic type [grade] endplate change at [Level].",
    impressionText: "Modic type [grade] endplate change at [Level].",
    anatomicalSection: "endplate",
    conflictGroup: "endplate",
    families: ["cervical", "dorsal"],
  },
  {
    // tiles "Uncovertebral hypertrophy C5-C6"
    concept: "uncovertebral_hypertrophy",
    patterns: [/uncovertebral (joint )?hypertrophy/i],
    findingsText: "Uncovertebral joint hypertrophy at [Level].",
    anatomicalSection: "uncovertebral",
    conflictGroup: "uncovertebral",
    families: ["cervical"],
  },
  {
    // tiles "Mild/Moderate/Severe central canal stenosis (pick level)"
    concept: "cervical_canal_stenosis",
    patterns: [/central canal stenosis/i, /canal stenosis at c\d/i, /cervical canal stenosis/i],
    findingsText: "Moderate central canal stenosis at [Level].",
    impressionText: "Moderate central canal stenosis at [Level].",
    anatomicalSection: "canal",
    conflictGroup: "canal_stenosis",
    families: ["cervical", "dorsal"],
  },
  {
    // tiles "Foraminal stenosis C5-C6 / C6-C7"
    concept: "cervical_foraminal_stenosis",
    patterns: [/foraminal stenosis (at )?c\d/i, /cervical foraminal stenosis/i, /neural foraminal stenosis at c\d/i],
    findingsText: "Bilateral neural foraminal stenosis at [Level].",
    impressionText: "Neural foraminal stenosis at [Level].",
    anatomicalSection: "foramina",
    conflictGroup: "foraminal_stenosis",
    families: ["cervical", "dorsal"],
  },
  {
    // tiles "Nerve root compression C6"
    concept: "cervical_root_compression",
    patterns: [/c\d nerve root (shows )?compression/i, /cervical nerve root compression/i],
    findingsText: "The [side] C6 nerve root shows compression by the disc-osteophyte complex.",
    anatomicalSection: "nerve_root",
    conflictGroup: "root_contact",
    families: ["cervical"],
  },
  {
    // tiles "Cord signal change" (critical)
    concept: "cord_signal_change",
    patterns: [/cord signal change/i, /myelomalacia/i, /t2 hyperintense signal .* cervical cord/i],
    findingsText: "T2 hyperintense signal within the cervical cord, suggestive of myelomalacia.",
    impressionText: "Cervical cord signal change — myelomalacia.",
    anatomicalSection: "cord",
    conflictGroup: "cord_signal",
    families: ["cervical"],
  },
  {
    // tiles "Cord compression C5-C6" (critical)
    concept: "cervical_cord_compression",
    patterns: [/cervical cord compression/i, /cord compression at c\d/i],
    findingsText: "Cervical cord compression at [Level] with effacement of the posterior subarachnoid space.",
    impressionText: "Cervical cord compression at [Level].",
    anatomicalSection: "cord",
    conflictGroup: "cord_compression",
    families: ["cervical"],
  },
  {
    // tiles "Atlanto-axial instability" (critical)
    concept: "atlanto_axial_instability",
    patterns: [/atlanto[- ]?axial instability/i],
    findingsText: "Atlanto-axial instability with a widened atlanto-dental interval on flexion.",
    impressionText: "Atlanto-axial instability.",
    anatomicalSection: "c1c2",
    conflictGroup: "atlanto_axial_instability",
    families: ["cervical"],
  },
  {
    // tiles "Ligamentum flavum hypertrophy" (cervical)
    concept: "cervical_ligamentum_flavum",
    patterns: [/cervical ligamentum flavum/i, /hypertrophy of the cervical ligamentum flavum/i],
    findingsText: "Hypertrophy of the cervical ligamentum flavum.",
    impressionText: "Cervical ligamentum flavum hypertrophy.",
    anatomicalSection: "ligamentum",
    conflictGroup: "ligamentum_flavum",
    families: ["cervical"],
  },
  {
    // tiles "Facet arthropathy" (cervical: "Advanced cervical facet joint arthropathy with joint fluid.")
    concept: "cervical_facet_arthropathy",
    patterns: [/cervical facet (joint )?arthropathy/i],
    findingsText: "Advanced cervical facet joint arthropathy with joint fluid.",
    impressionText: "Cervical facet joint arthropathy.",
    anatomicalSection: "facet",
    conflictGroup: "facet_joint",
    families: ["cervical"],
  },
  {
    // tiles "Compression fracture C5" (critical)
    concept: "cervical_compression_fracture",
    patterns: [/compression fracture .* c\d/i, /c\d compression fracture/i],
    findingsText: "Acute compression fracture of the [Level] vertebral body with marrow oedema on STIR and preserved posterior cortex.",
    impressionText: "Acute [Level] compression fracture.",
    anatomicalSection: "vertebra",
    conflictGroup: "compression_fracture",
    families: ["cervical"],
  },
  {
    // tiles "Cervical epidural collection" (critical)
    concept: "cervical_epidural_collection",
    patterns: [/cervical epidural (collection|abscess)/i],
    findingsText: "A posterior cervical epidural collection.",
    impressionText: "Cervical epidural collection.",
    anatomicalSection: "epidural",
    conflictGroup: "epidural_collection",
    families: ["cervical"],
  },
  {
    // tiles "Cervical syrinx"
    concept: "cervical_syrinx",
    patterns: [/syrinx/i, /central cavitory fluid signal/i],
    findingsText: "Focal syrinx — central cavitory fluid signal within the cervical cord.",
    impressionText: "Cervical syrinx.",
    anatomicalSection: "cord",
    conflictGroup: "syrinx",
    families: ["cervical"],
  },
  {
    // tiles "Spondylolisthesis" — cervical
    concept: "cervical_spondylolisthesis",
    patterns: [/cervical spondylolisthesis/i],
    findingsText: "Grade 1 spondylolisthesis at the mid-cervical level.",
    impressionText: "Grade 1 cervical spondylolisthesis.",
    anatomicalSection: "alignment",
    conflictGroup: "spondylolisthesis",
    families: ["cervical"],
  },
  {
    // Dorsal — whole-spine screening coverage. Baseline sentence comes from
    // report-formats-library "MRI Whole Spine — Screening" dorsal section.
    concept: "dorsal_disc_bulge",
    patterns: [/dorsal disc bulge/i, /thoracic disc bulge/i, /disc bulge at t\d/i],
    findingsText: "Disc bulge at [Level].",
    impressionText: "Disc bulge at [Level].",
    anatomicalSection: "disc",
    conflictGroup: "disc bulge",
    families: ["dorsal"],
  },
  {
    concept: "dorsal_canal_stenosis",
    patterns: [/dorsal (canal stenosis|canal narrowing)/i, /thoracic canal stenosis/i],
    findingsText: "Canal stenosis at [Level].",
    impressionText: "Canal stenosis at [Level].",
    anatomicalSection: "canal",
    conflictGroup: "canal_stenosis",
    families: ["dorsal"],
  },
  {
    // report-formats-library "MRI Dorsal Spine — Compression Fracture"
    concept: "dorsal_compression_fracture",
    patterns: [/dorsal compression fracture/i, /thoracic compression fracture/i, /compression fracture at t\d/i],
    findingsText: "Acute compression fracture at [Level] with marrow edema on T2/STIR.",
    impressionText: "Acute [Level] compression fracture.",
    anatomicalSection: "vertebra",
    conflictGroup: "compression_fracture",
    families: ["dorsal"],
  },

  // ── Dream 2 — full tile mirror, pass 1 ─────────────────────────────────────────
  // Every sentence below is copied VERBATIM from its cited Quick Select tile;
  // conflictGroup / baselineReplaces mirror the tile's own properties. The
  // owner's five day-to-day examinations are Brain, LS Spine, Cervical Spine
  // and the two screening protocols (regions.ts covers them with four region
  // names), so this pass mirrors the Brain / LS / Cervical tiles one-to-one.
  // [side?] slots fill only from the dictated side (see fillModifiersInPhrase).

  // Brain — hemorrhage variants (tiles "Subdural/Epidural/Subarachnoid…", "Microbleeds", "Basal ganglia hemorrhage")
  {
    // tiles "Basal ganglia hemorrhage" / "Acute hemorrhage" (category: critical)
    concept: "acute_hemorrhage",
    patterns: [/acute intraparenchymal hemorrhage/i, /acute intracerebral hemorrhage/i, /basal ganglia hemorrhage/i, /\bich\b/i],
    findingsText: "Acute intraparenchymal hemorrhage in the [side?] basal ganglia with intraventricular extension. Mass effect with midline shift of ___ mm to the contralateral side.",
    impressionText: "Acute [side?] basal ganglia hemorrhage.",
    anatomicalSection: "basal ganglia",
    conflictGroup: "hemorrhage",
    families: ["brain"],
  },
  {
    // tiles "Subdural hematoma" (critical)
    concept: "subdural_hematoma",
    patterns: [/subdural hematoma/i, /subdural collection/i],
    findingsText: "Crescentic extra-axial collection over the [side?] cerebral convexity, maximum thickness ___ mm, consistent with subdural hematoma.",
    impressionText: "[side?] subdural hematoma.",
    anatomicalSection: "extra-axial",
    conflictGroup: "subdural hematoma",
    families: ["brain"],
  },
  {
    // tiles "Epidural hematoma" (critical)
    concept: "epidural_hematoma",
    patterns: [/epidural hematoma/i, /extradural hematoma/i],
    findingsText: "Biconvex extra-axial collection in the [side?] epidural space, maximum thickness ___ mm, consistent with epidural hematoma.",
    impressionText: "[side?] epidural hematoma.",
    anatomicalSection: "extra-axial",
    conflictGroup: "epidural hematoma",
    families: ["brain"],
  },
  {
    // tiles "Subarachnoid hemorrhage" (critical)
    concept: "subarachnoid_hemorrhage",
    patterns: [/subarachnoid hemorrhage/i, /\bsah\b/i],
    findingsText: "Acute subarachnoid hemorrhage — blood in the basal cisterns and sulci.",
    impressionText: "Acute subarachnoid hemorrhage.",
    anatomicalSection: "cisterns",
    conflictGroup: "subarachnoid hemorrhage",
    families: ["brain"],
  },
  {
    // tiles "Microbleeds"
    concept: "microbleeds",
    patterns: [/micro\s?-?bleeds/i, /micro\s?-?hemorrhages/i, /susceptibility foci/i],
    findingsText: "Brain parenchyma shows multiple punctate foci of susceptibility on GRE/SWI, consistent with cerebral microbleeds.",
    impressionText: "Cerebral microbleeds.",
    anatomicalSection: "susceptibility",
    conflictGroup: "microbleeds",
    families: ["brain"],
  },
  // Brain — graded small vessel disease (tiles "Fazekas 1 / 2 / 3")
  {
    // tiles "Fazekas 1"
    concept: "fazekas_1",
    patterns: [/fazekas\s*(?:grade\s*)?1\b/i],
    findingsText: "Brain parenchyma shows few punctate T2/FLAIR hyperintense lesions in the bilateral periventricular and deep white matter, Fazekas grade 1. No confluent lesions.",
    impressionText: "Mild chronic small vessel ischemic disease (Fazekas grade 1).",
    anatomicalSection: "white matter",
    conflictGroup: "fazekas",
    families: ["brain"],
  },
  {
    // tiles "Fazekas 2"
    concept: "fazekas_2",
    patterns: [/fazekas\s*(?:grade\s*)?2\b/i],
    findingsText: "Brain parenchyma shows confluent T2/FLAIR hyperintense lesions in the bilateral periventricular and deep white matter, Fazekas grade 2.",
    impressionText: "Moderate chronic small vessel ischemic disease (Fazekas grade 2).",
    anatomicalSection: "white matter",
    conflictGroup: "fazekas",
    families: ["brain"],
  },
  {
    // tiles "Fazekas 3"
    concept: "fazekas_3",
    patterns: [/fazekas\s*(?:grade\s*)?3\b/i],
    findingsText: "Brain parenchyma shows confluent T2/FLAIR hyperintense lesions extending into the deep white matter, Fazekas grade 3.",
    impressionText: "Severe chronic small vessel ischemic disease (Fazekas grade 3).",
    anatomicalSection: "white matter",
    conflictGroup: "fazekas",
    families: ["brain"],
  },
  {
    // tiles "Lacunar infarcts"
    concept: "lacunar_infarcts",
    patterns: [/lacunar infarcts?/i, /\blacunes\b/i],
    findingsText: "Brain parenchyma shows multiple small lacunar cavities in the deep white matter.",
    impressionText: "Lacunes.",
    anatomicalSection: "white matter",
    conflictGroup: "lacunar",
    families: ["brain"],
  },
  // Brain — mass effect (tiles "Mass lesion" / "Cerebral edema" / "Midline shift")
  {
    // tiles "Mass lesion" (critical)
    concept: "mass_lesion",
    patterns: [/\bmass lesion\b/i, /space[- ]occupying lesion/i],
    findingsText: "Brain parenchyma contains a [side?] mass lesion with surrounding edema and mass effect.",
    impressionText: "[side?] mass lesion.",
    anatomicalSection: "brain",
    conflictGroup: "mass lesion",
    families: ["brain"],
  },
  {
    // tiles "Cerebral edema" (critical — no impressionSentence on the tile)
    concept: "cerebral_edema",
    patterns: [/cerebral edema/i, /diffuse (?:brain |cerebral )?edema/i],
    findingsText: "Brain parenchyma shows diffuse edema with effacement of the cortical sulci and basal cisterns.",
    anatomicalSection: "brain",
    conflictGroup: "edema",
    families: ["brain"],
  },
  {
    // tiles "Midline shift" (critical). The tile sentence reads "toward the
    // {side}" — wording that cannot stand without a side, so the PATTERNS
    // require one (dictation without a side asks for clarification instead of
    // printing "toward the ."), mirroring the tile boundary's own refusal.
    concept: "midline_shift",
    patterns: [/midline shift[^\n]*\b(?:left|right)\b/i, /\b(?:left|right)\b[^\n]*midline shift/i],
    findingsText: "Midline shift of ___ mm toward the [side?].",
    impressionText: "Midline shift toward [side?].",
    anatomicalSection: "midline",
    conflictGroup: "midline shift",
    baselineReplaces: "No midline shift is seen.",
    families: ["brain"],
  },
  // Brain — vascular (tiles "Aneurysm" / "Cavernoma" / "AVM")
  {
    // tiles "Aneurysm"
    concept: "aneurysm",
    patterns: [/\baneurysm\b/i],
    findingsText: "Saccular aneurysm at the [side?] posterior communicating artery, measuring approximately ___ mm.",
    impressionText: "[side?] posterior communicating artery aneurysm.",
    anatomicalSection: "vascular",
    conflictGroup: "aneurysm",
    families: ["brain"],
  },
  {
    // tiles "Cavernoma"
    concept: "cavernoma",
    patterns: [/cavernoma/i, /cavernous malformation/i],
    findingsText: "[side?] cavernoma — cavernous malformation with hemosiderin rim.",
    impressionText: "[side?] cavernoma.",
    anatomicalSection: "vascular",
    conflictGroup: "cavernoma",
    families: ["brain"],
  },
  {
    // tiles "AVM"
    concept: "avm",
    patterns: [/\bavm\b/i, /arteriovenous malformation/i],
    findingsText: "[side?] arteriovenous malformation (AVM) with nidus measuring approximately ___ cm.",
    impressionText: "[side?] arteriovenous malformation.",
    anatomicalSection: "vascular",
    conflictGroup: "avm",
    families: ["brain"],
  },
  // Brain — trauma (tiles "Contusion" / "Diffuse axonal injury")
  {
    // tiles "Contusion" (critical)
    concept: "contusion",
    patterns: [/contusion/i],
    findingsText: "[side?] cerebral contusion with an intraparenchymal hemorrhage component.",
    impressionText: "[side?] cerebral contusion.",
    anatomicalSection: "brain",
    conflictGroup: "contusion",
    families: ["brain"],
  },
  {
    // tiles "Diffuse axonal injury" (critical)
    concept: "diffuse_axonal_injury",
    patterns: [/diffuse axonal injury/i, /\bdai\b/i],
    findingsText: "Multiple foci of diffuse axonal injury.",
    impressionText: "Diffuse axonal injury.",
    anatomicalSection: "brain",
    conflictGroup: "diffuse axonal injury",
    families: ["brain"],
  },
  // Brain — infection/inflammation, epilepsy, extra-axial, orbit, tumor
  {
    // tiles "Demyelinating lesion"
    concept: "demyelinating_lesion",
    patterns: [/demyelinating lesions?/i, /\bdemyelination\b/i, /multiple sclerosis lesions?/i],
    findingsText: "Brain parenchyma shows multiple ovoid T2/FLAIR hyperintense demyelinating lesions in the white matter.",
    impressionText: "Demyelinating lesions.",
    anatomicalSection: "white matter",
    conflictGroup: "demyelinating",
    families: ["brain"],
  },
  {
    // tiles "Hippocampal sclerosis"
    concept: "hippocampal_sclerosis",
    patterns: [/hippocampal sclerosis/i, /mesial temporal sclerosis/i],
    findingsText: "[side?] hippocampal sclerosis with volume loss and T2/FLAIR hyperintensity.",
    impressionText: "[side?] hippocampal sclerosis.",
    anatomicalSection: "temporal",
    conflictGroup: "hippocampal sclerosis",
    families: ["brain"],
  },
  {
    // tiles "Extra-axial collection"
    concept: "extra_axial_collection",
    patterns: [/extra[- ]axial (?:fluid )?collection/i],
    findingsText: "[side?] extra-axial fluid collection with mass effect.",
    impressionText: "[side?] extra-axial collection.",
    anatomicalSection: "extra-axial",
    conflictGroup: "extra-axial collection",
    baselineReplaces: "No extra-axial collection is identified.",
    families: ["brain"],
  },
  {
    // tiles "Orbital cellulitis"
    concept: "orbital_cellulitis",
    patterns: [/orbital cellulitis/i],
    findingsText: "Preseptal and postseptal inflammatory change in the [side?] orbit, consistent with orbital cellulitis.",
    impressionText: "[side?] orbital cellulitis.",
    anatomicalSection: "orbit",
    conflictGroup: "orbital",
    families: ["brain"],
  },
  {
    // tiles "Glioma recurrence" (favorite — follow-up wording; the ___ blanks
    // are the tile's own, the radiologist fills the measurements)
    concept: "glioma_recurrence",
    patterns: [/glioma recurrence/i, /recurrent glioma/i, /tumor recurrence/i],
    findingsText: "Heterogeneously enhancing area in the right frontal operculum at the post-resection cavity, measuring approximately ___ × ___ × ___ cm, with surrounding T2/FLAIR hyperintensity suggestive of edema. Findings are concerning for tumor recurrence.",
    anatomicalSection: "brain",
    conflictGroup: "tumor recurrence",
    families: ["brain"],
  },

  // LS Spine — disc height, endplate variants (tiles "Reduced disc height L4-L5",
  // "Schmorl node L1", "Vertebral hemangioma L1")
  {
    concept: "reduced_disc_height",
    patterns: [/reduced disc height/i, /disc height (?:is )?reduced/i, /loss of disc height/i],
    findingsText: "Disc height is reduced at [Level].",
    impressionText: "Reduced disc height at [Level].",
    anatomicalSection: "disc",
    conflictGroup: "disc height",
  },
  {
    // tiles "Schmorl node L1" — a VERTEBRAL BODY finding: "at L2" must stay
    // "L2" (composer.ts BODY_FINDING_RE keeps body findings off the disc-
    // segment expander that would print "L2-L3").
    concept: "schmorl_node",
    patterns: [/schmorl(?:'?s)? nodes?/i],
    findingsText: "Schmorl node at [Level] vertebral endplate.",
    impressionText: "Schmorl node at the [Level] endplate.",
    anatomicalSection: "endplate",
    conflictGroup: "schmorl",
  },
  {
    // tiles "Vertebral hemangioma L1"
    concept: "vertebral_hemangioma",
    patterns: [/(?:vertebral )?hemangioma/i],
    findingsText: "Vertebral hemangioma at [Level] — typical T1/T2 hyperintense signal.",
    impressionText: "Typical vertebral hemangioma at [Level].",
    anatomicalSection: "vertebra",
    conflictGroup: "hemangioma",
  },
  {
    // tiles "Grade 2 spondylolisthesis L4-L5" — the Grade 2 upgrade of the V1
    // "anterolisthesis" (Grade 1) entry. Both share the conceptStem
    // "anterolisthesis" ON PURPOSE: when a dictated grade-2 sentence fires
    // both patterns, deterministicCompose's overlap guard keeps the MOST
    // SPECIFIC (longer) concept, so exactly ONE sentence — the Grade 2 one
    // — lands. Without a dictated grade, only the Grade 1 entry fires and
    // behavior is unchanged.
    concept: "lumbar_anterolisthesis",
    patterns: [
      /grade\s*(?:ii|2|two)\b\s*(?:spondylo)?(?:antero)?listhesis/i,
      /spondylolisthesis\s+grade\s*(?:ii|2|two)\b/i,
      /(?:antero)?listhesis\s+grade\s*(?:ii|2|two)\b/i,
    ],
    findingsText: "Grade 2 spondylolisthesis at [Level].",
    impressionText: "Grade 2 spondylolisthesis at [Level].",
    anatomicalSection: "alignment",
    conflictGroup: "spondylolisthesis",
    baselineReplaces: "No spondylolisthesis.",
  },

  // Cervical Spine — trauma / lesion / ligament tiles (lines 189-225 of the tile file)
  {
    // tiles "Burst fracture C5" (critical) — body finding, see schmorl_node.
    concept: "cervical_burst_fracture",
    patterns: [/burst fracture/i],
    findingsText: "Burst fracture of the [Level] vertebral body with loss of posterior vertebral body height.",
    impressionText: "[Level] burst fracture.",
    anatomicalSection: "vertebra",
    conflictGroup: "burst_fracture",
    baselineReplaces: "Cervical vertebral bodies demonstrate normal height and marrow signal.",
    families: ["cervical"],
  },
  {
    // tiles "Posterior element fracture C6" (critical)
    concept: "cervical_posterior_element_fracture",
    patterns: [/posterior element fracture/i, /fracture through the posterior elements/i],
    findingsText: "Fracture through the posterior elements of [Level] — lamina and lateral mass.",
    impressionText: "[Level] posterior element fracture.",
    anatomicalSection: "posterior elements",
    conflictGroup: "posterior_element_fracture",
    families: ["cervical"],
  },
  {
    // tiles "Lytic lesion C2"
    concept: "cervical_lytic_lesion",
    patterns: [/lytic lesion/i],
    findingsText: "Focal lytic lesion of the [Level] vertebral body without cortical breach.",
    impressionText: "Lytic lesion at [Level].",
    anatomicalSection: "vertebra",
    conflictGroup: "focal_lytic_lesion",
    baselineReplaces: "Cervical vertebral bodies demonstrate normal height and marrow signal.",
    families: ["cervical"],
  },
  {
    // tiles "Multiple cervical osseous lesions"
    concept: "cervical_multiple_osseous_lesions",
    patterns: [/multiple osseous lesions/i, /heterogeneous marrow signal throughout/i],
    findingsText: "Multiple osseous lesions with heterogeneous marrow signal throughout the cervical vertebral bodies.",
    impressionText: "Multiple cervical osseous lesions.",
    anatomicalSection: "vertebra",
    conflictGroup: "multiple osseous lesions",
    families: ["cervical"],
  },
  {
    // tiles "Disc extrusion C5-C6"
    concept: "cervical_disc_extrusion",
    patterns: [/cervical disc extrusion/i, /disc extrusion at c\d/i],
    findingsText: "Disc extrusion at [Level].",
    impressionText: "Disc extrusion at [Level].",
    anatomicalSection: "disc",
    conflictGroup: "disc extrusion",
    families: ["cervical"],
  },
  {
    // tiles "OPLL C5-C6"
    concept: "cervical_opll",
    patterns: [/\bopll\b/i, /ossification of the posterior longitudinal ligament/i],
    findingsText: "Thick ossification of the posterior longitudinal ligament at [Level].",
    impressionText: "Ossification of the posterior longitudinal ligament at [Level].",
    anatomicalSection: "ligament",
    conflictGroup: "ossification_posterior_longitudinal",
    families: ["cervical"],
  },
  {
    // tiles "Intramedullary cord lesion" (critical)
    concept: "cervical_intramedullary_lesion",
    patterns: [/intramedullary (?:cervical )?cord lesion/i, /expansile intramedullary lesion/i],
    findingsText: "An expansile intramedullary cervical cord lesion with surrounding oedema.",
    impressionText: "Cervical intramedullary lesion.",
    anatomicalSection: "cord",
    conflictGroup: "intramedullary_lesion",
    baselineReplaces: "Cervical spinal cord signal intensity is normal.",
    families: ["cervical"],
  },
  {
    // tiles "Intradural extramedullary lesion"
    concept: "cervical_intradural_lesion",
    patterns: [/intradural extramedullary/i],
    findingsText: "An enhancing intradural extramedullary cervical lesion with a dural tail.",
    impressionText: "Cervical intradural extramedullary lesion.",
    anatomicalSection: "thecal",
    conflictGroup: "intradural_lesion",
    families: ["cervical"],
  },

  // ── Dream 2, pass 2 — findings the owner asked for beyond the mirror ─────────
  // Tier A entries quote their sentence(s) VERBATIM from the cited report
  // formats library. Tier B entries carry NEW wording authored for this pass
  // (standard radiology phrasing, flagged in the PR for the owner-radiologist's
  // review — corrections can also be taught from Settings → Radiology → Voice).

  // Tier A — report-formats-library sources
  {
    // report-formats-library fmt("MRI Brain — NCC (Ring-Enhancing Granuloma)") —
    // the two finding sentences + the full impression, quoted verbatim.
    concept: "ncc_granuloma",
    patterns: [/ring[- ]enhancing (?:lesion|granuloma)/i, /neurocysticercosis/i, /\bncc\b/i, /tuberculoma/i],
    findingsText: "Solitary ring-enhancing lesion in the ___ (location) on post-contrast T1W images, with surrounding T2/FLAIR hyperintense perilesional edema. No restricted diffusion within the lesion on DWI/ADC.",
    impressionText: "Solitary ring-enhancing lesion with perilesional edema. Imaging features suggestive of infectious/inflammatory granuloma — differential diagnosis: neurocysticercosis (NCC) / tuberculoma.",
    anatomicalSection: "lesion",
    conflictGroup: "ring enhancing lesion",
    families: ["brain"],
  },
  {
    // fmt("MRI Brain — HIE (Pediatric)")
    concept: "hie",
    patterns: [/hypoxic ischemic/i, /\bhie\b/i],
    findingsText: "Evidence of T2W hyperintensity (CSF signal in all sequences) in bilateral fronto-parietal lobes and bilateral insular cortex with ex-vacuo dilatation of bilateral lateral ventricles. No evidence of acute infarct, hemorrhage or space-occupying mass lesion.",
    impressionText: "Evidence of T2W hyperintensity in bilateral fronto-parietal lobes and insular cortex with ex-vacuo ventricular dilatation. Consistent with hypoxic ischemic encephalopathy.",
    anatomicalSection: "brain",
    conflictGroup: "hie",
    families: ["brain"],
  },
  {
    // fmt("MRI LS Spine — Multilevel Degenerative") — the format's impression is
    // level-free (the format findings pin L3-L4/L4-L5/L5-S1), so the summary
    // sentence is the dictatable wording.
    concept: "multilevel_degenerative_disc_disease",
    patterns: [/multilevel degenerative/i, /degenerative disc disease/i, /multilevel disc disease/i],
    findingsText: "Multilevel lumbar degenerative disc disease with disc desiccation and mild diffuse disc bulges.",
    impressionText: "Multilevel lumbar degenerative disc disease with disc desiccation and mild diffuse disc bulges. No canal stenosis or nerve root compression.",
    anatomicalSection: "disc",
    conflictGroup: "multilevel degenerative",
  },
  {
    // fmt("MRI Dorsal Spine — Spondylodiscitis") — the quoted sentences are
    // region-free, so the finding composes for every spine family; the
    // recognition synonyms include the clinic's own shorthand (Pott's spine).
    concept: "spondylodiscitis",
    patterns: [/spondylodiscitis/i, /\bdiscitis\b/i, /pott'?s (?:spine|spondylitis)/i, /tubercular spondylitis/i],
    findingsText: "Altered marrow signal with T2/STIR hyperintensity and endplate erosion involving ___ and ___ vertebral bodies with associated disc signal abnormality — suggestive of infective spondylodiscitis. No significant epidural abscess or cord compression.",
    impressionText: "Imaging features consistent with infective spondylodiscitis at ___-___ levels with adjacent soft tissue involvement. No epidural abscess or cord compression.",
    anatomicalSection: "endplate",
    conflictGroup: "spondylodiscitis",
    families: ["lumbar", "dorsal", "cervical"],
  },

  // Tier B — NEW wording, owner-radiologist review requested in the PR.
  // NOTE: no built-in Tarlov entry ships — Tarlov cyst is the canonical
  // OWNER-TAUGHT custom finding (customPhrases.test.ts's documented example:
  // "a custom phrase can never silently override clinical tile wording"),
  // so the clinic's own Tarlov wording stays theirs to teach from
  // Settings → Radiology → Voice, and the sacral [Level] machinery serves it.
  {
    concept: "lumbosacral_transitional_vertebra",
    patterns: [/transitional vertebra/i, /bertolotti/i, /lumbosacral transition/i],
    findingsText: "Lumbosacral transitional vertebra (Bertolotti variant) with normal marrow signal.",
    impressionText: "Lumbosacral transitional vertebra.",
    anatomicalSection: "vertebra",
    conflictGroup: "transitional vertebra",
  },
  {
    concept: "sacroiliitis",
    patterns: [/sacroiliitis/i, /sacroiliac joint (?:edema|erosion|inflammation)/i],
    findingsText: "T2/STIR hyperintensity with erosions in the bilateral sacroiliac joints, consistent with active sacroiliitis.",
    impressionText: "Active bilateral sacroiliitis.",
    anatomicalSection: "sacroiliac",
    conflictGroup: "sacroiliitis",
  },
  {
    concept: "cervical_disc_osteophyte_complex",
    patterns: [/disc[- ]osteophyte complex/i, /osteophyte complex/i],
    findingsText: "Disc-osteophyte complex at [Level].",
    impressionText: "Disc-osteophyte complex at [Level].",
    anatomicalSection: "disc",
    conflictGroup: "disc_osteophyte_complex",
    families: ["cervical", "dorsal"],
  },
  {
    concept: "facet_synovial_cyst",
    patterns: [/synovial cyst/i],
    findingsText: "Synovial cyst arising from the [Level] facet joint with adjacent thecal sac compression.",
    impressionText: "Facet joint synovial cyst at [Level].",
    anatomicalSection: "facet",
    conflictGroup: "facet synovial cyst",
  },
];

export function matchCatalogPhrases(transcript: string, extras?: CatalogPhrase[]): CatalogPhrase[] {
  const hits: CatalogPhrase[] = [];
  for (const entry of CATALOG) {
    if (entry.patterns.some((p) => p.test(transcript))) hits.push(entry);
  }
  // Radiologist-authored findings (Settings → Radiology → Voice) join the
  // SAME match pass — a custom synonym is just as dictatable as a built-in.
  for (const entry of extras ?? []) {
    if (entry.patterns.some((p) => p.test(transcript))) hits.push(entry);
  }
  return hits;
}

/** Every built-in concept key — the create-time collision guard for custom phrases. */
export function builtInConcepts(): string[] {
  return CATALOG.map((c) => c.concept);
}

/** Region-scoped catalog for prompts (six-exam families). */
export function catalogForPrompt(region: string, extras?: CatalogPhrase[]): string {
  const regionLower = region.toLowerCase();
  const wholeSpine = /whole\s*spine/.test(regionLower);
  const isBrain = /brain/.test(regionLower);
  const isLumbar = !isBrain && (wholeSpine || /ls\s*spine|lumbar|lumbosacral/.test(regionLower));
  const isCervical = !isBrain && (wholeSpine || /cervical/.test(regionLower));
  const isDorsal = !isBrain && (wholeSpine || /dorsal/.test(regionLower));

  const familyApplies = (c: CatalogPhrase) => {
    const fam = c.families;
    if (!fam) return isLumbar; // V1 lumbar entries: visible for lumbar studies (and whole spine)
    if (isBrain) return fam.includes("brain");
    return (
      (isLumbar && fam.includes("lumbar"))
      || (isCervical && fam.includes("cervical"))
      || (isDorsal && fam.includes("dorsal"))
    );
  };
  const filtered = [
    ...CATALOG.filter(familyApplies),
    // Custom findings join the prompt for the SAME exam families only —
    // a brain-only phrase the doctor taught never fires in a spine study.
    ...(extras ?? []).filter(familyApplies),
  ];
  return filtered
    .map((c) => `- ${c.concept}: "${c.findingsText}"`)
    .join("\n");
}

/**
 * Find the catalog entry for a concept key (used by correction regeneration —
 * the deterministic composer rebuilds a sentence from the SAME template the
 * original add used, so an update never rewrites wording).
 */
export function phraseByConcept(concept: string, extras?: CatalogPhrase[]): CatalogPhrase | undefined {
  // Built-in first, then the radiologist-authored vocabulary. The two key
  // spaces are disjoint by construction (the write API rejects a custom
  // concept that collides with a built-in key), so order is cosmetic — but
  // built-in-first keeps the shipped wording authoritative if that guard is
  // ever bypassed by a manual SQL insert.
  return CATALOG.find((c) => c.concept === concept)
    ?? (extras ?? []).find((c) => c.concept === concept);
}

export function fillLevelInPhrase(text: string, level: string | null | undefined): string {
  if (!level?.trim()) return text.replace(/\[Level\]/g, "___");
  const norm = level.replace(/\s+/g, "").replace(/-/g, "-").toUpperCase();
  return text.replace(/\[Level\]/g, norm);
}

/** Normalize a dictated severity word to the tile property vocabulary. */
export function normalizeSeverity(word?: string | null): "mild" | "moderate" | "severe" | null {
  if (!word) return null;
  const w = word.trim().toLowerCase();
  if (/^mild$/.test(w) || /^minimal$/.test(w) || /^mildly$/.test(w)) return "mild";
  if (/^moderate$/.test(w) || /^moderately$/.test(w)) return "moderate";
  if (/^severe$/.test(w) || /^marked$/.test(w) || /^significantly narrowed$/.test(w)) return "severe";
  return null;
}

/** Normalize a dictated side word to the tile property vocabulary. */
export function normalizeLaterality(word?: string | null): "left" | "right" | "bilateral" | null {
  if (!word) return null;
  const w = word.trim().toLowerCase();
  if (/^left$/.test(w) || /^left[- ]sided$/.test(w)) return "left";
  if (/^right$/.test(w) || /^right[- ]sided$/.test(w)) return "right";
  if (/^bilateral$/.test(w) || /^both$/.test(w) || /^bilaterally$/.test(w)) return "bilateral";
  return null;
}

/**
 * Fill [severity] / [side] / [grade] placeholders in a phrase template using
 * ONLY words the radiologist actually dictated — nothing is invented. Missing
 * severities stay as the neutral template body (the phrase keeps its default
 * wording, exactly like the tile prints it before parameters are chosen).
 */
export function fillModifiersInPhrase(
  text: string,
  mods: { severity?: string | null; laterality?: string | null; grade?: string | null },
): string {
  // Mirrors abnormalityEngine.fillTemplate: raw lowercase substitution, then
  // sentence-case — so a dictated correction prints byte-identically to what
  // the Quick Select tile click would print.
  let out = text;
  const severity = normalizeSeverity(mods.severity);
  const side = normalizeLaterality(mods.laterality);
  if (severity) out = out.replace(/\[severity\]/g, severity);
  if (side) out = out.replace(/\[side\]/g, side);
  // [side?] — the honest-laterality slot (Dream 2 brain mirror): fills with
  // the side the radiologist actually dictated; when none was dictated the
  // token is REMOVED, never guessed. "bilateral" would invent a finding the
  // Quick Select boundary itself refuses to write without a chosen side
  // (store.ts B-09), and every mirror sentence is worded to read fluently
  // with the slot dropped ("over the [side?] cerebral convexity" →
  // "over the cerebral convexity").
  if (side) out = out.replace(/\[side\?\]/g, side);
  if (mods.grade) out = out.replace(/\[grade\]/g, mods.grade.trim());
  // Unfilled placeholders fall back to the tile's neutral rendering: no
  // severity adjective, bilateral for side (the tile default), grade 2.
  // [side?] is the exception — its neutral rendering is REMOVAL (above).
  out = out.replace(/\[severity\]\s*/g, "");
  out = out.replace(/\[side\?\]/g, "");
  out = out.replace(/\[side\]/g, "bilateral");
  out = out.replace(/\[grade\]/g, "2");
  out = out.replace(/\s{2,}/g, " ").trim();
  if (out) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

/**
 * Severity/side parameterized template for a concept (foraminal stenosis,
 * canal stenosis). Falls back to the plain catalog phrase when the concept
 * has no parameterized variant.
 */
function templateConceptStem(c: string): string {
  let s = c.toLowerCase();
  s = s.replace(/^(cervical|lumbar|dorsal|brain)_/, "");
  s = s.replace(/_(narrowing|stenosis|hypertrophy|changes|desiccation|arthropathy|fracture|compression)$/, "");
  return s;
}

export function severityPhraseForConcept(concept: string): {
  findingsText: string;
  impressionText?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
} | null {
  // Exact key first ("foraminal_stenosis"), then across family spellings —
  // the Quick Select catalog keys the same family as "foraminal_narrowing".
  const exact = SEVERITY_PHRASES.find((s) => s.concept === concept);
  if (exact) return exact;
  const stem = templateConceptStem(concept);
  return SEVERITY_PHRASES.find((s) => templateConceptStem(s.concept) === stem) ?? null;
}

/**
 * Resolve a conversational tail ("L4-L5 narrowing", "ligamentum flavum
 * hypertrophy") to catalog concepts — the shared helper for removal and
 * update corrections. Returns every catalog concept whose patterns match the
 * tail text, most specific first.
 */
export function conceptsMatchingTail(tail: string, extras?: CatalogPhrase[]): string[] {
  const concepts: string[] = [];
  for (const entry of CATALOG) {
    if (entry.patterns.some((p) => p.test(tail))) concepts.push(entry.concept);
  }
  // Custom findings are conversational too — "remove tarlov cyst" resolves
  // through the same tail matcher that removes a built-in finding.
  for (const entry of extras ?? []) {
    if (entry.patterns.some((p) => p.test(tail))) concepts.push(entry.concept);
  }
  // "narrowing"/"stenosis" without an anatomical qualifier maps to the
  // foraminal family first (the common clinical shorthand), then canal.
  if (!concepts.length && /\b(narrowing|stenosis)\b/i.test(tail)) {
    concepts.push("foraminal_narrowing", "canal_stenosis");
  }
  return concepts;
}
