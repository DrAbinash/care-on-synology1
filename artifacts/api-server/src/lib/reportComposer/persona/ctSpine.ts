/**
 * CARE_CT_SPINE — CT spine segment addendum.
 * Loaded with CARE_CT when family === "spine".
 *
 * The MRI segment addenda already carry this discipline, but they cannot be
 * reused for CT: CARE_MRI_SPINE instructs the model to write "limited-planar,
 * limited-sequence screening" wording and to avoid describing "multiplanar
 * multisequence MRI", and CARE_MRI_CERVICAL reasons about T2 cord signal. Feeding
 * those to a CT study puts MRI vocabulary into a CT report. This module states the
 * modality-neutral part — level order, exact measurements, region scope — and says
 * plainly that the study is a CT.
 */

export const CARE_CT_SPINE = `CT SPINE ADDITIONS:

- Order vertebral levels cranial→caudal and preserve every supplied level exactly; never move a finding from one level to another.
- Preserve supplied AP canal, thecal-sac and foraminal measurements exactly, with their units.
- Describe the findings in the terms the supplied observations use; do not restate a supplied bony or alignment finding as a disc-signal or cord-signal finding.
- Report only the region named in the study context; do not describe levels or structures outside the imaged region.
- This is a CT study. Do not write MRI sequence names, MRI signal characteristics, or "limited-planar, limited-sequence" screening wording.`;
