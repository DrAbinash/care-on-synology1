/**
 * MRI Brain — Normal (Contrast) owned baseline.
 *
 * The shipped contrast normal (report-formats-library.ts) carried the clinic's
 * sentence list but no `baselineManifest`, so `materializeFormatBaseline` returned
 * zero rows and Quick Select had nothing to retire: clicking an enhancing-tumour
 * tile on a CE-MRI brain left "No abnormal enhancement on post-contrast study."
 * printed underneath it.
 *
 * Ownership here adds no clinical claim: every sentence the row printed is kept
 * verbatim, and FINDINGS carries all of them — the two folded sentences (see the
 * note below) now sitting with the anatomy they describe rather than where the
 * hand-written paragraph happened to put them. `validateBaselineManifest` fails the
 * whole manifest closed if an observation ever stops being part of what prints.
 *
 * Canon concepts used: brain_parenchyma, basal_ganglia, mass_effect, ventricles,
 * posterior_fossa, extra_axial, enhancement_normal, vascular_flow_voids, sellar.
 * Two sentences have no concept of their own and are folded into the observation
 * whose anatomy they describe — the internal auditory canal / CP-angle line into
 * the posterior fossa (it is posterior fossa anatomy) and the "no focal or diffuse
 * altered signal" line into the parenchyma claim — because a slot carrying a concept
 * nothing else in CARE writes is a slot no tile can ever contradict. One printed
 * sentence is deliberately left un-owned, for the reason written at that row.
 */
import { SYSTEM_NORMAL_CONCEPT } from "@/lib/conceptCanon/normalImpression";
import type { BaselineManifest, BaselineManifestObservation } from "../types";

export const MRI_BRAIN_CONTRAST_NORMAL_NAME = "MRI Brain — Normal (Contrast)";

/**
 * Printed, deliberately not owned (see the note at its place in FINDINGS below). Named here so
 * the sentence cannot be lost: the manifest lists what a scaffold can restore, FINDINGS lists
 * what the report says, and those two sets are only allowed to differ by wording like this.
 */
const MIDLINE_POSITION_SENTENCE = "Midline structures: septum pellucidum and falx cerebri are in midline.";

const CONTRAST_NORMALS: BaselineManifestObservation[] = [
  {
    id: "cerebral-hemispheres",
    field: "findings",
    concept: "brain_parenchyma",
    conflictGroup: "brain_parenchyma",
    anatomicalSection: "brain parenchyma",
    renderedText:
      "Cerebral hemispheres show normal morphology and signal characteristics. Gray-white matter differentiation is preserved. Parenchymal signal: no focal or diffuse areas of altered signal intensity.",
  },
  {
    id: "deep-gray-matter",
    field: "findings",
    concept: "basal_ganglia",
    conflictGroup: "basal_ganglia",
    anatomicalSection: "basal ganglia",
    renderedText:
      "Deep gray matter structures: basal ganglia, thalami and corpus callosum appear normal in signal and structure.",
  },
  // "Midline structures: septum pellucidum and falx cerebri are in midline." is deliberately
  // NOT a row. CARE's abnormality oracle keeps a conservative fallback for wording its lists
  // do not name: a sentence with no cue and no normal predicate ("normal / unremarkable /
  // preserved / maintained / patent / symmetric …") reads as a FINDING, and "are in midline"
  // is exactly that shape. `generateProfessionalReport.test.ts` fails the corpus on it, and it
  // is right to — a baseline row that reads as a finding is one the retirement engine will not
  // suppress. The sentence still prints and the "Midline shift" box still retires it (measured);
  // it is simply not restorable from a scaffold row, which is how it behaved before this
  // baseline existed. Teaching the oracle the position vocabulary is a predicate change, not
  // this one's to make. The shift denial below is owned because "No evidence of …" is a denial
  // cue the oracle does read.
  {
    id: "mass-effect",
    field: "findings",
    concept: "mass_effect",
    conflictGroup: "mass_effect",
    anatomicalSection: "mass effect",
    renderedText: "No evidence of mass effect or midline shift.",
  },
  {
    id: "ventricles",
    field: "findings",
    concept: "ventricles",
    conflictGroup: "ventricles",
    anatomicalSection: "ventricles",
    renderedText:
      "Ventricular system and CSF spaces: lateral, third and fourth ventricles normal in size and configuration. Supratentorial sulci and cisterns within normal limits.",
  },
  {
    id: "posterior-fossa",
    field: "findings",
    concept: "posterior_fossa",
    conflictGroup: "posterior_fossa",
    anatomicalSection: "posterior fossa",
    renderedText:
      "Posterior fossa: brainstem and cerebellar hemispheres show normal morphology and signal intensity. Fourth ventricle midline and normal in size. Internal auditory canals and CP angles: bilateral internal acoustic meatus and cerebellopontine angles normal.",
  },
  {
    id: "space-occupying-lesion",
    field: "findings",
    concept: "extra_axial",
    conflictGroup: "extra_axial",
    anatomicalSection: "extra-axial spaces",
    renderedText: "No intra- or extra-axial space-occupying lesions identified.",
  },
  {
    id: "contrast-enhancement",
    field: "findings",
    concept: "enhancement_normal",
    conflictGroup: "enhancement_normal",
    anatomicalSection: "post-contrast examination",
    renderedText: "No abnormal enhancement on post-contrast study.",
  },
  {
    id: "venous-sinuses",
    field: "findings",
    concept: "vascular_flow_voids",
    conflictGroup: "vascular_flow_voids",
    anatomicalSection: "intracranial vessels",
    renderedText:
      "Venous sinuses: major intracranial dural venous sinuses demonstrate normal flow voids and outline.",
  },
  {
    id: "sellar",
    field: "findings",
    concept: "sellar",
    conflictGroup: "sellar",
    anatomicalSection: "sellar region",
    renderedText:
      "Sellar and parasellar region: sella turcica, suprasellar and parasellar structures unremarkable.",
  },
];

// FINDINGS is the rows' text with the one un-owned sentence spliced in where the shipped row
// printed it. Deriving the paragraph from the observations alone would have deleted the
// clinic's own wording, which is the one thing an ownership change must never do.
export const MRI_BRAIN_CONTRAST_NORMAL_FINDINGS = CONTRAST_NORMALS.flatMap((o) =>
  o.id === "mass-effect" ? [MIDLINE_POSITION_SENTENCE, o.renderedText] : [o.renderedText],
).join(" ");

export const MRI_BRAIN_CONTRAST_NORMAL_IMPRESSION =
  "Normal CE-MRI brain. No abnormal enhancement or space-occupying lesion.";

export const MRI_BRAIN_CONTRAST_NORMAL_MANIFEST: BaselineManifest = {
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: "mri-brain-contrast-normal-r1",
  observations: [
    ...CONTRAST_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_BRAIN_CONTRAST_NORMAL_IMPRESSION,
    },
  ],
};

export const MRI_BRAIN_CONTRAST_NORMAL_META = {
  name: MRI_BRAIN_CONTRAST_NORMAL_NAME,
  bodyPart: "Brain",
  modality: "MR" as const,
  protocolScope: "Contrast",
  clinicalHistory: "Contrast-enhanced MRI brain requested. Correlate with presenting symptoms.",
  technique:
    "MRI brain on 3T. T1W, T2W, FLAIR, DWI, ADC, SWI. Post-contrast T1W GRE. 5 mm. IV: Gadobutrol 0.1 mmol/kg.",
  recommendation: "Clinical correlation. Follow-up if clinically indicated.",
  reportTitle: "CE-MRI BRAIN",
  findings: MRI_BRAIN_CONTRAST_NORMAL_FINDINGS,
  impression: MRI_BRAIN_CONTRAST_NORMAL_IMPRESSION,
  diagnosisTags: ["normal", "contrast", "owned baseline"],
  manifest: MRI_BRAIN_CONTRAST_NORMAL_MANIFEST,
};
