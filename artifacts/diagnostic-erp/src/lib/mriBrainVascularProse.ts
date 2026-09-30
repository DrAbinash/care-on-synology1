/**
 * mriBrainVascularProse.ts — canonical vascular prose, and the split the safety
 * rules require (mra/mrv spec §1, §14, §16).
 *
 * `docs/clinical-libraries/mri-brain-mra-mrv-clinical-content-library.md` is
 * authoritative for terminology and starting prose, so the strings under
 * `VASCULAR_LIBRARY_PROSE` are copied verbatim and a test reads the document to
 * prove it. Nothing here rewrites that wording.
 *
 * The one transformation the specification forces is separation. Several library
 * sentences state a conclusion stronger than the acquisition can support —
 * "…diagnostic of acute arterial occlusion", "…diagnostic of Moyamoya disease",
 * "…diagnostic of acute dural venous sinus thrombosis". §1 says to preserve the
 * content but never emit that conclusion automatically, so each such line is
 * divided into the descriptive observation and the interpretation clause. The
 * observation is recordable; the interpretation is a separate radiologist-selected
 * atom, and the technique gates in `mriBrainVascularTechnique.ts` decide whether it
 * may be offered at all.
 *
 * Pure data + pure functions only — no store, no React.
 *
 * Test seam: this module deliberately imports nothing, so the prose guard test can
 * read its source text and assert every canonical sentence still appears verbatim
 * in `VASCULAR_PROSE_SOURCE`.
 */

export const VASCULAR_PROSE_SOURCE =
  "docs/clinical-libraries/mri-brain-mra-mrv-clinical-content-library.md";

/** Verbatim from the canonical library. `…Prose` tests assert these against the file. */
export const VASCULAR_LIBRARY_PROSE = {
  mraIntracranialNormal:
    "Major intracranial arteries (Bilateral ICAs, MCAs, ACAs, PCAs, Basilar, and Vertebral arteries) demonstrate normal course, lumen caliber, and uniform high-velocity signal without focal stenosis, occlusion, or aneurysm.",
  mraNeckNormal:
    "Extracranial internal carotid and vertebral arteries demonstrate symmetric caliber and intact luminal flow voids without dissecting hematoma or high-grade stenosis.",
  mrvNormal:
    "Dural venous sinuses (Superior Sagittal, Straight, Bilateral Transverse, and Sigmoid sinuses) and deep cerebral veins (Internal Cerebral Veins, Vein of Galen) demonstrate normal venous flow signal without filling defect.",

  acomAneurysm:
    "Saccular aneurysmal outpouching originating from the anterior communicating artery (ACom) measuring [X] mm (neck) x [X] mm (width) x [X] mm (height), directed [anteriorly/inferiorly] without surrounding thrombus.",
  mcaBifurcationAneurysm:
    "Saccular aneurysm arising from the bifurcation of the [right/left] middle cerebral artery (MCA) measuring [X] x [X] mm.",
  mcaM1Stenosis:
    "Severe (70-80%) focal lumen narrowing / stenosis involving the M1 segment of the [left/right] MCA with secondary reduction in distal branch perfusion.",
  icaTerminusOcclusion:
    "Abrupt cut-off / complete absence of flow signal in the [right/left] internal carotid artery terminus extending into the M1 and A1 segments, diagnostic of acute arterial occlusion.",
  moyamoyaPattern:
    "Progressive occlusion of the bilateral terminal ICAs with a dense network of lenticulostriate collateral vessels (\"puff of smoke\" appearance), diagnostic of Moyamoya disease.",
  avmPattern:
    "Complex vascular malformation (AVM) centered in the [left/right] parietal lobe with a prominent feeding artery from the [MCA], a central nidus measuring [X] cm, and early draining veins into the superior sagittal sinus.",

  carotidDissection:
    "Eccentric crescentic T1 hyperintense intramural hematoma surrounding a narrowed lumen in the cervical segment of the [left/right] ICA, diagnostic of acute carotid artery dissection.",
  carotidBulbStenosis:
    "High-grade atherosclerotic stenosis (>80% NASCET) at the [left/right] carotid bulb / proximal ICA with irregular lumen ulceration.",
  vertebralPicaVariant:
    "Hypoplasia of the [right/left] vertebral artery terminating in PICA, representing a normal anatomic variant.",

  cvstSagittal:
    "Complete absence of normal venous flow signal replaced by T1 hyperintense / T2 hypointense clot filling the superior sagittal sinus, extending into the [left/right] transverse and sigmoid sinuses, diagnostic of acute dural venous sinus thrombosis.",
  cvstTransverseFillingDefect:
    "Focal filling defect within the [left/right] transverse sinus with peripheral rim enhancement on post-contrast MRV, consistent with subacute dural venous sinus thrombosis.",
  deepVenousThrombosis:
    "Thrombosis of the deep venous system (internal cerebral veins and vein of Galen) with secondary bilateral thalamic edema on FLAIR.",
  transverseSinusHypoplasia:
    "Congenital hypoplasia / aplasia of the [left/right] transverse sinus, a non-pathologic developmental variant.",
} as const;

export type VascularLibraryKey = keyof typeof VASCULAR_LIBRARY_PROSE;

/**
 * A library sentence divided per §1. `observation` is the descriptive part that may
 * be recorded from the palette; `interpretation` is the strong clause that only a
 * radiologist selection (plus its technique gate) may put into the report.
 * `joiner` rebuilds the library line from the two halves for the verbatim test.
 */
export type VascularProseSplit = {
  source: VascularLibraryKey;
  observation: string;
  interpretation?: string;
  joiner?: string;
};

export const VASCULAR_PROSE_SPLITS: readonly VascularProseSplit[] = [
  {
    source: "acomAneurysm",
    observation: VASCULAR_LIBRARY_PROSE.acomAneurysm,
  },
  {
    source: "mcaBifurcationAneurysm",
    observation: VASCULAR_LIBRARY_PROSE.mcaBifurcationAneurysm,
  },
  {
    source: "mcaM1Stenosis",
    // The numeric grade and the perfusion claim are the parts the technique cannot
    // hand over for free, so they leave the observation with the radiologist.
    observation:
      "Focal lumen narrowing / stenosis involving the M1 segment of the [left/right] MCA.",
    interpretation: "Severe (70-80%) stenosis with secondary reduction in distal branch perfusion.",
  },
  {
    source: "icaTerminusOcclusion",
    observation:
      "Abrupt cut-off / complete absence of flow signal in the [right/left] internal carotid artery terminus extending into the M1 and A1 segments",
    interpretation: "Diagnostic of acute arterial occlusion.",  },
  {
    source: "moyamoyaPattern",
    observation:
      "Progressive occlusion of the bilateral terminal ICAs with a dense network of lenticulostriate collateral vessels (\"puff of smoke\" appearance)",
    interpretation: "Moyamoya disease.",  },
  {
    source: "avmPattern",
    observation:
      "Complex vascular malformation (AVM) centered in the [left/right] parietal lobe with a prominent feeding artery from the [MCA], a central nidus measuring [X] cm",
    interpretation: "Early draining veins into the superior sagittal sinus.",
    joiner: ", and ",
  },
  {
    source: "carotidDissection",
    observation:
      "Eccentric crescentic T1 hyperintense intramural hematoma surrounding a narrowed lumen in the cervical segment of the [left/right] ICA",
    interpretation: "Diagnostic of acute carotid artery dissection.",  },
  {
    source: "carotidBulbStenosis",
    observation:
      "Atherosclerotic stenosis at the [left/right] carotid bulb / proximal ICA with irregular lumen ulceration.",
    interpretation: "High-grade stenosis (>80% NASCET).",
  },
  {
    source: "vertebralPicaVariant",
    observation:
      "Hypoplasia of the [right/left] vertebral artery terminating in PICA",
    interpretation: "Representing a normal anatomic variant.",  },
  {
    source: "cvstSagittal",
    observation:
      "Complete absence of normal venous flow signal replaced by T1 hyperintense / T2 hypointense clot filling the superior sagittal sinus, extending into the [left/right] transverse and sigmoid sinuses",
    interpretation: "Diagnostic of acute dural venous sinus thrombosis.",  },
  {
    source: "cvstTransverseFillingDefect",
    observation:
      "Focal filling defect within the [left/right] transverse sinus with peripheral rim enhancement on post-contrast MRV",
    interpretation: "Consistent with subacute dural venous sinus thrombosis.",  },
  {
    source: "deepVenousThrombosis",
    observation:
      "Thrombosis of the deep venous system (internal cerebral veins and vein of Galen) with secondary bilateral thalamic edema on FLAIR.",
  },
  {
    source: "transverseSinusHypoplasia",
    observation:
      "Congenital hypoplasia / aplasia of the [left/right] transverse sinus",
    interpretation: "A non-pathologic developmental variant.",  },
];

export function vascularSplitFor(source: VascularLibraryKey): VascularProseSplit {
  const found = VASCULAR_PROSE_SPLITS.find((s) => s.source === source);
  if (!found) throw new Error(`mriBrainVascularProse: no split for ${source}`);
  return found;
}

/** Words that carry no clinical terminology, so the traceability guard skips them. */
const PROSE_STOPWORDS = new Set([
  "with", "that", "this", "from", "into", "the", "and", "for", "are", "has", "have",
  "their", "them", "over", "under", "without", "where", "when", "which", "about",
]);

/**
 * Every clinical word of a split half must be present in the library sentence it
 * came from. Re-ordering and dropping the strong clause are allowed; inventing a
 * new diagnostic term is not. Returns the terms that could not be traced.
 */
export function vascularUntracedProseWords(clause: string, sourceText: string): string[] {
  const haystack = sourceText.toLowerCase();
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const raw of clause.toLowerCase().split(/[^a-z0-9%.\-/]+/)) {
    const word = raw.replace(/^[.\-/]+|[.\-/]+$/g, "");
    if (word.length < 4 || PROSE_STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    if (!haystack.includes(word)) missing.push(word);
  }
  return missing;
}

// ─── §14 Basic intracranial MRA screening ────────────────────────────────

export const MRA_SCREENING_PROSE = {
  /** §14 normal screening seed, verbatim. */
  normal:
    "Major intracranial arteries demonstrate preserved flow-related signal without gross focal stenosis, occlusion or aneurysmal dilatation.",
  /** §14 limitation statement, verbatim, emitted exactly once per report. */
  limitation:
    "SCREENING MR ANGIOGRAPHY IS A LIMITED VASCULAR ASSESSMENT AND DOES NOT REPLACE A DEDICATED MRA/CTA/DSA WHEN CLINICALLY INDICATED.",
  sectionLabel: "Basic intracranial MRA screening",
} as const;

// ─── §17 Findings order ──────────────────────────────────────────────────

export const VASCULAR_FINDINGS_SECTIONS = {
  technique: "Technique",
  circleOfWillis: "Circle of Willis / configuration",
  anteriorCirculation: "Anterior circulation",
  posteriorCirculation: "Posterior circulation",
  focalArterialAbnormality: "Focal vascular abnormality",
  variants: "Anatomic variants",
  associatedBrain: "Associated brain findings",
  rightCarotid: "Right carotid system",
  leftCarotid: "Left carotid system",
  neckVertebrals: "Vertebral arteries",
  /**
   * The neck module's whole-tree normal. §17's neck list has no heading for a statement
   * that covers both carotid systems and the vertebrals, and reusing "Vertebral arteries"
   * here would be a real defect: the ledger matches a patch's section against the sentences
   * it may supersede, and the intracranial normal enumerates the vertebral arteries — so the
   * neck baseline would silently take the intracranial normal's line out of Findings
   * (mra/mrv spec §2, §15, §17; documented canonical discrepancy).
   */
  neckArterialTree: "Extracranial arterial tree",
  neckMeasurements: "Focal abnormality / measurements",
  duralSinuses: "Dural venous sinuses",
  deepVenousSystem: "Deep venous system",
  otherVeins: "Other veins",
  thrombus: "Thrombus/abnormality",
} as const;

export type VascularFindingsSectionKey = keyof typeof VASCULAR_FINDINGS_SECTIONS;

/** §17 order, per module. */
export const INTRACRANIAL_MRA_FINDINGS_ORDER: readonly VascularFindingsSectionKey[] = [
  "technique",
  "circleOfWillis",
  "anteriorCirculation",
  "posteriorCirculation",
  "focalArterialAbnormality",
  "variants",
  "associatedBrain",
];

export const MRA_NECK_FINDINGS_ORDER: readonly VascularFindingsSectionKey[] = [
  "technique",
  "neckArterialTree",
  "rightCarotid",
  "leftCarotid",
  "neckVertebrals",
  "neckMeasurements",
  "variants",
];

export const MRV_FINDINGS_ORDER: readonly VascularFindingsSectionKey[] = [
  "technique",
  "duralSinuses",
  "deepVenousSystem",
  "otherVeins",
  "thrombus",
  "associatedBrain",
];

// ─── §16 supplied macros, verbatim line by line ──────────────────────────

export const ANEURYSM_MACRO_FINDINGS = [
  "Circle of Willis Configuration: Normal complete configuration of the Circle of Willis.",
  "Location: Saccular aneurysmal outpouching originating at the junction of the Anterior Communicating Artery (ACom) and the left A1/A2 segment.",
  "Dimensions: Maximum dome height = X mm, maximum transverse width = X mm, neck diameter = X mm (Dome-to-neck ratio = X).",
  "Orientation: The aneurysm sac is oriented anteroinferiorly.",
  "Thrombus / Parenchyma: No intrinsic thrombus or parenchymal mass effect. No high-grade adjacent parenchymal hemorrhage on T2* GRE/SWI.",
  "Other Vessels: Bilateral internal carotid, middle cerebral, posterior cerebral, and basilar arteries demonstrate normal caliber without additional focal stenosis or aneurysm.",
] as const;

export const ANEURYSM_MACRO_IMPRESSION =
  "Unruptured saccular aneurysm arising from the anterior communicating artery (ACom) measuring X x X mm with an X mm neck.";

export const CVST_MACRO_FINDINGS = [
  "Superior Sagittal Sinus: Complete loss of normal flow void, replaced by T1 hyperintense and T2/FLAIR iso-to-hypointense thrombus spanning from the anterior third to the torcular herophili.",
  "Transverse & Sigmoid Sinuses: Extension of non-occlusive thrombus into the proximal right transverse sinus. Left transverse and sigmoid sinuses demonstrate patent flow.",
  "Deep Veins: Internal cerebral veins, Vein of Galen, and Straight sinus are patent with preserved flow voids.",
  "Brain Parenchyma: Focal area of cortical T2/FLAIR hyperintensity with cortical petechial blooming on SWI in the high parasagittal superior frontal gyrus, compatible with venous hemorrhagic infarction.",
] as const;

export const CVST_MACRO_IMPRESSIONS = [
  "Acute extensive dural venous sinus thrombosis involving the entire superior sagittal sinus and proximal right transverse sinus.",
  "Secondary acute venous hemorrhagic infarction in the superior frontal cortex.",
] as const;
