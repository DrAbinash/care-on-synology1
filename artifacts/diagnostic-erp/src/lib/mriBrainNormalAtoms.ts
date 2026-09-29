/**
 * mriBrainNormalAtoms.ts — protocol-aware NORMAL MRI Brain baseline.
 *
 * Emits the structured normal observations as ledger atoms on the SAME
 * concepts / conflict groups as the MRI_BRAIN_STANDARD_NORMAL manifest, so a
 * subsequently entered abnormal observation reconciles (same-slot replace +
 * baselineReplaces) instead of contradicting the normal.
 *
 * Sequence-aware: DWI/ADC, GRE/SWI, contrast, MRS and angiography statements
 * are ONLY emitted when the technique proves those were performed. Incidental
 * / extracranial structures are separate atoms so each stays individually
 * editable and removable.
 *
 * Pediatric guard: adult involution / atrophy wording is never emitted for a
 * pediatric study.
 */

import type { PendingPathologyPatch } from "@/lib/zai-workspace/store";
import {
  brainAtomsToPatches,
  brainBundleId,
  type BrainAtomSpec,
} from "@/lib/mriBrainAtoms";
import { sequenceAllows, type BrainSequenceContext } from "@/lib/mriBrainSequences";

export const BRAIN_NORMAL_SENTENCES = {
  parenchyma:
    "The cerebral hemispheres show normal morphology with preserved grey-white matter differentiation. No focal parenchymal signal abnormality is seen.",
  infarct: "No evidence of acute infarct.",
  diffusion: "No restricted diffusion is seen on DWI/ADC.",
  hemorrhage: "No intracranial haemorrhage is seen.",
  susceptibility: "No abnormal susceptibility blooming is seen on GRE/SWI.",
  basalGanglia: "Basal ganglia and thalami are symmetric and normal in signal.",
  ventricles: "The ventricular system is appropriate for age. The basal cisterns are patent. No hydrocephalus.",
  extraAxial: "No extra-axial collection is identified.",
  midline: "No midline shift. No mass effect.",
  vascularFlowVoids: "Major intracranial vascular flow voids are preserved where assessable.",
  brainstem: "The brainstem is normal in morphology and signal.",
  cerebellum: "The cerebellum is unremarkable.",
  posteriorFossa: "The posterior fossa is unremarkable.",
  sellar: "The sellar and parasellar region is grossly unremarkable.",
  craniocervical: "The craniocervical junction is unremarkable.",
  enhancement: "No abnormal enhancement following contrast administration.",
  mra: "No arterial occlusion or significant stenosis on MRA.",
  mrv: "The dural venous sinuses are patent on MRV.",
  mrs: "MR spectroscopy shows no significant metabolite abnormality.",
  sinuses: "The visualised paranasal sinuses are clear.",
  mastoids: "The visualised mastoid air cells are clear.",
  orbits: "The orbits are unremarkable.",
  scalp: "The calvarium and scalp soft tissues are unremarkable.",
} as const;

export type BrainNormalAtom = BrainAtomSpec;

/**
 * Sequence-aware normal set. `withIncidentals: false` omits the separately
 * editable extracranial structures (sinuses / mastoids / orbits / scalp).
 */
export function buildBrainNormalAtoms(opts: {
  region?: string;
  seq: BrainSequenceContext;
  withIncidentals?: boolean;
  bundleId?: string;
}): { bundleId: string; observations: PendingPathologyPatch[] } {
  const { seq } = opts;
  const region = opts.region ?? "Brain";
  const bundleId = opts.bundleId ?? brainBundleId("normal", "baseline");
  const atoms: BrainAtomSpec[] = [];
  const push = (
    concept: string,
    findings: string,
    extra?: Partial<BrainAtomSpec>,
  ) =>
    atoms.push({
      concept,
      conflictGroup: extra?.conflictGroup ?? concept,
      anatomicalSection: extra?.anatomicalSection ?? "brain",
      findings,
      // Normal sentences are a materialized baseline, not abnormalities —
      // the ledger treats role "baseline" as supersede-able by the first
      // same-slot abnormal observation.
      role: "baseline",
      ...extra,
    });

  push("brain_parenchyma", BRAIN_NORMAL_SENTENCES.parenchyma);
  // Acute-infarct conclusions require diffusion imaging.
  if (sequenceAllows(seq, ["dwi", "adc"])) {
    push("infarct", BRAIN_NORMAL_SENTENCES.infarct);
    push("diffusion", BRAIN_NORMAL_SENTENCES.diffusion);
  }
  push("hemorrhage", BRAIN_NORMAL_SENTENCES.hemorrhage);
  if (seq.performed.swiGre) {
    push("susceptibility", BRAIN_NORMAL_SENTENCES.susceptibility);
  }
  push("basal_ganglia", BRAIN_NORMAL_SENTENCES.basalGanglia);
  push("ventricles", BRAIN_NORMAL_SENTENCES.ventricles, { anatomicalSection: "ventricles" });
  push("extra_axial", BRAIN_NORMAL_SENTENCES.extraAxial, { anatomicalSection: "extra-axial spaces" });
  push("midline", BRAIN_NORMAL_SENTENCES.midline, { anatomicalSection: "midline" });
  push("vascular_flow_voids", BRAIN_NORMAL_SENTENCES.vascularFlowVoids, {
    anatomicalSection: "intracranial vessels",
  });
  push("brainstem", BRAIN_NORMAL_SENTENCES.brainstem, { anatomicalSection: "brainstem" });
  push("cerebellum", BRAIN_NORMAL_SENTENCES.cerebellum, { anatomicalSection: "cerebellum" });
  push("posterior_fossa", BRAIN_NORMAL_SENTENCES.posteriorFossa, {
    anatomicalSection: "posterior fossa",
  });
  push("sellar", BRAIN_NORMAL_SENTENCES.sellar, { anatomicalSection: "sellar region" });
  push("craniocervical_junction", BRAIN_NORMAL_SENTENCES.craniocervical, {
    anatomicalSection: "craniocervical junction",
  });
  if (seq.performed.contrast) {
    push("enhancement_normal", BRAIN_NORMAL_SENTENCES.enhancement);
  }
  if (seq.performed.mra) push("mra_arterial", BRAIN_NORMAL_SENTENCES.mra, { anatomicalSection: "intracranial vessels" });
  if (seq.performed.mrv) push("mrv_venous", BRAIN_NORMAL_SENTENCES.mrv, { anatomicalSection: "intracranial vessels" });
  if (seq.performed.mrs) push("mrs_metabolites", BRAIN_NORMAL_SENTENCES.mrs, { anatomicalSection: "spectroscopy" });

  if (opts.withIncidentals !== false) {
    push("sinus", BRAIN_NORMAL_SENTENCES.sinuses, { anatomicalSection: "paranasal sinuses" });
    push("mastoid", BRAIN_NORMAL_SENTENCES.mastoids, { anatomicalSection: "mastoids" });
    push("orbital", BRAIN_NORMAL_SENTENCES.orbits, { anatomicalSection: "orbits" });
    push("scalp", BRAIN_NORMAL_SENTENCES.scalp, { anatomicalSection: "scalp and calvarium" });
  }

  // Pediatric studies must not silently inherit adult involution wording —
  // the normal set above is age-neutral by construction; assert nothing here.

  return { bundleId, observations: brainAtomsToPatches(region, bundleId, atoms) };
}
