/**
 * mriDorsalBaselines.ts — the dorsal normal-sentence supersession contract
 * (dorsal spec §5: "Normal → abnormal reconciliation is mandatory").
 *
 * The normal dorsal preset seeds the ledger with the canonical library's own
 * normal sentences. When the radiologist then documents an abnormality, the
 * contradicting normal sentence must be claimed by the new observation so the
 * existing ledger machinery removes it — otherwise the report says the cord is
 * normal and compressed in the same section.
 *
 * The claim is expressed as `baselineReplaces`, the sentence text the abnormal
 * observation supersedes. It is keyed by concept because that is how the ledger
 * decides sentence ownership (`observationSlot.sentenceOwnedBySlot`), and it is
 * applied centrally at bundle build time so no palette author has to remember it
 * — and so no atom silently keeps an unrelated baseline claim.
 *
 * Pure data + functions only — no store, no React.
 */

import { DX_ALIGN, DX_BONE, DX_CANAL, DX_DISC, DX_POSTERIOR, DX_SOFT } from "./mriDorsalLibrary";
import type { SpineAtomSpec } from "./mriSpineAtoms";

/**
 * concept → the normal sentence an abnormality of that concept contradicts.
 * Only concepts the normal preset actually emits appear here.
 */
export const DORSAL_NORMAL_SENTENCE_BY_CONCEPT: Record<string, string> = {
  alignment: DX_ALIGN.normal,
  kyphosis: DX_ALIGN.normal,
  gibbus_deformity: DX_ALIGN.normal,
  spondylolisthesis: DX_ALIGN.normal,
  compression_fracture: DX_BONE.normal,
  vertebral_collapse: DX_BONE.normal,
  marrow_edema: DX_BONE.normal,
  bone_lesion: DX_BONE.noFocalLesion,
  retropulsion: DX_BONE.normal,
  posterior_elements: DX_POSTERIOR.posteriorElementsIntact,
  costovertebral_joint: DX_POSTERIOR.normal,
  facet_joint: DX_POSTERIOR.normal,
  foraminal_stenosis: DX_POSTERIOR.normal,
  root_contact: DX_POSTERIOR.normal,
  disc_contour: DX_DISC.normal,
  disc_signal: DX_DISC.normal,
  disc_migration: DX_DISC.normal,
  disc_height: DX_DISC.normal,
  canal_stenosis: DX_CANAL.normal,
  canal_morphology: DX_CANAL.normal,
  canal_ap: DX_CANAL.normal,
  olf: DX_CANAL.normal,
  opl_ossification: DX_CANAL.normal,
  cord_compression: DX_CANAL.cordNormal,
  cord_caliber: DX_CANAL.cordNormal,
  cord_signal: DX_CANAL.cordNormal,
  intradural_lesion: DX_CANAL.cordNormal,
  intramedullary_lesion: DX_CANAL.cordNormal,
  syrinx: DX_CANAL.cordNormal,
  conus_medullaris: DX_CANAL.conusTerminates,
  paravertebral_collection: DX_SOFT.normal,
  epidural_space: DX_SOFT.normal,
  epidural_collection: DX_SOFT.normal,
  epidural_lipomatosis: DX_SOFT.normal,
};

/**
 * Give every abnormal atom the baseline claim for its concept, unless it already
 * declares one. Baseline atoms themselves are left untouched, so a normal preset
 * never claims its own sentence.
 */
export function withDorsalBaselineContract<A extends SpineAtomSpec>(atoms: A[]): A[] {
  return atoms.map((atom) => {
    if (atom.role === "baseline" || atom.baselineReplaces) return atom;
    // An unfilled library slot (e.g. a conus sentence with the level still
    // bracketed) is a coverage statement, not a contradiction to remove.
    const baseline = DORSAL_NORMAL_SENTENCE_BY_CONCEPT[atom.concept];
    if (!baseline || atom.findings.includes(baseline)) return atom;
    return { ...atom, baselineReplaces: baseline };
  });
}
